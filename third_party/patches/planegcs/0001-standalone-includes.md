# planegcs 0001 — standalone includes

**Dependency:** `planegcs` (FreeCAD `src/Mod/Sketcher/App/planegcs/`)
**Upstream commit:** `0a45a0a008d4af7a85601016c5ab31bd26c25b22`
**Applies to:** `forge-kernel/3rdParty/planegcs/`

## What this file is, and what it is not

It is **not** a unified diff, and it is deliberately not presented as one.

A `.patch` here would need the upstream side of the diff. The FreeCAD tree at
`0a45a0a` is not in `.forge-local/sources/`, so producing one offline would mean
writing down what the upstream lines *probably* were — a fabricated artefact that
would look authoritative and could never be applied. The lock records that
honestly: this patch entry carries `"diffable_against_upstream": false`.

What this file **is**: a machine-enforced **content contract**. The checks below
are copied verbatim into `deps.lock.json` under
`dependencies[planegcs].patches[0].content_checks`, and
`tools/deps/forge_deps.py verify` fails if any of them stops holding.

### What the contract proves
That the vendored tree is still in the modified state Forge expects — the
FreeCAD-layout includes are gone and the Forge replacements are present.

### What it does not prove
That the *rest* of each file still matches upstream `0a45a0a`. That is covered
separately, and coarsely, by `dependencies[planegcs].fingerprint`: a content hash
over the vendored sources. If anyone edits the algorithmic body of `GCS.cpp`, the
fingerprint changes and `verify` fails — it just cannot tell you the edit was
algorithmic rather than cosmetic.

To upgrade this to a real diff: seed FreeCAD `0a45a0a` into
`.forge-local/sources/planegcs/`, then generate and commit the diff, and flip
`diffable_against_upstream` to `true`.

## The edits

The upstream sources assume FreeCAD's own source layout (`Base/Console.h`,
`FCConfig.h`, `SketcherGlobal.h` two directories up). All edits are at the include
layer; no algorithmic code was touched.

### 1. `GCS.cpp` — FreeCAD platform headers replaced

| removed (upstream) | added (Forge) |
|---|---|
| `#include <Base/Console.h>` | `#include "forge_planegcs_stub.h"` |
| `#include <FCConfig.h>` | *(folded into the stub)* |
| `#include <boost_graph_adjacency_list.hpp>` | `#include <boost/graph/adjacency_list.hpp>` |
| | `#include <boost/graph/connected_components.hpp>` |

`forge_planegcs_stub.h` lives next to the vendored sources and supplies
stand-ins for `Base::Console()` (a silent stderr forwarder) and
`Base::TimeElapsed` (a `<chrono>` timer). `boost_graph_adjacency_list.hpp` is a
FreeCAD-local warning-suppressing wrapper; Forge includes the canonical Boost
header directly.

### 2. `GCS.h`, `Constraints.h`, `Geo.h` — export macro header path

`#include "../../SketcherGlobal.h"` → `#include "SketcherGlobal.h"`

The replacement `SketcherGlobal.h` sits beside the vendored sources and stubs out
`SketcherExport` to nothing: planegcs is statically linked into
`forge_kernel.dylib`, so no DLL-export decoration is needed.

## Enforced checks

| file | must contain | must not contain |
|---|---|---|
| `GCS.cpp` | `#include "forge_planegcs_stub.h"`<br>`#include <boost/graph/adjacency_list.hpp>`<br>`#include <boost/graph/connected_components.hpp>` | `#include <Base/Console.h>`<br>`#include <FCConfig.h>`<br>`#include <boost_graph_adjacency_list.hpp>` |
| `GCS.h` | `#include "SketcherGlobal.h"` | `#include "../../SketcherGlobal.h"` |
| `Constraints.h` | `#include "SketcherGlobal.h"` | `#include "../../SketcherGlobal.h"` |
| `Geo.h` | `#include "SketcherGlobal.h"` | `#include "../../SketcherGlobal.h"` |

Run them with:

```
python3 tools/deps/forge_deps.py verify
```

## License

planegcs is `LGPL-2.1-or-later` (SPDX header in every vendored file). These edits
do not change that. Provenance detail: `forge-kernel/3rdParty/planegcs/UPSTREAM.md`.
