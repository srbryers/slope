import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { HookInput, GuardResult, SprintId } from '../../core/index.js';
import {
  findRoadmapSprint,
  formatSprintNumber,
  parseRoadmap,
  roadmapSprintKey,
  sprintIdKey,
  sprintIdsEqual,
} from '../../core/index.js';
import { loadConfig } from '../config.js';
import { shellCommandSegments, commandMatches, type ParsedCommand } from './command-parse.js';
import { loadPrReviewState } from '../pr-review-state.js';
import {
  formatSprintStateDiagnosis,
  gateCompletionCommand,
  isSprintComplete,
  loadSprintState,
  loadSprintStateResult,
  mutateSprintState,
  pendingGateNames,
  pendingGates,
  sprintStatePath,
  updateGate,
} from '../sprint-state.js';
import { resolveRepoSourceCwd } from '../../core/repo-state-scope.js';
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
function checkStaleness(sprint: SprintId, cwd: string): string | null {
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
  // Every `gh pr create` in the invocation is judged in its own checkout: in
  // `gh pr create -R other/x && gh pr create`, the second one must not ride on
  // the first. A denial wins; otherwise the first advisory note is kept.
  let advisory: GuardResult = {};
  for (const commandContext of prCreateCommandContexts(input, cwd)) {
    const result = checkPrCreate(commandContext);
    if (result.decision === 'deny') return result;
    if (Object.keys(advisory).length === 0) advisory = result;
  }
  return advisory;
}

function checkPrCreate(commandContext: PrCreateContext): GuardResult {
  // Everything below describes the checkout the command actually runs in: its
  // sprint evidence, its scorecards, its branch. Never the session's cwd.
  const guardCwd = resolveRepoSourceCwd(commandContext.cwd);

  // `--repo` can aim the PR at a repository this checkout is not a clone of.
  // Its sprint evidence lives in that repository's checkout, which we cannot
  // identify from here, and reading this checkout's file instead would apply
  // an unrelated repository's gates. So: no enforcement, and say why.
  if (commandContext.repo && !checkoutHasRemote(guardCwd, commandContext.repo)) {
    return {
      context: [
        `SLOPE sprint-completion: not enforced. \`gh pr create\` targets ${commandContext.repo}, which is not a remote of the checkout at ${guardCwd}.`,
        'Sprint gates are read from the target repository\'s own checkout; run the command from that checkout to apply them.',
      ].join(' '),
    };
  }

  const loadedState = loadSprintStateResult(guardCwd);
  // Missing, or a planned draft with nothing started: no sprint in progress.
  if (loadedState.status === 'missing' || loadedState.status === 'draft') return {};
  if (loadedState.status === 'corrupt') {
    return {
      decision: 'deny',
      blockReason: [
        'SLOPE sprint-completion: corrupt sprint evidence was preserved; repair it before creating a PR.',
        ...formatSprintStateDiagnosis(loadedState.diagnosis),
      ].join('\n'),
    };
  }
  const state = loadedState.state;
  const evidenceFile = sprintStatePath(guardCwd);
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
      const assessment = inspectSprintRollover(guardCwd, { from: state.sprint, to: branchSprint });
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
        `Sprint evidence file: ${evidenceFile}`,
        `State: Sprint ${formatSprintNumber(state.sprint)} (\`sprint\`); branch suggests Sprint ${branchSprint}.`,
        ...recovery,
      ].join('\n'),
    };
  }
  // Check scorecard existence independently of gates
  const scorecardMissing = !scorecardExists(state.sprint, guardCwd);
  const gatesComplete = isSprintComplete(state);

  if (gatesComplete && !scorecardMissing && !lineageError) return {};

  const staleWarning = checkStaleness(state.sprint, guardCwd);
  // Every denial below names the evidence file it judged, so the operator can
  // open the same file the guard read (#742).
  const lines: string[] = [`Sprint evidence file: ${evidenceFile}`, ''];

  if (lineageError) {
    lines.push(
      `SLOPE sprint-completion: rollover lineage verification failed (\`rollover\`): ${lineageError}`,
      '',
      'The rollover audit must be present on the branch being PR\'d, not only',
      'elsewhere in a branch stack. Record it with `slope sprint rollover`, or',
      'copy the existing audit from docs/retros/rollovers/ onto this branch.',
    );
  }

  if (scorecardMissing) {
    if (lines.length > 2) lines.push('');
    lines.push(
      `SLOPE sprint-completion: Cannot create PR — Sprint ${state.sprint} scorecard not found.`,
      `Expected at: ${scorecardPath(state.sprint, guardCwd)}`,
      '',
      'Create a scorecard and validate it:',
      '  - `slope auto-card` — generate from git + CI signals',
      '  - `slope validate` — validate scorecard (marks gate complete)',
    );
  }

  if (!gatesComplete) {
    const pendingNames = pendingGateNames(state);
    const pending = pendingGates(state);
    if (lines.length > 2) lines.push('');
    lines.push(
      `SLOPE sprint-completion: Sprint ${state.sprint} has incomplete gates:`,
      ...pending.map((label, index) => `  - ${label} (\`gates.${pendingNames[index]}\`)`),
      '',
      'Complete these gates before creating the PR:',
      ...pendingNames.map(gate => `  - ${gateCompletionCommand(gate, state.sprint)}`),
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
  command: ParsedCommand;
}

interface PrCreateContext {
  /** Directory the command runs in, after the tool cwd and any shell `cd`. */
  cwd: string;
  /** Repository named by `-R`/`--repo`/`GH_REPO`, when the PR is aimed at one explicitly. */
  repo?: string;
}

function prCreateCommandContexts(input: HookInput, cwd: string): PrCreateContext[] {
  return commandSegments(input, cwd)
    .flatMap(segment => {
      const args = ghPrCreateArguments(segment.words);
      return args ? [{ cwd: segment.cwd, ...(args.repo ? { repo: args.repo } : {}) }] : [];
    });
}

/** `gh pr create` flags that consume the following word, so it is never read as a flag. */
const GH_PR_CREATE_FLAGS_WITH_VALUE = new Set([
  '-t', '--title', '-b', '--body', '-F', '--body-file', '-B', '--base', '-H', '--head',
  '-r', '--reviewer', '-a', '--assignee', '-l', '--label', '-m', '--milestone',
  '-p', '--project', '-T', '--template', '--recover', '--hostname', '--config',
]);

/**
 * Consume one gh flag exactly once. String values can themselves look like
 * selectors; attached short values end the cluster (`-dt-Rother/thing` is a
 * draft title, whereas `-dRother/thing` selects a repository).
 */
function consumeGhFlag(words: string[], index: number): { next: number; repo?: string } {
  const word = words[index];
  if (word.startsWith('--')) {
    const equals = word.indexOf('=');
    const flag = equals < 0 ? word : word.slice(0, equals);
    if (flag === '--repo' || GH_PR_CREATE_FLAGS_WITH_VALUE.has(flag)) {
      const value = equals < 0 ? words[index + 1] : word.slice(equals + 1);
      return { next: index + (equals < 0 ? 2 : 1), ...(flag === '--repo' ? { repo: value ?? '' } : {}) };
    }
  } else {
    for (let offset = 1; offset < word.length; offset++) {
      const flag = `-${word[offset]}`;
      if (flag !== '-R' && !GH_PR_CREATE_FLAGS_WITH_VALUE.has(flag)) continue;
      const attached = word.slice(offset + 1);
      const value = attached ? attached.replace(/^=/, '') : words[index + 1];
      return { next: index + (attached ? 1 : 2), ...(flag === '-R' ? { repo: value ?? '' } : {}) };
    }
  }
  return { next: index + 1 };
}

/** Recognition and repo selection share value consumption and prefix handling. */
function ghPrCreateArguments(words: string[]): { repo: string | null } | null {
  const prefix = commandPrefix(words, 0);
  if (words[prefix.index] !== 'gh') return null;
  let repo: string | undefined;
  let flags = true;
  const commands: string[] = [];
  let i = prefix.index + 1;
  for (; i < words.length; i++) {
    const word = words[i];
    if (flags && word === '--') {
      flags = false;
    } else if (flags && word.startsWith('-')) {
      const flag = consumeGhFlag(words, i);
      if (flag.repo !== undefined) repo = flag.repo;
      i = flag.next - 1;
    } else {
      commands.push(word);
    }
  }
  if (commands[0] !== 'pr' || !['create', 'new'].includes(commands[1])) return null;
  // An empty explicit selector falls back to GH_REPO, as gh does.
  return { repo: repo || prefix.ghRepo };
}

/** `owner/repo` (lowercase) and host from a remote URL or a `gh` repo selector. */
function parseRepoReference(reference: string): { host?: string; slug: string } | null {
  const text = reference.trim().replace(/\/+$/, '').replace(/\.git$/, '');
  const url = text.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+\/[^/]+)$/i)
    ?? text.match(/^(?:[^@/:]+@)?([^/:]+):([^/]+\/[^/]+)$/);
  if (url) return { host: url[1].toLowerCase(), slug: url[2].toLowerCase() };
  const parts = text.split('/');
  if (parts.length === 2 && parts.every(Boolean)) return { slug: text.toLowerCase() };
  if (parts.length === 3 && parts.every(Boolean)) return { host: parts[0].toLowerCase(), slug: `${parts[1]}/${parts[2]}`.toLowerCase() };
  return null;
}

/** True when some git remote of the checkout at `cwd` is the repository `repo` names. */
function checkoutHasRemote(cwd: string, repo: string): boolean {
  const target = parseRepoReference(repo);
  if (!target) return false;
  let urls: string[];
  try {
    urls = execFileSync('git', ['config', '--get-regexp', '^remote\\..*\\.url$'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).split('\n').map(line => line.replace(/^\S+\s+/, '')).filter(Boolean);
  } catch {
    return false;
  }
  return urls.some(url => {
    const remote = parseRepoReference(url);
    return remote !== null && remote.slug === target.slug && (!target.host || target.host === remote.host);
  });
}

function commandSegments(input: HookInput, cwd: string): ShellCommandSegment[] {
  const command = commandText(input);
  if (!command) return [];

  const segments: ShellCommandSegment[] = [];
  let commandCwd = toolInputCwd(input, cwd);
  // shellCommandSegments skips heredoc bodies. The previous splitter did not,
  // so a heredoc line reading `gh pr merge …` was treated as a real merge and
  // this guard rewrote .slope/sprint-state.json from document prose (#683).
  for (const { text: segment, words, command: parsed } of shellCommandSegments(command)) {
    if (words.length === 0) continue;

    const cdTarget = cdCommandTarget(words);
    if (cdTarget) {
      commandCwd = resolveCommandCwd(commandCwd, cdTarget);
      continue;
    }

    segments.push({ cwd: commandCwd, segment, words, command: parsed });
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

/** `slope review <these>` manage review state; they do not generate the
 *  review markdown, so they must not satisfy the review_md gate. */
const REVIEW_STATE_SUBCOMMANDS = new Set([
  'start', 'round', 'status', 'reset', 'recommend',
  'findings', 'amend', 'defer', 'deferred', 'resolve', 'run',
]);

/** Test runners whose success marks the `tests` gate. */
const TEST_RUNNERS = new Set(['jest', 'vitest']);

/** True when `words` invokes a test runner, ignoring the runner prefix
 *  (`npx vitest`, `pnpm test`) and any `bun test` / `<pm> test` spelling. */
function isTestRunnerCommand(words: string[]): boolean {
  let i = skipCommandPrefix(words, 0);
  if (words[i] === 'npx' || words[i] === 'bunx') i++;
  else if (['pnpm', 'npm', 'yarn', 'bun'].includes(words[i] ?? '')) {
    i++;
    if (words[i] === 'run' || words[i] === 'exec') i++;
    if (words[i] === 'test') return true;
  }
  return TEST_RUNNERS.has(words[i] ?? '');
}

/** Index of the `slope` subcommand within `words`, or -1 when the command is
 *  not a slope invocation. Handles the runner spellings the CLI is reached
 *  through: `slope`, `npx slope`, `pnpm exec slope`, `env FOO=1 slope`. */
function skipSlopeExecutable(words: string[]): number {
  let i = skipCommandPrefix(words, 0);
  if (words[i] === 'npx' || words[i] === 'bunx') i++;
  else if (['pnpm', 'npm', 'yarn', 'bun'].includes(words[i] ?? '')) {
    i++;
    if (words[i] === 'exec' || words[i] === 'run') i++;
  }
  if (words[i] !== 'slope') return -1;
  return i + 1;
}

function skipCommandPrefix(words: string[], start: number): number {
  return commandPrefix(words, start).index;
}

/** Literal assignments and env wrappers, shared by recognition and GH_REPO selection. */
function commandPrefix(words: string[], start: number): { index: number; ghRepo: string | null } {
  let i = start;
  let ghRepo: string | null = null;
  while (i < words.length) {
    while (isEnvAssignment(words[i])) {
      if (words[i].startsWith('GH_REPO=')) ghRepo = words[i].slice('GH_REPO='.length) || null;
      i++;
    }
    if (words[i] === 'command') {
      i++;
      if (words[i] === '--') i++;
    } else if (words[i] === 'env') {
      i++;
      while (words[i]?.startsWith('-')) {
        const flag = words[i];
        if (flag === '--') { i++; break; }
        if (flag === '-i' || flag === '--ignore-environment') {
          ghRepo = null;
          i++;
        } else if (flag === '-u' || flag === '--unset') {
          if (words[i + 1] === 'GH_REPO') ghRepo = null;
          i += 2;
        } else if (flag.startsWith('--unset=')) {
          if (flag.slice('--unset='.length) === 'GH_REPO') ghRepo = null;
          i++;
        } else {
          break;
        }
      }
    } else {
      break;
    }
  }
  return { index: i, ghRepo };
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

/** Absolute path where the scorecard for the given sprint is expected. */
function scorecardPath(sprint: SprintId, cwd: string): string {
  const config = loadConfig(cwd);
  const pattern = config.scorecardPattern.replaceAll('*', String(sprint));
  return join(cwd, config.scorecardDir, pattern);
}

/** Check if a scorecard file exists for the given sprint. */
function scorecardExists(sprint: SprintId, cwd: string): boolean {
  return existsSync(scorecardPath(sprint, cwd));
}

/** Auto-detect test pass, validate success, and PR merge from Bash output. */
function handlePostToolUse(input: HookInput, cwd: string): GuardResult {
  const segments = commandSegments(input, cwd);
  if (segments.length === 0) return {};

  // These transitions WRITE state (sprint phase, roadmap, gates), so they
  // match on argv words rather than segment text: a quoted argument or a
  // heredoc body naming a command must never advance the sprint (#683).
  const isSlopeSubcommand = (words: string[], subcommand: string): boolean => {
    const i = skipSlopeExecutable(words);
    return i !== -1 && words[i] === subcommand;
  };

  // Detect PR merge → transition to scoring phase
  const prMergeCommand = segments.find(({ command }) =>
    commandMatches(command, ['gh', 'pr', 'merge'], { skipGhGlobalFlags: true }),
  );
  if (prMergeCommand) {
    return handlePrMerge(input, prMergeCommand.cwd);
  }

  // Detect slope validate success → auto-update roadmap
  const validateCommand = segments.find(({ words }) => isSlopeSubcommand(words, 'validate'));
  if (validateCommand) {
    return handleValidateSuccess(input, validateCommand.cwd);
  }

  // Detect slope review completion → mark review_md gate
  const reviewCommand = segments.find(({ words }) => {
    if (!isSlopeSubcommand(words, 'review')) return false;
    const next = words[skipSlopeExecutable(words) + 1];
    return next === undefined || !REVIEW_STATE_SUBCOMMANDS.has(next);
  });
  if (reviewCommand) {
    return handleReviewCompletion(input, reviewCommand.cwd, reviewCommand.segment, reviewCommand.words);
  }

  // Detect slope auto-card completion → suggest validate next
  const autoCardCommand = segments.find(({ words }) => isSlopeSubcommand(words, 'auto-card'));
  if (autoCardCommand) {
    return handleAutoCardCompletion(input, autoCardCommand.cwd);
  }

  // Word-matched for the same reason as the transitions above: updateGate is
  // a state write, and `tests` is one of the gates handlePreToolUse checks
  // before allowing `gh pr create`. Matching the raw text let an issue body
  // mentioning vitest satisfy a PR gate.
  const testCommand = segments.find(({ words }) => isTestRunnerCommand(words));
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
    const parsed = parseRoadmap(raw).roadmap;
    if (!parsed) return {};

    const parsedSprint = findRoadmapSprint(parsed, state.sprint);
    if (!parsedSprint) return {};
    const sprintKey = roadmapSprintKey(parsed, parsedSprint);
    const sprintIndex = parsed.sprints.indexOf(parsedSprint);
    const sprint = raw.sprints[sprintIndex];
    if (!sprint || sprint.status === 'complete') return {};

    sprint.status = 'complete';

    // Also update phase status if all sprints in a phase are now complete
    if (Array.isArray(raw.phases)) {
      for (let phaseIndex = 0; phaseIndex < parsed.phases.length; phaseIndex++) {
        const parsedPhase = parsed.phases[phaseIndex];
        const phaseKeys = (parsedPhase.sprint_keys ?? parsedPhase.sprints.map(String))
          .map(id => findRoadmapSprint(parsed, id))
          .filter((row): row is NonNullable<typeof row> => row !== undefined)
          .map(row => roadmapSprintKey(parsed, row));
        if (!phaseKeys.includes(sprintKey)) continue;
        const allComplete = phaseKeys.every(key => {
          const row = findRoadmapSprint(parsed, key);
          if (!row) return false;
          return raw.sprints[parsed.sprints.indexOf(row)]?.status === 'complete';
        });
        const phase = raw.phases[phaseIndex];
        if (allComplete && phase?.status !== 'complete') {
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

/** Which sprint a `slope review` invocation targeted, or null when it cannot
 *  be determined. Parses the same selector forms `parseReviewArgs` accepts —
 *  `--sprint=N`, `--sprint N` and a bare positional `N` — since #689 added the
 *  latter two and a bare number was otherwise read as a scorecard path,
 *  leaving the review_md gate unmarked. */
function reviewTargetSprint(words: string[], cwd: string): string | null {
  const args = words.slice(skipSlopeExecutable(words) + 1);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--sprint=')) return sprintIdKey(arg.slice('--sprint='.length));
    if (arg === '--sprint' && args[i + 1] != null) return sprintIdKey(args[i + 1]);
  }

  // A bare positional that looks like a sprint is a selector, not a path.
  const positional = args.find(arg => !arg.startsWith('-'));
  if (positional && /^S?\d+(?:\.\d+)?$/i.test(positional)) return sprintIdKey(positional);

  const path = positional;
  if (!path) return null;

  try {
    const raw = JSON.parse(readFileSync(isAbsolute(path) ? path : resolve(cwd, path), 'utf8'));
    return sprintIdKey(String(raw.sprint_number ?? ''));
  } catch {
    return null;
  }
}

/** Detect `slope review` completion → mark review_md gate. */
function handleReviewCompletion(input: HookInput, cwd: string, segment: string, words: string[]): GuardResult {
  const response = input.tool_response ?? {};
  const exitCode = response.exit_code ?? response.exitCode;
  if (exitCode !== 0 && exitCode !== '0') return {};

  const state = loadSprintState(cwd);
  if (!state) return {};

  const targetSprint = reviewTargetSprint(words, cwd);
  if (targetSprint != null && !sprintIdsEqual(targetSprint, state.sprint)) {
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

function missingPrReviewWarning(cwd: string, sprint: SprintId): string | null {
  const branch = currentBranch(cwd);
  const reviews = loadPrReviewState(cwd).reviews;
  const matching = reviews.filter(review =>
    (review.sprint !== undefined && sprintIdsEqual(review.sprint, sprint))
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
