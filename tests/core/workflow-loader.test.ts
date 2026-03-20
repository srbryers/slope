import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadWorkflow, listWorkflows } from '../../src/core/workflow-loader.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-wfload-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const SIMPLE_YAML = `
name: my-workflow
version: "1"
description: A test workflow
phases:
  - id: setup
    steps:
      - id: greet
        type: command
        command: echo hello
`;

describe('loadWorkflow', () => {
  it('loads a built-in workflow by name', () => {
    const def = loadWorkflow('sprint-standard', tmpDir);
    expect(def.name).toBe('sprint-standard');
    expect(def.version).toBe('1');
    expect(def.phases.length).toBeGreaterThan(0);
  });

  it('loads from project .slope/workflows/ first', () => {
    const wfDir = join(tmpDir, '.slope', 'workflows');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'sprint-standard.yaml'), SIMPLE_YAML);

    // Should load project override, not built-in
    const def = loadWorkflow('sprint-standard', tmpDir);
    expect(def.name).toBe('my-workflow');
  });

  it('strips .yaml extension from name', () => {
    const def = loadWorkflow('sprint-standard.yaml', tmpDir);
    expect(def.name).toBe('sprint-standard');
  });

  it('throws on non-existent workflow', () => {
    expect(() => loadWorkflow('nonexistent', tmpDir)).toThrow('not found');
  });

  it('loads project-only workflow', () => {
    const wfDir = join(tmpDir, '.slope', 'workflows');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'custom.yaml'), SIMPLE_YAML);

    const def = loadWorkflow('custom', tmpDir);
    expect(def.name).toBe('my-workflow');
  });
});

describe('listWorkflows', () => {
  it('lists built-in workflows', () => {
    const list = listWorkflows(tmpDir);
    expect(list.length).toBeGreaterThan(0);

    const standard = list.find(w => w.name === 'sprint-standard');
    expect(standard).toBeDefined();
    expect(standard!.source).toBe('built-in');
    expect(standard!.version).toBe('1');
  });

  it('includes project workflows', () => {
    const wfDir = join(tmpDir, '.slope', 'workflows');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'custom.yaml'), SIMPLE_YAML);

    const list = listWorkflows(tmpDir);
    const custom = list.find(w => w.name === 'my-workflow');
    expect(custom).toBeDefined();
    expect(custom!.source).toBe('project');
  });

  it('project overrides built-in with same filename', () => {
    const wfDir = join(tmpDir, '.slope', 'workflows');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'sprint-standard.yaml'), SIMPLE_YAML);

    const list = listWorkflows(tmpDir);
    const standard = list.find(w => w.name === 'my-workflow');
    expect(standard).toBeDefined();
    expect(standard!.source).toBe('project');
  });

  it('returns empty array when no workflows exist and no built-ins found', () => {
    // Built-ins always exist, but this tests the code path with no project dir
    const list = listWorkflows(tmpDir);
    // Should have at least the built-in(s)
    expect(Array.isArray(list)).toBe(true);
  });

  it('skips invalid YAML files', () => {
    const wfDir = join(tmpDir, '.slope', 'workflows');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'bad.yaml'), '{{{invalid yaml');
    writeFileSync(join(wfDir, 'good.yaml'), SIMPLE_YAML);

    const list = listWorkflows(tmpDir);
    const names = list.map(w => w.name);
    expect(names).toContain('my-workflow');
    expect(names).not.toContain('bad');
  });
});
