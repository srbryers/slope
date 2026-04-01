/**
 * SLOPE Extension for pi.dev coding agent
 *
 * Registers SLOPE tools and enforces guards via Pi's event system.
 * Install: copy to .pi/extensions/slope/ or npm install @slope-dev/pi-extension
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Pi extension interface (minimal types — avoids hard dependency on Pi)
interface PiContext {
  registerTool(definition: ToolDefinition): void;
  registerCommand(name: string, description: string, handler: (args: string) => Promise<void>): void;
  on(event: string, handler: (...args: unknown[]) => void | Promise<void>): void;
  sendMessage(role: string, content: string): void;
  cwd: string;
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (params: Record<string, unknown>, signal?: AbortSignal) => Promise<string>;
}

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

// ── Extension Entry Point ───────────────────────────

export default function slopeExtension(pi: PiContext): void {
  const cwd = pi.cwd;

  if (!hasSlopeProject(cwd)) {
    // Not a SLOPE project — register only the init tool
    pi.registerTool({
      name: 'slope_init',
      description: 'Initialize SLOPE in this project for sprint tracking and guard enforcement',
      parameters: {},
      execute: async () => slopeCmd('init', cwd),
    });
    return;
  }

  // ── SLOPE Tools ───────────────────────────────────

  pi.registerTool({
    name: 'slope_briefing',
    description: 'Get sprint briefing — handicap, hazards, claims, roadmap context. Use --compact for ~200 token summary.',
    parameters: {
      type: 'object',
      properties: {
        compact: { type: 'boolean', description: 'Compact mode (~200 tokens instead of full briefing)' },
      },
    },
    execute: async (params) => slopeCmd(`briefing${params.compact ? ' --compact' : ''}`, cwd),
  });

  pi.registerTool({
    name: 'slope_card',
    description: 'Display handicap card — rolling performance stats across sprints',
    parameters: {},
    execute: async () => slopeCmd('card', cwd),
  });

  pi.registerTool({
    name: 'slope_guard_check',
    description: 'Run standalone guard validation: typecheck, tests, uncommitted changes, unpushed commits. Call before committing.',
    parameters: {
      type: 'object',
      properties: {
        json: { type: 'boolean', description: 'Machine-readable JSON output' },
      },
    },
    execute: async (params) => slopeCmd(`guard check${params.json ? ' --json' : ''}`, cwd),
  });

  pi.registerTool({
    name: 'slope_sprint_context',
    description: 'Get remaining workflow steps for the current sprint — include in subagent prompts for workflow awareness.',
    parameters: {
      type: 'object',
      properties: {
        sprint_id: { type: 'string', description: 'Sprint ID (e.g., S80)' },
      },
      required: ['sprint_id'],
    },
    execute: async (params) => slopeCmd(`sprint context ${params.sprint_id}`, cwd),
  });

  pi.registerTool({
    name: 'slope_sprint_validate',
    description: 'Post-hoc validation: check workflow complete, scorecard exists, plan exists, tests pass.',
    parameters: {
      type: 'object',
      properties: {
        sprint_id: { type: 'string', description: 'Sprint ID (e.g., S80)' },
      },
      required: ['sprint_id'],
    },
    execute: async (params) => slopeCmd(`sprint validate ${params.sprint_id}`, cwd),
  });

  pi.registerTool({
    name: 'slope_review_run',
    description: 'Generate isolated review prompts from a PR diff for subagent-based code/architect reviews.',
    parameters: {
      type: 'object',
      properties: {
        pr: { type: 'number', description: 'PR number (default: current branch)' },
        type: { type: 'string', enum: ['architect', 'code', 'both'], description: 'Review type' },
      },
    },
    execute: async (params) => {
      const args = [params.pr ? `--pr=${params.pr}` : '', params.type ? `--type=${params.type}` : ''].filter(Boolean).join(' ');
      return slopeCmd(`review run ${args}`, cwd);
    },
  });

  pi.registerTool({
    name: 'slope_guard_metrics',
    description: 'Display guard execution metrics — per-guard totals, allow/deny rates, most active/blocking.',
    parameters: {},
    execute: async () => slopeCmd('guard metrics', cwd),
  });

  pi.registerTool({
    name: 'slope_convergence',
    description: 'Detect convergence patterns: improvement rate, plateau, reversion. Requires 10+ scorecards.',
    parameters: {
      type: 'object',
      properties: {
        json: { type: 'boolean', description: 'JSON output' },
      },
    },
    execute: async (params) => slopeCmd(`loop convergence${params.json ? ' --json' : ''}`, cwd),
  });

  // ── Guard Enforcement via Events ──────────────────

  // Track injected context for dedup (mirrors session-state.ts logic)
  const seenHashes = new Map<string, number>();

  function hashString(s: string): string {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
    }
    return String(hash);
  }

  function dedupContext(guard: string, context: string): string | null {
    const h = hashString(context);
    const count = seenHashes.get(h);
    if (count) {
      seenHashes.set(h, count + 1);
      return `SLOPE ${guard}: (same as prior warning, shown ${count + 1}x)`;
    }
    seenHashes.set(h, 1);
    return null;
  }

  // Enforce hazard warnings on file writes
  pi.on('tool_call', async (toolName: unknown, params: unknown) => {
    const name = String(toolName);
    const p = params as Record<string, unknown>;

    // Guard: hazard warning on write/edit
    if ((name === 'write' || name === 'edit') && p.file_path) {
      try {
        const result = slopeCmd(`guard hazard <<< '${JSON.stringify({
          session_id: 'pi-session',
          cwd,
          hook_event_name: 'PreToolUse',
          tool_name: name === 'write' ? 'Write' : 'Edit',
          tool_input: { file_path: p.file_path },
        })}'`, cwd);

        if (result && result.includes('additionalContext')) {
          const match = result.match(/"additionalContext":"([^"]+)"/);
          if (match) {
            const context = match[1].replace(/\\n/g, '\n');
            const dedup = dedupContext('hazard', context);
            pi.sendMessage('system', dedup ?? context);
          }
        }
      } catch { /* guard failure should never block */ }
    }

    // Guard: commit discipline nudge on bash
    if (name === 'bash' && typeof p.command === 'string') {
      // Nudge on git commit to check branch
      if (/git\s+commit/.test(p.command)) {
        try {
          const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8' }).trim();
          if (branch === 'main' || branch === 'master') {
            pi.sendMessage('system', 'SLOPE: Committing on main/master. Create a feature branch first: git checkout -b feat/<description>');
          }
        } catch { /* not in git repo */ }
      }
    }
  });

  // Guard: post-push suggestions
  pi.on('tool_result', async (toolName: unknown, params: unknown, result: unknown) => {
    const name = String(toolName);
    const p = params as Record<string, unknown>;

    if (name === 'bash' && typeof p.command === 'string' && /git\s+push/.test(p.command)) {
      const status = slopeCmd('sprint status 2>/dev/null || echo "no sprint"', cwd);
      if (status && !status.includes('no sprint') && !status.includes('Error')) {
        pi.sendMessage('system', `SLOPE post-push: Sprint active. Run \`slope guard check\` to verify, or \`slope sprint context\` for next steps.`);
      }
    }
  });

  // ── Slash Commands ────────────────────────────────

  pi.registerCommand('slope', 'Run any SLOPE CLI command', async (args: string) => {
    const output = slopeCmd(args || 'briefing --compact', cwd);
    pi.sendMessage('system', output);
  });

  pi.registerCommand('sprint', 'Quick sprint status', async () => {
    const output = slopeCmd('sprint status', cwd);
    pi.sendMessage('system', output);
  });

  // ── Session Start: Inject Briefing ────────────────

  pi.on('session_start', async () => {
    const briefing = slopeCmd('briefing --compact', cwd);
    pi.sendMessage('system', `SLOPE Session Briefing:\n${briefing}`);
  });
}
