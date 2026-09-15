# Modifications to the FreeCAD material library, as shipped in Forge

LGPL-2.1 section 2(a) and 2(c) ask that a modified copy of the Library carry
prominent notice of what was changed and when. This file is that notice for
everything under `third_party/freecad-derived/materials/`. The upstream is
FreeCAD, <https://github.com/FreeCAD/FreeCAD>, commit
`0a45a0a008d4af7a85601016c5ab31bd26c25b22`, subtree `src/Mod/Material/Resources/`.

`component.json` records every imported file with the SHA-256 it had when it was
imported. `tools/gates/freecad_derived_compliance_gate.sh` recomputes those
hashes, so a card edited without a new entry here turns CI red.

## 2026-09-15 — first import (Forge round 1, materials)

### What was taken, unchanged

* **115 material cards** from `Resources/Materials/Standard/`, byte for byte,
  including the UTF-8 byte-order mark some of them begin with. Every one states
  `License: "LGPL-2.0-or-later"` (110) or `License: "LGPL-2.1-or-later"` (5) in its
  own `General:` block.
* **12 model definitions** from `Resources/Models/` — the models those cards name
  and the models those models inherit: `Legacy/Father`, `Legacy/MaterialStandard`,
  `Mechanical/Density`, `Mechanical/LinearElastic`, `Mechanical/IsotropicLinearElastic`,
  `Mechanical/Hardness`, `Mechanical/Toughness`, `Mechanical/LinearElasticArrays`,
  `Mechanical/IsotropicLinearElasticArrays`, `Mechanical/ToughnessArrays`,
  `Thermal/Thermal`, `Electromagnetic/Electromagnetic`. Eight carry
  `SPDX-License-Identifier: LGPL-2.1-or-later`; four (Toughness and the three
  `*Arrays` models) carry only the long-form header granting LGPL version 2 or
  any later version.

No imported file's content was edited.

### What was removed (not imported)

* **25 cards under `Resources/Materials/Standard/` whose own licence is not LGPL**:
  18 `CC-BY-3.0`, 3 `CC-BY-4.0`, 4 `CC-BY-SA-4.0`. Among them are FreeCAD's generic
  steel, both 6061-T6 and 7075-T6 aluminium, and every thermoplastic. They live in
  an LGPL repository but say otherwise about themselves, and the decision this
  import rests on covers LGPL material only.
* Every card outside `Standard/`: `Appearance/`, `Patterns/`, `Machining/`,
  `Fluid/` and `Test/`. Forge shades parts with its own appearance table and does
  not use hatch patterns, machinability data, fluids or FreeCAD's test cards.
* Every model the imported cards do not use (rendering, architectural, costs,
  hyperelastic, fluid, patterns, test models).
* All of FreeCAD's material *code*: `App/` (the Qt/yaml-cpp loader, 41 files),
  `Gui/`, `materialtools/`, the Python modules and the tests. Forge reads the cards
  with its own reader, which is not derived from FreeCAD's and is not in this
  directory (`ui/src/MaterialCards.cpp`).

### What was added, new, for Forge (LGPL-2.1-or-later, Copyright 2026 ArchDisc)

* `include/forge_fcmat/fcmat_bundle.h`, `src/fcmat_bundle.cpp` — a four-function C
  interface that hands out the imported files by index, unparsed.
* `cmake/embed_resources.cmake`, `CMakeLists.txt` — build the imported files into
  **one shared library, `libforge_fcmaterials.dylib`**, from the list in
  `component.json`. It is installed into `Forge.app/Contents/Frameworks` and loaded
  through `@rpath`, so the LGPL part of the product is a separately replaceable file.
* `component.json`, `README.md`, this file, and `COPYING.LGPL` (the GNU Lesser
  General Public License, version 2.1, verbatim).

### Behaviour that differs from FreeCAD when these cards are read in Forge

These are properties of Forge's reader, not edits to the cards, and are recorded
here so nobody mistakes one program's reading for the other's:

* A property whose unit does not have the dimension of the unit its model declares
  is **refused**. FreeCAD keeps the number and relabels it in the model's unit.
* A number written with a comma (`1200,00`) is **refused** rather than read.
* A card whose density cannot be read is **not offered**, because Forge uses the
  library to weigh parts. At this import every one of the 115 cards is read, with
  1,529 properties interpreted, 45 temperature tables carried but not yet
  interpreted, and none refused.
* A card's id inside Forge is its file name, lower-cased, without `.FCMat`
  (`Steel-S235JR.FCMat` is `steel-s235jr`).
