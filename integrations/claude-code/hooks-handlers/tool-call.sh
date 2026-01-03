#!/usr/bin/env bash
# Alexandria v2: Tool Call Hook (PreToolUse)
#
# Purpose: Buffer tool invocations for checkpoint curation
# Matches pi-coding-agent behavior: fire-and-forget, non-blocking

# Graceful degradation
if ! command -v alex &> /dev/null; then
    exit 0
fi

# Read hook input
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
TOOL_INPUT=$(echo "$INPUT" | jq -c '.tool_input // empty' 2>/dev/null)

if [ -n "$TOOL_NAME" ] && [ -n "$TOOL_INPUT" ] && [ "$TOOL_INPUT" != "null" ]; then
    # Fire-and-forget: buffer for checkpoint curation
    (echo "$TOOL_INPUT" | alex ingest --type tool_call --tool "$TOOL_NAME" --skip-embedding 2>/dev/null) &
fi

exit 0
