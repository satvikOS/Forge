#!/usr/bin/env python3
"""stub_sidecar.py — a minimal stand-in for the SearXNG sidecar, bound to
127.0.0.1 ONLY, used to exercise the real POSIX socket transport in
retrieval/test/loopback_live.cpp.

It is not SearXNG. It answers POST /search with a SearXNG-shaped JSON body and
prints the received form body to stderr so the caller can assert that nothing
proprietary arrived. Serves a fixed number of requests and exits.
"""
import json
import socket
import sys
import threading

BODY = {
    "query": "stub",
    "number_of_results": 2,
    "results": [
        {
            "url": "https://www.iso.org/standard/6392.html",
            "title": "ISO 2768-1:1989 General tolerances",
            "content": "Tolerance class m permits a deviation of 0.2 mm for nominal lengths over 30 up to 120 mm.",
            "engine": "stub",
            "publishedDate": "1989-11-01T00:00:00Z",
        },
        {
            "url": "https://docs.example-machining.com/handbook/tolerances",
            "title": "Machining handbook: general tolerances",
            "content": "Class m is the shop default for general machining features.",
            "engine": "stub",
            "publishedDate": "2023-06-02T00:00:00Z",
        },
    ],
}


def main() -> int:
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", 0))  # loopback only, ephemeral port
    srv.listen(4)
    port = srv.getsockname()[1]
    print(port, flush=True)  # stdout: the port, for the caller

    srv.settimeout(30)
    try:
        conn, _ = srv.accept()
    except socket.timeout:
        print("stub: timed out waiting for a connection", file=sys.stderr)
        return 1

    with conn:
        conn.settimeout(10)
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = conn.recv(4096)
            if not chunk:
                break
            data += chunk
        head, _, rest = data.partition(b"\r\n\r\n")
        length = 0
        for line in head.split(b"\r\n"):
            if line.lower().startswith(b"content-length:"):
                length = int(line.split(b":", 1)[1].strip())
        while len(rest) < length:
            chunk = conn.recv(4096)
            if not chunk:
                break
            rest += chunk

        print("REQUEST-HEAD: " + head.decode("utf-8", "replace").split("\r\n")[0], file=sys.stderr)
        print("REQUEST-BODY: " + rest.decode("utf-8", "replace"), file=sys.stderr)

        payload = json.dumps(BODY).encode()
        resp = (
            b"HTTP/1.1 200 OK\r\n"
            b"Server: stub-sidecar\r\n"
            b"Content-Type: application/json\r\n"
            b"Content-Length: " + str(len(payload)).encode() + b"\r\n"
            b"Connection: close\r\n\r\n" + payload
        )
        conn.sendall(resp)
    srv.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
