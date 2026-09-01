#!/usr/bin/env bash
# run_differential_solid_gate.sh -- tier 2 of the two-path differential: THE SOLIDS.
#
# Compiles directly with the compiler rather than through forge-desktop/CMakeLists.txt,
# for the same reason run_ir_pipeline.sh does: that file links forge_desktop_core, which
# drags in SDL2, Vulkan and ImGui. This gate needs none of them -- only forge::ui,
# forge-desktop's KernelScene/PartFile (which are windowing-free by construction, see the
# header comment in KernelScene.hpp) and the node-free forge_kernel_core. The CI kernel
# job installs OCCT but not the windowing stack. A gate that cannot run in CI is a gate
# that rots.
#
# It runs FOUR arms per tree and requires all four to describe the same solid:
#   A  forge::ft::compileText          -- forge_verify's entry, where the benchmark
#                                         numbers come from
#   B  forge::ft::parse + compile      -- KernelScene's entry, over the IR the REAL
#                                         registered commands assembled
#   C  forge::desktop::KernelScene     -- the application object itself, tessellation
#                                         and viewport de-index included
#   D  the forge_verify BINARY         -- a SEPARATE ARTIFACT, over its stdin protocol.
#                                         A/B/C are three entry points in ONE process;
#                                         the invariant is about two ARTIFACTS, and a
#                                         stale or differently-linked verifier is
#                                         invisible to a comparison that never runs it.
#
# Requires a prebuilt libforge_kernel_core. Point at it with FORGE_KERNEL_BUILD_DIR, or
# build one with:
#   cmake -S forge-kernel -B forge-kernel/build-verify -DCMAKE_BUILD_TYPE=Release \
#         -DFORGE_BUILD_NODE_ADDON=OFF -DFORGE_BUILD_DESKTOP_FOUNDATION=ON
#   cmake --build forge-kernel/build-verify -j3 --target forge_kernel_core
#
# Exit codes
#   0  GREEN
#   1  RED  -- the arms disagree, or an injected divergence was NOT caught
#   3  RED  -- could not build, or the kernel core is missing. A check that could not
#              run is not a check that passed.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || {
  echo "[differential-solid] cannot resolve the repo root from ${BASH_SOURCE[0]}"; exit 3; }
[ -n "$ROOT" ] || { echo "[differential-solid] repo root resolved to the empty string"; exit 3; }
cd "$ROOT" || { echo "[differential-solid] cannot enter repo root $ROOT"; exit 3; }

KDIR="${FORGE_KERNEL_BUILD_DIR:-$ROOT/forge-kernel/build-verify}"
LIB=""
for cand in "$KDIR/libforge_kernel_core.dylib" "$KDIR/libforge_kernel_core.so" \
            "$KDIR/libforge_kernel_core.a"; do
  [ -f "$cand" ] && { LIB="$cand"; break; }
done
if [ -z "$LIB" ]; then
  echo "[differential-solid] libforge_kernel_core not found under $KDIR."
  echo "                     Set FORGE_KERNEL_BUILD_DIR or build it (see the header). RED."
  exit 3
fi
echo "[differential-solid] kernel core: $LIB"

# ── the forge_verify ARTIFACT ────────────────────────────────────────────────
# Arms A/B/C are three entry points inside one process. Arm D is the SEPARATE
# BINARY, and it is the only one that tests the thing the integration invariant is
# about: two artifacts built from one source. Its absence is RED (exit 3), never a
# skip -- a gate that silently drops its only cross-artifact arm still prints a
# green verdict, which is exactly the decoration this file argues against.
#
# Build it with the same one-liner the `kernel` job already uses for the batch
# gate; it reuses build-verify, so the configure is a no-op and only forge_verify
# itself links:
#   cmake --build forge-kernel/build-verify -j3 --target forge_verify
FORGE_VERIFY_BIN="${FORGE_VERIFY_BIN:-$KDIR/forge_verify}"
if [ ! -x "$FORGE_VERIFY_BIN" ]; then
  echo "[differential-solid] the forge_verify ARTIFACT is not at $FORGE_VERIFY_BIN."
  echo "                     Build it (see the header) or set FORGE_VERIFY_BIN. RED."
  exit 3
fi
export FORGE_VERIFY_BIN
echo "[differential-solid] forge_verify artifact: $FORGE_VERIFY_BIN"

CXX="${CXX:-clang++}"
OCCT_PREFIX="${OCCT_PREFIX:-$( (brew --prefix opencascade 2>/dev/null) || echo /usr/local )}"
EIGEN_PREFIX="${EIGEN_PREFIX:-$( (brew --prefix eigen 2>/dev/null) || echo /usr/local )}"
# EXACT pin, asked of the BINARY below rather than duplicated: one definition of "how
# many mutations exist" (differential_corpus.hpp), which is the discipline this whole
# gate exists to enforce.
MUTATIONS="${MUTATIONS:-9}"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/differential_solid.XXXXXX")"
cleanup() {
  rm -rf "$WORK"
  [ -d "$WORK" ] && echo "[differential-solid] WARNING: kept $WORK -- rm -rf did not remove it"
}
trap cleanup EXIT
BIN="$WORK/differential_solid_gate"

FAILURES=0
CAUGHT=0
fail() { echo "[differential-solid] FAIL -- $1"; FAILURES=$((FAILURES + 1)); }

# -Wall -Wextra -Werror to match every other gate in this tree: a warning nobody is
# forced to read is a suggestion, not a standard.
# shellcheck disable=SC2086
"$CXX" -std=c++20 -O1 -Wall -Wextra -Werror \
  -I ui/include -I ui/test -I forge-desktop/src -I forge-kernel/include \
  -I "$OCCT_PREFIX/include/opencascade" -I "$EIGEN_PREFIX/include/eigen3" \
  ui/src/*.cpp forge-desktop/src/KernelScene.cpp forge-desktop/src/PartFile.cpp \
  forge-desktop/test/differential_solid_gate.cpp \
  "$LIB" -L "$OCCT_PREFIX/lib" \
  -Wl,-rpath,"$KDIR" -Wl,-rpath,"$OCCT_PREFIX/lib" \
  -o "$BIN" 2>"$WORK/build.err"
rc=$?
if [ $rc -ne 0 ]; then
  echo "[differential-solid] the gate did not BUILD (rc=$rc). A gate that cannot build"
  echo "                     cannot fail. RED."
  tail -40 "$WORK/build.err"
  exit 3
fi

# The script's mutation count must equal the header's. Asked of the binary so there is
# exactly one definition of it.
DECLARED="$("$BIN" --mutation-count 2>/dev/null)"
if [ "$DECLARED" != "$MUTATIONS" ]; then
  fail "differential_corpus.hpp declares ${DECLARED:-<unreadable>} mutations, this script sweeps $MUTATIONS"
fi

# ── the clean run ────────────────────────────────────────────────────────────
"$BIN" >"$WORK/clean.out" 2>&1
rc=$?
cat "$WORK/clean.out"
# A signal death is NOT "the assertions failed" -- reporting it as such sends the reader
# looking for a geometry bug that is not there. MEASURED in this tree: compiling against
# a forge-kernel/include that is mid-edit while linking a libforge_kernel_core built from
# a DIFFERENT commit segfaults at rc=139.
if [ $rc -ge 128 ]; then
  echo
  echo "[differential-solid] the gate CRASHED on signal $((rc - 128)) -- it did not complete,"
  echo "                     so this is NOT an assertion failure. RED."
  echo "                     First thing to check: do forge-kernel/include and the linked"
  echo "                     libforge_kernel_core come from the SAME commit?"
  exit 1
fi
[ $rc -ne 0 ] && fail "the clean run is RED"

# ── every mutation THIS TIER CAN OBSERVE must be caught ──────────────────────
# Not every injected defect is visible to every tier, and sweeping one that is not
# is worse than skipping it: the case only reports "caught" when something ELSE in
# the run is already failing, so it turns green the moment the gate is otherwise
# healthy and nobody learns why. MEASURED -- CI run 33453484236 recorded case 7
# (which renames an op inside the OpConstraintBridge PROPOSAL, and this tier rules
# on no proposal) as caught with the SAME failure count as its red clean run.
#
# The binary declares what it can see; this script sweeps exactly that. The
# declaration is a whitelist of EXCLUSIONS in differential_corpus.hpp, so a
# mutation added later is swept by default and has to be argued out.
APPLICABLE="$("$BIN" --applicable-mutations 2>/dev/null)"
if [ -z "$APPLICABLE" ]; then
  fail "the gate declares NO observable mutations -- an unfalsifiable tier is not a tier"
fi
# zsh does not word-split, but this script runs under bash (the shebang, and CI's
# own bash --noprofile --norc). Split explicitly anyway rather than relying on it.
# shellcheck disable=SC2206
APPLICABLE_LIST=($APPLICABLE)
echo "[differential-solid] sweeping ${#APPLICABLE_LIST[@]} of $MUTATIONS mutations:" \
     "$APPLICABLE (the rest perturb nothing this tier measures)"

for i in "${APPLICABLE_LIST[@]}"; do
  "$BIN" --mutate "$i" >"$WORK/m$i.out" 2>&1
  mrc=$?
  if [ $mrc -eq 0 ]; then
    echo "[differential-solid] mutation $i NOT CAUGHT -- the gate stayed green with a"
    echo "                     deliberate divergence injected:"
    cat "$WORK/m$i.out"
    fail "mutation $i not caught"
  elif [ $mrc -ge 128 ]; then
    echo "[differential-solid] mutation $i CRASHED on signal $((mrc - 128)) rather than being"
    echo "                     caught. A crash is not a caught divergence."
    fail "mutation $i crashed"
  else
    name="$(sed -n 's/.*mutation=//p' "$WORK/m$i.out" | head -1)"
    verdict="$(grep -E 'checks, .* failures' "$WORK/m$i.out" | tail -1)"
    echo "[differential-solid] mutation $i caught: ${name:-?} -- ${verdict:-rc=$mrc}"
    CAUGHT=$((CAUGHT + 1))
  fi
done

if [ "$CAUGHT" -ne "${#APPLICABLE_LIST[@]}" ]; then
  fail "$CAUGHT of ${#APPLICABLE_LIST[@]} observable mutations caught"
fi

if [ "$FAILURES" -ne 0 ]; then
  echo "[differential-solid] VERDICT: RED -- $FAILURES failure(s)"
  exit 1
fi
echo "[differential-solid] VERDICT: PASS -- clean run green, $CAUGHT/${#APPLICABLE_LIST[@]} observable" \
     "divergences caught (of $MUTATIONS declared; the rest are tier 1's)"
exit 0
