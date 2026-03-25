/**
 * Org-level multi-repo aggregation.
 * Loads scorecards and common issues from multiple repos,
 * computes org-level handicap, and promotes shared patterns.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadScorecards } from './loader.js';
import { loadConfig } from './config.js';
import { computeHandicapCard } from './handicap.js';
import type { GolfScorecard, HandicapCard } from './types.js';
import type { CommonIssuesFile, RecurringPattern } from './briefing.js';

// ── Types ───────────────────────────────────────────

export interface OrgRepo {
  name: string;
  path: string;
}

export interface OrgConfig {
  repos: OrgRepo[];
}

export interface OrgScorecard extends GolfScorecard {
  _repo: string;
}

export interface RepoHandicap {
  repo: string;
  path: string;
  handicap: HandicapCard;
  sprint_count: number;
  latest_sprint?: number;
}

export interface OrgHandicap {
  overall: HandicapCard;
  per_repo: RepoHandicap[];
  total_sprints: number;
}

export interface OrgIssue extends RecurringPattern {
  repos: string[];
}

// ── Config ──────────────────────────────────────────

const ORG_CONFIG_FILE = '.slope/org.json';

export function loadOrgConfig(cwd: string): OrgConfig {
  const configPath = join(cwd, ORG_CONFIG_FILE);
  if (!existsSync(configPath)) {
    throw new Error(`Org config not found: ${configPath}. Run: slope org init`);
  }
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

export function createOrgConfig(cwd: string, repos: OrgRepo[]): void {
  const configPath = join(cwd, ORG_CONFIG_FILE);
  mkdirSync(join(cwd, '.slope'), { recursive: true });
  writeFileSync(configPath, JSON.stringify({ repos } satisfies OrgConfig, null, 2) + '\n');
}

// ── Scorecard Collection ────────────────────────────

export function loadOrgScorecards(orgConfig: OrgConfig): OrgScorecard[] {
  const all: OrgScorecard[] = [];

  for (const repo of orgConfig.repos) {
    if (!existsSync(repo.path)) continue;
    try {
      const config = loadConfig(repo.path);
      const cards = loadScorecards(config, repo.path);
      for (const card of cards) {
        all.push({ ...card, _repo: repo.name });
      }
    } catch { /* skip repos with missing/invalid config */ }
  }

  return all;
}

// ── Org Handicap ────────────────────────────────────

export function computeOrgHandicap(orgConfig: OrgConfig): OrgHandicap {
  const allCards: OrgScorecard[] = [];
  const perRepo: RepoHandicap[] = [];

  for (const repo of orgConfig.repos) {
    if (!existsSync(repo.path)) continue;
    try {
      const config = loadConfig(repo.path);
      const cards = loadScorecards(config, repo.path);
      const tagged = cards.map(c => ({ ...c, _repo: repo.name }));
      allCards.push(...tagged);

      if (cards.length > 0) {
        const sorted = [...cards].sort((a, b) => a.sprint_number - b.sprint_number);
        perRepo.push({
          repo: repo.name,
          path: repo.path,
          handicap: computeHandicapCard(cards),
          sprint_count: cards.length,
          latest_sprint: sorted[sorted.length - 1].sprint_number,
        });
      }
    } catch { /* skip */ }
  }

  return {
    overall: allCards.length > 0 ? computeHandicapCard(allCards) : computeHandicapCard([]),
    per_repo: perRepo,
    total_sprints: allCards.length,
  };
}

// ── Cross-Repo Common Issues ────────────────────────

export function mergeCommonIssues(orgConfig: OrgConfig): OrgIssue[] {
  // Collect all patterns with repo source
  const patternMap = new Map<string, { pattern: RecurringPattern; repos: Set<string> }>();

  for (const repo of orgConfig.repos) {
    const issuesPath = join(repo.path, '.slope/common-issues.json');
    if (!existsSync(issuesPath)) continue;

    try {
      const issues: CommonIssuesFile = JSON.parse(readFileSync(issuesPath, 'utf8'));
      for (const pattern of issues.recurring_patterns ?? []) {
        // Key by normalized title + category
        const key = `${pattern.category}:${pattern.title.toLowerCase().trim()}`;
        const existing = patternMap.get(key);
        if (existing) {
          existing.repos.add(repo.name);
        } else {
          patternMap.set(key, { pattern, repos: new Set([repo.name]) });
        }
      }
    } catch { /* skip */ }
  }

  // Promote patterns that appear in 2+ repos
  return Array.from(patternMap.values())
    .filter(entry => entry.repos.size >= 2)
    .map(entry => ({
      ...entry.pattern,
      repos: [...entry.repos],
    }));
}
