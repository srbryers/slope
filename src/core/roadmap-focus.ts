import type { RoadmapTicket } from './roadmap.js';

export type RoadmapFocusRelation = 'dependency' | 'previous' | 'successor';

export interface RoadmapFocusSprintSummary {
  id: number;
  label: string;
  theme: string;
  par: number;
  slope: number;
  type: string;
  status: string;
  note?: string;
}

export interface RoadmapFocusSprint extends RoadmapFocusSprintSummary {
  tickets: RoadmapTicket[];
}

export interface RoadmapFocusPhase {
  name: string;
  status?: string;
  note?: string;
  sprint_index: number;
  sprint_count: number;
}

export interface RoadmapFocusNeighbor {
  relation: RoadmapFocusRelation;
  direct: boolean;
  sprint: RoadmapFocusSprintSummary;
}

export interface RoadmapFocusHazard {
  sprint: number;
  sprint_label: string;
  ticket?: string;
  type: string;
  severity?: string;
  description: string;
}

export interface RoadmapFocusEvidence {
  kind: 'roadmap' | 'scorecard' | 'review' | 'issue' | 'design' | 'other';
  label: string;
  ref: string;
  sprint?: number;
}

export interface RoadmapFocusResult {
  roadmap: {
    name: string;
    description?: string;
  };
  sprint: RoadmapFocusSprint;
  phase: RoadmapFocusPhase | null;
  dependencies: RoadmapFocusNeighbor[];
  previous: RoadmapFocusNeighbor[];
  successors: RoadmapFocusNeighbor[];
  hazards: RoadmapFocusHazard[];
  evidence: RoadmapFocusEvidence[];
  bounds: {
    previous_limit: number;
    successor_limit: number;
    hazard_limit: number;
  };
}

export interface RoadmapFocusOptions {
  previousLimit?: number;
  successorLimit?: number;
  hazardLimit?: number;
  completedSprintIds?: Iterable<number>;
  scorecards?: Array<{
    sprint_number: number;
    shots?: Array<{
      ticket_key?: string;
      hazards?: Array<{ type?: string; severity?: string; description?: string }>;
    }>;
    bunker_locations?: Array<string | { area?: string }>;
  }>;
  evidence?: RoadmapFocusEvidence[];
}
