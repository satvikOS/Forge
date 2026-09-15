# Third-party notices — FreeCAD-derived libraries

Forge ships the libraries below. Each is a **modified copy of part of FreeCAD**
(<https://www.freecad.org>), licensed under the GNU Lesser General Public License
version 2.1 or later, built as a separate **shared library**, installed in
`Forge.app/Contents/Frameworks` and loaded **dynamically** by Forge. None of their
code is compiled into a Forge executable or into `libforge_kernel_core`.

Each component directory holds the licence text (`COPYING.LGPL`), the dated record
of every change made to FreeCAD's code (`MODIFICATIONS.md`) and the notice that
ships in the application bundle (`NOTICE`). `manifest.json` beside this file
records each component's path, upstream commit and licence, and
`tools/gates/freecad_derived_lgpl_gate.sh` fails CI when any of these is missing.

This file is maintained by hand, one section per component, and the gate requires
a section whose heading names each component's directory.

## sketch-solver — `libforge_gcs.dylib`

- **Path:** `third_party/freecad-derived/sketch-solver/`
- **What it is:** FreeCAD's planegcs 2D geometric constraint solver (the Sketcher's
  solver: DogLeg / Levenberg-Marquardt / BFGS, rank diagnosis of conflicting and
  redundant constraints), behind a versioned C interface, with FreeCAD's runtime
  services replaced and debug-only code removed.
- **Upstream:** FreeCAD, commit `0a45a0a008d4af7a85601016c5ab31bd26c25b22`,
  `src/Mod/Sketcher/App/planegcs/`
- **Licence:** `LGPL-2.1-or-later` — full text in `sketch-solver/COPYING.LGPL`
- **Copyright:** Konstantinos Poulios (2011), Victor Titov / DeepSOIC (2014), the
  FreeCAD contributors; modifications © 2026 ArchDisc.
- **Linkage:** dynamic, `@rpath/libforge_gcs.dylib`
- **Modifications:** `sketch-solver/MODIFICATIONS.md`
- **Compiles against (not part of the library):** Eigen (MPL-2.0) and Boost.Graph /
  Boost.Math (BSL-1.0), header-only.
- **Used by Forge for:** solving sketches, degrees of freedom, and naming the
  constraints that conflict. Forge's binding of the library to its sketch model is
  Forge's own code and lives outside this directory (`forge-kernel/src/Sketcher.cpp`,
  `forge-kernel/src/ft/SketchAdmission.cpp`).
- **Release obligation (owner, not automated):** LGPL-2.1 §6 requires that whoever
  receives a Forge release can get the complete source of this library *as
  modified* — this directory at the exact commit the release was built from —
  either with the release or through a written offer valid for three years. The
  release workflow does not attach it yet.
