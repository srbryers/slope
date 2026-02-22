// SLOPE — Event-to-Common-Issues Pipeline
// Analyzes events across sprints to detect recurring patterns and
// promote them to common issues entries.

import type { SlopeEvent } from './types.js';
import type { RecurringPattern, CommonIssuesFile } from './briefing.js';

/** Minimum sprint appearances to trigger promotion */
const DEFAULT_PROMOTION_THRESHOLD = 2;

/** Category mapping from event type to common-issues category */
const EVENT_TYPE_TO_CATEGORY: Record<string, string> = {
  failure: 'build',
  dead_end: 'approach',
  scope_change: 'scope',
  hazard: 'general',
  compaction: 'context',
  decision: 'architecture',
};

/** An event cluster — events grouped by area and type */
export interface EventCluster {
  type: string;
  area: string;
  sprints: number[];
  events: SlopeEvent[];
  description: string;
}

/** A candidate for promotion to common issues */
export interface PromotionCandidate {
  cluster: EventCluster;
  reason: string;
  suggestedPattern: RecurringPattern;
}

/** Result of running the pipeline */
export interface PipelineResult {
  clusters: EventCluster[];
  candidates: PromotionCandidate[];
  promoted: number;
  skipped: number;
}

/**
 * Extract the area from an event — uses ticket_key prefix or data fields.
 */
function extractArea(event: SlopeEvent): string {
  // Use data.file or data.area if present
  if (event.data.file && typeof event.data.file === 'string') {
    // Extract directory: "packages/core/src/foo.ts" → "packages/core/src"
    const parts = (event.data.file as string).split('/');
    return parts.length > 1 ? parts.slice(0, -1).join('/') : event.data.file as string;
  }
  if (event.data.area && typeof event.data.area === 'string') {
    return event.data.area as string;
  }
  // Fall back to ticket prefix: "S10-1" → "S10"
  if (event.ticket_key) {
    const match = event.ticket_key.match(/^([A-Za-z]+\d+)/);
    return match ? match[1] : event.ticket_key;
  }
  return 'general';
}

/**
 * Cluster events by type + area, tracking which sprints they appear in.
 */
export function clusterEvents(events: SlopeEvent[]): EventCluster[] {
  const clusterMap = new Map<string, EventCluster>();

  for (const event of events) {
    const area = extractArea(event);
    const key = `${event.type}:${area}`;

    if (!clusterMap.has(key)) {
      clusterMap.set(key, {
        type: event.type,
        area,
        sprints: [],
        events: [],
        description: '',
      });
    }

    const cluster = clusterMap.get(key)!;
    cluster.events.push(event);

    if (event.sprint_number !== undefined && !cluster.sprints.includes(event.sprint_number)) {
      cluster.sprints.push(event.sprint_number);
    }
  }

  // Build descriptions from event data
  for (const cluster of clusterMap.values()) {
    cluster.sprints.sort((a, b) => a - b);
    cluster.description = buildClusterDescription(cluster);
  }

  return [...clusterMap.values()];
}

function buildClusterDescription(cluster: EventCluster): string {
  const latestEvent = cluster.events[cluster.events.length - 1];
  const parts: string[] = [];

  if (latestEvent.data.error) parts.push(String(latestEvent.data.error));
  else if (latestEvent.data.description) parts.push(String(latestEvent.data.description));
  else if (latestEvent.data.desc) parts.push(String(latestEvent.data.desc));
  else if (latestEvent.data.reason) parts.push(String(latestEvent.data.reason));
  else if (latestEvent.data.approach) parts.push(`Dead end: ${latestEvent.data.approach}`);
  else if (latestEvent.data.choice) parts.push(`Decision: ${latestEvent.data.choice}`);

  if (parts.length === 0) {
    parts.push(`${cluster.type} in ${cluster.area}`);
  }

  parts.push(`(${cluster.events.length} occurrence(s) across sprint(s) ${cluster.sprints.join(', ')})`);
  return parts.join(' ');
}

/**
 * Find promotion candidates — clusters that appear in enough sprints.
 */
export function findPromotionCandidates(
  clusters: EventCluster[],
  threshold: number = DEFAULT_PROMOTION_THRESHOLD,
): PromotionCandidate[] {
  const candidates: PromotionCandidate[] = [];

  for (const cluster of clusters) {
    if (cluster.sprints.length >= threshold) {
      // Only promote miss-indicating event types
      if (cluster.type === 'decision' || cluster.type === 'compaction') continue;

      const nextId = Date.now() + candidates.length;
      candidates.push({
        cluster,
        reason: `${cluster.type} in ${cluster.area} appeared in ${cluster.sprints.length} sprint(s): ${cluster.sprints.join(', ')}`,
        suggestedPattern: {
          id: nextId,
          title: `[telemetry] ${cluster.type} in ${cluster.area}`,
          category: EVENT_TYPE_TO_CATEGORY[cluster.type] ?? 'general',
          sprints_hit: [...cluster.sprints],
          gotcha_refs: [],
          description: cluster.description,
          prevention: `Check ${cluster.area} area before starting — recurring ${cluster.type} pattern detected from telemetry.`,
          reported_by: [...new Set(cluster.events
            .map(e => (e.data.player as string) ?? (e.data.session_player as string))
            .filter(Boolean))],
        },
      });
    }
  }

  return candidates;
}

/**
 * Run the full pipeline: cluster events → find candidates → promote to common issues.
 * Respects existing manual entries — does not overwrite patterns without source: 'telemetry'.
 */
export function runPipeline(
  events: SlopeEvent[],
  existingIssues: CommonIssuesFile,
  options: { threshold?: number } = {},
): PipelineResult {
  const clusters = clusterEvents(events);
  const candidates = findPromotionCandidates(clusters, options.threshold);

  let promoted = 0;
  let skipped = 0;

  // Determine next ID from existing patterns
  const maxExistingId = existingIssues.recurring_patterns.reduce(
    (max, p) => Math.max(max, p.id), 0
  );
  let nextId = maxExistingId + 1;

  for (const candidate of candidates) {
    // Check if this pattern already exists (by title match)
    const existing = existingIssues.recurring_patterns.find(
      p => p.title === candidate.suggestedPattern.title,
    );

    if (existing) {
      // Update sprints_hit on existing telemetry pattern
      const newSprints = candidate.cluster.sprints.filter(
        s => !existing.sprints_hit.includes(s),
      );
      if (newSprints.length > 0) {
        existing.sprints_hit.push(...newSprints);
        existing.sprints_hit.sort((a, b) => a - b);
        existing.description = candidate.suggestedPattern.description;
        // Merge reported_by arrays (union, deduplicated)
        const candidateReporters = candidate.suggestedPattern.reported_by ?? [];
        const existingReporters = existing.reported_by ?? [];
        existing.reported_by = [...new Set([...existingReporters, ...candidateReporters])];
        promoted++;
      } else {
        skipped++;
      }
    } else {
      // Add new pattern with sequential ID
      candidate.suggestedPattern.id = nextId++;
      existingIssues.recurring_patterns.push(candidate.suggestedPattern);
      promoted++;
    }
  }

  return { clusters, candidates, promoted, skipped };
}
