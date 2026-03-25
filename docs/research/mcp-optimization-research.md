# Cutting MCP context bloat: a technical guide for agent tooling systems

**The Model Context Protocol's biggest threat isn't capability — it's waste.** A typical five-server MCP setup consumes **55,000 tokens of tool definitions before a single user message**, eating 45% of a 128K context window. Worse, research on LLM attention patterns shows that injecting large volumes of context actively degrades performance: models lose **30%+ accuracy** when relevant information sits in the middle of long contexts, and effective context utilization drops below 50% of baseline at just 32K tokens for most frontier models. The good news is that a convergent set of techniques — progressive disclosure, semantic deduplication, compact formats, and lazy loading — can reduce MCP context overhead by **80–99%** with no capability loss. This report synthesizes insights from four mandatory articles, the latest MCP protocol spec, and patterns from every major AI coding agent to build a concrete optimization playbook for SLOPE and similar systems.

## The "MCP tax" is measured in millions of dollars

The scope of context bloat in MCP is now well-quantified. An analysis by MMNTM found that production-grade MCP tool definitions cost **550–1,400 tokens each**. A modest setup of five servers (GitHub at ~26K tokens, Slack at ~21K, Sentry at ~3K, Grafana at ~3K, Splunk at ~2K) totals roughly **55K tokens of baseline overhead**. Anthropic internally measured **134K tokens** of tool definitions before optimization in one configuration — nearly the entire context window of most models. A Scalekit benchmark across 75 runs found MCP costs **4–32x more tokens** than CLI for identical operations, translating to $55.20/month versus $3.20 for the same workflows. At enterprise scale, one projection estimates **$4 million in annual waste** from unused MCP definitions across 1,000 developers.

Claude Code enforces a hard **25,000-token limit** on individual MCP tool responses (`MAX_MCP_OUTPUT_TOKENS`), with warnings starting at 10,000 tokens. The system prompt, tool definitions, MCP schemas, and memory files consume **30,000–40,000 tokens** before any conversation begins. Performance degradation starts around **147K–152K tokens** — not at the advertised 200K ceiling. These numbers establish the constraint space for any optimization effort.

## More context actively hurts: the attention paradox

The most counterintuitive finding in this research is that **injecting more context often makes agents worse, not better**. The foundational "Lost in the Middle" paper (Liu et al., TACL 2024) demonstrated a U-shaped attention curve: LLMs perform best when relevant information appears at the **beginning or end** of context, with performance dropping **30%+ when critical data sits in the middle**. GPT-3.5-Turbo scored lower on multi-document QA with relevant info in position 10 of 20 documents than it did with *no documents at all*. This effect persists across GPT-4, Claude, and open-source models and traces to Rotary Position Embedding's long-term decay.

The NoLiMa benchmark (ICML 2025) found the problem is even worse than previously understood: at 32K tokens, **11 of 12 frontier models dropped below 50%** of their short-context performance. GPT-4o fell from 99.3% to 69.7%. The "effective context length" where models maintain 85% of baseline performance is typically **4K–16K tokens** — a fraction of advertised maximums. Chroma's Context Rot study tested 18 frontier models and confirmed universal degradation with increased input length, with the surprising finding that shuffled (unstructured) haystacks produced *better* performance than coherent ones.

For SLOPE specifically, this means the **25K-char briefing dump is actively counterproductive**. By the time hazard guards fire on the 8th file edit, earlier context sits squarely in the attention blind spot. The implication is clear: context compression isn't just about cost savings — it directly improves agent accuracy.

## What the four articles reveal about compression architecture

**Google's TurboQuant** (ICLR 2026) achieves **6x memory compression with zero accuracy loss** on KV caches by decomposing vectors into polar coordinates — separating magnitude (importance) from direction (meaning) — then applying a 1-bit residual error correction via quantized Johnson-Lindenstrauss Transform. The direct analogy for MCP context is a multi-resolution tool description system: decompose each tool into a relevance weight (how likely needed now) and a semantic core (what it does), then store at three precision levels — keywords-only (~1-bit), summarized (~3-bit), and full detail (~32-bit). TurboQuant's data-oblivious design — requiring no per-dataset calibration — suggests context compression strategies should work generically across arbitrary tool sets without per-tool tuning.

**Cloudflare's Dynamic Workers** provides the most directly applicable architecture. Their "Code Mode" paradigm replaces sequential MCP tool calls with code generation against typed APIs, achieving an **81% token reduction** from converting MCP to TypeScript interfaces and a staggering **99.9% reduction** for the Cloudflare API — from 1.17 million tokens to ~1,000 with just two tools: `search()` and `execute()`. The key insight is that TypeScript interfaces are dramatically more compact than OpenAPI/JSON Schema for describing the same API surface, and the model already understands TypeScript natively from training data. Their principle that "only the output, and not every intermediate step, ends up in the context window" is foundational. Dynamic Workers' millisecond cold starts via V8 isolates demonstrate that on-demand context loading need not impose latency penalties.

**Anthropic's long-running apps post** documents the evolution from context-anxious sessions (Sonnet 4.5 prematurely wrapping up work) to Opus 4.6 running continuously for 2+ hours with automatic compaction. The critical patterns are: **file-based state externalization** (JSON preferred over Markdown because "the model is less likely to inappropriately change or overwrite JSON files"), **sprint contracts** (negotiating scope before execution to prevent wasted tokens), and **progressive detail emergence** (planners generate high-level specs; implementation details surface just-in-time). Their compaction system "preserves architectural decisions, unresolved bugs, and implementation details while discarding redundant tool outputs." The simplification principle — "every component in a harness encodes an assumption about what the model can't do on its own, and those assumptions are worth stress testing" — directly challenges verbose guard implementations.

**Linear's product update** demonstrates these principles in production. Their MCP server explicitly "improved performance and reduced token usage through better tool documentation" — optimizing the tool descriptions themselves for brevity. They added **URL-based resource loading** (return references instead of full content) and **pagination** with cursor, limit, and orderBy parameters. Their health indicators compress complex project state into single tokens ("On track" / "At risk" / "Off track"), and Skills encode reusable workflows by name rather than re-explaining them each time. Linear Agent being "fully grounded in the context of your workspace" while handling 75% of enterprise workspaces demonstrates that context efficiency and capability aren't in tension.

## Protocol and platform features now available for context optimization

The MCP spec has evolved rapidly across four versions (2024-11-05 through 2025-11-25). Several features directly address context bloat:

**ResourceLink** (spec 2025-06-18+) allows tool results to return URI-based references with descriptions and MIME types instead of embedding full payloads. An arXiv paper documents the "dual response pattern" — servers return a small preview plus a ResourceLink for complete data, with the recommendation to cap preview data to **10–100 records** while reporting total_count. This is the protocol-level implementation of progressive disclosure.

**Tasks** (spec 2025-11-25, experimental) enables async "call-now, fetch-later" semantics. Long-running operations return a task handle rather than blocking the context window, with polling and TTL support. The `io.modelcontextprotocol/model-immediate-response` extension returns control to the model while tasks execute in the background.

**Claude Code's MCPSearch** (v2.1.7+) automatically defers tool discovery when MCP tool descriptions exceed **10% of context window**. Tools are loaded on-demand via regex or BM25 search rather than pre-loaded. One benchmark showed overhead dropping from 51K to 8.5K tokens — a **83% reduction**. However, multiple GitHub issues report MCPSearch failing to auto-trigger with HTTP-type MCP servers.

**Anthropic's Tool Search Tool** (November 2025) provides an API-level equivalent: setting `defer_loading: true` on tool definitions achieved **85% reduction** (72K → 8.7K for 50+ tools) with accuracy *improvements* (Opus 4.5: 79.5% → 88.1%). **Programmatic Tool Calling** goes further: Claude writes Python code orchestrating tools in a sandbox, with intermediate results never entering context — yielding **37% average reduction** and up to **98.7%** for data-pass-through workflows.

**Prompt caching** (GA since December 2024) prices cache reads at **0.1x base input cost** — a 90% reduction. Since tool definitions are processed first and remain stable, they're excellent cache candidates. A 55K-token tool definition set costs ~$0.26 on first request but drops to ~$0.017 on subsequent turns. Extended 1-hour TTL caching (beta) enables cross-session savings.

Community proposals are pushing further. **SEP-1576** (Huawei) proposes schema deduplication via JSON `$ref` references, adaptive optional field control, flexible response granularity levels, and embedding-based tool retrieval. **Discussion #799** requests extending pagination to tool responses (not just list operations), including `paginationHint` annotations and client metadata (context window size) for servers to optimize page sizes.

## How AI coding agents solve the context budget problem

The major AI coding agents have converged on remarkably similar patterns, each with distinctive innovations worth studying.

**Aider's repo map** is the most elegant context selection mechanism. It uses tree-sitter to parse source files across 130+ languages, builds a dependency graph, then runs a **PageRank-style algorithm** to identify the most-referenced symbols. A binary search algorithm fits ranked symbols within a configurable token budget (default **1K tokens**). The map dynamically expands when no files are explicitly added, using a 2x multiplier to give the agent broader orientation. This graph-theoretic approach to relevance ranking directly applies to SLOPE's hazard prioritization: hazards could be ranked by their "PageRank" across affected files.

**Cursor's dynamic context engine** achieves **46.9% token reduction** in multi-MCP-server workflows through cross-server deduplication and adaptive scaling. Their principle — "context retrieval, not context dumping; structural signals over raw text; continuous relevancy evaluation instead of static prompts" — encapsulates the entire optimization philosophy.

**Windsurf's real-time action awareness** tracks developer actions (saves, test runs, navigation) and injects them automatically as context signals. Past conversation summaries are stored as Memories, loaded by reference rather than full content. This session-level state tracking directly addresses the semantic deduplication problem.

**GitHub Copilot** reserves ~30% of context for output, auto-compacts at 95% utilization, and recently introduced **Memories** — persistent learned patterns about project-specific standards that survive across sessions. The pattern of learning from corrections ("remember: always use camelCase in this project") provides a compression mechanism where a single memory replaces repeated corrections.

**Claude Code's subagent architecture** is particularly relevant for SLOPE. Each subagent gets a fresh context window and returns only summaries to the parent session. This is the most effective context isolation mechanism available: offload heavy processing to a subagent, get back a compressed result. Arize found in production that sub-agent architecture outperformed LLM-based summarization, which introduced subtle "framing drift."

## SLOPE's five proposals: evaluated, expanded, and enhanced

### Session-level deduplication (estimated 2–5K savings)

The estimate is conservative. Research indicates **30–40% of retrieved context is semantically redundant** in production agent sessions. The most practical implementation is hash-based: before injecting any guard or briefing content, compute a content hash and check it against a session-level seen-set. If identical content was injected within the last N turns, replace with a brief reference ("⚠️ Hazard guard #3 still active — see turn 4"). For semantically similar but not identical content, **SemHash** (using Model2Vec embeddings + approximate nearest neighbor search) provides configurable similarity thresholds (~0.90 for conservative dedup). OpenCode's Dynamic Context Pruning plugin implements a production-ready version: automatic duplicate tool-call removal, error purging after N turns, and configurable turn-based protection windows. **Realistic savings: 3–8K tokens per session**, especially for SLOPE's repeated hazard guard pattern.

### Compressed guard format (estimated 1–3K per area)

This estimate is achievable and potentially conservative. The format change alone delivers significant savings: **Markdown is 16–38% more token-efficient than JSON**, and **YAML provides 10–15% savings** with the best comprehension accuracy for nested data. For hazard guards specifically, a compressed format could use structured shorthand:

```
⚠ [P1] auth/middleware: JWT validation bypass on expired tokens (2026-03-15)
⚠ [P2] db/migrations: Schema drift in staging vs prod (2026-03-10)
```

versus the current prose format. Beyond format, **severity-tiered injection** multiplies savings: P1 (critical) hazards get full text on every fire, P2 gets full text once then one-liner references, P3+ gets index entries with on-demand expansion. **Position the highest-severity hazards at the start or end of context** to exploit the U-shaped attention curve. Combined with deduplication, this yields **2–5K savings per area** — roughly double the original estimate.

### Progressive MCP disclosure (estimated 3–5K per search)

This is the highest-impact optimization and the estimate should be raised. The evidence is overwhelming: Claude-Mem's progressive approach achieved **26x more token efficiency** than full-context dumps (800 tokens vs. 25,000 for the same information at 100% relevance). Microsoft's Agent Skills implementation saves **88%** with three-tier disclosure across 132 skills. Cloudflare's two-tool architecture (search + execute) reduced token usage by **99.9%** for the entire Cloudflare API.

For SLOPE, implement L0/L1/L2 as:
- **L0 (~200 tokens):** Sprint name, score, 3-word status per active issue, total hazard count, top-1 hazard title
- **L1 (~1,500 tokens):** Full issue summaries, hazard titles with severity, recent scoring changes, roadmap milestones
- **L2 (full data):** Complete hazard descriptions, historical scores, full roadmap context, all CLI command docs

The agent requests L1 or L2 only when its current task requires specific detail. **Realistic savings: 4–5.5K tokens on first call, plus compounding savings across the session** as the agent avoids loading irrelevant detail. One caveat from Vercel's agent evaluations: skills were never invoked in 56% of test cases, suggesting that metadata quality is critical — invest heavily in making L0 descriptions accurate triggers for L1/L2 loading.

### Briefing compression (estimated 5K on first call)

The 25K-char (~6K token) monolithic briefing is SLOPE's largest single context cost and the most counterproductive given attention research. The estimate of 5K savings assumes reducing to ~1K tokens, which is achievable. Three complementary techniques:

**Recency filtering:** Only include hazards, issues, and scores from the last N sprints (e.g., 2 sprints). Older data is available via explicit MCP queries. Since the "Lost in the Middle" research shows older context gets ignored anyway, removing it proactively saves tokens without losing effective information.

**Category counts with drill-down:** Replace "here are all 15 known hazards" with "15 hazards: 3 critical (auth, deployment, data), 7 moderate, 5 low — query `slope hazards --severity critical` for details." This is the same pattern as Linear's health indicators — compressing complex state into high-signal tokens.

**Structured shorthand format:** Use TSV or compact YAML instead of prose. For tabular sprint data (scores, rankings), **TSV is 40–50% more token-efficient** than JSON. A sprint scorecard in TSV might cost 200 tokens versus 400+ in formatted JSON.

Combined, these reduce the briefing from ~6K to ~800–1,200 tokens. **Realistic savings: 4.8–5.2K tokens**, aligning with the estimate. The LLMLingua library could provide additional compression (up to 5x with minimal quality loss on structured data), though the simpler approaches above likely suffice.

### Relevance-ranked hazards (estimated 1–2K per fire)

The current pattern of injecting all hazards for a file area on every edit is the wrong approach both for token efficiency and agent accuracy. A two-stage retrieval pipeline is standard practice in RAG systems:

**Stage 1 (fast filtering):** Use BM25 keyword matching against the current file path and edit content to retrieve candidate hazards. This is computationally cheap (~2ms for <50 items) and eliminates obviously irrelevant hazards.

**Stage 2 (relevance scoring):** Apply Maximal Marginal Relevance (MMR) to select diverse, relevant hazards. Rank by a composite score: `0.4 * recency + 0.3 * severity + 0.2 * specificity + 0.1 * edit_proximity`. Return only the **top 3–5 hazards** rather than all matching hazards.

Anthropic's Contextual Retrieval demonstrates that combining contextual embeddings with BM25 and reranking achieves a **67% reduction in retrieval failure rate**. For SLOPE's ~30-command system with likely dozens of hazards, this reduces per-fire injection from ~1.5K chars to ~400–600 chars for the top-N most relevant. **Realistic savings: 900–1,100 chars (roughly 225–275 tokens) per fire**, which compounds across a session with many edits. The estimate of 1–2K per fire is slightly optimistic in char terms but accurate in cumulative session impact.

## Six additional techniques beyond the original five

**Subagent delegation for heavy queries.** When SLOPE MCP search returns large result sets, offload processing to a Claude Code subagent. The subagent gets its own context window, processes the full results, and returns only a compressed summary. Arize found this outperformed LLM-based summarization in production.

**Compaction-aware response annotations.** MCP responses could tag sections as `compaction-safe` (can be discarded after processing, like raw data dumps) versus `must-retain` (like configuration decisions or IDs). Claude Code's compaction system would preserve the tagged essentials while aggressively compressing everything else.

**Code Mode for complex queries.** Following Cloudflare's pattern, SLOPE could expose a `slope_execute(code)` meta-tool that accepts a code block combining multiple SLOPE queries. Instead of five separate MCP tool calls (each consuming context for schema + response), the agent writes one code block that chains queries and returns only the final result. Cloudflare demonstrated **81–99.9% savings** with this approach.

**Token-budget-aware responses.** SLOPE's MCP server could accept a `token_budget` parameter and adjust response verbosity accordingly. With 150K tokens remaining, return full briefings. With 20K remaining, return only critical-path information. The MCP spec doesn't yet support context window negotiation (SEP-1576 proposes it), but SLOPE can implement it unilaterally as a tool parameter.

**Persistent cross-session memory.** Like GitHub Copilot's Memories feature, SLOPE could maintain a persistent learned-context file that captures project-specific patterns ("this repo always has migration issues," "auth tests are flaky on Wednesdays"). This replaces repeated hazard explanations with a single loaded memory, amortizing context cost across sessions.

**Format optimization.** Switch all structured SLOPE output to the most token-efficient format for its data type: TSV for scoreboards and tabular data (**40–50% savings** over JSON), YAML for configuration and nested structures (**10–15% savings** with best comprehension accuracy), and Markdown for narrative content (**16–38% savings** over JSON). Avoid TOON or other exotic formats — LLMs perform best with formats abundant in training data.

## Conclusion

The research converges on a clear hierarchy of interventions. **Progressive disclosure delivers the largest single improvement** — converting monolithic dumps to tiered L0/L1/L2 responses can save 80–99% of tokens while actually improving agent accuracy by keeping the context window focused. **Semantic deduplication is the second-highest priority**, eliminating the 30–40% redundancy that accumulates in long sessions. **Format optimization and relevance ranking** provide steady compound gains across every interaction.

The most important insight is not about efficiency — it's about effectiveness. The "Lost in the Middle" research, NoLiMa benchmark, and Context Rot study collectively prove that **aggressive context compression isn't a tradeoff between cost and capability**. It improves both. SLOPE's 25K-char briefing isn't just expensive; it's actively making the agent worse at its job. The optimal context window for most tasks is **4K–16K tokens of highly relevant information**, not 150K tokens of everything-that-might-matter.

For SLOPE specifically, implementing the five proposed solutions plus the six additional techniques described here should reduce per-session token usage by **60–80%** while improving agent task accuracy. The implementation priority should be: (1) progressive briefing disclosure, (2) hazard guard deduplication with severity tiering, (3) format optimization to YAML/Markdown/TSV, (4) relevance-ranked hazard injection, and (5) token-budget-aware response sizing. The MCP ecosystem is rapidly building the infrastructure for these patterns — ResourceLink, Tasks, MCPSearch, and Programmatic Tool Calling are all shipping now — and SLOPE should adopt them as they mature.