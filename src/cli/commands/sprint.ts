import {
  loadSprintState,
  saveSprintState,
  createSprintState,
  mutateSprintState,
  updateGate,
  updateSprintPhase,
  clearSprintState,
  isSprintComplete,
  pendingGates,
  isSprintPhase,
  SPRINT_PHASES,
  type GateName,
  type SprintPhase,
} from '../sprint-state.js';
import { WorkflowEngine, loadWorkflow, resolveVariables, validateWorkflow, loadConfig, loadScorecards, parseRoadmap, castRoadmapStructure, formatSprintLabel, formatSprintNumber, parseSprintNumber } from '../../core/index.js';
import type { RoadmapSprint, WorkflowDefinition, WorkflowExecution } from '../../core/index.js';
import { createHash } from 'node:crypto';

/** Get workflow definition from execution snapshot (preferred) or disk (fallback for old executions) */
function getDefinition(exec: WorkflowExecution, cwd: string): { def: WorkflowDefinition; drifted: boolean } {
  // Prefer snapshot from execution
  if (exec.definition_json) {
    const def = JSON.parse(exec.definition_json) as WorkflowDefinition;
    // Check if current YAML has drifted
    let drifted = false;
    try {
      const current = loadWorkflow(exec.workflow_name, cwd);
      const currentHash = createHash('sha256').update(JSON.stringify(current)).digest('hex').slice(0, 16);
      drifted = exec.definition_hash !== currentHash;
    } catch { /* workflow file might be gone — that's fine, we have the snapshot */ }
    return { def, drifted };
  }
  // Fallback for old executions without snapshot
  return { def: loadWorkflow(exec.workflow_name, cwd), drifted: false };
}
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { createStore } from '../../store/index.js';
import {
  blockingRoadmapIssuesForSprint,
  collectSiblingWorktreeReality,
  findWorktreeOverlaps,
  formatWorktreeRealitySection,
  loadRoadmapReality,
  parseTouchedPaths,
} from '../pre-sprint-reality.js';

/**
 * Check completion_conditions for a step before allowing completion/skip.
 * Returns null if all conditions met, or an error message string.
 */
function checkCompletionConditions(
  stepId: string,
  def: WorkflowDefinition,
  currentPhase: string | undefined,
  cwd: string,
): string | null {
  const phase = def.phases.find(p => p.id === currentPhase);
  const step = phase?.steps.find(s => s.id === stepId);
  if (!step?.completion_conditions) return null;

  const { files_exist } = step.completion_conditions;
  if (!files_exist || files_exist.length === 0) return null;

  const missing: string[] = [];
  for (const pattern of files_exist) {
    if (pattern.includes('*')) {
      // Simple glob: match files in the directory using the pattern
      const dir = join(cwd, dirname(pattern));
      const base = basename(pattern);
      const re = new RegExp('^' + base.replace(/\*/g, '.*') + '$');
      try {
        const files = readdirSync(dir);
        if (!files.some(f => re.test(f))) missing.push(pattern);
      } catch {
        missing.push(pattern); // directory doesn't exist
      }
    } else {
      if (!existsSync(join(cwd, pattern))) missing.push(pattern);
    }
  }

  if (missing.length > 0) {
    return `Step "${stepId}" has unmet completion conditions:\n` +
      missing.map(m => `  - Missing: ${m}`).join('\n') +
      '\n\nComplete these conditions before advancing, or use --force to override.';
  }
  return null;
}

const VALID_GATES: GateName[] = ['tests', 'code_review', 'architect_review', 'scorecard', 'review_md'];

/**
 * `slope sprint begin --sprint=N --ticket=T` — bundled start-of-work flow.
 *
 * Idempotent steps (GH #311):
 *   1. Start sprint state if not already started
 *   2. Claim the ticket (skip if already claimed by this user)
 *   3. Run briefing
 *   4. Run prep --lite for the ticket
 *   5. Print pending gates
 *   6. Print recommended next implementation step
 */
async function beginCommand(args: string[], cwd: string): Promise<void> {
  const sprintArg = args.find(a => a.startsWith('--sprint='));
  const ticketArg = args.find(a => a.startsWith('--ticket='));
  if (!sprintArg || !ticketArg) {
    console.error('\nUsage: slope sprint begin --sprint=N --ticket=KEY');
    console.error('Bundles: sprint start + claim + briefing + prep --lite\n');
    process.exit(1);
  }

  const sprint = parseSprintNumber(sprintArg.split('=')[1]);
  const ticket = ticketArg.split('=')[1];
  if (!sprint || !ticket) {
    console.error('Error: --sprint must be a positive sprint id; --ticket must be a non-empty key');
    process.exit(1);
  }

  // Step 1: sprint state
  let state = loadSprintState(cwd);
  if (state && state.sprint === sprint) {
    console.log(`Sprint ${formatSprintNumber(sprint)}: already started (phase: ${state.phase}).`);
  } else if (state && state.sprint !== sprint) {
    console.error(`Refusing to begin S${formatSprintNumber(sprint)} — sprint-state.json is for S${formatSprintNumber(state.sprint)}.`);
    console.error('Run `slope sprint reset` first if the previous sprint is done.');
    process.exit(1);
  } else {
    state = createSprintState(sprint, 'planning');
    saveSprintState(cwd, state);
    console.log(`Sprint ${formatSprintNumber(sprint)}: started (phase: planning).`);
  }

  // Step 2: claim
  const { resolveStore } = await import('../store.js');
  const { checkConflicts } = await import('../../core/index.js');
  const player = process.env.USER || 'unknown';
  const store = await resolveStore(cwd);
  try {
    const existing = await store.list(sprint);
    const ownClaim = existing.find(c => c.target === ticket && c.player === player);
    if (ownClaim) {
      console.log(`Ticket ${ticket}: already claimed by ${player}.`);
    } else {
      // Detect overlap conflicts via core check
      const tempClaim = {
        id: '__pending__',
        sprint_number: sprint,
        player,
        target: ticket,
        scope: 'ticket' as const,
        claimed_at: new Date().toISOString(),
      };
      const overlaps = checkConflicts([...existing, tempClaim]).filter(c => c.severity === 'overlap');
      if (overlaps.length > 0) {
        console.error(`\nClaim blocked — overlap conflict(s) detected:`);
        for (const c of overlaps) console.error(`  [!!] ${c.reason}`);
        console.error(`\nResolve conflicts or run \`slope claim --target=${ticket} --sprint=${formatSprintNumber(sprint)} --force\` to override.`);
        process.exit(1);
      }
      const claim = await store.claim({ sprint_number: sprint, player, target: ticket, scope: 'ticket' });
      console.log(`Ticket ${ticket}: claimed (id ${claim.id.slice(0, 8)}, player ${player}).`);
    }
  } finally {
    store.close();
  }

  // Step 3: briefing — wrapped so a briefing/prep failure doesn't leave the
  // user with sprint-state created but no human-readable handoff. Sprint
  // state is already persisted at this point; failures here are recoverable
  // by re-running the individual command.
  console.log('\n' + '─'.repeat(50));
  try {
    const { briefingCommand } = await import('./briefing.js');
    await briefingCommand([`--sprint=${formatSprintNumber(sprint)}`]);
  } catch (err) {
    console.error(`  Could not run briefing: ${(err as Error).message}`);
    console.error(`  Sprint state was already created; retry with: slope briefing --sprint=${formatSprintNumber(sprint)}`);
  }

  // Step 4: prep --lite
  console.log('\n' + '─'.repeat(50));
  console.log(`PREP: ${ticket} (--lite)`);
  console.log('─'.repeat(50));
  try {
    const { prepCommand } = await import('./prep.js');
    await prepCommand([ticket, '--lite']);
  } catch (err) {
    console.error(`  Could not run prep: ${(err as Error).message}`);
  }

  // Step 5 & 6: pending gates and next step (via agent status)
  console.log('\n' + '─'.repeat(50));
  console.log('NEXT');
  console.log('─'.repeat(50));
  let status;
  try {
    const { collectAgentStatus } = await import('./agent.js');
    status = await collectAgentStatus(cwd);
  } catch (err) {
    console.error(`  Could not compute agent status: ${(err as Error).message}`);
    return;
  }
  if (status.requiredGates.length > 0) {
    console.log(`  Pending gates: ${status.requiredGates.join(', ')}`);
  }
  if (status.recommendedCommands.length > 0) {
    console.log('  Recommended commands:');
    for (const c of status.recommendedCommands.slice(0, 3)) {
      console.log(`    $ ${c}`);
    }
  } else {
    console.log('  Sprint state is balanced. Start implementing.');
  }
  console.log('');
}

async function startCommand(args: string[], cwd: string): Promise<void> {
  const numberArg = args.find(a => a.startsWith('--number='));
  if (!numberArg) {
    console.error('Error: --number=N is required. Usage: slope sprint start --number=22');
    process.exit(1);
  }

  const sprint = parseSprintNumber(numberArg.slice('--number='.length));
  if (!sprint) {
    console.error('Error: --number must be a positive sprint id, e.g. 114 or 114.5.');
    process.exit(1);
  }

  const phaseArg = args.find(a => a.startsWith('--phase='));
  const phaseInput = phaseArg?.slice('--phase='.length) ?? 'planning';
  if (!isSprintPhase(phaseInput)) {
    console.error(`Error: invalid phase "${phaseInput}". Valid phases: ${SPRINT_PHASES.join(', ')}`);
    process.exit(1);
  }
  const phase = phaseInput as SprintPhase;
  const force = args.includes('--force');
  const touchesArg = args.find(a => a.startsWith('--touches='));
  const touchedPaths = parseTouchedPaths(touchesArg?.slice('--touches='.length));

  const existing = loadSprintState(cwd);
  if (existing && existing.sprint === sprint) {
    if (phaseArg && existing.phase !== phase) {
      updateSprintPhase(cwd, phase);
      console.log(`Sprint ${formatSprintNumber(sprint)} phase updated: ${phase}.`);
      return;
    }
    console.log(`Sprint ${formatSprintNumber(sprint)} state already exists (phase: ${existing.phase}).`);
    return;
  }

  const roadmapReality = loadRoadmapReality(cwd);
  const blockingRoadmapIssues = blockingRoadmapIssuesForSprint(roadmapReality, sprint);
  if (blockingRoadmapIssues.length > 0 && !force) {
    console.error(`\nPre-sprint reality check failed for ${formatSprintLabel(sprint)}:`);
    for (const issue of blockingRoadmapIssues) {
      console.error(`  [${issue.type}] ${issue.message}`);
    }
    console.error('\nThis sprint appears to have already shipped or already has a scorecard. Reconcile the roadmap, or rerun with --force if this is intentional.');
    process.exit(1);
  }

  const worktrees = collectSiblingWorktreeReality(cwd);
  const worktreeLines = formatWorktreeRealitySection(worktrees, touchedPaths);
  if (worktreeLines.length > 0) {
    console.log('');
    console.log(worktreeLines.join('\n'));
    console.log('');
  }

  const overlaps = findWorktreeOverlaps(worktrees, touchedPaths);
  if (overlaps.length > 0 && !force) {
    console.error('Pre-sprint reality check failed: sibling worktree overlap detected.');
    console.error('Resolve the overlap, choose a non-overlapping sprint, or rerun with --force if this is intentional.');
    process.exit(1);
  }

  const state = createSprintState(sprint, phase);
  saveSprintState(cwd, state);
  const autoClaim = await autoClaimSprint(cwd, sprint);
  console.log(`Sprint ${formatSprintNumber(sprint)} started (phase: ${phase}). Use 'slope sprint gate <name>' to mark gates.`);
  if (autoClaim) console.log(autoClaim);
}

async function autoClaimSprint(cwd: string, sprint: number): Promise<string | null> {
  const { resolveStore } = await import('../store.js');
  const player = process.env.USER || 'unknown';
  const target = `sprint:${formatSprintLabel(sprint)}`;

  try {
    const store = await resolveStore(cwd);
    try {
      const existing = await store.list(sprint);
      if (existing.some(c => c.player === player && c.target === target)) {
        return `Claim: ${target} already held by ${player}.`;
      }
      const claim = await store.claim({
        sprint_number: sprint,
        player,
        target,
        scope: 'area',
        notes: 'auto-claimed by slope sprint start',
      });
      return `Claim: ${claim.target} (${claim.scope}) auto-claimed for ${player}.`;
    } finally {
      store.close();
    }
  } catch {
    return null;
  }
}

function phaseCommand(args: string[], cwd: string): void {
  const phaseInput = args[0];
  if (!phaseInput || !isSprintPhase(phaseInput)) {
    console.error(`Error: phase required. Usage: slope sprint phase <${SPRINT_PHASES.join('|')}>`);
    process.exit(1);
  }

  const before = loadSprintState(cwd);
  if (!before) {
    console.error("No active sprint. Run 'slope sprint start --number=N' first.");
    process.exit(1);
  }

  updateSprintPhase(cwd, phaseInput);
  if (before.phase === phaseInput) {
    console.log(`Sprint ${formatSprintNumber(before.sprint)} already in ${phaseInput} phase.`);
  } else {
    console.log(`Sprint ${formatSprintNumber(before.sprint)} phase updated: ${before.phase} -> ${phaseInput}.`);
  }
}

function gateCommand(args: string[], cwd: string): void {
  const gateName = args[0] as GateName | undefined;
  if (!gateName || !VALID_GATES.includes(gateName)) {
    console.error(`Error: gate name required. Valid gates: ${VALID_GATES.join(', ')}`);
    process.exit(1);
  }

  const state = loadSprintState(cwd);
  if (!state) {
    console.error("No active sprint. Run 'slope sprint start --number=N' first.");
    process.exit(1);
  }

  if (state.gates[gateName]) {
    console.log(`Gate '${gateName}' is already complete.`);
    return;
  }

  updateGate(cwd, gateName, true);
  const updated = loadSprintState(cwd)!;
  const remaining = pendingGates(updated);

  if (remaining.length === 0) {
    console.log(`Gate '${gateName}' marked complete. All gates done — ready for PR!`);
  } else {
    console.log(`Gate '${gateName}' marked complete. Remaining: ${remaining.join(', ')}`);
  }
}

function statusCommand(cwd: string): void {
  const state = loadSprintState(cwd);
  if (!state) {
    console.log('No active sprint state.');
    return;
  }

  const complete = isSprintComplete(state);
  console.log(`Sprint ${formatSprintNumber(state.sprint)} — phase: ${state.phase}${complete ? ' (all gates complete)' : ''}`);
  console.log(`Started: ${state.started_at}`);
  console.log(`Updated: ${state.updated_at}`);
  console.log('');
  console.log('Gates:');
  for (const [gate, done] of Object.entries(state.gates)) {
    const marker = done ? '[x]' : '[ ]';
    console.log(`  ${marker} ${gate}`);
  }

  if (!complete) {
    const pending = pendingGates(state);
    console.log(`\nRemaining: ${pending.join(', ')}`);
  }
}

function resetCommand(cwd: string): void {
  clearSprintState(cwd);
  console.log('Sprint state cleared.');
}

// --- Workflow-driven commands ---

/**
 * Auto-execute command steps and advance the workflow.
 * Keeps running command steps until hitting a non-command step or completion.
 */
async function autoRunCommandSteps(
  execId: string,
  def: WorkflowDefinition,
  store: ReturnType<typeof createStore>,
  cwd: string,
): Promise<{ phase?: string; step?: { id: string; type: string; prompt?: string; command?: string }; is_complete: boolean }> {
  const { execSync } = await import('node:child_process');
  const engine = new WorkflowEngine();
  const resolved = resolveVariables(def, (await store.getExecution(execId))!.variables);

  let next = await engine.next(execId, resolved, store);

  while (!next.is_complete && next.step?.type === 'command' && next.step.command) {
    const cmd = next.step.command;
    const stepId = next.step.id;
    console.log(`  Running: ${cmd}`);

    let exitCode = 0;
    try {
      execSync(cmd, { cwd, stdio: 'inherit', timeout: 60000 });
    } catch (err) {
      exitCode = (err as { status?: number }).status ?? 1;
      console.log(`  Command exited with code ${exitCode}`);
    }

    // Complete the step with the exit code
    const result = await engine.complete(execId, stepId, { exit_code: exitCode }, resolved, store);
    if (result.is_complete) {
      return { is_complete: true };
    }

    // Get next step
    next = await engine.next(execId, resolved, store);
  }

  return next;
}

function getStore(cwd: string) {
  const config = loadConfig(cwd);
  return createStore({ storePath: config.store_path ?? '.slope/slope.db', cwd });
}

function roadmapTicketKeysForSprint(cwd: string, sprintId: string | undefined): string[] {
  if (!sprintId) return [];
  const sprintNumber = parseSprintNumber(sprintId);
  if (sprintNumber === null) return [];

  const config = loadConfig(cwd);
  if (!config.roadmapPath) return [];

  const roadmapPath = join(cwd, config.roadmapPath);
  if (!existsSync(roadmapPath)) return [];

  try {
    const raw = JSON.parse(readFileSync(roadmapPath, 'utf8'));
    const parsed = parseRoadmap(raw);
    const roadmap = parsed.roadmap ?? castRoadmapStructure(raw);
    const sprint = roadmap?.sprints.find(s => s.id === sprintNumber);
    return sprint?.tickets.map(t => t.key).filter(Boolean) ?? [];
  } catch {
    return [];
  }
}

function applyWorkflowVariableDefaults(
  def: WorkflowDefinition,
  vars: Record<string, string>,
  cwd: string,
  sprintId: string | undefined,
): void {
  if (sprintId && !('sprint_id' in vars)) {
    vars.sprint_id = sprintId;
  }

  const ticketsSpec = def.variables?.tickets;
  if (ticketsSpec?.required && !('tickets' in vars)) {
    const tickets = roadmapTicketKeysForSprint(cwd, sprintId);
    if (tickets.length > 0) {
      vars.tickets = tickets.join(',');
    }
  }
}

function positionalSprintArg(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--var') {
      i++;
      continue;
    }
    if (!arg.startsWith('--')) return arg;
  }
  return undefined;
}

function sprintIdFromRunArgs(args: string[]): string | undefined {
  const sprintFlag = args.find(a => a.startsWith('--sprint='));
  if (sprintFlag) return sprintFlag.slice('--sprint='.length);
  return positionalSprintArg(args);
}

const SPRINT_PHASE_ORDER: Record<SprintPhase, number> = {
  planning: 0,
  reviewing: 1,
  implementing: 2,
  scoring: 3,
  complete: 4,
};

function workflowPhaseToSprintPhase(workflowPhase: string | undefined): SprintPhase | null {
  switch (workflowPhase) {
    case 'pre_hole':
      return 'planning';
    case 'plan_review':
      return 'reviewing';
    case 'per_ticket':
      return 'implementing';
    case 'post_hole':
    case 'validate':
      return 'scoring';
    default:
      return null;
  }
}

function sprintNumberFromId(sprintId: string | undefined): number | null {
  if (!sprintId) return null;
  const parsed = Number(sprintId.replace(/^S/i, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function syncSprintStateWithWorkflow(cwd: string, sprintId: string | undefined, workflowPhase: string | undefined): void {
  const nextPhase = workflowPhaseToSprintPhase(workflowPhase);
  const sprint = sprintNumberFromId(sprintId);
  if (!nextPhase || sprint === null) return;

  const existing = loadSprintState(cwd);
  if (!existing) {
    saveSprintState(cwd, createSprintState(sprint, nextPhase));
    return;
  }
  if (existing.sprint !== sprint || existing.phase === 'complete') return;
  if (SPRINT_PHASE_ORDER[nextPhase] <= SPRINT_PHASE_ORDER[existing.phase]) return;

  mutateSprintState(cwd, current => {
    if (current.sprint !== sprint || current.phase === 'complete') return false;
    if (SPRINT_PHASE_ORDER[nextPhase] <= SPRINT_PHASE_ORDER[current.phase]) return false;
    current.phase = nextPhase;
    return true;
  });
}

async function runWorkflowCommand(args: string[], cwd: string): Promise<void> {
  const explicitSprintId = sprintIdFromRunArgs(args);
  const workflowArg = args.find(a => a.startsWith('--workflow='));
  const varArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--var' && i + 1 < args.length) {
      varArgs.push(`--var=${args[i + 1]}`);
      i++;
    } else if (args[i].startsWith('--var=')) {
      varArgs.push(args[i]);
    }
  }

  if (!workflowArg) {
    console.error('Usage: slope sprint run <sprint_id> --workflow=<name> [--var key=value ...]');
    process.exit(1);
  }

  const workflowName = workflowArg.slice('--workflow='.length);

  // Parse variables
  const vars: Record<string, string> = {};
  if (explicitSprintId) vars.sprint_id = explicitSprintId;
  for (const v of varArgs) {
    const kv = v.slice('--var='.length);
    const eq = kv.indexOf('=');
    if (eq > 0) {
      vars[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
  }
  const sprintId = explicitSprintId ?? vars.sprint_id;


  // Load and validate workflow
  const def = loadWorkflow(workflowName, cwd);
  const validation = validateWorkflow(def);
  if (!validation.valid) {
    console.error(`Workflow "${workflowName}" has errors:`);
    for (const err of validation.errors) {
      console.error(`  - ${err.message}`);
    }
    process.exit(1);
  }

  applyWorkflowVariableDefaults(def, vars, cwd, sprintId);

  // Resolve variables
  const resolved = resolveVariables(def, vars);

  // Start execution
  const store = getStore(cwd);
  try {
    const engine = new WorkflowEngine();
    const exec = await engine.start(resolved, store, {
      sprint_id: sprintId,
      variables: vars,
    });

    console.log(`\nWorkflow "${def.name}" started (execution: ${exec.id})`);
    if (sprintId) console.log(`Sprint: ${sprintId}`);
    console.log(`Status: ${exec.status}\n`);

    // Auto-execute any initial command steps
    const next = await autoRunCommandSteps(exec.id, resolved, store, cwd);
    syncSprintStateWithWorkflow(cwd, sprintId, next.phase);

    if (next.is_complete) {
      console.log('Workflow complete.');
    } else {
      console.log(`\nNext step:`);
      console.log(`  Phase: ${next.phase}`);
      console.log(`  Step:  ${next.step?.id} (${next.step?.type})`);
      if (next.step?.prompt) console.log(`  Prompt: ${next.step.prompt}`);
      if (next.step?.command) console.log(`  Command: ${next.step.command}`);
    }
    console.log('');
  } finally {
    store.close();
  }
}

async function workflowStatusCommand(args: string[], cwd: string): Promise<void> {
  const sprintArg = args.find(a => !a.startsWith('--'));
  const store = getStore(cwd);

  try {
    if (sprintArg) {
      const exec = await store.getExecutionBySprint(sprintArg);
      if (!exec) {
        console.log(`No active workflow execution for sprint ${sprintArg}.`);
        return;
      }
      printExecution(exec);
    } else {
      const active = await store.listExecutions({ status: 'running' });
      if (active.length === 0) {
        // Fall through to legacy status
        statusCommand(cwd);
        return;
      }
      console.log(`\n${active.length} active workflow execution(s):\n`);
      for (const exec of active) {
        printExecution(exec);
      }
    }
  } finally {
    store.close();
  }
}

interface StaleWorkflowExecution {
  exec: WorkflowExecution;
  reason: string;
}

function completedRoadmapSprintIds(cwd: string, config: ReturnType<typeof loadConfig>): Set<number> {
  if (!config.roadmapPath) return new Set();
  const roadmapPath = join(cwd, config.roadmapPath);
  if (!existsSync(roadmapPath)) return new Set();
  try {
    const raw = JSON.parse(readFileSync(roadmapPath, 'utf8'));
    const parsed = parseRoadmap(raw);
    const roadmap = parsed.roadmap ?? castRoadmapStructure(raw);
    if (!roadmap) return new Set();
    return new Set(
      roadmap.sprints
        .filter(sprint => {
          const status = (sprint as RoadmapSprint & { status?: string }).status;
          return status === 'complete' || status === 'superseded';
        })
        .map(sprint => sprint.id),
    );
  } catch {
    return new Set();
  }
}

async function findStaleWorkflowExecutions(cwd: string, store: ReturnType<typeof createStore>): Promise<StaleWorkflowExecution[]> {
  const config = loadConfig(cwd);
  const scorecardSprintIds = new Set(loadScorecards(config, cwd).map(card => card.sprint_number));
  const roadmapDoneIds = completedRoadmapSprintIds(cwd, config);
  const running = await store.listExecutions({ status: 'running' });
  const stale: StaleWorkflowExecution[] = [];

  for (const exec of running) {
    const sprint = sprintNumberFromId(exec.sprint_id);
    if (sprint === null) continue;
    const reasons: string[] = [];
    if (scorecardSprintIds.has(sprint)) reasons.push('scorecard exists');
    if (roadmapDoneIds.has(sprint)) reasons.push('roadmap complete/superseded');
    if (reasons.length > 0) {
      stale.push({ exec, reason: reasons.join(', ') });
    }
  }

  return stale;
}

async function workflowCleanupCommand(args: string[], cwd: string): Promise<void> {
  const action = args[0];
  const dryRun = args.includes('--dry-run');
  const staleOnly = args.includes('--stale');

  if (action !== 'cleanup' || !staleOnly) {
    console.error('Usage: slope sprint workflow cleanup --stale [--dry-run]');
    process.exit(1);
  }

  const store = getStore(cwd);
  try {
    const stale = await findStaleWorkflowExecutions(cwd, store);
    if (stale.length === 0) {
      console.log('No stale running workflow executions found.');
      return;
    }

    const engine = new WorkflowEngine();
    for (const { exec, reason } of stale) {
      const label = exec.sprint_id ?? exec.id;
      if (dryRun) {
        console.log(`[dry-run] Would pause ${label} (${exec.workflow_name}) at ${exec.current_phase}/${exec.current_step} — ${reason}`);
      } else {
        await engine.pause(exec.id, store);
        console.log(`Paused ${label} (${exec.workflow_name}) at ${exec.current_phase}/${exec.current_step} — ${reason}`);
      }
    }

    const suffix = dryRun ? 'would be paused' : 'paused';
    console.log(`\n${stale.length} stale workflow execution(s) ${suffix}.`);
  } finally {
    store.close();
  }
}

function printExecution(exec: { id: string; workflow_name: string; sprint_id?: string; current_phase?: string; current_step?: string; status: string; completed_steps: unknown[]; started_at: string }): void {
  console.log(`  Execution: ${exec.id}`);
  console.log(`  Workflow:  ${exec.workflow_name}`);
  if (exec.sprint_id) console.log(`  Sprint:    ${exec.sprint_id}`);
  console.log(`  Status:    ${exec.status}`);
  console.log(`  Phase:     ${exec.current_phase ?? '-'}`);
  console.log(`  Step:      ${exec.current_step ?? '-'}`);
  console.log(`  Progress:  ${exec.completed_steps.length} steps completed`);
  console.log(`  Started:   ${exec.started_at}`);
  console.log('');
}

async function resumeCommand(args: string[], cwd: string): Promise<void> {
  const sprintArg = args.find(a => !a.startsWith('--'));
  if (!sprintArg) {
    console.error('Usage: slope sprint resume <sprint_id>');
    process.exit(1);
  }

  const store = getStore(cwd);
  try {
    const exec = await store.getExecutionBySprint(sprintArg);
    if (!exec) {
      console.error(`No active workflow execution for sprint ${sprintArg}.`);
      process.exit(1);
    }

    const { def, drifted } = getDefinition(exec, cwd);
    if (drifted) console.log(`\x1b[33m⚠ Workflow definition has changed since this execution started. Using snapshot from start.\x1b[0m`);
    const resolved = resolveVariables(def, exec.variables);
    const engine = new WorkflowEngine();

    // Transition paused → running before querying next step
    if (exec.status === 'paused') {
      await engine.resume(exec.id, store);
    }

    // Auto-execute any pending command steps
    const next = await autoRunCommandSteps(exec.id, def, store, cwd);
    syncSprintStateWithWorkflow(cwd, sprintArg, next.phase);

    if (next.is_complete) {
      console.log(`Workflow for sprint ${sprintArg} is complete.`);
      return;
    }

    console.log(`\nResuming workflow for sprint ${sprintArg} (execution: ${exec.id})`);
    console.log(`\nNext step:`);
    console.log(`  Phase: ${next.phase}`);
    console.log(`  Step:  ${next.step?.id} (${next.step?.type})`);
    if (next.step?.prompt) console.log(`  Prompt: ${next.step.prompt}`);
    if (next.step?.command) console.log(`  Command: ${next.step.command}`);
    console.log('');
  } finally {
    store.close();
  }
}

async function skipCommand(args: string[], cwd: string): Promise<void> {
  const sprintArg = args.find(a => !a.startsWith('--'));
  const stepArg = args.find(a => a.startsWith('--step='));
  const reasonArg = args.find(a => a.startsWith('--reason='));

  if (!sprintArg || !stepArg) {
    console.error('Usage: slope sprint skip <sprint_id> --step=<id> --reason="..."');
    process.exit(1);
  }

  const stepId = stepArg.slice('--step='.length);
  const reason = reasonArg?.slice('--reason='.length) ?? 'Skipped via CLI';

  const store = getStore(cwd);
  try {
    const exec = await store.getExecutionBySprint(sprintArg);
    if (!exec) {
      console.error(`No active workflow execution for sprint ${sprintArg}.`);
      process.exit(1);
    }

    const forceFlag = args.some(a => a === '--force');
    const { def, drifted } = getDefinition(exec, cwd);
    if (drifted) console.log(`\x1b[33m⚠ Workflow definition has changed since this execution started. Using snapshot from start.\x1b[0m`);

    // Check completion conditions before allowing skip
    if (!forceFlag) {
      const conditionError = checkCompletionConditions(stepId, def, exec.current_phase, cwd);
      if (conditionError) {
        console.error(conditionError);
        process.exit(1);
      }
    }

    const resolved = resolveVariables(def, exec.variables);
    const engine = new WorkflowEngine();
    const result = await engine.skip(exec.id, stepId, reason, resolved, store);

    if (result.is_complete) {
      console.log(`Step "${stepId}" skipped. Workflow is now complete.`);
    } else {
      syncSprintStateWithWorkflow(cwd, sprintArg, result.advanced_to?.phase);
      console.log(`Step "${stepId}" skipped (reason: ${reason}).`);
      console.log(`Next: ${result.advanced_to?.phase}/${result.advanced_to?.step}`);
    }
  } finally {
    store.close();
  }
}

async function pauseCommand(args: string[], cwd: string): Promise<void> {
  const sprintArg = args.find(a => !a.startsWith('--'));

  if (!sprintArg) {
    console.error('Usage: slope sprint pause <sprint_id>');
    process.exit(1);
  }

  const store = getStore(cwd);
  try {
    const exec = await store.getExecutionBySprint(sprintArg);
    if (!exec) {
      console.error(`No active workflow execution for sprint ${sprintArg}.`);
      process.exit(1);
    }

    const engine = new WorkflowEngine();
    await engine.pause(exec.id, store);
    console.log(`Sprint ${sprintArg} paused at ${exec.current_phase}/${exec.current_step}.`);
    console.log('Resume with: slope sprint resume ' + sprintArg);
  } finally {
    store.close();
  }
}

async function contextCommand(args: string[], cwd: string): Promise<void> {
  const sprintArg = args.find(a => !a.startsWith('--'));
  if (!sprintArg) {
    console.error('Usage: slope sprint context <sprint_id>');
    process.exit(1);
  }

  const store = getStore(cwd);
  try {
    const exec = await store.getExecutionBySprint(sprintArg);
    if (!exec) {
      console.error(`No active workflow execution for sprint ${sprintArg}.`);
      process.exit(1);
    }

    const { def } = getDefinition(exec, cwd);
    const resolved = resolveVariables(def, exec.variables);
    const engine = new WorkflowEngine();
    const next = await engine.next(exec.id, resolved, store);

    const completedCount = exec.completed_steps.length;
    const totalSteps = def.phases.reduce((sum, p) => sum + p.steps.length, 0);

    const lines: string[] = [
      `Sprint ${sprintArg} — Workflow: ${exec.workflow_name}`,
      `Status: ${exec.status} | Progress: ${completedCount}/${totalSteps} steps`,
      '',
    ];

    if (next.is_complete) {
      lines.push('All steps complete. Run post-hole routine.');
    } else {
      lines.push(`Current: ${next.phase}/${next.step?.id} (${next.step?.type})`);
      if (next.step?.prompt) lines.push(`Prompt: ${next.step.prompt}`);
      if (next.step?.rules) lines.push(`Rules: ${next.step.rules.join('; ')}`);
      if (next.current_item) lines.push(`Item: ${next.current_item} (${(next.item_index ?? 0) + 1}/${next.total_items})`);

      // Show remaining steps
      lines.push('', 'Remaining steps:');
      const completedIds = new Set(exec.completed_steps.map(s => `${s.phase}/${s.step_id}`));
      for (const phase of def.phases) {
        for (const step of phase.steps) {
          if (!completedIds.has(`${phase.id}/${step.id}`)) {
            lines.push(`  ${phase.id}/${step.id} (${step.type})`);
          }
        }
      }
    }

    if (args.includes('--json')) {
      console.log(JSON.stringify({ sprint: sprintArg, workflow: exec.workflow_name, status: exec.status, progress: `${completedCount}/${totalSteps}`, current: next.is_complete ? null : { phase: next.phase, step: next.step?.id, type: next.step?.type }, remaining: def.phases.flatMap(p => p.steps.filter(s => !exec.completed_steps.some(cs => cs.phase === p.id && cs.step_id === s.id)).map(s => ({ phase: p.id, step: s.id, type: s.type }))) }, null, 2));
    } else {
      console.log(lines.join('\n'));
    }
  } finally {
    store.close();
  }
}

async function validateSprintCommand(args: string[], cwd: string): Promise<void> {
  const sprintArg = args.find(a => !a.startsWith('--'));
  if (!sprintArg) {
    console.error('Usage: slope sprint validate <sprint_id>');
    process.exit(1);
  }

  const store = getStore(cwd);
  try {
    // Check workflow execution
    const exec = await store.getExecutionBySprint(sprintArg);
    const checks: Array<{ name: string; passed: boolean; message: string }> = [];

    if (exec) {
      const { def } = getDefinition(exec, cwd);
      const totalSteps = def.phases.reduce((sum, p) => sum + p.steps.length, 0);
      const completed = exec.completed_steps.length;
      checks.push({
        name: 'workflow',
        passed: exec.status === 'completed',
        message: exec.status === 'completed' ? `complete (${completed}/${totalSteps} steps)` : `${exec.status} (${completed}/${totalSteps} steps)`,
      });
    } else {
      checks.push({ name: 'workflow', passed: false, message: 'no execution found' });
    }

    // Check scorecard exists
    const scorecardNum = sprintArg.replace(/^S/, '');
    const scorecardPath = join(cwd, 'docs', 'retros', `sprint-${scorecardNum}.json`);
    checks.push({
      name: 'scorecard',
      passed: existsSync(scorecardPath),
      message: existsSync(scorecardPath) ? 'exists' : 'missing',
    });

    // Check plan exists
    const planGlob = join(cwd, 'docs', 'backlog');
    let planExists = false;
    try {
      const files = readdirSync(planGlob);
      planExists = files.some(f => f.includes(`sprint-${scorecardNum}`) && f.endsWith('-plan.md'));
    } catch { /* dir missing */ }
    checks.push({
      name: 'plan',
      passed: planExists,
      message: planExists ? 'exists' : 'missing',
    });

    // Check tests pass
    try {
      const { execSync } = await import('node:child_process');
      execSync('pnpm test 2>&1', { cwd, encoding: 'utf8', timeout: 120000 });
      checks.push({ name: 'tests', passed: true, message: 'passing' });
    } catch {
      checks.push({ name: 'tests', passed: false, message: 'failing' });
    }

    const allPassed = checks.every(c => c.passed);
    const red = '\x1b[31m';
    const green = '\x1b[32m';
    const reset = '\x1b[0m';

    if (args.includes('--json')) {
      console.log(JSON.stringify({ sprint: sprintArg, passed: allPassed, checks }, null, 2));
    } else {
      console.log(`\n=== Sprint Validate: ${sprintArg} === ${allPassed ? `${green}PASS${reset}` : `${red}FAIL${reset}`}\n`);
      for (const c of checks) {
        const icon = c.passed ? `${green}✓${reset}` : `${red}✗${reset}`;
        console.log(`  ${icon} ${c.name.padEnd(12)} ${c.message}`);
      }
      console.log('');
    }

    if (!allPassed) process.exit(1);
  } finally {
    store.close();
  }
}

export async function sprintCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const sub = args[0];

  if (!sub || sub === '--help' || sub === '-h') {
    printSprintUsage();
    return;
  }

  switch (sub) {
    case 'start':
      await startCommand(args.slice(1), cwd);
      break;
    case 'begin':
      await beginCommand(args.slice(1), cwd);
      break;
    case 'plan': {
      const { sprintPlanCommand } = await import('./sprint-plan.js');
      await sprintPlanCommand(args.slice(1));
      break;
    }
    case 'gate':
      gateCommand(args.slice(1), cwd);
      break;
    case 'phase':
      phaseCommand(args.slice(1), cwd);
      break;
    case 'status':
      await workflowStatusCommand(args.slice(1), cwd);
      break;
    case 'reset': {
      const resetArgs = args.slice(1);
      if (resetArgs.includes('--help') || resetArgs.includes('-h')) {
        printSprintUsage();
        break;
      }
      if (resetArgs.length > 0) {
        printSprintUsage();
        process.exit(1);
      }
      resetCommand(cwd);
      break;
    }
    case 'run':
      await runWorkflowCommand(args.slice(1), cwd);
      break;
    case 'workflow':
      await workflowCleanupCommand(args.slice(1), cwd);
      break;
    case 'resume':
      await resumeCommand(args.slice(1), cwd);
      break;
    case 'skip':
      await skipCommand(args.slice(1), cwd);
      break;
    case 'pause':
      await pauseCommand(args.slice(1), cwd);
      break;
    case 'context':
      await contextCommand(args.slice(1), cwd);
      break;
    case 'validate':
      await validateSprintCommand(args.slice(1), cwd);
      break;
    default:
      printSprintUsage();
      process.exit(1);
      break;
  }
}

function printSprintUsage(): void {
  console.log(`
slope sprint — Sprint lifecycle management

Legacy commands:
  slope sprint start --number=N [--phase=<phase>] [--touches=<paths>] [--force]
                                      Start sprint state tracking with pre-sprint reality checks
  slope sprint begin --sprint=N --ticket=T  Bundled start + claim + briefing + prep (#311)
  slope sprint plan --sprint=N [--output=path]  Generate markdown sprint plan (#312)
  slope sprint phase <phase>       Update current sprint phase
  slope sprint gate <name>           Mark a gate as complete
  slope sprint status                Show sprint state and gates
  slope sprint reset                 Clear sprint state

Workflow commands:
  slope sprint run <id> --workflow=<name> [--var k=v ...]   Start workflow execution
  slope sprint status [sprint_id]    Show workflow execution progress
  slope sprint resume <sprint_id>    Resume a paused workflow execution
  slope sprint pause <sprint_id>     Pause a running workflow execution
  slope sprint context <sprint_id>   Show current workflow step and remaining work
  slope sprint validate <sprint_id>  Validate workflow, plan, scorecard, and tests
  slope sprint workflow cleanup --stale [--dry-run]         Pause stale completed/superseded executions
  slope sprint skip <id> --step=<s> --reason="..."          Skip a blocking step
`);
}
