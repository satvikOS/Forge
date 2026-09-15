#!/usr/bin/env bash
# Prove a packaged Forge.app carries the licence text its binaries require.
#
#   verify_bundle_licences.sh <path/to/Forge.app>
#
# Checks the ARTIFACT, not the manifest. The audit that prompted this found the
# manifest omits components that actually ship, so trusting it is the failure mode.
# Every component named below was confirmed to be linked into the shipped binaries:
# OCCT dynamically, planegcs statically (5 objects in libforge_kernel_core.dylib),
# MoltenVK staged explicitly by the packager, SDL2 as a dylib in Frameworks.
#
# Exit 0 = every required text present. Exit 1 = one is missing. Exit 2 = bad usage.
set -uo pipefail
APP="${1:-}"
[ -n "$APP" ] || { echo "usage: $0 <Forge.app>" >&2; exit 2; }
[ -d "$APP" ] || { echo "no bundle at $APP" >&2; exit 2; }

LIC="$APP/Contents/Resources/licenses"
MISSING=0
need() {
  local f="$1" why="$2"
  if [ -s "$LIC/$f" ]; then
    printf '  OK      %-28s %s\n' "$f" "$why"
  else
    printf '  MISSING %-28s %s\n' "$f" "$why"
    MISSING=$((MISSING + 1))
  fi
}
echo "[licences] $APP"
[ -d "$LIC" ] || { echo "  Contents/Resources/licenses does not exist -- the bundle ships NO licence text"; exit 1; }

need LGPL-2.1.txt              "OCCT (dynamic) AND planegcs (STATIC, in libforge_kernel_core)"
need SDL2-zlib.txt             "SDL2, dylib in Contents/Frameworks"
need MoltenVK-Apache-2.0.txt   "MoltenVK, staged by the packager"
need INCOMPLETE.md             "names what is still owed -- Dear ImGui's MIT text"

# The INCOMPLETE record must keep NAMING the gap. If someone deletes the mention
# without vendoring the text, the bundle silently stops disclosing it.
if [ -s "$LIC/INCOMPLETE.md" ] && ! grep -qi 'dear imgui' "$LIC/INCOMPLETE.md"; then
  echo "  MISSING INCOMPLETE.md no longer names Dear ImGui -- either vendor its"
  echo "          LICENSE.txt and add it above, or keep disclosing that it is absent"
  MISSING=$((MISSING + 1))
fi

# ── the FreeCAD-derived shared libraries ─────────────────────────────────────
# Every Frameworks dylib that third_party/freecad-derived/manifest.json names must
# ship with its component's LGPL text, modification record and notice. Driven by
# what is IN the bundle: a library that is shipped is a library that is owed.
FW="$APP/Contents/Frameworks"
MANIFEST="$(cd "$(dirname "${BASH_SOURCE[0]}")/../freecad-derived" 2>/dev/null && pwd)/manifest.json"
if [ -f "$MANIFEST" ]; then
  while IFS='|' read -r comp lib; do
    [ -n "$comp" ] || continue
    [ -f "$FW/$lib" ] || continue
    for f in COPYING.LGPL MODIFICATIONS.md NOTICE; do
      need "freecad-derived/$comp/$f" "$lib (LGPL-2.1, dynamic, Contents/Frameworks)"
    done
  done < <(python3 -c '
import json, sys
for c in json.load(open(sys.argv[1]))["components"]:
    print("%s|%s" % (c["name"], c["library"]))' "$MANIFEST")
  need "freecad-derived/THIRD_PARTY_NOTICES.md" "the FreeCAD-derived libraries, one section each"
else
  echo "  MISSING third_party/freecad-derived/manifest.json beside this script -- cannot tell which libraries are owed"
  MISSING=$((MISSING + 1))
fi

if [ "$MISSING" -gt 0 ]; then
  echo "[licences] RED -- $MISSING required item(s) missing. This artifact must not ship."
  exit 1
fi
echo "[licences] GREEN -- every required licence text is in the bundle"
