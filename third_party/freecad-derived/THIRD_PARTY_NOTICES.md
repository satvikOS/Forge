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

## expressions — `libforge_expr.dylib`

- **Path:** `third_party/freecad-derived/expressions/`
- **What it is:** FreeCAD's expression language (parser, evaluator, functions) and
  unit system (`Unit`, `Quantity`), with the FreeCAD document model, Python and Qt
  removed.
- **Upstream:** FreeCAD, commit `0a45a0a008d4af7a85601016c5ab31bd26c25b22`
- **Licence:** `LGPL-2.1-or-later` — full text in `expressions/COPYING.LGPL`
- **Copyright:** Jürgen Riegel (2002, 2010, 2013), Eivind Kvedalen (2015),
  Zheng Lei / realthunder (2019), the FreeCAD contributors; modifications
  © 2026 ArchDisc.
- **Linkage:** dynamic, `@rpath/libforge_expr.dylib`
- **Modifications:** `expressions/MODIFICATIONS.md`
- **Used by Forge for:** named parameters with units, expressions that drive feature
  dimensions, unit-checked arithmetic. Forge's binding of the library to its
  feature tree is Forge's own code and lives outside this directory
  (`ui/src/Parameters.cpp`, `ui/src/ParameterCommands.cpp`,
  `forge-desktop/src/ExpressionHost.cpp`).
