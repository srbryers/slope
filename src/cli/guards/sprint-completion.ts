import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { HookInput, GuardResult } from '../../core/index.js';
import { formatSprintNumber, parseSprintNumber, sprintIdsEqual, sprintIdToNumber } from '../../core/index.js';
import { loadConfig } from '../config.js';
import { loadPrReviewState } from '../pr-review-state.js';
import { loadSprintState, loadSprintStateResult, mutateSprintState, updateGate, isSprintComplete, pendingGates } from '../sprint-state.js';
import { inspectSprintRollover, verifySprintRolloverLineage } from '../sprint-rollover.js';
import { inferSprintFromBranch } from '../workflow-resync.js';

/**
 * Sprint-completion guard: enforces post-implementation gates.
 *
 * Single handler, three hook points (branches on hook_event_name):
 * - PreToolUse:Bash — blocks `gh pr create` if gates incomplete
 * - Stop — blocks session end if mid-sprint with incomplete gates
 * - PostToolUse:Bash — auto-detects test pass and marks gate
 */
export async function sprintCompletionGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  const event = input.hook_event_name;

  if (event === 'PreToolUse') {
    return handlePreToolUse(input, cwd);
  }

  if (event === 'Stop') {
    return handleStop(cwd);
  }

  if (event === 'PostToolUse') {
    return handlePostToolUse(input, cwd);
  }

  return {};
}

/** Check if sprint-state matches the current branch. Returns a warning string or null. */
function checkStaleness(sprint: number, cwd: string): string | null {
  try {
    const branch = currentBranch(cwd);
    if (branch) {
      const branchSprint = inferSprintFromBranch(cwd);
      if (branchSprint !== null && !sprintIdsEqual(branchSprint, sprint)) {
        return `Warning: sprint-state is for Sprint ${formatSprintNumber(sprint)} but branch "${branch}" suggests Sprint ${branchSprint}. Use audited sprint rollover; do not reset away the prior state.`;
      }
    }
    // No sprint number in branch name — can't verify, don't warn
  } catch {
    // git not available — skip check
  }
  return null;
}

/** Block `gh pr create` when gates are incomplete or scorecard is missing. */
function handlePreToolUse(input: HookInput, cwd: string): GuardResult {
  const commandContext = prCreateCommandContext(input, cwd);
  if (!commandContext) return {};
  const guardCwd = commandContext.cwd;

  const loadedState = loadSprintStateResult(guardCwd);
  if (loadedState.status === 'missing') return {};
  if (loadedState.status === 'corrupt') {
    return {
      decision: 'deny',
      blockReason: 'SLOPE sprint-completion: corrupt sprint evidence was preserved; repair it before creating a PR.',
    };
  }
  const state = loadedState.state;
  // Collected rather than returned immediately: a branch can be missing the
  // lineage audit *and* the scorecard, and reporting one at a time cost a round
  // trip each with differently-worded refusals (GH #641).
  let lineageError: string | null = null;
  try {
    verifySprintRolloverLineage(guardCwd, state);
  } catch (error) {
    lineageError = (error as Error).message;
  }
  const branchSprint = inferSprintFromBranch(guardCwd);
  if (branchSprint !== null && !sprintIdsEqual(branchSprint, state.sprint)) {
    let recovery: string[];
    try {
      const branchSprintNumber = sprintIdToNumber(branchSprint);
      if (branchSprintNumber === null) {
        throw new Error(`Sprint ${branchSprint} cannot be represented by the legacy numeric sprint-state rollover contract.`);
      }
      const assessment = inspectSprintRollover(guardCwd, { from: state.sprint, to: branchSprintNumber });
      const blockers = assessment.issues.filter(issue => issue.code !== 'from_not_terminal');
      if (blockers.length === 0) {
        const base = `slope sprint rollover --from=${assessment.from_label.slice(1)} --to=${assessment.to_label.slice(1)}`;
        recovery = [
          `Record the handoff with: \`${assessment.from_terminal ? base : `${base} --force --reason="<why>"`}\``,
        ];
      } else {
        recovery = [
          'Rollover is not currently eligible:',
          ...blockers.slice(0, 3).map(issue => `  - ${issue.message}`),
          ...(blockers.length > 3 ? [`  - … ${blockers.length - 3} additional issue(s) omitted`] : []),
        ];
      }
    } catch (error) {
      recovery = [`Rollover eligibility could not be verified: ${(error as Error).message}`];
    }
    return {
      decision: 'deny',
      blockReason: [
        'SLOPE sprint-completion: branch and sprint-state disagree; refusing automatic rebind.',
        `State: Sprint ${formatSprintNumber(state.sprint)}; branch suggests Sprint ${branchSprint}.`,
        ...recovery,
      ].join('\n'),
    };
  }
  // Check scorecard existence independently of gates
  const scorecardMissing = !scorecardExists(state.sprint, guardCwd);
  const gatesComplete = isSprintComplete(state);

  if (gatesComplete && !scorecardMissing && !lineageError) return {};

  const staleWarning = checkStaleness(state.sprint, guardCwd);
  const lines: string[] = [];

  if (lineageError) {
    lines.push(
      `SLOPE sprint-completion: rollover lineage verification failed: ${lineageError}`,
      '',
      'The rollover audit must be present on the branch being PR\'d, not only',
      'elsewhere in a branch stack. Record it with `slope sprint rollover`, or',
      'copy the existing audit from docs/retros/rollovers/ onto this branch.',
    );
  }

  if (scorecardMissing) {
    if (lines.length > 0) lines.push('');
    lines.push(
      `SLOPE sprint-completion: Cannot create PR — Sprint ${state.sprint} scorecard not found.`,
      '',
      'Create a scorecard and validate it:',
      '  - `slope auto-card` — generate from git + CI signals',
      '  - `slope validate` — validate scorecard (marks gate complete)',
    );
  }

  if (!gatesComplete) {
    const pending = pendingGates(state);
    if (lines.length > 0) lines.push('');
    lines.push(
      `SLOPE sprint-completion: Sprint ${state.sprint} has incomplete gates:`,
      ...pending.map(g => `  - ${g}`),
      '',
      'Complete these gates before creating the PR.',
    );
    if (pending.some(g => g === 'Code review' || g === 'Architect review')) {
      lines.push('', ...reviewGateEvidenceInstructions());
    }
  }

  if (staleWarning) lines.push('', staleWarning);
  return {
    decision: 'deny',
    blockReason: lines.join('\n'),
  };
}

interface ShellCommandSegment {
  cwd: string;
  segment: string;
  words: string[];
}

function prCreateCommandContext(input: HookInput, cwd: string): { cwd: string } | null {
  const segment = commandSegments(input, cwd).find(({ words }) => isGhPrCreateCommand(words));
  return segment ? { cwd: segment.cwd } : null;
}

function commandSegments(input: HookInput, cwd: string): ShellCommandSegment[] {
  const command = commandText(input);
  if (!command) return [];

  const segments: ShellCommandSegment[] = [];
  let commandCwd = toolInputCwd(input, cwd);
  for (const segment of splitShellSegments(command)) {
    const words = tokenizeShellWords(segment);
    if (words.length === 0) continue;

    const cdTarget = cdCommandTarget(words);
    if (cdTarget) {
      commandCwd = resolveCommandCwd(commandCwd, cdTarget);
      continue;
    }

    segments.push({ cwd: commandCwd, segment, words });
  }

  return segments;
}

function commandText(input: HookInput): string {
  const toolInput = input.tool_input;
  if (!toolInput || typeof toolInput !== 'object') return '';
  for (const key of ['command', 'cmd', 'input']) {
    const value = toolInput[key];
    if (typeof value === 'string') return value;
  }
  return '';
}

function toolInputCwd(input: HookInput, cwd: string): string {
  const toolInput = input.tool_input;
  if (!toolInput || typeof toolInput !== 'object') return cwd;
  for (const key of ['workdir', 'cwd']) {
    const value = toolInput[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return resolveCommandCwd(cwd, value.trim());
    }
  }
  return cwd;
}

function resolveCommandCwd(baseCwd: string, target: string): string {
  const expanded = expandHomePath(target);
  return isAbsolute(expanded) ? expanded : resolve(baseCwd, expanded);
}

function expandHomePath(target: string): string {
  if (target === '~') return homedir();
  if (target.startsWith('~/')) return join(homedir(), target.slice(2));
  return target;
}

function cdCommandTarget(words: string[]): string | null {
  const start = skipCommandPrefix(words, 0);
  if (words[start] !== 'cd') return null;

  let targetIndex = start + 1;
  if (words[targetIndex] === '--') targetIndex++;
  const target = words[targetIndex];
  if (!target || target === '-') return null;
  return target;
}

function isGhPrCreateCommand(words: string[]): boolean {
  let i = skipCommandPrefix(words, 0);
  if (words[i] !== 'gh') return false;
  i++;

  i = skipGhGlobalFlags(words, i);
  return words[i] === 'pr' && words[i + 1] === 'create';
}

const GH_GLOBAL_FLAGS_WITH_VALUE = new Set([
  '-R',
  '--repo',
  '--hostname',
  '--config',
]);

function skipGhGlobalFlags(words: string[], start: number): number {
  let i = start;
  while (words[i]?.startsWith('-')) {
    const flag = words[i];
    if (flag === '--') return i + 1;
    if (flag.includes('=')) {
      i++;
    } else if (GH_GLOBAL_FLAGS_WITH_VALUE.has(flag)) {
      i += 2;
    } else {
      i++;
    }
  }
  return i;
}

function splitShellSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (char === '\\' && quote !== "'") {
      current += char;
      if (i + 1 < command.length) current += command[++i];
      continue;
    }
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      current += char;
      continue;
    }
    if (!quote && (char === ';' || char === '\n' || char === '&' || char === '|')) {
      if (current.trim()) segments.push(current.trim());
      current = '';
      if ((char === '&' && command[i + 1] === '&') || (char === '|' && command[i + 1] === '|')) i++;
      continue;
    }
    current += char;
  }

  if (current.trim()) segments.push(current.trim());
  return segments;
}

function tokenizeShellWords(segment: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < segment.length; i++) {
    const char = segment[i];
    if (char === '\\' && quote !== "'") {
      const next = segment[i + 1];
      if (next && isEscapedShellChar(next)) {
        current += next;
        i++;
      } else {
        current += char;
      }
      continue;
    }
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      continue;
    }
    if (!quote && /\s/.test(char)) {
      if (current) {
        words.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (current) words.push(current);
  return words;
}

function isEscapedShellChar(char: string): boolean {
  return ['\\', '"', "'", ' ', '$', '`', '&', '|', ';', '\n', '\r'].includes(char);
}

function skipCommandPrefix(words: string[], start: number): number {
  let i = start;
  if (words[i] === 'env') i++;
  while (isEnvAssignment(words[i])) i++;
  if (words[i] === 'command') i++;
  return i;
}

function isEnvAssignment(word: string | undefined): boolean {
  return !!word && /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);
}

/** Warn at session end when mid-sprint with incomplete gates or missing scorecard.
 *  Advisory (context), not blocking — avoids trapping ad-hoc sessions that inherit
 *  sprint state from a previous session. */
function handleStop(cwd: string): GuardResult {
  const state = loadSprintState(cwd);
  if (!state) return {};

  // Warn during active/terminal workflow phases; planning/reviewing remain advisory-free.
  if (state.phase !== 'implementing' && state.phase !== 'scoring' && state.phase !== 'complete') return {};

  const scorecardMissing = !scorecardExists(state.sprint, cwd);
  const gatesComplete = isSprintComplete(state);

  if (gatesComplete && !scorecardMissing) return {};

  const staleWarning = checkStaleness(state.sprint, cwd);
  const lines: string[] = [];

  if (scorecardMissing) {
    lines.push(
      `SLOPE sprint-completion: Sprint ${state.sprint} scorecard not found.`,
      '',
      'Create a scorecard before ending the session:',
      '  - `slope auto-card` — generate from git + CI signals',
      '  - `slope validate` — validate scorecard (marks gate complete)',
    );
  }

  if (!gatesComplete) {
    const pending = pendingGates(state);
    if (lines.length > 0) lines.push('');
    lines.push(
      `SLOPE sprint-completion: Sprint ${state.sprint} is incomplete. Remaining gates:`,
      ...pending.map(g => `  - ${g}`),
      '',
      'Complete these before ending the session:',
      '  - `slope sprint gate tests` — mark tests passing',
      '  - `slope sprint gate code_review --reviewer=<id> --evidence=<path-or-url>` - record independent code review',
      '  - `slope sprint gate architect_review --reviewer=<id> --evidence=<path-or-url>` - record independent architect review',
      '  - `slope sprint gate code_review --pr-review=<url-or-id>` - record PR review evidence',
      '  - `slope sprint gate code_review --self-review --reason="..."` - explicit weaker self-review',
      '  - `slope sprint gate code_review --waive-independent-review --reason="..."` - explicitly waive a required independent review',
      '  - `slope sprint gate code_review --override="manual override reason"` - explicit manual override',
      '  - `slope validate` — validates scorecard (auto-marks gate)',
      `  - \`slope review --sprint=${state.sprint}\` — generates review markdown (auto-marks gate)`,
      '',
      'For abandoned work, use audited `slope sprint rollover --force --reason="..."`; reset is destructive emergency recovery and discards state evidence.',
    );
  }

  if (staleWarning) lines.push('', staleWarning);
  // Advisory context, not a hard block — ad-hoc sessions shouldn't be trapped
  // by sprint state left from a previous session.
  return { context: lines.join('\n') };
}

function reviewGateEvidenceInstructions(): string[] {
  return [
    'Review gates require explicit provenance:',
    '  - `slope sprint gate code_review --reviewer=<id> --evidence=<path-or-url>`',
    '  - `slope sprint gate architect_review --reviewer=<id> --evidence=<path-or-url>`',
    '  - `slope sprint gate code_review --pr-review=<url-or-id>`',
    '  - `slope sprint gate code_review --self-review --reason="..."`',
    '  - `slope sprint gate code_review --waive-independent-review --reason="..."`',
    '  - `slope sprint gate code_review --override="manual override reason"`',
  ];
}

/** Check if a scorecard file exists for the given sprint. */
function scorecardExists(sprint: number, cwd: string): boolean {
  const config = loadConfig(cwd);
  const pattern = config.scorecardPattern.replaceAll('*', String(sprint));
  const scorecardPath = join(cwd, config.scorecardDir, pattern);
  return existsSync(scorecardPath);
}

/** Auto-detect test pass, validate success, and PR merge from Bash output. */
function handlePostToolUse(input: HookInput, cwd: string): GuardResult {
  const segments = commandSegments(input, cwd);
  if (segments.length === 0) return {};

  // Detect PR merge → transition to scoring phase
  const prMergeCommand = segments.find(({ segment }) => /gh\s+pr\s+merge/.test(segment));
  if (prMergeCommand) {
    return handlePrMerge(input, prMergeCommand.cwd);
  }

  // Detect slope validate success → auto-update roadmap
  const validateCommand = segments.find(({ segment }) => /\bslope\s+validate\b/.test(segment));
  if (validateCommand) {
    return handleValidateSuccess(input, validateCommand.cwd);
  }

  // Detect slope review completion → mark review_md gate
  const reviewCommand = segments.find(({ segment }) =>
    /\bslope\s+review\b/.test(segment)
    && !/\bslope\s+review\s+(start|round|status|reset|recommend|findings|amend|defer|deferred|resolve)\b/.test(segment),
  );
  if (reviewCommand) {
    return handleReviewCompletion(input, reviewCommand.cwd, reviewCommand.segment);
  }

  // Detect slope auto-card completion → suggest validate next
  const autoCardCommand = segments.find(({ segment }) => /\bslope\s+auto-card\b/.test(segment));
  if (autoCardCommand) {
    return handleAutoCardCompletion(input, autoCardCommand.cwd);
  }

  // Check if command looks like a test runner
  const testCommand = segments.find(({ segment }) => /\b(jest|vitest|bun\s+test|npx\s+jest|npx\s+vitest)\b/.test(segment));
  if (!testCommand) return {};

  const state = loadSprintState(testCommand.cwd);
  if (!state) return {};
  if (state.gates.tests) return {}; // Already marked

  // Check exit code — tool_response for Bash includes exit_code or stdout
  const response = input.tool_response ?? {};
  const exitCode = response.exit_code ?? response.exitCode;

  // If exit code is explicitly 0, or if stdout contains pass indicators without failures
  if (exitCode === 0 || exitCode === '0') {
    updateGate(testCommand.cwd, 'tests', true);
    return { context: 'SLOPE: Tests passed — gate marked complete.' };
  }

  return {};
}

/** Auto-update roadmap status when `slope validate` succeeds. */
function handleValidateSuccess(input: HookInput, cwd: string): GuardResult {
  const response = input.tool_response ?? {};
  const exitCode = response.exit_code ?? response.exitCode;
  if (exitCode !== 0 && exitCode !== '0') return {};

  const state = loadSprintState(cwd);
  if (!state) return {};

  if (existsSync(join(cwd, 'docs', 'roadmap', 'project.yaml'))) {
    return {
      context: `SLOPE: Scorecard validated. Modular roadmap sources are authoritative - reconcile with \`slope roadmap complete --sprint=${state.sprint}\` if validate did not already update the source; it updates source YAML and runs roadmap compile.`,
    };
  }

  const config = loadConfig(cwd);
  const roadmapPath = join(cwd, config.roadmapPath);
  if (!existsSync(roadmapPath)) return {};

  try {
    const raw = JSON.parse(readFileSync(roadmapPath, 'utf8'));
    if (!raw || !Array.isArray(raw.sprints)) return {};

    const sprint = raw.sprints.find((s: { id: number }) => s.id === state.sprint);
    if (!sprint || sprint.status === 'complete') return {};

    sprint.status = 'complete';

    // Also update phase status if all sprints in a phase are now complete
    if (Array.isArray(raw.phases)) {
      for (const phase of raw.phases) {
        if (!Array.isArray(phase.sprints) || !phase.sprints.includes(state.sprint)) continue;
        const allComplete = phase.sprints.every((sid: number) => {
          const s = raw.sprints.find((sp: { id: number }) => sp.id === sid);
          return s?.status === 'complete';
        });
        if (allComplete && phase.status !== 'complete') {
          phase.status = 'complete';
        }
      }
    }

    writeFileSync(roadmapPath, JSON.stringify(raw, null, 2) + '\n');
    return { context: `SLOPE: Updated roadmap — Sprint ${state.sprint} → complete` };
  } catch {
    return {};
  }
}

function reviewTargetSprint(segment: string, cwd: string): number | null {
  const selector = segment.match(/--sprint(?:=|\s+)(S?\d+(?:\.\d+)?)/i)?.[1];
  if (selector) return parseSprintNumber(selector);

  const pathMatch = segment.match(/\bslope\s+review\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/);
  const path = pathMatch?.[1] ?? pathMatch?.[2] ?? pathMatch?.[3];
  if (!path || path.startsWith('-')) return null;

  try {
    const raw = JSON.parse(readFileSync(isAbsolute(path) ? path : resolve(cwd, path), 'utf8'));
    return parseSprintNumber(String(raw.sprint_number ?? ''));
  } catch {
    return null;
  }
}

/** Detect `slope review` completion → mark review_md gate. */
function handleReviewCompletion(input: HookInput, cwd: string, segment: string): GuardResult {
  const response = input.tool_response ?? {};
  const exitCode = response.exit_code ?? response.exitCode;
  if (exitCode !== 0 && exitCode !== '0') return {};

  const state = loadSprintState(cwd);
  if (!state) return {};

  const targetSprint = reviewTargetSprint(segment, cwd);
  if (targetSprint != null && targetSprint !== state.sprint) {
    return {
      context: `SLOPE: Historical Sprint ${formatSprintNumber(targetSprint)} review generated — active Sprint ${formatSprintNumber(state.sprint)} review gate unchanged.`,
    };
  }
  if (targetSprint == null && !state.gates.review_md) {
    return {
      context: 'SLOPE: Review command completed without a verifiable sprint target — active review gate unchanged.',
    };
  }

  if (!state.gates.review_md) updateGate(cwd, 'review_md', true);
  const lines = [state.gates.review_md
    ? 'SLOPE: Review generated — gate was already complete.'
    : 'SLOPE: Review generated — gate marked complete.'];
  const prReviewWarning = missingPrReviewWarning(cwd, state.sprint);
  if (prReviewWarning) lines.push('', prReviewWarning);
  return { context: lines.join('\n') };
}

function missingPrReviewWarning(cwd: string, sprint: number): string | null {
  const branch = currentBranch(cwd);
  const reviews = loadPrReviewState(cwd).reviews;
  const matching = reviews.filter(review =>
    review.sprint === sprint
    || (branch && review.branch === branch),
  );

  const closeoutPending = matching.find(review =>
    review.status === 'reviewed' && review.closeout_status !== 'settled',
  );
  if (closeoutPending) {
    return [
      'SLOPE PR closeout: PR implementation review is recorded, but review/check settlement is still pending.',
      `Run \`slope pr status --pr=${closeoutPending.pr} --sprint=${sprint}\` after checks and review threads settle before presenting PR #${closeoutPending.pr} as ready.`,
    ].join(' ');
  }
  if (matching.some(review => review.status === 'reviewed')) return null;
  const pending = matching.find(review => review.status === 'pending');
  const target = pending ? `PR #${pending.pr}` : 'the current branch PR';
  return [
    'SLOPE PR closeout: sprint retrospective review is not PR implementation review.',
    `Run \`slope pr status --sprint=${sprint}\` and \`slope pr review${pending ? ` --pr=${pending.pr}` : ''} --sprint=${sprint}\` before presenting ${target} as ready.`,
  ].join(' ');
}

function currentBranch(cwd: string): string | undefined {
  try {
    return execSync('git branch --show-current', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Detect `slope auto-card` completion → suggest validate next. */
function handleAutoCardCompletion(input: HookInput, cwd: string): GuardResult {
  const response = input.tool_response ?? {};
  const exitCode = response.exit_code ?? response.exitCode;
  if (exitCode !== 0 && exitCode !== '0') return {};

  const state = loadSprintState(cwd);
  if (!state) return {};

  return { context: 'SLOPE: Scorecard generated. Run `slope validate` to verify and mark the scorecard gate complete.' };
}

/** Transition sprint to scoring phase after PR merge. */
function handlePrMerge(input: HookInput, cwd: string): GuardResult {
  const state = loadSprintState(cwd);
  if (!state) return {};
  if (state.phase === 'scoring' || state.phase === 'complete') return {};

  // Check merge succeeded (exit code 0)
  const response = input.tool_response ?? {};
  const exitCode = response.exit_code ?? response.exitCode;
  if (exitCode !== 0 && exitCode !== '0' && exitCode !== undefined) return {};

  const updated = mutateSprintState(cwd, current => {
    if (current.phase === 'scoring' || current.phase === 'complete') return false;
    current.phase = 'scoring';
    return true;
  });
  if (!updated) return {};

  const pending = pendingGates(updated);
  return {
    context: [
      `SLOPE: PR merged — sprint phase is now 'scoring'. Remaining gates:`,
      ...pending.map(g => `  - ${g}`),
      '',
      'Complete these before ending the session:',
      '  1. Create scorecard → `slope validate`',
      `  2. Generate review → \`slope review --sprint=${state.sprint}\``,
    ].join('\n'),
  };
}
