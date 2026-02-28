# Slope Self-Development Loop — Mac Studio Plan

## Overview

This plan sets up an autonomous development loop where LLMs work through sprints on Slope's own codebase — scored by Slope itself. The loop uses a **tiered model strategy** that matches model capability to ticket complexity, just like choosing the right golf club for each shot:

- **Putter/Wedge tickets** → Qwen 2.5 Coder 32B (local, free, fast)
- **Short Iron tickets** → Qwen 32B or MiniMax M2.5 API (flex based on scope)
- **Long Iron/Driver tickets** → MiniMax M2.5 via API (architect-level planning, SWE-bench SOTA)

With 40 sprints of existing scorecard data, the loop is data-driven from day one: the backlog is generated from real miss patterns, hazard frequencies, and handicap trends rather than hand-written tickets. The tiered approach means complex tickets that previously required cloud Claude can now be attempted by M2.5 at a fraction of the cost.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      Mac Studio M3 Ultra                      │
│                                                               │
│  ┌──────────────┐   ┌──────────┐   ┌────────────────────┐    │
│  │    Ollama     │   │  Aider   │   │       Slope        │    │
│  │ (Qwen 32B)   │◄─►│  (agent) │◄─►│  (harness + data)  │    │
│  │ LOCAL / FREE  │   │          │   └────────────────────┘    │
│  └──────────────┘   │          │         │         │          │
│                      │          │         ▼         ▼          │
│  ┌──────────────┐   │          │   ┌───────────┐ ┌────────┐  │
│  │  MiniMax M2.5 │◄─►│          │   │Scorecards │ │Backlog │  │
│  │    (API)      │   └──────────┘   │ (40 + new)│ │ (auto) │  │
│  │ LONG/DRIVER   │                  └───────────┘ └────────┘  │
│  │ ~$0.30/$1.20  │                        │                   │
│  │  per M tokens │                        │                   │
│  └──────────────┘                         │                   │
│                                           │                   │
│  ┌────────────────────────────────────────┘                   │
│  │  slope-loop (mine → plan → select model → execute → score) │
│  └────────────────────────────────────────────────────────────│
└──────────────────────────────────────────────────────────────┘
```

**Components:**
- **Ollama + Qwen 2.5 Coder 32B** — local model for putter/wedge/short_iron tickets (free, fast, ~25GB)
- **MiniMax M2.5 API** — remote model for long_iron/driver tickets (SWE-bench SOTA, architect-level planning, $0.30/$1.20 per M tokens)
- **Aider** — open-source AI coding agent that supports both Ollama and OpenAI-compatible APIs
- **Slope CLI** — `@slope-dev/slope` (v1.13.1+) — 30 commands including `slope card`, `slope briefing`, `slope auto-card`, `slope session`, `slope dashboard`, `slope review`
- **Slope MCP Server** — exposes Slope commands as MCP tools via `.mcp.json` in repo root
- **Slope Guard Hooks** — 16 built-in hooks (`.claude/hooks/`) inject real-time guidance into agent context during sessions
- **Slope Agent Skills** — portable skill packages following the Anthropic Agent Skills spec (`SKILL.md` + YAML frontmatter). These package Slope's workflow knowledge so it works across claude.ai, Claude Code, the API, and any platform that supports the open standard — not just Claude Code's hooks.
- **Slope Semantic Index** — embedding-based codebase index using `nomic-embed-text` (137M params, ~270MB via Ollama). Powers `slope context` (file retrieval), `slope prep` (structured execution plans), and `slope enrich` (backlog pre-computation). Eliminates the repo map from Aider invocations, saving 30-50% of tokens per ticket.
- **slope-loop** — orchestrates the full cycle: analyze data → enrich backlog → select model per ticket → pre-compute context → execute → score

**Important: Existing repo structure.** The Slope repo already has `CLAUDE.md`, `.claude/rules/`, `.claude/hooks/`, `.cursor/rules/`, `.mcp.json`, and `CODEBASE.md`. The loop must work WITH these — not replace them. The plan adds two new layers:
1. **Official Slope skills** (`skills/`) — portable workflow packages that enhance the MCP server with domain intelligence. These follow the Agent Skills spec and work on any platform.
2. **Loop-specific agent guide** (`slope-loop/slope-loop-guide/SKILL.md`) — an auto-evolving skill that accumulates institutional knowledge from automated sprints. Packaged as a proper skill with progressive disclosure so it can be used in claude.ai, the API, or injected into Aider.

**Why two models:**
The 40 sprints of existing data already tell you which ticket complexities succeed and which fail. Simple tickets (putter/wedge) don't need a 230B model — Qwen 32B handles them well and runs locally for free. But complex tickets (long_iron/driver) benefit from M2.5's architect-level planning, where it decomposes features and writes specs before coding. At $0.30/$1.20 per M tokens, running a driver ticket through M2.5 costs ~$2-4 per complex ticket (M2.5 is verbose — expect 1.5-3M tokens per driver ticket, not 500K) — still far cheaper than cloud Claude's ~$7.50+ — while achieving comparable SWE-bench scores.

**MiniMax M2.5 key stats:**
- 230B total params, 10B active per token (MoE architecture)
- 80.2% SWE-Bench Verified (comparable to Claude Opus)
- Trained on 200K+ real-world coding environments across 10+ languages including TypeScript
- "Spec-writing" behavior: decomposes and plans before coding
- 37% faster task completion than M2.1
- MIT licensed, open weights

---

## Phase 1: Mac Studio Setup

### 1.1 Install Ollama

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull the recommended model for coding tasks
# Qwen 2.5 Coder 32B at Q6 — ~25GB, leaves plenty of headroom
ollama pull qwen2.5-coder:32b

# Smaller model for fast iteration / parallel work
ollama pull qwen2.5-coder:14b

# Embedding model for semantic codebase index (Phase 4.7)
# Tiny (137M params, ~270MB) — runs alongside Qwen with negligible overhead
ollama pull nomic-embed-text

# Verify
ollama list
```

**Why Qwen 2.5 Coder 32B (for putter/wedge/short_iron):**
- Specifically trained for code generation and editing
- 32B fits easily in 96GB with room for a second model
- At Q6 quantization, quality loss is minimal
- Benchmarks well against GPT-4 on coding tasks
- Fast inference on M3 Ultra at 819 GB/s bandwidth
- Free — zero marginal cost per ticket

### 1.2 Configure MiniMax M2.5 API

MiniMax M2.5 is the heavy hitter for complex tickets. At 230B params (10B active), it hits 80.2% on SWE-Bench Verified with architect-level planning. The 3-bit GGUF is ~101GB which won't fit on 96GB, but the API is extremely cheap.

**Option A: MiniMax Direct API (cheapest)**

```bash
# Sign up at https://www.minimax.io and get an API key
export MINIMAX_API_KEY="your-key-here"

# Test via curl (OpenAI-compatible endpoint)
curl https://api.minimax.io/v1/chat/completions \
  -H "Authorization: Bearer $MINIMAX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MiniMax-M2.5",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

**Option B: OpenRouter (more flexible, slightly higher cost)**

```bash
# Sign up at https://openrouter.ai and get an API key
export OPENROUTER_API_KEY="your-key-here"

# OpenRouter provides an OpenAI-compatible endpoint
# which Aider supports natively
```

**Option C: Ollama Cloud Proxy (simplest)**

```bash
# Ollama now supports cloud model proxying
# This routes through MiniMax's API but uses Ollama's interface
ollama run minimax-m2.5:cloud "Hello"
```

**Pricing comparison (per complex ticket, estimated ~1.5-3M tokens — M2.5 is verbose):**
- MiniMax Direct: ~$0.45-$0.90 input + ~$1.80-$3.60 output = **~$2-4 per ticket**
- OpenRouter: slightly higher markup but same ballpark
- Cloud Claude (Opus): ~$7.50+ per ticket
- Local Qwen 32B: **$0.00 per ticket**

At ~$3 per complex ticket, you can run 25 driver-level tickets for the price of 10 on cloud Claude. M2.5's verbosity (3.7x typical model output) is the trade-off for its spec-writing planning behavior.

**Why M2.5 for driver/long_iron tickets specifically:**
- Spec-writing behavior: decomposes features before coding (critical for multi-file changes)
- Trained on TypeScript, vitest, and complex repo structures
- 37% faster than M2.1 while using fewer tokens
- Multi-file edit capability that smaller models lack
- Recovers from execution errors in code-run-fix loops

### 1.3 Install Aider

```bash
pip install aider-chat

# Default aider config (uses local Qwen for most work)
cat > ~/.aider.conf.yml << 'EOF'
model: ollama/qwen2.5-coder:32b
auto-commits: true
auto-test: true
test-cmd: pnpm test
lint-cmd: pnpm typecheck
EOF

# Aider supports switching models per-invocation via --model flag
# The runner script will select the model based on ticket club:
#   putter/wedge/short_iron → ollama/qwen2.5-coder:32b (local)
#   long_iron/driver        → openrouter/minimax/minimax-m2.5 (API)
#
# For OpenRouter, set: export OPENROUTER_API_KEY="your-key-here"
# Aider auto-detects OpenRouter models with the openrouter/ prefix
```

**Why Aider:**
- Supports Ollama natively — no API keys needed for local model
- Supports OpenAI-compatible APIs — works with OpenRouter/MiniMax for M2.5
- Can switch models per invocation with `--model` flag (key for tiered strategy)
- CLI-based — can be scripted and automated
- Handles file editing with proper diffs
- Auto-commits with meaningful messages
- Has `--message` flag for non-interactive use (key for automation)

### 1.4 Verify Slope is ready

```bash
cd ~/projects/slope
pnpm install && pnpm build
pnpm test               # everything passes
pnpm typecheck           # strict TypeScript checks

# Verify CLI works
slope card               # see current handicap from 40+ sprints
slope briefing           # pre-sprint hazard index, known gotchas
slope next               # next sprint number
slope dashboard          # live performance dashboard

# Verify existing platform configs are intact
cat CLAUDE.md            # should exist — agent guidance for Claude Code
ls .claude/rules/        # platform-specific rules
ls .claude/hooks/        # 16 guard hooks for real-time guidance
cat .mcp.json            # MCP server config
cat CODEBASE.md          # auto-generated codebase map

# Verify SQLite store health
slope store status
```

**Key repo structure (already present — do not overwrite):**
- `CLAUDE.md` — agent guidance for Claude Code (leave as-is)
- `.claude/rules/` — platform rules (leave as-is)
- `.claude/hooks/` — 16 guard hooks (leave as-is)
- `.mcp.json` — MCP server configuration (leave as-is)
- `CODEBASE.md` — auto-generated codebase map
- `.slope/` — Slope data directory (scorecards, config, SQLite store)

---

## Phase 2: Mine the Existing Data

This is the critical step. Before any autonomous work begins, extract actionable intelligence from 40 sprints of real performance data.

### 2.1 Create the analysis script

Create `slope-loop/analyze.ts`:

```typescript
#!/usr/bin/env npx tsx
/**
 * analyze.ts — Mine 40 sprints of scorecard data to generate
 * a prioritized backlog for the autonomous loop.
 *
 * Outputs:
 *   - slope-loop/analysis.json    (raw analysis)
 *   - slope-loop/backlog.json     (generated sprint backlog)
 *
 * Run: npx tsx slope-loop/analyze.ts
 */

import {
  loadScorecards,
  computeHandicapCard,
  computeDispersion,
} from '@slope-dev/slope';
import { writeFileSync } from 'fs';
import { join } from 'path';

const OUTPUT_DIR = join(__dirname);

async function analyze() {
  // ─── Load all scorecard data ───────────────────
  const scorecards = await loadScorecards();
  const handicap = computeHandicapCard(scorecards);
  const dispersion = computeDispersion(scorecards);

  console.log(`\nLoaded ${scorecards.length} scorecards\n`);

  // ─── 1. Hazard frequency analysis ─────────────
  // Which hazard types appear most often?
  const hazardCounts: Record<string, number> = {};
  const hazardByModule: Record<string, Record<string, number>> = {};

  for (const card of scorecards) {
    for (const shot of card.shots || []) {
      for (const hazard of shot.hazards || []) {
        const type = hazard.type || hazard;
        hazardCounts[type] = (hazardCounts[type] || 0) + 1;

        // Track which modules/areas hazards cluster in
        const area = shot.target || shot.title || 'unknown';
        if (!hazardByModule[area]) hazardByModule[area] = {};
        hazardByModule[area][type] = (hazardByModule[area][type] || 0) + 1;
      }
    }
  }

  // ─── 2. Miss pattern analysis ──────────────────
  // Which miss directions are most common?
  const missCounts: Record<string, number> = {};
  const missByClub: Record<string, Record<string, number>> = {};

  for (const card of scorecards) {
    for (const shot of card.shots || []) {
      if (shot.miss_direction && shot.miss_direction !== 'none') {
        missCounts[shot.miss_direction] = (missCounts[shot.miss_direction] || 0) + 1;

        const club = shot.club || 'unknown';
        if (!missByClub[club]) missByClub[club] = {};
        missByClub[club][shot.miss_direction] =
          (missByClub[club][shot.miss_direction] || 0) + 1;
      }
    }
  }

  // ─── 3. Score distribution ─────────────────────
  // How often do we par, birdie, bogey?
  const scoreDist: Record<string, number> = {};
  for (const card of scorecards) {
    const label = card.score_label || card.score_vs_par || 'unknown';
    scoreDist[label] = (scoreDist[label] || 0) + 1;
  }

  // ─── 4. Club success rates ─────────────────────
  // Which clubs (complexity levels) succeed vs fail?
  const clubResults: Record<string, { total: number; success: number }> = {};
  for (const card of scorecards) {
    for (const shot of card.shots || []) {
      const club = shot.club || 'unknown';
      if (!clubResults[club]) clubResults[club] = { total: 0, success: 0 };
      clubResults[club].total++;
      if (['green', 'in_the_hole', 'fairway'].includes(shot.result || '')) {
        clubResults[club].success++;
      }
    }
  }

  // ─── 5. Recurring hazards (same hazard 3+ times) ─
  const recurringHazards = Object.entries(hazardCounts)
    .filter(([_, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1]);

  // ─── 6. Hotspot modules ────────────────────────
  // Areas with the most hazards and misses
  const moduleRisk: Record<string, number> = {};
  for (const [area, hazards] of Object.entries(hazardByModule)) {
    moduleRisk[area] = Object.values(hazards).reduce((a, b) => a + b, 0);
  }
  const hotspots = Object.entries(moduleRisk)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // ─── Build analysis output ─────────────────────

  const analysis = {
    generated_at: new Date().toISOString(),
    sprint_count: scorecards.length,
    handicap: {
      current: handicap.current,
      trend: handicap.trend,
      last_5: handicap.last5,
      last_10: handicap.last10,
      all_time: handicap.allTime,
    },
    hazards: {
      frequency: hazardCounts,
      by_module: hazardByModule,
      recurring: recurringHazards,
    },
    misses: {
      frequency: missCounts,
      by_club: missByClub,
    },
    scores: scoreDist,
    clubs: clubResults,
    hotspots,
    dispersion,
  };

  writeFileSync(
    join(OUTPUT_DIR, 'analysis.json'),
    JSON.stringify(analysis, null, 2)
  );

  console.log('═══ Analysis Summary ═══\n');
  console.log(`Sprints analyzed: ${scorecards.length}`);
  console.log(`Current handicap: ${handicap.current} (${handicap.trend})`);
  console.log(`\nTop recurring hazards:`);
  for (const [type, count] of recurringHazards.slice(0, 5)) {
    console.log(`  ${type}: ${count} occurrences`);
  }
  console.log(`\nHotspot areas:`);
  for (const [area, risk] of hotspots.slice(0, 5)) {
    console.log(`  ${area}: risk score ${risk}`);
  }
  console.log(`\nClub success rates:`);
  for (const [club, data] of Object.entries(clubResults)) {
    const pct = Math.round((data.success / data.total) * 100);
    console.log(`  ${club}: ${pct}% (${data.success}/${data.total})`);
  }
  console.log(`\nMiss patterns:`);
  for (const [dir, count] of Object.entries(missCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${dir}: ${count}`);
  }

  console.log(`\nFull analysis: slope-loop/analysis.json`);

  // ─── Generate backlog from analysis ────────────

  await generateBacklog(analysis);
}

async function generateBacklog(analysis: any) {
  /**
   * Backlog generation strategy:
   *
   * 1. HARDENING sprints — target hotspot modules with most hazards
   * 2. TEST sprints — add coverage where misses cluster
   * 3. CLEANUP sprints — address recurring hazards (tech debt, known gotchas)
   * 4. DOCUMENTATION sprints — areas with high complexity (driver/long_iron clubs)
   * 5. META sprints — use the dataset to improve Slope itself
   *
   * Ticket scoping rules:
   * - Club assignment based on historical success rates
   * - If local model's success rate on short_iron < 60%, scope down to wedge
   * - Each ticket targets ONE module/file
   * - Acceptance criteria always includes pnpm test
   */

  const sprints: any[] = [];
  let sprintCounter = analysis.sprint_count + 1; // Continue from existing count

  // ─── Strategy 1: Harden hotspot modules ────────
  const topHotspots = analysis.hotspots.slice(0, 3);
  if (topHotspots.length > 0) {
    sprints.push({
      id: `S-LOCAL-${String(sprintCounter).padStart(3, '0')}`,
      title: `Harden top hotspot modules`,
      strategy: 'hardening',
      par: Math.min(topHotspots.length + 1, 5),
      source: 'Derived from hazard frequency analysis — these modules have the most recurring issues',
      tickets: topHotspots.map((
        [area, risk]: [string, number],
        i: number
      ) => ({
        id: `S-LOCAL-${String(sprintCounter).padStart(3, '0')}-${i + 1}`,
        title: `Add defensive checks and error handling to ${area}`,
        description: `Module "${area}" has a risk score of ${risk} based on hazard frequency. Add input validation, null checks, error boundaries, and defensive patterns. Focus on the specific hazard types that appear most in this area: ${
          Object.entries(analysis.hazards.by_module[area] || {})
            .sort((a: any, b: any) => b[1] - a[1])
            .map(([type, count]: [string, any]) => `${type} (${count}x)`)
            .join(', ')
        }`,
        club: 'short_iron',
        acceptance: 'pnpm test passes, no new hazards introduced, defensive checks added'
      })),
    });
    sprintCounter++;
  }

  // ─── Strategy 2: Test coverage for miss-heavy areas ─
  const topMisses = Object.entries(analysis.misses.frequency)
    .sort((a: any, b: any) => b[1] - a[1])
    .slice(0, 3);

  if (topMisses.length > 0) {
    sprints.push({
      id: `S-LOCAL-${String(sprintCounter).padStart(3, '0')}`,
      title: `Improve test coverage for high-miss areas`,
      strategy: 'testing',
      par: 3,
      source: `Derived from miss pattern analysis — most common miss directions: ${
        topMisses.map(([dir, count]) => `${dir} (${count}x)`).join(', ')
      }`,
      tickets: [
        {
          id: `S-LOCAL-${String(sprintCounter).padStart(3, '0')}-1`,
          title: 'Add edge case tests for most-missed scenarios',
          description: `The most common miss direction is "${topMisses[0][0]}" (${topMisses[0][1]} times). This typically indicates ${
            topMisses[0][0] === 'long' ? 'over-engineering — add tests that verify minimal implementation' :
            topMisses[0][0] === 'short' ? 'under-implementation — add tests that catch missing functionality' :
            topMisses[0][0] === 'left' ? 'wrong approach — add tests that verify correct patterns are used' :
            'inconsistency — add tests that enforce consistent behavior'
          }. Find the modules where this miss type is most common and add targeted test cases.`,
          club: 'wedge',
          acceptance: 'pnpm test passes, new tests specifically cover the identified miss pattern'
        },
        {
          id: `S-LOCAL-${String(sprintCounter).padStart(3, '0')}-2`,
          title: 'Add regression tests for recurring hazards',
          description: `These hazards have appeared 3+ times: ${
            analysis.hazards.recurring
              .slice(0, 5)
              .map(([type, count]: [string, number]) => `${type} (${count}x)`)
              .join(', ')
          }. For each recurring hazard, add a test that would catch it if it reappears. The test should fail if the hazard condition is reintroduced.`,
          club: 'short_iron',
          acceptance: 'pnpm test passes, regression tests exist for top 5 recurring hazards'
        },
        {
          id: `S-LOCAL-${String(sprintCounter).padStart(3, '0')}-3`,
          title: 'Add property-based tests for scoring math',
          description: 'The scoring engine (buildScorecard, computeHandicapCard) should have property-based tests verifying invariants: handicap is always >= 0, par is always 3-5, scores are bounded, dispersion percentages sum to 100. Use vitest with fast-check or similar.',
          club: 'short_iron',
          acceptance: 'pnpm test passes, property-based tests exist for core scoring invariants'
        },
      ],
    });
    sprintCounter++;
  }

  // ─── Strategy 3: Address recurring hazards ─────
  const topRecurring = analysis.hazards.recurring.slice(0, 4);
  if (topRecurring.length > 0) {
    sprints.push({
      id: `S-LOCAL-${String(sprintCounter).padStart(3, '0')}`,
      title: `Resolve top recurring hazards`,
      strategy: 'cleanup',
      par: Math.min(topRecurring.length, 4),
      source: 'Derived from recurring hazard analysis — these keep appearing sprint after sprint',
      tickets: topRecurring.map((
        [type, count]: [string, number],
        i: number
      ) => ({
        id: `S-LOCAL-${String(sprintCounter).padStart(3, '0')}-${i + 1}`,
        title: `Resolve recurring "${type}" hazard`,
        description: `The "${type}" hazard has appeared ${count} times across ${analysis.sprint_count} sprints. Investigate the root cause by examining recent scorecards where this hazard appeared. Apply a fix that prevents it from recurring. ${
          type === 'bunker' ? 'Bunkers are known gotchas — look for TODO comments, fragile assumptions, or undocumented edge cases.' :
          type === 'water' ? 'Water hazards are breaking changes — look for missing migration logic, backwards-incompatible interfaces, or untested upgrade paths.' :
          type === 'rough' ? 'Rough is tech debt — look for duplicated code, poor abstractions, or missing types.' :
          type === 'trees' ? 'Trees are blockers — look for external dependencies, missing configs, or environment assumptions.' :
          'Investigate the pattern and apply a targeted fix.'
        }`,
        club: 'short_iron',
        acceptance: `pnpm test passes, root cause documented, fix applied, hazard should not recur`
      })),
    });
    sprintCounter++;
  }

  // ─── Strategy 4: Documentation for complex areas ─
  const complexClubs = ['driver', 'long_iron'];
  const complexAreas: string[] = [];
  for (const club of complexClubs) {
    if (analysis.clubs[club]) {
      const pct = (analysis.clubs[club].success / analysis.clubs[club].total) * 100;
      if (pct < 70) complexAreas.push(club);
    }
  }

  if (complexAreas.length > 0) {
    sprints.push({
      id: `S-LOCAL-${String(sprintCounter).padStart(3, '0')}`,
      title: `Document high-complexity areas`,
      strategy: 'documentation',
      par: 3,
      source: `Derived from club success rates — ${complexAreas.join(', ')} complexity tickets have low success rates, indicating these areas need better documentation for agents`,
      tickets: [
        {
          id: `S-LOCAL-${String(sprintCounter).padStart(3, '0')}-1`,
          title: 'Add architecture decision records for complex modules',
          description: 'Create docs/adr/ directory with ADR files for the most complex parts of the codebase. Each ADR should explain: context, decision, consequences, and known gotchas. Focus on modules that historically use driver or long_iron clubs.',
          club: 'wedge',
          acceptance: 'ADR files exist in docs/adr/, cover the most complex modules'
        },
        {
          id: `S-LOCAL-${String(sprintCounter).padStart(3, '0')}-2`,
          title: 'Add inline documentation for scoring engine internals',
          description: 'The scoring engine is the most critical module. Add comprehensive JSDoc comments to all internal (non-exported) functions. Include @internal tags, algorithm explanations, and edge case notes.',
          club: 'putter',
          acceptance: 'pnpm typecheck passes, all scoring internals have JSDoc'
        },
        {
          id: `S-LOCAL-${String(sprintCounter).padStart(3, '0')}-3`,
          title: 'Update loop skill with hazard-informed guidance',
          description: `Update slope-loop/slope-loop-guide/SKILL.md with guidance derived from ${analysis.sprint_count} sprints of data. Include: top recurring hazards in Known Hazards section, modules that need extra care, common miss patterns and their causes. This file follows the Agent Skills spec and is injected via Aider --read flag. Keep under 5000 words — detailed history goes in references/sprint-history.md.`,
          club: 'wedge',
          acceptance: 'slope-loop/slope-loop-guide/SKILL.md updated with data-driven guidance, under 5000 words, YAML frontmatter intact'
        },
      ],
    });
    sprintCounter++;
  }

  // ─── Strategy 5: Slope meta-improvement ────────
  sprints.push({
    id: `S-LOCAL-${String(sprintCounter).padStart(3, '0')}`,
    title: `Meta: Improve Slope based on ${analysis.sprint_count}-sprint dataset`,
    strategy: 'meta',
    par: 3,
    source: 'Meta-improvement — use the dataset to make the framework better',
    tickets: [
      {
        id: `S-LOCAL-${String(sprintCounter).padStart(3, '0')}-1`,
        title: 'Add data export for marketing site',
        description: 'Create a slope export command (or extend existing CLI) that outputs a sanitized JSON summary of aggregate stats suitable for the getslope.dev marketing site. Include: total sprints, estimation accuracy, delivery accuracy, performance index, trend direction, and top improvement areas. No raw scorecard data — just aggregate metrics.',
        club: 'short_iron',
        acceptance: 'pnpm test passes, export command produces valid JSON with aggregate stats'
      },
      {
        id: `S-LOCAL-${String(sprintCounter).padStart(3, '0')}-2`,
        title: 'Add automatic backlog suggestion command',
        description: 'Create a slope suggest command that reads existing scorecards and outputs suggested next tickets based on: recurring hazards, miss patterns, low-success-rate complexity levels, and hotspot modules. This is essentially a productized version of the analyze.ts script.',
        club: 'short_iron',
        acceptance: 'pnpm test passes, slope suggest outputs actionable ticket suggestions'
      },
      {
        id: `S-LOCAL-${String(sprintCounter).padStart(3, '0')}-3`,
        title: 'Add handicap prediction',
        description: 'Extend computeHandicapCard to include a projected_handicap field based on the current trend. Use a simple linear regression over the last 10 sprints to predict where the handicap will be in 5 sprints. Include confidence bounds.',
        club: 'short_iron',
        acceptance: 'pnpm test passes, handicap card includes projected_handicap with bounds'
      },
    ],
  });

  const backlog = {
    generated_at: new Date().toISOString(),
    generated_from: `${analysis.sprint_count} sprints of scorecard data`,
    current_handicap: analysis.handicap.current,
    handicap_trend: analysis.handicap.trend,
    generation_strategy: [
      'hardening — target modules with highest hazard density',
      'testing — cover areas where misses cluster',
      'cleanup — resolve hazards that keep recurring',
      'documentation — improve guidance for high-complexity areas',
      'meta — use the dataset to improve Slope itself',
    ],
    sprints,
  };

  writeFileSync(
    join(OUTPUT_DIR, 'backlog.json'),
    JSON.stringify(backlog, null, 2)
  );

  console.log(`\n═══ Backlog Generated ═══`);
  console.log(`Sprints: ${sprints.length}`);
  console.log(`Total tickets: ${sprints.reduce((sum: number, s: any) => sum + s.tickets.length, 0)}`);
  console.log(`Strategies: ${sprints.map((s: any) => s.strategy).join(', ')}`);
  console.log(`\nFull backlog: slope-loop/backlog.json`);
}

analyze().catch(console.error);
```

### 2.2 Run the analysis

```bash
cd ~/projects/slope
npx tsx slope-loop/analyze.ts
```

This produces two files:
- `slope-loop/analysis.json` — raw data: hazard frequencies, miss patterns, club success rates, hotspot modules
- `slope-loop/backlog.json` — generated sprint backlog with 4-5 sprints, each traceable back to the data that motivated it

### 2.3 Review and adjust

Before running the autonomous loop, review the generated backlog:

```bash
# Pretty-print the backlog
cat slope-loop/backlog.json | jq '.sprints[] | {id, title, strategy, ticket_count: (.tickets | length)}'
```

**Enrich tickets with routing signals.** The runner uses `max_files` and `modules` fields for intelligent model selection and parallel overlap detection. Add these to each ticket in `backlog.json`:

```json
{
  "id": "S-LOCAL-041-1",
  "title": "Add defensive checks to scoring engine",
  "club": "short_iron",
  "max_files": 2,
  "modules": ["src/scoring"],
  "description": "...",
  "acceptance": "..."
}
```

- `max_files` (number): Estimated files this ticket will touch. If ≥ 3, the runner auto-routes to M2.5 regardless of club. Default: 1.
- `modules` (string[]): Source directories this ticket affects. Used by `parallel.sh` to detect overlap between parallel sprints. Example: `["src/scoring", "src/cli"]`.

The `analyze.ts` script can estimate these from the scorecard data (which modules had hazards for this type of ticket), or you can add them manually during review.

Adjust anything that doesn't look right. The analysis script makes reasonable guesses, but you know the codebase — if it's suggesting hardening a module you just rewrote, remove that ticket. If it's missing something obvious, add it.

**This review step is important.** The analysis script generates tickets; your judgment filters them. This is the "Cloud Claude is the architect, local model is the laborer" principle in action.

---

## Phase 3: The Runner Script

### 3.1 Single sprint runner

Create `slope-loop/run.sh`:

```bash
#!/bin/bash
# slope-loop/run.sh — Run a single sprint from the generated backlog
# Usage: ./slope-loop/run.sh [sprint-id]
# If no sprint-id, picks the next unscored sprint

set -euo pipefail

SLOPE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKLOG="$SLOPE_DIR/slope-loop/backlog.json"
RESULTS_DIR="$SLOPE_DIR/slope-loop/results"
LOG_DIR="$SLOPE_DIR/slope-loop/logs"
AGENT_GUIDE="$SLOPE_DIR/slope-loop/slope-loop-guide/SKILL.md"
SPRINT_HISTORY="$SLOPE_DIR/slope-loop/slope-loop-guide/references/sprint-history.md"
BRANCH_PREFIX="slope-loop"

# ─── Model Tier Configuration ─────────────────────
# Match model capability to ticket complexity (like choosing the right club)
MODEL_LOCAL="ollama/qwen2.5-coder:32b"            # Putter, Wedge, Short Iron
MODEL_API="openrouter/minimax/minimax-m2.5"        # Long Iron, Driver
MODEL_API_TIMEOUT=1800                              # 30min for complex tickets
MODEL_LOCAL_TIMEOUT=900                             # 15min for simple tickets
ESCALATE_ON_FAIL=true                               # Retry failed local tickets on M2.5

# Agent guide token budget — Qwen 32B has 32K context.
# Repo map (~3K) + prompt (~1K) + SKILL.md + file contents must fit.
# The Skills spec recommends keeping SKILL.md under 5000 words.
# References (sprint-history.md) can grow unlimited — only loaded on demand.
AGENT_GUIDE_MAX_WORDS=5000

select_model() {
  local club="$1"
  local max_files="${2:-1}"

  # [LLM Review #2] Multi-file routing: if ticket touches 3+ files, escalate
  # regardless of club assignment — Qwen struggles with multi-file coordination
  if [ "$max_files" -ge 3 ]; then
    echo "$MODEL_API"
    return
  fi

  # Load data-driven overrides if they exist (from model-selector.ts)
  if [ -f "$SLOPE_DIR/slope-loop/model-config.json" ]; then
    local rec
    rec=$(jq -r ".recommendations.\"$club\" // \"\"" "$SLOPE_DIR/slope-loop/model-config.json")
    if [ "$rec" = "api" ]; then
      echo "$MODEL_API"
      return
    elif [ "$rec" = "local" ]; then
      echo "$MODEL_LOCAL"
      return
    fi
  fi

  case "$club" in
    putter|wedge)
      echo "$MODEL_LOCAL"
      ;;
    short_iron)
      echo "$MODEL_LOCAL"
      ;;
    long_iron|driver)
      echo "$MODEL_API"
      ;;
    *)
      echo "$MODEL_LOCAL"
      ;;
  esac
}

select_timeout() {
  local club="$1"
  case "$club" in
    long_iron|driver) echo "$MODEL_API_TIMEOUT" ;;
    *) echo "$MODEL_LOCAL_TIMEOUT" ;;
  esac
}

# ─── Run a single ticket with a given model ───────
# Returns 0 if tests pass, 1 if they don't
run_ticket_with_model() {
  local ticket_id="$1"
  local model="$2"
  local timeout_s="$3"
  local prompt="$4"
  local aider_log="$LOG_DIR/${ticket_id}-$(basename "$model").log"

  # Build aider args — inject agent guide if it exists (within token budget)
  local aider_args=(
    --model "$model"
    --message "$prompt"
    --auto-commits
    --auto-test
    --test-cmd "pnpm test"
    --yes
  )

  # [LLM Review #3] Allow streaming for M2.5 (reasoning model needs thinking tokens)
  # Only suppress streaming for local models (cleaner logs)
  if [[ "$model" == *"ollama"* ]]; then
    aider_args+=(--no-stream)
  fi

  # Inject agent guide skill if within token budget
  if [ -f "$AGENT_GUIDE" ]; then
    local guide_words
    guide_words=$(wc -w < "$AGENT_GUIDE")
    if [ "$guide_words" -le "$AGENT_GUIDE_MAX_WORDS" ]; then
      aider_args+=(--read "$AGENT_GUIDE")
    else
      log "   ⚠ Agent guide SKILL.md exceeds ${AGENT_GUIDE_MAX_WORDS} words — skipping injection (run synthesis)"
    fi
  fi

  # Also inject existing CLAUDE.md and CODEBASE.md for repo context
  if [ -f "$SLOPE_DIR/CODEBASE.md" ]; then
    aider_args+=(--read "$SLOPE_DIR/CODEBASE.md")
  fi

  timeout "$timeout_s" aider "${aider_args[@]}" \
    2>&1 | tee "$aider_log" || {
      log "   ⚠ Aider timed out or errored on $ticket_id (model: $model)"
    }

  # Return test status
  if pnpm test > /dev/null 2>&1; then
    return 0
  else
    return 1
  fi
}

mkdir -p "$RESULTS_DIR" "$LOG_DIR"

# ─── Helpers ──────────────────────────────────────

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_DIR/loop.log"; }

# ─── Pre-flight: Ollama health check ─────────────
# [Arch Review #7] Prevent false escalation on cold starts

if ! curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; then
  log "⚠ Ollama is not running. Attempting to start..."
  ollama serve &
  sleep 5
  if ! curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; then
    log "❌ Cannot reach Ollama. Please start it manually: ollama serve"
    exit 1
  fi
fi

# Verify the model is available
if ! ollama list 2>/dev/null | grep -q "qwen2.5-coder:32b"; then
  log "⚠ Qwen model not found. Pulling..."
  ollama pull qwen2.5-coder:32b
fi

log "✅ Ollama healthy, model available"

get_sprint() {
  local sprint_id="${1:-}"
  if [ -n "$sprint_id" ]; then
    jq -r ".sprints[] | select(.id == \"$sprint_id\")" "$BACKLOG"
  else
    for id in $(jq -r '.sprints[].id' "$BACKLOG"); do
      # [Arch Review #6] Atomic lock to prevent parallel race conditions
      if mkdir "$RESULTS_DIR/$id.lock" 2>/dev/null; then
        if [ ! -f "$RESULTS_DIR/$id.json" ]; then
          jq -r ".sprints[] | select(.id == \"$id\")" "$BACKLOG"
          return
        else
          rmdir "$RESULTS_DIR/$id.lock" 2>/dev/null || true
        fi
      fi
    done
    log "All sprints completed. Run analyze.ts to generate new backlog."
    exit 0
  fi
}

# ─── Pre-Sprint: Slope Briefing ───────────────────

log "═══ Pre-Sprint Briefing ═══"
slope briefing 2>/dev/null | tee -a "$LOG_DIR/loop.log" || true
echo ""

# ─── Main ─────────────────────────────────────────

cd "$SLOPE_DIR"

SPRINT=$(get_sprint "${1:-}")
SPRINT_ID=$(echo "$SPRINT" | jq -r '.id')
SPRINT_TITLE=$(echo "$SPRINT" | jq -r '.title')
SPRINT_STRATEGY=$(echo "$SPRINT" | jq -r '.strategy')
SPRINT_SOURCE=$(echo "$SPRINT" | jq -r '.source')
TICKET_COUNT=$(echo "$SPRINT" | jq -r '.tickets | length')

log "═══ Starting Sprint: $SPRINT_ID — $SPRINT_TITLE ═══"
log "Strategy: $SPRINT_STRATEGY"
log "Source: $SPRINT_SOURCE"
log "Tickets: $TICKET_COUNT"

# Create working branch
BRANCH="$BRANCH_PREFIX/$SPRINT_ID"
git checkout -b "$BRANCH" 2>/dev/null || git checkout "$BRANCH"

# Start Slope session (uses Slope's built-in session tracking)
slope session start --sprint="$SPRINT_ID" 2>/dev/null || true

# ─── Process Each Ticket ──────────────────────────
# [Arch Review #2] Use process substitution to avoid subshell variable loss

TICKET_RESULTS="[]"

while read -r TICKET; do
  TICKET_ID=$(echo "$TICKET" | jq -r '.id')
  TICKET_TITLE=$(echo "$TICKET" | jq -r '.title')
  TICKET_DESC=$(echo "$TICKET" | jq -r '.description')
  TICKET_ACCEPTANCE=$(echo "$TICKET" | jq -r '.acceptance')
  TICKET_CLUB=$(echo "$TICKET" | jq -r '.club')
  TICKET_MAX_FILES=$(echo "$TICKET" | jq -r '.max_files // 1')

  log "── Ticket: $TICKET_ID — $TICKET_TITLE ──"
  log "   Club: $TICKET_CLUB (max_files: $TICKET_MAX_FILES)"
  log "   Strategy: $SPRINT_STRATEGY"

  # Select model based on ticket complexity + file count
  TICKET_MODEL=$(select_model "$TICKET_CLUB" "$TICKET_MAX_FILES")
  TICKET_TIMEOUT=$(select_timeout "$TICKET_CLUB")
  log "   Model: $TICKET_MODEL (timeout: ${TICKET_TIMEOUT}s)"

  slope claim --target="$TICKET_ID" 2>/dev/null || true

  # ─── Build model-adaptive prompt ─────────────────
  # [LLM Review #1] Different models have different cognitive styles
  PROMPT="You are working on the SLOPE project (Sprint Lifecycle & Operational Performance Engine).
This is a TypeScript monorepo using pnpm, vitest for tests, and strict TypeScript.
Package: @slope-dev/slope | 30 CLI commands | SQLite store | MCP server

CONTEXT: This ticket was generated from analysis of 40+ sprints of real scorecard data.
STRATEGY: $SPRINT_STRATEGY
REASON: $SPRINT_SOURCE

TICKET: $TICKET_TITLE
DESCRIPTION: $TICKET_DESC

ACCEPTANCE CRITERIA: $TICKET_ACCEPTANCE

RULES:
- Make minimal, focused changes — do not refactor unrelated code
- Read the relevant source files FIRST before making changes
- Run 'pnpm test' to verify your changes
- Run 'pnpm typecheck' to check types
- If tests fail after 3 attempts, stop and document what went wrong in a comment
- Commit with a message starting with '$TICKET_ID:'
"

  # Append model-specific instructions
  if [[ "$TICKET_MODEL" == *"minimax"* ]]; then
    PROMPT+="
APPROACH: You excel at planning complex changes. Before writing any code:
1. Create a brief implementation plan covering: files to modify, changes per file, verification steps
2. Then execute your plan step by step
3. After each file change, verify it doesn't break existing tests
This ticket may involve multiple files — coordinate your changes carefully."
  elif [[ "$TICKET_MODEL" == *"ollama"* ]] || [[ "$TICKET_MODEL" == *"qwen"* ]]; then
    PROMPT+="
APPROACH: Make the smallest possible change that satisfies the acceptance criteria.
Do not plan extensively — read the relevant files and make the change directly.
Focus on a single file at a time. Keep edits minimal and precise."
  fi

  PROMPT+="
START by reading the relevant source files, then implement the change."

  FINAL_MODEL="$TICKET_MODEL"
  ESCALATED="false"
  TESTS_PASSING="false"

  # ─── Attempt 1: Primary model ───────────────────
  if run_ticket_with_model "$TICKET_ID" "$TICKET_MODEL" "$TICKET_TIMEOUT" "$PROMPT"; then
    log "   ✅ Tests passing for $TICKET_ID (model: $TICKET_MODEL)"
    TESTS_PASSING="true"
  else
    log "   ❌ Tests failing for $TICKET_ID (model: $TICKET_MODEL)"

    # ─── Attempt 2: Escalate to M2.5 if local model failed ─
    if [ "$ESCALATE_ON_FAIL" = "true" ] && [ "$TICKET_MODEL" = "$MODEL_LOCAL" ]; then
      log "   🔄 Escalating to $MODEL_API..."
      FINAL_MODEL="$MODEL_API"
      ESCALATED="true"

      # Reset changes from failed attempt
      git checkout -- . 2>/dev/null || true
      git clean -fd 2>/dev/null || true

      if run_ticket_with_model "$TICKET_ID" "$MODEL_API" "$MODEL_API_TIMEOUT" "$PROMPT"; then
        log "   ✅ Tests passing for $TICKET_ID after escalation to $MODEL_API"
        TESTS_PASSING="true"
      else
        log "   ❌ Tests still failing for $TICKET_ID even after escalation"
      fi
    fi
  fi

  # ─── Track model usage per ticket ───────────────
  # [Arch Review #3] Per-ticket result tracking in JSONL and structured result
  TICKET_RESULT="{\"ticket\":\"$TICKET_ID\",\"title\":\"$TICKET_TITLE\",\"club\":\"$TICKET_CLUB\",\"max_files\":$TICKET_MAX_FILES,\"primary_model\":\"$TICKET_MODEL\",\"final_model\":\"$FINAL_MODEL\",\"escalated\":$ESCALATED,\"tests_passing\":$TESTS_PASSING}"
  echo "$TICKET_RESULT" >> "$LOG_DIR/${SPRINT_ID}-models.jsonl"

  # Accumulate for sprint result JSON
  TICKET_RESULTS=$(echo "$TICKET_RESULTS" | jq ". + [$TICKET_RESULT]")

  slope release --target="$TICKET_ID" 2>/dev/null || true
  log "── Ticket $TICKET_ID complete ──"
done < <(echo "$SPRINT" | jq -c '.tickets[]')

# ─── Post-Sprint: Score, Review & Evolve Agent Guide ─

log "═══ Sprint $SPRINT_ID complete — scoring ═══"

slope session end 2>/dev/null || true

# Generate scorecard from git commits + CI signals
slope auto-card --sprint="$SPRINT_ID" 2>/dev/null || {
  log "Auto-card generation failed — manual review needed"
}

# Generate sprint review markdown
slope review 2>/dev/null || true

# Update the performance dashboard
slope dashboard 2>/dev/null || true

# ─── Auto-evolve agent guide skill ────────────────
# Two-tier progressive disclosure:
#   1. Compact one-liners → SKILL.md "Known Hazards" section (always loaded)
#   2. Full detail → references/sprint-history.md (loaded on demand)

MODELS_LOG="$LOG_DIR/${SPRINT_ID}-models.jsonl"
if [ -f "$MODELS_LOG" ]; then
  FAILED_TICKETS=$(grep '"tests_passing":false' "$MODELS_LOG" || true)
  ESCALATED_TICKETS=$(grep '"escalated":true' "$MODELS_LOG" || true)

  if [ -n "$FAILED_TICKETS" ] || [ -n "$ESCALATED_TICKETS" ]; then

    # ── Tier 2: Full detail → references/sprint-history.md (unlimited) ──
    {
      echo ""
      echo "## Sprint $SPRINT_ID ($(date '+%Y-%m-%d'))"
      echo ""

      if [ -n "$ESCALATED_TICKETS" ]; then
        echo "**Escalated** (local model failed, M2.5 attempted):"
        echo "$ESCALATED_TICKETS" | jq -r '"- \(.ticket): \(.title) [\(.club)]"' 2>/dev/null || true
        echo ""
      fi

      if [ -n "$FAILED_TICKETS" ]; then
        echo "**Failed** (investigate patterns):"
        echo "$FAILED_TICKETS" | jq -r '.ticket' 2>/dev/null | while read -r t; do
          FAIL_LOG="$LOG_DIR/${t}-*.log"
          if ls $FAIL_LOG 1>/dev/null 2>&1; then
            FAIL_CONTEXT=$(tail -30 $FAIL_LOG 2>/dev/null | head -20)
            SUMMARY=$(echo "Summarize in one sentence what went wrong in this coding attempt. Be specific about the root cause:

$FAIL_CONTEXT" | timeout 60 ollama run qwen2.5-coder:14b 2>/dev/null || echo "See log for details")
            echo "- $t: $SUMMARY"
          else
            echo "- $t: No log found"
          fi
        done
        echo ""
      fi
    } >> "$SPRINT_HISTORY"
    log "Sprint history updated: references/sprint-history.md"

    # ── Tier 1: Compact one-liners → SKILL.md "Known Hazards" (always loaded) ──
    # Insert before the "## Anti-Patterns" line in SKILL.md
    if [ -n "$FAILED_TICKETS" ]; then
      echo "$FAILED_TICKETS" | jq -r '.ticket + " " + .title' 2>/dev/null | while read -r line; do
        TICKET_ID_SHORT=$(echo "$line" | cut -d' ' -f1)
        TICKET_TITLE_SHORT=$(echo "$line" | cut -d' ' -f2-)
        # Append compact hazard line before Anti-Patterns section
        sed -i '' "/^## Anti-Patterns/i - [$SPRINT_ID] $TICKET_ID_SHORT: $TICKET_TITLE_SHORT — failed" "$AGENT_GUIDE"
      done
    fi
    if [ -n "$ESCALATED_TICKETS" ]; then
      echo "$ESCALATED_TICKETS" | jq -r '.ticket + " " + .club' 2>/dev/null | while read -r line; do
        TICKET_ID_SHORT=$(echo "$line" | cut -d' ' -f1)
        CLUB=$(echo "$line" | cut -d' ' -f2)
        sed -i '' "/^## Anti-Patterns/i - [$SPRINT_ID] $TICKET_ID_SHORT: escalated from local [$CLUB]" "$AGENT_GUIDE"
      done
    fi
    log "SKILL.md hazards updated with sprint $SPRINT_ID"

    # Check if SKILL.md exceeds the Skills spec recommended limit
    GUIDE_WORDS=$(wc -w < "$AGENT_GUIDE" 2>/dev/null || echo 0)
    if [ "$GUIDE_WORDS" -gt "$AGENT_GUIDE_MAX_WORDS" ]; then
      log "⚠ SKILL.md is ${GUIDE_WORDS} words (limit: ${AGENT_GUIDE_MAX_WORDS}) — needs synthesis"
      log "  Run: slope-loop/slope-loop-guide/scripts/synthesize.sh"
    fi
  fi
fi

# [Arch Review #3] Save structured result with per-ticket status
cat > "$RESULTS_DIR/$SPRINT_ID.json" << EOF
{
  "sprint_id": "$SPRINT_ID",
  "title": "$SPRINT_TITLE",
  "strategy": "$SPRINT_STRATEGY",
  "completed_at": "$(date -Iseconds)",
  "branch": "$BRANCH",
  "source": "$SPRINT_SOURCE",
  "model_log": "$MODELS_LOG",
  "tickets": $(echo "$TICKET_RESULTS" | jq '.')
}
EOF

# Clean up lock file
rmdir "$RESULTS_DIR/$SPRINT_ID.lock" 2>/dev/null || true

log "═══ Sprint $SPRINT_ID done ═══"
log "Review: slope card && git log --oneline $BRANCH"
log "Merge:  git checkout main && git merge $BRANCH"
```

### 3.2 Continuous loop with regeneration

Create `slope-loop/continuous.sh`:

```bash
#!/bin/bash
# slope-loop/continuous.sh — Run sprints continuously
# When backlog is exhausted, regenerates from updated scorecard data
# Usage: ./slope-loop/continuous.sh [max-sprints]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SLOPE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MAX_SPRINTS="${1:-10}"  # Safety limit — default 10 sprints max

echo "╔══════════════════════════════════════════════╗"
echo "║  SLOPE Self-Development Loop                 ║"
echo "║  Max sprints: $MAX_SPRINTS                            ║"
echo "║  Backlog driven by 40+ sprints of real data  ║"
echo "║  Press Ctrl+C to stop after current sprint   ║"
echo "╚══════════════════════════════════════════════╝"

SPRINT_COUNT=0

while [ $SPRINT_COUNT -lt $MAX_SPRINTS ]; do
  SPRINT_COUNT=$((SPRINT_COUNT + 1))
  echo ""
  echo "━━━ Sprint $SPRINT_COUNT of $MAX_SPRINTS ━━━"

  # Check if backlog has remaining sprints
  REMAINING=$(jq '[.sprints[].id] | length' "$SCRIPT_DIR/backlog.json")
  COMPLETED=$(ls "$SCRIPT_DIR/results/" 2>/dev/null | wc -l | tr -d ' ')

  if [ "$COMPLETED" -ge "$REMAINING" ]; then
    echo ""
    echo "Backlog exhausted. Regenerating from updated scorecard data..."
    echo "(New sprints completed since last analysis will inform the new backlog)"
    echo ""

    # Return to main before analysis
    cd "$SLOPE_DIR"
    git checkout main 2>/dev/null || true

    # Regenerate backlog from updated data
    npx tsx slope-loop/analyze.ts

    # Reset results for new backlog
    rm -f "$SCRIPT_DIR/results/"*.json
    echo "New backlog generated. Continuing..."
  fi

  "$SCRIPT_DIR/run.sh" || {
    echo "Sprint failed or no more sprints. Stopping."
    break
  }

  echo ""
  echo "Sprint $SPRINT_COUNT complete. Pausing 30s..."
  sleep 30
done

echo ""
echo "═══ Loop complete. $SPRINT_COUNT sprints processed. ═══"
echo ""
echo "Review everything:"
echo "  slope card                    # Updated handicap with new sprints"
echo "  ls slope-loop/results/        # Completed sprints"
echo "  cat slope-loop/logs/loop.log  # Full activity log"
echo ""
echo "The scorecard dataset now has $((40 + SPRINT_COUNT))+ sprints."
```

---

## Phase 4: Compounding Optimizations

These five systems make the loop get smarter with every sprint. They're listed in implementation priority order — #1 and #2 are built into the runner script above, #3-#5 are separate additions.

### 4.1 Automatic Model Escalation on Failure

**Already built into `run.sh` above.** When Qwen fails a ticket (tests not passing after timeout), the runner automatically resets the changes and retries with MiniMax M2.5 before marking it as a miss. This produces three valuable outcomes:

- **Self-healing:** Simple tickets that Qwen can't handle still get completed
- **Comparison data:** Every escalation generates a direct "Qwen failed, M2.5 succeeded/failed" data point in the model log (`*-models.jsonl`)
- **Tier calibration:** After 20+ escalation events, you'll know exactly where the Qwen→M2.5 boundary should be drawn — maybe short_iron should always go to M2.5, or maybe Qwen only fails on specific modules

Cost impact is negligible since escalation only triggers on failures, and failures are the cheapest tickets (less output before they stop).

### 4.2 Loop Agent Guide — Packaged as a Proper Skill

The Slope repo already has comprehensive agent guidance via `CLAUDE.md`, `.claude/rules/`, `.claude/hooks/` (16 guard hooks), and `CODEBASE.md`. These are maintained by hand and should NOT be overwritten.

The loop adds a **separate, auto-evolving skill** that follows the Anthropic Agent Skills spec. By packaging it as a real skill instead of a flat markdown file, we get:
- **Cross-platform portability** — works in claude.ai, Claude Code, the API, and any platform supporting the open standard
- **Progressive disclosure** — frontmatter (always loaded, ~200 tokens) → SKILL.md body (loaded when doing sprint work, ~2000 tokens) → `references/sprint-history.md` (loaded only when analyzing trends, unlimited)
- **Auto-triggering** — the description field means Claude loads this skill automatically when someone asks about the loop, sprint patterns, or model performance
- **Distribution** — anyone who clones the loop approach can upload this skill to their own Claude

**Create the loop agent guide skill:**

```
slope-loop/slope-loop-guide/
├── SKILL.md                        # Core skill file with YAML frontmatter
├── references/
│   └── sprint-history.md           # Full archive of per-sprint learnings (no size limit)
└── scripts/
    └── synthesize.sh               # Compacts SKILL.md when it exceeds token budget
```

```bash
mkdir -p slope-loop/slope-loop-guide/references slope-loop/slope-loop-guide/scripts

cat > slope-loop/slope-loop-guide/SKILL.md << 'SKILL'
---
name: slope-loop-guide
description: >
  Institutional knowledge for the Slope autonomous development loop.
  Use when executing automated sprints, reviewing loop results, analyzing
  model tier performance, or working on Slope's own codebase via the loop.
  Use when user says "run a sprint", "check loop status", "review sprint
  results", "model performance", "escalation patterns", or "agent guide".
  Do NOT use for general Slope CLI usage or manual development — those are
  covered by the main Slope skill and CLAUDE.md.
compatibility: >
  Requires Slope CLI (@slope-dev/slope v1.13.1+) and slope-loop/ directory.
  Best with Slope MCP server connected. Works in Claude Code (with hooks),
  claude.ai (upload as skill), and API (via /v1/skills endpoint).
metadata:
  author: srbryers
  version: 0.1.0
  mcp-server: slope
  category: workflow-automation
---

# Slope Loop — Agent Guide

This skill is auto-injected into every automated sprint via Aider's `--read`
flag. It evolves automatically as the loop discovers patterns. It supplements
(does NOT replace) CLAUDE.md, .claude/rules/, or .claude/hooks/.

## Project Quick Reference
- SLOPE: Sprint Lifecycle & Operational Performance Engine
- Package: @slope-dev/slope (v1.13.1+)
- TypeScript monorepo, pnpm, vitest for tests, strict TypeScript
- 30 CLI commands, SQLite store, MCP server, 16 guard hooks
- Scoring: golf metaphors (handicap, par, birdie, bogey, hazards)

## Sprint Execution Protocol
1. Run `slope briefing` before starting any ticket
2. Claim tickets with `slope claim --target=<id>`
3. Make minimal, focused changes per ticket
4. Run `pnpm test` and `pnpm typecheck` before committing
5. Commit messages start with the ticket ID
6. Release tickets with `slope release --target=<id>`
7. After all tickets: `slope auto-card --sprint=<id>` then `slope review`

## Testing Conventions
- Tests use vitest — look for *.test.ts files adjacent to source
- Prefer snapshot tests for complex output structures
- Guard hooks run automatically during Claude Code sessions — respect their guidance
- Property-based tests cover scoring math invariants

## Model Tier Rules
- Putter/Wedge/Short Iron → local Qwen 32B (fast, free)
- Long Iron/Driver → MiniMax M2.5 API (architect-level planning)
- Tickets touching 3+ files → always M2.5 regardless of club
- If local model fails → auto-escalate to M2.5 before marking as miss

## Known Hazards (auto-populated after each sprint)
<!-- Patterns that caused failures will appear here -->
<!-- Format: - [module]: [what went wrong] — [what to do differently] -->

## Anti-Patterns (auto-populated from failure analysis)
- Do not refactor unrelated code in a ticket
- Do not add dependencies without explicit acceptance criteria
- Do not modify test infrastructure unless the ticket specifically requires it
- Do not skip `pnpm typecheck` — strict TypeScript catches real bugs

## Error Handling
- If `slope auto-card` fails: check that the sprint has commits on the branch
- If `slope store status` reports issues: run `slope store backup` then `slope store restore`
- If Ollama returns empty responses: verify model is loaded with `ollama list`
- If aider edit blocks fail to parse: try `--edit-format diff` or `--edit-format whole`

For full sprint-by-sprint history, see `references/sprint-history.md`.
SKILL
```

```bash
cat > slope-loop/slope-loop-guide/references/sprint-history.md << 'HISTORY'
# Sprint History — Full Archive

This file contains the complete per-sprint learning history.
It is NOT loaded into context by default — only when explicitly needed
for trend analysis or pattern investigation.

The SKILL.md file contains the synthesized, actionable version.
This file is the raw archive that synthesis draws from.

<!-- Auto-appended by run.sh after each sprint -->
HISTORY
```

**How progressive disclosure solves the token budget problem:**

The previous approach used a flat 6KB limit with a synthesis script. The Skills spec's three-level system is architecturally cleaner:

| Level | File | When Loaded | Token Budget |
|-------|------|-------------|-------------|
| 1. Frontmatter | YAML header | Always (system prompt) | ~200 tokens |
| 2. SKILL.md body | Full instructions | When doing sprint work | ~2000 tokens (keep under 5000 words per spec) |
| 3. References | `references/sprint-history.md` | Only when analyzing trends | Unlimited |

The runner appends raw learnings to `references/sprint-history.md` (no size limit). When `SKILL.md` needs updating, the synthesis script reads the full history and compacts the "Known Hazards" and "Anti-Patterns" sections — keeping the core skill body lean while the archive grows indefinitely.

**Auto-evolution** is built into the runner script (Phase 3). After each sprint, the runner:
1. Appends detailed learnings to `references/sprint-history.md` (unlimited)
2. If a ticket failed: uses the 14B model to summarize why from the failure log
3. Appends a compact one-liner to the "Known Hazards" section of `SKILL.md`
4. If `SKILL.md` exceeds 5000 words, warns to run synthesis

**Create the synthesis script** `slope-loop/slope-loop-guide/scripts/synthesize.sh`:

```bash
#!/bin/bash
# slope-loop/slope-loop-guide/scripts/synthesize.sh
# Compacts the SKILL.md body by synthesizing accumulated learnings.
# Reads the full sprint history from references/ and produces concise rules.
# Run when the runner warns about SKILL.md exceeding 5000 words.

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SKILL_FILE="$SKILL_DIR/SKILL.md"
HISTORY="$SKILL_DIR/references/sprint-history.md"

if [ ! -f "$SKILL_FILE" ]; then
  echo "No SKILL.md found at $SKILL_FILE"
  exit 1
fi

SKILL_WORDS=$(wc -w < "$SKILL_FILE")
echo "Current SKILL.md: ${SKILL_WORDS} words"

if [ ! -f "$HISTORY" ]; then
  echo "No sprint history found. Nothing to synthesize."
  exit 0
fi

# Archive the current SKILL.md
cp "$SKILL_FILE" "$SKILL_DIR/references/SKILL.md.$(date +%Y%m%d).bak"

# Extract the full sprint history
LEARNINGS=$(cat "$HISTORY")

# Use local model to synthesize learnings into compact rules
SYNTHESIS=$(echo "You are analyzing sprint failure logs from an automated development loop.
The SKILL.md file has grown too large. Synthesize ALL learnings into:
1. '## Known Hazards' — concise bullet points: [module]: [issue] — [fix]
2. '## Anti-Patterns' — concise bullet points of things to avoid

Rules:
- Max 30 bullet points total across both sections
- Group by module/area. Remove duplicates.
- Each bullet must be actionable (not just 'ticket X failed')
- Keep the most recent/relevant patterns, archive older ones

FULL SPRINT HISTORY:
$LEARNINGS" | ollama run qwen2.5-coder:14b)

# Replace the Known Hazards and Anti-Patterns sections in SKILL.md
# Keep everything above "## Known Hazards" and below "## Error Handling"
HEADER=$(sed '/^## Known Hazards/,$d' "$SKILL_FILE")
FOOTER=$(sed -n '/^## Error Handling/,$p' "$SKILL_FILE")

{
  echo "$HEADER"
  echo ""
  echo "$SYNTHESIS"
  echo ""
  echo "$FOOTER"
} > "$SKILL_FILE"

NEW_WORDS=$(wc -w < "$SKILL_FILE")
echo "Synthesized SKILL.md: ${NEW_WORDS} words (was ${SKILL_WORDS})"
echo "Backup saved to: references/SKILL.md.$(date +%Y%m%d).bak"
echo "Full history preserved in: references/sprint-history.md"
```

**For Aider injection,** the runner uses `--read slope-loop/slope-loop-guide/SKILL.md`. Aider doesn't understand YAML frontmatter natively, but it doesn't hurt — Aider treats it as context, and the frontmatter's trigger phrases help even non-Claude models understand when the guidance applies.

**For claude.ai / API usage,** zip the `slope-loop-guide/` folder and upload via Settings → Capabilities → Skills, or reference via the `/v1/skills` API endpoint. The skill auto-triggers when someone asks about loop status, sprint results, or model performance.

Over 30+ sprints, this skill becomes a rich, data-driven guide that literally makes every agent better at working on this specific codebase — the first auto-evolving skill that improves itself from its own data.

### 4.3 Scorecard-Driven Model Selection (Week 3+)

The static `club→model` mapping is a starting point. After 15+ loop sprints, replace it with data-driven selection.

Create `slope-loop/model-selector.ts`:

```typescript
#!/usr/bin/env npx tsx
/**
 * model-selector.ts — Analyze model performance across tickets
 * and generate an optimized model selection config.
 *
 * Reads: slope-loop/logs/*-models.jsonl (per-ticket model tracking)
 * Reads: .slope/scorecards/ (sprint scores)
 * Outputs: slope-loop/model-config.json (data-driven model selection rules)
 *
 * Run: npx tsx slope-loop/model-selector.ts
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const LOG_DIR = join(__dirname, 'logs');
const OUTPUT = join(__dirname, 'model-config.json');

interface TicketResult {
  ticket: string;
  club: string;
  primary_model: string;
  final_model: string;
  escalated: boolean;
  tests_passing: boolean;
}

// ─── Collect all model results ─────────────────────
const results: TicketResult[] = [];

const modelLogs = readdirSync(LOG_DIR).filter(f => f.endsWith('-models.jsonl'));
for (const file of modelLogs) {
  const lines = readFileSync(join(LOG_DIR, file), 'utf-8').trim().split('\n');
  for (const line of lines) {
    try {
      results.push(JSON.parse(line));
    } catch { /* skip malformed */ }
  }
}

if (results.length < 10) {
  console.log(`Only ${results.length} ticket results — need 10+ for meaningful analysis.`);
  console.log('Using default club→model mapping for now.');
  process.exit(0);
}

// ─── Analyze success rates by club × model ─────────
type Key = string; // "club:model"
const stats: Record<Key, { total: number; passing: number }> = {};

for (const r of results) {
  const key = `${r.club}:${r.final_model}`;
  if (!stats[key]) stats[key] = { total: 0, passing: 0 };
  stats[key].total++;
  if (r.tests_passing) stats[key].passing++;
}

// ─── Analyze escalation patterns ───────────────────
const escalations = results.filter(r => r.escalated);
const escalationSaveRate = escalations.length > 0
  ? escalations.filter(r => r.tests_passing).length / escalations.length
  : 0;

// ─── Generate recommendations ──────────────────────
const recommendations: Record<string, string> = {};
const clubs = [...new Set(results.map(r => r.club))];

for (const club of clubs) {
  const localKey = `${club}:ollama/qwen2.5-coder:32b`;
  const apiKey = `${club}:openrouter/minimax/minimax-m2.5`;

  const localStats = stats[localKey] || { total: 0, passing: 0 };
  const apiStats = stats[apiKey] || { total: 0, passing: 0 };

  const localRate = localStats.total > 0 ? localStats.passing / localStats.total : 0;
  const apiRate = apiStats.total > 0 ? apiStats.passing / apiStats.total : 0;

  // If local success rate < 60% and API is significantly better, recommend API
  if (localStats.total >= 3 && localRate < 0.6 && (apiRate > localRate + 0.2 || apiStats.total === 0)) {
    recommendations[club] = 'api';
  } else {
    recommendations[club] = 'local';
  }
}

const config = {
  generated_at: new Date().toISOString(),
  ticket_count: results.length,
  escalation_save_rate: Math.round(escalationSaveRate * 100),
  success_rates: Object.fromEntries(
    Object.entries(stats).map(([k, v]) => [k, {
      ...v,
      rate: Math.round((v.passing / v.total) * 100),
    }])
  ),
  recommendations,
  notes: [
    'Recommendations based on observed success rates per club×model combination',
    `Escalation save rate: ${Math.round(escalationSaveRate * 100)}% (${escalations.filter(r => r.tests_passing).length}/${escalations.length})`,
    'Run again after 10+ more sprints for updated recommendations',
  ],
};

writeFileSync(OUTPUT, JSON.stringify(config, null, 2));

console.log('═══ Model Performance Analysis ═══\n');
console.log(`Tickets analyzed: ${results.length}`);
console.log(`Escalation save rate: ${Math.round(escalationSaveRate * 100)}%\n`);

console.log('Success rates (club:model):');
for (const [key, val] of Object.entries(stats)) {
  const rate = Math.round((val.passing / val.total) * 100);
  console.log(`  ${key}: ${rate}% (${val.passing}/${val.total})`);
}

console.log('\nRecommendations:');
for (const [club, rec] of Object.entries(recommendations)) {
  console.log(`  ${club} → ${rec}`);
}

console.log(`\nConfig: ${OUTPUT}`);
```

**Once generated, the runner can optionally load `model-config.json`** and override the default `select_model()` logic with data-driven recommendations. This means the loop literally learns which model to use for which type of work.

### 4.4 Parallel Execution (Week 2+)

Qwen 32B uses ~25GB. M2.5 runs via API. On 96GB of unified memory, you can run multiple streams.

**⚠ Critical: Module overlap check** (Arch Review finding). If two parallel sprints touch the same files, you'll get merge conflicts when landing both branches. The backlog generator should tag each ticket with `modules` (which source directories it touches), and `parallel.sh` must verify no overlap before launching.

**Option A: Two local Qwen instances on separate sprints**

```bash
# Terminal 1: Sprint with putter/wedge tickets
./slope-loop/run.sh S-LOCAL-041 &

# Terminal 2: Sprint with putter/wedge tickets
./slope-loop/run.sh S-LOCAL-042 &

# Both use Qwen 32B locally — model is shared via Ollama
# Ollama handles concurrent requests to the same model
wait
```

Ollama serves concurrent requests to a loaded model. Two aider instances sending requests to the same Qwen 32B won't double memory usage — they share the loaded weights. Token generation will be slower per-instance (bandwidth is shared), but total throughput increases.

**Option B: Local + API in parallel**

```bash
# Terminal 1: Simple tickets via local Qwen (free)
ESCALATE_ON_FAIL=false ./slope-loop/run.sh S-LOCAL-041 &

# Terminal 2: Complex tickets via M2.5 API (cheap)
# Override model selection to force API
MODEL_LOCAL="openrouter/minimax/minimax-m2.5" ./slope-loop/run.sh S-LOCAL-042 &

wait
```

This is the optimal parallel config: Qwen handles grunt work locally while M2.5 handles complex work via API. Zero contention on bandwidth.

**Option C: `parallel.sh` wrapper**

```bash
#!/bin/bash
# slope-loop/parallel.sh — Run two sprint streams simultaneously
# Usage: ./slope-loop/parallel.sh
# Verifies module overlap before launching to prevent merge conflicts.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Find next two unscored sprints
SPRINT_A=$(jq -r '.sprints[0].id' "$SCRIPT_DIR/backlog.json")
SPRINT_B=$(jq -r '.sprints[1].id' "$SCRIPT_DIR/backlog.json")

# [Arch Review #1] Check for module overlap before parallel execution
MODULES_A=$(jq -r ".sprints[] | select(.id == \"$SPRINT_A\") | .tickets[].modules[]?" "$SCRIPT_DIR/backlog.json" | sort -u)
MODULES_B=$(jq -r ".sprints[] | select(.id == \"$SPRINT_B\") | .tickets[].modules[]?" "$SCRIPT_DIR/backlog.json" | sort -u)
OVERLAP=$(comm -12 <(echo "$MODULES_A") <(echo "$MODULES_B"))

if [ -n "$OVERLAP" ]; then
  echo "⚠ Module overlap detected between $SPRINT_A and $SPRINT_B:"
  echo "$OVERLAP"
  echo "Running sequentially to avoid merge conflicts."
  "$SCRIPT_DIR/run.sh" "$SPRINT_A"
  "$SCRIPT_DIR/run.sh" "$SPRINT_B"
else
  echo "✅ No module overlap. Running in parallel: $SPRINT_A + $SPRINT_B"

  "$SCRIPT_DIR/run.sh" "$SPRINT_A" &
  PID_A=$!

  "$SCRIPT_DIR/run.sh" "$SPRINT_B" &
  PID_B=$!

  wait $PID_A
  echo "Sprint $SPRINT_A complete"

  wait $PID_B
  echo "Sprint $SPRINT_B complete"
fi

echo "Both sprints done. Run: slope card"
```

**Memory budget for parallel execution:**
- Qwen 32B (Q6): ~25GB (shared across concurrent requests)
- System + Slope + Aider + Git: ~5GB
- Available for second model or headroom: ~66GB
- Could even run Qwen 32B + Qwen 14B simultaneously for different complexity tiers

### 4.5 Cost & Performance Dashboard

Create `slope-loop/dashboard.ts` — generates a static HTML file you can open in a browser:

```typescript
#!/usr/bin/env npx tsx
/**
 * dashboard.ts — Generate a static HTML dashboard showing:
 *   - Handicap trend over time
 *   - Model tier success rates
 *   - API cost tracking
 *   - Escalation stats
 *   - Sprint velocity
 *
 * Run: npx tsx slope-loop/dashboard.ts
 * Open: slope-loop/dashboard.html
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const LOOP_DIR = __dirname;
const LOG_DIR = join(LOOP_DIR, 'logs');
const RESULTS_DIR = join(LOOP_DIR, 'results');
const ANALYSIS_FILE = join(LOOP_DIR, 'analysis.json');

// ─── Gather data ─────────────────────────────────

// Model results from all sprints
const modelResults: any[] = [];
const modelLogs = readdirSync(LOG_DIR).filter(f => f.endsWith('-models.jsonl'));
for (const file of modelLogs) {
  const lines = readFileSync(join(LOG_DIR, file), 'utf-8').trim().split('\n');
  for (const line of lines) {
    try { modelResults.push(JSON.parse(line)); } catch {}
  }
}

// Sprint results
const sprintResults: any[] = [];
if (existsSync(RESULTS_DIR)) {
  for (const file of readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json'))) {
    try { sprintResults.push(JSON.parse(readFileSync(join(RESULTS_DIR, file), 'utf-8'))); } catch {}
  }
}

// Analysis data
const analysis = existsSync(ANALYSIS_FILE)
  ? JSON.parse(readFileSync(ANALYSIS_FILE, 'utf-8'))
  : null;

// ─── Compute stats ───────────────────────────────

const totalTickets = modelResults.length;
const passing = modelResults.filter(r => r.tests_passing).length;
const escalated = modelResults.filter(r => r.escalated).length;
const escalatedSaved = modelResults.filter(r => r.escalated && r.tests_passing).length;

const localTickets = modelResults.filter(r => r.primary_model.includes('ollama'));
const apiTickets = modelResults.filter(r => r.final_model.includes('minimax'));
const localPassRate = localTickets.length > 0
  ? Math.round(localTickets.filter(r => r.tests_passing && !r.escalated).length / localTickets.length * 100) : 0;
const apiPassRate = apiTickets.length > 0
  ? Math.round(apiTickets.filter(r => r.tests_passing).length / apiTickets.length * 100) : 0;

// Rough cost estimate: ~1.5-3M tokens per API ticket at $0.30/$1.20 per M (M2.5 is verbose)
const estimatedAPICost = apiTickets.length * 3;

// ─── Generate HTML ───────────────────────────────

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Slope Loop Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 2rem; }
    h1 { color: #4ade80; margin-bottom: 0.5rem; }
    .subtitle { color: #888; margin-bottom: 2rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .card { background: #1a1a1a; border: 1px solid #333; border-radius: 12px; padding: 1.5rem; }
    .card .label { color: #888; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .card .value { font-size: 2rem; font-weight: 700; margin-top: 0.25rem; }
    .card .value.green { color: #4ade80; }
    .card .value.yellow { color: #facc15; }
    .card .value.red { color: #f87171; }
    .card .value.blue { color: #60a5fa; }
    .section { margin-bottom: 2rem; }
    .section h2 { color: #ccc; margin-bottom: 1rem; border-bottom: 1px solid #333; padding-bottom: 0.5rem; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #222; }
    th { color: #888; font-weight: 500; }
    .bar { height: 8px; border-radius: 4px; background: #333; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 4px; }
    .bar-fill.green { background: #4ade80; }
    .bar-fill.yellow { background: #facc15; }
    .bar-fill.red { background: #f87171; }
    .timestamp { color: #555; font-size: 0.8rem; margin-top: 2rem; }
  </style>
</head>
<body>
  <h1>⛳ Slope Loop Dashboard</h1>
  <p class="subtitle">Self-development loop performance · ${sprintResults.length} sprints · ${totalTickets} tickets</p>

  <div class="grid">
    <div class="card">
      <div class="label">Current Handicap</div>
      <div class="value green">${analysis?.handicap?.current ?? '—'}</div>
    </div>
    <div class="card">
      <div class="label">Trend</div>
      <div class="value ${analysis?.handicap?.trend === 'improving' ? 'green' : 'yellow'}">${analysis?.handicap?.trend ?? '—'}</div>
    </div>
    <div class="card">
      <div class="label">Overall Pass Rate</div>
      <div class="value ${(passing/totalTickets*100) > 70 ? 'green' : 'yellow'}">${totalTickets > 0 ? Math.round(passing/totalTickets*100) : 0}%</div>
    </div>
    <div class="card">
      <div class="label">API Cost (est.)</div>
      <div class="value blue">$${estimatedAPICost.toFixed(2)}</div>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <div class="label">Local (Qwen) Pass Rate</div>
      <div class="value">${localPassRate}%</div>
      <div class="bar" style="margin-top:0.5rem"><div class="bar-fill ${localPassRate > 70 ? 'green' : localPassRate > 50 ? 'yellow' : 'red'}" style="width:${localPassRate}%"></div></div>
    </div>
    <div class="card">
      <div class="label">API (M2.5) Pass Rate</div>
      <div class="value">${apiPassRate}%</div>
      <div class="bar" style="margin-top:0.5rem"><div class="bar-fill ${apiPassRate > 70 ? 'green' : apiPassRate > 50 ? 'yellow' : 'red'}" style="width:${apiPassRate}%"></div></div>
    </div>
    <div class="card">
      <div class="label">Escalations</div>
      <div class="value yellow">${escalated}</div>
    </div>
    <div class="card">
      <div class="label">Escalation Save Rate</div>
      <div class="value">${escalated > 0 ? Math.round(escalatedSaved/escalated*100) : 0}%</div>
    </div>
  </div>

  <div class="section">
    <h2>Sprints Completed</h2>
    <table>
      <tr><th>Sprint</th><th>Strategy</th><th>Completed</th></tr>
      ${sprintResults.map(s => \`<tr><td>\${s.sprint_id}</td><td>\${s.strategy}</td><td>\${s.completed_at?.split('T')[0] ?? '—'}</td></tr>\`).join('\\n      ')}
    </table>
  </div>

  <p class="timestamp">Generated: ${new Date().toISOString()}</p>
</body>
</html>`;

writeFileSync(join(LOOP_DIR, 'dashboard.html'), html);
console.log('Dashboard generated: slope-loop/dashboard.html');
```

Run after each review session: `npx tsx slope-loop/dashboard.ts && open slope-loop/dashboard.html`

This dashboard doubles as **marketing material for getslope.dev** — screenshot it, embed it in blog posts, share it on LinkedIn. Real data from a real self-developing codebase.

---

### 4.6 Official Slope Skills (Week 3+)

Slope's knowledge layer is currently scattered across Claude Code-specific files (`CLAUDE.md`, `.claude/rules/`, `.claude/hooks/`). This works for Claude Code but is invisible to claude.ai, the API, and other platforms. The Agent Skills spec solves this by packaging workflow knowledge into portable skill folders that auto-trigger across any surface.

**Slope should ship two official skills alongside the MCP server:**

#### Skill 1: `slope-sprint-workflow` (Category 2 — Workflow Automation)

Orchestrates the full sprint lifecycle. This is Pattern 1 from the Skills guide — sequential workflow orchestration with validation at each gate.

```
skills/slope-sprint-workflow/
├── SKILL.md
└── references/
    └── scoring-reference.md
```

```yaml
# skills/slope-sprint-workflow/SKILL.md
---
name: slope-sprint-workflow
description: >
  Orchestrates the complete Slope sprint lifecycle: briefing, ticket claiming,
  execution, scoring, and review. Use when user says "start a sprint", "run a
  sprint", "plan my next sprint", "help me score this sprint", "claim a ticket",
  "review this sprint", or "what should I work on next". Also triggers on
  "slope briefing", "slope auto-card", "slope review". Do NOT use for general
  project management, Jira workflows, or non-Slope sprint tools.
compatibility: >
  Requires Slope MCP server connected (@slope-dev/slope v1.13.1+).
  Works in Claude Code (best — hooks provide real-time guidance),
  claude.ai (upload as skill + connect MCP), and API (via /v1/skills).
metadata:
  author: srbryers
  version: 1.0.0
  mcp-server: slope
  category: workflow-automation
---
```

The SKILL.md body would contain:

```markdown
# Slope Sprint Workflow

## Step 1: Pre-Sprint Briefing
Run `slope briefing` to get:
- Current hazard index and known gotchas
- Performance snapshot (handicap trend)
- Backlog state and recommended next sprint

If hazard index is HIGH (3+), consider addressing hazards before new features.

## Step 2: Claim and Execute Tickets
For each ticket in the sprint:
1. `slope claim --target=<ticket-id>` — prevents conflicts with other agents
2. Read relevant source files BEFORE making changes
3. Make minimal, focused changes
4. `pnpm test` and `pnpm typecheck` after each change
5. Commit with message starting with ticket ID
6. `slope release --target=<ticket-id>`

CRITICAL: If tests fail after 3 attempts, stop and document what went wrong.
Do not force a fix — the scorecard should capture the miss accurately.

## Step 3: Score the Sprint
After all tickets are complete:
1. `slope auto-card --sprint=<id>` — generates scorecard from git commits + CI
2. Review the auto-generated scorecard for accuracy
3. `slope review` — produces sprint review markdown with recommendations

## Step 4: Post-Sprint Analysis
1. `slope card` — check updated handicap (is it trending down?)
2. `slope dashboard` — visual performance trends
3. Check miss patterns — are you consistently missing in one direction?

## Error Handling
- `slope auto-card` fails → verify sprint has commits on the working branch
- `slope session start` fails → check if a session is already active: `slope session list`
- Scorecard validation fails → run `slope validate` for detailed error messages
- SQLite locked → `slope store status` then `slope store backup && slope store restore`

## When NOT to Use This Skill
- Manual coding sessions (use CLAUDE.md guidance instead)
- Debugging specific bugs (just fix them, don't force sprint structure)
- Architecture design discussions (those aren't sprint tickets)

For scoring system reference, see `references/scoring-reference.md`.
```

#### Skill 2: `slope-performance-analysis` (Category 3 — MCP Enhancement)

Teaches Claude how to interpret Slope's performance data. The MCP server returns raw numbers; this skill adds the domain intelligence to make them meaningful.

```
skills/slope-performance-analysis/
├── SKILL.md
└── references/
    ├── scoring-system.md
    └── interpretation-guide.md
```

```yaml
# skills/slope-performance-analysis/SKILL.md
---
name: slope-performance-analysis
description: >
  Interprets Slope performance data: handicap cards, dispersion analysis,
  miss patterns, hazard trends, and model tier comparisons. Use when user
  asks "how am I doing", "analyze my performance", "what are my miss patterns",
  "show handicap trends", "compare model performance", "am I improving",
  "what should I focus on", or "interpret this scorecard". Do NOT use for
  executing sprints (use slope-sprint-workflow) or general statistics questions.
compatibility: >
  Requires Slope MCP server connected (@slope-dev/slope v1.13.1+).
  Performance data must exist (at least 5 sprints scored).
metadata:
  author: srbryers
  version: 1.0.0
  mcp-server: slope
  category: mcp-enhancement
---
```

The SKILL.md body would contain interpretation rules like:

```markdown
# Slope Performance Analysis

## Reading Handicap Cards
- Handicap < 1.0: Excellent — agent is consistently under par
- Handicap 1.0-2.0: Good — on track, minor improvements possible
- Handicap > 2.0: Needs attention — systematic issues likely
- Handicap TRENDING UP over 3+ windows: Regression — investigate miss patterns
- Handicap TRENDING DOWN: Improvement — current approach is working

## Interpreting Miss Patterns
- Mostly "long" misses: Over-engineering — tickets are being over-scoped
- Mostly "short" misses: Under-implementation — missing edge cases
- Mostly "left" misses: Wrong approach — choosing incorrect patterns
- Mixed miss directions: Inconsistency — no systematic issue, improve estimation

## Hazard Analysis
- Recurring hazards (3+ appearances): Add regression tests or defensive checks
- Hazards clustered in one module: That module needs refactoring or better docs
- New hazard types appearing: Codebase is evolving — update agent guide

## Model Tier Analysis (for autonomous loop data)
- Compare pass rates: Qwen vs M2.5 by club type
- Escalation save rate > 60%: M2.5 tier is providing good value
- Escalation save rate < 30%: Tickets may be too complex for any model — rescope
- If a club type always escalates: Promote that club to M2.5 tier permanently

## Actionable Recommendations
Always end analysis with 2-3 specific next actions. Examples:
- "Your scoring module has 5 bunker hazards — create a hardening sprint"
- "Short iron tickets pass at 90% on Qwen — no need to escalate these"
- "Handicap improved from 2.1 to 1.4 over last 10 sprints — current approach is working"

For full scoring system details, see `references/scoring-system.md`.
For interpretation methodology, see `references/interpretation-guide.md`.
```

#### Distribution

These skills ship as part of the Slope repo in a `skills/` directory:

```bash
# Users install via:
# 1. Clone and upload to claude.ai
git clone https://github.com/srbryers/slope
cd slope/skills/slope-sprint-workflow
zip -r ../slope-sprint-workflow.zip .
# Upload ZIP via Settings → Capabilities → Skills

# 2. Or use with Claude Code (auto-discovered from repo)
slope init --claude-code  # already sets up .claude/ — skills enhance it

# 3. Or via Skills API
# Reference in API calls via container.skills parameter
```

The install guide on getslope.dev becomes: (1) `npm install -g @slope-dev/slope`, (2) `slope init`, (3) upload the skills to claude.ai or connect via API. Users get the MCP (what Claude can do) AND the skills (how Claude should do it) in one package.

**The competitive angle:** When users compare sprint scoring tools, Slope ships with portable skills that work across platforms — not just Claude Code hooks. That's the "MCP + Skills" story the guide emphasizes, and Slope is positioned to be one of the first tools to do it properly.

---

### 4.7 Token-Efficient Execution via Semantic Pre-computation (Week 3+)

Every Aider invocation currently wastes tokens on three things the model shouldn't be doing: **orientation** (what is this codebase?), **navigation** (which files do I need?), and **planning** (what's my approach?). Slope already *knows* the answers — it has the codebase map, 40+ sprints of file-change history, hazard patterns, and guard hooks. But none of that knowledge is used to pre-compute the context the model needs. Instead, we pay the model to rediscover it from scratch every time.

The core principle: **Slope should navigate and plan, the model should implement.**

This phase adds three new CLI commands that front-load the expensive reasoning work, so the model receives a tight, pre-computed execution context instead of an open-ended ticket.

#### 4.7.1 Semantic Codebase Index — `slope index`

Build an embedding index of the codebase so Slope can answer "which files are relevant to this ticket?" without loading the full repo map into the model's context.

**Embedding model:** Use a dedicated small embedding model via Ollama. `nomic-embed-text` (137M params, ~270MB) is purpose-built for code/text retrieval and runs locally with negligible resource usage alongside Qwen 32B.

```bash
# Install the embedding model
ollama pull nomic-embed-text

# Build the index (run after slope map, or on a git hook)
slope index
```

**What gets indexed:**
- Every `.ts` source file, split by function/class (AST-aware chunking)
- Every `.test.ts` file, split by describe/it block
- Existing scorecard data (which tickets touched which files)
- Guard hook descriptions (what domain rules apply to which modules)
- CODEBASE.md sections (module-level documentation)

**Storage:** SQLite (Slope already uses SQLite for everything). Add a `codebase_embeddings` table:

```sql
CREATE TABLE codebase_embeddings (
  id INTEGER PRIMARY KEY,
  file_path TEXT NOT NULL,
  chunk_type TEXT NOT NULL,  -- 'function', 'class', 'test', 'doc', 'scorecard'
  chunk_name TEXT,           -- function name, class name, test description
  content TEXT NOT NULL,     -- the actual chunk content
  embedding BLOB NOT NULL,   -- float32 vector from nomic-embed-text
  last_updated TEXT NOT NULL, -- ISO timestamp, rebuild stale entries on next index
  UNIQUE(file_path, chunk_name)
);

-- Co-change history from scorecards (which files change together)
CREATE TABLE file_cochange (
  file_a TEXT NOT NULL,
  file_b TEXT NOT NULL,
  cochange_count INTEGER DEFAULT 1,
  last_sprint TEXT,
  PRIMARY KEY(file_a, file_b)
);
```

**Rebuild strategy:**
- Full rebuild: `slope index --rebuild` (runs on first setup, ~2-5 minutes for Slope's codebase)
- Incremental: `slope index` checks `git diff` since last index, re-embeds only changed files
- Auto-trigger: add to `slope session end` or as a post-commit hook
- The co-change table updates automatically when `slope auto-card` runs (it already knows which files were in each sprint)

**Token savings:** Eliminates the ~3-5K token repo map from every Aider invocation. The model no longer needs to scan the full codebase structure to find relevant files.

#### 4.7.2 Contextual File Retrieval — `slope context <ticket-id>`

Given a ticket, retrieve the most relevant files using the semantic index instead of loading the full repo map.

```bash
slope context S-LOCAL-042-1
```

Output:

```json
{
  "ticket": "S-LOCAL-042-1",
  "title": "Add defensive checks to calculateHandicap",
  "primary_files": [
    {
      "path": "src/scoring/handicap.ts",
      "relevance": 0.94,
      "reason": "Contains calculateHandicap function (direct match)",
      "tokens": 1200
    },
    {
      "path": "src/scoring/types.ts",
      "relevance": 0.82,
      "reason": "Defines ScoreData interface used by calculateHandicap",
      "tokens": 450
    }
  ],
  "test_files": [
    {
      "path": "tests/scoring/handicap.test.ts",
      "relevance": 0.91,
      "reason": "Test suite for calculateHandicap",
      "tokens": 800
    }
  ],
  "related_files": [
    {
      "path": "src/scoring/dispersion.ts",
      "relevance": 0.67,
      "reason": "Co-changed with handicap.ts in 3 previous sprints",
      "tokens": 900
    }
  ],
  "total_estimated_tokens": 3350,
  "context_budget_remaining": 28650,
  "similar_past_tickets": [
    {
      "id": "S-028-2",
      "title": "Add null check to calculateDispersion",
      "outcome": "passed",
      "model": "qwen2.5-coder:32b"
    }
  ]
}
```

**How retrieval works:**

1. Embed the ticket title + description using `nomic-embed-text`
2. Cosine similarity search against `codebase_embeddings` table
3. Boost files that appear in the `file_cochange` table with other high-relevance hits
4. Boost files referenced in similar past tickets (from scorecard data)
5. Include the corresponding test file for every primary source file
6. Estimate token count for each file (rough: `wc -c / 4`)
7. Rank and return top N files that fit within a token budget

**Integration with the runner:**

```bash
# In run.sh, replace Aider's repo map with targeted file loading:
CONTEXT=$(slope context "$TICKET_ID" 2>/dev/null)

if [ -n "$CONTEXT" ]; then
  # Extract file paths and pass them directly to Aider
  FILES=$(echo "$CONTEXT" | jq -r '.primary_files[].path, .test_files[].path' | sort -u)
  for f in $FILES; do
    aider_args+=(--file "$f")
  done
  # Skip repo map since we've pre-selected files
  aider_args+=(--no-auto-commits --map-tokens 0)
  log "   Context: $(echo "$FILES" | wc -l) files, ~$(echo "$CONTEXT" | jq '.total_estimated_tokens')t"
else
  # Fallback to repo map if context command fails or isn't available
  log "   Context: falling back to repo map (slope context unavailable)"
fi
```

Setting `--map-tokens 0` tells Aider to skip its own repo map generation entirely — Slope has already done the navigation work. This is where the bulk of the token savings come from.

**Token savings:** ~3-5K tokens per ticket (repo map eliminated) + ~1-3K tokens (model no longer reasons about which files to open).

#### 4.7.3 Structured Execution Plans — `slope prep <ticket-id>`

The biggest token sink is the model *planning* its approach. For simple tickets (putter/wedge), this is especially wasteful — the model spends 1-2K tokens reasoning about an approach that Slope could have prescribed in 200 tokens.

`slope prep` generates a structured, prescriptive execution plan that tells the model exactly what to do, eliminating the planning step.

> **Note:** This command is named `slope prep` (not `slope plan`) because `slope plan` already exists as the sprint planning command.

```bash
slope prep S-LOCAL-042-1
```

Output:

```yaml
ticket: S-LOCAL-042-1
title: Add defensive checks to calculateHandicap
club: short_iron
action: modify
files:
  modify:
    - path: src/scoring/handicap.ts
      function: calculateHandicap
      change: Add null/undefined guards for input parameters
  test:
    - path: tests/scoring/handicap.test.ts
      add_cases:
        - "returns default handicap (0) when rounds is undefined"
        - "returns default handicap (0) when rounds is empty array"
        - "handles holes array being empty within a round"
pattern: defensive-null-check
context:
  - "ScoreData.rounds can be undefined (see src/scoring/types.ts line 34)"
  - "Similar fix applied in S-028-2 to calculateDispersion — same pattern"
  - "Guard hook 'scoring-guard' validates output format — don't change return type"
constraints:
  - "Do NOT change the function signature"
  - "Do NOT refactor surrounding code"
  - "Return 0 (not null/undefined) as the default handicap"
verification: |
  pnpm test -- --grep "calculateHandicap"
  pnpm typecheck
```

**How the plan is generated:**

This is where Slope's accumulated intelligence pays off. The plan draws from multiple data sources, all of which already exist in the Slope ecosystem:

1. **File locations** → from `slope context` (the semantic index)
2. **Function-level targets** → lightweight AST parse of the primary files (TypeScript compiler API, extract function/class names and signatures)
3. **Similar past tickets** → from scorecard data (which tickets had similar descriptions, what files they touched, whether they passed)
4. **Module patterns** → from guard hooks (they already encode rules like "scoring module uses strict null checks")
5. **Constraints** → from the ticket's acceptance criteria + anti-patterns from the loop skill
6. **Verification commands** → from testing conventions (already in the loop skill)

For simple tickets (putter/wedge), the plan can be generated entirely from the index + scorecard data — no LLM needed. For complex tickets (long_iron/driver), the plan generation itself could optionally use the 14B model to produce the context/constraints sections, which is still far cheaper than having the 32B or M2.5 model figure it out during implementation.

**Integration with the runner:**

```bash
# In run.sh, generate plan and inject as part of the prompt:
PLAN=$(slope prep "$TICKET_ID" 2>/dev/null)

if [ -n "$PLAN" ]; then
  # Write plan to a temp file and inject via --read
  PLAN_FILE="$LOG_DIR/${TICKET_ID}-plan.yaml"
  echo "$PLAN" > "$PLAN_FILE"
  aider_args+=(--read "$PLAN_FILE")

  # Use a more prescriptive prompt since we have a structured plan
  if [[ "$MODEL" == *"qwen"* ]]; then
    PROMPT="Execute the plan in ${TICKET_ID}-plan.yaml exactly as specified.
Read the plan's 'files.modify' section. Open those files. Make ONLY the changes described.
Then run the verification commands. Do not deviate from the plan."
  else
    PROMPT="You have a structured execution plan in ${TICKET_ID}-plan.yaml.
Follow it precisely: modify the listed files as described, add the specified test cases,
respect all constraints. Run verification after changes. If the plan is insufficient
to complete the ticket, document what additional changes are needed but do not make
unplanned modifications."
  fi
else
  # Fallback to standard prompt if plan command unavailable
  log "   Plan: falling back to standard prompt (slope prep unavailable)"
fi
```

**Token savings:** ~1-2K tokens per ticket (model executes rather than plans). For putter/wedge tickets, the savings are even larger because those tickets often have simple, predictable plans that the model over-thinks.

#### 4.7.4 Backlog Enrichment — `slope enrich`

Front-load ALL the navigation and planning work to backlog generation time, so it's a one-time cost shared across the entire sprint.

```bash
# Run after analyze.ts generates the raw backlog
slope enrich slope-loop/backlog.json
```

This command iterates through every ticket in the backlog and pre-computes:

```json
{
  "id": "S-LOCAL-042-1",
  "title": "Add defensive checks to calculateHandicap",
  "club": "short_iron",
  "max_files": 2,
  "modules": ["src/scoring"],
  "files": {
    "primary": ["src/scoring/handicap.ts"],
    "test": ["tests/scoring/handicap.test.ts"],
    "related": ["src/scoring/types.ts"]
  },
  "similar_tickets": ["S-028-2", "S-033-1"],
  "similar_outcomes": ["passed", "passed"],
  "hazards": ["scoring module has 5 bunker hazards — careful with type assertions"],
  "estimated_tokens": 4200,
  "plan_generated": true,
  "plan_path": "slope-loop/plans/S-LOCAL-042-1.yaml"
}
```

The `estimated_tokens` field enables a critical optimization in the runner: **context-aware model routing.** Instead of routing purely by club, the runner can check whether a ticket will actually fit in Qwen's 32K context:

```bash
# In run.sh, after model selection:
EST_TOKENS=$(echo "$TICKET" | jq -r '.estimated_tokens // 0')

if [[ "$MODEL" == *"qwen"* ]] && [ "$EST_TOKENS" -gt 24000 ]; then
  log "   ⚠ Ticket estimated at ${EST_TOKENS}t — exceeds Qwen comfort zone, routing to M2.5"
  MODEL="$MODEL_API"
  TIMEOUT="$MODEL_API_TIMEOUT"
fi
```

This catches tickets that are technically "short_iron" in complexity but touch large files that would overflow Qwen's context — currently a silent failure mode that wastes a local run before escalating.

**When to run enrichment:**
- After `analyze.ts` generates a new backlog
- After `slope index` rebuilds (re-enrich with updated file locations)
- Optionally as part of `slope suggest` when that replaces `analyze.ts`

#### Token Savings Summary

| Source | Current tokens/ticket | With pre-computation | Saving |
|--------|----------------------|---------------------|--------|
| Repo map (orientation) | 3,000-5,000 | 0 (`slope context` replaces) | 3-5K |
| Model navigation reasoning | 1,000-3,000 | 0 (files pre-selected) | 1-3K |
| Model planning reasoning | 1,000-2,000 | ~200 (executes structured plan) | 0.8-1.8K |
| Skill injection | ~2,000 | ~2,000 (unchanged) | 0 |
| File contents | 2,000-8,000 | 2,000-8,000 (unchanged, better targeted) | 0 |
| Implementation output | 1,000-5,000 | 1,000-5,000 (unchanged) | 0 |
| **Total** | **10,000-25,000** | **5,200-15,200** | **~30-50%** |

**Cost impact on M2.5 tier:**
- Current: ~$2-4 per complex ticket (1.5-3M tokens at $0.30/$1.20)
- With pre-computation: ~$1.20-2.40 per complex ticket
- At 5 complex tickets/day: saves ~$4-8/day → ~$120-240/month

**Context fit impact on Qwen tier:**
- Current: some short_iron tickets silently overflow 32K context → fail → escalate to M2.5
- With `estimated_tokens` routing: tickets that won't fit are routed to M2.5 upfront
- Fewer false escalations = less API spend + cleaner data for model-selector.ts

**Escalation reduction:**
- Better file targeting means fewer "wrong file" failures on Qwen
- Structured plans mean fewer "wrong approach" failures on Qwen
- Net effect: escalation rate drops → cost drops → more tickets run locally for free

#### Implementation Priority

These commands build on each other. Implement in order:

1. **`slope index`** (Week 3) — Foundation. Everything else depends on the embedding index. Start with just source files, add scorecard/co-change data later.
2. **`slope context`** (Week 3) — Immediate token savings. Integrate with runner via `--map-tokens 0`. This single change eliminates the repo map overhead.
3. **`slope enrich`** (Week 4) — Enriches backlog with file paths and token estimates. Enables context-aware model routing.
4. **`slope prep`** (Week 4+) — Structured execution plans. Start with simple putter/wedge plans (template-driven, no LLM needed), add LLM-assisted plans for complex tickets later.

Each command is independently useful — you don't need all four to see benefits. `slope context` alone provides the biggest ROI since it eliminates the repo map from every invocation.

#### Architectural Note

These commands make Slope a **full execution orchestrator**, not just a scoring framework. The progression:

```
v1 (current):  Slope scores sprints → data
v2 (loop):     Slope scores + generates backlog → data + tickets
v3 (skills):   Slope scores + generates backlog + provides workflow knowledge → portable
v4 (context):  Slope scores + generates backlog + provides workflow knowledge + navigates codebase + plans execution → token-efficient
```

At v4, the model's role shrinks to its highest-value activity: writing correct code given precise instructions. Everything else — orientation, navigation, planning, scoring — is handled by Slope, which has the institutional knowledge to do it better and cheaper than burning model tokens.

This also strengthens the `slope suggest` endgame (Week 4+): when Slope generates its own backlog, it can simultaneously generate the execution plans and file contexts. The loop becomes: `slope suggest` → `slope enrich` → `run.sh` picks ticket → model executes pre-computed plan → `slope auto-card` → data feeds back into `slope suggest`. The model is a code-writing tool within a Slope-orchestrated pipeline, not an autonomous agent figuring things out from scratch.

---

## Phase 5: Review Workflow

### 5.1 Quick status check

```bash
slope card                          # Handicap now includes local loop sprints
slope dashboard                     # Live local performance dashboard
npx tsx slope-loop/dashboard.ts     # Generate loop-specific HTML dashboard
open slope-loop/dashboard.html      # Visual overview with model comparison
cat slope-loop/logs/loop.log        # What happened
ls slope-loop/results/              # Which sprints completed
git branch | grep slope-loop        # Branches created
```

### 5.2 Per-sprint review

```bash
# For each completed sprint branch:
git log --oneline slope-loop/S-LOCAL-041
git diff main..slope-loop/S-LOCAL-041 --stat   # What files changed
git diff main..slope-loop/S-LOCAL-041           # Full diff
pnpm test                                       # Still passing?
```

### 5.3 Decision tree

```
Tests passing on the branch?
├── YES → Review the diff
│   ├── Clean and correct → git checkout main && git merge slope-loop/S-LOCAL-041
│   ├── Functional but messy → Clean up manually, then merge
│   └── Wrong approach → Delete branch, adjust ticket, re-queue
│
└── NO → Check slope-loop/logs/S-LOCAL-041-*.log
    ├── Model got confused → Simplify ticket description, re-queue
    ├── Ticket too complex → Break into smaller wedge/putter tickets
    └── Found real bug → File it, fix with cloud Claude
```

### 5.4 Feed learnings back

After each review session:

1. **Merge good branches** — this updates the scorecard data
2. **Re-run analysis** — `npx tsx slope-loop/analyze.ts` — backlog evolves
3. **Re-run model selector** — `npx tsx slope-loop/model-selector.ts` — tier recommendations evolve
4. **Regenerate dashboard** — `npx tsx slope-loop/dashboard.ts` — visual check on trends
5. **Review loop skill** — `wc -w slope-loop/slope-loop-guide/SKILL.md` — check word count stays under 5000
6. **Synthesize if needed** — if SKILL.md exceeds 5000 words, run `slope-loop/slope-loop-guide/scripts/synthesize.sh`
7. **Review per-ticket results** — `cat slope-loop/results/S-LOCAL-*.json | jq '.tickets[]'` — check individual ticket status
8. **Compare model performance** — check `dashboard.html` for Qwen vs M2.5 pass rates and escalation save rate
9. **Adjust model tiers** — if `model-config.json` recommends promoting short_iron to API, consider it
10. **Track cost** — dashboard shows estimated API spend. Target: <$10/day for the autonomous loop (revised from $5 based on M2.5 verbosity)

---

## Phase 6: Scaling Timeline

### Week 1 — Validate

- **Day 1: Manual Aider + Qwen test** (most critical step — validates the entire local tier)
  - `aider --model ollama/qwen2.5-coder:32b --message "Add a JSDoc comment to src/index.ts" --yes`
  - If edit blocks don't parse: try `--edit-format diff` or `--edit-format whole`
  - If still broken: check Aider version, Ollama version, model chat template
- **Day 1: Verify Slope framework** — `slope card`, `slope briefing`, `slope store status`
- **Day 2: Run `analyze.ts`** — review the generated backlog, check club and max_files assignments
- **Days 3-5: Run 2-3 sprints manually** (watch them) — start with **local-only** (Qwen 32B)
- Verify the aider → Ollama → Slope pipeline works end-to-end
- Verify per-ticket result tracking in `slope-loop/results/*.json`
- Tune timeouts, model choice, and ticket scoping
- **Goal: 3 successfully scored sprints on local model, pipeline proven**

### Week 2 — Trust + Introduce M2.5

- Run `continuous.sh` while you work on other projects
- Add a few **long_iron/driver tickets** to backlog to test M2.5 via API
- Watch escalation behavior — how often does Qwen fail and M2.5 save it?
- Check per-ticket results: `jq '.tickets[]' slope-loop/results/*.json`
- Start running **parallel.sh** — it will auto-check module overlap before launching
- Review dashboard at end of day: `npx tsx slope-loop/dashboard.ts && open slope-loop/dashboard.html`
- Check loop skill growth: `wc -w slope-loop/slope-loop-guide/SKILL.md` (should stay under 5000 words)
- **Goal: 7+ sprints, first escalation and model comparison data, agent guide evolving**

### Week 3 — Compound + Ship Skills + Semantic Index

- Run `model-selector.ts` — do the data-driven recommendations match your intuition?
- Use `slope dashboard` + `slope-loop/dashboard.html` as marketing material for getslope.dev
- Write a LinkedIn post about the tiered model strategy with real data from the dashboard
- Review `slope-loop/slope-loop-guide/SKILL.md` — it should be rich with auto-populated hazards by now
- If SKILL.md exceeds 5000 words, run `slope-loop/slope-loop-guide/scripts/synthesize.sh`
- **Create the two official Slope skills** (Phase 4.6): `slope-sprint-workflow` and `slope-performance-analysis`
- Test skills in claude.ai: zip each skill folder, upload via Settings → Capabilities → Skills
- Verify auto-triggering: "help me plan a sprint" should load `slope-sprint-workflow`
- Add skills install guide to getslope.dev and the GitHub README
- **Build `slope index`** (Phase 4.7.1): pull `nomic-embed-text`, build embedding index of codebase
- **Build `slope context`** (Phase 4.7.2): integrate with runner via `--map-tokens 0` — immediate token savings
- Measure before/after token usage on a few tickets to validate the 30-50% savings estimate
- Start adding CaddyStack tickets to a separate backlog
- Run the same loop against CaddyStack's repo
- Publish model-tier performance data (which model scores best at which complexity)
- **Goal: Two projects being developed by the loop, official skills shipped, repo map eliminated from Aider invocations**

### Week 4+ — Converge + Structured Plans

- Build `slope suggest` as a real CLI command (from the meta sprint)
- Add model recommendation to `slope suggest` — it knows which model tier works for which ticket type
- Replace `analyze.ts` with the productized command
- The loop now generates its own backlog natively through Slope
- **Build `slope enrich`** (Phase 4.7.4): add file paths, token estimates, and context-aware model routing to backlog
- **Build `slope prep`** (Phase 4.7.3): structured execution plans, starting with template-driven putter/wedge plans
- The full pipeline becomes: `slope suggest` → `slope enrich` → `run.sh` (with `slope context` + `slope prep`) → `slope auto-card`
- **Ship skills via Skills API** — reference in API calls via `container.skills` parameter
- Explore replacing Aider with Claude API + Slope skill for loop execution (the Skills API + pre-computed context may make this practical)
- Begin CaddyStack ↔ Slope integration work
- **Goal: Slope generates its own development backlog, pre-computes execution context, and the model's role is reduced to writing code. Skills available on all platforms.**

---

## File Structure

```
slope/
├── .claude/
│   ├── rules/              # Platform rules (DO NOT MODIFY — maintained by hand)
│   └── hooks/              # 16 guard hooks (DO NOT MODIFY — maintained by hand)
├── .cursor/rules/          # Cursor rules (DO NOT MODIFY)
├── .slope/                 # Slope data directory
│   ├── config.json         # Slope config (metaphor, guards, etc.)
│   └── scorecards/         # 40 existing + new from loop
├── skills/                 # Official Slope skills (Agent Skills spec)
│   ├── slope-sprint-workflow/
│   │   ├── SKILL.md        # Sprint lifecycle orchestration skill
│   │   └── references/
│   │       └── scoring-reference.md
│   └── slope-performance-analysis/
│       ├── SKILL.md        # Performance data interpretation skill
│       └── references/
│           ├── scoring-system.md
│           └── interpretation-guide.md
├── slope-loop/
│   ├── analyze.ts          # Mines 40+ sprints → generates backlog
│   ├── model-selector.ts   # Analyzes model performance → generates tier config
│   ├── dashboard.ts        # Generates HTML performance dashboard
│   ├── parallel.sh         # Runs two sprint streams (with overlap check)
│   ├── slope-loop-guide/   # Auto-evolving loop skill (Agent Skills spec)
│   │   ├── SKILL.md        # Core skill: YAML frontmatter + instructions (~5000 words max)
│   │   ├── references/
│   │   │   └── sprint-history.md   # Full archive of per-sprint learnings (unlimited)
│   │   └── scripts/
│   │       └── synthesize.sh       # Compacts SKILL.md when it exceeds word limit
│   ├── backlog.json        # Auto-generated sprint backlog (with data provenance)
│   ├── model-config.json   # Data-driven model selection rules (after 15+ sprints)
│   ├── analysis.json       # Raw analysis output (hazards, misses, hotspots)
│   ├── dashboard.html      # Static performance dashboard (marketing-ready)
│   ├── run.sh              # Single sprint runner (with escalation + skill injection)
│   ├── continuous.sh       # Continuous loop with backlog regeneration
│   ├── results/            # Sprint completion markers + per-ticket results
│   │   ├── S-LOCAL-041.json
│   │   ├── S-LOCAL-041.lock  # Atomic lock (removed after completion)
│   │   └── ...
│   └── logs/               # Aider logs, model tracking, loop output
│       ├── loop.log
│       ├── S-LOCAL-041-models.jsonl   # Per-ticket model usage tracking
│       ├── S-LOCAL-041-1-qwen.log     # Aider log (primary model)
│       ├── S-LOCAL-041-1-minimax.log  # Aider log (escalated, if applicable)
│       └── ...
├── src/                    # Slope source (what the agent works on)
├── tests/                  # Tests (the agent's acceptance gate)
├── docs/                   # Framework documentation
├── templates/              # Scorecard templates
├── scripts/                # Build/release scripts
├── CLAUDE.md               # Agent guidance for Claude Code (DO NOT OVERWRITE)
├── CODEBASE.md             # Auto-generated codebase map
├── .mcp.json               # MCP server configuration
├── package.json            # @slope-dev/slope
├── tsconfig.json
└── vitest.config.ts
```

---

## Quick Start Checklist

```
SETUP
□ Install Ollama, pull qwen2.5-coder:32b (and qwen2.5-coder:14b for summaries)
□ Install aider (pip install aider-chat)
□ Set up MiniMax M2.5 API access (OpenRouter or MiniMax direct)
□ Export OPENROUTER_API_KEY (or MINIMAX_API_KEY) in shell profile

⚠ CRITICAL: MANUAL AIDER + QWEN TEST (do this before trusting the loop)
□ cd ~/projects/slope
□ aider --model ollama/qwen2.5-coder:32b --message "Add a JSDoc comment to the top of src/index.ts" --yes
□ Verify: Did Aider correctly parse Qwen's edit blocks?
□ If NOT: try --edit-format diff or --edit-format whole
□ This is the #1 failure mode — if edit blocks don't parse, the entire local tier is broken

VERIFY SLOPE FRAMEWORK
□ slope card                  # Current handicap from 40+ sprints
□ slope briefing              # Pre-sprint hazard state
□ slope next                  # Next sprint number
□ slope store status          # SQLite store healthy
□ cat CLAUDE.md               # Existing agent guidance — DO NOT overwrite
□ ls .claude/hooks/           # 16 guard hooks present
□ cat .mcp.json               # MCP server config present

CREATE LOOP FILES
□ Create slope-loop/ directory
□ Create slope-loop/slope-loop-guide/ skill directory (SKILL.md + references/ + scripts/)
□ Create slope-loop/slope-loop-guide/SKILL.md (initial version from Phase 4.2)
□ Create slope-loop/slope-loop-guide/references/sprint-history.md
□ Create slope-loop/slope-loop-guide/scripts/synthesize.sh
□ chmod +x slope-loop/run.sh slope-loop/continuous.sh slope-loop/parallel.sh
□ chmod +x slope-loop/slope-loop-guide/scripts/synthesize.sh

GENERATE BACKLOG
□ Run: npx tsx slope-loop/analyze.ts
□ Review analysis.json — do the patterns make sense?
□ Review backlog.json — are the tickets well-scoped?
□ Verify club assignments match intended model tiers
□ Check max_files field — tickets with 3+ files should route to M2.5
□ Check modules field — needed for parallel overlap detection
□ Adjust any tickets that need refinement

FIRST SPRINT
□ First sprint: ./slope-loop/run.sh (watch it live)
□ Watch the Ollama health check pass
□ Watch model selection — Qwen for simple, M2.5 for complex
□ Watch for escalation behavior — did any tickets get retried on M2.5?
□ Review: slope card — does the sprint look right?
□ Review: cat slope-loop/results/S-LOCAL-*.json — check per-ticket results
□ Check slope-loop/slope-loop-guide/SKILL.md — did it auto-append hazards?
□ Check slope-loop/slope-loop-guide/references/sprint-history.md — full details there?

SKILLS (Week 3)
□ Create skills/slope-sprint-workflow/SKILL.md (from Phase 4.6)
□ Create skills/slope-performance-analysis/SKILL.md (from Phase 4.6)
□ Test in claude.ai: zip each skill folder, upload via Settings → Capabilities → Skills
□ Verify: "help me plan a sprint" auto-triggers slope-sprint-workflow
□ Verify: "how am I doing" auto-triggers slope-performance-analysis
□ Add install guide to getslope.dev README

SEMANTIC PRE-COMPUTATION (Week 3-4)
□ ollama pull nomic-embed-text
□ Build slope index command (Phase 4.7.1) — embed source files into SQLite
□ Build slope context command (Phase 4.7.2) — retrieve relevant files per ticket
□ Integrate slope context with run.sh: add --map-tokens 0 to Aider args
□ Measure token usage before/after on 3-5 tickets (validate 30-50% savings)
□ Build slope enrich command (Phase 4.7.4) — add token estimates to backlog
□ Build slope prep command (Phase 4.7.3) — start with putter/wedge templates
□ Integrate slope prep with run.sh: inject structured plan via --read

SCALE
□ If good: ./slope-loop/continuous.sh 5
□ Come back, review branches, merge passing ones
□ Re-analyze: npx tsx slope-loop/analyze.ts
□ Enrich: slope enrich slope-loop/backlog.json
□ Generate dashboard: npx tsx slope-loop/dashboard.ts && open slope-loop/dashboard.html
□ Compare model performance in dashboard
□ Check: are context-aware routing decisions reducing false escalations?
```

---

## Key Principles

1. **The data is the product.** Every sprint — even failures — enriches the dataset. After 50+ scored sprints, you have the most comprehensive real-world AI agent performance dataset available. That's Slope's moat. The model-tier comparison data (Qwen vs M2.5 on the same ticket types) adds a dimension nobody else has.

2. **The backlog writes itself.** With 40 sprints of data, you don't need to invent tickets. The analysis script reads miss patterns, hazard clusters, and success rates, then generates targeted work. As new sprints complete, the analysis evolves.

3. **Right club for the right shot.** The tiered model strategy isn't just about cost — it's about matching capability to complexity. Qwen 32B is fast and free for single-file changes. MiniMax M2.5's architect-level planning is overkill for adding a JSDoc comment, but essential for multi-file refactors. The runner selects automatically based on club AND file count, and after enough data, `model-selector.ts` replaces gut feeling with evidence.

4. **Escalation beats failure.** When Qwen can't finish a ticket, M2.5 gets a shot before it's marked as a miss. This self-healing behavior means more tickets land, and every escalation event is a data point that calibrates the tier boundary. The escalation save rate in the dashboard tells you exactly how much value the API tier adds.

5. **Skills are the portable knowledge layer.** Slope's workflow knowledge was previously locked in Claude Code-specific files (`CLAUDE.md`, `.claude/hooks/`). By packaging it as Agent Skills following the open spec, the same guidance works in claude.ai, Claude Code, the API, and any platform that supports the standard. Three skills ship: `slope-sprint-workflow` (orchestrates the sprint lifecycle), `slope-performance-analysis` (interprets handicap data), and `slope-loop-guide` (auto-evolving institutional knowledge from the loop). The loop guide is the first auto-evolving skill — it improves itself from its own data using progressive disclosure: frontmatter (always loaded) → SKILL.md body (loaded when doing sprint work) → `references/sprint-history.md` (loaded on demand, unlimited).

6. **Cloud Claude is still the architect.** Local and API models execute well-scoped tickets. Complex design decisions, architecture work, and ticket refinement still go through cloud Claude. M2.5 is the best laborer you've ever had, but it's still a laborer.

7. **Cost structure favors boldness — and Slope makes it bolder.** At ~$2-4 per complex ticket on M2.5 vs ~$7.50 on cloud Claude, you can afford to let M2.5 attempt ambitious tickets and fail. Semantic pre-computation (`slope context` + `slope prep`) pushes that down further to ~$1.20-2.40 by eliminating the repo map and planning overhead. Failures still generate scorecard data. The worst case is a bogey'd ticket that costs a couple dollars — and teaches the backlog generator what to avoid next time.

8. **Parallelism requires discipline.** Qwen uses ~25GB of 96GB. M2.5 runs via API. Two sprint streams run simultaneously — but only if they touch different modules. Lock files prevent sprint-picking races. The bottleneck isn't model inference — it's how fast you can review and merge the output.

9. **The dashboard is the product demo.** Every time you run `slope dashboard` or `slope-loop/dashboard.ts`, you get a marketing-ready snapshot of real AI agent performance data. Handicap trends, model comparisons, cost efficiency, escalation rates — all from a real codebase being developed by the framework it measures. That's Slope's pitch in one HTML file. Pair it with the official skills on getslope.dev — "install SLOPE, upload the skills, and your AI agent knows how to run sprints and interpret performance data out of the box."

10. **Slope navigates, the model implements.** The semantic codebase index (`slope index`) means Slope knows which files are relevant to any ticket. `slope context` replaces the repo map. `slope prep` replaces the model's planning step. `slope enrich` front-loads everything at backlog time. The model's role shrinks to its highest-value activity: writing correct code given precise instructions. Everything else — orientation, navigation, planning, scoring — is handled by Slope, which has the institutional knowledge to do it better and cheaper.

11. **The self-referential endgame.** Sprint 41+ generates data → data generates backlog → `slope enrich` pre-computes context → `slope prep` structures execution → model writes code → `slope auto-card` scores → data feeds back. The loop guide skill evolves with each sprint. The model selector learns which model works best. `slope suggest` replaces `analyze.ts`. The Skills API (`/v1/skills`) opens a path to replacing Aider entirely — the loop becomes Slope CLI + Claude API + Slope skills + semantic context, all first-party. The system improves itself, and the improvements are portable.
