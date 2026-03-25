# Context Compression Sprint Plan

**Theme:** Reduce SLOPE context window usage by 60-80%
**Par:** 4 (4 tickets)
**Slope:** 2

## Measured waste (this session: 986 turns, 1762m)
- Edit+Write: 131 fires → hazard guard alone: ~49k tokens
- Read+Glob+Grep+Edit+Write: 529 fires → explore guard overhead
- Session briefing: ~6k tokens on first fire
- Repeated identical hazard injection across 131 edit operations

## Tickets

### T1: Session-level guard dedup + compressed format
Biggest savings. Hash guard output, track per session, replace repeats with one-liner.

### T2: L0/L1/L2 briefing tiers
Default briefing to ~200 tokens. --detail for ~1.5k. --full for current 25k.

### T3: Top-N hazard cap with severity ranking
Sort by recency * severity * specificity. Inject top 3, show count of remaining.

### T4: MCP response trimming
search({}) returns compact summaries. context_search caps output length.
