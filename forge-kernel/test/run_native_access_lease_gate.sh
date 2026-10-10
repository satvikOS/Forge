#!/usr/bin/env bash
# run_native_access_lease_gate.sh — T-261: the OCCT-free seam's reads stay alive
# while the caller reads them, and no kernel call site reads through a borrow.
#
#   KERNEL_BUILD=<forge-kernel build dir holding libforge_kernel_core.dylib> \
#     [OLD_KERNEL_BUILD=<dir holding a PRE-T-261 libforge_kernel_core>] \
#     bash forge-kernel/test/run_native_access_lease_gate.sh [--mutations]
#
# Drives test/native_access_lease_gate.cpp:
#
#   new-tsan / new-asan   src/ShapeRegistry.cpp + src/ShapeHandle.cpp +
#                         src/NativeShapeAccess.cpp compiled INTO the gate under
#                         -fsanitize=thread / =address.
#                           borrow-solid|mesh|shape  MUST be caught by the
#                             sanitizer: a reader holding nativeSolidOf /
#                             nativeMeshOf / nativeShapeOf while another thread
#                             releases the handle reads freed memory. A borrow
#                             scenario that comes back clean means the gate went
#                             blind, and the gate FAILS.
#                           lease-solid|mesh|shape|refusal|stress  MUST be clean.
#   old-tsan / old-asan   FAILING-FIRST, rerun every time, against the seam at
#                         $OLD_REF (the pre-T-261 NativeShapeAccess.{hpp,cpp}):
#                           (a) the borrow scenarios are caught there too (the
#                               defect is real on the code being replaced), and
#                           (b) the lease scenarios do NOT COMPILE there: the
#                               old seam offers an OCCT-free caller no owning
#                               read at all.
#   integ                 -DGATE_INTEGRATION, the real library: massProperties()
#                         and io::exportStl() in a tight loop while another
#                         thread releases the handle; closed-form answers, no
#                         crash, and the payload's last owner is the READER in
#                         >= 25% (massProperties) / >= 5% (exportStl, whose
#                         lease covers only its tessellation) of rounds: the
#                         call held a lease across the release.
#   integ-old (optional)  the same binary against $OLD_KERNEL_BUILD. Recorded,
#                         and REQUIRED to fail: on the borrow-reading library the
#                         reader never owns the payload (pinned=0) or crashes.
#                         Skipped (and said so) when OLD_KERNEL_BUILD is unset:
#                         it needs a second full kernel build.
#   call sites            every nativeSolidOf( / nativeMeshOf( / nativeShapeOf(
#                         CALL in forge-kernel/src and forge-desktop/src. Each
#                         one outside the seam's own definitions FAILS the gate
#                         unless it is in ALLOWED_BORROWS below with a reason.
#
# --mutations  one-anchor mutants of a COPY of src/NativeShapeAccess.cpp, each
#              removing one T-261 guarantee; the named scenario must go RED
#              under both sanitizers. A stale anchor or a mutant that does not
#              compile FAILS the gate.
#
# Exit: 0 PASSED, 1 FAILED, 2 NOT_RUN (a prerequisite is missing).
# Native only: clang++, the kernel library, OCCT. No node/npm.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KDIR="$(cd "$HERE/.." && pwd)"                 # forge-kernel/
REPO="$(cd "$KDIR/.." && pwd)"
KB="${KERNEL_BUILD:-$REPO/build-k}"
OUT="${OUT_DIR:-$KB/native_access_lease_gate}"
CXX="${CXX:-clang++}"
OLD_REF="${OLD_REF:-4f3e97702172889432dbbcd4b7b376363e20bf91}"  # work/T-183 head: the seam before T-261
OLD_KB="${OLD_KERNEL_BUILD:-}"
RUN_TIMEOUT_S="${RUN_TIMEOUT_S:-600}"
if [[ -z "${OCCT_PREFIX:-}" ]]; then
  if command -v brew >/dev/null 2>&1; then OCCT_PREFIX="$(brew --prefix opencascade)"; else OCCT_PREFIX=/opt/homebrew/opt/opencascade; fi
fi

# Borrow call sites that are KNOWN and not yet moved, each with its reason.
# Format: "<repo-relative path>|<reason>". Anything else fails the gate.
ALLOWED_BORROWS=(
  "forge-kernel/src/FeaTet.cpp|owned by T-256 (IN_PROGRESS) at T-261 time; its move onto nativeSolidLease is filed as a follow-up"
)

not_run() { echo "NOT_RUN: $*"; echo "VERDICT: NOT_RUN"; exit 2; }
case "${1:-}" in
  ""|--mutations) ;;
  *) not_run "unknown argument '$1' (usage: $0 [--mutations])" ;;
esac

[[ -d "$KB" ]] || not_run "KERNEL_BUILD '$KB' does not exist"
libin() { local d="$1"; for c in "$d/libforge_kernel_core.dylib" "$d/libforge_kernel_core.so"; do [[ -f "$c" ]] && { echo "$c"; return; }; done; }
LIB="$(libin "$KB")"
[[ -n "$LIB" ]] || not_run "no libforge_kernel_core in $KB (build target forge_kernel_core first)"
[[ -d "$OCCT_PREFIX/include/opencascade" ]] || not_run "OCCT headers not found under $OCCT_PREFIX"
command -v "$CXX" >/dev/null 2>&1 || not_run "compiler '$CXX' not found"
git -C "$REPO" cat-file -e "$OLD_REF^{commit}" 2>/dev/null || not_run "OLD_REF $OLD_REF is not in this clone"
mkdir -p "$OUT"

SRC="$KDIR/test/native_access_lease_gate.cpp"
COMMON=(-std=gnu++20 -O1 -g -fno-omit-frame-pointer -Wall -Wextra -Werror
        -DFORGE_NATIVE_BREP=1 -isystem "$OCCT_PREFIX/include/opencascade")
link_flags() {  # <lib dir>
  echo "-L$1 -lforge_kernel_core -Wl,-rpath,$1 -L$OCCT_PREFIX/lib -Wl,-rpath,$OCCT_PREFIX/lib -lTKernel -lTKMath -lTKBRep -lTKG3d -lTKG2d -lTKGeomBase -lTKTopAlgo"
}
REGISTRY=("$KDIR/src/ShapeRegistry.cpp" "$KDIR/src/ShapeHandle.cpp")

# ---- the pre-T-261 seam ------------------------------------------------------
OLD="$OUT/old-seam"
rm -rf "$OLD"; mkdir -p "$OLD/include/forge" "$OLD/src"
git -C "$REPO" show "$OLD_REF:forge-kernel/include/forge/NativeShapeAccess.hpp" > "$OLD/include/forge/NativeShapeAccess.hpp" || not_run "git show old header"
git -C "$REPO" show "$OLD_REF:forge-kernel/src/NativeShapeAccess.cpp" > "$OLD/src/NativeShapeAccess.cpp" || not_run "git show old source"
if grep -q 'nativeSolidLease' "$OLD/include/forge/NativeShapeAccess.hpp"; then
  not_run "OLD_REF $OLD_REF already carries the T-261 seam; point it at the commit before"
fi

FAILS=0
SUMMARY="$OUT/summary.txt"
: > "$SUMMARY"
say() { echo "$*" | tee -a "$SUMMARY"; }

build() {  # name, extra flags... (link flags last)
  local name="$1"; shift
  mkdir -p "$(dirname "$OUT/$name")"
  if ! "$CXX" "${COMMON[@]}" "$@" -o "$OUT/$name" > "$OUT/$name.build.log" 2>&1; then
    say "BUILD FAILED  $name  (log: $OUT/$name.build.log)"; sed -n 1,40p "$OUT/$name.build.log"
    FAILS=$((FAILS + 1)); return 1
  fi
}

run() {  # <binary> <scenario> [timeout] -> RC, LOG
  LOG="$OUT/$1.$2.log"
  TSAN_OPTIONS="halt_on_error=1 exitcode=66 ${TSAN_OPTIONS:-}" \
  ASAN_OPTIONS="halt_on_error=1 detect_leaks=0 ${ASAN_OPTIONS:-}" \
    perl -e 'my $t = shift; my $pid = fork(); die "fork: $!" unless defined $pid;
             if ($pid == 0) { exec @ARGV or exit 127 }
             $SIG{ALRM} = sub { kill "KILL", $pid }; alarm $t;
             waitpid($pid, 0); my $s = $?;
             exit(($s & 127) ? 128 + ($s & 127) : $s >> 8);' \
      "${3:-$RUN_TIMEOUT_S}" "$OUT/$1" "$2" "$OUT" > "$LOG" 2>&1
  RC=$?
}

sanitizer_report() {
  grep -m1 -E 'WARNING: ThreadSanitizer|ERROR: AddressSanitizer|ERROR: ThreadSanitizer' "$LOG" || true
}

expect_green() {  # binary scenario
  run "$1" "$2"
  local rep; rep="$(sanitizer_report)"
  if [[ $RC -eq 0 && -z "$rep" ]] && grep -q '^GREEN' "$LOG"; then
    say "PASS  $1 $2$(grep -m1 'MEASURE.*last owner' "$LOG" | sed 's/^ *\[MEASURE\][^:]*:/  —/')"
  else
    say "FAIL  $1 $2  rc=$RC ${rep:+[$rep]}  (log: $LOG)"
    grep -E 'FAIL|SUMMARY|Sanitizer' "$LOG" | head -12
    FAILS=$((FAILS + 1))
  fi
}

expect_caught() {  # binary scenario [timeout]: must end in a sanitizer report
  local on="${CAUGHT_ON:-the borrow API}"
  run "$1" "$2" "${3:-}"
  local rep; rep="$(sanitizer_report)"
  if [[ $RC -ne 0 && -n "$rep" ]]; then
    say "PASS  $1 $2  caught on $on as required (rc=$RC, $rep)"
  else
    say "FAIL  $1 $2  $on was NOT caught (rc=$RC) — the gate is blind  (log: $LOG)"
    FAILS=$((FAILS + 1))
  fi
}

BORROW=(borrow-solid borrow-mesh borrow-shape)
LEASE=(lease-solid lease-mesh lease-shape lease-refusal lease-stress)

say "== native_access_lease_gate  (kernel: $LIB; old seam: $OLD_REF)"

# ---- new seam, instrumented ---------------------------------------------------
for san in thread address; do
  name="new-${san:0:1}san"
  # shellcheck disable=SC2046
  if build "$name" -fsanitize="$san" -I"$KDIR/include" "$SRC" "${REGISTRY[@]}" \
       "$KDIR/src/NativeShapeAccess.cpp" $(link_flags "$KB"); then
    for s in "${BORROW[@]}"; do expect_caught "$name" "$s"; done
    for s in "${LEASE[@]}"; do expect_green "$name" "$s"; done
  fi
done

# ---- old seam: the failing-first proof ------------------------------------------
for san in thread address; do
  name="old-${san:0:1}san"
  # shellcheck disable=SC2046
  if build "$name" -fsanitize="$san" -DGATE_OLD_API -I"$OLD/include" -I"$KDIR/include" "$SRC" \
       "${REGISTRY[@]}" "$OLD/src/NativeShapeAccess.cpp" $(link_flags "$KB"); then
    for s in "${BORROW[@]}"; do CAUGHT_ON="the pre-T-261 seam" expect_caught "$name" "$s"; done
  fi
done
# (b) the lease scenarios against the old header: they must NOT compile, and for
# the right reason (the lease API is absent), not some unrelated error.
if "$CXX" "${COMMON[@]}" -fsyntax-only -I"$OLD/include" -I"$KDIR/include" "$SRC" \
     > "$OUT/old-lease-syntax.log" 2>&1; then
  say "FAIL  old seam: the lease scenarios COMPILED against $OLD_REF — the gate no longer tells the APIs apart"
  FAILS=$((FAILS + 1))
elif grep -qE "no (member|function).*'nativeSolidLease'|use of undeclared identifier 'nativeSolidLease'|no member named 'nativeSolidLease'" "$OUT/old-lease-syntax.log"; then
  say "PASS  old seam: the lease scenarios do not compile there ($(grep -m1 -E "nativeSolidLease|NativeShapeLease" "$OUT/old-lease-syntax.log" | sed 's/^.*error: //'))"
else
  say "FAIL  old seam: the lease scenarios failed to compile for an UNRELATED reason (log: $OUT/old-lease-syntax.log)"
  sed -n 1,20p "$OUT/old-lease-syntax.log"; FAILS=$((FAILS + 1))
fi

# ---- the real kernel library ------------------------------------------------------
# shellcheck disable=SC2046
if build integ -DGATE_INTEGRATION -I"$KDIR/include" "$SRC" $(link_flags "$KB"); then
  for s in integ-massprops integ-stl; do expect_green integ "$s"; done
fi
if [[ -n "$OLD_KB" ]]; then
  OLDLIB="$(libin "$OLD_KB")"
  if [[ -z "$OLDLIB" ]]; then
    say "FAIL  OLD_KERNEL_BUILD '$OLD_KB' holds no libforge_kernel_core"; FAILS=$((FAILS + 1))
  elif nm -gU "$OLDLIB" 2>/dev/null | grep -q nativeSolidLease; then
    say "FAIL  OLD_KERNEL_BUILD '$OLD_KB' already exports nativeSolidLease: it is not a pre-T-261 library"
    FAILS=$((FAILS + 1))
  # shellcheck disable=SC2046
  elif build integ-old -DGATE_INTEGRATION -I"$KDIR/include" "$SRC" $(link_flags "$OLD_KB"); then
    for s in integ-massprops integ-stl; do
      run integ-old "$s"
      if [[ $RC -ne 0 ]]; then
        say "PASS  integ-old $s  RED on the pre-T-261 library as required (rc=$RC; $(grep -m1 'MEASURE.*last owner' "$LOG" | sed 's/^ *\[MEASURE\][^:]*: //'))"
      else
        say "FAIL  integ-old $s  GREEN on the pre-T-261 library — the call-site check cannot see a borrow  (log: $LOG)"
        FAILS=$((FAILS + 1))
      fi
    done
  fi
else
  say "SKIP  integ-old: OLD_KERNEL_BUILD unset (needs a second, pre-T-261 kernel build)"
fi

# ---- call sites ---------------------------------------------------------------------
# A CALL is the name followed by '(' on a line that is not a // comment line,
# excluding the seam's own definitions in src/NativeShapeAccess.cpp.
SITES="$OUT/borrow_call_sites.txt"
( cd "$REPO" && grep -rnE '\b(nativeSolidOf|nativeMeshOf|nativeShapeOf)\(' \
      forge-kernel/src forge-desktop/src --include='*.cpp' --include='*.hpp' --include='*.h' \
    | grep -vE '^[^:]+:[0-9]+:[[:space:]]*//' \
    | grep -v '^forge-kernel/src/NativeShapeAccess.cpp:' ) > "$SITES" || true
bad=0; allowed=0
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  file="${line%%:*}"; ok=""
  for a in "${ALLOWED_BORROWS[@]}"; do [[ "$file" == "${a%%|*}" ]] && ok="${a#*|}"; done
  if [[ -n "$ok" ]]; then
    say "NOTE  borrow call site kept, allowed: $line  — $ok"; allowed=$((allowed + 1))
  else
    say "FAIL  borrow call site: $line  — read through nativeSolidLease/nativeMeshLease/nativeShapeLease"
    bad=$((bad + 1))
  fi
done < "$SITES"
if [[ $bad -eq 0 ]]; then
  say "PASS  call sites: 0 unallowed borrow reads in forge-kernel/src + forge-desktop/src ($allowed allowed, listed above)"
else
  FAILS=$((FAILS + bad))
fi

# ---- negative controls (--mutations) ----------------------------------------------
MUT_NAME=(); MUT_SCEN=(); MUT_FROM=(); MUT_TO=()
mutant() { MUT_NAME+=("$1"); MUT_SCEN+=("$2"); MUT_FROM+=("$3"); MUT_TO+=("$4"); }
# the leases dressed as the old borrow: right pointer, no shared ownership
mutant solid-lease-borrowed lease-solid \
  'return reg.getNativeSolid(h);' \
  'return NativeLease<native::brep::Solid>(std::shared_ptr<const native::brep::Solid>(std::shared_ptr<const native::brep::Solid>(), reg.getNativeSolid(h).get()));'
mutant mesh-lease-borrowed lease-mesh \
  'return reg.getNativeMesh(h);' \
  'return NativeLease<native::mesh::HalfEdgeMesh>(std::shared_ptr<const native::mesh::HalfEdgeMesh>(std::shared_ptr<const native::mesh::HalfEdgeMesh>(), reg.getNativeMesh(h).get()));'
mutant shape-lease-unpinned lease-shape \
  'return NativeShapeLease(nativeSolidLease(h));' \
  'return NativeShapeLease(NativeLease<native::brep::Solid>(std::shared_ptr<const native::brep::Solid>(std::shared_ptr<const native::brep::Solid>(), nativeSolidLease(h).get())));'
# the never-throw refusal: an unknown/released handle must not raise
mutant solid-lease-throws lease-refusal \
  'return reg.getNativeSolid(h);
  } catch (...) {' \
  'return reg.getNativeSolid(h);
  } catch (const std::bad_alloc&) {'

apply_mutant() {  # <src> <dst> <anchor> <replacement>: literal, exactly once
  FROM="$3" TO="$4" perl -0777 -ne '
    my ($f, $t) = ($ENV{FROM}, $ENV{TO});
    my $n = () = /\Q$f\E/g;
    if ($n != 1) { print STDERR "anchor found $n times\n"; exit 1 }
    s/\Q$f\E/$t/; print;' "$1" > "$2"
}

if [[ "${1:-}" == "--mutations" ]]; then
  MDIR="$OUT/mutants"; rm -rf "$MDIR"; mkdir -p "$MDIR"
  killed=0; total=0
  for i in "${!MUT_NAME[@]}"; do
    m="${MUT_NAME[$i]}"; scen="${MUT_SCEN[$i]}"
    if ! apply_mutant "$KDIR/src/NativeShapeAccess.cpp" "$MDIR/$m.cpp" "${MUT_FROM[$i]}" "${MUT_TO[$i]}" 2> "$MDIR/$m.apply.log"; then
      say "FAIL  mutant $m: stale anchor ($(cat "$MDIR/$m.apply.log")) — it cannot prove anything"
      FAILS=$((FAILS + 1)); continue
    fi
    for san in thread address; do
      name="mutants/$m.${san:0:1}san"; total=$((total + 1))
      # shellcheck disable=SC2046
      if build "$name" -fsanitize="$san" -I"$KDIR/include" "$SRC" "${REGISTRY[@]}" "$MDIR/$m.cpp" \
           $(link_flags "$KB"); then
        run "$name" "$scen" 120
        rep="$(sanitizer_report)"
        if [[ $RC -ne 0 ]]; then
          killed=$((killed + 1))
          say "PASS  mutant $m ($san): $scen RED (rc=$RC${rep:+, $rep}$(grep -m1 '\[FAIL\]' "$LOG" | sed 's/^ */, /'))"
        else
          say "FAIL  mutant $m ($san): $scen stayed GREEN — the gate cannot see it  (log: $LOG)"
          FAILS=$((FAILS + 1))
        fi
      fi
    done
  done
  say "mutants killed: $killed / $total"
fi

if [[ $FAILS -eq 0 ]]; then
  say "VERDICT: PASSED"; exit 0
fi
say "VERDICT: FAILED ($FAILS)"; exit 1
