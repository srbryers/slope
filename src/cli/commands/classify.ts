import { classifyShot } from '../../core/index.js';
import type { ExecutionTrace } from '../../core/index.js';

export function classifyCommand(args: string[]): void {
  let scope: string | undefined;
  let modified: string | undefined;
  let tests: string | undefined;
  let reverts: string | undefined;
  let hazards: string | undefined;

  for (const arg of args) {
    if (arg.startsWith('--scope=')) scope = arg.slice('--scope='.length);
    else if (arg.startsWith('--modified=')) modified = arg.slice('--modified='.length);
    else if (arg.startsWith('--tests=')) tests = arg.slice('--tests='.length);
    else if (arg.startsWith('--reverts=')) reverts = arg.slice('--reverts='.length);
    else if (arg.startsWith('--hazards=')) hazards = arg.slice('--hazards='.length);
  }

  if (!scope || !modified || !tests || reverts == null) {
    console.error('\nUsage: slope classify --scope="a.ts,b.ts" --modified="a.ts,b.ts" --tests=pass|fail|partial --reverts=N [--hazards=N]\n');
    process.exit(1);
    return; // unreachable, helps TS narrow
  }

  const validTests = ['pass', 'fail', 'partial'];
  if (!validTests.includes(tests)) {
    console.error(`\nInvalid --tests value "${tests}". Must be one of: ${validTests.join(', ')}\n`);
    process.exit(1);
    return;
  }

  const scopePaths = scope.split(',').map((s: string) => s.trim()).filter(Boolean);
  const modifiedFiles = modified.split(',').map((s: string) => s.trim()).filter(Boolean);
  const revertCount = parseInt(reverts, 10) || 0;
  const hazardCount = parseInt(hazards ?? '0', 10) || 0;

  // Build test_results
  const testResults: ExecutionTrace['test_results'] = [];
  if (tests === 'pass') {
    testResults.push({ suite: 'all', passed: true, first_run: true });
  } else if (tests === 'fail') {
    testResults.push({ suite: 'all', passed: false, first_run: true });
  } else {
    testResults.push({ suite: 'unit', passed: true, first_run: true });
    testResults.push({ suite: 'integration', passed: false, first_run: true });
  }

  // Build hazards_encountered
  const hazardsEncountered = Array.from({ length: hazardCount }, (_, i) => ({
    type: 'rough' as const,
    description: `Hazard ${i + 1}`,
  }));

  const trace: ExecutionTrace = {
    planned_scope_paths: scopePaths,
    modified_files: modifiedFiles,
    test_results: testResults,
    reverts: revertCount,
    elapsed_minutes: 0,
    hazards_encountered: hazardsEncountered,
  };

  const result = classifyShot(trace);

  console.log('');
  console.log('SHOT CLASSIFICATION');
  console.log('\u2550'.repeat(40));
  console.log(`  Result:         ${result.result}`);
  console.log(`  Miss direction: ${result.miss_direction ?? 'none'}`);
  console.log(`  Confidence:     ${Math.round(result.confidence * 100)}%`);
  console.log(`  Reasoning:      ${result.reasoning}`);
  console.log('');
}
