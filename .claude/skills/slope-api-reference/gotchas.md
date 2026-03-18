# SLOPE MCP Gotchas

All known MCP tool gotchas. Read before writing execute() code or debugging tool errors.

## 1. Path Escape Blocking

**What:** The sandbox prevents accessing files outside the project root. Absolute paths and `../` traversal are blocked by `safePath()`.

**Workaround:** Always use relative paths from the project root:
```javascript
// Bad — blocked
readFile("/Users/me/other-project/file.ts")
readFile("../../other-project/file.ts")

// Good — relative to project root
readFile("src/core/scoring.ts")
readFile(".slope/config.json")
```

## 2. 30-Second Timeout on execute()

**What:** The sandbox has a 30-second execution timeout (`vm.runInContext` with timeout option). Long-running computations will be killed.

**Workaround:** Keep execute() calls focused. If processing many scorecards, filter first:
```javascript
const recent = loadScorecards().slice(-10);
return computeHandicapCard(recent);
```

## 3. No require/import in Sandbox

**What:** The sandbox runs in `node:vm` context. `require()`, `import`, and `module` are not available. Only pre-injected SLOPE APIs and standard globals are accessible.

**Workaround:** Use the pre-injected functions. All core exports from `src/core/index.ts` are available as globals. File operations use `readFile()`, `writeFile()`, `listFiles()` (not `fs`).

## 4. context_search Uses Fixed-String Grep, Not Regex

**What:** `context_search` falls back to fixed-string grep when embeddings are unavailable. Regex patterns won't match — they're treated as literal strings.

**Workaround:** Use simple keywords, not regex patterns:
```javascript
// Bad — treated as literal string ".+Handler"
context_search(".+Handler")

// Good — plain keyword
context_search("Handler")
context_search("webhook handler")
```

## 5. Console Output Captured to Logs Array

**What:** `console.log()` output inside execute() is captured to a `logs` array in the response, not displayed directly. The return value is what you see as the main result.

**Workaround:** Always `return` the data you want to see. Use `console.log()` only for debugging:
```javascript
// The result is the return value
return computeHandicapCard(loadScorecards());

// console.log output appears in response.logs
console.log("debug info");
```

## 6. search({ module: 'map' }) Returns Full CODEBASE.md

**What:** The `map` module is a special case — it returns the full CODEBASE.md content, not filtered registry entries. This is the L1 context tier.

**When to use:** When you need the complete codebase overview (~5k tokens). For targeted questions, use `search({ module: 'map', query: 'guards' })` to get a specific section.

## 7. Store-Backed Tools Require .slope/slope.db

**What:** Session, claim, conflict, and testing tools all require the SQLite store. They return errors if the store file doesn't exist or is corrupted.

**Workaround:** Check store health first:
```javascript
store_status({})
// If issues, run: slope store backup && slope store restore
```

## 8. Only One Active Testing Session at a Time

**What:** `testing_session_start` fails if a testing session is already active. You must end the current session before starting a new one.

**Workaround:** Check status first:
```javascript
testing_session_status({})
// If active, end it: testing_session_end({ summary: "..." })
```

## 9. Worktree Cleanup Can Fail Silently

**What:** Git worktree removal sometimes fails without a clear error, especially when the worktree is the current working directory or has a lock file.

**Workaround:** The `worktree-self-remove` guard blocks self-removal. For cleanup, use `slope loop clean --worktrees` or `git worktree prune`.

## 10. Config Paths Auto-Resolve from .slope/config.json

**What:** `loadConfig()` in the sandbox resolves paths relative to `.slope/config.json`. You don't need to specify the config path — it's found automatically by walking up from cwd.

**Implication:** Config-dependent functions (like `loadScorecards()`) work without arguments in the sandbox.

## 11. parseRoadmap() Returns null on Invalid Input

**What:** `parseRoadmap(json)` returns `{ roadmap: null, validation: { valid: false, errors: [...] } }` on invalid input. It does NOT throw.

**Workaround:** Always check the validation result:
```javascript
const result = parseRoadmap(data);
if (!result.roadmap) {
  return { error: "Invalid roadmap", details: result.validation.errors };
}
return result.roadmap;
```

## 12. Return Values Must Be JSON-Serializable

**What:** The sandbox serializes return values to JSON. Functions become `null`, circular references throw, and `undefined` becomes `null`.

**Workaround:** Return plain objects, arrays, strings, numbers. Don't return functions or class instances with methods:
```javascript
// Bad — function values become null
return { compute: () => 42 }

// Good — plain data
return { result: 42 }
```
