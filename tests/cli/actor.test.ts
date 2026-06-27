import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveActor } from '../../src/cli/actor.js';
import type { SlopeConfig } from '../../src/core/index.js';

const baseConfig = {
  scorecardDir: 'docs/retros',
  scorecardPattern: 'sprint-*.json',
  minSprint: 1,
  commonIssuesPath: '.slope/common-issues.json',
  sessionsPath: '.slope/sessions.json',
  registry: 'file',
  claimsPath: '.slope/claims.json',
  roadmapPath: 'docs/backlog/roadmap.json',
  flowsPath: '.slope/flows.json',
  inspirationsPath: '.slope/inspirations.json',
  skillsPath: '.slope/skills.json',
  visionPath: '.slope/vision.json',
  repoProfilePath: '.slope/repo-profile.json',
  transcriptsPath: '.slope/transcripts',
  metaphor: 'golf',
} satisfies SlopeConfig;

describe('resolveActor', () => {
  it('prefers explicit override', () => {
    const actor = resolveActor(process.cwd(), {
      explicitActor: 'codex',
      config: baseConfig,
      env: { SLOPE_ACTOR: 'env-agent' },
    });

    expect(actor).toEqual({ name: 'codex', source: 'override', isFallback: false });
  });

  it('uses configured default team player with display name', () => {
    const actor = resolveActor(process.cwd(), {
      config: {
        ...baseConfig,
        team: {
          defaultPlayer: 'sbry',
          players: { sbry: 'Sebastian Bryers' },
        },
      },
      env: {},
    });

    expect(actor).toEqual({
      name: 'sbry:Sebastian Bryers',
      source: 'config:team.defaultPlayer',
      isFallback: false,
    });
  });

  it('falls back to git user name when no configured or environment actor exists', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-actor-'));
    try {
      execSync('git init -q', { cwd });
      execSync('git config user.name "Git User"', { cwd });

      const actor = resolveActor(cwd, {
        config: baseConfig,
        env: {},
      });

      expect(actor).toEqual({ name: 'Git User', source: 'git:user.name', isFallback: false });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('uses unknown only when no configured, git, or environment identity exists', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-actor-empty-'));
    try {
      const actor = resolveActor(cwd, { config: baseConfig, env: {} });

      expect(actor).toEqual({ name: 'unknown', source: 'fallback', isFallback: true });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
