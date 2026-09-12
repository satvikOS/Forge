#!/usr/bin/env bash
# ft_silent_noop_gate.sh — an op that DID NOTHING must not report SUCCESS.
#
# ── THE DEFECT THIS PINS ─────────────────────────────────────────────────────
# FIFTEEN ops in src/ft/FeatureTreeCompiler.cpp answered a request they had not
# carried out, and reported ok=true. Eight returned their own INPUT (THREAD,
# REPLACEFACE, DRAFT, OFFSETSOLID, SPLITBODY, SURFTRIM, SURFEXTEND, UNFOLD); two
# silently became a different op (RIB -> FUSE, POCKET -> CUT); and five read a
# keyword slot with kwOpt(), which returns its DEFAULT for any token that is not
# a Keyword, so the caller's selector, side or plane vanished (FILLET, CHAMFER,
# BLEND, THICKEN, SKETCH). The compiler recorded every one as compiled,
# `nCompiled` went up, `valid` was true, and the geometry handed back was not the
# geometry asked for. There is no observable anywhere downstream that separates
# that from a feature that really happened — which is why it survived.
#
# The count is DERIVED, not asserted: section 5 re-reads the dispatch table in
# FeatureTreeCompiler.cpp and fails if the number of refusing handlers moves. An
# earlier version of this header said "Eleven" while the commit subject said
# "twelve" and neither matched the file.
#
# MEASURED through forge_verify on the pre-fix kernel (every number below is a
# real line of its stdout, not an estimate):
#
#   READ THE ARGUMENTS AND THREW THEM AWAY
#     THREAD(%1,20,2.5,30) on CYL(10,40)   ok=true valid=true 12566.3706  3f  3e
#     THREAD(%1,6,1.0,5)   on CYL(10,40)   ok=true valid=true 12566.3706  3f  3e
#        M20x2.5 and M6x1.0 are the same answer, and that answer is the bare
#        input cylinder: opThread read three numbers with (void) casts.
#
#   SILENTLY DEGRADED TO A DIFFERENT OP
#     RIB(%1,%2,4)    on BOX(60,40,20)+BOX(60,4,30)   50400.0000  18f  36e
#     RIB(%1,%2,40)   same operands                    50400.0000  18f  36e
#     FUSE(%1,%2)     same operands                    50400.0000  18f  36e
#        thickness discarded; RIB *is* a plain FUSE, for every thickness.
#     POCKET(%1,%2,5)  on BOX(60,40,20)+BOX(20,20,40)  40000.0000  10f  24e
#     POCKET(%1,%2,50) same operands                   40000.0000  10f  24e
#     CUT(%1,%2)       same operands                   40000.0000  10f  24e
#        depth discarded; a 5 mm pocket in a 20 mm plate should leave 46000
#        mm^3. It left 40000 — a hole straight through the part — and passed.
#
#   THE KERNEL RAISED AND catch (...) ATE IT
#     DRAFT(%1,5,Z) / DRAFT(%1,20,Z) on BOX(60,40,20)  48000.0000  6f  12e
#        identical to the input box at every angle. The swallowed exception is
#        Standard_NoSuchObject — an OCCT raise, which is not a std::exception,
#        so it was invisible to every handler that looked for one.
#     OFFSETSOLID(%1,0) on BOX(60,40,20)               48000.0000  6f  12e
#        the swallowed message was "offsetSolid distance must be non-zero".
#
#   A KEYWORD SLOT SILENTLY TOOK ITS DEFAULT
#     FILLET(%1,1,"face:top")     on BOX(60,40,20)  47898.3304  26f  56e
#     FILLET(%1,1,ALL)            same body         47898.3304  26f  56e
#     FILLET(%1,1,ALL,"face:top") same body         47898.3304  26f  56e
#        identical to the last digit, and the same pair for CHAMFER and BLEND.
#        The third row is the one that matters: it was measured on the dylib that
#        shipped WITH THE FIRST FIX (11cf789d). The guard checked arg #2 and the
#        gate then asserted "a QUOTED selector is refused, never widened to ALL"
#        — an invariant that was false one argument to the right, certified by
#        the gate that stated it.
#     SPLITBODY(%1,%2,"NEGATIVE")  40000.0000  10f  24e   == POSITIVE
#     SPLITBODY(%1,%2,NEGATIVE)     8000.0000   6f  12e
#        kwOpt() returns its DEFAULT for any non-Keyword token, and that hole is
#        not selector-specific: SURFTRIM, THICKEN and SKETCH had it too, and
#        SKETCH("YZ") put the extruded part on the XY plane. Five times the
#        volume, and a part on the wrong plane, both ok=true.
#
# ── WHAT THIS GATE ASSERTS ───────────────────────────────────────────────────
#   1. each of those requests is now REFUSED, and refused for the RIGHT reason
#      (the message is checked, not just the exit) — "it went red" is not
#      evidence that the check you care about is awake;
#   2. nothing was traded away: the ops and selectors that DO work still build,
#      to the same numbers as before;
#   3. a source check for the swallow sites no input in this tree can reach.
#      SURFTRIM, SURFEXTEND, SPLITBODY and UNFOLD were fixed the same way, but
#      no IR fixture makes their kernel call raise, so execution cannot see
#      them. Saying so and checking the source is honest; pretending the
#      execution checks cover them would not be. The scanner PROVES ITSELF first
#      (section 4a) because its predecessor caught one defect in five;
#   4. the op count is read out of the dispatch table, not retyped — and read
#      out of CODE. Section 5 ran its message test over the ORIGINAL source, so
#      the count was partly reading PROSE: deleting opSketch's guard outright
#      left it at 15, because a COMMENT in skNew() contains "NOT APPLIED", and
#      adding one comment line to opScaleUniform that changes no behaviour made
#      it 16 and turned the gate red. Comments are blanked for that test now and
#      string literals are kept, which is what a refusal message actually is
#      (4 of the 15 are counted by their message alone);
#   5. the IR THE SHIPPED COMMANDS EMIT runs — BOTH the legal forms and the ones
#      the app can still emit that the kernel refuses. Documenting only the legal
#      selector domain (right in itself) had removed FILLET(%body, 2,
#      "bore:r=6") and FILLET(%body, 2, CONVEX) from this probe, so the only two
#      app emissions the refusals broke were the only two nothing ran;
#   6. the refusal a user is left looking at names the op and gives a NEXT STEP.
#      That requirement was stated here and not enforced: the test was the
#      substring " or ", and a pure diagnosis with no remedy passed 52/52 on it.
#      ft_next_step.py is an imperative-clause test that proves itself on
#      fixtures in both directions (section 6a) before any row is judged.
#
# 59 checks: 22 refusals asserted on their REASON, 12 working rows held to
# measured volume/face/edge triples, 3 source checks, 1 derived count, and 21
# app-path checks (1 next-step self-proof, 1 next-step scan over every refuse()
# call site, 14 documented command rows, 4 app-reachable-but-refused rows, and 1
# floor under that coverage). Revert any one
# fix and the checks that belong to it go red — proven eleven times, by doing
# it, not by asserting it.
set -uo pipefail
KROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
V="${FORGE_VERIFY_BIN:-$KROOT/build/forge_verify}"
SRC="$KROOT/src/ft/FeatureTreeCompiler.cpp"
PASS=0; FAIL=0

[ -x "$V" ] || { echo "  FAIL  forge_verify not executable at $V"; exit 1; }
[ -r "$SRC" ] || { echo "  FAIL  cannot read $SRC"; exit 1; }

# ask <ir>  ->  "<ok>|<volume>|<faceCount>|<edgeCount>|<error>"
ask() {
  printf '%s\n' "$(python3 -c '
import json,sys
sys.stdout.write(json.dumps({"id":"g","ir":sys.argv[1]}))' "$1")" \
    | "$V" 2>/dev/null | python3 -c '
import json,sys
line=[l for l in sys.stdin if l.strip()]
if not line:
    print("NOOUT|||"); raise SystemExit
d=json.loads(line[-1])
print("%s|%s|%s|%s|%s" % (d.get("ok"), d.get("volume"), d.get("faceCount"),
                          d.get("edgeCount"), (d.get("error") or "").replace("|","/")))'
}

fld() { printf '%s' "$1" | cut -d'|' -f"$2"; }

# refuses <label> <ir> <phrase-that-must-appear>
refuses() {
  local label="$1" ir="$2" want="$3" out ok err
  out="$(ask "$ir")"; ok="$(fld "$out" 1)"; err="$(fld "$out" 5)"
  if [ "$ok" != "False" ]; then
    echo "  FAIL  $label reported SUCCESS (ok=$ok, volume=$(fld "$out" 2), faces=$(fld "$out" 3))"
    echo "        That is the defect: a step recorded in the feature tree that did not happen."
    FAIL=$((FAIL+1)); return
  fi
  case "$err" in
    *"$want"*) echo "  PASS  $label refused: ${err:0:96}"; PASS=$((PASS+1)) ;;
    *) echo "  FAIL  $label was refused for the WRONG reason (wanted '$want')"
       echo "        got: ${err:0:140}"
       FAIL=$((FAIL+1)) ;;
  esac
}

# builds <label> <ir> <expected-volume> <expected-faces> <expected-edges>
#
# The volume is compared NUMERICALLY, not as a string: `48000` and `48000.0` are
# the same solid, and the first version of this gate reported five false FAILs
# saying "built, but MOVED: got 48000, want 48000.0". forge_verify's formatter is
# fixed at six decimals, so 1e-6 absolute is the sharpest an honest comparison
# can be here; the relative term carries that to the larger magnitudes.
builds() {
  local label="$1" ir="$2" wv="$3" wf="$4" we="$5" out gv
  out="$(ask "$ir")"
  if [ "$(fld "$out" 1)" != "True" ]; then
    echo "  FAIL  $label no longer builds: $(fld "$out" 5)"; FAIL=$((FAIL+1)); return
  fi
  gv="$(fld "$out" 2)"
  if python3 -c 'import sys
g,w=float(sys.argv[1]),float(sys.argv[2])
sys.exit(0 if abs(g-w) <= max(1e-6, 1e-9*abs(w)) else 1)' "$gv" "$wv" \
     && [ "$(fld "$out" 3)" = "$wf" ] && [ "$(fld "$out" 4)" = "$we" ]; then
    echo "  PASS  $label builds unchanged ($gv mm^3, ${wf}f, ${we}e)"; PASS=$((PASS+1))
  else
    echo "  FAIL  $label built, but MOVED: got $gv / $(fld "$out" 3)f / $(fld "$out" 4)e,"
    echo "        want $wv / ${wf}f / ${we}e"
    FAIL=$((FAIL+1))
  fi
}

echo "== 1. an op that cannot do its job REFUSES, by name =="
refuses "THREAD(dia,pitch,len)" \
  '%1 = CYL(10, 40, 0,0,0)
%2 = THREAD(%1, 20, 2.5, 30)
RESULT(%2)' \
  'THREAD: not implemented'

refuses "RIB(thickness)" \
  '%1 = BOX(60,40,20)
%2 = BOX(60,4,30)
%3 = RIB(%1, %2, 4)
RESULT(%3)' \
  'RIB: thickness 4.000000 is NOT APPLIED'

refuses "POCKET(depth)" \
  '%1 = BOX(60,40,20)
%2 = BOX(20,20,40)
%3 = POCKET(%1, %2, 5)
RESULT(%3)' \
  'POCKET: depth 5.000000 is NOT APPLIED'

refuses "DRAFT (kernel raises)" \
  '%1 = BOX(60,40,20)
%2 = DRAFT(%1, 5, Z)
RESULT(%2)' \
  'DRAFT: the kernel declined to draft'

refuses "OFFSETSOLID (kernel raises)" \
  '%1 = BOX(60,40,20)
%2 = OFFSETSOLID(%1, 0)
RESULT(%2)' \
  'OFFSETSOLID: the kernel declined to offset'

echo
echo "== 1b. ... and the swallowed exception is NAMED, both kinds of it =="
# An OCCT raise is not a std::exception. Before, DRAFT's catch(...) destroyed a
# Standard_NoSuchObject and OFFSETSOLID's destroyed a std::invalid_argument, and
# the two were indistinguishable from success. Both messages now survive.
refuses "DRAFT names the OCCT raise" \
  '%1 = BOX(60,40,20)
%2 = DRAFT(%1, 5, Z)
RESULT(%2)' \
  'kernel raised Standard_'
refuses "OFFSETSOLID names the std::exception" \
  '%1 = BOX(60,40,20)
%2 = OFFSETSOLID(%1, 0)
RESULT(%2)' \
  'distance must be non-zero'

echo
echo "== 2. a non-keyword in a KEYWORD SLOT is refused, never widened to the default =="
refuses "FILLET(%b, 1, \"face:top\")" \
  '%1 = BOX(60,40,20)
%2 = FILLET(%1, 1, "face:top")
RESULT(%2)' \
  'quoted selector "face:top" is NOT APPLIED'

refuses "CHAMFER(%b, 1, \"face:top\")" \
  '%1 = BOX(60,40,20)
%2 = CHAMFER(%1, 1, "face:top")
RESULT(%2)' \
  'quoted selector "face:top" is NOT APPLIED'

refuses "BLEND(%b, 1, 2, \"face:top\")" \
  '%1 = BOX(60,40,20)
%2 = BLEND(%1, 1, 2, "face:top")
RESULT(%2)' \
  'quoted selector "face:top" is NOT APPLIED'

# A STRING IS NOT THE ONLY THING kwOpt WIDENS. It returns its default for every
# non-Keyword token, so a bare number in the selector slot meant ALL too --
# MEASURED, FILLET(%1,1,7) gave 47898.330353 / 26f / 56e, the same solid as
# FILLET(%1,1,ALL). Found by measuring the slot rather than by reading the
# defect list, which named only the quoted form.
refuses "FILLET(%b, 1, 7) -- a NUMBER in the selector slot" \
  '%1 = BOX(60,40,20)
%2 = FILLET(%1, 1, 7)
RESULT(%2)' \
  'non-keyword token at arg #2 is NOT APPLIED'

# THE INVARIANT ABOVE WAS FALSE ONE ARGUMENT TO THE RIGHT. The first version of
# this gate said "a QUOTED selector is refused, never widened to ALL" and checked
# arg #2 only. MEASURED on the dylib that shipped with it (11cf789d):
#
#   FILLET(%1, 1, ALL, "face:top") -> ok=true 47898.330353, 26f/56e
#   FILLET(%1, 1, ALL)             -> ok=true 47898.330353, 26f/56e
#
# to the last digit. The fourth token was dropped and every edge was still
# rounded. A gate that STATES an invariant and enforces it on one arity only
# certifies the hole it leaves, so the adjacent input is now checked here.
refuses "FILLET(%b, 1, ALL, \"face:top\") -- the 4-ARG form" \
  '%1 = BOX(60,40,20)
%2 = FILLET(%1, 1, ALL, "face:top")
RESULT(%2)' \
  'quoted selector "face:top" is NOT APPLIED'

refuses "CHAMFER(%b, 1, ALL, \"face:top\") -- the 4-ARG form" \
  '%1 = BOX(60,40,20)
%2 = CHAMFER(%1, 1, ALL, "face:top")
RESULT(%2)' \
  'quoted selector "face:top" is NOT APPLIED'

refuses "BLEND(%b, 1, 2, ALL, \"face:top\") -- the 5-ARG form" \
  '%1 = BOX(60,40,20)
%2 = BLEND(%1, 1, 2, ALL, "face:top")
RESULT(%2)' \
  'quoted selector "face:top" is NOT APPLIED'

# An extra argument that IS a keyword is still an argument the op will not read.
refuses "FILLET(%b, 1, ALL, VERTICAL) -- a dropped 4th KEYWORD" \
  '%1 = BOX(60,40,20)
%2 = FILLET(%1, 1, ALL, VERTICAL)
RESULT(%2)' \
  'would be DISCARDED, not applied'

echo
echo "== 2c. the SAME defect in four more keyword slots in the same file =="
# kwOpt() is not selector-specific and neither is its hole. Two of these four
# are in handlers the selector fix itself edited. MEASURED on 11cf789d, the
# post-fix dylib, each pair one process apart:
#
#   SPLITBODY(%1,%2,NEGATIVE)    ->  8000.000000 mm^3,  6f/12e
#   SPLITBODY(%1,%2,"NEGATIVE")  -> 40000.000000 mm^3, 10f/24e  == POSITIVE
#   SURFTRIM(...,INSIDE)+THICKEN ->   400.000000 mm^3
#   SURFTRIM(...,"INSIDE")+THICK ->  5124.631241 mm^3           == OUTSIDE
#   THICKEN(%sheet,1,"IN")       ->  5524.631241 mm^3           == MID
#   SKETCH(YZ)  + rect + EXTRUDE -> bbox extent 10,40,25
#   SKETCH("YZ")+ rect + EXTRUDE -> bbox extent 40,25,10        == XY
#
# Five times the volume, and a part on the wrong plane, both reported ok=true.
refuses "SPLITBODY(%b, %t, \"NEGATIVE\") -- edited by this change, unrefused" \
  '%1 = BOX(60,40,20)
%2 = BOX(20,20,40)
%3 = SPLITBODY(%1, %2, "NEGATIVE")
RESULT(%3)' \
  'quoted side "NEGATIVE" is NOT APPLIED'

refuses "SPLITBODY(%b, %t, SIDEWAYS) -- a keyword the slot does not define" \
  '%1 = BOX(60,40,20)
%2 = BOX(20,20,40)
%3 = SPLITBODY(%1, %2, SIDEWAYS)
RESULT(%3)' \
  'is NOT ONE THIS OP DEFINES'

refuses "SURFTRIM(%s, %t, \"INSIDE\") -- edited by this change, unrefused" \
  '%1 = BOX(60,40,2)
%2 = UNFOLD(%1, 0.44)
%3 = BOX(20,20,20)
%4 = UNFOLD(%3, 0.44)
%5 = SURFTRIM(%2, %4, "INSIDE")
%6 = THICKEN(%5, 1)
RESULT(%6)' \
  'quoted side "INSIDE" is NOT APPLIED'

refuses "THICKEN(%s, 1, \"IN\") -- the side slot" \
  '%1 = BOX(60,40,2)
%2 = UNFOLD(%1, 0.44)
%3 = THICKEN(%2, 1, "IN")
RESULT(%3)' \
  'quoted side "IN" is NOT APPLIED'

# SKETCH is measured through its bbox EXTENT, not its volume: all three planes
# give 10000 mm^3, so volume cannot tell them apart. sketch_plane_gate.sh proves
# that separately; here it is the reason the check is written this way.
SK=$(python3 -c '
import json,subprocess,sys
ir = "%1 = SKETCH(\"YZ\")\n%2 = SPT(%1,0,0)\n%3 = SPT(%1,40,0)\n%4 = SPT(%1,40,25)\n%5 = SPT(%1,0,25)\n%6 = SLINE(%2,%3)\n%7 = SLINE(%3,%4)\n%8 = SLINE(%4,%5)\n%9 = SLINE(%5,%2)\n%10 = SOLVE(%1)\n%11 = EXTRUDE(%10,10)\nRESULT(%11)"
p = subprocess.run([sys.argv[1]], input=json.dumps({"id":"g","ir":ir}), capture_output=True, text=True)
ls=[l for l in p.stdout.splitlines() if l.strip()]
d = json.loads(ls[-1]) if ls else {}
print("%s|%s" % (d.get("ok"), (d.get("error") or "").replace("|","/")))' "$V")
case "$SK" in
  False*'quoted plane "YZ" is NOT APPLIED'*)
    echo "  PASS  SKETCH(\"YZ\") refused: ${SK#False|}"; PASS=$((PASS+1)) ;;
  True*)
    echo "  FAIL  SKETCH(\"YZ\") BUILT — it solved on XY and the part is on the wrong plane"
    FAIL=$((FAIL+1)) ;;
  *)
    echo "  FAIL  SKETCH(\"YZ\") refused for the WRONG reason: $SK"; FAIL=$((FAIL+1)) ;;
esac

echo
echo "== 2d. a keyword the RESOLVER does not implement says so, and does not lie =="
# part.fillet offers ALL | VERTICAL | RIM | CONVEX (ui/src/PartCommands.cpp) and
# selectEdges() resolves ALL | VERTICAL | RIM | HORIZONTAL. CONVEX used to come
# back "no edges match selector `CONVEX`" — which reads, on a BOX, as "your body
# has no convex edges". Every edge of a box is convex. The user is told to
# re-select for ever over a keyword that has no resolver at all.
refuses "FILLET(%b, 1, CONVEX) -- offered by the app, resolved by nothing" \
  '%1 = BOX(60,40,20)
%2 = FILLET(%1, 1, CONVEX)
RESULT(%2)' \
  'is NOT IMPLEMENTED here'

echo
echo "== 2e. the ninth op, found by measuring rather than by reading the list =="
# opReplaceFace had the same body shape as the old opThread -- resolve, (void),
# return the input -- and neither audit named it. MEASURED before the fix:
# REPLACEFACE(%1,"face:top",%2) on BOX(60,40,20) -> ok=true, 48000.0000, 6f/12e.
refuses "REPLACEFACE(%b, \"face:top\", %tool)" \
  '%1 = BOX(60,40,20)
%2 = BOX(20,20,20)
%3 = REPLACEFACE(%1, "face:top", %2)
RESULT(%3)' \
  'REPLACEFACE: not implemented'

echo
echo "== 3. NOTHING was traded away: what worked still works, to the same numbers =="
builds "BOX(60,40,20)" \
  '%1 = BOX(60,40,20)
RESULT(%1)' 48000 6 12
builds "FUSE (what RIB silently was)" \
  '%1 = BOX(60,40,20)
%2 = BOX(60,4,30)
%3 = FUSE(%1, %2)
RESULT(%3)' 50400 18 36
builds "CUT (what POCKET silently was)" \
  '%1 = BOX(60,40,20)
%2 = BOX(20,20,40)
%3 = CUT(%1, %2)
RESULT(%3)' 40000 10 24
builds "FILLET(ALL)" \
  '%1 = BOX(60,40,20)
%2 = FILLET(%1, 1, ALL)
RESULT(%2)' 47898.330353 26 56
builds "FILLET(VERTICAL)" \
  '%1 = BOX(60,40,20)
%2 = FILLET(%1, 3, VERTICAL)
RESULT(%2)' 47845.486678 10 24
# THE DOCUMENTED DEFAULT SURVIVES. FILLET's form is `FILLET(%body, radius
# [, sel=ALL])`: OMITTING the selector still means ALL and must keep working.
# Only a selector that is PRESENT and not a keyword is refused -- the two cases
# are one line apart in refuseTextSelector and this is what separates them.
builds "FILLET(%b, 1) -- selector omitted, default ALL" \
  '%1 = BOX(60,40,20)
%2 = FILLET(%1, 1)
RESULT(%2)' 47898.330353 26 56
builds "CHAMFER(%b, 1) -- selector omitted, default ALL" \
  '%1 = BOX(60,40,20)
%2 = CHAMFER(%1, 1)
RESULT(%2)' 47765.333333 26 48
builds "CHAMFER(ALL)" \
  '%1 = BOX(60,40,20)
%2 = CHAMFER(%1, 1, ALL)
RESULT(%2)' 47765.333333 26 48
builds "BLEND(ALL)" \
  '%1 = BOX(60,40,20)
%2 = BLEND(%1, 1, 2, ALL)
RESULT(%2)' 47763.835977 26 56
builds "OFFSETSOLID(2)" \
  '%1 = BOX(60,40,20)
%2 = OFFSETSOLID(%1, 2)
RESULT(%2)' 67584 6 12
builds "SPLITBODY(POSITIVE)" \
  '%1 = BOX(60,40,20)
%2 = BOX(20,20,40)
%3 = SPLITBODY(%1, %2, POSITIVE)
RESULT(%3)' 40000 10 24
builds "UNFOLD -> THICKEN" \
  '%1 = BOX(60,40,2)
%2 = UNFOLD(%1, 0.44)
%3 = THICKEN(%2, 1)
RESULT(%3)' 5524.631241 32 60

echo
echo "== 4. SOURCE: no op may answer a failed kernel call with its own input =="
# The four sites execution cannot reach — SURFTRIM, SURFEXTEND, SPLITBODY and
# UNFOLD — plus every future one. `catch (...)` followed by `return body;` /
# `return surf;` IS the defect's signature: the op swallowed a failure and handed
# back what it was given.
#
# A SOURCE CHECK IS WEAKER THAN AN EXECUTION CHECK and is labelled as one. It is
# here because the alternative is no coverage at all for those four.
#
# THE FIRST VERSION OF THIS CHECK CAUGHT ONE DEFECT IN FIVE. It was three lines
# of awk that armed on `catch (...)` and looked three lines ahead for a return of
# one of five hard-coded names. Re-injecting the identical defect in five shapes,
# it caught the literal revert and nothing else: a one-line catch body evaded it
# (the awk `next` skips the line it armed on), two comment lines evaded it (past
# the window), `catch (const std::exception&)` evaded it (only `...` was armed),
# and one rename hop evaded it (the name was not in the list). A check that fires
# on `git revert` and on nothing else certifies the hole it leaves.
#
# ft_swallow_scan.py replaces it: brace-balanced, every catch clause of every
# kind, the whole block however long, and any `return` of a value ALREADY IN HAND
# rather than a fresh kernel call. Deliberate swallows carry `SWALLOW-OK:` and
# are PRINTED as allowances, not skipped in silence.
SCAN="$KROOT/test/ft_swallow_scan.py"
if [ ! -r "$SCAN" ]; then
  echo "  FAIL  $SCAN is missing — section 4 has no instrument"
  FAIL=$((FAIL+1))
else
  # 4a. THE INSTRUMENT PROVES ITSELF BEFORE IT IS BELIEVED. Five re-injections of
  # the same defect, in the five shapes that defeated the awk, must ALL go red;
  # five things that merely look like it must all stay green. A scanner that has
  # not been shown to fail is not evidence that the file is clean.
  T="$(mktemp -d)"
  printf 'void f(){ try { g(); }\n  catch (...) {\n    return surf;\n  }\n}\n'                                       > "$T/A.cpp"
  printf 'void f(){ try { g(); }\n  catch (...) { return surf; }\n}\n'                                               > "$T/B.cpp"
  printf 'void f(){ try { g(); }\n  catch (...) {\n    // native offset is flaky\n    // fall back\n\n    return surf;\n  }\n}\n' > "$T/C.cpp"
  printf 'void f(){ try { g(); }\n  catch (const std::exception&) {\n    return surf;\n  }\n}\n'                      > "$T/D.cpp"
  printf 'void f(){ try { g(); }\n  catch (...) {\n    Handle out = surf;\n    return out;\n  }\n}\n'                 > "$T/E.cpp"
  printf 'void f(){ try { g(); } catch (...) { refuse(op, "declined"); } }\n'                                        > "$T/OK1.cpp"
  printf 'void f(){ try { g(); } catch (...) { return forge::cut(a, b); } }\n'                                       > "$T/OK2.cpp"
  printf 'void f(){ try { g(); } catch (...) { return; } }\n'                                                        > "$T/OK3.cpp"
  printf 'void f(){ /* catch (...) { return surf; } */ g(); }\n'                                                     > "$T/OK4.cpp"
  printf 'void f(){ const char* s = "catch (...) { return surf; }"; (void)s; }\n'                                    > "$T/OK5.cpp"
  CAUGHT=0; MISSED=""
  for sh in A B C D E; do
    if python3 "$SCAN" "$T/$sh.cpp" >/dev/null 2>&1; then MISSED="$MISSED $sh"; else CAUGHT=$((CAUGHT+1)); fi
  done
  FALSE=""
  for sh in OK1 OK2 OK3 OK4 OK5; do
    python3 "$SCAN" "$T/$sh.cpp" >/dev/null 2>&1 || FALSE="$FALSE $sh"
  done
  rm -rf "$T"
  if [ "$CAUGHT" = 5 ] && [ -z "$FALSE" ]; then
    echo "  PASS  the scanner itself: 5/5 injected swallow shapes RED, 5/5 look-alikes green"
    PASS=$((PASS+1))
  else
    echo "  FAIL  the scanner cannot see the defect it is here to see"
    [ -n "$MISSED" ] && echo "        shapes it MISSED:$MISSED (the old awk missed B C D E)"
    [ -n "$FALSE" ]  && echo "        FALSE POSITIVES on:$FALSE"
    FAIL=$((FAIL+1))
  fi

  # 4b. and now the real file
  SWALLOW="$(python3 "$SCAN" "$SRC" 2>&1)"; rc=$?
  printf '%s\n' "$SWALLOW" | grep '^  allow ' || true
  if [ "$rc" -ne 0 ]; then
    echo "  FAIL  a catch block still answers with the op's own input:"
    printf '%s\n' "$SWALLOW" | grep -v '^  allow ' | sed 's/^/    /'
    echo "        Each of these reports SUCCESS for an op that failed. Refuse instead"
    echo "        (Builder::refuse names the exception in flight and attributes the op),"
    echo "        or mark it SWALLOW-OK: <reason> if the failure IS reported to the caller."
    FAIL=$((FAIL+1))
  else
    echo "  PASS  no catch block in FeatureTreeCompiler.cpp returns the op's own input unreported"
    PASS=$((PASS+1))
  fi
fi

# The helper the four unreachable sites were converted to use. If it is gone,
# they were converted back — and section 1 would not notice.
if grep -q "\[\[noreturn\]\] void refuse(" "$SRC"; then
  echo "  PASS  Builder::refuse exists (the named-refusal path those sites now take)"
  PASS=$((PASS+1))
else
  echo "  FAIL  Builder::refuse is gone — the swallow sites have nothing to refuse WITH"
  FAIL=$((FAIL+1))
fi

echo
echo "== 5. THE COUNT IS DERIVED FROM THE FILE, not written in a comment =="
# The commit that introduced this gate said "twelve ops" in its subject, "Eleven"
# in this header and in the CI step comment, and the file said neither. A number
# a human retypes is a number that goes stale, so it is read out of the dispatch
# table instead: every `case OpCode::X: return opY(op` whose handler body calls
# one of the refusal helpers or carries a refusal message.
NOPS=$(python3 - "$SRC" <<'PY'
import re, sys
src = open(sys.argv[1], encoding="utf-8").read()
# TWO blanked copies, and the difference between them is the whole point.
#
# The first version ran the CALL test over comment-blanked code and the TEXT test
# over the ORIGINAL source, so the "refusing handler" count was reading PROSE.
# MEASURED, both directions:
#   - delete opSketch's guard outright and the count does not move: a comment in
#     skNew() contains the words "NOT APPLIED", so SKETCH stayed counted while
#     the guard it was counted for was gone. The gate stays GREEN on the defect
#     it exists to catch.
#   - add ONE comment line saying "not implemented" to opScaleUniform, change no
#     behaviour at all, and the count becomes 16 and the gate goes RED.
# `code` blanks comments AND string literals (the brace walk must not trip over a
# `{` inside either). `text` blanks comments and KEEPS string literals, which is
# what a refusal message actually is, so the TEXT test reads code and not prose.
# Both are the same length as the source -- every blanked character is replaced
# by a space, never removed -- so one set of offsets indexes both.
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(sys.argv[1])))
def blank(t, strings=True):
    out = list(t); i = 0; n = len(t)
    while i < n:
        c = t[i]
        if c == "/" and i+1 < n and t[i+1] == "/":
            while i < n and t[i] != "\n": out[i] = " "; i += 1
        elif c == "/" and i+1 < n and t[i+1] == "*":
            out[i] = out[i+1] = " "; i += 2
            while i < n and not (t[i] == "*" and i+1 < n and t[i+1] == "/"):
                if t[i] != "\n": out[i] = " "
                i += 1
            if i < n:
                out[i] = " "
                if i+1 < n: out[i+1] = " "
                i += 2
        elif c in "\"'":
            q = c
            if strings: out[i] = " "
            i += 1
            # A literal is WALKED either way -- a `//` or a `{` inside one must not
            # be read as code -- and only ERASED when strings=True.
            while i < n and t[i] != q:
                if t[i] == "\\":
                    if strings: out[i] = " "
                    i += 1
                if i < n and t[i] != "\n":
                    if strings: out[i] = " "
                i += 1
            if i < n:
                if strings: out[i] = " "
                i += 1
        else: i += 1
    return "".join(out)
def bal(t, i):
    d = 0
    while i < len(t):
        if t[i] == "{": d += 1
        elif t[i] == "}":
            d -= 1
            if d == 0: return i + 1
        i += 1
    raise SystemExit("unbalanced")
code = blank(src)                      # comments + string literals gone
text = blank(src, strings=False)       # comments gone, string literals KEPT
assert len(code) == len(src) == len(text)
disp = dict(re.findall(r"case OpCode::(\w+):\s*return (\w+)\(op", code))
CALL = ("refuse(", "refuseTextSelector(", "refuseNonKeyword(",
        "refuseUnknownKeyword(", "refuseExtraArgs(")
TEXT = ("NOT APPLIED", "not implemented", "NOT ONE THIS OP DEFINES", "NOT IMPLEMENTED")
names = []
for op, fn in sorted(disp.items()):
    m = re.search(r"\bHandle\s+%s\s*\(const Op& op" % re.escape(fn), code)
    if not m: continue
    a = code.index("{", m.end()); b = bal(code, a)
    if any(g in code[a:b] for g in CALL) or any(x in text[a:b] for x in TEXT):
        names.append(op.upper())
print("%d %s" % (len(names), ",".join(names)))
PY
)
WANT=15
GOT="${NOPS%% *}"
if [ "$GOT" = "$WANT" ]; then
  echo "  PASS  $GOT op handlers refuse: ${NOPS#* }"
  PASS=$((PASS+1))
else
  echo "  FAIL  the file has $GOT refusing op handlers, this gate and the commit say $WANT"
  echo "        ${NOPS#* }"
  echo "        Update the number everywhere it is written, or say why the op was dropped."
  FAIL=$((FAIL+1))
fi

echo
echo "== 6. THE APP PATH: what a USER of these commands is left looking at =="
# Six of the refusing ops are wired to buttons — part.thread, part.rib,
# part.pocket, part.replace_face, part.draft, part.offset_solid — and none of
# those paths had been run once before this section existed. The IR below is NOT
# written here: ft_app_path_probe.py reads each command's recorded emission out
# of implementation/sacrosanct/archie_op_vocabulary.json, which is derived from
# ui/src/PartCommands.cpp and gated against it, so a command whose emission moves
# moves this check with it.
#
# READING THE IR OUT OF THE VOCABULARY NARROWED THE INSTRUMENT AROUND THE
# FAILURE. `examples` documents the LEGAL forms only, so narrowing part.fillet's
# documented selector domain to ALL|RIM|VERTICAL — which is right, the kernel
# resolves no others — also deleted from this probe the only two emissions the
# refusals broke. MEASURED on the dylib of the first version of this fix:
#   FILLET(%5, 2, "bore:r=6")  REFUSED — and that is the exact statement
#                              ui/test/part_commands_test.cpp:195 asserts
#                              part.fillet emits for a non-keyword selector
#   FILLET(%4, 2, CONVEX)      REFUSED — CONVEX is in part.fillet's own
#                              parameter domain (ui/src/PartCommands.cpp:1601)
# Neither was run by anything. The vocabulary now records them as
# `refused_app_emissions` — derived from the same two sources, the app's ternary
# domain and selectEdges' resolvable set — and the probe runs them. They are
# EXPECTED to be refused: if one BUILDS, the silent widening is back.
PROBE="$KROOT/test/ft_app_path_probe.py"
NEXTSTEP="$KROOT/test/ft_next_step.py"
APPCMDS="part.thread part.rib part.pocket part.replace_face part.draft part.offset_solid
         part.fillet part.chamfer part.variable_fillet part.split_body part.thicken part.surf_trim"

# 6a. THE NEXT-STEP PREDICATE PROVES ITSELF FIRST — same reason section 4a does.
# This gate used to require a next step with
#     *" instead"*|*"Write "*|*"Cut "*|*"Use "*|*"or "*
# and MEASURED, a refusal that was a pure diagnosis with no remedy passed 52/52
# on the substring " or ". The requirement was stated and not enforced, which is
# the defect this whole section was written to answer. ft_next_step.py replaces
# it with an imperative-clause test and runs it over fixtures in both directions
# before anything below is believed.
if [ ! -r "$NEXTSTEP" ]; then
  echo "  FAIL  $NEXTSTEP is missing — the next-step requirement is unenforced again"
  FAIL=$((FAIL+1))
elif SP="$(python3 "$NEXTSTEP" --self-proof 2>&1)"; then
  echo "  PASS ${SP#  self-proof}"
  PASS=$((PASS+1))
else
  echo "  FAIL  the next-step predicate does not hold on its own fixtures:"
  echo "$SP"
  FAIL=$((FAIL+1))
fi

# 6b. AND IT IS APPLIED TO EVERY refuse() SITE, not only the reachable ones.
# Only TWO of the six refuse(op, "...") call sites in FeatureTreeCompiler.cpp can
# be reached by any IR fixture in this tree; the other four need their kernel call
# to RAISE and nothing here makes it. "All six end with what to do" was therefore
# a claim execution could not check, asserted on the strength of two. This scans
# the source for all six — the same reason section 4 scans for swallow sites no
# input can reach.
if SC="$(python3 "$NEXTSTEP" --scan "$SRC" 2>&1)"; then
  echo "  PASS ${SC#  scan}"
  PASS=$((PASS+1))
else
  echo "$SC"
  FAIL=$((FAIL+1))
fi

if [ ! -r "$PROBE" ]; then
  echo "  FAIL  $PROBE is missing — the app path is unmeasured again"
  FAIL=$((FAIL+1))
else
  APPOUT="$(python3 "$PROBE" "$V" $APPCMDS 2>&1)"
  if [ $? -ne 0 ] || [ -z "$APPOUT" ]; then
    echo "  FAIL  the app-path probe did not run: ${APPOUT:0:200}"
    FAIL=$((FAIL+1))
  else
    # The probe emits BOTH halves of what the app can write, tagged:
    #   documented — from examples[]:                 expected per the case list
    #   refused    — from refused_app_emissions[]:    expected to be REFUSED
    SAWREFUSED=0
    while IFS='|' read -r cmd source ir ok err; do
      [ -z "$cmd" ] && continue
      if [ "$source" = refused ]; then
        want=REFUSE; SAWREFUSED=$((SAWREFUSED+1))
      else
        case "$cmd" in
          part.thread|part.rib|part.pocket|part.replace_face|part.draft) want=REFUSE ;;
          *) want=BUILD ;;
        esac
      fi
      if [ "$want" = BUILD ]; then
        if [ "$ok" = "True" ]; then
          echo "  PASS  $cmd still builds: $ir"; PASS=$((PASS+1))
        else
          echo "  FAIL  $cmd no longer builds: $ir"; echo "        $err"; FAIL=$((FAIL+1))
        fi
        continue
      fi
      if [ "$ok" = "True" ]; then
        if [ "$source" = refused ]; then
          echo "  FAIL  $cmd BUILT a statement the vocabulary derives as refused: $ir"
          echo "        The guard is gone and the argument is being silently widened again."
        else
          echo "  FAIL  $cmd reported SUCCESS for an op that did nothing: $ir"
        fi
        FAIL=$((FAIL+1)); continue
      fi
      # READABLE, not merely non-empty: it must name the op the user clicked and
      # tell them what to do. "refused" with no next step is a dead end in a UI.
      op="${ir#*= }"; op="${op%%(*}"
      case "$err" in
        *"$op"*) ;;
        *) echo "  FAIL  $cmd refused without naming $op: $err"; FAIL=$((FAIL+1)); continue ;;
      esac
      if STEP="$(python3 "$NEXTSTEP" "$err")"; then
        echo "  PASS  $cmd [$source] refuses readably, next step: ${STEP:0:90}"
        PASS=$((PASS+1))
      else
        echo "  FAIL  $cmd refused with no next step for the user — only a diagnosis:"
        echo "        $err"
        FAIL=$((FAIL+1))
      fi
    done <<< "$APPOUT"
    # The refused half is the half that disappeared once. If the vocabulary stops
    # deriving it, this section silently shrinks back to measuring only the rows
    # that were never in danger.
    if [ "$SAWREFUSED" -ge 4 ]; then
      echo "  PASS  $SAWREFUSED app-reachable-but-refused emissions were run (not just the legal forms)"
      PASS=$((PASS+1))
    else
      echo "  FAIL  only $SAWREFUSED refused_app_emissions rows ran; part.fillet and part.chamfer"
      echo "        each contribute two (CONVEX and a quoted selector). The vocabulary has"
      echo "        stopped deriving them and the probe is blind to them again."
      FAIL=$((FAIL+1))
    fi
  fi
fi

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
