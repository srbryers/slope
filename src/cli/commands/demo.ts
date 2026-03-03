// SLOPE — slope demo: scripted onboarding showcase for video recordings
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import * as p from '@clack/prompts';
import { detectPackageManager, analyzeStack } from '../../core/analyzers/stack.js';
import { analyzeBacklog } from '../../core/analyzers/backlog.js';
import { mergeBacklogs } from '../../core/analyzers/backlog-merged.js';
import { createVision, updateVision } from '../../core/vision.js';
import { generateRoadmapFromVision, PRIORITY_SYNONYMS } from '../../core/generators/roadmap.js';

// --- Types ---

interface DemoClarification { question: string; answer: string; }
interface DemoPushback {
  comment: string;
  revised: { audience?: string; nonGoals?: string[] };
  approval: string;
}
interface DemoAnswers {
  vision: string;
  priorities: string[];
  clarifications: DemoClarification[];
  audience: string;
  nonGoals: string[];
  pushback: DemoPushback;
  ticketOverrides?: Record<string, string>;
}

// --- Speed config ---

const SPEED: Record<string, number> = { slow: 30, normal: 15, fast: 3 };

// --- Color helpers (raw ANSI, TTY-aware) ---

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

type Colors = ReturnType<typeof createColors>;

function createColors(enabled: boolean) {
  const wrap = (code: string) => enabled
    ? (s: string) => `\x1b[${code}m${s}\x1b[0m`
    : (s: string) => s;
  return {
    bold: wrap('1'),
    dim: wrap('2'),
    green: wrap('32'),
    boldCyan: wrap('1;36'),
    boldGreen: wrap('1;32'),
    boldYellow: wrap('1;33'),
    boldWhite: wrap('1;37'),
    boldRed: wrap('1;31'),
    dimCyan: wrap('2;36'),
    dimItalic: wrap('2;3'),
  };
}

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
  const indent = ' '.repeat(stripAnsi(prefix).length);
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lp = i === 0 ? prefix : indent;
    process.stdout.write(lp);
    // Emit ANSI escape sequences atomically so colors don't break typewriter effect
    const tokens = lines[i].match(/\x1b\[[0-9;]*m|./gs) ?? [];
    for (const tok of tokens) {
      process.stdout.write(tok);
      if (charDelay > 0 && !tok.startsWith('\x1b')) await sleep(charDelay);
    }
    process.stdout.write('\n');
  }
}

async function mcpCall(label: string, result: string, delay: number, c: Colors): Promise<void> {
  const line = result
    ? `  ${c.dim('\u25b8 ' + label.padEnd(32))} \u2192 ${c.bold(result)}`
    : `  ${c.dim('\u25b8 ' + label)}`;
  console.log(line);
  await sleep(delay);
}

async function revealLines(lines: string[], lineDelay: number): Promise<void> {
  for (const line of lines) {
    console.log(line);
    if (lineDelay > 0) await sleep(lineDelay);
  }
}

async function typewriteVision(
  fields: { heading: string; value: string }[],
  charDelay: number, c: Colors, isTTY: boolean,
): Promise<void> {
  const contentWidth = 52;
  const innerWidth = contentWidth + 4; // 2-char pad each side
  const b = (s: string) => c.dimCyan(s);

  const printBoxLine = (text: string, ansiCode?: string) => {
    const styled = ansiCode && isTTY
      ? `\x1b[${ansiCode}m${text}\x1b[0m`
      : text;
    const rightPad = ' '.repeat(Math.max(0, contentWidth - text.length + 2));
    console.log(b('│') + '  ' + styled + rightPad + b('│'));
  };

  const typeInBox = async (text: string, ansiCode: string) => {
    const display = text.slice(0, contentWidth);
    const rightPad = ' '.repeat(Math.max(0, contentWidth - display.length + 2));
    process.stdout.write(b('│') + '  ');
    if (charDelay > 0 && isTTY) {
      process.stdout.write(`\x1b[${ansiCode}m`);
      for (const ch of display) {
        process.stdout.write(ch);
        await sleep(Math.max(1, Math.floor(charDelay * 0.4)));
      }
      process.stdout.write('\x1b[0m');
    } else {
      process.stdout.write(isTTY ? `\x1b[${ansiCode}m${display}\x1b[0m` : display);
    }
    process.stdout.write(rightPad + b('│') + '\n');
  };

  const emptyLine = () => console.log(
    b('│') + ' '.repeat(innerWidth) + b('│')
  );

  // Top border
  const title = ' Vision ';
  const topRule = '─'.repeat(innerWidth - title.length - 2);
  console.log(b('╭─') + b(title) + b(topRule) + b('╮'));
  emptyLine();

  for (let i = 0; i < fields.length; i++) {
    const { heading, value } = fields[i];
    printBoxLine(heading, '2'); // dim heading
    const lines = wordWrap(value, contentWidth).split('\n');
    for (const line of lines) {
      await typeInBox(line, '1;37'); // bold white value
    }
    emptyLine(); // spacing between fields
  }

  // Bottom border
  console.log(b('╰') + b('─'.repeat(innerWidth)) + b('╯'));
}

function sideBySide(
  leftTitle: string, leftContent: string[],
  rightTitle: string, rightContent: string[],
  c: Colors,
): string[] {
  const lw = 30;
  const rw = 38;
  const gap = '     ';
  const arrow = '  \u2192  ';

  const pad = (s: string, w: number) => {
    const vis = stripAnsi(s).length;
    return s + ' '.repeat(Math.max(0, w - vis));
  };

  // Pad content to equal height with top/bottom spacing
  const lPad = ['', ...leftContent, ''];
  const rPad = ['', ...rightContent, ''];
  while (lPad.length < rPad.length) lPad.splice(lPad.length - 1, 0, '');
  while (rPad.length < lPad.length) rPad.splice(rPad.length - 1, 0, '');
  const h = lPad.length;
  const mid = Math.floor(h / 2);

  const out: string[] = [];

  // Top borders
  const lTop = c.dim('\u256d\u2500 ' + leftTitle + ' ' + '\u2500'.repeat(Math.max(0, lw - leftTitle.length - 3)) + '\u256e');
  const rTop = c.boldCyan('\u256d\u2500 ' + rightTitle + ' ' + '\u2500'.repeat(Math.max(0, rw - rightTitle.length - 3)) + '\u256e');
  out.push('  ' + lTop + gap + rTop);

  // Content rows
  for (let i = 0; i < h; i++) {
    const g = i === mid ? arrow : gap;
    out.push(
      '  ' + c.dim('\u2502') + pad('  ' + (lPad[i] || ''), lw) + c.dim('\u2502') +
      g +
      c.boldCyan('\u2502') + pad('  ' + (rPad[i] || ''), rw) + c.boldCyan('\u2502')
    );
  }

  // Bottom borders
  out.push(
    '  ' + c.dim('\u2570' + '\u2500'.repeat(lw) + '\u256f') +
    gap +
    c.boldCyan('\u2570' + '\u2500'.repeat(rw) + '\u256f')
  );

  return out;
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

  if (!Array.isArray(obj.clarifications) ||
      !obj.clarifications.every((c: unknown) =>
        typeof c === 'object' && c !== null &&
        typeof (c as Record<string, unknown>).question === 'string' &&
        typeof (c as Record<string, unknown>).answer === 'string'))
    throw new Error('Answers file must contain a "clarifications" array of {question, answer}.');

  if (!obj.audience || typeof obj.audience !== 'string')
    throw new Error('Answers file must contain an "audience" string.');

  if (!Array.isArray(obj.nonGoals) ||
      !obj.nonGoals.every((v: unknown) => typeof v === 'string'))
    throw new Error('Answers file must contain a "nonGoals" string array.');

  const pb = obj.pushback as Record<string, unknown> | undefined;
  if (!pb || typeof pb !== 'object' ||
      typeof pb.comment !== 'string' ||
      typeof pb.approval !== 'string' ||
      !pb.revised || typeof pb.revised !== 'object')
    throw new Error('Answers file must contain a "pushback" object with {comment, revised, approval}.');

  return {
    vision: obj.vision as string,
    priorities: obj.priorities as string[],
    clarifications: obj.clarifications as DemoClarification[],
    audience: obj.audience as string,
    nonGoals: obj.nonGoals as string[],
    pushback: obj.pushback as DemoPushback,
    ticketOverrides: obj.ticketOverrides as Record<string, string> | undefined,
  };
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
  const c = createColors(isTTY);
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
    await typewrite(c.boldCyan('Agent') + '  ', 'Let me take a look at this project...', charDelay);
    console.log('');

    const pm = detectPackageManager(cwd);
    await mcpCall('detectPackageManager()', pm ? `"${pm}"` : '"unknown"', pause, c);

    const stack = await analyzeStack(cwd);
    const displayFrameworks = stack.frameworks
      .filter(f => !['vitest', 'jest', 'mocha'].includes(f));
    const stackParts = [stack.primaryLanguage, ...displayFrameworks].filter(Boolean);
    const stackStr = stackParts.length > 1
      ? `${stackParts[0]} \u00b7 ${stackParts.slice(1).join(', ')}`
      : stackParts[0] || 'Unknown';
    await mcpCall('analyzeStack()', stackStr, pause, c);

    console.log('');
    const statsLines = [
      `  ${c.dim('Project:')}  ${c.boldWhite(projectName)}`,
      `  ${c.dim('Stack:')}    ${c.boldWhite(stackStr)}`,
      ...(pm ? [`  ${c.dim('PM:')}       ${c.boldWhite(pm)}`] : []),
    ];
    await revealLines(statsLines, isTTY ? 150 : 0);
    console.log('');

    const backlog = await analyzeBacklog(cwd);
    const todoCount = backlog.todos.length;

    if (todoCount > 0) {
      await typewrite(c.boldCyan('Agent') + '  ', `I found ${c.boldYellow(String(todoCount))} TODOs scattered across your codebase:`, charDelay);
      console.log('');

      const sample = backlog.todos.slice(0, 5);
      const maxLen = Math.max(...sample.map(t => t.file.length));
      const todoLines = sample.map(todo =>
        `  ${c.dim(todo.file.padEnd(maxLen + 2))}${todo.type}: ${todo.text}`
      );
      if (todoCount > 5) todoLines.push(`  ${c.dim(`... and ${todoCount - 5} more`)}`);
      await revealLines(todoLines, isTTY ? 150 : 0);
      console.log('');
      await typewrite('  ', c.dimItalic("There's real work here, but no structure. Let's fix that."), charDelay);
    } else {
      await typewrite(c.boldCyan('Agent') + '  ', "Clean codebase \u2014 no scattered TODOs. Let's set up structure.", charDelay);
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
    await typewrite(c.boldCyan('Agent') + '  ', agentQ, charDelay);
    console.log('');
    await sleep(isTTY ? 500 : 0);

    const wrappedVision = wordWrap(answers.vision, 60);
    await typewrite(c.boldGreen('You') + '    ', wrappedVision, charDelay);
    console.log('');
    await sleep(pause);

    await typewrite(c.boldCyan('Agent') + '  ', `Got it. I've extracted your priorities: ${answers.priorities.join(', ')}.`, charDelay);
    console.log('');
    await sleep(pause);

    // Clarifying Q&A
    for (const cl of answers.clarifications) {
      await typewrite(c.boldCyan('Agent') + '  ', wordWrap(cl.question, 60), charDelay);
      console.log('');
      await sleep(isTTY ? 400 : 0);
      await typewrite(c.boldGreen('You') + '    ', wordWrap(cl.answer, 60), charDelay);
      console.log('');
      await sleep(pause);
    }

    // Create vision with full fields
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-demo-'));
    const vision = createVision({
      purpose: answers.vision,
      priorities: answers.priorities,
      audience: answers.audience,
      nonGoals: answers.nonGoals,
      techDirection: stackStr,
    }, tmpDir);

    await mcpCall('createVision()', '', pause, c);

    // Display vision (typed in)
    const visionFields = (aud: string, ng: string[]) => [
      { heading: 'Purpose', value: vision.purpose },
      { heading: 'Audience', value: aud },
      { heading: 'Priorities', value: answers.priorities.join(', ') },
      { heading: 'Non-goals', value: ng.join(', ') },
      { heading: 'Tech', value: stackStr },
    ];
    await typewriteVision(visionFields(answers.audience, answers.nonGoals), charDelay, c, isTTY);
    console.log('');
    await sleep(pause * 2);

    // Pushback
    await typewrite(c.boldGreen('You') + '    ', wordWrap(answers.pushback.comment, 60), charDelay);
    console.log('');
    await sleep(pause);

    // Revision
    await typewrite(c.boldCyan('Agent') + '  ', 'Good call. Let me update that.', charDelay);
    console.log('');

    const revised = answers.pushback.revised;
    updateVision({
      audience: revised.audience,
      nonGoals: revised.nonGoals,
    }, tmpDir);

    await mcpCall('updateVision()', '', pause, c);

    // Revised vision display
    await typewriteVision(
      visionFields(revised.audience ?? answers.audience, revised.nonGoals ?? answers.nonGoals),
      charDelay, c, isTTY,
    );
    console.log('');
    await sleep(pause);

    // Approval
    await typewrite(c.boldGreen('You') + '    ', answers.pushback.approval, charDelay);
    console.log('');
    await sleep(pause);
    await typewrite(c.boldCyan('Agent') + '  ', 'Locked in.', charDelay);
    console.log('');
    await sleep(pause * 2);

    // ─── Step 3: Roadmap Generation — The Wow Moment ───

    await typewrite(c.boldCyan('Agent') + '  ', 'Now let me map your backlog to your priorities...', charDelay);
    console.log('');

    const merged = mergeBacklogs(backlog);
    const roadmap = generateRoadmapFromVision(vision, merged);

    await mcpCall('generateRoadmapFromVision(vision, backlog)', '', pause, c);

    const matchLines = ['  Matching TODOs to vision priorities...'];
    for (const priority of answers.priorities) {
      const synonyms = PRIORITY_SYNONYMS[priority.toLowerCase()];
      if (synonyms) {
        matchLines.push(`    "${priority}"`.padEnd(20) + `\u2192 ${synonyms.slice(0, 4).join(', ')}`);
      }
    }
    await revealLines(matchLines, isTTY ? 150 : 0);
    console.log('');

    let matchedCount = 0;
    for (const sprint of roadmap.sprints) {
      if (sprint.theme.toLowerCase() !== 'general') {
        matchedCount += sprint.tickets
          .filter(t => !t.title.startsWith('Investigate and plan')).length;
      }
    }

    // Phase-based display with ticket overrides
    const overrides = answers.ticketOverrides ?? {};
    const cleanTitle = (key: string, raw: string): string => {
      if (overrides[key]) return overrides[key];
      return raw.replace(/^(TODO|FIXME|HACK):\s*/i, '');
    };

    for (const phase of roadmap.phases) {
      const phaseLines: string[] = [`  ${c.boldYellow(phase.name)}`];
      for (const sprintId of phase.sprints) {
        const sprint = roadmap.sprints.find(s => s.id === sprintId);
        if (!sprint) continue;
        phaseLines.push(`    ${c.dim(`Sprint ${sprint.id} (${sprint.tickets.length} ticket${sprint.tickets.length !== 1 ? 's' : ''}, par ${sprint.par})`)}`);
        const shown = sprint.tickets.slice(0, 5);
        const extra = sprint.tickets.length - shown.length;
        for (const t of shown) {
          phaseLines.push(`      ${c.dim(t.key)}  ${cleanTitle(t.key, t.title)}`);
        }
        if (extra > 0) phaseLines.push(`      ${c.dim(`... +${extra} more`)}`);
      }
      await revealLines(phaseLines, isTTY ? 150 : 0);
      console.log('');
    }

    console.log(`  Matched ${c.boldGreen(`${matchedCount}/${todoCount}`)} TODOs to your vision priorities.`);
    console.log('');
    await sleep(pause * 2);

    // ─── Step 4: Before/After Summary ───

    console.log('');
    const moduleCount = Object.keys(backlog.todosByModule).length;
    const prioritySprints = roadmap.sprints.filter(s => s.theme.toLowerCase() !== 'general').length;
    const firstTheme = roadmap.sprints[0]?.theme ?? 'Start';
    const themeDisplay = firstTheme.charAt(0).toUpperCase() + firstTheme.slice(1);

    const beforeLines = [
      c.dim(`${todoCount} scattered TODOs`),
      c.dim(`${moduleCount} module${moduleCount !== 1 ? 's' : ''}`),
      c.dim('No priorities'),
      c.dim('No structure'),
    ];
    const afterLines = [
      `${c.boldGreen('\u2713')} ${c.boldWhite('Vision locked in')}`,
      `${c.boldGreen('\u2713')} ${c.boldWhite(`${prioritySprints} priority sprint${prioritySprints !== 1 ? 's' : ''}`)}`,
      `${c.boldGreen('\u2713')} ${c.boldWhite(`${matchedCount}/${todoCount} TODOs mapped`)}`,
      `${c.boldGreen('\u2713')} ${c.boldWhite(`Sprint 1 (${themeDisplay}) ready`)}`,
    ];

    const comparison = sideBySide('Before', beforeLines, 'After', afterLines, c);
    await revealLines(comparison, isTTY ? 60 : 0);

    console.log('');
    await sleep(pause * 2);

    // ─── Step 5: What's Next ───

    await typewrite(c.boldCyan('Agent') + '  ', c.bold('Your agent is ready to execute Sprint 1.'), charDelay);
    await typewrite('       ', c.bold('Every sprint gets scored. Every ticket is tracked.'), charDelay);
    await typewrite('       ', c.bold("That's SLOPE \u2014 the AI agent harness."), charDelay);
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
