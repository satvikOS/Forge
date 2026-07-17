# K_TKPRIM_DROP_BRIEF — TKPrim (BRepPrimAPI_*) drop attempt

**Date:** 2026-07-17
**Program:** forge-kernel OCCT→zero (see `docs/KERNEL_DYLIB_DROP_ROADMAP.md`)
**Target:** drop `TKPrim` from `OCCT_LIBS`; otool `opencascade` count 17 → 16
**Outcome:** **NOT DROPPED — BLOCKED.** otool stays **17**. No `src/` changes made; tree byte-identical to HEAD (`c3b3f9dd`) apart from this brief. All gates remain green.

---

## Verified facts

- `BRepPrimAPI_MakeBox / _MakeCylinder / _MakeCone / _MakeSphere / _MakeTorus / _MakeWedge / _MakePrism / _MakeRevol` all resolve to **`libTKPrim.7.9.dylib`** (verified with `nm -gU`). Dropping TKPrim removes every one of them.
- otool before (and after — unchanged): `otool -L build/Release/forge-kernel.node | grep -c opencascade` = **17** (TKPrim present).
- Core A/B gate green on the shipped `.node`: `node test/native_vs_occt_core.mjs` → **34/34 ALL GATES PASS**.
- The roadmap's estimate of "~8 direct uses" is a large undercount: there are **~33 live `BRepPrimAPI_*` call sites across 8 `src/` files** (audit below).

## Runtime gating reality (the crux)

`src/native/brep/NativeRoute.cpp` defines two independent gates:

- **CORE** — `forgeNativeBrepEnabled()` — **DEFAULT ON**. Routes the canonical primitive builders (`makeBox/Cylinder/Cone/Sphere/Torus/Prism-ngon/Wedge`) to native. OCCT is the documented `FORGE_NATIVE_BREP=0` **rollback baseline**.
- **FEAT** — `forgeNativeFeaturesEnabled()` — **DEFAULT OFF** (Wave 2, opt-in only via `FORGE_NATIVE_FEATURES=1`). Gates extrude/revolve/holeWizard/rib/sheet-metal/weldments/push-pull. **In the production default, these run the OCCT `BRepPrimAPI_*` path — it is the LIVE path, not a fallback.** The native FEAT path returns a `NativeMesh` (representation change from analytic B-rep `Solid`), which is exactly why FEAT is still opt-in.

So there is no configuration in which all `BRepPrimAPI_*` sites are dead code.

---

## Blockers (each independently sufficient)

### A. Unconditional OCCT with NO native path — removing the headers breaks the `src/` compile
| Site | Op | Native path? |
|---|---|---|
| `src/Primitives.cpp:221` | `makeEllipsoid` = `BRepPrimAPI_MakeSphere(1)` + `GTransform` | **None.** A 3-axis ellipsoid is a non-revolution quadric, outside the native analytic set (plane/cyl/cone/sphere/torus). `buildEllipsoid` is a faceted NURBS approx (~0.1% vol error) that FAILS the analytic A/B gate. In-code comment marks it OCCT-until-a-later-wave. |
| `src/Features.cpp:394` | `extrudeProfileOnPlane` prism (arbitrary-plane) | **None** — no `#ifdef FORGE_NATIVE_BREP` branch at all. |
| `src/DirectEdit.cpp:63,189` | `makeCylinder`, push/pull prism | **None** — no native guard in the file. |
| `src/DirectModeling.cpp:248` | `extrudeFace` helper (used by default `pushPullFace`) + inward prism `:421` | **None** for the helper; default path is OCCT. |
| `src/Mold.cpp:298,402,456,480,487` | parting prism, core cylinder, sprue cone, runner/gate cylinders | **None** — no native guard in the file. |

### B. FEAT gate default OFF → OCCT is the live production path (removing it regresses the default build)
Removing the OCCT branch forces the native FEAT path, changing analytic B-rep `Solid` results into `NativeMesh` — a semantic regression that breaks downstream analytic ops, mass-props parity, and boolean/fillet-on-analytic:
- `src/Features.cpp:316` extrudeProfile, `:491` revolveProfile, `:1445` holeWizard cyl, `:1491` countersink cone, `:1579` rib prism
- `src/SheetMetal.cpp:206` brickAt box, `:403` baseFlange prism
- `src/SheetMetalExtended.cpp:730,743,750,759` relief cyl/box
- `src/Weldments.cpp:182,188,194,389,438,491` member boxes / cap / gusset / bead

### C. No native analogue even with FEAT ON
- `src/Features.cpp:1592,1597` open-profile ribbon rib — code explicitly "HONESTLY stays on the OCCT path"; no native prism analogue for the in-plane-offset ribbon.
- `makeEllipsoid` (as in A).

### D. Downstream oracle note (not the binding blocker)
Even if A–C were solved, ~24 `test/native_vs_occt_*.cpp` A/B oracles `#include <BRepPrimAPI_*>` and link OCCT directly as the reference; those would need the golden-fixture conversion described in the roadmap. This is downstream of the `src/` blockers and moot until they are cleared.

---

## Why no partial migration was committed
The only `BRepPrimAPI_*` sites that are pure native-default fallbacks are the CORE builders in `Primitives.cpp` (Box/Cyl/Cone/Sphere/Torus/Prism-ngon/Wedge). `#ifdef`-guarding them out would (i) delete the documented `FORGE_NATIVE_BREP=0` rollback baseline, and (ii) still **not** drop TKPrim, because blockers A/B/C keep the toolkit linked. That is pure risk for zero otool reduction, so it was correctly not done.

## What would unblock a future drop
1. Native general-quadric (ellipsoid) surface support behind the analytic A/B gate.
2. Native FEAT extrude/revolve that emit an **analytic B-rep `Solid`** (not a mesh), promoted to default, with parity on mass-props/topology signature.
3. Native paths wired into DirectEdit, DirectModeling `extrudeFace`, Mold, `extrudeProfileOnPlane`, and the open-profile ribbon rib.
4. Convert the `native_vs_occt_*` primitive oracles to native-only golden fixtures (keep the OCCT oracle behind an opt-in `#ifdef` TU excluded from the default build).

Until (1)–(3), `grep -rE 'BRepPrimAPI|BRepPrim_' src/` cannot be emptied without regressing the default build, so **TKPrim must stay in `OCCT_LIBS`.**
