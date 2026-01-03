#!/usr/bin/env bash
# Alexandria v2: Session Start Hook
#
# Purpose: Start session tracking and inject memory context
# Matches pi-coding-agent behavior exactly
#
# Flow:
#   1. Start Alexandria session tracking
#   2. Generate context pack (task level, progressive disclosure)
#   3. Check for stale memories
#   4. Inject via hookSpecificOutput.additionalContext

# Graceful degradation - if alex not available, exit silently
if ! command -v alex &> /dev/null; then
    exit 0
fi

# Start Alexandria session for tracking
alex session start --json >/dev/null 2>&1

# Generate context pack with progressive disclosure
# Default: task level (~500 tokens)
# --hot prioritizes frequently accessed memories (won't increment access counts)
CONTEXT_PACK=$(alex pack --level task --hot -f text 2>/dev/null)

# Check for stale memories
STALE_JSON=$(alex check --json 2>/dev/null)
STALE_COUNT=$(echo "$STALE_JSON" | jq -r '.stale | length' 2>/dev/null || echo "0")

# Build context to inject
CONTEXT=""

if [ -n "$CONTEXT_PACK" ] && [ "$CONTEXT_PACK" != "null" ] && [ ${#CONTEXT_PACK} -gt 50 ]; then
    CONTEXT="# Alexandria Memory Context

${CONTEXT_PACK}

These memories contain past decisions, constraints, known fixes, and conventions for this codebase."
fi

# Add stale memory notice
if [ "$STALE_COUNT" != "0" ] && [ -n "$STALE_COUNT" ]; then
    if [ -n "$CONTEXT" ]; then
        CONTEXT="${CONTEXT}

---

"
    fi
    CONTEXT="${CONTEXT}⚠️ ${STALE_COUNT} memory(ies) may be stale. Run \`alex check\` to review."
fi

# Inject context via hookSpecificOutput
if [ -n "$CONTEXT" ]; then
    ESCAPED_CONTEXT=$(echo "$CONTEXT" | jq -Rs '.')
    cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": ${ESCAPED_CONTEXT}
  }
}
EOF
fi

exit 0
