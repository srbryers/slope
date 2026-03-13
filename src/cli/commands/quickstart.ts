import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as p from '@clack/prompts';

/**
 * slope quickstart — Interactive tutorial for new users.
 * Walks through the core SLOPE workflow, checking current state along the way.
 */
export async function quickstartCommand(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
slope quickstart — Interactive SLOPE tutorial

Usage:
  slope quickstart    Walk through the core SLOPE workflow step by step

Non-destructive — shows commands to run, does not modify your project.
`);
    return;
  }

  const cwd = process.cwd();

  p.intro('SLOPE Quickstart');

  console.log(`
  SLOPE (Sprint Lifecycle & Operational Performance Engine) helps you
  track, score, and improve your sprint execution over time.

  This guide walks through the core workflow. No files will be modified.
`);

  // ── Step 0: Check prerequisites ──────────────────────────────────

  const slopeDir = join(cwd, '.slope');
  const hasSlope = existsSync(join(slopeDir, 'config.json'));
  const retrosDir = join(cwd, 'docs', 'retros');
  const hasScorecards = existsSync(retrosDir) && readdirSync(retrosDir).some(f => f.endsWith('.json'));

  if (!hasSlope) {
    p.note(
      'Your project has not been initialized with SLOPE yet.\n\n' +
      'Run one of:\n' +
      '  slope init                       Basic setup\n' +
      '  slope init --interactive         Guided wizard\n' +
      '  slope init --claude-code         Setup with Claude Code hooks\n' +
      '  slope init --cursor              Setup with Cursor IDE rules',
      'Step 0 — Initialize',
    );

    const shouldContinue = await p.confirm({
      message: 'Continue the tutorial anyway?',
      initialValue: true,
    });

    if (p.isCancel(shouldContinue) || !shouldContinue) {
      p.outro('Run `slope init` first, then `slope quickstart` again.');
      return;
    }
  } else {
    p.log.success('Project initialized — .slope/config.json found');
  }

  // ── Step 1: Pre-Sprint Briefing ──────────────────────────────────

  p.note(
    'Before starting a sprint, get a briefing on your current state:\n\n' +
    '  slope briefing\n\n' +
    'This shows:\n' +
    '  - Handicap snapshot (trending performance)\n' +
    '  - Hazard index (known gotchas in your code areas)\n' +
    '  - Session continuity (active claims, unfinished work)\n\n' +
    'Filter by area:  slope briefing --categories=testing,api\n' +
    'Filter by keyword: slope briefing --keywords=migration',
    'Step 1 — Pre-Sprint Briefing',
  );

  // ── Step 2: Sprint Planning ──────────────────────────────────────

  p.note(
    'Plan each ticket before writing code:\n\n' +
    '  slope plan --complexity=medium\n\n' +
    'This recommends:\n' +
    '  - Club selection (approach complexity: putter → driver)\n' +
    '  - Known hazards for the code areas you\'ll touch\n' +
    '  - Training tips based on your miss patterns\n\n' +
    'Claim tickets to avoid conflicts in multi-agent setups:\n' +
    '  slope claim --target=S1-1 --sprint=1',
    'Step 2 — Planning & Claims',
  );

  // ── Step 3: Scoring ──────────────────────────────────────────────

  p.note(
    'After completing sprint work, score and validate:\n\n' +
    '  slope validate docs/retros/sprint-1.json\n' +
    '  slope review docs/retros/sprint-1.json\n\n' +
    'Or auto-generate a scorecard from git history:\n' +
    '  slope auto-card --sprint=1\n\n' +
    'View your performance trend:\n' +
    '  slope card',
    'Step 3 — Scoring & Review',
  );

  // ── Step 4: Guards & Hooks ───────────────────────────────────────

  p.note(
    'Guards are hooks that guide your agent during coding:\n\n' +
    '  slope hook add --level=full     Install all guards\n' +
    '  slope guard list                See available guards\n' +
    '  slope guard status              Check installation state\n' +
    '  slope guard docs                Detailed guard documentation\n\n' +
    'Guards can:\n' +
    '  - Nudge you to commit/push regularly\n' +
    '  - Warn about known hazards in files you\'re editing\n' +
    '  - Block commits on main (branch discipline)\n' +
    '  - Detect scope drift outside your claimed tickets',
    'Step 4 — Guards & Hooks',
  );

  // ── Next Steps ───────────────────────────────────────────────────

  const nextSteps: string[] = [];

  if (!hasSlope) {
    nextSteps.push('slope init --interactive     Initialize SLOPE for this project');
  }
  if (!hasScorecards) {
    nextSteps.push('slope auto-card --sprint=1   Generate your first scorecard from git');
  }
  nextSteps.push('slope briefing               Get a pre-sprint briefing');
  nextSteps.push('slope help                   Browse all commands');
  nextSteps.push('slope doctor                 Check repo health');

  p.note(nextSteps.join('\n'), 'Next Steps');

  p.outro('Ready to score your sprints!');
}
