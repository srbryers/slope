import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reconcileModularRoadmapSources } from '../../../src/cli/commands/validate.js';

let cwd: string;
let originalCwd: string;
let logs: string[];

/** Write a single-sprint modular roadmap whose sprint 9 carries `status`. */
function writeRoadmap(status: string): string {
  const root = join(cwd, 'docs', 'roadmap');
  mkdirSync(join(root, 'phases'), { recursive: true });
  writeFileSync(join(root, 'project.yaml'), `
version: 1
name: Reconcile Roadmap
output: ../backlog/roadmap.json
sources:
  - path: phases/phase-01.yaml
    kind: phase
`);
  const phasePath = join(root, 'phases', 'phase-01.yaml');
  writeFileSync(phasePath, `version: "1"
phase:
  name: Phase 1
  status: active
  sprints: [9]
sprints:
  - id: 9
    theme: Deliberate
    par: 3
    slope: 1
    type: feature
    status: ${status}
    tickets:
      - {key: S9-1, title: T1, club: wedge, complexity: small}
`);
  return phasePath;
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'slope-validate-reconcile-'));
  originalCwd = process.cwd();
  process.chdir(cwd);
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.map(String).join(' ')));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(cwd, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('validate reconciliation status safety (GH #660)', () => {
  it('reports a status conflict and leaves a deliberate status untouched', () => {
    const phasePath = writeRoadmap('absorbed');
    const before = readFileSync(phasePath, 'utf8');

    const ok = reconcileModularRoadmapSources(cwd, [
      { sprint: 9, path: join(cwd, 'docs', 'retros', 'sprint-9.json') },
    ]);

    // A scorecard for a deliberately-dispositioned sprint is a legitimate
    // state, not a validation failure.
    expect(ok).toBe(true);
    const output = logs.join('\n');
    expect(output).toContain("status 'absorbed'");
    expect(output).toContain('slope roadmap complete --sprint=9');
    expect(output).not.toContain('reconciled: S9 -> complete');
    // Nothing written — the authored status survives.
    expect(readFileSync(phasePath, 'utf8')).toBe(before);
  });

  it('still reconciles an in-flight sprint to complete', () => {
    writeRoadmap('planned');

    const ok = reconcileModularRoadmapSources(cwd, [
      { sprint: 9, path: join(cwd, 'docs', 'retros', 'sprint-9.json') },
    ]);

    expect(ok).toBe(true);
    const output = logs.join('\n');
    expect(output).toContain('Roadmap source reconciled: S9 -> complete');
    expect(readFileSync(join(cwd, 'docs', 'roadmap', 'phases', 'phase-01.yaml'), 'utf8'))
      .toContain('status: complete');
  });
});
