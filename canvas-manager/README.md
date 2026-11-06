# Canvas Manager

Lists the canvases that `HTML Image Viewer` (`~/Documents/HTML/HTML Image Viewer/image-viewer.html`)
has saved in Chrome, shows which ones have lost their HTML file, and deletes or renames them.

Install: `chrome://extensions`, Developer mode, Load unpacked, pick this folder. Then open the
extension's Details and turn on **Allow access to file URLs**; clicking the icon without it opens
that page.

How it works: every local HTML file shares one IndexedDB origin (`file://`), so the manager is drawn
into a `file:///?canvas-manager` tab, where it can read and delete the viewer's databases. The
service worker checks whether a file still exists (`fetch` of its `file://` URL) and which files are
open in tabs, since an open viewer tab would write its old copy back over a delete or rename.

A canvas knows its path only after it has been opened with the viewer from 2026-11-06 onwards;
before that it shows as "Location unknown".
