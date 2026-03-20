// slope workflow — Manage workflow definitions

import { loadWorkflow, listWorkflows, validateWorkflow } from '../../core/index.js';
import type { WorkflowStep } from '../../core/index.js';

function workflowValidate(args: string[], cwd: string): void {
  const name = args[0];
  if (!name) {
    console.error('Usage: slope workflow validate <name>\n');
    process.exit(1);
  }

  let def;
  try {
    def = loadWorkflow(name, cwd);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const result = validateWorkflow(def);

  console.log(`\nWorkflow: ${def.name} (v${def.version})`);
  if (def.description) console.log(`  ${def.description}`);
  console.log('');

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      console.log(`  \x1b[31m[ERROR]\x1b[0m ${err.message}${err.path ? ` (${err.path})` : ''}`);
    }
  }

  if (result.warnings.length > 0) {
    for (const warn of result.warnings) {
      console.log(`  \x1b[33m[WARN]\x1b[0m ${warn.message}${warn.path ? ` (${warn.path})` : ''}`);
    }
  }

  if (result.valid && result.warnings.length === 0) {
    console.log('  \x1b[32mValid — no issues found.\x1b[0m');
  } else if (result.valid) {
    console.log(`\n  \x1b[32mValid\x1b[0m with ${result.warnings.length} warning(s).`);
  } else {
    console.log(`\n  \x1b[31mInvalid\x1b[0m — ${result.errors.length} error(s), ${result.warnings.length} warning(s).`);
    process.exit(1);
  }

  console.log('');
}

function workflowList(cwd: string): void {
  const workflows = listWorkflows(cwd);

  if (workflows.length === 0) {
    console.log('No workflows found.');
    console.log('Create .slope/workflows/<name>.yaml or use a built-in workflow.\n');
    return;
  }

  console.log('\nAvailable Workflows\n');
  console.log('  Name                     Source     Description');
  console.log('  ' + '\u2500'.repeat(70));

  for (const wf of workflows) {
    const name = wf.name.padEnd(24);
    const source = wf.source.padEnd(10);
    const desc = wf.description ?? '';
    console.log(`  ${name} ${source} ${desc}`);
  }

  console.log(`\n  ${workflows.length} workflow(s) available.\n`);
}

function workflowShow(args: string[], cwd: string): void {
  const name = args[0];
  if (!name) {
    console.error('Usage: slope workflow show <name>\n');
    process.exit(1);
  }

  let def;
  try {
    def = loadWorkflow(name, cwd);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  console.log(`\n\x1b[1m${def.name}\x1b[0m (v${def.version})`);
  if (def.description) console.log(`  ${def.description}`);

  // Variables
  if (def.variables && Object.keys(def.variables).length > 0) {
    console.log('\n  Variables:');
    for (const [name, spec] of Object.entries(def.variables)) {
      const parts = [];
      if (spec.type) parts.push(spec.type);
      if (spec.required) parts.push('required');
      if (spec.default !== undefined) parts.push(`default: "${spec.default}"`);
      if (spec.pattern) parts.push(`pattern: ${spec.pattern}`);
      console.log(`    ${name}: ${parts.join(', ')}`);
    }
  }

  // Phases and steps
  console.log('\n  Phases:');
  for (const phase of def.phases) {
    let phaseLabel = `  \x1b[36m${phase.id}\x1b[0m`;
    if (phase.repeat_for) phaseLabel += ` (repeat for each \${${phase.repeat_for}})`;
    console.log(phaseLabel);

    for (const step of phase.steps) {
      const typeIcon = stepIcon(step);
      const flags = [];
      if (step.blocks_next) flags.push('blocks');
      if (step.checkpoint) flags.push(`checkpoint: ${step.checkpoint}`);
      const flagStr = flags.length > 0 ? ` \x1b[90m[${flags.join(', ')}]\x1b[0m` : '';

      console.log(`    ${typeIcon} ${step.id}${flagStr}`);

      if (step.command) console.log(`      \x1b[90m$ ${step.command}\x1b[0m`);
      if (step.prompt) console.log(`      \x1b[90m"${step.prompt}"\x1b[0m`);
      if (step.required_fields) console.log(`      \x1b[90mfields: ${step.required_fields.join(', ')}\x1b[0m`);
      if (step.rules) {
        for (const rule of step.rules) {
          console.log(`      \x1b[90m- ${rule}\x1b[0m`);
        }
      }
    }
  }

  console.log('');
}

function stepIcon(step: WorkflowStep): string {
  switch (step.type) {
    case 'command': return '\u25B6';     // ▶
    case 'validation': return '\u2713';  // ✓
    case 'agent_input': return '\u270E'; // ✎
    case 'agent_work': return '\u2692';  // ⚒
    default: return '\u2022';            // •
  }
}

export async function workflowCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const sub = args[0];

  switch (sub) {
    case 'validate':
      workflowValidate(args.slice(1), cwd);
      break;
    case 'list':
      workflowList(cwd);
      break;
    case 'show':
      workflowShow(args.slice(1), cwd);
      break;
    default:
      console.log(`
slope workflow — Manage workflow definitions

Usage:
  slope workflow validate <name>   Parse and validate a workflow definition
  slope workflow list              List all available workflows (project + built-in)
  slope workflow show <name>       Pretty-print a workflow with phase/step tree

Workflows define step-by-step sprint lifecycles that control execution order.
Place custom workflows in .slope/workflows/<name>.yaml
`);
      if (sub) process.exit(1);
      break;
  }
}
