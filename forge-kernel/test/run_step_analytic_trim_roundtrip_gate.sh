#!/usr/bin/env bash
# run_step_analytic_trim_roundtrip_gate.sh — T-270. Build + run
# step_analytic_trim_roundtrip_gate, then PROVE it can fail by reverting each
# fix it pins.
#
#   [0/10] the fixes under test are PRESENT in the source (refuse otherwise)
#   [1/10] build forge_kernel_core + link the gate against the REAL library
#   [2/10] clean run: must exit 0 (and, with STEP_TRIM_CORPUS=<list>, the corpus
#          tally must have zero round trips WRONG in volume)
#   [3/10] M1 — remove the curved-face trim guard (every curved face read as its
#          vertex box again, the defect as measured at ed241f37): must go RED
#   [4/10] M2 — keep the guard but discard the region it builds (the face falls
#          back to its box): must go RED
#   [5/10] M3 — skip the (u,v)-straightness test (an edge curved in (u,v), the
#          oblique cut's ellipse, read through its vertex polygon): must go RED
#   [6/10] M4 — annotate a disk face WITH holes as a disk again: must go RED
#   [7/10] M5 — seed the sector sweep at angle 0 again (a cap sector whose loop
#          starts at its centre widened to start at 0): must go RED
#   [8/10] M6 — ignore the AP214 SURFACE_CURVE wrapper on edges: must go RED
#   [9/10] M7 — ignore it on disk-cap circles: must go RED
#   [10/10] rebuild clean, prove the object was recompiled, re-run green
#
# Exit 0 iff the gate built, passed clean, AND every mutation turned it red.
# The source is rewritten IN PLACE during the mutations and restored by a trap;
# do not edit StepAnalytic.cpp while this runs. Native toolchain + POSIX shell
# tools only (clang++, cmake, awk, grep, sed).
# Env: STEP_TRIM_BUILD (build dir), JOBS, STEP_TRIM_EVIDENCE (an existing
# directory that receives every transcript), STEP_TRIM_CORPUS (a file listing
# STEP paths for the --corpus tally of the clean run).
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL/.." || exit 2
CXX="${CXX:-clang++}"

OCCT="${OCCT_ROOT:-}"
if [ -z "$OCCT" ]; then
  for c in /opt/homebrew/opt/opencascade /usr/local/opt/opencascade /usr; do
    [ -e "$c/lib" ] && [ -e "$c/include/opencascade/Standard_Version.hxx" ] && { OCCT="$c"; break; }
  done
fi
# The gate itself includes no OCCT header; libforge_kernel_core still links the
# OCCT runtime it already depends on, so the gate needs its lib dir to load.
[ -n "$OCCT" ] || { echo "[step-trim] FATAL: OCCT runtime not found (set OCCT_ROOT)" >&2; exit 2; }

SRC=forge-kernel/src/native/brep/StepAnalytic.cpp
BUILD="${STEP_TRIM_BUILD:-forge-kernel/build-trim}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/step_trim.XXXXXX")"
GATE="$TMP/step_analytic_trim_roundtrip_gate"
ORIG="$TMP/StepAnalytic.cpp.orig"
EVID="${STEP_TRIM_EVIDENCE:-}"

echo "[0/10] the fixes under test are PRESENT in the source"
for marker in T270-QUADRIC-TRIM-GUARD T270-QUADRIC-ON-SURFACE T270-QUADRIC-UV-STRAIGHT T270-QUADRIC-RECT \
              T270-QUADRIC-REGION T270-QUADRIC-WINDING T270-DISK-HOLES T270-SECTOR-SWEEP \
              T270-EDGE-SURFACE-CURVE T270-DISK-SURFACE-CURVE; do
  if [ "$(grep -c -- "$marker" "$SRC")" != 1 ]; then
    echo "[step-trim] FATAL: $SRC does not carry '$marker' exactly once — the fix was reverted or moved." >&2
    echo "[step-trim] Refusing to report success over code that is not there." >&2
    rm -rf "$TMP"; exit 2
  fi
done
echo "      ok"

invalidate_obj() { find "$BUILD" -name 'StepAnalytic.cpp.o' -delete 2>/dev/null || true; }

build_lib() {
  if [ ! -f "$BUILD/CMakeCache.txt" ]; then
    cmake -S forge-kernel -B "$BUILD" -DCMAKE_BUILD_TYPE=Release \
          -DFORGE_BUILD_NODE_ADDON=OFF -DFORGE_BUILD_DESKTOP_FOUNDATION=OFF \
          > "$TMP/cfg.log" 2>&1 || { echo "[step-trim] configure failed:" >&2; tail -25 "$TMP/cfg.log" >&2; return 1; }
  fi
  cmake --build "$BUILD" -j"${JOBS:-3}" --target forge_kernel_core > "$TMP/build.log" 2>&1 \
    || { echo "[step-trim] library build failed:" >&2; tail -25 "$TMP/build.log" >&2; return 1; }
}

link_gate() {
  "$CXX" -std=c++20 -O1 -Wall -Wextra -Werror -DFORGE_NATIVE_BREP=1 \
    -Iforge-kernel/include \
    forge-kernel/test/step_analytic_trim_roundtrip_gate.cpp -o "$GATE" \
    -L "$BUILD" -lforge_kernel_core -Wl,-rpath,"$BUILD" \
    -L "$OCCT/lib" -Wl,-rpath,"$OCCT/lib" 2> "$TMP/link.log" \
    || { echo "[step-trim] link failed:" >&2; tail -25 "$TMP/link.log" >&2; return 1; }
}

# literal_replace FILE OLD NEW — replace the single occurrence of the literal
# (single-line) text OLD by NEW; returns 3 (FILE untouched) unless OLD occurs
# EXACTLY once. ENVIRON (not awk -v) so no escape is ever reinterpreted.
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

echo "[1/10] build"
invalidate_obj
touch "$SRC"
build_lib || { rm -rf "$TMP"; exit 2; }
link_gate || { rm -rf "$TMP"; exit 2; }

echo "[2/10] run (clean tree)"
OUT=$("$GATE" 2>&1); rc=$?
echo "$OUT" | sed 's/^/      /'
[ -n "$EVID" ] && echo "$OUT" > "$EVID/gate_clean.txt"
if [ "$rc" -ne 0 ]; then echo "[step-trim] RED — the clean run failed (exit $rc)."; rm -rf "$TMP"; exit 1; fi
echo "      clean exit $rc"
if [ -n "${STEP_TRIM_CORPUS:-}" ]; then
  "$GATE" --corpus "$STEP_TRIM_CORPUS" > "$TMP/corpus.txt" 2>&1; crc=$?
  grep '^\[corpus\]' "$TMP/corpus.txt" | sed 's/^/      /'
  [ -n "$EVID" ] && cp "$TMP/corpus.txt" "$EVID/corpus_clean.txt"
  if [ "$crc" -ne 0 ]; then echo "[step-trim] RED — corpus round trips WRONG in volume (exit $crc)."; rm -rf "$TMP"; exit 1; fi
fi

cp "$SRC" "$ORIG"
restore() {
  [ -f "$ORIG" ] && cp "$ORIG" "$SRC"
  invalidate_obj
  touch "$SRC"
  build_lib >/dev/null 2>&1 || true
}
trap 'restore; rm -rf "$TMP"' EXIT

# run_mutant <marker> <old> <new> — mutate a fresh copy of the clean source,
# rebuild, run; echo the gate's exit code. 2 = the mutant did not build
# (INCONCLUSIVE, never counted as caught).
run_mutant() {
  local marker="$1" old="$2" new="$3"
  cp "$ORIG" "$SRC"
  if ! literal_replace "$SRC" "$old" "$new"; then echo "MUTATION-NOT-APPLIED"; return; fi
  if grep -q -- "$marker" "$SRC"; then echo "MUTATION-NOT-APPLIED"; return; fi
  invalidate_obj
  touch "$SRC"
  if build_lib && link_gate; then
    "$GATE" > "$TMP/mutant.out" 2>&1; local mrc=$?
    [ -n "$EVID" ] && cp "$TMP/mutant.out" "$EVID/mutant_${marker}.txt"
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
show() { grep -E "$1" "$TMP/mutant.out" | head -"${2:-3}" | cut -c1-240 | sed "s/^/      $3> /"; }

echo "[3/10] M1 — remove the curved-face trim guard"
M1=$(run_mutant T270-QUADRIC-TRIM-GUARD \
  "            if (!verifyQuadricTrim(f, *surf, tw))   // T270-QUADRIC-TRIM-GUARD" \
  "            if (false && !verifyQuadricTrim(f, *surf, tw))   // M1 guard removed (T270-MUTANT)")
check_caught M1 "$M1"; show "FAIL|checks," 4 M1

echo "[4/10] M2 — discard the region the guard builds"
M2=$(run_mutant T270-QUADRIC-REGION \
  "    f->regionUV = true;                     // T270-QUADRIC-REGION" \
  "    f->regionUV = false;   // M2 region discarded (T270-MUTANT)")
check_caught M2 "$M2"; show "FAIL|checks," 4 M2

echo "[5/10] M3 — skip the (u,v)-straightness test"
M3=$(run_mutant T270-QUADRIC-UV-STRAIGHT \
  "    if (!quadEdgesStraight(s, outer, tolP)) {   // T270-QUADRIC-UV-STRAIGHT" \
  "    if (false && !quadEdgesStraight(s, outer, tolP)) {   // M3 (T270-MUTANT)")
check_caught M3 "$M3"; show "FAIL|checks," 4 M3

echo "[6/10] M4 — a disk face with holes annotated as a disk again"
M4=$(run_mutant T270-DISK-HOLES \
  "                          f->innerLoops.empty();   // T270-DISK-HOLES" \
  "                          true;   // M4 holes ignored again (T270-MUTANT)")
check_caught M4 "$M4"; show "FAIL|checks," 4 M4

echo "[7/10] M5 — the sector sweep seeded at angle 0 again"
M5=$(run_mutant T270-SECTOR-SWEEP \
  "                        have = true; lo = hi = a;   // T270-SECTOR-SWEEP" \
  "                        have = true; lo = std::min(0.0, a); hi = std::max(0.0, a);   // M5 (T270-MUTANT)")
check_caught M5 "$M5"; show "FAIL|checks," 4 M5

echo "[8/10] M6 — the AP214 SURFACE_CURVE wrapper ignored on edges"
M6=$(run_mutant T270-EDGE-SURFACE-CURVE \
  '    if (cit->second.type == "SURFACE_CURVE" || cit->second.type == "SEAM_CURVE") {   // T270-EDGE-SURFACE-CURVE' \
  '    if (false) {   // M6 (T270-MUTANT)')
check_caught M6 "$M6"; show "FAIL|checks," 4 M6

echo "[9/10] M7 — the AP214 SURFACE_CURVE wrapper ignored on disk-cap circles"
M7=$(run_mutant T270-DISK-SURFACE-CURVE \
  '    if (cit != tab.end() && (cit->second.type == "SURFACE_CURVE" || cit->second.type == "SEAM_CURVE")) {   // T270-DISK-SURFACE-CURVE' \
  '    if (false) {   // M7 (T270-MUTANT)')
check_caught M7 "$M7"; show "FAIL|checks," 4 M7

echo "[10/10] rebuild clean and re-run (the mutations must leave no residue)"
restore
trap 'rm -rf "$TMP"' EXIT
if ! find "$BUILD" -name 'StepAnalytic.cpp.o' | grep -q .; then
  echo "[step-trim] RED — StepAnalytic.cpp.o did not come back after restore(); the next run"
  echo "        would describe a STALE object, not this tree."
  exit 1
fi
if grep -q "T270-MUTANT" "$SRC"; then echo "[step-trim] RED — the source still carries a mutant."; exit 1; fi
link_gate || exit 2
OUT2=$("$GATE" 2>&1); rc2=$?
if [ "$rc2" -ne 0 ]; then
  echo "[step-trim] RED — the tree did not come back clean:"; echo "$OUT2" | sed 's/^/      /'; exit 1
fi
echo "      clean exit $rc2 ; M1 exit $M1 ; M2 exit $M2 ; M3 exit $M3 ; M4 exit $M4 ; M5 exit $M5 ; M6 exit $M6 ; M7 exit $M7"
echo "[step-trim] GREEN — clean run passes and all seven mutations were caught."
