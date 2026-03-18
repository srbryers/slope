# Recommendations — From Patterns to Backlog Strategies

How to translate performance data into actionable sprint planning.

## From Handicap Trends

| Trend | Action |
|-------|--------|
| Improving (last_5 < last_10) | Maintain current approach. Reduce experimentation. Capitalize on momentum. |
| Stable (last_5 ≈ last_10) | Look for optimization opportunities in recurring patterns. Try one process experiment per sprint. |
| Worsening (last_5 > last_10) | Investigate recent changes. Check for new hazard patterns. Consider a hardening sprint. |

## From Miss Patterns

### Dominant `long` (>40%) — Over-Engineering
- Break tickets into smaller units
- Add pre-shot scope checks: "Can this be done in <50 lines?"
- Set explicit acceptance criteria that prevent gold-plating
- Consider lower club selection (short_iron instead of long_iron)

### Dominant `short` (>40%) — Incomplete Work
- Improve requirements gathering before sprint start
- Add acceptance criteria checklists to each ticket
- Do gap analysis during pre-shot: compare spec vs existing implementation
- Allocate more time for pre-shot routine

### Dominant `left` (>40%) — Wrong Approach
- More pre-shot research (read CODEBASE.md, check existing patterns)
- Consult yardage book more thoroughly
- Consider pairing on driver/long_iron tickets
- Use `search({ module: 'core', query: '<feature>' })` before writing code

### Dominant `right` (>40%) — Scope Creep
- Enforce strict ticket boundaries
- If you notice unrelated work, create a separate ticket immediately
- Use scope-drift guard to catch file-level drift
- Review ticket description before each commit: "Am I still on target?"

## From Hazard Hotspots

### Single Hazard Type
- **rough only** → Add test coverage, clarify requirements, improve docs
- **bunker only** → Architectural review needed, check for tech debt
- **water only** → External dependency audit, add retry/fallback patterns
- **trees only** → UX review, improve error messages and CLI output

### Multiple Hazard Types
The module has deeper structural issues. Before making more changes:
1. Run architect review on the module
2. Check for coupling with other modules
3. Consider a focused refactoring sprint
4. Document the module's intended architecture

### Spreading Across Modules
Pattern is systemic — the issue is process, not code:
1. Review commit discipline (are you committing often enough?)
2. Check pre-shot routine compliance (are you reading types before using them?)
3. Evaluate if the current sprint pace is sustainable
4. Consider a meta-sprint to improve tooling/process

## Backlog Strategy Selection

Based on analysis, prioritize sprint strategies:

| Priority | Strategy | Trigger |
|----------|----------|---------|
| 1 | **Hardening** | Hotspot with `weighted_score >= 3.0` |
| 2 | **Testing** | Module with `rough` hazards from missing test coverage |
| 3 | **Cleanup** | Recurring hazard pattern across 3+ sprints |
| 4 | **Documentation** | Complex modules causing `rough` from missing context |
| 5 | **Meta** | Process issues (worsening trend, systemic miss patterns) |

## Generating Training Plans

Use `generateTrainingPlan()` to get automated recommendations:
```javascript
// Via execute()
const scorecards = loadScorecards();
const card = computeHandicapCard(scorecards);
return generateTrainingPlan({
  handicapCard: card,
  recentScorecards: scorecards.slice(-5),
});
```

Training plans suggest specific practice areas based on club performance, miss patterns, and hazard trends.
