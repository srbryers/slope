/**
 * SLOPE Plugin for OpenCode
 *
 * Registers SLOPE tools and enforces guards via OpenCode's plugin hook system.
 * Install: copy to .opencode/plugins/slope/ or npm install @slope-dev/opencode-plugin
 *
 * OpenCode plugin API:
 * - tool.execute.before: intercept before tool runs (can block)
 * - tool.execute.after: react after tool completes
 * - session.created: inject context at session start
 * - file.edited: react to file changes
 *
 * Note: MCP tool calls do NOT trigger tool.execute hooks (OpenCode issue #2319)
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// OpenCode plugin interface (minimal types)
interface OpenCodeContext {
  project: { root: string };
  directory: string;
  on(event: string, handler: (...args: unknown[]) => void | Promise<void>): void;
  registerCommand(name: string, description: string, handler: (args: string) => Promise<string>): void;
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

// ── Plugin Entry Point ──────────────────────────────

export default function slopePlugin(ctx: OpenCodeContext): void {
  const cwd = ctx.project?.root ?? ctx.directory;

  if (!hasSlopeProject(cwd)) return;

  // Track dedup hashes in-memory
  const seenHashes = new Map<number, number>();

  function hashString(s: string): number {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
    }
    return hash;
  }

  function shouldInject(guard: string, context: string): string | null {
    const h = hashString(context);
    const count = seenHashes.get(h);
    if (count) {
      seenHashes.set(h, count + 1);
      return `SLOPE ${guard}: (same as prior warning, shown ${count + 1}x)`;
    }
    seenHashes.set(h, 1);
    return null; // new — inject full
  }

  // ── Guard Enforcement ─────────────────────────────

  // Before file writes: hazard warning + branch check
  ctx.on('tool.execute.before', async (toolName: unknown, params: unknown) => {
    const name = String(toolName);
    const p = params as Record<string, unknown>;

    if ((name === 'write' || name === 'edit') && p.file_path) {
      // Hazard check
      try {
        const input = JSON.stringify({
          session_id: 'opencode-session',
          cwd,
          hook_event_name: 'PreToolUse',
          tool_name: name === 'write' ? 'Write' : 'Edit',
          tool_input: { file_path: p.file_path },
        });
        const result = execSync(`echo '${input.replace(/'/g, "'\\''")}' | slope guard hazard`, {
          cwd, encoding: 'utf8', timeout: 5000,
        }).trim();

        if (result.includes('additionalContext')) {
          const match = result.match(/"additionalContext":"([^"]+)"/);
          if (match) {
            const context = match[1].replace(/\\n/g, '\n');
            const dedup = shouldInject('hazard', context);
            // OpenCode plugins can log to stderr for agent context
            console.error(dedup ?? context);
          }
        }
      } catch { /* guard failure should never block */ }
    }

    // Branch check on git commit
    if (name === 'bash' && typeof p.command === 'string' && /git\s+commit/.test(p.command)) {
      try {
        const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8' }).trim();
        if (branch === 'main' || branch === 'master') {
          console.error('SLOPE: Committing on main/master. Create a feature branch first.');
        }
      } catch { /* not in git repo */ }
    }
  });

  // After git push: suggest next actions
  ctx.on('tool.execute.after', async (toolName: unknown, params: unknown) => {
    const name = String(toolName);
    const p = params as Record<string, unknown>;

    if (name === 'bash' && typeof p.command === 'string' && /git\s+push/.test(p.command)) {
      console.error('SLOPE: Push complete. Run `slope guard check` to verify or `slope sprint context` for next steps.');
    }
  });

  // Session start: inject compact briefing
  ctx.on('session.created', async () => {
    const briefing = slopeCmd('briefing --compact', cwd);
    console.error(`SLOPE Session Briefing:\n${briefing}`);
  });

  // ── Slash Commands ────────────────────────────────

  ctx.registerCommand('slope', 'Run any SLOPE CLI command', async (args: string) => {
    return slopeCmd(args || 'briefing --compact', cwd);
  });

  ctx.registerCommand('sprint', 'Quick sprint status', async () => {
    return slopeCmd('sprint status', cwd);
  });

  ctx.registerCommand('guard-check', 'Run SLOPE guard validation', async () => {
    return slopeCmd('guard check', cwd);
  });
}
