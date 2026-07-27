import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  discoverScorecardFiles,
  extractSprintReferences,
  formatSprintLabel,
  formatSprintNumber,
  latestSprintIdKey,
  loadScorecards,
  nextCanonicalSprintId,
  parseSprintNumber,
  sprintNumberFromScorecardFile,
  roadmapSprintKey,
  sprintIdsEqual,
  type RoadmapSprint,
  type SlopeConfig,
} from '../core/index.js';
import { loadRoadmapForInference, maxSprintByOrder } from './sprint-inference.js';
import { isSprintPhase, type SprintPhase } from './sprint-state.js';

export const RESUME_POINTER_SCHEMA = 'slope.sprint_resume_pointer.v1';
export const DEFAULT_RESUME_POINTER_PATH = 'docs/backlog/.sprint-active.json';

const LOCAL_ONLY_EXCLUDED = ['slope.db', 'session locks', 'guard metrics', 'baselines'];
const UNSAFE_TO_AUTO_RESUME_IF = [
  'branch differs from source_branch without explicit --force',
  'source_commit is not ancestor of HEAD',
  'roadmap/retro evidence is missing',
  'phase in pointer conflicts with roadmap state',
];

export interface SprintResumeClaimPointer {
  id: string;
  state: 'in_progress' | 'done' | 'unknown';
  scope?: 'ticket' | 'area';
  last_evidence?: string;
}

export interface SprintResumePointer {
  schema: typeof RESUME_POINTER_SCHEMA;
  sprint: number;
  phase: SprintPhase;
  source_branch?: string;
  source_commit?: string;
  generated_at: string;
  evidence: Record<string, string>;
  resume_claims: SprintResumeClaimPointer[];
  local_only_excluded: string[];
  unsafe_to_auto_resume_if: string[];
}

export interface PortableResumePlan {
  sprint: number;
  phase: SprintPhase;
  source: 'pointer' | 'explicit' | 'branch' | 'git' | 'roadmap' | 'scorecards';
  pointerPath?: string;
  pointer?: SprintResumePointer;
  evidence: Record<string, string>;
  resumeClaims: SprintResumeClaimPointer[];
  unsafe: string[];
  currentBranch?: string;
  headCommit?: string;
}

export interface PortableResumeOptions {
  sprint?: number;
  phase?: SprintPhase;
  from?: string;
  force?: boolean;
}

export function defaultResumePointerPath(cwd: string): string {
  return join(cwd, DEFAULT_RESUME_POINTER_PATH);
}

function resolveInputPath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : join(cwd, path);
}

export function currentGitBranch(cwd: string): string | null {
  try {
    return execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8', timeout: 3000 }).trim() || null;
  } catch {
    return null;
  }
}

export function currentGitCommit(cwd: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', timeout: 3000 }).trim() || null;
  } catch {
    return null;
  }
}

export function isCommitAncestor(cwd: string, maybeAncestor: string): boolean {
  if (!/^[0-9a-fA-F]{4,64}$/.test(maybeAncestor)) return false;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', maybeAncestor, 'HEAD'], { cwd, stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export function sprintFromBranchName(branch: string | null): number | null {
  if (!branch) return null;
  const match = branch.match(/(?:^|[\/_-])S?(\d+(?:\.\d+)?)(?=$|[\/_-])/i);
  return match ? parseSprintNumber(match[1]) : null;
}

export function sprintFromRecentGitHistory(cwd: string): number | null {
  try {
    const subjects = execFileSync('git', ['log', '--format=%s', '-n', '30'], { cwd, encoding: 'utf8', timeout: 3000 })
      .split('\n')
      .filter(Boolean);
    const refs = [...extractSprintReferences(subjects)];
    return refs.length > 0 ? refs[0] : null;
  } catch {
    return null;
  }
}

export function loadSprintResumePointer(cwd: string, pointerPath = defaultResumePointerPath(cwd)): SprintResumePointer | null {
  if (!existsSync(pointerPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(pointerPath, 'utf8')) as Partial<SprintResumePointer>;
    if (raw.schema !== RESUME_POINTER_SCHEMA) return null;
    if (typeof raw.sprint !== 'number' || !raw.phase || !isSprintPhase(raw.phase)) return null;
    return {
      schema: RESUME_POINTER_SCHEMA,
      sprint: raw.sprint,
      phase: raw.phase,
      source_branch: typeof raw.source_branch === 'string' ? raw.source_branch : undefined,
      source_commit: typeof raw.source_commit === 'string' ? raw.source_commit : undefined,
      generated_at: typeof raw.generated_at === 'string' ? raw.generated_at : new Date().toISOString(),
      evidence: raw.evidence && typeof raw.evidence === 'object' ? raw.evidence as Record<string, string> : {},
      resume_claims: Array.isArray(raw.resume_claims)
        ? raw.resume_claims.filter(isResumeClaimPointer).map(normalizeResumeClaimPointer)
        : [],
      local_only_excluded: Array.isArray(raw.local_only_excluded) ? raw.local_only_excluded.filter(isString) : LOCAL_ONLY_EXCLUDED,
      unsafe_to_auto_resume_if: Array.isArray(raw.unsafe_to_auto_resume_if) ? raw.unsafe_to_auto_resume_if.filter(isString) : UNSAFE_TO_AUTO_RESUME_IF,
    };
  } catch {
    return null;
  }
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isResumeClaimPointer(value: unknown): value is SprintResumeClaimPointer {
  const claim = value as Partial<SprintResumeClaimPointer>;
  return Boolean(claim && typeof claim.id === 'string' && (!claim.state || ['in_progress', 'done', 'unknown'].includes(claim.state)));
}

function normalizeResumeClaimPointer(claim: SprintResumeClaimPointer): SprintResumeClaimPointer {
  return {
    id: claim.id,
    state: claim.state ?? 'unknown',
    scope: claim.scope === 'area' ? 'area' : 'ticket',
    last_evidence: claim.last_evidence,
  };
}

export function buildSprintResumePointer(
  cwd: string,
  config: SlopeConfig,
  input: { sprint: number; phase: SprintPhase; resumeClaims?: SprintResumeClaimPointer[] },
): SprintResumePointer {
  return {
    schema: RESUME_POINTER_SCHEMA,
    sprint: input.sprint,
    phase: input.phase,
    source_branch: currentGitBranch(cwd) ?? undefined,
    source_commit: currentGitCommit(cwd) ?? undefined,
    generated_at: new Date().toISOString(),
    evidence: collectResumeEvidence(cwd, config, input.sprint),
    resume_claims: input.resumeClaims ?? [],
    local_only_excluded: LOCAL_ONLY_EXCLUDED,
    unsafe_to_auto_resume_if: UNSAFE_TO_AUTO_RESUME_IF,
  };
}

export function writeSprintResumePointer(cwd: string, pointer: SprintResumePointer, outputPath = defaultResumePointerPath(cwd)): string {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(pointer, null, 2) + '\n', 'utf8');
  return relative(cwd, outputPath).replace(/\\/g, '/');
}

export function planPortableSprintResume(
  cwd: string,
  config: SlopeConfig,
  options: PortableResumeOptions = {},
): PortableResumePlan {
  const pointerPath = options.from ? resolveInputPath(cwd, options.from) : defaultResumePointerPath(cwd);
  const pointer = loadSprintResumePointer(cwd, pointerPath);
  const currentBranch = currentGitBranch(cwd) ?? undefined;
  const headCommit = currentGitCommit(cwd) ?? undefined;

  const inferred = inferPortableSprint(cwd, config, options, pointer);
  const phase = options.phase ?? pointer?.phase ?? 'implementing';
  const evidence = pointer?.evidence ?? collectResumeEvidence(cwd, config, inferred.sprint);
  const unsafe = pointer ? validatePointerForResume(cwd, config, pointer, currentBranch) : [];

  return {
    sprint: inferred.sprint,
    phase,
    source: inferred.source,
    pointerPath: pointer ? pointerPath : undefined,
    pointer: pointer ?? undefined,
    evidence,
    resumeClaims: pointer?.resume_claims ?? [],
    unsafe,
    currentBranch,
    headCommit,
  };
}

function inferPortableSprint(
  cwd: string,
  config: SlopeConfig,
  options: PortableResumeOptions,
  pointer: SprintResumePointer | null,
): { sprint: number; source: PortableResumePlan['source'] } {
  if (options.sprint) return { sprint: options.sprint, source: 'explicit' };
  if (pointer) return { sprint: pointer.sprint, source: 'pointer' };

  const branchSprint = sprintFromBranchName(currentGitBranch(cwd));
  if (branchSprint) return { sprint: branchSprint, source: 'branch' };

  const gitSprint = sprintFromRecentGitHistory(cwd);
  if (gitSprint) return { sprint: gitSprint, source: 'git' };

  const roadmap = loadRoadmapForInference(cwd, config);
  const completed = new Set(loadScorecards(config, cwd).map(card => card.sprint_number));
  const roadmapSprint = roadmap?.sprints
    .filter(sprint => !completed.has(roadmapSprintKey(roadmap, sprint)))
    .find(sprint => (sprint as RoadmapSprint & { status?: string }).status !== 'complete' && (sprint as RoadmapSprint & { status?: string }).status !== 'superseded');
  if (roadmapSprint) return { sprint: roadmapSprint.id, source: 'roadmap' };

  const latest = latestSprintIdKey([...completed]);
  return { sprint: latest !== '0' ? nextCanonicalSprintId(latest) : 1, source: 'scorecards' };
}

function validatePointerForResume(cwd: string, config: SlopeConfig, pointer: SprintResumePointer, currentBranch?: string): string[] {
  const unsafe: string[] = [];
  if (pointer.source_branch && currentBranch && pointer.source_branch !== currentBranch) {
    unsafe.push(`branch differs from pointer source_branch (${currentBranch} != ${pointer.source_branch})`);
  }
  if (pointer.source_commit && !isCommitAncestor(cwd, pointer.source_commit)) {
    unsafe.push(`source_commit ${pointer.source_commit.slice(0, 12)} is not an ancestor of HEAD`);
  }

  for (const [label, evidencePath] of Object.entries(pointer.evidence ?? {})) {
    const pathOnly = evidencePath.split('#')[0];
    if (pathOnly && !existsSync(join(cwd, pathOnly))) {
      unsafe.push(`evidence ${label} is missing (${pathOnly})`);
    }
  }

  const roadmap = loadRoadmapForInference(cwd, config);
  const sprint = roadmap?.sprints.find(s => s.id === pointer.sprint) as (RoadmapSprint & { status?: string }) | undefined;
  if (sprint?.status === 'complete' && pointer.phase !== 'complete') {
    unsafe.push(`pointer phase ${pointer.phase} conflicts with completed roadmap sprint ${formatSprintLabel(pointer.sprint)}`);
  }

  return unsafe;
}

function collectResumeEvidence(cwd: string, config: SlopeConfig, sprint: number): Record<string, string> {
  const evidence: Record<string, string> = {};
  if (existsSync(join(cwd, config.roadmapPath))) {
    evidence.roadmap = `${config.roadmapPath}#${formatSprintLabel(sprint)}`;
  }
  const retro = findScorecardForSprint(cwd, config, sprint);
  if (retro) {
    evidence.latest_retro = retro;
  }
  return evidence;
}

function findScorecardForSprint(cwd: string, config: SlopeConfig, sprint: number): string | null {
  for (const file of discoverScorecardFiles(config, cwd)) {
    const scorecardSprint = sprintNumberFromScorecardFile(file, config);
    if (scorecardSprint !== null && sprintIdsEqual(scorecardSprint, sprint)) {
      return relative(cwd, file).replace(/\\/g, '/');
    }
  }
  const fallback = join(cwd, config.scorecardDir, `sprint-${formatSprintNumber(sprint)}.json`);
  return existsSync(fallback) ? relative(cwd, fallback).replace(/\\/g, '/') : null;
}
