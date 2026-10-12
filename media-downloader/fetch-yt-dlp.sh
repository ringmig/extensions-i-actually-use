#!/bin/bash
# Installs or updates the standalone yt-dlp in bin/. Exit 0 = a new version
# was installed, 1 = already current or the fetch failed.
#
# It has to be the unpacked build (yt-dlp_macos.zip). The single-file build
# unpacks its Python on every run, and anything a process started by Chrome
# writes is quarantined, so macOS reports "Python.framework is damaged".
# That also rules out yt-dlp's own -U and is why the flag is stripped below.
BIN_DIR="${1:-$HOME/.local/share/media-downloader/bin}"
DIST="$BIN_DIR/yt-dlp-dist"
REPO="https://github.com/yt-dlp/yt-dlp/releases/latest"

LATEST="$(curl -fsIL -o /dev/null -w '%{url_effective}' "$REPO")" || exit 1
LATEST="${LATEST##*/}"
if [ -d "$DIST" ] && [ "$("$BIN_DIR/yt-dlp" --version 2>/dev/null)" = "$LATEST" ]; then
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsL -o "$TMP/yt-dlp.zip" "$REPO/download/yt-dlp_macos.zip" || exit 1
mkdir "$TMP/dist" && unzip -oq "$TMP/yt-dlp.zip" -d "$TMP/dist" || exit 1
xattr -dr com.apple.quarantine "$TMP/dist" 2>/dev/null

mkdir -p "$BIN_DIR"
rm -rf "$DIST" "$BIN_DIR/yt-dlp"
mv "$TMP/dist" "$DIST"
ln -s "yt-dlp-dist/yt-dlp_macos" "$BIN_DIR/yt-dlp"
xattr -d com.apple.quarantine "$BIN_DIR/yt-dlp" 2>/dev/null
exit 0
