import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  runLightweightDetection,
  validateInterviewAnswers,
  answersToInitInput,
} from '../../src/core/interview-engine.js';
import { initFromAnswers } from '../../src/core/interview.js';

// Register built-in metaphors
import '../../src/core/metaphors/index.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-engine-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('runLightweightDetection', () => {
  it('reads package.json name', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-app' }));
    const info = runLightweightDetection(tmpDir);
    expect(info.projectName).toBe('my-app');
  });

  it('detects sprint number from retros', () => {
    const retrosDir = join(tmpDir, 'docs', 'retros');
    mkdirSync(retrosDir, { recursive: true });
    writeFileSync(join(retrosDir, 'sprint-3.json'), '{}');
    writeFileSync(join(retrosDir, 'sprint-7.json'), '{}');
    writeFileSync(join(retrosDir, 'sprint-1.json'), '{}');
    const info = runLightweightDetection(tmpDir);
    expect(info.existingSprintNumber).toBe(7);
  });

  it('handles missing package.json gracefully', () => {
    const info = runLightweightDetection(tmpDir);
    // Falls back to directory name
    expect(info.projectName).toBeTruthy();
    expect(info.techStack).toBeUndefined();
  });

  it('handles malformed package.json gracefully', () => {
    writeFileSync(join(tmpDir, 'package.json'), 'not json');
    const info = runLightweightDetection(tmpDir);
    // Falls back to directory name
    expect(info.projectName).toBeTruthy();
  });

  it('handles no git repo gracefully', () => {
    const info = runLightweightDetection(tmpDir);
    expect(info.repoUrl).toBeUndefined();
  });

  it('handles empty retros directory', () => {
    const retrosDir = join(tmpDir, 'docs', 'retros');
    mkdirSync(retrosDir, { recursive: true });
    const info = runLightweightDetection(tmpDir);
    expect(info.existingSprintNumber).toBeUndefined();
  });

  it('detects tech stack from dependencies', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      name: 'test',
      dependencies: { react: '^18.0.0', next: '^14.0.0' },
      devDependencies: { vitest: '^1.0.0' },
    }));
    const info = runLightweightDetection(tmpDir);
    expect(info.techStack).toContain('react');
    expect(info.techStack).toContain('vitest');
  });
});

describe('validateInterviewAnswers', () => {
  it('accepts valid minimal answers', () => {
    const errors = validateInterviewAnswers({ 'project-name': 'my-app' });
    expect(errors).toEqual([]);
  });

  it('rejects missing project name', () => {
    const errors = validateInterviewAnswers({});
    expect(errors).toEqual([{ field: 'project-name', message: 'Project name is required' }]);
  });

  it('rejects invalid repo URL', () => {
    const errors = validateInterviewAnswers({
      'project-name': 'app',
      'repo-url': 'not-a-url',
    });
    expect(errors.some((e) => e.field === 'repo-url')).toBe(true);
  });

  it('rejects invalid sprint number', () => {
    const errors = validateInterviewAnswers({
      'project-name': 'app',
      'sprint-number': 'abc',
    });
    expect(errors.some((e) => e.field === 'sprint-number')).toBe(true);
  });
});

describe('answersToInitInput', () => {
  it('transforms answers correctly', () => {
    const input = answersToInitInput({
      'project-name': 'My App',
      'metaphor': 'gaming',
      'repo-url': 'https://github.com/acme/app',
      'sprint-number': '5',
      'vision': 'Build something great',
    });
    expect(input.projectName).toBe('My App');
    expect(input.metaphor).toBe('gaming');
    expect(input.repoUrl).toBe('https://github.com/acme/app');
    expect(input.currentSprint).toBe(5);
    expect(input.vision).toBe('Build something great');
  });

  it('parses team members string', () => {
    const input = answersToInitInput({
      'project-name': 'app',
      'team-members': 'alice:Alice Smith, bob:Bob Jones',
    });
    expect(input.teamMembers).toEqual({
      alice: 'Alice Smith',
      bob: 'Bob Jones',
    });
  });

  it('handles empty optional fields', () => {
    const input = answersToInitInput({ 'project-name': 'app' });
    expect(input.repoUrl).toBeUndefined();
    expect(input.metaphor).toBeUndefined();
    expect(input.currentSprint).toBeUndefined();
    expect(input.teamMembers).toBeUndefined();
    expect(input.vision).toBeUndefined();
  });
});

describe('initFromAnswers', () => {
  it('creates config and returns success result', async () => {
    const result = await initFromAnswers(tmpDir, {
      'project-name': 'Test App',
      'metaphor': 'golf',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.configPath).toContain('.slope');
      expect(result.filesCreated.length).toBeGreaterThanOrEqual(1);
      expect(result.providers).toEqual([]);
    }
  });

  it('returns structured errors on invalid answers', async () => {
    const result = await initFromAnswers(tmpDir, {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.field === 'project-name')).toBe(true);
    }
  });
});
