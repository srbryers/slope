import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { issueCommand } from '../../../src/cli/commands/issue.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `slope-issue-command-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeCommonIssues(cwd: string): string {
  const slopeDir = join(cwd, '.slope');
  mkdirSync(slopeDir, { recursive: true });
  const path = join(slopeDir, 'common-issues.json');
  writeFileSync(path, JSON.stringify({
    recurring_patterns: [
      {
        title: 'Ticket result normalization',
        sprint: 342,
        command: 'slope review docs/retros/sprint-342.json',
        evidence: 'Ticket-style scorecard result: "short" was rendered as Green in slope review for S342-T5.',
      },
      {
        title: 'Missing review artifact',
        sprint: 341,
        command: 'slope review docs/retros/sprint-341.json',
        evidence: 'slope review docs/retros/sprint-341.json printed to stdout but docs/retros/sprint-341-review.md was missing.',
      },
      {
        title: 'Prompt generation counted as reviewed',
        sprint: 341,
        command: 'slope pr status --sprint=341',
        evidence: 'PR review: reviewed appeared after review prompt generation only; review rounds were not complete.',
      },
      {
        title: 'Warning flood',
        sprint: 362,
        command: 'slope briefing --sprint=362',
        evidence: 'SLOPE explore warning loop flooded output 650x, stale-map warnings persisted, and briefing hung on the hazard ledger.',
      },
      {
        title: 'Validate scope',
        sprint: 348,
        command: 'slope validate --sprint=348',
        evidence: 'slope validate --sprint=348 ran a historical project-wide pass and failed due older invalid scorecards.',
      },
      {
        title: 'Native ABI drift',
        sprint: 351,
        command: 'slope sprint status',
        evidence: 'slope sprint status failed because better-sqlite3 was compiled for a stale NODE_MODULE_VERSION native ABI.',
      },
    ],
  }, null, 2));
  return path;
}

async function captureLogs(fn: () => Promise<void>): Promise<string> {
  const logs: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((message = '') => {
    logs.push(String(message));
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return logs.join('\n');
}

describe('slope issue command', () => {
  let cwd: string;
  let originalCwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(cwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(cwd, { recursive: true, force: true });
  });

  it('prints dry-run candidates as JSON with evidence, labels, and dedupe status', async () => {
    writeCommonIssues(cwd);

    const output = await captureLogs(() =>
      issueCommand(['scout', '--source=.slope/common-issues.json', '--dry-run', '--json'])
    );
    const payload = JSON.parse(output);
    const titles = payload.candidates.map((candidate: { title: string }) => candidate.title);

    expect(payload.mode).toBe('dry-run');
    expect(payload.evidence_count).toBe(6);
    expect(payload.candidate_count).toBe(6);
    expect(titles).toContain('Ticket-style scorecards break review/recommend/amend normalization');
    expect(titles).toContain('validate --sprint should isolate the requested sprint result');
    expect(payload.candidates[0].labels.length).toBeGreaterThan(0);
    expect(payload.candidates[0].dedupe.status).toBe('new');
    expect(payload.candidates[0].body).toContain('## Acceptance Criteria');
  });

  it('writes a daily triage digest with an approval request section', async () => {
    writeCommonIssues(cwd);
    const digestPath = join(cwd, '.slope', 'digest.md');

    await captureLogs(() =>
      issueCommand(['triage', '--source=.slope/common-issues.json', '--daily-digest', '--output=.slope/digest.md'])
    );

    expect(existsSync(digestPath)).toBe(true);
    const digest = readFileSync(digestPath, 'utf8');
    expect(digest).toContain('## Request Approval To Fix');
    expect(digest).toContain('requested decision: approve fix, defer, or reject');
  });

  it('preserves canonical sprint ids in collected evidence', async () => {
    const sourcePath = writeCommonIssues(cwd);
    const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
    source.recurring_patterns.push({
      title: 'Canonical review artifact follow-up',
      sprint: 'S458.10',
      command: 'slope review --sprint=458.10',
      evidence: 'slope review for S458.10 left the canonical review markdown missing.',
    });
    writeFileSync(sourcePath, JSON.stringify(source, null, 2));

    const output = await captureLogs(() =>
      issueCommand(['scout', '--source=.slope/common-issues.json', '--dry-run', '--json'])
    );
    const payload = JSON.parse(output);
    const evidence = payload.candidates.flatMap((candidate: { evidence: Array<{ sprint?: string }> }) =>
      candidate.evidence
    );

    expect(evidence.some((item: { sprint?: string }) => item.sprint === '458.10')).toBe(true);
    expect(evidence.some((item: { sprint?: string }) => item.sprint === '458.1')).toBe(false);
  });

  it('writes scout JSON output without dumping the full payload to stdout', async () => {
    writeCommonIssues(cwd);
    const outputPath = join(cwd, '.slope', 'candidates.json');

    const stdout = await captureLogs(() =>
      issueCommand(['scout', '--source=.slope/common-issues.json', '--dry-run', '--output=.slope/candidates.json'])
    );

    expect(existsSync(outputPath)).toBe(true);
    const payload = JSON.parse(readFileSync(outputPath, 'utf8'));
    expect(payload.candidate_count).toBe(6);
    expect(stdout).toContain('SLOPE Issue Scout');
    expect(stdout).toContain('Candidate issues:');
    expect(stdout).not.toContain('"candidates"');
  });
});
