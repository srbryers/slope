import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseInspirations,
  validateInspirations,
  loadInspirations,
  linkInspirationToSprint,
  deriveId,
} from '../../src/core/inspirations.js';
import type { InspirationsFile } from '../../src/core/inspirations.js';

const tmpDir = join(import.meta.dirname ?? __dirname, '.tmp-inspirations-test');
const inspirationsPath = join(tmpDir, '.slope', 'inspirations.json');

function makeFile(overrides?: Partial<InspirationsFile>): InspirationsFile {
  return {
    version: '1',
    last_updated: '2024-01-01T00:00:00Z',
    inspirations: [],
    ...overrides,
  };
}

function writeFile(file: InspirationsFile): void {
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
  writeFileSync(inspirationsPath, JSON.stringify(file, null, 2));
}

beforeEach(() => {
  mkdirSync(join(tmpDir, '.slope'), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('deriveId', () => {
  it('converts project name to kebab-case', () => {
    expect(deriveId('GitNexus')).toBe('gitnexus');
    expect(deriveId('Open Viking')).toBe('open-viking');
    expect(deriveId('MiroFish 2.0')).toBe('mirofish-2-0');
  });

  it('strips leading/trailing hyphens', () => {
    expect(deriveId('  Hello World  ')).toBe('hello-world');
  });
});

describe('parseInspirations', () => {
  it('parses valid file', () => {
    const file = makeFile({
      inspirations: [
        {
          id: 'test',
          source_url: 'https://github.com/test/test',
          project_name: 'Test',
          ideas: ['idea one'],
          status: 'backlogged',
          linked_sprints: [],
          added_at: '2024-01-01T00:00:00Z',
        },
      ],
    });
    const result = parseInspirations(JSON.stringify(file));
    expect(result.inspirations).toHaveLength(1);
    expect(result.inspirations[0].id).toBe('test');
  });

  it('throws on invalid version', () => {
    expect(() => parseInspirations(JSON.stringify({ version: '99', inspirations: [] }))).toThrow('Unsupported');
  });

  it('throws on missing inspirations array', () => {
    expect(() => parseInspirations(JSON.stringify({ version: '1' }))).toThrow('"inspirations" array');
  });

  it('throws on entry missing id', () => {
    const file = makeFile({ inspirations: [{ source_url: 'x', project_name: 'x', ideas: [], status: 'backlogged', linked_sprints: [] } as any] });
    expect(() => parseInspirations(JSON.stringify(file))).toThrow('string "id"');
  });

  it('throws on entry with invalid status', () => {
    const file = makeFile({
      inspirations: [{
        id: 'x', source_url: 'x', project_name: 'x', ideas: [],
        status: 'invalid' as any, linked_sprints: [],
      }] as any,
    });
    expect(() => parseInspirations(JSON.stringify(file))).toThrow('valid "status"');
  });
});

describe('validateInspirations', () => {
  it('returns no errors for valid file', () => {
    const file = makeFile({
      inspirations: [{
        id: 'test', source_url: 'https://x', project_name: 'Test',
        ideas: ['idea'], status: 'backlogged', linked_sprints: [], added_at: '2024-01-01',
      }],
    });
    const result = validateInspirations(file);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('detects duplicate IDs', () => {
    const entry = {
      id: 'dup', source_url: 'https://x', project_name: 'X',
      ideas: ['a'], status: 'backlogged' as const, linked_sprints: [], added_at: '2024-01-01',
    };
    const file = makeFile({ inspirations: [entry, { ...entry }] });
    const result = validateInspirations(file);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Duplicate');
  });

  it('warns on empty ideas', () => {
    const file = makeFile({
      inspirations: [{
        id: 'empty', source_url: 'https://x', project_name: 'X',
        ideas: [], status: 'backlogged', linked_sprints: [], added_at: '2024-01-01',
      }],
    });
    const result = validateInspirations(file);
    expect(result.warnings.some(w => w.includes('no ideas'))).toBe(true);
  });

  it('warns on rejected without reason', () => {
    const file = makeFile({
      inspirations: [{
        id: 'rej', source_url: 'https://x', project_name: 'X',
        ideas: ['a'], status: 'rejected', linked_sprints: [], added_at: '2024-01-01',
      }],
    });
    const result = validateInspirations(file);
    expect(result.warnings.some(w => w.includes('rejected_reason'))).toBe(true);
  });
});

describe('loadInspirations', () => {
  it('returns null for missing file', () => {
    expect(loadInspirations(join(tmpDir, 'nonexistent.json'))).toBeNull();
  });

  it('loads valid file', () => {
    const file = makeFile({
      inspirations: [{
        id: 'test', source_url: 'https://x', project_name: 'Test',
        ideas: ['idea'], status: 'backlogged', linked_sprints: [], added_at: '2024-01-01',
      }],
    });
    writeFile(file);
    const result = loadInspirations(inspirationsPath);
    expect(result).not.toBeNull();
    expect(result!.inspirations).toHaveLength(1);
  });

  it('returns null for invalid JSON', () => {
    writeFileSync(inspirationsPath, 'not json');
    expect(loadInspirations(inspirationsPath)).toBeNull();
  });
});

describe('linkInspirationToSprint', () => {
  it('links sprint to inspiration', () => {
    const file = makeFile({
      inspirations: [{
        id: 'test', source_url: 'https://x', project_name: 'Test',
        ideas: ['idea'], status: 'backlogged', linked_sprints: [], added_at: '2024-01-01',
      }],
    });
    writeFile(file);
    const result = linkInspirationToSprint(inspirationsPath, 'test', 65);
    expect(result.inspirations[0].linked_sprints).toEqual([65]);
  });

  it('is idempotent — no duplicate sprint links', () => {
    const file = makeFile({
      inspirations: [{
        id: 'test', source_url: 'https://x', project_name: 'Test',
        ideas: ['idea'], status: 'backlogged', linked_sprints: [65], added_at: '2024-01-01',
      }],
    });
    writeFile(file);
    const result = linkInspirationToSprint(inspirationsPath, 'test', 65);
    expect(result.inspirations[0].linked_sprints).toEqual([65]);
  });

  it('sorts sprint numbers', () => {
    const file = makeFile({
      inspirations: [{
        id: 'test', source_url: 'https://x', project_name: 'Test',
        ideas: ['idea'], status: 'backlogged', linked_sprints: [70], added_at: '2024-01-01',
      }],
    });
    writeFile(file);
    const result = linkInspirationToSprint(inspirationsPath, 'test', 65);
    expect(result.inspirations[0].linked_sprints).toEqual([65, 70]);
  });

  it('throws if file missing', () => {
    expect(() => linkInspirationToSprint(join(tmpDir, 'nope.json'), 'x', 1)).toThrow('not found');
  });

  it('throws if ID not found', () => {
    const file = makeFile({ inspirations: [] });
    writeFile(file);
    expect(() => linkInspirationToSprint(inspirationsPath, 'nonexistent', 1)).toThrow('not found');
  });

  it('persists to disk', () => {
    const file = makeFile({
      inspirations: [{
        id: 'test', source_url: 'https://x', project_name: 'Test',
        ideas: ['idea'], status: 'backlogged', linked_sprints: [], added_at: '2024-01-01',
      }],
    });
    writeFile(file);
    linkInspirationToSprint(inspirationsPath, 'test', 42);
    const reloaded = JSON.parse(readFileSync(inspirationsPath, 'utf8'));
    expect(reloaded.inspirations[0].linked_sprints).toEqual([42]);
  });
});
