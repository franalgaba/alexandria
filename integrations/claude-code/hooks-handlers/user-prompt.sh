#!/usr/bin/env bash
# Alexandria v2: User Prompt Hook with Context Management
#
# Purpose:
# 1. Buffer user prompts for checkpoint curation
# 2. Check context window usage (threshold: 50%)
# 3. Check for progressive disclosure triggers
# 4. Re-inject memories if escalation detected

# Graceful degradation
if ! command -v alex &> /dev/null; then
    exit 0
fi

# Read hook input
INPUT=$(cat)
USER_PROMPT=$(echo "$INPUT" | jq -r '.user_prompt // empty' 2>/dev/null)
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)

# Skip short prompts
if [ -z "$USER_PROMPT" ] || [ ${#USER_PROMPT} -lt 10 ]; then
    exit 0
fi

# Fire-and-forget: buffer for checkpoint curation
(echo "$USER_PROMPT" | alex ingest --type user_prompt --skip-embedding 2>/dev/null) &

# Check context window usage (if transcript available)
if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
    CONTEXT_CHECK=$(alex context --transcript "$TRANSCRIPT" --json 2>/dev/null)
    EXCEEDS=$(echo "$CONTEXT_CHECK" | jq -r '.exceeds50Percent' 2>/dev/null)
    PERCENTAGE=$(echo "$CONTEXT_CHECK" | jq -r '.percentage' 2>/dev/null)

    if [ "$EXCEEDS" = "true" ]; then
        # Extract learnings before suggesting clear
        alex checkpoint --reason "Auto: context at ${PERCENTAGE}%" 2>/dev/null

        # Output message to user
        cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "⚠️ Context window at ${PERCENTAGE}%. Memories extracted via checkpoint. Consider using /clear to continue with fresh context and preserved learnings."
  }
}
EOF
        exit 0
    fi
fi

# Check for progressive disclosure triggers
DISCLOSURE=$(alex disclose --check --query "$USER_PROMPT" 2>/dev/null)
NEEDED=$(echo "$DISCLOSURE" | jq -r '.needed' 2>/dev/null)

if [ "$NEEDED" = "true" ]; then
    TRIGGER=$(echo "$DISCLOSURE" | jq -r '.trigger' 2>/dev/null)

    # Get incremental context
    CONTEXT=$(alex disclose --query "$USER_PROMPT" -f text 2>/dev/null)

    if [ -n "$CONTEXT" ] && [ ${#CONTEXT} -gt 50 ]; then
        ESCAPED=$(echo "$CONTEXT" | jq -Rs '.')
        cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": ${ESCAPED}
  }
}
EOF
    fi
fi

exit 0
