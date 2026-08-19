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
import { reviewCommand, parseReviewArgs } from './commands/review.js';
import { briefingCommand } from './commands/briefing.js';
import { planCommand } from './commands/plan.js';
import { classifyCommand } from './commands/classify.js';
import { claimCommand } from './commands/claim.js';
import { releaseCommand } from './commands/release.js';
import { statusCommand } from './commands/status.js';
import { tournamentCommand } from './commands/tournament.js';
import { autoCardCommand } from './commands/auto-card.js';
import { nextCommand } from './commands/next.js';
import { agentCommand } from './commands/agent.js';
import { ticketCommand } from './commands/ticket.js';
import { gateCommand } from './commands/gate.js';
import { commitReadyCommand } from './commands/commit-ready.js';
import { prCommand } from './commands/pr.js';
import { sessionCommand } from './commands/session.js';
import { hookCommand } from './commands/hook.js';
import { roadmapCommand } from './commands/roadmap.js';
import { retroCommand } from './commands/retro.js';
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
import { workflowCommand } from './commands/workflow.js';
import { inspirationsCommand } from './commands/inspirations.js';
import { reviewStateCommand, shouldRouteToReviewState } from './commands/review-state.js';
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
import { interviewCommand } from './commands/interview.js';
import { sprintCommand } from './commands/sprint.js';
import { resumeCommand } from './commands/resume.js';
import { doctorCommand } from './commands/doctor.js';
import { versionCommand } from './commands/version.js';
import { helpCommand, printDefaultHelp } from './commands/help.js';
import { quickstartCommand } from './commands/quickstart.js';
import { nowCommand } from './commands/now.js';
import { startCommand } from './commands/start.js';
import { worktreeCommand } from './commands/worktree.js';
import { orgCommand } from './commands/org.js';
import { memoryCommand } from './commands/memory.js';
import { phaseCommand } from './commands/phase.js';
import { skillsCommand } from './commands/skills.js';
import { issueCommand } from './commands/issue.js';
import { reportCliError } from './error-reporter.js';
import { buildSourceCheckoutRuntimeWarning } from './source-runtime.js';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const subcommand = process.argv[2];

const sourceRuntimeWarning = buildSourceCheckoutRuntimeWarning({
  cwd: process.cwd(),
  cliEntryPath: fileURLToPath(import.meta.url),
  args: process.argv.slice(2),
});
if (sourceRuntimeWarning) {
  console.error(`${sourceRuntimeWarning}\n`);
}

// Handle --help and -h flags globally
if (subcommand === '--help' || subcommand === '-h') {
  printDefaultHelp();
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
    initCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'interview':
    interviewCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'card':
    cardCommand(process.argv.slice(3));
    break;
  case 'validate':
    validateCommand(process.argv.slice(3));
    break;
  case 'review': {
    const reviewArgs = process.argv.slice(3);
    if (shouldRouteToReviewState(reviewArgs)) {
      reviewStateCommand(reviewArgs).catch(reportCliError);
    } else {
      const parsed = parseReviewArgs(reviewArgs);
      reviewCommand(parsed.path, parsed.mode, parsed.metaphor, parsed.outputPath, parsed.sprintSelector, {
        force: parsed.force,
      });
    }
    break;
  }
  case 'briefing':
    briefingCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'plan':
    planCommand(process.argv.slice(3));
    break;
  case 'classify':
    classifyCommand(process.argv.slice(3));
    break;
  case 'claim':
    claimCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'release':
    releaseCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'status':
    statusCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'tournament':
    tournamentCommand(process.argv.slice(3));
    break;
  case 'auto-card':
    autoCardCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'hook':
    hookCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'session':
    sessionCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'next':
    nextCommand(process.argv.slice(3));
    break;
  case 'agent':
    agentCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'ticket':
    ticketCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'gate':
    gateCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'commit-ready':
    commitReadyCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'pr':
    prCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'roadmap':
    roadmapCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'retro':
    retroCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'extract':
    extractCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'distill':
    distillCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'report':
    reportCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'standup':
    standupCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'escalate':
    escalateCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'guard': {
    const guardArgs = process.argv.slice(3);
    const guardSub = guardArgs[0];
    if (guardSub === 'list' || guardSub === 'status' || guardSub === 'enable' || guardSub === 'disable' || guardSub === 'docs' || guardSub === 'audit' || guardSub === 'recommend' || guardSub === 'metrics' || guardSub === 'check') {
      guardManageCommand(guardArgs).catch(reportCliError);
    } else {
      guardCommand(guardArgs).catch(reportCliError);
    }
    break;
  }
  case 'plugin':
    pluginCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'dashboard':
    dashboardCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'map':
    mapCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'flows':
    flowsCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'workflow':
    workflowCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'inspirations':
    inspirationsCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'analyze':
    analyzeCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'vision':
    visionCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'transcript':
    transcriptCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'store':
    storeCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'metaphor':
    metaphorCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'initiative':
    initiativeCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'index':
    indexCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'context':
    contextCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'prep':
    prepCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'enrich':
    enrichCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'stats':
    statsCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'docs':
    docsCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'loop':
    loopCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'sprint':
    sprintCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'resume':
    resumeCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'phase':
    phaseCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'skills':
    skillsCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'issue':
    issueCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'doctor':
    doctorCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'version':
    versionCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'help':
    helpCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'quickstart':
    quickstartCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'now':
    nowCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'start':
    startCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'worktree':
    worktreeCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'org':
    orgCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  case 'memory':
    memoryCommand(process.argv.slice(3)).catch(reportCliError);
    break;
  default:
    if (!subcommand) {
      printDefaultHelp();
      process.exit(0);
    }
    console.error(`Unknown command: "${subcommand}"`);
    console.error('Run `slope help` for the human surface or `slope help --all` for all commands.');
    process.exit(1);
}
