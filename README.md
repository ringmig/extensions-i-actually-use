# Extensions I Actually Use

A collection of small, independent Chrome extensions (Manifest V3). Each folder is one extension
and can be installed on its own.

## Installing

No build step is needed. To install one extension:

1. Click **Download** under the extension below, and unzip the file. You get one folder.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick that folder. Chrome loads the extension from that folder every
   time it starts, so put it somewhere permanent first, not in Downloads. Deleting the folder
   removes the extension; moving it means loading it again, and its settings start over.

To install them all, clone the repo (or **Code → Download ZIP**) and load each folder the same way.

To update, download the zip again and unzip it over the old folder, or `git pull` in a clone. Then
click the reload icon on the extension's card in `chrome://extensions`.

## Other browsers

Built for and tested in Google Chrome on macOS. Other Chromium browsers (Edge, Brave, Arc,
Vivaldi, Opera) install extensions the same way and use the same extension APIs, so most of these
should work there too, but they have not been tested. Two known exceptions:

- **Media Downloader:** `setup.command` connects yt-dlp to Google Chrome only, so YouTube, Vimeo
  and the other yt-dlp sites do not download in another browser. Instagram, TikTok and the rest
  still do.
- **Bookmarks Manager:** some browsers keep their own start page and do not let an extension
  replace the new tab page.

## Extensions

### <img src="auto-hide-cursor/icons/icon128.png" width="28" height="28" align="top" alt=""> Auto Hide Cursor
**[Download](https://github.com/ringmig/extensions-i-actually-use/releases/latest/download/auto-hide-cursor.zip)**

Hides the mouse cursor after 3 seconds of inactivity.

### <img src="bookmarks-manager/icons/icon128.png" width="28" height="28" align="top" alt=""> Bookmarks Manager
**[Download](https://github.com/ringmig/extensions-i-actually-use/releases/latest/download/bookmarks-manager.zip)**

Replaces the new tab page with a minimal dark bookmarks manager that shows site previews.

### <img src="four-panes/icons/icon128.png" width="28" height="28" align="top" alt=""> Four Panes
**[Download](https://github.com/ringmig/extensions-i-actually-use/releases/latest/download/four-panes.zip)**

Opens four browser panes in a 2×2 grid in one fullscreen window.

### <img src="gif-recorder/icons/icon128.png" width="28" height="28" align="top" alt=""> GIF Recorder
**[Download](https://github.com/ringmig/extensions-i-actually-use/releases/latest/download/gif-recorder.zip)**

Right-click to select any area of a page and record it as an animated GIF.

### <img src="media-downloader/icons/icon128.png" width="28" height="28" align="top" alt=""> Media Downloader
**[Download](https://github.com/ringmig/extensions-i-actually-use/releases/latest/download/media-downloader.zip)**

Right-click to download media from Instagram, TikTok, YouTube, X, Facebook and more. Right-click
selected text to save it as a `.txt` file.

YouTube, Vimeo and some other sites are downloaded through [yt-dlp](https://github.com/yt-dlp/yt-dlp),
which runs on your own computer. **macOS only:** after loading the extension, double-click
`media-downloader/setup.command` once. It downloads yt-dlp and ffmpeg and connects them to Chrome.
If macOS says it cannot be opened, right-click it and choose **Open**.

Instagram, TikTok and similar sites go through the third-party
[btch-downloader](https://github.com/hostinger-bot/btch-downloader) service, so the URLs of those
posts are sent to that service.

### <img src="remove-element/icons/icon128.png" width="28" height="28" align="top" alt=""> Remove Element
**[Download](https://github.com/ringmig/extensions-i-actually-use/releases/latest/download/remove-element.zip)**

Point and click to remove things from a page. What you remove is remembered per site.

### <img src="copy-image-url/icon128.png" width="28" height="28" align="top" alt=""> Right-Click Rescue
**[Download](https://github.com/ringmig/extensions-i-actually-use/releases/latest/download/copy-image-url.zip)**

Gives you back right-click and text selection on sites that block them. Adds Copy Image, Copy Image
URL and Open Image in New Tab to the menu, which find the image even under a transparent overlay.

### <img src="shift-zoom/icons/icon128.png" width="28" height="28" align="top" alt=""> Shift Zoom
**[Download](https://github.com/ringmig/extensions-i-actually-use/releases/latest/download/shift-zoom.zip)**

Hold Shift and scroll to zoom in on the cursor position. Cmd+click always opens links in a new tab.

### <img src="transcribe/icons/icon128.png" width="28" height="28" align="top" alt=""> Transcribe
**[Download](https://github.com/ringmig/extensions-i-actually-use/releases/latest/download/transcribe.zip)**

Downloads the transcript of a YouTube video, a Short or a TikTok video in one click.

### <img src="history-blacklist/icons/icon128.png" width="28" height="28" align="top" alt=""> Unhistory
**[Download](https://github.com/ringmig/extensions-i-actually-use/releases/latest/download/history-blacklist.zip)**

Keeps the keywords and URLs you list out of your browser history and your address-bar suggestions.

## License

[MIT](LICENSE). You may use, copy, change and share the code, including commercially, as long as
the license notice comes with it. The code comes with no warranty.

Bundled third-party code keeps its own license, which is MIT for both:
- `media-downloader/btch-downloader.min.js`: [btch-downloader](https://github.com/hostinger-bot/btch-downloader)
- `gif-recorder/lib/gifenc.js`: [gifenc](https://github.com/mattdesl/gifenc) by Matt DesLauriers

Media Downloader and Transcribe fetch content from third-party platforms. Their terms of service
may forbid downloading, and staying within them is your responsibility.
