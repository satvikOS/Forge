# libforge_gcs — modifications to FreeCAD planegcs

LGPL-2.1 section 2(a) requires a modified file to carry a prominent notice that it
was changed and the date of the change. Every modified file below carries that
notice in a `MODIFIED FOR FORGE` box directly under its original licence header, and
this document is the complete record. `tools/gates/freecad_derived_lgpl_gate.sh`
fails if a file is changed without being listed here, if a file listed as verbatim no
longer matches upstream byte for byte, or if a modified file loses its notice.

## Upstream

| | |
|---|---|
| Project | FreeCAD — <https://github.com/FreeCAD/FreeCAD> |
| Commit | `0a45a0a008d4af7a85601016c5ab31bd26c25b22` |
| Subtree | `src/Mod/Sketcher/App/planegcs/` |
| Licence | LGPL-2.1-or-later (SPDX header in every file; full text in `COPYING.LGPL`) |
| Copyright | © 2011 Konstantinos Poulios; © 2014 Victor Titov (DeepSOIC); and the FreeCAD contributors |

The unmodified import is its own commit on the branch that introduced this
directory ("import FreeCAD planegcs VERBATIM at 0a45a0a"), so `git diff` of that
commit against any later one shows every change to the upstream files exactly.

## What was done, in one paragraph

planegcs is built as ONE shared library, `libforge_gcs`, whose only exported
interface is a C ABI (`include/forge_gcs/forge_gcs.h`). Every planegcs class is
compiled with hidden visibility, so no Eigen or Boost type and no C++ class layout
crosses the library boundary. That is what lets someone rebuild this library from
these sources and drop it into an installed Forge — the relinking freedom LGPL-2.1
section 6 protects — without Forge being recompiled. The FreeCAD runtime services the
solver reached for (logging, timing, export macros) are replaced by small stand-ins.
Debug-only code Forge cannot use is removed. The rank diagnosis keeps the conflict
*groups* it already computes, so Forge can tell a user which constraints contradict
each other instead of printing one flattened list. No numerical algorithm is changed.

## Upstream files

`sha256 (upstream)` is the hash of the file at the upstream commit. The gate re-hashes
every `verbatim` file against it.

| file | status | sha256 (upstream) |
|---|---|---|
| `planegcs/Constraints.cpp` | verbatim | `023f2f7753aff95ded246f41521527a07a1b82ba8815da327ad692e864156d7f` |
| `planegcs/Constraints.h` | **modified** | `e088865959562632c27ce5c29d67933f4f543dc716679e696d8473eb60a198d6` |
| `planegcs/GCS.cpp` | **modified** | `4ce413be489276e228160fa52f3aa533dd6b31136d41c36f7f0a9f34f9e8fab2` |
| `planegcs/GCS.h` | **modified** | `20d89779bbc17af5e3b3e4f070cb6efaacac5e3c08fea393cbffcc0522060b16` |
| `planegcs/Geo.cpp` | verbatim | `169aad09829b81288d3a81d81cd00fdb5ce9723a4ee34450fb0ac8667b8e9e2b` |
| `planegcs/Geo.h` | **modified** | `20c2de0ed0b5b6e2aa6e7f7f302ec11ce798bcb653b051d44cf5de7b60590af5` |
| `planegcs/qp_eq.cpp` | verbatim | `dc71350766c1a4edf7024d593cb5d55b0736a4f43d319d25a9c961e8342ca11c` |
| `planegcs/qp_eq.h` | verbatim | `34e373d9b3b0f5938c849ea7489a8405617692a5062198e8ae0f0c6ac5e4d468` |
| `planegcs/SubSystem.cpp` | verbatim | `28c94e84ff50187ec9b6060ac72e05fb6671a51fae2be40f479d2b4dd151e393` |
| `planegcs/SubSystem.h` | verbatim | `99e1380a0a08d9fd7ee0fd69e26d3d9dcb46fdf033f4c397c9a05e8df8c53dc4` |
| `planegcs/Util.h` | verbatim | `33aee54b020e565faf96629a6d4a57a75a3699acb2336aa96d3663cd70c7e53e` |

## Changes to upstream files

### 2026-09-15

**`planegcs/Constraints.h`, `planegcs/Geo.h`, `planegcs/GCS.h`** — the include
`"../../SketcherGlobal.h"`, which points into FreeCAD's module tree, is replaced by
`"SketcherGlobal.h"`, supplied by `compat/`.

**`planegcs/GCS.cpp`** —
- `#include <Base/Console.h>` and `#include <FCConfig.h>` (FreeCAD's runtime) are
  replaced by `#include "forge_gcs_console.h"` (`compat/`). Solver log and warning
  messages go to a sink the host installs with `forge_gcs_set_log_sink()`; with none
  installed they are discarded. Timing uses `std::chrono::steady_clock`.
- `#include <boost_graph_adjacency_list.hpp>` (a FreeCAD wrapper that silences
  warnings) is replaced by the canonical `#include <boost/graph/adjacency_list.hpp>`.
- The replacement `Eigen::FullPivLU<MatrixXd>::compute` compiled only for Eigen older
  than 3.3 is removed; that configuration is now a compile-time `#error`. Forge builds
  against Eigen 3.3 or newer, where the stock implementation is used — as it already
  was for every FreeCAD build on a current Eigen.
- `System::extractSubsystem()` (about 2,000 lines) and its three call sites are
  removed. It existed only when `_GCS_EXTRACT_SOLVER_SUBSYSTEM_` was defined, which
  upstream never does, and wrote the solver subsystem to `subsystemfile.txt` in the
  working directory to help file bug reports against Eigen.
- `System::identifyConflictingRedundantConstraints` additionally records
  `conflictingTagGroups` (the tags of each conflict group, filtered exactly as the
  existing flattened `conflictingTags` is) and `proposedRemovalTags` (the tags its
  existing removal heuristic chose). `System::clear()` and the start of
  `System::diagnose()` reset both. No existing value is computed differently.

**`planegcs/GCS.h`** —
- Declares the two members above and the getters `getConflictingGroups()` and
  `getProposedRemovals()`, which return empty results when no diagnosis is held, like
  the existing getters.
- The declaration of `extractSubsystem()` is removed and defining
  `_GCS_EXTRACT_SOLVER_SUBSYSTEM_` is a compile-time `#error`.

## Files added for Forge (part of this LGPL library)

All carry `SPDX-License-Identifier: LGPL-2.1-or-later` and were written on 2026-09-15.

| file | purpose |
|---|---|
| `include/forge_gcs/forge_gcs.h` | the library's C ABI: opaque systems, geometry, one constraint primitive per planegcs entry point used, solve, diagnosis (dof, conflicting / redundant / partially redundant tags, conflict groups, removal proposals, dependent parameters and their groups), per-tag error and removal, ABI version, log sink |
| `src/forge_gcs.cpp` | its implementation: owns the parameter storage, validates every index and kind, converts every failure and every exception into a result code plus a sentence (`forge_gcs_last_error`) |
| `compat/SketcherGlobal.h` | stands in for FreeCAD's export-macro header; exports nothing |
| `compat/forge_gcs_console.h` | stands in for FreeCAD's `Base::Console` and `Base::TimeElapsed` |
| `CMakeLists.txt` | builds `libforge_gcs` as a SHARED library, standalone or via `add_subdirectory` |
| `build_forge_gcs.sh` | the same build without CMake, for script-driven gates |
| `test/forge_gcs_abi_test.c` | a C program that exercises the ABI through its plain C header |

## Removed from Forge in the same change

The previous copy of these sources at `forge-kernel/3rdParty/planegcs/` was compiled
**statically** into `libforge_kernel_core.dylib` and the Node addon. It is deleted,
together with the Eigen compatibility shim that copy compiled against
(`forge-kernel/3rdParty/planegcs_eigen_shim/`, Forge's own code, which has no other
user). Forge now links `libforge_gcs` dynamically and compiles no solver source.
