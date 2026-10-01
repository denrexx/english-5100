#!/usr/bin/env python3
"""Local website and shared progress server."""
import argparse
import functools
import gzip
import json
import socket
import subprocess
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from progress_store import ProgressStore

ROOT = Path(__file__).resolve().parent
PUBLIC = {'index.html', 'app.js', 'sync.js', 'style.css', 'tokens.css', 'data.json', 'sw.js', 'manifest.webmanifest'}


class Handler(SimpleHTTPRequestHandler):
    def send_json(self, status, document):
        body = json.dumps(document, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if urlsplit(self.path).path == '/api/progress':
            document = self.server.progress.read()
            if urlsplit(self.path).query == f"revision={document['revision']}" and document['state'] is not None:
                self.send_response(204)
                self.end_headers()
            else:
                self.send_json(200, document)
            return
        requested = unquote(urlsplit(self.path).path).lstrip('/') or 'index.html'
        if requested not in PUBLIC and not (
            requested.startswith('audio/') and len(requested) == 50
            and requested.endswith('.ogg')
            and all(c in '0123456789abcdef' for c in requested[6:-4])
        ):
            self.send_error(404)
            return
        if requested in PUBLIC and 'gzip' in self.headers.get('Accept-Encoding', ''):
            stamp = (ROOT / requested).stat().st_mtime_ns
            if COMPRESSED[requested][0] != stamp:
                COMPRESSED[requested] = (stamp, gzip.compress((ROOT / requested).read_bytes(), compresslevel=6))
            body = COMPRESSED[requested][1]
            self.send_response(200)
            self.send_header('Content-Type', self.guess_type(requested))
            self.send_header('Content-Encoding', 'gzip')
            self.send_header('Vary', 'Accept-Encoding')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            super().do_GET()

    def do_POST(self):
        if urlsplit(self.path).path != '/api/progress':
            self.send_error(404)
            return
        origin = self.headers.get('Origin')
        if origin and urlsplit(origin).netloc.lower() != self.headers.get('Host', '').lower():
            self.send_json(403, {'error': 'Origin not allowed'})
            return
        if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
            self.send_json(415, {'error': 'JSON required'})
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 5 * 1024 * 1024:
                self.send_json(413, {'error': 'Progress too large'})
                return
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError('Invalid request')
            saved, document = self.server.progress.write(payload.get('revision'), payload.get('state'))
        except (ValueError, TypeError, OverflowError):
            self.send_json(400, {'error': 'Invalid progress'})
            return
        self.send_json(200 if saved else 409, document)

    def do_HEAD(self):
        requested = unquote(urlsplit(self.path).path).lstrip('/') or 'index.html'
        if requested not in PUBLIC and not (requested.startswith('audio/') and len(requested) == 50 and requested.endswith('.ogg') and all(c in '0123456789abcdef' for c in requested[6:-4])):
            self.send_error(404)
            return
        super().do_HEAD()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store' if urlsplit(self.path).path == '/api/progress' else 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
        super().end_headers()

    def log_message(self, fmt, *args):
        if args and str(args[0]).startswith(('POST', 'DELETE')):
            return
        super().log_message(fmt, *args)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='English 5100 server')
    parser.add_argument('--port', type=int, default=8080)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--lan', action='store_true', help='Открыть сайт для устройств в локальной сети')
    parser.add_argument('--state-file', type=Path, default=Path.home() / '.local/share/english-5100/progress.sqlite3', help='Файл общего прогресса')
    args = parser.parse_args()
    if args.lan:
        args.host = '0.0.0.0'
    COMPRESSED = {name: ((ROOT / name).stat().st_mtime_ns, gzip.compress((ROOT / name).read_bytes(), compresslevel=6)) for name in PUBLIC}
    ThreadingHTTPServer.allow_reuse_address = True
    try:
        server = ThreadingHTTPServer((args.host, args.port), functools.partial(Handler, directory=str(ROOT)))
        server.progress = ProgressStore(args.state_file)
    except OSError as error:
        raise SystemExit(f'Не удалось запустить сайт: {error}. Попробуйте ./start.sh --port 8081')
    if args.host == '0.0.0.0':
        addresses = set()
        try:
            interfaces = json.loads(subprocess.check_output(['ip', '-j', '-4', 'address', 'show'], text=True))
            for interface in interfaces:
                if interface['ifname'].startswith(('lo', 'tun', 'tap', 'docker', 'veth', 'br-', 'wg')):
                    continue
                addresses.update(a['local'] for a in interface.get('addr_info', []) if a.get('scope') == 'global')
        except (OSError, ValueError):
            try:
                addresses.update(socket.gethostbyname_ex(socket.gethostname())[2])
            except OSError:
                pass
        print(f'На компьютере: http://localhost:{args.port}', flush=True)
        for address in sorted(addresses):
            print(f'В локальной сети: http://{address}:{args.port}', flush=True)
    else:
        print(f'English 5100: http://{args.host}:{args.port}', flush=True)
    print('Остановить: Ctrl+C', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
