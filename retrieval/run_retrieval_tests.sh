#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_retrieval_tests.sh — build and run the SearXNG retrieval gate.
#
# Pure C++20 + libc. No OCCT, no Node, no npm, no third-party library.
#
#   phase 1  fixtures — every test drives an injected transport; no socket exists
#   phase 2  the same binary re-run under a dyld interposer that aborts on any
#            socket()/connect()/getaddrinfo(), proving the offline property
#            rather than asserting it (SACROSANCT 12.4 / 20.2)
#   phase 3  the loopback live check — the ONE place a real POSIX socket is
#            opened, against a stub sidecar on 127.0.0.1, and the ONE place the
#            redaction assertion is made from the FAR END of the socket
#
# Nothing leaves the machine in any phase: phase 3 is loopback-only, the same
# destination class 20.2 permits, and the transport refuses anything else.
#
# Exit 0 iff every source compiles warning-free, the gate prints "0 failed", and
# every phase either ran and passed or was opted out of EXPLICITLY.
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
    # Fall through: phase 3 is not macOS-specific and must not be skipped as a
    # side effect of opting out of phase 2.
  else
    echo "[retrieval] FATAL: phase 2 (the network-denied proof) cannot run on $(uname -s)." >&2
    echo "[retrieval] retrieval/test/net_denied_interpose.c is a __DATA,__interpose dyld" >&2
    echo "[retrieval] interposer and is macOS-only. Run this gate on macOS, or port the" >&2
    echo "[retrieval] interposer to LD_PRELOAD for glibc." >&2
    echo "[retrieval] Refusing to exit 0: a gate must not claim a proof it did not perform." >&2
    echo "[retrieval] Set FORGE_ALLOW_NO_DENIAL_PROOF=1 to accept phase 1 only, explicitly." >&2
    exit 1
  fi
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

# ── phase 3: the one check that opens a real socket ──────────────────────────
# Phases 1 and 2 are fixture-driven, so the POSIX connect/write/read path and the
# far-end redaction assertion — the only place anything reads the bytes the
# SERVER received rather than the ones the client believes it sent — ship
# unexecuted unless this runs. loopback_live_check.sh existed and was invoked by
# nothing: a test nobody calls is not a test, and its absence was invisible
# because the gate it should have belonged to was green without it.
#
# LOOPBACK ONLY. The stub binds 127.0.0.1 on an ephemeral port and the transport
# refuses any non-loopback destination by construction, so this phase reaches the
# same destination class SACROSANCT 20.2 permits and nothing leaves the machine.
#
# Like phase 2, it is a HARD FAILURE when it cannot run. Skipping quietly is how
# a suite ends up green while the proof in its name never happened.
LIVE="$ROOT/retrieval/test/loopback_live_check.sh"
if [ ! -x "$LIVE" ]; then
  echo "[retrieval] FATAL: $LIVE is missing or not executable." >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  if [ "${FORGE_ALLOW_NO_LIVE_LOOPBACK:-0}" = "1" ]; then
    echo "[retrieval] phases 3, 4 and 5 SKIPPED: python3 is not on PATH."
    echo "[retrieval] FORGE_ALLOW_NO_LIVE_LOOPBACK=1 was set, so this is an explicit, recorded"
    echo "[retrieval] opt-out. THIS RUN DOES NOT EXERCISE THE REAL SOCKET PATH, does not make"
    echo "[retrieval] the far-end redaction assertion, AND DOES NOT TEST THE EXECUTOR OR THE"
    echo "[retrieval] ARCHIE-SIDE BRIDGE AT ALL — phases 4 and 5 need python3 for their stub"
    echo "[retrieval] sidecar and for the bridge itself. The send path Archie uses is UNPROVEN"
    echo "[retrieval] in this run."
    echo
    echo "[retrieval] GATE PASSED (phases 1-2; phases 3-5 opted out)"
    exit 0
  fi
  echo "[retrieval] FATAL: phase 3 needs python3 for retrieval/test/stub_sidecar.py." >&2
  echo "[retrieval] Refusing to exit 0: the real socket path and the far-end redaction" >&2
  echo "[retrieval] assertion would ship unexecuted." >&2
  echo "[retrieval] Set FORGE_ALLOW_NO_LIVE_LOOPBACK=1 to accept phases 1-2 only, explicitly." >&2
  exit 1
fi

echo
echo "[retrieval] phase 3: loopback live check (real socket, far-end redaction assertion)"
"$LIVE" > "$OUT/live.log" 2>&1
rc3=$?
if [ "$rc3" -ne 0 ]; then
  echo "[retrieval] PHASE 3 FAILED (exit $rc3) — see below"
  cat "$OUT/live.log"
  exit "$rc3"
fi
grep -E '^\[live\] (stub listening|LOOPBACK)' "$OUT/live.log"
# A pass must be a pass the script actually declared, not merely exit 0.
if ! grep -q '^\[live\] LOOPBACK LIVE CHECK PASSED' "$OUT/live.log"; then
  echo "[retrieval] phase 3 exited 0 without declaring a pass. Refusing to report it as one."
  cat "$OUT/live.log"
  exit 1
fi
echo "[retrieval] phase 3 (loopback live) PASSED"

# ── phase 4: the EXECUTOR ────────────────────────────────────────────────────
# Phases 1-3 prove the CLIENT. They say nothing about forge_retrieve, the binary
# Archie actually invokes — and a gated library called by an ungated wrapper is
# an ungated system. Phase 4 drives the real executable through a real loopback
# socket: that it refuses to approve its own request, that a registered secret
# never reaches its stdout, and that every way the sidecar can be absent or wrong
# comes back RETRIEVAL_UNAVAILABLE with nothing transmitted.
#
# IT RUNS IN ITS --mutations FORM, ALWAYS. After the clean run it injects five
# defects into a COPY of the executor and requires each to turn a NAMED check
# red. That costs ~49s measured, which the 20-minute job affords, and it is the
# difference between a green check and an earned one. Two of those five defects
# went UNCAUGHT when first written — the checks they were aimed at were being
# satisfied by a redundant guard one line further down — so this is not a
# formality; it has already found holes in its own gate.
EXECGATE="$ROOT/retrieval/test/run_executor_gate.sh"
if [ ! -f "$EXECGATE" ]; then
  echo "[retrieval] FATAL: $EXECGATE is missing." >&2
  exit 1
fi
echo
echo "[retrieval] phase 4: the executor (forge_retrieve), with mutations"
bash "$EXECGATE" --mutations > "$OUT/executor.log" 2>&1
rc4=$?
if [ "$rc4" -ne 0 ]; then
  echo "[retrieval] PHASE 4 FAILED (exit $rc4) — see below"
  cat "$OUT/executor.log"
  exit "$rc4"
fi
grep -E '^\[executor\] (mutations|clean run)' "$OUT/executor.log"
# Exit 0 is not a pass unless the script SAID so. An empty log is a run that did
# not run, and a suite that reads only $? cannot tell the two apart.
if ! grep -q '^\[executor\] GATE PASSED (green, and every check demonstrated red)' "$OUT/executor.log"; then
  echo "[retrieval] phase 4 exited 0 without declaring a mutation-proved pass. Refusing to report one."
  cat "$OUT/executor.log"
  exit 1
fi
echo "[retrieval] phase 4 (executor) PASSED"

# ── phase 5: the Archie-side bridge ──────────────────────────────────────────
# forge_retrieval_bridge.py is what Archie imports. Its load-bearing property is
# NEGATIVE — that it is not a second send path — so the gate reads the module's
# own AST for every networking import and every way it could mint an approval,
# and then drives the real executor against a real stub to prove the rest.
PYGATE="$ROOT/retrieval/test/executor_python_gate.py"
if [ ! -f "$PYGATE" ]; then
  echo "[retrieval] FATAL: $PYGATE is missing." >&2
  exit 1
fi
echo
echo "[retrieval] phase 5: the Archie-side bridge, with mutations"
python3 "$PYGATE" --mutations > "$OUT/bridge.log" 2>&1
rc5=$?
if [ "$rc5" -ne 0 ]; then
  echo "[retrieval] PHASE 5 FAILED (exit $rc5) — see below"
  cat "$OUT/bridge.log"
  exit "$rc5"
fi
grep -E '^(mutations|\[python-gate\] clean run)' "$OUT/bridge.log"
if ! grep -q '^\[python-gate\] GATE PASSED (green, and every check demonstrated red)' "$OUT/bridge.log"; then
  echo "[retrieval] phase 5 exited 0 without declaring a mutation-proved pass. Refusing to report one."
  cat "$OUT/bridge.log"
  exit 1
fi
echo "[retrieval] phase 5 (bridge) PASSED"

echo
echo "[retrieval] GATE PASSED"
exit 0
