#!/usr/bin/env bash
# freecad_derived_compliance_gate.sh -- no FreeCAD-derived library ships without
# its licence, its record of changes and its notice, and none is compiled in.
#
# Thin wrapper so the check is a *_gate.sh the registration ratchets can see; the
# logic, and why each rule exists, is in freecad_derived_compliance.py beside it.
#
#   bash tools/gates/freecad_derived_compliance_gate.sh              # the tree (hermetic)
#   bash tools/gates/freecad_derived_compliance_gate.sh --selftest   # proves 16 red paths
#   bash tools/gates/freecad_derived_compliance_gate.sh --build forge-desktop/build \
#        --kernel forge-kernel/build-app/libforge_kernel_core.dylib  # otool/nm, macOS
#   bash tools/gates/freecad_derived_compliance_gate.sh --bundle dist/Forge.app
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
command -v python3 >/dev/null 2>&1 || { echo "[fc-compliance] python3 is required"; exit 2; }
exec python3 tools/gates/freecad_derived_compliance.py "$@"
