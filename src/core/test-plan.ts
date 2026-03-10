/**
 * Test plan parser — reads markdown test plans into structured data.
 * Write-side is intentionally omitted; the calling agent handles markdown edits.
 */

export interface TestPlanArea {
  area: string;
  status: string;
  lastTested: string;
  notes: string;
}

export interface TestPlanSection {
  name: string;
  areas: TestPlanArea[];
}

export interface TestPlanSummary {
  total: number;
  untested: number;
  passed: number;
  issues: number;
  fixed: number;
  stale: number;
  other: number;
}

export interface ParsedTestPlan {
  sections: TestPlanSection[];
  summary: TestPlanSummary;
}

/**
 * Parse a markdown test plan into structured sections.
 * Expects `## Section Name` headings followed by pipe-delimited tables
 * with columns: Area | Status | Last Tested | Notes
 */
export function parseTestPlan(markdown: string): ParsedTestPlan {
  const sections: TestPlanSection[] = [];
  const lines = markdown.split('\n');

  let currentSection: TestPlanSection | null = null;
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Section heading
    const headingMatch = trimmed.match(/^## (.+)/);
    if (headingMatch) {
      const name = headingMatch[1].trim();
      // Skip meta sections
      if (name === 'How to use this plan' || name === 'Status key' || name === 'Session Log') {
        currentSection = null;
        inTable = false;
        continue;
      }
      currentSection = { name, areas: [] };
      sections.push(currentSection);
      inTable = false;
      continue;
    }

    // Table separator row (|---|---|...)
    if (currentSection && trimmed.match(/^\|[-\s|]+\|$/)) {
      inTable = true;
      continue;
    }

    // Table header row (| Area | Status | ...) — skip
    if (currentSection && !inTable && trimmed.match(/^\|\s*Area\s*\|/i)) {
      continue;
    }

    // Table data row
    if (currentSection && inTable && trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed.split('|').map(c => c.trim()).filter(c => c.length > 0);
      if (cells.length >= 2) {
        currentSection.areas.push({
          area: cells[0] ?? '',
          status: cells[1]?.toLowerCase() ?? 'untested',
          lastTested: cells[2] ?? '—',
          notes: cells[3] ?? '',
        });
      }
      continue;
    }

    // Non-table line after table started — end the table
    if (inTable && trimmed.length > 0 && !trimmed.startsWith('|')) {
      inTable = false;
    }
  }

  return { sections, summary: getTestPlanSummary(sections) };
}

/** Compute coverage counts from parsed sections. */
export function getTestPlanSummary(sections: TestPlanSection[]): TestPlanSummary {
  const summary: TestPlanSummary = { total: 0, untested: 0, passed: 0, issues: 0, fixed: 0, stale: 0, other: 0 };

  for (const section of sections) {
    for (const area of section.areas) {
      summary.total++;
      switch (area.status) {
        case 'untested': summary.untested++; break;
        case 'passed': summary.passed++; break;
        case 'issues': summary.issues++; break;
        case 'fixed': summary.fixed++; break;
        case 'stale': summary.stale++; break;
        default: summary.other++; break;
      }
    }
  }

  return summary;
}

/** Get areas that need testing (untested, stale, or fixed-needs-retest). */
export function getAreasNeedingTest(sections: TestPlanSection[]): Array<{ section: string; area: string; status: string }> {
  const needs: Array<{ section: string; area: string; status: string }> = [];
  for (const section of sections) {
    for (const a of section.areas) {
      if (a.status === 'untested' || a.status === 'stale' || a.status === 'fixed') {
        needs.push({ section: section.name, area: a.area, status: a.status });
      }
    }
  }
  return needs;
}
