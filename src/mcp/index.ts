#!/usr/bin/env node
/**
 * @slope-dev/slope — Code-mode MCP server for SLOPE.
 *
 * Exposes up to 6 tools:
 *   search()           — discover the SLOPE API (functions, types, constants)
 *   execute()          — run JS in a sandboxed node:vm with the full API pre-injected
 *   session_status()   — show active sessions and claims (requires store)
 *   acquire_claim()    — claim a ticket/area (requires store)
 *   check_conflicts()  — detect overlapping claims (requires store)
 *   store_status()     — check store health, schema version, stats (requires store)
 *
 * Usage:
 *   npx @slope-dev/slope              # stdio transport
 *   import { createSlopeToolsServer }     # programmatic
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SLOPE_REGISTRY, SLOPE_TYPES } from './registry.js';
import { runInSandbox } from './sandbox.js';
import type { SlopeStore } from '../core/index.js';
import { checkConflicts, loadFlows, checkFlowStaleness, checkStoreHealth, METAPHOR_SCHEMA, listMetaphors, buildInterviewContext, generateInterviewSteps, loadConfig } from '../core/index.js';
import { gaming } from '../core/metaphors/gaming.js';
import type { ClaimScope, FlowsFile, FlowDefinition } from '../core/index.js';

/** Tool names exposed by this MCP server (for tests and tool discovery). */
export const SLOPE_MCP_TOOL_NAMES = ['search', 'execute', 'session_status', 'acquire_claim', 'check_conflicts', 'store_status', 'testing_session_start', 'testing_session_finding', 'testing_session_end', 'testing_session_status'] as const;

/** Detection results for hook/settings activation status. */
export interface SetupHints {
  guardsInstalled: boolean;
  lifecycleHooksInstalled: boolean;
  settingsConfigured: boolean;
}

/** Detect which SLOPE hooks and settings are activated in the project. */
export function detectSetupHints(projectRoot: string): SetupHints {
  const hints: SetupHints = {
    guardsInstalled: false,
    lifecycleHooksInstalled: false,
    settingsConfigured: false,
  };

  // Check .slope/hooks.json for guard-* and lifecycle hook entries
  const hooksPath = join(projectRoot, '.slope', 'hooks.json');
  if (existsSync(hooksPath)) {
    try {
      const hooksData = JSON.parse(readFileSync(hooksPath, 'utf-8'));
      const installed = hooksData?.installed ?? {};
      const keys = Object.keys(installed);
      hints.guardsInstalled = keys.some((k) => k.startsWith('guard-'));
      hints.lifecycleHooksInstalled =
        keys.includes('session-start') && keys.includes('session-end');
    } catch {
      // Malformed JSON — treat as not installed
    }
  }

  // Check .claude/settings.json for slope-guard.sh in hooks commands
  const settingsPath = join(projectRoot, '.claude', 'settings.json');
  if (existsSync(settingsPath)) {
    try {
      const raw = readFileSync(settingsPath, 'utf-8');
      hints.settingsConfigured = raw.includes('slope-guard.sh');
    } catch {
      // Unreadable — treat as not configured
    }
  }

  return hints;
}

/** Build a markdown hint string, or null if everything is already set up. */
export function buildSetupHint(hints: SetupHints): string | null {
  const missing: string[] = [];

  if (!hints.guardsInstalled) {
    missing.push(
      '- **Guard hooks** (explore, hazard, commit-nudge, scope-drift, compaction, stop-check):\n' +
      '  Proactive guidance during coding. Install with: `slope hook add --level=full`',
    );
  }

  if (!hints.lifecycleHooksInstalled) {
    missing.push(
      '- **Lifecycle hooks** (session-start, session-end):\n' +
      '  Automatic session tracking and briefings.\n' +
      '  Install with: `slope hook add session-start && slope hook add session-end`',
    );
  }

  if (!hints.settingsConfigured && !hints.guardsInstalled) {
    // Settings only matter if guards aren't installed; if guards are installed
    // but settings are missing, the hook add command handles both.
  }

  if (missing.length === 0) return null;

  return (
    '---\n' +
    'SLOPE Setup Hint: The following hooks are not yet activated:\n\n' +
    missing.join('\n\n') +
    '\n\nRun the commands above, then restart your session to activate.'
  );
}

export function createSlopeToolsServer(store?: SlopeStore, setupHints?: SetupHints, storeType?: string): McpServer {
  const server = new McpServer({
    name: 'slope-tools',
    version: '1.0.0',
  });

  server.tool(
    'search',
    'Discover SLOPE API functions, filesystem helpers, constants, and type definitions. Call with no args to see everything, or filter by query/module.',
    {
      query: z.string().optional().describe('Case-insensitive search term to filter by name or description'),
      module: z.enum(['core', 'fs', 'constants', 'types', 'store', 'map', 'flows', 'metaphor', 'init', 'testing']).optional().describe('Filter by module category'),
    },
    async ({ query, module }) => {
      // Map module — return codebase map content
      if (module === 'map') {
        return { content: [{ type: 'text' as const, text: handleMapQuery(query) }] };
      }
      // Metaphor module — return schema, built-in list, and example
      if (module === 'metaphor') {
        return { content: [{ type: 'text' as const, text: handleMetaphorQuery() }] };
      }
      // Init module — return interview step schema + agent workflow instructions
      if (module === 'init') {
        return { content: [{ type: 'text' as const, text: handleInitQuery() }] };
      }
      // Flows module — return flow definitions
      if (module === 'flows') {
        return { content: [{ type: 'text' as const, text: handleFlowsQuery(query) }] };
      }
      if (module === 'types') {
        return { content: [{ type: 'text' as const, text: SLOPE_TYPES }] };
      }
      let results = SLOPE_REGISTRY;
      if (module) {
        results = results.filter((e) => e.module === module);
      }
      if (query) {
        const q = query.toLowerCase();
        results = results.filter(
          (e) => e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
        );
      }
      const content: Array<{ type: 'text'; text: string }> = [
        { type: 'text' as const, text: JSON.stringify(results, null, 2) },
      ];
      // Append setup hint only on unfiltered discovery calls (no query, no module)
      if (!query && !module && setupHints) {
        const hint = buildSetupHint(setupHints);
        if (hint) {
          content.push({ type: 'text' as const, text: hint });
        }
      }
      return { content };
    },
  );

  server.tool(
    'execute',
    'Run JavaScript code in a sandboxed environment with the full SLOPE API and filesystem helpers pre-injected. Use `return` to produce output. Call search() first to discover available functions.',
    {
      code: z.string().describe('JavaScript code to execute. Use `return` for output. All SLOPE core functions, constants, and fs helpers are available as top-level names.'),
    },
    async ({ code }) => {
      try {
        const { result, logs } = await runInSandbox(code, process.cwd());
        const parts: Array<{ type: 'text'; text: string }> = [];
        if (logs.length > 0) {
          parts.push({ type: 'text' as const, text: '--- logs ---\n' + logs.join('\n') });
        }
        parts.push({ type: 'text' as const, text: JSON.stringify(result, null, 2) ?? 'undefined' });
        return { content: parts };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    },
  );

  // Store-backed tools (only available when a store is provided)
  if (store) {
    server.tool(
      'session_status',
      'Show active SLOPE sessions and their claims.',
      {},
      async () => {
        const sessions = await store.getActiveSessions();
        const claims = await store.getActiveClaims();
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ sessions, claims }, null, 2),
          }],
        };
      },
    );

    server.tool(
      'acquire_claim',
      'Claim a ticket or area for the current sprint.',
      {
        sessionId: z.string().describe('Session ID to associate with the claim'),
        target: z.string().describe('Ticket key or area path to claim'),
        scope: z.enum(['ticket', 'area']).describe('Claim scope: ticket or area'),
        sprintNumber: z.number().describe('Sprint number'),
        player: z.string().describe('Player name'),
      },
      async ({ sessionId, target, scope, sprintNumber, player }) => {
        const claim = await store.claim({
          sprint_number: sprintNumber,
          player,
          target,
          scope: scope as ClaimScope,
          session_id: sessionId,
        });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(claim, null, 2),
          }],
        };
      },
    );

    server.tool(
      'check_conflicts',
      'Detect overlapping and adjacent conflicts among sprint claims.',
      {
        sprintNumber: z.number().optional().describe('Optional sprint number to filter claims'),
      },
      async ({ sprintNumber }) => {
        const claims = await store.getActiveClaims(sprintNumber);
        const conflicts = checkConflicts(claims);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ claims: claims.length, conflicts }, null, 2),
          }],
        };
      },
    );

    server.tool(
      'store_status',
      'Check store health: schema version, row counts, and error status.',
      {},
      async () => {
        const result = await checkStoreHealth(store, storeType ?? 'unknown');
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      },
    );

    // ─── Testing Session Tools ───

    server.tool(
      'testing_session_start',
      'Start a manual testing session. Creates a fresh git worktree for testing, returns setup steps from config. Only one active session allowed at a time.',
      {
        purpose: z.string().optional().describe('Purpose or focus area for this testing session'),
        sprint: z.number().optional().describe('Associated sprint number'),
      },
      async ({ purpose, sprint }) => {
        // Check for existing active session
        const existing = await store.getActiveTestingSession();
        if (existing) {
          return {
            content: [{ type: 'text' as const, text: `Error: Active testing session already exists (${existing.id}, started ${existing.started_at}). End it first with testing_session_end.` }],
            isError: true,
          };
        }

        let projectRoot: string;
        try {
          projectRoot = findProjectRoot(process.cwd());
        } catch {
          projectRoot = process.cwd();
        }

        // Clean up stale testing worktrees (best-effort)
        const worktreeDir = join(projectRoot, '.claude', 'worktrees');
        try {
          const { readdirSync, existsSync: dirExists } = await import('node:fs');
          if (dirExists(worktreeDir)) {
            const entries = readdirSync(worktreeDir).filter(e => e.startsWith('testing-'));
            for (const entry of entries) {
              try {
                // Check if branch is merged and no active session references it
                const wtPath = join(worktreeDir, entry);
                execSync(`git worktree remove ${JSON.stringify(wtPath)} --force 2>/dev/null`, { cwd: projectRoot, timeout: 10000 });
              } catch { /* best-effort cleanup */ }
            }
            execSync('git worktree prune 2>/dev/null', { cwd: projectRoot, timeout: 5000 });
          }
        } catch { /* best-effort cleanup */ }

        // Create fresh worktree
        const timestamp = Date.now();
        const branchName = `testing/${timestamp}`;
        const worktreePath = join(worktreeDir, `testing-${timestamp}`);
        try {
          // Ensure worktree parent directory exists
          const { mkdirSync: mkdirS } = await import('node:fs');
          mkdirS(worktreeDir, { recursive: true });

          // Get the default branch (main or master)
          let baseBranch = 'main';
          try {
            baseBranch = execSync('git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null', { cwd: projectRoot, encoding: 'utf8', timeout: 5000 }).trim().replace('refs/remotes/origin/', '');
          } catch {
            try {
              execSync('git rev-parse --verify origin/main 2>/dev/null', { cwd: projectRoot, timeout: 5000 });
            } catch {
              baseBranch = 'master';
            }
          }

          execSync(`git worktree add ${JSON.stringify(worktreePath)} -b ${branchName} origin/${baseBranch}`, { cwd: projectRoot, timeout: 30000 });

          // Mirror .slope directory for store access
          const slopeDir = join(projectRoot, '.slope');
          const wtSlopeDir = join(worktreePath, '.slope');
          const { cpSync } = await import('node:fs');
          if (existsSync(slopeDir)) {
            cpSync(slopeDir, wtSlopeDir, { recursive: true });
          }
        } catch (err) {
          return {
            content: [{ type: 'text' as const, text: `Error creating testing worktree: ${err instanceof Error ? err.message : String(err)}` }],
            isError: true,
          };
        }

        // Detect current branch for session record
        let currentBranch: string | undefined;
        try {
          currentBranch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { cwd: projectRoot, encoding: 'utf8', timeout: 5000 }).trim();
        } catch { /* not in git repo */ }

        // Create session in store
        const session = await store.createTestingSession({
          branch: currentBranch,
          sprint,
          purpose,
          worktree_path: worktreePath,
          branch_name: branchName,
        });

        // Load config for setup steps
        let setupSteps: string[] = [];
        try {
          const config = loadConfig(projectRoot);
          if (config.testing?.setup_steps) {
            setupSteps = config.testing.setup_steps.map(step =>
              step.replace(/\{projectRoot\}/g, projectRoot).replace(/\{worktreeRoot\}/g, worktreePath),
            );
          }
        } catch { /* no config — no setup steps */ }

        const response: Record<string, unknown> = {
          session_id: session.id,
          started_at: session.started_at,
          worktree_path: worktreePath,
          branch_name: branchName,
          setup_steps: setupSteps,
          prompt: `Testing session started. The testing worktree is at: ${worktreePath}\n\n` +
            (setupSteps.length > 0
              ? `Walk the user through these setup steps in the worktree:\n${setupSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n`
              : '') +
            'Once setup is complete, the user can begin testing. Use testing_session_finding to record any bugs or observations found during testing.\n' +
            'When done testing, remind the user to run any teardown steps BEFORE calling testing_session_end.',
        };

        return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
      },
    );

    server.tool(
      'testing_session_finding',
      'Record a finding (bug, observation, issue) during an active testing session.',
      {
        description: z.string().describe('Description of the finding'),
        severity: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Severity level (default: medium)'),
        ticket: z.string().optional().describe('Associated ticket key'),
      },
      async ({ description, severity, ticket }) => {
        const session = await store.getActiveTestingSession();
        if (!session) {
          return {
            content: [{ type: 'text' as const, text: 'Error: No active testing session. Start one with testing_session_start.' }],
            isError: true,
          };
        }

        const finding = await store.addTestingFinding({
          session_id: session.id,
          description,
          severity: severity ?? 'medium',
          ticket,
        });

        const findings = await store.getTestingFindings(session.id);

        const response = {
          finding_id: finding.id,
          session_id: session.id,
          running_count: findings.length,
          prompt: `Finding recorded (${findings.length} total). Is there more to test, or would you like to end the session? Remember to run teardown steps before calling testing_session_end.`,
        };

        return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
      },
    );

    server.tool(
      'testing_session_end',
      'End the active testing session. Returns a summary of findings and runs worktree cleanup. Run any teardown steps BEFORE calling this tool.',
      {
        session_id: z.string().optional().describe('Session ID to end (defaults to active session)'),
        skip_cleanup: z.boolean().optional().describe('Skip worktree removal (default: false)'),
      },
      async ({ session_id, skip_cleanup }) => {
        // Resolve session
        let sessionId = session_id;
        if (!sessionId) {
          const active = await store.getActiveTestingSession();
          if (!active) {
            return {
              content: [{ type: 'text' as const, text: 'Error: No active testing session to end.' }],
              isError: true,
            };
          }
          sessionId = active.id;
        }

        // Get findings before ending
        const findings = await store.getTestingFindings(sessionId);

        // End session in store
        const result = await store.endTestingSession(sessionId);

        // Load teardown steps
        let teardownSteps: string[] = [];
        let projectRoot: string;
        try {
          projectRoot = findProjectRoot(process.cwd());
          const config = loadConfig(projectRoot);
          if (config.testing?.teardown_steps) {
            teardownSteps = config.testing.teardown_steps.map(step =>
              step.replace(/\{projectRoot\}/g, projectRoot).replace(/\{worktreeRoot\}/g, result.worktree_path ?? ''),
            );
          }
        } catch {
          projectRoot = process.cwd();
        }

        // Worktree cleanup
        let cleanupStatus = 'skipped';
        if (!skip_cleanup && result.worktree_path) {
          try {
            execSync(`git worktree remove ${JSON.stringify(result.worktree_path)} --force 2>/dev/null`, { cwd: projectRoot, timeout: 15000 });
            if (result.branch_name) {
              execSync(`git branch -D ${result.branch_name} 2>/dev/null`, { cwd: projectRoot, timeout: 5000 });
            }
            execSync('git worktree prune 2>/dev/null', { cwd: projectRoot, timeout: 5000 });
            cleanupStatus = 'success';
          } catch {
            cleanupStatus = 'failed — manual cleanup may be needed';
          }
        }

        // Build summary
        const severityCounts: Record<string, number> = {};
        for (const f of findings) {
          severityCounts[f.severity] = (severityCounts[f.severity] ?? 0) + 1;
        }

        const response = {
          session_id: sessionId,
          ended_at: result.ended_at,
          finding_count: result.finding_count,
          severity_counts: severityCounts,
          findings: findings.map(f => ({
            id: f.id,
            description: f.description,
            severity: f.severity,
            ticket: f.ticket,
          })),
          teardown_steps: teardownSteps,
          worktree_cleanup: cleanupStatus,
          prompt: result.finding_count > 0
            ? `Testing session ended with ${result.finding_count} finding(s). Suggested next actions:\n` +
              '1. File issues for critical/high findings\n' +
              '2. Start a sprint to fix the bugs found\n' +
              '3. Add findings to the backlog'
            : 'Testing session ended with no findings. Clean run!',
        };

        return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
      },
    );

    server.tool(
      'testing_session_status',
      'Show active testing session info and findings, or indicate no active session.',
      {},
      async () => {
        const session = await store.getActiveTestingSession();
        if (!session) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ active: false, message: 'No active testing session.' }, null, 2) }] };
        }

        const findings = await store.getTestingFindings(session.id);

        const response = {
          active: true,
          session,
          findings,
          finding_count: findings.length,
        };

        return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
      },
    );
  }

  return server;
}

/** Handle search({ module: 'metaphor' }) — return schema, built-in list, and example for custom metaphor generation */
function handleMetaphorQuery(): string {
  // Built-in metaphors are loaded via the barrel import of core at the top of this file
  const builtins = listMetaphors();
  const sections: string[] = [];

  sections.push('# SLOPE Metaphor Schema\n');
  sections.push('Use this schema to generate a valid custom MetaphorDefinition.\n');

  sections.push('## Required Keys\n');
  sections.push('Each category below lists the keys that must have a non-empty string value:\n');
  for (const [category, keys] of Object.entries(METAPHOR_SCHEMA)) {
    sections.push(`**${category}:** ${(keys as readonly string[]).join(', ')}`);
  }

  sections.push('\n## Built-in Metaphors\n');
  for (const m of builtins) {
    sections.push(`- **${m.id}** (${m.name}): ${m.description}`);
  }

  sections.push('\n## Example: Gaming Metaphor\n');
  sections.push('Use this as a reference when generating a new metaphor:\n');
  sections.push('```json');
  sections.push(JSON.stringify(gaming, null, 2));
  sections.push('```');

  sections.push('\n## How to Create a Custom Metaphor\n');
  sections.push('1. Generate a MetaphorDefinition object with all required keys filled in');
  sections.push('2. Call `saveCustomMetaphor(definition, true)` to validate, save, and activate it');
  sections.push('3. The metaphor will be saved to `.slope/plugins/metaphors/<id>.json`');
  sections.push('4. If `setActive=true`, it becomes the active metaphor in config');

  return sections.join('\n');
}

/** Handle search({ module: 'map' }) — return codebase map content with optional section filtering */
function handleMapQuery(query?: string): string {
  const cwd = process.cwd();
  const mapPath = join(cwd, 'CODEBASE.md');

  if (!existsSync(mapPath)) {
    return 'No codebase map found at CODEBASE.md. Run `slope map` to generate one.';
  }

  const content = readFileSync(mapPath, 'utf8');
  let result = '';

  // Check staleness from metadata
  const metaMatch = content.match(/^---\n([\s\S]*?)\n---/m);
  if (metaMatch) {
    const gitShaMatch = metaMatch[1].match(/git_sha:\s*"?([^"\n]+)"?/);
    if (gitShaMatch) {
      try {
        const distance = parseInt(
          execSync(`git rev-list --count ${gitShaMatch[1]}..HEAD 2>/dev/null`, { cwd, encoding: 'utf8' }).trim() || '0',
          10,
        );
        if (distance > 50) {
          result += `⚠️ WARNING: Codebase map is stale (${distance} commits behind). Run \`slope map\` to refresh.\n\n`;
        }
      } catch { /* git command failed — skip staleness check */ }
    }
  }

  if (query) {
    // Filter to sections matching the query
    const q = query.toLowerCase();
    const sections = content.split(/^(?=## )/m);
    const matched = sections.filter(s => {
      const heading = s.match(/^## (.+)/)?.[1] ?? '';
      return heading.toLowerCase().includes(q);
    });

    if (matched.length === 0) {
      result += `No sections matching "${query}" found in codebase map. Available sections:\n`;
      const headings = content.match(/^## .+/gm) ?? [];
      result += headings.map(h => `- ${h.replace('## ', '')}`).join('\n');
    } else {
      result += matched.join('\n');
    }
  } else {
    result += content;
  }

  return result;
}

/** Handle search({ module: 'flows' }) — return flow definitions with optional filtering */
function handleFlowsQuery(query?: string): string {
  const cwd = process.cwd();

  // Resolve flows path from config (config.json is already in .slope/)
  let flowsPath: string;
  try {
    const configPath = join(cwd, '.slope', 'config.json');
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      flowsPath = join(cwd, config.flowsPath || '.slope/flows.json');
    } else {
      flowsPath = join(cwd, '.slope', 'flows.json');
    }
  } catch {
    flowsPath = join(cwd, '.slope', 'flows.json');
  }

  const flows = loadFlows(flowsPath);
  if (!flows) {
    return 'No flows defined. Run `slope flows init` to create .slope/flows.json.';
  }

  if (flows.flows.length === 0) {
    return 'Flows file exists but contains no flow definitions.';
  }

  // Get current git SHA for staleness check
  let currentSha = '';
  try {
    currentSha = execSync('git rev-parse HEAD 2>/dev/null', { cwd, encoding: 'utf8', timeout: 5000 }).trim();
  } catch { /* not in git repo */ }

  // Filter flows by query
  let matched = flows.flows;
  if (query) {
    const q = query.toLowerCase();
    matched = flows.flows.filter(f =>
      f.id.toLowerCase().includes(q) ||
      f.title.toLowerCase().includes(q) ||
      f.tags.some(t => t.toLowerCase().includes(q)),
    );
  }

  if (matched.length === 0) {
    const allIds = flows.flows.map(f => f.id).join(', ');
    return `No flows matching "${query}". Available flows: ${allIds}`;
  }

  // Format output
  const sections: string[] = [];
  for (const flow of matched) {
    const lines: string[] = [];
    lines.push(`## ${flow.title} (\`${flow.id}\`)`);
    lines.push('');
    lines.push(flow.description);
    lines.push('');
    lines.push(`**Entry point:** ${flow.entry_point}`);
    lines.push(`**Tags:** ${flow.tags.join(', ') || '—'}`);

    // Staleness
    if (currentSha && flow.last_verified_sha) {
      const { stale, changedFiles } = checkFlowStaleness(flow, currentSha, cwd);
      if (stale) {
        lines.push(`**Status:** STALE (${changedFiles.length} file(s) changed: ${changedFiles.join(', ')})`);
      } else {
        lines.push('**Status:** Current');
      }
    } else if (!flow.last_verified_sha) {
      lines.push('**Status:** Unverified');
    }

    lines.push('');
    lines.push('**Files:**');
    for (const f of flow.files) {
      lines.push(`- \`${f}\``);
    }

    if (flow.steps.length > 0) {
      lines.push('');
      lines.push('**Steps:**');
      for (let i = 0; i < flow.steps.length; i++) {
        const step = flow.steps[i];
        lines.push(`${i + 1}. **${step.name}** — ${step.description}`);
        for (const fp of step.file_paths) {
          lines.push(`   - \`${fp}\``);
        }
        if (step.notes) {
          lines.push(`   _${step.notes}_`);
        }
      }
    }

    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n---\n\n');
}

/** Handle search({ module: 'init' }) — return interview steps schema + agent workflow instructions */
function handleInitQuery(): string {
  const cwd = process.cwd();

  // Metaphors are registered via the barrel import of core (listMetaphors, etc.)
  const ctx = buildInterviewContext(cwd);
  const steps = generateInterviewSteps(ctx);

  const sections: string[] = [];

  sections.push('# SLOPE Init — Agent API\n');
  sections.push('Use `getInitQuestions()` and `submitInitAnswers()` to drive `slope init` programmatically.\n');

  sections.push('## Workflow\n');
  sections.push('1. Call `getInitQuestions()` to get interview steps with smart defaults');
  sections.push('2. Present each question to the user (use step descriptions for context)');
  sections.push('3. Call `submitInitAnswers(answers, providers)` with collected answers');
  sections.push('4. Report the result (files created, config path)\n');

  sections.push('## Interview Steps\n');
  for (const step of steps) {
    const defaultVal = step.default !== undefined ? ` (default: ${JSON.stringify(step.default)})` : '';
    const requiredTag = step.required ? ' **required**' : '';
    sections.push(`### \`${step.id}\` (${step.type})${requiredTag}${defaultVal}`);
    sections.push(`${step.question}`);
    if (step.description) sections.push(`_${step.description}_`);
    if (step.options && step.options.length > 0) {
      sections.push('Options:');
      for (const opt of step.options) {
        sections.push(`  - \`${opt.value}\` — ${opt.label}${opt.description ? ': ' + opt.description : ''}`);
      }
    }
    sections.push('');
  }

  sections.push('## Detected Project Info\n');
  sections.push('```json');
  sections.push(JSON.stringify(ctx.detected, null, 2));
  sections.push('```\n');

  sections.push('## Example\n');
  sections.push('```javascript');
  sections.push('// Get questions with smart defaults');
  sections.push('const { steps, context } = getInitQuestions();');
  sections.push('');
  sections.push('// Submit answers');
  sections.push('return await submitInitAnswers({');
  sections.push('  "project-name": "My App",');
  sections.push('  "metaphor": "gaming",');
  sections.push('  "platforms": ["claude-code"],');
  sections.push('}, ["claude-code"]);');
  sections.push('```');

  return sections.join('\n');
}

/** Walk up directories looking for .slope/config.json */
function findProjectRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, '.slope', 'config.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('No .slope/config.json found in any parent directory');
    }
    dir = parent;
  }
}

async function main(): Promise<void> {
  let store: SlopeStore | undefined;
  let hints: SetupHints | undefined;
  let storeType: string | undefined;
  try {
    const { loadConfig } = await import('../core/index.js');
    const { createStore } = await import('../store/index.js');
    const cwd = findProjectRoot(process.cwd());
    const config = loadConfig(cwd);
    store = createStore({ storePath: config.store_path ?? '.slope/slope.db', cwd });
    storeType = config.store ?? 'sqlite';
    hints = detectSetupHints(cwd);
  } catch {
    // No config or store — server runs without store tools
  }
  const server = createSlopeToolsServer(store, hints, storeType);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isDirectRun = process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('mcp-slope-tools');
if (isDirectRun) {
  main().catch((err) => {
    process.stderr.write(`MCP server error: ${err}\n`);
    process.exit(1);
  });
}
