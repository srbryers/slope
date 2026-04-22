/**
 * SLOPE Extension for pi coding agent
 *
 * Registers SLOPE tools and enforces guards via Pi's event system.
 * Install: pi install . (project-local) or pi install npm:@slope-dev/slope
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import {
  InterviewStateMachine,
  buildInterviewContext,
  generateInterviewSteps,
  initFromAnswers,
} from '@slope-dev/slope';
import type { InterviewStep, StepOption } from '@slope-dev/slope';

// ── Helpers ─────────────────────────────────────────

function slopeCmd(args: string, cwd: string): string {
  try {
    return execSync(`slope ${args}`, { cwd, encoding: 'utf8', timeout: 30000 }).trim();
  } catch (err) {
    const msg = err instanceof Error ? (err as { stderr?: string }).stderr ?? err.message : String(err);
    return `Error: ${msg}`;
  }
}

function hasSlopeProject(cwd: string): boolean {
  return existsSync(join(cwd, '.slope', 'config.json'));
}

// ── Onboarding State ────────────────────────────────

const ONBOARDING_STATE_FILE = '.slope/.pi-onboarding.json';

interface OnboardingState {
  shownAt?: string;
}

function loadOnboardingState(cwd: string): OnboardingState {
  const path = join(cwd, ONBOARDING_STATE_FILE);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as OnboardingState;
  } catch {
    return {};
  }
}

function saveOnboardingState(cwd: string, state: OnboardingState): void {
  const dir = join(cwd, '.slope');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(cwd, ONBOARDING_STATE_FILE), JSON.stringify(state, null, 2) + '\n');
}

/** Determine the SLOPE project state for this workspace */
function getProjectState(cwd: string): 'fresh' | 'complete' | 'active' {
  const sprintStatePath = join(cwd, '.slope', 'sprint-state.json');
  if (!existsSync(sprintStatePath)) {
    return 'fresh';
  }
  try {
    const state = JSON.parse(readFileSync(sprintStatePath, 'utf8')) as {
      phase?: string;
    };
    if (
      state.phase === 'planning' ||
      state.phase === 'implementing' ||
      state.phase === 'scoring'
    ) {
      return 'active';
    }
    return 'complete';
  } catch {
    return 'fresh';
  }
}

// ── Extension Entry Point ───────────────────────────

export default function slopeExtension(pi: ExtensionAPI, _cwdOverride?: string): void {
  const cwd = _cwdOverride ?? process.cwd();
  if (!hasSlopeProject(cwd)) {
    // Not a SLOPE project — register only the init tool
    pi.registerTool({
      name: 'slope_init',
      label: 'Slope Init',
      description: 'Initialize SLOPE in this project for sprint tracking and guard enforcement',
      parameters: Type.Object({}),
      async execute(_id, _params, _signal, _update, ctx) {
        const result = slopeCmd('init', ctx.cwd);
        return { content: [{ type: 'text' as const, text: result }], details: {} };
      },
    });
    return;
  }

  // ── SLOPE Tools ───────────────────────────────────

  pi.registerTool({
    name: 'slope_interview',
    label: 'Slope Interview',
    description: 'Run the project interview directly in Pi. Uses native dialogs (input, select, confirm). No shell-out. Creates .slope/config.json and starter files on completion.',
    parameters: Type.Object({
      resume: Type.Optional(Type.Boolean({ description: 'Resume a previously started interview' })),
    }),
    async execute(_id, _params, _signal, _update, ctx) {
      const steps = generateInterviewSteps(buildInterviewContext(ctx.cwd));
      const sm = new InterviewStateMachine(steps);

      let step: InterviewStep | null;
      while ((step = sm.nextQuestion()) !== null) {
        let value: unknown;
        switch (step.type) {
          case 'text': {
            const placeholder = step.description ?? '';
            const def = typeof step.default === 'string' ? step.default : undefined;
            const reply = await ctx.ui.input(step.question, placeholder + (def ? ` (default: ${def})` : ''));
            value = reply ?? def ?? '';
            break;
          }
          case 'select': {
            const options = (step.options ?? []).map((o: StepOption) =>
              o.hint ? `${o.label} ${o.hint}` : o.label
            );
            const reply = await ctx.ui.select(step.question, options);
            if (reply === undefined) {
              return {
                content: [{ type: 'text' as const, text: 'Interview cancelled.' }],
                details: {},
              };
            }
            // Map display label back to value
            const chosen = step.options?.find((o: StepOption) =>
              (o.hint ? `${o.label} ${o.hint}` : o.label) === reply
            );
            value = chosen?.value ?? reply;
            break;
          }
          case 'multiselect': {
            // Pi has no multiselect — ask for comma-separated values
            const optionsText = (step.options ?? [])
              .map((o: StepOption) => `${o.label}${o.hint ? ` ${o.hint}` : ''}`)
              .join(', ');
            const reply = await ctx.ui.input(
              `${step.question} (comma-separated)`,
              optionsText,
            );
            if (reply === undefined) {
              return {
                content: [{ type: 'text' as const, text: 'Interview cancelled.' }],
                details: {},
              };
            }
            value = reply.split(',').map((s: string) => s.trim()).filter(Boolean);
            break;
          }
          case 'confirm': {
            value = await ctx.ui.confirm(step.question, step.description ?? '');
            break;
          }
          default: {
            const reply = await ctx.ui.input(step.question);
            value = reply ?? '';
          }
        }

        const submitResult = sm.submitAnswer(step.id, value);
        if (!submitResult.success) {
          return {
            content: [{ type: 'text' as const, text: `Validation error: ${submitResult.error}` }],
            details: {},
          };
        }
      }

      const answers = sm.getResultUnknown();
      const platformsVal = answers.platforms;
      const result = await initFromAnswers(
        ctx.cwd,
        answers,
        Array.isArray(platformsVal) ? platformsVal as string[] : undefined,
      );

      if (!result.success) {
        return {
          content: [{ type: 'text' as const, text: `Interview failed:\n${result.errors.map((e: { field: string; message: string }) => `  ${e.field}: ${e.message}`).join('\n')}` }],
          details: {},
        };
      }

      // Clear onboarding flag so future sessions show planning briefing
      saveOnboardingState(ctx.cwd, { shownAt: new Date().toISOString() });

      return {
        content: [{
          type: 'text' as const,
          text:
            'Project initialized from interview.\n\n' +
            `Files created:\n${result.filesCreated.map((f: string) => `  ${f}`).join('\n')}\n\n` +
            'Next: run `slope sprint start` to begin your first sprint.',
        }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: 'slope_briefing',
    label: 'Slope Briefing',
    description: 'Get sprint briefing — handicap, hazards, claims, roadmap context. Use compact for ~200 token summary.',
    parameters: Type.Object({
      compact: Type.Optional(Type.Boolean({ description: 'Compact mode (~200 tokens instead of full briefing)' })),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const result = slopeCmd(`briefing${params.compact ? ' --compact' : ''}`, ctx.cwd);
      return { content: [{ type: 'text' as const, text: result }], details: {} };
    },
  });

  pi.registerTool({
    name: 'slope_card',
    label: 'Slope Card',
    description: 'Display handicap card — rolling performance stats across sprints',
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _update, ctx) {
      const result = slopeCmd('card', ctx.cwd);
      return { content: [{ type: 'text' as const, text: result }], details: {} };
    },
  });

  pi.registerTool({
    name: 'slope_guard_check',
    label: 'Slope Guard Check',
    description: 'Run standalone guard validation: typecheck, tests, uncommitted changes, unpushed commits. Call before committing.',
    parameters: Type.Object({
      json: Type.Optional(Type.Boolean({ description: 'Machine-readable JSON output' })),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const result = slopeCmd(`guard check${params.json ? ' --json' : ''}`, ctx.cwd);
      return { content: [{ type: 'text' as const, text: result }], details: {} };
    },
  });

  pi.registerTool({
    name: 'slope_sprint_context',
    label: 'Slope Sprint Context',
    description: 'Get remaining workflow steps for the current sprint — include in subagent prompts for workflow awareness.',
    parameters: Type.Object({
      sprint_id: Type.String({ description: 'Sprint ID (e.g., S80)' }),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const result = slopeCmd(`sprint context ${params.sprint_id}`, ctx.cwd);
      return { content: [{ type: 'text' as const, text: result }], details: {} };
    },
  });

  pi.registerTool({
    name: 'slope_sprint_validate',
    label: 'Slope Sprint Validate',
    description: 'Post-hoc validation: check workflow complete, scorecard exists, plan exists, tests pass.',
    parameters: Type.Object({
      sprint_id: Type.String({ description: 'Sprint ID (e.g., S80)' }),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const result = slopeCmd(`sprint validate ${params.sprint_id}`, ctx.cwd);
      return { content: [{ type: 'text' as const, text: result }], details: {} };
    },
  });

  pi.registerTool({
    name: 'slope_review_run',
    label: 'Slope Review Run',
    description: 'Generate isolated review prompts from a PR diff for subagent-based code/architect reviews.',
    parameters: Type.Object({
      pr: Type.Optional(Type.Number({ description: 'PR number (default: current branch)' })),
      type: Type.Optional(Type.Union(
        [Type.Literal('architect'), Type.Literal('code'), Type.Literal('both')],
        { description: 'Review type' },
      )),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const args = [
        params.pr ? `--pr=${params.pr}` : '',
        params.type ? `--type=${params.type}` : '',
      ].filter(Boolean).join(' ');
      const result = slopeCmd(`review run ${args}`, ctx.cwd);
      return { content: [{ type: 'text' as const, text: result }], details: {} };
    },
  });

  pi.registerTool({
    name: 'slope_guard_metrics',
    label: 'Slope Guard Metrics',
    description: 'Display guard execution metrics — per-guard totals, allow/deny rates, most active/blocking.',
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _update, ctx) {
      const result = slopeCmd('guard metrics', ctx.cwd);
      return { content: [{ type: 'text' as const, text: result }], details: {} };
    },
  });

  pi.registerTool({
    name: 'slope_convergence',
    label: 'Slope Convergence',
    description: 'Detect convergence patterns: improvement rate, plateau, reversion. Requires 10+ scorecards.',
    parameters: Type.Object({
      json: Type.Optional(Type.Boolean({ description: 'JSON output' })),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const result = slopeCmd(`loop convergence${params.json ? ' --json' : ''}`, ctx.cwd);
      return { content: [{ type: 'text' as const, text: result }], details: {} };
    },
  });

  // ── Guard Enforcement via Events ──────────────────

  // Guard: hazard warning on write/edit; commit discipline nudge on bash
  pi.on('tool_call', async (event, ctx) => {
    const { toolName, input } = event;
    const inp = input as Record<string, unknown>;

    // Hazard warning on file writes/edits
    if ((toolName === 'write' || toolName === 'edit') && typeof inp.path === 'string') {
      try {
        const payload = JSON.stringify({
          session_id: 'pi-session',
          cwd: ctx.cwd,
          hook_event_name: 'PreToolUse',
          tool_name: toolName === 'write' ? 'Write' : 'Edit',
          tool_input: { file_path: inp.path },
        });
        const result = execSync(`echo ${JSON.stringify(payload)} | slope guard hazard`, {
          cwd: ctx.cwd,
          encoding: 'utf8',
          timeout: 5000,
        }).trim();

        if (result.includes('additionalContext')) {
          const match = result.match(/"additionalContext":"([^"]+)"/);
          if (match) {
            const context = match[1].replace(/\\n/g, '\n');
            pi.sendMessage(
              { customType: 'slope-hazard', content: context, display: true },
              { deliverAs: 'steer' },
            );
          }
        }
      } catch { /* guard failure should never block */ }
    }

    // Commit discipline: warn on direct main/master commits
    if (toolName === 'bash' && typeof inp.command === 'string' && /git\s+commit/.test(inp.command)) {
      try {
        const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ctx.cwd, encoding: 'utf8' }).trim();
        if (branch === 'main' || branch === 'master') {
          pi.sendMessage(
            {
              customType: 'slope-guard',
              content: 'SLOPE: Committing directly on main/master. Create a feature branch first: git checkout -b feat/<description>',
              display: true,
            },
            { deliverAs: 'steer' },
          );
        }
      } catch { /* not in git repo */ }
    }
  });

  // Guard: post-push sprint nudge
  pi.on('tool_result', async (event, ctx) => {
    const inp = event.input as Record<string, unknown>;
    if (event.toolName === 'bash' && typeof inp.command === 'string' && /git\s+push/.test(inp.command)) {
      try {
        const status = slopeCmd('sprint status', ctx.cwd);
        if (status && !status.includes('Error')) {
          pi.sendMessage(
            {
              customType: 'slope-post-push',
              content: 'SLOPE post-push: Sprint active. Run `slope guard check` to verify, or `slope sprint context` for next steps.',
              display: true,
            },
            { deliverAs: 'steer' },
          );
        }
      } catch { /* ignore */ }
    }
  });

  // ── Slash Commands ────────────────────────────────

  pi.registerCommand('slope', {
    description: 'Run any SLOPE CLI command (default: briefing --compact)',
    handler: async (args, ctx) => {
      const output = slopeCmd(args || 'briefing --compact', ctx.cwd);
      ctx.ui.notify(output, 'info');
    },
  });

  pi.registerCommand('sprint', {
    description: 'Quick sprint status',
    handler: async (_args, ctx) => {
      const output = slopeCmd('sprint status', ctx.cwd);
      ctx.ui.notify(output, 'info');
    },
  });

  // ── Session Start: Inject Briefing on First Turn ──

  let briefingInjected = false;

  pi.on('session_start', async (_event, ctx) => {
    briefingInjected = false;
    ctx.ui.notify('SLOPE loaded — use /slope, /sprint, or ask for slope_* tools', 'info');
  });

  pi.on('before_agent_start', async (_event, ctx) => {
    if (briefingInjected) return;
    briefingInjected = true;

    const projectState = getProjectState(ctx.cwd);

    // Fresh project: onboarding instead of briefing
    if (projectState === 'fresh') {
      const onboarding = loadOnboardingState(ctx.cwd);
      if (!onboarding.shownAt) {
        onboarding.shownAt = new Date().toISOString();
        saveOnboardingState(ctx.cwd, onboarding);

        return {
          message: {
            customType: 'slope-onboarding',
            content:
              '🎯 SLOPE Onboarding\n\n' +
              'This project has SLOPE initialized, but no sprint is active yet. Please help get things set up:\n\n' +
              '1. **Understand the project**: Read README.md, package.json, and explore key source files to understand what\'s been built.\n' +
              '2. **Index the codebase**: Run `slope map` to generate CODEBASE.md for architectural context.\n' +
              '3. **Interview the user**: Ask 2–3 quick questions about the project goals, team size, and current priorities.\n' +
              '4. **Start Sprint 1**: Once you have context, suggest creating a sprint plan with `slope sprint start` or by editing docs/backlog/roadmap.json.\n\n' +
              'Session mode: adhoc (sprint-workflow guards are silenced until a sprint begins).\n' +
              'Use /slope or the slope_* tools anytime for SLOPE commands.',
            display: true,
          },
        };
      }
      // Onboarding already shown this project — stay silent in adhoc mode
      return {};
    }

    // Sprint complete but no active one
    if (projectState === 'complete') {
      return {
        message: {
          customType: 'slope-briefing',
          content:
            'SLOPE: No active sprint (previous sprint complete). ' +
            'Start the next sprint with `slope sprint start`, or continue in adhoc mode.',
          display: true,
        },
      };
    }

    // Active sprint — check if in planning phase
    const sprintStatePath = join(ctx.cwd, '.slope', 'sprint-state.json');
    let phase: string | undefined;
    try {
      const raw = JSON.parse(readFileSync(sprintStatePath, 'utf8'));
      phase = raw.phase;
    } catch { /* ignore */ }

    if (phase === 'planning') {
      return {
        message: {
          customType: 'slope-planning',
          content:
            '📋 SLOPE Planning Phase\n\n' +
            'The project is initialized and ready for sprint planning.\n\n' +
            'Suggested next steps:\n' +
            '1. Review docs/backlog/roadmap.json and refine the starter sprint\n' +
            '2. Run `slope sprint start --number=1` to activate Sprint 1\n' +
            '3. Use `slope sprint run S1 --workflow=sprint-standard` to begin execution\n\n' +
            'Session mode: planning (workflow guards are relaxed).',
          display: true,
        },
      };
    }

    // Normal active sprint — compact briefing
    const briefing = slopeCmd('briefing --compact', ctx.cwd);
    if (briefing.startsWith('Error:')) {
      return {
        message: {
          customType: 'slope-briefing',
          content: `SLOPE: Could not load briefing (${briefing}). Run \`slope briefing\` manually.`,
          display: true,
        },
      };
    }

    return {
      message: {
        customType: 'slope-briefing',
        content: `SLOPE Session Briefing:\n${briefing}`,
        display: true,
      },
    };
  });
}
