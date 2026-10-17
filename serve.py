#!/usr/bin/env python3
"""Kerf local server: serves the app and a project folder.

  ./serve.py [project_dir] [--port 8790]

API (localhost only):
  GET  /api/ls                  -> {"root":..., "files":[...]}   (.kerf + assets)
  GET  /api/file?path=p         -> raw bytes of a project file
  POST /api/file?path=p         -> write body to a project file
  GET  /api/font?name=Liberation Sans:style=Bold -> font file via fc-match
  GET  /api/fonts               -> ["Family:style=Style", ...]
"""
import argparse
import json
import mimetypes
import os
import shutil
import subprocess
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

APP_DIR = os.path.dirname(os.path.abspath(__file__))
ASSET_EXT = {'.kerf', '.scad', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ttf', '.otf', '.txt'}


class Handler(SimpleHTTPRequestHandler):
    root = None

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=APP_DIR, **kw)

    def log_message(self, fmt, *args):
        if '/api/' in (args[0] if args else ''):
            return
        sys.stderr.write('%s\n' % (fmt % args))

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _safe(self, rel):
        p = os.path.realpath(os.path.join(self.root, rel or ''))
        if p != self.root and not p.startswith(self.root + os.sep):
            raise PermissionError(rel)
        return p

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        try:
            if u.path == '/api/ls':
                files = []
                for d, dirs, names in os.walk(self.root):
                    dirs[:] = [x for x in dirs if not x.startswith('.')]
                    for n in names:
                        if os.path.splitext(n)[1].lower() in ASSET_EXT:
                            files.append(os.path.relpath(os.path.join(d, n), self.root))
                return self._json({'root': self.root, 'files': sorted(files)})
            if u.path == '/api/file':
                p = self._safe(q.get('path', [''])[0])
                if not os.path.isfile(p):
                    return self._json({'error': 'not found'}, 404)
                with open(p, 'rb') as f:
                    data = f.read()
                self.send_response(200)
                self.send_header('Content-Type', mimetypes.guess_type(p)[0] or 'application/octet-stream')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            if u.path == '/api/font':
                name = q.get('name', ['Liberation Sans'])[0]
                path = subprocess.run(['fc-match', '-f', '%{file}', name], capture_output=True, text=True).stdout.strip()
                if not path or not os.path.isfile(path) or not path.lower().endswith(('.ttf', '.otf')):
                    return self._json({'error': f'no TrueType/OpenType font for {name!r}'}, 404)
                with open(path, 'rb') as f:
                    data = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'font/ttf')
                self.send_header('X-Font-File', os.path.basename(path))
                self.end_headers()
                self.wfile.write(data)
                return
            if u.path == '/api/fonts':
                out = subprocess.run(['fc-list', ':fontformat=TrueType', 'family', 'style'], capture_output=True, text=True).stdout
                fonts = set()
                for line in out.splitlines():
                    fam, _, style = line.partition(':style=')
                    fams = fam.split(',')
                    fonts.add(f"{fams[0]}:style={style.split(',')[0]}" if style else fams[0])
                return self._json(sorted(fonts))
        except PermissionError:
            return self._json({'error': 'outside project'}, 403)
        return super().do_GET()

    def do_POST(self):
        u = urlparse(self.path)
        if u.path != '/api/file':
            return self._json({'error': 'bad path'}, 404)
        try:
            p = self._safe(parse_qs(u.query).get('path', [''])[0])
        except PermissionError:
            return self._json({'error': 'outside project'}, 403)
        n = int(self.headers.get('Content-Length', 0))
        data = self.rfile.read(n)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        tmp = p + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(data)
        os.replace(tmp, p)
        return self._json({'ok': True, 'bytes': len(data)})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('project', nargs='?', default=os.path.join(APP_DIR, 'projects'))
    ap.add_argument('--port', type=int, default=8790)
    a = ap.parse_args()
    root = os.path.realpath(a.project)
    if not os.path.isdir(root):
        os.makedirs(root)
    if not any(n.endswith('.kerf') for n in os.listdir(root)):
        for n in os.listdir(os.path.join(APP_DIR, 'examples')):
            shutil.copy(os.path.join(APP_DIR, 'examples', n), root)
    Handler.root = root
    srv = ThreadingHTTPServer(('127.0.0.1', a.port), Handler)
    print(f'Kerf: http://127.0.0.1:{a.port}/   project: {root}')
    srv.serve_forever()


if __name__ == '__main__':
    main()
