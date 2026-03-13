// CLI Command Registry — metadata for CLI commands (map generation, documentation, slope-web)

export interface CliFlag {
  /** Flag as typed: e.g. '--metaphor=<id>', '--json', '--fix' */
  flag: string;
  /** Short description */
  desc: string;
}

export interface CliSubcommand {
  /** Subcommand name: e.g. 'generate', 'start' */
  name: string;
  /** Short description */
  desc: string;
  /** Flags specific to this subcommand */
  flags?: CliFlag[];
}

export interface CliCommandMeta {
  /** Command name as invoked: e.g. "init", "auto-card" */
  cmd: string;
  /** Short description of the command */
  desc: string;
  /** Functional category */
  category: 'lifecycle' | 'scoring' | 'analysis' | 'tooling' | 'planning';
  /** Subcommands, if any */
  subcommands?: CliSubcommand[];
  /** Top-level flags (when no subcommands, or shared across subcommands) */
  flags?: CliFlag[];
}

/** Command files that are internal implementation modules, not user-invocable top-level commands. */
export const CLI_INTERNAL_MODULES = ['review-state'] as const;

export const CLI_COMMAND_REGISTRY: readonly CliCommandMeta[] = [
  // ── Lifecycle ──────────────────────────────────────────────────
  {
    cmd: 'init', desc: 'Initialize .slope/ directory', category: 'lifecycle',
    flags: [
      { flag: '--metaphor=<id>', desc: 'Set metaphor theme (golf, gaming, dnd, etc.)' },
      { flag: '--interactive', desc: 'Rich interactive setup wizard' },
    ],
  },
  {
    cmd: 'help', desc: 'Show detailed per-command usage', category: 'lifecycle',
    flags: [{ flag: '<command>', desc: 'Command name to show details for' }],
  },
  {
    cmd: 'quickstart', desc: 'Interactive tutorial for new users', category: 'lifecycle',
  },
  {
    cmd: 'doctor', desc: 'Check repo health and auto-fix issues', category: 'lifecycle',
    flags: [{ flag: '--fix', desc: 'Auto-fix detected issues' }],
  },
  {
    cmd: 'version', desc: 'Show version or bump with automated PR workflow', category: 'lifecycle',
    subcommands: [
      { name: 'bump', desc: 'Bump version with automated PR workflow', flags: [
        { flag: '<version>', desc: 'Version to bump to (e.g. 1.25.0)' },
        { flag: '--dry-run', desc: 'Preview changes without committing' },
      ]},
    ],
  },
  {
    cmd: 'session', desc: 'Manage live sessions', category: 'lifecycle',
    subcommands: [
      { name: 'start', desc: 'Start a new session', flags: [
        { flag: '--role=<role>', desc: 'Session role (primary, secondary, observer)' },
        { flag: '--ide=<id>', desc: 'IDE identifier (claude-code, cursor, etc.)' },
        { flag: '--branch=<name>', desc: 'Git branch name' },
        { flag: '--swarm=<id>', desc: 'Join an existing swarm' },
        { flag: '--agent-role=<role>', desc: 'Role within the swarm' },
      ]},
      { name: 'end', desc: 'End active session', flags: [
        { flag: '--session-id=<id>', desc: 'Specific session to end' },
      ]},
      { name: 'heartbeat', desc: 'Send session heartbeat', flags: [
        { flag: '--session-id=<id>', desc: 'Specific session to heartbeat' },
      ]},
      { name: 'list', desc: 'List active sessions', flags: [
        { flag: '--swarm=<id>', desc: 'Filter by swarm' },
      ]},
    ],
  },
  {
    cmd: 'claim', desc: 'Claim a ticket or area for the sprint', category: 'lifecycle',
    flags: [
      { flag: '--target=<path>', desc: 'File or directory to claim' },
      { flag: '--ticket=<key>', desc: 'Ticket key (e.g. S48-1)' },
      { flag: '--force', desc: 'Override conflicting claims' },
    ],
  },
  {
    cmd: 'release', desc: 'Release a claim by ID or target', category: 'lifecycle',
    flags: [
      { flag: '--id=<id>', desc: 'Claim ID to release' },
      { flag: '--target=<path>', desc: 'Release claim by target path' },
    ],
  },
  {
    cmd: 'status', desc: 'Show sprint course status and conflicts', category: 'lifecycle',
    flags: [{ flag: '--json', desc: 'Output as JSON' }],
  },
  { cmd: 'next', desc: 'Show next sprint number (auto-detect)', category: 'lifecycle' },
  {
    cmd: 'sprint', desc: 'Manage sprint lifecycle state and gates', category: 'lifecycle',
    subcommands: [
      { name: 'start', desc: 'Start a new sprint', flags: [
        { flag: '--number=<N>', desc: 'Sprint number (required)' },
        { flag: '--phase=<phase>', desc: 'Initial phase (default: planning)' },
      ]},
      { name: 'gate', desc: 'Mark a gate as complete', flags: [
        { flag: '<name>', desc: 'Gate name to complete' },
      ]},
      { name: 'status', desc: 'Show current sprint state and gates' },
      { name: 'reset', desc: 'Reset sprint state' },
    ],
  },

  // ── Scoring ────────────────────────────────────────────────────
  {
    cmd: 'card', desc: 'Display handicap card', category: 'scoring',
    flags: [
      { flag: '--metaphor=<id>', desc: 'Display theme override' },
      { flag: '--player=<name>', desc: 'Filter to a specific player' },
      { flag: '--swarm', desc: 'Show swarm/multi-agent handicap' },
      { flag: '--team', desc: 'Show team handicap card' },
    ],
  },
  {
    cmd: 'validate', desc: 'Validate scorecard(s)', category: 'scoring',
    flags: [{ flag: '<path>', desc: 'Scorecard JSON file to validate' }],
  },
  {
    cmd: 'review', desc: 'Format sprint review or manage review state', category: 'scoring',
    subcommands: [
      { name: 'start', desc: 'Start a plan review', flags: [
        { flag: '--tier=<tier>', desc: 'Review tier (skip, light, standard, deep)' },
      ]},
      { name: 'round', desc: 'Record completion of a review round' },
      { name: 'status', desc: 'Show current review state' },
      { name: 'reset', desc: 'Reset review state' },
      { name: 'recommend', desc: 'Check which review types apply to the sprint' },
      { name: 'findings', desc: 'Manage review findings', flags: [
        { flag: 'add', desc: 'Add a finding (--type, --ticket, --severity, --description)' },
        { flag: 'list', desc: 'List recorded findings' },
        { flag: 'clear', desc: 'Clear all findings' },
      ]},
      { name: 'amend', desc: 'Inject review findings as hazards into scorecard' },
    ],
    flags: [
      { flag: '--metaphor=<id>', desc: 'Display theme override' },
      { flag: '<path>', desc: 'Scorecard file to review (default: latest)' },
    ],
  },
  {
    cmd: 'auto-card', desc: 'Generate scorecard from git + CI signals', category: 'scoring',
    flags: [
      { flag: '--sprint=<N>', desc: 'Sprint number (required)' },
      { flag: '--since=<date>', desc: 'Start date for git log' },
      { flag: '--branch=<ref>', desc: 'Git branch to analyze' },
      { flag: '--theme=<text>', desc: 'Sprint theme description' },
      { flag: '--player=<name>', desc: 'Player name for scorecard' },
      { flag: '--test-output=<file>', desc: 'Path to test output for CI signal parsing' },
      { flag: '--pr=<number>', desc: 'PR number for PR signal parsing' },
      { flag: '--swarm=<id>', desc: 'Swarm ID for multi-agent scorecard' },
      { flag: '--dry-run', desc: 'Preview without writing' },
    ],
  },
  {
    cmd: 'classify', desc: 'Classify a shot from execution trace', category: 'scoring',
    flags: [
      { flag: '--scope=<files>', desc: 'Comma-separated file scope' },
      { flag: '--modified=<files>', desc: 'Comma-separated modified files' },
      { flag: '--tests=<result>', desc: 'Test result (pass, fail, partial)' },
      { flag: '--reverts=<N>', desc: 'Number of reverts' },
      { flag: '--hazards=<N>', desc: 'Number of hazards encountered' },
    ],
  },
  {
    cmd: 'tournament', desc: 'Build tournament review from sprints', category: 'scoring',
    flags: [
      { flag: '--id=<id>', desc: 'Tournament identifier' },
      { flag: '--name=<name>', desc: 'Tournament display name' },
      { flag: '--sprints=<N-M>', desc: 'Sprint range (e.g. 1-10)' },
      { flag: '--output=<path>', desc: 'Output file path' },
    ],
  },

  // ── Analysis ───────────────────────────────────────────────────
  {
    cmd: 'briefing', desc: 'Pre-round briefing with hazards and nutrition', category: 'analysis',
    flags: [
      { flag: '--categories=<list>', desc: 'Filter by issue categories (comma-separated)' },
      { flag: '--keywords=<list>', desc: 'Filter by keywords (comma-separated)' },
      { flag: '--sprint=<N>', desc: 'Sprint number' },
      { flag: '--role=<id>', desc: 'Filter by role' },
      { flag: '--player=<name>', desc: 'Filter to a specific player' },
      { flag: '--personal', desc: 'Show personal stats only' },
      { flag: '--no-training', desc: 'Skip training recommendations' },
      { flag: '--compact', desc: 'Shorter output for session hooks' },
    ],
  },
  {
    cmd: 'plan', desc: 'Pre-shot advisor (club + training + hazards)', category: 'analysis',
    flags: [
      { flag: '--complexity=<level>', desc: 'Complexity (trivial, small, medium, large)' },
      { flag: '--slope-factors=<list>', desc: 'Comma-separated slope factors' },
      { flag: '--areas=<list>', desc: 'Comma-separated code areas' },
      { flag: '--sprint=<N>', desc: 'Sprint number for context' },
    ],
  },
  {
    cmd: 'report', desc: 'Generate HTML performance report', category: 'analysis',
    flags: [
      { flag: '--html', desc: 'Generate HTML report' },
      { flag: '--output=<path>', desc: 'Output file path' },
    ],
  },
  {
    cmd: 'dashboard', desc: 'Live local performance dashboard', category: 'analysis',
    flags: [
      { flag: '--port=<N>', desc: 'HTTP port (default: 3000)' },
      { flag: '--no-open', desc: 'Don\'t auto-open browser' },
      { flag: '--refresh=<N>', desc: 'Auto-refresh interval in seconds (0=disable)' },
      { flag: '--metaphor=<id>', desc: 'Display theme override' },
      { flag: '--player=<name>', desc: 'Filter to a specific player' },
    ],
  },
  {
    cmd: 'standup', desc: 'Generate or ingest standup report', category: 'analysis',
    flags: [
      { flag: '--session=<id>', desc: 'Session ID for standup generation' },
      { flag: '--role=<id>', desc: 'Agent role filter' },
      { flag: '--sprint=<N>', desc: 'Sprint number' },
      { flag: '--ingest=<path>', desc: 'Ingest standup from file (or stdin with --ingest)' },
      { flag: '--aggregate', desc: 'Aggregate team standups' },
      { flag: '--json', desc: 'Output as JSON' },
    ],
  },
  {
    cmd: 'analyze', desc: 'Scan repo and generate profile', category: 'analysis',
    flags: [
      { flag: '--analyzers=<list>', desc: 'Run specific analyzers (comma-separated: stack, git, etc.)' },
      { flag: '--json', desc: 'Output full profile as JSON' },
    ],
  },

  // ── Tooling ────────────────────────────────────────────────────
  {
    cmd: 'hook', desc: 'Manage lifecycle hooks', category: 'tooling',
    subcommands: [
      { name: 'add', desc: 'Install guard hooks', flags: [
        { flag: '--level=<level>', desc: 'Hook level (full, scoring)' },
        { flag: '--harness=<id>', desc: 'Target harness (auto-detect or specify)' },
      ]},
      { name: 'remove', desc: 'Remove installed hooks' },
      { name: 'list', desc: 'Show installed hooks', flags: [
        { flag: '--available', desc: 'Show full catalog of available hooks' },
      ]},
    ],
  },
  {
    cmd: 'guard', desc: 'Run guard handler or manage guard activation', category: 'tooling',
    subcommands: [
      { name: '<name>', desc: 'Run a guard (reads hook JSON from stdin)' },
      { name: 'list', desc: 'Show all available guards' },
      { name: 'status', desc: 'Show per-harness guard installation state' },
      { name: 'docs', desc: 'Show detailed guard documentation', flags: [
        { flag: '<name>', desc: 'Guard name (optional — shows all if omitted)' },
      ]},
      { name: 'enable', desc: 'Enable a disabled guard', flags: [
        { flag: '<name>', desc: 'Guard name to enable' },
      ]},
      { name: 'disable', desc: 'Disable a guard', flags: [
        { flag: '<name>', desc: 'Guard name to disable' },
      ]},
    ],
  },
  {
    cmd: 'extract', desc: 'Extract events into SLOPE store', category: 'tooling',
    flags: [
      { flag: '--file=<path>', desc: 'Event file to extract' },
      { flag: '--session-id=<id>', desc: 'Session ID to tag events' },
      { flag: '--sprint=<N>', desc: 'Sprint number' },
    ],
  },
  {
    cmd: 'distill', desc: 'Promote event patterns to common issues', category: 'tooling',
    flags: [
      { flag: '--auto', desc: 'Auto-promote patterns above threshold' },
      { flag: '--dry-run', desc: 'Preview without writing' },
      { flag: '--sprint=<N>', desc: 'Filter to a specific sprint' },
      { flag: '--threshold=<N>', desc: 'Minimum occurrence threshold' },
    ],
  },
  {
    cmd: 'map', desc: 'Generate/update codebase map', category: 'tooling',
    flags: [
      { flag: '--check', desc: 'Check staleness (exit 1 if stale)' },
      { flag: '--output=<path>', desc: 'Custom output path (default: CODEBASE.md)' },
    ],
  },
  {
    cmd: 'flows', desc: 'Manage user flow definitions', category: 'tooling',
    subcommands: [
      { name: 'init', desc: 'Create .slope/flows.json with example template' },
      { name: 'list', desc: 'List all flows with staleness indicators' },
      { name: 'check', desc: 'Validate all flows (file existence, staleness); exit 1 if stale' },
    ],
  },
  {
    cmd: 'metaphor', desc: 'Manage metaphor display themes', category: 'tooling',
    subcommands: [
      { name: 'list', desc: 'Show all available metaphors' },
      { name: 'set', desc: 'Set the active metaphor', flags: [
        { flag: '<id>', desc: 'Metaphor ID to activate' },
      ]},
      { name: 'show', desc: 'Show all terms for a metaphor', flags: [
        { flag: '<id>', desc: 'Metaphor ID to display' },
      ]},
    ],
  },
  {
    cmd: 'plugin', desc: 'Manage custom plugins', category: 'tooling',
    subcommands: [
      { name: 'list', desc: 'Show all plugins (built-in + custom)' },
      { name: 'validate', desc: 'Validate a plugin file', flags: [
        { flag: '<path>', desc: 'Plugin file path' },
      ]},
    ],
  },
  {
    cmd: 'store', desc: 'Store diagnostics and management', category: 'tooling',
    subcommands: [
      { name: 'status', desc: 'Show store type, schema version, and stats', flags: [
        { flag: '--json', desc: 'Output as JSON' },
      ]},
      { name: 'backup', desc: 'Back up the store', flags: [
        { flag: '--output=<path>', desc: 'Backup output path' },
      ]},
    ],
  },
  {
    cmd: 'escalate', desc: 'Escalate issues based on severity triggers', category: 'tooling',
    flags: [
      { flag: '--reason=<text>', desc: 'Manual escalation reason' },
      { flag: '--session-id=<id>', desc: 'Session ID context' },
      { flag: '--swarm=<id>', desc: 'Auto-detect escalations in a swarm' },
      { flag: '--sprint=<N>', desc: 'Sprint number' },
    ],
  },
  {
    cmd: 'transcript', desc: 'View session transcript data', category: 'tooling',
    subcommands: [
      { name: 'list', desc: 'List available transcripts' },
      { name: 'show', desc: 'Show turn-by-turn summary', flags: [
        { flag: '<session-id>', desc: 'Session ID to display' },
      ]},
      { name: 'stats', desc: 'Aggregate metrics', flags: [
        { flag: '<session-id>', desc: 'Session ID (optional, all if omitted)' },
      ]},
    ],
  },

  // ── Planning ───────────────────────────────────────────────────
  {
    cmd: 'roadmap', desc: 'Strategic planning and roadmap tools', category: 'planning',
    subcommands: [
      { name: 'validate', desc: 'Schema + dependency graph checks', flags: [
        { flag: '--path=<file>', desc: 'Roadmap file path' },
      ]},
      { name: 'review', desc: 'Automated architect review', flags: [
        { flag: '--path=<file>', desc: 'Roadmap file path' },
      ]},
      { name: 'status', desc: 'Current progress', flags: [
        { flag: '--path=<file>', desc: 'Roadmap file path' },
        { flag: '--sprint=<N>', desc: 'Focus on specific sprint' },
      ]},
      { name: 'show', desc: 'Render summary (critical path, parallel tracks)', flags: [
        { flag: '--path=<file>', desc: 'Roadmap file path' },
      ]},
      { name: 'sync', desc: 'Sync scorecards into roadmap', flags: [
        { flag: '--path=<file>', desc: 'Roadmap file path' },
        { flag: '--dry-run', desc: 'Preview without writing' },
      ]},
      { name: 'generate', desc: 'Generate from vision + backlog analysis', flags: [
        { flag: '--path=<file>', desc: 'Output roadmap file path' },
      ]},
    ],
  },
  {
    cmd: 'vision', desc: 'Display project vision document', category: 'planning',
    subcommands: [
      { name: 'create', desc: 'Create a new vision document', flags: [
        { flag: '--purpose=<text>', desc: 'Project purpose' },
        { flag: '--priorities=<list>', desc: 'Comma-separated priorities' },
      ]},
      { name: 'update', desc: 'Update existing vision fields', flags: [
        { flag: '--purpose=<text>', desc: 'Updated purpose' },
        { flag: '--priorities=<list>', desc: 'Updated priorities' },
      ]},
    ],
    flags: [{ flag: '--json', desc: 'Output as JSON' }],
  },
  {
    cmd: 'initiative', desc: 'Multi-sprint initiative orchestration', category: 'planning',
    subcommands: [
      { name: 'create', desc: 'Create a new initiative' },
      { name: 'status', desc: 'Show current initiative state' },
      { name: 'next', desc: 'Show next sprint in the initiative' },
      { name: 'advance', desc: 'Advance to the next phase' },
      { name: 'review', desc: 'Record a review gate result', flags: [
        { flag: '--sprint=<N>', desc: 'Sprint number' },
        { flag: '--gate=<gate>', desc: 'Gate type (plan, pr)' },
        { flag: '--reviewer=<type>', desc: 'Reviewer type' },
        { flag: '--findings=<N>', desc: 'Number of findings' },
      ]},
      { name: 'checklist', desc: 'Show review checklist' },
    ],
  },

  // ── Loop ─────────────────────────────────────────────
  {
    cmd: 'loop', desc: 'Autonomous sprint execution loop', category: 'tooling',
    subcommands: [
      { name: 'run', desc: 'Single sprint execution', flags: [
        { flag: '--sprint=<ID>', desc: 'Sprint ID to execute' },
        { flag: '--dry-run', desc: 'Preview without executing' },
      ]},
      { name: 'continuous', desc: 'Multi-sprint loop', flags: [
        { flag: '--max=<N>', desc: 'Maximum sprints to run (default: 10)' },
        { flag: '--pause=<S>', desc: 'Pause between sprints in seconds' },
        { flag: '--staging', desc: 'Use staging branch' },
        { flag: '--dry-run', desc: 'Preview without executing' },
      ]},
      { name: 'parallel', desc: 'Dual-sprint parallel execution via worktrees', flags: [
        { flag: '--dry-run', desc: 'Preview without executing' },
      ]},
      { name: 'status', desc: 'Show loop progress, next sprint, config', flags: [
        { flag: '--sprint=<ID>', desc: 'Show status for a specific sprint' },
      ]},
      { name: 'config', desc: 'Loop configuration management', flags: [
        { flag: '--show', desc: 'Display current config' },
        { flag: '--set', desc: 'Set a config value (k=v)' },
      ]},
      { name: 'results', desc: 'Format/display sprint results', flags: [
        { flag: '--sprint=<ID>', desc: 'Show results for a specific sprint' },
        { flag: '--json', desc: 'Output as JSON' },
      ]},
      { name: 'analyze', desc: 'Mine scorecards, generate backlog', flags: [
        { flag: '--regenerate', desc: 'Force regeneration' },
      ]},
      { name: 'models', desc: 'Model selection analytics', flags: [
        { flag: '--analyze', desc: 'Run model analysis' },
        { flag: '--show', desc: 'Show current model config' },
      ]},
      { name: 'guide', desc: 'SKILL.md word count and hazard check', flags: [
        { flag: '--check', desc: 'Validate guide' },
        { flag: '--synthesize', desc: 'Synthesize guide content' },
      ]},
      { name: 'clean', desc: 'Cleanup loop artifacts', flags: [
        { flag: '--results', desc: 'Clean result files' },
        { flag: '--logs', desc: 'Clean log files' },
        { flag: '--worktrees', desc: 'Clean git worktrees' },
        { flag: '--all', desc: 'Clean everything' },
      ]},
    ],
  },

  // ── Indexing ──────────────────────────────────────────────────────
  {
    cmd: 'index-cmd', desc: 'Semantic embedding index management', category: 'tooling',
    flags: [
      { flag: '--full', desc: 'Full reindex (drop + rebuild)' },
      { flag: '--status', desc: 'Show index stats' },
      { flag: '--prune', desc: 'Remove embeddings for deleted files' },
      { flag: '--json', desc: 'Output stats as JSON' },
    ],
  },
  {
    cmd: 'context', desc: 'Semantic context search for agents', category: 'tooling',
    flags: [
      { flag: '<query>', desc: 'Free-text semantic search query' },
      { flag: '--ticket=<key>', desc: 'Use ticket title as query' },
      { flag: '--file=<path>', desc: 'Find files related to a given file' },
      { flag: '--top=<N>', desc: 'Limit results (default: 5)' },
      { flag: '--format=<fmt>', desc: 'Output format (paths, snippets, full)' },
    ],
  },
  {
    cmd: 'prep', desc: 'Generate execution plan for a ticket', category: 'tooling',
    flags: [
      { flag: '<ticket-id>', desc: 'Ticket ID to prepare' },
      { flag: '--json', desc: 'Output as JSON' },
      { flag: '--top=<N>', desc: 'Limit context results (default: 5)' },
    ],
  },
  {
    cmd: 'enrich', desc: 'Batch-enrich backlog with file context', category: 'tooling',
    flags: [
      { flag: '<backlog-path>', desc: 'Path to backlog file' },
      { flag: '--output=<path>', desc: 'Output path for enriched backlog' },
      { flag: '--with-plans', desc: 'Include execution plans' },
      { flag: '--top=<N>', desc: 'Limit context results per ticket (default: 5)' },
    ],
  },
  {
    cmd: 'docs', desc: 'Generate documentation manifest and changelog', category: 'tooling',
    subcommands: [
      { name: 'generate', desc: 'Build manifest JSON from registries + git history', flags: [
        { flag: '--output=<path>', desc: 'Write manifest to path (default: .slope/docs.json)' },
        { flag: '--pretty', desc: 'Pretty-print JSON output' },
        { flag: '--incremental', desc: 'Skip changelog generation' },
        { flag: '--stdout', desc: 'Write to stdout instead of file' },
      ]},
      { name: 'changelog', desc: 'Generate changelog from conventional commits', flags: [
        { flag: '--since=<version>', desc: 'Changelog since this version/tag' },
        { flag: '--format=<fmt>', desc: 'Output format: markdown (default) or json' },
      ]},
      { name: 'check', desc: 'Compare saved manifest against current state (exit 1 on drift)', flags: [
        { flag: '--manifest=<path>', desc: 'Path to saved manifest (default: .slope/docs.json)' },
      ]},
      { name: 'sync', desc: 'Copy manifest to slope-web or target directory', flags: [
        { flag: '--target=<path>', desc: 'Target directory (default: adjacent slope-web repo)' },
      ]},
    ],
  },
];
