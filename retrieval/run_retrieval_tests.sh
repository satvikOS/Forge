#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_retrieval_tests.sh — build and run the SearXNG retrieval gate.
#
# Pure C++20 + libc. No OCCT, no Node, no npm, no third-party library, and NO
# NETWORK: every test drives fixtures through an injected transport. The gate is
# expected to behave identically with the machine's network denied, which is the
# SACROSANCT 12.4 / 20.2 offline requirement.
#
# Exit 0 iff every source compiles warning-free and the gate prints "0 failed".
# Override the compiler with CXX=g++.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"

CXX="${CXX:-clang++}"
FLAGS="-std=c++20 -O2 -Wall -Wextra -Werror"
INC="-Iretrieval/include"
OUT="$(mktemp -d /tmp/forge_retrieval.XXXXXX)"
trap 'rm -rf "$OUT"' EXIT

SRCS=(
  retrieval/src/Json.cpp
  retrieval/src/Redactor.cpp
  retrieval/src/SearchRequest.cpp
  retrieval/src/EvidenceRecord.cpp
  retrieval/src/HttpTransport.cpp
  retrieval/src/SearxngClient.cpp
)

echo "[retrieval] compiler: $($CXX --version | head -1)"
OBJS=()
for src in "${SRCS[@]}"; do
  obj="$OUT/$(basename "${src%.cpp}").o"
  if ! "$CXX" $FLAGS $INC -c "$src" -o "$obj"; then
    echo "[retrieval] COMPILE FAILED: $src"
    exit 1
  fi
  OBJS+=("$obj")
  echo "[retrieval] compiled $src"
done

if ! "$CXX" $FLAGS $INC retrieval/test/retrieval_gate.cpp "${OBJS[@]}" -o "$OUT/retrieval_gate"; then
  echo "[retrieval] LINK FAILED"
  exit 1
fi
echo "[retrieval] linked $OUT/retrieval_gate"
echo

"$OUT/retrieval_gate" "$ROOT/retrieval/test/fixtures"
rc=$?
echo
if [ "$rc" -ne 0 ]; then
  echo "[retrieval] GATE FAILED (exit $rc)"
  exit "$rc"
fi
echo "[retrieval] phase 1 (fixtures) PASSED"

# ── phase 2: prove the gate is offline, don't just assert it ─────────────────
# A dyld interposer turns socket()/connect()/getaddrinfo()/gethostbyname() into
# a hard abort, then the WHOLE gate is re-run under it. If any code path in the
# retrieval module reaches the network, this phase dies with SIGABRT. This is
# the SACROSANCT 12.4 / 20.2 "works with network denied" proof.
# A named proof must never SILENTLY not happen. Before this guard was explicit, phase 2 was
# skipped on every non-Darwin host and the gate still exited 0 — while the CI job carrying its
# name, "SearXNG client + redaction (incl. network-denied phase)", ran on ubuntu-latest. The
# check was green and the proof it is named after had not run. That is the exact
# green-signal-not-earned failure this suite exists to prevent, so an unsupported platform is now
# a HARD FAILURE unless the operator explicitly opts out.
if [ "$(uname -s)" != "Darwin" ]; then
  if [ "${FORGE_ALLOW_NO_DENIAL_PROOF:-0}" = "1" ]; then
    echo "[retrieval] phase 2 SKIPPED on $(uname -s): the dyld interposer is macOS-only."
    echo "[retrieval] FORGE_ALLOW_NO_DENIAL_PROOF=1 was set, so this is an explicit, recorded"
    echo "[retrieval] opt-out. THIS RUN DOES NOT PROVE THE NETWORK-DENIED PROPERTY."
    echo "[retrieval] phase 1 result stands on its own; phase 2 is UNPROVEN here."
    exit 0
  fi
  echo "[retrieval] FATAL: phase 2 (the network-denied proof) cannot run on $(uname -s)." >&2
  echo "[retrieval] retrieval/test/net_denied_interpose.c is a __DATA,__interpose dyld" >&2
  echo "[retrieval] interposer and is macOS-only. Run this gate on macOS, or port the" >&2
  echo "[retrieval] interposer to LD_PRELOAD for glibc." >&2
  echo "[retrieval] Refusing to exit 0: a gate must not claim a proof it did not perform." >&2
  echo "[retrieval] Set FORGE_ALLOW_NO_DENIAL_PROOF=1 to accept phase 1 only, explicitly." >&2
  exit 1
fi

if [ "$(uname -s)" = "Darwin" ]; then
  CC="${CC:-clang}"
  if ! "$CC" -dynamiclib -O1 retrieval/test/net_denied_interpose.c -o "$OUT/net_denied.dylib"; then
    echo "[retrieval] could not build the network-denial interposer"
    exit 1
  fi

  # Self-test: the interposer must be able to FAIL, or phase 2 proves nothing.
  printf '#include <sys/socket.h>\nint main(){return socket(AF_INET,SOCK_STREAM,0)>=0?0:1;}\n' \
    > "$OUT/probe.c"
  "$CC" -O0 "$OUT/probe.c" -o "$OUT/probe" 2>/dev/null
  DYLD_INSERT_LIBRARIES="$OUT/net_denied.dylib" "$OUT/probe" 2>/dev/null
  probe_rc=$?
  if [ "$probe_rc" -ne 134 ]; then
    echo "[retrieval] interposer self-test did NOT abort (exit $probe_rc):"
    echo "[retrieval] phase 2 would be a gate that cannot fail. Refusing to report it as a pass."
    exit 1
  fi
  echo "[retrieval] interposer self-test aborted a real socket() as expected"

  echo "[retrieval] re-running the whole gate with the network denied"
  DYLD_INSERT_LIBRARIES="$OUT/net_denied.dylib" \
    "$OUT/retrieval_gate" "$ROOT/retrieval/test/fixtures" > "$OUT/offline.log" 2>&1
  rc2=$?
  tail -3 "$OUT/offline.log"
  if [ "$rc2" -ne 0 ]; then
    echo "[retrieval] OFFLINE PHASE FAILED (exit $rc2) — see below"
    cat "$OUT/offline.log"
    exit "$rc2"
  fi
  echo "[retrieval] phase 2 (network denied) PASSED"
else
  echo "[retrieval] phase 2 skipped: the interposer is macOS-specific"
fi

echo
echo "[retrieval] GATE PASSED"
exit 0
