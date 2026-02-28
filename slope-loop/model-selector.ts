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

interface TicketResult {
  ticket: string;
  club: string;
  primary_model: string;
  final_model: string;
  escalated: boolean;
  tests_passing: boolean;
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

  // Analyze success rates by club x model
  const stats: Record<string, { total: number; passing: number }> = {};

  for (const r of results) {
    const key = `${r.club}:${r.final_model}`;
    if (!stats[key]) stats[key] = { total: 0, passing: 0 };
    stats[key].total++;
    if (r.tests_passing) stats[key].passing++;
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

  // Generate recommendations
  const recommendations: Record<string, { model: string; reason: string }> = {};
  const clubs = [...new Set(results.map(r => r.club))];

  for (const club of clubs) {
    const localKey = `${club}:ollama/qwen2.5-coder:32b`;
    const apiKey = `${club}:openrouter/minimax/minimax-m2.5`;

    const localStats = stats[localKey] ?? { total: 0, passing: 0 };
    const apiStats = stats[apiKey] ?? { total: 0, passing: 0 };

    const localRate = localStats.total > 0 ? localStats.passing / localStats.total : 0;
    const apiRate = apiStats.total > 0 ? apiStats.passing / apiStats.total : 0;

    // If local success rate < 60% and API is significantly better, recommend API
    if (localStats.total >= 3 && localRate < 0.6 && (apiRate > localRate + 0.2 || apiStats.total === 0)) {
      recommendations[club] = { model: 'api', reason: `local rate ${Math.round(localRate * 100)}% < 60%` };
    } else if (localStats.total >= 3 && localRate >= 0.6) {
      recommendations[club] = { model: 'local', reason: `local rate ${Math.round(localRate * 100)}% >= 60%` };
    } else {
      recommendations[club] = { model: 'local', reason: 'insufficient data, defaulting to local' };
    }
  }

  const config = {
    generated_at: new Date().toISOString(),
    ticket_count: results.length,
    escalation_save_rate: Math.round(escalationSaveRate * 100),
    success_rates: Object.fromEntries(
      Object.entries(stats).map(([k, v]) => [k, {
        ...v,
        rate: Math.round((v.passing / v.total) * 100),
      }]),
    ),
    cost_per_success: costPerSuccess,
    recommendations,
    notes: [
      'Recommendations based on observed success rates per club x model combination',
      `Escalation save rate: ${Math.round(escalationSaveRate * 100)}% (${escalations.filter(r => r.tests_passing).length}/${escalations.length})`,
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

  console.log('\nRecommendations:');
  for (const [club, rec] of Object.entries(recommendations)) {
    console.log(`  ${club} -> ${rec.model} (${rec.reason})`);
  }

  console.log(`\nConfig: ${OUTPUT}`);
}

run();
