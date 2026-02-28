#!/usr/bin/env npx tsx
/**
 * dashboard.ts — Generate a static HTML dashboard showing:
 *   - Handicap trend over time
 *   - Model tier success rates
 *   - API cost tracking
 *   - Escalation stats
 *   - Sprint velocity and convergence indicators
 *
 * Run: npx tsx slope-loop/dashboard.ts
 * Open: slope-loop/dashboard.html
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, 'logs');
const RESULTS_DIR = join(__dirname, 'results');
const ANALYSIS_FILE = join(__dirname, 'analysis.json');

interface ModelResult {
  ticket: string;
  club: string;
  primary_model: string;
  final_model: string;
  escalated: boolean;
  tests_passing: boolean;
}

interface SprintResult {
  sprint_id: string;
  strategy: string;
  completed_at?: string;
  tickets_total?: number;
  tickets_passing?: number;
}

function run(): void {
  // Gather model results from all sprints
  const modelResults: ModelResult[] = [];
  if (existsSync(LOG_DIR)) {
    for (const file of readdirSync(LOG_DIR).filter(f => f.endsWith('-models.jsonl'))) {
      const content = readFileSync(join(LOG_DIR, file), 'utf-8').trim();
      if (!content) continue;
      for (const line of content.split('\n')) {
        try { modelResults.push(JSON.parse(line)); } catch { /* skip */ }
      }
    }
  }

  // Sprint results
  const sprintResults: SprintResult[] = [];
  if (existsSync(RESULTS_DIR)) {
    for (const file of readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json'))) {
      try { sprintResults.push(JSON.parse(readFileSync(join(RESULTS_DIR, file), 'utf-8'))); } catch { /* skip */ }
    }
  }

  // Analysis data
  let analysis: Record<string, unknown> | null = null;
  if (existsSync(ANALYSIS_FILE)) {
    try { analysis = JSON.parse(readFileSync(ANALYSIS_FILE, 'utf-8')); } catch { /* skip */ }
  }

  // Compute stats
  const totalTickets = modelResults.length;
  const passing = modelResults.filter(r => r.tests_passing).length;
  const escalated = modelResults.filter(r => r.escalated).length;
  const escalatedSaved = modelResults.filter(r => r.escalated && r.tests_passing).length;

  const localTickets = modelResults.filter(r => r.primary_model?.includes('ollama'));
  const apiTickets = modelResults.filter(r => r.final_model?.includes('minimax'));
  const localPassRate = localTickets.length > 0
    ? Math.round(localTickets.filter(r => r.tests_passing && !r.escalated).length / localTickets.length * 100) : 0;
  const apiPassRate = apiTickets.length > 0
    ? Math.round(apiTickets.filter(r => r.tests_passing).length / apiTickets.length * 100) : 0;

  // Rough cost estimate: ~$3 per API ticket
  const estimatedAPICost = apiTickets.length * 3;

  const overallPassRate = totalTickets > 0 ? Math.round(passing / totalTickets * 100) : 0;
  const escSaveRate = escalated > 0 ? Math.round(escalatedSaved / escalated * 100) : 0;

  const handicapData = analysis?.handicap as Record<string, unknown> | undefined;
  const currentHandicap = handicapData?.current ?? '—';
  const trend = handicapData?.trend ?? '—';
  const trendClass = trend === 'improving' ? 'green' : 'yellow';
  const passClass = overallPassRate > 70 ? 'green' : 'yellow';

  // Sprint rows
  const sprintRows = sprintResults.map(s =>
    `<tr><td>${s.sprint_id}</td><td>${s.strategy}</td><td>${s.tickets_total ?? '—'}</td><td>${s.tickets_passing ?? '—'}</td><td>${s.completed_at?.split('T')[0] ?? '—'}</td></tr>`,
  ).join('\n      ');

  // Convergence: are pass rates improving over time?
  let convergenceNote = 'Insufficient data';
  if (sprintResults.length >= 3) {
    const recent = sprintResults.slice(-3);
    const recentPassRates = recent
      .filter(s => s.tickets_total && s.tickets_total > 0)
      .map(s => (s.tickets_passing ?? 0) / (s.tickets_total ?? 1));
    if (recentPassRates.length >= 2 && recentPassRates[recentPassRates.length - 1] >= recentPassRates[0]) {
      convergenceNote = 'Trending up';
    } else if (recentPassRates.length >= 2) {
      convergenceNote = 'Trending down';
    }
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Slope Loop Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 2rem; }
    h1 { color: #4ade80; margin-bottom: 0.5rem; }
    .subtitle { color: #888; margin-bottom: 2rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .card { background: #1a1a1a; border: 1px solid #333; border-radius: 12px; padding: 1.5rem; }
    .card .label { color: #888; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .card .value { font-size: 2rem; font-weight: 700; margin-top: 0.25rem; }
    .card .value.green { color: #4ade80; }
    .card .value.yellow { color: #facc15; }
    .card .value.red { color: #f87171; }
    .card .value.blue { color: #60a5fa; }
    .section { margin-bottom: 2rem; }
    .section h2 { color: #ccc; margin-bottom: 1rem; border-bottom: 1px solid #333; padding-bottom: 0.5rem; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #222; }
    th { color: #888; font-weight: 500; }
    .bar { height: 8px; border-radius: 4px; background: #333; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 4px; }
    .bar-fill.green { background: #4ade80; }
    .bar-fill.yellow { background: #facc15; }
    .bar-fill.red { background: #f87171; }
    .timestamp { color: #555; font-size: 0.8rem; margin-top: 2rem; }
  </style>
</head>
<body>
  <h1>Slope Loop Dashboard</h1>
  <p class="subtitle">Self-development loop performance &middot; ${sprintResults.length} sprints &middot; ${totalTickets} tickets</p>

  <div class="grid">
    <div class="card">
      <div class="label">Current Handicap</div>
      <div class="value green">${currentHandicap}</div>
    </div>
    <div class="card">
      <div class="label">Trend</div>
      <div class="value ${trendClass}">${trend}</div>
    </div>
    <div class="card">
      <div class="label">Overall Pass Rate</div>
      <div class="value ${passClass}">${overallPassRate}%</div>
    </div>
    <div class="card">
      <div class="label">API Cost (est.)</div>
      <div class="value blue">$${estimatedAPICost.toFixed(2)}</div>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <div class="label">Local (Qwen) Pass Rate</div>
      <div class="value">${localPassRate}%</div>
      <div class="bar" style="margin-top:0.5rem"><div class="bar-fill ${localPassRate > 70 ? 'green' : localPassRate > 50 ? 'yellow' : 'red'}" style="width:${localPassRate}%"></div></div>
    </div>
    <div class="card">
      <div class="label">API (M2.5) Pass Rate</div>
      <div class="value">${apiPassRate}%</div>
      <div class="bar" style="margin-top:0.5rem"><div class="bar-fill ${apiPassRate > 70 ? 'green' : apiPassRate > 50 ? 'yellow' : 'red'}" style="width:${apiPassRate}%"></div></div>
    </div>
    <div class="card">
      <div class="label">Escalations</div>
      <div class="value yellow">${escalated}</div>
    </div>
    <div class="card">
      <div class="label">Escalation Save Rate</div>
      <div class="value">${escSaveRate}%</div>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <div class="label">Convergence</div>
      <div class="value ${convergenceNote === 'Trending up' ? 'green' : convergenceNote === 'Trending down' ? 'red' : 'yellow'}">${convergenceNote}</div>
    </div>
  </div>

  <div class="section">
    <h2>Sprints Completed</h2>
    <table>
      <tr><th>Sprint</th><th>Strategy</th><th>Tickets</th><th>Passing</th><th>Date</th></tr>
      ${sprintRows || '<tr><td colspan="5">No sprints completed yet</td></tr>'}
    </table>
  </div>

  <p class="timestamp">Generated: ${new Date().toISOString()}</p>
</body>
</html>`;

  writeFileSync(join(__dirname, 'dashboard.html'), html);
  console.log('Dashboard generated: slope-loop/dashboard.html');
  console.log(`  Sprints: ${sprintResults.length}`);
  console.log(`  Tickets: ${totalTickets}`);
  console.log(`  Convergence: ${convergenceNote}`);
}

run();
