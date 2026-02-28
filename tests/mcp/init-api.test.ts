import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInSandbox } from '../../src/mcp/sandbox.js';
import { SLOPE_REGISTRY } from '../../src/mcp/registry.js';

// Register built-in metaphors
import '../../src/core/metaphors/index.js';

import {
  buildInterviewContext,
  generateInterviewSteps,
} from '../../src/core/index.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-mcp-init-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('getInitQuestions (via sandbox)', () => {
  it('returns steps with expected IDs', async () => {
    const { result } = await runInSandbox('return getInitQuestions();', tmpDir);
    const data = result as { steps: Array<{ id: string }>; context: unknown };
    const ids = data.steps.map((s) => s.id);
    expect(ids).toContain('project-name');
    expect(ids).toContain('metaphor');
    expect(ids).toContain('platforms');
    expect(ids).toContain('sprint-number');
  });

  it('includes detected context', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'sandbox-test' }));
    const { result } = await runInSandbox('return getInitQuestions();', tmpDir);
    const data = result as { steps: unknown[]; context: { detected: { projectName?: string } } };
    expect(data.context.detected.projectName).toBe('sandbox-test');
  });

  it('is idempotent (call twice, same result)', async () => {
    const { result: r1 } = await runInSandbox('return getInitQuestions();', tmpDir);
    const { result: r2 } = await runInSandbox('return getInitQuestions();', tmpDir);
    const ids1 = (r1 as { steps: Array<{ id: string }> }).steps.map((s) => s.id);
    const ids2 = (r2 as { steps: Array<{ id: string }> }).steps.map((s) => s.id);
    expect(ids1).toEqual(ids2);
  });
});

describe('submitInitAnswers (via sandbox)', () => {
  it('creates config and files', async () => {
    const code = `return await submitInitAnswers({
      "project-name": "Sandbox App",
      "metaphor": "golf"
    });`;
    const { result } = await runInSandbox(code, tmpDir);
    const data = result as { success: boolean; configPath: string; filesCreated: string[] };
    expect(data.success).toBe(true);
    expect(data.configPath).toContain('.slope');
    expect(existsSync(join(tmpDir, '.slope', 'config.json'))).toBe(true);
  });

  it('returns structured errors on invalid answers', async () => {
    const code = `return await submitInitAnswers({});`;
    const { result } = await runInSandbox(code, tmpDir);
    const data = result as { success: boolean; errors: Array<{ field: string; message: string }> };
    expect(data.success).toBe(false);
    expect(data.errors.some((e) => e.field === 'project-name')).toBe(true);
  });

  it('providers param overrides answers.platforms', async () => {
    const code = `return await submitInitAnswers({
      "project-name": "Provider Test",
      "platforms": ["cursor"]
    }, ["claude-code"]);`;
    const { result } = await runInSandbox(code, tmpDir);
    const data = result as { success: boolean; providers: string[] };
    expect(data.success).toBe(true);
    // providers param should take precedence
    expect(data.providers).toEqual(['claude-code']);
  });
});

describe('search({ module: "init" })', () => {
  it('is handled as a valid module (integration check via core functions)', () => {
    // Verify the init module produces steps and context (same as handleInitQuery would)
    const ctx = buildInterviewContext(tmpDir);
    const steps = generateInterviewSteps(ctx);
    expect(steps.length).toBeGreaterThan(0);
    expect(ctx.detected).toBeDefined();
  });
});

describe('registry entries', () => {
  it('includes both new function entries', () => {
    const names = SLOPE_REGISTRY.map((e) => e.name);
    expect(names).toContain('getInitQuestions');
    expect(names).toContain('submitInitAnswers');
  });

  it('getInitQuestions entry has correct module and signature', () => {
    const entry = SLOPE_REGISTRY.find((e) => e.name === 'getInitQuestions');
    expect(entry).toBeDefined();
    expect(entry!.module).toBe('init');
    expect(entry!.signature).toContain('InterviewStep');
    expect(entry!.signature).toContain('InterviewContext');
  });

  it('submitInitAnswers entry has correct module and signature', () => {
    const entry = SLOPE_REGISTRY.find((e) => e.name === 'submitInitAnswers');
    expect(entry).toBeDefined();
    expect(entry!.module).toBe('init');
    expect(entry!.signature).toContain('InitFromAnswersResult');
  });
});
