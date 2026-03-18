import { join } from 'node:path';
import type { HookInput, GuardResult } from '../../core/index.js';
import { appendTurn } from '../../core/transcript.js';
import type { ToolCallSummary, TranscriptLine } from '../../core/types.js';
import { loadConfig } from '../config.js';
import { resolveStore } from '../store.js';

/**
 * Summarize tool_input params into a short string for the transcript.
 */
function summarizeParams(toolName: string, toolInput: Record<string, unknown>): string {
  switch (toolName) {
    case 'Read':
      return `file: ${toolInput.file_path ?? ''}`;
    case 'Edit':
    case 'Write':
      return `file: ${toolInput.file_path ?? ''}`;
    case 'Bash':
      return `cmd: ${String(toolInput.command ?? '').slice(0, 80)}`;
    case 'Grep':
      return `pattern: ${toolInput.pattern ?? ''}, path: ${toolInput.path ?? '.'}`;
    case 'Glob':
      return `pattern: ${toolInput.pattern ?? ''}`;
    case 'Task':
      return `type: ${toolInput.subagent_type ?? ''}`;
    default: {
      const json = JSON.stringify(toolInput);
      return json.length > 80 ? json.slice(0, 80) + '...' : json;
    }
  }
}

/**
 * Detect whether the tool call succeeded from tool_response.
 */
function detectSuccess(toolResponse: Record<string, unknown> | undefined): boolean {
  if (!toolResponse) return true;
  if (toolResponse.error) return false;
  if (typeof toolResponse.stderr === 'string' && (toolResponse.stderr as string).length > 0) return false;
  if (toolResponse.is_error === true) return false;
  return true;
}

/**
 * Transcript guard: fires PostToolUse on all tools (no matcher).
 * Appends tool call metadata to the session transcript JSONL file.
 * Silent — returns empty GuardResult, no context injection.
 *
 * Note: appendFileSync is safe for single-agent sessions (typical usage).
 * Multi-agent scenarios sharing a session_id could interleave partial writes;
 * if multi-agent transcript support is needed, add file locking or per-agent files.
 */
export async function transcriptGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  // Skip if no session_id
  if (!input.session_id) return {};

  const config = loadConfig();
  const transcriptsDir = join(cwd, config.transcriptsPath ?? '.slope/transcripts');

  const toolName = input.tool_name ?? 'unknown';
  const toolInput = input.tool_input ?? {};
  const success = detectSuccess(input.tool_response);

  const toolCall: ToolCallSummary = {
    tool: toolName,
    params_summary: summarizeParams(toolName, toolInput),
    success,
  };

  const line: TranscriptLine = {
    role: 'tool_result',
    timestamp: new Date().toISOString(),
    tool_calls: [toolCall],
    outcome: success ? 'success' : 'failure',
  };

  try {
    appendTurn(transcriptsDir, input.session_id, line);
  } catch {
    // Silent — transcript write failure should never block the agent
  }

  // Heartbeat: keep session alive in store (prevents stale cleanup with shorter TTL)
  if (input.session_id) {
    try {
      const store = await resolveStore(cwd);
      try {
        await store.updateHeartbeat(input.session_id);
      } finally {
        try { store.close(); } catch { /* ignore */ }
      }
    } catch { /* heartbeat failure is non-fatal */ }
  }

  return {};
}
