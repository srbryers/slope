import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateInitInput, initFromInterview } from '../../src/core/interview.js';
import type { InitInput } from '../../src/core/interview.js';

// Import metaphors to register them (needed for validation)
import '../../src/core/metaphors/index.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-interview-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('validateInitInput', () => {
  it('accepts valid minimal input', () => {
    const errors = validateInitInput({ projectName: 'my-app' });
    expect(errors).toEqual([]);
  });

  it('accepts valid full input', () => {
    const errors = validateInitInput({
      projectName: 'My CaddyStack App',
      repoUrl: 'https://github.com/acme/app',
      teamMembers: { alice: 'Alice Smith', bob: 'Bob Jones' },
      sprintCadence: 'weekly',
      metaphor: 'golf',
      techStack: ['typescript', 'react'],
      vision: 'Build the best tool',
      priorities: ['speed', 'reliability'],
      currentSprint: 5,
    });
    expect(errors).toEqual([]);
  });

  it('rejects empty projectName', () => {
    const errors = validateInitInput({ projectName: '' });
    expect(errors).toContain('projectName is required and must be non-empty');
  });

  it('rejects whitespace-only projectName', () => {
    const errors = validateInitInput({ projectName: '   ' });
    expect(errors).toContain('projectName is required and must be non-empty');
  });

  it('rejects unknown metaphor', () => {
    const errors = validateInitInput({ projectName: 'app', metaphor: 'nonexistent' });
    expect(errors.some(e => e.includes('Unknown metaphor'))).toBe(true);
  });

  it('rejects invalid repoUrl', () => {
    const errors = validateInitInput({ projectName: 'app', repoUrl: 'not-a-url' });
    expect(errors.some(e => e.includes('repoUrl'))).toBe(true);
  });

  it('accepts valid GitHub URL with .git suffix', () => {
    const errors = validateInitInput({ projectName: 'app', repoUrl: 'https://github.com/user/repo.git' });
    expect(errors).toEqual([]);
  });

  it('rejects invalid team member slugs', () => {
    const errors = validateInitInput({
      projectName: 'app',
      teamMembers: { 'invalid slug!': 'Name' },
    });
    expect(errors.some(e => e.includes('Team member slug'))).toBe(true);
  });

  it('accepts valid team member slugs', () => {
    const errors = validateInitInput({
      projectName: 'app',
      teamMembers: { 'alice-b': 'Alice', bob_c: 'Bob', dev1: 'Dev' },
    });
    expect(errors).toEqual([]);
  });

  it('rejects non-positive currentSprint', () => {
    expect(validateInitInput({ projectName: 'app', currentSprint: 0 }))
      .toContain('currentSprint must be a positive integer');
    expect(validateInitInput({ projectName: 'app', currentSprint: -1 }))
      .toContain('currentSprint must be a positive integer');
    expect(validateInitInput({ projectName: 'app', currentSprint: 1.5 }))
      .toContain('currentSprint must be a positive integer');
  });

  it('collects multiple errors', () => {
    const errors = validateInitInput({
      projectName: '',
      metaphor: 'fake',
      currentSprint: -1,
    });
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('initFromInterview', () => {
  it('creates config and project files', async () => {
    const result = await initFromInterview(tmpDir, {
      projectName: 'Test App',
    });

    expect(result.configPath).toContain('.slope');
    expect(result.filesCreated.length).toBeGreaterThanOrEqual(1);

    // Config file should exist
    const config = JSON.parse(readFileSync(result.configPath, 'utf8'));
    expect(config.projectName).toBe('Test App');
    expect(config.projectId).toBe('test-app');
  });

  it('creates scorecard, common issues, and roadmap', async () => {
    await initFromInterview(tmpDir, { projectName: 'Full Init' });

    expect(existsSync(join(tmpDir, 'docs', 'retros', 'sprint-1.json'))).toBe(true);
    expect(existsSync(join(tmpDir, '.slope', 'common-issues.json'))).toBe(true);
    expect(existsSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'))).toBe(true);
  });

  it('sets metaphor in config', async () => {
    const result = await initFromInterview(tmpDir, {
      projectName: 'Tennis App',
      metaphor: 'tennis',
    });

    const config = JSON.parse(readFileSync(result.configPath, 'utf8'));
    expect(config.metaphor).toBe('tennis');
  });

  it('sets currentSprint in config', async () => {
    const result = await initFromInterview(tmpDir, {
      projectName: 'Sprint App',
      currentSprint: 10,
    });

    const config = JSON.parse(readFileSync(result.configPath, 'utf8'));
    expect(config.currentSprint).toBe(10);
  });

  it('sets team members in config', async () => {
    const result = await initFromInterview(tmpDir, {
      projectName: 'Team App',
      teamMembers: { alice: 'Alice Smith', bob: 'Bob Jones' },
    });

    const config = JSON.parse(readFileSync(result.configPath, 'utf8'));
    expect(config.team.players).toEqual({ alice: 'Alice Smith', bob: 'Bob Jones' });
  });

  it('uses vision in roadmap description', async () => {
    await initFromInterview(tmpDir, {
      projectName: 'Vision App',
      vision: 'Build the future of sprint tracking',
    });

    const roadmap = JSON.parse(readFileSync(join(tmpDir, 'docs', 'backlog', 'roadmap.json'), 'utf8'));
    expect(roadmap.description).toBe('Build the future of sprint tracking');
  });

  it('generates slug-safe projectId', async () => {
    const result = await initFromInterview(tmpDir, {
      projectName: 'My Amazing App!!!',
    });

    const config = JSON.parse(readFileSync(result.configPath, 'utf8'));
    expect(config.projectId).toBe('my-amazing-app');
  });

  it('throws on invalid input', async () => {
    await expect(initFromInterview(tmpDir, { projectName: '' }))
      .rejects.toThrow('Invalid init input');
  });

  it('does not overwrite existing files', async () => {
    // First init
    await initFromInterview(tmpDir, { projectName: 'First' });

    // Second init — should not overwrite scorecard
    const result = await initFromInterview(tmpDir, { projectName: 'Second' });

    // Config is always overwritten (createConfig behavior)
    const config = JSON.parse(readFileSync(result.configPath, 'utf8'));
    expect(config.projectName).toBe('Second');

    // But scorecard should still exist from first init
    const scorecard = JSON.parse(readFileSync(join(tmpDir, 'docs', 'retros', 'sprint-1.json'), 'utf8'));
    expect(scorecard.sprint_number).toBe(1);
  });
});
