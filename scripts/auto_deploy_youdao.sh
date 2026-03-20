#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <bundle-dir> [resource-dir ...]" >&2
  exit 1
fi

BUNDLE_DIR="$(cd "$1" && pwd)"
WHITEBOARD_JSON="$BUNDLE_DIR/whiteboard-input.json"
DEPLOY_SCRIPT="$HOME/Documents/openclaw-monitor/deploy-static.sh"

if [ ! -f "$WHITEBOARD_JSON" ]; then
  echo "Missing whiteboard-input.json: $WHITEBOARD_JSON" >&2
  exit 1
fi

if [ ! -f "$DEPLOY_SCRIPT" ]; then
  mkdir -p "$(dirname "$DEPLOY_SCRIPT")"
  curl -fsSL "https://raw.githubusercontent.com/MindedCoder/claw-monitor/main/src/deploy-static.sh" -o "$DEPLOY_SCRIPT"
  chmod +x "$DEPLOY_SCRIPT"
fi

STATIC_WEB_PATH="$(jq -r '.staticWebPath' "$WHITEBOARD_JSON")"
PLATFORM="$(jq -r '.platform' "$WHITEBOARD_JSON")"
RESOURCE_PATH="$(jq -r '.resourcePath' "$WHITEBOARD_JSON")"

if [ "$STATIC_WEB_PATH" = "null" ] || [ -z "$STATIC_WEB_PATH" ]; then
  echo "Missing staticWebPath in $WHITEBOARD_JSON" >&2
  exit 1
fi

if [ "$PLATFORM" = "null" ] || [ -z "$PLATFORM" ]; then
  PLATFORM="unknown"
fi

RESOURCE_ARGS=()
if [ $# -gt 1 ]; then
  shift
  RESOURCE_ARGS=("$@")
elif [ "$RESOURCE_PATH" != "null" ] && [ -n "$RESOURCE_PATH" ]; then
  RESOURCE_ARGS=("$(basename "$RESOURCE_PATH")")
fi

if [ ${#RESOURCE_ARGS[@]} -gt 0 ]; then
  URL_PATH="$("$DEPLOY_SCRIPT" "$STATIC_WEB_PATH" "$PLATFORM" "${RESOURCE_ARGS[@]}")"
else
  URL_PATH="$("$DEPLOY_SCRIPT" "$STATIC_WEB_PATH" "$PLATFORM")"
fi

echo "本地访问: http://127.0.0.1:9001/$URL_PATH"
echo "公网访问: https://claw.bfelab.com/bfe/$(echo "$URL_PATH" | sed 's|^bfe/||')"
