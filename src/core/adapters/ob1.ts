// SLOPE OB1Adapter — adapts guard framework to OB1's per-event hook system.
// OB1 (OB-1 CLI) uses per-event executable scripts in .ob1/hooks/.
// Each script receives JSON on stdin and returns JSON on stdout.
//
// OB1 hook protocol:
//   Allow: {} or { "output": "context message" }
//   Block: { "error": "block reason" }
//
// Hook types: pre_tool, post_tool, pre_agent, post_agent
// Naming convention: <hook-type>_slope.sh (e.g., pre_tool_slope.sh)

import { existsSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import type { HarnessAdapter, ToolNameMap } from '../harness.js';
import { registerAdapter, resolveToolMatcher, SLOPE_BIN_PREAMBLE, writeOrUpdateManagedScript } from '../harness.js';
import type { GuardResult, AnyGuardDefinition } from '../guard.js';

/**
 * OB1 tool name mappings — verified from OB1 tool definitions.
 *
 * OB1 agents have access to: read_file, write_file, replace, apply_patch,
 * glob, list_directory, grep_search, run_shell_command, worker, general,
 * explore, plan, codebase_investigator, browser, vision-analyzer,
 * handoff_to_agent, web_fetch, google_web_search.
 */
const OB1_TOOLS: ToolNameMap = {
  read_file: 'read_file',
  write_file: 'replace|write_file|apply_patch',
  search_files: 'glob|list_directory',
  search_content: 'grep_search',
  execute_command: 'run_shell_command',
  create_subagent: 'worker|general|explore|plan|codebase_investigator|browser|vision-analyzer|handoff_to_agent|web',
  exit_plan: '',  // No OB1 equivalent for exit_plan
};

/**
 * OB1 hook output protocol.
 *
 * OB1 hooks receive JSON on stdin and return JSON on stdout:
 *   Allow (no context): {}
 *   Allow (with context): { "output": "context message for the agent" }
 *   Block: { "error": "reason for blocking" }
 */
export interface OB1HookOutput {
  /** Context to inject into agent's conversation (when allowing) */
  output?: string;
  /** Error message to block the operation */
  error?: string;
}

/**
 * Map SLOPE hook events to OB1 hook script base names.
 *
 * PreCompact is intentionally NOT mapped — OB1 has no pre-compaction hook.
 * Stop maps to post_agent — OB1's post_agent fires when the agent finishes,
 * which is semantically equivalent to Slope's Stop event.
 */
const HOOK_EVENT_MAP: Partial<Record<'PreToolUse' | 'PostToolUse' | 'Stop' | 'PreCompact', string>> = {
  PreToolUse: 'pre_tool',
  PostToolUse: 'post_tool',
  Stop: 'post_agent',
};

/** OB1 adapter — formats guard output for OB1's JSON hook protocol. */
export class OB1Adapter implements HarnessAdapter {
  readonly id = 'ob1' as const;
  readonly displayName = 'OB1';
  readonly toolNames: ToolNameMap = OB1_TOOLS;
  readonly supportedEvents = new Set(['PreToolUse', 'PostToolUse', 'Stop']);
  readonly supportsContextInjection = true;

  hooksConfigPath(_cwd: string): string | null {
    // OB1 uses directory-based hook discovery (per-event scripts), not a single config file.
    return null;
  }

  formatPreToolOutput(result: GuardResult): OB1HookOutput {
    if (result.decision === 'deny' || result.blockReason) {
      return {
        error: result.blockReason ?? 'Blocked by SLOPE guard',
        ...(result.context && { output: result.context }),
      };
    }
    // 'ask' maps to allow — OB1 has no user-confirmation prompt
    if (result.context) {
      return { output: result.context };
    }
    return {};
  }

  formatPostToolOutput(result: GuardResult): OB1HookOutput {
    if (result.blockReason) {
      return {
        error: result.blockReason,
        ...(result.context && { output: result.context }),
      };
    }
    if (result.context) {
      return { output: result.context };
    }
    return {};
  }

  formatStopOutput(result: GuardResult): OB1HookOutput {
    if (result.blockReason) {
      return { error: result.blockReason };
    }
    return {};
  }

  /**
   * Generate per-event dispatcher script content for a set of guards.
   * OB1 uses per-event scripts named <hook-type>_slope.sh in .ob1/hooks/.
   * Each script handles all guards for that event, including tool name filtering.
   *
   * Returns a map of script filename → script content.
   */
  generateHooksConfig(guards: AnyGuardDefinition[], guardScriptPath: string): Record<string, string> {
    const scripts: Record<string, string> = {};

    // Group guards by OB1 hook event
    const guardsByEvent = new Map<string, AnyGuardDefinition[]>();
    for (const g of guards) {
      const ob1Event = HOOK_EVENT_MAP[g.hookEvent];
      if (!ob1Event) continue;

      let list = guardsByEvent.get(ob1Event);
      if (!list) {
        list = [];
        guardsByEvent.set(ob1Event, list);
      }
      list.push(g);
    }

    for (const [event, eventGuards] of guardsByEvent) {
      const guardCalls = eventGuards.map(g => {
        const matcher = resolveToolMatcher(this, 'toolCategories' in g ? g.toolCategories : undefined);
        if (matcher) {
          // Filter by tool name — OB1 has no built-in matcher, so we filter in the script
          // exit_plan maps to empty string — filter out empty tool names
          const filteredTools = matcher.split('|').filter(Boolean);
          if (filteredTools.length === 0) {
            // All tools filtered out (e.g., exit_plan has no OB1 equivalent) — skip guard
            return [
              `# Guard: ${g.name} — ${g.description}`,
              `# NOTE: Skipped — no OB1 equivalent tool for this guard's toolCategories`,
            ].join('\n');
          }
          const tools = filteredTools.map(t => `"${t}"`).join(' ');
          return [
            `# Guard: ${g.name} — ${g.description}`,
            `TOOLS=(${tools})`,
            `if tool_matches "$TOOL_NAME" "\${TOOLS[@]}"; then`,
            `  run_guard "${guardScriptPath}" "${g.name}"`,
            `fi`,
          ].join('\n');
        }
        // No matcher — runs for all tools
        return [
          `# Guard: ${g.name} — ${g.description}`,
          `run_guard "${guardScriptPath}" "${g.name}"`,
        ].join('\n');
      });

      // Script filename: <event>_slope.sh (e.g., pre_tool_slope.sh)
      const scriptFilename = `${event}_slope.sh`;

      scripts[scriptFilename] = [
        '#!/usr/bin/env bash',
        `# SLOPE guard dispatcher for OB1 ${event} event`,
        '# Auto-generated by slope hook add --level=full --harness=ob1',
        '#',
        '# OB1 passes JSON on stdin. This script routes to matching SLOPE guards',
        '# and returns JSON on stdout with { output?, error? }.',
        '',
        '# === SLOPE MANAGED (do not edit above this line) ===',
        '',
        '# Read stdin once and cache it',
        'INPUT=$(cat)',
        '',
        '# Extract tool name from OB1 stdin JSON.',
        '# OB1 provides tool info as { "name": "tool_name", "args": {...} }',
        '# For non-tool events (post_agent), TOOL_NAME will be empty — this is correct.',
        'HAS_JQ=false',
        'command -v jq >/dev/null 2>&1 && HAS_JQ=true',
        '',
        'if [ "$HAS_JQ" = "true" ]; then',
        '  TOOL_NAME=$(echo "$INPUT" | jq -r \'.name // empty\' 2>/dev/null || true)',
        'else',
        '  # Fallback: extract "name" field from JSON',
        '  TOOL_NAME=$(echo "$INPUT" | sed -n \'s/.*"name"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p\' | head -1)',
        'fi',
        '',
        '# Track combined result',
        'BLOCKED=false',
        'ERROR_MSG=""',
        'CONTEXT=""',
        '',
        'tool_matches() {',
        '  local tool="$1"; shift',
        '  for t in "$@"; do',
        '    [ "$tool" = "$t" ] && return 0',
        '  done',
        '  return 1',
        '}',
        '',
        '# JSON-safe string escape (for printf output)',
        'json_escape() {',
        '  local s="$1"',
        '  s="${s//\\\\/\\\\\\\\}"',   // escape backslashes
        '  s="${s//\"/\\\\\"}"',        // escape double quotes
        '  printf "%s" "$s"',
        '}',
        '',
        'run_guard() {',
        '  local script="$1" guard="$2"',
        '  local result',
        '  result=$(echo "$INPUT" | "$script" "$guard" 2>/dev/null) || return 0',
        '  ',
        '  if [ "$HAS_JQ" = "true" ]; then',
        '    local err ctx',
        '    err=$(echo "$result" | jq -r \'.error // empty\' 2>/dev/null || true)',
        '    if [ -n "$err" ]; then',
        '      BLOCKED=true',
        '      ERROR_MSG="${ERROR_MSG:+$ERROR_MSG; }$err"',
        '    fi',
        '    ctx=$(echo "$result" | jq -r \'.output // empty\' 2>/dev/null || true)',
        '    [ -n "$ctx" ] && CONTEXT="${CONTEXT:+$CONTEXT; }$ctx"',
        '  else',
        '    # Fallback: grep-based JSON parsing',
        '    local err',
        '    err=$(echo "$result" | sed -n \'s/.*"error"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p\' | head -1)',
        '    if [ -n "$err" ]; then',
        '      BLOCKED=true',
        '      ERROR_MSG="${ERROR_MSG:+$ERROR_MSG; }$err"',
        '    fi',
        '    local ctx',
        '    ctx=$(echo "$result" | sed -n \'s/.*"output"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p\' | head -1)',
        '    [ -n "$ctx" ] && CONTEXT="${CONTEXT:+$CONTEXT; }$ctx"',
        '  fi',
        '}',
        '',
        ...guardCalls,
        '',
        '# Output combined result — use jq for safe JSON encoding if available',
        'if [ "$HAS_JQ" = "true" ]; then',
        '  if [ "$BLOCKED" = "true" ]; then',
        '    if [ -n "$CONTEXT" ]; then',
        '      jq -n --arg err "$ERROR_MSG" --arg ctx "$CONTEXT" \\',
        '        \'{error:$err,output:$ctx}\'',
        '    else',
        '      jq -n --arg err "$ERROR_MSG" \'{error:$err}\'',
        '    fi',
        '  elif [ -n "$CONTEXT" ]; then',
        '    jq -n --arg ctx "$CONTEXT" \'{output:$ctx}\'',
        '  else',
        '    echo \'{}\'',
        '  fi',
        'else',
        '  # Fallback: manual JSON with escaped values',
        '  if [ "$BLOCKED" = "true" ]; then',
        '    if [ -n "$CONTEXT" ]; then',
        '      printf \'{"error":"%s","output":"%s"}\\n\' "$(json_escape "$ERROR_MSG")" "$(json_escape "$CONTEXT")"',
        '    else',
        '      printf \'{"error":"%s"}\\n\' "$(json_escape "$ERROR_MSG")"',
        '    fi',
        '  elif [ -n "$CONTEXT" ]; then',
        '    printf \'{"output":"%s"}\\n\' "$(json_escape "$CONTEXT")"',
        '  else',
        '    printf \'{}\\n\'',
        '  fi',
        'fi',
        '',
        '# === SLOPE END ===',
        '',
      ].join('\n');
    }

    return scripts;
  }

  installGuards(cwd: string, guards: AnyGuardDefinition[]): void {
    const hooksDir = join(cwd, '.ob1', 'hooks');
    mkdirSync(hooksDir, { recursive: true });

    // Create or update the guard dispatcher (preserves user content after SLOPE END)
    const dispatcherPath = join(hooksDir, 'slope-guard.sh');
    const script = [
      '#!/usr/bin/env bash',
      '# SLOPE guard dispatcher — called by per-event hook scripts',
      '# Auto-generated by slope hook add --level=full --harness=ob1',
      '#',
      '# Receives JSON on stdin, passes to slope guard, returns JSON on stdout.',
      '',
      '# === SLOPE MANAGED (do not edit above this line) ===',
      ...SLOPE_BIN_PREAMBLE,
      '',
      'slope guard "$@"',
      '# === SLOPE END ===',
      '',
    ].join('\n');
    const dispatcherResult = writeOrUpdateManagedScript(dispatcherPath, script);
    if (dispatcherResult !== 'unchanged') {
      console.log(`  ${dispatcherResult === 'created' ? 'Created' : 'Updated'} ${dispatcherPath}`);
    }

    // Generate per-event scripts
    const guardScript = join('.ob1', 'hooks', 'slope-guard.sh');
    const eventScripts = this.generateHooksConfig(guards, guardScript) as Record<string, string>;

    for (const [scriptFilename, content] of Object.entries(eventScripts)) {
      const scriptPath = join(hooksDir, scriptFilename);
      // Always overwrite event scripts (they're fully generated)
      writeFileSync(scriptPath, content);
      chmodSync(scriptPath, 0o755);
      console.log(`  Created ${scriptPath}`);
    }

    // Generate guards manifest for reference
    const manifestPath = join(hooksDir, 'guards-manifest.json');
    const manifest = guards
      .filter(g => HOOK_EVENT_MAP[g.hookEvent])
      .map(g => {
        const matcher = resolveToolMatcher(this, 'toolCategories' in g ? g.toolCategories : undefined) ?? g.matcher;
        return {
          name: g.name,
          description: g.description,
          hookEvent: g.hookEvent,
          ob1HookType: HOOK_EVENT_MAP[g.hookEvent],
          ...(matcher && { matcher }),
          level: g.level,
          command: `${guardScript} ${g.name}`,
        };
      });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`  Created ${manifestPath}`);

    console.log(`  Installed ${Object.keys(eventScripts).length} OB1 hook scripts to ${hooksDir}`);
  }

  detect(cwd: string): boolean {
    // Only detect if .ob1/hooks directory exists (not just .ob1/ which is the global config dir).
    // This prevents false-positives — the global ~/.ob1 lives in the user's home directory,
    // not the project root. A project-level .ob1/hooks/ only exists when OB1 hooks have
    // been explicitly set up for this project.
    return existsSync(join(cwd, '.ob1', 'hooks'));
  }
}

/** Singleton instance */
export const ob1Adapter = new OB1Adapter();

// Auto-register on import
registerAdapter(ob1Adapter);
