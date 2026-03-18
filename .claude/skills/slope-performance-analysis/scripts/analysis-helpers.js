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
const card = computeHandicapCard(scorecards);
return generateTrainingPlan({
  handicapCard: card,
  recentScorecards: scorecards.slice(-5),
});

// ── Hazard hotspot ranking ──
// Returns modules ranked by weighted hazard score
const scorecards = loadScorecards();
const area = computeAreaPerformance(scorecards);
return area.modules
  .filter((m) => m.hazardCount > 0)
  .sort((a, b) => b.weightedScore - a.weightedScore)
  .slice(0, 10);

// ── Trend detection (last 5 vs last 10) ──
const scorecards = loadScorecards();
const card = computeHandicapCard(scorecards);
const trend =
  card.rolling.last5 < card.rolling.last10
    ? "improving"
    : card.rolling.last5 > card.rolling.last10
      ? "worsening"
      : "stable";
return { trend, last5: card.rolling.last5, last10: card.rolling.last10 };

// ── Club success rates ──
const scorecards = loadScorecards();
const card = computeHandicapCard(scorecards);
return card.clubPerformance;

// ── Team handicap (multi-developer) ──
const scorecards = loadScorecards();
return computeTeamHandicap(scorecards);
