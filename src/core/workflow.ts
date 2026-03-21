// SLOPE — Workflow Definition Types & YAML Parser
// Parses YAML 1.2 workflow definitions into typed structures for the workflow engine.

import { parseDocument } from 'yaml';

// --- Workflow Definition Types ---

/** Variable definition for workflow parameterization */
export interface WorkflowVariable {
  required?: boolean;
  type?: 'string' | 'integer' | 'array';
  pattern?: string;
  default?: string;
}

/** A single step within a workflow phase */
export interface WorkflowStep {
  id: string;
  type: 'command' | 'validation' | 'agent_input' | 'agent_work';
  prompt?: string;
  command?: string;
  checkpoint?: string;
  blocks_next?: boolean;
  rules?: string[];
  required_fields?: string[];
  /** Validation conditions (for type=validation) */
  conditions?: string[];
}

/** A phase containing ordered steps */
export interface WorkflowPhase {
  id: string;
  steps: WorkflowStep[];
  /** Variable name containing array to iterate over */
  repeat_for?: string;
  /** Timeout in seconds for each repeated item */
  timeout_per_item?: number;
  /** Behavior when a repeated item times out */
  on_timeout?: 'fail' | 'log_blocker_and_skip';
}

/** Top-level workflow definition */
export interface WorkflowDefinition {
  name: string;
  version: string;
  description?: string;
  variables?: Record<string, WorkflowVariable>;
  phases: WorkflowPhase[];
}

// --- Parser ---

/** Parse a YAML string into a WorkflowDefinition. Throws on invalid structure. */
export function parseWorkflow(yaml: string): WorkflowDefinition {
  const doc = parseDocument(yaml, { schema: 'core' });

  if (doc.errors.length > 0) {
    throw new Error(`YAML parse error: ${doc.errors[0].message}`);
  }

  const raw = doc.toJS() as Record<string, unknown>;

  if (!raw || typeof raw !== 'object') {
    throw new Error('Workflow must be a YAML mapping');
  }

  // Required fields
  if (!raw.name || typeof raw.name !== 'string') {
    throw new Error('Workflow must have a string "name" field');
  }
  if (!raw.version || typeof raw.version !== 'string') {
    throw new Error('Workflow must have a string "version" field');
  }
  if (!Array.isArray(raw.phases)) {
    throw new Error('Workflow must have a "phases" array');
  }

  // Parse variables
  const variables: Record<string, WorkflowVariable> | undefined =
    raw.variables && typeof raw.variables === 'object' && !Array.isArray(raw.variables)
      ? parseVariables(raw.variables as Record<string, unknown>)
      : undefined;

  // Parse phases
  const phases: WorkflowPhase[] = (raw.phases as unknown[]).map((p, i) =>
    parsePhase(p, i),
  );

  return {
    name: raw.name as string,
    version: raw.version as string,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    variables,
    phases,
  };
}

function parseVariables(raw: Record<string, unknown>): Record<string, WorkflowVariable> {
  const result: Record<string, WorkflowVariable> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val !== 'object' || val === null || Array.isArray(val)) {
      throw new Error(`Variable "${key}" must be a mapping`);
    }
    const v = val as Record<string, unknown>;
    result[key] = {
      required: typeof v.required === 'boolean' ? v.required : undefined,
      type: isVariableType(v.type) ? v.type : undefined,
      pattern: typeof v.pattern === 'string' ? v.pattern : undefined,
      default: v.default !== undefined ? String(v.default) : undefined,
    };
  }
  return result;
}

function isVariableType(val: unknown): val is 'string' | 'integer' | 'array' {
  return val === 'string' || val === 'integer' || val === 'array';
}

const VALID_STEP_TYPES = new Set(['command', 'validation', 'agent_input', 'agent_work']);

function parsePhase(raw: unknown, index: number): WorkflowPhase {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Phase at index ${index} must be a mapping`);
  }

  const p = raw as Record<string, unknown>;

  if (!p.id || typeof p.id !== 'string') {
    throw new Error(`Phase at index ${index} must have a string "id"`);
  }

  if (!Array.isArray(p.steps)) {
    throw new Error(`Phase "${p.id}" must have a "steps" array`);
  }

  const steps: WorkflowStep[] = (p.steps as unknown[]).map((s, si) =>
    parseStep(s, p.id as string, si),
  );

  return {
    id: p.id as string,
    steps,
    repeat_for: typeof p.repeat_for === 'string' ? p.repeat_for : undefined,
    timeout_per_item: typeof p.timeout_per_item === 'number' ? p.timeout_per_item : undefined,
    on_timeout: p.on_timeout === 'fail' || p.on_timeout === 'log_blocker_and_skip'
      ? p.on_timeout
      : undefined,
  };
}

function parseStep(raw: unknown, phaseId: string, index: number): WorkflowStep {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Step at index ${index} in phase "${phaseId}" must be a mapping`);
  }

  const s = raw as Record<string, unknown>;

  if (!s.id || typeof s.id !== 'string') {
    throw new Error(`Step at index ${index} in phase "${phaseId}" must have a string "id"`);
  }

  if (!s.type || typeof s.type !== 'string' || !VALID_STEP_TYPES.has(s.type)) {
    throw new Error(
      `Step "${s.id}" in phase "${phaseId}" must have a valid "type" (command|validation|agent_input|agent_work)`,
    );
  }

  return {
    id: s.id as string,
    type: s.type as WorkflowStep['type'],
    prompt: typeof s.prompt === 'string' ? s.prompt : undefined,
    command: typeof s.command === 'string' ? s.command : undefined,
    checkpoint: typeof s.checkpoint === 'string' ? s.checkpoint : undefined,
    blocks_next: typeof s.blocks_next === 'boolean' ? s.blocks_next : undefined,
    rules: Array.isArray(s.rules) ? (s.rules as unknown[]).map(r => String(r)) : undefined,
    required_fields: Array.isArray(s.required_fields)
      ? (s.required_fields as unknown[]).map(r => String(r))
      : undefined,
    conditions: Array.isArray(s.conditions)
      ? (s.conditions as unknown[]).map(c => String(c))
      : undefined,
  };
}

// --- Variable Interpolation ---

/**
 * Resolve `${varName}` references in all string values of a workflow definition.
 * - Top-level string keys only (no nesting like `${x.y}`)
 * - Missing variable at resolve time → error
 * - Escaped `\${literal}` → `${literal}`
 */
export function resolveVariables(
  def: WorkflowDefinition,
  vars: Record<string, string>,
): WorkflowDefinition {
  // Validate all required variables are provided
  if (def.variables) {
    for (const [name, spec] of Object.entries(def.variables)) {
      if (spec.required && !(name in vars) && spec.default === undefined) {
        throw new Error(`Required variable "${name}" not provided`);
      }
    }
  }

  // Build resolved vars: provided values + defaults
  const resolved: Record<string, string> = {};
  if (def.variables) {
    for (const [name, spec] of Object.entries(def.variables)) {
      if (name in vars) {
        resolved[name] = vars[name];
      } else if (spec.default !== undefined) {
        resolved[name] = spec.default;
      }
    }
  }
  // Also include any extra vars not in the schema
  for (const [name, val] of Object.entries(vars)) {
    if (!(name in resolved)) {
      resolved[name] = val;
    }
  }

  // Validate patterns
  if (def.variables) {
    for (const [name, spec] of Object.entries(def.variables)) {
      if (spec.pattern && name in resolved) {
        const re = new RegExp(spec.pattern);
        if (!re.test(resolved[name])) {
          throw new Error(`Variable "${name}" value "${resolved[name]}" does not match pattern "${spec.pattern}"`);
        }
      }
    }
  }

  // Deep-clone and interpolate all string values (avoids JSON.stringify escape issues)
  return deepInterpolate(def, resolved) as WorkflowDefinition;
}

/** Recursively walk a value, interpolating ${var} in all strings. */
function deepInterpolate(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return interpolateString(value, vars);
  }
  if (Array.isArray(value)) {
    return value.map(item => deepInterpolate(item, vars));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = deepInterpolate(val, vars);
    }
    return result;
  }
  return value;
}

/** Interpolate ${var} references in a string. Throws on unresolved variables. */
function interpolateString(str: string, vars: Record<string, string>): string {
  // Replace escaped \${ with a placeholder, then restore after interpolation
  const PLACEHOLDER = '\x00ESCAPED_DOLLAR\x00';
  let result = str.replace(/\\\$\{/g, PLACEHOLDER);

  // Find and replace ${varName} references
  result = result.replace(/\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_match, name: string) => {
    if (!(name in vars)) {
      throw new Error(`Unresolved variable reference: \${${name}}`);
    }
    return vars[name];
  });

  // Restore escaped references as literal ${
  result = result.replaceAll(PLACEHOLDER, '${');

  return result;
}
