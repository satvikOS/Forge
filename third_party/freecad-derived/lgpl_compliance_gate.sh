#!/usr/bin/env bash
# lgpl_compliance_gate.sh -- is every FreeCAD-derived component shipped the way
# its licence allows?
#
# Everything under third_party/freecad-derived/<component>/ is taken from LGPL
# code (FreeCAD, or a library FreeCAD vendors) and MODIFIED for Forge. Forge is a
# commercial product, and LGPL permits that on conditions this gate turns into
# checks. HERMETIC: bash, grep, sed, awk, python3 for one JSON read; no compiler,
# no network, nothing CI has to install.
#
# FOR EVERY COMPONENT DIRECTORY, ALL OF:
#   1. COPYING.LGPL is the full LGPL-2.1 text (title, version, the section 6
#      relinking clause, and the "END OF TERMS" line -- a truncated file is not
#      the licence).
#   2. MODIFICATIONS.md exists, names the upstream commit (40 hex digits) and
#      carries at least one dated change (LGPL-2.1 s2(a): modified files must
#      carry prominent notices stating the change and its date).
#   3. Every C/C++ source and header carries an LGPL SPDX identifier and a
#      copyright line.
#   4. Its CMakeLists.txt builds exactly one library, and SHARED. A static LGPL
#      library linked into Forge would make every recipient's right to relink
#      depend on object files Forge does not ship.
#   5. It pulls in no OCCT, Qt, Coin3D or Python: not in an #include, not in a
#      find_package. Forge is native C++ without them, and the OCCT-zero ledger
#      must not rise through a side door.
#   6. The dependency manifest (third_party/manifest/deps.lock.json) records it
#      -- path, upstream repository and revision, SPDX, linkage "dynamic" -- and
#      third_party/notices/NOTICES.md carries its entry.
#   7. No build file OUTSIDE the component compiles one of its sources: the only
#      way in is add_subdirectory() of the directory, which keeps it the SHARED
#      target above.
#   8. forge-desktop/package_macos.sh stages its COPYING.LGPL and
#      MODIFICATIONS.md into the bundle, and verify_bundle_licences.sh requires
#      them there.
#
# AND, WHEN ASKED ABOUT A BUILT ARTIFACT:
#   --binary <file>   the file loads the component's library through @rpath (or
#                     ldd on Linux) and DEFINES none of its symbols. Proves dynamic
#                     linkage of forge_desktop, the worker, a gate.
#   --bundle <.app>   Contents/Frameworks holds the library and
#                     Contents/Resources/licenses/freecad-derived/<component>/
#                     holds COPYING.LGPL and MODIFICATIONS.md.
#
# --selftest copies the tree to a scratch directory, proves the clean copy is
# GREEN, then breaks one rule at a time and requires RED each time.
#
# Exit 0 GREEN, 1 RED, 2 usage.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 2
ROOT="${FORGE_LGPL_ROOT:-$(cd "$HERE/../.." && pwd)}"
cd "$ROOT" || { echo "[lgpl] cannot enter $ROOT"; exit 2; }

BINARIES=()
BUNDLES=()
SELFTEST=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --binary) [ -n "${2:-}" ] || { echo "[lgpl] --binary needs a path"; exit 2; }; BINARIES+=("$2"); shift 2 ;;
    --bundle) [ -n "${2:-}" ] || { echo "[lgpl] --bundle needs a path"; exit 2; }; BUNDLES+=("$2"); shift 2 ;;
    --selftest) SELFTEST=1; shift ;;
    -h|--help) sed -n '2,50p' "$0"; exit 0 ;;
    *) echo "[lgpl] unknown argument: $1"; exit 2 ;;
  esac
done

# ── --selftest ─────────────────────────────────────────────────────────────────
if [ "$SELFTEST" -eq 1 ]; then
  SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/lgpl_selftest.XXXXXX")" || exit 2
  trap 'rm -rf "$SCRATCH"' EXIT
  seed() {  # a fresh copy of exactly what the gate reads
    rm -rf "$SCRATCH/t"; mkdir -p "$SCRATCH/t"
    (cd "$ROOT" && tar cf - third_party/freecad-derived third_party/manifest third_party/notices \
       third_party/licenses forge-desktop/package_macos.sh forge-desktop/CMakeLists.txt) |
      (cd "$SCRATCH/t" && tar xf -)
  }
  run_copy() { FORGE_LGPL_ROOT="$SCRATCH/t" bash "$HERE/lgpl_compliance_gate.sh" >"$SCRATCH/out" 2>&1; }
  seed
  if ! run_copy; then
    cat "$SCRATCH/out"; echo "[lgpl-selftest] RED: the CLEAN copy does not pass, so no mutation proves anything"; exit 1
  fi
  echo "[lgpl-selftest] clean copy GREEN"
  COMP="$(ls -d "$SCRATCH"/t/third_party/freecad-derived/*/ | head -1)"
  COMP="${COMP%/}"
  SRC1="$(find "$COMP/src" -name '*.cpp' | sort | head -1)"
  BAD=0
  mutate() {  # mutate <label> <shell snippet run in the copy>
    seed
    (cd "$SCRATCH/t" && eval "$2")
    if run_copy; then
      echo "[lgpl-selftest] SURVIVED: $1 -- the gate stayed GREEN"; BAD=$((BAD + 1))
    else
      echo "[lgpl-selftest] red as required: $1"
    fi
  }
  mutate "COPYING.LGPL deleted"                "rm -f '$COMP/COPYING.LGPL'"
  mutate "COPYING.LGPL truncated"              "head -c 4000 '$COMP/COPYING.LGPL' > '$COMP/x' && mv '$COMP/x' '$COMP/COPYING.LGPL'"
  mutate "MODIFICATIONS.md deleted"            "rm -f '$COMP/MODIFICATIONS.md'"
  mutate "MODIFICATIONS.md lost its dates"     "sed -i.bak -E 's/20[0-9]{2}-[0-9]{2}-[0-9]{2}/sometime/g' '$COMP/MODIFICATIONS.md'"
  mutate "a source lost its SPDX line"         "sed -i.bak '/SPDX-License-Identifier/d' '$SRC1'"
  mutate "the library became STATIC"           "sed -i.bak 's/ SHARED / STATIC /' '$COMP/CMakeLists.txt'"
  mutate "an OCCT header was included"         "printf '#include <TopoDS_Shape.hxx>\n' >> '$SRC1'"
  mutate "a Qt header was included"            "printf '#include <QString>\n' >> '$SRC1'"
  mutate "the manifest entry was removed"      "python3 -c \"import json,sys;p='third_party/manifest/deps.lock.json';d=json.load(open(p));d['dependencies']=[x for x in d['dependencies'] if 'freecad-derived' not in (x.get('source') or {}).get('path','')];json.dump(d,open(p,'w'),indent=2)\""
  mutate "the notice was removed"              "python3 -c \"import re;p='third_party/notices/NOTICES.md';s=open(p).read();s=re.sub(r'## forge_asmsolver[^#]*','',s);open(p,'w').write(s)\""
  mutate "a source was compiled by another target" "printf 'add_library(sneaky STATIC \${FORGE_ROOT}/third_party/freecad-derived/assembly-solver/src/ForgeAsmSolver.cpp)\n' >> forge-desktop/CMakeLists.txt"
  mutate "the packager stopped staging the licence" "sed -i.bak 's#freecad-derived#freecad-DERIVED-GONE#g' forge-desktop/package_macos.sh"
  if [ "$BAD" -ne 0 ]; then
    echo "[lgpl-selftest] RED: $BAD mutation(s) survived"; exit 1
  fi
  echo "[lgpl-selftest] GREEN -- clean copy passes and all 12 mutations are caught"
  exit 0
fi

FAIL=0
red() { echo "[lgpl] RED: $*"; [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error::$*"; FAIL=1; }

BASE="third_party/freecad-derived"
[ -d "$BASE" ] || { echo "[lgpl] no $BASE directory: nothing derived from FreeCAD is in this tree"; exit 0; }
COMPONENTS=()
for d in "$BASE"/*/; do
  [ -d "$d" ] && COMPONENTS+=("${d%/}")
done
if [ "${#COMPONENTS[@]}" -eq 0 ]; then
  echo "[lgpl] $BASE holds no components"; exit 0
fi
echo "[lgpl] ${#COMPONENTS[@]} FreeCAD-derived component(s): ${COMPONENTS[*]}"

LIBNAMES=()
for C in "${COMPONENTS[@]}"; do
  name="$(basename "$C")"
  # 1. the licence text, whole
  if [ ! -s "$C/COPYING.LGPL" ]; then
    red "$C has no COPYING.LGPL"
  else
    for needle in "GNU LESSER GENERAL PUBLIC LICENSE" "Version 2.1, February 1999" \
                  "Work that uses the Library" "END OF TERMS AND CONDITIONS"; do
      grep -qF "$needle" "$C/COPYING.LGPL" || red "$C/COPYING.LGPL is not the full LGPL-2.1 text (missing \"$needle\")"
    done
  fi
  # 2. the modification record
  if [ ! -s "$C/MODIFICATIONS.md" ]; then
    red "$C has no MODIFICATIONS.md"
  else
    grep -qE '\b[0-9a-f]{40}\b' "$C/MODIFICATIONS.md" || red "$C/MODIFICATIONS.md does not name the upstream commit"
    grep -qE '20[0-9]{2}-[0-9]{2}-[0-9]{2}' "$C/MODIFICATIONS.md" || red "$C/MODIFICATIONS.md records no dated change"
  fi
  # 3. every source carries its licence and copyright
  SOURCES="$(find "$C" \( -name '*.cpp' -o -name '*.cc' -o -name '*.c' -o -name '*.h' -o -name '*.hpp' \) -type f | sort)"
  NSRC="$(printf '%s\n' "$SOURCES" | grep -c . || true)"
  [ "$NSRC" -gt 0 ] || red "$C has no sources"
  NOSPDX="$(printf '%s\n' "$SOURCES" | while IFS= read -r f; do
              [ -n "$f" ] || continue
              head -40 "$f" | grep -qE 'SPDX-License-Identifier: LGPL-2\.1' || echo "$f"
            done)"
  [ -z "$NOSPDX" ] || red "$C: sources without an LGPL-2.1 SPDX identifier:$(printf '\n    %s' $NOSPDX)"
  NOCOPY="$(printf '%s\n' "$SOURCES" | while IFS= read -r f; do
              [ -n "$f" ] || continue
              head -40 "$f" | grep -qi 'copyright' || echo "$f"
            done)"
  [ -z "$NOCOPY" ] || red "$C: sources without a copyright line:$(printf '\n    %s' $NOCOPY)"
  # 4. one SHARED library
  if [ ! -f "$C/CMakeLists.txt" ]; then
    red "$C has no CMakeLists.txt"
  else
    LIBS="$(grep -E '^[[:space:]]*add_library[[:space:]]*\(' "$C/CMakeLists.txt" || true)"
    NLIB="$(printf '%s\n' "$LIBS" | grep -c . || true)"
    [ "$NLIB" -eq 1 ] || red "$C/CMakeLists.txt must declare exactly one library (found $NLIB)"
    printf '%s\n' "$LIBS" | grep -qE 'add_library[[:space:]]*\([[:space:]]*[A-Za-z0-9_]+[[:space:]]+SHARED[[:space:]]' ||
      red "$C/CMakeLists.txt does not build its library SHARED"
    LIB="$(printf '%s\n' "$LIBS" | sed -nE 's/.*add_library[[:space:]]*\([[:space:]]*([A-Za-z0-9_]+).*/\1/p' | head -1)"
    [ -n "$LIB" ] && LIBNAMES+=("$LIB")
    grep -qiE 'find_package[[:space:]]*\([[:space:]]*(Qt[0-9]*|OpenCASCADE|OCC|Coin|Coin3D|Python[0-9]*|PySide[0-9]*|pybind11)' "$C/CMakeLists.txt" &&
      red "$C/CMakeLists.txt finds a forbidden package (OCCT, Qt, Coin3D or Python)"
  fi
  # 5. no OCCT, Qt, Coin3D, Python
  FORBIDDEN='^[[:space:]]*#[[:space:]]*include[[:space:]]*[<"]((Standard|TopoDS|TopExp|TopTools|TopAbs|BRep[A-Za-z]*|BRepAlgoAPI|BRepBuilderAPI|gp|Geom|Geom2d|GeomAPI|Bnd|Poly|TColgp|TColStd|NCollection|IntTools|ShapeFix|STEPControl|IGESControl)_[A-Za-z0-9_]*\.hxx|Q[A-Z][A-Za-z]*|Qt[A-Za-z]*/|Inventor/|Python\.h|pybind11/|boost/python)'
  HITS="$(printf '%s\n' "$SOURCES" | while IFS= read -r f; do
            [ -n "$f" ] || continue
            grep -nE "$FORBIDDEN" "$f" | sed "s#^#$f:#"
          done)"
  [ -z "$HITS" ] || red "$C includes OCCT, Qt, Coin3D or Python:$(printf '\n    %s' "$HITS")"
  # 6. the manifest and the notice
  ENTRY="$(python3 - "$C" <<'PY'
import json, sys
comp = sys.argv[1]
d = json.load(open("third_party/manifest/deps.lock.json"))
for dep in d.get("dependencies", []):
    src = dep.get("source") or {}
    if src.get("kind") == "vendored" and src.get("path") == comp:
        up = dep.get("upstream") or {}
        lic = dep.get("license") or {}
        problems = []
        if not up.get("repository"): problems.append("no upstream repository")
        rev = str(up.get("revision") or "")
        if len(rev) != 40 or any(c not in "0123456789abcdef" for c in rev): problems.append("upstream revision is not a 40-hex commit")
        if not str(lic.get("spdx", "")).startswith("LGPL-2.1"): problems.append("SPDX is not LGPL-2.1")
        if "dynamic" not in str(lic.get("linkage", "")): problems.append("linkage is not dynamic")
        print(dep["name"] + ("" if not problems else "|" + "; ".join(problems)))
        break
PY
)"
  if [ -z "$ENTRY" ]; then
    red "$C is not recorded in third_party/manifest/deps.lock.json"
  else
    DEPNAME="${ENTRY%%|*}"
    [ "$ENTRY" = "$DEPNAME" ] || red "$C's manifest entry is incomplete: ${ENTRY#*|}"
    grep -qE "^## $DEPNAME " third_party/notices/NOTICES.md || red "third_party/notices/NOTICES.md has no entry for $DEPNAME ($C)"
  fi
  # 7. nothing outside the component compiles its sources
  SNEAK="$(grep -rnE "freecad-derived/$name/src/[^ )\"']+\.(cpp|cc|c)" \
             --include='CMakeLists.txt' --include='*.cmake' . 2>/dev/null |
           grep -v "^\./$C/" || true)"
  [ -z "$SNEAK" ] || red "a build file outside $C compiles its sources (they must only be reached through add_subdirectory):$(printf '\n    %s' "$SNEAK")"
  # 8. the bundle carries its licence
  if [ -f forge-desktop/package_macos.sh ]; then
    grep -q "freecad-derived" forge-desktop/package_macos.sh ||
      red "forge-desktop/package_macos.sh does not stage the FreeCAD-derived licence files"
  fi
  if [ -f third_party/licenses/verify_bundle_licences.sh ]; then
    grep -q "freecad-derived/$name/COPYING.LGPL" third_party/licenses/verify_bundle_licences.sh ||
      red "verify_bundle_licences.sh does not require $name's COPYING.LGPL in the bundle"
  fi
  echo "[lgpl] checked $C ($NSRC sources)"
done

# ── built artifacts ────────────────────────────────────────────────────────────
for B in "${BINARIES[@]:-}"; do
  [ -n "$B" ] || continue
  if [ ! -f "$B" ]; then red "--binary $B does not exist (a skipped check is not a passed one)"; continue; fi
  for LIB in "${LIBNAMES[@]}"; do
    if command -v otool >/dev/null 2>&1; then
      LOADS="$(otool -L "$B" | tail -n +2 | awk '{print $1}')"
      echo "[lgpl] otool -L $B:"; printf '%s\n' "$LOADS" | grep -E "lib$LIB" | sed 's/^/    /'
      printf '%s\n' "$LOADS" | grep -qx "@rpath/lib$LIB.dylib" || red "$B does not load @rpath/lib$LIB.dylib dynamically"
    else
      ldd "$B" 2>/dev/null | grep -q "lib$LIB\.so" || red "$B does not load lib$LIB.so dynamically"
    fi
  done
  DEFINED="$(nm -C "$B" 2>/dev/null | awk '$2 ~ /^[TtDdBbSs]$/' | grep -c 'MbD::' || true)"
  [ "${DEFINED:-0}" -eq 0 ] || red "$B DEFINES $DEFINED symbols of the LGPL solver: it was linked in statically"
  echo "[lgpl] $B defines 0 LGPL solver symbols"
done
for A in "${BUNDLES[@]:-}"; do
  [ -n "$A" ] || continue
  [ -d "$A" ] || { red "--bundle $A does not exist"; continue; }
  for LIB in "${LIBNAMES[@]}"; do
    [ -f "$A/Contents/Frameworks/lib$LIB.dylib" ] || red "$A/Contents/Frameworks has no lib$LIB.dylib"
  done
  for C in "${COMPONENTS[@]}"; do
    name="$(basename "$C")"
    for f in COPYING.LGPL MODIFICATIONS.md; do
      [ -s "$A/Contents/Resources/licenses/freecad-derived/$name/$f" ] ||
        red "$A does not ship licenses/freecad-derived/$name/$f"
    done
  done
done

if [ "$FAIL" -ne 0 ]; then
  echo "[lgpl] RED -- a FreeCAD-derived component is not shipped the way its licence allows"
  exit 1
fi
echo "[lgpl] GREEN -- every FreeCAD-derived component is LGPL-complete, SHARED, OCCT/Qt/Coin/Python-free, recorded and noticed"
exit 0
