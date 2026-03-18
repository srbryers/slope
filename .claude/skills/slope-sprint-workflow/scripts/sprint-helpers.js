// sprint-helpers.js — execute() snippets for sprint workflow
// Paste these into execute({ code: "..." }) calls via the SLOPE MCP server.

// ── Validate a scorecard ──
// Returns validation result with errors and warnings
return validateScorecard(
  JSON.parse(readFile("docs/retros/sprint-N.json"))
);

// ── Load briefing data ──
// Returns formatted briefing string with handicap, hazards, nutrition
const scorecards = loadScorecards();
const config = loadConfig();
const commonIssues = JSON.parse(
  readFile(".slope/common-issues.json")
);
return formatBriefing({
  scorecards,
  commonIssues,
  filter: { categories: ["types", "process"] },
});

// ── Check branch hygiene ──
// Returns list of branches (use to identify stale ones)
return listFiles(".git/refs/heads").map((f) => f.replace(".git/refs/heads/", ""));

// ── Compute par and slope ──
const ticketCount = 4;
const slopeFactors = ["cross_package", "new_area"];
return {
  par: computePar(ticketCount),
  slope: computeSlope(slopeFactors),
};

// ── Build a scorecard from shots ──
const scorecard = buildScorecard({
  sprint: 67,
  title: "The Sprint Title",
  theme: "sprint-theme",
  par: 4,
  slope: 2,
  shots: [
    {
      ticket: "T1",
      club: "short_iron",
      result: "green",
      description: "Implement feature X",
    },
    {
      ticket: "T2",
      club: "wedge",
      result: "in_the_hole",
      description: "Update config",
    },
  ],
});
return scorecard;

// ── Extract hazard index for briefing ──
const scorecards = loadScorecards();
return extractHazardIndex(scorecards, "types");

// ── Recommend reviews for current sprint ──
// Pass the scorecard to get review type recommendations
const card = JSON.parse(readFile("docs/retros/sprint-67.json"));
return recommendReviews({
  scorecard: card,
  ticketCount: 4,
  hasSchemaChanges: false,
  hasSecurityChanges: false,
});
