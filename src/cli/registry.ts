// CLI Command Registry — metadata for CLI commands (map generation, documentation, slope-web)

export interface CliCommandMeta {
  /** Command name as invoked: e.g. "init", "auto-card" */
  cmd: string;
  /** Short description of the command */
  desc: string;
  /** Functional category */
  category: 'lifecycle' | 'scoring' | 'analysis' | 'tooling' | 'planning';
}

/** Command files that are internal implementation modules, not user-invocable top-level commands. */
export const CLI_INTERNAL_MODULES = ['review-state'] as const;

export const CLI_COMMAND_REGISTRY: readonly CliCommandMeta[] = [
  // ── Lifecycle ──────────────────────────────────────────────────
  { cmd: 'init',      desc: 'Initialize .slope/ directory',                    category: 'lifecycle' },
  { cmd: 'session',   desc: 'Manage live sessions',                            category: 'lifecycle' },
  { cmd: 'claim',     desc: 'Claim a ticket or area for the sprint',           category: 'lifecycle' },
  { cmd: 'release',   desc: 'Release a claim by ID or target',                 category: 'lifecycle' },
  { cmd: 'status',    desc: 'Show sprint course status and conflicts',         category: 'lifecycle' },
  { cmd: 'next',      desc: 'Show next sprint number (auto-detect)',           category: 'lifecycle' },

  // ── Scoring ────────────────────────────────────────────────────
  { cmd: 'card',         desc: 'Display handicap card',                        category: 'scoring' },
  { cmd: 'validate',     desc: 'Validate scorecard(s)',                        category: 'scoring' },
  { cmd: 'review',       desc: 'Format sprint review or manage review state',  category: 'scoring' },
  { cmd: 'auto-card',    desc: 'Generate scorecard from git + CI signals',     category: 'scoring' },
  { cmd: 'classify',     desc: 'Classify a shot from execution trace',         category: 'scoring' },
  { cmd: 'tournament',   desc: 'Build tournament review from sprints',         category: 'scoring' },

  // ── Analysis ───────────────────────────────────────────────────
  { cmd: 'briefing',   desc: 'Pre-round briefing with hazards and nutrition',  category: 'analysis' },
  { cmd: 'plan',       desc: 'Pre-shot advisor (club + training + hazards)',   category: 'analysis' },
  { cmd: 'report',     desc: 'Generate HTML performance report',              category: 'analysis' },
  { cmd: 'dashboard',  desc: 'Live local performance dashboard',              category: 'analysis' },
  { cmd: 'standup',    desc: 'Generate or ingest standup report',             category: 'analysis' },
  { cmd: 'analyze',    desc: 'Scan repo and generate profile',               category: 'analysis' },

  // ── Tooling ────────────────────────────────────────────────────
  { cmd: 'hook',       desc: 'Manage lifecycle hooks',                        category: 'tooling' },
  { cmd: 'guard',      desc: 'Run guard handler or manage guard activation',  category: 'tooling' },
  { cmd: 'extract',    desc: 'Extract events into SLOPE store',              category: 'tooling' },
  { cmd: 'distill',    desc: 'Promote event patterns to common issues',      category: 'tooling' },
  { cmd: 'map',        desc: 'Generate/update codebase map',                 category: 'tooling' },
  { cmd: 'flows',      desc: 'Manage user flow definitions',                 category: 'tooling' },
  { cmd: 'metaphor',   desc: 'Manage metaphor display themes',               category: 'tooling' },
  { cmd: 'plugin',     desc: 'Manage custom plugins',                        category: 'tooling' },
  { cmd: 'store',      desc: 'Store diagnostics and management',              category: 'tooling' },
  { cmd: 'escalate',   desc: 'Escalate issues based on severity triggers',   category: 'tooling' },
  { cmd: 'transcript', desc: 'View session transcript data',                 category: 'tooling' },

  // ── Planning ───────────────────────────────────────────────────
  { cmd: 'roadmap',     desc: 'Strategic planning and roadmap tools',            category: 'planning' },
  { cmd: 'vision',      desc: 'Display project vision document',                category: 'planning' },
  { cmd: 'initiative',  desc: 'Multi-sprint initiative orchestration',           category: 'planning' },

  // ── Loop ─────────────────────────────────────────────
  { cmd: 'loop',       desc: 'Autonomous sprint execution loop',               category: 'tooling' },

  // ── Indexing ──────────────────────────────────────────────────────
  { cmd: 'index-cmd',   desc: 'Semantic embedding index management',            category: 'tooling' },
  { cmd: 'context',     desc: 'Semantic context search for agents',             category: 'tooling' },
  { cmd: 'prep',        desc: 'Generate execution plan for a ticket',           category: 'tooling' },
  { cmd: 'enrich',      desc: 'Batch-enrich backlog with file context',         category: 'tooling' },
  { cmd: 'demo',        desc: 'Scripted onboarding showcase for video recordings', category: 'tooling' },
  { cmd: 'docs',        desc: 'Generate documentation manifest and changelog',  category: 'tooling' },
  { cmd: 'narrate',     desc: 'Generate ElevenLabs TTS voiceover for demo',    category: 'tooling' },
];
