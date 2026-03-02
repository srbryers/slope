// SLOPE — slope vision: display, create, and update project vision document
import { loadVision, createVision, updateVision } from '../../core/vision.js';

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)(?:=(.+))?$/);
    if (match) result[match[1]] = match[2] ?? 'true';
  }
  return result;
}

function createSubcommand(flags: Record<string, string>): void {
  if (!flags.purpose) {
    console.error('Error: --purpose is required.');
    console.error('Usage: slope vision create --purpose="..." --priorities="a,b,c"');
    process.exit(1);
  }

  const priorities = flags.priorities
    ? flags.priorities.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  if (priorities.length === 0) {
    console.error('Error: --priorities is required (comma-separated list).');
    process.exit(1);
  }

  try {
    const vision = createVision({
      purpose: flags.purpose,
      priorities,
      audience: flags.audience,
      techDirection: flags['tech-direction'],
      nonGoals: flags['non-goals']
        ? flags['non-goals'].split(',').map(s => s.trim()).filter(Boolean)
        : undefined,
    });
    console.log('\nVision created successfully.\n');
    console.log(`  Purpose:    ${vision.purpose}`);
    console.log(`  Priorities: ${vision.priorities.join(', ')}`);
    if (vision.audience) console.log(`  Audience:   ${vision.audience}`);
    if (vision.techDirection) console.log(`  Tech:       ${vision.techDirection}`);
    if (vision.nonGoals?.length) console.log(`  Non-goals:  ${vision.nonGoals.join(', ')}`);
    console.log('');
  } catch (err) {
    console.error(`\nError: ${(err as Error).message}\n`);
    process.exit(1);
  }
}

function updateSubcommand(flags: Record<string, string>): void {
  const fields: Record<string, unknown> = {};
  if (flags.purpose) fields.purpose = flags.purpose;
  if (flags.priorities) fields.priorities = flags.priorities.split(',').map(s => s.trim()).filter(Boolean);
  if (flags.audience) fields.audience = flags.audience;
  if (flags['tech-direction']) fields.techDirection = flags['tech-direction'];
  if (flags['non-goals']) fields.nonGoals = flags['non-goals'].split(',').map(s => s.trim()).filter(Boolean);

  if (Object.keys(fields).length === 0) {
    console.error('Error: provide at least one field to update.');
    console.error('Usage: slope vision update --purpose="..." --priorities="a,b,c"');
    process.exit(1);
  }

  try {
    const vision = updateVision(fields);
    console.log('\nVision updated successfully.\n');
    console.log(`  Purpose:    ${vision.purpose}`);
    console.log(`  Priorities: ${vision.priorities.join(', ')}`);
    if (vision.audience) console.log(`  Audience:   ${vision.audience}`);
    if (vision.techDirection) console.log(`  Tech:       ${vision.techDirection}`);
    if (vision.nonGoals?.length) console.log(`  Non-goals:  ${vision.nonGoals.join(', ')}`);
    console.log(`  Updated:    ${vision.updatedAt}`);
    console.log('');
  } catch (err) {
    console.error(`\nError: ${(err as Error).message}\n`);
    process.exit(1);
  }
}

export async function visionCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const flags = parseArgs(args.slice(sub === 'create' || sub === 'update' ? 1 : 0));

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
slope vision — Project vision document

Usage:
  slope vision                Show current vision
  slope vision create         Create a new vision document
  slope vision update         Update existing vision fields
  slope vision --json         Output as JSON

Create options:
  --purpose="..."             Project purpose (required)
  --priorities="a,b,c"        Comma-separated priorities (required)
  --audience="..."            Target audience
  --tech-direction="..."      Technical direction
  --non-goals="a,b"           Comma-separated non-goals

Update options:
  Same flags as create — only provided fields are updated.
`);
    return;
  }

  if (sub === 'create') {
    createSubcommand(flags);
    return;
  }

  if (sub === 'update') {
    updateSubcommand(flags);
    return;
  }

  // Default: show vision
  const vision = loadVision();

  if (!vision) {
    console.log('No vision set. Run \`slope vision create\` or \`slope init --interactive\` to create one.');
    return;
  }

  if (flags.json === 'true') {
    console.log(JSON.stringify(vision, null, 2));
    return;
  }

  console.log(`\nProject Vision\n`);
  console.log(`  Purpose:      ${vision.purpose}`);
  if (vision.audience) console.log(`  Audience:     ${vision.audience}`);
  if (vision.priorities.length > 0) {
    console.log(`  Priorities:`);
    for (const p of vision.priorities) {
      console.log(`    - ${p}`);
    }
  }
  if (vision.techDirection) console.log(`  Tech:         ${vision.techDirection}`);
  if (vision.nonGoals && vision.nonGoals.length > 0) {
    console.log(`  Non-goals:`);
    for (const ng of vision.nonGoals) {
      console.log(`    - ${ng}`);
    }
  }
  console.log(`  Updated:      ${vision.updatedAt}\n`);
}
