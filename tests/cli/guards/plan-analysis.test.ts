import { describe, expect, it } from 'vitest';
import { countTickets } from '../../../src/cli/guards/plan-analysis.js';

describe('countTickets', () => {
  it('counts bold bullet ticket lists (GH #634)', () => {
    // The exact shape from sprint-156-plan.md, which reported 0 tickets and
    // downgraded a Standard-tier plan to Skip.
    expect(countTickets([
      '# Sprint 156 Plan',
      '',
      '## Tickets (par 4)',
      '',
      '- **S156-1** (long_iron / multi-package): add the schema migration',
      '- **S156-2** (short_iron): wire the API surface',
      '- **S156-3** (wedge): update docs',
      '- **S156-4** (short_iron): add tests',
    ].join('\n'))).toBe(4);
  });

  it('does not inflate the count from dependency back-references (GH #634)', () => {
    expect(countTickets([
      '## Tickets',
      '- **S156-1**: first',
      '- **S156-2**: second (depends_on: S156-1)',
    ].join('\n'))).toBe(2);
  });

  it('does not treat sprint ranges as ticket keys (GH #634)', () => {
    expect(countTickets([
      '## Notes',
      'Extends the roadmap across S64-S80 with no tickets of its own.',
    ].join('\n'))).toBe(0);
  });

  it('counts H3 ticket headers', () => {
    expect(countTickets([
      '# Sprint Plan',
      '### S97-1: First ticket',
      '### S97-2: Second ticket',
    ].join('\n'))).toBe(2);
  });

  it('counts ticket rows in slope sprint plan tables', () => {
    expect(countTickets([
      '# Sprint 97 Plan',
      '',
      '## Tickets',
      '',
      '| Key | Title | Club | Complexity | Depends on |',
      '|---|---|---|---|---|',
      '| S97-1 | Teach plan-analysis ticket counting to read tables | wedge | small | — |',
      '| S97-2 | Add review recommend regression coverage | wedge | small | S97-1 |',
    ].join('\n'))).toBe(2);
  });

  it('counts decimal sprint labels in ticket table rows', () => {
    expect(countTickets([
      '| Key | Title |',
      '|---|---|',
      '| S43.5-1 | Inserted sprint ticket |',
    ].join('\n'))).toBe(1);
  });
});
