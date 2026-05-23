import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tmpDir: string;
let exitCode: number | undefined;

vi.spyOn(process, 'cwd').mockImplementation(() => tmpDir);
vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
  exitCode = code as number;
  throw new Error(`process.exit(${code})`);
});

import { skillsCommand } from '../../src/cli/commands/skills.js';

function writeConfig(): void {
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  writeFileSync(join(tmpDir, '.slope', 'config.json'), JSON.stringify({
    scorecardDir: 'docs/retros',
    scorecardPattern: 'sprint-*.json',
    minSprint: 1,
    skillsPath: '.slope/skills.json',
    skillRoots: ['.agents/skills'],
  }));
}

function writeSkill(): void {
  const dir = join(tmpDir, '.agents', 'skills', 'review-helper');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---
name: review-helper
description: Review pull requests.
triggers:
  - review
---

Review pull requests.
`);
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-cli-skills-'));
  writeConfig();
  exitCode = undefined;
});

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

describe('slope skills scan', () => {
  it('creates .slope/skills.json from configured roots', async () => {
    writeSkill();

    await skillsCommand(['scan']);

    const registryPath = join(tmpDir, '.slope', 'skills.json');
    expect(existsSync(registryPath)).toBe(true);
    const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
    expect(registry.skills[0].id).toBe('review-helper');
    expect(registry.skills[0].path).toBe('.agents/skills/review-helper/SKILL.md');
  });

  it('accepts explicit repeated roots', async () => {
    writeSkill();

    await skillsCommand(['scan', '--root=.agents/skills']);

    const registry = JSON.parse(readFileSync(join(tmpDir, '.slope', 'skills.json'), 'utf8'));
    expect(registry.roots).toEqual(['.agents/skills']);
  });
});

describe('slope skills list', () => {
  it('prints registered skills', async () => {
    writeSkill();
    await skillsCommand(['scan']);

    const logged: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.join(' '));
    });
    await skillsCommand(['list']);
    spy.mockRestore();

    expect(logged.some(line => line.includes('review-helper'))).toBe(true);
    expect(logged.some(line => line.includes('1 skill(s) registered'))).toBe(true);
  });

  it('prints JSON with --json', async () => {
    writeSkill();
    await skillsCommand(['scan']);

    const logged: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.join(' '));
    });
    await skillsCommand(['list', '--json']);
    spy.mockRestore();

    const parsed = JSON.parse(logged.join('\n'));
    expect(parsed[0].id).toBe('review-helper');
  });
});

describe('slope skills validate', () => {
  it('passes for a valid registry', async () => {
    writeSkill();
    await skillsCommand(['scan']);

    const logged: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.join(' '));
    });
    await skillsCommand(['validate']);
    spy.mockRestore();

    expect(logged.some(line => line.includes('All 1 skill(s) valid'))).toBe(true);
  });

  it('exits 1 when registry is missing', async () => {
    await expect(skillsCommand(['validate'])).rejects.toThrow('process.exit(1)');
    expect(exitCode).toBe(1);
  });
});
