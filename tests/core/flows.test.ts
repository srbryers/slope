import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import {
  parseFlows,
  validateFlows,
  checkFlowStaleness,
  loadFlows,
} from '../../src/core/flows.js';
import type { FlowsFile, FlowDefinition } from '../../src/core/flows.js';

// --- Helpers ---

function makeFlowsFile(overrides: Partial<FlowsFile> = {}): FlowsFile {
  return {
    version: '1',
    last_generated: '2026-02-23T00:00:00Z',
    flows: [],
    ...overrides,
  };
}

function makeFlow(overrides: Partial<FlowDefinition> = {}): FlowDefinition {
  return {
    id: 'test-flow',
    title: 'Test Flow',
    description: 'A test flow',
    entry_point: 'src/index.ts',
    steps: [
      {
        name: 'Step 1',
        description: 'First step',
        file_paths: ['src/a.ts'],
      },
    ],
    files: ['src/a.ts'],
    tags: ['test'],
    last_verified_sha: 'abc123',
    last_verified_at: '2026-02-23T00:00:00Z',
    ...overrides,
  };
}

// --- parseFlows ---

describe('parseFlows', () => {
  it('parses valid flows JSON', () => {
    const input = makeFlowsFile({ flows: [makeFlow()] });
    const result = parseFlows(JSON.stringify(input));
    expect(result.version).toBe('1');
    expect(result.flows).toHaveLength(1);
    expect(result.flows[0].id).toBe('test-flow');
  });

  it('rejects non-object input', () => {
    expect(() => parseFlows('"hello"')).toThrow('must be an object');
  });

  it('rejects unsupported version', () => {
    expect(() => parseFlows(JSON.stringify({ version: '2', flows: [] }))).toThrow('Unsupported flows version');
  });

  it('rejects missing flows array', () => {
    expect(() => parseFlows(JSON.stringify({ version: '1' }))).toThrow('must have a "flows" array');
  });

  it('rejects flow without id', () => {
    const input = { version: '1', flows: [{ title: 'x', steps: [], files: [], tags: [] }] };
    expect(() => parseFlows(JSON.stringify(input))).toThrow('must have a string "id"');
  });

  it('rejects flow without title', () => {
    const input = { version: '1', flows: [{ id: 'x', steps: [], files: [], tags: [] }] };
    expect(() => parseFlows(JSON.stringify(input))).toThrow('must have a string "title"');
  });

  it('rejects flow without steps array', () => {
    const input = { version: '1', flows: [{ id: 'x', title: 'X', files: [], tags: [] }] };
    expect(() => parseFlows(JSON.stringify(input))).toThrow('must have a "steps" array');
  });

  it('rejects flow without files array', () => {
    const input = { version: '1', flows: [{ id: 'x', title: 'X', steps: [], tags: [] }] };
    expect(() => parseFlows(JSON.stringify(input))).toThrow('must have a "files" array');
  });

  it('rejects flow without tags array', () => {
    const input = { version: '1', flows: [{ id: 'x', title: 'X', steps: [], files: [] }] };
    expect(() => parseFlows(JSON.stringify(input))).toThrow('must have a "tags" array');
  });

  it('parses multiple flows', () => {
    const input = makeFlowsFile({
      flows: [
        makeFlow({ id: 'flow-a', title: 'Flow A' }),
        makeFlow({ id: 'flow-b', title: 'Flow B' }),
      ],
    });
    const result = parseFlows(JSON.stringify(input));
    expect(result.flows).toHaveLength(2);
  });
});

// --- validateFlows ---

describe('validateFlows', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-flows-'));
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src', 'a.ts'), '// a');
    writeFileSync(join(tmpDir, 'src', 'b.ts'), '// b');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('validates clean flows', () => {
    const flows = makeFlowsFile({
      flows: [makeFlow({ files: ['src/a.ts'], steps: [{ name: 'S1', description: 'step', file_paths: ['src/a.ts'] }] })],
    });
    const result = validateFlows(flows, tmpDir);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('errors on missing files', () => {
    const flows = makeFlowsFile({
      flows: [makeFlow({ files: ['src/missing.ts'] })],
    });
    const result = validateFlows(flows, tmpDir);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('not found');
  });

  it('warns on missing step file_paths', () => {
    const flows = makeFlowsFile({
      flows: [makeFlow({
        files: ['src/a.ts'],
        steps: [{ name: 'S1', description: 'step', file_paths: ['src/missing.ts'] }],
      })],
    });
    const result = validateFlows(flows, tmpDir);
    expect(result.warnings.some(w => w.includes('not found'))).toBe(true);
  });

  it('warns on orphaned step paths not in files list', () => {
    const flows = makeFlowsFile({
      flows: [makeFlow({
        files: ['src/a.ts'],
        steps: [{ name: 'S1', description: 'step', file_paths: ['src/b.ts'] }],
      })],
    });
    const result = validateFlows(flows, tmpDir);
    expect(result.warnings.some(w => w.includes('not in top-level files list'))).toBe(true);
  });

  it('errors on duplicate flow IDs', () => {
    const flows = makeFlowsFile({
      flows: [
        makeFlow({ id: 'dup' }),
        makeFlow({ id: 'dup' }),
      ],
    });
    const result = validateFlows(flows, tmpDir);
    expect(result.errors.some(e => e.includes('Duplicate flow ID'))).toBe(true);
  });

  it('warns on empty steps', () => {
    const flows = makeFlowsFile({
      flows: [makeFlow({ steps: [], files: ['src/a.ts'] })],
    });
    const result = validateFlows(flows, tmpDir);
    expect(result.warnings.some(w => w.includes('no steps'))).toBe(true);
  });

  it('warns on empty files', () => {
    const flows = makeFlowsFile({
      flows: [makeFlow({ files: [], steps: [] })],
    });
    const result = validateFlows(flows, tmpDir);
    expect(result.warnings.some(w => w.includes('no files'))).toBe(true);
  });
});

// --- checkFlowStaleness ---

describe('checkFlowStaleness', () => {
  let tmpDir: string;
  let initialSha: string;
  let laterSha: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-flows-git-'));
    execSync('git init', { cwd: tmpDir });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir });
    execSync('git config user.name "Test"', { cwd: tmpDir });

    // Create initial commit with tracked files
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src', 'a.ts'), '// a');
    writeFileSync(join(tmpDir, 'src', 'b.ts'), '// b');
    execSync('git add -A && git commit -m "init"', { cwd: tmpDir });
    initialSha = execSync('git rev-parse HEAD', { cwd: tmpDir, encoding: 'utf8' }).trim();

    // Modify one file and commit
    writeFileSync(join(tmpDir, 'src', 'a.ts'), '// modified a');
    execSync('git add -A && git commit -m "modify a"', { cwd: tmpDir });
    laterSha = execSync('git rev-parse HEAD', { cwd: tmpDir, encoding: 'utf8' }).trim();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns not stale when SHAs match', () => {
    const flow = makeFlow({ last_verified_sha: laterSha, files: ['src/a.ts'] });
    const result = checkFlowStaleness(flow, laterSha, tmpDir);
    expect(result.stale).toBe(false);
    expect(result.changedFiles).toHaveLength(0);
  });

  it('returns stale when tracked file changed', () => {
    const flow = makeFlow({ last_verified_sha: initialSha, files: ['src/a.ts'] });
    const result = checkFlowStaleness(flow, laterSha, tmpDir);
    expect(result.stale).toBe(true);
    expect(result.changedFiles).toContain('src/a.ts');
  });

  it('returns not stale when unrelated files changed', () => {
    const flow = makeFlow({ last_verified_sha: initialSha, files: ['src/b.ts'] });
    const result = checkFlowStaleness(flow, laterSha, tmpDir);
    expect(result.stale).toBe(false);
    expect(result.changedFiles).toHaveLength(0);
  });

  it('returns not stale when no last_verified_sha', () => {
    const flow = makeFlow({ last_verified_sha: '', files: ['src/a.ts'] });
    const result = checkFlowStaleness(flow, laterSha, tmpDir);
    expect(result.stale).toBe(false);
  });
});

// --- loadFlows ---

describe('loadFlows', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-flows-load-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null for missing file', () => {
    const result = loadFlows(join(tmpDir, 'nonexistent.json'));
    expect(result).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    const fp = join(tmpDir, 'bad.json');
    writeFileSync(fp, 'not json');
    const result = loadFlows(fp);
    expect(result).toBeNull();
  });

  it('loads valid flows file', () => {
    const fp = join(tmpDir, 'flows.json');
    const data = makeFlowsFile({ flows: [makeFlow()] });
    writeFileSync(fp, JSON.stringify(data));
    const result = loadFlows(fp);
    expect(result).not.toBeNull();
    expect(result!.flows).toHaveLength(1);
    expect(result!.flows[0].id).toBe('test-flow');
  });
});
