#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_import_conic_prism_gate.sh — T-247.
#
# Builds test/import_conic_prism_gate.cpp against an EXISTING kernel build
# (libforge_kernel_core, configured from this tree) and runs it, then proves the
# gate can fail: each mutant of src/OcctImport.cpp (the code under test, never
# the test) must turn it RED, ON ITS OWN ROW.
#
#   M1  the fix skipped: a conic basis goes back through curveToBSpline, whose
#       parameter is not the conic's angle. readExtrusionSurface's round-trip
#       self-check (8341ad68) must FIRE and decline the import -> row "ok".
#       This is acceptance A3: the check stays, and is seen to work.
#   M2  the self-check blind to the arc law (samples native(u) at OCCT's u):
#       it must fire on a CORRECT surface -> row "ok". Proves the check reads the
#       new conic layout, not only the old one.
#   M3  the solid importer ignores the arc law (identity map for the conic
#       extrusion) -> row "vtxuv" (boundary vertices off the surface at their
#       own (u,v)).
#   M4  uniform native columns on the full-rectangle grid (the canonical border
#       points binned onto columns they do not lie on) -> row "vtxuv".
#   M5  nSeg = ceil(sweep / 90 deg) (3 on the 4.4 rad arc): a knot falls INSIDE
#       a grid cell and one Gauss rule spans the kink -> row "vol".
#   M6  the property bridge handed the tensor surface (no composite routing):
#       OCCT's (u,v) answered at the arc parameter -> row "bridge".
#   M7  c75af519's behaviour: the fix skipped AND the self-check removed, so the
#       reparameterised surface imports ok=1 -> row "vtxuv". Proves the gate
#       itself sees the silent wrong geometry, independent of the self-check.
#
# ★ NOBUILD IS NEVER A KILL: a mutant that fails to compile is a FAILURE OF THIS
#   SCRIPT. ★ The patch is proven to have landed (the mutant source differs from
#   the stock source) and every mutant links a FRESH binary at a fresh path.
# ★ The tree is never written: each mutant is a copy in a temp dir. The mutant
#   OcctImport object is linked INTO the gate executable, whose own definitions of
#   importOcctSolid / importOcctFaceSurface take precedence over the dylib's for
#   the gate's calls (that is the code under test; the rest of the kernel stays
#   the shipped dylib).
#
# usage: KERNEL_BUILD=<build dir> (or BUILD=) bash forge-kernel/test/run_import_conic_prism_gate.sh [--no-mutations]
# exit 0 iff the stock gate is green AND every mutant is red on its own row.
# Native C++ only: no node, no addon.
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
[ -e "$OCCT/include/opencascade/Standard_Version.hxx" ] || { echo "FATAL: OCCT not found at $OCCT"; exit 2; }
CXX="${CXX:-clang++}"
OCCT_LIBS="-lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKPrim -lTKG3d -lTKG2d -lTKGeomBase -lTKGeomAlgo"
GATE_FLAGS="-std=gnu++20 -O2 -Wall -Werror -DFORGE_NATIVE_BREP=1 -DFORGE_NATIVE_LAW=1 \
  -DFORGE_NATIVE_NURBS_CONVERT=1 -DFORGE_NATIVE_PROJECTION=1 -I$K/include -isystem $OCCT/include/opencascade"
# The code under test is compiled EXACTLY as the core compiles it.
CORE_DEFS="$(sed -n 's/^CXX_DEFINES = //p' "$FLAGS_MAKE")"
CORE_INCS="$(sed -n 's/^CXX_INCLUDES = //p' "$FLAGS_MAKE")"
CORE_FLAGS="$(sed -n 's/^CXX_FLAGS = //p' "$FLAGS_MAKE")"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/conic_prism_gate.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
export DYLD_LIBRARY_PATH="$KB:$OCCT/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
export LD_LIBRARY_PATH="$KB:$OCCT/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

echo "[conic-prism] compiling the gate"
if ! $CXX $GATE_FLAGS -c "$K/test/import_conic_prism_gate.cpp" -o "$TMP/gate.o" 2>"$TMP/gate.err"; then
  cat "$TMP/gate.err"; echo "[conic-prism] FAIL: gate does not compile"; exit 1
fi
link() { # link <out> [extra objects...]
  local out="$1"; shift
  $CXX "$TMP/gate.o" "$@" -o "$out" -L"$KB" -lforge_kernel_core -L"$OCCT/lib" $OCCT_LIBS \
       -Wl,-rpath,"$KB" -Wl,-rpath,"$OCCT/lib"
}
link "$TMP/gate_stock" || { echo "[conic-prism] FAIL: stock link"; exit 1; }
echo "[conic-prism] stock run"
"$TMP/gate_stock" | tee "$TMP/stock.txt"
STOCK_RC=${PIPESTATUS[0]}
if [ "$STOCK_RC" -ne 0 ]; then echo "[conic-prism] FAIL: stock gate RED (rc $STOCK_RC)"; exit 1; fi
[ "$DO_MUT" -eq 1 ] || { echo "[conic-prism] stock GREEN (mutations skipped)"; exit 0; }

SRC="$K/src/OcctImport.cpp"
# mutant <id> <expected-row> <python replacement program reading/writing $1>
FAILS=0
mutant() {
  local id="$1" row="$2" prog="$3"
  local d="$TMP/$id"; mkdir -p "$d"
  cp "$SRC" "$d/OcctImport.cpp"
  if ! python3 - "$d/OcctImport.cpp" <<<"$prog" 2>"$d/patch.err"; then
    echo "  [$id] SCRIPT FAIL: patch did not apply: $(tail -1 "$d/patch.err")"; FAILS=$((FAILS+1)); return
  fi
  if cmp -s "$SRC" "$d/OcctImport.cpp"; then
    echo "  [$id] SCRIPT FAIL: patch landed nothing"; FAILS=$((FAILS+1)); return
  fi
  # shellcheck disable=SC2086
  if ! $CXX $CORE_DEFS $CORE_INCS $CORE_FLAGS -w -c "$d/OcctImport.cpp" -o "$d/OcctImport.o" 2>"$d/build.err"; then
    echo "  [$id] SCRIPT FAIL: NOBUILD (never a kill)"; tail -5 "$d/build.err"; FAILS=$((FAILS+1)); return
  fi
  if ! link "$d/gate" "$d/OcctImport.o" 2>"$d/link.err"; then
    echo "  [$id] SCRIPT FAIL: link"; tail -5 "$d/link.err"; FAILS=$((FAILS+1)); return
  fi
  "$d/gate" > "$d/out.txt" 2>&1; local rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "  [$id] SURVIVED (gate GREEN on the mutant)"; FAILS=$((FAILS+1)); return
  fi
  if grep -qE "^[[:space:]]+\[FAIL\] .{28} $row " "$d/out.txt"; then
    echo "  [$id] KILLED on its own row '$row': $(grep -E "^[[:space:]]+\[FAIL\] .{28} $row " "$d/out.txt" | head -1 | sed 's/^ *//' | cut -c1-150)"
  else
    echo "  [$id] SCRIPT FAIL: red, but not on row '$row':"; grep FAIL "$d/out.txt" | head -3; FAILS=$((FAILS+1))
  fi
}

R='import sys; p=sys.argv[1]; s=open(p).read()'
W='open(p,"w").write(s)'
echo "[conic-prism] mutants of src/OcctImport.cpp"
mutant M1 ok "$R
a='const bool isConic = readGeomCurve(basis, conic, conicWhy) &&'
assert s.count(a)==1; s=s.replace(a,'const bool isConic = false && readGeomCurve(basis, conic, conicWhy) &&'); $W"
mutant M2 ok "$R
a='const double un = isConic ? revAngleToParam(uu - u0, delta, nSeg) : uu;'
assert s.count(a)==1; s=s.replace(a,'const double un = uu; (void)delta;'); $W"
mutant M3 vtxuv "$R
a='if (fs.revolution || fs.conicExtrusion) {'
assert s.count(a)==1; s=s.replace(a,'if (fs.revolution) {'); $W"
mutant M4 vtxuv "$R
a='''                    if (fs.conicExtrusion) {
                        double un, vn;'''
assert s.count(a)==1; s=s.replace(a,'''                    if (false) {
                        double un, vn;'''); $W"
mutant M5 vol "$R
a='nSeg = sweep <= 0.5 * kPi + 1e-9 ? 1 : (sweep <= kPi + 1e-9 ? 2 : 4);'
assert s.count(a)==1; s=s.replace(a,'nSeg = (int)std::ceil(sweep / (0.5 * kPi) - 1e-9);'); $W"
mutant M6 bridge "$R
a='if (readOk && fs.conicExtrusion) return extrudedFaceSurface(face);'
assert s.count(a)==1; s=s.replace(a,''); $W"
mutant M7 vtxuv "$R
a='const bool isConic = readGeomCurve(basis, conic, conicWhy) &&'
assert s.count(a)==1; s=s.replace(a,'const bool isConic = false && readGeomCurve(basis, conic, conicWhy) &&')
b='''                if (dst > 1e-6 * std::max(1.0, scale)) {
                    why = \"extrusion native/OCCT round-trip mismatch'''
assert s.count(b)==1; s=s.replace(b,'''                if (false && dst > 1e-6 * std::max(1.0, scale)) {
                    why = \"extrusion native/OCCT round-trip mismatch'''); $W"

if [ "$FAILS" -ne 0 ]; then echo "[conic-prism] FAIL: $FAILS mutant(s) not killed on their own row"; exit 1; fi
echo "[conic-prism] PASS: stock GREEN, 7/7 mutants RED on their own rows"
exit 0
