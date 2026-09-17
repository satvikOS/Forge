#!/usr/bin/env python3
"""Replays knowing-v1's recorded BOX+HOLE answer (live2_empty.log) on 127.0.0.1:<port>,
to show what the app does when a whole-part plan lands on the starter part."""
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

PLAN = {"intent": "", "summary": "",
        "steps": [{"commandId": "part.primitive_box", "irOp": "BOX",
                   "args": [{"name": "dx", "number": 60.0}, {"name": "dy", "number": 40.0},
                            {"name": "dz", "number": 10.0}]},
                  {"commandId": "part.hole", "irOp": "HOLE",
                   "args": [{"name": "diameter", "number": 8.0}, {"name": "x", "number": 0.0},
                            {"name": "y", "number": 0.0}, {"name": "z", "number": -5.0}]}]}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._send({"ok": True, "model": "replay", "adapter": "replay", "loaded": True})

    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))
        self._send({"id": req.get("id"), "ok": True, "plan": PLAN})


HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
