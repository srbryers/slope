import { describe, expect, it } from 'vitest';
import { patchRoadmapSourceSprintText } from '../../src/core/roadmap-source-patch.js';

const DOC = `version: "1"
phase:
  name: 'Phase 48 — Enforcement'
  status: active
  sprints: [458, 458.1, 458.2]
  note: >-
    A wrapped note that a canonical reserializer
    would reflow differently.
sprints:
  - id: 458
    theme: 'Base asset'   # single quotes on purpose
    par: 3
    slope: 1
    type: feature
    status: complete
    tickets:
      - {key: S458-1, title: 'T1', club: wedge, complexity: small}
  - id: 458.1
    theme: Variant A
    par: 3
    slope: 1
    type: feature
    status: planned # promoted after fold
    tickets:
      - key: S458.1-1
        title: T1
        club: wedge
        complexity: small
  - id: 458.2
    theme: Variant B
    par: 3
    slope: 1
    type: feature
    status: planned
    tickets:
      - {key: S458.2-1, title: T1, club: wedge, complexity: small}
scorecards:
  "458": docs/retros/sprint-458.json
`;

describe('patchRoadmapSourceSprintText', () => {
  it('changes only the targeted status line and scorecards entry', () => {
    const patched = patchRoadmapSourceSprintText(DOC, 458.1, {
      status: 'complete',
      scorecardKey: '458.1',
      scorecardPath: 'docs/retros/sprint-458.1.json',
    });

    expect(patched).not.toBeNull();
    const before = DOC.split('\n');
    const after = patched!.split('\n');
    expect(after.length).toBe(before.length + 1);
    const changed = before.filter(line => !after.includes(line));
    expect(changed).toEqual(['    status: planned # promoted after fold']);
    expect(after).toContain('    status: complete # promoted after fold');
    expect(after).toContain('  "458.1": docs/retros/sprint-458.1.json');
    // Adjacent decimal sprint remains byte-identical. (#618)
    expect(patched).toContain('  - id: 458.2\n    theme: Variant B\n    par: 3\n    slope: 1\n    type: feature\n    status: planned');
    // Untouched formatting survives: quoted version, single quotes, wrapped scalar.
    expect(patched).toContain('version: "1"');
    expect(patched).toContain("theme: 'Base asset'   # single quotes on purpose");
    expect(patched).toContain('A wrapped note that a canonical reserializer');
  });

  it('never matches ticket-level id lines or phase sprint lists', () => {
    const doc = `version: 1
phase:
  name: P
  sprints: [7]
sprints:
  - id: 7
    theme: T
    par: 3
    slope: 1
    type: feature
    status: planned
    tickets:
      - id: S7-1
        title: T1
        club: wedge
        complexity: small
`;
    const patched = patchRoadmapSourceSprintText(doc, 7, { status: 'complete' });
    expect(patched).toContain('status: complete');
    expect(patched).toContain('- id: S7-1');
  });

  it('inserts a status line when the entry has none', () => {
    const doc = `version: 1
phase:
  name: P
  sprints: [7]
sprints:
  - id: 7
    theme: T
    par: 3
    slope: 1
    type: feature
    tickets:
      - {key: S7-1, title: T1, club: wedge, complexity: small}
`;
    const patched = patchRoadmapSourceSprintText(doc, 7, { status: 'complete' });
    expect(patched!.split('\n')).toContain('    status: complete');
    expect(patched!.indexOf('status: complete')).toBeLessThan(patched!.indexOf('theme: T'));
  });

  it('replaces an existing scorecards key preserving its quoting', () => {
    const doc = `version: 1
phase:
  name: P
  sprints: [7]
sprints:
  - id: 7
    theme: T
    par: 3
    slope: 1
    type: feature
    status: planned
    tickets:
      - {key: S7-1, title: T1, club: wedge, complexity: small}
scorecards:
  '7': docs/retros/old-7.json
`;
    const patched = patchRoadmapSourceSprintText(doc, 7, {
      status: 'complete',
      scorecardKey: '7',
      scorecardPath: 'docs/retros/sprint-7.json',
    });
    expect(patched).toContain("'7': docs/retros/sprint-7.json");
    expect(patched).not.toContain('old-7.json');
  });

  it('creates the scorecards section when absent', () => {
    const doc = `version: 1
phase:
  name: P
  sprints: [7]
sprints:
  - id: 7
    theme: T
    par: 3
    slope: 1
    type: feature
    status: planned
    tickets:
      - {key: S7-1, title: T1, club: wedge, complexity: small}
`;
    const patched = patchRoadmapSourceSprintText(doc, 7, {
      status: 'complete',
      scorecardKey: '7',
      scorecardPath: 'docs/retros/sprint-7.json',
    });
    expect(patched!.endsWith('scorecards:\n  "7": docs/retros/sprint-7.json\n')).toBe(true);
  });

  it('preserves CRLF line endings', () => {
    const doc = 'version: 1\r\nphase:\r\n  name: P\r\n  sprints: [7]\r\nsprints:\r\n  - id: 7\r\n    theme: T\r\n    par: 3\r\n    slope: 1\r\n    type: feature\r\n    status: planned\r\n    tickets:\r\n      - {key: S7-1, title: T1, club: wedge, complexity: small}\r\n';
    const patched = patchRoadmapSourceSprintText(doc, 7, { status: 'complete' });
    expect(patched).toContain('    status: complete\r\n');
    expect(patched).not.toContain('\n    status: complete\n');
  });

  it('declines flow-style sprint entries', () => {
    const doc = `version: 1
phase:
  name: P
  sprints: [7]
sprints:
  - {id: 7, theme: T, par: 3, slope: 1, type: feature, status: planned, tickets: []}
`;
    expect(patchRoadmapSourceSprintText(doc, 7, { status: 'complete' })).toBeNull();
  });

  it('declines duplicate block entries for the same id', () => {
    const doc = `version: 1
phase:
  name: P
  sprints: [7]
sprints:
  - id: 7
    theme: T
    par: 3
    slope: 1
    type: feature
    status: planned
    tickets:
      - {key: S7-1, title: T1, club: wedge, complexity: small}
  - id: 7
    theme: T2
    par: 3
    slope: 1
    type: feature
    status: planned
    tickets:
      - {key: S7-2, title: T2, club: wedge, complexity: small}
`;
    expect(patchRoadmapSourceSprintText(doc, 7, { status: 'complete' })).toBeNull();
  });

  it('declines mixed line endings rather than silently normalizing them', () => {
    const doc = 'version: 1\nphase:\r\n  name: P\n  sprints: [7]\nsprints:\n  - id: 7\n    theme: T\n    par: 3\n    slope: 1\n    type: feature\n    status: planned\n    tickets:\n      - {key: S7-1, title: T1, club: wedge, complexity: small}\n';
    expect(patchRoadmapSourceSprintText(doc, 7, { status: 'complete' })).toBeNull();
  });
});
