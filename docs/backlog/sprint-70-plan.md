# Sprint 70 Plan — The Replay (Session Insights & Debugging)

**Par:** 4 (4 tickets)
**Slope:** 2
**Theme:** Enhanced transcript viewing, guard decision logging, compaction tracking

## Context

Transcript infrastructure exists (`src/core/transcript.ts`, `src/cli/commands/transcript.ts`). Sessions are tracked in the store. Compaction guard writes handoffs to `.slope/handoffs/`. Guard metrics consumption (`computeGuardMetrics`) exists but there's no guard decision WRITER — only the reader.

## Tickets

### T1: Enhanced transcript viewer — filter by tool, show timing, highlight errors
**Club:** short_iron
**Files:** `src/cli/commands/transcript.ts`

`slope transcript show` already renders a table. Add:
- `--tool=Read` filter to show only specific tool calls
- `--errors` flag to show only failed turns
- Highlight error turns in red
- Show duration_ms when available

### T2: Session replay summary — auto-generate narrative
**Club:** long_iron
**Files:** `src/cli/commands/transcript.ts`

Add `slope transcript summary <session-id>`:
- Read transcript JSONL, compute: total turns, unique tools used, error count, most-used tool
- Generate one-paragraph narrative: "Session X ran N turns over Mm. Used Read (40%), Edit (30%), Bash (20%). 2 errors. Most active area: src/core/."
- `--json` flag for machine-readable output

### T3: Compaction event tracking — log what was lost and recovered
**Club:** wedge
**Files:** `src/cli/guards/compaction.ts`, `src/cli/commands/session.ts`

Compaction guard already writes handoff files. Add:
- Track compaction count per session in handoff metadata (`compaction_count`)
- `slope session compactions <session-id>` — list all handoff files for a session with summary
- Show what was preserved (git state, claims, review state) vs what was lost (context)

### T4: Guard fire log — persistent JSONL record of every guard decision
**Club:** wedge
**Files:** `src/cli/guards/transcript.ts` (or new file), `src/core/analytics.ts`

`computeGuardMetrics` reads guard decision JSONL but nothing writes it. Add:
- After each guard runs, append a line to `.slope/guard-decisions.jsonl`
- Format: `{ ts, guard, event, tool, decision }` (matches `GuardMetricLine`)
- `slope guard metrics` CLI command to display computed metrics
