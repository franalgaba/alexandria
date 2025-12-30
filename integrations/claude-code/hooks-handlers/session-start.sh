#!/usr/bin/env bash

# Alexandria Memory Context Injection Hook
# Injects relevant memories at session start and checks for stale memories

# Check if alex is available
if ! command -v alex &> /dev/null; then
    exit 0
fi

# Start a new session
alex session start --json 2>/dev/null

# Get context pack with memories (budget 1500 tokens, text format)
CONTEXT_PACK=$(alex pack --level task -b 1500 -f text 2>/dev/null)

# Get stale memories
STALE_JSON=$(alex check --json 2>/dev/null)
STALE_COUNT=$(echo "$STALE_JSON" | jq -r '.stale | length' 2>/dev/null || echo "0")

# Build context string
CONTEXT=""

# Add memory context if we have any
if [ -n "$CONTEXT_PACK" ] && [ "$CONTEXT_PACK" != "null" ]; then
    CONTEXT="# Alexandria Memory Context

The following memories from past sessions are relevant to this project:

${CONTEXT_PACK}

Use these memories to inform your responses. They contain past decisions, constraints, known fixes, and conventions for this codebase."
fi

# Add stale memory warnings if any
if [ "$STALE_COUNT" != "0" ] && [ -n "$STALE_COUNT" ]; then
    STALE_LIST=$(echo "$STALE_JSON" | jq -r '.stale[] | "- [\(.type)] \"\(.content | .[0:50])...\" (Reason: \(.reasons | join(", ")))"' 2>/dev/null)

    if [ -n "$CONTEXT" ]; then
        CONTEXT="${CONTEXT}

---

"
    fi
    CONTEXT="${CONTEXT}**Note:** ${STALE_COUNT} memory(ies) may be stale and need verification:

${STALE_LIST}

You can verify or retire these with \`alex verify <id>\` or \`alex retire <id>\`."
fi

# Only output if we have context
if [ -n "$CONTEXT" ]; then
    # Escape for JSON (replace newlines, quotes, backslashes)
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
