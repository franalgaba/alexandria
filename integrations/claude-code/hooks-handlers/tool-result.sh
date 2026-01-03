#!/usr/bin/env bash
# Alexandria v2: Tool Result Hook (PostToolUse)
#
# Purpose: Buffer tool outputs for checkpoint curation
# Matches pi-coding-agent behavior: fire-and-forget, non-blocking

# Graceful degradation
if ! command -v alex &> /dev/null; then
    exit 0
fi

# Read hook input
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
TOOL_RESULT=$(echo "$INPUT" | jq -r '.tool_result // empty' 2>/dev/null)

if [ -z "$TOOL_NAME" ] || [ -z "$TOOL_RESULT" ] || [ ${#TOOL_RESULT} -lt 10 ]; then
    exit 0
fi

# Try to extract exit code from tool result (for bash tool)
# Claude Code embeds this in the result for bash commands
EXIT_CODE=""
if [ "$TOOL_NAME" = "bash" ] || [ "$TOOL_NAME" = "Bash" ]; then
    # Look for exit code patterns in the result
    # Pattern 1: "exit code: N" or "Exit code: N"
    EXIT_CODE=$(echo "$TOOL_RESULT" | grep -oiE 'exit code:?\s*[0-9]+' | grep -oE '[0-9]+' | head -1)
    
    # Pattern 2: Check for common error indicators if no explicit exit code
    if [ -z "$EXIT_CODE" ]; then
        if echo "$TOOL_RESULT" | grep -qiE 'error|failed|command not found|permission denied|no such file'; then
            EXIT_CODE="1"
        fi
    fi
fi

# Build ingest command
INGEST_ARGS="--type tool_output --tool $TOOL_NAME --skip-embedding"
if [ -n "$EXIT_CODE" ]; then
    INGEST_ARGS="$INGEST_ARGS --exit-code $EXIT_CODE"
fi

# Fire-and-forget: buffer for checkpoint curation
(echo "$TOOL_RESULT" | alex ingest $INGEST_ARGS 2>/dev/null) &

exit 0
