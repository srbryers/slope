/**
 * Auto-memory capture from guard corrections and workflow outcomes.
 * Creates memories automatically with lower weight (5) and proper deduplication.
 */

import { addMemory, searchMemories, updateMemory } from './memory.js';
import type { MemoryCategory } from './memory.js';

// ── Deduplication ───────────────────────────────────

const DEDUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function isDuplicate(cwd: string, text: string): boolean {
  const recent = searchMemories(cwd, {
    query: text.slice(0, 50),
    source: 'auto-guard',
    limit: 5,
  });
  const now = Date.now();
  for (const mem of recent) {
    const age = now - new Date(mem.createdAt).getTime();
    if (age < DEDUP_WINDOW_MS && mem.text.toLowerCase().includes(text.toLowerCase().slice(0, 30))) {
      return true;
    }
  }
  return false;
}

// ── Guard Override Capture ──────────────────────────

export function captureGuardOverride(
  cwd: string,
  guardName: string,
  context: string,
): void {
  const text = `Guard override: ${guardName} — ${context}`;
  if (isDuplicate(cwd, text)) return;

  addMemory(cwd, text, {
    category: 'hazard' as MemoryCategory,
    weight: 5,
    source: 'auto-guard',
  });
}

// ── Workflow Pattern Extraction ─────────────────────

export function extractWorkflowPatterns(
  cwd: string,
  scorecard: { score_label: string; par: number; score: number; shots?: Array<{ result: string; club: string; hazards?: string[] }> },
): void {
  const patterns: Array<{ text: string; category: MemoryCategory }> = [];

  // Pattern: consistently over/under par
  if (scorecard.score > scorecard.par) {
    patterns.push({
      text: `Sprint scored ${scorecard.score} vs par ${scorecard.par} — tendency to over-scope. Consider smaller tickets or better hazard planning.`,
      category: 'workflow',
    });
  }

  // Pattern: test coverage drops on wedge tickets
  const wedgeShots = scorecard.shots?.filter(s => s.club === 'wedge' || s.club === 'putter') ?? [];
  const wedgeWithHazards = wedgeShots.filter(s => s.hazards && s.hazards.length > 0);
  if (wedgeShots.length > 0 && wedgeWithHazards.length / wedgeShots.length > 0.5) {
    patterns.push({
      text: 'Small tickets (wedge/putter) frequently hit hazards — consider adding explicit test or validation tickets.',
      category: 'workflow',
    });
  }

  // Pattern: repeated rough hazards
  const roughCount = scorecard.shots?.filter(s =>
    s.hazards?.some(h => h.toLowerCase().includes('rough')),
  ).length ?? 0;
  if (roughCount >= 2) {
    patterns.push({
      text: `Recurring 'rough' hazards in sprint — verify approach complexity before starting tickets.`,
      category: 'hazard',
    });
  }

  for (const p of patterns) {
    if (!isDuplicate(cwd, p.text)) {
      addMemory(cwd, p.text, {
        category: p.category,
        weight: 5,
        source: 'auto-workflow',
      });
    }
  }
}

// ── Repeated Guard Fire Suggestion ──────────────────

interface GuardFireRecord {
  guard: string;
  pattern: string;
  count: number;
  lastFired: string;
}

const GUARD_FIRE_LOG: Map<string, GuardFireRecord[]> = new Map();

export function recordGuardFire(
  cwd: string,
  guardName: string,
  pattern: string,
): void {
  const key = cwd;
  const records = GUARD_FIRE_LOG.get(key) ?? [];
  const existing = records.find(r => r.guard === guardName && r.pattern === pattern);

  if (existing) {
    existing.count++;
    existing.lastFired = new Date().toISOString();
    if (existing.count >= 3) {
      const text = `Guard "${guardName}" fired ${existing.count} times on pattern: ${pattern}. Consider addressing root cause.`;
      // Check for existing memory for this guard+pattern, not exact text
      const all = searchMemories(cwd, { source: 'auto-guard', limit: 20 });
      const prev = all.find(m => m.text.includes(`Guard "${guardName}"`) && m.text.includes(pattern));
      if (prev) {
        // Update existing memory instead of creating duplicate
        updateMemory(cwd, prev.id, { text });
      } else {
        addMemory(cwd, text, {
          category: 'hazard',
          weight: 5,
          source: 'auto-guard',
        });
      }
    }
  } else {
    records.push({ guard: guardName, pattern, count: 1, lastFired: new Date().toISOString() });
  }

  GUARD_FIRE_LOG.set(key, records);
}
