# Wrap Session — Close Out the Working Session

Run the session-close routine. A session is not a sprint: a long session can span several sprints or end mid-sprint, so this complements `/post-sprint` rather than replacing it. Leaked claims and unpushed work are the two failure modes this prevents.

## Steps

### 1. Generate the standup wrap

Run `slope standup` — it reports sprint + scorecard state, branch + commits this session, transcript volume, blockers, and decisions. This is the body of your handoff summary.

### 2. Check for unpushed work

The last push is the recovery point. Run:

- `git status --short` — uncommitted changes? Commit them (use a `wip:` prefix if incomplete).
- `git log @{upstream}..HEAD --oneline 2>/dev/null || git log origin/main..HEAD --oneline` — unpushed commits? Push the branch.

Never end a session with uncommitted or unpushed work.

### 3. Report sprint state

- `slope sprint status` — if gates are pending, say which ones in the handoff.
- For every sprint touched this session, confirm `docs/retros/sprint-N.json` exists or note that the scorecard is missing.
- `slope status` — check for dangling workflow executions or stale claims that would gate the next session.

### 4. End the session

Run `slope session end` — with one active session it defaults to it; this releases the session's claims. Leaked claims block later sessions.

### 5. Emit the handoff summary

Close with a short summary for the next session:

- **Shipped**: PRs merged, sprints closed (with scores)
- **Open**: current sprint state, pending gates, unmerged branches
- **Next**: the single most useful thing the next session should pick up
