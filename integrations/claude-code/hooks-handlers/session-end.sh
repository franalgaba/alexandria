#!/usr/bin/env bash
# End Alexandria session
# Note: Memories are extracted in real-time as events are ingested

# Check if alex is available
if ! command -v alex &> /dev/null; then
    exit 0
fi

# End the session
alex session end 2>/dev/null

# Check how many pending review memories we have
PENDING=$(alex list --json 2>/dev/null | jq '[.[] | select(.reviewStatus == "pending")] | length' 2>/dev/null)

if [ -n "$PENDING" ] && [ "$PENDING" -gt 0 ] 2>/dev/null; then
    cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionEnd",
    "systemMessage": "📚 Alexandria: $PENDING memory candidate(s) pending review. Run 'alex review' to approve or reject them."
  }
}
EOF
fi

exit 0
