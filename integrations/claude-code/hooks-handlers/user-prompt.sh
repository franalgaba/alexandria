#!/usr/bin/env bash
# Capture user prompts and inject task-relevant memories for Alexandria

# Check if alex is available
if ! command -v alex &> /dev/null; then
    exit 0
fi

# Read the hook input from stdin
INPUT=$(cat)

# Extract user prompt from the input
USER_PROMPT=$(echo "$INPUT" | jq -r '.user_prompt // empty' 2>/dev/null)

if [ -z "$USER_PROMPT" ] || [ ${#USER_PROMPT} -lt 10 ]; then
    exit 0
fi

# Ingest the user prompt (fire-and-forget, run in background)
echo "$USER_PROMPT" | alex ingest --type user_prompt --skip-embedding 2>/dev/null &

# Search for relevant memories based on the user's query
SEARCH_RESULTS=$(alex search "$USER_PROMPT" --limit 5 --json 2>/dev/null)
RESULT_COUNT=$(echo "$SEARCH_RESULTS" | jq -r 'length' 2>/dev/null || echo "0")

# If we found relevant memories, inject them as context
if [ "$RESULT_COUNT" != "0" ] && [ "$RESULT_COUNT" != "null" ] && [ -n "$RESULT_COUNT" ]; then
    # Format the results
    MEMORY_LIST=$(echo "$SEARCH_RESULTS" | jq -r '.[] | "- [\(.object.objectType)] \(.object.content)"' 2>/dev/null)

    if [ -n "$MEMORY_LIST" ]; then
        CONTEXT="**Relevant memories for this task:**

${MEMORY_LIST}"

        # Escape for JSON
        ESCAPED_CONTEXT=$(echo "$CONTEXT" | jq -Rs '.')

        cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": ${ESCAPED_CONTEXT}
  }
}
EOF
    fi
fi

exit 0
