#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_orchestration_tests.sh — build and run the durable-workflow gate.
#
# Pure C++20 + libc. No OCCT, no kernel, no Node, no npm, no third-party
# library, and NO NETWORK: the research node is driven through fixture
# transports. The gate is expected to behave identically with the machine's
# network denied, which is the SACROSANCT 12.4 / 20.2 offline requirement, and
# phase 2 PROVES that with a dyld interposer rather than asserting it.
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
INC="-Iorchestration/include -Iretrieval/include"
OUT="$(mktemp -d /tmp/forge_orch.XXXXXX)"
trap 'rm -rf "$OUT"' EXIT

SRCS=(
  orchestration/src/Digest.cpp
  orchestration/src/NodeContract.cpp
  orchestration/src/WorkflowState.cpp
  orchestration/src/CheckpointStore.cpp
  orchestration/src/ResearchNode.cpp
  retrieval/src/Json.cpp
  retrieval/src/Redactor.cpp
  retrieval/src/SearchRequest.cpp
  retrieval/src/EvidenceRecord.cpp
  retrieval/src/HttpTransport.cpp
  retrieval/src/SearxngClient.cpp
)

echo "[orch] compiler: $($CXX --version | head -1)"
OBJS=()
for src in "${SRCS[@]}"; do
  obj="$OUT/$(basename "${src%.cpp}").o"
  if ! "$CXX" $FLAGS $INC -c "$src" -o "$obj"; then
    echo "[orch] COMPILE FAILED: $src"
    exit 1
  fi
  OBJS+=("$obj")
  echo "[orch] compiled $src"
done

if ! "$CXX" $FLAGS $INC orchestration/test/orchestration_gate.cpp "${OBJS[@]}" \
     -o "$OUT/orchestration_gate"; then
  echo "[orch] LINK FAILED"
  exit 1
fi
echo "[orch] linked $OUT/orchestration_gate"
echo

mkdir -p "$OUT/scratch1"
"$OUT/orchestration_gate" "$ROOT" "$OUT/scratch1"
rc=$?
echo
if [ "$rc" -ne 0 ]; then
  echo "[orch] GATE FAILED (exit $rc)"
  exit "$rc"
fi
echo "[orch] phase 1 (fixtures) PASSED"

# ── phase 2: prove the gate is offline, don't just assert it ─────────────────
# The retrieval module's dyld interposer turns socket()/connect()/getaddrinfo()/
# gethostbyname() into a hard abort. The WHOLE gate is re-run under it. If any
# code path in the orchestration module or the client it drives reaches the
# network, this phase dies with SIGABRT.
if [ "$(uname -s)" = "Darwin" ]; then
  CC="${CC:-clang}"
  if ! "$CC" -dynamiclib -O1 retrieval/test/net_denied_interpose.c -o "$OUT/net_denied.dylib"; then
    echo "[orch] could not build the network-denial interposer"
    exit 1
  fi

  # Self-test: the interposer must be able to FAIL, or phase 2 proves nothing.
  printf '#include <sys/socket.h>\nint main(){return socket(AF_INET,SOCK_STREAM,0)>=0?0:1;}\n' \
    > "$OUT/probe.c"
  "$CC" -O0 "$OUT/probe.c" -o "$OUT/probe" 2>/dev/null
  DYLD_INSERT_LIBRARIES="$OUT/net_denied.dylib" "$OUT/probe" 2>/dev/null
  probe_rc=$?
  if [ "$probe_rc" -ne 134 ]; then
    echo "[orch] interposer self-test did NOT abort (exit $probe_rc):"
    echo "[orch] phase 2 would be a gate that cannot fail. Refusing to report it as a pass."
    exit 1
  fi
  echo "[orch] interposer self-test aborted a real socket() as expected"

  echo "[orch] re-running the whole gate with the network denied"
  mkdir -p "$OUT/scratch2"
  DYLD_INSERT_LIBRARIES="$OUT/net_denied.dylib" \
    "$OUT/orchestration_gate" "$ROOT" "$OUT/scratch2" > "$OUT/offline.log" 2>&1
  rc2=$?
  tail -3 "$OUT/offline.log"
  if [ "$rc2" -ne 0 ]; then
    echo "[orch] OFFLINE PHASE FAILED (exit $rc2) — see below"
    cat "$OUT/offline.log"
    exit "$rc2"
  fi
  echo "[orch] phase 2 (network denied) PASSED"
else
  echo "[orch] phase 2 skipped: the interposer is macOS-specific"
fi

echo
echo "[orch] GATE PASSED"
exit 0
