#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_ab_tkoffset_mutations.sh — PROVE the family I and family J gates can FAIL.
#
# SR-3: "PROVE each gate can fail by mutating the code under test and showing
# red-then-green." A harness that has only ever been seen green is not evidence.
# This script mutates the ENGINES (never the tests), requires the corresponding
# A/B to turn RED, restores the source byte-for-byte, and requires it to be GREEN
# again. Any mutation that does NOT turn its gate red is itself a FAILURE of this
# script: it means the gate is blind to that class of error.
#
# One mutation is deliberately VOLUME-PRESERVING (draft M1 on the mid-height
# pivot case), because a harness that only watched volume would pass it. That is
# the mutation that proves the centre-of-mass and bounding-box assertions are
# load-bearing rather than decorative.
#
# usage: bash forge-kernel/test/run_ab_tkoffset_mutations.sh
# exit 0 iff every mutation went red, every restore went green.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

DRAFT_SRC=forge-kernel/src/native/brep/NativeDraft.cpp
THICK_SRC=forge-kernel/src/native/brep/NativeThickenShell.cpp
DRAFT_AB=forge-kernel/test/run_ab_native_draft.sh
THICK_AB=forge-kernel/test/run_ab_native_thicken.sh

BK="$(mktemp -d "${TMPDIR:-/tmp}/forge_mut.XXXXXX")"
cp "$DRAFT_SRC" "$BK/draft.orig"
cp "$THICK_SRC" "$BK/thicken.orig"
restore() { cp "$BK/draft.orig" "$DRAFT_SRC"; cp "$BK/thicken.orig" "$THICK_SRC"; }
trap 'restore; rm -rf "$BK"' EXIT

PASS=0; FAIL=0
note() { printf '%s\n' "$*"; }

# run_gate SCRIPT -> echoes the score line, then GREEN / RED / NOBUILD.
# NOBUILD is reported SEPARATELY and is never accepted as a mutation kill: a
# mutant that fails to COMPILE proves nothing about what the assertions can see.
# (Two mutants in the first draft of this script did exactly that — they left a
# variable unused and died on -Werror — and were rewritten to compile.)
run_gate() {
  local out rc score
  out="$(bash "$1" 2>&1)"; rc=$?
  score="$(printf '%s\n' "$out" | grep -E '^\[ab-(draft|thicken)\] [0-9]+ passed' | tail -1)"
  if [ -z "$score" ]; then
    printf '%s\n' "$(printf '%s\n' "$out" | tail -2 | tr '\n' ' ')"
    echo "NOBUILD"
    return
  fi
  printf '%s\n' "$score"
  [ "$rc" -eq 0 ] && echo "GREEN" || echo "RED"
}

# mutate FILE 'python-expression-safe old' 'new'  — exact, unique, else abort
mutate() {
  python3 - "$1" "$2" "$3" <<'PY'
import io, sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(p, encoding="utf-8").read()
if s.count(old) != 1:
    sys.stderr.write("MUTATION TARGET NOT UNIQUE (%d): %r\n" % (s.count(old), old[:80]))
    sys.exit(2)
io.open(p, "w", encoding="utf-8").write(s.replace(old, new))
PY
}

check() { # LABEL SCRIPT EXPECT
  local label="$1" script="$2" expect="$3" res
  res="$(run_gate "$script")"
  local verdict; verdict="$(printf '%s\n' "$res" | tail -1)"
  local score;   score="$(printf '%s\n' "$res" | head -1)"
  if [ "$verdict" = "NOBUILD" ]; then
    FAIL=$((FAIL+1)); printf '  FAIL  %-58s NOBUILD - the mutant did not compile, so it\n        proves nothing. %s\n' "$label" "$score"
  elif [ "$verdict" = "$expect" ]; then
    PASS=$((PASS+1)); printf '  ok    %-58s %s  (%s)\n' "$label" "$verdict" "$score"
  else
    FAIL=$((FAIL+1)); printf '  FAIL  %-58s %s, expected %s  (%s)\n' \
      "$label" "$verdict" "$expect" "$score"
  fi
}

note "== baseline: both gates must be GREEN before anything is mutated =="
check "baseline draft"   "$DRAFT_AB" GREEN
check "baseline thicken" "$THICK_AB" GREEN

# ─────────────────────────────── family J (draft) ────────────────────────────
note ""
note "== family J mutations (NativeDraft.cpp) =="

# M1 — SIGN FLIP. On case3 (walls pivoting about MID-HEIGHT) this mutation
# PRESERVES THE VOLUME EXACTLY: the section at the neutral plane is unchanged and
# the wall leans out below / in above either way. It is caught ONLY by the centre
# of mass and the bounding box. This is the mutation that proves those assertions
# are load-bearing.
mutate "$DRAFT_SRC" "    const double theta = angleRad;" \
                    "    const double theta = -angleRad;  /* MUTANT M1 */" || exit 2
check "M1 draft: rotation sign flipped (volume-preserving on case3)" "$DRAFT_AB" RED
restore

# M2 — WRONG ROTATION AXIS: pivot about the line through the ORIGIN instead of
# the face/neutral-plane intersection. Keeps the drafted face's ANGLE correct and
# only moves where the taper is pinned.
mutate "$DRAFT_SRC" "    const gp_Vec p0v = n * alpha + mv * beta;" \
                    "    const gp_Vec p0v = (n * alpha + mv * beta) * 0.0;  /* MUTANT M2 */" || exit 2
check "M2 draft: rotation axis moved to the origin"                 "$DRAFT_AB" RED
restore

# M3 — SKIP THE VERTEX RE-MEET for faces that were not selected, i.e. leave the
# untouched faces' vertices where they were. A half-applied draft.
mutate "$DRAFT_SRC" "        moved[static_cast<std::size_t>(i) - 1] = corner;" \
                    "        moved[static_cast<std::size_t>(i) - 1] = (i % 2) ? corner : BRep_Tool::Pnt(TopoDS::Vertex(vfMap.FindKey(i)));  /* MUTANT M3 */" || exit 2
check "M3 draft: every other vertex left un-drafted"                "$DRAFT_AB" RED
restore

# M4 — DISABLE THE EXACTNESS GUARD (the residual check on the plane meet). This
# one must stay GREEN: it is a SAFETY guard, not geometry, and the supported cases
# have exact corners. A guard that changed a passing answer would mean the answer
# was only passing because the guard rejected something.
mutate "$DRAFT_SRC" "            if (std::fabs(r) > resTol) return kNull;" \
                    "            if (std::fabs(r) > 1.0e30 * resTol) return kNull;  /* MUTANT M4 */" || exit 2
check "M4 draft: exactness guard widened (must stay GREEN)"         "$DRAFT_AB" GREEN
restore

# ────────────────────────────── family I (thicken) ───────────────────────────
note ""
note "== family I mutations (NativeThickenShell.cpp) =="

# T1 — DROP THE EDGE WEDGE: emit the plain fuse-of-prisms. This is EXACTLY the
# wrong answer the header's measured table names (600 instead of 600 + 10 pi).
mutate "$THICK_SRC" "        parts.push_back(wedge);" \
                    "        if (theta > 1.0e9) parts.push_back(wedge);  /* MUTANT T1 */" || exit 2
check "T1 thicken: convex edge wedge omitted (fuse-of-prisms)"      "$THICK_AB" RED
restore

# T2 — CONVEXITY TEST INVERTED: wedges on the concave folds, none on the convex.
mutate "$THICK_SRC" "        if (gp_Vec(a1).Dot(gp_Vec(u2)) > 0.0) continue;   // CONCAVE: prisms overlap" \
                    "        if (gp_Vec(a1).Dot(gp_Vec(u2)) < 0.0) continue;  /* MUTANT T2 */" || exit 2
check "T2 thicken: convexity test inverted"                         "$THICK_AB" RED
restore

# T3 — WEDGE RADIUS HALVED. Volume moves by only (3/4)*10 pi on the L case, ~3.7%
# of the total: enough that the volume assertion catches it, and a check that the
# tolerance is not so loose it swallows a real error.
mutate "$THICK_SRC" "        const TopoDS_Shape wedge = sectorWedge(p0, edir, len, r, a1, a2, theta);" \
                    "        const TopoDS_Shape wedge = sectorWedge(p0, edir, len, 0.5 * r, a1, a2, theta);  /* MUTANT T3 */" || exit 2
check "T3 thicken: wedge radius halved"                             "$THICK_AB" RED
restore

# T4 — COPLANAR PATH: offset along the WRONG SIGN. The flat prism's VOLUME is
# unchanged (area * |t| either way); only its position moves. Caught by the
# bounding box and the centre of mass, never by volume.
mutate "$THICK_SRC" "        BRepPrimAPI_MakePrism mkp(shell, gp_Vec(N[0]) * (sgn * r));" \
                    "        BRepPrimAPI_MakePrism mkp(shell, gp_Vec(N[0]) * (-sgn * r));  /* MUTANT T4 */" || exit 2
check "T4 thicken: flat prism direction flipped (volume-preserving)" "$THICK_AB" RED
restore

note ""
note "== restore: both gates must be GREEN again =="
check "restored draft"   "$DRAFT_AB" GREEN
check "restored thicken" "$THICK_AB" GREEN

note ""
note "[mutations] $PASS ok, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
