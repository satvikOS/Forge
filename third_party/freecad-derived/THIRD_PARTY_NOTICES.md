# Third-party notices — FreeCAD-derived components

Forge includes the components below, each derived from FreeCAD
(<https://github.com/FreeCAD/FreeCAD>) and distributed under the GNU Lesser General
Public License, version 2.1 or (at your option) any later version. Each is a separate
shared library in `Forge.app/Contents/Frameworks`; its complete corresponding source,
the full licence text and the record of every modification are in the directory named
below, and `forge-desktop/package_macos.sh` copies the licence, notice and
modification record of each into `Forge.app/Contents/Resources/licenses/`.

`lgpl_compliance_gate.sh` fails if a component in `MANIFEST.json` has no entry here.

---

## sketch-solver — libforge_gcs.dylib

- **Directory:** `third_party/freecad-derived/sketch-solver`
- **Derived from:** FreeCAD planegcs (`src/Mod/Sketcher/App/planegcs/`), commit
  `0a45a0a008d4af7a85601016c5ab31bd26c25b22`
- **Copyright:** © 2011 Konstantinos Poulios; © 2014 Victor Titov (DeepSOIC); the
  FreeCAD contributors. Modifications © 2026 ArchDisc.
- **Licence:** LGPL-2.1-or-later — `COPYING.LGPL`
- **Modifications:** `MODIFICATIONS.md`
- **Notice:** `NOTICE.md`
- **Linked by Forge:** dynamically, through the C interface
  `include/forge_gcs/forge_gcs.h`
- **Compiles against (not included in the library):** Eigen (MPL-2.0), Boost.Graph
  and Boost.Math (BSL-1.0), header-only
