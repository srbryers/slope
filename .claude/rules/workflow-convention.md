# Workflow Convention

## When to use workflows

- **Always** for new sprint execution via `slope sprint run --workflow=<name>`
- **Opt-in** for `slope loop` via `LoopConfig.workflowName`
- **Not required** for legacy sprint tracking (`slope sprint start/gate`)

## Built-in workflows

| Workflow | Use case | Phases |
|----------|----------|--------|
| `sprint-standard` | Interactive sprints with full SLOPE ceremony | pre_hole → per_ticket → post_hole |
| `sprint-autonomous` | `slope loop` autonomous execution | pre_hole → per_ticket → post_hole (minimal gates) |
| `sprint-lightweight` | Quick fixes, docs-only sprints | per_ticket → validate |

## Creating custom workflows

Place YAML files in `.slope/workflows/<name>.yaml`. Project workflows override built-in defaults with the same filename.

```yaml
name: my-workflow
version: "1"
description: What this workflow does
variables:
  sprint_id:
    required: true
    type: string
phases:
  - id: phase_name
    steps:
      - id: step_name
        type: command|validation|agent_input|agent_work
        command: "for type=command"
        prompt: "for agent types"
```

## Step types

- **command** — Run a shell command. Use `checkpoint: exit_code_0` to require success.
- **validation** — Check conditions. Use `conditions` array.
- **agent_input** — Collect structured input. Use `required_fields`.
- **agent_work** — Agent executes freely. Use `rules` for guidance.

## Variables

- Define in `variables:` section with `required`, `type`, `pattern`, `default`
- Reference with `${var_name}` — top-level string keys only
- Escape literal: `\${not_a_var}`
- Missing required variable = error at resolve time

## repeat_for phases

For per-ticket iteration, use `repeat_for: tickets` on a phase. The engine iterates all steps for each item before moving to the next item.
