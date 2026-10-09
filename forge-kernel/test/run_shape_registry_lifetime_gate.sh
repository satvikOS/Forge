#!/usr/bin/env bash
# run_shape_registry_lifetime_gate.sh — T-183: ShapeRegistry read lifetimes,
# native->OCCT conversion accounting, and document-close release.
#
#   KERNEL_BUILD=<forge-kernel build dir holding libforge_kernel_core.dylib> \
#     bash forge-kernel/test/run_shape_registry_lifetime_gate.sh
#
# Builds test/shape_registry_lifetime_gate.cpp five ways and runs each:
#
#   new-tsan   src/ShapeRegistry.cpp compiled INTO the gate, -fsanitize=thread.
#              Every scenario must PASS with no ThreadSanitizer report.
#   new-asan   the same under -fsanitize=address: no AddressSanitizer report.
#   old-tsan   -DGATE_OLD_API against the PRE-T-183 ShapeRegistry.{hpp,cpp}
#   old-asan   (git show $OLD_REF). The FAILING-FIRST PROOF, rerun every time:
#              each race scenario must be caught by the sanitizer (the
#              use-after-free the fix removes) and conversion-unlocked must FAIL
#              its check (the conversion held the global lock), and
#              destroy-unlocked must not finish cleanly (a payload destructor
#              ran under the global lock and re-entered it). An old scenario
#              that comes back green means this gate can no longer see the
#              defect, and the gate FAILS.
#   integ      -DGATE_INTEGRATION: no registry compiled in; the REAL
#              libforge_kernel_core registry through the real kernel ops and the
#              real feature-tree compiler (conversion counter = 0 on the native
#              path; scoped rebuild/close releases every handle).
#
# The kernel library is NOT instrumented; the registry under test is (it is
# compiled into the gate). The native builders, occtFromNativeSolid and OCCT
# come from the uninstrumented libraries. That is why the race scenarios keep
# their payloads in storage the gate allocates (see the gate's SolidHolder).
#
# Exit: 0 PASSED (everything above held), 1 FAILED, 2 NOT_RUN (a prerequisite
# is missing: the build dir, the library, a compiler, or $OLD_REF — a skipped
# failing-first proof is not a pass).
#
# Native only: clang++, the kernel library, OCCT. No node/npm.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KDIR="$(cd "$HERE/.." && pwd)"                 # forge-kernel/
REPO="$(cd "$KDIR/.." && pwd)"
KB="${KERNEL_BUILD:-$REPO/build-k}"
OUT="${OUT_DIR:-$KB/shape_registry_lifetime_gate}"
CXX="${CXX:-clang++}"
OLD_REF="${OLD_REF:-b609b41d43511d1345fd6c8c5a8439466d39366c}"  # origin/archdisc before T-183
RUN_TIMEOUT_S="${RUN_TIMEOUT_S:-600}"
if [[ -z "${OCCT_PREFIX:-}" ]]; then
  if command -v brew >/dev/null 2>&1; then OCCT_PREFIX="$(brew --prefix opencascade)"; else OCCT_PREFIX=/opt/homebrew/opt/opencascade; fi
fi

not_run() { echo "NOT_RUN: $*"; echo "VERDICT: NOT_RUN"; exit 2; }

[[ -d "$KB" ]] || not_run "KERNEL_BUILD '$KB' does not exist"
LIB=""
for c in "$KB/libforge_kernel_core.dylib" "$KB/libforge_kernel_core.so"; do [[ -f "$c" ]] && LIB="$c"; done
[[ -n "$LIB" ]] || not_run "no libforge_kernel_core in $KB (build target forge_kernel_core first)"
[[ -d "$OCCT_PREFIX/include/opencascade" ]] || not_run "OCCT headers not found under $OCCT_PREFIX"
command -v "$CXX" >/dev/null 2>&1 || not_run "compiler '$CXX' not found"
mkdir -p "$OUT"

SRC="$KDIR/test/shape_registry_lifetime_gate.cpp"
COMMON=(-std=gnu++20 -O1 -g -fno-omit-frame-pointer -Wall -Wextra -Werror
        -DFORGE_NATIVE_BREP=1 -isystem "$OCCT_PREFIX/include/opencascade")
LINK=(-L"$KB" -lforge_kernel_core -Wl,-rpath,"$KB"
      -L"$OCCT_PREFIX/lib" -Wl,-rpath,"$OCCT_PREFIX/lib"
      -lTKernel -lTKMath -lTKBRep -lTKG3d -lTKG2d -lTKGeomBase -lTKTopAlgo)

# ---- the pre-T-183 registry, for the failing-first proof -------------------
OLD="$OUT/old-registry"
rm -rf "$OLD"; mkdir -p "$OLD/include/forge" "$OLD/src"
if ! git -C "$REPO" cat-file -e "$OLD_REF^{commit}" 2>/dev/null; then
  not_run "OLD_REF $OLD_REF is not in this clone (fetch it, or set OLD_REF to the pre-T-183 commit)"
fi
git -C "$REPO" show "$OLD_REF:forge-kernel/include/forge/ShapeRegistry.hpp" > "$OLD/include/forge/ShapeRegistry.hpp" || not_run "git show old header"
git -C "$REPO" show "$OLD_REF:forge-kernel/src/ShapeRegistry.cpp" > "$OLD/src/ShapeRegistry.cpp" || not_run "git show old source"
if grep -q 'nativeToOcctConversions' "$OLD/src/ShapeRegistry.cpp"; then
  not_run "OLD_REF $OLD_REF already carries the T-183 registry; point it at the commit before"
fi

FAILS=0
SUMMARY="$OUT/summary.txt"
: > "$SUMMARY"
say() { echo "$*" | tee -a "$SUMMARY"; }

build() {  # name, extra flags...
  local name="$1"; shift
  if ! "$CXX" "${COMMON[@]}" "$@" "${LINK[@]}" -o "$OUT/$name" > "$OUT/$name.build.log" 2>&1; then
    say "BUILD FAILED  $name  (log: $OUT/$name.build.log)"; sed -n 1,40p "$OUT/$name.build.log"
    FAILS=$((FAILS + 1)); return 1
  fi
}

# run <binary> <scenario> -> sets RC and LOG; bounded by RUN_TIMEOUT_S.
run() {
  LOG="$OUT/$1.$2.log"
  # perl forks + waits so a crash is an exit code (128+signal) here, not a shell
  # "Abort trap" line, and a hang is killed at the timeout (rc 137).
  TSAN_OPTIONS="halt_on_error=1 exitcode=66 ${TSAN_OPTIONS:-}" \
  ASAN_OPTIONS="halt_on_error=1 detect_leaks=0 ${ASAN_OPTIONS:-}" \
    perl -e 'my $t = shift; my $pid = fork(); die "fork: $!" unless defined $pid;
             if ($pid == 0) { exec @ARGV or exit 127 }
             $SIG{ALRM} = sub { kill "KILL", $pid }; alarm $t;
             waitpid($pid, 0); my $s = $?;
             exit(($s & 127) ? 128 + ($s & 127) : $s >> 8);' \
      "${3:-$RUN_TIMEOUT_S}" "$OUT/$1" "$2" > "$LOG" 2>&1
  RC=$?
}

sanitizer_report() {  # prints the first report line, if any
  grep -m1 -E 'WARNING: ThreadSanitizer|ERROR: AddressSanitizer|ERROR: ThreadSanitizer' "$LOG" || true
}

expect_green() {  # binary scenario
  run "$1" "$2"
  local rep; rep="$(sanitizer_report)"
  if [[ $RC -eq 0 && -z "$rep" ]] && grep -q '^GREEN' "$LOG"; then
    say "PASS  $1 $2"
  else
    say "FAIL  $1 $2  rc=$RC ${rep:+[$rep]}  (log: $LOG)"
    grep -E 'FAIL|SUMMARY|Sanitizer' "$LOG" | head -12
    FAILS=$((FAILS + 1))
  fi
}

expect_caught() {  # binary scenario how(sanitizer|check): the OLD code must go RED this way
  run "$1" "$2" "${4:-}"
  local rep; rep="$(sanitizer_report)"
  local ok=0
  case "$3" in
    sanitizer) [[ $RC -ne 0 && -n "$rep" ]] && ok=1 ;;
    check)     [[ $RC -ne 0 ]] && grep -q '\[FAIL\]' "$LOG" && ok=1 ;;
    any)       [[ $RC -ne 0 ]] && ok=1 ;;  # crash, sanitizer, check, or hang (137)
  esac
  if [[ $ok -eq 1 ]]; then
    say "PASS  $1 $2  RED on the old registry as required (rc=$RC${rep:+, $rep}$( [[ $3 == check ]] && echo ", $(grep -m1 '\[FAIL\]' "$LOG" | sed 's/^ *//')"))"
  else
    say "FAIL  $1 $2  the OLD registry was NOT caught ($3 expected; rc=$RC) — the gate is blind  (log: $LOG)"
    FAILS=$((FAILS + 1))
  fi
}

NEW_SCENARIOS=(race-occt race-native-solid race-native-mesh conversion-unlocked destroy-unlocked
               lease-outlives-release stress conversion-counter release-during-conversion
               scope scope-attribution)

say "== shape_registry_lifetime_gate  (kernel: $LIB; old registry: $OLD_REF)"

# ---- new registry, instrumented --------------------------------------------
for san in thread address; do
  name="new-${san:0:1}san"
  if build "$name" -fsanitize="$san" -I"$KDIR/include" "$SRC" "$KDIR/src/ShapeRegistry.cpp"; then
    for s in "${NEW_SCENARIOS[@]}"; do expect_green "$name" "$s"; done
  fi
done

# ---- old registry: the failing-first proof ---------------------------------
for san in thread address; do
  name="old-${san:0:1}san"
  if build "$name" -fsanitize="$san" -DGATE_OLD_API -I"$OLD/include" -I"$KDIR/include" \
       "$SRC" "$OLD/src/ShapeRegistry.cpp"; then
    for s in race-occt race-native-solid race-native-mesh; do expect_caught "$name" "$s" sanitizer; done
    expect_caught "$name" conversion-unlocked check
    # A payload destructor under the old global lock self-deadlocks (or the
    # platform refuses the relock and terminates): any non-zero end, 60 s bound.
    expect_caught "$name" destroy-unlocked any 60
  fi
done

# ---- the real kernel library --------------------------------------------------
if build integ -DGATE_INTEGRATION -I"$KDIR/include" "$SRC"; then
  for s in integration-native-path integration-document-close; do expect_green integ "$s"; done
fi

if [[ $FAILS -eq 0 ]]; then
  say "VERDICT: PASSED"; exit 0
fi
say "VERDICT: FAILED ($FAILS)"; exit 1
