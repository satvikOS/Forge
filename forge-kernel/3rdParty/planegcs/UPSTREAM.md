# planegcs (vendored)

`planegcs` is FreeCAD's plane geometric constraint solver — a Newton-style
2D constraint propagator (BFGS / Levenberg-Marquardt / DogLeg) that backs the
FreeCAD Sketcher workbench. We vendor it verbatim, in-tree, so that Forge can
ship a constraint solver without taking a runtime dependency on the wider
FreeCAD codebase.

## Licence — what the files actually say

Every vendored source file carries one SPDX tag, and it is the same tag in all
of them. Measured, not recalled:

```
$ cd forge-kernel && grep -rh "SPDX-License-Identifier" 3rdParty/planegcs/ \
    --include='*.h' --include='*.cpp' | sort | uniq -c
  13 // SPDX-License-Identifier: LGPL-2.1-or-later
```

Thirteen source files, thirteen identical tags, and no file without one. That is
the whole census: there is no second value. Eleven of the thirteen are upstream
FreeCAD files; the remaining two (`SketcherGlobal.h`, `forge_planegcs_stub.h`)
were written at vendoring time to replace FreeCAD headers and carry the same tag.

The tag is the first line of each file. `GCS.h` in full, lines 1-4:

```
// SPDX-License-Identifier: LGPL-2.1-or-later

/***************************************************************************
 *   Copyright (c) 2011 Konstantinos Poulios <logari81@gmail.com>          *
```

and the licence block that follows it reads *"This library is free software; you
can redistribute it and/or modify it under the terms of the GNU Library General
Public License … either version 2 of the License, or (at your option) any later
version."*

**No vendored file offers a BSD alternative.** An earlier revision of this note
described the subtree as "BSD/LGPL-2.1+ licensed". That description was not taken
from these files and is corrected here: the sources say `LGPL-2.1-or-later`, and
only that.

Other copyright holders appearing in the subtree: Konstantinos Poulios (2011),
Victor Titov / DeepSOIC (2014).

Two notes elsewhere in the tree describe the same component; both already say
`LGPL-2.1-or-later` and agree with the headers —
`third_party/notices/NOTICES.md` (`## planegcs freecad-0a45a0a`) and
`third_party/manifest/deps.lock.json`. `third_party/licenses/README.md` records
the static-linkage consequence. The repository-wide comparison of every vendored
component's headers against its local notes is
`third_party/VENDORED_COMPONENT_SWEEP.md`.

### Reproducing the census

The command above is scoped to `*.h` / `*.cpp` on purpose. The unscoped form,
`grep -rh "SPDX-License-Identifier" 3rdParty/planegcs/`, also reads this Markdown
file and so matches its prose as well — including the lines you are reading. The
scoped form reads only the sources and is stable.

## Source

- **Upstream**: <https://github.com/FreeCAD/FreeCAD>
- **Subtree**: `src/Mod/Sketcher/App/planegcs/`
- **Commit pinned at vendoring**: `0a45a0a008d4af7a85601016c5ab31bd26c25b22`
  (FreeCAD `main`, mid-2025) — the same upstream commit as the FreeCAD-derived
  expression library in `third_party/freecad-derived/expressions`.
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
   `SketcherExport` (no DLL-export decoration needed: the objects are linked
   into `forge_kernel` / `forge_kernel_core` directly).
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

The `#include <Eigen/...>` lines in `GCS.h`, `GCS.cpp`, `SubSystem.h`,
`qp_eq.h` and `qp_eq.cpp` are **unmodified**. They resolve to
`3rdParty/planegcs_eigen_shim/`, a Forge-authored drop-in shim backed by
`forge::native::linalg`, which the kernel places on the include path ahead of
any system include. No real Eigen is present in this repository, and the
vendored files were not edited to achieve that.

## How Forge consumes this

`forge-kernel/CMakeLists.txt` compiles the five vendored `.cpp` files
(`PLANEGCS_SRC`: `Constraints.cpp`, `GCS.cpp`, `Geo.cpp`, `SubSystem.cpp`,
`qp_eq.cpp`) into **both** shared libraries the kernel produces —
`add_library(forge_kernel SHARED ...)` and `add_library(forge_kernel_core
SHARED ...)`. `libforge_kernel_core.dylib` is the one that ships in
`Forge.app/Contents/Frameworks`. The objects are inside it; there is no separate
planegcs library file.

The Forge-native wrapper at `forge-kernel/src/Sketcher.cpp` /
`forge-kernel/include/forge/Sketcher.hpp` projects `GCS::System` onto a
handle-based API that the N-API binding forwards to JS as
`window.forge.sketcher.*`. Inside the repository the vendored headers are
included by six files, all under `forge-kernel/`: `src/Sketcher.cpp`,
`include/forge/Sketcher.hpp`, `src/ft/SketchInspect.cpp`,
`include/forge/ft/SketchInspect.hpp`, `src/binding_sketchdiag.cpp` and
`test/ft/sketch_solve_test.cpp`.

That linkage — LGPL-2.1-or-later objects inside a shipped Forge library — is
what `third_party/PLANEGCS_STATIC_LINK_OPTIONS.md` exists to cost. This file
does not decide it.

## Verbose mode

The planegcs solver, when run with `Base::Console().verbose = true`, will
spew QR timing / iteration logs to stderr — useful for diagnosing
ill-conditioned sketches. Forge exposes no public switch for it yet
(default-off, by design).
