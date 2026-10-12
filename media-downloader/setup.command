#!/bin/bash
# Double-click once per Mac. Fetches yt-dlp and ffmpeg and registers the native
# host with Chrome, so nothing has to be installed beforehand. Safe to re-run:
# it also refreshes the host after the extension folder has been updated.
set -e
cd "$(dirname "$0")"

# The "key" in manifest.json pins this ID on every machine.
EXT_ID="jmhedjechefldglimlldkckbgakhlnif"
# Must match HOST_DIR in install-host.sh.
BIN_DIR="$HOME/.local/share/media-downloader/bin"
mkdir -p "$BIN_DIR"

echo "Checking yt-dlp..."
./fetch-yt-dlp.sh "$BIN_DIR" || true
"$BIN_DIR/yt-dlp" --version

if [ ! -x "$BIN_DIR/ffmpeg" ]; then
  echo "Fetching ffmpeg..."
  [ "$(uname -m)" = "arm64" ] && ARCH=arm64 || ARCH=amd64
  TMP="$(mktemp -d)"
  curl -fL --progress-bar -o "$TMP/ffmpeg.zip" \
    "https://ffmpeg.martin-riedl.de/redirect/latest/macos/$ARCH/release/ffmpeg.zip"
  unzip -oq "$TMP/ffmpeg.zip" ffmpeg -d "$BIN_DIR"
  rm -rf "$TMP"
  chmod +x "$BIN_DIR/ffmpeg"
fi

# The host itself is a Python script. On a Mac without Python this opens
# Apple's own installer for the command line tools.
/usr/bin/python3 --version

./install-host.sh "$EXT_ID"
