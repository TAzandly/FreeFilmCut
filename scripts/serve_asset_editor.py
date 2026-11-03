#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""FreeFilmCut Asset Editor static server.

python -m http.server on Windows/Python 3.9 maps .mjs -> text/plain, which
blocks ES module loads (troika webgl-sdf-generator.mjs / bidi-js).
This server forces application/javascript for .mjs/.js.
"""
from __future__ import annotations

import argparse
import mimetypes
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# Register before handler class so extensions_map init sees them.
mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("font/woff", ".woff")
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("font/ttf", ".ttf")
mimetypes.add_type("font/otf", ".otf")


class AssetEditorHandler(SimpleHTTPRequestHandler):
    # Force critical types even if the OS mimetypes DB is wrong.
    extensions_map = {
        **getattr(SimpleHTTPRequestHandler, "extensions_map", {}),
        ".html": "text/html",
        ".css": "text/css",
        ".js": "application/javascript",
        ".mjs": "application/javascript",
        ".json": "application/json",
        ".wasm": "application/wasm",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".ttf": "font/ttf",
        ".otf": "font/otf",
        ".svg": "image/svg+xml",
        "": "application/octet-stream",
    }

    def guess_type(self, path):  # noqa: N802 — stdlib API
        ext = os.path.splitext(path)[1].lower()
        if ext in (".mjs", ".js"):
            return "application/javascript"
        return super().guess_type(path)

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve FreeFilmCut three.js editor")
    parser.add_argument("port", nargs="?", type=int, default=5174)
    parser.add_argument("-d", "--directory", default=None, help="Root to serve (default: cwd)")
    args = parser.parse_args()

    root = os.path.abspath(args.directory or os.getcwd())
    if not os.path.isdir(root):
        print("[ERROR] directory not found:", root, file=sys.stderr)
        return 1
    os.chdir(root)

    try:
        httpd = ThreadingHTTPServer(("0.0.0.0", args.port), AssetEditorHandler)
    except OSError as exc:
        print("[ERROR] cannot bind port %s: %s" % (args.port, exc), file=sys.stderr)
        return 1

    print("========================================")
    print("  FreeFilmCut Asset Editor")
    print("  Root: %s" % root)
    print("  URL:  http://localhost:%s/editor/?v=fcc-ui-18" % args.port)
    print("  MIME: .mjs -> application/javascript")
    print("========================================")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
