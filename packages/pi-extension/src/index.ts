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
  loadPiSettings,
  savePiSettings,
  isSkillEnabled,
  setSkillEnabled,
  listSkills,
  searchMemories,
  addMemory,
  removeMemory,
} from '@slope-dev/slope';
import type { InterviewStep, StepOption, PiSettings } from '@slope-dev/slope';

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

// ── Vague-Prompt Detector ────────────────────────────

// Matches vague action verbs at the start of a prompt. Shared by isVaguePrompt() and getPlannerSignals().
const VAGUE_VERB_RE = /^(optimize|improve|make\s+\S+\s+better|make\s+better|fix|refactor|clean\s+up|tidy|architect)\b/i;

export function isVaguePrompt(prompt: string): boolean {
  const trimmed = prompt.trim();
  return (
    trimmed.length < 200 &&
    VAGUE_VERB_RE.test(trimmed) &&
    !HAS_PATH_RE.test(trimmed) &&
    !HAS_SYMBOL_RE.test(trimmed)
  );
}

/**
 * Module-level ref populated by registerModelRouter so the vague-prompt
 * detector (registered first) can call doSwitch without accessing the closure.
 * Set synchronously during extension init, before any events fire.
 */
let _routerRef: { state: RouterState; pi: ExtensionAPI } | null = null;

// ── Plan-Gate Helpers ────────────────────────────────

/** Returns the active sprint phase, or null if no sprint state exists. */
function readSprintPhase(cwd: string): string | null {
  const sprintStatePath = join(cwd, '.slope', 'sprint-state.json');
  if (!existsSync(sprintStatePath)) return null;
  try {
    const state = JSON.parse(readFileSync(sprintStatePath, 'utf8')) as { phase?: string };
    return state.phase ?? null;
  } catch {
    return null;
  }
}

function inSprintPhase(cwd: string): boolean {
  const phase = readSprintPhase(cwd);
  return phase === 'planning' || phase === 'implementing' || phase === 'scoring';
}

function hasRecentPlan(ctx: { sessionManager: { getEntries: () => Array<{ role?: string; content?: string }> } }): boolean {
  const entries = ctx.sessionManager.getEntries();
  // Scan last 5 assistant messages for a structured plan.
  const assistantMessages = entries
    .filter(e => e.role === 'assistant' && typeof e.content === 'string')
    .slice(-5);
  const PLAN_HEADING = /^##+\s*(plan|approach|steps?)\b/im;
  const NUMBERED_LIST = /^\s*1\.\s.+\n\s*2\.\s.+\n\s*3\.\s/m;
  const PLAN_MARKER = /\[plan\]|<plan>/i;
  return assistantMessages.some(m =>
    PLAN_HEADING.test(m.content ?? '') ||
    NUMBERED_LIST.test(m.content ?? '') ||
    PLAN_MARKER.test(m.content ?? '')
  );
}

// Read-only bash commands that are always exempt from the plan-gate.
const BASH_EXEMPT_PREFIXES = [
  'git status', 'git log', 'git diff', 'git show', 'git branch',
  'ls', 'pwd', 'cat ', 'grep', 'find ', 'which ', 'echo ',
  'head ', 'tail ', 'wc ', 'stat ', 'file ', 'type ',
];

function isBashExempt(command: string): boolean {
  const trimmed = command.trim();
  return BASH_EXEMPT_PREFIXES.some(prefix => trimmed.startsWith(prefix));
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
  const phase = readSprintPhase(cwd);
  if (phase === null) return 'fresh';
  if (phase === 'planning' || phase === 'implementing' || phase === 'scoring') return 'active';
  return 'complete';
}

// ── Extension Entry Point ───────────────────────────

export default function slopeExtension(pi: ExtensionAPI, _cwdOverride?: string): void {
  const cwd = _cwdOverride ?? process.cwd();

  // Load Pi settings (always, even without a SLOPE project)
  const settings = loadPiSettings(cwd);

  if (!hasSlopeProject(cwd)) {
    // Not a SLOPE project — register only the init tool and settings command
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

    // Settings command is always available
    registerSettingsCommand(pi, settings, cwd);
    return;
  }

  // ── SLOPE Tools ───────────────────────────────────

  if (isSkillEnabled(settings, 'interview')) {
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
  } // end interview skill

  if (isSkillEnabled(settings, 'briefing')) {
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
  } // end briefing skill

  if (isSkillEnabled(settings, 'scorecard')) {
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
  } // end scorecard skill

  if (isSkillEnabled(settings, 'guards')) {
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
  } // end guards skill

  if (isSkillEnabled(settings, 'planning')) {
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
  } // end planning skill

  if (isSkillEnabled(settings, 'review')) {
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
  } // end review skill

  if (isSkillEnabled(settings, 'memory')) {
  pi.registerTool({
    name: 'slope_memory',
    label: 'Slope Memory',
    description: 'List, add, search, or remove cross-session memories stored in .slope/memories.json',
    parameters: Type.Object({
      action: Type.Union(
        [Type.Literal('list'), Type.Literal('add'), Type.Literal('search'), Type.Literal('remove')],
        { description: 'Memory action' },
      ),
      text: Type.Optional(Type.String({ description: 'Memory text (for add)' })),
      query: Type.Optional(Type.String({ description: 'Search query (for search)' })),
      id: Type.Optional(Type.String({ description: 'Memory ID (for remove)' })),
      category: Type.Optional(Type.String({ description: 'Category filter' })),
      limit: Type.Optional(Type.Number({ description: 'Max results' })),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      switch (params.action) {
        case 'list': {
          const results = searchMemories(ctx.cwd, {
            category: params.category as import('@slope-dev/slope').MemoryCategory | undefined,
            limit: params.limit ?? 10,
          });
          const lines = results.map(m => `[${m.category}] w:${m.weight} ${m.text.slice(0, 80)}`);
          return { content: [{ type: 'text' as const, text: lines.join('\n') || 'No memories.' }], details: {} };
        }
        case 'add': {
          if (!params.text) return { content: [{ type: 'text' as const, text: 'Error: text required for add' }], details: {} };
          const mem = addMemory(ctx.cwd, params.text, {
            category: params.category as import('@slope-dev/slope').MemoryCategory | undefined,
            source: 'manual',
          });
          return { content: [{ type: 'text' as const, text: `Added: ${mem.id.slice(0, 12)}… [${mem.category}]` }], details: {} };
        }
        case 'search': {
          const results = searchMemories(ctx.cwd, {
            query: params.query,
            category: params.category as import('@slope-dev/slope').MemoryCategory | undefined,
            limit: params.limit ?? 10,
          });
          const lines = results.map(m => `[${m.category}] w:${m.weight} ${m.text.slice(0, 80)}`);
          return { content: [{ type: 'text' as const, text: lines.join('\n') || 'No memories found.' }], details: {} };
        }
        case 'remove': {
          if (!params.id) return { content: [{ type: 'text' as const, text: 'Error: id required for remove' }], details: {} };
          const ok = removeMemory(ctx.cwd, params.id);
          return { content: [{ type: 'text' as const, text: ok ? 'Removed.' : 'Memory not found.' }], details: {} };
        }
      }
    },
  });
  } // end memory skill

  if (isSkillEnabled(settings, 'guards')) {
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
  } // end guards skill (metrics)

  if (isSkillEnabled(settings, 'scorecard')) {
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
  } // end scorecard skill (convergence)

  // ── Guard Enforcement via Events ──────────────────

  if (isSkillEnabled(settings, 'guards')) {
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
  } // end guards event handlers

  if (isSkillEnabled(settings, 'plan-gate')) {
  pi.on('tool_call', async (event, ctx) => {
    const { toolName, input } = event;
    const inp = input as Record<string, unknown>;

    // Only gate destructive tools.
    if (toolName !== 'write' && toolName !== 'edit' && toolName !== 'bash') return;

    // Bash: exempt read-only commands.
    if (toolName === 'bash' && typeof inp.command === 'string' && isBashExempt(inp.command)) return;

    // Not a gate situation when a sprint is active.
    if (inSprintPhase(ctx.cwd)) return;

    // Not a gate situation when the assistant recently produced a plan.
    if (hasRecentPlan(ctx as any)) return;

    const reason = 'plan-gate: Run /sprint start or write a plan before this action.';

    // Interactive: ask the user; non-interactive: hard block.
    const ui = (ctx as any).ui;
    if (typeof ui?.confirm === 'function') {
      const ok = await ui.confirm(
        'No plan detected',
        'Run /sprint start or write a plan first. Proceed anyway?',
      );
      if (!ok) return { block: true, reason };
    } else {
      return { block: true, reason };
    }
  });
  // Vague-prompt detector — registered BEFORE model-router's before_agent_start so
  // the forced local-planner tier sticks when the router handler fires next.
  pi.on('before_agent_start', async (event, ctx) => {
    if (!isVaguePrompt(event.prompt ?? '')) return;

    // Inject planning preamble into the chained system prompt.
    const preamble =
      '\n\nBefore any tool calls, produce a written plan addressing what to change, ' +
      'where, and the order of work. Format: a numbered list of steps under a ' +
      '"## Plan" heading. Do not call write/edit/bash before the plan is written.';

    // Force-route to local-planner when the model-router skill is active.
    if (_routerRef) {
      _routerRef.state.turnsSinceSwitch = 3; // satisfy hysteresis so doSwitch fires
      await doSwitch('local-planner', 'vague-prompt-detector', ctx, _routerRef.pi, _routerRef.state);
    }

    return {
      systemPrompt: event.systemPrompt + preamble,
    };
  });
  } // end plan-gate event handlers

  if (isSkillEnabled(settings, 'planning')) {
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
  } // end planning event handlers

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

  if (isSkillEnabled(settings, 'memory')) {
  pi.registerCommand('slope-memory', {
    description: 'List or add cross-session memories',
    handler: async (args, ctx) => {
      const tokens = (args ?? '').trim().split(/\s+/).filter(Boolean);
      const sub = tokens[0];
      if (sub === 'add') {
        const text = tokens.slice(1).join(' ').trim();
        if (!text) { ctx.ui.notify('Usage: /slope-memory add <text>', 'info'); return; }
        try {
          const mem = addMemory(ctx.cwd, text, { source: 'manual' });
          ctx.ui.notify(`Memory added: ${mem.id.slice(0, 12)}…`, 'info');
        } catch (err) {
          ctx.ui.notify(`Memory not added: ${(err as Error).message}`, 'warning');
        }
      } else {
        const results = searchMemories(ctx.cwd, { limit: 10 });
        if (results.length === 0) { ctx.ui.notify('No memories stored.', 'info'); return; }
        const lines = results.map(m => `[${m.category}] w:${m.weight} ${m.text.slice(0, 60)}`);
        ctx.ui.notify(`Memories:\n${lines.join('\n')}`, 'info');
      }
    },
  });
  } // end memory slash command

  // Settings command
  registerSettingsCommand(pi, settings, cwd);

  // ── Model Router ────────────────────────────────

  if (isSkillEnabled(settings, 'model-router')) {
    registerModelRouter(pi, cwd);
  }

  // ── Session Start: Inject Briefing on First Turn ──

  let briefingInjected = false;

  pi.on('session_start', async (_event, ctx) => {
    briefingInjected = false;
    ctx.ui.notify('SLOPE loaded — use /slope, /sprint, /slope-settings, or ask for slope_* tools', 'info');
  });

  if (isSkillEnabled(settings, 'briefing')) {
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

    // Inject top memories if memory skill is enabled
    let memoryContext = '';
    if (isSkillEnabled(settings, 'memory')) {
      try {
        const memories = searchMemories(ctx.cwd, { limit: 5, minWeight: 5 });
        if (memories.length > 0) {
          memoryContext = '\n\n📌 Relevant Memories:\n' + memories.map(m => `  • [${m.category}] ${m.text.slice(0, 100)}`).join('\n');
        }
      } catch { /* ignore memory errors */ }
    }

    return {
      message: {
        customType: 'slope-briefing',
        content: `SLOPE Session Briefing:\n${briefing}${memoryContext}`,
        display: true,
      },
    };
  });
  } // end briefing event handlers
}

// ── Settings Command ──────────────────────────────

// ── Model Router ──────────────────────────────────────────

const COMPLEX_KEYWORDS = [
  'architect', 'design', 'refactor', 'debug', 'investigate',
  'why does', 'how should', 'what\'s the best', 'review this',
  'performance', 'security', 'migration', 'breaking change',
  'multi-file', 'cross-cutting', 'redesign', 'strategy',
  'explain why', 'trade-off', 'compare approaches',
];

const SIMPLE_KEYWORDS = [
  'fix typo', 'rename', 'add import', 'run test', 'format',
  'lint', 'commit', 'push', 'status', 'list files', 'show',
  'create file', 'delete file', 'move file',
];

// Standalone ambiguous noun tokens. 'it' is intentionally excluded — too common.
const AMBIGUOUS_NOUN_TOKENS = [
  'the code', 'this', 'everything', 'all of it', 'the whole thing', 'the codebase',
];

const HAS_PATH_RE = /\.(tsx?|jsx?|py|rs|go|md|json|ya?ml|sh|sql|css|html|toml)\b/i;
// Function-call shape `foo()` OR PascalCase identifier `MyClass`.
const HAS_SYMBOL_RE = /\b[a-z][A-Za-z0-9_]*\(\)|\b[A-Z][a-z][A-Za-z0-9]+\b/;

function hasCodeIdentifier(prompt: string): boolean {
  return HAS_PATH_RE.test(prompt) || HAS_SYMBOL_RE.test(prompt);
}

function getPlannerSignals(prompt: string): string[] {
  const trimmed = prompt.trim();
  const lower = trimmed.toLowerCase();
  const signals: string[] = [];
  if (VAGUE_VERB_RE.test(trimmed)) signals.push('vague-verb');
  for (const t of AMBIGUOUS_NOUN_TOKENS) {
    if (lower.includes(t)) { signals.push('ambiguous-noun'); break; }
  }
  if (trimmed.length < 200 && !hasCodeIdentifier(trimmed)) signals.push('short-no-code');
  return signals;
}

export type ModelTier = 'local-coder' | 'local-general' | 'local-planner' | 'cloud';

export interface RouterState {
  currentTier: ModelTier;
  turnsSinceSwitch: number;
  lastSwitchReason: string;
  /** Set by doSwitch when entering local-planner; consumed by the vague-prompt detector (T3). */
  plannerPreambleStaged?: boolean;
}

export interface ComplexityResult {
  /** Recommended tier for this prompt. */
  tier: ModelTier;
  /** Cloud-escalation score on the existing 0–5 scale. */
  score: number;
  /** Human-readable top reason for the tier choice. */
  signal: string;
}

export function scoreComplexity(prompt: string): ComplexityResult {
  const trimmed = prompt.trim();
  const lower = trimmed.toLowerCase();

  // 0–5 score (cloud-escalation signal). Same weights as the prior implementation.
  let score = 0;
  let topComplexKw: string | null = null;
  for (const kw of COMPLEX_KEYWORDS) {
    if (lower.includes(kw)) {
      score += 2;
      if (!topComplexKw) topComplexKw = kw;
    }
  }
  for (const kw of SIMPLE_KEYWORDS) {
    if (lower.includes(kw)) score -= 1;
  }
  if (trimmed.length > 500) score += 1;
  if (trimmed.length > 1000) score += 1;
  if (trimmed.length < 50) score -= 1;
  const questions = (trimmed.match(/\?/g) ?? []).length;
  if (questions >= 2) score += 1;
  const fileRefs = (trimmed.match(/\.[a-z]{1,4}\b/g) ?? []).length;
  if (fileRefs >= 3) score += 1;
  score = Math.max(0, Math.min(5, score));

  // Tier selection. Order matters: cloud > planner > coder > general.
  if (score >= 3) {
    return { tier: 'cloud', score, signal: topComplexKw ?? 'high-complexity' };
  }
  const planner = getPlannerSignals(trimmed);
  if (planner.length >= 2) {
    return { tier: 'local-planner', score, signal: planner.join('+') };
  }
  if (hasCodeIdentifier(trimmed)) {
    return { tier: 'local-coder', score, signal: 'code-identifier' };
  }
  // Coder-flavoured keywords still hint at coder when no identifier is present.
  const CODER_HINT_KWS = ['fix typo', 'rename', 'add import', 'run test', 'format', 'lint',
    'commit', 'push', 'create file', 'delete file', 'move file', 'debug', 'refactor'];
  for (const kw of CODER_HINT_KWS) {
    if (lower.includes(kw)) return { tier: 'local-coder', score, signal: kw };
  }
  return { tier: 'local-general', score, signal: 'general-reasoning' };
}

const TIER_ICONS: Record<ModelTier, string> = {
  'local-coder': '\u{1F6E0}',
  'local-general': '\u{1F9E0}',
  'local-planner': '\u{1F4CB}',
  'cloud': '☁',
};

/** Backwards-compat: persisted RouterState may carry the old 'local' tier name. */
function normalizeTier(tier: string): ModelTier {
  if (tier === 'local') return 'local-coder';
  if (tier === 'local-coder' || tier === 'local-general' || tier === 'local-planner' || tier === 'cloud') {
    return tier;
  }
  return 'local-coder';
}

function registerModelRouter(pi: ExtensionAPI, _cwd: string): void {
  const state: RouterState = {
    currentTier: 'local-coder',
    turnsSinceSwitch: 0,
    lastSwitchReason: 'startup',
  };
  // Expose state + pi so the vague-prompt detector (registered earlier) can call doSwitch.
  _routerRef = { state, pi };

  // Restore state from session
  pi.on('session_start', async (_event, ctx) => {
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === 'custom' && entry.customType === 'slope-model-router') {
        const persisted = entry.data as Partial<RouterState> & { currentTier?: string };
        state.currentTier = normalizeTier(persisted.currentTier ?? 'local-coder');
        state.turnsSinceSwitch = persisted.turnsSinceSwitch ?? 0;
        state.lastSwitchReason = persisted.lastSwitchReason ?? 'restored';
        state.plannerPreambleStaged = persisted.plannerPreambleStaged;
      }
    }
    ctx.ui.setStatus('model-router', `${TIER_ICONS[state.currentTier]} ${state.currentTier}`);
  });

  // Analyze complexity before each agent turn
  pi.on('before_agent_start', async (event, ctx) => {
    const prompt = (event.prompt ?? '').toLowerCase();

    // Explicit user commands \u2014 match longest variants first.
    if (/(use|switch|\/route)\s+local-planner\b/.test(prompt)) {
      await doSwitch('local-planner', 'user request', ctx, pi, state);
      return;
    }
    if (/(use|switch|\/route)\s+local-general\b/.test(prompt)) {
      await doSwitch('local-general', 'user request', ctx, pi, state);
      return;
    }
    if (/(use|switch|\/route)\s+local-coder\b/.test(prompt)) {
      await doSwitch('local-coder', 'user request', ctx, pi, state);
      return;
    }
    const FORCE_LOCAL = ['use local', '/route local', 'switch local'];
    const FORCE_CLOUD = ['use cloud', '/route cloud', 'switch cloud', 'use sonnet', 'use opus'];
    if (FORCE_LOCAL.some(k => prompt.includes(k))) {
      await doSwitch('local-coder', 'user request (legacy "local")', ctx, pi, state);
      return;
    }
    if (FORCE_CLOUD.some(k => prompt.includes(k))) {
      await doSwitch('cloud', 'user request', ctx, pi, state);
      return;
    }

    const result = scoreComplexity(event.prompt ?? '');

    // Hysteresis: don't switch too frequently (min 3 turns between switches).
    if (state.turnsSinceSwitch < 3) {
      state.turnsSinceSwitch++;
      return;
    }

    if (result.tier !== state.currentTier) {
      await doSwitch(result.tier, `auto: ${result.signal} (score ${result.score})`, ctx, pi, state);
    } else {
      state.turnsSinceSwitch++;
    }
  });

  // Track turns
  pi.on('turn_end', async () => {
    state.turnsSinceSwitch++;
  });

  // Manual command
  pi.registerCommand('route', {
    description: 'Switch model routing: /route local-coder | local-general | local-planner | cloud | status',
    handler: async (args, ctx) => {
      const arg = (args ?? '').trim().toLowerCase();
      if (arg === 'status' || arg === '') {
        ctx.ui.notify(
          `Model router: ${state.currentTier} (${state.turnsSinceSwitch} turns since switch, reason: ${state.lastSwitchReason})`,
          'info',
        );
        return;
      }
      // Back-compat: bare 'local' = local-coder.
      if (arg === 'local') {
        await doSwitch('local-coder', 'manual /route (legacy "local")', ctx, pi, state);
        return;
      }
      if (arg === 'local-coder' || arg === 'local-general' || arg === 'local-planner' || arg === 'cloud') {
        await doSwitch(arg, 'manual /route command', ctx, pi, state);
        return;
      }
      ctx.ui.notify('Usage: /route local-coder | local-general | local-planner | cloud | status', 'info');
    },
  });
}

export async function doSwitch(
  tier: ModelTier,
  reason: string,
  ctx: any,
  pi: ExtensionAPI,
  state: RouterState,
): Promise<void> {
  const registry = ctx.modelRegistry;
  let model;

  if (tier === 'cloud') {
    model = registry.find('openrouter', 'anthropic/claude-sonnet-4-5')
      ?? registry.find('openrouter', 'google/gemini-2.5-pro-preview')
      ?? registry.find('anthropic', 'claude-sonnet-4-20250514');
  } else if (tier === 'local-coder') {
    model = registry.find('mlx-local', 'Qwen3-Coder-Next')
      ?? registry.find('mlx-local', 'Qwen3-Coder')
      ?? registry.find('ollama', 'qwen3-coder:30b');
  } else {
    // local-general and local-planner share the dense reasoning model.
    model = registry.find('mlx-local', 'Qwen3.6-27B')
      ?? registry.find('mlx-local', 'Qwen3-27B')
      ?? registry.find('ollama', 'qwen3:27b');
  }

  if (!model) {
    ctx.ui.notify(`No ${tier} model available — check models.json`, 'warning');
    return;
  }

  const success = await pi.setModel(model);
  if (success) {
    state.currentTier = tier;
    state.turnsSinceSwitch = 0;
    state.lastSwitchReason = reason;
    state.plannerPreambleStaged = tier === 'local-planner';

    ctx.ui.setStatus('model-router', `${TIER_ICONS[tier]} ${tier}`);
    ctx.ui.notify(`Model router: switched to ${tier} (${model.name ?? model.id}) — ${reason}`, 'info');

    // Persist state
    pi.appendEntry('slope-model-router', state);
  }
}

// ── Settings Command ──────────────────────────────────

function registerSettingsCommand(pi: ExtensionAPI, settings: PiSettings, cwd: string): void {
  pi.registerCommand('slope-settings', {
    description: 'Show and manage SLOPE Pi feature settings',
    handler: async (_args, ctx) => {
      const skills = listSkills(settings);

      // Build interactive select options showing current state
      const options = skills.map((s) => {
        const status = s.enabled ? '✓ ON ' : '✗ OFF';
        return `${s.name.padEnd(12)} ${status}  ${s.description}`;
      });

      const choice = await ctx.ui.select('SLOPE Features — select one to toggle', options);
      if (choice === undefined) {
        ctx.ui.notify('Settings unchanged.', 'info');
        return;
      }

      // Extract skill name from selection
      const skillName = skills[options.indexOf(choice)]?.name;
      if (!skillName || !settings.skills[skillName]) {
        ctx.ui.notify('Invalid selection.', 'error');
        return;
      }

      const wasEnabled = settings.skills[skillName].enabled;
      const confirm = await ctx.ui.confirm(
        `Toggle "${skillName}" ${wasEnabled ? 'OFF' : 'ON'}?`,
        `Currently: ${wasEnabled ? 'enabled' : 'disabled'}. Changes take effect after session restart.`,
      );

      if (!confirm) {
        ctx.ui.notify('Settings unchanged.', 'info');
        return;
      }

      setSkillEnabled(settings, skillName, !wasEnabled);
      savePiSettings(cwd, settings);
      ctx.ui.notify(
        `SLOPE: "${skillName}" is now ${!wasEnabled ? 'ENABLED' : 'DISABLED'}. ` +
        'Restart the session for changes to take full effect.',
        'info',
      );
    },
  });
}
