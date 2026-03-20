import { describe, it, expect } from 'vitest';
import { parseWorkflow, resolveVariables } from '../../src/core/workflow.js';
import type { WorkflowDefinition } from '../../src/core/workflow.js';

const MINIMAL_YAML = `
name: test-workflow
version: "1"
phases:
  - id: setup
    steps:
      - id: greet
        type: command
        command: echo hello
`;

const FULL_YAML = `
name: sprint-standard
version: "1"
description: Standard sprint lifecycle
variables:
  sprint_id:
    required: true
    type: string
    pattern: "^S\\\\d+$"
  model:
    type: string
    default: local
phases:
  - id: pre_hole
    steps:
      - id: briefing
        type: command
        command: slope briefing --sprint=\${sprint_id}
        checkpoint: exit_code_0
        blocks_next: true
      - id: verify_previous
        type: validation
        conditions:
          - file_exists:.slope/config.json
  - id: per_ticket
    repeat_for: tickets
    timeout_per_item: 300
    on_timeout: log_blocker_and_skip
    steps:
      - id: pre_shot
        type: agent_input
        prompt: "Select club for ticket"
        required_fields:
          - club
          - approach
      - id: implement
        type: agent_work
        prompt: "Implement the ticket"
        rules:
          - "Run tests after each change"
          - "Commit after completion"
        blocks_next: true
  - id: post_hole
    steps:
      - id: validate
        type: command
        command: slope validate
        checkpoint: exit_code_0
`;

describe('parseWorkflow', () => {
  it('parses a minimal workflow', () => {
    const def = parseWorkflow(MINIMAL_YAML);
    expect(def.name).toBe('test-workflow');
    expect(def.version).toBe('1');
    expect(def.phases).toHaveLength(1);
    expect(def.phases[0].id).toBe('setup');
    expect(def.phases[0].steps).toHaveLength(1);
    expect(def.phases[0].steps[0]).toEqual({
      id: 'greet',
      type: 'command',
      command: 'echo hello',
      prompt: undefined,
      checkpoint: undefined,
      blocks_next: undefined,
      rules: undefined,
      required_fields: undefined,
      conditions: undefined,
    });
  });

  it('parses a full workflow with all features', () => {
    const def = parseWorkflow(FULL_YAML);
    expect(def.name).toBe('sprint-standard');
    expect(def.description).toBe('Standard sprint lifecycle');
    expect(def.variables).toBeDefined();
    expect(def.variables!.sprint_id.required).toBe(true);
    expect(def.variables!.sprint_id.type).toBe('string');
    expect(def.variables!.model.default).toBe('local');

    // Phases
    expect(def.phases).toHaveLength(3);

    // per_ticket phase
    const perTicket = def.phases[1];
    expect(perTicket.repeat_for).toBe('tickets');
    expect(perTicket.timeout_per_item).toBe(300);
    expect(perTicket.on_timeout).toBe('log_blocker_and_skip');

    // agent_input step
    const preShot = perTicket.steps[0];
    expect(preShot.type).toBe('agent_input');
    expect(preShot.required_fields).toEqual(['club', 'approach']);

    // agent_work step
    const implement = perTicket.steps[1];
    expect(implement.type).toBe('agent_work');
    expect(implement.rules).toHaveLength(2);
    expect(implement.blocks_next).toBe(true);

    // validation step
    const verify = def.phases[0].steps[1];
    expect(verify.type).toBe('validation');
    expect(verify.conditions).toEqual(['file_exists:.slope/config.json']);
  });

  it('throws on missing name', () => {
    expect(() => parseWorkflow('version: "1"\nphases: []')).toThrow('string "name"');
  });

  it('throws on missing version', () => {
    expect(() => parseWorkflow('name: test\nphases: []')).toThrow('string "version"');
  });

  it('throws on missing phases', () => {
    expect(() => parseWorkflow('name: test\nversion: "1"')).toThrow('"phases" array');
  });

  it('throws on invalid step type', () => {
    const yaml = `
name: test
version: "1"
phases:
  - id: p1
    steps:
      - id: s1
        type: invalid_type
`;
    expect(() => parseWorkflow(yaml)).toThrow('valid "type"');
  });

  it('throws on step missing id', () => {
    const yaml = `
name: test
version: "1"
phases:
  - id: p1
    steps:
      - type: command
`;
    expect(() => parseWorkflow(yaml)).toThrow('string "id"');
  });

  it('throws on phase missing id', () => {
    const yaml = `
name: test
version: "1"
phases:
  - steps: []
`;
    expect(() => parseWorkflow(yaml)).toThrow('string "id"');
  });

  it('throws on invalid YAML', () => {
    expect(() => parseWorkflow('{{{')).toThrow('YAML parse error');
  });

  it('handles YAML 1.2 correctly (no Norway problem)', () => {
    // In YAML 1.1, 'no' would be parsed as false. YAML 1.2 core schema keeps it as a string.
    const yaml = `
name: "no"
version: "1"
phases:
  - id: "on"
    steps:
      - id: "yes"
        type: command
        command: echo yes
`;
    const def = parseWorkflow(yaml);
    expect(def.name).toBe('no');
    expect(def.phases[0].id).toBe('on');
    expect(def.phases[0].steps[0].id).toBe('yes');
  });
});

describe('resolveVariables', () => {
  const baseDef: WorkflowDefinition = {
    name: 'test',
    version: '1',
    variables: {
      sprint_id: { required: true, type: 'string' },
      model: { type: 'string', default: 'local' },
    },
    phases: [
      {
        id: 'setup',
        steps: [
          {
            id: 'briefing',
            type: 'command',
            command: 'slope briefing --sprint=${sprint_id}',
          },
          {
            id: 'run',
            type: 'command',
            command: 'run with ${model}',
          },
        ],
      },
    ],
  };

  it('interpolates provided variables', () => {
    const resolved = resolveVariables(baseDef, { sprint_id: 'S42' });
    expect(resolved.phases[0].steps[0].command).toBe('slope briefing --sprint=S42');
  });

  it('uses defaults for missing optional variables', () => {
    const resolved = resolveVariables(baseDef, { sprint_id: 'S42' });
    expect(resolved.phases[0].steps[1].command).toBe('run with local');
  });

  it('overrides defaults with provided values', () => {
    const resolved = resolveVariables(baseDef, { sprint_id: 'S42', model: 'api' });
    expect(resolved.phases[0].steps[1].command).toBe('run with api');
  });

  it('throws on missing required variable', () => {
    expect(() => resolveVariables(baseDef, {})).toThrow('Required variable "sprint_id"');
  });

  it('throws on unresolved variable reference', () => {
    const def: WorkflowDefinition = {
      name: 'test',
      version: '1',
      phases: [{
        id: 'p',
        steps: [{
          id: 's',
          type: 'command',
          command: 'echo ${unknown_var}',
        }],
      }],
    };
    expect(() => resolveVariables(def, {})).toThrow('Unresolved variable reference: ${unknown_var}');
  });

  it('handles escaped dollar signs', () => {
    const def: WorkflowDefinition = {
      name: 'test',
      version: '1',
      phases: [{
        id: 'p',
        steps: [{
          id: 's',
          type: 'command',
          command: 'echo \\${not_a_var}',
        }],
      }],
    };
    const resolved = resolveVariables(def, {});
    expect(resolved.phases[0].steps[0].command).toBe('echo ${not_a_var}');
  });

  it('validates pattern constraint', () => {
    const def: WorkflowDefinition = {
      name: 'test',
      version: '1',
      variables: {
        sprint_id: { required: true, type: 'string', pattern: '^S\\d+$' },
      },
      phases: [{ id: 'p', steps: [{ id: 's', type: 'command', command: '${sprint_id}' }] }],
    };
    // Valid
    expect(() => resolveVariables(def, { sprint_id: 'S42' })).not.toThrow();
    // Invalid pattern
    expect(() => resolveVariables(def, { sprint_id: 'invalid' })).toThrow('does not match pattern');
  });

  it('does not mutate the original definition', () => {
    const original = JSON.stringify(baseDef);
    resolveVariables(baseDef, { sprint_id: 'S42' });
    expect(JSON.stringify(baseDef)).toBe(original);
  });
});
