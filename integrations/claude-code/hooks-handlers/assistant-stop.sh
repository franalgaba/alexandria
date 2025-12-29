#!/usr/bin/env bash
# Capture assistant's final response when it stops

# Check if alex is available
if ! command -v alex &> /dev/null; then
    exit 0
fi

# Read the hook input from stdin
INPUT=$(cat)

# Extract the stop reason/response
REASON=$(echo "$INPUT" | jq -r '.reason // empty' 2>/dev/null)

# The transcript path contains the full conversation
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)

# If we have a transcript, we could extract the last assistant message
# For now, just note the stop event
if [ -n "$REASON" ]; then
    echo "Agent stopped: $REASON" | alex ingest --type assistant_response --skip-embedding 2>/dev/null
fi

exit 0
