#!/usr/bin/env bash
# Capture tool calls (invocations) for Alexandria

# Check if alex is available
if ! command -v alex &> /dev/null; then
    exit 0
fi

# Read the hook input from stdin
INPUT=$(cat)

# Extract tool info
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
TOOL_INPUT=$(echo "$INPUT" | jq -r '.tool_input // empty' 2>/dev/null)

if [ -n "$TOOL_NAME" ] && [ -n "$TOOL_INPUT" ]; then
    CONTENT="Tool: $TOOL_NAME
Input: $TOOL_INPUT"
    echo "$CONTENT" | alex ingest --type tool_call --tool "$TOOL_NAME" --skip-embedding 2>/dev/null
fi

exit 0
