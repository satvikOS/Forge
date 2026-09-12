# File formats — import and export

Companion to `MIGRATION.md` (the judgement) and `OCCT_REMOVAL_TRACKER.md` (the
generated census). This file covers ONE rung of the migration order: **import /
export**. Every number below was measured on this tree at `ddef657b`, clean
working copy, on 2026-09-12. The command that produced each claim is named beside
it.

## The one-line answer

Import/export is the rung where OCCT is **nearly gone but not gone**. The
Data-Exchange toolkits are not linked into anything the app ships — no TKDESTEP,
no TKXSBase, no TKDEIGES, no TKDESTL (`tools/kernel/occt_linked_snapshot.json`
lists the 6 linked toolkits and the 14 shipped dylibs; none of those four appear).
What remains is **124 OCCT include lines in four exchange files**, and they are
not schema code: they are modelling code that builds and reads an OCCT
`TopoDS_Shape`.

| file | production OCCT include lines |
|---|---:|
| `forge-kernel/src/native/brep/StepReadOcct.cpp` | 71 |
| `forge-kernel/src/native/brep/StepWriteOcct.cpp` | 46 |
| `forge-kernel/src/IoExchange.cpp` | 6 (3 of them dead — see below) |
| `forge-kernel/include/forge/native/brep/StepReadOcct.hpp` | 1 (`TopoDS_Shape`, the return type) |
| **every other exchange file** | **0** |

Measured by running the tracker's own `occt_includes()` over each path, so these
are the same lines `OCCT_REMOVAL_TRACKER.md` counts (its "heaviest production
kernel files" table lists StepReadOcct.cpp at 71 and StepWriteOcct.cpp at 46;
the kernel total is 1398).

"Exchange file" here means a **file-format codec** — everything under
`src/native/brep/{Step*,Iges*,MeshExchange}.cpp`, plus `IoExchange.cpp`,
`GltfExport.cpp` and `Dxf.cpp`. It does NOT include `src/OcctImport.cpp`, which
carries **48** OCCT include lines of its own: that file converts a *representation*
(an OCCT handle into a native B-rep) and never touches a file. Do not read the
124 as the exchange rung's whole OCCT bill if you are counting the shape
importer with it.

Of `IoExchange.cpp`'s 6, three — `STEPControl_Reader`, `STEPControl_Writer`,
`Interface_Static` — are inside `#ifndef FORGE_NATIVE_BREP` (IoExchange.cpp:19-23)
and are compiled only into the pure-OCCT fallback build. `FORGE_NATIVE_BREP`
defaults **ON** (`forge-kernel/CMakeLists.txt:51`), so in the shipped kernel those
three lines are dead. The other three (`BRepTools`, `BRep_Builder`, `TopoDS_Shape`)
are live and serve `importBrep` / `exportBrep`, which are OCCT unconditionally.

## Direction table — what is native TODAY

`ShapeKind` matters as much as the format: a handle is `NativeSolid`, `NativeMesh`
or `Occt`, and the export route is chosen from it.

| format | read | write |
|---|---|---|
| STEP (Forge's own analytic dialect) | **native** — `StepAnalytic::read` | **native** — `StepAnalytic::write` (NativeSolid) |
| STEP (foreign, fully reconstructible) | **native** — `readForeignStep` → native B-rep | — |
| STEP (foreign, anything else) | **OCCT-backed** — `foreignStepToOcct` builds a `TopoDS_Shape` | **OCCT-backed** — `StepWriteOcct::write` (Occt handle) |
| STEP (mesh-backed body) | — | **native** — `StepFaceted::write` (NativeMesh, and the fallback for an Occt handle) |
| IGES | **native only** — `readForeignIges`; OCCT's `IGESControl_Reader` include was removed from `IoExchange.cpp` | **not wired** — see "built and unreachable" |
| STL | **native** — `MeshExchange::readSTL` (+ an in-line binary→ASCII transcode) | **native** — `MeshExchange::writeSTL` |
| BREP | **OCCT** — `BRepTools::Read`, unconditional | **OCCT** — `BRepTools::Write`, unconditional |
| glTF 2.0 (.glb) | not built | **native** — `forge::gltf`, tessellating through `forge::Tessellate` |
| DXF (2D only — LINE/CIRCLE/ARC/LWPOLYLINE, not a solid path) | **native** — `forge::dxf::parse`, reached from `binding.cpp:8696` | **native** — `forge::dxf::write`, `binding.cpp:8734` |
| JT, Parasolid | **not built** — both throw a pointer to STEP | not built |
| VRML | **not built** — no path exists (`forge-kernel/CMakeLists.txt:1805`) | not built |

Source: `forge-kernel/src/IoExchange.cpp` read end to end;
`grep -n '#include' forge-kernel/src/GltfExport.cpp` (0 OCCT lines; its header's
"OCCT tessellation deflection" wording is about the parameter, not the backend —
`Tessellate.cpp` has 0 OCCT includes and meshes via `forge::occtmesh`).

Do not read that last parenthesis as more than it says. `forge::occtmesh` itself —
`forge-kernel/src/OcctNativeMesh.cpp` — carries **25** OCCT include lines. What it
dropped is TKMesh/`BRepMesh`, not OCCT. So the faceted STEP fallback for an
OCCT-backed handle is not an OCCT-free path; it is an OCCT path that no longer
needs the mesher toolkit.

## STEP read — the three-rung ladder

`forge::io::importStep` (IoExchange.cpp:78-118) tries, in order:

1. `StepAnalytic::read` — Forge's own analytic dialect. Returns a `NativeSolid`
   usable by the native query/op layer. Declines anything foreign.
2. `readForeignStep` (`StepRead.cpp`, 2317 lines, **0 OCCT includes**) — the full
   AP203/214/242 core zoo including trimmed B-splines, into a native B-rep, then
   sewn. **Accepted only when `unsupported.empty() && closed`.** A partial body is
   never handed back.
3. `foreignStepToOcct` (`StepReadOcct.cpp`, 1792 lines, 71 OCCT includes) — parses
   the same ISO-10303-21 text with the shared `StepPart21` lexer and builds an OCCT
   `TopoDS_Shape` directly through the modelling toolkits. No TKDESTEP.

The runtime gate `forgeNativeStepEnabled()` guards rungs 1 and 2.
**It defaults ON** — `NativeRoute.cpp:89` is `return envSet ? envOn : true`.
Note that the block comment above it, at `NativeRoute.cpp:34` and `:40-41`,
still says "STEP = native STEP import/export. Default OFF. — Wave 3"
and "leaving FEAT/STEP on OCCT". That comment is stale; the function is the fact.

## STEP write — three routes off one switch

`forge::io::exportStep` (IoExchange.cpp:143-248) branches on `ShapeKind`:

* `NativeSolid` → `StepAnalytic::write`. Real quadrics and real curves, not a
  tessellation. Throws on failure — no silent facet fallback.
* `NativeMesh` → `StepFaceted::write`. Every face a flat `PLANE` triangle; the
  header says so plainly and so does the code comment.
* `Occt` → `StepWriteOcct::write`. Serialises the OCCT handle's real surfaces,
  curves and pcurves to AP242 with **no** tessellation. A face whose surface class
  cannot be written analytically is faceted **per face** and counted in
  `facetedFaces`; an unwritable shared **edge** fails the whole write, and only
  then does the faceted route below take over.

That last route exists because the faceted fallback is not always available: it
goes through `forge::tessellate`, which for an OCCT handle calls
`forge::occtmesh::tessellateShapeForViewport` and **honestly returns an empty mesh**
when it defers (`Tessellate.cpp:58-62`, "no BRepMesh"). An empty mesh makes
`exportStep` throw. TKMesh is not linked and not shipped.

## Units — the metre defect is fixed, the inch defect is live

There are **three** independent length-unit resolvers in the exchange layer and
they do not agree. This was measured, not read:

| resolver | file | detects |
|---|---|---|
| `resolveLengthScaleMm` | `StepRead.cpp:982` (declared in `StepRead.hpp:150`) | SI prefixes, context-referenced SI, **typed** `CONVERSION_BASED_UNIT` inch/foot |
| `resolveScale` | `StepReadOcct.cpp:271` (file-local) | SI prefixes in complex records **only** |
| IGES global fields 13/14/15 | `IgesRead.cpp:273-298` | the IGES unit-flag table (1=inch … 7=km) |

The IGES numbering is 1-based *13/14/15* — model-space scale, unit flag, unit name
— read as `fields[12]/[13]/[14]`. Say it exactly, because *14/15/16* is the bug
this reader already fixed: `IgesRead.cpp:273-275` records that "an earlier build
read f14/f15/f16 by mistake, which forced the writer to emit a spurious scale field
and made OCCT mis-read the units".

### The metre defect: FIXED, and gated

`StepAnalytic::read` once had no unit handling at all and read a foreign
`SI_UNIT($,.METRE.)` file raw — exactly 1000× small. It now **declines** rather
than scales (`StepAnalytic.cpp:1133-1158`), dropping the file to `readForeignStep`,
which resolves and applies the scale. Measured live against the prebuilt
`forge-kernel/build-app/libforge_kernel_core.dylib` with a linked probe (no tree
file touched):

```
writer emits MILLI: 1
mm doc    -> StepAnalytic::read ok=1
metre doc -> StepAnalytic::read ok=0
             reason="StepAnalytic.read: unit context is METRE (scale 1000.000000 mm),
                     not millimetres; deferring to the foreign reader"
metre doc -> readForeignStep      ok=1 lengthScaleToMm=1000 unit=METRE     faces=6 closed=1
mm doc    -> readForeignStep      ok=1 lengthScaleToMm=1    unit=MILLIMETRE faces=6 closed=1
metre doc -> foreignStepToOcct    dx=10000   (a "10" box declared in metres)
mm doc    -> foreignStepToOcct    dx=10
```

So all three STEP read paths handle the metre case correctly today. The gate is
`forge-kernel/test/step_unit_decline_gate.cpp`, driven by
`forge-kernel/test/run_step_unit_decline_gate.sh`, which is run by
`.github/workflows/kernel-tests.yml:910`. That script refuses to report success if
the decline string is absent from the source, and it mutates the fix out to prove
the gate can fail. **It rewrites `StepAnalytic.cpp` in place while it runs**, so do
not run it in a worktree another agent is using.

### The inch defect: PRESENT, on both foreign readers, silently

The canonical spelling an exporter emits is a COMPLEX record:

```
#159=(CONVERSION_BASED_UNIT('inch',#1593)NAMED_UNIT(#1592)LENGTH_UNIT());
```

The Part-21 lexer stores a complex record with `type == ""`. `resolveLengthScaleMm`'s
imperial pass requires `ins.type == "CONVERSION_BASED_UNIT"` (`StepRead.cpp:1035`),
so it never matches that spelling. Measured on a Forge-written box whose unit
record was swapped for each form:

```
mm (baseline)         readForeignStep: ok=1 scale=1     unit=MILLIMETRE
                      foreignStepToOcct: dx=10
inch, COMPLEX only    readForeignStep: ok=1 scale=1     unit=MILLIMETRE   <-- 25.4x small
                      foreignStepToOcct: dx=10                            <-- 25.4x small
inch, COMPLEX+SIMPLE  readForeignStep: ok=1 scale=25.4  unit=INCH
                      foreignStepToOcct: dx=10                            <-- 25.4x small
```

Two separate findings:

* **`readForeignStep` needs a redundant simple record.** With the complex form
  alone it falls through to the SI pass and reports the unit the inch is *defined
  in*, with full confidence and `ok=1`. Measured on a variant where the inch is
  defined against a bare metre: `scale=1000 unit=METRE` — off by 1000/25.4 ≈ 39×.
  Nothing in the result says the answer is a guess.
* **`foreignStepToOcct` resolves no inch at all, in either spelling.** Its scale IS
  applied (the metre row above moves 10 → 10000), so this is purely
  `resolveScale` not detecting the unit. That function's own header comment at
  `StepReadOcct.cpp:267-270` says it "finds the LENGTH_UNIT SI_UNIT (prefix,.METRE.)
  **or a CONVERSION_BASED_UNIT (inch/foot)**". It does not:
  `grep -n "INCH\|CONVERSION_BASED" forge-kernel/src/native/brep/StepReadOcct.cpp`
  returns only that comment line and nothing in the body.

The A/B oracle does not catch this. `native_vs_occt_step_read.cpp:218-232` builds
its inch fixture carrying **both** spellings on purpose — `#9104` simple so the
native reader resolves it, `#9106` complex so OCCT does — and its inch assertion is
marked `partialOk` because OCCT does not scale inch on that transfer
(`:451-452`). Its verdict line is `return (g_pass + g_partial == g_total) ? 0 : 1;`
(`:563`), so PARTIAL counts as passing. The CMake list that registers it says so
too: "NOTE: its own verdict counts PARTIAL as passing"
(`forge-kernel/CMakeLists.txt:3170`).

## Built, compiled, tested — and not reachable

State these as plainly as the gaps. Each is finished work; none of it is a to-do.

* **`IgesWrite.cpp` — a real native IGES 5.3 writer, 524 lines, 0 OCCT includes.**
  Emits 186 MANIFOLD SOLID B-REP / 514 SHELL / 510 FACE / 508 LOOP / 504 EDGE /
  502 VERTEX over **190 PLANE SURFACE** (form 1, built from a 116 POINT + two 123
  DIRECTIONs) and 128 RATIONAL B-SPLINE surfaces, with 110 LINE per edge. Not
  108 — `IgesWrite.cpp:238` is `B.add(190, 1, ...)`, and the comment at `:210-218`
  gives the reason a 108 would be wrong: "a 108 PLANE is an unbounded implicit
  construction plane and OCCT silently DROPS every face that references one (the
  shell reconstructs with zero faces)". `IgesWrite.hpp:14` and
  `CMakeLists.txt:2428` both still say 108; the emitter is the fact. It is compiled into
  the kernel (`forge-kernel/CMakeLists.txt:2428`) and its output is proved readable
  by OCCT 7.9.3's `IGESControl_Reader`, with face count and volume matched to
  1e-6, by `test/native_vs_occt_dataexchange_write.cpp` — which IS in the ctest
  gate list (`CMakeLists.txt:3145`). It honestly refuses quadric faces, because the
  IGES reader has no 510-face base surface for them.
  **It is not wired to `forge::io::exportIges`**, which throws unconditionally
  (`IoExchange.cpp:429-440`). `grep -rn IgesWrite` finds no caller outside tests,
  CMake, and the two doc comments in `ui/src/FileExchange.cpp`.
* **`MeshExchange` OBJ / OFF / PLY codecs, both directions**
  (`MeshExchange.hpp:145-154`). `grep -rn 'writeOBJ\|readOBJ\|writePLY\|readPLY\|
  writeOFF\|readOFF'` across the whole tree finds exactly ONE caller outside
  `MeshExchange.cpp`: `test/native/brep/meshexchange_test.cpp`, which round-trips
  all three formats (`:223-248`) and carries a dozen negative controls (`:340-404`).
  That test is registered NOWHERE — the same `grep -rl` that clears the
  unregistered-test list at the end of this document clears it too — so the codecs are not merely
  uncalled in production, they have a real test that has never run. No product path
  reaches them; only STL is wired into `IoExchange`. (The `readPLY` in
  `frontend/src/forge-v4/pointCloudImport.js` is a separate JS point-cloud reader,
  not this one.)
* **`StepWatertight.cpp` — the welded boundary-fan watertight soup + GWN self-test
  + GWN face reorientation**, 447 lines, 0 OCCT includes, compiled in
  (`CMakeLists.txt:2430`). Both of its consumers in `StepRead.cpp:2273-2301` are
  behind environment variables — `FORGE_WT_REORIENT` and `FORGE_WT_PROBE` — and
  **off by default**. That is deliberate and the header says why: the reorienter's
  measured result is negative (the orientation-defective corpus targets are all
  OPEN shells, where the oracle is unavailable; on closed ones it nudged parity
  63 → 62). The watertight substrate is the bankable half; the reorienter is a
  documented dormant negative finding, not unfinished work.
* **Native IGES import is real and complete-or-refuse** (`readForeignIges`,
  `IgesRead.cpp`, 1314 lines, 0 OCCT). `forge::io::importIges` accepts only
  `unsupported.empty() && closed`, else throws with the gap named. The desktop app
  still does not offer it, and `ui/src/FileExchange.cpp:108-114` gives the reason:
  there is no IGES fixture in the tree and no reachable IGES writer to make one, so
  the branch has never been proven. That refusal is re-measured by
  `forge-desktop/test/file_exchange_gate.cpp`
  (`forge-desktop/CMakeLists.txt:459,805`, run at `kernel-tests.yml:1616`, which
  invokes `ci_desktop_gate.sh` -> `run_desktop.sh:203`). `kernel-tests.yml:1559` is
  NOT the run: it is the binary's name inside the build step's `[ -x ]` presence
  loop, which proves the gate was compiled and nothing more.

## Not built

* **IGES export from the public API.** `forge::io::exportIges` throws. (The native
  writer exists — see above — but nothing routes to it.)
* **JT, Parasolid.** Both throw a message pointing at STEP. Parasolid sniffs the
  magic bytes only to name the variant in the error.
* **VRML.** No path.
* **Binary STL write.** `exportStl`'s `ascii` parameter is accepted and ignored
  (`IoExchange.cpp:362`, `(void)ascii`); the native codec always emits ASCII, and
  the header comment explains that the exact-double text round-trip is what buys
  the 1e-9 volume parity that binary float32 could not. `linearTol` / `angularTol`
  are advisory for the same reason. Binary STL **read** is supported, via an
  in-line transcode discriminated by the `84 + 50*n` size rule, not by the header
  text — `test/io_stl_binary_solid_header.cpp` pins the case of a binary file whose
  80-byte header happens to begin "solid".
* **A shared unit resolver.** Three implementations, listed above. `StepRead.hpp:148`
  already makes the argument, about the STEP pair: "DECLARED, never copied -- two
  copies would drift and the next reader could not tell which one ran." That
  declaration did its job for `StepAnalytic.cpp`, which calls `resolveLengthScaleMm`
  rather than copying it. `StepReadOcct.cpp` has its own `resolveScale` anyway, so
  there are still two STEP unit resolvers — and the inch measurements above are
  exactly the drift that header predicted.

## What gates each claim — and the hole between the gates

| claim | proved by | runs in CI? |
|---|---|---|
| StepAnalytic declines a non-mm file, and still reads mm | `test/step_unit_decline_gate.cpp` via `run_step_unit_decline_gate.sh` | **yes** — `kernel-tests.yml:910` |
| the desktop app's import/export refusals are each real | `forge-desktop/test/file_exchange_gate.cpp` | **yes** — `kernel-tests.yml:1616` (via `ci_desktop_gate.sh`) |
| the OCCT census in the tracker matches the tree | `tools/kernel/occt_dependency_graph.py --check` | **yes** — `gate-registration.yml:196` |
| native STEP/IGES writer output is readable by OCCT | `test/native_vs_occt_dataexchange_write.cpp` | **no** |
| native vs OCCT foreign STEP read parity | `test/native_vs_occt_step_read.cpp` | **no** |
| the OCCT-backed reader's pcurve projection path | `test/step_read_occt_projection_gate.cpp` | **no** |
| native vs OCCT STL parity | `test/native_vs_occt_stl.cpp` | **no** |
| imported quadric faces come back as quadrics | `test/native_vs_occt_import_surfaces.cpp` | **no** |

The "no" rows are not unregistered — they are in `FORGE_AB_GATES`
(`forge-kernel/CMakeLists.txt:3127-3178`) and `add_test` makes each a ctest case.
**No workflow invokes ctest.** `grep -rn "ctest\|forge_gate_\|kernel\.ab\|
FORGE_BUILD_TESTS" .github/workflows/` returns nothing across all three workflow
files. So every C++ A/B oracle for import/export builds and registers, and never
runs on a push.

The registration ratchet does not cover them either. `gate_registration_ratchet.sh`
enumerates `forge-kernel/test/*_gate.sh` — shell scripts only — so a C++ gate
reachable only through ctest is outside what it can see. Run on this tree it
reports `measured=10 pinned=10 GREEN`, and two of the ten pinned-unreachable
entries are import gates: `build_import_surfaces_gate` and `build_hlr_import_gate`.
Both are gates over `src/OcctImport.cpp` — the OCCT-handle -> native B-rep
*shape* importer, the 48-line file scoped out at the top — not over a file codec.
No ctest-only gate over a file codec is visible to the ratchet at all.

`native_vs_occt_iges` is a third case and a different one: it is deliberately NOT
registered, at `CMakeLists.txt:3087`, because it is **red** — "rc 1, 11/16 — case C
PARTIAL, a 128-entity property-flag-count divergence". That is an open gap, named
rather than hidden.

Also unregistered anywhere — not ctest, not a script, not a workflow:
`test/native/brep/{step_read_test, step_analytic_test, iges_read_test,
stepfaceted_test, meshexchange_test}.cpp` and
`test/native/brep/dataexchange_roundtrip_test.cpp`. Measured: `grep -rl` for each
basename across every `*.txt *.sh *.yml *.yaml *.cmake *.json *.py` in the tree
returns **nothing** for all six. `meshexchange_test` is the one that matters most,
because it is the only thing in the tree that exercises the OBJ/OFF/PLY codecs at
all — see "built, compiled, tested — and not reachable" above.

## Stale scope notes in this layer — do not read them as the state

`MIGRATION.md` records that a comment claiming less than the code delivers is as
dangerous as one claiming more, because it reads as a to-do list. The exchange
layer currently carries nine, all measured against the code beside them. They are
listed here so the next reader is not misled; fixing them belongs to whoever owns
those files.

1. `forge-kernel/include/forge/IoExchange.hpp:29` — "IGES is implemented via OCCT's
   `IGESControl_Reader` (TKDEIGES is linked)". It is not: `importIges` is native-only
   and TKDEIGES appears in neither the linked nor the shipped list in
   `occt_linked_snapshot.json`.
2. `IoExchange.hpp:46` — "importIges stays OCCT." Same.
3. `IoExchange.hpp:45` — `exportIges` "returns false". It **throws**
   (`IoExchange.cpp:435`). A caller written to the header would not catch it.
4. `IoExchange.cpp:439` — the throw's own message ends "IGES IMPORT is supported
   (via OCCT)." The import in the same file is native.
5. `IoExchange.cpp:430-431` — "There is no native IGES writer". There is:
   `src/native/brep/IgesWrite.cpp`, compiled and OCCT-proved. This is the
   costliest of the nine, because it is the comment that would stop someone
   wiring the writer that already exists.
6. `forge-kernel/include/forge/native/brep/IgesWrite.hpp:6-7` — "today
   `forge::io::exportIges` is OCCT `IGESControl_Writer` only ... 'no native IGES
   writer'", at the top of the file that **is** the native IGES writer. Wrong twice
   over: `exportIges` is not OCCT's writer (it throws), and OCCT 7.9's TKDEIGES
   ships no writer package at all — the reason item 5's comment gives for the
   deferral. The mirror of item 7, and it compounds item 5.
7. `forge-kernel/include/forge/native/brep/IgesRead.hpp:6` — "today
   `forge::io::importIges` is OCCT `IGESControl_Reader` only". That was true when
   the reader was written; it has since replaced it.
8. `NativeRoute.cpp:34` and `:40-41` — "STEP ... Default OFF", "leaving FEAT/STEP
   on OCCT". `forgeNativeStepEnabled()` at `:77-90` defaults it **ON**.
9. `StepReadOcct.cpp:268` — claims a `CONVERSION_BASED_UNIT` (inch/foot) branch.
   The function has none, which is the live defect measured above.

Items 5, 6 and 8 are the under-claiming kind: each describes real, working code as
absent or off. That is the failure mode `MIGRATION.md` warns about, and it is the
more expensive one, because an over-claim gets caught the first time someone tries
to use the feature, while an under-claim is never tested at all — it just quietly
becomes a line item on somebody's plan.
