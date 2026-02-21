#!/usr/bin/env node
/**
 * @slope-dev/mcp-tools — MCP server exposing SLOPE advisory tools.
 *
 * All tools are read-only: they compute analysis and recommendations from
 * scorecard data passed as input. No DB or filesystem access needed.
 *
 * Usage:
 *   npx @slope-dev/mcp-tools              # stdio transport
 *   import { createSlopeToolsServer }     # programmatic
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  recommendClub,
  classifyShot,
  generateTrainingPlan,
  computeHandicapCard,
  computeDispersion,
  buildScorecard,
  formatBriefing,
  formatSprintReview,
  buildTournamentReview,
  formatTournamentReview,
} from '@slope-dev/core';

const scorecardSchema = z.array(z.any()).describe('Array of GolfScorecard objects');

/** Tool names exposed by this MCP server (for tests and tool discovery). */
export const SLOPE_MCP_TOOL_NAMES = [
  'recommend_club',
  'classify_shot',
  'generate_training_plan',
  'compute_handicap',
  'compute_dispersion',
  'build_scorecard',
  'format_briefing',
  'format_sprint_review',
  'build_tournament_review',
  'format_tournament_review',
] as const;

export function createSlopeToolsServer(): McpServer {
  const server = new McpServer({
    name: 'slope-tools',
    version: '0.1.0',
  });

  server.tool(
    'recommend_club',
    'Get a data-driven club (complexity) recommendation for an upcoming ticket.',
    {
      ticketComplexity: z.enum(['trivial', 'small', 'medium', 'large']).describe('Ticket complexity'),
      scorecards: scorecardSchema,
      slopeFactors: z.array(z.string()).optional().describe('Slope factors present'),
    },
    async ({ ticketComplexity, scorecards, slopeFactors }) => {
      const result = recommendClub({ ticketComplexity, scorecards, slopeFactors });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'classify_shot',
    'Classify a shot result from execution trace data.',
    {
      trace: z.any().describe('ExecutionTrace object with scope, modified files, test results, etc.'),
    },
    async ({ trace }) => {
      const result = classifyShot(trace);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'generate_training_plan',
    'Generate training recommendations from handicap trends and dispersion data.',
    {
      handicap: z.any().describe('HandicapCard object'),
      dispersion: z.any().describe('DispersionReport object'),
      recentScorecards: scorecardSchema,
    },
    async ({ handicap, dispersion, recentScorecards }) => {
      const result = generateTrainingPlan({ handicap, dispersion, recentScorecards });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'compute_handicap',
    'Compute handicap card (rolling stats) from scorecard history.',
    { scorecards: scorecardSchema },
    async ({ scorecards }) => {
      const result = computeHandicapCard(scorecards);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'compute_dispersion',
    'Compute shot dispersion analysis (miss patterns, systemic issues).',
    { scorecards: scorecardSchema },
    async ({ scorecards }) => {
      const result = computeDispersion(scorecards);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'build_scorecard',
    'Build a complete SLOPE scorecard from minimal input (auto-computes stats, score, label).',
    {
      input: z.any().describe('ScorecardInput object with sprint_number, theme, par, slope, shots'),
    },
    async ({ input }) => {
      const result = buildScorecard(input);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'format_briefing',
    'Format a pre-round briefing with hazards, gotchas, handicap, and training.',
    {
      scorecards: scorecardSchema,
      commonIssues: z.any().describe('CommonIssuesFile object'),
      lastSession: z.any().optional().describe('Last session entry'),
      filter: z.object({
        categories: z.array(z.string()).optional(),
        keywords: z.array(z.string()).optional(),
      }).optional().describe('Filter criteria'),
    },
    async ({ scorecards, commonIssues, lastSession, filter }) => {
      const result = formatBriefing({ scorecards, commonIssues, lastSession, filter });
      return { content: [{ type: 'text' as const, text: result }] };
    },
  );

  server.tool(
    'format_sprint_review',
    'Format a SLOPE scorecard into a markdown sprint review.',
    {
      scorecard: z.any().describe('GolfScorecard object'),
      mode: z.enum(['technical', 'plain']).optional().describe('Review mode (default: technical)'),
    },
    async ({ scorecard, mode }) => {
      const result = formatSprintReview(scorecard, undefined, undefined, mode);
      return { content: [{ type: 'text' as const, text: result }] };
    },
  );

  server.tool(
    'build_tournament_review',
    'Build a tournament review aggregating multiple sprint scorecards.',
    {
      id: z.string().describe('Tournament ID (e.g. "M-09")'),
      name: z.string().describe('Tournament name'),
      scorecards: scorecardSchema,
      takeaways: z.array(z.string()).optional(),
      improvements: z.array(z.string()).optional(),
      reflection: z.string().optional(),
    },
    async ({ id, name, scorecards, takeaways, improvements, reflection }) => {
      const review = buildTournamentReview(id, name, scorecards, { takeaways, improvements, reflection });
      return { content: [{ type: 'text' as const, text: JSON.stringify(review, null, 2) }] };
    },
  );

  server.tool(
    'format_tournament_review',
    'Format a TournamentReview object into markdown.',
    {
      review: z.any().describe('TournamentReview object'),
    },
    async ({ review }) => {
      const result = formatTournamentReview(review);
      return { content: [{ type: 'text' as const, text: result }] };
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
