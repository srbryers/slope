#!/bin/bash
# slope-loop/slope-loop-guide/scripts/synthesize.sh
# Compacts the SKILL.md body by synthesizing accumulated learnings.
# Reads the full sprint history from references/ and produces concise rules.
# Run when the runner warns about SKILL.md exceeding 5000 words.

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SKILL_FILE="$SKILL_DIR/SKILL.md"
HISTORY="$SKILL_DIR/references/sprint-history.md"

if [ ! -f "$SKILL_FILE" ]; then
  echo "No SKILL.md found at $SKILL_FILE"
  exit 1
fi

SKILL_WORDS=$(wc -w < "$SKILL_FILE")
echo "Current SKILL.md: ${SKILL_WORDS} words"

if [ "$SKILL_WORDS" -lt 5000 ]; then
  echo "SKILL.md is under 5000 words. No synthesis needed."
  exit 0
fi

if [ ! -f "$HISTORY" ]; then
  echo "No sprint history found. Nothing to synthesize."
  exit 0
fi

# Archive the current SKILL.md
cp "$SKILL_FILE" "$SKILL_DIR/references/SKILL.md.$(date +%Y%m%d).bak"

# Extract the full sprint history
LEARNINGS=$(cat "$HISTORY")

# Use local model to synthesize learnings into compact rules
SYNTHESIS=$(echo "You are analyzing sprint failure logs from an automated development loop.
The SKILL.md file has grown too large. Synthesize ALL learnings into:
1. '## Known Hazards' — concise bullet points: [module]: [issue] — [fix]
2. '## Anti-Patterns' — concise bullet points of things to avoid

Rules:
- Max 30 bullet points total across both sections
- Group by module/area. Remove duplicates.
- Each bullet must be actionable (not just 'ticket X failed')
- Keep the most recent/relevant patterns, archive older ones

FULL SPRINT HISTORY:
$LEARNINGS" | ollama run qwen2.5-coder:14b)

# Replace the Known Hazards and Anti-Patterns sections in SKILL.md
# Keep everything above "## Known Hazards" and below "## Error Handling"
HEADER=$(sed '/^## Known Hazards/,$d' "$SKILL_FILE")
FOOTER=$(sed -n '/^## Error Handling/,$p' "$SKILL_FILE")

# Reassemble SKILL.md with synthesized sections
cat > "$SKILL_FILE" << EOF
${HEADER}
${SYNTHESIS}

${FOOTER}
EOF

NEW_WORDS=$(wc -w < "$SKILL_FILE")
echo "Synthesized SKILL.md: ${NEW_WORDS} words (was ${SKILL_WORDS})"
echo "Backup saved to references/SKILL.md.$(date +%Y%m%d).bak"

# Verify YAML frontmatter is intact
if ! head -1 "$SKILL_FILE" | grep -q "^---"; then
  echo "WARNING: YAML frontmatter may be damaged. Check the backup."
  exit 1
fi

echo "Synthesis complete."
