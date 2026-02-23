import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { GolfScorecard, SlopeConfig, DashboardConfig } from '@srbryers/core';
import {
  loadScorecards,
  buildReportData,
  generateDashboardHtml,
  renderSprintDetail,
  getMetaphor,
  DEFAULT_DASHBOARD_CONFIG,
} from '@srbryers/core';
import { resolveDashboardConfig } from '../src/commands/dashboard.js';

let tmpDir: string;

function writeScorecard(dir: string, num: number, overrides: Partial<GolfScorecard> = {}): void {
  const card: GolfScorecard = {
    sprint_number: num,
    theme: `Sprint ${num}`,
    par: 4,
    slope: 2,
    score: 4,
    score_label: 'par',
    date: `2026-01-${String(num).padStart(2, '0')}`,
    type: 'feature',
    shots: [
      { ticket_key: `S${num}-1`, title: 'Task', club: 'short_iron', result: 'in_the_hole', hazards: [] },
      { ticket_key: `S${num}-2`, title: 'Task', club: 'wedge', result: 'green', hazards: [] },
    ],
    stats: {
      fairways_hit: 2, fairways_total: 2,
      greens_in_regulation: 2, greens_total: 2,
      putts: 0, penalties: 0, hazards_hit: 0, hazard_penalties: 0,
      miss_directions: { long: 0, short: 0, left: 0, right: 0 },
    },
    conditions: [],
    special_plays: [],
    nutrition: [{ category: 'hydration', description: 'Test', status: 'healthy' }],
    yardage_book_updates: [],
    bunker_locations: [],
    course_management_notes: [],
    ...overrides,
  };
  const retrosDir = join(dir, 'docs', 'retros');
  mkdirSync(retrosDir, { recursive: true });
  writeFileSync(join(retrosDir, `sprint-${num}.json`), JSON.stringify(card));
}

const mockConfig: SlopeConfig = {
  scorecardDir: 'docs/retros',
  scorecardPattern: 'sprint-*.json',
  minSprint: 1,
  commonIssuesPath: '.slope/common-issues.json',
  sessionsPath: '.slope/sessions.json',
  registry: 'file',
  claimsPath: '.slope/claims.json',
  roadmapPath: 'docs/backlog/roadmap.json',
  metaphor: 'golf',
};

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-dashboard-'));
});

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
});

// --- HTTP Server Integration ---

describe('dashboard server integration', () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;

  beforeEach(async () => {
    writeScorecard(tmpDir, 1);
    writeScorecard(tmpDir, 2);

    const scorecards = loadScorecards(mockConfig, tmpDir);

    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost`);
      const pathname = url.pathname;

      if (pathname === '/' && req.method === 'GET') {
        const data = buildReportData(scorecards);
        const html = generateDashboardHtml(data, undefined, { refreshInterval: 30 });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } else if (pathname === '/api/data' && req.method === 'GET') {
        const data = buildReportData(scorecards);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } else if (pathname.startsWith('/api/sprint/') && req.method === 'GET') {
        const sprintStr = pathname.slice('/api/sprint/'.length);
        const sprintNum = parseInt(sprintStr, 10);
        const card = scorecards.find(s => s.sprint_number === sprintNum);
        if (!card) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Sprint not found' }));
          return;
        }
        if (url.searchParams.get('html') === '1') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderSprintDetail(card));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(card));
        }
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('GET / returns HTML with DOCTYPE', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('<!DOCTYPE html>');
  });

  it('GET /api/data returns valid JSON with ReportData fields', async () => {
    const res = await fetch(`${baseUrl}/api/data`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const data = await res.json();
    expect(data.sprintCount).toBe(2);
    expect(data.scorecards).toHaveLength(2);
    expect(data.handicapCard).toBeDefined();
    expect(data.sprintTrend).toHaveLength(2);
  });

  it('GET /api/sprint/1 returns scorecard JSON', async () => {
    const res = await fetch(`${baseUrl}/api/sprint/1`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sprint_number).toBe(1);
    expect(data.theme).toBe('Sprint 1');
  });

  it('GET /api/sprint/1?html=1 returns HTML with shot records', async () => {
    const res = await fetch(`${baseUrl}/api/sprint/1?html=1`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('S1-1');
    expect(body).toContain('Sprint 1');
  });

  it('returns 404 for non-existent sprint', async () => {
    const res = await fetch(`${baseUrl}/api/sprint/99`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown routes', async () => {
    const res = await fetch(`${baseUrl}/unknown`);
    expect(res.status).toBe(404);
  });
});

// --- resolveDashboardConfig ---

describe('resolveDashboardConfig', () => {
  it('returns defaults when no args or config', () => {
    const result = resolveDashboardConfig([], mockConfig);
    expect(result).toEqual(DEFAULT_DASHBOARD_CONFIG);
  });

  it('--port=8080 overrides default', () => {
    const result = resolveDashboardConfig(['--port=8080'], mockConfig);
    expect(result.port).toBe(8080);
  });

  it('--no-open overrides autoOpen', () => {
    const result = resolveDashboardConfig(['--no-open'], mockConfig);
    expect(result.autoOpen).toBe(false);
  });

  it('--refresh=0 disables auto-refresh', () => {
    const result = resolveDashboardConfig(['--refresh=0'], mockConfig);
    expect(result.refreshInterval).toBe(0);
  });

  it('config file values used when no CLI flags', () => {
    const configWithDashboard = {
      ...mockConfig,
      dashboard: { port: 9090, autoOpen: false, refreshInterval: 15 },
    };
    const result = resolveDashboardConfig([], configWithDashboard);
    expect(result.port).toBe(9090);
    expect(result.autoOpen).toBe(false);
    expect(result.refreshInterval).toBe(15);
  });

  it('CLI flags override config file values', () => {
    const configWithDashboard = {
      ...mockConfig,
      dashboard: { port: 9090, autoOpen: false, refreshInterval: 15 },
    };
    const result = resolveDashboardConfig(['--port=7070', '--refresh=45'], configWithDashboard);
    expect(result.port).toBe(7070);
    expect(result.autoOpen).toBe(false); // from config
    expect(result.refreshInterval).toBe(45); // from CLI
  });
});
