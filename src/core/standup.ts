// SLOPE — Standup Communication Protocol
// Structured format for agent status reports in multi-agent sprints.

import type { SlopeEvent, SprintClaim } from './types.js';

/** Structured standup report — platform-agnostic agent status format */
export interface StandupReport {
  sessionId: string;
  agent_role?: string;
  ticketKey?: string;
  status: 'working' | 'blocked' | 'complete';
  progress: string;
  blockers: string[];
  decisions: string[];
  handoffs: HandoffEntry[];
  timestamp: string;
}

/** A handoff — files or areas another agent needs to know about */
export interface HandoffEntry {
  target: string;
  description: string;
  for_role?: string;
}

/**
 * Generate a standup report from a session's events and claims.
 * Extracts progress, blockers, decisions, and handoffs from recent events.
 */
export function generateStandup(opts: {
  sessionId: string;
  agent_role?: string;
  events: SlopeEvent[];
  claims: SprintClaim[];
}): StandupReport {
  const { sessionId, agent_role, events, claims } = opts;

  // Determine current ticket from claims
  const ticketClaims = claims.filter(c => c.scope === 'ticket' && c.session_id === sessionId);
  const ticketKey = ticketClaims.length > 0 ? ticketClaims[0].target : undefined;

  // Extract blockers from failure/dead_end events
  const blockers: string[] = [];
  for (const e of events) {
    if (e.type === 'failure') {
      const desc = (e.data.error as string) ?? (e.data.description as string) ?? 'Unknown failure';
      blockers.push(desc);
    } else if (e.type === 'dead_end') {
      const desc = (e.data.approach as string) ?? (e.data.description as string) ?? 'Dead end encountered';
      blockers.push(`Dead end: ${desc}`);
    }
  }

  // Extract decisions from decision events
  const decisions: string[] = [];
  for (const e of events) {
    if (e.type === 'decision') {
      const desc = (e.data.choice as string) ?? (e.data.description as string) ?? 'Decision made';
      decisions.push(desc);
    }
  }

  // Extract handoffs from scope_change and hazard events
  const handoffs: HandoffEntry[] = [];
  for (const e of events) {
    if (e.type === 'scope_change') {
      const area = (e.data.area as string) ?? (e.data.target as string);
      if (area) {
        handoffs.push({
          target: area,
          description: (e.data.reason as string) ?? 'Scope changed',
        });
      }
    } else if (e.type === 'hazard') {
      const area = (e.data.area as string) ?? '';
      if (area) {
        handoffs.push({
          target: area,
          description: `Hazard: ${(e.data.description as string) ?? 'issue encountered'}`,
        });
      }
    }
  }

  // Determine overall status
  let status: StandupReport['status'] = 'working';
  if (blockers.length > 0) {
    status = 'blocked';
  }
  // Check for completion markers
  const hasCompletion = events.some(e =>
    e.type === 'decision' && (e.data.status === 'complete' || e.data.choice === 'complete'),
  );
  if (hasCompletion) {
    status = 'complete';
  }

  // Build progress summary
  const progressParts: string[] = [];
  const claimTargets = claims.filter(c => c.session_id === sessionId).map(c => c.target);
  if (claimTargets.length > 0) {
    progressParts.push(`Working on: ${claimTargets.join(', ')}`);
  }
  const eventCount = events.length;
  if (eventCount > 0) {
    progressParts.push(`${eventCount} event${eventCount === 1 ? '' : 's'} recorded`);
  }
  const progress = progressParts.length > 0 ? progressParts.join('. ') : 'No activity recorded';

  return {
    sessionId,
    agent_role,
    ticketKey,
    status,
    progress,
    blockers,
    decisions,
    handoffs,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Format a standup report as human-readable markdown.
 */
export function formatStandup(report: StandupReport): string {
  const lines: string[] = [];

  const statusIcon = report.status === 'complete' ? '[DONE]'
    : report.status === 'blocked' ? '[BLOCKED]'
    : '[ACTIVE]';

  lines.push(`## Standup ${statusIcon}`);
  lines.push('');

  // Identity
  const rolePart = report.agent_role ? ` (${report.agent_role})` : '';
  lines.push(`**Session:** ${report.sessionId}${rolePart}`);
  if (report.ticketKey) {
    lines.push(`**Ticket:** ${report.ticketKey}`);
  }
  lines.push(`**Status:** ${report.status}`);
  lines.push('');

  // Progress
  lines.push(`**Progress:** ${report.progress}`);
  lines.push('');

  // Blockers
  if (report.blockers.length > 0) {
    lines.push('**Blockers:**');
    for (const b of report.blockers) {
      lines.push(`- ${b}`);
    }
    lines.push('');
  }

  // Decisions
  if (report.decisions.length > 0) {
    lines.push('**Decisions:**');
    for (const d of report.decisions) {
      lines.push(`- ${d}`);
    }
    lines.push('');
  }

  // Handoffs
  if (report.handoffs.length > 0) {
    lines.push('**Handoffs:**');
    for (const h of report.handoffs) {
      const forRole = h.for_role ? ` (for: ${h.for_role})` : '';
      lines.push(`- **${h.target}**: ${h.description}${forRole}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Parse a standup report from its JSON event data.
 * Used when ingesting another agent's standup.
 */
export function parseStandup(data: Record<string, unknown>): StandupReport | null {
  if (!data.sessionId || !data.status || !data.progress) {
    return null;
  }

  return {
    sessionId: data.sessionId as string,
    agent_role: data.agent_role as string | undefined,
    ticketKey: data.ticketKey as string | undefined,
    status: data.status as StandupReport['status'],
    progress: data.progress as string,
    blockers: (data.blockers as string[]) ?? [],
    decisions: (data.decisions as string[]) ?? [],
    handoffs: (data.handoffs as HandoffEntry[]) ?? [],
    timestamp: (data.timestamp as string) ?? new Date().toISOString(),
  };
}

/**
 * Extract handoffs from a standup that are relevant to a given role.
 * Returns handoffs that either have no for_role or match the target role.
 */
export function extractRelevantHandoffs(
  standup: StandupReport,
  roleId?: string,
): HandoffEntry[] {
  if (!roleId) return [...standup.handoffs];
  return standup.handoffs.filter(h =>
    !h.for_role || h.for_role === roleId,
  );
}

// --- Team Standup Aggregation ---

/** Aggregated team standup from multiple agent standups */
export interface TeamStandup {
  timestamp: string;
  agents: StandupReport[];
  status: 'working' | 'blocked' | 'complete';
  summary: { working: number; blocked: number; complete: number };
  blockers: Array<{ agent: string; blocker: string }>;
  decisions: Array<{ agent: string; decision: string }>;
  handoffs: HandoffEntry[];
  conflicts: Array<{ agents: string[]; description: string }>;
}

/**
 * Aggregate multiple standup reports into a team-level summary.
 * Sorts by timestamp, deduplicates, detects conflicts between agents.
 */
export function aggregateStandups(standups: StandupReport[]): TeamStandup {
  // Sort by timestamp (most recent last)
  const sorted = [...standups].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Summary counts
  const summary = { working: 0, blocked: 0, complete: 0 };
  for (const s of sorted) {
    summary[s.status]++;
  }

  // Overall status: blocked wins > working > complete
  let status: TeamStandup['status'] = 'complete';
  if (summary.working > 0) status = 'working';
  if (summary.blocked > 0) status = 'blocked';

  // Collect blockers with agent attribution
  const blockers: Array<{ agent: string; blocker: string }> = [];
  for (const s of sorted) {
    const agent = s.agent_role ?? s.sessionId;
    for (const b of s.blockers) {
      blockers.push({ agent, blocker: b });
    }
  }

  // Collect decisions with agent attribution
  const decisions: Array<{ agent: string; decision: string }> = [];
  for (const s of sorted) {
    const agent = s.agent_role ?? s.sessionId;
    for (const d of s.decisions) {
      decisions.push({ agent, decision: d });
    }
  }

  // Deduplicate handoffs by target + description
  const handoffKeys = new Set<string>();
  const handoffs: HandoffEntry[] = [];
  for (const s of sorted) {
    for (const h of s.handoffs) {
      const key = `${h.target}::${h.description}`.toLowerCase();
      if (!handoffKeys.has(key)) {
        handoffKeys.add(key);
        handoffs.push(h);
      }
    }
  }

  // Detect conflicts: agents reporting different statuses on the same ticket
  const conflicts: Array<{ agents: string[]; description: string }> = [];
  const ticketStatuses = new Map<string, Array<{ agent: string; status: string }>>();

  for (const s of sorted) {
    if (s.ticketKey) {
      const agent = s.agent_role ?? s.sessionId;
      if (!ticketStatuses.has(s.ticketKey)) {
        ticketStatuses.set(s.ticketKey, []);
      }
      ticketStatuses.get(s.ticketKey)!.push({ agent, status: s.status });
    }
  }

  for (const [ticket, entries] of ticketStatuses) {
    const statuses = new Set(entries.map(e => e.status));
    if (statuses.size > 1) {
      const agents = entries.map(e => e.agent);
      const statusList = entries.map(e => `${e.agent}=${e.status}`).join(', ');
      conflicts.push({
        agents,
        description: `Ticket "${ticket}" has conflicting statuses: ${statusList}`,
      });
    }
  }

  return {
    timestamp: new Date().toISOString(),
    agents: sorted,
    status,
    summary,
    blockers,
    decisions,
    handoffs,
    conflicts,
  };
}

/**
 * Format a team standup as human-readable markdown.
 */
export function formatTeamStandup(standup: TeamStandup): string {
  const lines: string[] = [];

  const statusIcon = standup.status === 'complete' ? '[DONE]'
    : standup.status === 'blocked' ? '[BLOCKED]'
    : '[ACTIVE]';

  lines.push(`# Team Standup ${statusIcon}`);
  lines.push('');
  lines.push(`**Agents:** ${standup.agents.length} | Working: ${standup.summary.working} | Blocked: ${standup.summary.blocked} | Complete: ${standup.summary.complete}`);
  lines.push('');

  // Conflicts (show first — most important)
  if (standup.conflicts.length > 0) {
    lines.push('## Conflicts');
    for (const c of standup.conflicts) {
      lines.push(`- ${c.description}`);
    }
    lines.push('');
  }

  // Blockers
  if (standup.blockers.length > 0) {
    lines.push('## Blockers');
    for (const b of standup.blockers) {
      lines.push(`- **${b.agent}**: ${b.blocker}`);
    }
    lines.push('');
  }

  // Decisions
  if (standup.decisions.length > 0) {
    lines.push('## Decisions');
    for (const d of standup.decisions) {
      lines.push(`- **${d.agent}**: ${d.decision}`);
    }
    lines.push('');
  }

  // Handoffs
  if (standup.handoffs.length > 0) {
    lines.push('## Handoffs');
    for (const h of standup.handoffs) {
      const forRole = h.for_role ? ` (for: ${h.for_role})` : '';
      lines.push(`- **${h.target}**: ${h.description}${forRole}`);
    }
    lines.push('');
  }

  // Per-agent summaries
  lines.push('## Agent Reports');
  for (const agent of standup.agents) {
    const role = agent.agent_role ?? agent.sessionId;
    const icon = agent.status === 'complete' ? '[DONE]'
      : agent.status === 'blocked' ? '[BLOCKED]'
      : '[ACTIVE]';
    lines.push(`- **${role}** ${icon}: ${agent.progress}`);
  }
  lines.push('');

  return lines.join('\n');
}
