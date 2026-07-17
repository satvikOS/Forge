# K6 — Analytic-surface attachment on the `importOcctSolid` path

Status: **VERIFIED / LOCKED IN** (regression gate added 2026-07-17).

Sacrosanct pillar #3 (OCCT→zero), K6 "native-`Solid`-everywhere" keystone. This
note records the measured state of the raw-`TopoDS_Shape` → native `brep::Solid`
importer (`src/OcctImport.cpp::importOcctSolid`) with respect to attaching a native
analytic `Surface` to each imported quadric face — the property the native HLR
silhouette pass and every G1 analytic query on an OCCT-bridged input depend on.

## Finding

`importOcctSolid` **already attaches** a native analytic `brep::Surface`
(`SurfaceKind::Plane | Cylinder | Cone | Sphere | Torus`, plus `Nurbs` for
free-form/extrusion faces) to every imported face. `readSurface()` inspects each
OCCT face's `BRepAdaptor_Surface`/`Geom_Surface`, extracts the `gp_` parameters
(axis, location, radii), builds the matching native surface with the frame matched
to OCCT's elementary parameterization, respects face orientation (`reversed`), and
sets it on the native `Face` (`src/OcctImport.cpp`, the `f->surface = surf`
assignments in the staged-face and staged-poly build loops).

This capability predates this note (the analytic + NURBS import routes were built in
the OcctImport slice committed 2026-06-28). What was **missing** was a gate asserting
the analytic FACE IDENTITY of the `importOcctSolid` output — neither
`native_occt_import_test.cpp` (which A/B's volume/area/bbox/Betti/validity) nor the
native-STEP-path `native_analytic_face_inventory.mjs` covered the raw-`TopoDS`
`importOcctSolid` → `analyticFaceInventory` parity. That coverage gap is now closed.

## What is covered (A/B verified to ~1e-9)

`test/native_vs_occt_import_surfaces.cpp` (driver `test/build_import_surfaces_gate.sh`)
imports each fixture via `importOcctSolid`, runs `analyticFaceInventory`, and A/B's the
curved face's parameters against OCCT's `Geom_Surface`:

| fixture | native `analyticFaceInventory` | curved-face A/B vs OCCT `gp_` |
|---|---|---|
| box 10×6×4 | 6 `{plane:6}` | plane normals unit |
| cylinder r5 h10 | 3 `{cylinder:1, plane:2}` | radius==5, axis‖, origin on axis |
| placed cylinder r2.5 h9 (rotated frame) | 3 `{cylinder:1, plane:2}` | radius==2.5, axis‖(0,1,0), origin on axis |
| cone frustum r4→r2 h7 | 3 `{cone:1, plane:2}` | radii {2,4}, axis‖ |
| cone to apex r4→0 h6 | 2 `{cone:1, plane:1}` | radii {0,4}, axis‖ |
| sphere r5 | 1 `{sphere:1}` | radius==5, centre== |
| torus R8 r2 | 1 `{torus:1}` | major==8, minor==2, centre==, axis‖ |
| box − through-cylinder (trimmed boolean bore r2) | 7 `{cylinder:1, plane:6}` | radius==2, axis‖, origin on axis |

Result: **36/36 passed**. Every quadric kind attaches with the correct native
surface, and the imported cylinder reports `cylinder 3 {cylinder:1, plane:2}` with
`radius==5` — matching OCCT and matching the BUILT native cylinder. The trimmed
boolean bore (a drilled hole in a plate) also attaches its exact `Cylinder` surface,
so real-CAD holed parts import as analytic, not faceted.

## Deferred (unchanged — honest, not facet-faked)

These are NOT quadrics and are handled by `importOcctSolid`'s existing routes; this
gate does not add them:

* **NURBS / Bezier / SurfaceOfLinearExtrusion** — imported as `SurfaceKind::Nurbs`
  (exact rational tensor surface), NOT a quadric, so `analyticFaceInventory` keeps
  each such face unique (`"other"` kind). Faithful, but not a canonical analytic face.
* **SurfaceOfRevolution / OffsetSurface** — `importOcctSolid` DEFERS these
  (`ok=false`, named reason): no exact uniform-angle NURBS form / toleranced-fit
  offset. See `include/forge/OcctImport.hpp` scope block.

## How to run

```
cd forge-kernel && bash test/build_import_surfaces_gate.sh
```

This is an OCCT-linking bridge gate (the OCCT side is the A/B oracle), so — like its
sibling `build_occt_import_test.sh` — it is not part of the pure-native
`test/native/run_native.sh` suite. It does not build or alter the `.node` and drops no
dylib: `otool -L build/Release/forge-kernel.node | grep -c opencascade` stays **17**.
This is a capability VERIFICATION + regression lock, not a toolkit drop.
