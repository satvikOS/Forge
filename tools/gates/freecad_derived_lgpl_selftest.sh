#!/usr/bin/env bash
# freecad_derived_lgpl_selftest.sh — prove freecad_derived_lgpl_gate.sh FAILS
# where it claims to.
#
# Copies the parts of this tree the gate reads into a scratch directory, confirms
# the copy is GREEN (the control), then injects one defect per case into a fresh
# copy and requires the gate to go RED with the sentence that names that defect.
# Never touches the checkout. A gate nobody has seen fail is indistinguishable
# from one that cannot.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || exit 2
GATE="$ROOT/tools/gates/freecad_derived_lgpl_gate.sh"
[ -f "$GATE" ] || { echo "[lgpl-selftest] $GATE is missing"; exit 2; }
WORK="$(mktemp -d "${TMPDIR:-/tmp}/forge_lgpl_self.XXXXXX")" || exit 2
trap 'rm -rf "$WORK"' EXIT

make_tree() {  # make_tree <dest>
  local d="$1"
  mkdir -p "$d/third_party" "$d/forge-desktop" "$d/forge-kernel" "$d/tools/gates"
  cp -R "$ROOT/third_party/freecad-derived" "$d/third_party/freecad-derived"
  cp -R "$ROOT/third_party/licenses" "$d/third_party/licenses"
  cp "$ROOT/forge-desktop/CMakeLists.txt" "$ROOT/forge-desktop/package_macos.sh" "$d/forge-desktop/"
  cp "$ROOT/forge-kernel/CMakeLists.txt" "$d/forge-kernel/"
  # Not a git checkout: the gate's L8 scan falls back to find, which is what a
  # tarball of the source looks like too.
}

# edit <file> <old> <new>: an exact, single replacement, or the case is invalid
edit() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path, encoding="utf-8", errors="surrogateescape").read()
if text.count(old) != 1:
    sys.stderr.write("selftest anchor found %d times in %s: %r\n" % (text.count(old), path, old))
    sys.exit(3)
open(path, "w", encoding="utf-8", errors="surrogateescape").write(text.replace(old, new))
PY
}

PASS=0
FAILN=0
case_() {  # case_ <label> <regex the RED output must match> <setup commands...>
  local label="$1" want="$2"; shift 2
  local d="$WORK/$label"
  make_tree "$d"
  if ! ( cd "$d" && "$@" ); then
    echo "  INVALID $label -- the defect could not be injected"
    FAILN=$((FAILN + 1))
    return
  fi
  local out rc
  out="$(cd /tmp && FORGE_LGPL_ROOT="$d" GITHUB_ACTIONS= bash "$GATE" 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -qE "$want"; then
    printf '  ok    %-34s RED as required\n' "$label"
    PASS=$((PASS + 1))
  else
    printf '  FAIL  %-34s rc=%s (wanted RED matching /%s/)\n' "$label" "$rc" "$want"
    printf '%s\n' "$out" | sed 's/^/          | /' | head -12
    FAILN=$((FAILN + 1))
  fi
}

X="third_party/freecad-derived/expressions"

echo "[lgpl-selftest] driving freecad_derived_lgpl_gate.sh's red paths"

# the control
make_tree "$WORK/control"
if out="$(FORGE_LGPL_ROOT="$WORK/control" GITHUB_ACTIONS= bash "$GATE" 2>&1)"; then
  echo "  ok    control                            GREEN"
  PASS=$((PASS + 1))
else
  echo "  FAIL  control -- the unmodified copy is not GREEN; every case below would be meaningless"
  printf '%s\n' "$out" | sed 's/^/          | /'
  exit 1
fi

case_ no_copying        'has no COPYING.LGPL'            rm "$X/COPYING.LGPL"
case_ wrong_licence     'not the complete GNU LGPL 2.1'  sh -c "printf 'MIT License\n' > $X/COPYING.LGPL"
case_ no_modifications  'has no MODIFICATIONS.md'        rm "$X/MODIFICATIONS.md"
case_ undated_changes   'no dated change entry'          edit "$X/MODIFICATIONS.md" '### 2026-09-15 — initial adaptation (ArchDisc)' '### initial adaptation'
case_ no_notice         'has no NOTICE'                  rm "$X/NOTICE"
case_ no_notice_section "has no '## expressions' section" edit third_party/freecad-derived/THIRD_PARTY_NOTICES.md '## expressions' '## something else'
case_ no_manifest_entry 'has no component whose path'    edit third_party/freecad-derived/manifest.json '"path": "third_party/freecad-derived/expressions"' '"path": "third_party/freecad-derived/elsewhere"'
case_ spdx_stripped     'no SPDX LGPL-2.1 header'        edit "$X/src/Unit.cpp" '// SPDX-License-Identifier: LGPL-2.1-or-later' '// (header removed)'
case_ change_unmarked   "says neither 'MODIFIED for"     edit "$X/src/Unit.cpp" 'MODIFIED for libforge_expr (2026-09-15)' 'Adapted for Forge'
case_ occt_include      'includes a forbidden header'    edit "$X/src/Quantity.cpp" '#include <array>' '#include <array>
#include <TopoDS_Shape.hxx>'
case_ qt_include        'includes a forbidden header'    edit "$X/src/Expression.cpp" '#include <cerrno>' '#include <cerrno>
#include <QString>'
case_ python_include    'includes a forbidden header'    edit "$X/src/Evaluator.cpp" '#include <cctype>' '#include <cctype>
#include <Python.h>'
case_ static_library    'does not build forge_expr as add_library'  edit "$X/CMakeLists.txt" 'add_library(forge_expr SHARED' 'add_library(forge_expr STATIC'
case_ compiled_into_app 'LGPL source compiled outside'   edit forge-desktop/CMakeLists.txt '"${CMAKE_CURRENT_SOURCE_DIR}/src/ExpressionHost.cpp"' '"${CMAKE_CURRENT_SOURCE_DIR}/src/ExpressionHost.cpp"
    "${FORGE_ROOT}/third_party/freecad-derived/expressions/src/Expression.cpp"'
case_ core_links_it     'forge_desktop_core links forge_expr' edit forge-desktop/CMakeLists.txt 'target_link_libraries(forge_desktop_core PUBLIC forge_ui forge_imgui' 'target_link_libraries(forge_desktop_core PUBLIC forge_ui forge_imgui forge_expr'
case_ app_not_linked    'does not link forge_desktop against' edit forge-desktop/CMakeLists.txt 'forge_desktop_render forge_updater forge_expr' 'forge_desktop_render forge_updater'
case_ packager_forgets  'does not stage the FreeCAD-derived notices' edit forge-desktop/package_macos.sh 'bash "$ROOT/third_party/freecad-derived/stage_bundle_notices.sh" "$APP"' 'true'
case_ verifier_blind    'licence verifier rejects|stage_bundle_notices.sh refused' edit third_party/freecad-derived/stage_bundle_notices.sh '  for f in COPYING.LGPL MODIFICATIONS.md NOTICE; do' '  for f in NOTICE; do'

echo "[lgpl-selftest] $PASS passed, $FAILN failed"
if [ "$FAILN" -ne 0 ]; then
  echo "[lgpl-selftest] RED -- the LGPL gate does not fail where it claims to"
  exit 1
fi
echo "[lgpl-selftest] GREEN -- control is green and every injected LGPL defect turns the gate red"
