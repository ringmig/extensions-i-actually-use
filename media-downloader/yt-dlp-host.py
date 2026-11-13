#!/usr/bin/env python3
"""
Native messaging host for Media Downloader Chrome extension.
Receives URLs from the extension, runs yt-dlp, reports progress.
"""

import json
import struct
import subprocess
import sys
import os
import re
import shutil

# Every line of yt-dlp output to the log file is useful while debugging and
# noise otherwise — the file has no rotation.
DEBUG = False

# setup.command puts its own yt-dlp and ffmpeg in bin/ next to this file, so
# those win. Chrome launches native hosts with a minimal PATH — the common
# locations stay as a fallback for an install without bin/.
BIN_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bin')
os.environ['PATH'] = BIN_DIR + ':' + os.environ.get('PATH', '') + ':/opt/homebrew/bin:/usr/local/bin:/usr/bin'


def read_message():
    """Read a native messaging message from stdin."""
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    length = struct.unpack('<I', raw_length)[0]
    data = sys.stdin.buffer.read(length)
    return json.loads(data.decode('utf-8'))


def send_message(msg):
    """Send a native messaging message to stdout."""
    encoded = json.dumps(msg).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def get_downloads_dir():
    """The user's Downloads folder, where Chrome's own downloads land too."""
    return os.path.expanduser('~/Downloads')


def story_dir(url):
    """Stories land in the Downloads folder itself; a whole reel gets its own
    folder there, named <account>_story_<when it was downloaded>."""
    downloads = get_downloads_dir()
    m = re.search(r'/stories/([^/?#]+)/(\d+)?', url)
    if not m or m.group(2):
        return downloads
    from datetime import datetime
    return os.path.join(downloads, f'{m.group(1)}_story_{datetime.now():%Y-%m-%d_%H.%M.%S}')


def self_update(tool='yt-dlp'):
    """True if a newer release of tool was installed into bin/."""
    script = os.path.join(os.path.dirname(BIN_DIR), f'fetch-{tool}.sh')
    try:
        updated = subprocess.run([script, BIN_DIR], timeout=300).returncode == 0
    except Exception:
        return False
    log(f'{tool} update: {"installed" if updated else "nothing newer"}')
    return updated


def run_gallerydl(url, download_dir, retried=False):
    """Instagram stories: yt-dlp's reels_media call gets HTTP 400 since 2026-10
    (yt-dlp #17755), gallery-dl's GraphQL route still works."""
    cmd = [
        'gallery-dl',
        '--cookies-from-browser', 'chrome',
        '-D', download_dir,
        # Inside a reel's folder the date prefix keeps Finder in story order.
        '-f', ('{username}_{media_id}.{extension}' if download_dir == get_downloads_dir()
               else '{date:%Y-%m-%d_%H.%M.%S}_{media_id}.{extension}'),
        # Instagram's DASH streams are VP9, which Quick Look and Finder
        # thumbnails cannot decode; the direct mp4 is H.264 with sound (720p).
        '-o', 'videos=merged',
        url,
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    except FileNotFoundError:
        if not retried and self_update('gallery-dl'):
            return run_gallerydl(url, download_dir, retried=True)
        send_message({'status': 'error', 'error': 'gallery-dl not installed, run setup.command'})
        return
    except Exception as e:
        send_message({'status': 'error', 'error': str(e)})
        return

    # stdout lists one path per file; "# " marks one that was already there.
    files = [l.lstrip('# ').strip() for l in proc.stdout.splitlines() if l.strip()]
    if proc.returncode == 0 and files:
        name = (os.path.basename(files[0]) if len(files) == 1
                else f'{os.path.basename(download_dir)} ({len(files)} files)')
        send_message({'status': 'done', 'filename': name})
    elif not retried and self_update('gallery-dl'):
        run_gallerydl(url, download_dir, retried=True)
    else:
        errors = [l for l in proc.stderr.splitlines() if '[error]' in l]
        err = re.sub(r'^\[[^\]]+\]\[error\]\s*', '', errors[-1]) if errors else 'Download Failed'
        log(f'gallery-dl exited with {proc.returncode}: {proc.stderr[-500:]}')
        send_message({'status': 'error', 'error': err[:200]})


def run_ytdlp(url, download_dir, retried=False):
    """Run yt-dlp and stream progress back to the extension."""
    output_template = os.path.join(download_dir, '%(title)s.%(ext)s')

    cmd = [
        'yt-dlp',
        '--no-playlist',
        '--newline',
        '--progress',
        # Format sort: prefer mp4 video + m4a audio, then resolution, then bitrate.
        # Helps Instagram (and others) pick a working stream — see yt-dlp #11151.
        '-S', 'proto,ext:mp4:m4a,res,br',
        '-o', output_template,
    ]
    # Instagram CDN URLs require the user's session cookies — read them from
    # the Chrome profile so logged-in posts work the same way they do in the tab.
    if 'instagram.com' in url:
        cmd += ['--cookies-from-browser', 'chrome']
    cmd.append(url)

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )

        filename = None
        last_pct = ''
        recent_lines = []  # ring buffer of last N output lines for error context

        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue

            # Keep last 20 lines for error reporting
            recent_lines.append(line)
            if len(recent_lines) > 20:
                recent_lines.pop(0)

            if DEBUG:
                log(f'yt-dlp: {line}')

            # Extract progress percentage
            pct_match = re.search(r'(\d+\.?\d*)%', line)
            if pct_match:
                pct = pct_match.group(1).split('.')[0] + '%'
                if pct != last_pct:
                    last_pct = pct
                    send_message({'status': 'progress', 'progress': pct})

            # Extract destination filename
            dest_match = re.search(r'\[download\] Destination: (.+)', line)
            if dest_match:
                filename = dest_match.group(1)

            # Already downloaded
            already_match = re.search(r'\[download\] (.+) has already been downloaded', line)
            if already_match:
                filename = already_match.group(1)

            # Merging (ffmpeg)
            merge_match = re.search(r'\[Merger\] Merging formats into "(.+)"', line)
            if merge_match:
                filename = merge_match.group(1)

        proc.wait()

        if proc.returncode == 0:
            display_name = os.path.basename(filename) if filename else 'download complete'
            send_message({'status': 'done', 'filename': display_name})
        elif not retried and self_update():
            # Sites break a stale yt-dlp regularly (YouTube: 403 mid-download).
            # ponytail: every failure costs one update check; gate on the
            # error text if that wait starts to be felt.
            run_ytdlp(url, download_dir, retried=True)
        else:
            # Surface the actual error: prefer the last ERROR line, fall back to last line.
            err_line = next(
                (l for l in reversed(recent_lines) if 'ERROR' in l or 'Unsupported URL' in l),
                recent_lines[-1] if recent_lines else 'Download Failed'
            )
            # Trim yt-dlp's "ERROR: " prefix and shorten for toast display
            err_line = re.sub(r'^ERROR:\s*', '', err_line)[:200]
            log(f'yt-dlp exited with {proc.returncode}: {err_line}')
            send_message({'status': 'error', 'error': err_line or 'Download Failed'})

    except FileNotFoundError:
        send_message({'status': 'error', 'error': 'Downloader not installed'})
    except Exception as e:
        send_message({'status': 'error', 'error': str(e)})


LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ytdlp-host.log')

def log(msg):
    with open(LOG_FILE, 'a') as f:
        from datetime import datetime
        f.write(f'[{datetime.now().isoformat()}] {msg}\n')


def main():
    try:
        log(f'Host started. PATH={os.environ.get("PATH","")}')
        log(f'yt-dlp location: {shutil.which("yt-dlp")}')
        log(f'python: {sys.executable}')

        msg = read_message()
        log(f'Received message: {msg}')

        if not msg:
            log('No message received, exiting')
            return

        url = msg.get('url')
        if not url:
            send_message({'status': 'error', 'error': 'No URL provided'})
            return

        download_dir = msg.get('downloadDir', get_downloads_dir())
        send_message({'status': 'started'})
        if re.search(r'instagram\.com/stories/', url):
            run_gallerydl(url, story_dir(url))
        else:
            run_ytdlp(url, download_dir)
    except Exception as e:
        log(f'FATAL: {e}')
        import traceback
        log(traceback.format_exc())
        try:
            send_message({'status': 'error', 'error': str(e)})
        except:
            pass


if __name__ == '__main__':
    main()
