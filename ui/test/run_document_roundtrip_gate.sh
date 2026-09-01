#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_document_roundtrip_gate.sh — DOES SAVING AND LOADING CHANGE THE SOLID?
#
# PartDocumentFile.hpp claimed this gate existed by name before it did. This is
# it. run_ui.sh proves the .fpart round trip preserves every FIELD; this proves
# it preserves the PART, by asking the kernel to build the document before and
# after and comparing what came back.
#
#   forge::ui   builds the 71-statement fixture, saves it to a real file, loads
#               it back from those bytes, and writes out both feature-IR programs
#               (ui/test/document_roundtrip_emit.cpp).
#   forge::ft   builds each program and measures it (forge_verify, census=full).
#   the check   compares a VECTOR of thirteen observables, requires a positive
#               control to move, and corrupts five saved fields in turn to prove
#               the instrument can see each of them lost
#               (ui/test/document_roundtrip_check.py).
#
# VOLUME CANNOT VALIDATE GEOMETRY — the divergence theorem gives a
# self-intersecting shell the right volume — so nothing here is decided on one
# number. The vector is volume, the six bbox coordinates, face / edge / vertex /
# body / shell counts, genus, BRepCheck validity, total surface area, the
# area-weighted surface centroid, and the face-kind histogram.
#
# ── what this script needs, and what it does when it is missing ─────────────
# A forge_verify binary. It looks at $FORGE_VERIFY_BIN, then
# $FORGE_KERNEL_BUILD_DIR/forge_verify, then forge-kernel/build-verify/forge_verify
# (which is where the `kernel` CI job builds one). If it finds none it EXITS 3 —
# deliberately red, never a silent skip, for the same reason
# forge_verify_batch_gate.sh does: a gate that cannot run must not look like a
# gate that passed.
#
# It compiles ui/src plus ONE extra translation unit with clang++ directly. It
# does NOT configure CMake, build forge-desktop, or link SDL2, Vulkan or ImGui —
# the forge::ui layer includes none of them, which is the whole reason it is a
# separate layer.
#
# Usage:  bash ui/test/run_document_roundtrip_gate.sh
#         FORGE_VERIFY_BIN=path/to/forge_verify bash ui/test/run_document_roundtrip_gate.sh
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || {
  echo "[roundtrip] cannot resolve the repo root from ${BASH_SOURCE[0]}"; exit 3; }
[ -n "$ROOT" ] || { echo "[roundtrip] repo root resolved to the empty string"; exit 3; }
cd "$ROOT" || { echo "[roundtrip] cannot enter repo root $ROOT"; exit 3; }

CXX="${CXX:-clang++}"
PYTHON="${PYTHON:-python3}"
# Same flags as run_ui.sh: SR-3 requires -Wall -Wextra, and -Werror because a
# warning nobody is forced to read is a suggestion.
FLAGS="-std=c++20 -O2 -Wall -Wextra -Werror"
INC="-I ui/include -I ui/test"

command -v "$PYTHON" >/dev/null 2>&1 || {
  echo "[roundtrip] no $PYTHON on PATH — cannot read the kernel's JSON"; exit 3; }

# ── find the verifier ───────────────────────────────────────────────────────
VERIFY="${FORGE_VERIFY_BIN:-}"
if [ -z "$VERIFY" ] && [ -n "${FORGE_KERNEL_BUILD_DIR:-}" ]; then
  VERIFY="$FORGE_KERNEL_BUILD_DIR/forge_verify"
fi
[ -n "$VERIFY" ] || VERIFY="forge-kernel/build-verify/forge_verify"
if [ ! -x "$VERIFY" ]; then
  echo "[roundtrip] no forge_verify at '$VERIFY'."
  echo "[roundtrip] Build one with:"
  echo "    cmake -S forge-kernel -B forge-kernel/build-verify -DCMAKE_BUILD_TYPE=Release \\"
  echo "          -DFORGE_BUILD_NODE_ADDON=OFF -DFORGE_BUILD_DESKTOP_FOUNDATION=ON"
  echo "    cmake --build forge-kernel/build-verify --target forge_verify"
  echo "[roundtrip] or point FORGE_VERIFY_BIN at an existing one."
  echo "[roundtrip] VERDICT: NOT RUN (exit 3) — a gate that cannot run is not a gate that passed"
  exit 3
fi

WORK="$(mktemp -d /tmp/forge_doc_roundtrip.XXXXXX)"
cleanup() {
  # KEEP the working directory when the gate failed: doc.fpart, the four IR
  # programs and the mutant are the whole evidence, and deleting them means the
  # next reader has to reproduce the failure before they can look at it.
  if [ "${KEEP:-0}" = "1" ]; then
    echo "[roundtrip] evidence kept in $WORK"
    return
  fi
  rm -rf "$WORK"
  [ -d "$WORK" ] && echo "[roundtrip] WARNING: kept $WORK -- rm -rf did not remove it"
  return 0
}
trap cleanup EXIT

echo "[roundtrip] CXX=$CXX  verifier=$VERIFY"

# ── 1. compile the emitter against the whole forge::ui layer ────────────────
# Every ui/src object, so a duplicate symbol or a missing definition surfaces
# here rather than in the app.
EMIT="$WORK/document_roundtrip_emit"
# shellcheck disable=SC2086
if ! $CXX $FLAGS $INC ui/test/document_roundtrip_emit.cpp ui/src/*.cpp -o "$EMIT" \
     2>"$WORK/build.err"; then
  echo "[roundtrip] BUILD FAILED:"; tail -30 "$WORK/build.err"
  echo "[roundtrip] VERDICT: FAIL"
  KEEP=1; exit 1
fi
echo "[roundtrip] built the emitter against $(ls ui/src/*.cpp | wc -l | tr -d ' ') forge::ui sources"

# ── 2. save and load, for real, through a file on disk ──────────────────────
if ! "$EMIT" "$WORK"; then
  rc=$?
  echo "[roundtrip] the emitter failed (exit $rc):"
  [ -f "$WORK/status.txt" ] && cat "$WORK/status.txt"
  echo "[roundtrip] VERDICT: FAIL"
  KEEP=1; exit 1
fi
# A script that prints COMPLETE without checking is lying: the emitter's last
# line is "ok" only when every file was written.
if ! tail -1 "$WORK/status.txt" | grep -qx "ok"; then
  echo "[roundtrip] the emitter did not finish:"; cat "$WORK/status.txt"
  echo "[roundtrip] VERDICT: FAIL"
  KEEP=1; exit 1
fi

# ── 3. ask the kernel ───────────────────────────────────────────────────────
if ! "$PYTHON" ui/test/document_roundtrip_check.py "$VERIFY" "$EMIT" "$WORK"; then
  rc=$?
  echo "[roundtrip] VERDICT: FAIL (check exited $rc)"
  KEEP=1; exit "$rc"
fi
exit 0
