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
      const phase = parseInt(args[1], 10);
      if (isNaN(phase)) {
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
      const phase = parseInt(args[1], 10);
      if (isNaN(phase)) {
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
  const command = override ?? regressionCommand(cwd);

  const phase = phaseArg !== undefined
    ? parseInt(phaseArg, 10)
    : currentPhaseNumber(cwd);
  if (phase == null || isNaN(phase)) {
    console.error('\nCould not resolve the phase for this sprint.');
    console.error('Pass it explicitly: slope phase regression <N>\n');
    process.exit(1);
    return;
  }

  console.log(`\nPhase ${phase} regression: ${command}\n`);
  // Inherit stdio so the test output is the command's own, not a summary of
  // it. A gate writer that hides why the run failed is not evidence.
  const [file, ...rest] = command.split(/\s+/);
  const result = spawnSync(file, rest, { cwd, stdio: 'inherit', shell: true });

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

  const phase = positional[1] !== undefined
    ? parseInt(positional[1], 10)
    : currentPhaseNumber(cwd);
  if (phase == null || isNaN(phase)) {
    console.error('\nCould not resolve the phase for this sprint.');
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

  if (!gates) {
    console.log(`  Phase ${phase}: No cleanup state recorded`);
    return;
  }

  const status = complete ? 'COMPLETE' : `${pending.length} gate(s) pending`;
  console.log(`  Phase ${phase}: ${status}`);
  if (!complete) {
    for (const g of pending) {
      console.log(`    [ ] ${g}`);
    }
  }
  if (gates.completed_at) {
    console.log(`    Completed: ${gates.completed_at}`);
  }
}
