#!/usr/bin/env bash
# run_isolation_gate.sh -- ★ PROVE THE APPLICATION SURVIVES A KERNEL SEGFAULT,
# and prove the proof can fail.
#
# WHAT IT BUILDS. Two binaries, directly with the compiler rather than through
# forge-desktop/CMakeLists.txt -- that file links the real application (SDL2, the
# Vulkan loader, glslang, MoltenVK), none of which a headless gate needs and none
# of which the kernel CI job installs. Same reasoning, same shape, as
# run_click_gate.sh, so this can ride the same job for the price of one more
# clang++ pass.
#
#   forge_kernel_worker  the child. NOT sanitized, deliberately: AddressSanitizer
#                        converts a fatal signal into its own report and a NORMAL
#                        EXIT, and the signal is precisely the observable the gate
#                        asserts on. A sanitized worker would exit 1 where the
#                        gate needs it to die on SIGSEGV.
#   isolation_gate       the parent. SANITIZED, because handling a dead child is
#                        pointer-heavy code in the process that must not fall over.
#
# ── ★ THE MUTATIONS ─────────────────────────────────────────────────────────
# A GATE NEVER PROVEN TO FAIL IS DECORATION. Six of the eight mutations below
# are injected into the PRODUCTION SOURCES -- a copy of them -- not into the test,
# because a mutation that only edits the test proves the test can print FAIL, not
# that it is watching the shipped code.
#
# Two are especially load-bearing:
#   G1  dereferences null IN THE PARENT. That is what an in-process OCCT fault
#       does today. If the gate survives it, the whole "the parent survived"
#       family of checks is unfalsifiable and this gate is theatre.
#   S2  grows a QUARANTINE in KernelSession::submit -- it declines to re-run a
#       program that has crashed before. That is the single most plausible wrong
#       turn this mechanism could take, it would look like prudence in review,
#       and the owner's constraint forbids it: "dont gate anything if you do that
#       then how will Archie generate ultra long feature trees for Kernel to
#       execute". The gate must go red the moment a refusal appears.
#
# Exit codes
#   0  GREEN -- the gate passed AND every mutation was caught
#   1  RED   -- an assertion failed, or a mutation was NOT caught
#   3  RED   -- could not build. A check that could not run is not a check that passed.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || { echo "[isolation] cannot cd to $ROOT. RED."; exit 3; }

KDIR="${FORGE_KERNEL_BUILD_DIR:-$ROOT/forge-kernel/build-verify}"
case "$KDIR" in /*) ;; *) KDIR="$ROOT/$KDIR" ;; esac
LIB=""
for cand in "$KDIR/libforge_kernel_core.dylib" "$KDIR/libforge_kernel_core.so" \
            "$KDIR/libforge_kernel_core.a"; do
  [ -f "$cand" ] && { LIB="$cand"; break; }
done
if [ -z "$LIB" ]; then
  echo "[isolation] libforge_kernel_core not found under $KDIR."
  echo "            Set FORGE_KERNEL_BUILD_DIR or build it. RED."
  exit 3
fi
echo "[isolation] kernel core: $LIB"

export ASAN_OPTIONS="${ASAN_OPTIONS:-abort_on_error=0:exitcode=1}"
CXX="${CXX:-clang++}"
OCCT_PREFIX="${OCCT_PREFIX:-$( (brew --prefix opencascade 2>/dev/null) || echo /usr/local )}"
EIGEN_PREFIX="${EIGEN_PREFIX:-$( (brew --prefix eigen 2>/dev/null) || echo /usr/local )}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/isolation_gate.XXXXXX")"
cleanup() {
  rm -rf "$WORK"
  [ -d "$WORK" ] && echo "[isolation] WARNING: kept $WORK -- rm -rf did not remove it"
}
trap cleanup EXIT

# timeout(1) is coreutils and absent on macOS: run the child in the background,
# arm a killer, reap whichever finishes first. Returns 124 on timeout.
#
# ★ THIS IS LOAD-BEARING, NOT HYGIENE. Mutation S6 removes the guard against an
# unbounded, uninterruptible wait -- so the mutated gate HANGS rather than
# failing an assertion. Without a timeout that mutation would hang CI instead of
# turning it red, and "a hang" and "a pass" look identical to a runner that waits
# for ever. A gate that cannot time out cannot catch a hang.
TEST_TIMEOUT="${TEST_TIMEOUT:-300}"
run_with_timeout() {
  local secs="$1"; shift
  "$@" & local pid=$!
  ( sleep "$secs"; kill -9 "$pid" 2>/dev/null ) & local wd=$!
  local rc=0
  wait "$pid" 2>/dev/null || rc=$?
  if kill -0 "$wd" 2>/dev/null; then kill -9 "$wd" 2>/dev/null; wait "$wd" 2>/dev/null || true
  else rc=124; fi
  return $rc
}

INC=(-I "$ROOT/ui/include" -I "$ROOT/forge-kernel/include" -I "$ROOT/forge-desktop/src"
     -I "$OCCT_PREFIX/include/opencascade" -I "$EIGEN_PREFIX/include/eigen3")
# ModelQuality.cpp CALLS OCCT (it enumerates the sub-shapes the quality queries
# need: the solids of the model, the edges with a face on each side, the face
# map). Every toolkit below is already in this binary's closure through the
# kernel library; naming them makes the DIRECT references resolve.
LINK=("$LIB" -L "$OCCT_PREFIX/lib" -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG3d -lTKGeomBase -Wl,-rpath,"$KDIR" -Wl,-rpath,"$OCCT_PREFIX/lib")
ASAN=(-fsanitize=address -fno-omit-frame-pointer -g)

# $1 = source directory to compile FROM (the tree, or a mutated copy)
# $2 = output directory
build_pair() {
  local SRC="$1" OUT="$2"
  # The worker: unsanitized, because the gate needs it to die on a real signal.
  "$CXX" -std=c++20 -O1 -Wall -Wextra -Werror -DFORGE_NATIVE_BREP=1 \
    -I "$SRC/ui/include" -I "$ROOT/forge-kernel/include" -I "$SRC/forge-desktop/src" \
    -I "$OCCT_PREFIX/include/opencascade" -I "$EIGEN_PREFIX/include/eigen3" \
    "$SRC"/ui/src/*.cpp \
    "$SRC/forge-desktop/src/KernelScene.cpp" "$SRC/forge-desktop/src/ModelQuality.cpp" \
    "$SRC/forge-desktop/src/PartFile.cpp" \
    "$SRC/forge-desktop/src/kernel_worker_main.cpp" \
    "${LINK[@]}" -o "$OUT/forge_kernel_worker" 2>"$OUT/worker.err" || return 1
  # The gate: sanitized.
  "$CXX" -std=c++20 -O1 -Wall -Wextra -Werror "${ASAN[@]}" -DFORGE_NATIVE_BREP=1 \
    -I "$SRC/ui/include" -I "$ROOT/forge-kernel/include" -I "$SRC/forge-desktop/src" \
    -I "$OCCT_PREFIX/include/opencascade" -I "$EIGEN_PREFIX/include/eigen3" \
    "$SRC"/ui/src/*.cpp \
    "$SRC/forge-desktop/src/KernelScene.cpp" "$SRC/forge-desktop/src/ModelQuality.cpp" \
    "$SRC/forge-desktop/src/PartFile.cpp" \
    "$SRC/forge-desktop/src/Camera.cpp" \
    "$SRC/forge-desktop/test/isolation_gate.cpp" \
    "${LINK[@]}" -o "$OUT/isolation_gate" 2>"$OUT/gate.err" || return 1
  return 0
}

echo "[isolation] compiling the worker (unsanitized) and the gate (sanitized)"
mkdir -p "$WORK/base"
if ! build_pair "$ROOT" "$WORK/base"; then
  echo "[isolation] the gate did not BUILD. RED."
  cat "$WORK/base/worker.err" "$WORK/base/gate.err" 2>/dev/null | tail -30
  exit 3
fi

run_with_timeout "$TEST_TIMEOUT" "$WORK/base/isolation_gate" \
    --worker "$WORK/base/forge_kernel_worker"
rc=$?
if [ $rc -eq 124 ]; then
  echo "[isolation] the gate exceeded ${TEST_TIMEOUT}s and was killed -- a HANG, not a pass. RED."
  exit 1
fi
if [ $rc -ge 128 ]; then
  echo "[isolation] the gate died on signal $((rc - 128)) -- it did not complete, so this is"
  echo "            NOT an assertion failure. RED."
  exit 1
fi
[ $rc -ne 0 ] && exit $rc

# ── the mutation proof ──────────────────────────────────────────────────────
# Each entry: id | one-line description | file | sed expression
# The sed expressions edit a COPY of the tree; $ROOT is never written to.
MUTS=(
"S1|the isolated path is bypassed, so every build runs in process|forge-desktop/src/KernelScene.cpp|s/if (session_\.workerConfigured()) {/if (false) {/"
"S2|★ a QUARANTINE appears: submit() declines a program that crashed before|ui/src/KernelSession.cpp|s|^bool KernelSession::submit(std::string label, std::string program, std::uint64_t nowMs) {|&\\n  if (priorIncidentFor(program) != nullptr) return false;|"
"S3|the worker stops announcing its ops, so a crash names nothing|forge-desktop/src/kernel_worker_main.cpp|s|^  std::fprintf(stderr, \"%s%d %s\\\\n\", forge::ui::kOpProgressPrefix, opId,|  if (opId) return; std::fprintf(stderr, \"%s%d %s\\\\n\", forge::ui::kOpProgressPrefix, opId,|"
"S4|the vertex-length check is weakened from != to <, so an over-long stream renders|forge-desktop/src/KernelScene.cpp|s/if (have != want) {/if (have < want) {/"
"S5|a crashed build reports SUCCESS|forge-desktop/src/KernelScene.cpp|s|^    error_ = session_\.diagnostic();\$|    error_ = session_.diagnostic();\\n    return true;|"
"S6|the unbounded-uninterruptible-wait guard is removed, so the app HANGS on rebuild|forge-desktop/src/KernelScene.cpp|s|^  if (limits_\.deadlineMs == 0 \&\& !hostPump_) {|  if (false) {|"
)

BAD=0
echo
echo "[isolation] mutation proof -- each injected defect MUST turn the gate red:"

for entry in "${MUTS[@]}"; do
  id="${entry%%|*}"; rest="${entry#*|}"
  desc="${rest%%|*}"; rest="${rest#*|}"
  file="${rest%%|*}"; expr="${rest#*|}"

  MDIR="$WORK/$id"
  mkdir -p "$MDIR/out"
  # Copy only what is compiled, so the copy is cheap and cannot pick up a stale
  # build tree.
  mkdir -p "$MDIR/src/ui" "$MDIR/src/forge-desktop"
  cp -R "$ROOT/ui/include" "$ROOT/ui/src" "$MDIR/src/ui/"
  cp -R "$ROOT/forge-desktop/src" "$ROOT/forge-desktop/test" "$MDIR/src/forge-desktop/"

  if ! sed -i '' "$expr" "$MDIR/src/$file"; then
    echo "  $id: SED FAILED -- the mutation could not be applied. RED."
    BAD=$((BAD+1)); continue
  fi
  # ★ A mutation that changed nothing proves nothing. This is the check that
  # catches a sed expression rotting against a refactor -- silently applying to
  # no lines and leaving a mutation that "passes" because the code is pristine.
  if diff -q "$ROOT/$file" "$MDIR/src/$file" >/dev/null 2>&1; then
    echo "  $id: NO-OP -- the sed matched nothing, so this mutation tests NOTHING. RED."
    BAD=$((BAD+1)); continue
  fi

  if ! build_pair "$MDIR/src" "$MDIR/out"; then
    # ★ NOT A PASS. A mutation that does not compile has proven nothing about the
    # gate's ASSERTIONS -- it proved the compiler works. It usually means the sed
    # is wrong (S2's first version matched two sites, one of them a const method
    # with no `program` in scope), and letting it count as "caught" is how a
    # rotted mutation masquerades as coverage for ever. Fix the sed.
    echo "  $id: DID NOT COMPILE -- proves nothing about the assertions. RED. <- $desc"
    cat "$MDIR/out/worker.err" "$MDIR/out/gate.err" 2>/dev/null | grep -m3 "error:" | sed 's/^/        /'
    BAD=$((BAD+1))
    continue
  fi
  run_with_timeout "$TEST_TIMEOUT" "$MDIR/out/isolation_gate" \
      --worker "$MDIR/out/forge_kernel_worker" > "$MDIR/out/run.log" 2>&1
  mrc=$?
  if [ "$mrc" -eq 0 ]; then
    echo "  $id: STAYED GREEN -- the check it targets is unfalsifiable <- $desc"
    BAD=$((BAD+1))
  else
    fails="$(grep -c '  FAIL' "$MDIR/out/run.log" || true)"
    first="$(grep -m1 '  FAIL' "$MDIR/out/run.log" | sed 's/^  FAIL: //' | cut -c1-64)"
    if [ "$mrc" -eq 124 ]; then first="HUNG -- killed after ${TEST_TIMEOUT}s"
    elif [ -z "$first" ]; then first="exit $mrc"; fi
    echo "  $id: RED ($fails checks failed) <- $desc"
    echo "        first: $first"
  fi
  rm -rf "$MDIR"
done

# Gate-side mutations. G1 is the positive control for the isolation itself.
for g in 1 2; do
  run_with_timeout "$TEST_TIMEOUT" "$WORK/base/isolation_gate" \
      --worker "$WORK/base/forge_kernel_worker" --mutation "$g" > "$WORK/base/g$g.log" 2>&1
  mrc=$?
  case "$g" in
    1) desc="★ null dereference IN THE PARENT (what an UNISOLATED fault does)";;
    2) desc="the host pump never cancels, so the deadline ends the job instead";;
  esac
  if [ "$mrc" -eq 0 ]; then
    echo "  G$g: STAYED GREEN -- unfalsifiable <- $desc"
    BAD=$((BAD+1))
  else
    if [ "$mrc" -ge 128 ]; then
      note="died on signal $((mrc - 128))"
    else
      note="$(grep -m1 'SUMMARY: AddressSanitizer' "$WORK/base/g$g.log" | cut -c1-64)"
      [ -z "$note" ] && note="$(grep -m1 '  FAIL' "$WORK/base/g$g.log" | sed 's/^  FAIL: //' | cut -c1-64)"
      [ -z "$note" ] && note="exit $mrc"
    fi
    echo "  G$g: RED <- $desc"
    echo "        $note"
  fi
done

if [ "$BAD" -ne 0 ]; then
  echo
  echo "[isolation] $BAD mutation(s) did not turn the gate red. RED."
  exit 1
fi
echo
echo "[isolation] GREEN -- the gate passes and all 8 mutations were caught."
exit 0
