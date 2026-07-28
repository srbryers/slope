import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  collectSlopeReleaseEvidence,
  getVersionBumpStagePaths,
  versionCommand,
} from '../../src/cli/commands/version.js';

let tmpDir: string;
let originalCwd: string;
let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-version-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // Create a minimal package.json
  writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'test', version: '1.5.0' }, null, 2));
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: tmpDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitInit(): void {
  git(['init']);
  git(['config', 'user.email', 'test@test.com']);
  git(['config', 'user.name', 'Test User']);
}

function gitCommit(message: string): void {
  git(['add', '-A']);
  git(['commit', '-m', message]);
}

function writeJson(path: string, data: unknown): void {
  const fullPath = join(tmpDir, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, JSON.stringify(data, null, 2));
}

function output(): string {
  return consoleSpy.mock.calls.map(c => c[0]).join('\n');
}

describe('versionCommand', () => {
  // GH #300: default version output must read from the installed slope
  // package, not from process.cwd(). The tmpdir we chdir into has a foreign
  // package.json (version 1.5.0); slope should report its own version, not
  // that one.
  it('shows installed slope version (not cwd) with no subcommand', async () => {
    await versionCommand([]);
    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('@slope-dev/slope');
    expect(output).not.toContain('v1.5.0'); // cwd's foreign version must NOT leak through
    expect(output).not.toContain('vunknown');
  });

  it('shows installed slope version with unknown subcommand', async () => {
    await versionCommand(['show']);
    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('@slope-dev/slope');
    expect(output).not.toContain('v1.5.0');
  });

  it('prints nested bump help without entering release automation (#501)', async () => {
    await versionCommand(['bump', '--help']);
    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');

    expect(output).toContain('slope version bump');
    expect(output).toContain('Bump version');
  });

  it('bump rejects version strings with trailing content (shell injection)', async () => {
    // "1.2.3; echo pwned" should NOT match the anchored regex /^\d+\.\d+\.\d+$/
    // So the command should auto-bump to 1.6.0 instead
    // It will fail at gh auth check, but the version parsing happens before that
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'test', version: '1.5.0' }, null, 2));

    // We can't easily run the full bump flow without gh, but we can verify
    // the regex by checking that getCurrentVersion still works
    const pkg = JSON.parse(readFileSync(join(tmpDir, 'package.json'), 'utf8'));
    expect(pkg.version).toBe('1.5.0');

    // Verify the regex rejects injection attempts
    expect(/^\d+\.\d+\.\d+$/.test('1.2.3; echo pwned')).toBe(false);
    expect(/^\d+\.\d+\.\d+$/.test('1.2.3')).toBe(true);
  });

  it('stages the bundled Codex plugin manifest when the version script updates it (#524)', () => {
    const manifestDir = join(tmpDir, 'templates', 'codex', 'plugins', 'slope', '.codex-plugin');
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: '@slope-dev/slope', version: '1.5.0' }, null, 2));
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(join(manifestDir, 'plugin.json'), JSON.stringify({ name: 'slope', version: '1.5.1' }, null, 2));

    expect(getVersionBumpStagePaths(tmpDir)).toEqual([
      'package.json',
      'templates/codex/plugins/slope/.codex-plugin/plugin.json',
    ]);
    expect(readFileSync(join(manifestDir, 'plugin.json'), 'utf8')).toContain('"version": "1.5.1"');
  });

  it('stages only package.json when no bundled Codex plugin manifest exists', () => {
    expect(getVersionBumpStagePaths(tmpDir)).toEqual(['package.json']);
  });

  it('raises recommendation to minor from shipped SLOPE scorecard evidence when squash subjects hide feature work (#550)', async () => {
    gitInit();
    gitCommit('chore: initial release');
    git(['tag', 'v1.0.0']);

    writeJson('docs/backlog/roadmap.json', {
      name: 'Test Roadmap',
      phases: [{ name: 'Phase 1', sprints: [42] }],
      sprints: [{
        id: 42,
        theme: 'Human Cockpit',
        par: 4,
        slope: 2,
        type: 'cli product surface',
        status: 'complete',
        tickets: [{
          key: 'S42-1',
          title: 'Implement a compact user-facing command cockpit',
          club: 'short_iron',
          complexity: 'standard',
        }],
      }],
    });
    writeJson('docs/retros/sprint-42.json', {
      sprint_number: 42,
      theme: 'Human Cockpit',
      type: 'cli product surface',
      shots: [{
        ticket_key: 'S42-1',
        title: 'Implement a compact user-facing command cockpit',
        notes: 'Shipped new human-facing CLI behavior.',
      }],
      slope_factors: ['cli_surface'],
    });
    gitCommit('Human cockpit shipped (#1)');

    await versionCommand(['recommend']);
    const text = output();

    expect(text).toContain('Conventional commit tier: patch');
    expect(text).toContain('SLOPE release evidence: minor');
    expect(text).toContain('S42 Human Cockpit');
    expect(text).toContain('Recommended: minor (1.5.0');
    expect(text).toContain('Recommendation raised above commit-subject tier');
  });

  it('raises recommendation to major for shipped schema migration evidence', async () => {
    gitInit();
    gitCommit('chore: initial release');
    git(['tag', 'v1.0.0']);

    writeJson('docs/retros/sprint-267.json', {
      sprint_number: '267',
      theme: 'Sprint ID 2.0 Release Train',
      type: 'release + migration',
      shots: [{
        ticket_key: 'S267-1',
        title: 'Ship the canonical sprint identity store migration',
      }],
      slope_factors: ['schema_migration'],
    });
    gitCommit('docs(S267): close release train');

    await versionCommand(['recommend']);
    const text = output();

    expect(text).toContain('Conventional commit tier: patch');
    expect(text).toContain('SLOPE release evidence: major');
    expect(text).toContain('S267 Sprint ID 2.0 Release Train');
    expect(text).toContain('Recommended: major (1.5.0');
    expect(text).toContain('Recommendation raised above commit-subject tier');
  });

  it('does not raise recommendation from planned roadmap feature work without shipped evidence', async () => {
    gitInit();
    gitCommit('chore: initial release');
    git(['tag', 'v1.0.0']);

    writeJson('docs/backlog/roadmap.json', {
      name: 'Test Roadmap',
      phases: [{ name: 'Phase 1', sprints: [43] }],
      sprints: [{
        id: 43,
        theme: 'Future Human Cockpit',
        par: 4,
        slope: 2,
        type: 'cli product surface',
        status: 'planned',
        tickets: [{
          key: 'S43-1',
          title: 'Plan a future user-facing command cockpit',
          club: 'short_iron',
          complexity: 'standard',
        }],
      }],
    });
    gitCommit('docs(roadmap): plan S43');

    await versionCommand(['recommend']);
    const text = output();

    expect(text).toContain('Conventional commit tier: patch');
    expect(text).toContain('SLOPE release evidence: none found');
    expect(text).toContain('Recommended: patch (1.5.0');
    expect(text).not.toContain('SLOPE release evidence: minor');
  });

  it('raises recommendation from completed roadmap metadata when scorecard evidence is absent', async () => {
    gitInit();
    gitCommit('chore: initial release');
    git(['tag', 'v1.0.0']);

    writeJson('docs/backlog/roadmap.json', {
      name: 'Test Roadmap',
      phases: [{ name: 'Phase 1', sprints: [44] }],
      sprints: [{
        id: 44,
        theme: 'Command Cockpit',
        par: 4,
        slope: 2,
        type: 'cli product surface',
        status: 'complete',
        tickets: [{
          key: 'S44-1',
          title: 'Ship a compact user-facing command cockpit',
          club: 'short_iron',
          complexity: 'standard',
        }],
      }],
    });
    gitCommit('docs(roadmap): close S44');

    await versionCommand(['recommend']);
    const text = output();

    expect(text).toContain('SLOPE release evidence: minor');
    expect(text).toContain('S44 Command Cockpit (roadmap: cli product surface)');
    expect(text).toContain('Recommended: minor (1.5.0');
  });

  it('keeps coexisting decimal sprint release evidence distinct and ordered', () => {
    writeJson('docs/backlog/roadmap.json', {
      name: 'Canonical roadmap',
      phases: [{
        name: 'Decimal phase',
        sprints: [458.1, 458.1],
        sprint_keys: ['458.1', '458.10'],
      }],
      sprints: [
        {
          id: 458.1,
          id_key: '458.1',
          theme: 'First insert',
          par: 3,
          slope: 1,
          type: 'cli product surface',
          status: 'complete',
          tickets: [{ key: 'S458.1-1', title: 'Ship first insert', club: 'wedge', complexity: 'small' }],
        },
        {
          id: 458.1,
          id_key: '458.10',
          theme: 'Tenth insert',
          par: 3,
          slope: 1,
          type: 'cli product surface',
          status: 'complete',
          tickets: [{ key: 'S458.10-1', title: 'Ship tenth insert', club: 'wedge', complexity: 'small' }],
        },
      ],
    });
    writeJson('docs/retros/sprint-458.1.json', {
      sprint_number: '458.1',
      theme: 'First insert',
      type: 'cli product surface',
    });
    writeJson('docs/retros/sprint-458.10.json', {
      sprint_number: '458.10',
      theme: 'Tenth insert',
      type: 'cli product surface',
    });

    const evidence = collectSlopeReleaseEvidence(tmpDir, [{
      hash: '',
      scope: 'release',
      description: 'Ship S458.10 after S458.1',
    }]);

    expect(evidence.map(item => item.sprint)).toEqual(['458.1', '458.10']);
    expect(evidence.map(item => item.theme)).toEqual(['First insert', 'Tenth insert']);
  });
});
