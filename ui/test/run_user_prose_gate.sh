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
# -- THE SIX THE FIRST VERSION OF THIS SCRIPT COULD NOT PROVE ----------------
# Every mutation above was still red on the day a live leak was on screen,
# because each targets a check that was working. These target the six holes:
#
#   8  ToolEntry::reason back to the STATUS CODE                       -> check K
#      THE ACTUAL DEFECT. "selection_signature_mismatch: 1..n edge
#      (homogeneous)", on 51 of the 84 shipped commands, on the menu tooltip and
#      in every panel command list -- while check F scanned that exact field, by
#      name, on every command, and passed.
#   9  a command id drawn on every palette row                         -> check I
#  10  "an OCCT fault" back in an activity-log MESSAGE                 -> check H
#  11  a C++ class name back in the CoPilot header                     -> check D
#      (CamelCase with no "::" and no underscore: invisible to the old scanner)
#  12  a leak in a file the OLD four-name source list never read       -> check D
#  13  userText(DispatchStatus) forwarding to machineName()            -> check J
#
# 7 is still the one that matters most. Every other check in that file is an
# application of scanUserFacingProse(); if it could be emptied and the gate stay
# green, all the others would be decoration.
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
TOOLS="ui/src/ToolCatalog.cpp"
PLATFORM="forge-desktop/src/PlatformSDL2.cpp"
REG="ui/src/CommandRegistry.cpp"

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
  if (raw.empty()) return out;'''
new='''  std::vector<ProseFinding> out;
  return out;
  if (raw.empty()) return out;'''
assert old in s, "mutation 7 anchor missing"
open(p,'w').write(s.replace(old,new,1))
PY
       ;;
    8) # THE DEFECT: the status code back on the field every surface draws
       python3 - "$tree/$TOOLS" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old='      e.reason = explainUnavailable(id, d, verdict.status, verdict.detail, e.missing, &selection);'
new='      e.reason = std::string(machineName(verdict.status)) + (verdict.detail.empty() ? std::string() : (": " + verdict.detail));'
assert old in s, "mutation 8 anchor missing"
open(p,'w').write(s.replace(old,new,1))
PY
       ;;
    9) # a command id drawn on every palette row
       python3 - "$tree/$FRAME" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old='      ImGui::TextDisabled("%s", item.category.c_str());'
new='      ImGui::TextDisabled("%s", item.commandId.c_str());'
assert old in s, "mutation 9 anchor missing"
open(p,'w').write(s.replace(old,new,1))
PY
       ;;
    10) # a library name back in a log MESSAGE (argument 1, which is drawn)
       python3 - "$tree/$FRAME" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old='"operation fails badly, you lose that operation and nothing else \u2014 "'
new='"operation fails badly, an OCCT fault loses that operation and nothing else \u2014 "'
assert old in s, "mutation 10 anchor missing"
open(p,'w').write(s.replace(old,new,1))
PY
       ;;
    11) # a bare CamelCase class name: no "::", no underscore, no vk prefix
       python3 - "$tree/$FRAME" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old='copilotAutoPlan_ ? "Working offline, on this computer"'
new='copilotAutoPlan_ ? "LocalPlanner (offline, deterministic)"'
assert old in s, "mutation 11 anchor missing"
open(p,'w').write(s.replace(old,new,1))
PY
       ;;
    12) # a leak in a file the source list never named
       #
       # MEASURED, and it is a LATENT hole rather than a live one: of the 28
       # files under forge-desktop/src, exactly two hold a call that puts
       # characters on a user's screen today, and the old four-name list had
       # both. It also had two files with no text call in them at all
       # (ViewportRenderer.cpp, KernelScene.cpp) and did not have the other 24.
       # So this mutation does not restore a leak that was shipping; it proves
       # the WALK -- that a text call added to any file in the directory is
       # scanned, which under a hand-written list of four names it was not.
       python3 - "$tree/$PLATFORM" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
anchor = "  ImGuiIO& io = ImGui::GetIO();"
assert anchor in s, "mutation 12 anchor missing"
leak = anchor + chr(10) + '  ImGui::TextUnformatted("forge::ui::DockLayout is not implemented in this segment");'
open(p,'w').write(s.replace(anchor, leak, 1))
PY
       ;;
    13) # userText forwards to the machine spelling
       python3 - "$tree/$REG" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old="""const char* userText(DispatchStatus status) noexcept {
  switch (status) {"""
new="""const char* userText(DispatchStatus status) noexcept {
  return machineName(status);
  switch (status) {"""
assert old in s, "mutation 13 anchor missing"
open(p,'w').write(s.replace(old,new,1))
PY
       ;;
    *) echo "[prose] no such mutation: $n"; return 2 ;;
  esac
  run_against "$tree" "m$n"
  return $?
}

BAD=0
for m in 1 2 3 4 5 6 7 8 9 10 11 12 13; do
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
  echo "[prose] RED: $BAD of 13 mutations did not prove the gate can fail"; exit 1
fi
echo "[prose] GREEN -- clean run passes and all 13 mutations proved red"
