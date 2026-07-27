# Sprint 264 Scoring Methodology Review

- Reviewer: Noether (`019fa4c0-94e1-7cf1-b794-ccffd602fc34`)
- Lane: multi-agent scoring, attribution, and statistical methodology
- Scope: estimands, exposure selection, handoffs, penalties, missingness, adjustment, uncertainty, and legacy attribution
- Final reviewed commit: `0b1f051cefc0c3ceb4a459c0530f91653433175d`
- Final verdict: APPROVED

## Findings And Resolution

1. Selecting only completed shots conflicted with an estimand whose denominator includes every accepted exposure.
   Resolved by defining ownership spells over all accepted exposures and treating incomplete outcomes as missing rather than silently dropping exposure.
2. Post-outcome handoff state could leak the response into difficulty adjustment.
   Resolved by allowing handoff state to condition only the subsequent ownership spell.
3. Shot loss and penalty loss could count the same failure twice.
   Resolved with a disjoint loss ledger for shot loss, penalty loss, and round adjustments.
4. Estimator weights and clustered uncertainty were underspecified.
   Resolved with equal spell weights, effective-sample-size reporting, and a 2,000-replicate round-cluster bootstrap.
5. Legacy `agents[]` role labels could not safely establish actor identity.
   Resolved by treating them as role-only attribution and prohibiting actor inference from session or display labels.
6. Unattributed penalties could lower an actor or role handicap by remaining outside its point estimate.
   Resolved by excluding penalties and round adjustments from the v1 actor and role handicap and reporting them as separate diagnostics.
7. The expected-loss model could learn the evaluated identity or the response it was meant to adjust.
   Resolved by excluding principal, actor, session, and role predictors and requiring external training or whole-round cross-fitting.
8. Five rounds were insufficient for ordinary cluster-bootstrap inference.
   Resolved with minimum reporting thresholds of 60 ownership spells across 30 closed rounds.
9. External predictive uncertainty could double-count aleatoric outcome variance.
   Resolved by propagating only conditional-mean or parameter uncertainty from the expected-loss model.

## Verification

The final review found no remaining P1 or P2 methodology issues and confirmed all prior findings remained resolved at `0b1f051`. The accepted scorecard version and as-of version are pinned per round, non-complete spells remain missing, identity and response leakage are forbidden, and penalty diagnostics are separated from the handicap estimand. The complete repository gate passed 259 test files and 4,324 tests with 27 skipped; TypeScript typecheck and production builds passed. The primary sprint-state SHA-256 remained `dd6cca8a8cc26d288b4742ab921949f0a1d4e1598f4382b318afd15e93f6f598` across the full suite.
