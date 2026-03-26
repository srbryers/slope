import { describe, it, expect } from 'vitest';
import { loadWorkflow, listWorkflows, validateWorkflow } from '../../src/core/index.js';

describe('Built-in workflows', () => {
  // Use a non-existent project dir so only built-ins are found
  const cwd = '/tmp/slope-builtin-test-nonexistent';

  describe('sprint-standard', () => {
    it('loads and parses successfully', () => {
      const def = loadWorkflow('sprint-standard', cwd);
      expect(def.name).toBe('sprint-standard');
      expect(def.version).toBe('1');
    });

    it('has required structure', () => {
      const def = loadWorkflow('sprint-standard', cwd);

      // Should have 4 phases (pre_hole, plan_review, per_ticket, post_hole)
      expect(def.phases).toHaveLength(4);

      // Phase IDs
      const phaseIds = def.phases.map(p => p.id);
      expect(phaseIds).toContain('pre_hole');
      expect(phaseIds).toContain('plan_review');
      expect(phaseIds).toContain('per_ticket');
      expect(phaseIds).toContain('post_hole');

      // per_ticket should use repeat_for
      const perTicket = def.phases.find(p => p.id === 'per_ticket')!;
      expect(perTicket.repeat_for).toBe('tickets');
      expect(perTicket.on_timeout).toBe('log_blocker_and_skip');
    });

    it('has required variables', () => {
      const def = loadWorkflow('sprint-standard', cwd);
      expect(def.variables).toBeDefined();
      expect(def.variables!.sprint_id).toBeDefined();
      expect(def.variables!.sprint_id.required).toBe(true);
      expect(def.variables!.tickets).toBeDefined();
      expect(def.variables!.tickets.required).toBe(true);
    });

    it('passes validation with no errors', () => {
      const def = loadWorkflow('sprint-standard', cwd);
      const result = validateWorkflow(def);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('has all step types represented', () => {
      const def = loadWorkflow('sprint-standard', cwd);
      const allSteps = def.phases.flatMap(p => p.steps);
      const types = new Set(allSteps.map(s => s.type));

      expect(types.has('command')).toBe(true);
      expect(types.has('validation')).toBe(true);
      expect(types.has('agent_input')).toBe(true);
      expect(types.has('agent_work')).toBe(true);
    });
  });

  describe('sprint-autonomous', () => {
    it('loads and passes validation', () => {
      const def = loadWorkflow('sprint-autonomous', cwd);
      expect(def.name).toBe('sprint-autonomous');
      const result = validateWorkflow(def);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('has plan and per_ticket phases', () => {
      const def = loadWorkflow('sprint-autonomous', cwd);
      const phaseIds = def.phases.map(p => p.id);
      expect(phaseIds).toContain('plan');
      expect(phaseIds).toContain('per_ticket');

      const perTicket = def.phases.find(p => p.id === 'per_ticket')!;
      expect(perTicket.repeat_for).toBe('tickets');
      expect(perTicket.on_timeout).toBe('log_blocker_and_skip');
      expect(perTicket.timeout_per_item).toBe(1800);
    });
  });

  describe('sprint-lightweight', () => {
    it('loads and passes validation', () => {
      const def = loadWorkflow('sprint-lightweight', cwd);
      expect(def.name).toBe('sprint-lightweight');
      const result = validateWorkflow(def);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('has minimal structure (per_ticket + validate)', () => {
      const def = loadWorkflow('sprint-lightweight', cwd);
      expect(def.phases).toHaveLength(2);
      expect(def.phases[0].id).toBe('per_ticket');
      expect(def.phases[1].id).toBe('validate');
    });
  });

  describe('listWorkflows', () => {
    it('includes all 3 built-in workflows', () => {
      const list = listWorkflows(cwd);
      const names = list.map(w => w.name);
      expect(names).toContain('sprint-standard');
      expect(names).toContain('sprint-autonomous');
      expect(names).toContain('sprint-lightweight');
    });
  });
});
