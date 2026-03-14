#!/usr/bin/env node
/**
 * SLOPE CLI — Sprint Lifecycle & Operational Performance Engine
 *
 * Usage:
 *   slope init                              Initialize .slope/ directory
 *   slope card                              Display handicap card
 *   slope validate [path]                   Validate scorecard(s)
 *   slope review [path] [--plain]           Format sprint review
 *   slope briefing [--sprint=N] [options]    Pre-round briefing
 *   slope plan --complexity=<level>         Pre-shot advisor
 *   slope classify --scope=... ...          Classify a shot
 *   slope claim --target=<t> [--force]       Claim a ticket or area
 *   slope release --id=<id>                 Release a claim
 *   slope status [--sprint=N]               Show sprint course status
 *   slope dashboard [--port=N] [--no-open]  Live local performance dashboard
 */

import { initCommand } from './commands/init.js';
import { cardCommand } from './commands/card.js';
import { validateCommand } from './commands/validate.js';
import { reviewCommand } from './commands/review.js';
import { briefingCommand } from './commands/briefing.js';
import { planCommand } from './commands/plan.js';
import { classifyCommand } from './commands/classify.js';
import { claimCommand } from './commands/claim.js';
import { releaseCommand } from './commands/release.js';
import { statusCommand } from './commands/status.js';
import { tournamentCommand } from './commands/tournament.js';
import { autoCardCommand } from './commands/auto-card.js';
import { nextCommand } from './commands/next.js';
import { sessionCommand } from './commands/session.js';
import { hookCommand } from './commands/hook.js';
import { roadmapCommand } from './commands/roadmap.js';
import { extractCommand } from './commands/extract.js';
import { distillCommand } from './commands/distill.js';
import { guardCommand, guardManageCommand } from './commands/guard.js';
import { reportCommand } from './commands/report.js';
import { standupCommand } from './commands/standup.js';
import { escalateCommand } from './commands/escalate.js';
import { pluginCommand } from './commands/plugin.js';
import { dashboardCommand } from './commands/dashboard.js';
import { mapCommand } from './commands/map.js';
import { flowsCommand } from './commands/flows.js';
import { reviewStateCommand } from './commands/review-state.js';
import { analyzeCommand } from './commands/analyze.js';
import { visionCommand } from './commands/vision.js';
import { transcriptCommand } from './commands/transcript.js';
import { storeCommand } from './commands/store.js';
import { metaphorCommand } from './commands/metaphor.js';
import { initiativeCommand } from './commands/initiative.js';
import { indexCommand } from './commands/index-cmd.js';
import { contextCommand } from './commands/context.js';
import { prepCommand } from './commands/prep.js';
import { enrichCommand } from './commands/enrich.js';
import { docsCommand } from './commands/docs.js';
import { statsCommand } from './commands/stats.js';
import { loopCommand } from './commands/loop.js';
import { sprintCommand } from './commands/sprint.js';
import { doctorCommand } from './commands/doctor.js';
import { versionCommand } from './commands/version.js';
import { helpCommand } from './commands/help.js';
import { quickstartCommand } from './commands/quickstart.js';
import { worktreeCommand } from './commands/worktree.js';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const subcommand = process.argv[2];

// Handle --help and -h flags globally
if (subcommand === '--help' || subcommand === '-h') {
  console.log(`
SLOPE CLI — Sprint Lifecycle & Operational Performance Engine

Usage:
  slope init [--claude-code|--cursor|--opencode|--generic|--all]  Initialize .slope/ directory
  slope init --team                         Enable multi-developer team mode
  slope card                                Show handicap card
  slope card --player=<name>                Show handicap for a specific player
  slope card --team                         Show per-player comparison table
  slope validate [path]                     Validate scorecard(s)
  slope review [path] [--plain]             Format sprint review markdown
  slope briefing                            Pre-round briefing
  slope version                             Show current version
  slope doctor                              Check repo health

For full command list, run: slope
`);
  process.exit(0);
}

// Handle --version flag
if (subcommand === '--version') {
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8'));
  console.log(`@slope-dev/slope v${pkg.version ?? 'unknown'}`);
  process.exit(0);
}

switch (subcommand) {
  case 'init':
    initCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'card':
    cardCommand(process.argv.slice(3));
    break;
  case 'validate':
    validateCommand(process.argv[3]);
    break;
  case 'review': {
    const reviewArgs = process.argv.slice(3);
    const reviewSub = reviewArgs[0];
    if (['start', 'round', 'status', 'reset', 'recommend', 'findings', 'amend'].includes(reviewSub)) {
      reviewStateCommand(reviewArgs).catch(err => {
        console.error('Error:', err.message);
        process.exit(1);
      });
    } else {
      const plainFlag = reviewArgs.includes('--plain');
      const metaphorArg = reviewArgs.find((a: string) => a.startsWith('--metaphor='));
      const metaphorVal = metaphorArg?.slice('--metaphor='.length);
      const path = reviewArgs.find((a: string) => !a.startsWith('--'));
      reviewCommand(path, plainFlag ? 'plain' : undefined, metaphorVal);
    }
    break;
  }
  case 'briefing':
    briefingCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'plan':
    planCommand(process.argv.slice(3));
    break;
  case 'classify':
    classifyCommand(process.argv.slice(3));
    break;
  case 'claim':
    claimCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'release':
    releaseCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'status':
    statusCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'tournament':
    tournamentCommand(process.argv.slice(3));
    break;
  case 'auto-card':
    autoCardCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'hook':
    hookCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'session':
    sessionCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'next':
    nextCommand();
    break;
  case 'roadmap':
    roadmapCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'extract':
    extractCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'distill':
    distillCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'report':
    reportCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'standup':
    standupCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'escalate':
    escalateCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'guard': {
    const guardArgs = process.argv.slice(3);
    const guardSub = guardArgs[0];
    if (guardSub === 'list' || guardSub === 'status' || guardSub === 'enable' || guardSub === 'disable' || guardSub === 'docs') {
      guardManageCommand(guardArgs).catch(err => {
        console.error('Error:', err.message);
        process.exit(1);
      });
    } else {
      guardCommand(guardArgs).catch(err => {
        console.error('Error:', err.message);
        process.exit(1);
      });
    }
    break;
  }
  case 'plugin':
    pluginCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'dashboard':
    dashboardCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'map':
    mapCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'flows':
    flowsCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'analyze':
    analyzeCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'vision':
    visionCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'transcript':
    transcriptCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'store':
    storeCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'metaphor':
    metaphorCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'initiative':
    initiativeCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'index':
    indexCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'context':
    contextCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'prep':
    prepCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'enrich':
    enrichCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'stats':
    statsCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'docs':
    docsCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'loop':
    loopCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'sprint':
    sprintCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'doctor':
    doctorCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'version':
    versionCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'help':
    helpCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'quickstart':
    quickstartCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'worktree':
    worktreeCommand(process.argv.slice(3)).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  default:
    console.log(`
SLOPE CLI — Sprint Lifecycle & Operational Performance Engine

Usage:
  slope init [--claude-code|--cursor|--opencode|--generic|--all]  Initialize .slope/ directory
  slope init --team                         Enable multi-developer team mode
  slope card                                Show handicap card
  slope card --player=<name>                Show handicap for a specific player
  slope card --team                         Show per-player comparison table
  slope validate [path]                     Validate scorecard(s)
  slope review [path] [--plain]             Format sprint review markdown
  slope review start [--rounds=N|--tier=T]  Start plan review lifecycle
  slope review round                        Record a completed review round
  slope review status                       Show current review state
  slope review reset                        Clear review state
  slope review recommend                    Recommend review types for current sprint
  slope review findings add|list|clear      Manage implementation review findings
  slope review amend [--sprint=N]           Amend scorecard with review findings
  slope briefing [--sprint=N] [options]      Pre-round briefing
  slope plan --complexity=<level>           Pre-shot advisor (club + training + hazards)
  slope classify --scope=... ...            Classify a shot from execution trace
  slope claim --target=<t> [--force]        Claim a ticket or area for the sprint
  slope release --id=<id>                   Release a claim by ID
  slope release --target=<t> [--player=<p>] Release a claim by target
  slope status [--sprint=N]                 Show sprint course status + conflicts
  slope tournament --id=<id> --sprints=N..M Build tournament review from sprints
  slope auto-card --sprint=<N> [options]    Generate scorecard from git + CI signals
  slope hook add|remove|list|show            Manage lifecycle hooks
  slope hook add --level=full               Install all guidance hooks
  slope guard <name>                        Run a guard handler (reads stdin)
  slope guard list|enable|disable           Manage guard activation
  slope session start|end|heartbeat|list    Manage live sessions
  slope next                                Show next sprint number (auto-detect)
  slope extract --file=<path> [options]       Extract events into SLOPE store
  slope distill [--auto] [--dry-run]         Promote event patterns to common issues
  slope standup [--session=<id>] [--json]     Generate standup report from session
  slope standup --ingest=<path> [--role=<id>] Ingest another agent's standup
  slope report --html [--output=<path>]      Generate HTML performance report
  slope dashboard [--port=N] [--no-open]    Live local performance dashboard
  slope dashboard --player=<name>          Filter dashboard to a single player
  slope roadmap validate|review|status|show  Strategic planning tools
  slope map [--check] [--output=<path>]     Generate/update codebase map
  slope flows init|list|check               Manage user flow definitions
  slope analyze [--json] [--analyzers=...]  Scan repo and generate profile
  slope vision [--json]                     Display project vision document
  slope store status [--json]                Store diagnostics (type, schema, stats)
  slope store migrate status                Show schema version and migration status
  slope store backup [--output=<path>]      Back up the store
  slope store restore --from=<path>         Restore from a backup
  slope transcript list|show|stats          View session transcript data
  slope metaphor list|set|show              Manage metaphor display themes
  slope plugin list|validate                Manage custom plugins
  slope initiative create|status|next|advance|review  Multi-sprint initiative orchestration
  slope index [--full|--status|--prune]               Semantic embedding index
  slope context "query" [options]                     Semantic context search
  slope prep <ticket-id> [--json] [--top=5]          Generate execution plan for a ticket
  slope enrich [backlog-path] [--output=<path>]      Batch-enrich backlog with file context
  slope stats export [--pretty]                      Export stats JSON for slope-web
  slope docs generate|changelog|check                Documentation manifest and changelog
  slope sprint start|gate|status|reset               Manage sprint lifecycle state
  slope worktree cleanup [--path|--all] [--dry-run]  Clean up stale worktrees
  slope loop status|config|run|continuous|...        Autonomous sprint execution loop
  slope doctor [--fix]                               Check repo health and fix issues
  slope version                                      Show current version
  slope version bump [<version>] [--dry-run]         Bump version, create PR, merge

Examples:
  slope init                                Create .slope/ with config + example scorecard
  slope init --cursor                       Also install Cursor IDE rules
  slope init --cursor                       Also add SLOPE MCP server to .cursor/mcp.json
  slope init --claude-code                  Also install Claude Code rules + hooks
  slope init --opencode                     Also install OpenCode AGENTS.md + MCP config
  slope init --team                          Enable multi-developer mode
  slope card                                Show handicap across all scorecards
  slope card --player=alice                 Show handicap for alice only
  slope card --team                         Compare all players side-by-side
  slope validate docs/retros/sprint-1.json  Validate a specific scorecard
  slope validate                            Validate all scorecards
  slope review                              Review the latest scorecard
  slope review --plain                      Non-technical sprint review
  slope briefing                            Full briefing (top 10 recent gotchas)
  slope briefing --categories=testing       Filter by category
  slope briefing --keywords=migration       Filter by keyword
  slope plan --complexity=medium            Club recommendation for medium ticket
  slope plan --complexity=large --areas=db  Include hazard warnings for db area
  slope classify --scope="a.ts" --modified="a.ts" --tests=pass --reverts=0
  slope briefing --sprint=2                 Briefing for sprint 2
  slope claim --target=S2-1 --sprint=2      Claim ticket S2-1 for sprint 2
  slope claim --target=packages/cli --scope=area  Claim an area
  slope claim --target=S2-1 --force         Claim even if overlap conflict exists
  slope status --sprint=2                   Show all claims for sprint 2
  slope release --target=S2-1               Release your claim on S2-1
  slope dashboard                           Start live dashboard on port 3000
  slope dashboard --port=8080 --no-open     Custom port, no browser auto-open
`);
    process.exit(subcommand ? 1 : 0);
}
