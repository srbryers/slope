import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  castRoadmapStructure,
  findShippedSprintsOnMain,
  formatSprintLabel,
  loadScorecards,
  parseRoadmap,
  roadmapSprintKeyFromId,
  sprintIdKey,
  validateRoadmap,
} from '../core/index.js';
import type {
  RoadmapDefinition,
  RoadmapValidationError,
  RoadmapValidationResult,
  RoadmapValidationWarning,
  SprintId,
} from '../core/index.js';
import { loadConfig } from './config.js';

export interface RoadmapReality {
  roadmap?: RoadmapDefinition;
  validation?: RoadmapValidationResult;
}

export interface WorktreeReality {
  path: string;
  branch: string;
  head: string;
  ahead: number;
  behind: number;
  dirtyFiles: string[];
  changedFiles: string[];
  migrationFiles: string[];
}

export interface WorktreeOverlap {
  path: string;
  branch: string;
  files: string[];
}

type RoadmapIssue = RoadmapValidationError | RoadmapValidationWarning;

interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
}

export function buildRoadmapReality(cwd: string, roadmap: RoadmapDefinition): RoadmapReality {
  const config = loadConfig(cwd);
  const scorecards = loadScorecards(config, cwd).map(s => ({ sprint_number: s.sprint_number }));
  const shippedSprintIds = findShippedSprintsOnMain(cwd);
  return {
    roadmap,
    validation: validateRoadmap(roadmap, scorecards, shippedSprintIds),
  };
}

export function loadRoadmapReality(cwd: string): RoadmapReality {
  const config = loadConfig(cwd);
  const path = join(cwd, config.roadmapPath);
  if (!existsSync(path)) return {};

  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const parsed = parseRoadmap(raw);
    const roadmap = parsed.roadmap ?? castRoadmapStructure(raw) ?? undefined;
    return roadmap ? buildRoadmapReality(cwd, roadmap) : {};
  } catch {
    return {};
  }
}

export function roadmapRealityIssues(reality: RoadmapReality, sprint?: SprintId): RoadmapIssue[] {
  const validation = reality.validation;
  if (!validation) return [];
  const selectedKey = sprint == null ? null : roadmapRealitySprintKey(reality, sprint);

  return [...validation.errors, ...validation.warnings]
    .filter(isRealityIssue)
    .filter(issue => selectedKey == null || (
      issue.sprint != null
      && roadmapRealitySprintKey(reality, issue.sprint) === selectedKey
    ));
}

export function blockingRoadmapIssuesForSprint(reality: RoadmapReality, sprint: SprintId): RoadmapIssue[] {
  return roadmapRealityIssues(reality, sprint)
    .filter(issue => /has shipped commits on main|has a scorecard/.test(issue.message));
}

export function formatRoadmapRealitySection(reality: RoadmapReality, sprint?: SprintId, limit = 8): string[] {
  const issues = roadmapRealityIssues(reality, sprint);
  if (issues.length === 0) return [];

  const shown = issues.slice(0, limit);
  const lines = ['ROADMAP REALITY CHECKS'];
  for (const issue of shown) {
    const level = issue.type === 'error' ? 'error' : 'warn';
    const loc = issue.sprint ? `[${formatSprintLabel(issue.sprint)}] ` : '';
    lines.push(`  [${level}] ${loc}${issue.message}`);
  }
  if (issues.length > shown.length) {
    lines.push(`  ... ${issues.length - shown.length} more roadmap reality issue(s)`);
  }
  return lines;
}

function roadmapRealitySprintKey(reality: RoadmapReality, sprint: SprintId): string | null {
  return reality.roadmap
    ? roadmapSprintKeyFromId(reality.roadmap, sprint)
    : sprintIdKey(sprint);
}

export function collectSiblingWorktreeReality(cwd: string, baseRef?: string): WorktreeReality[] {
  const worktrees = listWorktrees(cwd);
  if (worktrees.length <= 1) return [];

  const currentPath = currentWorktreePath(cwd);
  const base = baseRef ?? resolveBaseRef(cwd);
  return worktrees
    .filter(wt => resolve(wt.path) !== currentPath)
    .map(wt => buildWorktreeReality(wt, base));
}

export function parseTouchedPaths(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map(p => normalizeRepoPath(p))
    .filter(Boolean);
}

export function findWorktreeOverlaps(worktrees: WorktreeReality[], touchedPaths: string[]): WorktreeOverlap[] {
  if (touchedPaths.length === 0) return [];

  const overlaps: WorktreeOverlap[] = [];
  for (const wt of worktrees) {
    const candidateFiles = unique([...wt.dirtyFiles, ...wt.changedFiles, ...wt.migrationFiles]);
    const files = candidateFiles.filter(file =>
      touchedPaths.some(touched => pathsOverlap(file, touched)),
    );
    if (files.length > 0) {
      overlaps.push({ path: wt.path, branch: wt.branch, files });
    }
  }
  return overlaps;
}

export function formatWorktreeRealitySection(worktrees: WorktreeReality[], touchedPaths: string[] = []): string[] {
  if (worktrees.length === 0) return [];

  const lines = ['WORKTREE CONFLICT SURFACE'];
  for (const wt of worktrees) {
    const branch = wt.branch || '(detached)';
    lines.push(`  ${branch} at ${wt.path} (ahead ${wt.ahead}, behind ${wt.behind})`);
    if (wt.dirtyFiles.length > 0) {
      lines.push(`    dirty: ${formatFileList(wt.dirtyFiles)}`);
    }
    if (wt.changedFiles.length > 0) {
      lines.push(`    ahead files: ${formatFileList(wt.changedFiles)}`);
    }
    if (wt.migrationFiles.length > 0) {
      lines.push(`    migrations: ${formatFileList(wt.migrationFiles)}`);
    }
    if (wt.dirtyFiles.length === 0 && wt.changedFiles.length === 0) {
      lines.push('    no dirty or ahead files detected');
    }
  }

  const overlaps = findWorktreeOverlaps(worktrees, touchedPaths);
  if (overlaps.length > 0) {
    lines.push('');
    lines.push('  Potential overlap with requested touched paths:');
    for (const overlap of overlaps) {
      lines.push(`    [!!] ${overlap.branch || '(detached)'}: ${formatFileList(overlap.files, 8)}`);
    }
  } else if (touchedPaths.length === 0) {
    lines.push('');
    lines.push('  Tip: pass --touches=path/to/file,path/to/dir to block on direct overlap during sprint start.');
  }

  return lines;
}

function isRealityIssue(issue: RoadmapIssue): boolean {
  return /scorecard|shipped commits|phantom sprint/i.test(issue.message);
}

function listWorktrees(cwd: string): WorktreeInfo[] {
  const output = git(cwd, ['worktree', 'list', '--porcelain']);
  if (!output) return [];

  const worktrees: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) worktrees.push(normalizeWorktree(current));
      current = { path: line.slice('worktree '.length) };
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace('refs/heads/', '');
    } else if (line === '') {
      if (current.path) worktrees.push(normalizeWorktree(current));
      current = {};
    }
  }
  if (current.path) worktrees.push(normalizeWorktree(current));
  return worktrees;
}

function normalizeWorktree(wt: Partial<WorktreeInfo>): WorktreeInfo {
  return {
    path: wt.path ?? '',
    branch: wt.branch ?? '',
    head: wt.head ?? '',
  };
}

function buildWorktreeReality(wt: WorktreeInfo, baseRef: string): WorktreeReality {
  const statusFiles = parseStatus(git(wt.path, ['status', '--porcelain=v1', '--untracked-files=all']));
  const changedFiles = splitLines(git(wt.path, ['diff', '--name-only', `${baseRef}...HEAD`]))
    .map(normalizeRepoPath)
    .filter(isRelevantPath);
  const counts = parseAheadBehind(git(wt.path, ['rev-list', '--left-right', '--count', `${baseRef}...HEAD`]));
  const migrationFiles = unique([...statusFiles, ...changedFiles].filter(isMigrationPath));

  return {
    path: wt.path,
    branch: wt.branch,
    head: wt.head,
    ahead: counts.ahead,
    behind: counts.behind,
    dirtyFiles: statusFiles,
    changedFiles,
    migrationFiles,
  };
}

function currentWorktreePath(cwd: string): string {
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  return resolve(top || cwd);
}

function resolveBaseRef(cwd: string): string {
  for (const ref of ['origin/main', 'main', 'master', 'HEAD']) {
    if (git(cwd, ['rev-parse', '--verify', ref])) return ref;
  }
  return 'HEAD';
}

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10000,
    }).trimEnd();
  } catch {
    return '';
  }
}

function parseStatus(output: string): string[] {
  return output.split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean)
    .map(line => normalizeStatusPath(line.slice(3)))
    .map(normalizeRepoPath)
    .filter(isRelevantPath);
}

function parseAheadBehind(output: string): { ahead: number; behind: number } {
  const [left, right] = output.trim().split(/\s+/).map(v => parseInt(v, 10));
  return {
    behind: Number.isFinite(left) ? left : 0,
    ahead: Number.isFinite(right) ? right : 0,
  };
}

function normalizeStatusPath(path: string): string {
  const renameArrow = ' -> ';
  return path.includes(renameArrow) ? path.slice(path.indexOf(renameArrow) + renameArrow.length) : path;
}

function normalizeRepoPath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function pathsOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function isRelevantPath(path: string): boolean {
  if (!path) return false;
  return !/^(?:\.git|\.slope|\.codex|\.claude|node_modules|dist|coverage|\.DS_Store)(?:\/|$)/.test(path);
}

function isMigrationPath(path: string): boolean {
  return /(^|\/)(?:migrations?|drizzle)(\/|$)/i.test(path) || /\b\d{3,}[_-].*\.sql$/i.test(path);
}

function splitLines(output: string): string[] {
  return output.split('\n').map(line => line.trim()).filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function formatFileList(files: string[], limit = 6): string {
  const shown = files.slice(0, limit);
  const suffix = files.length > shown.length ? ` (+${files.length - shown.length} more)` : '';
  return shown.join(', ') + suffix;
}

export function relativeWorktreePath(cwd: string, path: string): string {
  const rel = relative(cwd, path);
  return rel && !rel.startsWith('..') ? rel : path;
}
