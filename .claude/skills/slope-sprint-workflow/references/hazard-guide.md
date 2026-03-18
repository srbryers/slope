# Hazard Guide — Types, Examples, Prevention

## Hazard Types

### rough — Code Friction
**Meaning:** Friction, wasted time, unclear requirements, missing context.
**Common causes:** API shape assumptions, missing type definitions, unclear ticket scope, insufficient pre-shot research.
**Review source:** Code review findings.

**Real examples:**
- S39: Nested event structure assumed flat — runtime crash
- S42: ESM/CJS boundary mismatch
- S44: HandicapCard property names guessed incorrectly
- S48: Threshold changed in one consumer but not others
- S49: AI-generated code duplicated existing abstractions

**Prevention:**
- Always read type definitions before consuming APIs
- Grep for all usages when changing shared constants
- Self-review diffs after complex tickets

### bunker — Architectural Trap
**Meaning:** Structural/design problems, wrong abstractions, tech debt.
**Common causes:** Wrong abstraction level, premature optimization, ignoring existing patterns.
**Review source:** Architect review findings.

**Real examples:**
- Choosing a new pattern when the codebase already has an established one
- Over-abstracting a one-off operation into a generic framework
- Missing dependency ordering in multi-package changes

**Prevention:**
- Check CODEBASE.md for existing patterns before introducing new ones
- Use `search({ module: 'core', query: '<pattern>' })` to find existing implementations
- Keep abstractions minimal — three similar lines > premature abstraction

### water — Blocking Issue
**Meaning:** External dependency failure, infrastructure problems, security issues.
**Common causes:** External API changes, CI/CD failures, missing environment variables, security vulnerabilities.
**Review source:** Security review findings.

**Real examples:**
- S46: `process.exit()` inside try/finally skipped cleanup
- External API timeout during sprint execution
- Missing environment variable in CI causing test failures

**Prevention:**
- Never call `process.exit()` inside try/finally
- Pin external dependencies
- Test with CI environment parity locally

### trees — UX/Design Issue
**Meaning:** User flow problems, accessibility gaps, poor developer experience.
**Common causes:** Missing error messages, confusing CLI output, incomplete help text.
**Review source:** UX review findings.

**Real examples:**
- CLI command with no `--help` output
- Error message that doesn't suggest next steps
- Guard output that's too verbose or unclear

**Prevention:**
- Include `--help` text for every new CLI command
- Error messages should say what went wrong AND what to do about it
- Test guard output readability

## Severity & Scoring Impact

| Severity | Penalty | When to use |
|----------|---------|-------------|
| Minor | +0.25 | Friction only, no rework needed |
| Moderate | +0.5 | Required small rework or workaround |
| Major | +1.0 | Required significant rework or revert |
| Critical | +1.5 | Blocked sprint progress or caused data loss |

## Hazard Hotspot Analysis

When multiple hazards cluster in the same module:
- **Single hazard type** — Targeted fix (e.g., add tests for `rough`)
- **Multiple hazard types** — Module needs architectural review before more changes
- **Spreading across modules** — Pattern is systemic; review process, not code
