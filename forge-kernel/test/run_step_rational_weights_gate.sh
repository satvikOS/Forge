#!/usr/bin/env bash
# run_step_rational_weights_gate.sh — T-158. Build + run step_rational_weights_gate,
# then PROVE it can fail by reverting each fix it pins.
#
#   [0/8] the fixes under test are PRESENT in the source (refuse otherwise)
#   [1/8] build forge_kernel_core + link the gate against the REAL library
#   [2/8] clean run: must exit 0
#   [3/8] mutation M1 — revert the RATIONAL fix (weights dropped again):
#         the gate must go RED, and the independent reader must see 1.590990
#   [4/8] mutation M2 — revert the EDGE fix (Edge::curve ignored again):
#         the gate must go RED on the written-arc check
#   [5/8] mutation M3 — disable the B-spline SIDE TEST (a trimmed foreign
#         B-spline face read back as its whole (u,v) rectangle): must go RED
#   [6/8] mutation M4 — drop the BOX CLAMP from the side test (a point of the
#         iso-line v = v0 OUTSIDE [u0,u1] counts as on side v0 again, so a face
#         straddling a closed surface's seam reads as its complement): must go RED
#   [7/8] mutation M5 — drop the SEAM rule (a seam vertex's u taken at face value,
#         so the 270->360 deg wall face of a split B-spline cylinder gets the box
#         u[0,0.75]): must go RED
#   [8/8] rebuild clean, prove the object was recompiled, re-run green
#
# Exit 0 iff the gate built, passed clean, AND every mutation turned it red.
# The source is rewritten IN PLACE during [3/8]..[7/8] and restored by a trap;
# do not edit StepAnalytic.cpp while this runs. Native toolchain + POSIX shell
# tools only (clang++, cmake, awk, grep, sed) — no interpreter is needed.
# Env: STEP_RATIONAL_BUILD (build dir), JOBS, OCCT_ROOT, STEP_RATIONAL_EVIDENCE
# (an existing directory that receives each mutant's full gate transcript).
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL/.." || exit 2
CXX="${CXX:-clang++}"

OCCT="${OCCT_ROOT:-}"
if [ -z "$OCCT" ]; then
  for c in /opt/homebrew/opt/opencascade /usr/local/opt/opencascade /usr; do
    [ -e "$c/include/opencascade/Standard_Version.hxx" ] && { OCCT="$c"; break; }
  done
fi
[ -n "$OCCT" ] || { echo "[step-rational] FATAL: OCCT not found (set OCCT_ROOT)" >&2; exit 2; }

SRC=forge-kernel/src/native/brep/StepAnalytic.cpp
BUILD="${STEP_RATIONAL_BUILD:-forge-kernel/build-rational}"
# Private scratch: never a fixed /tmp name another worktree's run could clobber.
TMP="$(mktemp -d "${TMPDIR:-/tmp}/step_rational.XXXXXX")"
GATE="$TMP/step_rational_weights_gate"
ORIG="$TMP/StepAnalytic.cpp.orig"

echo "[0/8] the fixes under test are PRESENT in the source"
for marker in T158-RATIONAL-SURFACE T158-EDGE-OWN-CURVE T158-NURBS-TRIM-GUARD T158-NURBS-BOX-CLAMP T158-NURBS-SEAM; do
  if ! grep -q "$marker" "$SRC"; then
    echo "[step-rational] FATAL: $SRC has no '$marker' — the fix was reverted or moved." >&2
    echo "[step-rational] Refusing to report success over code that is not there." >&2
    rm -rf "$TMP"; exit 2
  fi
done
echo "      ok"

# Deleting the object is what forces the rebuild: a source and library that share
# an mtime to the second read as "up to date" to cmake (see the long account in
# run_step_unit_decline_gate.sh — the same race bit that gate three times).
invalidate_obj() {
  find "$BUILD" -name 'StepAnalytic.cpp.o' -delete 2>/dev/null || true
}

build_lib() {
  if [ ! -f "$BUILD/CMakeCache.txt" ]; then
    cmake -S forge-kernel -B "$BUILD" -DCMAKE_BUILD_TYPE=Release \
          -DFORGE_BUILD_NODE_ADDON=OFF -DFORGE_BUILD_DESKTOP_FOUNDATION=OFF \
          > "$TMP/cfg.log" 2>&1 || { echo "[step-rational] configure failed:" >&2; tail -25 "$TMP/cfg.log" >&2; return 1; }
  fi
  cmake --build "$BUILD" -j"${JOBS:-3}" --target forge_kernel_core > "$TMP/build.log" 2>&1 \
    || { echo "[step-rational] library build failed:" >&2; tail -25 "$TMP/build.log" >&2; return 1; }
}

link_gate() {
  # Link the REAL library (no -undefined dynamic_lookup: the gate calls into it).
  "$CXX" -std=c++20 -O1 -Wall -Wextra -Werror -DFORGE_NATIVE_BREP=1 \
    -Iforge-kernel/include -I"$OCCT/include/opencascade" \
    forge-kernel/test/step_rational_weights_gate.cpp -o "$GATE" \
    -L "$BUILD" -lforge_kernel_core -Wl,-rpath,"$BUILD" \
    -L "$OCCT/lib" -Wl,-rpath,"$OCCT/lib" 2> "$TMP/link.log" \
    || { echo "[step-rational] link failed:" >&2; tail -25 "$TMP/link.log" >&2; return 1; }
}

# literal_replace FILE OLD NEW — replace the single occurrence of the literal
# (single-line) text OLD by NEW. Returns 3, leaving FILE untouched, unless OLD
# occurs EXACTLY once. ENVIRON (not awk -v) so no escape is ever reinterpreted.
literal_replace() {
  local f="$1" out="$TMP/mutant.cpp"
  OLD="$2" NEW="$3" awk '
    BEGIN { old = ENVIRON["OLD"]; new = ENVIRON["NEW"]; n = 0 }
    {
      line = $0; acc = ""
      while ((i = index(line, old)) > 0) {
        acc = acc substr(line, 1, i - 1) new
        line = substr(line, i + length(old)); n++
      }
      print acc line
    }
    END { if (n != 1) exit 3 }' "$f" > "$out" || return 3
  cat "$out" > "$f"
}

echo "[1/8] build"
invalidate_obj
touch "$SRC"
build_lib || { rm -rf "$TMP"; exit 2; }
link_gate || { rm -rf "$TMP"; exit 2; }

echo "[2/8] run (clean tree)"
OUT=$("$GATE" 2>&1); rc=$?
echo "$OUT" | sed 's/^/      /'
if [ "$rc" -ne 0 ]; then echo "[step-rational] RED — the clean run failed (exit $rc)."; rm -rf "$TMP"; exit 1; fi
echo "      clean exit $rc"

cp "$SRC" "$ORIG"
restore() {
  [ -f "$ORIG" ] && cp "$ORIG" "$SRC"
  invalidate_obj
  touch "$SRC"
  build_lib >/dev/null 2>&1 || true
}
trap 'restore; rm -rf "$TMP"' EXIT

# run_mutant <marker> <old> <new> — apply to a fresh copy of the clean source,
# rebuild, run; echo the gate's exit code. 2 = the mutant did not build
# (INCONCLUSIVE, never counted as caught).
run_mutant() {
  local marker="$1" old="$2" new="$3"
  cp "$ORIG" "$SRC"
  if ! literal_replace "$SRC" "$old" "$new"; then echo "MUTATION-NOT-APPLIED"; return; fi
  if grep -q "$marker" "$SRC"; then echo "MUTATION-NOT-APPLIED"; return; fi
  invalidate_obj
  touch "$SRC"
  if build_lib && link_gate; then
    "$GATE" > "$TMP/mutant.out" 2>&1; local mrc=$?
    # Keep each mutant's full transcript when an evidence directory is given.
    [ -n "${STEP_RATIONAL_EVIDENCE:-}" ] && cp "$TMP/mutant.out" "$STEP_RATIONAL_EVIDENCE/mutant_${marker}.txt"
    echo "$mrc"
  else
    echo 2
  fi
}

check_caught() {  # $1 label, $2 exit code
  if [ "$2" = "MUTATION-NOT-APPLIED" ]; then
    echo "      ★ $1 did not apply (source shape changed) — reporting BROKEN, not green"; exit 1
  elif [ "$2" -eq 2 ]; then
    echo "      ★ $1 INCONCLUSIVE — the mutant did not build, so the gate never ran."; exit 1
  elif [ "$2" -eq 0 ]; then
    echo "      ★ $1 stayed GREEN — the gate does not test the defect"; exit 1
  fi
  echo "      $1 caught (exit $2)"
}

echo "[3/8] mutation M1 — revert the rational fix; the blend must read back wrong"
M1_RC=$(run_mutant T158-RATIONAL-SURFACE \
  "                if (w != 1.0) rational = true;   // T158-RATIONAL-SURFACE" \
  "                // M1: weights dropped again (T158-MUTANT)")
check_caught M1 "$M1_RC"
grep -E "independent reader\] blend radius|checks," "$TMP/mutant.out" | head -4 | sed 's/^/      M1> /'

echo "[4/8] mutation M2 — revert the edge fix; the written arc must be caught"
M2_RC=$(run_mutant T158-EDGE-OWN-CURVE \
  "curveId = emitEdgeOwnCurve(E, *e, sameSense);   // T158-EDGE-OWN-CURVE" \
  "curveId = 0; (void)&emitEdgeOwnCurve;   // M2: Edge::curve ignored again (T158-MUTANT)")
check_caught M2 "$M2_RC"
grep -E "WRITTEN arc edges|checks," "$TMP/mutant.out" | head -3 | sed 's/^/      M2> /'

echo "[5/8] mutation M3 — disable the B-spline side test; a trimmed face must be caught"
M3_RC=$(run_mutant T158-NURBS-TRIM-GUARD \
  "            return false;   // T158-NURBS-TRIM-GUARD" \
  "            continue;   // M3: side test disabled, every sample passes (T158-MUTANT)")
check_caught M3 "$M3_RC"
grep -E "TRIMMED patch|faces 0/90/180/270 \(seam vertices\): read|checks," "$TMP/mutant.out" | head -3 | sed 's/^/      M3> /'

echo "[6/8] mutation M4 — drop the box clamp; a face straddling the seam must be caught"
M4_RC=$(run_mutant T158-NURBS-BOX-CLAMP \
  "        const double cu = std::clamp(s.u, u0, u1), cv = std::clamp(s.v, v0, v1);   // T158-NURBS-BOX-CLAMP" \
  "        const double cu = s.u, cv = s.v;   // M4: box clamp removed (T158-MUTANT)")
check_caught M4 "$M4_RC"
grep -E "straddles the seam\): read|checks," "$TMP/mutant.out" | head -3 | sed 's/^/      M4> /'

echo "[7/8] mutation M5 — drop the seam rule; the wall face ending at the seam must be caught"
M5_RC=$(run_mutant T158-NURBS-SEAM \
  "        const bool su = closedU && nurbsCoincide(n.evaluate(ua, s.v), s.p), sv = closedV && nurbsCoincide(n.evaluate(s.u, va), s.p);   // T158-NURBS-SEAM" \
  "        const bool su = false, sv = false; (void)closedU; (void)closedV;   // M5: seam vertices taken at face value (T158-MUTANT)")
check_caught M5 "$M5_RC"
grep -E "faces 0/90/180/270 \(seam vertices\): read|checks," "$TMP/mutant.out" | head -3 | sed 's/^/      M5> /'

echo "[8/8] rebuild clean and re-run (the mutations must leave no residue)"
restore
trap 'rm -rf "$TMP"' EXIT
if ! find "$BUILD" -name 'StepAnalytic.cpp.o' | grep -q .; then
  echo "[step-rational] RED — StepAnalytic.cpp.o did not come back after restore();"
  echo "        whatever runs next would describe a STALE object, not this tree."
  exit 1
fi
if grep -q "T158-MUTANT" "$SRC"; then echo "[step-rational] RED — the source still carries a mutant."; exit 1; fi
link_gate || exit 2
OUT2=$("$GATE" 2>&1); rc2=$?
if [ "$rc2" -ne 0 ]; then
  echo "[step-rational] RED — the tree did not come back clean:"; echo "$OUT2" | sed 's/^/      /'; exit 1
fi
echo "      clean exit $rc2 ; M1 exit $M1_RC ; M2 exit $M2_RC ; M3 exit $M3_RC ; M4 exit $M4_RC ; M5 exit $M5_RC"
echo "[step-rational] GREEN — clean run passes and all five mutations were caught."
