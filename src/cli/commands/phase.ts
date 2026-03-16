import {
  loadPhaseCleanup,
  completePhase,
  markPhaseGate,
  pendingPhaseGates,
  isPhaseComplete,
} from '../phase-cleanup.js';

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

    default:
      console.log(`
slope phase — Phase boundary cleanup management

Usage:
  slope phase complete <N>   Mark phase N cleanup as complete (all gates)
  slope phase status [N]     Show cleanup status for phase N (or all)
  slope phase audit <N>      Mark deferred findings audited for phase N
`);
  }
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
