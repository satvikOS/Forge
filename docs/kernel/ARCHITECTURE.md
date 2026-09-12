# The Forge Kernel — architecture

Companion to `MIGRATION.md` (the judgement about OCCT removal) and
`OCCT_REMOVAL_TRACKER.md` (the generated census). This file answers a different
question: **what are the layers, what does `forge-kernel/include/forge/` actually
expose, where is OCCT still sitting, and what is the ShapeHandle/ShapeRegistry
boundary.**

Every number below was produced by a command run against this tree. The commands
are in `## How to re-measure` so a reader can falsify any line. Where a claim is
about something NOT built, it says so as plainly as the claims about what is.

**Measured at `ddef657b` (`kernel(math): Point3 had three declarations, and it is
NOT Vec3`), 2026-09-12.** The censuses below are taken over `git ls-files` and
files as committed; the gate runs in §5 and §6 were executed while every tracked
file matched `ddef657b` (`git status --porcelain=v1` then listed 6 entries, all
untracked new docs). Do not read "clean tree" into that: other agents are writing
in this worktree, and that same command reported 9 entries, one of them a modified
tracked file, an hour later. HEAD will have moved too. Re-run the commands before
quoting a number into a decision.

---

## 1. The layer stack

Six independent include roots own the `forge/` prefix. **A `#include "forge/…"`
line is not evidence that a file touches the kernel.**

| root | headers | what it is |
|---|---:|---|
| `forge-kernel/include/forge` | 482 | the kernel API — this document's subject |
| `ui/include/forge` | 44 | `forge::ui`, the application's models and panels |
| `retrieval/include/forge` | 6 | retrieval |
| `orchestration/include/forge` | 5 | orchestration |
| `simulation/include/forge` | 3 | simulation |
| `archie/include/forge` | 1 | Archie |

`forge::ui` does not include a single kernel header. All 433 `forge/…` include
lines under `ui/{include,src,test}` are `forge/ui/…`, and `ui/` carries **0 OCCT
include lines**. The application (`forge-desktop`) is the seam where the UI layer
and the kernel meet — that is an architectural property, not an accident, and it
is why an OCCT header reaching the app is a boundary question rather than a UI
question.

Downwards from the app:

```
  Electron / JS                    forge-desktop (C++/SDL2/Vulkan/ImGui)
        │                                  │                    │
        │  N-API                           │ C++ API            │ spawn
  forge_kernel (.node)            forge_kernel_core        forge_kernel_worker
   470 TUs, incl. the 5                465 TUs — the same    (one IR program per
   binding*.cpp                        set minus those 5      process; the process
        │                                  │                   the app may lose)
        └──────────────┬───────────────────┘
                       │
        forge-kernel/include/forge  ← the Forge-owned API surface (482 headers)
                       │
        forge-kernel/src/native/…   ← 20 subsystem dirs + 3 loose (§3)
                       │
                     OCCT           ← 6 toolkits linked, 14 dylibs shipped
```

* `forge_kernel` and `forge_kernel_core` are **the same source set**. CMake reads
  `FORGE_KERNEL_SOURCES` (**470** `.cpp` entries, `CMakeLists.txt:1882-2504`, every
  one of them a file that exists) and filters out the N-API translation units to
  build the node-free core (`forge-kernel/CMakeLists.txt:2576-2592`). The filter is
  the regex `(^|/)binding[^/]*\.cpp$`, so it removes **five** TUs, not the four its
  own comment names: `src/binding.cpp`, `binding_geom.cpp`, `binding_field.cpp`,
  `binding_sketchdiag.cpp` **and `src/ft/binding_ft.cpp`** (`:2495`). Those five are
  exactly the five files under `forge-kernel/src` that include `<napi.h>`, so the
  filter is right and the comment beside it is one file short. `forge_kernel_core`
  is therefore **465** TUs, and it links with **no** `-undefined dynamic_lookup`, so
  a stray Node symbol in a non-binding file fails the link loudly (the comment at
  `:2613-2625` records the 40 undefined OCCT symbols this actually caught).
* The JS surface is **340 `exports.Set(` registrations** across the four
  `src/binding*.cpp` TUs (19,567 lines, of which `binding.cpp` is 17,940);
  counting the fifth N-API TU as well it is **341 across 19,678 lines**
  (`src/ft/binding_ft.cpp` is 111 lines and registers one entry point).
* `forge_kernel_worker` (`forge-desktop/src/kernel_worker_main.cpp`) is the
  out-of-process kernel: one feature-IR program on stdin, a progress trail of
  `FORGE-OP <id> <NAME>` lines on stderr, a header plus binary vertex records on
  stdout. It exists so an OCCT segfault kills a process instead of the document.
* `FORGE_NATIVE_BREP` defaults **ON** (`forge-kernel/CMakeLists.txt:51`).

The linked-OCCT facts are the tracker's, from `otool -L` on
`/Applications/Forge.app` 0.1.3329 (`tools/kernel/occt_linked_snapshot.json`,
measured 2026-09-11): `forge_desktop` and `forge_kernel_worker` each link **6**
toolkits (TKBRep, TKG3d, TKGeomBase, TKMath, TKTopAlgo, TKernel), `forge_update`
links **0**, and the bundle ships **14** dylibs. That snapshot is a build
artefact, not this tree; do not re-derive it from CMake.

---

## 2. What `include/forge/` exposes

**482 headers.** 306 sit directly in `include/forge/`; the other 176 are in its
**four** subdirectories (`native/`, `math/`, `ft/`, `capi/`) — `native/` being the
only one with subdirectories of its own.

| path | headers | OCCT include lines (in n headers) | note |
|---|---:|---:|---|
| `forge/` (top level) | 306 | 32 (in 10) | the public API + the engineering surface |
| `forge/native/` | 161 in 21 subsystems + 3 loose | 62 (in 18) | the in-house kernel (§3) |
| `forge/math/` | 7 | 0 | Vec3, Mat3, Transform, Quaternion, Axis, Point3, Math |
| `forge/ft/` | 4 | 0 | FeatureTree, ChunkChain, GraphAudit, SketchInspect |
| `forge/capi/` | 1 | 0 | the opaque-handle C ABI |

(Lines and files are different numbers and the column has to say which: 10 + 18 =
the 28 headers of §4, while 32 + 62 = the 94 include lines they contain.)

### The top level is mostly not geometry

Of the 306 top-level headers, **40 name `ShapeHandle` at all**. The other ~266 —
`AashtoPavement.hpp`, `Psychrometric.hpp`, `WindTowerFoundation.hpp`,
`ReverseOsmosis.hpp` and so on — are the engineering/analysis surface: they take
and return numbers, not bodies. When someone says "the Kernel API", the part that
touches a shape is the minority of the file count. Sizing the OCCT-removal job off
"306 public headers" overstates it by roughly 7×.

### `forge/math/` — Forge-owned, 784 lines, adopted

7 headers, 0 OCCT. `Vec3` is **one type**: the nine module-local declarations are
`using Vec3 = forge::math::Vec3;` aliases and
`tools/kernel/vec3_unification_gate.py` fails if a tenth appears (it is green on
this tree). As of `ddef657b`, `Point3.hpp` (56 lines) defines a **distinct
`struct Point3`**, not an alias of `Vec3` — the commit message says so and the
file has `struct Point3` at line 46.

### `forge/capi/forge_capi.h` — built, tested, and used by nothing

285 lines, 0 OCCT, **27 `FG_API` declarations / 24 `Fg*` verbs**, strict C99
opaque handles (`FgHandle`, `FgSession`). It is **compiled**:
`src/native/capi/forge_capi.cpp` (709 lines, 0 OCCT) is in `FORGE_KERNEL_SOURCES`
at `CMakeLists.txt:2502`, and `kernel.capi_smoke` links `forge_kernel_core`
(`:3048-3058`).

And **nothing else in the tree includes it.** The complete includer list is the
header itself, its own `.cpp`, and `forge-kernel/test/capi/forge_capi_smoke.cpp`.
Neither `forge-desktop/src` nor `ui/src` names `FgSession` or `forge_capi`. The C
ABI is a real, compiled, smoke-tested surface with zero production callers. That
is a scope fact, not a defect — but a reader should not infer from its existence
that the app goes through it. It does not; the app uses the C++ headers.

---

## 3. The `native/` subsystem list

21 subsystem directories plus 3 loose headers (`Predicates.hpp`,
`ExactPredicates3D.hpp`, `ExactReal.hpp`). OCCT include lines counted with the
tracker's own header-family regex over `git ls-files`, so these numbers add up to
the tracker's.

| subsystem | headers | sources | OCCT (hdr) | OCCT (src) | files carrying OCCT |
|---|---:|---:|---:|---:|---:|
| **brep** | 65 | 63 | 44 | 534 | **31** |
| **geom** | 25 | 24 | 18 | 59 | **6** |
| mesh | 27 | 28 | 0 | 0 | 0 |
| implicit | 10 | 10 | 0 | 0 | 0 |
| voxel | 8 | 7 | 0 | 0 | 0 |
| fea | 5 | 0 | 0 | 0 | 0 |
| shape | 4 | 4 | 0 | 0 | 0 |
| csg | 3 | 3 | 0 | 0 | 0 |
| gdt | 2 | 2 | 0 | 0 | 0 |
| am, cam, composites, em, linalg, materials, storage, surfit, tolstack, util, viz, vvuq | 1 each | 1 each (em/0) | 0 | 0 | 0 |
| loose (`Predicates`, `ExactPredicates3D`, `ExactReal`) | 3 | 3 | 0 | 0 | 0 |

The rows are the 21 directories under `include/forge/native/`, and the source
column is what `src/native/<same name>/` holds. `src/native/` itself has **20**
directories, and they are not a subset: `em/` and `fea/` are header-only (0
sources, as the table shows), while `src/native/capi/` has no header here at all
and so has no row — it holds `forge_capi.cpp`, the C ABI's single implementation
TU (§2), 0 OCCT. The union is 22 subsystem directories.

### The OCCT in `native/` is a named bridge layer, not a diffuse dependency

This is the fact that most changes how the tree reads, and it is not visible in
the tracker's per-subsystem totals.

All **31** OCCT-carrying files in `native/brep` are bridges, by name: 16 sources
and 15 headers, every one of them `Native*` (`NativeFilletChamfer`,
`NativeThickSolid`, `NativeLoftPipe`, `NativeDraft*`, `NativeShapeHeal*`,
`NativeThickenShell`, `NativeVariableFillet`, `NativeWireFill`, `NativeFilling`,
`NativeSectionFill`, `NativeAabbBridge`), `Step{Read,Write}Occt`, or
`FaceNormal.hpp`. The other 47 sources and 50 headers — `Topology`, `Boolean`,
`Fillet`, `Chamfer`, `Surface`, `Curve`, `Nurbs*`, `Primitives`, `Sew`, `Heal`,
`Check`, `Query`, `Section`, `OffsetShape`, `Shell`, `UnifyFaces`, `MassProps`,
`Hlr`, `Gear`, `Loft`, `Sweep`, `Iges*`, `Step{Analytic,Faceted,Part21,Read,
Watertight}` — carry **zero** OCCT include lines.

Same shape in `native/geom`: all 77 lines sit in **three** `Native*`
header/source pairs — `NativeNurbsConvert`, `NativePCurveFit`, `NativeProjection`.

And the 594 `gp_Pnt` uses MIGRATION.md reports for `src/native/brep` are **all in
14 files**, every one of them a bridge — 159 in `NativeLoftPipe.cpp`, 121 in
`NativeFilletChamfer.cpp`, 94 in `NativeThickSolid.cpp`, 62 in
`NativeVariableFillet.cpp`, and so on down to 5. Zero `gp_Pnt` appears in any core
B-Rep source. (Those are *occurrences*, which is what MIGRATION.md's 594 counts and
what the 14 sum to; `grep -c` would answer the different question "how many lines",
which totals 543.)

Read together with MIGRATION.md: its warning stands — the OCCT vocabulary is real
and substituting it is the work — but the shape of that work is **14 to 31 named
bridge files**, not 63 sources that need rewriting. Anyone planning from "the
native tree is not independent of OCCT" alone will size this wrong in the
pessimistic direction.

### `native::shape::Shape` — the TopoDS_Shape successor: built, not adopted

`forge/native/shape/Shape.hpp` is the designated OCCT-zero replacement for
`TopoDS_Shape`: a trivially-copyable non-owning tagged pointer with `type()`,
safe downcasts, identity and `std::hash`. Its four sources
(`Shape/Wire/Compound/Explore.cpp`) **are** in `FORGE_KERNEL_SOURCES`
(`CMakeLists.txt:2344-2347`), and `test/native/brep/shape_facade_test.cpp`
exercises it.

**Production files outside `native/shape/` that include it: zero. Files outside
`native/shape/` that name `native::shape::`: zero** — tree-wide the string occurs
in exactly one file, `Shape.hpp` itself, on lines 136-137 (its own `std::hash`
specialisation, which has to leave the namespace to specialise). The one file that
takes the type by name is its test, via `using shape::Shape;`.
This is the exact pattern MIGRATION.md names
for Vec3 — a directory can be OCCT-free by being unused. The successor type exists
and compiles; nothing has migrated onto it. Treat "Shape exists" as a completed
foundation, and "anything uses Shape" as not started.

---

## 4. The ShapeHandle / ShapeRegistry boundary

This is where the app/kernel line is actually drawn, and it is drawn in **headers**
— not in which `.cpp` names an OCCT type.

### Two headers, one entry table

`forge/ShapeHandle.hpp` — 45 lines. Includes `<cstdint>` and nothing else:

* `using ShapeHandle = std::uint32_t;` and `kInvalidHandle = 0`
* `enum class ShapeKind : std::uint8_t { Occt, NativeSolid, NativeMesh }`
* four free functions — `shapeKind`, `shapeHandleKnown`, `retainShape`,
  `releaseShape` — deliberately free rather than members so a caller asking "what
  kind of body is this" need not include the registry's class definition.
  `src/ShapeHandle.cpp` answers them by forwarding to `ShapeRegistry::instance()`.

`forge/ShapeRegistry.hpp` — 117 lines. Includes `forge/ShapeHandle.hpp`,
`<TopoDS_Shape.hxx>` **unconditionally** (line 30), and under
`#ifdef FORGE_NATIVE_BREP` the complete `native/brep/Topology.hpp` and
`native/mesh/HalfEdgeMesh.hpp` (the `Entry` owns `shared_ptr`s of those types, so
forward declarations will not do).

`Entry` is a variant: `ShapeKind kind`, a `TopoDS_Shape shape` by value, a
refcount, and — only under `FORGE_NATIVE_BREP` — a
`shared_ptr<TopologyBuilder> owner` + `Solid* solid`, and a
`shared_ptr<HalfEdgeMesh> mesh`. One `uint32_t` handle addresses all three
backends; `makeBox`/`cut`/`fillet`/`massProps`/`tessellate` are identical in JS
whichever produced the body.

### The header's `get()` comment and the implementation disagree

`ShapeRegistry.hpp:66-67` documents `get()` as throwing "if the entry is NOT a
`Kind::Occt` entry". `ShapeRegistry.cpp:56-84` does not do that: for a
`NativeSolid` handle it **lazily materialises** the OCCT shape via
`occtFromNativeSolid(*e.solid)` and caches it in `e.shape` (which is why
`entries_` is `mutable`), so a native body flows transparently through every
OCCT-only op. Only `NativeMesh` throws. The behaviour is documented correctly in
the private-members comment at `:110-111` and in the `.cpp`; it is the public
doc comment that is stale. Recorded here rather than fixed — this file is owned by
another agent's work in this tree.

### Include census — the boundary, counted

| header | files that `#include` it | where |
|---|---:|---|
| `forge/ShapeHandle.hpp` | 37 | 35 public kernel headers, 1 kernel `.cpp`, 1 app TU (`ModelQuality.cpp`) |
| `forge/ShapeRegistry.hpp` | 53 | 40 kernel `.cpp`, 7 kernel tests, 4 public headers, 2 app TUs |

The four public headers still pulling in the registry (and therefore OCCT) are
`Drawings.hpp`, `NativeOcctBridge.hpp`, `BodyInventory.hpp`, `FeaTet.hpp`. The two
app TUs are `forge-desktop/src/FileExchangeHost.cpp` (its own `#include` at line
21) and `forge-desktop/test/quality_gate.cpp`.

### How far the OCCT taint actually reaches into the API

Computing the include closure over `include/forge` (a header is tainted if it
includes an OCCT header, or includes a `forge/` header that is tainted):

* **28** of 482 public headers include an OCCT header **directly** — matching the
  tracker's 28, of which 6 are the expected legacy adapter (`Occt*.hpp`,
  `NativeOcctBridge.hpp`) and 22 are, in the tracker's phrasing, "the Kernel API
  proper". Read that 22 with §3 beside it: **18 of them are the `native/`
  bridge headers** (15 in `brep`, 3 in `geom`), and only **4** are top-level API
  headers.
* **32** of 482 are tainted **transitively**. The four additional ones are
  `BodyInventory.hpp` and `FeaTet.hpp` (via `ShapeRegistry.hpp`) and
  `ArcHelix.hpp` and `Features.hpp` (via `Sketcher.hpp`, which includes
  `<TopoDS_Wire.hxx>`).
* So **450 of 482 public headers are OCCT-free, including transitively.**

At the top level, exactly four API-proper headers name OCCT themselves:
`ShapeRegistry.hpp` (`TopoDS_Shape`), `Sketcher.hpp` (`TopoDS_Wire`),
`Drawings.hpp` (`TopoDS_Shape`, `gp_Pln`, `gp_Pnt2d`) and `Mold.hpp`
(`TopoDS_{Edge,Face,Shape}`, `gp_Dir`, `gp_Pnt`).

### The OCCT-free query API that made the boundary movable

`forge/ShapeQuery.hpp` (89 lines, includes only `ShapeHandle.hpp`, `<cstddef>`,
`<vector>`) is the pattern: `shapeBounds`, `shapeFaceCount`, `shapeSolids`,
`shapeFaces`, `shapeEdgeJoins`, `shapeDraftFaces` — sub-shape questions answered
in Forge's vocabulary, each returned sub-shape registered as its own handle that
the caller releases. OCCT still answers them, on the kernel side of the line. This
is what let `ModelQuality.cpp` shed its OCCT includes — 13 of them, per
`ShapeQuery.hpp`'s own preamble; `forge-desktop/src` measures 0 today.

---

## 5. What proves each claim

| gate | invoked from | what it proves | what it does NOT |
|---|---|---|---|
| `tools/kernel/occt_dependency_graph.py --check` | `.github/workflows/gate-registration.yml:196` | the committed tracker matches the tree (GREEN here) | it is a **drift detector, not a ratchet** — adding OCCT to a public header turns it red until someone regenerates, and regenerating makes it green again with a larger number. Nothing asserts the count may not grow. |
| `tools/kernel/vec3_unification_gate.py` | `gate-registration.yml:210-211` | `Vec3` is one type; module epsilon guards intact (green here) | says nothing about Plane (7 declarations), AABB (4) or Mat3 (3) |
| `tools/kernel/topology_honesty_gate.py` | `gate-registration.yml:225-226` | every claim in `native/brep/Topology.hpp`'s scope note matches a code probe (green here) | covers that one header's note only |
| `forge-desktop/test/run_syntax_gate.sh --mutations` | `.github/workflows/kernel-tests.yml:318` | the app type-checks with **no OCCT include path** (§6) | it checks 29 of 41 classified TUs, and its census is `-maxdepth 1` |

**There is no gate asserting that `ShapeHandle.hpp` stays OCCT-free**, and none
asserting that the count of OCCT-exposing public headers may only fall. Both would
be cheap; neither exists.

---

## 6. The app-side boundary, measured — and three skip reasons are stale

Run here at `ddef657b`, `bash forge-desktop/test/run_syntax_gate.sh` is **GREEN**:
29 translation units type-check under `-std=c++20 -Wall -Wextra -Werror
-fsyntax-only` with an include path of `forge-desktop/src`, the vendored ImGui,
`ui/include`, `forge-desktop/test` and `forge-kernel/include` — **and no OCCT**.
12 TUs are skipped by name, 6 of them for OCCT.

`ModelQuality.cpp` is genuinely in the CHECKED list and green. But the tracker's
summary — "run_syntax_gate.sh compiles **every** forge-desktop translation unit
with no OCCT include path" — is stronger than what the gate does. It compiles 29
of the 41 it classifies.

I re-checked the six OCCT-skipped TUs by hand with the gate's own flags and no
OCCT on the include path:

| TU | result | why |
|---|---|---|
| `src/StudyHost.cpp` | **exit 0** | skip reason stale: `forge/Fea.hpp` includes `forge/ShapeHandle.hpp`, not `ShapeRegistry.hpp` |
| `src/CamHost.cpp` | **exit 0** | skip reason stale: `forge/CamAdvanced.hpp` and `forge/Cam.hpp` both include `ShapeHandle.hpp` |
| `test/differential_solid_gate.cpp` | **exit 0** | skip reason stale (`forge/Topology.hpp` includes `ShapeHandle.hpp`); it needs `-I ui/test` for `ui/test/differential_corpus.hpp` (a committed, hand-written header, not a generated one), which the gate's include line does not carry |
| `src/KernelScene.cpp` | fails | real: `forge/BodyInventory.hpp:46` → `forge/ShapeRegistry.hpp:30` → `<TopoDS_Shape.hxx>` |
| `src/FileExchangeHost.cpp` | fails | real, but not for the stated reason: the `.cpp` includes `forge/ShapeRegistry.hpp` itself at line 21 (`forge/IoExchange.hpp` has already migrated to `ShapeHandle.hpp`) |
| `test/quality_gate.cpp` | fails | real, for **two** independent reasons: it includes `forge/ShapeRegistry.hpp` itself at line 70 (which is what clang reports first), and it names `<BRep_Builder.hxx>` and `<TopoDS_Compound.hxx>` at lines 72-73 to build its two-solid fixture. The gate's skip reason cites only the second |

Worth separating from all of that: **`forge-desktop/src` names zero OCCT
include lines.** The only two in the whole of `forge-desktop` are
`quality_gate.cpp`'s fixture includes, and the tracker classifies `/test/` as
ORACLE, which is why its APP row reads 0. The remaining app-side OCCT
dependency is entirely a *header-reachability* problem, exactly as
`ShapeHandle.hpp`'s own preamble argues — not a code problem.

So the boundary is **better than the gate reports**: three of the six are already
OCCT-free and the list under-states finished work. Three genuinely remain, and
**all three** reduce to one header — `forge/ShapeRegistry.hpp`, reached once
transitively (through `BodyInventory.hpp`) and twice by a direct `#include` in the
`.cpp` itself (`FileExchangeHost.cpp:21`, `quality_gate.cpp:70`).
`quality_gate.cpp` alone would still fail after that, because it also names two
OCCT headers directly.

The gate is not edited here (other agents are working in this tree). Anyone
picking this up: correcting the SKIPPED list is a three-line change, and moving
`BodyInventory.hpp` to `ShapeHandle.hpp` would leave the two direct `.cpp`
includes and `quality_gate.cpp`'s fixture as the remainder.

One more scope note on that gate: its census is
`find forge-desktop/{src,test} -maxdepth 1`, which is 41 files. The **6**
translation units under `forge-desktop/src/update/` (`Updater.cpp`,
`Manifest.cpp`, `ManifestSignature.cpp`, `Sha256.cpp`, `Version.cpp`,
`main_update_cli.cpp`) are neither checked nor skipped — the "a new TU cannot join
forge-desktop unnoticed" property holds only at depth 1. They build the
`forge_update` binary, which links 0 OCCT toolkits, so this is a coverage hole in
the syntax gate rather than an OCCT one.

---

## 7. Stated plainly: what is NOT built

* **`native::shape::Shape` is not adopted.** Compiled and tested, zero production
  includers outside its own directory, and zero files outside that directory
  naming `native::shape::` (the only occurrence tree-wide is `Shape.hpp`'s own
  `std::hash` specialisation). The replacement for `TopoDS_Shape` exists; the
  migration onto it has not started.
* **The C ABI has no production callers.** `forge/capi/forge_capi.h` is built into
  the kernel and smoke-tested, and is included by exactly three files, all its own.
* **`ShapeRegistry.hpp` still names `TopoDS_Shape`** in `add()`, `get()` and its
  private `Entry`, unconditionally. Four public headers and two app TUs still
  reach it.
* **The vocabulary below Vec3 is still fragmented**: Plane has 7 declarations,
  AABB 4, Mat3 3 (tracker §"Is the Forge vocabulary ADOPTED"). `Point3` became a
  single distinct type at `ddef657b`.
* **No gate forbids OCCT re-entering a public header.** The tracker detects the
  change; nothing rejects it.
* **The syntax gate does not cover `forge-desktop/src/update/`** (6 TUs), and its
  OCCT skip list is 3 entries out of date in the conservative direction.
* Native B-Rep scope limits live in `forge/native/brep/Topology.hpp`'s own scope
  note, which `topology_honesty_gate.py` probes claim-by-claim: no general Euler
  operator completeness (only MEV/MEF), no non-manifold representation (an `Edge`
  has exactly two coedge slots), no genus>0 handle operators, no persistent-ID
  minting. That note is gated; this file does not restate it, because two copies
  of a scope note is how one of them goes stale.

---

## How to re-measure

Run from the worktree root.

```sh
# §1 include roots and the ui/ decoupling
for r in archie orchestration retrieval simulation ui forge-kernel; do
  echo -n "$r: "; git ls-files "$r/include/forge" | grep -cE '\.(hpp|h)$'; done
grep -rhoE '#include[[:space:]]*[<"]forge/[A-Za-z0-9_]+' ui/src ui/include ui/test \
  | sed 's/.*forge\///' | sort | uniq -c

# §1 source-set size and the N-API surface. Count ENTRIES, not lines ending in
# `.cpp`: 63 of the 470 carry a trailing `#` comment, so a `/\.cpp$/` line regex
# answers 407 — an undercount, and the one this file used to print.
python3 - <<'PY'
import re
blk = open('forge-kernel/CMakeLists.txt').read().split('\n')[1881:2504]
e = [t for l in blk for t in l.split('#', 1)[0].split() if t.endswith('.cpp')]
core = [x for x in e if not re.search(r'(^|/)binding[^/]*\.cpp$', x)]
print(len(e), 'entries;', len(e) - len(core), 'N-API TUs filtered;', len(core), 'in core')
PY
grep -rl 'napi\.h' forge-kernel/src --include='*.cpp'          # the same 5 files
grep -ohE 'exports\.Set\(' forge-kernel/src/binding*.cpp | wc -l              # 340
grep -ohE 'exports\.Set\(' forge-kernel/src/binding*.cpp \
                           forge-kernel/src/ft/binding_ft.cpp | wc -l         # 341

# §2 header census
git ls-files forge-kernel/include/forge | grep -cE '\.(hpp|h)$'          # 482
git ls-files forge-kernel/include/forge \
  | grep -cE '^forge-kernel/include/forge/[A-Za-z0-9_]+\.hpp$'           # 306
grep -l 'ShapeHandle' forge-kernel/include/forge/*.hpp | wc -l           # 40
# OCCT at the top level: 10 FILES, 32 LINES — the table's column says which
grep -lE '^[[:space:]]*#[[:space:]]*include[[:space:]]*[<"][A-Za-z0-9_]+\.hxx[>"]' \
  forge-kernel/include/forge/*.hpp | wc -l                               # 10
grep -hE  '^[[:space:]]*#[[:space:]]*include[[:space:]]*[<"][A-Za-z0-9_]+\.hxx[>"]' \
  forge-kernel/include/forge/*.hpp | wc -l                               # 32

# §2 the C ABI and its (empty) caller set
grep -cE '^FG_API' forge-kernel/include/forge/capi/forge_capi.h          # 27
# --include='*.h' matters: without it the header itself is not searched and the
# answer is 2 includers, not the 3 this file reports.
grep -rl 'capi/forge_capi.h' --include='*.cpp' --include='*.hpp' --include='*.h' .

# §3 per-subsystem OCCT, using the tracker's own regex (see the script's OCCT_HDR)
python3 tools/kernel/occt_dependency_graph.py --check
# gp_Pnt OCCURRENCES per file (grep -c would count lines: 543, not 594)
for f in $(git ls-files 'forge-kernel/src/native/brep'); do
  n=$(grep -o 'gp_Pnt' "$f" | wc -l); [ "$n" -gt 0 ] && echo "$n $f"; done | sort -rn

# §3 Shape adoption
grep -rl 'native/shape/Shape.hpp' --include='*.cpp' --include='*.hpp' .
grep -rn 'native::shape::' --include='*.cpp' --include='*.hpp' .   # Shape.hpp:136-137 only
grep -rl 'native::shape::' --include='*.cpp' --include='*.hpp' . | grep -v '/native/shape/'

# §4 the boundary census
grep -rlE '^[[:space:]]*#[[:space:]]*include[[:space:]]*[<"]forge/ShapeHandle\.hpp[>"]' \
  --include='*.cpp' --include='*.hpp' --include='*.h' . | wc -l          # 37
grep -rlE '^[[:space:]]*#[[:space:]]*include[[:space:]]*[<"]forge/ShapeRegistry\.hpp[>"]' \
  --include='*.cpp' --include='*.hpp' --include='*.h' . | wc -l          # 53

# §6 the app boundary (bash, not zsh — zsh does not word-split $INC)
bash forge-desktop/test/run_syntax_gate.sh
bash -c 'R=$PWD; INC="-I $R/forge-desktop/src -I $R/forge-desktop/third_party/imgui
  -I $R/ui/include -I $R/forge-desktop/test -I $R/ui/test -I $R/forge-kernel/include"
  for f in src/StudyHost.cpp src/CamHost.cpp test/differential_solid_gate.cpp \
           src/KernelScene.cpp src/FileExchangeHost.cpp test/quality_gate.cpp; do
    clang++ -std=c++20 -Wall -Wextra -Werror -fsyntax-only $INC "$R/forge-desktop/$f" \
      >/dev/null 2>&1; echo "$? $f"; done'
```
