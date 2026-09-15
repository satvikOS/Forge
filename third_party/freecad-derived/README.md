# third_party/freecad-derived — the LGPL boundary

Code taken from FreeCAD (LGPL-2.1-or-later) and adapted for Forge lives here and
nowhere else in this repository. The rules, each enforced by
`lgpl_compliance_gate.sh`:

1. **One directory per component**, listed in `MANIFEST.json` and in
   `THIRD_PARTY_NOTICES.md`.
2. **Each component ships its paperwork:** `COPYING.LGPL` (the full LGPL-2.1 text),
   `MODIFICATIONS.md` (every change to upstream files, with dates — LGPL-2.1 §2(a)),
   and `NOTICE.md`. Every source file keeps its original copyright and SPDX header;
   every modified upstream file carries a dated `MODIFIED FOR FORGE` notice box.
3. **Each component builds as ONE shared library** (`add_library(... SHARED)`), is
   linked dynamically, and is installed into `Forge.app/Contents/Frameworks`. No
   Forge CMake target and no Forge gate script may compile a source from here into
   `forge_desktop`, `forge_kernel_worker`, `libforge_kernel_core` or the Node addon.
4. **No OCCT, Qt, Coin3D or Python** is included by a component. Where FreeCAD code
   depended on OCCT, it is adapted onto Forge's native kernel types instead.
5. **Forge's own code stays out.** The adapter that maps Forge's document, sketch and
   assembly model onto a component's interface is Forge code and lives in Forge's
   tree (for the sketch solver: `forge-kernel/src/Sketcher.cpp`). Nothing proprietary
   is copied into this directory.

## Release obligation (not automated here)

LGPL-2.1 requires that recipients of a Forge release can obtain the complete
corresponding source of each library in this directory, **as modified**, for at
least three years (§6(c)), or that it accompanies the release. The owner must attach
or link the source of this directory — at the exact commit the release was built
from — to every published release. The release workflow does not do this yet.

## Components

| component | library | upstream |
|---|---|---|
| `sketch-solver` | `libforge_gcs` | FreeCAD planegcs @ `0a45a0a` |
