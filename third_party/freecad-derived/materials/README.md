# FreeCAD material library — the part of it Forge ships

**Licence:** GNU Lesser General Public License — every imported card and model
states LGPL-2.0-or-later or LGPL-2.1-or-later; the files added for Forge are
LGPL-2.1-or-later. Full text: [`COPYING.LGPL`](COPYING.LGPL).
**Upstream:** FreeCAD, <https://github.com/FreeCAD/FreeCAD>, commit
`0a45a0a008d4af7a85601016c5ab31bd26c25b22`, `src/Mod/Material/Resources/`.
**What changed, and when:** [`MODIFICATIONS.md`](MODIFICATIONS.md).
**Every file, with its licence and hash:** [`component.json`](component.json).

## Notice

This directory contains material cards and model definitions from the FreeCAD
project. The cards are the work of their named authors — M. Münch (93 cards),
Joe Da Silva (15), Uwe Stöhr (5), vlk (1), and one card that names no author —
and the model definitions are Copyright (c) 2023 David Carter and Copyright (c)
2025–2026 Joe Da Silva. Each file's own header or `General:` block names its
author and licence; nothing here replaces those statements.

The files are distributed in the hope that they will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. Material values are typical published values, not certified
figures for any particular batch of material.

## How Forge uses it

The files are compiled into one shared library, `libforge_fcmaterials.dylib`,
which Forge installs in `Forge.app/Contents/Frameworks` and loads at run time. The
library interprets nothing: `include/forge_fcmat/fcmat_bundle.h` hands out each
file's path and bytes. Forge's own reader (outside this directory) parses them.

## Replacing or modifying the library

You may change any card or model here, or replace the whole set, under the terms of
the LGPL. To use your version with an installed copy of Forge:

1. Edit the files under `Resources/`. If you add, remove or rename a file, run
   `python3 tools/freecad_derived/vendor_materials.py --upstream <FreeCAD checkout>`
   from the Forge source tree, or edit `component.json` by hand so it lists every
   file you want built in (the build embeds exactly that list).
2. Build the library on its own:
   `cmake -S third_party/freecad-derived/materials -B build-fcmat && cmake --build build-fcmat`
3. Replace `Forge.app/Contents/Frameworks/libforge_fcmaterials.dylib` with
   `build-fcmat/libforge_fcmaterials.dylib`, then re-sign the application bundle
   (`codesign --force --deep --sign - Forge.app` for a local ad-hoc signature).

Forge reads the library through a four-function C interface
(`FORGE_FCMAT_ABI_VERSION` 1); any library that exports those functions with that
version works with an unmodified Forge.
