# forge_asmsolver — modifications to OndselSolver

This directory is a **modified version of OndselSolver**, the multibody assembly
solver FreeCAD's Assembly workbench uses. It is distributed under the GNU Lesser
General Public License version 2.1 (`COPYING.LGPL`). LGPL-2.1 section 2(a)
requires a modified library to carry prominent notices stating that it was
changed and the date of any change; this file is that notice for the directory
as a whole, and every file that was changed also says so in its own header.

## Upstream

| | |
|---|---|
| Project | OndselSolver — "Assembly Constraints and Multibody Dynamics code" |
| Repository | https://github.com/FreeCAD/OndselSolver |
| Commit | `30e9b64e8bf881d438d4b88834f9ba3674865418` (2025-08-31, "fix pc file") |
| How it was pinned | the gitlink FreeCAD `0a45a0a` records at `src/3rdParty/OndselSolver` |
| Licence | LGPL-2.1 (`upstream/LICENSE`, kept verbatim; GitHub reports `LGPL-2.1`) |
| Copyright | (c) 2023 Ondsel, Inc. |

`upstream/LICENSE` and `upstream/README.md` are the upstream files, unchanged.
`COPYING.LGPL` is the canonical FSF text of the same licence.

The pristine import is its own commit in Forge's history ("Vendor OndselSolver
30e9b64 verbatim as the base of the assembly solver"), so `git diff` from that
commit to any later one shows every change made here, line by line.

### The SPDX identifier

Upstream files carry a copyright block and no SPDX line. Each file now also
carries `SPDX-License-Identifier: LGPL-2.1-only`. The identifier is `-only`
because the upstream LICENSE is the version 2.1 text and nothing in the
repository grants "or any later version"; claiming `-or-later` would be a grant
the authors did not make. Fourteen upstream source files carried no notice at
all; they now say they are part of OndselSolver and that the upstream LICENSE
applies.

## Changes — 2026-09-15 (Forge, ArchDisc)

### 1. Removed

* **Everything outside the library sources**: the standalone executable
  (`OndselSolverMain`), the GoogleTest suite (`tests`), the `.asmt` sample models
  (`testapp`), the Visual Studio project files, `.rc`/`.aps` resources, the
  movie, `.mbd` and log files that lived in the source directory, the CLA
  documents and the upstream CMake/pkg-config files.
* **The CADSystem demo back-end** (`CADSystem.h/.cpp`): hand-built pendulum and
  piston models that printed to `std::cout`.
* **Code nothing reaches.** Every header that no other kept file includes was
  removed together with its `.cpp`, iterated to a fixed point (135 files in all,
  listed by `git diff --name-status` against the import commit). That takes out
  the unfinished contact and extrusion classes and every joint Forge does not
  expose yet: gear, rack-and-pinion, screw, universal, constant-velocity,
  parallel-axes, perpendicular, point-in-line, point-in-plane, line-in-plane,
  rev-cyl, rev-rev, cyl-sph, no-rotation, allow-rotation, general motion, and
  the rotation/translation limits. They are recoverable from the import commit
  when Forge adds the joint.
* **File I/O and demos in `ASMTAssembly`**: the `.asmt` reader (`parseASMT` and
  every `read*`), the writer (`outputFile`, `storeOnLevel*`, `storeOnTimeSeries`),
  `assemblyFromFile`, `readWriteFile`, `runFile`, the single-pendulum demos, the
  dragging-log tests, `setFilename`, `setDebug` and the `debug` flag with the five
  blocks that wrote `runPreDrag.asmt`, `runDragStep.asmt` and `dragging.log`
  into the process's working directory.
* `SystemNewtonRaphson::outputSpreadsheet`, which wrote
  `../../testapp/spreadsheetcpp.csv`.

### 2. Changed

* **No writes to the host's standard streams.** `ExternalSystem::logString` and
  `ASMTItem::logString` printed to `std::cout`; `ASMTAssembly::updateFromMbD`
  printed `Time = ...`; `ASMTRotationalMotion::createMbD` printed the parsed
  drive function; `ASMTSpatialContainer::compareResults/outputResults` printed
  comparisons against a reference series only the removed reader could supply.
  Forge's kernel worker speaks a protocol on stdout, so a library that prints is
  a library that corrupts it. Messages now go to
  `ASMTAssembly::solverMessages` (bounded to 256 lines).
* **`ExternalSystem`**: the CADSystem and FreeCAD `AssemblyObject` back-pointers
  are removed. The two remaining raw pointers are initialised to `nullptr`, and
  a missing host is a `SimulationStoppingError` rather than a dereference.
* **`PosICNewtonRaphson::run` is bounded.** It retried for ever while each pass
  ended in a singular matrix. A pass that marks no new equation redundant cannot
  make progress, and now stops with a `SimulationStoppingError`.
* `ASMTItem.cpp` includes `<fstream>` itself instead of receiving it through
  `ASMTAssembly.h`.
* Builds as C++20 (upstream: C++17). No source change was needed for that.

### 3. Added

* `include/forge_asmsolver/AsmSolver.h` and `src/ForgeAsmSolver.cpp` — a
  plain-data facade: bodies with placements and a grounded flag, eight joint
  kinds (fixed, revolute, slider, cylindrical, ball, planar, distance, angle),
  optional drives, and one `solve()` that never throws. It reports per-joint
  equation counts, the equations the solver found redundant, the error of every
  equation **including the redundant ones** (an equation the solver set aside is
  not an equation that holds, so a conflict cannot be reported as solved), the
  degrees of freedom, and walks a rotational drive in steps of at most 20° so it
  cannot land on the mirror branch of `sin(theta - target) = 0`. The header names
  no OndselSolver type, so the library can be rebuilt and replaced without
  recompiling Forge.
* `CMakeLists.txt` — builds `libforge_asmsolver` as a **SHARED** library, standalone.
* `test/asmsolver_selftest.cpp` — the library's own self-test through the
  public header.

## Rebuilding this library (LGPL-2.1 section 6)

```sh
cmake -S third_party/freecad-derived/assembly-solver -B build-asm -DCMAKE_BUILD_TYPE=Release
cmake --build build-asm
./build-asm/asmsolver_selftest
```

Copy the resulting `libforge_asmsolver.dylib` over
`Forge.app/Contents/Frameworks/libforge_asmsolver.dylib` to run Forge against
your build. Forge loads it through `@rpath` and uses only the functions in
`AsmSolver.h`; `apiVersion()` guards the struct layout.
