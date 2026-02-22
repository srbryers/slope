import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerRole,
  getRole,
  hasRole,
  listRoles,
  loadCustomRoles,
  generalist,
  backend,
  frontend,
  architect,
  devops,
} from '../src/roles.js';
import type { RoleDefinition } from '../src/roles.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Built-in roles', () => {
  it('all 5 built-in roles are registered', () => {
    expect(hasRole('generalist')).toBe(true);
    expect(hasRole('backend')).toBe(true);
    expect(hasRole('frontend')).toBe(true);
    expect(hasRole('architect')).toBe(true);
    expect(hasRole('devops')).toBe(true);
  });

  it('generalist has no focus areas', () => {
    expect(generalist.focusAreas).toEqual([]);
    expect(generalist.briefingFilter.emphasize).toEqual([]);
    expect(generalist.briefingFilter.deemphasize).toEqual([]);
  });

  it('backend focuses on API and database areas', () => {
    expect(backend.focusAreas).toContain('packages/core');
    expect(backend.briefingFilter.emphasize).toContain('database');
    expect(backend.briefingFilter.emphasize).toContain('api');
    expect(backend.briefingFilter.deemphasize).toContain('styling');
  });

  it('frontend focuses on UI and components', () => {
    expect(frontend.focusAreas).toContain('src/components');
    expect(frontend.briefingFilter.emphasize).toContain('accessibility');
    expect(frontend.briefingFilter.deemphasize).toContain('database');
  });

  it('architect focuses on cross-package dependencies', () => {
    expect(architect.focusAreas).toContain('packages/*');
    expect(architect.briefingFilter.emphasize).toContain('architecture');
    expect(architect.briefingFilter.emphasize).toContain('tech-debt');
  });

  it('devops focuses on CI/CD and infrastructure', () => {
    expect(devops.focusAreas).toContain('.github');
    expect(devops.briefingFilter.emphasize).toContain('ci');
    expect(devops.briefingFilter.deemphasize).toContain('styling');
  });
});

describe('Registry operations', () => {
  it('getRole returns a registered role', () => {
    const role = getRole('generalist');
    expect(role.id).toBe('generalist');
    expect(role.name).toBe('Generalist');
  });

  it('getRole throws for unknown role', () => {
    expect(() => getRole('nonexistent')).toThrow(/Unknown role: "nonexistent"/);
  });

  it('hasRole returns false for unknown role', () => {
    expect(hasRole('nonexistent')).toBe(false);
  });

  it('listRoles returns all registered roles', () => {
    const roles = listRoles();
    expect(roles.length).toBeGreaterThanOrEqual(5);
    const ids = roles.map(r => r.id);
    expect(ids).toContain('generalist');
    expect(ids).toContain('backend');
  });

  it('registerRole adds a custom role', () => {
    const custom: RoleDefinition = {
      id: 'test-custom',
      name: 'Test Custom',
      description: 'A test role',
      focusAreas: ['src/test'],
      clubPreferences: { test: 'wedge' },
      briefingFilter: { emphasize: ['testing'], deemphasize: [] },
    };

    registerRole(custom);
    expect(hasRole('test-custom')).toBe(true);
    expect(getRole('test-custom')).toEqual(custom);
  });
});

describe('loadCustomRoles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slope-roles-test-'));
  });

  it('returns empty array when .slope/roles does not exist', () => {
    const loaded = loadCustomRoles(tmpDir);
    expect(loaded).toEqual([]);
  });

  it('loads valid JSON role files', () => {
    const rolesDir = join(tmpDir, '.slope', 'roles');
    mkdirSync(rolesDir, { recursive: true });
    writeFileSync(join(rolesDir, 'qa.json'), JSON.stringify({
      id: 'qa-test',
      name: 'QA Tester',
      description: 'Quality assurance specialist',
      focusAreas: ['tests'],
    }));

    const loaded = loadCustomRoles(tmpDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('qa-test');
    expect(loaded[0].name).toBe('QA Tester');
    expect(loaded[0].focusAreas).toEqual(['tests']);
    // Defaults filled in
    expect(loaded[0].clubPreferences).toEqual({});
    expect(loaded[0].briefingFilter).toEqual({ emphasize: [], deemphasize: [] });

    // Should be registered
    expect(hasRole('qa-test')).toBe(true);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips invalid JSON files', () => {
    const rolesDir = join(tmpDir, '.slope', 'roles');
    mkdirSync(rolesDir, { recursive: true });
    writeFileSync(join(rolesDir, 'bad.json'), 'not valid json');
    writeFileSync(join(rolesDir, 'missing-id.json'), JSON.stringify({ name: 'No ID' }));

    const loaded = loadCustomRoles(tmpDir);
    expect(loaded).toEqual([]);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips non-JSON files', () => {
    const rolesDir = join(tmpDir, '.slope', 'roles');
    mkdirSync(rolesDir, { recursive: true });
    writeFileSync(join(rolesDir, 'readme.md'), '# Roles');
    writeFileSync(join(rolesDir, 'valid.json'), JSON.stringify({
      id: 'file-filter-test',
      name: 'Filtered',
    }));

    const loaded = loadCustomRoles(tmpDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('file-filter-test');

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
