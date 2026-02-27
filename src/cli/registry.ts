// CLI Command Registry — single source of truth for all slope CLI commands

export interface CliCommandMeta {
  /** Command name as invoked: e.g. "init", "auto-card" */
  cmd: string;
  /** Short description of the command */
  desc: string;
  /** Functional category */
  category: 'lifecycle' | 'scoring' | 'analysis' | 'tooling' | 'planning';
}

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
  { cmd: 'review-state', desc: 'Manage plan review lifecycle and findings',    category: 'scoring' },

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
  { cmd: 'plugin',     desc: 'Manage custom plugins',                        category: 'tooling' },
  { cmd: 'escalate',   desc: 'Escalate issues based on severity triggers',   category: 'tooling' },
  { cmd: 'transcript', desc: 'View session transcript data',                 category: 'tooling' },

  // ── Planning ───────────────────────────────────────────────────
  { cmd: 'roadmap',  desc: 'Strategic planning and roadmap tools',            category: 'planning' },
  { cmd: 'vision',   desc: 'Display project vision document',                category: 'planning' },
] as const;
