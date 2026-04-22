// SLOPE — Interview CLI Command
// Human and agent-native modes for the project interview.

import * as p from '@clack/prompts';
import { buildInterviewContext, InterviewStateMachine } from '../../core/index.js';
import { generateInterviewSteps } from '../../core/interview-steps.js';
import { initFromAnswers } from '../../core/interview.js';
import { formatPreviewText } from '../../core/metaphor-preview.js';
import type { InterviewStep, StepOption } from '../../core/interview-steps.js';
import type { MetaphorPreview } from '../../core/metaphor-preview.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Ensure built-in metaphors are registered
import '../../core/metaphors/index.js';

/**
 * Render a single interview step using the appropriate @clack/prompts widget.
 */
async function renderStep(
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

function buildSummary(
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

/** Run the interview in human-interactive mode */
async function runHumanMode(cwd: string): Promise<void> {
  p.intro('slope interview');

  const s = p.spinner();
  s.start('Detecting project info...');
  const ctx = buildInterviewContext(cwd);
  s.stop('Project detected');

  const steps = generateInterviewSteps(ctx);
  const sm = new InterviewStateMachine(steps);

  let step: InterviewStep | null;
  while ((step = sm.nextQuestion()) !== null) {
    const value = await renderStep(step, sm.getResultUnknown());
    if (p.isCancel(value)) {
      p.cancel('Interview cancelled.');
      process.exit(0);
    }

    const submitResult = sm.submitAnswer(step.id, value);
    if (!submitResult.success) {
      p.log.error(`Validation error: ${submitResult.error}`);
      process.exit(1);
    }

    if (step.id === 'metaphor' && value !== 'custom') {
      const opt = step.options?.find((o: StepOption) => o.value === value);
      const preview = opt?.preview as MetaphorPreview | undefined;
      if (preview) {
        p.note(formatPreviewText(preview), `${preview.name} Preview`);
      }
    }
  }

  const answers = sm.getResultUnknown();
  p.note(buildSummary(answers, ctx), 'Interview Summary');
  const confirmed = await p.confirm({ message: 'Create project?' });
  if (!confirmed || p.isCancel(confirmed)) {
    p.cancel('Interview cancelled.');
    process.exit(0);
  }

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

  p.note(result.filesCreated.map((f: string) => `  ${f}`).join('\n'), 'Files created');
  p.outro('Done! Run `slope briefing` to get started.');
}

/** JSON-serializable question for agent mode */
interface AgentQuestion {
  type: 'question';
  id: string;
  question: string;
  kind: string;
  description?: string;
  options?: Array<{ value: string; label: string; description?: string }>;
  default?: unknown;
  required?: boolean;
}

/** JSON-serializable completion for agent mode */
interface AgentComplete {
  type: 'complete';
  filesCreated: string[];
  configPath: string;
  providers: string[];
}

/** JSON-serializable error for agent mode */
interface AgentError {
  type: 'error';
  errors: Array<{ field: string; message: string }>;
}

/** Run the interview in agent JSON mode */
async function runAgentMode(cwd: string): Promise<void> {
  const ctx = buildInterviewContext(cwd);
  const steps = generateInterviewSteps(ctx);
  const sm = new InterviewStateMachine(steps);

  // Seed _mode so conditional steps (e.g. deep-analysis) are skipped in agent mode
  const state = sm.getState();
  state.answers._mode = 'agent';
  sm.restoreState(state);

  const step = sm.nextQuestion();
  if (!step) {
    const out: AgentComplete = { type: 'complete', filesCreated: [], configPath: '', providers: [] };
    console.log(JSON.stringify(out));
    return;
  }

  emitQuestion(step);

  for await (const line of readStdinLines()) {
    let parsed: { id: string; value: unknown };
    try {
      parsed = JSON.parse(line);
    } catch {
      const out: AgentError = { type: 'error', errors: [{ field: '_input', message: 'Invalid JSON' }] };
      console.log(JSON.stringify(out));
      return;
    }

    const submitResult = sm.submitAnswer(parsed.id, parsed.value);
    if (!submitResult.success) {
      const out: AgentError = { type: 'error', errors: [{ field: parsed.id, message: submitResult.error }] };
      console.log(JSON.stringify(out));
      return;
    }

    const next = sm.nextQuestion();
    if (!next) {
      // Interview complete — run init
      const answers = sm.getResultUnknown();
      const platformsVal = answers.platforms;
      const result = await initFromAnswers(cwd, answers, Array.isArray(platformsVal) ? platformsVal as string[] : undefined);
      if (!result.success) {
        const out: AgentError = { type: 'error', errors: result.errors };
        console.log(JSON.stringify(out));
        return;
      }
      const out: AgentComplete = {
        type: 'complete',
        filesCreated: result.filesCreated,
        configPath: result.configPath,
        providers: result.providers,
      };
      console.log(JSON.stringify(out));
      return;
    }

    emitQuestion(next);
  }
}

function emitQuestion(step: InterviewStep): void {
  const out: AgentQuestion = {
    type: 'question',
    id: step.id,
    question: step.question,
    kind: step.type,
    description: step.description,
    options: step.options?.map((o) => ({
      value: o.value,
      label: o.label,
      description: o.description,
    })),
    default: step.default,
    required: step.required,
  };
  console.log(JSON.stringify(out));
}

async function* readStdinLines(): AsyncGenerator<string> {
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    yield line;
  }
}

/** Main entry for `slope interview` command */
export async function interviewCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const isAgent = args.includes('--agent');

  // Guard: if .slope/config.json already exists, warn but allow --force
  const configPath = join(cwd, '.slope', 'config.json');
  const hasConfig = existsSync(configPath);
  if (hasConfig && !args.includes('--force')) {
    if (isAgent) {
      const out: AgentError = { type: 'error', errors: [{ field: '_init', message: 'Project already initialized. Use --force to re-interview.' }] };
      console.log(JSON.stringify(out));
    } else {
      console.error('Project already initialized. Use --force to re-interview.');
    }
    process.exit(1);
  }

  if (isAgent) {
    await runAgentMode(cwd);
  } else {
    await runHumanMode(cwd);
  }
}
