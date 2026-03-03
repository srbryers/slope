// SLOPE — slope demo: scripted onboarding showcase for video recordings
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import * as p from '@clack/prompts';
import { runAnalyzers, loadRepoProfile } from '../../core/analyzers/index.js';
import { estimateComplexity } from '../../core/analyzers/complexity.js';
import { detectPackageManager } from '../../core/analyzers/stack.js';
import { analyzeBacklog } from '../../core/analyzers/backlog.js';
import { mergeBacklogs } from '../../core/analyzers/backlog-merged.js';
import { createVision, updateVision } from '../../core/vision.js';
import { generateRoadmapFromVision, PRIORITY_SYNONYMS } from '../../core/generators/roadmap.js';
import {
  createColors, sleep, wordWrap,
  typewrite, mcpCall, revealLines, typewriteVision,
  renderProfileSummary, sideBySide, renderCtaBox, renderRoadmapPhases,
} from '../display.js';

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

// --- Narrator pause config ---

/** Narrator pause windows (ms) keyed by CUE ID. Used by --narrated flag. */
export const NARRATOR_CUE_PAUSES: Record<string, number> = {
  '1a': 6000, '1b': 6000,
  '2':  6000,
  '3a': 6000, '3b': 6000, '3c': 6000, '3d': 5000, '3e': 6000,
  '4a': 6000, '4b': 4000, '4c': 6000, '4d': 4000, '4e': 3000,
  '5a': 5000, '5b': 6000, '5c': 5000, '5d': 3000,
  '6a': 4000, '6b': 4000,
};

/** Narrator voiceover text keyed by CUE ID, matching NARRATOR_CUE_PAUSES. */
export const NARRATOR_SEGMENTS: Record<string, { text: string; label: string }> = {
  '1a': { label: 'hook',     text: "This is SLOPE, the AI agent harness. I'm going to set it up on a real project." },
  '1b': { label: 'scan',     text: 'It scans the codebase — stack, structure, test coverage, CI. A full profile of where the project stands today.' },
  '2':  { label: 'todo',     text: "One TODO here, but on bigger projects that's hundreds. No structure, no priorities. That's what we're fixing." },
  '3a': { label: 'vision',   text: "It asks you to describe your vision. SLOPE recommends dictating — just talk naturally about what you're building and why." },
  '3b': { label: 'priorities', text: "It pulls out the priorities automatically. You don't rank them in a form — you talk, it listens." },
  '3c': { label: 'clarify',  text: 'Follow-up questions — not generic ones. Based on what it found in the codebase and what you just said.' },
  '3d': { label: 'bottleneck', text: "Delivery is the bottleneck. If it's late, nothing else matters. SLOPE is going to remember that." },
  '3e': { label: 'gap',      text: 'No tests, no CI. The founder knows it. SLOPE picked up the gap from the profile scan and asked directly.' },
  '4a': { label: 'structure', text: 'It structures everything into a vision document — purpose, audience, priorities, non-goals. All from one conversation.' },
  '4b': { label: 'checkin',  text: 'And it checks in. You get to push back.' },
  '4c': { label: 'pushback', text: "Audience was too narrow, a couple of non-goals missing. Small corrections, but they'll drive every sprint after this." },
  '4d': { label: 'updated',  text: 'Updated instantly. No re-doing a form.' },
  '4e': { label: 'locked',   text: 'Vision locked. Watch what happens next.' },
  '5a': { label: 'roadmap',  text: 'It takes the vision, the profile, and generates a sprint roadmap. Each priority maps to real work.' },
  '5b': { label: 'sprint1',  text: 'Sprint 1 focuses on speed — the delivery cron, the processing pipeline. Tickets come from priorities and profile gaps.' },
  '5c': { label: 'sprints',  text: 'Testing, reliability, documentation — each gets its own sprint. Real tickets. Ready to execute.' },
  '5d': { label: 'done',     text: 'Five sprints, mapped to what the founder said matters.' },
  '6a': { label: 'before-after', text: 'Before: no priorities, no structure. After: vision locked, five sprints, Sprint 1 ready.' },
  '6b': { label: 'closing',  text: 'One conversation. Structure, accountability, and a scored roadmap.' },
};

// --- Speed config ---

const SPEED: Record<string, number> = { slow: 30, normal: 15, fast: 3 };

// --- Args ---

function parseArgs(args: string[]) {
  let project = process.cwd();
  let answers = '';
  let speed = 'normal';
  let help = false;
  let narrated = false;
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--narrated') narrated = true;
    else if (arg.startsWith('--project=')) project = arg.slice('--project='.length);
    else if (arg.startsWith('--answers=')) answers = arg.slice('--answers='.length);
    else if (arg.startsWith('--speed=')) speed = arg.slice('--speed='.length);
  }
  return { project, answers, speed, help, narrated };
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
  --narrated                 Insert longer pauses for voiceover narration
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
  const nPause = (ms: number) => sleep(opts.narrated ? ms : 0);
  let tmpDir: string | null = null;

  try {
    // ─── Step 1: The Problem — Show Scattered TODOs ───

    p.note(
      'The AI agent harness.\nStructure. Accountability. Results.',
      'SLOPE'
    );
    console.log('');
    await nPause(NARRATOR_CUE_PAUSES['1a']); // CUE 1a: "This is SLOPE..."
    await typewrite(c.boldCyan('Agent') + '  ', 'Let me take a look at this project...', charDelay);
    console.log('');

    const pm = detectPackageManager(cwd);
    await mcpCall('detectPackageManager()', pm ? `"${pm}"` : '"unknown"', pause, c);

    let profile = loadRepoProfile(cwd);
    if (!profile) {
      profile = await runAnalyzers({ cwd });
    }
    const complexity = estimateComplexity(profile);
    const stack = profile.stack;
    const displayFrameworks = stack.frameworks
      .filter(f => !['vitest', 'jest', 'mocha'].includes(f));
    const stackParts = [stack.primaryLanguage, ...displayFrameworks].filter(Boolean);
    const stackStr = stackParts.length > 1
      ? `${stackParts[0]} \u00b7 ${stackParts.slice(1).join(', ')}`
      : stackParts[0] || 'Unknown';
    await mcpCall('runAnalyzers()', stackStr, pause, c);

    console.log('');
    const statsLines = [
      `  ${c.dim('Project:')}  ${c.boldWhite(projectName)}`,
      ...renderProfileSummary(profile, c),
      ...(pm ? [`  ${c.dim('PM:')}        ${c.boldWhite(pm)}`] : []),
    ];
    await revealLines(statsLines, isTTY ? 150 : 0);
    console.log('');
    await nPause(NARRATOR_CUE_PAUSES['1b']); // CUE 1b: "It scans the codebase..."

    const backlog = await analyzeBacklog(cwd);
    const todoCount = backlog.todos.length;

    if (todoCount > 0) {
      await typewrite(c.boldCyan('Agent') + '  ', `I found ${c.boldYellow(String(todoCount))} TODO${todoCount !== 1 ? 's' : ''} scattered across your codebase:`, charDelay);
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
    await nPause(NARRATOR_CUE_PAUSES['2']); // CUE 2: "One TODO here..."
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
    await nPause(NARRATOR_CUE_PAUSES['3a']); // CUE 3a: "It asks you to describe your vision..."
    await sleep(isTTY ? 500 : 0);

    const wrappedVision = wordWrap(answers.vision, 60);
    await typewrite(c.boldGreen('You') + '    ', wrappedVision, charDelay);
    console.log('');
    await sleep(pause);

    await typewrite(c.boldCyan('Agent') + '  ', `Got it. I've extracted your priorities: ${answers.priorities.join(', ')}.`, charDelay);
    console.log('');
    await nPause(NARRATOR_CUE_PAUSES['3b']); // CUE 3b: "It pulls out the priorities..."
    await sleep(pause);

    // Clarifying Q&A — narrator cues after each Q and A
    for (let ci = 0; ci < answers.clarifications.length; ci++) {
      const cl = answers.clarifications[ci];
      await typewrite(c.boldCyan('Agent') + '  ', wordWrap(cl.question, 60), charDelay);
      console.log('');
      if (ci === 0) await nPause(NARRATOR_CUE_PAUSES['3c']); // CUE 3c: "Follow-up questions..."
      await sleep(isTTY ? 400 : 0);
      await typewrite(c.boldGreen('You') + '    ', wordWrap(cl.answer, 60), charDelay);
      console.log('');
      await nPause(NARRATOR_CUE_PAUSES['3d']); // CUE 3d/3e: answer commentary
      await sleep(pause);
    }

    // Create vision with full fields
    await typewrite(c.boldCyan('Agent') + '  ', "Great. Let me structure that into a vision document.", charDelay);
    console.log('');

    tmpDir = mkdtempSync(join(tmpdir(), 'slope-demo-'));
    const vision = createVision({
      purpose: answers.vision,
      priorities: answers.priorities,
      audience: answers.audience,
      nonGoals: answers.nonGoals,
      techDirection: stackStr,
    }, tmpDir);

    await mcpCall('createVision()', '', pause, c);
    console.log('');

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
    await nPause(NARRATOR_CUE_PAUSES['4a']); // CUE 4a: "It structures everything..."
    await sleep(pause);

    await typewrite(c.boldCyan('Agent') + '  ', "How does that look? Anything you'd change?", charDelay);
    console.log('');
    await nPause(NARRATOR_CUE_PAUSES['4b']); // CUE 4b: "And it checks in..."
    await sleep(pause);

    // Pushback
    await typewrite(c.boldGreen('You') + '    ', wordWrap(answers.pushback.comment, 60), charDelay);
    console.log('');
    await nPause(NARRATOR_CUE_PAUSES['4c']); // CUE 4c: "Audience was too narrow..."
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
    await nPause(NARRATOR_CUE_PAUSES['4d']); // CUE 4d: "Updated instantly..."
    await sleep(pause);

    // Approval
    await typewrite(c.boldGreen('You') + '    ', answers.pushback.approval, charDelay);
    console.log('');
    await sleep(pause);
    await typewrite(c.boldCyan('Agent') + '  ', 'Locked in.', charDelay);
    console.log('');
    await nPause(NARRATOR_CUE_PAUSES['4e']); // CUE 4e: "Vision locked..."
    await sleep(pause * 2);

    // ─── Step 3: Roadmap Generation — The Wow Moment ───

    await typewrite(c.boldCyan('Agent') + '  ', 'Now let me map your backlog to your priorities...', charDelay);
    console.log('');

    const merged = mergeBacklogs(backlog);
    const roadmap = generateRoadmapFromVision(vision, merged, complexity, profile);

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
    await nPause(NARRATOR_CUE_PAUSES['5a']); // CUE 5a: "It takes the vision..."

    let matchedCount = 0;
    for (const sprint of roadmap.sprints) {
      if (sprint.theme.toLowerCase() !== 'general') {
        matchedCount += sprint.tickets
          .filter(t => !t.title.startsWith('Investigate and plan')).length;
      }
    }

    // Phase-based display with ticket overrides — split into groups for narrator pauses
    const overrides = answers.ticketOverrides ?? {};
    const phaseLines = renderRoadmapPhases(roadmap, c, overrides);

    // Split phaseLines into groups at blank-line boundaries (between phases)
    const phaseGroups: string[][] = [];
    let currentGroup: string[] = [];
    for (const line of phaseLines) {
      if (line === '' && currentGroup.length > 0) {
        currentGroup.push('');
        phaseGroups.push(currentGroup);
        currentGroup = [];
      } else {
        currentGroup.push(line);
      }
    }
    if (currentGroup.length > 0) phaseGroups.push(currentGroup);

    // Reveal each group with narrator pauses between them
    // CUE 5b after first group, CUE 5c after middle groups, CUE 5d after last
    const narratorRoadmapPauses = [NARRATOR_CUE_PAUSES['5b'], NARRATOR_CUE_PAUSES['5c'], NARRATOR_CUE_PAUSES['5d']];
    for (let gi = 0; gi < phaseGroups.length; gi++) {
      await revealLines(phaseGroups[gi], isTTY ? 150 : 0);
      const pauseIdx = gi === 0 ? 0 : gi >= phaseGroups.length - 1 ? 2 : 1;
      await nPause(narratorRoadmapPauses[pauseIdx]);
    }

    if (todoCount > 0) {
      console.log(`  Matched ${c.boldGreen(`${Math.min(matchedCount, todoCount)}/${todoCount}`)} TODO${todoCount !== 1 ? 's' : ''} to your vision priorities.`);
    }
    console.log('');
    await sleep(pause * 2);

    // ─── Step 4: Before/After Summary ───

    console.log('');
    const moduleCount = Object.keys(backlog.todosByModule).length;
    const prioritySprints = roadmap.sprints.filter(s => s.theme.toLowerCase() !== 'general').length;
    const firstTheme = roadmap.sprints[0]?.theme ?? 'Start';
    const themeDisplay = firstTheme.charAt(0).toUpperCase() + firstTheme.slice(1);

    const beforeLines = todoCount > 0
      ? [
          c.dim(`${todoCount} scattered TODO${todoCount !== 1 ? 's' : ''}`),
          c.dim(`${moduleCount} module${moduleCount !== 1 ? 's' : ''}`),
          c.dim('No priorities'),
          c.dim('No structure'),
        ]
      : [
          c.dim(`${profile.structure.sourceFiles} source files`),
          c.dim('No priorities'),
          c.dim('No roadmap'),
          c.dim('No structure'),
        ];
    const afterLines = [
      `${c.boldGreen('\u2713')} ${c.boldWhite('Vision locked in')}`,
      `${c.boldGreen('\u2713')} ${c.boldWhite(`${prioritySprints} priority sprint${prioritySprints !== 1 ? 's' : ''}`)}`,
      ...(todoCount > 0
        ? [`${c.boldGreen('\u2713')} ${c.boldWhite(`${Math.min(matchedCount, todoCount)}/${todoCount} TODO${todoCount !== 1 ? 's' : ''} mapped`)}`]
        : []),
      `${c.boldGreen('\u2713')} ${c.boldWhite(`Sprint 1 (${themeDisplay}) ready`)}`,
    ];

    const comparison = sideBySide('Before', beforeLines, 'After', afterLines, c);
    await revealLines(comparison, isTTY ? 60 : 0);

    console.log('');
    await nPause(NARRATOR_CUE_PAUSES['6a']); // CUE 6a: "Before: no priorities..."
    await sleep(pause * 2);

    // ─── Step 5: What's Next ───

    await typewrite(c.boldCyan('Agent') + '  ', c.bold('Your agent is ready to execute Sprint 1.'), charDelay);
    await typewrite('       ', c.bold('Every sprint gets scored. Every ticket is tracked.'), charDelay);
    await typewrite('       ', c.bold("That's SLOPE \u2014 the AI agent harness."), charDelay);
    console.log('');
    await sleep(pause);

    await typewrite(c.boldCyan('Agent') + '  ', 'Get started:', charDelay);
    console.log('');
    const slopePrompt = 'Run slope briefing, then plan Sprint 1.';
    renderCtaBox([
      { name: 'Claude Code', cmd: `$ claude "${slopePrompt}"` },
      { name: 'Cursor', cmd: `> ${slopePrompt}` },
      { name: 'OpenCode', cmd: `$ opencode "${slopePrompt}"` },
    ], c);
    console.log('');
    await nPause(NARRATOR_CUE_PAUSES['6b']); // CUE 6b: "One conversation..."

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
