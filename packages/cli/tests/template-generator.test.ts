import { describe, it, expect } from 'vitest';
import { golf, gaming } from '@slope-dev/core';
import {
  generateProjectContext,
  generateSprintChecklist,
  generateCommitDiscipline,
  generateReviewLoop,
  generateCursorSprintChecklist,
  generateCursorCommitDiscipline,
  generateCursorReviewLoop,
  generateCursorrules,
  generateGenericChecklist,
} from '../src/template-generator.js';

describe('generateProjectContext', () => {
  it('golf output contains expected terms', () => {
    const content = generateProjectContext(golf);
    expect(content).toContain('SLOPE Project');
    expect(content).toContain('handicap card');
    expect(content).toContain('pre-round briefing');
    expect(content).toContain('Pre-Hole');
    expect(content).toContain('Per-Shot');
    expect(content).toContain('Post-Hole');
    expect(content).toContain('MCP Tools');
  });

  it('gaming output uses gaming vocabulary', () => {
    const content = generateProjectContext(gaming);
    expect(content).toContain('player stats');
    expect(content).toContain('quest log');
    expect(content).toContain('Pre-Level');
    expect(content).toContain('Per-Quest');
    expect(content).toContain('Post-Level');
  });
});

describe('generateSprintChecklist', () => {
  it('golf output matches golf terminology', () => {
    const content = generateSprintChecklist(golf);
    expect(content).toContain('Pre-Hole Routine (Sprint Start)');
    expect(content).toContain('Pre-Shot Routine (Per-Ticket, Before Code)');
    expect(content).toContain('Post-Shot Routine (Per-Ticket, After Completion)');
    expect(content).toContain('Post-Hole Routine (Sprint Completion)');
    expect(content).toContain('Driver (risky/new)');
    expect(content).toContain('Long Iron (multi-package)');
    expect(content).toContain('Short Iron (standard)');
    expect(content).toContain('Wedge (small)');
    expect(content).toContain('Putter (trivial)');
    expect(content).toContain('Fairway (clean start)');
    expect(content).toContain('Green (landed correctly)');
    expect(content).toContain('In the Hole (perfect)');
    expect(content).toContain("mirroring golf's structured approach");
  });

  it('gaming output uses gaming terminology', () => {
    const content = generateSprintChecklist(gaming);
    expect(content).toContain('Pre-Level Routine (Sprint Start)');
    expect(content).toContain('Pre-Quest Routine (Per-Ticket, Before Code)');
    expect(content).toContain('Post-Quest Routine (Per-Ticket, After Completion)');
    expect(content).toContain('Post-Level Routine (Sprint Completion)');
    expect(content).toContain('Boss Fight (risky/new)');
    expect(content).toContain('Side Quest (standard)');
    expect(content).toContain('Tutorial (trivial)');
    expect(content).toContain('S-Rank (perfect)');
    expect(content).toContain('using gaming terminology');
  });

  it('contains Pre-Tournament section for all metaphors', () => {
    const golfContent = generateSprintChecklist(golf);
    const gamingContent = generateSprintChecklist(gaming);
    expect(golfContent).toContain('Pre-Tournament Routine (Course Strategy)');
    expect(gamingContent).toContain('Pre-Tournament Routine (Course Strategy)');
  });
});

describe('generateCommitDiscipline', () => {
  it('golf output references Post-Shot', () => {
    const content = generateCommitDiscipline(golf);
    expect(content).toContain('Post-Shot Routine');
    expect(content).toContain('Score the shot');
  });

  it('gaming output references Post-Quest', () => {
    const content = generateCommitDiscipline(gaming);
    expect(content).toContain('Post-Quest Routine');
    expect(content).toContain('Score the quest');
  });

  it('contains commit triggers', () => {
    const content = generateCommitDiscipline(golf);
    expect(content).toContain('Commit early, commit often');
    expect(content).toContain('Each new file');
    expect(content).toContain('Every 30 minutes');
  });
});

describe('generateReviewLoop', () => {
  it('contains review tiers', () => {
    const content = generateReviewLoop();
    expect(content).toContain('Skip');
    expect(content).toContain('Light');
    expect(content).toContain('Standard');
    expect(content).toContain('Deep');
  });
});

describe('Cursor templates', () => {
  it('cursor sprint checklist has mdc frontmatter', () => {
    const content = generateCursorSprintChecklist(golf);
    expect(content).toMatch(/^---\n/);
    expect(content).toContain('alwaysApply: true');
    expect(content).toContain('Pre-Hole Routine');
  });

  it('cursor commit discipline has mdc frontmatter', () => {
    const content = generateCursorCommitDiscipline(golf);
    expect(content).toMatch(/^---\n/);
    expect(content).toContain('alwaysApply: true');
    expect(content).toContain('Post-Shot Routine');
  });

  it('cursor review loop has alwaysApply false', () => {
    const content = generateCursorReviewLoop();
    expect(content).toContain('alwaysApply: false');
  });

  it('cursor gaming templates use gaming terms', () => {
    const checklist = generateCursorSprintChecklist(gaming);
    expect(checklist).toContain('Pre-Level Routine');
    expect(checklist).toContain('Post-Quest Routine');

    const commit = generateCursorCommitDiscipline(gaming);
    expect(commit).toContain('Post-Quest Routine');
  });
});

describe('generateCursorrules', () => {
  it('golf output contains SLOPE project context', () => {
    const content = generateCursorrules(golf);
    expect(content).toContain('SLOPE Project');
    expect(content).toContain('.cursor/mcp.json');
    expect(content).toContain('handicap card');
    expect(content).toContain('Pre-Hole');
    expect(content).toContain('Post-Hole');
    expect(content).toContain('Driver: risky');
    expect(content).toContain('Putter: trivial');
    expect(content).toContain('In the Hole: perfect');
    expect(content).toContain('.cursor/rules/');
  });

  it('gaming output uses gaming vocabulary', () => {
    const content = generateCursorrules(gaming);
    expect(content).toContain('player stats');
    expect(content).toContain('Pre-Level');
    expect(content).toContain('Post-Level');
    expect(content).toContain('Boss Fight: risky');
    expect(content).toContain('S-Rank: perfect');
  });
});

describe('generateGenericChecklist', () => {
  it('golf output contains SLOPE commands', () => {
    const content = generateGenericChecklist(golf);
    expect(content).toContain('slope briefing');
    expect(content).toContain('slope validate');
    expect(content).toContain('slope review');
    expect(content).toContain('slope card');
    expect(content).toContain('Pre-Hole (Sprint Start)');
    expect(content).toContain('Post-Hole (Sprint End)');
  });

  it('gaming output uses gaming vocabulary', () => {
    const content = generateGenericChecklist(gaming);
    expect(content).toContain('Pre-Level (Sprint Start)');
    expect(content).toContain('Post-Level (Sprint End)');
    expect(content).toContain('Boss Fight');
    expect(content).toContain('player stats');
  });
});
