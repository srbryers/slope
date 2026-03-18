# Error Recovery — Loop Troubleshooting Guide

Expanded error handling scenarios and recovery steps for the autonomous loop.

## Sprint Execution Errors

### `slope auto-card` fails
**Symptoms:** Auto-card generation returns an error or produces an empty scorecard.
**Cause:** Usually missing commits on the branch or failing tests.
**Recovery:**
1. Check that the sprint branch has commits: `git log --oneline main..HEAD`
2. Verify tests pass: `pnpm test`
3. Verify typecheck passes: `pnpm typecheck`
4. If tests fail, fix them before retrying auto-card
5. If no commits exist, the sprint had no work — skip scoring

### `slope store status` reports issues
**Symptoms:** Store health check returns warnings or errors.
**Recovery:**
1. Run `slope store backup` to create a safety copy
2. Check `.slope/slope.db` file permissions and integrity
3. If corrupt, delete `.slope/slope.db` and re-run `slope extract` to rebuild from git history
4. Re-run `slope store status` to verify recovery

### Ollama returns empty responses
**Symptoms:** Local model produces no output or garbage output.
**Recovery:**
1. Verify model is loaded: `ollama list`
2. Check Ollama is running: `curl http://localhost:11434/api/tags`
3. Try a simple test with the configured local model (check `slope loop config --show` for the model name)
4. If model is corrupted, re-pull: `ollama pull <model-name>`
5. If Ollama is down, the loop should auto-escalate to API model

### Aider edit blocks fail to parse
**Symptoms:** Aider reports "Failed to apply edit" or produces malformed diffs.
**Recovery:**
1. Try `--edit-format diff` instead of default
2. Try `--edit-format whole` for simple single-file changes
3. Check if the file has unusual encoding or very long lines
4. Reduce the scope of the edit request

## Loop Infrastructure Errors

### Loop stalls (no progress)
**Symptoms:** Loop hasn't produced output for >10 minutes.
**Recovery:**
1. Check guard output in transcript — guards may be blocking tool use
2. Check if a hook is hanging: look for long-running processes
3. Check system resources: disk space, memory, CPU
4. If a guard is blocking, check its condition and resolve the underlying issue
5. Restart the loop with `slope loop run --sprint=<current>`

### Escalation triggers unexpectedly
**Symptoms:** API model is used for tickets that should run locally.
**Recovery:**
1. Review `slope escalate` output for trigger details
2. Check model tier rules — multi-file or high-token tickets always escalate
3. Review `slope loop models --analyze` for success rate data
4. If local model is consistently failing, check Ollama health
5. Adjust thresholds via `slope loop config --set token_threshold=<N>`

### Backlog exhausted
**Symptoms:** Loop reports "no sprints remaining" but work isn't done.
**Recovery:**
1. Run `slope loop analyze --regenerate` to mine scorecards and regenerate backlog
2. Check `docs/backlog/` for the regenerated sprint queue
3. If regeneration produces no tickets, the roadmap may need updating
4. Manually create a sprint plan if automated generation is insufficient

## Git & Worktree Errors

### Worktree cleanup fails
**Symptoms:** `git worktree remove` fails or leaves stale worktrees.
**Recovery:**
1. List worktrees: `git worktree list`
2. Check for locks: look for `.git/worktrees/<name>/locked` files
3. Force remove if needed: `git worktree remove --force <path>`
4. Clean stale entries: `git worktree prune`
5. Use `slope loop clean --worktrees` for automated cleanup

### Branch conflicts during parallel execution
**Symptoms:** Multiple worktrees try to modify the same files.
**Recovery:**
1. The parallel runner should detect module overlap and serialize conflicting sprints
2. If conflicts occur, resolve manually in the primary worktree
3. Use `slope loop parallel --dry-run` to preview overlap detection before running
