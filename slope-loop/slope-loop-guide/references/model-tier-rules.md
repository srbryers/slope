# Model Tier Rules — Expanded Reference

Detailed model routing rules for the autonomous loop.

## Club-to-Model Mapping

| Club | Default Model | Rationale |
|------|--------------|-----------|
| Putter | Local (Qwen 32B) | Trivial changes — fast, free |
| Wedge | Local (Qwen 32B) | Small changes — fast, free |
| Short Iron | Local (Qwen 32B) | Standard work — try local first |
| Long Iron | API (MiniMax M2.5) | Multi-package — needs planning capability |
| Driver | API (MiniMax M2.5) | High risk — needs architect-level reasoning |

## Escalation Triggers

The loop auto-escalates from local to API model when:

1. **Local model failure** — If the local model fails to produce a valid edit, retry with API model before marking as miss
2. **Multi-file tickets** — Tickets with `max_files >= 2` always route to API regardless of club
3. **Documentation strategy** — Tickets with documentation-heavy strategy always route to API (local models struggle with prose)
4. **Token escalation** — If the ticket context exceeds 24K tokens, escalate to API model

## Token Thresholds

| Threshold | Action |
|-----------|--------|
| < 8K tokens | Local model (comfortable context) |
| 8K-24K tokens | Local model (monitor quality) |
| > 24K tokens | Auto-escalate to API model |

## Multi-File Detection

A ticket is classified as multi-file when:
- Explicit `max_files >= 2` in the backlog entry
- File analysis detects changes needed in 2+ source files
- Cross-package changes are required (always multi-file)

## Configuration

Model routing is configurable via `slope loop config`:

```bash
# Show current config
slope loop config --show

# Override default local model
slope loop config --set local_model=ollama/qwen3-coder-next-fast

# Override API model
slope loop config --set api_model=openrouter/anthropic/claude-haiku-4-5

# Set token escalation threshold
slope loop config --set token_threshold=24000
```

## Model Performance Tracking

Use `slope loop models` to analyze model selection outcomes:

```bash
# Show model analytics
slope loop models --analyze

# Show current model configuration
slope loop models --show
```

Track success rates per tier to inform routing adjustments. If local model success rate drops below 60%, consider raising the escalation trigger threshold.
