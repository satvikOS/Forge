#!/usr/bin/env bash
# orphan_source_ratchet.sh — every .cpp under src/ is compiled, or is listed here
# with a reason.
#
# 39 files produced no object in any target. Not "unused" -- never BUILT, so nothing
# could call them and no compiler ever checked them. They included the mesh
# substrate OCCT_ZERO_ROADMAP.md credits as the sewing (W3.4) and HLR (W3.6)
# foundation, and WallThickness, which the DFM audit recorded as fully implemented
# and reachable by nothing.
#
# THE INSTRUMENT MUST NOT BE THE STALE ONE. The first sweep counted a file as
# compiled if ANY .o existed for it, and picked up leftovers under
# CMakeFiles/forge_kernel.dir -- the node-addon target the current configure sets
# OFF -- which hid two files and reported 37 where the truth was 39. That is the
# same trap as ratcheting an OCCT count on a .node nothing rebuilds. So this reads
# compile_commands.json, which CMake regenerates from the CURRENT configure and
# which cannot survive a source being dropped from a target.
set -uo pipefail
KROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="${1:-$KROOT/build}"
CC="$BUILD/compile_commands.json"

# Legitimately outside forge_kernel_core, each with the reason it is out.
ALLOW="
src/binding.cpp                   node addon (FORGE_BUILD_NODE_ADDON)
src/binding_field.cpp             node addon
src/binding_geom.cpp              node addon
src/binding_sketchdiag.cpp        node addon
src/ft/binding_ft.cpp             node addon
"

[ -f "$CC" ] || { echo "[orphan-ratchet] no compile_commands.json at $CC"; echo "  configure with -DCMAKE_EXPORT_COMPILE_COMMANDS=ON"; exit 1; }

python3 - "$KROOT" "$CC" <<'PY'
import json, os, sys, re
kroot, ccpath = sys.argv[1], sys.argv[2]
allow = set()
for line in """
src/binding.cpp
src/binding_field.cpp
src/binding_geom.cpp
src/binding_sketchdiag.cpp
src/ft/binding_ft.cpp
""".split():
    allow.add(line.strip())

src = set()
for d, _, fs in os.walk(os.path.join(kroot, "src")):
    for f in fs:
        if f.endswith(".cpp"):
            src.add(os.path.relpath(os.path.join(d, f), kroot))

compiled = set()
for e in json.load(open(ccpath)):
    p = e.get("file", "")
    if "/src/" in p:
        rel = p[p.index("/src/") + 1:]
        compiled.add(rel)

orphan = sorted(src - compiled - allow)
extra_allow = sorted(allow & compiled)

print("[orphan-ratchet] %d .cpp under src/, %d compiled, %d allowed out, %d ORPHAN"
      % (len(src), len(src & compiled), len(allow), len(orphan)))
for o in orphan:
    print("  ORPHAN  %s -- never compiled by any target. Add it to FORGE_KERNEL_SOURCES,"
          " or add it to ALLOW in this file WITH A REASON." % o)
for e in extra_allow:
    print("  NOTE    %s is on the allow-list but IS compiled; drop it from ALLOW." % e)
sys.exit(1 if orphan else 0)
PY
