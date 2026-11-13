#!/bin/bash
# Registers the yt-dlp native messaging host for Chrome.
# Run this once after loading the extension.
#
# Usage: ./install-host.sh <extension-id>
#   The extension ID is shown in chrome://extensions/ with Developer mode on.

set -e

EXT_ID="$1"
if [ -z "$EXT_ID" ]; then
  echo "Usage: ./install-host.sh <extension-id>"
  echo "  Find your extension ID at chrome://extensions/ (Developer mode)"
  exit 1
fi

HOST_NAME="com.mediadownloader.ytdlp"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Host scripts must live OUTSIDE ~/Documents on macOS Sequoia —
# Chrome cannot execute scripts from TCC-protected directories.
HOST_DIR="$HOME/.local/share/media-downloader"
mkdir -p "$HOST_DIR"
cp "$SCRIPT_DIR/yt-dlp-host.py" "$HOST_DIR/"
cp "$SCRIPT_DIR/yt-dlp-host.sh" "$HOST_DIR/" 2>/dev/null || true
cp "$SCRIPT_DIR/fetch-yt-dlp.sh" "$HOST_DIR/" 2>/dev/null || true
cp "$SCRIPT_DIR/fetch-gallery-dl.sh" "$HOST_DIR/" 2>/dev/null || true
chmod +x "$HOST_DIR/yt-dlp-host.py" "$HOST_DIR/yt-dlp-host.sh" 2>/dev/null
HOST_SCRIPT="$HOST_DIR/yt-dlp-host.sh"

# Determine target directory
if [ "$(uname)" = "Darwin" ]; then
  TARGET_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
else
  TARGET_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
fi

mkdir -p "$TARGET_DIR"

# Write manifest
cat > "$TARGET_DIR/$HOST_NAME.json" << EOF
{
  "name": "$HOST_NAME",
  "description": "yt-dlp native messaging host for Media Downloader",
  "path": "$HOST_SCRIPT",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXT_ID/"
  ]
}
EOF

echo "Installed native messaging host:"
echo "  Manifest: $TARGET_DIR/$HOST_NAME.json"
echo "  Script:   $HOST_SCRIPT"
echo "  Extension: $EXT_ID"
echo ""
echo "Reload the extension in chrome://extensions/ to activate."
