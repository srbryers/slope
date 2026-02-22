# SLOPE Sprint Checklist

## Pre-Tournament (Course Strategy)
1. Build roadmap in `docs/backlog/roadmap.json`
2. Run `slope roadmap validate` — check dependencies and structure
3. Run `slope roadmap review` — scope balance, critical path, bottlenecks
4. Run `slope roadmap show` — view dependency graph

## Pre-Round (Sprint Start)
1. Run `slope briefing` — handicap, hazards, gotchas, session continuity
2. Verify previous scorecard exists
3. Set par (1-2 tickets=3, 3-4=4, 5+=5) and slope factors

## Per-Ticket
- **Before:** Select club (driver/long_iron/short_iron/wedge/putter), scan hazards
- **After:** Score shot, record hazards, check penalties, commit + push

## Post-Hole (Sprint End)
1. Build scorecard JSON, run `slope validate`
2. Update common-issues with new patterns
3. Run `slope review` for markdown output
4. Run `slope card` for handicap trends

## Commit Discipline
- Commit after each file, feature, migration, or bug fix
- Push after each ticket and every 30 minutes
- Format: `<type>(<ticket>): <summary>` (feat/fix/refactor/docs/test/chore)
