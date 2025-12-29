#!/usr/bin/env bash

# Alexandria Memory Revalidation Hook
# Checks for stale memories and adds context for Claude to prompt the user

# Check if alex is available
if ! command -v alex &> /dev/null; then
    exit 0
fi

# Get stale memories
STALE_JSON=$(alex check --json 2>/dev/null)
if [ $? -ne 0 ]; then
    exit 0
fi

# Parse the stale count
STALE_COUNT=$(echo "$STALE_JSON" | jq -r '.stale | length' 2>/dev/null)
if [ "$STALE_COUNT" = "0" ] || [ -z "$STALE_COUNT" ]; then
    exit 0
fi

# Build the list of stale memories for Claude
STALE_LIST=$(echo "$STALE_JSON" | jq -r '.stale[] | "- **[\(.type)]** \"\(.content | .[0:60])...\" (Reason: \(.reasons | join(", ")))"' 2>/dev/null)

# Output the revalidation context as additionalContext
cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "📚 **Alexandria Memory Check**

I found ${STALE_COUNT} memory(ies) that may need revalidation:

${STALE_LIST}

Before we begin, I should ask you about each one:

For each stale memory, please tell me:
- **[v] Verify** - if it's still valid
- **[r] Retire** - if it no longer applies
- **[s] Skip** - to review later

I'll run the appropriate \`alex verify <id>\` or \`alex retire <id>\` commands based on your choices.

Would you like to review these memories now, or skip and continue with your task?"
  }
}
EOF

exit 0
