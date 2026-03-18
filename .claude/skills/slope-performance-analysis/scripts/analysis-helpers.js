// analysis-helpers.js — execute() snippets for performance analysis
// Paste these into execute({ code: "..." }) calls via the SLOPE MCP server.

// ── Compute handicap card ──
// Returns full handicap card with rolling stats, club performance, dispersion
const scorecards = loadScorecards();
return computeHandicapCard(scorecards);

// ── Compute dispersion report ──
// Returns miss direction distribution and dominant miss analysis
const scorecards = loadScorecards();
return computeDispersion(scorecards);

// ── Compute area performance ──
// Returns per-module performance breakdown with hazard hotspots
const scorecards = loadScorecards();
return computeAreaPerformance(scorecards);

// ── Generate training plan ──
// Returns recommended practice areas based on trends
const scorecards = loadScorecards();
return generateTrainingPlan({
  handicap: computeHandicapCard(scorecards),
  dispersion: computeDispersion(scorecards),
  recentScorecards: scorecards.slice(-5),
});

// ── Club-level miss rates ──
// Returns per-club stats from area performance
const scorecards = loadScorecards();
const area = computeAreaPerformance(scorecards);
return Object.entries(area.by_club).map(([club, stats]) => ({
  club,
  count: stats.count,
  in_the_hole_rate: stats.in_the_hole_rate,
  miss_rate: stats.miss_rate,
}));

// ── Trend detection (last 5 vs last 10) ──
const scorecards = loadScorecards();
const card = computeHandicapCard(scorecards);
const trend =
  card.last_5.handicap < card.last_10.handicap
    ? "improving"
    : card.last_5.handicap > card.last_10.handicap
      ? "worsening"
      : "stable";
return { trend, last5: card.last_5.handicap, last10: card.last_10.handicap };

// ── Per-sprint-type performance ──
const scorecards = loadScorecards();
const area = computeAreaPerformance(scorecards);
return area.by_sprint_type;

// ── Team handicap (multi-developer) ──
const scorecards = loadScorecards();
return computeTeamHandicap(scorecards);
