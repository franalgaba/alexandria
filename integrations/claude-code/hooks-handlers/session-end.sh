#!/usr/bin/env bash
# Alexandria v2: Session End Hook
#
# Purpose: Final checkpoint and session cleanup
# Memory extraction prompts happen in Stop hook during the session

# Graceful degradation
if ! command -v alex &> /dev/null; then
    exit 0
fi

# Final checkpoint before ending
alex checkpoint --reason "Session end" 2>/dev/null

# End session tracking
alex session end 2>/dev/null

# Show summary to stderr
STATS=$(alex stats --json 2>/dev/null)
if [ -n "$STATS" ]; then
    OBJECTS=$(echo "$STATS" | jq -r '.totalObjects // 0' 2>/dev/null)
    echo "📚 Alexandria: Session ended. $OBJECTS total memories." >&2
fi

exit 0
