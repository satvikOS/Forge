# planegcs (vendored)

`planegcs` is FreeCAD's plane geometric constraint solver — a Newton-style
2D constraint propagator (BFGS / Levenberg-Marquardt / DogLeg) that backs the
FreeCAD Sketcher workbench. It is BSD/LGPL-2.1+ licensed (`SPDX-License-Identifier:
LGPL-2.1-or-later`, per the header in every source file). We vendor it
verbatim, in-tree, so that Forge can ship a constraint solver without taking
a runtime dependency on the wider FreeCAD codebase.

## Source

- **Upstream**: <https://github.com/FreeCAD/FreeCAD>
- **Subtree**: `src/Mod/Sketcher/App/planegcs/`
- **Commit pinned at vendoring**: `0a45a0a008d4af7a85601016c5ab31bd26c25b22`
  (FreeCAD `main`, mid-2025)
- **Files vendored** (`*.cpp` / `*.h`):
  - `Constraints.cpp`, `Constraints.h`
  - `GCS.cpp`, `GCS.h`
  - `Geo.cpp`, `Geo.h`
  - `SubSystem.cpp`, `SubSystem.h`
  - `Util.h`
  - `qp_eq.cpp`, `qp_eq.h`

## Forge-local modifications

The upstream tree assumes FreeCAD's source layout (`Base/Console.h`,
`FCConfig.h`, `SketcherGlobal.h`, etc.). The following surgical changes were
made at vendoring time to make planegcs a standalone library — all of the
edits are at the include layer; no algorithmic code was touched.

1. **`Constraints.h`, `GCS.h`, `Geo.h`** — `#include "../../SketcherGlobal.h"`
   rewritten to `#include "SketcherGlobal.h"`. The replacement
   `SketcherGlobal.h` lives next to the vendored sources and stubs out
   `SketcherExport` (no DLL-export decoration needed: we statically link
   planegcs into `forge_kernel.dylib`).
2. **`GCS.cpp`** — `#include <Base/Console.h>` + `#include <FCConfig.h>` +
   `#include <boost_graph_adjacency_list.hpp>` replaced with:
   - `#include "forge_planegcs_stub.h"` — provides `Base::Console()` and
     `Base::TimeElapsed` stand-ins (silent stderr forwarder + chrono timer).
   - `#include <boost/graph/adjacency_list.hpp>` — the canonical Boost name
     for the same header (FreeCAD uses a build-system alias).

No `Base::Exception` instances are thrown from the planegcs subtree, so no
`std::runtime_error` substitution was needed. The exception-substitution
contingency called out in the slice spec was investigated and found
unnecessary (`grep -rn 'throw' planegcs/` returns no matches).

## How Forge consumes this

`forge-kernel/CMakeLists.txt` adds the vendored sources to the
`forge_kernel` shared library. The Forge-native wrapper at
`forge-kernel/src/Sketcher.cpp` / `forge-kernel/include/forge/Sketcher.hpp`
projects `GCS::System` onto a handle-based API that the N-API binding
forwards to JS as `window.forge.sketcher.*`.

## Verbose mode

The planegcs solver, when run with `Base::Console().verbose = true`, will
spew QR timing / iteration logs to stderr — useful for diagnosing
ill-conditioned sketches. Forge exposes no public switch for it yet
(default-off, by design).
