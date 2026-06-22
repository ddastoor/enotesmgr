#!/usr/bin/env python3
"""Dev server for eNotes4 SPA. Serves from ./www (or project root as fallback)."""

import argparse
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

EXTRA_MIME_TYPES = {
    ".wasm": "application/wasm",
    ".js":   "application/javascript",
    ".mjs":  "application/javascript",
}

class SPAHandler(SimpleHTTPRequestHandler):
    def guess_type(self, path):
        _, ext = os.path.splitext(path)
        if ext in EXTRA_MIME_TYPES:
            return EXTRA_MIME_TYPES[ext]
        return super().guess_type(path)

    def end_headers(self):
        # Allow the Google OAuth popup to communicate back to the opener.
        # (No COEP: the GIS script and Google endpoints don't send CORP headers,
        # and the WASM crypto here doesn't require cross-origin isolation.)
        self.send_header("Cross-Origin-Opener-Policy", "same-origin-allow-popups")
        super().end_headers()

    def log_message(self, fmt, *args):
        print(f"  {self.address_string()} - {fmt % args}")


def main():
    parser = argparse.ArgumentParser(description="eNotes4 dev server")
    parser.add_argument("--port", type=int, default=8000, help="Port to listen on (default: 8000)")
    parser.add_argument("--dir", type=str, default=None, help="Directory to serve (default: ./www or .)")
    args = parser.parse_args()

    project_root = os.path.dirname(os.path.abspath(__file__))

    if args.dir:
        serve_dir = os.path.abspath(args.dir)
    else:
        www = os.path.join(project_root, "www")
        serve_dir = www if os.path.isdir(www) else project_root

    if not os.path.isdir(serve_dir):
        print(f"Error: directory not found: {serve_dir}", file=sys.stderr)
        sys.exit(1)

    os.chdir(serve_dir)

    server = HTTPServer(("localhost", args.port), SPAHandler)
    print(f"Serving '{serve_dir}' at http://localhost:{args.port}/")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
