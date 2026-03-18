// execute-examples.js — Composable JS snippets for execute() calls
// Each block is independent. Paste into execute({ code: "..." }).

// ── Handicap card (most common) ──
return computeHandicapCard(loadScorecards());

// ── Dispersion analysis ──
return computeDispersion(loadScorecards());

// ── Area performance with hotspot ranking ──
const area = computeAreaPerformance(loadScorecards());
return area.modules
  .filter((m) => m.hazardCount > 0)
  .sort((a, b) => b.weightedScore - a.weightedScore)
  .slice(0, 10);

// ── Validate a scorecard file ──
return validateScorecard(
  JSON.parse(readFile("docs/retros/sprint-67.json"))
);

// ── Build scorecard from shots ──
return buildScorecard({
  sprint: 67,
  title: "Sprint Title",
  theme: "theme-name",
  par: 4,
  slope: 2,
  shots: [
    { ticket: "T1", club: "short_iron", result: "green", description: "Feature" },
    { ticket: "T2", club: "wedge", result: "in_the_hole", description: "Fix" },
  ],
});

// ── Roadmap critical path ──
const raw = JSON.parse(readFile("docs/backlog/roadmap.json"));
const parsed = parseRoadmap(raw);
if (!parsed.roadmap) return { error: parsed.validation.errors };
return computeCriticalPath(parsed.roadmap);

// ── Team handicap ──
return computeTeamHandicap(loadScorecards());

// ── Formatted briefing ──
return formatBriefing({
  scorecards: loadScorecards(),
  commonIssues: JSON.parse(readFile(".slope/common-issues.json")),
});

// ── Training plan from current data ──
const scorecards = loadScorecards();
return generateTrainingPlan({
  handicapCard: computeHandicapCard(scorecards),
  recentScorecards: scorecards.slice(-5),
});

// ── Current config ──
return loadConfig();

// ── List all metaphors ──
return listMetaphors();

// ── Par and slope calculation ──
return {
  par: computePar(4),
  slope: computeSlope(["cross_package", "new_area"]),
};
