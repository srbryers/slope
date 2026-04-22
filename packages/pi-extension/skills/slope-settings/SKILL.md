---
name: slope-settings
description: Configure which SLOPE features are active in Pi. Use /slope-settings to view all features and /slope-settings-toggle <feature> to enable or disable them.
---

# SLOPE Pi Settings

Manage which SLOPE features are active in your Pi environment.

## Available Features

| Feature | Default | What it does |
|---------|---------|-------------|
| guards | on | Commit discipline nudges, hazard warnings on file edits, workflow step gates |
| interview | on | Project interview for fresh SLOPE projects (asks name, metaphor, platforms, etc.) |
| briefing | on | Pre-session briefing injection with handicap, hazards, gotchas, roadmap context |
| planning | on | Sprint planning workflow, plan review gating, club recommendations |
| scorecard | on | Scorecard creation helpers and post-sprint validation |
| review | on | Code review and architect review generation from PR diffs |
| dashboard | off | Live performance dashboard (requires manual `slope dashboard` start) |

## Commands

```bash
/slope-settings                    # Show current settings
/slope-settings-toggle guards      # Toggle guards on/off
/slope-settings-toggle interview   # Toggle interview on/off
```

## When to Toggle

- **Disable guards** when doing exploratory work outside of a sprint
- **Disable briefing** if you prefer to run `slope briefing` manually
- **Disable interview** if you never use the Pi interview flow (use CLI `slope interview --agent` instead)
- **Enable dashboard** if you want Pi to remind you to start the dashboard

Restart the Pi session after toggling for changes to take full effect.
