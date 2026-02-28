// SLOPE — Rich Interactive Init (powered by @clack/prompts)
// Renders interview steps as select menus, text inputs, and confirm dialogs.

import * as p from '@clack/prompts';
import { buildInterviewContext } from '../core/interview-engine.js';
import { generateInterviewSteps } from '../core/interview-steps.js';
import { initFromAnswers } from '../core/interview.js';
import { formatPreviewText } from '../core/metaphor-preview.js';
import type { InterviewStep, StepOption } from '../core/interview-steps.js';
import type { MetaphorPreview } from '../core/metaphor-preview.js';

// Ensure built-in metaphors are registered
import '../core/metaphors/index.js';

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

/**
 * Run the full interactive init flow using @clack/prompts.
 */
export async function runInteractiveCli(cwd: string): Promise<void> {
  p.intro('slope init');

  // 1. Lightweight detection with spinner
  const s = p.spinner();
  s.start('Detecting project info...');
  const ctx = buildInterviewContext(cwd);
  s.stop('Project detected');

  // 2. Walk through interview steps
  const steps = generateInterviewSteps(ctx);
  const answers: Record<string, unknown> = {};

  for (const step of steps) {
    if (step.condition && !step.condition(answers)) continue;
    const value = await renderStep(step, answers);
    if (p.isCancel(value)) {
      p.cancel('Init cancelled.');
      process.exit(0);
    }
    answers[step.id] = value;

    // Show metaphor preview after selection
    if (step.id === 'metaphor' && value !== 'custom') {
      const opt = step.options?.find((o: StepOption) => o.value === value);
      const preview = opt?.preview as MetaphorPreview | undefined;
      if (preview) {
        p.note(formatPreviewText(preview), `${preview.name} Preview`);
      }
    }
  }

  // 3. Summary + confirm
  p.note(buildSummary(answers, ctx), 'Init Summary');
  const confirmed = await p.confirm({ message: 'Create project?' });
  if (!confirmed || p.isCancel(confirmed)) {
    p.cancel('Init cancelled.');
    process.exit(0);
  }

  // 4. Run init with spinner
  s.start('Initializing project...');
  const platformsVal = answers.platforms;
  const result = await initFromAnswers(cwd, answers, Array.isArray(platformsVal) ? platformsVal as string[] : undefined);
  s.stop('Project initialized');

  if (!result.success) {
    p.log.error('Initialization failed:');
    for (const e of result.errors) {
      p.log.error(`  ${e.field}: ${e.message}`);
    }
    process.exit(1);
  }

  // 5. Print what was created
  p.note(result.filesCreated.map((f: string) => `  ${f}`).join('\n'), 'Files created');
  p.outro('Done! Run `slope briefing` to get started.');
}
