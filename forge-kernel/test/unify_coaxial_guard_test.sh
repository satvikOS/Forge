#!/usr/bin/env bash
# unify_coaxial_guard_test.sh -- the mixed-representation coaxial bore must not SIGSEGV,
# and every shape that already unified must be left EXACTLY as it was.
#
# WHAT IS BEING GUARDED (measured 2026-08-29, and present in the pinned baseline binary
# every published score is measured with). ShapeUpgrade_UnifySameDomain::IntUnifyFaces
# dereferences a NULL Geom2d_Curve and takes the process down when a body carries two
# coaxial, EQUAL-RADIUS, seam-carrying cylindrical walls STORED DIFFERENTLY: one an
# analytic Geom_CylindricalSurface (what HOLE builds) and one a
# Geom_SurfaceOfLinearExtrusion of a circle (what CIRCLE+EXTRUDE+CUT leaves).
#
# THE TWO HALVES OF THIS GATE ARE EQUALLY LOAD-BEARING:
#   CRASHERS  -- were rc=139 before the guard; must now return a VALID solid, asserted on
#                a VECTOR of observables (validity, volume, face AND edge count, shells).
#                Volume alone is not accepted as proof of geometry in this programme.
#   UNTOUCHED -- must be byte-for-byte what they were. near_smaller/near_bigger sit 0.005
#                either side of the radius coincidence and must keep their DISTINCT face
#                counts (10 and 8), so a guard that fired on a tolerance band instead of
#                on exact coincidence goes red here.
#
# WHAT THIS GATE DOES NOT COVER, measured rather than assumed. Widening the guard to fire
# on radius coincidence ALONE -- dropping the analytic-vs-extrusion requirement -- leaves
# this gate GREEN, including on hole_then_cut, which carries exactly that coaxial
# equal-radius pair with BOTH walls analytic. The reason is that OCCT does not merge that
# pair either: it comes out at 9 faces whether unification runs or not. On none of these
# small shapes does ShapeUpgrade_UnifySameDomain measurably reduce anything, so skipping
# it costs nothing HERE and no assertion over them can detect an over-wide guard.
#
# THE MIXED-REPRESENTATION TEST IS NOT COSMETIC, and this file cannot show it. Measured
# over real emissions with DYLD_LIBRARY_PATH selecting three separately built dylibs
# (no-guard / this guard / over-wide guard), with ho1139 as the positive control that
# proves the arms really differ:
#     this guard vs no-guard :   0 of 150 rows differ   (and it rescues ho1139 from SIGSEGV)
#     this guard vs over-wide:  39 of 150 rows differ   (26% of parts stop unifying)
# So widening the guard silently disables same-domain unification on a quarter of real
# parts. If you change the guard's conditions, that corpus run is what has to be repeated
# -- this gate will not notice.
#
# Exit codes
#   0  GREEN -- every crasher recovered with the expected solid, every untouched case unchanged.
#   1  RED   -- a crasher still crashed, recovered the WRONG solid, or an untouched case moved.
#   3  RED   -- could not build or could not parse a result. Refusing to guess: an
#               unparseable result is not a pass.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BUILD="${FORGE_KERNEL_BUILD_DIR:-$ROOT/build-verify}"
VERIFY="$BUILD/forge_verify"

if [ ! -x "$VERIFY" ]; then
  echo "[unify-guard] building forge_verify into $BUILD"
  cmake -S "$ROOT" -B "$BUILD" -DCMAKE_BUILD_TYPE=Release \
        -DFORGE_BUILD_NODE_ADDON=OFF -DFORGE_BUILD_DESKTOP_FOUNDATION=ON >/dev/null 2>&1
  cmake --build "$BUILD" -j"${JOBS:-3}" --target forge_verify >/dev/null 2>&1
fi
if [ ! -x "$VERIFY" ]; then
  echo "[unify-guard] no forge_verify at $VERIFY -- cannot run. RED."
  exit 3
fi

PLATE='%1 = POLY([0 0; 113.35 0; 113.35 44.95; 0 44.95])\n%2 = EXTRUDE(%1, 79.386)'
# A CUT wall (extrusion-of-circle) at x=50 of radius $1, then a HOLE of diameter $2.
pair_ir() {
  printf '%s\\n%%3 = CIRCLE(%s, 50, 0, %s)\\n%%4 = EXTRUDE(%%3, 13.301)\\n%%5 = TRANSLATE(%%4, 0, 0, -6.65)\\n%%6 = CUT(%%2, %%5)\\n%%7 = HOLE(%%6, %s, 50, 0, 0)\\n%%900 = VERIFY(%%7)\\nRESULT(%%900)' \
    "$PLATE" "$1" "$1" "$2"
}

fails=0
# run <name> <class> <ir> <valid> <volume> <faces> <edges> <shells>
run_case() {
  local name="$1" cls="$2" ir="$3" xvalid="$4" xvol="$5" xf="$6" xe="$7" xs="$8"
  local out rc
  out="$(printf '{"id":"%s","ir":"%s"}\n' "$name" "$ir" | "$VERIFY" 2>/dev/null)"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    # rc >= 128 (or negative) is a CRASH, not a refusal.
    echo "[unify-guard] RED $cls/$name: forge_verify exited $rc (>=128 means it was killed by a signal)"
    fails=$((fails + 1)); return
  fi
  if [ -z "$out" ]; then
    echo "[unify-guard] RED $cls/$name: no output to parse -- refusing to guess"
    fails=$((fails + 1)); return
  fi
  local got
  got="$(printf '%s' "$out" | awk -v xv="$xvalid" -v xvol="$xvol" -v xf="$xf" -v xe="$xe" -v xs="$xs" '
    {
      v="?"; vol="?"; f="?"; e="?"; s="?";
      if (match($0, /"valid":(true|false)/))      { v   = substr($0, RSTART+8, RLENGTH-8) }
      if (match($0, /"volume":-?[0-9.]+/))        { vol = substr($0, RSTART+9, RLENGTH-9) }
      if (match($0, /"faceCount":[0-9]+/))        { f   = substr($0, RSTART+12, RLENGTH-12) }
      if (match($0, /"edgeCount":[0-9]+/))        { e   = substr($0, RSTART+12, RLENGTH-12) }
      if (match($0, /"shellCount":[0-9]+/))       { s   = substr($0, RSTART+13, RLENGTH-13) }
      if (v=="?" || vol=="?" || f=="?" || e=="?" || s=="?") { print "UNPARSEABLE"; exit }
      bad = "";
      if (v   != xv) bad = bad " valid=" v "(want " xv ")";
      d = vol - xvol; if (d < 0) d = -d;
      if (d > 0.01)  bad = bad " volume=" vol "(want " xvol ")";
      if (f+0 != xf+0) bad = bad " faces=" f "(want " xf ")";
      if (e+0 != xe+0) bad = bad " edges=" e "(want " xe ")";
      if (s+0 != xs+0) bad = bad " shells=" s "(want " xs ")";
      print (bad == "" ? "OK" : "MISMATCH:" bad);
    }')"
  case "$got" in
    OK) printf '[unify-guard] ok  %-9s %-18s valid=%s vol=%s faces=%s edges=%s shells=%s\n' \
          "$cls" "$name" "$xvalid" "$xvol" "$xf" "$xe" "$xs" ;;
    UNPARSEABLE)
      echo "[unify-guard] RED $cls/$name: result had no parseable observables -- refusing to guess"
      fails=$((fails + 1)) ;;
    *) echo "[unify-guard] RED $cls/$name:${got#MISMATCH:}"; fails=$((fails + 1)) ;;
  esac
}

# ---- CRASHERS: rc=139 before the guard, at three different radii ----------------
# The expected volumes are the CLOSED FORM (plate 113.35*44.95*79.386 minus a bore of
# pi*r^2 over half the plate height), not numbers copied off a passing run: all three
# agree with it to under 0.002 mm^3. A guard that returned a non-crashing but WRONG
# solid would still be red here.
run_case crash_r4.495 CRASHER "$(pair_ir 4.495 8.99)" true 401958.6697  9 21 1
run_case crash_r5.0   CRASHER "$(pair_ir 5.0   10.0)" true 401360.7386  9 21 1
run_case crash_r3.0   CRASHER "$(pair_ir 3.0    6.0)" true 403355.9259  9 21 1

# ---- UNTOUCHED: these already unified and must not move -------------------------
# 0.005 either side of the coincidence -- distinct face counts, and both must survive.
run_case near_smaller UNTOUCHED "$(pair_ir 4.495 8.98)" true 401963.8023 10 24 1
run_case near_bigger  UNTOUCHED "$(pair_ir 4.495 9.00)" true 401953.0598  8 18 1
run_case much_bigger  UNTOUCHED "$(pair_ir 4.495 20.0)" true 392008.2956  8 18 1
run_case cut_only     UNTOUCHED \
  "$PLATE\\n%3 = CIRCLE(4.495, 50, 0, 4.495)\\n%4 = EXTRUDE(%3, 13.301)\\n%5 = TRANSLATE(%4, 0, 0, -6.65)\\n%6 = CUT(%2, %5)\\n%900 = VERIFY(%6)\\nRESULT(%900)" \
  true 404267.1301 8 18 1
run_case hole_only    UNTOUCHED \
  "$PLATE\\n%3 = HOLE(%2, 8.99, 50, 0, 0)\\n%900 = VERIFY(%3)\\nRESULT(%900)" \
  true 401958.6681 8 18 1
# THE NARROWNESS CASE. Same coaxial equal-radius pair as crash_r4.495, but HOLE first so
# BOTH walls end up analytic -- OCCT handles this one, and the guard must not touch it.
run_case hole_then_cut UNTOUCHED \
  "$PLATE\\n%3 = HOLE(%2, 8.99, 50, 0, 0)\\n%4 = CIRCLE(4.495, 50, 0, 4.495)\\n%5 = EXTRUDE(%4, 13.301)\\n%6 = TRANSLATE(%5, 0, 0, -6.65)\\n%7 = CUT(%3, %6)\\n%900 = VERIFY(%7)\\nRESULT(%900)" \
  true 401958.6681 9 21 1

if [ "$fails" -ne 0 ]; then
  echo "[unify-guard] $fails case(s) RED."
  exit 1
fi
echo "[unify-guard] GREEN -- 3 crashers recovered, 6 untouched cases unchanged."
exit 0
