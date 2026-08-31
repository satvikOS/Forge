#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# loopback_live_check.sh — exercise the REAL POSIX socket transport against a
# stub sidecar on 127.0.0.1.
#
# This is the one check in the module that opens a socket. It is LOOPBACK ONLY:
# the stub binds 127.0.0.1 on an ephemeral port and the client refuses any
# non-loopback destination by construction, so nothing leaves the machine. It
# exists because the main gate (run_retrieval_tests.sh) is fixture-driven and
# would otherwise ship the connect/write/read path unexecuted.
#
# It also asserts on the SERVER side that the received form body carries no
# customer name, no part number and no secret dimension — an end-to-end
# redaction check made from the far end of the socket.
#
# Exit 0 iff the round trip succeeded and the received body was clean.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"

CXX="${CXX:-clang++}"
FLAGS="-std=c++20 -O2 -Wall -Wextra -Werror"
INC="-Iretrieval/include"
OUT="$(mktemp -d /tmp/forge_retrieval_live.XXXXXX)"
STUB_PID=""
cleanup() {
  [ -n "$STUB_PID" ] && kill "$STUB_PID" 2>/dev/null
  rm -rf "$OUT"
}
trap cleanup EXIT

echo "[live] building the loopback driver"
if ! "$CXX" $FLAGS $INC \
      retrieval/test/loopback_live.cpp \
      retrieval/src/Json.cpp retrieval/src/Redactor.cpp retrieval/src/SearchRequest.cpp \
      retrieval/src/EvidenceRecord.cpp retrieval/src/HttpTransport.cpp \
      retrieval/src/SearxngClient.cpp \
      -o "$OUT/loopback_live"; then
  echo "[live] BUILD FAILED"
  exit 1
fi

echo "[live] starting the stub sidecar on 127.0.0.1"
python3 retrieval/test/stub_sidecar.py > "$OUT/port.txt" 2> "$OUT/stub.err" &
STUB_PID=$!

# A sub-second sleep, without depending on perl. The old line was
#   perl -e 'select undef,undef,undef,0.1' 2>/dev/null || true
# which on a host with no perl waits ZERO time and is swallowed by `|| true`, so the 5-second
# grace period below collapsed to ~0.13s of pure spinning and a stub that took longer than that
# to bind was reported as "stub did not report a port" — a false failure of a passing transport.
# `sleep 0.1` is accepted by BSD and GNU sleep; the integer fallback keeps a strict POSIX sleep
# waiting rather than not waiting at all.
nap() { sleep 0.1 2>/dev/null || sleep 1; }

PORT=""
for _ in $(seq 1 50); do
  PORT="$(head -1 "$OUT/port.txt" 2>/dev/null)"
  [ -n "$PORT" ] && break
  nap
done
if [ -z "$PORT" ]; then
  echo "[live] stub did not report a port"
  cat "$OUT/stub.err"
  exit 1
fi
echo "[live] stub listening on 127.0.0.1:$PORT"

"$OUT/loopback_live" "$PORT"
rc=$?
wait "$STUB_PID" 2>/dev/null
STUB_PID=""

echo
echo "[live] ── what the sidecar actually received ──"
cat "$OUT/stub.err"

# Far-end redaction assertions: read the body the SERVER saw, not the one the
# client believes it sent.
BODY_LINE="$(grep '^REQUEST-BODY: ' "$OUT/stub.err" || true)"
if [ -z "$BODY_LINE" ]; then
  echo "[live] the stub recorded no request body"
  exit 1
fi

leak=0
for secret in Northwind Aerospace ACME 4471 47.625; do
  if printf '%s' "$BODY_LINE" | grep -qi -- "$secret"; then
    echo "[live] LEAK: the sidecar received '$secret'"
    leak=1
  fi
done
if ! printf '%s' "$BODY_LINE" | grep -q '2768'; then
  echo "[live] the sidecar did NOT receive the allowlisted standard number 2768"
  leak=1
fi

if [ "$rc" -eq 0 ] && [ "$leak" -eq 0 ]; then
  echo "[live] LOOPBACK LIVE CHECK PASSED (round trip ok, received body clean)"
  exit 0
fi
echo "[live] LOOPBACK LIVE CHECK FAILED (driver exit $rc, leak flag $leak)"
exit 1
