// Loop orchestration types — derived from actual backlog.json, model-config.json, and result schemas

// === Config ===

export interface LoopConfig {
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
}

// === Execution Plan ===

export interface ExecutionPlan {
  ticket: string;           // ticket key
  title: string;
  files: PlanFileEntry[];   // concrete file-level changes
  testFiles: string[];      // matched test files
  approach: string;         // model-specific approach text
  generated: 'enriched' | 'grep' | 'generic'; // which tier produced the plan
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
  type: string;
  tickets: PlannedTicket[];
}

// === Model Config ===

export interface ModelConfig {
  generated_at: string;
  ticket_count: number;
  escalation_save_rate: number;
  success_rates: Record<string, { total: number; passing: number; rate: number }>;
  cost_per_success: Record<string, number>;
  recommendations: Record<string, { model: 'api' | 'local'; reason: string }>;
  notes: string[];
}

