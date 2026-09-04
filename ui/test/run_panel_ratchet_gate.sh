#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_panel_ratchet_gate.sh — PROVE THE EMPTY-PANEL RATCHET CAN FAIL.
#
# ui/test/run_ui.sh already builds and runs panel_content_ratchet_test on every
# push (it globs ui/test/*_test.cpp). This script is the other half, and it is
# the half that decides whether the ratchet is worth anything: a pin nobody has
# ever SEEN go red is indistinguishable from a pin that cannot.
#
# The ratchet's own Section A proves its COMPARISON fires, with synthetic input.
# That is not the same claim as this one. Here every mutation is made in the REAL
# sources — the workspace layouts, the panel catalogue, the frame builder's own
# dispatch and the pin itself — so what is proved is that the gate is wired to
# the things it claims to watch.
#
#   1  a new workspace tab with no content         -> RED (the regression)
#   2  a pinned empty panel gains content          -> RED (the improvement half)
#   3  a panel that HAD content loses its dispatch -> RED (content going backwards)
#   4  the catalogue alone declares a panel done   -> RED (the one-word loophole)
#   5  the pin is padded with an extra id          -> RED (a pin above the truth)
#   6  an edit naming no panel                     -> GREEN (the true control)
#
# 6 is not optional. Without it, 1-5 would pass just as well over a gate that
# went red at any edit whatsoever.
#
# Each mutation runs against a COPY of the tree, so nothing edits the working
# checkout. A mutation that fails to COMPILE is reported as a broken mutation,
# never as a red gate -- "it did not build" is not "the check fired".
#
# Usage: bash ui/test/run_panel_ratchet_gate.sh [--mutations]
#        (no argument = the clean run only)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || {
  echo "[panel-ratchet] cannot resolve the repo root"; exit 1; }
[ -n "$ROOT" ] || { echo "[panel-ratchet] repo root resolved to the empty string"; exit 1; }
cd "$ROOT" || { echo "[panel-ratchet] cannot enter repo root $ROOT"; exit 1; }

CXX="${CXX:-clang++}"
command -v "$CXX" >/dev/null 2>&1 || { echo "[panel-ratchet] no $CXX on PATH"; exit 1; }
command -v python3 >/dev/null 2>&1 || {
  echo "[panel-ratchet] no python3 on PATH; the mutations are applied with it"; exit 1; }

WORK="$(mktemp -d /tmp/forge_panel_ratchet.XXXXXX)"
cleanup() {
  rm -rf "$WORK"
  if [ -d "$WORK" ]; then
    echo "[panel-ratchet] WARNING: kept $WORK -- rm -rf did not remove it"
  fi
}
trap cleanup EXIT

# 0 = the gate passed, 1 = the gate FAILED (what a mutation must produce),
# 2 = it did not build (never a pass and never a proof).
run_against() {
  local tree="$1" tag="$2"
  local bin="$WORK/gate_$tag"
  if ! $CXX -std=c++20 -O2 -Wall -Wextra -Werror \
       "-DFORGE_UI_REPO_ROOT=\"$tree\"" \
       -I "$tree/ui/include" -I "$tree/ui/test" \
       "$tree/ui/test/panel_content_ratchet_test.cpp" "$tree"/ui/src/*.cpp \
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
  echo "[panel-ratchet] RED: the gate does not BUILD"; cat "$WORK/clean.build"; exit 1
fi
if [ "$CLEAN_RC" -ne 0 ]; then
  echo "[panel-ratchet] RED: the clean run FAILS -- the pin and the measurement disagree"
  cat "$WORK/clean.out"; exit 1
fi
grep -E '^\[panel-ratchet\] [0-9]' "$WORK/clean.out"
sed -n '/checks,/p' "$WORK/clean.out"
echo "[panel-ratchet] clean run GREEN"

if [ "${1:-}" != "--mutations" ]; then exit 0; fi

# ── the mutations ───────────────────────────────────────────────────────────
FRAME="forge-desktop/src/ForgeFrame.cpp"
CAT="ui/src/PanelCatalog.cpp"
PROFILE="ui/src/WorkspaceProfile.cpp"
PIN="ui/test/panel_content_ratchet_test.cpp"

mutate() {
  local n="$1" tree="$WORK/m$1"
  copy_tree "$tree"
  case "$n" in
    1) # A NEW workspace tab that draws nothing and is in no catalogue.
       python3 - "$tree/$PROFILE" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old='{"mates", "interference", "properties"}'
new='{"mates", "interference", "flange_wizard"}'
assert old in s, "mutation 1 anchor missing"
open(p,'w').write(s.replace(old,new,1))
PY
       ;;
    2) # A pinned empty panel GAINS content: dispatched and declared Live.
       python3 - "$tree/$FRAME" "$tree/$CAT" "$tree/$PIN" <<'PY'
import sys, re
fp,cp,pp=sys.argv[1],sys.argv[2],sys.argv[3]
# ── DO NOT HARD-CODE A PANEL NAME ──────────────────────────────────────────
# This named "mates", and stopped applying the moment that panel was
# IMPLEMENTED: the anchor still matched the dispatch, the catalogue row was
# already Live, so the "mutation" changed nothing and the harness reported the
# check as unfalsifiable -- accusing the branch that did the work. The same
# lesson ui/test/run_user_prose_gate.sh learned (archdisc a7789601).
#
# The id is taken from THE PIN, which is by construction the set of panels this
# gate has MEASURED as empty and which appear in a shipped workspace. Whichever
# panel is implemented next, this still selects one that is genuinely empty.
pin=open(pp).read()
block=re.search(r'kPinnedEmptyPanels\[\] = \{(.*?)\};', pin, re.S)
assert block, "cannot find kPinnedEmptyPanels"
ids=re.findall(r'"([a-z_]+)"', block.group(1))
assert ids, "the pin is EMPTY -- if no panel is empty this mutation needs rethinking, not deleting"
pid=ids[0]
s=open(fp).read()
old='  } else if (panelId == "curve_list") {'
new='  } else if (panelId == "%s") {\n    drawCurveListPanel();\n  } else if (panelId == "curve_list") {' % pid
assert old in s, "mutation 2 frame anchor missing"
open(fp,'w').write(s.replace(old,new,1))
c=open(cp).read()
row=re.search(r'\{"%s",\n(?:[^\n]*\n)*?\s*PanelContent::Planned\},' % pid, c)
assert row, "pinned panel %s is not a Planned catalogue row" % pid
open(cp,'w').write(c.replace(row.group(0), row.group(0).replace("PanelContent::Planned","PanelContent::Live"),1))
PY
       ;;
    3) # A panel that HAD content loses its dispatch: content going backwards.
       python3 - "$tree/$FRAME" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old='  } else if (panelId == "curve_list") {\n    drawCurveListPanel();\n'
assert old in s, "mutation 3 anchor missing"
open(p,'w').write(s.replace(old,'',1))
PY
       ;;
    4) # THE ONE-WORD LOOPHOLE: the catalogue declares a panel finished while the
       # frame builder still draws nothing for it. If this stayed green the pin
       # could be lowered by editing a sentence.
       python3 - "$tree/$CAT" "$tree/$PIN" <<'PY'
import sys, re
cp,pp=sys.argv[1],sys.argv[2]
# Same rule as mutation 2: this named "bom", and was disarmed the moment that
# panel became Live -- the anchor no longer matched, so nothing was mutated and
# the loophole went untested. Select from the pin instead.
pin=open(pp).read()
block=re.search(r'kPinnedEmptyPanels\[\] = \{(.*?)\};', pin, re.S)
assert block, "cannot find kPinnedEmptyPanels"
ids=re.findall(r'"([a-z_]+)"', block.group(1))
assert ids, "the pin is EMPTY -- if no panel is empty this mutation needs rethinking, not deleting"
pid=ids[0]
s=open(cp).read()
row=re.search(r'\{"%s",\n(?:[^\n]*\n)*?\s*PanelContent::Planned\},' % pid, s)
assert row, "pinned panel %s is not a Planned catalogue row" % pid
open(cp,'w').write(s.replace(row.group(0), row.group(0).replace("PanelContent::Planned","PanelContent::Live"),1))
PY
       ;;
    5) # THE PIN PADDED with a panel that is not empty. A pin allowed to sit
       # above the truth can absorb a future regression in silence.
       python3 - "$tree/$PIN" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old='    "annotation",\n'
assert old in s, "mutation 5 anchor missing"
open(p,'w').write(s.replace(old, old+'    "measure",\n',1))
PY
       ;;
    6) # TRUE CONTROL: an edit that names no panel at all must leave the verdict
       # alone. Without this the five cases above would pass over a gate that
       # simply reacts to any edit.
       python3 - "$tree/$CAT" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old='namespace forge::ui {'
assert old in s, "control anchor missing"
open(p,'w').write(s.replace(old, old+'\n\n// An edit that names nothing.\n',1))
PY
       ;;
    *) echo "[panel-ratchet] no such mutation: $n"; return 3 ;;
  esac
  run_against "$tree" "m$n"
  return $?
}

BAD=0
for m in 1 2 3 4 5; do
  mutate "$m"
  rc=$?
  case "$rc" in
    1) echo "[panel-ratchet] mutation $m: RED (as required)"
       grep -E '  RED|disagree' "$WORK/m$m.out" | head -3 | sed 's/^/        /' ;;
    0) echo "[panel-ratchet] mutation $m STAYED GREEN -- the ratchet does not watch what it claims"
       BAD=$((BAD + 1)) ;;
    *) echo "[panel-ratchet] mutation $m DID NOT BUILD -- that is not a proof; fix the mutation"
       sed -n '1,15p' "$WORK/m$m.build" 2>/dev/null
       BAD=$((BAD + 1)) ;;
  esac
done

mutate 6
rc=$?
if [ "$rc" -eq 0 ]; then
  echo "[panel-ratchet] control: GREEN (as required) -- the gate reacts to panels, not to edits"
else
  echo "[panel-ratchet] CONTROL FAILED (exit $rc) -- the gate goes red at any edit, so the five"
  echo "[panel-ratchet] cases above prove nothing about panels"
  sed -n '1,15p' "$WORK/m6.out" "$WORK/m6.build" 2>/dev/null
  BAD=$((BAD + 1))
fi

if [ "$BAD" -ne 0 ]; then
  echo "[panel-ratchet] RED: $BAD of 6 cases did not prove the ratchet can fail"; exit 1
fi
echo "[panel-ratchet] GREEN -- clean run passes, all 5 mutations red, control green"
