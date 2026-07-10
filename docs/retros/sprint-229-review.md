## Sprint 229 Review: Modular Roadmap Source Federation

### SLOPE Scorecard Summary

| Metric | Value |
|---|---|
| Par | 4 |
| Slope | 4 |
| Score | 6 |
| Label | Double Bogey |
| Fairway % | 100% (4/4) |
| GIR % | 100% (4/4) |
| Putts | 2 |
| Penalties | 0 |
| Hazard Penalties | 2 |

### Shot-by-Shot (Tickets Delivered: 4)

| Ticket | Club | Result | Hazards | Notes |
|---|---|---|---|---|
| S229-1 | Long Iron | Green | Bunker: Independent review found that permissive compatibility casting could surface raw runtime errors and that manifest membership, kind, and order were not enforced as the compilation authority. Strict source schemas and exact reconciliation replaced the loose boundary. | Added versioned project, phase, backlog, and archive YAML contracts with an ordered manifest and source-attributed validation errors. |
| S229-2 | Long Iron | Green | Bunker: The first implementation allowed the manifest output to overlap authored or unrelated repository files and did not reject logical S435/S43.5 collisions. Output is now pinned to roadmapPath and identity normalization is roadmap-aware. | The compiler preserves authored manifest order and emits a byte-stable RoadmapDefinition projection while unchanged projects remain in single-file mode. |
| S229-3 | Long Iron | Green | Bunker: Safety review exposed repository traversal through symlinked roots, incomplete multi-file guard coverage, malformed/delete terminal-history bypasses, and custom --source authority bypasses. All paths now fail closed with dedicated regressions. | Validation covers duplicate and logical-collision IDs, phase membership, dependencies, projection drift, archived scorecard identity, strict YAML, realpath containment, and generated-output authority. |
| S229-4 | Short Iron | Green | Bunker: Independent review found archive plan/apply races and a data-loss path where an archive destination aliased the live source by symlink, junction, or hard link. Replanning under a federation lock, byte verification, and independent-file identity checks closed the paths. | Archive moves only whole terminal phases with durable scorecard links, keeps compiled bytes unchanged, and rejects conflicting, raced, or aliased destinations. |

### Conditions

| Condition | Impact | Description |
|---|---|---|
| Wind | major | The feature creates a new filesystem authority boundary over durable project history, so compatibility, identity, path containment, crash behavior, and archive races all had to be proven together. |

### Hazards Discovered

| Type | Ticket | Description |
|---|---|---|
| Bunker | S229-1 | Independent review found that permissive compatibility casting could surface raw runtime errors and that manifest membership, kind, and order were not enforced as the compilation authority. Strict source schemas and exact reconciliation replaced the loose boundary. |
| Bunker | S229-2 | The first implementation allowed the manifest output to overlap authored or unrelated repository files and did not reject logical S435/S43.5 collisions. Output is now pinned to roadmapPath and identity normalization is roadmap-aware. |
| Bunker | S229-3 | Safety review exposed repository traversal through symlinked roots, incomplete multi-file guard coverage, malformed/delete terminal-history bypasses, and custom --source authority bypasses. All paths now fail closed with dedicated regressions. |
| Bunker | S229-4 | Independent review found archive plan/apply races and a data-loss path where an archive destination aliased the live source by symlink, junction, or hard link. Replanning under a federation lock, byte verification, and independent-file identity checks closed the paths. |

**Known hazards for future sprints:**
- Validate authored schemas before casting to a compatibility model.
- Treat the ordered manifest as an exact closed source set.
- Constrain configured outputs and sources by lexical path, realpath, and filesystem identity.
- Re-plan destructive filesystem operations inside the same lock used for commit.
- Fail closed when durable terminal history cannot be parsed or reconstructed.
- Test CLI authority rules with default, custom, and deliberately missing source selectors.

### Training Log

| Type | Description | Outcome |
|---|---|---|
| Lessons | A generated compatibility file needs exactly one explicit authoring authority. | Modular projects reject direct sync/generate/projection edits and compile only the complete ordered manifest. |
| Lessons | Lexical path containment is insufficient wherever symlinks, junctions, and hard links can exist. | Source loading uses realpath containment and archive moves prove the destination is an independent regular file. |
| Lessons | Archive safety depends on identity and time, not only equal bytes. | Archive re-plans under a shared lock and verifies source/destination bytes and filesystem identity before committing and deleting. |
| Lessons | History protection must fail closed on deletion and malformed replacement. | The guard parses current terminal history separately and denies unverifiable next content across every touched source. |

### Nutrition Check (Development Health)

| Category | Status | Notes |
|---|---|---|
| testing | healthy | Focused federation, guard, and roadmap suites passed after independent-review repairs; both reviewers independently reran their scopes. |
| testing | healthy | The complete Vitest suite passed: 3,780 tests. |
| build | healthy | Production build and TypeScript typecheck passed, including packages/pi-extension. |
| review | healthy | Independent architecture and filesystem-safety lanes requested changes, then approved the hardened implementation with durable tracked evidence. |

### Course Management Notes

- All implementation and hardening commits are pushed; no PR merge is implied.
- Independent architecture and safety reviews are approved and recorded in adjacent tracked evidence files.
- A process kill after manifest commit may leave an orphan source copy, but authoritative bytes and validation remain intact.

### 19th Hole

- **How did it feel?** The compatibility compiler was tractable; making a durable filesystem authority genuinely safe required several adversarial review rounds.
- **Advice for next player?** Dogfood the source layout with byte-for-byte projection checks before treating modular mode as mature.
- **What surprised you?** Equal destination bytes were not evidence of a safe copy because the path could still be the same inode through an alias.
- **Excited about next?** S232 can migrate SLOPE itself while legacy consumers continue reading the same roadmap.json contract.

