#!/usr/bin/env npx tsx
/**
 * model-selector.ts — Analyze model performance across tickets
 * and generate an optimized model selection config.
 *
 * Reads: slope-loop/logs/*-models.jsonl (per-ticket model tracking)
 * Outputs: slope-loop/model-config.json (data-driven model selection rules)
 *
 * Run: npx tsx slope-loop/model-selector.ts
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, 'logs');
const OUTPUT = join(__dirname, 'model-config.json');
const MIN_SAMPLES = 3;

interface TicketResult {
  ticket: string;
  club: string;
  primary_model: string;
  final_model: string;
  escalated: boolean;
  tests_passing: boolean;
  // Cross-dimensional fields (optional for backward compat with old logs)
  strategy?: string;
  sprint_type?: string;
  // Cost tracking
  cost_usd?: number;
}

type StatsMap = Record<string, { total: number; passing: number }>;

function computeRates(stats: StatsMap): Record<string, { total: number; passing: number; rate: number }> {
  return Object.fromEntries(
    Object.entries(stats).map(([k, v]) => [k, {
      ...v,
      rate: Math.round((v.passing / v.total) * 100),
    }]),
  );
}

function increment(stats: StatsMap, key: string, passing: boolean): void {
  if (!stats[key]) stats[key] = { total: 0, passing: 0 };
  stats[key].total++;
  if (passing) stats[key].passing++;
}

function run(): void {
  if (!existsSync(LOG_DIR)) {
    console.log('No logs/ directory found. Run some sprints first.');
    process.exit(0);
  }

  // Collect all model results
  const results: TicketResult[] = [];
  const modelLogs = readdirSync(LOG_DIR).filter(f => f.endsWith('-models.jsonl'));

  for (const file of modelLogs) {
    const content = readFileSync(join(LOG_DIR, file), 'utf-8').trim();
    if (!content) continue;
    for (const line of content.split('\n')) {
      try {
        results.push(JSON.parse(line));
      } catch { /* skip malformed */ }
    }
  }

  if (results.length < 10) {
    console.log(`Only ${results.length} ticket results — need 10+ for meaningful analysis.`);
    console.log('Using default club->model mapping for now.');
    process.exit(0);
  }

  // ── Per-club x model stats (existing) ─────────────────
  const clubModelStats: StatsMap = {};
  for (const r of results) {
    increment(clubModelStats, `${r.club}:${r.final_model}`, r.tests_passing);
  }

  // ── Cross-dimensional: club x strategy ────────────────
  const strategyStats: StatsMap = {};
  for (const r of results) {
    if (r.strategy) {
      increment(strategyStats, `${r.club}:${r.strategy}`, r.tests_passing);
    }
  }

  // ── Cross-dimensional: club x sprint_type ─────────────
  const typeStats: StatsMap = {};
  for (const r of results) {
    if (r.sprint_type) {
      increment(typeStats, `${r.club}:${r.sprint_type}`, r.tests_passing);
    }
  }

  // ── Escalation analysis ───────────────────────────────
  const escalations = results.filter(r => r.escalated);
  const escalationSaveRate = escalations.length > 0
    ? escalations.filter(r => r.tests_passing).length / escalations.length
    : 0;

  // ── Cost per success tracking ─────────────────────────
  const costPerSuccess: Record<string, number> = {};
  for (const [key, val] of Object.entries(clubModelStats)) {
    const isApi = key.includes('minimax') || key.includes('openrouter') || key.includes('anthropic');
    const costPerTicket = isApi ? 3.0 : 0;
    const successCount = val.passing || 1;
    costPerSuccess[key] = (costPerTicket * val.total) / successCount;
  }

  // ── Cost-adjusted scores (higher = better) ────────────
  const costAdjustedScores: Record<string, number> = {};
  const epsilon = 0.01; // avoid division by zero
  for (const [key, val] of Object.entries(clubModelStats)) {
    const rate = val.total > 0 ? val.passing / val.total : 0;
    const cost = costPerSuccess[key] ?? epsilon;
    costAdjustedScores[key] = Math.round((rate / (cost + epsilon)) * 1000) / 1000;
  }

  // ── Per-club recommendations (existing) ───────────────
  const recommendations: Record<string, { model: string; reason: string }> = {};
  const clubs = [...new Set(results.map(r => r.club))];

  for (const club of clubs) {
    const localKey = `${club}:ollama/qwen2.5-coder:32b`;
    const apiKey = `${club}:openrouter/minimax/minimax-m2.5`;

    const localStats = clubModelStats[localKey] ?? { total: 0, passing: 0 };
    const apiStats = clubModelStats[apiKey] ?? { total: 0, passing: 0 };

    const localRate = localStats.total > 0 ? localStats.passing / localStats.total : 0;
    const apiRate = apiStats.total > 0 ? apiStats.passing / apiStats.total : 0;

    if (localStats.total >= MIN_SAMPLES && localRate < 0.6 && (apiRate > localRate + 0.2 || apiStats.total === 0)) {
      recommendations[club] = { model: 'api', reason: `local rate ${Math.round(localRate * 100)}% < 60%` };
    } else if (localStats.total >= MIN_SAMPLES && localRate >= 0.6) {
      recommendations[club] = { model: 'local', reason: `local rate ${Math.round(localRate * 100)}% >= 60%` };
    } else {
      recommendations[club] = { model: 'local', reason: 'insufficient data, defaulting to local' };
    }
  }

  // ── Cross-dimensional recommendations ─────────────────
  function crossDimRecs(stats: StatsMap): Record<string, { model: string; reason: string; samples: number }> {
    const recs: Record<string, { model: string; reason: string; samples: number }> = {};
    for (const [key, val] of Object.entries(stats)) {
      if (val.total < MIN_SAMPLES) continue;
      const rate = val.passing / val.total;
      recs[key] = {
        model: rate >= 0.6 ? 'local' : 'api',
        reason: `${Math.round(rate * 100)}% success (${val.passing}/${val.total})`,
        samples: val.total,
      };
    }
    return recs;
  }

  const recsByStrategy = crossDimRecs(strategyStats);
  const recsByType = crossDimRecs(typeStats);

  // ── Output ────────────────────────────────────────────
  const config = {
    generated_at: new Date().toISOString(),
    ticket_count: results.length,
    escalation_save_rate: Math.round(escalationSaveRate * 100),
    success_rates: computeRates(clubModelStats),
    success_rates_by_strategy: Object.keys(strategyStats).length > 0 ? computeRates(strategyStats) : undefined,
    success_rates_by_type: Object.keys(typeStats).length > 0 ? computeRates(typeStats) : undefined,
    cost_per_success: costPerSuccess,
    cost_adjusted_scores: costAdjustedScores,
    recommendations,
    recommendations_by_strategy: Object.keys(recsByStrategy).length > 0 ? recsByStrategy : undefined,
    recommendations_by_type: Object.keys(recsByType).length > 0 ? recsByType : undefined,
    min_samples: MIN_SAMPLES,
    notes: [
      'Recommendations based on observed success rates per club x model combination',
      `Escalation save rate: ${Math.round(escalationSaveRate * 100)}% (${escalations.filter(r => r.tests_passing).length}/${escalations.length})`,
      `Cross-dimensional breakdowns require strategy/sprint_type in JSONL logs (added in v1.37)`,
      'Run again after 10+ more sprints for updated recommendations',
    ],
  };

  writeFileSync(OUTPUT, JSON.stringify(config, null, 2) + '\n');

  console.log('=== Model Performance Analysis ===\n');
  console.log(`Tickets analyzed: ${results.length}`);
  console.log(`Escalation save rate: ${Math.round(escalationSaveRate * 100)}%\n`);

  console.log('Success rates (club:model):');
  for (const [key, val] of Object.entries(clubModelStats)) {
    const rate = Math.round((val.passing / val.total) * 100);
    console.log(`  ${key}: ${rate}% (${val.passing}/${val.total})`);
  }

  if (Object.keys(strategyStats).length > 0) {
    console.log('\nSuccess rates (club:strategy):');
    for (const [key, val] of Object.entries(strategyStats)) {
      const rate = Math.round((val.passing / val.total) * 100);
      console.log(`  ${key}: ${rate}% (${val.passing}/${val.total})`);
    }
  }

  console.log('\nCost-adjusted scores (higher = better):');
  for (const [key, score] of Object.entries(costAdjustedScores)) {
    console.log(`  ${key}: ${score}`);
  }

  console.log('\nRecommendations:');
  for (const [club, rec] of Object.entries(recommendations)) {
    console.log(`  ${club} -> ${rec.model} (${rec.reason})`);
  }

  console.log(`\nConfig: ${OUTPUT}`);
}

run();
