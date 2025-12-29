#!/usr/bin/env bash
# Capture user prompts for Alexandria

# Check if alex is available
if ! command -v alex &> /dev/null; then
    exit 0
fi

# Read the hook input from stdin
INPUT=$(cat)

# Extract user prompt from the input
USER_PROMPT=$(echo "$INPUT" | jq -r '.user_prompt // empty' 2>/dev/null)

if [ -n "$USER_PROMPT" ] && [ ${#USER_PROMPT} -gt 10 ]; then
    echo "$USER_PROMPT" | alex ingest --type user_prompt --skip-embedding 2>/dev/null
fi

exit 0
