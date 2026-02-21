#!/usr/bin/env node
/**
 * @slope-dev/mcp-tools — Code-mode MCP server for SLOPE.
 *
 * Exposes two tools:
 *   search()  — discover the SLOPE API (functions, types, constants)
 *   execute() — run JS in a sandboxed node:vm with the full API pre-injected
 *
 * Usage:
 *   npx @slope-dev/mcp-tools              # stdio transport
 *   import { createSlopeToolsServer }     # programmatic
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SLOPE_REGISTRY, SLOPE_TYPES } from './registry.js';
import { runInSandbox } from './sandbox.js';

/** Tool names exposed by this MCP server (for tests and tool discovery). */
export const SLOPE_MCP_TOOL_NAMES = ['search', 'execute'] as const;

export function createSlopeToolsServer(): McpServer {
  const server = new McpServer({
    name: 'slope-tools',
    version: '0.2.0',
  });

  server.tool(
    'search',
    'Discover SLOPE API functions, filesystem helpers, constants, and type definitions. Call with no args to see everything, or filter by query/module.',
    {
      query: z.string().optional().describe('Case-insensitive search term to filter by name or description'),
      module: z.enum(['core', 'fs', 'constants', 'types']).optional().describe('Filter by module category'),
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

  return server;
}

async function main(): Promise<void> {
  const server = createSlopeToolsServer();
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
