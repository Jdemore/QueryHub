"""Local dev server for QueryHub.

Usage:  python runner.py [port]

Serves this folder over HTTP (ES modules will not load from file://),
disables caching so edits to JSON/JS show up on refresh, and opens the
browser. Ctrl+C to stop.
"""

import os
import socket
import sys
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PORT = 8000


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "application/javascript",
        ".mjs": "application/javascript",
        ".json": "application/json",
        ".css": "text/css",
        ".html": "text/html",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Quieter log: method, path, status only.
        sys.stdout.write("%s %s\n" % (self.address_string(), fmt % args))


def pick_port(start):
    for port in range(start, start + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise SystemExit("No free port found between %d and %d" % (start, start + 19))


def main():
    requested = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    port = pick_port(requested)
    if port != requested:
        print("Port %d is busy, using %d" % (requested, port))

    server = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=ROOT))
    url = "http://localhost:%d/" % port
    print("QueryHub running at %s  (Ctrl+C to stop)" % url)
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
