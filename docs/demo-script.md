# Demo: SLOPE Onboarding in 5 Minutes

Estimated runtime: 3-5 minutes.

## Pre-recording Setup

- Have a real project ready (justbriefme works — it has TODOs, a real stack, no SLOPE installed)
- Clean terminal, dark theme, large font (14-16pt)
- Claude Code open in the project directory
- Delete `.slope/` from justbriefme if it exists: `rm -rf .slope`

## Script

### [0:00] Hook — 15 seconds

> "I'm going to set up sprint tracking on a real project in under 5 minutes — entirely through conversation with an AI agent."

Show the project briefly: `ls`, maybe `cat package.json | head -20` to establish it's a real Next.js app.

### [0:15] Start the conversation — 30 seconds

> "Hey Claude, I want to set up SLOPE on this project."

The agent should:

1. Call `search({ module: 'init' })` to discover the onboarding API
2. Call `detectPackageManager()` → `"pnpm"`
3. Say something like "I detected pnpm. Let me install SLOPE as a dev dependency."
4. Run `pnpm add -D @slope-dev/slope`

**Talking point:** "The agent figured out my package manager automatically — no config needed."

### [0:45] Init interview — 60 seconds

The agent calls `getInitQuestions()` and walks you through conversationally:

- **Project name:** "justbriefme"
- **Metaphor:** "agile" (or "golf" for the classic SLOPE feel)
- **Platforms:** "claude-code"
- **Sprint number:** "1"

The agent calls `submitInitAnswers()` and you see the config, scorecard template, and platform rules get created.

**Talking point:** "Instead of running a CLI wizard, the agent asks me the questions naturally and sets everything up."

### [1:45] Vision — 60 seconds

The agent asks about your project vision conversationally:

- "What's the purpose of this project?"
  > "It's an AI-powered briefing tool that summarizes news and research for busy professionals"
- "Who's the target audience?"
  > "Busy executives and researchers"
- "What are your top priorities?"
  > "Speed, reliability, and good UX"

Agent calls `createVision()`. Show the output — purpose, priorities, timestamps.

**Talking point:** "The vision isn't just a text blob — it's structured data the system uses to generate your roadmap."

### [2:45] Roadmap generation — 60 seconds

The agent analyzes your backlog:

- Scans for TODOs → finds 19 across the codebase
- Calls `generateRoadmapFromVision()`

Show the output:

- Sprint 1 — Speed (2 tickets: cron jobs)
- Sprint 2 — Reliability (2 tickets: status tracking, dedup)
- Sprint 3 — UX (5 tickets: email, subscriber flow)
- Sprint 4 — General (10 tickets: everything else)

**Talking point:** "It matched my TODOs to my vision priorities using keyword analysis. The cron jobs landed in Speed, the email delivery flow in UX. Items it couldn't match go to a General backlog sprint."

### [3:45] Show the artifacts — 30 seconds

Quick tour of what was created:

```sh
cat .slope/config.json        # project config
cat .slope/vision.json         # structured vision
slope vision                   # pretty-printed vision
slope roadmap show             # (if roadmap was saved to file)
```

### [4:15] Wrap — 30 seconds

> "In under 5 minutes, I went from zero to a fully structured project with a vision document, a prioritized roadmap generated from actual code TODOs, and sprint tracking ready to go. All through conversation."

Optional closer: show `slope briefing` or `slope card` to hint at what comes next.

## Tips for the Recording

- **Don't script the agent responses** — let them happen naturally. The slight variation makes it feel real.
- **Pause briefly** after each agent action so viewers can read the output.
- **If the agent does something unexpected**, roll with it — that's more authentic than a perfect take.
- **Cut points:** If you need to edit, the natural breaks are between each phase (install → init → vision → roadmap → artifacts).
- **Thumbnail/title idea:** "AI Agent Sets Up My Entire Project in 5 Minutes"
