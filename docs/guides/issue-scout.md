# SLOPE Issue Scout

`slope issue` detects likely SLOPE product issues from agent work, de-dupes them against GitHub, and prepares a daily approval digest.

## Manual Scout

Run a dry scan against local evidence:

```sh
slope issue scout \
  --source .slope/common-issues.json \
  --source .slope/transcripts \
  --repo srbryers/slope \
  --dry-run
```

For machine-readable output:

```sh
slope issue scout --repo srbryers/slope --dry-run --json
```

The dry-run output includes:

- candidate title
- confidence
- labels
- evidence
- generated issue body
- fingerprint
- de-dupe result

## Creating Issues

Create mode is explicit:

```sh
slope issue scout --repo srbryers/slope --create
```

The scout opens GitHub issues only for candidates that do not match an existing issue title or scout fingerprint. It records created, commented, or de-duped fingerprints in `.slope/issue-scout.json` by default.

To add fresh evidence to matching issues instead of only recording the duplicate:

```sh
slope issue scout --repo srbryers/slope --create --comment-duplicates
```

## Daily Digest

Render the approval digest:

```sh
slope issue triage \
  --repo srbryers/slope \
  --daily-digest \
  --output .slope/issue-scout-digest.md
```

The digest includes a `Request Approval To Fix` section. Each new candidate asks for one explicit decision: approve fix, defer, or reject.

## GitHub Action

`.github/workflows/slope-issue-scout.yml` runs daily and on manual dispatch.

Scheduled runs:

- build SLOPE from the checked-out repository
- scan committed `docs/issues` plus optional `.slope` paths
- write `.slope/issue-scout-candidates.json`
- write `.slope/issue-scout-digest.md`
- upload both as artifacts
- email the digest when secrets are configured

Manual dispatch can also create issues by enabling `create_issues`.

## Email Secrets

Email is optional. The workflow sends through Resend when all three secrets exist:

- `RESEND_API_KEY`
- `SLOPE_DIGEST_EMAIL_TO`
- `SLOPE_DIGEST_EMAIL_FROM`

Without those secrets, the workflow still uploads the digest artifact and logs that email was skipped.

## Safety Model

- Scheduled runs are proposal-only.
- Issue creation requires manual `workflow_dispatch` with `create_issues=true`.
- Duplicate titles and scout fingerprints are not opened as new issues.
- Duplicate commenting is off unless `--comment-duplicates` is passed.
- The daily digest is an approval request, not an authorization to fix.

After approval, run the normal sprint loop: open a sprint, claim the issue, implement, test, score, review, PR, and merge.
