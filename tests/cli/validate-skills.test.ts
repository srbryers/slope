import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildScorecard } from '../../src/core/builder.js';
import type { SkillRegistryFile } from '../../src/core/skills.js';

let tmpDir: string;
let exitCode: number | undefined;

vi.spyOn(process, 'cwd').mockImplementation(() => tmpDir);
vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
  exitCode = code as number;
  throw new Error(`process.exit(${code})`);
});

import { validateCommand } from '../../src/cli/commands/validate.js';

function writeConfig(): void {
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
    minSprint: 1,
    skillsPath: '.slope/skills.json',
  }));
}

function writeRegistry(ids: string[]): void {
  const registry: SkillRegistryFile = {
    version: '1',
    generated_at: '2026-05-23T00:00:00.000Z',
    roots: ['.agents/skills'],
    skills: ids.map(id => ({
      id,
      name: id,
      description: `${id} description`,
      path: `.agents/skills/${id}/SKILL.md`,
      directory: `.agents/skills/${id}`,
      root: '.agents/skills',
      sources: [{
        path: `.agents/skills/${id}/SKILL.md`,
        directory: `.agents/skills/${id}`,
        root: '.agents/skills',
        metadata_sources: ['SKILL.md'],
      }],
      triggers: ['test'],
    })),
  };
  writeFileSync(join(tmpDir, '.slope', 'skills.json'), JSON.stringify(registry, null, 2));
}

function writeScorecard(skillsUsed: string[], sprintNumber = 1): string {
  const retrosDir = join(tmpDir, 'docs', 'retros');
  mkdirSync(retrosDir, { recursive: true });
  const card = buildScorecard({
    sprint_number: sprintNumber,
    theme: 'Skill validation',
    par: 3,
    slope: 1,
    date: '2026-05-23',
    player: 'test',
    shots: [{
      ticket_key: `S${sprintNumber}-1`,
      title: 'Test',
      club: 'wedge',
      result: 'in_the_hole',
      hazards: [],
    }],
    training: [{ type: 'lessons', description: 'test', outcome: 'ok' }],
    nutrition: [{ category: 'hydration', description: 'test', status: 'healthy' }],
    bunker_locations: ['none'],
    skills_used: skillsUsed,
  });
  const path = join(retrosDir, `sprint-${sprintNumber}.json`);
  writeFileSync(path, JSON.stringify(card, null, 2));
  return `docs/retros/sprint-${sprintNumber}.json`;
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-validate-skills-'));
  writeConfig();
  exitCode = undefined;
});

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

describe('slope validate --skills', () => {
  it('passes when scorecard skill references exist in the registry', () => {
    writeRegistry(['slope-sprint-workflow']);
    const path = writeScorecard(['slope-sprint-workflow']);

    expect(() => validateCommand([path, '--skills'])).toThrow('process.exit(0)');
    expect(exitCode).toBe(0);
  });

  it('fails when scorecard skill references are unknown', () => {
    writeRegistry(['slope-sprint-workflow']);
    const path = writeScorecard(['missing-skill']);

    expect(() => validateCommand([path, '--skills'])).toThrow('process.exit(1)');
    expect(exitCode).toBe(1);
  });

  it('fails when --skills is used before scanning a registry', () => {
    const path = writeScorecard(['slope-sprint-workflow']);

    expect(() => validateCommand([path, '--skills'])).toThrow('process.exit(1)');
    expect(exitCode).toBe(1);
  });

  it('includes decimal inserted sprint scorecards during default validation', () => {
    writeScorecard([], 114.5);

    expect(() => validateCommand()).toThrow('process.exit(0)');
    expect(exitCode).toBe(0);
  });
});
