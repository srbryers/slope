# S231 Adversarial CLI Review

Reviewer: `s231_cli_adversarial`  
Lane: implementation correctness and abuse cases  
Verdict: APPROVED

The first review rejected forced dependency bypasses, weak scorecard evidence, duplicate flag ambiguity, missing lineage consumption, unsafe copyable commands, and overwrite paths in `start`, `begin`, workflow resync, guards, and portable resume. Each finding was reproduced before repair.

The approved implementation verifies:

- forced unfinished work never satisfies its own target dependency, even if roadmap metadata says complete;
- corrupt state and audit evidence fail closed without byte changes;
- duplicate and unknown lifecycle flags do not mutate state;
- copyable retry values are platform-aware and shell-quoted;
- begin, start, PR guards, workflow synchronization, review-tier initialization, and portable resume preserve/verify rollover lineage;
- guard output recommends force only when the target is otherwise dependency-eligible;
- installed audits continue to require their tracked scorecard evidence;
- reset remains an explicitly destructive emergency exception, not the normal boundary transition.

Validation: 170 focused tests and TypeScript typecheck passed. No reviewer edits were made.
