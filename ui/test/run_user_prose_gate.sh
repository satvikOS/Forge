#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_user_prose_gate.sh — PROVE user_facing_text_test CAN FAIL.
#
# ui/test/run_ui.sh already builds and runs that gate on every push. This script
# exists for the other half, and it is the half that decides whether the gate is
# worth anything: a check nobody has ever SEEN go red is indistinguishable from a
# check that cannot.
#
# The defect the gate exists for shipped past every reviewer who read the file it
# was in. So each mutation below reintroduces one REAL leak, in the real source,
# and the run is red or this script is.
#
#   1  the placeholder paragraph, verbatim, back in drawGenericPanel   -> check D
#   2  scene_.error() handed straight to an ImGui text call            -> check E
#   3  a panel added to a workspace with no catalogue entry            -> check B
#   4  a Planned panel declared Live without being implemented         -> check C
#   5  a C++ class name inside a panel's purpose sentence              -> check B
#   6  a translator that echoes the internal detail it was given       -> check G
#   7  the scanner neutered to find nothing                            -> check A
#
# 7 is the one that matters most. Every other check in that file is an
# application of scanUserFacingProse(); if it could be emptied and the gate stay
# green, all six of the others would be decoration.
#
# Each mutation runs against a COPY of the tree, so nothing edits the working
# checkout. A mutation that fails to COMPILE is reported as a broken mutation,
# never as a red gate -- "it did not build" is not "the check fired".
#
# Usage: bash ui/test/run_user_prose_gate.sh [--mutations]
#        (no argument = the clean run only)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || {
  echo "[prose] cannot resolve the repo root"; exit 1; }
[ -n "$ROOT" ] || { echo "[prose] repo root resolved to the empty string"; exit 1; }
cd "$ROOT" || { echo "[prose] cannot enter repo root $ROOT"; exit 1; }

CXX="${CXX:-clang++}"
command -v "$CXX" >/dev/null 2>&1 || { echo "[prose] no $CXX on PATH"; exit 1; }

WORK="$(mktemp -d /tmp/forge_prose.XXXXXX)"
cleanup() {
  rm -rf "$WORK"
  if [ -d "$WORK" ]; then echo "[prose] WARNING: kept $WORK -- rm -rf did not remove it"; fi
}
trap cleanup EXIT

# Build and run the gate against a given tree. Prints nothing on success.
#   0 = the gate passed, 1 = the gate FAILED (what a mutation must produce),
#   2 = it did not build (never a pass and never a proof).
run_against() {
  local tree="$1" tag="$2"
  local bin="$WORK/gate_$tag"
  if ! $CXX -std=c++20 -O2 -Wall -Wextra -Werror \
       "-DFORGE_UI_REPO_ROOT=\"$tree\"" \
       -I "$tree/ui/include" -I "$tree/ui/test" \
       "$tree/ui/test/user_facing_text_test.cpp" "$tree"/ui/src/*.cpp \
       -o "$bin" >"$WORK/$tag.build" 2>&1; then
    return 2
  fi
  if "$bin" >"$WORK/$tag.out" 2>&1; then return 0; fi
  return 1
}

# A copy holding exactly what the gate compiles and what it reads.
copy_tree() {
  local dst="$1"
  mkdir -p "$dst/forge-desktop"
  cp -R "$ROOT/ui" "$dst/ui"
  cp -R "$ROOT/forge-desktop/src" "$dst/forge-desktop/src"
}

# ── the clean run comes FIRST ───────────────────────────────────────────────
# Mutations under a gate that is red anyway prove nothing at all.
CLEAN="$WORK/clean"
copy_tree "$CLEAN"
run_against "$CLEAN" clean
CLEAN_RC=$?
if [ "$CLEAN_RC" -eq 2 ]; then
  echo "[prose] RED: the gate does not BUILD"; cat "$WORK/clean.build"; exit 1
fi
if [ "$CLEAN_RC" -ne 0 ]; then
  echo "[prose] RED: the clean run FAILS"; cat "$WORK/clean.out"; exit 1
fi
sed -n '/checks,/p' "$WORK/clean.out"
grep -E '^\[user_facing_text\] ' "$WORK/clean.out" | head -3
echo "[prose] clean run GREEN"

if [ "${1:-}" != "--mutations" ]; then exit 0; fi

# ── the mutations ───────────────────────────────────────────────────────────
FRAME="forge-desktop/src/ForgeFrame.cpp"
CAT="ui/src/PanelCatalog.cpp"
PROFILE="ui/src/WorkspaceProfile.cpp"
TEXT="ui/src/UserFacingText.cpp"

mutate() {
  local n="$1" tree="$WORK/m$1"
  copy_tree "$tree"
  case "$n" in
    1) # the placeholder paragraph, back where it was
       python3 - "$tree/$FRAME" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old='    ImGui::TextWrapped("%s", info->purpose.c_str());'
new='''    ImGui::TextWrapped(
        "Panel is docked and laid out by forge::ui::DockLayout. Its content is not "
        "implemented in this segment.");'''
assert old in s, "mutation 1 anchor missing"
open(p,'w').write(s.replace(old,new,1))
PY
       ;;
    2) # the raw internal detail, back at a text call
       python3 - "$tree/$FRAME" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old='    ImGui::TextWrapped("%s", why.c_str());'
new='    ImGui::TextWrapped("%s", r.error.c_str());'
assert old in s, "mutation 2 anchor missing"
open(p,'w').write(s.replace(old,new,1))
PY
       ;;
    3) # a panel in a shipped workspace that the catalogue has never heard of
       python3 - "$tree/$PROFILE" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old='{"feature_tree", "model_browser"}, {"viewport_3d"},\n                                  {"properties", "measure", "appearance"},'
new='{"feature_tree", "model_browser"}, {"viewport_3d"},\n                                  {"properties", "measure", "flange_wizard"},'
assert old in s, "mutation 3 anchor missing"
open(p,'w').write(s.replace(old,new,1))
PY
       ;;
    4) # a promise the frame builder does not keep
       python3 - "$tree/$CAT" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old='''    {"mates",
     "The mates holding this assembly together, and how many ways each component can still move.",
     PanelContent::Planned},'''
new=old.replace("PanelContent::Planned","PanelContent::Live")
assert old in s, "mutation 4 anchor missing"
open(p,'w').write(s.replace(old,new,1))
PY
       ;;
    5) # a C++ name inside a sentence a user reads
       python3 - "$tree/$CAT" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old='"The mates holding this assembly together, and how many ways each component can still move."'
new='"The mates held by forge::ui::DockLayout for this assembly."'
assert old in s, "mutation 5 anchor missing"
open(p,'w').write(s.replace(old,new,1))
PY
       ;;
    6) # the translator echoes what it was told
       python3 - "$tree/$TEXT" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old='''  return "Forge could not rebuild this part. The shape on screen is the last one that built, "
         "and nothing you have drawn has been lost. " +
         std::string(userFacingDetailPointer());'''
new='''  return "Forge could not rebuild this part: " + detail;'''
assert old in s, "mutation 6 anchor missing"
open(p,'w').write(s.replace(old,new,1))
PY
       ;;
    7) # the scanner finds nothing, ever
       python3 - "$tree/$TEXT" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old='''  std::vector<ProseFinding> out;
  if (text.empty()) return out;'''
new='''  std::vector<ProseFinding> out;
  return out;
  if (text.empty()) return out;'''
assert old in s, "mutation 7 anchor missing"
open(p,'w').write(s.replace(old,new,1))
PY
       ;;
    *) echo "[prose] no such mutation: $n"; return 2 ;;
  esac
  run_against "$tree" "m$n"
  return $?
}

BAD=0
for m in 1 2 3 4 5 6 7; do
  mutate "$m"
  rc=$?
  case "$rc" in
    1) echo "[prose] mutation $m: RED (as required)" ;;
    0) echo "[prose] mutation $m STAYED GREEN -- the check it targets is unfalsifiable"
       BAD=$((BAD + 1)) ;;
    *) echo "[prose] mutation $m DID NOT BUILD -- that is not a proof; fix the mutation"
       sed -n '1,15p' "$WORK/m$m.build" 2>/dev/null
       BAD=$((BAD + 1)) ;;
  esac
done

if [ "$BAD" -ne 0 ]; then
  echo "[prose] RED: $BAD of 7 mutations did not prove the gate can fail"; exit 1
fi
echo "[prose] GREEN -- clean run passes and all 7 mutations proved red"
