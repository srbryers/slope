import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseRoadmap,
  loadScorecards,
  formatSprintLabel,
  findRoadmapSprint,
  roadmapSprintKey,
  roadmapSprintKeyFromId,
} from '../../core/index.js';
import type { RoadmapDefinition, RoadmapSprint } from '../../core/index.js';
import { loadConfig } from '../config.js';
import { inferSprintContext } from '../sprint-inference.js';
import { loadSprintState, pendingGateNames } from '../sprint-state.js';
import { resolveStore } from '../store.js';

/**
 * `slope agent status` — machine-readable operational status (GH #310).
 *
 * Surface a single source of truth that AI agents can consume without
 * orchestrating sprint/roadmap/initiative/status commands themselves.
 *
 * `--json` emits the AgentStatus object exactly. Default output is a
 * compact human-readable summary derived from the same data.
 */

/** AgentStatus schema version. Bumped when the JSON shape changes in a
 *  breaking way — agents consuming this should check `_version` and refuse
 *  unknown values rather than risk silent misinterpretation. */
export const AGENT_STATUS_VERSION = 2;

export interface AgentStatus {
  /** Schema version — bumped on breaking changes to the JSON shape. */
  _version: number;
  vision: 'present' | 'missing';
  roadmap: 'valid' | 'invalid' | 'missing';
  currentSprint: string | null;
  /** Sprint phase (sprint-state) OR initiative gate phase. 'pr_review' and
   *  'plan_review' come from the initiative subsystem; the others come from
   *  sprint-state.json. 'unknown' = no state on disk. */
  phase: 'planning' | 'plan_review' | 'reviewing' | 'implementing' | 'scoring' | 'pr_review' | 'complete' | 'unknown';
  activeClaims: string[];
  nextTicket: string | null;
  blockedBy: string[];
  requiredGates: string[];
  recommendedCommands: string[];
}

export async function agentCommand(args: string[]): Promise<void> {
  const sub = args[0];

  if (sub === '--help' || sub === '-h') {
    printHelp();
    return;
  }

  if (sub === 'status' || sub === undefined) {
    await statusSubcommand(args.slice(sub === 'status' ? 1 : 0));
    return;
  }

  if (sub === 'next-md') {
    await nextMdSubcommand(args.slice(1));
    return;
  }

  console.error(`\nUnknown agent subcommand: ${sub}\n`);
  printHelp();
  process.exit(1);
}

function printHelp(): void {
  console.log(`
slope agent — Machine-readable operational primitives for AI agents

Usage:
  slope agent status            Show current state (human-readable)
  slope agent status --json     Emit AgentStatus JSON
  slope agent next-md           Generate AGENT_NEXT.md (current-state handoff)
  slope agent next-md --output=<path>   Write to a custom path

Output fields (status):
  vision               'present' | 'missing'
  roadmap              'valid' | 'invalid' | 'missing'
  currentSprint        string | null
  phase                planning | reviewing | implementing | scoring | complete | unknown
  activeClaims         ticket keys currently claimed
  nextTicket           recommended next ticket key
  blockedBy            sprint IDs blocking the current/next sprint
  requiredGates        pending gate names (e.g. tests, code_review)
  recommendedCommands  ordered list of next CLI invocations
`);
}

async function statusSubcommand(args: string[]): Promise<void> {
  const json = args.includes('--json');
  const cwd = process.cwd();
  const status = await collectAgentStatus(cwd);

  if (json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  printHumanStatus(status);
}

export async function collectAgentStatus(cwd: string): Promise<AgentStatus> {
  const config = loadConfig(cwd);

  // Vision
  const visionPath = join(cwd, '.slope', 'vision.json');
  const vision: AgentStatus['vision'] = existsSync(visionPath) ? 'present' : 'missing';

  // Roadmap
  let roadmap: RoadmapDefinition | null = null;
  let roadmapState: AgentStatus['roadmap'] = 'missing';
  const roadmapPath = join(cwd, config.roadmapPath);
  if (existsSync(roadmapPath)) {
    try {
      const raw = JSON.parse(readFileSync(roadmapPath, 'utf8'));
      const parsed = parseRoadmap(raw);
      roadmap = parsed.roadmap;
      roadmapState = parsed.validation.valid ? 'valid' : 'invalid';
    } catch {
      roadmapState = 'invalid';
    }
  }

  // Current sprint — sprint-state.json wins; otherwise infer from roadmap
  // pending work before falling back to scorecards (#364).
  const sprintState = loadSprintState(cwd);
  let currentSprint: string | null = sprintState?.sprint ?? null;
  if (currentSprint == null) {
    try {
      const inferred = inferSprintContext(cwd, config);
      currentSprint = inferred.source === 'initial' && !roadmap ? null : inferred.sprint;
    } catch {
      // best-effort
    }
  }

  // Phase
  const phase: AgentStatus['phase'] = sprintState?.phase ?? 'unknown';

  // Active claims + completed tickets (from store, single open)
  // Completed = any ticket with a `decision` event of kind `ticket_done`.
  // `slope ticket done` writes those, so we use them to advance nextTicket
  // past finished work even after the claim has been released. (#348)
  const activeClaims: string[] = [];
  const completedTickets = new Set<string>();
  if (currentSprint != null) {
    try {
      const store = await resolveStore(cwd);
      const claims = await store.list(currentSprint);
      for (const c of claims) {
        if (c.target) activeClaims.push(c.target);
      }
      try {
        const events = await store.getEventsBySprint(currentSprint);
        for (const e of events) {
          if (e.type === 'decision' && e.ticket_key && (e.data as { kind?: string })?.kind === 'ticket_done') {
            completedTickets.add(e.ticket_key);
          }
        }
      } catch {
        // events optional — older stores may not have them
      }
      store.close();
    } catch {
      // store unavailable — return empty
    }
  }

  // Sprints completed = roadmap entry has `status: complete` OR a scorecard
  // exists on disk for that sprint. The scorecard signal matches what
  // `slope roadmap status` uses (#356) — agent status was previously only
  // looking at the roadmap status field, which isn't auto-updated when a
  // sprint closes, so it kept reporting stale `blockedBy: [N]` even after
  // the upstream sprint was completed.
  const completedSprintIds = new Set<string>();
  for (const s of roadmap?.sprints ?? []) {
    if ((s as RoadmapSprint & { status?: string }).status === 'complete') {
      completedSprintIds.add(roadmapSprintKey(roadmap!, s));
    }
  }
  try {
    for (const card of loadScorecards(config, cwd)) {
      const key = roadmap
        ? roadmapSprintKeyFromId(roadmap, card.sprint_number)
        : String(card.sprint_number);
      if (key !== null) completedSprintIds.add(key);
    }
  } catch {
    // scorecards optional — keep going with whatever the roadmap had
  }

  // Next ticket priority:
  //   1. The agent's active claim (finishing in-flight work beats starting new) — #342
  //   2. The first ticket that is neither claimed by anyone nor already done — #348
  //   3. null when the sprint is exhausted
  let nextTicket: string | null = null;
  let blockedBy: string[] = [];
  if (roadmap && currentSprint != null) {
    const sprint = findRoadmapSprint(roadmap, currentSprint);
    if (sprint) {
      const claimed = new Set(activeClaims);
      const inFlight = sprint.tickets.find(t => claimed.has(t.key));
      if (inFlight) {
        nextTicket = inFlight.key;
      } else {
        const next = sprint.tickets.find(t => !claimed.has(t.key) && !completedTickets.has(t.key));
        nextTicket = next?.key ?? null;
      }
      blockedBy = computeBlockers(roadmap, sprint, completedSprintIds);
    }
  }

  // Required gates (pending)
  const requiredGates: string[] = [];
  if (sprintState) {
    requiredGates.push(...pendingGateNames(sprintState));
  }

  // Recommend commands based on combined state
  const recommendedCommands = recommendCommands({
    vision,
    roadmap: roadmapState,
    currentSprint,
    phase,
    activeClaims,
    nextTicket,
    blockedBy,
    requiredGates,
    sprintState,
  });

  return {
    _version: AGENT_STATUS_VERSION,
    vision,
    roadmap: roadmapState,
    currentSprint,
    phase,
    activeClaims,
    nextTicket,
    blockedBy,
    requiredGates,
    recommendedCommands,
  };
}

/** A sprint is blocked when any of its `depends_on` upstreams is not yet
 *  in the completed-sprint set. The set is built by the caller from BOTH
 *  roadmap `status: complete` AND scorecards on disk — matching the
 *  source of truth `slope roadmap status` already uses (#356). */
function computeBlockers(
  roadmap: RoadmapDefinition,
  sprint: RoadmapSprint,
  completedSprintIds: Set<string>,
): string[] {
  return (sprint.depends_on ?? [])
    .map(dependency => roadmapSprintKeyFromId(roadmap, dependency))
    .filter((dependency): dependency is string =>
      dependency !== null && !completedSprintIds.has(dependency));
}

function recommendCommands(state: {
  vision: AgentStatus['vision'];
  roadmap: AgentStatus['roadmap'];
  currentSprint: string | null;
  phase: AgentStatus['phase'];
  activeClaims: string[];
  nextTicket: string | null;
  blockedBy: string[];
  requiredGates: string[];
  sprintState: ReturnType<typeof loadSprintState>;
}): string[] {
  const cmds: string[] = [];

  // Bootstrap — missing fundamentals come first
  if (state.vision === 'missing') {
    cmds.push('slope vision create --purpose="..." --priorities="a,b,c"');
    return cmds;
  }
  if (state.roadmap === 'missing') {
    cmds.push('slope roadmap generate');
    return cmds;
  }
  if (state.roadmap === 'invalid') {
    cmds.push('slope roadmap validate');
    // Continue on — agent may still want to know what to do beyond fixing
  }

  // No active sprint state
  if (state.sprintState == null) {
    if (state.currentSprint != null) {
      cmds.push(`slope sprint start --number=${state.currentSprint}`);
    } else {
      cmds.push('slope briefing');
    }
    return cmds;
  }

  // Blocked by upstream sprint
  if (state.blockedBy.length > 0) {
    cmds.push(`slope roadmap status`);
    return cmds;
  }

  // Phase-driven recommendations
  switch (state.phase) {
    case 'planning':
      cmds.push('slope briefing');
      if (state.nextTicket) {
        cmds.push(`slope prep ${state.nextTicket} --lite`);
      }
      break;
    case 'reviewing':
      cmds.push('slope review status');
      cmds.push('slope review round');
      break;
    case 'implementing':
      if (state.activeClaims.length === 0 && state.nextTicket) {
        cmds.push(`slope claim ${state.nextTicket}`);
      } else if (state.requiredGates.length > 0) {
        for (const g of state.requiredGates.slice(0, 2)) {
          if (g === 'code_review' || g === 'architect_review') {
            cmds.push(`slope sprint gate ${g} --reviewer=<id> --evidence=<path-or-url>`);
          } else {
            cmds.push(`slope sprint gate ${g}`);
          }
        }
      }
      break;
    case 'scoring':
      if (state.requiredGates.includes('scorecard')) {
        cmds.push(`slope auto-card --sprint=${state.currentSprint}`);
        cmds.push('slope validate');
      }
      if (state.requiredGates.includes('review_md')) {
        cmds.push(`slope review --sprint=${state.currentSprint}`);
      }
      break;
    case 'complete':
      cmds.push(`slope sprint rollover --from=${state.currentSprint} --to=<next>`);
      cmds.push('slope briefing');
      break;
  }

  return cmds;
}

async function nextMdSubcommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const status = await collectAgentStatus(cwd);

  // Pull sprint theme from roadmap if available, for nicer rendering
  let sprintTheme: string | undefined;
  try {
    const config = loadConfig(cwd);
    const roadmapPath = join(cwd, config.roadmapPath);
    if (existsSync(roadmapPath)) {
      const raw = JSON.parse(readFileSync(roadmapPath, 'utf8'));
      const parsed = parseRoadmap(raw);
      const sprint = parsed.roadmap && status.currentSprint
        ? findRoadmapSprint(parsed.roadmap, status.currentSprint)
        : undefined;
      sprintTheme = sprint?.theme;
    }
  } catch { /* best-effort */ }

  const md = renderAgentMarkdown(status, { sprintTheme });

  const outputArg = args.find(a => a.startsWith('--output='));
  // Reject --output= (empty value) and undefined splits — fall back to default
  // path. Without this, an empty value would write to the cwd as a file named
  // ''.
  const outputPath = (outputArg && outputArg.length > '--output='.length)
    ? outputArg.slice('--output='.length)
    : 'AGENT_NEXT.md';
  const absPath = join(cwd, outputPath);

  writeFileSync(absPath, md);
  console.log(`Wrote ${outputPath}`);
}

export function renderAgentMarkdown(
  s: AgentStatus,
  opts: { sprintTheme?: string } = {},
): string {
  const lines: string[] = [];
  const sprintLabel = s.currentSprint != null
    ? `${formatSprintLabel(s.currentSprint)}${opts.sprintTheme ? ` ${opts.sprintTheme}` : ''}`
    : '—';

  lines.push('# Agent Next');
  lines.push('');
  lines.push('<!-- Generated by `slope agent next-md`. Not a durable doc — regenerate after sprint state changes. -->');
  lines.push('');
  lines.push(`Current sprint: ${sprintLabel}`);
  lines.push(`Current phase: ${s.phase}`);
  lines.push(`Current claim: ${s.activeClaims.length > 0 ? s.activeClaims.join(', ') + ' active' : 'none'}`);
  lines.push(`Next ticket: ${s.nextTicket ?? '—'}`);
  lines.push(`Next command: ${s.recommendedCommands[0] ?? '—'}`);
  lines.push('');

  if (s.blockedBy.length > 0) {
    lines.push('## Blocked');
    lines.push('');
    lines.push(`This sprint is blocked by: ${s.blockedBy.map(id => `S${id}`).join(', ')}`);
    lines.push('');
    lines.push('Resolve those before proceeding here.');
    lines.push('');
  }

  if (s.requiredGates.length > 0) {
    lines.push('## Pending gates');
    lines.push('');
    for (const g of s.requiredGates) {
      lines.push(`- ${g}`);
    }
    lines.push('');
  }

  if (s.recommendedCommands.length > 0) {
    lines.push('## Recommended commands');
    lines.push('');
    for (const c of s.recommendedCommands) {
      lines.push(`- \`${c}\``);
    }
    lines.push('');
  }

  // Provenance: state snapshot for agents that want raw data inline
  lines.push('## Status snapshot');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(s, null, 2));
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

function printHumanStatus(s: AgentStatus): void {
  const lines: string[] = [];
  lines.push('');
  lines.push('SLOPE AGENT STATUS');
  lines.push('═'.repeat(50));
  lines.push(`  Vision:        ${s.vision}`);
  lines.push(`  Roadmap:       ${s.roadmap}`);
  lines.push(`  Sprint:        ${s.currentSprint != null ? formatSprintLabel(s.currentSprint) : '—'}`);
  lines.push(`  Phase:         ${s.phase}`);
  lines.push(`  Claims:        ${s.activeClaims.length > 0 ? s.activeClaims.join(', ') : 'none'}`);
  lines.push(`  Next ticket:   ${s.nextTicket ?? '—'}`);
  if (s.blockedBy.length > 0) {
    lines.push(`  Blocked by:    ${s.blockedBy.map(id => `S${id}`).join(', ')}`);
  }
  if (s.requiredGates.length > 0) {
    lines.push(`  Pending gates: ${s.requiredGates.join(', ')}`);
  }
  lines.push('');
  if (s.recommendedCommands.length > 0) {
    lines.push('RECOMMENDED NEXT COMMANDS:');
    for (const c of s.recommendedCommands) {
      lines.push(`  $ ${c}`);
    }
  } else {
    lines.push('No recommended commands — state is balanced.');
  }
  lines.push('');
  console.log(lines.join('\n'));
}
