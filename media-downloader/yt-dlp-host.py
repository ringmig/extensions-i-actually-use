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

# Chrome launches native hosts with minimal PATH — add common locations
os.environ['PATH'] = os.environ.get('PATH', '') + ':/opt/homebrew/bin:/usr/local/bin:/usr/bin'


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
    """Get the default Downloads directory."""
    home = os.path.expanduser('~')
    return os.path.join(home, 'Downloads')


def run_ytdlp(url, download_dir):
    """Run yt-dlp and stream progress back to the extension."""
    output_template = os.path.join(download_dir, '%(title)s.%(ext)s')

    cmd = [
        'yt-dlp',
        '--no-playlist',
        '--newline',
        '--progress',
        '-o', output_template,
        url
    ]

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

        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue

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
        else:
            send_message({'status': 'error', 'error': 'Download Failed'})

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
