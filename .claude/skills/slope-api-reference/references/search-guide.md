# search() Module Guide

What each search module returns, when to use it, and special cases.

## Module Overview

| Module | Returns | Token Cost | When to Use |
|--------|---------|-----------|-------------|
| *(none)* | All modules + functions | ~10k | Discovering what's available |
| `core` | Core scoring/analysis functions | ~3k | Finding specific function signatures |
| `fs` | Filesystem helper functions | ~1k | Finding file operation functions |
| `constants` | Exported constants | ~1k | Looking up thresholds, enums, mappings |
| `store` | Store interface methods | ~1k | Understanding store operations |
| `flows` | Flow definitions from .slope/flows.json | ~2k | Checking user flow mappings |
| `inspirations` | Inspiration entries | ~1k | Checking tracked OSS inspirations |
| `init` | Interview steps for `slope init` | ~2k | Understanding init workflow |
| `testing` | Test plan and testing functions | ~1k | Working with test sessions |
| `map` | Full CODEBASE.md | ~5k | Complete codebase overview (L1) |
| `types` | All TypeScript type definitions | ~5k | Understanding type shapes |
| `metaphor` | Metaphor schema + built-in list | ~2k | Working with display themes |

## Special Cases

### map — Full Codebase Overview
```javascript
search({ module: 'map' })
// Returns: Full CODEBASE.md content (~5k tokens)
// This is the L1 context tier

search({ module: 'map', query: 'guards' })
// Returns: Only the guards section of CODEBASE.md (~500 tokens)
// This is the L1.5 context tier
```

**When to use:** Starting a sprint, finding which package owns a feature, checking CLI commands or guard definitions.

**Staleness:** The response includes `generated_at` and `git_sha` metadata. If the map is stale (commits exist after `git_sha`), a warning is included.

### types — TypeScript Definitions
```javascript
search({ module: 'types' })
// Returns: All ~140 type definitions as TypeScript source
```

**When to use:** Before consuming an internal API — this is how you verify type shapes (the #1 hazard prevention). Also useful for understanding input/output shapes of execute() functions.

### init — Interview Steps
```javascript
search({ module: 'init' })
// Returns: Ordered interview steps for slope init workflow
```

**When to use:** Only when working on the init/onboarding flow. Returns the interview question sequence and validation rules.

### flows — User Flow Definitions
```javascript
search({ module: 'flows' })
// Returns: All flows from .slope/flows.json with staleness check

search({ module: 'flows', query: 'oauth' })
// Returns: Flows matching 'oauth' in id, title, or tags
```

**When to use:** When editing files that belong to a tracked user flow, or checking if a code path is mapped.

### metaphor — Display Themes
```javascript
search({ module: 'metaphor' })
// Returns: Metaphor schema (vocabulary fields) + list of built-in metaphors
```

**When to use:** When working with display output, adding new metaphors, or checking vocabulary mappings.

## Using the query Parameter

The `query` parameter filters results within the selected module:

```javascript
// Find all handicap-related functions in core
search({ module: 'core', query: 'handicap' })

// Find validation functions
search({ module: 'core', query: 'validate' })

// Find roadmap functions
search({ module: 'core', query: 'roadmap' })
```

**Note:** Query matching is case-insensitive and matches against function names, descriptions, and signatures.

## context_search vs search

| Feature | `search()` | `context_search()` |
|---------|-----------|-------------------|
| Source | SLOPE registry (curated) | Codebase files (grep/embeddings) |
| Best for | Function signatures, types | Implementation details, code patterns |
| Regex | No (plain text) | No (fixed-string grep fallback) |
| Modules | Yes (filtered views) | No (searches all files) |
| Token cost | Predictable per module | Variable (depends on matches) |

**Rule of thumb:** Use `search()` to find *what* exists. Use `context_search()` to find *where* and *how* it's implemented.
