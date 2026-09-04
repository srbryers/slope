import { spawnSync } from 'node:child_process';
import {
  loadPhaseCleanup,
  completePhase,
  markPhaseGate,
  pendingPhaseGates,
  isPhaseComplete,
  regressionCommand,
  PHASE_GATE_NAMES,
  type PhaseGateName,
} from '../phase-cleanup.js';
import { currentPhaseNumber } from '../phase-gate-recording.js';

/**
 * slope phase <subcommand> — Phase boundary cleanup management.
 *
 * Subcommands:
 *   complete <N>   — Mark phase N as fully cleaned up (manual override)
 *   status [N]     — Show cleanup status for phase N (or all phases)
 *   audit <N>      — Mark deferred findings as audited for phase N
 */
export async function phaseCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const cwd = process.cwd();

  switch (sub) {
    case 'complete': {
      const phase = parsePhaseArg(args[1]);
      if (phase == null) {
        console.error('Error: phase number required. Usage: slope phase complete <N>');
        process.exit(1);
      }
      completePhase(cwd, phase);
      console.log(`Phase ${phase} marked as complete (all gates).`);
      break;
    }

    case 'status': {
      const phaseArg = args[1] ? parseInt(args[1], 10) : null;
      const state = loadPhaseCleanup(cwd);

      if (phaseArg !== null && !isNaN(phaseArg)) {
        // Show single phase
        showPhaseStatus(phaseArg, cwd);
      } else {
        // Show all phases
        const phases = Object.keys(state.phases).sort((a, b) => parseInt(a) - parseInt(b));
        if (phases.length === 0) {
          console.log('\nNo phase cleanup state recorded.\n');
          return;
        }
        console.log('\nPhase Cleanup Status:\n');
        for (const p of phases) {
          showPhaseStatus(parseInt(p), cwd);
        }
      }
      break;
    }

    case 'audit': {
      const phase = parsePhaseArg(args[1]);
      if (phase == null) {
        console.error('Error: phase number required. Usage: slope phase audit <N>');
        process.exit(1);
      }
      markPhaseGate(cwd, phase, 'findings_audited', true);
      console.log(`Phase ${phase} findings_audited gate marked complete.`);
      break;
    }

    case 'regression': {
      await regressionSubcommand(args.slice(1), cwd);
      break;
    }

    case 'gate': {
      gateSubcommand(args.slice(1), cwd);
      break;
    }

    default:
      console.log(`
slope phase — Phase boundary cleanup management

Usage:
  slope phase status [N]           Show cleanup status for phase N (or all)
  slope phase audit <N>            Mark deferred findings audited for phase N
  slope phase regression [N]       Run the project's test command; record the gate on success
  slope phase gate <name> [N]      Record one gate as evidence
  slope phase complete <N>         Mark every gate at once (manual override)

Gate names: ${PHASE_GATE_NAMES.join(', ')}

Most gates are recorded by the command that satisfies them: \`slope validate\`,
\`slope card\`, \`slope map\` and \`slope phase audit\`. \`slope phase regression\`
covers the fifth. \`slope phase gate\` is for recording evidence gathered
another way, and \`slope phase complete\` remains an override that records
everything without checking anything.
`);
  }
}

/**
 * A phase number from an argument, or null.
 *
 * `parseInt` accepted `-1`, `0`, `3.7` (as 3) and `1abc` (as 1), each of which
 * wrote a phantom entry that then showed up in `slope phase status`.
 */
function parsePhaseArg(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (!/^\d+$/.test(value)) return null;
  const n = parseInt(value, 10);
  return n >= 1 ? n : null;
}

/**
 * `slope phase regression [N]` — run the project's tests and record the gate.
 *
 * #696 reported the regression label hardcoded to `bun test` in a pnpm project
 * where bun was not installed, so the gate named a command the reader could
 * not run and their passing test run could not satisfy it. The command is
 * derived from the lockfile now, and this is the writer that gate never had.
 */
async function regressionSubcommand(args: string[], cwd: string): Promise<void> {
  const phaseArg = args.find(a => !a.startsWith('--'));
  const override = args.find(a => a.startsWith('--command='))?.slice('--command='.length);
  if (override !== undefined && override.trim() === '') {
    console.error('\n--command= needs a command to run.\n');
    process.exit(1);
    return;
  }
  const command = override ?? regressionCommand(cwd);
  if (!command) {
    console.error('\nNo package manager lockfile found, so the test command cannot be derived.');
    console.error('Pass one: slope phase regression --command="<your test command>"\n');
    process.exit(1);
    return;
  }

  const phase = phaseArg !== undefined ? parsePhaseArg(phaseArg) : currentPhaseNumber(cwd);
  if (phase == null) {
    console.error(phaseArg !== undefined
      ? `\n"${phaseArg}" is not a phase number.`
      : '\nNo phase is currently being closed out (its sprints are not all scored, or it is already complete).');
    console.error('Pass it explicitly: slope phase regression <N>\n');
    process.exit(1);
    return;
  }

  console.log(`\nPhase ${phase} regression: ${command}\n`);
  // Inherit stdio so the test output is the command's own, not a summary of
  // it. A gate writer that hides why the run failed is not evidence.
  // Hand the whole string to the shell. Splitting on whitespace first mangled
  // any --command carrying a quoted argument with a space in it.
  //
  // The only `shell: true` in src/, and a security review flagged the reason:
  // on Windows, cmd.exe searches the working directory before PATH, so a
  // `pnpm.cmd` sitting in the repo would run instead of the real one. Kept
  // deliberately, because running the repository's own test command is this
  // command's entire purpose. Anyone running `pnpm test` in a hostile repo is
  // already running its package.json scripts, so this grants no capability the
  // operator was not exercising. stdio is inherited so the test output is the
  // command's own rather than bytes SLOPE relays.
  const result = spawnSync(command, { cwd, stdio: 'inherit', shell: true });

  if (result.status !== 0) {
    console.error(`\nRegression failed (exit ${result.status ?? 'signal'}). Gate not recorded.\n`);
    process.exit(result.status ?? 1);
    return;
  }

  markPhaseGate(cwd, phase, 'regression_passed', true);
  console.log(`\nPhase ${phase} regression_passed gate marked complete.\n`);
}

/**
 * `slope phase gate <name> [N]` — record one gate as evidence.
 *
 * #696 asked for either automatic recording or an evidence-oriented command.
 * Both are here: the commands record their own gates, and this covers evidence
 * gathered another way, so `phase complete` stays a genuine override rather
 * than the only way through the boundary.
 */
function gateSubcommand(args: string[], cwd: string): void {
  const positional = args.filter(a => !a.startsWith('--'));
  const name = positional[0] as PhaseGateName | undefined;
  const clear = args.includes('--clear');

  if (!name || !PHASE_GATE_NAMES.includes(name)) {
    console.error(`\nUsage: slope phase gate <name> [N] [--clear]`);
    console.error(`Gate names: ${PHASE_GATE_NAMES.join(', ')}\n`);
    process.exit(1);
    return;
  }

  const phase = positional[1] !== undefined ? parsePhaseArg(positional[1]) : currentPhaseNumber(cwd);
  if (phase == null) {
    console.error(positional[1] !== undefined
      ? `\n"${positional[1]}" is not a phase number.`
      : '\nNo phase is currently being closed out (its sprints are not all scored, or it is already complete).');
    console.error(`Pass it explicitly: slope phase gate ${name} <N>\n`);
    process.exit(1);
    return;
  }

  markPhaseGate(cwd, phase, name, !clear);
  console.log(`Phase ${phase} ${name} gate marked ${clear ? 'incomplete' : 'complete'}.`);
}

function showPhaseStatus(phase: number, cwd: string): void {
  const complete = isPhaseComplete(cwd, phase);
  const pending = pendingPhaseGates(cwd, phase);
  const state = loadPhaseCleanup(cwd);
  const gates = state.phases[String(phase)];

  // No recorded state means every gate is pending, so say which. Printing
  // only "No cleanup state recorded" hid the gate list, and with it the
  // command beside each gate, from anyone who had not already recorded one.
  const status = complete
    ? 'COMPLETE'
    : `${pending.length} gate(s) pending${gates ? '' : ' (nothing recorded yet)'}`;
  console.log(`  Phase ${phase}: ${status}`);
  if (!complete) {
    for (const g of pending) {
      console.log(`    [ ] ${g}`);
    }
  }
  if (!gates) return;
  if (gates.completed_at) {
    console.log(`    Completed: ${gates.completed_at}`);
  }
}
