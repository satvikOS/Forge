#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_selection_consumed_gate.sh — PROVE selection_consumed_test CAN FAIL.
#
# ui/test/run_ui.sh already builds and runs ui/test/selection_consumed_test.cpp
# on every push -- it globs ui/test/*_test.cpp. This script is the other half: a
# check nobody has ever seen go red is indistinguishable from one that cannot.
#
# WHAT THE GATE PROTECTS. Five Part commands took a viewport pick and threw it
# away: part.hole and part.counterbore put every hole through the world origin on
# a hard-coded +Z axis, and part.fillet / part.chamfer / part.variable_fillet
# rounded EVERY edge of the body whichever edges were picked. The pick now places
# the feature, and a pick the kernel's edge keywords cannot say exactly is refused.
# Each mutation below puts back one way of getting that wrong, in the REAL source:
#
#   1  part.hole ignores where the face was clicked      -> holes at the origin again
#   2  part.counterbore is given the INWARD normal       -> the recess is cut in air
#   3  the dress-up commands widen a partial pick      -> 3 of 8 edges rounds all 8
#      instead of refusing it
#   4  the hit point is not snapped onto the face plane  -> a 0.6 um roof on every
#                                                           counterbore
#   5  the face normal ignores the mesh's winding        -> an axis pointing out of
#                                                           an inside-out body
#   6  the edge class is read off the segment soup's     -> a bore rim is not HORIZONTAL,
#      first and last points, not the chain's two ends      so 8 of 10 flat edges is
#                                                           emitted as all of them
#   7  a refusal stops offering the selector box         -> the one route to every
#                                                           edge goes unmentioned
#   8  a typed selector no longer overrides the pick     -> typing ALL is refused, so
#                                                           the refusal's advice fails
#   9  a comment-only edit to PartCommands.cpp           -> GREEN (the control)
#
# 9 is not optional: without it, 1-8 would pass just as well over a harness that
# went red on any rebuild at all.
#
# COST. Every ui/ source is compiled ONCE; a mutation recompiles only the one
# file it edits and relinks. Rebuilding all 44 sources per mutation, as the older
# proofs do, would add minutes to a CI job that is already at its budget.
#
# A mutation that does not APPLY (its anchor is missing) or does not COMPILE is a
# broken mutation, never a red gate -- "it did not build" is not "the check fired".
#
# Usage: bash ui/test/run_selection_consumed_gate.sh [--mutations]
#        (no argument = the clean run only)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

TAG="[selection-consumed]"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || {
  echo "$TAG cannot resolve the repo root"; exit 1; }
[ -n "$ROOT" ] || { echo "$TAG repo root resolved to the empty string"; exit 1; }
cd "$ROOT" || { echo "$TAG cannot enter repo root $ROOT"; exit 1; }

CXX="${CXX:-clang++}"
command -v "$CXX" >/dev/null 2>&1 || { echo "$TAG no $CXX on PATH"; exit 1; }
command -v python3 >/dev/null 2>&1 || {
  echo "$TAG no python3 on PATH; the mutations are applied with it"; exit 1; }
JOBS="${JOBS:-$( (command -v nproc >/dev/null && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 4 )}"
FLAGS=(-std=c++20 -O2 -Wall -Wextra -Werror)
TEST="ui/test/selection_consumed_test.cpp"

WORK="$(mktemp -d /tmp/forge_selection_consumed.XXXXXX)"
cleanup() {
  rm -rf "$WORK"
  if [ -d "$WORK" ]; then echo "$TAG WARNING: kept $WORK -- rm -rf did not remove it"; fi
}
trap cleanup EXIT

# The whole ui/ tree is copied so that no mutation can ever touch the checkout.
TREE="$WORK/tree"
mkdir -p "$TREE"
cp -R "$ROOT/ui" "$TREE/ui"
DEF="-DFORGE_UI_REPO_ROOT=\"$TREE\""

objname() { echo "$WORK/obj/$(echo "$1" | tr '/.' '__').o"; }

compile_one() {  # compile_one <source path inside TREE> <object>
  "$CXX" "${FLAGS[@]}" "$DEF" -I "$TREE/ui/include" -I "$TREE/ui/test" \
    -c "$TREE/$1" -o "$2" >"$2.log" 2>&1 || { echo "$1" >>"$WORK/objfail"; return 1; }
}

# ── 1. every source once, in parallel, then the gate's own object ───────────
mkdir -p "$WORK/obj"
: >"$WORK/objfail"
SRCS=()
for f in "$TREE"/ui/src/*.cpp; do SRCS+=("ui/src/$(basename "$f")"); done
PIDS=()
for s in "${SRCS[@]}" "$TEST"; do
  compile_one "$s" "$(objname "$s")" &
  PIDS+=("$!")
  if [ "${#PIDS[@]}" -ge "$JOBS" ]; then wait "${PIDS[0]}"; PIDS=("${PIDS[@]:1}"); fi
done
for p in "${PIDS[@]:-}"; do [ -n "$p" ] && wait "$p"; done
if [ -s "$WORK/objfail" ]; then
  echo "$TAG RED: the clean tree does not BUILD"
  while IFS= read -r s; do echo "  $s"; sed -n '1,20p' "$(objname "$s").log"; done <"$WORK/objfail"
  exit 1
fi

# 0 = the gate passed, 1 = the gate FAILED (what a mutation must produce),
# 2 = it did not build (never a pass and never a proof).
link_and_run() {  # link_and_run <tag> [<source replaced> <its object>]
  local tag="$1" swapped="${2:-}" swapObj="${3:-}" objs=() s
  for s in "${SRCS[@]}" "$TEST"; do
    if [ -n "$swapped" ] && [ "$s" = "$swapped" ]; then objs+=("$swapObj"); else objs+=("$(objname "$s")"); fi
  done
  if ! "$CXX" "${objs[@]}" -o "$WORK/gate_$tag" >"$WORK/$tag.link" 2>&1; then return 2; fi
  if "$WORK/gate_$tag" >"$WORK/$tag.out" 2>&1; then return 0; fi
  return 1
}

link_and_run clean
CLEAN_RC=$?
if [ "$CLEAN_RC" -eq 2 ]; then echo "$TAG RED: the gate does not LINK"; cat "$WORK/clean.link"; exit 1; fi
if [ "$CLEAN_RC" -ne 0 ]; then echo "$TAG RED: the clean run FAILS"; cat "$WORK/clean.out"; exit 1; fi
tail -n 1 "$WORK/clean.out"
echo "$TAG clean run GREEN"

if [ "${1:-}" != "--mutations" ]; then exit 0; fi

# ── 2. the mutations ─────────────────────────────────────────────────────────
# mutate <n> <file>: edit a COPY of <file> (python3 runs the mutation's script,
# fed on stdin by expect) and prove the copy differs, so a mutation that matched nothing can
# never be mistaken for one that changed nothing the gate reads.
mutate() {
  local n="$1" rel="$2" mut="$WORK/m$1"
  mkdir -p "$mut/$(dirname "$rel")"
  cp "$TREE/$rel" "$mut/$rel"
  if ! python3 - "$mut/$rel" "$n" >"$WORK/m$n.apply" 2>&1; then
    echo "$TAG mutation $n DID NOT APPLY -- its anchor is missing"; cat "$WORK/m$n.apply"; return 2
  fi
  if cmp -s "$TREE/$rel" "$mut/$rel"; then
    echo "$TAG mutation $n CHANGED NOTHING -- a no-op is not a proof"; return 2
  fi
  local obj="$WORK/m$n.o"
  # The mutant is compiled from the mutation directory with the SAME include
  # path, so a quoted include of a sibling header still resolves to the tree.
  if ! "$CXX" "${FLAGS[@]}" "$DEF" -I "$TREE/ui/include" -I "$TREE/ui/test" \
       -c "$mut/$rel" -o "$obj" >"$WORK/m$n.build" 2>&1; then
    return 3
  fi
  link_and_run "m$n" "$rel" "$obj"
}

PY_HEAD='import sys
p = sys.argv[1]
s = open(p).read()
def swap(old, new, count=1):
    global s
    assert s.count(old) >= count, "anchor missing: " + old[:70]
    s = s.replace(old, new, count)
'

expect() {  # expect <n> <want: red|green> <file> <python body>
  local n="$1" want="$2" rel="$3" body="$4" rc
  printf '%s\n%s\nopen(p, "w").write(s)\n' "$PY_HEAD" "$body" >"$WORK/m$n.py"
  # mutate() feeds python3 on stdin; rebind it to this mutation's script.
  mutate "$n" "$rel" <"$WORK/m$n.py"
  rc=$?
  case "$want:$rc" in
    red:1)   echo "$TAG mutation $n: RED (as required)"; return 0 ;;
    green:0) echo "$TAG mutation $n: GREEN (the control, as required)"; return 0 ;;
    red:0)   echo "$TAG mutation $n STAYED GREEN -- the check it targets is unfalsifiable" ;;
    green:1) echo "$TAG control $n went RED -- the harness reacts to any edit"
             sed -n '1,20p' "$WORK/m$n.out" ;;
    *:3)     echo "$TAG mutation $n DID NOT BUILD -- that is not a proof; fix the mutation"
             sed -n '1,15p' "$WORK/m$n.build" ;;
    *)       echo "$TAG mutation $n is broken (rc=$rc)" ;;
  esac
  return 1
}

BAD=0
expect 1 red ui/src/PartCommands.cpp '
swap("  if (!placedByHand(ctx)) {\n",
     "  if (false && !placedByHand(ctx)) {\n")
' || BAD=$((BAD + 1))

expect 2 red ui/src/PartCommands.cpp '
swap("placeOnPickedFace(ctx, args, 4, PickedAxis::OutOfMaterial);",
     "placeOnPickedFace(ctx, args, 4, PickedAxis::IntoMaterial);")
' || BAD=$((BAD + 1))

expect 3 red ui/src/PartCommands.cpp '
swap("  if (!plan.expressible) {\n    ctx.fail(edgeSelectorRefusal(what, verb, overrideParam, plan));\n    return false;\n  }\n",
     "  if (!plan.expressible) return !edgeSelectorRefusal(what, verb, overrideParam, plan).empty();\n")
' || BAD=$((BAD + 1))

expect 4 red ui/src/PickModel.cpp '
swap("  for (int i = 0; i < 3; ++i) ev.point[i] -= d * ev.normal[i];\n",
     "  for (int i = 0; i < 3; ++i) ev.point[i] -= 0.0 * d * ev.normal[i];\n")
' || BAD=$((BAD + 1))

expect 5 red ui/src/PickModel.cpp '
swap("  const double sign = (winding == MeshWinding::Outward) ? 1.0 : -1.0;\n",
     "  const double sign = (winding == MeshWinding::Outward) ? 1.0 : 1.0;\n")
' || BAD=$((BAD + 1))

expect 6 red ui/src/PickModel.cpp '
swap("  const double* a = edge.endA;\n  const double* b = edge.endB;\n",
     "  const double* a = &edge.points[0];\n  const double* b = &edge.points[edge.points.size() - 3];\n")
' || BAD=$((BAD + 1))

expect 7 red ui/src/PartCommands.cpp '
swap("    ctx.fail(edgeSelectorRefusal(what, verb, overrideParam, plan));\n",
     "    ctx.fail(edgeSelectorRefusal(what, verb, nullptr, plan));\n")
' || BAD=$((BAD + 1))

expect 8 red ui/src/PartCommands.cpp '
swap("  if (overrideParam != nullptr && hasText(ctx, overrideParam)) return true;\n",
     "  if (false && overrideParam != nullptr && hasText(ctx, overrideParam)) return true;\n")
' || BAD=$((BAD + 1))

expect 9 green ui/src/PartCommands.cpp '
swap("// ── WHERE THE USER POINTED ", "// (control: a comment-only edit)\n// ── WHERE THE USER POINTED ")
' || BAD=$((BAD + 1))

if [ "$BAD" -ne 0 ]; then
  echo "$TAG RED: $BAD of 9 mutations did not prove what they claim"; exit 1
fi
echo "$TAG GREEN -- clean run passes, all 8 mutations proved red and the control stayed green"
