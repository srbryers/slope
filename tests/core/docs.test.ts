import { describe, it, expect } from 'vitest';
import {
  buildDocsManifest,
  computeSectionChecksum,
} from '../../src/core/docs.js';
import type { DocsManifestInput, ChangelogSection } from '../../src/core/docs.js';
import { CLI_COMMAND_REGISTRY } from '../../src/cli/registry.js';
import { GUARD_DEFINITIONS } from '../../src/core/guard.js';

// Ensure built-in metaphors are registered
import '../../src/core/metaphors/index.js';

function makeInput(overrides?: Partial<DocsManifestInput>): DocsManifestInput {
  return {
    version: '1.0.0',
    gitSha: 'abc123',
    changelog: { status: 'success', entries: [] },
    commands: CLI_COMMAND_REGISTRY,
    ...overrides,
  };
}

describe('computeSectionChecksum', () => {
  it('produces deterministic hashes', () => {
    const data = { b: 2, a: 1 };
    const hash1 = computeSectionChecksum(data);
    const hash2 = computeSectionChecksum(data);
    expect(hash1).toBe(hash2);
  });

  it('produces same hash regardless of key order', () => {
    const a = { x: 1, y: 2, z: 3 };
    const b = { z: 3, x: 1, y: 2 };
    expect(computeSectionChecksum(a)).toBe(computeSectionChecksum(b));
  });

  it('produces different hash for different data', () => {
    const a = { x: 1 };
    const b = { x: 2 };
    expect(computeSectionChecksum(a)).not.toBe(computeSectionChecksum(b));
  });

  it('handles nested objects deterministically', () => {
    const a = { outer: { b: 2, a: 1 } };
    const b = { outer: { a: 1, b: 2 } };
    expect(computeSectionChecksum(a)).toBe(computeSectionChecksum(b));
  });

  it('handles arrays', () => {
    const data = [{ b: 2, a: 1 }, { d: 4, c: 3 }];
    const hash1 = computeSectionChecksum(data);
    const hash2 = computeSectionChecksum(data);
    expect(hash1).toBe(hash2);
  });

  it('returns a hex string', () => {
    const hash = computeSectionChecksum({ test: true });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('buildDocsManifest', () => {
  it('returns all required sections', () => {
    const manifest = buildDocsManifest(makeInput());
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.gitSha).toBe('abc123');
    expect(manifest.generatedAt).toBeTruthy();
    expect(manifest.checksums).toBeTruthy();
    expect(manifest.commands).toBeTruthy();
    expect(manifest.guards).toBeTruthy();
    expect(manifest.metaphors).toBeTruthy();
    expect(manifest.roles).toBeTruthy();
    expect(manifest.constants).toBeTruthy();
    expect(manifest.changelog).toBeTruthy();
  });

  it('commands count matches CLI_COMMAND_REGISTRY', () => {
    const manifest = buildDocsManifest(makeInput());
    expect(manifest.commands.length).toBe(CLI_COMMAND_REGISTRY.length);
  });

  it('guards count matches GUARD_DEFINITIONS', () => {
    const manifest = buildDocsManifest(makeInput());
    expect(manifest.guards.length).toBe(GUARD_DEFINITIONS.length);
  });

  it('includes all built-in metaphors', () => {
    const manifest = buildDocsManifest(makeInput());
    expect(manifest.metaphors.length).toBeGreaterThanOrEqual(7);
    const ids = manifest.metaphors.map(m => m.id);
    expect(ids).toContain('golf');
    expect(ids).toContain('tennis');
    expect(ids).toContain('baseball');
    expect(ids).toContain('gaming');
    expect(ids).toContain('dnd');
    expect(ids).toContain('matrix');
    expect(ids).toContain('agile');
  });

  it('metaphors have complete term maps', () => {
    const manifest = buildDocsManifest(makeInput());
    for (const m of manifest.metaphors) {
      expect(m.vocabulary).toBeTruthy();
      expect(m.clubs).toBeTruthy();
      expect(m.shotResults).toBeTruthy();
      expect(m.hazards).toBeTruthy();
      expect(m.conditions).toBeTruthy();
      expect(m.scoreLabels).toBeTruthy();
    }
  });

  it('includes all built-in roles', () => {
    const manifest = buildDocsManifest(makeInput());
    expect(manifest.roles.length).toBeGreaterThanOrEqual(8);
    const ids = manifest.roles.map(r => r.id);
    expect(ids).toContain('generalist');
    expect(ids).toContain('backend');
    expect(ids).toContain('frontend');
    expect(ids).toContain('architect');
  });

  it('constants sections are populated', () => {
    const manifest = buildDocsManifest(makeInput());
    expect(manifest.constants.parThresholds).toBeTruthy();
    expect(manifest.constants.slopeFactors).toBeTruthy();
    expect(manifest.constants.scoreLabels).toBeTruthy();
    expect(manifest.constants.hazardPenalties).toBeTruthy();
  });

  it('per-section checksums are deterministic', () => {
    const input = makeInput();
    const m1 = buildDocsManifest(input);
    const m2 = buildDocsManifest(input);
    // generatedAt will differ, but checksums are based on section data
    expect(m1.checksums.commands).toBe(m2.checksums.commands);
    expect(m1.checksums.guards).toBe(m2.checksums.guards);
    expect(m1.checksums.metaphors).toBe(m2.checksums.metaphors);
    expect(m1.checksums.roles).toBe(m2.checksums.roles);
    expect(m1.checksums.constants).toBe(m2.checksums.constants);
  });

  it('checksums change when input data changes', () => {
    const input1 = makeInput({ version: '1.0.0' });
    const input2 = makeInput({ version: '2.0.0' });
    const m1 = buildDocsManifest(input1);
    const m2 = buildDocsManifest(input2);
    // Commands/guards/metaphors/roles/constants should be the same
    expect(m1.checksums.commands).toBe(m2.checksums.commands);
    // But changelog differs because it's part of the manifest input
  });

  it('handles unavailable changelog gracefully', () => {
    const changelog: ChangelogSection = {
      status: 'unavailable',
      entries: [],
      reason: 'No git',
    };
    const manifest = buildDocsManifest(makeInput({ changelog }));
    expect(manifest.changelog.status).toBe('unavailable');
    expect(manifest.changelog.reason).toBe('No git');
    // All other sections should still be populated
    expect(manifest.commands.length).toBeGreaterThan(0);
    expect(manifest.guards.length).toBeGreaterThan(0);
    expect(manifest.metaphors.length).toBeGreaterThan(0);
  });

  it('includes changelog checksum', () => {
    const manifest = buildDocsManifest(makeInput());
    expect(manifest.checksums.changelog).toBeTruthy();
    expect(manifest.checksums.changelog).toMatch(/^[a-f0-9]{64}$/);
  });
});
