# Sprint 72 Plan — The Foursome v2 (Multi-Agent Session Coordination)

**Par:** 4 (4 tickets)
**Slope:** 3
**Theme:** Enhanced coordination for concurrent agent sessions

## Context

Multi-agent infrastructure already exists:
- Sessions with `swarm_id` + `agent_role` grouping
- Claims system with overlap/adjacent conflict detection (`checkConflicts`)
- Worktree isolation guard blocks unprotected concurrent access
- Compaction handoffs persist session state to disk
- MCP tools: `acquire_claim`, `check_conflicts`, `session_status`

S72 enhances this with: real-time alerts during editing, structured handoff protocol, parallel ticket orchestration, and a live dashboard.

## Tickets

### T1: Session conflict detection — real-time claim overlap alerts during editing
**Club:** short_iron
**Files:** `src/cli/guards/claim-required.ts`, `src/core/registry.ts`

Existing: `checkConflicts()` runs on claim acquisition. Missing: no real-time alerts when agents edit files in overlapping areas during a session.

**Approach:**
- Extend `claim-required` guard (fires on Edit/Write) to check for cross-session overlaps
- If current file is in an area claimed by another active session, inject warning context
- Use `store.getActiveSessions()` + `store.list(sprintNumber)` to find other agents' claims
- Warning is advisory (context only), not blocking — agents can intentionally overlap
- Skip check for same-session claims (no self-conflict)

### T2: Agent handoff protocol — structured session transfer
**Club:** long_iron
**Files:** `src/cli/commands/session.ts`, `src/core/handoff.ts` (new)

Existing: compaction guard writes handoff files on PreCompact. Missing: explicit handoff between agents (not just compaction recovery).

**Approach:**
- Add `slope session handoff --to=<session-id> [--message="context"]`
- Creates a handoff record: `{ from, to, claims, git_state, message, timestamp }`
- Transfers claims from source to target session (re-acquire under new session_id)
- Write handoff to `.slope/handoffs/transfer-{from}-{to}.json`
- Receiving agent's next guard invocation injects handoff context
- Add `slope session handoff --list` to show pending handoffs

### T3: Parallel sprint orchestration — coordinate agents on independent tickets
**Club:** long_iron
**Files:** `src/cli/commands/session.ts`

Existing: `slope loop parallel` runs sprints in worktrees. Missing: within a single sprint, assigning individual tickets to different agents.

**Approach:**
- Add `slope session assign --ticket=S72-1 --agent=<session-id>`
- Creates a ticket-level claim linked to the agent's session
- Uses existing claims system (`store.acquire`) with `session_id` metadata
- `slope session plan` shows ticket-to-agent assignment matrix for current sprint
- Validates no overlap before assigning (uses `checkConflicts`)

### T4: Agent session dashboard — live view of all active sessions
**Club:** short_iron
**Files:** `src/cli/commands/session.ts`

Existing: `slope session list` shows sessions. Missing: rich dashboard with claims, conflicts, and activity.

**Approach:**
- Add `slope session dashboard [--json]`
- Shows: active sessions (role, IDE, branch, heartbeat age)
- Per-session: claimed tickets/areas, last tool call (from transcript if available)
- Conflicts: highlighted in red
- Stale agents: flagged with warning (heartbeat > 5min)
- Swarm grouping when swarm_id present

## Review Tier

**Light** (1 round) — builds on established patterns, no new store schema.

## Dependencies

- All tickets are independent (can be worked in any order)
