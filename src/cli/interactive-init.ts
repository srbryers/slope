// SLOPE — Unified Interactive Init (powered by @clack/prompts)
// Demo-quality onboarding: detection, vision conversation, roadmap, before/after, CTA.
// Returns InteractiveResult to init.ts for infrastructure setup.

import * as p from '@clack/prompts';
import { basename } from 'node:path';
import { buildInterviewContext } from '../core/interview-engine.js';
import { generateInterviewSteps } from '../core/interview-steps.js';
import { formatPreviewText } from '../core/metaphor-preview.js';
import { analyzeStack, detectPackageManager } from '../core/analyzers/stack.js';
import { analyzeBacklog } from '../core/analyzers/backlog.js';
import { mergeBacklogs } from '../core/analyzers/backlog-merged.js';
import { generateRoadmapFromVision, PRIORITY_SYNONYMS } from '../core/generators/roadmap.js';
import {
  createColors, renderVisionBox, sideBySide, renderCtaBox, renderRoadmapPhases, revealLines,
} from './display.js';
import type { InterviewStep, StepOption } from '../core/interview-steps.js';
import type { MetaphorPreview } from '../core/metaphor-preview.js';
import type { RoadmapDefinition } from '../core/roadmap.js';

// Ensure built-in metaphors are registered
import '../core/metaphors/index.js';

// --- Types ---

export interface InteractiveResult {
  projectName: string;
  metaphor: string;
  platforms: string[];
  vision: {
    purpose: string;
    priorities: string[];
    audience?: string;
    nonGoals?: string[];
    techDirection: string;
  };
  roadmap: RoadmapDefinition | null;  // null = use starter
  backlogStats: { todoCount: number; moduleCount: number; matchedCount: number } | null;
}

// --- Helpers ---

/**
 * Render a single interview step using the appropriate @clack/prompts widget.
 */
export async function renderStep(
  step: InterviewStep,
  _answers: Record<string, unknown>,
): Promise<unknown> {
  switch (step.type) {
    case 'text':
      return p.text({
        message: step.question,
        placeholder: step.description,
        defaultValue: typeof step.default === 'string' ? step.default : undefined,
        validate: step.validate
          ? (v) => step.validate!(v) ?? undefined
          : undefined,
      });

    case 'select':
      return p.select({
        message: step.question,
        options: (step.options ?? []).map((o) => ({
          value: o.value,
          label: o.hint ? `${o.label} ${o.hint}` : o.label,
          hint: o.description,
        })),
        initialValue: typeof step.default === 'string' ? step.default : undefined,
      });

    case 'multiselect':
      return p.multiselect({
        message: step.question,
        options: (step.options ?? []).map((o) => ({
          value: o.value,
          label: o.hint ? `${o.label} ${o.hint}` : o.label,
          hint: o.description,
        })),
        initialValues: Array.isArray(step.default) ? step.default : [],
        required: false,
      });

    case 'confirm':
      return p.confirm({
        message: step.question,
        initialValue: typeof step.default === 'boolean' ? step.default : false,
      });

    default:
      return p.text({ message: step.question });
  }
}

/**
 * Build a summary string from collected answers and context.
 * Kept for backward compatibility and agent mode.
 */
export function buildSummary(
  answers: Record<string, unknown>,
  _ctx: { detected: { detectedPlatforms: string[] } },
): string {
  const lines: string[] = [];
  lines.push(`Project:   ${answers['project-name'] ?? '(not set)'}`);
  lines.push(`Metaphor:  ${answers['metaphor'] ?? 'golf'}`);

  const repoUrl = String(answers['repo-url'] ?? '').trim();
  if (repoUrl) lines.push(`Repo:      ${repoUrl}`);

  lines.push(`Sprint:    ${answers['sprint-number'] ?? '1'}`);

  const platformsRaw = answers['platforms'];
  const platforms = Array.isArray(platformsRaw) ? platformsRaw as string[] : undefined;
  if (platforms && platforms.length > 0) {
    lines.push(`Platforms: ${platforms.join(', ')}`);
  }

  const team = String(answers['team-members'] ?? '').trim();
  if (team) lines.push(`Team:      ${team}`);

  const vision = String(answers['vision'] ?? '').trim();
  if (vision) lines.push(`Vision:    ${vision}`);

  return lines.join('\n');
}

/** Check if a prompt result was cancelled */
function cancelled(value: unknown): boolean {
  return p.isCancel(value);
}

// --- Main Flow ---

/**
 * Run the unified interactive init flow.
 * Returns InteractiveResult for init.ts to handle infrastructure, or null if cancelled.
 */
export async function runInteractiveCli(cwd: string): Promise<InteractiveResult | null> {
  const isTTY = process.stdout.isTTY ?? false;
  const c = createColors(isTTY);

  // ─── Phase 1: Intro + Detection ───

  p.intro('SLOPE');
  console.log('  The AI agent harness.');
  console.log('  Structure. Accountability. Results.');
  console.log('');

  const s = p.spinner();
  s.start('Analyzing project...');

  const ctx = buildInterviewContext(cwd);
  const projectName = ctx.detected.projectName ?? basename(cwd);
  const pm = detectPackageManager(cwd);
  const stack = await analyzeStack(cwd);
  const backlog = await analyzeBacklog(cwd);

  s.stop('Project detected');

  const displayFrameworks = stack.frameworks
    .filter(f => !['vitest', 'jest', 'mocha'].includes(f));
  const stackParts = [stack.primaryLanguage, ...displayFrameworks].filter(Boolean);
  const stackStr = stackParts.length > 1
    ? `${stackParts[0]} \u00b7 ${stackParts.slice(1).join(', ')}`
    : stackParts[0] || 'Unknown';

  console.log('');
  console.log(`  ${c.dim('Project:')}  ${c.boldWhite(projectName)}`);
  console.log(`  ${c.dim('Stack:')}    ${c.boldWhite(stackStr)}`);
  if (pm) console.log(`  ${c.dim('PM:')}       ${c.boldWhite(pm)}`);

  const todoCount = backlog.todos.length;
  if (todoCount > 0) {
    console.log('');
    console.log(`  Found ${c.boldYellow(String(todoCount))} TODOs scattered across your codebase:`);
    const sample = backlog.todos.slice(0, 5);
    const maxLen = Math.max(...sample.map(t => t.file.length));
    for (const todo of sample) {
      console.log(`    ${c.dim(todo.file.padEnd(maxLen + 2))}${todo.type}: ${todo.text}`);
    }
    if (todoCount > 5) console.log(`    ${c.dim(`... and ${todoCount - 5} more`)}`);
  }
  console.log('');

  // ─── Phase 2: Quick Config ───

  // Use interview steps for project-name, metaphor, platforms
  const steps = generateInterviewSteps(ctx);

  // Project name
  const nameStep = steps.find(st => st.id === 'project-name')!;
  const nameVal = await renderStep(nameStep, {});
  if (cancelled(nameVal)) { p.cancel('Init cancelled.'); return null; }
  const finalName = String(nameVal).trim() || projectName;

  // Metaphor
  const metaphorStep = steps.find(st => st.id === 'metaphor')!;
  const metaphorVal = await renderStep(metaphorStep, {});
  if (cancelled(metaphorVal)) { p.cancel('Init cancelled.'); return null; }
  const metaphor = String(metaphorVal) || 'golf';

  // Show metaphor preview
  if (metaphor !== 'custom') {
    const opt = metaphorStep.options?.find((o: StepOption) => o.value === metaphor);
    const preview = opt?.preview as MetaphorPreview | undefined;
    if (preview) {
      p.note(formatPreviewText(preview), `${preview.name} Preview`);
    }
  }

  // Platforms
  const platformStep = steps.find(st => st.id === 'platforms')!;
  const platformVal = await renderStep(platformStep, {});
  if (cancelled(platformVal)) { p.cancel('Init cancelled.'); return null; }
  const platforms = Array.isArray(platformVal) ? platformVal as string[] : [];

  // ─── Phase 3: Vision Conversation ───

  const visionText = await p.text({
    message: "Tell me about your vision for this project.\nWhat's it for, who uses it, why does it matter?",
    placeholder: 'Get free and loose with it — describe what you\'re trying to achieve.',
    validate: (v) => {
      if (!v || !v.trim()) return 'Vision is required — even a sentence helps shape your roadmap.';
      return undefined;
    },
  });
  if (cancelled(visionText)) { p.cancel('Init cancelled.'); return null; }

  // Priorities multiselect
  const prioritiesVal = await p.multiselect({
    message: 'What are your top priorities?',
    options: [
      { value: 'speed', label: 'Speed / Performance' },
      { value: 'reliability', label: 'Reliability' },
      { value: 'ux', label: 'UX' },
      { value: 'security', label: 'Security' },
      { value: 'scalability', label: 'Scalability' },
      { value: 'dx', label: 'Developer Experience' },
      { value: 'testing', label: 'Testing' },
      { value: 'observability', label: 'Observability' },
      { value: 'documentation', label: 'Documentation' },
    ],
    required: false,
  });
  if (cancelled(prioritiesVal)) { p.cancel('Init cancelled.'); return null; }
  const priorities = Array.isArray(prioritiesVal) ? prioritiesVal as string[] : [];

  // Audience (optional)
  const audienceVal = await p.text({
    message: "Who's the target audience? (optional)",
    placeholder: 'e.g., Time-poor professionals who consume briefings on mobile',
  });
  if (cancelled(audienceVal)) { p.cancel('Init cancelled.'); return null; }
  const audience = String(audienceVal ?? '').trim();

  // Non-goals (optional)
  const nonGoalsVal = await p.text({
    message: 'Anything explicitly out of scope? (optional, comma-separated)',
    placeholder: 'e.g., Social features, real-time collaboration, multi-language',
  });
  if (cancelled(nonGoalsVal)) { p.cancel('Init cancelled.'); return null; }
  const nonGoalsStr = String(nonGoalsVal ?? '').trim();
  const nonGoals = nonGoalsStr
    ? nonGoalsStr.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  // ─── Phase 4: Vision Display + Confirmation ───

  let currentVision = {
    purpose: String(visionText),
    priorities: [...priorities],
    audience,
    nonGoals: [...nonGoals],
    techDirection: stackStr,
  };

  // Vision edit loop
  let confirmed = false;
  while (!confirmed) {
    console.log('');
    const visionFields = [
      { heading: 'Purpose', value: currentVision.purpose },
      ...(currentVision.audience ? [{ heading: 'Audience', value: currentVision.audience }] : []),
      { heading: 'Priorities', value: currentVision.priorities.length > 0 ? currentVision.priorities.join(', ') : '(none selected)' },
      ...(currentVision.nonGoals.length > 0 ? [{ heading: 'Non-goals', value: currentVision.nonGoals.join(', ') }] : []),
      { heading: 'Tech', value: currentVision.techDirection },
    ];
    renderVisionBox(visionFields, c, isTTY);
    console.log('');

    const editChoice = await p.select({
      message: 'Does this look right?',
      options: [
        { value: 'confirm', label: "Yes, let's go" },
        { value: 'purpose', label: 'Edit vision' },
        { value: 'priorities', label: 'Edit priorities' },
        { value: 'audience', label: 'Edit audience' },
        { value: 'nonGoals', label: 'Edit non-goals' },
      ],
    });
    if (cancelled(editChoice)) { p.cancel('Init cancelled.'); return null; }

    if (editChoice === 'confirm') {
      confirmed = true;
    } else if (editChoice === 'purpose') {
      const newVal = await p.text({
        message: 'Updated vision:',
        defaultValue: currentVision.purpose,
        validate: (v) => v && v.trim() ? undefined : 'Vision cannot be empty.',
      });
      if (cancelled(newVal)) { p.cancel('Init cancelled.'); return null; }
      currentVision.purpose = String(newVal);
    } else if (editChoice === 'priorities') {
      const newVal = await p.multiselect({
        message: 'Updated priorities:',
        options: [
          { value: 'speed', label: 'Speed / Performance' },
          { value: 'reliability', label: 'Reliability' },
          { value: 'ux', label: 'UX' },
          { value: 'security', label: 'Security' },
          { value: 'scalability', label: 'Scalability' },
          { value: 'dx', label: 'Developer Experience' },
          { value: 'testing', label: 'Testing' },
          { value: 'observability', label: 'Observability' },
          { value: 'documentation', label: 'Documentation' },
        ],
        initialValues: currentVision.priorities,
        required: false,
      });
      if (cancelled(newVal)) { p.cancel('Init cancelled.'); return null; }
      currentVision.priorities = Array.isArray(newVal) ? newVal as string[] : [];
    } else if (editChoice === 'audience') {
      const newVal = await p.text({
        message: 'Updated audience:',
        defaultValue: currentVision.audience,
      });
      if (cancelled(newVal)) { p.cancel('Init cancelled.'); return null; }
      currentVision.audience = String(newVal ?? '').trim();
    } else if (editChoice === 'nonGoals') {
      const newVal = await p.text({
        message: 'Updated non-goals (comma-separated):',
        defaultValue: currentVision.nonGoals.join(', '),
      });
      if (cancelled(newVal)) { p.cancel('Init cancelled.'); return null; }
      const raw = String(newVal ?? '').trim();
      currentVision.nonGoals = raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
    }
  }

  // ─── Phase 5: Roadmap Generation ───

  let roadmap: RoadmapDefinition | null = null;
  let matchedCount = 0;

  if (todoCount > 0 && currentVision.priorities.length > 0) {
    const s2 = p.spinner();
    s2.start('Matching TODOs to vision priorities...');
    const merged = mergeBacklogs(backlog);
    roadmap = generateRoadmapFromVision(
      {
        purpose: currentVision.purpose,
        priorities: currentVision.priorities,
        audience: currentVision.audience,
        techDirection: currentVision.techDirection,
        nonGoals: currentVision.nonGoals,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      merged,
    );
    s2.stop('Roadmap generated');

    // Show priority matching
    console.log('');
    const matchLines: string[] = [];
    for (const priority of currentVision.priorities) {
      const synonyms = PRIORITY_SYNONYMS[priority.toLowerCase()];
      if (synonyms) {
        matchLines.push(`    "${priority}"`.padEnd(20) + `\u2192 ${synonyms.slice(0, 4).join(', ')}`);
      }
    }
    if (matchLines.length > 0) {
      await revealLines(matchLines, 0);
      console.log('');
    }

    // Count matched TODOs
    for (const sprint of roadmap.sprints) {
      if (sprint.theme.toLowerCase() !== 'general') {
        matchedCount += sprint.tickets
          .filter(t => !t.title.startsWith('Investigate and plan')).length;
      }
    }

    // Show roadmap phases
    const phaseLines = renderRoadmapPhases(roadmap, c);
    await revealLines(phaseLines, 0);

    console.log(`  Matched ${c.boldGreen(`${matchedCount}/${todoCount}`)} TODOs to your vision priorities.`);
    console.log('');
  }

  // ─── Phase 6: Before/After ───

  if (todoCount > 0 && roadmap) {
    const moduleCount = Object.keys(backlog.todosByModule).length;
    const prioritySprints = roadmap.sprints.filter(s2 => s2.theme.toLowerCase() !== 'general').length;
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
    await revealLines(comparison, 0);
    console.log('');
  }

  return {
    projectName: finalName,
    metaphor,
    platforms,
    vision: currentVision,
    roadmap,
    backlogStats: todoCount > 0
      ? { todoCount, moduleCount: Object.keys(backlog.todosByModule).length, matchedCount }
      : null,
  };
}

/**
 * Render post-setup display: files created list and CTA box.
 * Called by init.ts after infrastructure setup completes.
 */
export function renderPostSetup(
  result: InteractiveResult,
  filesCreated: string[],
): void {
  const isTTY = process.stdout.isTTY ?? false;
  const c = createColors(isTTY);

  // Files created
  if (filesCreated.length > 0) {
    p.note(filesCreated.map(f => `  ${f}`).join('\n'), 'Files created');
  }

  // CTA box — only show tools matching selected platforms
  const slopePrompt = 'Run slope briefing, then plan Sprint 1.';
  const toolMap: Record<string, { name: string; cmd: string }> = {
    'claude-code': { name: 'Claude Code', cmd: `$ claude "${slopePrompt}"` },
    'cursor': { name: 'Cursor', cmd: `> ${slopePrompt}` },
    'windsurf': { name: 'Windsurf', cmd: `> ${slopePrompt}` },
    'cline': { name: 'Cline', cmd: `> ${slopePrompt}` },
    'opencode': { name: 'OpenCode', cmd: `$ opencode "${slopePrompt}"` },
  };

  const tools = result.platforms
    .map(p2 => toolMap[p2])
    .filter((t): t is { name: string; cmd: string } => t !== undefined);

  // Fallback: if no platforms selected, show Claude Code
  if (tools.length === 0) {
    tools.push(toolMap['claude-code']);
  }

  console.log('');
  renderCtaBox(tools, c);
  console.log('');

  p.outro('slope.sh');
}
