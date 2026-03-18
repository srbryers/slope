# Loop Guide Gotchas

Loop-specific hazards from common-issues and sprint history. Read before running automated sprints.

## 1. Shell Script Boundary Values (common-issues #3)

**What:** Shell arithmetic comparisons (`-lt` vs `-le`, `-gt` vs `-ge`) are error-prone. Off-by-one errors in shell scripts have no type safety net.

**Examples:**
- S48: `-lt 500` excluded exactly 500 lines (should have been `-le`)
- S45: Multiple shell hazards accumulated 2.5 penalty points

**Prevention:** Explicitly test boundary values in shell scripts. Consider ShellCheck for static analysis. When writing arithmetic comparisons, always ask: "What happens at exactly the threshold value?"

## 2. process.exit() Inside try/finally (common-issues #5)

**What:** `process.exit(1)` inside a try block with `finally { db.close() }` — exit runs before finally in Node.js. Cleanup code never executes.

**Examples:**
- S46: Original store.ts hazard
- S49: Autonomous agent repeated the same pattern in restore validation

**Prevention:** Never call `process.exit()` inside try/finally. Use a flag/error variable, close resources in finally, then exit after the try/finally block.

## 3. AI-Generated Code Duplicates Existing Abstractions (common-issues #6)

**What:** Autonomous agents (Aider/Sonnet) may reimplement logic that already exists elsewhere in the same file or codebase.

**Examples:**
- S49: `validateSubcommand` duplicated `loadRoadmapFile`'s file-loading and error handling instead of extracting a shared helper

**Prevention:** Code review gate is essential for AI-generated code. Check for duplicated logic patterns across the modified file before merging. Use `search()` to find existing implementations before writing new ones.

## 4. gh pr merge --delete-branch Fails in Worktrees (common-issues #8)

**What:** `gh pr merge --delete-branch` succeeds at merging but exits 1 because local branch cleanup tries to switch to main, which is held by the parent worktree. Agent sees error, retries, gets "already merged."

**Examples:**
- Hit at least 4 times before S60 when it was mechanically enforced

**Prevention:** Now enforced by the `worktree-merge` guard. In worktrees, use `gh pr merge --squash` without `--delete-branch`. Remote branch is deleted by GitHub; local cleanup happens when worktree is removed.

## 5. Do Not Assume Shell Script Execution

**What:** The loop runs via Aider/Claude Code hooks, not by directly executing shell scripts. Assuming you can run `run.sh` or `continuous.sh` directly will fail or bypass the orchestration layer.

**Prevention:** Use `slope loop` CLI commands instead of shell scripts. Shell scripts are internal infrastructure maintained for backward compatibility.

## 6. Branch-Before-Commit Guard is Active

**What:** The `branch-before-commit` guard blocks commits directly to main/master. Autonomous agents that try to commit to main will be blocked.

**Prevention:** Always create a feature branch before making commits. The loop infrastructure handles this automatically, but manual interventions must respect it.

## 7. Test Validation is Mandatory

**What:** Loop auto-card generation requires passing tests. If tests fail, the sprint cannot be scored and the loop stalls.

**Prevention:** Always run `pnpm test` and `pnpm typecheck` before committing. The loop runs equivalent checks, but guard hooks during Claude Code sessions enforce this too.
