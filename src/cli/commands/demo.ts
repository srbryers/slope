// SLOPE — slope demo: scripted onboarding showcase for video recordings
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import * as p from '@clack/prompts';
import { detectPackageManager, analyzeStack } from '../../core/analyzers/stack.js';
import { analyzeBacklog } from '../../core/analyzers/backlog.js';
import { mergeBacklogs } from '../../core/analyzers/backlog-merged.js';
import { createVision } from '../../core/vision.js';
import { generateRoadmapFromVision, PRIORITY_SYNONYMS } from '../../core/generators/roadmap.js';

// --- Types ---

interface DemoAnswers {
  vision: string;
  priorities: string[];
}

// --- Speed config ---

const SPEED: Record<string, number> = { slow: 40, normal: 20, fast: 5 };

// --- Helpers ---

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function wordWrap(text: string, width: number): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

async function typewrite(prefix: string, text: string, charDelay: number): Promise<void> {
  const indent = ' '.repeat(prefix.length);
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lp = i === 0 ? prefix : indent;
    process.stdout.write(lp);
    for (const ch of lines[i]) {
      process.stdout.write(ch);
      if (charDelay > 0) await sleep(charDelay);
    }
    process.stdout.write('\n');
  }
}

async function mcpCall(label: string, result: string, delay: number): Promise<void> {
  const line = result
    ? `  \u25b8 ${label.padEnd(32)} \u2192 ${result}`
    : `  \u25b8 ${label}`;
  console.log(line);
  await sleep(delay);
}

// --- Args ---

function parseArgs(args: string[]) {
  let project = process.cwd();
  let answers = '';
  let speed = 'normal';
  let help = false;
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg.startsWith('--project=')) project = arg.slice('--project='.length);
    else if (arg.startsWith('--answers=')) answers = arg.slice('--answers='.length);
    else if (arg.startsWith('--speed=')) speed = arg.slice('--speed='.length);
  }
  return { project, answers, speed, help };
}

// --- Validation ---

function loadAnswers(path: string): DemoAnswers {
  let raw: string;
  try { raw = readFileSync(path, 'utf8'); }
  catch { throw new Error(`Answers file not found: ${path}`); }

  let obj: Record<string, unknown>;
  try { obj = JSON.parse(raw); }
  catch { throw new Error(`Answers file is not valid JSON: ${path}`); }

  if (!obj.vision || typeof obj.vision !== 'string')
    throw new Error('Answers file must contain a "vision" string.');
  if (!Array.isArray(obj.priorities) || obj.priorities.length === 0 ||
      !obj.priorities.every((v: unknown) => typeof v === 'string'))
    throw new Error('Answers file must contain a non-empty "priorities" string array.');

  return { vision: obj.vision, priorities: obj.priorities as string[] };
}

// --- Main ---

export async function demoCommand(args: string[]): Promise<void> {
  const opts = parseArgs(args);

  if (opts.help) {
    console.log(`
slope demo — Scripted onboarding showcase for video recordings

Usage:
  slope demo --answers=<path> [options]

Options:
  --answers=<path>           JSON file with vision answers (required)
  --project=<path>           Target project directory (default: cwd)
  --speed=slow|normal|fast   Typewriter delay (default: normal)
  --help, -h                 Show this help

Answers file format:
  {
    "vision": "Your freeform project vision...",
    "priorities": ["speed", "reliability", "ux"]
  }
`);
    return;
  }

  if (!opts.answers) {
    console.error('Error: --answers=<path> is required. Run "slope demo --help" for usage.');
    process.exit(1);
  }

  const answersPath = resolve(opts.answers);
  const answers = loadAnswers(answersPath);
  const cwd = resolve(opts.project);
  const isTTY = process.stdout.isTTY ?? false;
  const charDelay = isTTY ? (SPEED[opts.speed] ?? SPEED.normal) : 0;
  const pause = isTTY ? 300 : 0;
  const projectName = basename(cwd);
  let tmpDir: string | null = null;

  try {
    // ─── Step 1: The Problem — Show Scattered TODOs ───

    p.note(
      'The AI agent harness.\nStructure. Accountability. Results.',
      'SLOPE'
    );
    console.log('');
    await typewrite('Agent  ', 'Let me take a look at this project...', charDelay);
    console.log('');

    const pm = detectPackageManager(cwd);
    await mcpCall('detectPackageManager()', pm ? `"${pm}"` : '"unknown"', pause);

    const stack = await analyzeStack(cwd);
    const displayFrameworks = stack.frameworks
      .filter(f => !['vitest', 'jest', 'mocha'].includes(f));
    const stackParts = [stack.primaryLanguage, ...displayFrameworks].filter(Boolean);
    const stackStr = stackParts.length > 1
      ? `${stackParts[0]} \u00b7 ${stackParts.slice(1).join(', ')}`
      : stackParts[0] || 'Unknown';
    await mcpCall('analyzeStack()', stackStr, pause);

    console.log('');
    console.log(`  Project:  ${projectName}`);
    console.log(`  Stack:    ${stackStr}`);
    if (pm) console.log(`  PM:       ${pm}`);
    console.log('');

    const backlog = await analyzeBacklog(cwd);
    const todoCount = backlog.todos.length;

    if (todoCount > 0) {
      await typewrite('Agent  ', `I found ${todoCount} TODOs scattered across your codebase:`, charDelay);
      console.log('');

      const sample = backlog.todos.slice(0, 5);
      const maxLen = Math.max(...sample.map(t => t.file.length));
      for (const todo of sample) {
        console.log(`  ${todo.file.padEnd(maxLen + 2)}${todo.type}: ${todo.text}`);
      }
      if (todoCount > 5) console.log(`  ... and ${todoCount - 5} more`);
      console.log('');
      await typewrite('  ', "There's real work here, but no structure. Let's fix that.", charDelay);
    } else {
      await typewrite('Agent  ', "Clean codebase \u2014 no scattered TODOs. Let's set up structure.", charDelay);
    }

    console.log('');
    await sleep(pause * 2);

    // ─── Step 2: Vision Conversation ───

    const agentQ = wordWrap(
      "Tell me about your vision for this project. What's it for, " +
      "who uses it, why does it matter to you? Get free and loose " +
      "with it \u2014 SLOPE recommends dictating your answer so we get " +
      "a full stream of consciousness of what you're trying to achieve.",
      60
    );
    await typewrite('Agent  ', agentQ, charDelay);
    console.log('');
    await sleep(isTTY ? 500 : 0);

    const wrappedVision = wordWrap(answers.vision, 60);
    await typewrite('You    ', wrappedVision, charDelay);
    console.log('');
    await sleep(pause);

    await typewrite('Agent  ', `Got it. I've extracted your priorities: ${answers.priorities.join(', ')}.`, charDelay);
    console.log('');

    tmpDir = mkdtempSync(join(tmpdir(), 'slope-demo-'));
    const vision = createVision({
      purpose: answers.vision,
      priorities: answers.priorities,
    }, tmpDir);

    await mcpCall('createVision()', '', pause);
    console.log('  \u2713 Vision created');
    console.log('');
    await sleep(pause * 2);

    // ─── Step 3: Roadmap Generation — The Wow Moment ───

    await typewrite('Agent  ', 'Now let me map your backlog to your priorities...', charDelay);
    console.log('');

    const merged = mergeBacklogs(backlog);
    const roadmap = generateRoadmapFromVision(vision, merged);

    await mcpCall('generateRoadmapFromVision(vision, backlog)', '', pause);

    console.log('  Matching TODOs to vision priorities...');
    for (const priority of answers.priorities) {
      const synonyms = PRIORITY_SYNONYMS[priority.toLowerCase()];
      if (synonyms) {
        console.log(`    "${priority}"`.padEnd(20) + `\u2192 ${synonyms.slice(0, 4).join(', ')}`);
      }
    }
    console.log('');

    let matchedCount = 0;
    for (const sprint of roadmap.sprints) {
      if (sprint.theme.toLowerCase() !== 'general') {
        matchedCount += sprint.tickets
          .filter(t => !t.title.startsWith('Investigate and plan')).length;
      }
    }

    for (const sprint of roadmap.sprints) {
      const shown = sprint.tickets.slice(0, 5);
      const extra = sprint.tickets.length - shown.length;
      const theme = sprint.theme.charAt(0).toUpperCase() + sprint.theme.slice(1);
      console.log(`  Sprint ${sprint.id} \u2014 ${theme} (${sprint.tickets.length} ticket${sprint.tickets.length !== 1 ? 's' : ''})`);
      for (const t of shown) console.log(`    ${t.key}  ${t.title}`);
      if (extra > 0) console.log(`    ... +${extra} more`);
      console.log('');
    }

    console.log(`  Matched ${matchedCount}/${todoCount} TODOs to your vision priorities.`);
    console.log('');
    await sleep(pause * 2);

    // ─── Step 4: Before/After Summary ───

    await typewrite('Agent  ', 'From scattered TODOs to a structured roadmap:', charDelay);
    console.log('');

    const moduleCount = Object.keys(backlog.todosByModule).length;
    p.note(
      `${todoCount} TODOs across ${moduleCount} module${moduleCount !== 1 ? 's' : ''}. No priorities. No structure.`,
      'Before'
    );

    console.log('                          \u2193');

    const prioritySprints = roadmap.sprints.filter(s => s.theme.toLowerCase() !== 'general').length;
    const generalSprints = roadmap.sprints.filter(s => s.theme.toLowerCase() === 'general').length;
    const sprintDesc = generalSprints > 0
      ? `${prioritySprints} priority sprint${prioritySprints !== 1 ? 's' : ''} + ${generalSprints} general sprint${generalSprints !== 1 ? 's' : ''}`
      : `${prioritySprints} priority sprint${prioritySprints !== 1 ? 's' : ''}`;

    const purposeFirst = answers.vision.split(/[.!?]/)[0].trim();
    const purposeShort = purposeFirst.length > 50
      ? purposeFirst.slice(0, 50).replace(/\s+\S*$/, '') + '...'
      : purposeFirst;
    const firstTheme = roadmap.sprints[0]?.theme ?? 'Start';
    const themeDisplay = firstTheme.charAt(0).toUpperCase() + firstTheme.slice(1);

    p.note(
      [
        `Vision:    ${purposeShort}`,
        `Roadmap:   ${sprintDesc}`,
        `Matched:   ${matchedCount}/${todoCount} TODOs aligned to your priorities`,
        `Ready:     Sprint 1 (${themeDisplay}) is ready to execute`,
      ].join('\n'),
      'After'
    );

    console.log('');
    await sleep(pause * 2);

    // ─── Step 5: What's Next ───

    await typewrite('Agent  ', 'Your agent is ready to execute Sprint 1.', charDelay);
    await typewrite('       ', 'Every sprint gets scored. Every ticket is tracked.', charDelay);
    await typewrite('       ', "That's SLOPE \u2014 the AI agent harness.", charDelay);
    console.log('');

    p.outro('slope.sh');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\nError: ${msg}\n`);
    process.exit(1);
  } finally {
    if (tmpDir) {
      try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore cleanup errors */ }
    }
  }
}
