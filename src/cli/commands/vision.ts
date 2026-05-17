// SLOPE — slope vision: display, create, and update project vision document
import { loadVision, createVision, updateVision, writeVisionMarkdown } from '../../core/vision.js';

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)(?:=(.+))?$/);
    if (match) result[match[1]] = match[2] ?? 'true';
  }
  return result;
}

export function splitTopLevelCommaList(input: string): string[] {
  const items: string[] = [];
  let current = '';
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }

    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === '(') parenDepth++;
    if (char === ')' && parenDepth > 0) parenDepth--;
    if (char === '[') bracketDepth++;
    if (char === ']' && bracketDepth > 0) bracketDepth--;
    if (char === '{') braceDepth++;
    if (char === '}' && braceDepth > 0) braceDepth--;

    if (char === ',' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      const trimmed = current.trim();
      if (trimmed) items.push(trimmed);
      current = '';
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed) items.push(trimmed);
  return items;
}

function createSubcommand(flags: Record<string, string>): void {
  if (!flags.purpose) {
    console.error('Error: --purpose is required.');
    console.error('Usage: slope vision create --purpose="..." --priorities="a,b,c"');
    process.exit(1);
  }

  const priorities = flags.priorities ? splitTopLevelCommaList(flags.priorities) : [];

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
      nonGoals: flags['non-goals'] ? splitTopLevelCommaList(flags['non-goals']) : undefined,
    });
    console.log('\nVision created successfully.\n');
    console.log(`  Purpose:    ${vision.purpose}`);
    console.log(`  Priorities: ${vision.priorities.join(', ')}`);
    if (vision.audience) console.log(`  Audience:   ${vision.audience}`);
    if (vision.techDirection) console.log(`  Tech:       ${vision.techDirection}`);
    if (vision.nonGoals?.length) console.log(`  Non-goals:  ${vision.nonGoals.join(', ')}`);
    console.log('');

    // Optional tracked Markdown mirror — see GH #305
    if (flags['write-md']) {
      const mdPath = flags['write-md'] === 'true' ? 'docs/vision.md' : flags['write-md'];
      const written = writeVisionMarkdown(vision, mdPath);
      console.log(`  Markdown:   ${written}\n`);
    }
  } catch (err) {
    console.error(`\nError: ${(err as Error).message}\n`);
    process.exit(1);
  }
}

function updateSubcommand(flags: Record<string, string>): void {
  const fields: Record<string, unknown> = {};
  if (flags.purpose) fields.purpose = flags.purpose;
  if (flags.priorities) fields.priorities = splitTopLevelCommaList(flags.priorities);
  if (flags.audience) fields.audience = flags.audience;
  if (flags['tech-direction']) fields.techDirection = flags['tech-direction'];
  if (flags['non-goals']) fields.nonGoals = splitTopLevelCommaList(flags['non-goals']);

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

    if (flags['write-md']) {
      const mdPath = flags['write-md'] === 'true' ? 'docs/vision.md' : flags['write-md'];
      const written = writeVisionMarkdown(vision, mdPath);
      console.log(`  Markdown:   ${written}\n`);
    }
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
  --priorities="a,b,c"        Comma-separated priorities; commas inside (), [], {} are preserved (required)
  --audience="..."            Target audience
  --tech-direction="..."      Technical direction
  --non-goals="a,b"           Comma-separated non-goals; commas inside (), [], {} are preserved
  --write-md[=<path>]         Also write tracked Markdown (default: docs/vision.md)

Update options:
  Same flags as create — only provided fields are updated.
  --write-md[=<path>]         Re-render tracked Markdown after update.
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
