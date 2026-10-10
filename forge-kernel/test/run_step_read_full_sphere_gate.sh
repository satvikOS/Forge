#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_step_read_full_sphere_gate.sh — T-273.
#
# Builds test/step_read_full_sphere_gate.cpp against an EXISTING kernel build
# (libforge_kernel_core, configured from this tree), runs it, then proves the gate
# can fail: each mutant of src/native/brep/StepRead.cpp (the code under test,
# never the test) must turn it RED, ON ITS OWN ROW.
#
#   M1  the pole-aware region path switched off (the old sequential unwrap for
#       every ring) -> full sphere area/volume 0 again           -> row "area"
#   M2  the sphere orientation fix removed (reversed = !same_sense as for the
#       other quadrics) -> the capsule's sphere flux goes inward  -> row "vol"
#   M3  the full-band rule removed (a seam-only ring keeps its zero-width walk)
#       -> full sphere area 0                                     -> row "area"
#   M4  the pole ROW dropped (a run becomes ONE point, the exit) -> the upper
#       hemisphere's near-pole sliver is lost again               -> row "area"
#   M5  the closing run does not absorb the winding (it continues naturally
#       instead of returning to the start) -> hemispheres degenerate -> row "area"
#
# ★ NOBUILD IS NEVER A KILL. ★ The patch is proven to have landed (the mutant
#   differs from the stock source) and every mutant links a FRESH binary.
# ★ The tree is never written: mutants are copies in a temp dir. The mutant
#   StepRead object is linked INTO the gate executable, whose own definition of
#   readForeignStep takes precedence over the dylib's for the gate's calls.
#
# usage: KERNEL_BUILD=<build dir> (or BUILD=) bash forge-kernel/test/run_step_read_full_sphere_gate.sh [--no-mutations]
# exit 0 iff the stock gate is green AND every mutant is red on its own row.
# Native C++ only: no node, no addon; the gate itself includes no OCCT header.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
K="$ROOT/forge-kernel"
KB="${KERNEL_BUILD:-${BUILD:-}}"     # either spelling (CI uses BUILD=forge-kernel/build-verify)
[ -n "$KB" ] && [ -d "$KB" ] && KB="$(cd "$KB" && pwd)"
DO_MUT=1
[ "${1:-}" = "--no-mutations" ] && DO_MUT=0
if [ -z "$KB" ] || [ ! -f "$KB/libforge_kernel_core.dylib" -a ! -f "$KB/libforge_kernel_core.so" ]; then
  echo "FATAL: set KERNEL_BUILD to a build dir holding libforge_kernel_core (target forge_kernel_core)"; exit 2
fi
FLAGS_MAKE="$KB/CMakeFiles/forge_kernel_core.dir/flags.make"
[ -f "$FLAGS_MAKE" ] || { echo "FATAL: $FLAGS_MAKE missing (not a CMake build of forge_kernel_core)"; exit 2; }
OCCT="${OCCT_ROOT:-$(brew --prefix opencascade 2>/dev/null || echo /opt/homebrew/opt/opencascade)}"
CXX="${CXX:-clang++}"
GATE_FLAGS="-std=gnu++20 -O2 -Wall -Werror -DFORGE_NATIVE_BREP=1 -I$K/include"
CORE_DEFS="$(sed -n 's/^CXX_DEFINES = //p' "$FLAGS_MAKE")"
CORE_INCS="$(sed -n 's/^CXX_INCLUDES = //p' "$FLAGS_MAKE")"
CORE_FLAGS="$(sed -n 's/^CXX_FLAGS = //p' "$FLAGS_MAKE")"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/full_sphere_gate.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
export DYLD_LIBRARY_PATH="$KB:$OCCT/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
export LD_LIBRARY_PATH="$KB:$OCCT/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

echo "[full-sphere] compiling the gate"
# shellcheck disable=SC2086
if ! $CXX $GATE_FLAGS -c "$K/test/step_read_full_sphere_gate.cpp" -o "$TMP/gate.o" 2>"$TMP/gate.err"; then
  cat "$TMP/gate.err"; echo "[full-sphere] FAIL: gate does not compile"; exit 1
fi
link() { # link <out> [extra objects...]
  local out="$1"; shift
  $CXX "$TMP/gate.o" "$@" -o "$out" -L"$KB" -lforge_kernel_core -Wl,-rpath,"$KB" -Wl,-rpath,"$OCCT/lib"
}
link "$TMP/gate_stock" || { echo "[full-sphere] FAIL: stock link"; exit 1; }
echo "[full-sphere] stock run"
"$TMP/gate_stock" | tee "$TMP/stock.txt"
STOCK_RC=${PIPESTATUS[0]}
if [ "$STOCK_RC" -ne 0 ]; then echo "[full-sphere] FAIL: stock gate RED (rc $STOCK_RC)"; exit 1; fi
[ "$DO_MUT" -eq 1 ] || { echo "[full-sphere] stock GREEN (mutations skipped)"; exit 0; }

SRC="$K/src/native/brep/StepRead.cpp"
FAILS=0
mutant() {
  local id="$1" row="$2" prog="$3"
  local d="$TMP/$id"; mkdir -p "$d"
  cp "$SRC" "$d/StepRead.cpp"
  if ! python3 - "$d/StepRead.cpp" <<<"$prog" 2>"$d/patch.err"; then
    echo "  [$id] SCRIPT FAIL: patch did not apply: $(tail -1 "$d/patch.err")"; FAILS=$((FAILS+1)); return
  fi
  if cmp -s "$SRC" "$d/StepRead.cpp"; then
    echo "  [$id] SCRIPT FAIL: patch landed nothing"; FAILS=$((FAILS+1)); return
  fi
  # shellcheck disable=SC2086
  if ! $CXX $CORE_DEFS $CORE_INCS $CORE_FLAGS -w -c "$d/StepRead.cpp" -o "$d/StepRead.o" 2>"$d/build.err"; then
    echo "  [$id] SCRIPT FAIL: NOBUILD (never a kill)"; tail -5 "$d/build.err"; FAILS=$((FAILS+1)); return
  fi
  if ! link "$d/gate" "$d/StepRead.o" 2>"$d/link.err"; then
    echo "  [$id] SCRIPT FAIL: link"; tail -5 "$d/link.err"; FAILS=$((FAILS+1)); return
  fi
  "$d/gate" > "$d/out.txt" 2>&1; local rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "  [$id] SURVIVED (gate GREEN on the mutant)"; FAILS=$((FAILS+1)); return
  fi
  if grep -qE "^[[:space:]]+\[FAIL\] .{18} $row " "$d/out.txt"; then
    echo "  [$id] KILLED on its own row '$row': $(grep -E "^[[:space:]]+\[FAIL\] .{18} $row " "$d/out.txt" | head -1 | sed 's/^ *//' | cut -c1-140)"
  else
    echo "  [$id] SCRIPT FAIL: red, but not on row '$row':"; grep FAIL "$d/out.txt" | head -3; FAILS=$((FAILS+1))
  fi
}

R='import sys; p=sys.argv[1]; s=open(p).read()'
W='open(p,"w").write(s)'
echo "[full-sphere] mutants of src/native/brep/StepRead.cpp"
mutant M1 area "$R
a='if (buildPoleAwareRegion(pts, sf, thetaAnchor, poly)) return poly;'
assert s.count(a)==1; s=s.replace(a,'if (false && buildPoleAwareRegion(pts, sf, thetaAnchor, poly)) return poly;'); $W"
mutant M2 vol "$R
a='if (s.kind == SurfaceKind::Sphere) s.reversed = sameSense;'
assert s.count(a)==1; s=s.replace(a,''); $W"
mutant M3 area "$R
a='jump[0] = 2.0 * PI;'
assert s.count(a)==1; s=s.replace(a,'jump[0] = 0.0;'); $W"
mutant M4 area "$R
a='poly.push_back({uIn, runV[r]});'
assert s.count(a)==1; s=s.replace(a,'(void)uIn;'); $W"
mutant M5 area "$R
a='const double uOut = (j < seq.size()) ? seq[j][0] + shift : seq[0][0];'
assert s.count(a)==1; s=s.replace(a,'const double uOut = (j < seq.size()) ? seq[j][0] + shift : uIn;'); $W"

if [ "$FAILS" -ne 0 ]; then echo "[full-sphere] FAIL: $FAILS mutant(s) not killed on their own row"; exit 1; fi
echo "[full-sphere] PASS: stock GREEN, 5/5 mutants RED on their own rows"
exit 0
