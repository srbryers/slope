import { describe, it, expect } from 'vitest';
import { validateWorkflow } from '../../src/core/workflow-validator.js';
import type { WorkflowDefinition } from '../../src/core/workflow.js';

function makeDef(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    name: 'test',
    version: '1',
    phases: [
      {
        id: 'setup',
        steps: [
          { id: 'run', type: 'command', command: 'echo hello' },
        ],
      },
    ],
    ...overrides,
  };
}

describe('validateWorkflow', () => {
  it('validates a correct minimal workflow', () => {
    const result = validateWorkflow(makeDef());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects unsupported version', () => {
    const result = validateWorkflow(makeDef({ version: '2' }));
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('Unsupported workflow version');
  });

  it('detects duplicate step IDs across phases', () => {
    const result = validateWorkflow(makeDef({
      phases: [
        { id: 'p1', steps: [{ id: 'dup', type: 'command', command: 'a' }] },
        { id: 'p2', steps: [{ id: 'dup', type: 'command', command: 'b' }] },
      ],
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('Duplicate step ID'))).toBe(true);
  });

  it('detects duplicate phase IDs', () => {
    const result = validateWorkflow(makeDef({
      phases: [
        { id: 'same', steps: [{ id: 's1', type: 'command', command: 'a' }] },
        { id: 'same', steps: [{ id: 's2', type: 'command', command: 'b' }] },
      ],
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('Duplicate phase ID'))).toBe(true);
  });

  it('errors on command step without command', () => {
    const result = validateWorkflow(makeDef({
      phases: [{ id: 'p', steps: [{ id: 's', type: 'command' }] }],
    }));
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('must have a "command" field');
  });

  it('warns on validation step without conditions', () => {
    const result = validateWorkflow(makeDef({
      phases: [{ id: 'p', steps: [{ id: 's', type: 'validation' }] }],
    }));
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.message.includes('no conditions'))).toBe(true);
  });

  it('warns on agent_input without required_fields or prompt', () => {
    const result = validateWorkflow(makeDef({
      phases: [{ id: 'p', steps: [{ id: 's', type: 'agent_input' }] }],
    }));
    expect(result.warnings.some(w => w.message.includes('no required_fields'))).toBe(true);
  });

  it('warns on agent_work without prompt or rules', () => {
    const result = validateWorkflow(makeDef({
      phases: [{ id: 'p', steps: [{ id: 's', type: 'agent_work' }] }],
    }));
    expect(result.warnings.some(w => w.message.includes('no prompt or rules'))).toBe(true);
  });

  it('warns on blocks_next on terminal step', () => {
    const result = validateWorkflow(makeDef({
      phases: [{
        id: 'p', steps: [
          { id: 's', type: 'command', command: 'echo', blocks_next: true },
        ],
      }],
    }));
    expect(result.warnings.some(w => w.message.includes('redundant'))).toBe(true);
  });

  it('warns on undefined variable in repeat_for', () => {
    const result = validateWorkflow(makeDef({
      variables: { sprint_id: { required: true } },
      phases: [{
        id: 'p',
        repeat_for: 'tickets',
        steps: [{ id: 's', type: 'command', command: 'echo ${sprint_id}' }],
      }],
    }));
    expect(result.warnings.some(w => w.message.includes('not defined in variables'))).toBe(true);
  });

  it('warns on unreferenced variables', () => {
    const result = validateWorkflow(makeDef({
      variables: { unused_var: { type: 'string' } },
    }));
    expect(result.warnings.some(w => w.message.includes('never referenced'))).toBe(true);
  });

  it('warns on on_timeout without repeat_for', () => {
    const result = validateWorkflow(makeDef({
      phases: [{
        id: 'p',
        on_timeout: 'fail',
        steps: [{ id: 's', type: 'command', command: 'echo' }],
      }],
    }));
    expect(result.warnings.some(w => w.message.includes('on_timeout is ignored'))).toBe(true);
  });

  it('warns on empty phases', () => {
    const result = validateWorkflow(makeDef({ phases: [] }));
    expect(result.warnings.some(w => w.message.includes('no phases'))).toBe(true);
  });

  it('warns on phase with no steps', () => {
    const result = validateWorkflow(makeDef({
      phases: [{ id: 'empty', steps: [] }],
    }));
    expect(result.warnings.some(w => w.message.includes('no steps'))).toBe(true);
  });

  it('collects variable refs from command, prompt, rules, conditions', () => {
    const result = validateWorkflow(makeDef({
      variables: {
        a: { type: 'string' },
        b: { type: 'string' },
        c: { type: 'string' },
        d: { type: 'string' },
      },
      phases: [{
        id: 'p',
        steps: [
          { id: 's1', type: 'command', command: 'echo ${a}' },
          { id: 's2', type: 'agent_work', prompt: '${b}', rules: ['${c}'] },
          { id: 's3', type: 'validation', conditions: ['${d}'] },
        ],
      }],
    }));
    // All 4 variables referenced — no "never referenced" warnings
    expect(result.warnings.filter(w => w.message.includes('never referenced'))).toHaveLength(0);
  });

  it('includes path context in issues', () => {
    const result = validateWorkflow(makeDef({
      phases: [{ id: 'p', steps: [{ id: 's', type: 'command' }] }],
    }));
    expect(result.errors[0].path).toBe('phases[0].steps[0].command');
  });
});
