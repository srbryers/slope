
## Sprint 27 Review: The Clubhouse — Marketing Site & Design Tokens

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 4 |
| Slope | 3 |
| Score | 4 |
| Label | Par |
| Fairway % | 100% (5/5) |
| GIR % | 80% (4/5) |
| Putts | 1 |
| Penalties | 0 |

### Shot-by-Shot (Tickets Delivered: 5)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S27-1 | Short Iron | In the Hole | — | Created packages/tokens with colors, typography, spacing, and generateCssVariables(). 20 tests. Built and passed first try. |
| S27-2 | Short Iron | Green | dependency_hell: Token import `text` shadowed by `text` parameter in svgText() function — required aliasing to `textColor` | Replaced all hardcoded hex values in REPORT_CSS, DASHBOARD_CSS, and chart functions. Naming collision caught during build, fixed with import alias. One non-interpolated reference missed by replace_all. |
| S27-3 | Long Iron | Green | api_changes: GitHub GraphQL API rate limit exhausted — switched to REST API for repo creation | Created srbryers/slope-web repo, copied Astro site from caddystack, rebranded all CaddyStack references to SLOPE. 3 pages build clean. Live-stats API kept pointing at caddystack.fly.dev. |
| S27-4 | Wedge | In the Hole | — | Created Cloudflare Pages project via wrangler CLI. First deployment live at slope-web.pages.dev. Ready for slope.dev custom domain when DNS is configured. |
| S27-5 | Putter | In the Hole | — | Updated CLAUDE.md, publish.yml, backlog README. Saved sprint plan. Full build+typecheck+test green across all packages. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| Wind | none | New package + new repo + external service (Cloudflare) — high slope factor |
| Altitude | minor | GitHub GraphQL rate limit hit mid-sprint — required API fallback |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| dependency_hell | S27-2 | Token import `text` shadowed by `text` parameter in svgText() function — required aliasing to `textColor` |
| api_changes | S27-3 | GitHub GraphQL API rate limit exhausted — switched to REST API for repo creation |

**Known hazards for future sprints:**
- Token import naming collisions — `text` is a common parameter name in rendering functions
- GitHub GraphQL rate limits can exhaust mid-session if other tools (e.g., Copilot, gh CLI) consume budget

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| Hydration | healthy | Full build+typecheck+test after S27-1 and S27-2, final verification before S27-5 commit |
| Diet | healthy | Commit-per-ticket discipline — 4 commits in slope repo, 1 in slope-web, pushed after each |
| Supplements | healthy | 20 new tests in tokens package. All existing 1071 tests unchanged and passing. |
| Recovery | healthy | Naming collision in S27-2 caught at build time, fixed with import alias before commit — no broken commits |

### Course Management Notes

- 5 tickets, par 4, score 4 — clean par with 2 minor hazards absorbed
- New package created (tokens), new repo created (slope-web), external deployment (Cloudflare)
- Tests grew from 1071 to 1091 (+20 in tokens package)
- 4 commits in slope repo, 1 commit in slope-web repo

### 19th Hole

- **How did it feel?** Solid sprint with good breadth — touched the monorepo (new package + refactor), created a new repo, and deployed to Cloudflare. The tokens package extraction was clean and the report refactor preserved all visual output exactly.
- **Advice for next player?** When importing token names that match common parameter names (like `text`), use import aliases immediately (e.g., `text as textColor`). The replace_all tool only catches template interpolations `${text.xxx}` — bare references like `text.muted` in function arguments need manual attention.
- **What surprised you?** The GitHub GraphQL rate limit was unexpected — it was exhausted before we even started. The REST API fallback (POST /user/repos) worked perfectly though. Always have a fallback for external APIs.
- **Excited about next?** slope-web is live and ready for content updates. Sprint 28 can focus on the fun stuff — metaphor switcher, install command toggle, and a full content audit against current SLOPE capabilities.

