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
# WHAT IT DELIBERATELY DOES NOT COVER. Five TUs need a header this gate cannot
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
# ── THE THIRD CLASS: NEEDS NO SDK, NEEDS A PLATFORM ─────────────────────────
# The first draft of this gate had exactly two classes -- "compiles here" and
# "needs an SDK" -- and that is not a partition of the truth. A TU can need no
# SDK at all and still not type-check, because it is written against ONE
# platform's libc. update_gate.cpp is that file: it drives the macOS .app update
# path and calls Apple's SIX-argument
#
#     getxattr(path, name, value, size, position, options)   <sys/xattr.h>
#
# with XATTR_NOFOLLOW. Linux glibc declares a FOUR-argument getxattr and defines
# no XATTR_NOFOLLOW at all, so on a Linux runner the TU fails to compile -- and
# it fails CORRECTLY. MEASURED, not assumed: GitHub run 33462602122 on
# ubuntu-latest printed
#
#     update_gate.cpp:215:85: error: use of undeclared identifier 'XATTR_NOFOLLOW'
#
# while the same commit's macos-15 desktop job compiled and RAN that same gate
# green. The file is not broken; the classification was.
#
# Recording it as an SDK skip would have been a lie, and dropping it from the
# gate would have been the silence this script exists to remove. So there is a
# third list. On Darwin its members are CHECKED like any other TU -- the
# platform that ships the app is the platform that type-checks its updater, and
# desktop-release.yml builds Forge.app on macos-15 and nowhere else. On every
# other host they are skipped BY NAME with the platform requirement printed,
# exactly like an SDK skip. The census counts all three lists, so the routing
# can never become a way to hide a file: a TU dropped from CHECKED and not added
# to another list still turns the gate red.
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
  forge-desktop/src/FileDialog.cpp
  forge-desktop/src/ForgeFrame.cpp
  forge-desktop/src/ImGuiErrorPolicy.cpp
  forge-desktop/src/kernel_worker_main.cpp
  forge-desktop/src/PartFile.cpp
  forge-desktop/src/UpdateService.cpp
  forge-desktop/test/appcast_check.cpp
  forge-desktop/test/copilot_gate.cpp
  forge-desktop/test/document_gate.cpp
  forge-desktop/test/file_dialog_gate.cpp
  forge-desktop/test/file_exchange_gate.cpp
  forge-desktop/test/frame_gate.cpp
  forge-desktop/test/imgui_recovery_gate.cpp
  forge-desktop/test/ir_pipeline_gate.cpp
  forge-desktop/test/isolation_gate.cpp
)
# Needs an SDK this gate does not have. Printed, never silent.
SKIPPED=(
  "forge-desktop/src/KernelScene.cpp     (OCCT: TopoDS_Shape.hxx)"
  "forge-desktop/src/FileExchangeHost.cpp (OCCT: TopoDS_Shape.hxx, reached through forge/IoExchange.hpp -> forge/ShapeRegistry.hpp)"
  "forge-desktop/src/main.cpp            (SDL2 + Vulkan)"
  "forge-desktop/src/PlatformSDL2.cpp    (SDL2)"
  "forge-desktop/src/ViewportRenderer.cpp (Vulkan)"
  "forge-desktop/test/click_gate.cpp     (Vulkan, through its ImGui backend)"
  "forge-desktop/test/differential_solid_gate.cpp (OCCT: TopoDS_Shape.hxx, reached through forge/Topology.hpp -> forge/ShapeRegistry.hpp)"
  "forge-desktop/src/FileDialogMac.mm    (AppKit + UniformTypeIdentifiers, and it is Objective-C++: -x objective-c++, not a C++ TU)"
  "forge-desktop/test/panel_probe.mm     (AppKit + UniformTypeIdentifiers; run it with test/run_panel_probe.sh, which builds it under the same -Wall -Wextra -Werror this gate would)"
)
# Needs NO SDK, but is written against ONE platform's libc. Checked on that
# platform, skipped by name everywhere else. See the header for the measurement.
# Two parallel arrays rather than one "path (reason)" string, because these
# paths are handed to the compiler on Darwin and a reason glued to a path is not
# a path. bash 3.2 has no associative arrays; index i pairs them.
DARWIN_ONLY=(
  forge-desktop/test/update_gate.cpp
)
DARWIN_ONLY_WHY=(
  "macOS libc: getxattr(..., XATTR_NOFOLLOW), Apple's 6-argument form"
)
if [ "${#DARWIN_ONLY[@]}" -ne "${#DARWIN_ONLY_WHY[@]}" ]; then
  echo "[syntax] RED: DARWIN_ONLY has ${#DARWIN_ONLY[@]} paths but ${#DARWIN_ONLY_WHY[@]} reasons"
  exit 1
fi

# uname is the HOST. It is the right question here: this gate type-checks with
# the host's own headers and does not cross-compile, so what the host's libc
# declares is exactly what determines whether the TU can be checked.
HOST_OS="$(uname -s 2>/dev/null || echo unknown)"
PLATFORM_SKIPPED=()
_i=0
while [ "$_i" -lt "${#DARWIN_ONLY[@]}" ]; do
  # A path that does not exist would be skipped BY NAME on Linux for a name
  # nothing has, while the real TU stayed unclassified -- and the census would
  # still balance, because one phantom entry offsets one missing one. That is a
  # gate that passes while a file goes unchecked. Assert the file is real.
  if [ ! -f "${DARWIN_ONLY[$_i]}" ]; then
    echo "[syntax] RED: DARWIN_ONLY names ${DARWIN_ONLY[$_i]}, which does not exist"
    exit 1
  fi
  if [ "$HOST_OS" = "Darwin" ]; then
    CHECKED+=("${DARWIN_ONLY[$_i]}")
  else
    PLATFORM_SKIPPED+=("${DARWIN_ONLY[$_i]}  (needs Darwin -- ${DARWIN_ONLY_WHY[$_i]})")
  fi
  _i=$(( _i + 1 ))
done

# ── the census, so a new TU cannot join forge-desktop unnoticed ──────────────
# `find | wc -l` on a path that does not exist prints 0 and the comparison would
# then read as "nothing new", which is the zero-that-arrives-too-fast failure.
# Assert the directory first.
[ -d forge-desktop/src ] || { echo "[syntax] forge-desktop/src is missing"; exit 1; }
# .mm AS WELL AS .cpp. The census existed so that a new translation unit must be
# classified rather than absorbed, and an Objective-C++ file is a translation
# unit: counting only *.cpp would have let src/FileDialogMac.mm -- the one file
# that opens a window -- join forge-desktop with nothing saying so.
PRESENT="$(find forge-desktop/src forge-desktop/test -maxdepth 1 \
                \( -name '*.cpp' -o -name '*.mm' \) | sort)"
PRESENT_N="$(printf '%s\n' "$PRESENT" | grep -cE '\.(cpp|mm)$')"
# All THREE lists, so the platform routing cannot become a way to hide a file.
# CHECKED has already absorbed DARWIN_ONLY on Darwin, so counting both there
# would double-count; PLATFORM_SKIPPED is non-empty exactly when it did not.
CLASSIFIED_N=$(( ${#CHECKED[@]} + ${#SKIPPED[@]} + ${#PLATFORM_SKIPPED[@]} ))
if [ "$PRESENT_N" -ne "$CLASSIFIED_N" ]; then
  echo "[syntax] RED: forge-desktop/{src,test} holds $PRESENT_N .cpp files but this gate"
  echo "[syntax]      classifies $CLASSIFIED_N. A new translation unit must be added to"
  echo "[syntax]      CHECKED (it compiles here), to SKIPPED (with the SDK it needs), or"
  echo "[syntax]      to DARWIN_ONLY (needs no SDK, needs one platform's libc)."
  echo "[syntax]      present:"
  printf '%s\n' "$PRESENT" | sed 's/^/[syntax]        /'
  exit 1
fi

echo "[syntax] CXX=$CXX  host=$HOST_OS  ${#CHECKED[@]} translation units, ${#SKIPPED[@]} skipped for a missing SDK, ${#PLATFORM_SKIPPED[@]} skipped for the platform"
for s in "${SKIPPED[@]}"; do echo "[syntax]   skipped: $s"; done
for s in "${PLATFORM_SKIPPED[@]:-}"; do
  [ -n "$s" ] && echo "[syntax]   skipped: $s"
done
if [ "$HOST_OS" = "Darwin" ] && [ "${#DARWIN_ONLY[@]}" -gt 0 ]; then
  echo "[syntax]   host is Darwin: ${#DARWIN_ONLY[@]} platform-gated TU(s) are CHECKED, not skipped"
fi

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
