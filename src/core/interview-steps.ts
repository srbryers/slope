// SLOPE — Interview Step Definitions
// Structured representation of init questions for CLI and agent consumption.

import type { InterviewContext } from './interview-engine.js';
import { listMetaphors } from './metaphor.js';

export type StepType = 'text' | 'select' | 'multiselect' | 'confirm';

export interface StepOption {
  value: string;
  label: string;
  description?: string;
  hint?: string;
  preview?: unknown;
}

export interface InterviewStep {
  id: string;
  question: string;
  type: StepType;
  description?: string;
  options?: StepOption[];
  default?: string | string[] | boolean;
  required?: boolean;
  validate?: (value: unknown) => string | null;
  condition?: (answers: Record<string, unknown>) => boolean;
}

/** All available platform options for multiselect */
const PLATFORM_OPTIONS: StepOption[] = [
  { value: 'claude-code', label: 'Claude Code', description: 'Anthropic CLI with MCP + rules + hooks' },
  { value: 'cursor', label: 'Cursor', description: 'Cursor IDE with MCP + rules' },
  { value: 'windsurf', label: 'Windsurf', description: 'Windsurf IDE with MCP + rules' },
  { value: 'cline', label: 'Cline', description: 'VS Code extension with rules' },
  { value: 'opencode', label: 'OpenCode', description: 'OpenCode with MCP + plugin' },
];

const BUILTIN_IDS = ['golf', 'tennis', 'baseball', 'gaming', 'dnd', 'matrix', 'agile'];

/**
 * Generate interview steps with smart defaults from detected context.
 * Steps are returned in presentation order.
 * Caller must ensure metaphors are registered before calling (import metaphors/index.js).
 */
export function generateInterviewSteps(ctx: InterviewContext): InterviewStep[] {
  const { detected } = ctx;
  const steps: InterviewStep[] = [];

  // 1. Project name
  steps.push({
    id: 'project-name',
    question: 'What is your project name?',
    type: 'text',
    description: 'Used in config, roadmap, and display output.',
    default: detected.projectName,
    required: true,
    validate: (v) => {
      const s = String(v ?? '').trim();
      return s.length === 0 ? 'Project name is required' : null;
    },
  });

  // 2. Metaphor (select) — previews attached by metaphor-preview module
  steps.push(buildMetaphorStep());

  // 3. Repo URL
  steps.push({
    id: 'repo-url',
    question: 'What is your GitHub repo URL?',
    type: 'text',
    description: 'Optional. Used for remote git analysis and PR integration.',
    default: detected.repoUrl,
    required: false,
    validate: (v) => {
      const s = String(v ?? '').trim();
      if (!s) return null;
      const ghPattern = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/;
      return ghPattern.test(s) ? null : 'Must be a valid GitHub URL (https://github.com/owner/repo)';
    },
  });

  // 4. Sprint number
  const defaultSprint = detected.existingSprintNumber
    ? String(detected.existingSprintNumber + 1)
    : '1';
  steps.push({
    id: 'sprint-number',
    question: 'What sprint number are you starting?',
    type: 'text',
    description: 'The current or next sprint number.',
    default: defaultSprint,
    required: false,
    validate: (v) => {
      const s = String(v ?? '').trim();
      if (!s) return null;
      const n = parseInt(s, 10);
      if (isNaN(n) || n < 1 || !Number.isInteger(n)) return 'Must be a positive integer';
      return null;
    },
  });

  // 5. Platforms
  const detectedPlatformValues = detected.detectedPlatforms;
  const platformOptions = PLATFORM_OPTIONS.map((opt) => ({
    ...opt,
    hint: detectedPlatformValues.includes(opt.value) ? '(detected)' : undefined,
  }));
  steps.push({
    id: 'platforms',
    question: 'Which platforms do you use?',
    type: 'multiselect',
    description: 'SLOPE installs rules, MCP config, and hooks for each selected platform.',
    options: platformOptions,
    default: detectedPlatformValues.length > 0 ? detectedPlatformValues : undefined,
  });

  // 6. Team members
  steps.push({
    id: 'team-members',
    question: 'Team members (slug:name, comma-separated)?',
    type: 'text',
    description: 'Optional. Example: alice:Alice Smith, bob:Bob Jones',
    required: false,
  });

  // 7. Vision
  steps.push({
    id: 'vision',
    question: 'Project vision or purpose?',
    type: 'text',
    description: 'Optional. Used in roadmap description and vision document.',
    required: false,
  });

  // 8. Deep analysis (CLI-only, skipped in agent mode)
  steps.push({
    id: 'deep-analysis',
    question: 'Run repo analysis for better suggestions?',
    type: 'confirm',
    description: 'Scans your repo for tech stack, structure, and complexity. Takes 5-15 seconds.',
    default: false,
    condition: (answers) => {
      return answers._mode !== 'agent';
    },
  });

  return steps;
}

/**
 * Build the metaphor selection step with all registered metaphors.
 */
function buildMetaphorStep(): InterviewStep {
  const allMetaphors = listMetaphors();

  const builtins = BUILTIN_IDS
    .map((id) => allMetaphors.find((m) => m.id === id))
    .filter((m): m is (typeof allMetaphors)[number] => m !== undefined);
  const customs = allMetaphors.filter((m) => !BUILTIN_IDS.includes(m.id));

  const options: StepOption[] = [
    ...builtins.map((m) => ({
      value: m.id,
      label: m.name,
      description: m.description,
    })),
    ...customs.map((m) => ({
      value: m.id,
      label: m.name,
      description: m.description,
      hint: '(custom)',
    })),
    {
      value: 'custom',
      label: 'Custom',
      description: 'Describe a theme and your AI agent will generate it',
    },
  ];

  return {
    id: 'metaphor',
    question: 'Choose a display metaphor for SLOPE output:',
    type: 'select',
    description: 'Metaphors change display terms (e.g., "sprint" becomes "hole" in golf, "quest" in gaming). Internal types are unaffected.',
    options,
    default: 'golf',
  };
}
