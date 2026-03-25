// Loop orchestration types — derived from actual backlog.json, model-config.json, and result schemas

import type { Logger } from './logger.js';

// === Config ===

export interface LoopConfig {
  /** Workflow name to use for step ordering (opt-in). When set, the loop delegates to the workflow engine. */
  workflowName?: string;
  /** Variables to pass to the workflow (e.g., model, sprint_id) */
  workflowVariables?: Record<string, string>;
  modelLocal: string;
  modelApi: string;
  ollamaApiBase: string;
  ollamaFlashAttention: boolean;
  ollamaKvCacheType: string;
  modelApiTimeout: number;
  modelLocalTimeout: number;
  escalateOnFail: boolean;
  agentGuideMaxWords: number;
  modelRegenThreshold: number;
  loopTestCmd: string;
  backlogPath: string;
  resultsDir: string;
  logDir: string;
  agentGuide: string;
  sprintHistory: string;
  forcePlannerExecutor: boolean; // If true, always use planner before executor
  /** Max sprint-level retries on full failure (default 0 — no retry) */
  maxRetries: number;
  /** Retry strategy: 'model' escalates all tickets to API, 'replan' regenerates plans */
  retryStrategy: 'none' | 'model' | 'replan';
}

export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  modelLocal: 'ollama/qwen3-coder-next-fast',
  modelApi: 'openrouter/anthropic/claude-haiku-4-5',
  ollamaApiBase: 'http://localhost:11434',
  ollamaFlashAttention: true,
  ollamaKvCacheType: 'q8_0',
  modelApiTimeout: 1800,
  modelLocalTimeout: 1800,
  escalateOnFail: true,
  agentGuideMaxWords: 5000,
  modelRegenThreshold: 10,
  loopTestCmd: "pnpm vitest run --exclude '**/guards.test.ts'",
  backlogPath: 'slope-loop/backlog.json',
  resultsDir: 'slope-loop/results',
  logDir: 'slope-loop/logs',
  agentGuide: 'slope-loop/slope-loop-guide/SKILL.md',
  sprintHistory: 'slope-loop/slope-loop-guide/references/sprint-history.md',
  forcePlannerExecutor: false,
  maxRetries: 0,
  retryStrategy: 'none',
};

// Mapping from LoopConfig keys to environment variable names
export const ENV_VAR_MAP: Record<string, keyof LoopConfig> = {
  MODEL_LOCAL: 'modelLocal',
  MODEL_API: 'modelApi',
  OLLAMA_API_BASE: 'ollamaApiBase',
  OLLAMA_FLASH_ATTENTION: 'ollamaFlashAttention',
  OLLAMA_KV_CACHE_TYPE: 'ollamaKvCacheType',
  MODEL_API_TIMEOUT: 'modelApiTimeout',
  MODEL_LOCAL_TIMEOUT: 'modelLocalTimeout',
  ESCALATE_ON_FAIL: 'escalateOnFail',
  AGENT_GUIDE_MAX_WORDS: 'agentGuideMaxWords',
  MODEL_REGEN_THRESHOLD: 'modelRegenThreshold',
  LOOP_TEST_CMD: 'loopTestCmd',
  LOOP_BACKLOG_PATH: 'backlogPath',
  LOOP_RESULTS_DIR: 'resultsDir',
  LOOP_LOG_DIR: 'logDir',
  LOOP_FORCE_PLANNER_EXECUTOR: 'forcePlannerExecutor',
};

/** Source of a config value (for --show display) */
export type ConfigSource = 'env' | 'file' | 'default';

export interface ConfigWithSources {
  config: LoopConfig;
  sources: Record<keyof LoopConfig, ConfigSource>;
}

// === Backlog ===

export interface BacklogFile {
  generated_at: string;
  _enrichMeta?: { version: number };
  sprints: BacklogSprint[];
}

export interface BacklogSprint {
  id: string;
  title: string;
  strategy: 'hardening' | 'testing' | 'cleanup' | 'documentation' | 'hardening-overflow' | 'roadmap';
  par: number;
  slope: number;
  type: 'feature' | 'bugfix' | 'chore';
  tickets: BacklogTicket[];
  /** Sprint IDs that must complete before this sprint can run */
  depends_on?: string[];
}

export interface BacklogTicket {
  key: string;
  title: string;
  club: Club;
  description: string;
  acceptance_criteria: string[];
  modules: string[];
  max_files: number;
  estimated_tokens?: number;
  files?: { primary: string[] };
}

export type Club = 'putter' | 'wedge' | 'short_iron' | 'long_iron' | 'driver';

// === Results ===

export interface TicketResult {
  ticket: string;
  title: string;
  club: string;
  max_files: number;
  primary_model: string;
  final_model: string;
  escalated: boolean;
  tests_passing: boolean;
  noop: boolean;
  // Sprint-level context for cross-dimensional model analysis
  strategy?: BacklogSprint['strategy'];
  sprint_type?: BacklogSprint['type'];
  // Added by SlopeExecutor (optional for AiderExecutor backward compat)
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
  duration_s?: number;
  transcript?: TranscriptEvent[];
}

// === Executor Adapter ===

/** Which executor backend to use */
export type ExecutorId = 'aider' | 'slope';

/** Structured record of a single tool call during execution */
export interface TranscriptEvent {
  timestamp: string;
  tool: string;
  input: Record<string, unknown>;
  output?: string;
  duration_ms?: number;
  guard_warning?: string;
}

/** Result from a single executor run (one model attempt on one ticket) */
export interface ExecutionResult {
  outcome: 'completed' | 'stuck' | 'error' | 'timeout';
  noop: boolean;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  duration_s: number;
  transcript: TranscriptEvent[];
  files_changed: string[];
  /** If true, the executor's inner guards (typecheck + tests) passed and no
   *  additional changes were made after verification. Outer guards can be skipped. */
  innerGuardsPassed?: boolean;
}

/** Context passed to an executor for a single ticket attempt */
export interface ExecutionContext {
  ticketKey: string;
  model: string;
  timeout: number;
  prompt: string;
  ticket: BacklogTicket;
  preSha: string;
}

/** Adapter interface — both AiderExecutor and SlopeExecutor implement this */
export interface ExecutorAdapter {
  readonly id: ExecutorId;
  execute(ctx: ExecutionContext, config: LoopConfig, cwd: string, log: Logger): Promise<ExecutionResult>;
}

export interface SprintResult {
  sprint_id: string;
  title: string;
  strategy: string;
  completed_at: string;
  branch: string;
  tickets_total: number;
  tickets_passing: number;
  tickets_noop: number;
  tickets: TicketResult[];
  pr_number?: number;
  merge_status?: 'merged' | 'blocked' | 'skipped';
  merge_block_reason?: string;
  handicap_delta?: number;
  /** Number of sprint-level retries attempted */
  retries?: number;
}

// === Execution Plan ===

export interface ExecutionPlan {
  ticket: string;           // ticket key
  title: string;
  files: PlanFileEntry[];   // concrete file-level changes
  testFiles: string[];      // matched test files
  approach: string;         // model-specific approach text
  generated: 'enriched' | 'modules' | 'grep' | 'generic'; // which tier produced the plan
}

export interface PlanFileEntry {
  path: string;             // relative file path
  action: string;           // what to do: "add export", "modify function X", etc.
  reason: string;           // why: maps to which acceptance criterion
}

// === Planned Sprints (roadmap-driven backlog source) ===

export interface PlannedTicket {
  key: string;
  title: string;
  club: Club;
  description: string;
  acceptance_criteria: string[];
  modules: string[];
  max_files: number;
}

export interface PlannedSprint {
  id: string;              // display ID in roadmap.json (e.g., "P10-1")
  theme: string;
  par: number;
  slope: number;
  type: 'feature' | 'bugfix' | 'chore';
  tickets: PlannedTicket[];
}

// === Model Config ===

export interface ModelConfig {
  generated_at: string;
  ticket_count: number;
  escalation_save_rate: number;
  success_rates: Record<string, { total: number; passing: number; rate: number }>;
  /** Cross-dimensional rates: "club:strategy" → stats */
  success_rates_by_strategy?: Record<string, { total: number; passing: number; rate: number }>;
  /** Cross-dimensional rates: "club:sprint_type" → stats */
  success_rates_by_type?: Record<string, { total: number; passing: number; rate: number }>;
  cost_per_success: Record<string, number>;
  /** Cost-adjusted scores: higher is better (success_rate / cost) */
  cost_adjusted_scores?: Record<string, number>;
  recommendations: Record<string, { model: string; reason: string }>;
  /** Cross-dimensional recommendations: "club:sprint_type" or "club:strategy" → model */
  recommendations_by_type?: Record<string, { model: string; reason: string; samples: number }>;
  recommendations_by_strategy?: Record<string, { model: string; reason: string; samples: number }>;
  /** Minimum sample count used for cross-dimensional recommendations */
  min_samples?: number;
  notes: string[];
}

