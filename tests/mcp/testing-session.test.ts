import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteSlopeStore } from '../../src/store/index.js';
import { buildSuggestions } from '../../src/cli/guards/next-action.js';

describe('Testing Session — Store', () => {
  let store: SqliteSlopeStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-test-'));
    store = new SqliteSlopeStore(join(tmpDir, 'slope.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a testing session', async () => {
    const session = await store.createTestingSession({ purpose: 'Test checkout flow' });
    expect(session.id).toMatch(/^tsess-/);
    expect(session.started_at).toBeTruthy();
  });

  it('creates a testing session with worktree info', async () => {
    const session = await store.createTestingSession({
      purpose: 'Test login',
      worktree_path: '/tmp/testing-123',
      branch_name: 'testing/123',
      sprint: 60,
    });
    expect(session.id).toMatch(/^tsess-/);

    const active = await store.getActiveTestingSession();
    expect(active).not.toBeNull();
    expect(active!.worktree_path).toBe('/tmp/testing-123');
    expect(active!.branch_name).toBe('testing/123');
    expect(active!.sprint).toBe(60);
    expect(active!.purpose).toBe('Test login');
  });

  it('returns null when no active session', async () => {
    const session = await store.getActiveTestingSession();
    expect(session).toBeNull();
  });

  it('adds and retrieves findings', async () => {
    const session = await store.createTestingSession({ purpose: 'test' });

    const f1 = await store.addTestingFinding({
      session_id: session.id,
      description: 'Button broken on mobile',
      severity: 'high',
    });
    expect(f1.id).toMatch(/^tfind-/);

    await store.addTestingFinding({
      session_id: session.id,
      description: 'Minor typo',
      severity: 'low',
      ticket: 'T1',
    });

    const findings = await store.getTestingFindings(session.id);
    expect(findings).toHaveLength(2);
    expect(findings[0].description).toBe('Button broken on mobile');
    expect(findings[0].severity).toBe('high');
    expect(findings[1].ticket).toBe('T1');
  });

  it('defaults severity to medium', async () => {
    const session = await store.createTestingSession({});
    await store.addTestingFinding({ session_id: session.id, description: 'test' });
    const findings = await store.getTestingFindings(session.id);
    expect(findings[0].severity).toBe('medium');
  });

  it('ends a testing session', async () => {
    const session = await store.createTestingSession({
      worktree_path: '/tmp/wt',
      branch_name: 'testing/1',
    });
    await store.addTestingFinding({ session_id: session.id, description: 'bug 1' });
    await store.addTestingFinding({ session_id: session.id, description: 'bug 2', severity: 'critical' });

    const result = await store.endTestingSession(session.id);
    expect(result.ended_at).toBeTruthy();
    expect(result.finding_count).toBe(2);
    expect(result.worktree_path).toBe('/tmp/wt');
    expect(result.branch_name).toBe('testing/1');

    // Session is no longer active
    const active = await store.getActiveTestingSession();
    expect(active).toBeNull();
  });

  it('throws when ending non-existent session', async () => {
    await expect(store.endTestingSession('nonexistent')).rejects.toThrow('not found');
  });

  it('only returns active session, not ended ones', async () => {
    const s1 = await store.createTestingSession({ purpose: 'first' });
    await store.endTestingSession(s1.id);

    const s2 = await store.createTestingSession({ purpose: 'second' });
    const active = await store.getActiveTestingSession();
    expect(active!.id).toBe(s2.id);
    expect(active!.purpose).toBe('second');
  });
});

describe('Testing Session — Config Interpolation', () => {
  it('interpolates {projectRoot} and {worktreeRoot} in setup steps', () => {
    const steps = [
      'cd {worktreeRoot} && pnpm install',
      'cp {projectRoot}/.env {worktreeRoot}/.env',
    ];
    const interpolated = steps.map(s =>
      s.replace(/\{projectRoot\}/g, '/home/user/project').replace(/\{worktreeRoot\}/g, '/home/user/project/.claude/worktrees/testing-123'),
    );
    expect(interpolated[0]).toBe('cd /home/user/project/.claude/worktrees/testing-123 && pnpm install');
    expect(interpolated[1]).toBe('cp /home/user/project/.env /home/user/project/.claude/worktrees/testing-123/.env');
  });
});

describe('Testing Session — Next-Action Guard', () => {
  it('builds suggestions for testing-active state', () => {
    const result = buildSuggestions({ type: 'testing-active' });
    expect(result).toContain('Testing session active');
    expect(result).toContain('testing_session_end');
    expect(result).toContain('Continue testing');
  });
});
