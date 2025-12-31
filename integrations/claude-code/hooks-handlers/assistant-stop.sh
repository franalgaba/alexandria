#!/usr/bin/env bash
# Alexandria v2: Assistant Stop Hook
#
# Purpose: Buffer assistant responses for checkpoint curation
# Memory extraction happens automatically via Haiku (if Claude OAuth available)
# or Tier 0 deterministic patterns.

# Graceful degradation
if ! command -v alex &> /dev/null; then
    exit 0
fi

# Read hook input
INPUT=$(cat)
REASON=$(echo "$INPUT" | jq -r '.reason // empty' 2>/dev/null)

# Buffer the response (fire-and-forget)
if [ -n "$REASON" ]; then
    (echo "Agent stopped: $REASON" | alex ingest --type assistant_response --skip-embedding 2>/dev/null) &
fi

exit 0
