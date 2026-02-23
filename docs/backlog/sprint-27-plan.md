# Sprint 27 — The Clubhouse: Marketing Site & Design Tokens

**Par:** 4 | **Slope:** 3 | **Type:** feature

**Theme:** Migrate the SLOPE marketing site from Caddystack into a standalone `slope-web` repo, create a shared design tokens package in this monorepo, and rebrand for slope.dev.

## Tickets

| Ticket | Club | Summary |
|--------|------|---------|
| S27-1 | short_iron | Create `@srbryers/tokens` package — colors, typography, spacing, CSS generation |
| S27-2 | short_iron | Refactor core HTML reports to import colors/spacing from tokens |
| S27-3 | long_iron | Create `slope-web` repo — migrate Astro site from Caddystack, rebrand for slope.dev |
| S27-4 | wedge | Cloudflare Pages deployment for slope-web |
| S27-5 | putter | Docs, workspace config, publish workflow updates |

## Execution Order

```
S27-1 → S27-2 → S27-5
  ↘ S27-3 → S27-4
```

## Key Decisions

- Tokens package lives in this monorepo as `packages/tokens`
- Core reports import from `@srbryers/tokens` via `workspace:*`
- Marketing site is a separate repo (`srbryers/slope-web`) to keep this monorepo focused on installable packages
- Live stats API still points at caddystack.fly.dev (reference implementation)
- Domain registration and DNS for slope.dev are out of scope (Sprint 28+)
