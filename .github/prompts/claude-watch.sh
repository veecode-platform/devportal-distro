#!/bin/bash
# claude-watch.sh — Run a Claude Code prompt headlessly with real-time readable output
# Usage: ./claude-watch.sh <prompt-file> [allowed-tools]

set -euo pipefail

PROMPT_FILE="${1:?Usage: $0 <prompt-file> [allowed-tools]}"
TOOLS="${2:-Bash,Read,Edit,Write,Glob,Grep}"

PROMPT=$(<"$PROMPT_FILE")
unset CLAUDECODE

env -u CLAUDECODE claude -p "$PROMPT" \
  --output-format stream-json \
  --verbose \
  --include-partial-messages \
  --allowedTools "$TOOLS" | \
  jq --unbuffered -rj '
    if .type == "stream_event" then
      if .event.delta.type? == "text_delta" then
        .event.delta.text
      elif .event.delta.type? == "input_json_delta" then
        empty
      else empty end
    elif .type == "assistant" then
      (.message.content // [])[] |
      if .type == "tool_use" then
        "\n\u001b[33m[" + .name + "]\u001b[0m " + (.input | tostring | .[0:300]) + "\n"
      elif .type == "tool_result" then
        "\u001b[90m  → " + (.content | tostring | .[0:200]) + "\u001b[0m\n"
      else empty end
    elif .type == "result" then
      "\n\u001b[32m[DONE] cost=$" + (.total_cost_usd | tostring) +
      " turns=" + (.num_turns | tostring) + "\u001b[0m\n" +
      (.result // "") + "\n"
    else empty end'
