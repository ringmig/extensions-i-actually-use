#!/bin/bash
# Double-click when a download fails with "yt-dlp is probably outdated".
brew update && brew upgrade yt-dlp
yt-dlp --version
