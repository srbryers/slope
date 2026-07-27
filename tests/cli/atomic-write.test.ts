import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as ts from 'typescript';
import { atomicWriteFileSync, createAtomicTempPath } from '../../src/cli/atomic-write.js';

interface ChildResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-atomic-write-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function compileCliModules(moduleNames: string[]): string {
  const moduleDir = join(tmpDir, 'compiled-cli');
  const coreDir = join(tmpDir, 'core');
  mkdirSync(moduleDir, { recursive: true });
  mkdirSync(coreDir, { recursive: true });
  writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ type: 'module' }));

  for (const moduleName of moduleNames) {
    const sourcePath = join(process.cwd(), 'src', 'cli', `${moduleName}.ts`);
    const source = readFileSync(sourcePath, 'utf8');
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
      },
    });
    writeFileSync(join(moduleDir, `${moduleName}.js`), transpiled.outputText);
  }

  const stateScopeSource = readFileSync(join(process.cwd(), 'src', 'core', 'repo-state-scope.ts'), 'utf8');
  const stateScope = ts.transpileModule(stateScopeSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  writeFileSync(join(coreDir, 'repo-state-scope.js'), stateScope.outputText);

  return moduleDir;
}

function runNode(script: string): Promise<ChildResult> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

function expectChildrenSucceeded(results: ChildResult[]): void {
  const failures = results.filter(result => result.code !== 0);
  expect(failures.map(result => result.stderr).join('\n')).toBe('');
  expect(failures).toHaveLength(0);
}

describe('atomicWriteFileSync', () => {
  it('generates unique same-directory temp paths instead of a fixed .tmp path', () => {
    const filePath = join(tmpDir, '.slope', 'sprint-state.json');
    const tempPaths = new Set(Array.from({ length: 100 }, () => createAtomicTempPath(filePath)));

    expect(tempPaths.size).toBe(100);
    for (const tempPath of tempPaths) {
      expect(dirname(tempPath)).toBe(dirname(filePath));
      expect(tempPath).not.toBe(`${filePath}.tmp`);
      expect(tempPath.endsWith('.tmp')).toBe(true);
      expect(tempPath).toContain('.sprint-state.json.');
    }
  });

  it('leaves a valid target and no fixed temp file after repeated writes', () => {
    const filePath = join(tmpDir, '.slope', 'session-state.json');

    for (let i = 0; i < 10; i++) {
      atomicWriteFileSync(filePath, JSON.stringify({ value: i }) + '\n');
    }

    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({ value: 9 });
    expect(existsSync(`${filePath}.tmp`)).toBe(false);
  });
});

describe('withFileLockSync', () => {
  it('serializes concurrent read-modify-write updates across processes', async () => {
    const moduleDir = compileCliModules(['atomic-write']);
    const helperUrl = pathToFileURL(join(moduleDir, 'atomic-write.js')).href;
    const filePath = join(tmpDir, 'counter.json');
    const writers = 6;
    const iterations = 12;
    writeFileSync(filePath, JSON.stringify({ count: 0, writers: {} }) + '\n');

    const results = await Promise.all(Array.from({ length: writers }, (_, writerIndex) => {
      const writerId = `writer-${writerIndex}`;
      return runNode(`
        import { existsSync, readFileSync } from 'node:fs';
        import { atomicWriteFileSync, withFileLockSync } from ${JSON.stringify(helperUrl)};

        const filePath = ${JSON.stringify(filePath)};
        const writerId = ${JSON.stringify(writerId)};
        const iterations = ${iterations};
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

        for (let i = 0; i < iterations; i++) {
          await sleep(Math.floor(Math.random() * 4));
          withFileLockSync(filePath, () => {
            const state = existsSync(filePath)
              ? JSON.parse(readFileSync(filePath, 'utf8'))
              : { count: 0, writers: {} };
            state.count += 1;
            state.writers[writerId] = (state.writers[writerId] ?? 0) + 1;
            atomicWriteFileSync(filePath, JSON.stringify(state, null, 2) + '\\n');
          });
        }
      `);
    }));

    expectChildrenSucceeded(results);
    const state = JSON.parse(readFileSync(filePath, 'utf8'));
    expect(state.count).toBe(writers * iterations);
    for (let i = 0; i < writers; i++) {
      expect(state.writers[`writer-${i}`]).toBe(iterations);
    }
  }, 15000);

  it('keeps representative sprint and session state writes valid under concurrent processes', async () => {
    // session-scope is a dependency of sprint-state (cross-worktree reconcile).
    const moduleDir = compileCliModules(['atomic-write', 'sprint-state', 'session-state', 'session-scope']);
    const sprintUrl = pathToFileURL(join(moduleDir, 'sprint-state.js')).href;
    const sessionUrl = pathToFileURL(join(moduleDir, 'session-state.js')).href;
    const slopeDir = join(tmpDir, '.slope');
    mkdirSync(slopeDir, { recursive: true });
    writeFileSync(join(slopeDir, 'sprint-state.json'), JSON.stringify({
      sprint: 102,
      phase: 'implementing',
      gates: {
        tests: false,
        code_review: false,
        architect_review: false,
        scorecard: false,
        review_md: false,
      },
      started_at: '2026-05-21T00:00:00.000Z',
      updated_at: '2026-05-21T00:00:00.000Z',
    }, null, 2) + '\n');

    const sprintJobs = ['tests', 'code_review', 'architect_review', 'scorecard', 'review_md']
      .map(gate => {
        const options = gate === 'code_review' || gate === 'architect_review'
          ? `, { review: { provenance: 'independent_review', reviewer: '${gate}-reviewer', evidence: ['agent:${gate}'] } }`
          : '';
        return runNode(`
        import { updateGate } from ${JSON.stringify(sprintUrl)};
        await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 8)));
        updateGate(${JSON.stringify(tmpDir)}, ${JSON.stringify(gate)}, true${options});
      `);
      });

    const sessionFields = [
      ['briefing_session_id', 'session-briefing'],
      ['push_prompted_session_id', 'session-push'],
      ['claim_warned_session_id', 'session-claim'],
      ['handoff_read_session_id', 'session-handoff'],
      ['last_push_command', 'git push origin fix'],
    ] as const;
    const sessionJobs = sessionFields.map(([field, value]) => runNode(`
      import { updateSessionState } from ${JSON.stringify(sessionUrl)};
      await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 8)));
      updateSessionState(${JSON.stringify(tmpDir)}, ${JSON.stringify(field)}, ${JSON.stringify(value)});
    `));

    const results = await Promise.all([...sprintJobs, ...sessionJobs]);

    expectChildrenSucceeded(results);
    const sprintState = JSON.parse(readFileSync(join(slopeDir, 'sprint-state.json'), 'utf8'));
    expect(Object.values(sprintState.gates)).toEqual([true, true, true, true, true]);
    const sessionState = JSON.parse(readFileSync(join(slopeDir, '.session-state.json'), 'utf8'));
    for (const [field, value] of sessionFields) {
      expect(sessionState[field]).toBe(value);
    }
    expect(readdirSync(slopeDir).filter(name => name.endsWith('.tmp') || name.endsWith('.lock'))).toEqual([]);
  }, 15000);
});
