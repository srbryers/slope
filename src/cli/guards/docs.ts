// Guard Documentation — extended per-guard documentation for `slope guard docs`

export interface GuardDoc {
  /** What problem this guard solves */
  purpose: string;
  /** Hook event + matcher (what tools/actions fire it) */
  triggers: string;
  /** What it does when fired (block vs advisory vs context injection) */
  behavior: string;
  /** How to enable/disable, relevant config.json fields */
  configuration: string;
  /** Which --level installs it */
  level: 'scoring' | 'full';
}

export const GUARD_DOCS: Record<string, GuardDoc> = {
  explore: {
    purpose: 'Prevents unnecessary deep codebase exploration when a codebase map (CODEBASE.md) exists. Reminds the agent to check the map before reading files or searching.',
    triggers: 'PreToolUse on Read, Glob, Grep. Fires when the agent tries to read or search files.',
    behavior: 'Advisory — injects a context reminder suggesting the agent read CODEBASE.md or use `search({ module: \'map\' })` before exploring. Does not block.',
    configuration: 'guidance.indexPaths in config.json controls which index files to check for. Disable: add "explore" to guidance.disabled.',
    level: 'full',
  },
  hazard: {
    purpose: 'Warns about known issues and recurring patterns in file areas being edited. Prevents the agent from repeating past mistakes.',
    triggers: 'PreToolUse on Edit, Write. Fires when the agent is about to modify a file.',
    behavior: 'Advisory — injects context with relevant hazards from common-issues.json and recent scorecard hazards for the file area being edited.',
    configuration: 'guidance.hazardRecency (default: 5) controls how many sprints back to look for hazards. Disable: add "hazard" to guidance.disabled.',
    level: 'full',
  },
  'commit-nudge': {
    purpose: 'Nudges the agent to commit after prolonged editing. Prevents lost work from uncommitted changes.',
    triggers: 'PostToolUse on Edit, Write. Fires after a file modification completes.',
    behavior: 'Advisory — injects a commit reminder when the time since last commit exceeds the configured interval. Does not block.',
    configuration: 'guidance.commitInterval (default: 15 minutes) controls the nudge threshold. Disable: add "commit-nudge" to guidance.disabled.',
    level: 'full',
  },
  'scope-drift': {
    purpose: 'Warns when the agent edits files outside the claimed ticket scope. Keeps work focused and prevents unintended changes.',
    triggers: 'PreToolUse on Edit, Write. Fires when a file modification is attempted.',
    behavior: 'Advisory — if the file being edited is outside the current ticket\'s claimed scope (from `slope claim`), injects a warning. Does not block.',
    configuration: 'guidance.scopeDrift (default: true) enables/disables. Disable: add "scope-drift" to guidance.disabled.',
    level: 'full',
  },
  compaction: {
    purpose: 'Extracts session events before Claude Code compacts context. Preserves sprint data that would otherwise be lost during context compression.',
    triggers: 'PreCompact. Fires before Claude Code compresses the conversation context.',
    behavior: 'Side-effect — writes a handoff file with session events to the handoffs directory. No agent-visible output.',
    configuration: 'guidance.handoffsDir (default: .slope/handoffs) controls where handoff files are written. Disable: add "compaction" to guidance.disabled.',
    level: 'full',
  },
  'stop-check': {
    purpose: 'Checks for uncommitted or unpushed work before session end. Prevents data loss from abandoned changes.',
    triggers: 'Stop. Fires when the agent session is ending.',
    behavior: 'Block — if there are uncommitted changes or unpushed commits, blocks the session end and reminds the agent to commit/push first.',
    configuration: 'Disable: add "stop-check" to guidance.disabled.',
    level: 'full',
  },
  'subagent-gate': {
    purpose: 'Controls subagent resource usage by enforcing model selection on Explore/Plan subagents. Prevents expensive long-running subagent calls.',
    triggers: 'PreToolUse on Agent. Fires when the agent launches a subagent.',
    behavior: 'Blocks subagents using models not in the allowed list. Injects codebase orientation context for allowed subagents.',
    configuration: 'guidance.subagentAllowModels (default: [\'haiku\']). Disable: add "subagent-gate" to guidance.disabled.',
    level: 'full',
  },
  'push-nudge': {
    purpose: 'Nudges the agent to push after accumulating too many unpushed commits. Ensures recovery points exist on the remote.',
    triggers: 'PostToolUse on Bash. Fires after a shell command completes (checks if it was a git commit).',
    behavior: 'Advisory — when unpushed commit count exceeds the threshold, injects a push reminder. Does not block.',
    configuration: 'guidance.pushInterval (default: 30 minutes), guidance.pushCommitThreshold (default: 5 commits). Disable: add "push-nudge" to guidance.disabled.',
    level: 'full',
  },
  'workflow-gate': {
    purpose: 'Blocks exit from plan mode until review rounds are complete. Enforces the plan review workflow.',
    triggers: 'PreToolUse on ExitPlanMode. Fires when the agent tries to leave plan mode.',
    behavior: 'Block — denies ExitPlanMode if the configured review rounds have not been completed (tracked via `slope review` state).',
    configuration: 'Review tier and rounds are set via `slope review start --tier=<tier>`. Disable: add "workflow-gate" to guidance.disabled.',
    level: 'full',
  },
  'review-tier': {
    purpose: 'Suggests starting a plan review after writing a plan file. Prompts the agent to follow the review workflow.',
    triggers: 'PostToolUse on Edit, Write. Fires after a file modification (checks if the file looks like a plan).',
    behavior: 'Advisory — if the written file appears to be a sprint plan, injects a suggestion to run `slope review start`. Does not block.',
    configuration: 'Disable: add "review-tier" to guidance.disabled.',
    level: 'full',
  },
  'version-check': {
    purpose: 'Blocks pushes to main when package versions have not been bumped. Prevents releasing unbumped code.',
    triggers: 'PreToolUse on Bash. Fires when a shell command is about to run (checks for git push to main).',
    behavior: 'Block — denies the Bash command if it\'s a push to main/master and package.json versions haven\'t been bumped since the last release.',
    configuration: 'Disable: add "version-check" to guidance.disabled.',
    level: 'full',
  },
  'stale-flows': {
    purpose: 'Warns when editing files that belong to a stale flow definition. Keeps flow definitions up to date.',
    triggers: 'PreToolUse on Edit, Write. Fires when editing a file listed in a flow definition.',
    behavior: 'Advisory — if the file being edited is part of a flow whose definition is stale, injects a warning to update the flow.',
    configuration: 'Flow definitions are in .slope/flows.json. Disable: add "stale-flows" to guidance.disabled.',
    level: 'full',
  },
  'next-action': {
    purpose: 'Suggests next actions before session end. Helps the agent wrap up cleanly with a clear handoff.',
    triggers: 'Stop. Fires when the agent session is ending.',
    behavior: 'Advisory — injects suggestions for what to do next based on current session state (e.g., create scorecard, push, PR).',
    configuration: 'Disable: add "next-action" to guidance.disabled.',
    level: 'full',
  },
  'pr-review': {
    purpose: 'Prompts for the review workflow after PR creation. Ensures sprint review artifacts are created.',
    triggers: 'PostToolUse on Bash. Fires after a shell command completes (checks for `gh pr create`).',
    behavior: 'Advisory — if the command created a PR, injects a reminder to run `slope review recommend` and create review artifacts.',
    configuration: 'Disable: add "pr-review" to guidance.disabled.',
    level: 'full',
  },
  transcript: {
    purpose: 'Records tool call metadata to the session transcript. Enables post-session analysis and auto-card generation.',
    triggers: 'PostToolUse on all tools. Fires after every tool call.',
    behavior: 'Side-effect — appends tool call data to the session transcript store. No agent-visible output.',
    configuration: 'Disable: add "transcript" to guidance.disabled.',
    level: 'full',
  },
  'branch-before-commit': {
    purpose: 'Blocks git commit on main/master. Enforces branch discipline by requiring a feature branch first.',
    triggers: 'PreToolUse on Bash. Fires when a shell command is about to run (checks for git commit on a protected branch).',
    behavior: 'Block — denies the Bash command if it\'s a git commit on main/master. Suggests creating a feature branch first.',
    configuration: 'guidance.protectedBranches (default: [\'main\', \'master\']), guidance.allowMainCommitPatterns for exceptions. Disable: add "branch-before-commit" to guidance.disabled.',
    level: 'full',
  },
  'worktree-check': {
    purpose: 'Blocks concurrent sessions from operating in the same directory without worktree isolation. Prevents file conflicts between agents.',
    triggers: 'PreToolUse on Read, Glob, Grep, Edit, Write, Bash. Fires on most tool calls.',
    behavior: 'Block — if another session is active in the same directory, denies the tool call and requires `EnterWorktree` for isolation.',
    configuration: 'Disable: add "worktree-check" to guidance.disabled.',
    level: 'full',
  },
  'sprint-completion': {
    purpose: 'Enforces sprint lifecycle gates. Blocks PR creation and session end when required gates (build, test, scorecard) are incomplete.',
    triggers: 'PreToolUse on Bash (blocks `gh pr create`), PostToolUse on Bash (auto-detects test pass), Stop (blocks session end).',
    behavior: 'Block + side-effect — blocks PR/session-end when gates are incomplete. Auto-marks the test gate when a test run passes.',
    configuration: 'Sprint gates are managed via `slope sprint start/gate/status`. Disable: add "sprint-completion" to guidance.disabled.',
    level: 'full',
  },
  'worktree-merge': {
    purpose: 'Blocks `gh pr merge --delete-branch` in worktrees. Deleting the branch while in a worktree causes a false failure state.',
    triggers: 'PreToolUse on Bash. Fires when a shell command is about to run (checks for gh pr merge with --delete-branch).',
    behavior: 'Block — denies the command and suggests merging without --delete-branch, then cleaning up the worktree separately.',
    configuration: 'Disable: add "worktree-merge" to guidance.disabled.',
    level: 'full',
  },
};

/**
 * Format guard documentation for console output.
 * @param name — specific guard name, or undefined for all guards
 */
export function formatGuardDocs(name?: string): void {
  if (name) {
    const doc = GUARD_DOCS[name];
    if (!doc) {
      console.error(`Unknown guard: "${name}"`);
      console.error(`Available guards: ${Object.keys(GUARD_DOCS).join(', ')}`);
      process.exit(1);
    }
    printGuardDoc(name, doc);
    return;
  }

  // Group by hook event for overview
  const byEvent: Record<string, string[]> = {};
  for (const [guardName, doc] of Object.entries(GUARD_DOCS)) {
    // Extract primary event from triggers string
    const eventMatch = doc.triggers.match(/^(\w+)/);
    const event = eventMatch?.[1] ?? 'Other';
    if (!byEvent[event]) byEvent[event] = [];
    byEvent[event].push(guardName);
  }

  console.log('\nSLOPE Guard Documentation\n');

  const eventOrder = ['PreToolUse', 'PostToolUse', 'Stop', 'PreCompact'];
  for (const event of eventOrder) {
    const guards = byEvent[event];
    if (!guards || guards.length === 0) continue;

    console.log(`  ${event}:`);
    for (const g of guards) {
      const doc = GUARD_DOCS[g];
      const levelTag = doc.level === 'scoring' ? '[scoring]' : '[full]   ';
      console.log(`    ${levelTag} ${g.padEnd(22)} ${doc.purpose.split('.')[0]}`);
    }
    console.log('');
  }

  console.log('Run `slope guard docs <name>` for detailed documentation.\n');
}

function printGuardDoc(name: string, doc: GuardDoc): void {
  console.log(`\n${name}\n${'='.repeat(name.length)}\n`);
  console.log(`  Purpose:        ${doc.purpose}`);
  console.log(`  Triggers:       ${doc.triggers}`);
  console.log(`  Behavior:       ${doc.behavior}`);
  console.log(`  Configuration:  ${doc.configuration}`);
  console.log(`  Install level:  ${doc.level}`);
  console.log('');
}
