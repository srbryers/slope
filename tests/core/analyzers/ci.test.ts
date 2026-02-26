import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeCI } from '../../../src/core/analyzers/ci.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'slope-ci-'));
}

describe('analyzeCI', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects GitHub Actions workflows', () => {
    mkdirSync(join(tmpDir, '.github/workflows'), { recursive: true });
    writeFileSync(join(tmpDir, '.github/workflows/ci.yml'), [
      'name: CI',
      'on: push',
      'jobs:',
      '  test:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: npm test',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: npm run build',
    ].join('\n'));

    const result = analyzeCI(tmpDir);
    expect(result.system).toBe('github-actions');
    expect(result.configFiles).toContain('.github/workflows/ci.yml');
    expect(result.hasTestStage).toBe(true);
    expect(result.hasBuildStage).toBe(true);
  });

  it('detects CircleCI config', () => {
    mkdirSync(join(tmpDir, '.circleci'), { recursive: true });
    writeFileSync(join(tmpDir, '.circleci/config.yml'), [
      'version: 2.1',
      'jobs:',
      '  test:',
      '    steps:',
      '      - run: npm test',
      '  deploy:',
      '    steps:',
      '      - run: npm run deploy',
    ].join('\n'));

    const result = analyzeCI(tmpDir);
    expect(result.system).toBe('circleci');
    expect(result.configFiles).toContain('.circleci/config.yml');
    expect(result.hasTestStage).toBe(true);
    expect(result.hasDeployStage).toBe(true);
  });

  it('detects GitLab CI config', () => {
    writeFileSync(join(tmpDir, '.gitlab-ci.yml'), [
      'stages:',
      '  - lint',
      '  - build',
      '  - publish',
    ].join('\n'));

    const result = analyzeCI(tmpDir);
    expect(result.system).toBe('gitlab-ci');
    expect(result.configFiles).toContain('.gitlab-ci.yml');
    expect(result.hasTestStage).toBe(true); // lint matches
    expect(result.hasBuildStage).toBe(true);
    expect(result.hasDeployStage).toBe(true); // publish matches
  });

  it('detects stage keywords from workflow content', () => {
    mkdirSync(join(tmpDir, '.github/workflows'), { recursive: true });
    writeFileSync(join(tmpDir, '.github/workflows/deploy.yml'), [
      'name: Deploy',
      'jobs:',
      '  publish:',
      '    steps:',
      '      - run: npm run deploy',
    ].join('\n'));

    const result = analyzeCI(tmpDir);
    expect(result.hasDeployStage).toBe(true);
  });

  it('handles multiple workflow files', () => {
    mkdirSync(join(tmpDir, '.github/workflows'), { recursive: true });
    writeFileSync(join(tmpDir, '.github/workflows/test.yml'), 'jobs:\n  test:\n    run: vitest');
    writeFileSync(join(tmpDir, '.github/workflows/release.yml'), 'jobs:\n  release:\n    run: deploy');

    const result = analyzeCI(tmpDir);
    expect(result.configFiles).toHaveLength(2);
    expect(result.hasTestStage).toBe(true);
    expect(result.hasDeployStage).toBe(true);
  });

  it('returns empty profile for directory without CI', () => {
    const result = analyzeCI(tmpDir);
    expect(result.system).toBeUndefined();
    expect(result.configFiles).toEqual([]);
    expect(result.hasTestStage).toBe(false);
    expect(result.hasBuildStage).toBe(false);
    expect(result.hasDeployStage).toBe(false);
  });
});
