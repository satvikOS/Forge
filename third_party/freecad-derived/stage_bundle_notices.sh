#!/usr/bin/env bash
# stage_bundle_notices.sh — copy every FreeCAD-derived library's licence
# obligations into a Forge.app bundle.
#
#   bash third_party/freecad-derived/stage_bundle_notices.sh <path/to/Forge.app>
#
# For each component directory under third_party/freecad-derived/ it copies
# COPYING.LGPL, MODIFICATIONS.md and NOTICE into
#   Forge.app/Contents/Resources/licenses/freecad-derived/<component>/
# and THIRD_PARTY_NOTICES.md into
#   Forge.app/Contents/Resources/licenses/freecad-derived/
#
# Called by forge-desktop/package_macos.sh. A separate script, and not lines
# inside the packager, so tools/gates/freecad_derived_lgpl_gate.sh can run the
# SAME staging against a synthetic bundle on a runner that cannot build the app
# -- a gate that could only check the packager by reading it would be checking
# a paragraph, not a bundle.
#
# Refuses (exit 1) rather than staging a partial set: a library shipped without
# its licence text is the defect, and a bundle that has half of it looks
# compliant to anyone who does not count.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 2
APP="${1:-}"
[ -n "$APP" ] || { echo "usage: $0 <Forge.app>" >&2; exit 2; }
[ -d "$APP/Contents" ] || { echo "[fc-notices] no bundle at $APP" >&2; exit 2; }

DEST="$APP/Contents/Resources/licenses/freecad-derived"
mkdir -p "$DEST" || exit 1
[ -f "$HERE/THIRD_PARTY_NOTICES.md" ] || { echo "[fc-notices] THIRD_PARTY_NOTICES.md is missing" >&2; exit 1; }
cp "$HERE/THIRD_PARTY_NOTICES.md" "$DEST/THIRD_PARTY_NOTICES.md" || exit 1

n=0
for comp in "$HERE"/*/; do
  [ -d "$comp" ] || continue
  name="$(basename "$comp")"
  mkdir -p "$DEST/$name" || exit 1
  for f in COPYING.LGPL MODIFICATIONS.md NOTICE; do
    if [ ! -s "$comp/$f" ]; then
      echo "[fc-notices] $name has no $f -- refusing to stage a library without its licence obligations" >&2
      exit 1
    fi
    cp "$comp/$f" "$DEST/$name/$f" || exit 1
  done
  n=$((n + 1))
done
[ "$n" -gt 0 ] || { echo "[fc-notices] no FreeCAD-derived component found under $HERE" >&2; exit 1; }
echo "[fc-notices] staged the licence, modification record and notice of $n FreeCAD-derived component(s)"
