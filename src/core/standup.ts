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
