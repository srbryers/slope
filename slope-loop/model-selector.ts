#!/usr/bin/env npx tsx
/**
 * model-selector.ts — Analyze model performance across tickets
 * and generate an optimized model selection config.
 *
 * Reads: slope-loop/logs/*-models.jsonl (per-ticket model tracking)
 * Reads: slope-loop/backlog.json (for strategy and type info)
 * Outputs: slope-loop/model-config.json (data-driven model selection rules)
 *
 * Run: npx tsx slope-loop/model-selector.ts
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, 'logs');
const BACKLOG_PATH = join(__dirname, 'backlog.json');
const OUTPUT = join(__dirname, 'model-config.json');

const DEFAULT_MIN_SAMPLES = 3;

interface TicketResult {
  ticket: string;
  club: string;
  primary_model: string;
  final_model: string;
  escalated: boolean;
  tests_passing: boolean;
}

interface BacklogSprint {
  id: string;
  strategy: string;
  type: string;
}

interface BacklogFile {
  sprints: BacklogSprint[];
}

function run(): void {
  if (!existsSync(LOG_DIR)) {
    console.log('No logs/ directory found. Run some sprints first.');
    process.exit(0);
  }

  // Load backlog for strategy/type mapping
  let backlog: BacklogFile | null = null;
  if (existsSync(BACKLOG_PATH)) {
    try {
      backlog = JSON.parse(readFileSync(BACKLOG_PATH, 'utf8')) as BacklogFile;
    } catch {
      // ignore
    }
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

  // Build sprint lookup from backlog
  const sprintMeta: Record<string, { strategy: string; type: string }> = {};
  if (backlog) {
    for (const sprint of backlog.sprints) {
      sprintMeta[sprint.id] = { strategy: sprint.strategy, type: sprint.type };
    }
  }

  // Annotate results with strategy/type from filename
  for (const r of results) {
    // Filename format: S<number>-models.jsonl -> sprint ID: S<number>
    // Extract sprint ID from ticket key (e.g., "S27-1" -> "S27")
    const match = r.ticket.match(/^(S\d+)/);
    if (match) {
      const sprintId = match[1];
      const meta = sprintMeta[sprintId];
      if (meta) {
        (r as Record<string, unknown>).strategy = meta.strategy;
        (r as Record<string, unknown>).type = meta.type;
      }
    }
  }

  // Analyze success rates by club x model
  const stats: Record<string, { total: number; passing: number }> = {};

  for (const r of results) {
    const key = `${r.club}:${r.final_model}`;
    if (!stats[key]) stats[key] = { total: 0, passing: 0 };
    stats[key].total++;
    if (r.tests_passing) stats[key].passing++;
  }

  // Analyze success rates by club x strategy
  const statsByStrategy: Record<string, Record<string, { total: number; passing: number }>> = {};
  for (const r of results) {
    const strategy = (r as Record<string, unknown>).strategy as string | undefined;
    if (!strategy) continue;
    if (!statsByStrategy[r.club]) statsByStrategy[r.club] = {};
    if (!statsByStrategy[r.club][strategy]) statsByStrategy[r.club][strategy] = { total: 0, passing: 0 };
    statsByStrategy[r.club][strategy].total++;
    if (r.tests_passing) statsByStrategy[r.club][strategy].passing++;
  }

  // Analyze success rates by club x type
  const statsByType: Record<string, Record<string, { total: number; passing: number }>> = {};
  for (const r of results) {
    const type = (r as Record<string, unknown>).type as string | undefined;
    if (!type) continue;
    if (!statsByType[r.club]) statsByType[r.club] = {};
    if (!statsByType[r.club][type]) statsByType[r.club][type] = { total: 0, passing: 0 };
    statsByType[r.club][type].total++;
    if (r.tests_passing) statsByType[r.club][type].passing++;
  }

  // Analyze escalation patterns
  const escalations = results.filter(r => r.escalated);
  const escalationSaveRate = escalations.length > 0
    ? escalations.filter(r => r.tests_passing).length / escalations.length
    : 0;

  // Cost per success tracking
  const costPerSuccess: Record<string, number> = {};
  for (const [key, val] of Object.entries(stats)) {
    const isApi = key.includes('minimax') || key.includes('openrouter');
    const costPerTicket = isApi ? 3.0 : 0; // ~$3 per API ticket, $0 local
    const successCount = val.passing || 1;
    costPerSuccess[key] = (costPerTicket * val.total) / successCount;
  }

  // Cost-adjusted score: success_rate / (cost_per_success + epsilon)
  const EPSILON = 0.01;
  const costAdjustedScores: Record<string, number> = {};
  for (const [key, val] of Object.entries(stats)) {
    const rate = (val.passing / val.total); // success rate 0-1
    const cost = costPerSuccess[key] || EPSILON;
    costAdjustedScores[key] = rate / (cost + EPSILON);
  }

  // Helper to compute rate with min_samples check
  function computeRate(s: { total: number; passing: number } | undefined): { total: number; passing: number; rate: number } | null {
    if (!s || s.total < DEFAULT_MIN_SAMPLES) return null;
    return { ...s, rate: Math.round((s.passing / s.total) * 100) };
  }

  // Generate recommendations
  const recommendations: Record<string, { model: 'api' | 'local'; reason: string }> = {};
  const clubs = [...new Set(results.map(r => r.club))];

  for (const club of clubs) {
    const localKey = `${club}:ollama/qwen2.5-coder:32b`;
    const apiKey = `${club}:openrouter/minimax/minimax-m2.5`;

    const localStats = stats[localKey] ?? { total: 0, passing: 0 };
    const apiStats = stats[apiKey] ?? { total: 0, passing: 0 };

    const localRate = localStats.total > 0 ? localStats.passing / localStats.total : 0;
    const apiRate = apiStats.total > 0 ? apiStats.passing / apiStats.total : 0;

    // Only recommend if we have enough samples
    if (localStats.total >= DEFAULT_MIN_SAMPLES || apiStats.total >= DEFAULT_MIN_SAMPLES) {
      // If local success rate < 60% and API is significantly better, recommend API
      if (localStats.total >= DEFAULT_MIN_SAMPLES && localRate < 0.6 && (apiRate > localRate + 0.2 || apiStats.total === 0)) {
        recommendations[club] = { model: 'api', reason: `local rate ${Math.round(localRate * 100)}% < 60%` };
      } else if (localStats.total >= DEFAULT_MIN_SAMPLES && localRate >= 0.6) {
        recommendations[club] = { model: 'local', reason: `local rate ${Math.round(localRate * 100)}% >= 60%` };
      } else {
        // Mixed signals or insufficient data - don't recommend
        recommendations[club] = { model: 'local', reason: 'mixed signals, defaulting to local' };
      }
    } else {
      recommendations[club] = { model: 'local', reason: 'insufficient data, defaulting to local' };
    }
  }

  // Build success_rates_by_strategy with min_samples filter
  const successRatesByStrategy: Record<string, Record<string, { total: number; passing: number; rate: number }>> = {};
  for (const [club, strategies] of Object.entries(statsByStrategy)) {
    successRatesByStrategy[club] = {};
    for (const [strategy, s] of Object.entries(strategies)) {
      const computed = computeRate(s);
      if (computed) {
        successRatesByStrategy[club][strategy] = computed;
      }
    }
  }

  // Build success_rates_by_type with min_samples filter
  const successRatesByType: Record<string, Record<string, { total: number; passing: number; rate: number }>> = {};
  for (const [club, types] of Object.entries(statsByType)) {
    successRatesByType[club] = {};
    for (const [type, s] of Object.entries(types)) {
      const computed = computeRate(s);
      if (computed) {
        successRatesByType[club][type] = computed;
      }
    }
  }

  const config = {
    generated_at: new Date().toISOString(),
    ticket_count: results.length,
    escalation_save_rate: Math.round(escalationSaveRate * 100),
    min_samples: DEFAULT_MIN_SAMPLES,
    success_rates: Object.fromEntries(
      Object.entries(stats).map(([k, v]) => [k, {
        ...v,
        rate: Math.round((v.passing / v.total) * 100),
      }]),
    ),
    success_rates_by_strategy: successRatesByStrategy,
    success_rates_by_type: successRatesByType,
    cost_per_success: costPerSuccess,
    cost_adjusted_scores: costAdjustedScores,
    recommendations,
    notes: [
      'Recommendations based on observed success rates per club x model combination',
      `Escalation save rate: ${Math.round(escalationSaveRate * 100)}% (${escalations.filter(r => r.tests_passing).length}/${escalations.length})`,
      `min_samples threshold: ${DEFAULT_MIN_SAMPLES} (recommendations only emitted when sample count >= min_samples)`,
      'cost_adjusted_score = success_rate / (cost_per_success + epsilon) — higher is better',
      'Run again after 10+ more sprints for updated recommendations',
    ],
  };

  writeFileSync(OUTPUT, JSON.stringify(config, null, 2) + '\n');

  console.log('=== Model Performance Analysis ===\n');
  console.log(`Tickets analyzed: ${results.length}`);
  console.log(`Escalation save rate: ${Math.round(escalationSaveRate * 100)}%\n`);

  console.log('Success rates (club:model):');
  for (const [key, val] of Object.entries(stats)) {
    const rate = Math.round((val.passing / val.total) * 100);
    console.log(`  ${key}: ${rate}% (${val.passing}/${val.total})`);
  }

  console.log('\nSuccess rates by club x strategy (>=3 samples):');
  for (const [club, strategies] of Object.entries(successRatesByStrategy)) {
    if (Object.keys(strategies).length === 0) continue;
    console.log(`  ${club}:`);
    for (const [strategy, s] of Object.entries(strategies)) {
      console.log(`    ${strategy}: ${s.rate}% (${s.passing}/${s.total})`);
    }
  }

  console.log('\nSuccess rates by club x type (>=3 samples):');
  for (const [club, types] of Object.entries(successRatesByType)) {
    if (Object.keys(types).length === 0) continue;
    console.log(`  ${club}:`);
    for (const [type, s] of Object.entries(types)) {
      console.log(`    ${type}: ${s.rate}% (${s.passing}/${s.total})`);
    }
  }

  console.log('\nRecommendations:');
  for (const [club, rec] of Object.entries(recommendations)) {
    console.log(`  ${club} -> ${rec.model} (${rec.reason})`);
  }

  console.log(`\nConfig: ${OUTPUT}`);
}

run();
