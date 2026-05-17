import { describe, expect, it } from 'vitest';
import { countTickets } from '../../../src/cli/guards/plan-analysis.js';

describe('countTickets', () => {
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
