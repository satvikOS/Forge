#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_syntax_gate.sh — DOES forge-desktop/src STILL PARSE AND TYPE-CHECK?
#
# THE DEFECT THIS EXISTS FOR, MEASURED TWICE.
#
#   #107   KernelScene.cpp called scene_.features(), a method that did not
#          exist. The application was un-buildable for hours and every check
#          stayed green.
#   2026-08-31  forge::ui::DocumentHost grew a PURE virtual (documentReset) and
#          ForgeFrame, the app's only DocumentHost, did not implement it. `class
#          ForgeFrame final` therefore named an abstract class:
#            ForgeFrame.hpp:96:7: error: abstract class is marked 'final'
#          Again un-buildable, again with every headless gate green — they build
#          ui/src and ui/test and never touch forge-desktop/src.
#
# The `desktop` CI job DOES compile the application and would catch both. It also
# installs OCCT, builds forge_kernel_core, links ImGui and runs six gates under a
# sanitizer: minutes, and a runner with an SDK on it. That cost is why it sits in
# the expensive job, and why a whole class of "the app does not build" defects
# reaches CI later than it needs to — and cannot be checked at all on a developer
# machine that must not spend gigabytes.
#
# THIS gate is the cheap half. It runs `-fsyntax-only` — parse, template
# instantiation and full type checking, NO code generation, NO linking — over
# every forge-desktop translation unit that needs no external SDK. MEASURED on an
# M-series laptop: 0.53 s and 151 MB peak RSS for ForgeFrame.cpp, the largest of
# them. It needs clang++ and the repository, nothing else: Dear ImGui is vendored
# in-tree, forge::ui is header-plus-source in-tree, and KernelScene.hpp includes
# nothing but the standard library and forge/ui.
#
# WHAT IT DELIBERATELY DOES NOT COVER. Four TUs need a header this gate cannot
# supply and are SKIPPED BY NAME, never by a silent glob:
#   KernelScene.cpp     OCCT   (TopoDS_Shape.hxx)
#   main.cpp            SDL2 + Vulkan
#   PlatformSDL2.cpp    SDL2
#   ViewportRenderer.cpp  Vulkan
#   click_gate.cpp      Vulkan (through its ImGui backend include)
# A gate that quietly skipped a file it could not compile would be the same
# silence it was written to remove, so the skip list is printed on every run and
# the file count is asserted: a TU added to forge-desktop/src joins the checked
# set or the gate goes red asking why.
#
# Exit 0 iff every checked TU type-checks warning-clean under -Wall -Wextra
# -Werror. --mutate <n> injects a defect to prove the gate can fail.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="${FORGE_DESKTOP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}" || {
  echo "[syntax] cannot resolve the repo root"; exit 1; }
[ -n "$ROOT" ] || { echo "[syntax] repo root resolved to the empty string"; exit 1; }
cd "$ROOT" || { echo "[syntax] cannot enter repo root $ROOT"; exit 1; }

CXX="${CXX:-clang++}"
command -v "$CXX" >/dev/null 2>&1 || { echo "[syntax] no $CXX on PATH"; exit 1; }

MUTATE=0
PROVE=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --mutate) MUTATE="${2:-0}"; shift 2 ;;
    --mutations) PROVE=1; shift ;;
    *) echo "[syntax] unknown argument: $1"; exit 1 ;;
  esac
done

# ── --mutations: run the gate clean, then prove every mutation turns it red ──
# A gate that has never been seen to fail is indistinguishable from silence, and
# both defects this gate exists for produced exactly that: green everywhere,
# application un-buildable. The clean run is asserted FIRST -- three red
# mutations under a gate that is red anyway prove nothing.
if [ "$PROVE" -eq 1 ]; then
  SELF="${BASH_SOURCE[0]}"
  if ! bash "$SELF" >/dev/null 2>&1; then
    echo "[syntax] RED: the CLEAN run does not pass; the mutation proof would be meaningless"
    bash "$SELF"
    exit 1
  fi
  echo "[syntax] clean run GREEN; proving the gate can fail"
  PROVE_BAD=0
  for m in 1 2 3; do
    if bash "$SELF" --mutate "$m" >/dev/null 2>&1; then
      echo "[syntax] mutation $m STAYED GREEN — the check it targets is unfalsifiable"
      PROVE_BAD=$((PROVE_BAD + 1))
    else
      echo "[syntax] mutation $m: RED (as required)"
    fi
  done
  if [ "$PROVE_BAD" -ne 0 ]; then
    echo "[syntax] RED: $PROVE_BAD mutation(s) did not turn the gate red"
    exit 1
  fi
  echo "[syntax] GREEN -- gate passes clean and all 3 mutations proved red"
  exit 0
fi

INC="-I forge-desktop/src -I forge-desktop/third_party/imgui -I ui/include -I forge-desktop/test"
INC="$INC -I forge-kernel/include"
FLAGS="-std=c++20 -Wall -Wextra -Werror -fsyntax-only"

# The TUs this gate checks. EXPLICIT, not a glob: the skipped four are skipped
# for a stated reason and a new file must be classified rather than absorbed.
CHECKED=(
  forge-desktop/src/Camera.cpp
  forge-desktop/src/ForgeFrame.cpp
  forge-desktop/src/kernel_worker_main.cpp
  forge-desktop/src/PartFile.cpp
  forge-desktop/src/UpdateService.cpp
  forge-desktop/test/appcast_check.cpp
  forge-desktop/test/copilot_gate.cpp
  forge-desktop/test/document_gate.cpp
  forge-desktop/test/frame_gate.cpp
  forge-desktop/test/ir_pipeline_gate.cpp
  forge-desktop/test/isolation_gate.cpp
  forge-desktop/test/update_gate.cpp
)
# Needs an SDK this gate does not have. Printed, never silent.
SKIPPED=(
  "forge-desktop/src/KernelScene.cpp     (OCCT: TopoDS_Shape.hxx)"
  "forge-desktop/src/main.cpp            (SDL2 + Vulkan)"
  "forge-desktop/src/PlatformSDL2.cpp    (SDL2)"
  "forge-desktop/src/ViewportRenderer.cpp (Vulkan)"
  "forge-desktop/test/click_gate.cpp     (Vulkan, through its ImGui backend)"
)

# ── the census, so a new TU cannot join forge-desktop unnoticed ──────────────
# `find | wc -l` on a path that does not exist prints 0 and the comparison would
# then read as "nothing new", which is the zero-that-arrives-too-fast failure.
# Assert the directory first.
[ -d forge-desktop/src ] || { echo "[syntax] forge-desktop/src is missing"; exit 1; }
PRESENT="$(find forge-desktop/src forge-desktop/test -maxdepth 1 -name '*.cpp' | sort)"
PRESENT_N="$(printf '%s\n' "$PRESENT" | grep -c '\.cpp$')"
CLASSIFIED_N=$(( ${#CHECKED[@]} + ${#SKIPPED[@]} ))
if [ "$PRESENT_N" -ne "$CLASSIFIED_N" ]; then
  echo "[syntax] RED: forge-desktop/{src,test} holds $PRESENT_N .cpp files but this gate"
  echo "[syntax]      classifies $CLASSIFIED_N. A new translation unit must be added to"
  echo "[syntax]      CHECKED (it compiles here) or to SKIPPED (with the SDK it needs)."
  echo "[syntax]      present:"
  printf '%s\n' "$PRESENT" | sed 's/^/[syntax]        /'
  exit 1
fi

echo "[syntax] CXX=$CXX  ${#CHECKED[@]} translation units, ${#SKIPPED[@]} skipped for a missing SDK"
for s in "${SKIPPED[@]}"; do echo "[syntax]   skipped: $s"; done

# ── the mutation ────────────────────────────────────────────────────────────
# Injected into a COPY of the tree, never into the working tree: a gate that
# edits the sources it is checking is one interrupted run away from leaving a
# defect behind. Mutation 1 removes an override of a pure virtual, which is
# exactly the defect of 2026-08-31; mutation 2 calls a method that does not
# exist, which is exactly #107.
WORK=""
cleanup() {
  if [ -n "$WORK" ] && [ -d "$WORK" ]; then
    rm -rf "$WORK"
    [ -d "$WORK" ] && echo "[syntax] WARNING: kept $WORK -- rm -rf did not remove it"
  fi
}
trap cleanup EXIT

if [ "$MUTATE" -ne 0 ]; then
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/forge_syntax_mut.XXXXXX")" || {
    echo "[syntax] cannot make a scratch tree"; exit 1; }
  mkdir -p "$WORK/forge-desktop" "$WORK/ui" "$WORK/forge-kernel"
  cp -R forge-desktop/src forge-desktop/test forge-desktop/third_party "$WORK/forge-desktop/" || {
    echo "[syntax] cannot copy forge-desktop"; exit 1; }
  cp -R ui/include "$WORK/ui/" || { echo "[syntax] cannot copy ui/include"; exit 1; }
  cp -R forge-kernel/include "$WORK/forge-kernel/" || {
    echo "[syntax] cannot copy forge-kernel/include"; exit 1; }
  case "$MUTATE" in
    1)
      # Drop ForgeFrame's documentReset override: DocumentHost keeps the pure
      # virtual, so ForgeFrame becomes abstract and is marked final.
      perl -0pi -e 's/^\s*bool documentReset\(std::string& error\) override;\n//m' \
        "$WORK/forge-desktop/src/ForgeFrame.hpp" || true
      ;;
    2)
      # Call a method that does not exist -- #107, reproduced.
      perl -0pi -e 's/void ForgeFrame::note\(const std::string& line\) \{/void ForgeFrame::note(const std::string\& line) {\n  (void)scene_.thisMethodDoesNotExist();/' \
        "$WORK/forge-desktop/src/ForgeFrame.cpp" || true
      ;;
    3)
      # A warning, not an error: -Werror is what makes it fail, and a gate that
      # dropped -Werror would go green on it.
      perl -0pi -e 's/void ForgeFrame::note\(const std::string& line\) \{/void ForgeFrame::note(const std::string\& line) {\n  int unusedOnPurpose = 1;/' \
        "$WORK/forge-desktop/src/ForgeFrame.cpp" || true
      ;;
    *)
      echo "[syntax] no such mutation: $MUTATE"; exit 1 ;;
  esac
  cd "$WORK" || { echo "[syntax] cannot enter $WORK"; exit 1; }
  echo "[syntax] MUTATION $MUTATE ACTIVE (in a copy at $WORK)"
fi

BAD=0
OK=0
for f in "${CHECKED[@]}"; do
  if [ ! -f "$f" ]; then
    echo "[syntax] RED: $f is not there -- a check that cannot run is not a check that passed"
    BAD=$((BAD + 1))
    continue
  fi
  # shellcheck disable=SC2086
  if $CXX $FLAGS $INC "$f" 2>"${TMPDIR:-/tmp}/forge_syntax.err"; then
    echo "[syntax]   OK   $f"
    OK=$((OK + 1))
  else
    echo "[syntax]   FAIL $f"
    head -20 "${TMPDIR:-/tmp}/forge_syntax.err" | sed 's/^/[syntax]        /'
    BAD=$((BAD + 1))
  fi
done

if [ "$BAD" -ne 0 ]; then
  echo "[syntax] RED: $BAD of $((OK + BAD)) translation units do not type-check"
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "::error::forge-desktop does not type-check; the application is un-buildable on this commit"
  fi
  exit 1
fi
echo "[syntax] GREEN -- all $OK forge-desktop translation units type-check (-Wall -Wextra -Werror)"
