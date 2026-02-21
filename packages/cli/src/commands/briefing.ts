import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatBriefing } from '@slope-dev/core';
import type { CommonIssuesFile, SessionEntry, SprintClaim } from '@slope-dev/core';
import { loadConfig } from '../config.js';
import { loadScorecards } from '../loader.js';
import { createRegistry } from '../registries/index.js';

export async function briefingCommand(args: string[]): Promise<void> {
  const config = loadConfig();
  const cwd = process.cwd();
  const scorecards = loadScorecards(config, cwd);

  // Load common-issues
  let commonIssues: CommonIssuesFile;
  try {
    commonIssues = JSON.parse(readFileSync(join(cwd, config.commonIssuesPath), 'utf8'));
  } catch {
    commonIssues = { recurring_patterns: [] };
  }

  // Load last session
  let lastSession: SessionEntry | undefined;
  try {
    const sessionsData = JSON.parse(readFileSync(join(cwd, config.sessionsPath), 'utf8'));
    const sessions = sessionsData.sessions;
    if (sessions && sessions.length > 0) {
      lastSession = sessions[sessions.length - 1];
    }
  } catch { /* skip */ }

  // Parse args
  const categories: string[] = [];
  const keywords: string[] = [];
  let includeTraining = true;
  let sprintFlag: number | undefined;
  for (const arg of args) {
    if (arg.startsWith('--categories=')) {
      categories.push(...arg.slice('--categories='.length).split(',').map(s => s.trim()).filter(Boolean));
    } else if (arg.startsWith('--keywords=')) {
      keywords.push(...arg.slice('--keywords='.length).split(',').map(s => s.trim()).filter(Boolean));
    } else if (arg.startsWith('--sprint=')) {
      sprintFlag = parseInt(arg.slice('--sprint='.length), 10);
    } else if (arg === '--no-training') {
      includeTraining = false;
    }
  }

  // Resolve sprint number
  let sprintNumber: number;
  if (sprintFlag) {
    sprintNumber = sprintFlag;
  } else if (config.currentSprint) {
    sprintNumber = config.currentSprint;
  } else if (scorecards.length > 0) {
    const maxSprint = Math.max(...scorecards.map(s => s.sprint_number));
    sprintNumber = maxSprint + 1;
  } else {
    sprintNumber = 1;
  }

  // Load claims
  let claims: SprintClaim[] = [];
  try {
    const registry = createRegistry(config, cwd);
    claims = await registry.list(sprintNumber);
  } catch { /* skip — claims are optional */ }

  const filter = (categories.length > 0 || keywords.length > 0)
    ? { categories: categories.length > 0 ? categories : undefined, keywords: keywords.length > 0 ? keywords : undefined }
    : undefined;

  const output = formatBriefing({ scorecards, commonIssues, lastSession, filter, includeTraining, claims });
  console.log('');
  console.log(output);
}
