# execute() Cookbook

Common patterns for the `execute()` MCP tool. Each snippet is self-contained — paste directly into `execute({ code: "..." })`.

## Scoring & Handicap

### Compute Handicap Card
```javascript
return computeHandicapCard(loadScorecards());
```

### Compute Handicap for Recent Sprints Only
```javascript
const scorecards = loadScorecards().slice(-10);
return computeHandicapCard(scorecards);
```

### Compute Dispersion Report
```javascript
return computeDispersion(loadScorecards());
```

### Compute Area Performance
```javascript
return computeAreaPerformance(loadScorecards());
```

### Generate Training Plan
```javascript
const scorecards = loadScorecards();
const card = computeHandicapCard(scorecards);
return generateTrainingPlan({
  handicapCard: card,
  recentScorecards: scorecards.slice(-5),
});
```

## Scorecard Building & Validation

### Build a Scorecard
```javascript
return buildScorecard({
  sprint: 67,
  title: "The Sprint Title",
  theme: "sprint-theme",
  par: 4,
  slope: 2,
  shots: [
    { ticket: "T1", club: "short_iron", result: "green", description: "Feature X" },
    { ticket: "T2", club: "wedge", result: "in_the_hole", description: "Config update" },
  ],
});
```

### Validate an Existing Scorecard
```javascript
const card = JSON.parse(readFile("docs/retros/sprint-67.json"));
return validateScorecard(card);
```

### Compute Stats from Shots
```javascript
const shots = [
  { ticket: "T1", club: "short_iron", result: "green" },
  { ticket: "T2", club: "wedge", result: "in_the_hole" },
  { ticket: "T3", club: "long_iron", result: "green", hazards: [{ type: "rough", description: "API shape mismatch" }] },
];
return computeStatsFromShots(shots);
```

## Roadmap Analysis

### Parse and Validate Roadmap
```javascript
const raw = JSON.parse(readFile("docs/backlog/roadmap.json"));
const result = parseRoadmap(raw);
if (!result.roadmap) return { error: result.validation.errors };
return { valid: true, sprints: result.roadmap.sprints.length };
```

### Compute Critical Path
```javascript
const raw = JSON.parse(readFile("docs/backlog/roadmap.json"));
const { roadmap } = parseRoadmap(raw);
if (!roadmap) return { error: "Invalid roadmap" };
return computeCriticalPath(roadmap);
```

### Find Parallel Opportunities
```javascript
const raw = JSON.parse(readFile("docs/backlog/roadmap.json"));
const { roadmap } = parseRoadmap(raw);
if (!roadmap) return { error: "Invalid roadmap" };
return findParallelOpportunities(roadmap);
```

### Format Strategic Context
```javascript
const raw = JSON.parse(readFile("docs/backlog/roadmap.json"));
const { roadmap } = parseRoadmap(raw);
if (!roadmap) return { error: "Invalid roadmap" };
return formatStrategicContext(roadmap, 67);
```

## Team & Multi-Developer

### Compute Team Handicap
```javascript
return computeTeamHandicap(loadScorecards());
```

### Build Leaderboard
```javascript
return buildLeaderboard(loadScorecards());
```

### Extract Player Handicaps
```javascript
return computePlayerHandicaps(loadScorecards());
```

## Briefing & Hazards

### Format Full Briefing
```javascript
const scorecards = loadScorecards();
const commonIssues = JSON.parse(readFile(".slope/common-issues.json"));
return formatBriefing({ scorecards, commonIssues });
```

### Extract Hazard Index
```javascript
return extractHazardIndex(loadScorecards());
```

### Filter Common Issues by Category
```javascript
const issues = JSON.parse(readFile(".slope/common-issues.json"));
return filterCommonIssues(issues, { categories: ["types", "process"] });
```

## Standup & Communication

### Generate Standup Report
```javascript
// Requires store-backed session data
return generateStandup({
  sessionId: "current",
  events: [],
  claims: [],
});
```

## Configuration & Setup

### Load Current Config
```javascript
return loadConfig();
```

### List Available Metaphors
```javascript
return listMetaphors();
```

### Check Flow Staleness
```javascript
const flows = loadFlows(".slope/flows.json");
if (!flows) return { error: "No flows file" };
return flows.flows.map(f => ({
  id: f.id,
  title: f.title,
}));
```
