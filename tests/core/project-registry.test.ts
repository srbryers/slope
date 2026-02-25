import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileProjectRegistry } from '../../src/core/project-registry.js';
import type { SlopeConfig } from '../../src/core/config.js';

let tmpDir: string;
let registry: FileProjectRegistry;

const makeConfig = (overrides?: Partial<SlopeConfig>): SlopeConfig => ({
  scorecardDir: 'docs/retros',
  scorecardPattern: 'sprint-*.json',
  minSprint: 1,
  commonIssuesPath: '.slope/common-issues.json',
  sessionsPath: '.slope/sessions.json',
  registry: 'file',
  claimsPath: '.slope/claims.json',
  roadmapPath: 'docs/backlog/roadmap.json',
  flowsPath: '.slope/flows.json',
  metaphor: 'golf',
  ...overrides,
});

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-registry-'));
  registry = new FileProjectRegistry(tmpDir);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('FileProjectRegistry', () => {
  it('returns null for nonexistent project', async () => {
    const result = await registry.getProject('nonexistent');
    expect(result).toBeNull();
  });

  it('lists empty when no projects saved', async () => {
    const projects = await registry.listProjects();
    expect(projects).toEqual([]);
  });

  it('saves and retrieves a project', async () => {
    const config = makeConfig({ projectId: 'my-app', projectName: 'My App' });
    await registry.saveProject('my-app', config);

    const retrieved = await registry.getProject('my-app');
    expect(retrieved).toBeTruthy();
    expect(retrieved!.projectId).toBe('my-app');
    expect(retrieved!.metaphor).toBe('golf');
  });

  it('lists saved projects with names', async () => {
    await registry.saveProject('app-1', makeConfig({ projectName: 'App One' }));
    await registry.saveProject('app-2', makeConfig({ projectName: 'App Two' }));

    const projects = await registry.listProjects();
    expect(projects).toHaveLength(2);
    expect(projects.map(p => p.id).sort()).toEqual(['app-1', 'app-2']);
    expect(projects.find(p => p.id === 'app-1')!.name).toBe('App One');
  });

  it('uses project id as name fallback', async () => {
    await registry.saveProject('unnamed', makeConfig());

    const projects = await registry.listProjects();
    expect(projects[0].name).toBe('unnamed');
  });

  it('overwrites existing project config', async () => {
    await registry.saveProject('app', makeConfig({ metaphor: 'golf' }));
    await registry.saveProject('app', makeConfig({ metaphor: 'tennis' }));

    const retrieved = await registry.getProject('app');
    expect(retrieved!.metaphor).toBe('tennis');

    const projects = await registry.listProjects();
    expect(projects).toHaveLength(1);
  });

  it('removes a project', async () => {
    await registry.saveProject('app', makeConfig());

    const removed = await registry.removeProject('app');
    expect(removed).toBe(true);

    const result = await registry.getProject('app');
    expect(result).toBeNull();
  });

  it('returns false when removing nonexistent project', async () => {
    const removed = await registry.removeProject('nope');
    expect(removed).toBe(false);
  });

  it('persists across instances', async () => {
    await registry.saveProject('persist', makeConfig({ projectName: 'Persist' }));

    const registry2 = new FileProjectRegistry(tmpDir);
    const retrieved = await registry2.getProject('persist');
    expect(retrieved).toBeTruthy();
    expect(retrieved!.projectName).toBe('Persist');
  });
});
