#!/usr/bin/env node
/**
 * @slope-dev/mcp-tools — Code-mode MCP server for SLOPE.
 *
 * Exposes up to 5 tools:
 *   search()           — discover the SLOPE API (functions, types, constants)
 *   execute()          — run JS in a sandboxed node:vm with the full API pre-injected
 *   session_status()   — show active sessions and claims (requires store)
 *   acquire_claim()    — claim a ticket/area (requires store)
 *   check_conflicts()  — detect overlapping claims (requires store)
 *
 * Usage:
 *   npx @slope-dev/mcp-tools              # stdio transport
 *   import { createSlopeToolsServer }     # programmatic
 */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SLOPE_REGISTRY, SLOPE_TYPES } from './registry.js';
import { runInSandbox } from './sandbox.js';
import type { SlopeStore } from '@slope-dev/core';
import { checkConflicts } from '@slope-dev/core';
import type { ClaimScope } from '@slope-dev/core';

/** Tool names exposed by this MCP server (for tests and tool discovery). */
export const SLOPE_MCP_TOOL_NAMES = ['search', 'execute', 'session_status', 'acquire_claim', 'check_conflicts'] as const;

export function createSlopeToolsServer(store?: SlopeStore): McpServer {
  const server = new McpServer({
    name: 'slope-tools',
    version: '0.2.0',
  });

  server.tool(
    'search',
    'Discover SLOPE API functions, filesystem helpers, constants, and type definitions. Call with no args to see everything, or filter by query/module.',
    {
      query: z.string().optional().describe('Case-insensitive search term to filter by name or description'),
      module: z.enum(['core', 'fs', 'constants', 'types', 'store']).optional().describe('Filter by module category'),
    },
    async ({ query, module }) => {
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
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
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
  }

  return server;
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
  try {
    const { loadConfig } = await import('@slope-dev/core');
    const { createStore } = await import('@slope-dev/store-sqlite');
    const cwd = findProjectRoot(process.cwd());
    const config = loadConfig(cwd);
    store = createStore({ storePath: config.store_path ?? '.slope/slope.db', cwd });
  } catch {
    // No config or store — server runs without store tools
  }
  const server = createSlopeToolsServer(store);
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
