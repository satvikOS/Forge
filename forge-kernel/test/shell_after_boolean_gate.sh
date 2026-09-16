#!/usr/bin/env bash
# shell_after_boolean_gate.sh -- SHELL must never hollow NOTHING and report success.
#
# THE DEFECT THIS GATE EXISTS FOR (measured 2026-09-16 on SHA 02de2e15, the shipped
# kernel, with that tree's own build/forge_verify):
#
#     %1 = BOX(125, 26, 48)              -> SHELL(%1, 8)  removes 43600 mm^3  (112400)
#     %4 = FUSE(BOX(125,26,48), rib)     -> SHELL(%4, 8)  removes        0    (156000)
#                                           ok:true, no error, no warning.
#
# That second line is the holdout row h39_rib. It was ACCEPTED by the bridge, it
# compiled, and it returned the UN-RIBBED, UN-HOLLOWED web with a success verdict.
# It is the T-137 failure class -- an operation that does nothing and reports that
# it worked -- and it is the one thing that must not survive here.
#
# WHY IT HAPPENED, traced to the call (scratchpad/shell_probe2.cpp, OCCT 7.9.3):
#   A FUSE splits a planar face into coplanar pieces and nothing merges them back --
#   BOX(125,26,48) fused with a rib comes back as TEN faces for a solid that is still
#   a six-faced box. FeatureTreeCompiler::opShell then opens ONE of the two coplanar
#   bottom pieces, and BRepOffsetAPI_MakeThickSolid cannot offset a wall that is
#   coplanar-adjacent to the opening. It does not say so. Both verdicts OCCT
#   publishes read clean:
#       IsDone()             = TRUE
#       MakeOffset().Error() = BRepOffset_NoError
#       Shape()              = a REBUILT copy of the input (IsSame() is FALSE, so a
#                              pointer-identity check cannot see it either)
#   The ONLY observable that moves is the volume, which is why this gate measures it.
#
# THE TWO HALVES ARE EQUALLY LOAD-BEARING:
#   NO-OP    -- was ok:true with the input volume before the fix. Must now EITHER
#               hollow correctly to the closed form, OR refuse with a message that
#               names forge.part.shell. A silent pass-through is RED either way.
#               "It refused" is accepted here on purpose: a named refusal is a
#               correct answer, a silent wrong part is not.
#   UNCHANGED-- shells that already worked, asserted on a VECTOR of observables
#               (valid, volume, face count) against a CLOSED FORM, not against
#               numbers copied off a passing run. box_60x40x30 is the fixture
#               forge-desktop/ui_ir_probe.cpp already asserts (22428 mm^3);
#               fuse_stacked is an EXISTING fuse-then-shell that was correct before
#               the fix and must stay correct.
#
# WHAT THIS GATE DOES NOT COVER, stated rather than implied. It drives the IR
# compiler (FeatureTreeCompiler::opShell), so it sees the opShell route only. A
# caller that reaches forge::part::shell() directly with its own face list -- the
# desktop registry command, forge_feature_probe -- does not pass through opShell's
# coplanar merge, and for those the refusal in Features.cpp requireHollowed is the
# whole protection. It also does not cover shells that produce the WRONG non-zero
# volume: this gate can only tell a hollow from no hollow at all.
#
# Exit codes
#   0  GREEN -- no silent no-op survived, every unchanged case still exact.
#   1  RED   -- a no-op passed silently, or a working shell moved.
#   3  RED   -- could not build or could not parse a result. An unparseable result
#               is not a pass; refusing to guess.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BUILD="${FORGE_KERNEL_BUILD_DIR:-$ROOT/build-verify}"
VERIFY="$BUILD/forge_verify"

if [ ! -x "$VERIFY" ]; then
  echo "[shell-noop] building forge_verify into $BUILD"
  cmake -S "$ROOT" -B "$BUILD" -DCMAKE_BUILD_TYPE=Release \
        -DFORGE_BUILD_NODE_ADDON=OFF -DFORGE_BUILD_DESKTOP_FOUNDATION=ON >/dev/null 2>&1
  cmake --build "$BUILD" -j"${JOBS:-3}" --target forge_verify >/dev/null 2>&1
fi
if [ ! -x "$VERIFY" ]; then
  echo "[shell-noop] no forge_verify at $VERIFY -- cannot run. RED."
  exit 3
fi

fails=0

# ---------------------------------------------------------------- NO-OP arm
# noop_case <name> <ir> <inputVolume>
# RED if the result is ok AND still measures the input volume. GREEN on a real
# hollow (volume strictly down) or on a refusal naming forge.part.shell.
noop_case() {
  local name="$1" ir="$2" vin="$3" out rc
  out="$(printf '{"id":"%s","ir":"%s"}\n' "$name" "$ir" | "$VERIFY" 2>/dev/null)"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "[shell-noop] RED NOOP/$name: forge_verify exited $rc (>=128 means a signal killed it)"
    fails=$((fails + 1)); return
  fi
  [ -z "$out" ] && { echo "[shell-noop] RED NOOP/$name: no output -- refusing to guess"; fails=$((fails+1)); return; }
  local verdict
  verdict="$(printf '%s' "$out" | awk -v vin="$vin" -v nm="$name" '
    {
      ok="?"; vol="";
      if (match($0, /"ok":(true|false)/)) { ok = substr($0, RSTART+5, RLENGTH-5) }
      if (match($0, /"volume":-?[0-9.]+/)) { vol = substr($0, RSTART+9, RLENGTH-9) }
      if (ok=="?") { print "UNPARSEABLE"; exit }
      if (ok=="false") {
        if (index($0, "forge.part.shell") > 0) { print "REFUSED"; exit }
        print "REFUSED_UNNAMED"; exit
      }
      if (vol=="") { print "UNPARSEABLE"; exit }
      d = vol - vin; if (d < 0) d = -d;
      if (d <= 0.01) { print "NOOP:" vol; exit }
      print "HOLLOWED:" vol;
    }')"
  case "$verdict" in
    HOLLOWED:*) printf '[shell-noop] ok  NOOP      %-18s hollowed: %s -> %s\n' "$name" "$vin" "${verdict#HOLLOWED:}" ;;
    REFUSED)    printf '[shell-noop] ok  NOOP      %-18s refused, and the refusal names forge.part.shell\n' "$name" ;;
    REFUSED_UNNAMED)
      echo "[shell-noop] RED NOOP/$name: it failed, but the message does not name forge.part.shell --"
      echo "             a failure that does not say what it was is not the deliverable."
      printf '             %s\n' "$out"
      fails=$((fails + 1)) ;;
    NOOP:*)
      echo "[shell-noop] RED NOOP/$name: SILENT NO-OP. ok:true and the part still measures ${verdict#NOOP:} mm^3,"
      echo "             the same solid that went in ($vin). The shell was never cut and nothing said so."
      fails=$((fails + 1)) ;;
    *)  echo "[shell-noop] RED NOOP/$name: unparseable result -- refusing to guess"; fails=$((fails + 1)) ;;
  esac
}

# ------------------------------------------------------------ UNCHANGED arm
# keep_case <name> <ir> <valid> <volume> <faces>
keep_case() {
  local name="$1" ir="$2" xv="$3" xvol="$4" xf="$5" out rc
  out="$(printf '{"id":"%s","ir":"%s"}\n' "$name" "$ir" | "$VERIFY" 2>/dev/null)"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "[shell-noop] RED KEEP/$name: forge_verify exited $rc"
    fails=$((fails + 1)); return
  fi
  local got
  got="$(printf '%s' "$out" | awk -v xv="$xv" -v xvol="$xvol" -v xf="$xf" '
    {
      v="?"; vol="?"; f="?";
      if (match($0, /"valid":(true|false)/)) { v   = substr($0, RSTART+8,  RLENGTH-8) }
      if (match($0, /"volume":-?[0-9.]+/))   { vol = substr($0, RSTART+9,  RLENGTH-9) }
      if (match($0, /"faceCount":[0-9]+/))   { f   = substr($0, RSTART+12, RLENGTH-12) }
      if (v=="?" || vol=="?" || f=="?") { print "UNPARSEABLE"; exit }
      bad="";
      if (v != xv) bad = bad " valid=" v "(want " xv ")";
      d = vol - xvol; if (d < 0) d = -d;
      if (d > 0.01) bad = bad " volume=" vol "(want " xvol ")";
      if (f+0 != xf+0) bad = bad " faces=" f "(want " xf ")";
      print (bad=="" ? "OK" : "MISMATCH:" bad);
    }')"
  case "$got" in
    OK) printf '[shell-noop] ok  UNCHANGED %-18s valid=%s vol=%s faces=%s\n' "$name" "$xv" "$xvol" "$xf" ;;
    UNPARSEABLE)
      echo "[shell-noop] RED KEEP/$name: no parseable observables -- refusing to guess"
      printf '             %s\n' "$out"
      fails=$((fails + 1)) ;;
    *) echo "[shell-noop] RED KEEP/$name:${got#MISMATCH:}"; fails=$((fails + 1)) ;;
  esac
}

# ---- NO-OP arm: every one of these returned ok:true with dV == 0 before the fix --
# h39_rib, the shipped holdout row, cut down to the SHELL that no-ops. The rib
# (125 x 8 x 48 at y 5..13) lies inside the web, so the FUSE is geometrically the
# web and arithmetically 156000 -- which is exactly why a no-op is invisible in the
# volume alone unless you know what the shell was supposed to remove.
H39_FUSE='%1 = BOX(125, 26, 48)\n%2 = BOX(125, 8, 48)\n%3 = TRANSLATE(%2, 0, 9, 0)\n%4 = FUSE(%1, %3)'
noop_case h39_rib_shell "$H39_FUSE\\n%5 = SHELL(%4, 8)\\nRESULT(%5)" 156000

# The whole h39_rib emission as the model wrote it, SHELL included. Before the fix
# this measured 156000 -- BOX(125,26,48) alone, the un-ribbed web -- and was scored
# as an accepted plan.
noop_case h39_rib_full \
  "$H39_FUSE\\n%5 = SHELL(%4, 8)\\n%6 = BOX(125, 26, 4)\\n%7 = TRANSLATE(%6, 0, 0, 20)\\n%8 = FUSE(%5, %7)\\nRESULT(%8)" \
  156000

# The rib PROTRUDING instead of buried: a genuine T (here flush, so a 125x34x48
# bar), 204000 mm^3, and the same coplanar-split bottom face. Also a no-op before.
noop_case tee_protruding \
  '%1 = BOX(125, 26, 48)\n%2 = BOX(125, 8, 48)\n%3 = TRANSLATE(%2, 0, 17, 0)\n%4 = FUSE(%1, %3)\n%5 = SHELL(%4, 8)\nRESULT(%5)' \
  204000

# NO BOOLEAN AT ALL. A 15 mm wall in a 20 mm cube: the cavity would be -10 mm on two
# axes, so there is nothing to cut. The shipped kernel returned ok:true and the
# UNTOUCHED 8000 mm^3 cube. This case is in the NO-OP arm and not the UNCHANGED arm
# because a refusal is the only correct answer available -- it proves the guard is
# not a boolean-shaped special case but a post-condition on the op's own contract.
noop_case wall_thicker_than_part \
  '%1 = BOX(20, 20, 20)\n%2 = SHELL(%1, 15)\nRESULT(%2)' 8000

# ---- UNCHANGED arm: closed forms, from fixtures that already existed -------------
# box_60x40x30 is forge-desktop/ui_ir_probe.cpp's shell fixture verbatim:
#   72000 - 54*34*27 = 22428, opening the -Z face; 5 outer + 5 inner + 1 rim = 11.
keep_case box_60x40x30 \
  '%1 = BOX(60, 40, 30)\n%2 = SHELL(%1, 3)\nRESULT(%2)' true 22428 11
# The h39 web as a PRIMITIVE -- the control that proves the same call works when no
# boolean has split the face: 156000 - 109*10*40 = 112400.
keep_case box_125x26x48 \
  '%1 = BOX(125, 26, 48)\n%2 = SHELL(%1, 8)\nRESULT(%2)' true 112400 11
# A curved wall, so the gate is not a planar-only claim: CYL(r=20,h=40) shelled 2 mm
# open at -Z = pi*20^2*40 - pi*18^2*38 = 11586.1937 mm^3.
keep_case cyl_r20_h40 \
  '%1 = CYL(20, 40)\n%2 = SHELL(%1, 2)\nRESULT(%2)' true 11586.1937 5
# AN EXISTING FUSE-THEN-SHELL THAT ALREADY WORKED. Two 24 mm boxes stacked into the
# same 125x26x48 bar: the boolean splits the SIDE faces, not the face being opened,
# so the join always managed this one. Same closed form as the primitive, 112400.
# Its FACE COUNT moved 19 -> 11 with this change, because opShell now merges the
# coplanar strips before shelling. That is the merge doing its job on a body that
# did not need rescuing, it is the identical solid, and it is recorded here rather
# than left for someone to discover.
keep_case fuse_stacked \
  '%1 = BOX(125, 26, 24)\n%2 = BOX(125, 26, 24)\n%3 = TRANSLATE(%2, 0, 0, 24)\n%4 = FUSE(%1, %3)\n%5 = SHELL(%4, 8)\nRESULT(%5)' \
  true 112400 11

if [ "$fails" -ne 0 ]; then
  echo "[shell-noop] $fails case(s) RED."
  exit 1
fi
echo "[shell-noop] GREEN -- 4 no-ops closed, 4 working shells unchanged."
exit 0
