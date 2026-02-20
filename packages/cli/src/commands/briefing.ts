import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatBriefing } from '@slope-dev/core';
import type { CommonIssuesFile, SessionEntry } from '@slope-dev/core';
import { loadConfig } from '../config.js';
import { loadScorecards } from '../loader.js';

export function briefingCommand(args: string[]): void {
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
  for (const arg of args) {
    if (arg.startsWith('--categories=')) {
      categories.push(...arg.slice('--categories='.length).split(',').map(s => s.trim()).filter(Boolean));
    } else if (arg.startsWith('--keywords=')) {
      keywords.push(...arg.slice('--keywords='.length).split(',').map(s => s.trim()).filter(Boolean));
    } else if (arg === '--no-training') {
      includeTraining = false;
    }
  }

  const filter = (categories.length > 0 || keywords.length > 0)
    ? { categories: categories.length > 0 ? categories : undefined, keywords: keywords.length > 0 ? keywords : undefined }
    : undefined;

  const output = formatBriefing({ scorecards, commonIssues, lastSession, filter, includeTraining });
  console.log('');
  console.log(output);
}
