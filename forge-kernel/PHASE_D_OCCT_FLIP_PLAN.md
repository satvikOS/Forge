# Phase-D — OCCT-deletion flip plan (2026-06-25 audit)

Grounded read-only audit of the live runtime path (`forge-kernel/src/`) after 8 OCCT-zero
bursts. **Headline: the OCCT-zero work is now WIRING-BOUND, not geometry-bound.** 124 native
modules exist with 34 `native_vs_occt_*` A/B harnesses + ~122 green native gates, but only the
**CORE tier is flipped to native-default**. ~18 runtime op files still call OCCT in their default
path while **their native equivalent is already built + certified — just not called from the op file.**

Readiness of the runtime OCCT call-sites: **8 FLIP-NOW · 22 NEEDS-WORK (almost all "wire the
already-built module") · 4 KEEP (named blockers).**

## Flip mechanism (`src/native/brep/NativeRoute.cpp`)
Three per-capability gates: `forgeNativeBrepEnabled()` (CORE — **default-ON since 2026-06-23**:
primitives/transform/massProps/tessellate/AABB/native-on-native boolean), `forgeNativeFeaturesEnabled()`
(FEAT — default-OFF), `forgeNativeStepEnabled()` (STEP — default-OFF). `setNativeBrep()` forces all
three (A/B harness only). A call-site goes native-default by (a) having a native branch behind its gate
AND (b) the gate defaulting true. **Most of the 18 un-wired files have NO native branch at all today** —
the work is to call the existing native module behind a per-file gate, A/B-verify, then default-on.

## Un-wired-but-built (NEEDS-WORK = wiring): native module exists + certified, runtime not calling it
VarFillet→FilletAnalytic · LoftGuide→Loft(guided) · Airfoil→Nurbs+Loft · Nurbs.cpp→NurbsSurface/
TrimmedFace/SSI/Query · ClassASurfacing→SurfaceFill/Gregory/Sew · Sewing→Sew · ShapeFix→Heal ·
Healing→Heal/Sew/HoleFill · ShapeCheck→Check · Drawings→Hlr/ProjectSilhouette/Section · Cam→PolygonOffset2D ·
CamAdvanced→Surface · Weldments→Primitives+Boolean · SheetMetal*→Primitives+Boolean · Fea/FeaTet→Aabb+
Query+SolidTessellate · DirectModeling→Boolean+prism · InterferenceDetection→Boolean+MassProps.

## Phase-D sequence
- **PD-0 (done):** CORE gate native-default (primitives/transform/massProps/tessellate/AABB/native-on-native boolean).
- **PD-1:** gate `LOD.cpp BRepTools::Clean` behind `kindOf==Occt`; add a **topology signature** (face/edge/vertex + adjacency hash) to every CORE A/B gate (kills coincidental mass-props parity).
- **PD-2:** native ellipsoid (scaled-sphere B-rep) + pyramid already loft-native → Primitives 100% native.
- **PD-3:** retire `extractWires()` (native `extractProfileRings()` is the only path once FEAT flips).
- **PD-4:** flip FEAT gate native-default for the certified ops (fillet/chamfer/draft/loft/unguided sweep); keep OCCT fallback for guided-sweep + revolve until native lands.
- **PD-5:** wire the 18 un-wired files (above), each behind a per-file gate, A/B (or regression-image for HLR/validator/healing) verified, then default-on.
- **PD-6:** flip STEP gate native-default (trimmed-NURBS read certified); wire native STL (MeshExchange) + IGES; keep OCCT STEP-read fallback for exotic foreign AP242.
- **PD-7:** resolve boolean blockers — implement native boolean **LINEAGE** (Modified/Generated/IsDeleted from the analytic-SSI imprint topology) + fuzzy-boolean policy; then flip Booleans full-native + InterferenceDetection narrow-phase.
- **PD-8:** native Mold cavity/core Splitter OR document-as-removed.
- **PD-9:** drop OCCT `.brep` round-trip (document-as-removed — un-reimplementable; STEP+native cover exchange).
- **PD-10:** **FREEZE GOLDEN CORPUS** — run OCCT one final time to emit mass-props + topology signatures + tessellation hashes + HLR/section images + STEP round-trips over CADGenBench+demo+regression sets (the post-deletion truth oracle; resolves the oracle-removal paradox).
- **PD-11:** **OCCT-DELETION GATE** — confirm zero runtime OCCT call-sites, run full regression + CADGenBench ≥0.85 against the frozen corpus, remove OCCT from CMakeLists + delete fallback branches + NativeOcctBridge.cpp; A/B harnesses retire/pin to the frozen corpus.

## Hard blockers (cannot all be document-removed)
1. **Boolean LINEAGE** — native booleans give exact geometry (A/B-certified) but emit no Modified/
   Generated/IsDeleted; the JS topo-id contract REQUIRES them. **The one item that cannot be
   document-removed — #1 critical path.** Emit lineage from the analytic-SSI imprint topology.
2. **Fuzzy/gap-tolerant boolean** (`BooleanTol.cpp`) — OCCT-only; build native OR document-as-removed (require watertight operands, surface the real error per no-fallback rule).
3. **Mold cavity/core Splitter** — no native equivalent; build OR document-removed.
4. **OCCT `.brep`** — IS OCCT's serialization; document-as-removed.
Plus: oracle-removal paradox (PD-10 golden corpus is a hard pre-gate) + coincidental-mass-props-parity (PD-1 topology signatures).

## Estimate
CORE is live. The dominant remaining work is **WIRING, not new geometry** (~18 files whose native
modules already exist + carry green A/B harnesses). **~3-4 weeks** if fuzzy-boolean/Mold-split/.brep are
documented-as-removed and lineage + wiring are completed (kernel-clang XOR GPU-train, in parallel with
training); ~5-7 weeks if every KEEP is reimplemented. **Boolean lineage is the one hard gate that cannot
be document-removed.** Execute at GPU-free train pauses (alternating-block cadence).
