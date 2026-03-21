// SLOPE — Workflow Validator
// Validates WorkflowDefinitions for structural correctness before execution.

import type { WorkflowDefinition, WorkflowStep } from './workflow.js';
import { VALID_STEP_TYPES } from './workflow.js';

/** A single validation error or warning */
export interface ValidationIssue {
  message: string;
  /** Dot-path to the problematic element (e.g., "phases[0].steps[1]") */
  path?: string;
}

/** Result of validating a workflow definition */
export interface WorkflowValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/**
 * Validate a parsed WorkflowDefinition for structural issues.
 * Does NOT re-validate YAML parsing — assumes parseWorkflow() already succeeded.
 */
export function validateWorkflow(def: WorkflowDefinition): WorkflowValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Version check
  if (def.version !== '1') {
    errors.push({ message: `Unsupported workflow version: "${def.version}" (expected "1")` });
  }

  // Name check
  if (!def.name || def.name.trim().length === 0) {
    errors.push({ message: 'Workflow name must be a non-empty string' });
  }

  // Collect all step IDs for uniqueness check
  const allStepIds = new Map<string, string>(); // step_id → phase_id

  // Collect all variable references found in steps
  const referencedVars = new Set<string>();
  const definedVars = new Set(Object.keys(def.variables ?? {}));

  if (def.phases.length === 0) {
    warnings.push({ message: 'Workflow has no phases' });
  }

  // Phase-level checks
  const phaseIds = new Set<string>();
  for (let pi = 0; pi < def.phases.length; pi++) {
    const phase = def.phases[pi];
    const pPath = `phases[${pi}]`;

    // Duplicate phase ID
    if (phaseIds.has(phase.id)) {
      errors.push({ message: `Duplicate phase ID: "${phase.id}"`, path: pPath });
    }
    phaseIds.add(phase.id);

    // Empty steps
    if (phase.steps.length === 0) {
      warnings.push({ message: `Phase "${phase.id}" has no steps`, path: pPath });
    }

    // repeat_for variable reference
    if (phase.repeat_for) {
      referencedVars.add(phase.repeat_for);
      if (definedVars.size > 0 && !definedVars.has(phase.repeat_for)) {
        warnings.push({
          message: `Phase "${phase.id}" references variable "${phase.repeat_for}" in repeat_for, but it is not defined in variables`,
          path: `${pPath}.repeat_for`,
        });
      }

      // on_timeout only makes sense with repeat_for
      if (phase.timeout_per_item && !phase.on_timeout) {
        warnings.push({
          message: `Phase "${phase.id}" has timeout_per_item but no on_timeout behavior`,
          path: `${pPath}.on_timeout`,
        });
      }
    } else {
      // on_timeout without repeat_for
      if (phase.on_timeout) {
        warnings.push({
          message: `Phase "${phase.id}" has on_timeout but no repeat_for — on_timeout is ignored`,
          path: `${pPath}.on_timeout`,
        });
      }
    }

    // Step-level checks
    for (let si = 0; si < phase.steps.length; si++) {
      const step = phase.steps[si];
      const sPath = `${pPath}.steps[${si}]`;

      // Duplicate step ID across all phases
      if (allStepIds.has(step.id)) {
        errors.push({
          message: `Duplicate step ID: "${step.id}" (also in phase "${allStepIds.get(step.id)}")`,
          path: sPath,
        });
      }
      allStepIds.set(step.id, phase.id);

      // Valid step type
      if (!VALID_STEP_TYPES.has(step.type)) {
        errors.push({
          message: `Invalid step type: "${step.type}"`,
          path: `${sPath}.type`,
        });
      }

      // Type-specific validation
      validateStepByType(step, sPath, errors, warnings);

      // blocks_next on terminal step is redundant
      if (step.blocks_next && si === phase.steps.length - 1) {
        warnings.push({
          message: `Step "${step.id}" has blocks_next but is the last step in its phase — this is redundant`,
          path: `${sPath}.blocks_next`,
        });
      }

      // Collect variable references from string fields
      collectVarRefs(step.command, referencedVars);
      collectVarRefs(step.prompt, referencedVars);
      if (step.rules) step.rules.forEach(r => collectVarRefs(r, referencedVars));
      if (step.conditions) step.conditions.forEach(c => collectVarRefs(c, referencedVars));
    }
  }

  // Warn about unreferenced variables
  for (const varName of definedVars) {
    if (!referencedVars.has(varName)) {
      warnings.push({
        message: `Variable "${varName}" is defined but never referenced`,
        path: `variables.${varName}`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/** Validate type-specific step requirements */
function validateStepByType(
  step: WorkflowStep,
  path: string,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
): void {
  switch (step.type) {
    case 'command':
      if (!step.command) {
        errors.push({
          message: `Command step "${step.id}" must have a "command" field`,
          path: `${path}.command`,
        });
      }
      break;

    case 'validation':
      if (!step.conditions?.length && !step.command) {
        warnings.push({
          message: `Validation step "${step.id}" has no conditions or command — it will always pass`,
          path,
        });
      }
      break;

    case 'agent_input':
      if (!step.required_fields?.length && !step.prompt) {
        warnings.push({
          message: `Agent input step "${step.id}" has no required_fields or prompt`,
          path,
        });
      }
      break;

    case 'agent_work':
      if (!step.prompt && !step.rules?.length) {
        warnings.push({
          message: `Agent work step "${step.id}" has no prompt or rules — agent has no guidance`,
          path,
        });
      }
      break;
  }
}

/** Extract ${varName} references from a string */
function collectVarRefs(str: string | undefined, refs: Set<string>): void {
  if (!str) return;
  const pattern = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
  let match;
  while ((match = pattern.exec(str)) !== null) {
    refs.add(match[1]);
  }
}
