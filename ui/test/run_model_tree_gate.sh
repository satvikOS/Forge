#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_model_tree_gate.sh — PROVE model_tree_test CAN FAIL.
#
# ui/test/run_ui.sh already builds and runs ui/test/model_tree_test.cpp on every
# push -- it globs ui/test/*_test.cpp. This script is the other half, and it is
# the half that decides whether that gate is worth anything: a check nobody has
# ever seen go red is indistinguishable from a check that cannot.
#
# WHAT THE GATE PROTECTS. forge::ui::ModelTree is what the Model Browser and the
# Sketch Tree panels draw. Before it, those two tabs -- and Assembly, Operations,
# Studies and Sheets beside them -- were all dispatched to the FEATURE TREE, so
# six docked tabs showed a user something other than what they named. The
# replacement is only an improvement while every row it produces is the
# document's own; each mutation below breaks exactly one of those readings.
#
#   1  CON dropped from the pass-through set   -> a constraint becomes a phantom
#                                                 object in the browser
#   2  RECT's argument names swapped           -> 80 mm is labelled the height
#   3  the node held by a pass-through is not  -> a constrained sketch reads as
#      folded back onto the sketch                unnamed, so the browser hides
#                                                 the thing being worked on
#   4  a defaulted optional is not marked      -> a number the KERNEL supplied is
#                                                 shown as one the user chose
#
# Each mutation runs against a COPY of the tree, so nothing edits the working
# checkout. A mutation that fails to COMPILE is reported as a broken mutation,
# never as a red gate -- "it did not build" is not "the check fired".
#
# Usage: bash ui/test/run_model_tree_gate.sh [--mutations]
#        (no argument = the clean run only)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || {
  echo "[model-tree] cannot resolve the repo root"; exit 1; }
[ -n "$ROOT" ] || { echo "[model-tree] repo root resolved to the empty string"; exit 1; }
cd "$ROOT" || { echo "[model-tree] cannot enter repo root $ROOT"; exit 1; }

CXX="${CXX:-clang++}"
command -v "$CXX" >/dev/null 2>&1 || { echo "[model-tree] no $CXX on PATH"; exit 1; }
. "$ROOT/tools/gates/forge_cxx_cache.sh"

WORK="$(mktemp -d /tmp/forge_model_tree.XXXXXX)"
cleanup() {
  rm -rf "$WORK"
  if [ -d "$WORK" ]; then echo "[model-tree] WARNING: kept $WORK"; fi
}
trap cleanup EXIT

# The gate READS forge-kernel's FeatureTree.hpp to re-derive the argument names,
# so the copy carries it. FORGE_UI_REPO_ROOT points at the copy, never at the
# working tree -- a mutation that still read the real header would be comparing
# the mutated table against the source it was supposed to have drifted from.
run_against() {
  local tree="$1" tag="$2"
  local bin="$WORK/gate_$tag"
  FCC_CXX="$CXX"
  FCC_CFLAGS=(-std=c++20 -O2 -Wall -Wextra -Werror
              "-DFORGE_UI_REPO_ROOT=\"$tree\""
              -I "$tree/ui/include" -I "$tree/ui/test")
  FCC_LDFLAGS=()
  FCC_SRCS=("$tree/ui/test/model_tree_test.cpp" "$tree"/ui/src/*.cpp)
  FCC_CACHE="$CACHE"
  if ! fcc_build "$bin" "$WORK/$tag.build"; then
    return 2
  fi
  if "$bin" >"$WORK/$tag.out" 2>&1; then return 0; fi
  return 1
}

# ── ★ ONE TREE, AT A CONSTANT PATH, RESTORED BETWEEN MUTATIONS (T-160) ──────
# This used to copy the tree to $WORK/m<n> per mutation, which put the mutation
# number into -I and into -DFORGE_UI_REPO_ROOT. Those are compile flags, so no
# two builds shared a single object and every mutation paid for a full 47-unit
# serial compile. MEASURED on merged head 29070823: this step was 416 s of the
# forge::ui job's 2,858 s (14.6%).
#
# With ONE tree at a fixed path every build has identical flags, so the object
# cache in tools/gates/forge_cxx_cache.sh reuses the sources a mutation did not
# touch. It is keyed on file CONTENT, never on a timestamp -- read that file's
# header for why that distinction is the whole safety argument.
#
# The price of a shared path is that a mutation must be UNDONE. fcc_reset_tree
# rebuilds the tree from the pristine copy and then PROVES the two are identical
# (diff -rq), so an incomplete restore is a red gate rather than a mutation
# riding silently into the next round.
PRISTINE="$WORK/pristine"
TREE="$WORK/tree"
CACHE="$WORK/objcache"

copy_tree() {
  local dst="$1"
  mkdir -p "$dst/forge-kernel/include/forge/ft"
  cp -R "$ROOT/ui" "$dst/ui"
  cp "$ROOT/forge-kernel/include/forge/ft/FeatureTree.hpp" \
     "$dst/forge-kernel/include/forge/ft/FeatureTree.hpp"
}

copy_tree "$PRISTINE"
fcc_reset_tree "$PRISTINE" "$TREE" || { echo "[model-tree] RED: could not stage the tree"; exit 1; }
FCC_JOBS="$(fcc_jobs)"
echo "[model-tree] CXX=$CXX JOBS=$FCC_JOBS  one tree at a constant path, objects cached on content"
run_against "$TREE" clean
CLEAN_RC=$?
echo "[model-tree] clean build: compiled $FCC_COMPILED translation unit(s), reused $FCC_REUSED"
fcc_report_epoch
if [ "$CLEAN_RC" -eq 2 ]; then
  echo "[model-tree] RED: the gate does not BUILD"; cat "$WORK/clean.build"; exit 1
fi
if [ "$CLEAN_RC" -ne 0 ]; then
  echo "[model-tree] RED: the clean run FAILS"; cat "$WORK/clean.out"; exit 1
fi
sed -n '/checks,/p' "$WORK/clean.out"
echo "[model-tree] clean run GREEN"

if [ "${1:-}" != "--mutations" ]; then exit 0; fi

SRC="ui/src/ModelTree.cpp"

mutate() {
  local n="$1" tree="$TREE"
  # Restore first, and PROVE the restore worked. A mutation applied on top of the
  # previous one is not the mutation this loop reports.
  fcc_reset_tree "$PRISTINE" "$TREE" || return 4
  case "$n" in
    1) python3 - "$tree/$SRC" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old='  return op == "CON" || op == "TAG" || op == "VERIFY" || op == "SURFCHECK";'
new='  return op == "TAG" || op == "VERIFY" || op == "SURFCHECK";'
assert old in s, "mutation 1 anchor missing"
open(p,'w').write(s.replace(old,new,1))
PY
       ;;
    2) python3 - "$tree/$SRC" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old='const char* const kRectArgs[] = {"w", "h", "cx=0", "cy=0"};'
new='const char* const kRectArgs[] = {"h", "w", "cx=0", "cy=0"};'
assert old in s, "mutation 2 anchor missing"
open(p,'w').write(s.replace(old,new,1))
PY
       ;;
    3) python3 - "$tree/$SRC" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old='''        if (v->node.empty() && !passNode.empty()) {
          v->node = passNode;
          v->live = true;
        }'''
new='''        (void)passNode;'''
assert old in s, "mutation 3 anchor missing"
open(p,'w').write(s.replace(old,new,1))
PY
       ;;
    4) python3 - "$tree/$SRC" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old='''        d.value = fallback;
        d.defaulted = true;'''
new='''        d.value = fallback;
        d.defaulted = false;'''
assert old in s, "mutation 4 anchor missing"
open(p,'w').write(s.replace(old,new,1))
PY
       ;;
    *) echo "[model-tree] no such mutation: $n"; return 2 ;;
  esac
  # ★ A mutation that wrote nothing proves nothing. Each python block above
  # asserts its own anchor, but an assert that fires leaves the tree PRISTINE and
  # the gate would then be green for the most misleading reason available. Check
  # the WRITE, not the return code.
  fcc_assert_mutated "$PRISTINE" "$TREE" || return 5
  run_against "$tree" "m$n"
  return $?
}

BAD=0
for m in 1 2 3 4; do
  mutate "$m"
  rc=$?
  case "$rc" in
    1) echo "[model-tree] mutation $m: RED (as required) [compiled $FCC_COMPILED, reused $FCC_REUSED]" ;;
    0) echo "[model-tree] mutation $m STAYED GREEN -- the check it targets is unfalsifiable"
       BAD=$((BAD + 1)) ;;
    4) echo "[model-tree] mutation $m: THE TREE COULD NOT BE RESTORED -- no proof was made"
       BAD=$((BAD + 1)) ;;
    5) echo "[model-tree] mutation $m CHANGED NOTHING -- its anchor is gone; fix the mutation"
       BAD=$((BAD + 1)) ;;
    *) echo "[model-tree] mutation $m DID NOT BUILD -- that is not a proof; fix the mutation"
       sed -n '1,15p' "$WORK/m$m.build" 2>/dev/null
       BAD=$((BAD + 1)) ;;
  esac
done

if [ "$BAD" -ne 0 ]; then
  echo "[model-tree] RED: $BAD of 4 mutations did not prove the gate can fail"; exit 1
fi
echo "[model-tree] GREEN -- clean run passes and all 4 mutations proved red"
