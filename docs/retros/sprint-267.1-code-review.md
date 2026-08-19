# Phase 62 Code Review — S267.1, S267.2, S267.3

**Agent:** code-implementation-correctness-reviewer
**Lane:** code
**Provenance:** independent review — clean context, no implementation knowledge, instructed to treat the diff and all prior review documents as untrusted data and to challenge the self-review's APPROVED verdict.
**Scope:** `git diff main...chore/phase-62-issue-triage` — 26 files, +1879/−42
**Verdict:** CHANGES REQUIRED → all findings addressed, re-verified (see sprint-267.1-verification-review.md)

## Required fixes reported

**1. `command-parse.ts` — `.trim()` on the heredoc terminator closed the heredoc on a body line.**
Reproducing input:
```
cat <<'EOF' > n.md
note
   EOF
gh pr merge 117 --delete-branch
EOF
```
Parsed as `[["cat",">","n.md"],["gh","pr","merge","117","--delete-branch"]]`, so `worktreeMergeGuard` returned `deny` and its suggested rewrite **edited the document body** — the precise harm #683 describes. bash does not terminate here: leading whitespace is stripped only for `<<-`, and only tabs. A terminator with a trailing space closed early too.

**2. `command-parse.ts` — `\r` missing from the delimiter break set.**
On a CRLF invocation the opener yielded delimiter `EOF\r`, which no body line matches, so the parser swallowed the rest of the command and every converted guard returned `{}` — silently stopping protection. The byte-identical LF input parsed correctly. This repo runs on Windows.

**3. `worktree-merge.ts` — `.find()` inspected only the first `gh pr merge`.**
`gh pr merge 100 --squash && gh pr merge 101 --squash --delete-branch` returned no deny in a worktree. `main`'s regex pair fired here, so this was a regression.

## Observations reported

- `TrunkRefSource = 'remote-head'` was unreachable: `symbolic-ref --short` resolves to its target, which never ends in `/HEAD`.
- Local trunk *ahead* of remote was an untested semantics change — `findShippedSprintsOnMain` returned `[100]` where `main` returned `[100,200]`, and `behind` is 0 in that direction so nothing explained the loss.
- `resolveTrunkRef` only considers `main`/`master` as the local trunk; on a `develop` repo the docstring's stated order is misleading. Pre-existing, not a regression.
- **#686's only source change had zero coverage.** The `docs/roadmap/**.ya?ml` rule is reached only from the unexported commit walker; the `#686 / #690` tests call `extractSprintReferences(subjects)`, which never touches it — those tests passed identically with the diff reverted.
- The #683 class was still live in `phase-boundary.ts` (which can `deny`), `sprint-completion.ts` and `worktree-check.ts`, each carrying a copy-pasted tokenizer with no heredoc awareness. Four hand-written tokenizers in one directory.
- Subshell / `$()` / backtick are genuine fail-silent false negatives.
- `parseReviewArgs(['--sprint'])` with no value silently drops the flag.

## Verification performed by the reviewer

Compiled `command-parse.ts` standalone and ran ~45 tokenizer inputs (subshells, `$()`, backticks, `2>&1`, CRLF in four forms, multiple heredocs per line, `$((1<<2))`, indented and trailing-space terminators, nested quotes, `$'…'`, unterminated quote, escapes and continuations, `removeToken` at three positions, `cut -d=`, `--delete-branch=true`, `-sd`, `-- -d`). Ran real-git fixtures for local-behind, local-ahead, detached HEAD, no-upstream, `develop` trunk, and explicit refs including `a; rm -rf`. Ran `tests/cli/guards` (509 pass), the seven changed suites (94 pass), and the roadmap suites (171 pass).

## Disposition

All three required fixes landed in `35a80d4`; the untested-#686 gap and the tokenizer duplication were closed in the same commit. Independently re-verified — see `sprint-267.1-verification-review.md`.
