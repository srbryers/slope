import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { loadConfig } from '../config.js';
import {
  loadScorecards,
  buildReportData,
  generateDashboardHtml,
  renderSprintDetail,
  getMetaphor,
  DEFAULT_DASHBOARD_CONFIG,
  buildLeaderboard,
  filterScorecardsByPlayer,
} from '../../core/index.js';
import type { SlopeConfig, DashboardConfig } from '../../core/index.js';

export function resolveDashboardConfig(args: string[], config: SlopeConfig): DashboardConfig {
  const defaults = { ...DEFAULT_DASHBOARD_CONFIG };

  // Config file layer
  const fileConfig = (config as SlopeConfig & { dashboard?: Partial<DashboardConfig> }).dashboard;
  if (fileConfig) {
    if (fileConfig.port !== undefined) defaults.port = fileConfig.port;
    if (fileConfig.autoOpen !== undefined) defaults.autoOpen = fileConfig.autoOpen;
    if (fileConfig.refreshInterval !== undefined) defaults.refreshInterval = fileConfig.refreshInterval;
  }

  // CLI flag layer (highest priority)
  const portArg = args.find(a => a.startsWith('--port='));
  if (portArg) defaults.port = parseInt(portArg.slice('--port='.length), 10);

  if (args.includes('--no-open')) defaults.autoOpen = false;

  const refreshArg = args.find(a => a.startsWith('--refresh='));
  if (refreshArg) defaults.refreshInterval = parseInt(refreshArg.slice('--refresh='.length), 10);

  return defaults;
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} ${url}`, () => {/* fire-and-forget */});
}

export async function dashboardCommand(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  const config = loadConfig();
  const cwd = process.cwd();
  const dashConfig = resolveDashboardConfig(args, config);

  // Resolve metaphor
  const metaphorArg = args.find(a => a.startsWith('--metaphor='));
  const metaphorId = metaphorArg?.slice('--metaphor='.length) ?? config.metaphor ?? 'golf';
  let metaphor;
  try {
    metaphor = getMetaphor(metaphorId);
  } catch {
    console.error(`Unknown metaphor: "${metaphorId}". Using golf.`);
    metaphor = getMetaphor('golf');
  }

  // Parse --player flag
  const playerArg = args.find(a => a.startsWith('--player='));
  const playerFilter = playerArg?.slice('--player='.length);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${dashConfig.port}`);
    const pathname = url.pathname;

    try {
      if (pathname === '/' && req.method === 'GET') {
        const allScorecards = loadScorecards(config, cwd);
        const scorecards = playerFilter ? filterScorecardsByPlayer(allScorecards, playerFilter) : allScorecards;
        const data = buildReportData(scorecards);
        const html = generateDashboardHtml(data, metaphor, dashConfig);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } else if (pathname === '/api/data' && req.method === 'GET') {
        const allScorecards = loadScorecards(config, cwd);
        const scorecards = playerFilter ? filterScorecardsByPlayer(allScorecards, playerFilter) : allScorecards;
        const data = buildReportData(scorecards);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } else if (pathname === '/api/leaderboard' && req.method === 'GET') {
        const scorecards = loadScorecards(config, cwd);
        const leaderboard = buildLeaderboard(scorecards);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(leaderboard));
      } else if (pathname.startsWith('/api/sprint/') && req.method === 'GET') {
        const sprintStr = pathname.slice('/api/sprint/'.length);
        const sprintNum = parseInt(sprintStr, 10);
        if (isNaN(sprintNum)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid sprint number' }));
          return;
        }

        const scorecards = loadScorecards(config, cwd);
        const card = scorecards.find(s => s.sprint_number === sprintNum);
        if (!card) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Sprint not found' }));
          return;
        }

        if (url.searchParams.get('html') === '1') {
          const html = renderSprintDetail(card, metaphor);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(card));
        }
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  });

  server.listen(dashConfig.port, () => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : dashConfig.port;
    const url = `http://localhost:${port}`;
    console.log(`\nSLOPE Dashboard running at ${url}`);
    console.log(`  Metaphor: ${metaphorId}`);
    console.log(`  Auto-refresh: ${dashConfig.refreshInterval > 0 ? `${dashConfig.refreshInterval}s` : 'disabled'}`);
    console.log(`  Press Ctrl+C to stop\n`);

    if (dashConfig.autoOpen) {
      openBrowser(url);
    }
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down dashboard...');
    server.close(() => process.exit(0));
  });
}

function printUsage(): void {
  console.log(`
slope dashboard — Live local SLOPE performance dashboard

Usage:
  slope dashboard                    Start dashboard on port 3000
  slope dashboard --port=8080        Use custom port
  slope dashboard --no-open          Don't auto-open browser
  slope dashboard --refresh=60       Set auto-refresh interval (seconds, 0=disable)
  slope dashboard --metaphor=gaming  Use specific metaphor for labels
  slope dashboard --player=alice     Filter dashboard to a single player

Routes:
  /                  Dashboard HTML page
  /api/data          Report data as JSON
  /api/sprint/:n     Single sprint scorecard (JSON or ?html=1)
  /api/leaderboard   Team leaderboard (JSON)

Examples:
  slope dashboard
  slope dashboard --port=8080 --no-open --metaphor=gaming
  slope dashboard --refresh=0
`);
}
