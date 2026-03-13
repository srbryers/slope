import { openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import type { HookInput, GuardResult } from '../../core/index.js';
import { loadConfig } from '../config.js';

const FALLBACK_CONTEXT =
  'SLOPE subagent tip: Direct subagents to use Glob/Grep for file discovery (not Bash find/ls). Check for CODEBASE.md or MCP search() for repo orientation.';

function buildOrientation(cwd: string): string {
  try {
    const mapPath = join(cwd, 'CODEBASE.md');
    // Read only first 512 bytes — enough for YAML frontmatter
    const buf = Buffer.alloc(512);
    const fd = openSync(mapPath, 'r');
    const bytesRead = readSync(fd, buf, 0, 512, 0);
    closeSync(fd);
    const head = buf.toString('utf8', 0, bytesRead);

    const metaMatch = head.match(/^---\n([\s\S]*?)\n---/m);
    if (!metaMatch) return FALLBACK_CONTEXT;

    const meta = metaMatch[1];
    const extract = (key: string): string | undefined =>
      meta.match(new RegExp(`${key}:\\s*(\\d+)`))?.[1];

    const cmds = extract('cli_commands');
    const guards = extract('guards');
    const tests = extract('test_files');
    const src = extract('source_files');

    const stats = [cmds && `${cmds} CLI commands`, guards && `${guards} guards`, tests && `${tests} test files`, src && `${src} source files`]
      .filter(Boolean)
      .join(', ');

    return `SLOPE subagent tip: Monorepo (packages/core, packages/cli, packages/mcp-tools, packages/tokens). Stats: ${stats}. Direct subagents to read CODEBASE.md or use MCP search({ module: 'map' }) first. Prefer Glob/Grep over Bash find/ls.`;
  } catch {
    return FALLBACK_CONTEXT;
  }
}

/**
 * Subagent gate guard: fires PreToolUse on Agent.
 * Enforces model selection on Explore/Plan subagents (Agent tool has no max_turns).
 */
export async function subagentGateGuard(input: HookInput, _cwd: string): Promise<GuardResult> {
  const toolInput = input.tool_input ?? {};
  const subagentType = toolInput.subagent_type as string | undefined;
  const model = toolInput.model as string | undefined;
  const resume = toolInput.resume as string | undefined;

  // Exempt resumed agents — they inherit prior settings
  if (resume) return {};

  // Only gate Explore and Plan subagents
  if (subagentType !== 'Explore' && subagentType !== 'Plan') return {};

  const config = loadConfig();
  const guidance = config.guidance ?? {};
  const allowedModels = guidance.subagentAllowModels ?? ['haiku'];

  if (model && !allowedModels.includes(model)) {
    return {
      decision: 'deny',
      blockReason: `SLOPE subagent-gate: ${subagentType} agent blocked — model "${model}" not in allowed list [${allowedModels.join(', ')}]. Resubmit with model: ${allowedModels[0]}.`,
    };
  }

  return { context: buildOrientation(_cwd) };
}
