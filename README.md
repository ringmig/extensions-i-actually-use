# Extensions I Actually Use

A collection of small, independent Chrome extensions (Manifest V3). Each folder is one extension
and can be installed on its own.

## Installing

No build step is needed.

1. Download or clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the folder of the extension you want.

To update an extension, pull the latest changes and click the reload icon on its card in `chrome://extensions`.

## Extensions

### <img src="auto-hide-cursor/icons/icon128.png" width="28" height="28" align="top" alt=""> Auto Hide Cursor
Hides the mouse cursor after 3 seconds of inactivity.

### <img src="bookmarks-manager/chrome.svg" width="28" height="28" align="top" alt=""> Bookmarks Manager
Replaces the new tab page with a minimal dark bookmarks manager that shows site previews.

### <img src="copy-image-url/icon128.png" width="28" height="28" align="top" alt=""> Copy Image URL
Right-click any image to copy the image or its URL, even on sites that block right-clicking.

### <img src="four-panes/icons/icon128.png" width="28" height="28" align="top" alt=""> Four Panes
Opens four browser panes in a 2×2 grid in one fullscreen window.

### <img src="gif-recorder/icons/icon128.png" width="28" height="28" align="top" alt=""> GIF Recorder
Right-click to select any area of a page and record it as an animated GIF.

### <img src="history-blacklist/icons/icon128.png" width="28" height="28" align="top" alt=""> History Blacklist
Keeps the keywords and URLs you list out of your history and your address-bar suggestions.

### <img src="media-downloader/icons/icon128.png" width="28" height="28" align="top" alt=""> Media Downloader
Right-click to download media from Instagram, TikTok, YouTube, X, Facebook and more. Right-click
selected text to save it as a `.txt` file.

YouTube, Vimeo and some other sites are downloaded through [yt-dlp](https://github.com/yt-dlp/yt-dlp),
which runs on your own computer. **macOS only:** after loading the extension, double-click
`media-downloader/setup.command` once. It downloads yt-dlp and ffmpeg and connects them to Chrome.

Instagram, TikTok and similar sites go through the third-party
[btch-downloader](https://github.com/hostinger-bot/btch-downloader) service, so the URLs of those
posts are sent to that service.

### <img src="remove-element/icons/icon128.png" width="28" height="28" align="top" alt=""> Remove Element
Point and click to remove things from a page. What you remove is remembered per site.

### <img src="shift-zoom/icons/icon128.png" width="28" height="28" align="top" alt=""> Shift Zoom
Hold Shift and scroll to zoom in on the cursor position. Cmd+click always opens links in a new tab.

### <img src="transcribe/icons/icon128.png" width="28" height="28" align="top" alt=""> Transcribe
Downloads the transcript of a YouTube video, a Short or a TikTok video in one click.

## License

[MIT](LICENSE). You may use, copy, change and share the code, including commercially, as long as
the license notice comes with it. The code comes with no warranty.

Bundled third-party code keeps its own license, which is MIT for both:
- `media-downloader/btch-downloader.min.js`: [btch-downloader](https://github.com/hostinger-bot/btch-downloader)
- `gif-recorder/lib/gifenc.js`: [gifenc](https://github.com/mattdesl/gifenc) by Matt DesLauriers

Media Downloader and Transcribe fetch content from third-party platforms. Their terms of service
may forbid downloading, and staying within them is your responsibility.
