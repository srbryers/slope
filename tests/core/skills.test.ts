import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseSkillMarkdown,
  scanSkills,
  validateSkillRegistry,
  saveSkillRegistry,
  loadSkillRegistry,
  skillIds,
} from '../../src/core/skills.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-skills-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeSkill(root: string, name: string, content: string, openaiYaml?: string): void {
  const dir = join(tmpDir, root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), content);
  if (openaiYaml) {
    mkdirSync(join(dir, 'agents'), { recursive: true });
    writeFileSync(join(dir, 'agents', 'openai.yaml'), openaiYaml);
  }
}

describe('parseSkillMarkdown', () => {
  it('parses YAML frontmatter and body', () => {
    const parsed = parseSkillMarkdown(`---
name: slope-sprint-workflow
version: "1.0"
description: Sprint lifecycle orchestration.
triggers:
  - sprint
---

# Skill

Use this for sprint work.
`);

    expect(parsed.metadata.name).toBe('slope-sprint-workflow');
    expect(parsed.metadata.version).toBe('1.0');
    expect(parsed.body).toContain('Use this for sprint work');
    expect(parsed.warnings).toHaveLength(0);
  });

  it('warns when frontmatter is missing', () => {
    const parsed = parseSkillMarkdown('# Skill only');
    expect(parsed.metadata).toEqual({});
    expect(parsed.warnings[0]).toContain('no YAML frontmatter');
  });
});

describe('scanSkills', () => {
  it('scans configured roots and parses SKILL.md metadata', () => {
    writeSkill('.agents/skills', 'slope-sprint-workflow', `---
name: slope-sprint-workflow
description: Sprint lifecycle orchestration.
triggers:
  - sprint
context_files:
  - CODEBASE.md
---

# SLOPE Sprint Workflow
`);

    const result = scanSkills({
      cwd: tmpDir,
      roots: ['.agents/skills'],
      generatedAt: '2026-05-23T00:00:00.000Z',
    });

    expect(result.registry.generated_at).toBe('2026-05-23T00:00:00.000Z');
    expect(result.registry.skills).toHaveLength(1);
    expect(result.registry.skills[0]).toMatchObject({
      id: 'slope-sprint-workflow',
      name: 'slope-sprint-workflow',
      description: 'Sprint lifecycle orchestration.',
      path: '.agents/skills/slope-sprint-workflow/SKILL.md',
      triggers: ['sprint'],
      context_files: ['CODEBASE.md'],
    });
  });

  it('honors absolute scan roots', () => {
    writeSkill('custom-skills', 'setup', `---
name: setup
description: Configure a project.
---

Set up the repo.
`);

    const result = scanSkills({ cwd: tmpDir, roots: [join(tmpDir, 'custom-skills')] });

    expect(result.registry.skills).toHaveLength(1);
    expect(result.registry.skills[0].id).toBe('setup');
  });

  it('merges duplicate skill ids across provider roots', () => {
    const skill = `---
name: slope-sprint-workflow
description: Sprint lifecycle orchestration.
triggers:
  - sprint
---

Guide.
`;
    writeSkill('.agents/skills', 'slope-sprint-workflow', skill);
    writeSkill('.claude/skills', 'slope-sprint-workflow', skill);

    const result = scanSkills({ cwd: tmpDir, roots: ['.agents/skills', '.claude/skills'] });

    expect(result.registry.skills).toHaveLength(1);
    expect(result.registry.skills[0].sources).toHaveLength(2);
    expect(result.warnings.some(w => w.includes('Merged duplicate skill id'))).toBe(true);
  });

  it('parses agents/openai.yaml metadata without making it executable', () => {
    writeSkill(
      '.agents/skills',
      'review-helper',
      `---
name: review-helper
description: Review PRs.
---

Review pull requests.
`,
      `name: review-helper
triggers:
  - code review
tags:
  - github
`,
    );

    const result = scanSkills({ cwd: tmpDir, roots: ['.agents/skills'] });
    const skill = result.registry.skills[0];

    expect(skill.triggers).toEqual(['code review']);
    expect(skill.tags).toEqual(['github']);
    expect(skill.sources[0].metadata_sources).toEqual(['SKILL.md', 'agents/openai.yaml']);
    expect(skill.sources[0].openai_metadata_path).toBe('.agents/skills/review-helper/agents/openai.yaml');
    expect(skill.openai?.name).toBe('review-helper');
  });
});

describe('skill registry persistence and validation', () => {
  it('saves and loads .slope/skills.json', () => {
    writeSkill('.agents/skills', 'setup', `---
name: setup
description: Configure a project.
---

Set up the repo.
`);
    const { registry } = scanSkills({ cwd: tmpDir, roots: ['.agents/skills'] });
    const path = saveSkillRegistry(registry, join(tmpDir, '.slope', 'skills.json'));

    const loaded = loadSkillRegistry(path);
    expect(loaded?.skills[0].id).toBe('setup');
    expect(skillIds(loaded).has('setup')).toBe(true);
  });

  it('validates duplicate ids and missing source paths', () => {
    writeSkill('.agents/skills', 'setup', `---
name: setup
description: Configure a project.
triggers:
  - setup
---

Set up the repo.
`);
    const { registry } = scanSkills({ cwd: tmpDir, roots: ['.agents/skills'] });
    registry.skills.push({ ...registry.skills[0], path: '.agents/skills/missing/SKILL.md' });

    const result = validateSkillRegistry(registry, tmpDir);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Duplicate skill id'))).toBe(true);
    expect(result.errors.some(e => e.includes('source not found'))).toBe(true);
  });
});
