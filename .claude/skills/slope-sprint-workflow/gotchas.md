# Sprint Workflow Gotchas

Top recurring hazards from 60+ sprints. Read before every sprint start.

## 1. API Shape Assumptions (common-issues #1)

**What:** Assuming property names or structure of internal APIs without reading the definition. #1 hazard source across S39-S44.

**Examples:**
- S39: Assumed nested event structure was flat — caused runtime crash
- S42: ESM/CJS boundary mismatch — import worked in tests, failed in production
- S44: HandicapCard property names guessed wrong — `handicap` vs `currentHandicap`

**Prevention:** Always LSP hover or read the source type definition before consuming any internal API. Never guess property names — verify them.

## 2. Threshold Consistency Across Consumers (common-issues #2)

**What:** Changing a default value in one consumer but not all consumers of the same pipeline.

**Examples:**
- S48: `context.ts` threshold updated to 0.4 but `enrich.ts` still used 0.55

**Prevention:** When changing a shared constant or threshold, grep for all usages across the codebase before committing.

## 3. Review-Discovered Hazards Inflate Scores (common-issues #4)

**What:** Every hazard since S43 was found by post-hole review, never during coding. The review gate works but is a trailing indicator.

**Examples:**
- S45: par -> triple+ from 2.5 hazard penalties alone, all found in review
- S49: All 3 hazards in autonomous sprint caught by manual code review

**Prevention:** Mid-ticket self-review after complex changes (driver/long_iron). Shift detection left — don't rely solely on post-hole review.

## 4. Compaction Drops Pending Protocol Gates (common-issues #7)

**What:** Advisory guard output (context messages) is lost on compaction. If the agent hasn't acted on the guidance before compaction, the obligation disappears.

**Examples:**
- S60: Post-compaction "continue without asking" instructions compounded the problem by discouraging re-checking

**Prevention:** All mandatory gates must write state to disk. Use the workflow-gate pattern: write expected state on detection, block on incomplete state at action time.

## 5. Skipping Pre-Round Routine

**What:** Jumping straight into coding without running `slope briefing` or checking the previous scorecard.

**Why it matters:** Leads to redundant work, missed hazards from prior sprints, and incorrect par/slope settings.

**Prevention:** Always run `slope briefing` before writing code. Check `docs/retros/` for the previous sprint's scorecard.

## 6. Batching Commits

**What:** Writing multiple features or files before committing.

**Why it matters:** One crash loses all progress. The last push is the recovery point.

**Prevention:** Commit after each file, each feature, each migration. Push after each ticket and every 30 minutes.

## 7. Over-Scoping Tickets

**What:** Pulling in unrelated improvements while working on a focused ticket.

**Why it matters:** Scope creep is a `right` miss direction. Inflates score and increases hazard surface.

**Prevention:** If you notice something unrelated that needs fixing, create a separate ticket. Keep the current ticket focused.
