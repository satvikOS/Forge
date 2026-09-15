#!/usr/bin/env bash
# freecad_derived_lgpl_gate.sh — the LGPL boundary around third_party/freecad-derived.
#
#   bash tools/gates/freecad_derived_lgpl_gate.sh              # the tree as it is
#   bash tools/gates/freecad_derived_lgpl_gate.sh --mutations  # ...and prove it can fail
#   bash tools/gates/freecad_derived_lgpl_gate.sh --binary LIB_OR_EXE... --library LIBFORGE_X.dylib...
#
# WHAT IT ENFORCES (tools/gates/freecad_derived_lgpl_gate.py holds the checks):
# FreeCAD code is LGPL-2.1-or-later. Forge may adapt it on two conditions, and this
# gate is both of them as checks. (1) The derived code lives ONLY under
# third_party/freecad-derived/<component>/, and every component ships COPYING.LGPL
# (the full text), a dated MODIFICATIONS.md, a NOTICE, a manifest.json entry and a
# THIRD_PARTY_NOTICES.md section; its sources keep their SPDX header; a file recorded
# as verbatim still matches upstream and a modified one says so. (2) It is a SEPARATE
# SHARED LIBRARY: add_library(... SHARED) and nothing else, no OCCT / Qt / Coin3D /
# Python header, no Forge build file compiling one of its sources -- and, in binary
# mode, no Forge binary defining a symbol the library exports.
#
# RED ON THE BASE IT WAS WRITTEN AGAINST. At b8aefa91 planegcs was vendored at
# forge-kernel/3rdParty/planegcs and compiled STATICALLY into libforge_kernel_core;
# the provenance check reports those eleven files and the gate exits 1.
#
# HERMETIC: bash, python3 (stdlib), cp, and -- binary mode only -- nm and otool.
#
# RELEASE OBLIGATION, NOT CHECKED HERE: LGPL-2.1 §6 also needs the modified library
# source to be available to whoever receives a release. That is a release-process
# step for the owner (see each component's section in
# third_party/freecad-derived/THIRD_PARTY_NOTICES.md), not something a PR can prove.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PY="$ROOT/tools/gates/freecad_derived_lgpl_gate.py"

if [ "${1:-}" != "--mutations" ]; then
  exec python3 "$PY" "$@"
fi

# ── --mutations: every rule must be able to turn the gate red ─────────────────
python3 "$PY" || { echo "[lgpl-gate] the unmutated tree is not green -- mutations would prove nothing"; exit 1; }

FD="$ROOT/third_party/freecad-derived"
COMP="$(for d in "$FD"/*/; do [ -f "$d/CMakeLists.txt" ] && basename "$d" && break; done)"
[ -n "$COMP" ] || { echo "[lgpl-gate] no component to mutate"; exit 2; }
WORK="$(mktemp -d "${TMPDIR:-/tmp}/lgpl_gate.XXXXXX")" || exit 2
trap 'rm -rf "$WORK"' EXIT

fresh() {  # a scratch root holding a copy of the boundary directory and nothing else
  rm -rf "$WORK/root"
  mkdir -p "$WORK/root/third_party" || return 1
  cp -R "$FD" "$WORK/root/third_party/freecad-derived" || return 1
  C="$WORK/root/third_party/freecad-derived/$COMP"
}
first_src() { find "$C" -name '*.cpp' -not -path '*/test/*' | sort | head -1; }
first_hdr() { find "$C" -name '*.h' -not -path '*/test/*' | sort | head -1; }

fresh || exit 2
if ! python3 "$PY" --root "$WORK/root" >/dev/null 2>&1; then
  echo "[lgpl-gate] the scratch copy is not green on its own -- the harness is broken"
  python3 "$PY" --root "$WORK/root" | tail -5
  exit 1
fi

TOTAL=0; PROVED=0
mutate() {  # mutate <name> <shell that edits $C / $WORK/root>
  local name="$1" edit="$2" rc
  TOTAL=$((TOTAL + 1))
  fresh || { echo "  ERROR  $name: could not build the scratch tree"; return; }
  if ! eval "$edit"; then echo "  ERROR  $name: the mutation itself failed"; return; fi
  python3 "$PY" --root "$WORK/root" >"$WORK/out" 2>&1
  rc=$?
  if [ "$rc" -eq 1 ]; then
    PROVED=$((PROVED + 1))
    printf '  RED    %-44s %s\n' "$name" "$(grep -m1 'FAIL' "$WORK/out" | sed 's/^ *FAIL *//' | cut -c1-90)"
  else
    printf '  GREEN  %-44s rc=%s  <-- this rule cannot fail\n' "$name" "$rc"
  fi
}

mutate "COPYING.LGPL deleted"            'rm "$C/COPYING.LGPL"'
mutate "COPYING.LGPL truncated"          'head -c 4000 "$FD/$COMP/COPYING.LGPL" > "$C/COPYING.LGPL"'
mutate "MODIFICATIONS.md deleted"        'rm "$C/MODIFICATIONS.md"'
mutate "NOTICE deleted"                  'rm -f "$C/NOTICE" "$C/NOTICE.md"'
mutate "manifest entry removed"          'python3 -c "import json,sys;p=sys.argv[1];m=json.load(open(p));m[\"components\"]=[e for e in m[\"components\"] if e.get(\"name\")!=sys.argv[2]];open(p,\"w\").write(json.dumps(m))" "$WORK/root/third_party/freecad-derived/manifest.json" "$COMP"'
mutate "THIRD_PARTY_NOTICES section gone" 'sed -i.bak "/^## .*$COMP/d" "$WORK/root/third_party/freecad-derived/THIRD_PARTY_NOTICES.md"'
mutate "SPDX header stripped"            'f="$(first_src)"; grep -v "SPDX-License-Identifier" "$f" > "$f.tmp" && mv "$f.tmp" "$f"'
mutate "an OCCT header included"         'f="$(first_src)"; printf "#include <TopoDS_Shape.hxx>\n" >> "$f"'
mutate "a Qt header included"            'f="$(first_hdr)"; printf "#include <QString>\n" >> "$f"'
mutate "built STATIC, not SHARED"        'sed -i.bak "s/SHARED/STATIC/" "$C/CMakeLists.txt"'
mutate "a Forge CMake compiles a source" 'src="$(first_src)"; mkdir -p "$WORK/root/forge-kernel"; printf "add_library(forge_kernel_core SHARED third_party/freecad-derived/%s)\n" "${src#$WORK/root/third_party/freecad-derived/}" > "$WORK/root/forge-kernel/CMakeLists.txt"'
mutate "a Forge script compiles a source" 'src="$(first_src)"; mkdir -p "$WORK/root/forge-kernel/test"; printf "\$CXX -c third_party/freecad-derived/%s -o x.o\n" "${src#$WORK/root/third_party/freecad-derived/}" > "$WORK/root/forge-kernel/test/build_x.sh"'
mutate "FreeCAD source outside the boundary" 'mkdir -p "$WORK/root/forge-kernel/3rdParty"; cp "$(grep -rl "FreeCAD CAx development system" "$C" | head -1)" "$WORK/root/forge-kernel/3rdParty/stray.h"'
# The recorded-upstream rules apply to a component whose MODIFICATIONS.md carries
# the upstream table; they are proved when this one does.
if grep -q '| verbatim |' "$FD/$COMP/MODIFICATIONS.md" 2>/dev/null; then
  mutate "a VERBATIM file silently edited" 'f="$C/$(grep -m1 "| verbatim |" "$C/MODIFICATIONS.md" | sed "s/^| \`\([^\`]*\)\`.*/\1/")"; printf "\n// edited\n" >> "$f"'
  mutate "a MODIFIED file lost its notice" 'f="$C/$(grep -m1 "| \*\*modified\*\* |" "$C/MODIFICATIONS.md" | sed "s/^| \`\([^\`]*\)\`.*/\1/")"; sed -i.bak "s/MODIFIED FOR FORGE/changed/g" "$f"'
fi

echo "[lgpl-gate] $PROVED of $TOTAL mutation(s) turned the gate red"
[ "$PROVED" -eq "$TOTAL" ] && [ "$TOTAL" -ge 13 ]
