#!/bin/bash
# Installs or updates gallery-dl in its own venv under bin/. Exit 0 = something
# newer was installed, 1 = already current or the fetch failed.
#
# gallery-dl is used for Instagram stories, where yt-dlp's API call is rejected.
# uv is fetched into bin/ and brings its own Python, so this does not depend on
# Apple's Python 3.9 with its old pip and LibreSSL.
BIN_DIR="${1:-$HOME/.local/share/media-downloader/bin}"
UV="$BIN_DIR/uv"
VENV="$BIN_DIR/gallery-dl-venv"

mkdir -p "$BIN_DIR"
if [ ! -x "$UV" ]; then
  [ "$(uname -m)" = "arm64" ] && ARCH=aarch64 || ARCH=x86_64
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  curl -fsL "https://github.com/astral-sh/uv/releases/latest/download/uv-$ARCH-apple-darwin.tar.gz" \
    | tar -xz -C "$TMP" || exit 1
  mv "$TMP/uv-$ARCH-apple-darwin/uv" "$UV" || exit 1
  xattr -d com.apple.quarantine "$UV" 2>/dev/null
fi

if [ ! -x "$VENV/bin/python" ]; then
  "$UV" venv -q --python 3.12 "$VENV" || exit 1
fi

before="$("$UV" pip freeze -q --python "$VENV" 2>/dev/null)"
"$UV" pip install -q --python "$VENV" -U gallery-dl || exit 1
# Anything a process started by Chrome writes is quarantined (see fetch-yt-dlp.sh).
xattr -dr com.apple.quarantine "$VENV" 2>/dev/null
ln -sf "gallery-dl-venv/bin/gallery-dl" "$BIN_DIR/gallery-dl"
[ "$before" != "$("$UV" pip freeze -q --python "$VENV")" ]
