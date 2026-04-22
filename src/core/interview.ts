// SLOPE — Interview-Based Init
// Structured project initialization from collected input fields.
// Core defines only what it needs — no CLI/infrastructure concerns.

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createConfig } from './config.js';
import type { SlopeConfig } from './config.js';
import { hasMetaphor } from './metaphor.js';
import { validateInterviewAnswers, answersToInitInput } from './interview-engine.js';

/** Core input — what initFromInterview() actually needs */
export interface InitInput {
  projectName: string;
  repoUrl?: string;
  teamMembers?: Record<string, string>;  // slug -> display name
  sprintCadence?: 'weekly' | 'biweekly' | 'monthly';
  metaphor?: string;
  techStack?: string[];
  vision?: string;
  priorities?: string[];
  currentSprint?: number;
}

/** Result of initFromInterview() */
export interface InitResult {
  config: SlopeConfig;
  configPath: string;
  filesCreated: string[];
}

/**
 * Validate InitInput fields.
 * Returns an array of error strings (empty = valid).
 */
export function validateInitInput(input: InitInput): string[] {
  const errors: string[] = [];

  if (!input.projectName || input.projectName.trim().length === 0) {
    errors.push('projectName is required and must be non-empty');
  }

  if (input.metaphor !== undefined && input.metaphor !== 'custom') {
    // Import side-effects of metaphors happen at module load in the caller
    if (!hasMetaphor(input.metaphor)) {
      errors.push(`Unknown metaphor "${input.metaphor}". Use listMetaphors() to see available options.`);
    }
  }

  if (input.repoUrl !== undefined) {
    const ghPattern = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?\/?$/;
    if (!ghPattern.test(input.repoUrl)) {
      errors.push(`repoUrl "${input.repoUrl}" does not match expected GitHub URL pattern`);
    }
  }

  if (input.teamMembers !== undefined) {
    const slugPattern = /^[a-zA-Z0-9][\w-]*$/;
    for (const slug of Object.keys(input.teamMembers)) {
      if (!slugPattern.test(slug)) {
        errors.push(`Team member slug "${slug}" must be alphanumeric (may contain hyphens/underscores)`);
      }
    }
  }

  if (input.currentSprint !== undefined) {
    if (!Number.isInteger(input.currentSprint) || input.currentSprint < 1) {
      errors.push('currentSprint must be a positive integer');
    }
  }

  return errors;
}

function buildExampleScorecard() {
  return {
  sprint_number: 1,
  theme: 'Getting Started',
  par: 3,
  slope: 0,
  score: 3,
  score_label: 'par',
  date: new Date().toISOString().split('T')[0],
  shots: [
    {
      ticket_key: 'S1-1',
      title: 'Set up project',
      club: 'short_iron',
      result: 'green',
      hazards: [],
    },
  ],
  conditions: [],
  special_plays: [],
  stats: {
    fairways_hit: 1, fairways_total: 1, greens_in_regulation: 1,
    greens_total: 1, putts: 0, penalties: 0, hazards_hit: 0, hazard_penalties: 0,
    miss_directions: { long: 0, short: 0, left: 0, right: 0 },
  },
  yardage_book_updates: [],
  bunker_locations: [],
  course_management_notes: [],
  };
}

const EXAMPLE_COMMON_ISSUES = {
  recurring_patterns: [
    {
      id: 1,
      title: 'Example pattern',
      category: 'general',
      sprints_hit: [1],
      gotcha_refs: [],
      description: 'This is an example recurring pattern. Replace with your own.',
      prevention: 'Add your prevention strategy here.',
    },
  ],
};

/**
 * Initialize a SLOPE project from structured interview input.
 * Creates config, example scorecard, roadmap, and common-issues.
 * Does NOT initialize a store — that's the caller's responsibility.
 */
/** Structured result for agent-facing initFromAnswers */
export type InitFromAnswersResult =
  | { success: true; configPath: string; filesCreated: string[]; providers: string[] }
  | { success: false; errors: Array<{ field: string; message: string }> };

/**
 * Initialize a SLOPE project from raw interview answers.
 * Validates answers and creates core files.
 * Provider installation is the caller's responsibility (CLI or MCP layer).
 * Returns a structured result (never throws on validation errors).
 */
export async function initFromAnswers(
  cwd: string,
  answers: Record<string, unknown>,
  providers?: string[],
): Promise<InitFromAnswersResult> {
  const validationErrors = validateInterviewAnswers(answers);
  if (validationErrors.length > 0) {
    return { success: false, errors: validationErrors };
  }

  const input = answersToInitInput(answers);

  let result: InitResult;
  try {
    result = await initFromInterview(cwd, input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, errors: [{ field: '_init', message }] };
  }

  const platformsRaw = answers.platforms;
  const effectiveProviders = providers
    ?? (Array.isArray(platformsRaw) ? platformsRaw as string[] : []);

  return {
    success: true,
    configPath: result.configPath,
    filesCreated: result.filesCreated,
    providers: effectiveProviders,
  };
}

export async function initFromInterview(cwd: string, input: InitInput): Promise<InitResult> {
  const errors = validateInitInput(input);
  if (errors.length > 0) {
    throw new Error(`Invalid init input:\n  - ${errors.join('\n  - ')}`);
  }

  const filesCreated: string[] = [];

  // Create .slope/config.json via existing createConfig
  const configPath = createConfig(cwd);
  filesCreated.push(configPath);

  // Read back the config and augment with interview data
  const configData = JSON.parse(readFileSync(configPath, 'utf8'));

  configData.projectName = input.projectName;
  configData.projectId = input.projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  if (input.metaphor) {
    configData.metaphor = input.metaphor;
  }
  if (input.currentSprint) {
    configData.currentSprint = input.currentSprint;
  }
  if (input.teamMembers && Object.keys(input.teamMembers).length > 0) {
    configData.team = {
      players: input.teamMembers,
    };
  }

  writeFileSync(configPath, JSON.stringify(configData, null, 2) + '\n');

  // Create scorecard directory + example
  const scorecardDir = join(cwd, 'docs', 'retros');
  if (!existsSync(scorecardDir)) {
    mkdirSync(scorecardDir, { recursive: true });
  }

  const examplePath = join(scorecardDir, 'sprint-1.json');
  if (!existsSync(examplePath)) {
    writeFileSync(examplePath, JSON.stringify(buildExampleScorecard(), null, 2) + '\n');
    filesCreated.push(examplePath);
  }

  // Create common issues
  const commonIssuesPath = join(cwd, '.slope', 'common-issues.json');
  if (!existsSync(commonIssuesPath)) {
    writeFileSync(commonIssuesPath, JSON.stringify(EXAMPLE_COMMON_ISSUES, null, 2) + '\n');
    filesCreated.push(commonIssuesPath);
  }

  // Create starter roadmap
  const backlogDir = join(cwd, 'docs', 'backlog');
  const roadmapPath = join(backlogDir, 'roadmap.json');
  if (!existsSync(roadmapPath)) {
    mkdirSync(backlogDir, { recursive: true });
    const roadmap = {
      name: input.projectName,
      description: input.vision ?? `Roadmap for ${input.projectName}`,
      phases: [{ name: 'Phase 1', sprints: [1] }],
      sprints: [
        {
          id: 1,
          theme: 'Getting Started',
          par: 3,
          slope: 0,
          type: 'feature',
          tickets: [
            { key: 'S1-1', title: 'Set up project', club: 'short_iron', complexity: 'standard' },
          ],
        },
      ],
    };
    writeFileSync(roadmapPath, JSON.stringify(roadmap, null, 2) + '\n');
    filesCreated.push(roadmapPath);
  }

  // Create sprint state (planning phase) so the project is "active" not "fresh"
  const sprintStatePath = join(cwd, '.slope', 'sprint-state.json');
  if (!existsSync(sprintStatePath)) {
    const now = new Date().toISOString();
    writeFileSync(
      sprintStatePath,
      JSON.stringify({
        sprint: input.currentSprint ?? 1,
        phase: 'planning',
        gates: {},
        started_at: now,
        updated_at: now,
      }, null, 2) + '\n',
    );
    filesCreated.push(sprintStatePath);
  }

  // Build the final config object to return
  const config: SlopeConfig = {
    ...configData,
  };

  return {
    config,
    configPath,
    filesCreated,
  };
}
