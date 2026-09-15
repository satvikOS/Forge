#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# freecad_derived_lgpl_gate.sh — does every FreeCAD-derived library in this tree
# carry its LGPL-2.1 obligations, and is it kept a SEPARATE, DYNAMICALLY LINKED
# shared library?
#
# Forge adapts FreeCAD code (LGPL-2.1-or-later) under third_party/freecad-derived/.
# That is safe for a commercial product on two conditions, and this gate is the
# mechanical form of both. It is HERMETIC: bash, grep, python3 -- no compiler, no
# SDK, no network, no build -- so it runs on the cheapest runner in seconds.
#
# FOR EVERY COMPONENT DIRECTORY third_party/freecad-derived/<c>/:
#   L1  manifest.json has an entry whose path is that directory, naming its
#       library, an LGPL licence and a 40-hex upstream commit; and every entry
#       names a directory that exists
#   L2  COPYING.LGPL is the complete GNU LGPL 2.1 text (sha256-pinned to the copy
#       Forge already ships in third_party/licenses/LGPL-2.1.txt)
#   L3  MODIFICATIONS.md exists, names the upstream commit, and dates its changes
#       (LGPL-2.1 s2: modified files carry prominent notices and dates)
#   L4  NOTICE exists, and THIRD_PARTY_NOTICES.md has a section for the component
#   L5  every source file keeps an SPDX LGPL header, and every one that is not
#       generated says whether it was MODIFIED (and when) or is a NEW FILE
#   L6  no source includes an OpenCASCADE, Qt, Coin3D or Python header -- the
#       library must not drag the OCCT-zero programme backwards or pull in a
#       toolkit Forge does not ship
#   L7  its CMakeLists.txt builds it `add_library(<target> SHARED ...)` and never
#       STATIC or OBJECT
# ACROSS THE REST OF THE REPOSITORY:
#   L8  no CMake file or shell script outside the component compiles one of its
#       .cpp/.c sources (that would put LGPL code INSIDE a Forge binary)
#   L9  forge-desktop links the component's CMake target, and the packager stages
#       its notices (stage_bundle_notices.sh) and asserts the dynamic link on the
#       bundle; staging is RUN here against a synthetic bundle and the licence
#       verifier is run on the result
#
# The binary-level proof -- that the executable's load commands name the library
# and it defines none of its symbols -- is made by forge-desktop/test/
# run_parameters_gate.sh on the gate binary it links, and by package_macos.sh on
# the shipped forge_desktop.
#
# PUBLISHING the modified source with each release is a RELEASE-PROCESS obligation
# this gate cannot discharge; MODIFICATIONS.md and NOTICE state it.
#
# FORGE_LGPL_ROOT overrides the repository root (the selftest points it at a copy).
# Its red paths are proved by tools/gates/freecad_derived_lgpl_selftest.sh.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="${FORGE_LGPL_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT" || { echo "[lgpl] cannot enter $ROOT"; exit 2; }

BASE="third_party/freecad-derived"
MANIFEST="$BASE/manifest.json"
NOTICES="$BASE/THIRD_PARTY_NOTICES.md"
# sha256 of the GNU LGPL 2.1 text Forge ships (third_party/licenses/LGPL-2.1.txt,
# copied from OpenCASCADE's LICENSE_LGPL_21.txt: 26434 bytes).
LGPL21_SHA256="e237fa56668030e928551ddd60f05df5fe957f75eab874bbd017e085ed722e7c"

FAIL=0
red() {
  echo "[lgpl] RED: $*"
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error::$*"
  FAIL=1
}
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

# RED, not "nothing to check": Forge ships FreeCAD-derived libraries, so a tree
# without the directory is a tree whose libraries lost their records. Retiring
# the last component means retiring this gate in the same change.
[ -d "$BASE" ] || { red "$BASE is missing -- the FreeCAD-derived libraries and their LGPL records are gone"; exit 1; }
[ -f "$MANIFEST" ] || { red "$MANIFEST is missing"; exit 1; }
[ -f "$NOTICES" ] || red "$NOTICES is missing"

# ── L1: the manifest and the directories agree ───────────────────────────────
MANIFEST_ROWS="$(python3 - "$MANIFEST" <<'PY'
import json, re, sys
try:
    doc = json.load(open(sys.argv[1]))
except Exception as e:
    print("ERROR|manifest does not parse: %s" % e)
    sys.exit(0)
for c in doc.get("components", []):
    missing = [k for k in ("name", "path", "library", "cmake_target", "license", "upstream_commit")
               if not c.get(k)]
    if missing:
        print("ERROR|component %r lacks %s" % (c.get("name"), ", ".join(missing)))
        continue
    if not re.fullmatch(r"[0-9a-f]{40}", c["upstream_commit"]):
        print("ERROR|component %s: upstream_commit is not a 40-hex commit" % c["name"])
    if not c["license"].startswith("LGPL-2.1"):
        print("ERROR|component %s: licence %r is not LGPL-2.1" % (c["name"], c["license"]))
    print("ROW|%s|%s|%s|%s|%s" % (c["name"], c["path"], c["library"], c["cmake_target"],
                                  c["upstream_commit"]))
PY
)"
while IFS='|' read -r kind a _; do
  [ "$kind" = "ERROR" ] && red "$MANIFEST: $a"
done <<< "$MANIFEST_ROWS"

declare_rows() { printf '%s\n' "$MANIFEST_ROWS" | grep '^ROW|'; }
N=0
for dir in "$BASE"/*/; do
  [ -d "$dir" ] || continue
  comp="$(basename "$dir")"
  path="$BASE/$comp"
  row="$(declare_rows | awk -F'|' -v p="$path" '$3 == p')"
  if [ -z "$row" ]; then
    red "$path exists but $MANIFEST has no component whose path is $path"
    continue
  fi
  N=$((N + 1))
  IFS='|' read -r _ name _ library target commit <<< "$row"

  # ── L2 ──
  if [ ! -f "$path/COPYING.LGPL" ]; then
    red "$path has no COPYING.LGPL"
  elif [ "$(sha256 "$path/COPYING.LGPL")" != "$LGPL21_SHA256" ]; then
    red "$path/COPYING.LGPL is not the complete GNU LGPL 2.1 text (sha256 differs)"
  fi

  # ── L3 ──
  if [ ! -f "$path/MODIFICATIONS.md" ]; then
    red "$path has no MODIFICATIONS.md (LGPL-2.1 s2 requires the changes and their dates)"
  else
    grep -qF "$commit" "$path/MODIFICATIONS.md" \
      || red "$path/MODIFICATIONS.md does not name the upstream commit $commit"
    grep -qE '^#+ .*[0-9]{4}-[0-9]{2}-[0-9]{2}' "$path/MODIFICATIONS.md" \
      || red "$path/MODIFICATIONS.md has no dated change entry (a heading with YYYY-MM-DD)"
  fi

  # ── L4 ──
  [ -s "$path/NOTICE" ] || red "$path has no NOTICE"
  if [ -f "$NOTICES" ]; then
    grep -qE "^## +$comp\b" "$NOTICES" \
      || red "$NOTICES has no '## $comp' section"
    grep -qF "$library" "$NOTICES" || red "$NOTICES does not name $library"
  fi

  # ── L5 and L6 ──
  while IFS= read -r src; do
    [ -n "$src" ] || continue
    head -5 "$src" | grep -qE 'SPDX-License-Identifier: *LGPL-2\.1' \
      || red "$src has no SPDX LGPL-2.1 header in its first lines"
    case "$src" in
      *.tab.c|*.tab.h|*.lex.c) ;;   # generated: MODIFICATIONS.md records how
      *)
        grep -qE 'MODIFIED for [A-Za-z_]+ \([0-9]{4}-[0-9]{2}-[0-9]{2}\)|NEW FILE \([0-9]{4}-[0-9]{2}-[0-9]{2}\)' "$src" \
          || red "$src says neither 'MODIFIED for <library> (<date>)' nor 'NEW FILE (<date>)'"
        ;;
    esac
    if grep -nE '^[[:space:]]*#[[:space:]]*include[[:space:]]*[<"](Standard_|TopoDS|TopAbs|TopExp|TopLoc|BRep|Geom|gp_|GC_|TColgp|TColStd|NCollection|BOPAlgo|ShapeFix|IGES|STEP|Q[A-Z][A-Za-z]+|Qt[A-Za-z]*/|Inventor/|Python\.h|pybind11|CXX/|boost/python)' "$src" >/dev/null; then
      red "$src includes a forbidden header: $(grep -nE '^[[:space:]]*#[[:space:]]*include[[:space:]]*[<"](Standard_|TopoDS|TopAbs|TopExp|TopLoc|BRep|Geom|gp_|GC_|TColgp|TColStd|NCollection|BOPAlgo|ShapeFix|IGES|STEP|Q[A-Z][A-Za-z]+|Qt[A-Za-z]*/|Inventor/|Python\.h|pybind11|CXX/|boost/python)' "$src" | head -1)"
    fi
  done < <(find "$path" -type f \( -name '*.cpp' -o -name '*.c' -o -name '*.h' -o -name '*.hpp' -o -name '*.y' -o -name '*.l' \) | sort)

  # ── L7 ──
  if [ ! -f "$path/CMakeLists.txt" ]; then
    red "$path has no CMakeLists.txt"
  else
    grep -qE "add_library\(\s*$target\s+SHARED" "$path/CMakeLists.txt" \
      || red "$path/CMakeLists.txt does not build $target as add_library($target SHARED ...)"
    if grep -nE 'add_library\([^)]*\b(STATIC|OBJECT)\b' "$path/CMakeLists.txt" >/dev/null; then
      red "$path/CMakeLists.txt declares a STATIC or OBJECT library -- LGPL code must stay a shared library"
    fi
  fi

  # ── L8: no Forge target compiles its sources ──
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    red "LGPL source compiled outside its library: $hit"
  done < <(
    { git ls-files -- '*CMakeLists.txt' '*.cmake' '*.sh' 2>/dev/null \
        || find . -name CMakeLists.txt -o -name '*.cmake' -o -name '*.sh'; } \
      | sed 's#^\./##' | grep -v "^$path/" | grep -v '^tools/gates/freecad_derived_lgpl_' \
      | while IFS= read -r f; do
          [ -f "$f" ] || continue
          grep -nE "freecad-derived/$comp/src/[A-Za-z0-9_]+\.(cpp|c)\b" "$f" 2>/dev/null \
            | grep -vE 'mutate|^[0-9]+:[[:space:]]*#' | sed "s#^#$f:#"
        done
  )

  # ── L9: forge-desktop links the TARGET, the packager stages and checks ──
  if [ -f forge-desktop/CMakeLists.txt ]; then
    grep -qE "add_subdirectory\([^)]*freecad-derived/$comp" forge-desktop/CMakeLists.txt \
      || red "forge-desktop/CMakeLists.txt does not add_subdirectory $path"
    # CMake calls span lines; compare against the file with newlines folded.
    FOLDED="$(cat forge-desktop/CMakeLists.txt forge-kernel/CMakeLists.txt 2>/dev/null | sed 's/#.*$//' | tr '\n' ' ')"
    printf '%s' "$FOLDED" | grep -qE "target_link_libraries\(forge_desktop [^)]*\b$target\b" \
      || red "forge-desktop/CMakeLists.txt does not link forge_desktop against the $target target"
    for t in forge_desktop_core forge_ui forge_kernel_worker forge_kernel_core forge_desktop_render forge_archie; do
      if printf '%s' "$FOLDED" | grep -qE "target_link_libraries\($t [^)]*\b$target\b"; then
        red "$t links $target -- only the application executable may, so no library every gate links carries the LGPL dependency"
      fi
    done
  fi
  if [ -f forge-desktop/package_macos.sh ]; then
    grep -qE 'stage_bundle_notices\.sh' forge-desktop/package_macos.sh \
      || red "forge-desktop/package_macos.sh does not stage the FreeCAD-derived notices"
    grep -qF "$library" forge-desktop/package_macos.sh \
      || red "forge-desktop/package_macos.sh does not assert $library is loaded dynamically"
  fi
done

[ "$N" -gt 0 ] || red "$BASE holds no component directory the manifest describes"

# L1, the other direction: every manifest entry is a real directory.
while IFS='|' read -r kind name path _; do
  [ "$kind" = "ROW" ] || continue
  [ -d "$path" ] || red "$MANIFEST names $name at $path, which does not exist"
done <<< "$MANIFEST_ROWS"

# ── L9: RUN the staging on a synthetic bundle and verify it ──────────────────
if [ -f "$BASE/stage_bundle_notices.sh" ]; then
  APPDIR="$(mktemp -d "${TMPDIR:-/tmp}/forge_lgpl_app.XXXXXX")" || exit 2
  APP="$APPDIR/Forge.app"
  mkdir -p "$APP/Contents/Frameworks" "$APP/Contents/Resources/licenses"
  while IFS='|' read -r kind name path library _; do
    [ "$kind" = "ROW" ] || continue
    : > "$APP/Contents/Frameworks/$library"   # a shipped library, as the verifier sees it
  done <<< "$MANIFEST_ROWS"
  if ! bash "$BASE/stage_bundle_notices.sh" "$APP" > "$APPDIR/stage.log" 2>&1; then
    red "stage_bundle_notices.sh refused: $(tail -1 "$APPDIR/stage.log")"
  elif [ -f third_party/licenses/verify_bundle_licences.sh ]; then
    # The verifier also requires the non-FreeCAD texts package_macos.sh stages;
    # stage those the same way so only the FreeCAD-derived rows can fail here.
    for l in third_party/licenses/*.txt third_party/licenses/*.md; do
      [ -f "$l" ] && cp "$l" "$APP/Contents/Resources/licenses/"
    done
    if ! bash third_party/licenses/verify_bundle_licences.sh "$APP" > "$APPDIR/verify.log" 2>&1; then
      red "the licence verifier rejects a bundle staged by stage_bundle_notices.sh:"
      grep -E 'MISSING|RED' "$APPDIR/verify.log" | sed 's/^/        /'
    fi
  fi
  rm -rf "$APPDIR"
else
  red "$BASE/stage_bundle_notices.sh is missing"
fi

if [ "$FAIL" -ne 0 ]; then
  echo "[lgpl] FAILED -- a FreeCAD-derived library does not carry its LGPL obligations"
  exit 1
fi
echo "[lgpl] GREEN -- $N FreeCAD-derived component(s): LGPL text, dated modifications, notices, SPDX headers, no OCCT/Qt/Coin/Python, SHARED only, no source compiled into Forge, staged and verified in a bundle"
