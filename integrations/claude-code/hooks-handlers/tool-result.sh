#!/usr/bin/env bash
# Capture tool results for Alexandria

# Check if alex is available
if ! command -v alex &> /dev/null; then
    exit 0
fi

# Read the hook input from stdin
INPUT=$(cat)

# Extract tool info
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
TOOL_RESULT=$(echo "$INPUT" | jq -r '.tool_result // empty' 2>/dev/null)

if [ -n "$TOOL_NAME" ] && [ -n "$TOOL_RESULT" ] && [ ${#TOOL_RESULT} -gt 10 ]; then
    echo "$TOOL_RESULT" | alex ingest --type tool_output --tool "$TOOL_NAME" --skip-embedding 2>/dev/null
fi

exit 0
