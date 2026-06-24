# ARCHDISC EXECUTION ROADMAP — Forge + Archie (Sequenced, Wave-by-Wave)

**Issued 2026-06-24.** Companion to `BIBLE_2026-06-24.md`. Grounded in the 26 specs under `docs/SCOPE_2026-06-24/{kernel,training,research}/` and `forge-kernel/OCCT_ZERO_ROADMAP.md` (Wave-1 audit, 2026-06-23, ~35% migrated).

> **THE ONE HARDWARE LAW (governs the whole plan):** 36 GB M4 Max. **Kernel C++ rebuilds and GPU/MLX training NEVER run concurrently; serve-XOR-train always.** The plan therefore interleaves into two lanes that share one machine: a **KERNEL lane** (C++ build/A-B/CI, GPU idle) and a **MODEL lane** (MLX train/eval, kernel binary frozen). A wave runs one lane to a checkpoint, frees the machine, then runs the other. Every step: real impl, A/B + topology-signature gate, CI-green, no stub.

> **THE SINGLE CRITICAL-PATH BLOCKER:** the **native trimmed-NURBS B-rep face (K1)**. Until it exists, the first B-spline face in any real/benchmark/customer part routes to OCCT, and OCCT cannot be deleted, and ACIS-SAT/Parasolid-XT/healing-on-imports/Class-A/var-fillet/editing-axis are all gated. It is built **once** and shared by surfacing, data-exchange, booleans, and healing. Second blocker: **persistent topological naming (K0)** for the parametric/assembly/editing spine.

---

## WAVE 0 — Harvest + flips + the CADGenBench rig (days; KERNEL lane, GPU free for S0 train in MODEL lane)

Lowest-risk, highest-ROI, mostly already-built. Start the moment the GPU frees from any running train.

**KERNEL lane (CI-green flips + dark-capability harvest):**
- **W0.1 OCCT-Zero Wave-1 flips** (`OCCT_ZERO_ROADMAP` W1.1–W1.6): Primitives, Transform, Booleans (native operands only), Tessellate, LOD, MassProps → native-default behind `FORGE_NATIVE_BREP`, OCCT kept as oracle+fallback. A/B `native_vs_occt` + **add the topology signature** to the gate (the existing gate is mass-props only).
- **W0.2 Bridge the dark geom engines to JS** (`predicates-geom.md` Phase A1): expose `insphere, delaunay2D, constrainedDelaunay2D, delaunay3D, voronoi3D, alphaShape3D, polygonBoolean2D, polygonOffset2D, convexDecomposition, minkowskiSum3D, selfIntersect`. ~400 LOC binding.
- **W0.3 Wire + bind the implicit/voxel stack** (`implicit-frep.md` Phase A, `voxel-lattice.md` Phase A): add `SdfLibrary/SdfOps/FRepTree/MeshToSDF/MeshToFRep/Lattice/Morphology` to the addon target; bind `forge.implicit.*`, `forge.lattice.*`, `forge.tpms.*`, `forge.voxelBoolean`, `forge.morphology`, `forge.dualContour`, `forge.meshToSdf` + a `FieldBody` handle. ~1.6k LOC, zero new math — unblocks the whole field-design area.
- **W0.4 Surface the planegcs diagnose** (`sketcher-constraints.md` Phase A): return `getConflicting/getRedundant/getPartiallyRedundant/getDependentParams` from `solve()`; replace the false-static `SketchDof.cpp` with solver-backed audit; per-constraint residuals. ~250 LOC — closes the marquee D-Cubed gap.
- **W0.5 OCCT-Zero Wave-2 cheap flips** (W2.1 native AABB, W2.2 drop matelib OCCT quaternion, W2.5 retire `extractWires`→`extractProfileRings`). ~350 LOC.
- **W0.6 ForgeCADScore v2 + the CADGenBench rig** (Mecado M0): faithful local re-impl of all four axes + internal GT mirror corpus; `forge-bench cadgen run` → `output.step` + `meta.json` + upstream-schema JSON + HTML report. This is the standing eval harness for everything downstream.

**MODEL lane (runs while KERNEL lane CI churns — but NOT during a kernel rebuild):**
- **W0.M Train S0 `arch14b-math`** (the reasoning spine, requirement-zero). `bulk_synth_math.py` + `bulk_synth_numerics.py`, ~3.0M unique, streaming download→process→delete, **no `--mask-prompt`**, NaN-guard, early loss-verify. Gate: analytical ≥0.90, solver-choice ≥0.90, NaN-free.

*Wave-0 exit:* OCCT-Zero at the honest ~50% mark; field-design + sketcher-diagnose reachable by Archie; the rig exists; S0 promoted.

---

## WAVE 1 — The two keystones (KERNEL lane heavy; MODEL lane runs S1 geometry between rebuilds)

This wave is the gate for everything. Run it **before** breadth.

**KERNEL lane — build K0 then K1 (sequential, they share the topology):**
- **K0 — Unified body model + persistent topological naming.**
  1. Face inner/hole loops + general Loop set (Euler re-derivation). (~600 LOC)
  2. Curve geometry on edges + pcurves on coedges (new `Curve`/`PCurve` tagged types). (~1.2k)
  3. Per-entity **tolerance attribute** on Vertex/Edge/Coedge + tolerant-entity semantics. (~400)
  4. Native **Generated/Modified/Deleted lineage** emitted from every op (boolean first; harvest OCCT `Modified/Generated/IsDeleted` on the OCCT path as oracle). (~700)
  5. Sub-shape **persistent names** + first-class `Reference{name, snapshotGeom}` selection; wire the dormant `bindSpine.js`/`HistoryLog.js`; converge the two FeatureTree impls + two history models. (~2k)
  6. **NativeMesh→analytic re-entry** — native features build `brep::Solid`, not `HalfEdgeMesh`. (~2k)
  - *Gate:* edit-upstream-param → named face/edge resolves correctly (regression e2e "edit base height, fillet stays on top rim"); A/B lineage == OCCT; native extrude→fillet→boolean chain matches OCCT chain.
- **K1 — Trimmed-NURBS B-rep face + NURBS algebra (THE critical-path keystone).**
  1. NURBS algebra completion: degree-elevate / knot-remove / refine / r-fold-insert; surface 2nd-fundamental-form curvature; isocurve + curve/point projection (p-curves). (~1.25k)
  2. Trimmed-NURBS face: B-spline surface + N (u,v) trim loops; point-in-trim classification; trim-respecting adaptive tessellation. (~1.5k)
  3. NURBS-aware SSI (the deferred cone-cone/torus/NURBS pairs) + edge imprint. (~900)
  4. Sew/heal trimmed-NURBS faces into a manifold shell. (~500)
  - *Gate:* point-in-trim A/B vs OCCT `BRepTopAdaptor_FClass2d`; SSI residual ≤1e-9 + Hausdorff vs `GeomAPI_IntSS`; trimmed-patch mass-props + topology signature vs OCCT.

**MODEL lane — between K0/K1 rebuilds (machine free):**
- **W1.M Train S1 geometry `bulk_synth_geom.py`** (~1.5M, ForgeCADScore-replay-filtered) + **S1.5 materials `bulk_synth_materials.py`** (~1.6–1.8M). S1 gates validity/shape/topology; S1.5 supplies material cards physics needs.

*Wave-1 exit:* the unified body model exists; the trimmed-NURBS keystone exists; S1+S1.5 promoted. **This is the inflection point — everything after parallelizes.**

---

## WAVE 2 — Read the world + exact robustness + booleans (KERNEL lane; MODEL lane trains S2 physics)

Now that K1 exists, the foreign-format readers and the boolean envelope unlock.

**KERNEL lane (parallelizable sub-tracks, all consume K0/K1):**
- **K6-core — Foreign STEP read (the unblock-the-most item).** Part-21 complex-instance + curve/pcurve decode → trimmed-NURBS foreign STEP reader (A/B vs `STEPControl_Reader` on a frozen corpus, topology-signature gated) → native sewing-on-import → STEP writer parity (round-trip B-splines). ~3.4k LOC. *This is what lets Forge read the CADGenBench/Mecado corpus natively.*
- **K2 — ExactReal + Manifold-grade mesh boolean.** `ExactReal` lazy-exact number → exact intersection constructions → lift the mesh boolean off its 0.12% ceiling, output manifold-by-invariant with property/originalID propagation. (~1.5k + ~1.6k) Then `Arrangement_2` (DCEL + Bentley-Ottmann + point-location + overlay + arc/polyline traits) and PMP repair (corefine/clip/stitch/self-intersect-resolution/non-manifold-split/3D-hole-fill). (~5.7k) — can run after the boolean lift.
- **K3 — Booleans to full envelope + lineage + fuzzy + multi-result + Splitter/Section/Imprint.** Native lineage (B2, gates feature-tree booleans off OCCT) → sphere/torus imprint → NURBS-face boolean (consumes K1) → native fuzzy → multi-lump/void/sheet → standalone Splitter/Section/Imprint. ~8.8k LOC.
- **K5-core — Native B-rep validator + tolerant sewing.** The validator is the oracle every heal op gates on; tolerant face sewing (grow-tolerant-edge, not move-geometry); non-manifold sewing (replace the 3rd-coedge hard-assert). ~2.4k LOC.

**MODEL lane:** **W2.M Train S2 physics `bulk_synth_physics.py`** (~2M) — FEA/CFD/MBD/fracture/EM, eAGI `gen_eval`+`gen_outcome` woven ~10%.

*Wave-2 exit:* Forge reads real/foreign STEP natively; the mesh boolean is Manifold-grade; booleans carry lineage and cover the full surface zoo; the B-rep validator exists; S2 promoted.

---

## WAVE 3 — Manufacturability + interface axis + foreign kernels (KERNEL lane; MODEL lane trains S3/S3.5)

This wave directly attacks the CADGenBench interface axis (0.4 weight, where the field dies) and Mecado's manufacturability bar.

**KERNEL lane:**
- **K6-foreign — ACIS-SAT then Parasolid-XT.** ACIS-SAT text reader+writer first (documented grammar, right first foreign-kernel target; **no OCCT oracle → frozen golden corpus** from a licensed app) → `.sab` → Parasolid-XT `.x_t`+`.x_b` reader+writer (hardest item, golden corpus) → IGES read+write → STL/BREP native. ~14k LOC, additive/parallelizable now that K1 exists.
- **K5-heal — the 7 heal operators** (orient/gap-close/sliver-removal/pcurve-regen/same-domain-merge/auto-fill/self-intersect-heal) + native fuzzy boolean. ~3.5k LOC. Closes the editing-axis dirty-import path.
- **K7-interface — std thread/hole B-rep (ISO 261/ASME B1.1) + instanced boolean + native clash + AP242 PMI/GD&T semantic round-trip.** The Mecado R4 interface-placement track (±1°/±1% IoU≥0.95). ~3k LOC.
- **K4 — Blending family (deepest item, scheduled here behind a documented A/B gate):** analytic rolling-ball constant-radius fillet *surface* → variable/law/conic → concave → setback vertex → face-face G2 → chamfer flavors → surface MATCH/FAIR. ~3–4k LOC. (Migrate the var-radius fillet **last**.)

**MODEL lane:** **W3.M Train S3 manufacturing `bulk_synth_mfg.py`** (~2.0–2.5M, manufacturability central) + **S3.5 GD&T/metrology/quality** (~2.4M, the interface-axis oracle pulled forward — `forge::native::gdt`/`tolstack` are the answer key).

*Wave-3 exit:* OCCT-zero data exchange + foreign-kernel parity; manufacturable-geometry + interface placement at spec; full blend family; S3+S3.5 promoted.

---

## WAVE 4 — Assembly, large-model, implicit/voxel/AM, sim breadth (KERNEL lane; MODEL lane trains S4/S5)

Breadth on the now-solid foundation. K0's persistent naming + K1's NURBS face are prerequisites already met.

**KERNEL lane (parallel tracks):**
- **K7-assembly — lightweight body rep + two-level BVH + per-instance state + STEP assembly I/O + sub-tree rebuild + out-of-core.** The NX-Lightweight/CATIA-cgr keystone (B3 lightweight rep first). ~5–6k LOC.
- **K8 — implicit/voxel/lattice/AM to libfive+PicoGK parity.** Merge SdfTree⇒FRepTree → **interval-pruned octree DC** (libfive headline) → **sparse narrow-band voxel field** (PicoGK keystone; dense grid is its own A/B oracle) → threading + eikonal re-distance → graded/conformal + octet/diamond/Kelvin/auxetic/stochastic lattices → MC33 → slicer + supports → tree breadth. ~7.15k (implicit) + ~7–8.5k (voxel) LOC.
- **K9 — sim breadth + fully-visual + motion capture.** **S-A1 frame stream first** (zero new physics, turns validated solvers into a real-time visual demo) → nodal recovery + field extraction → **body-fitted mesher** (keystone; removes staircase error + last sim-pillar OCCT calls) → element zoo (C3D10/C3D20/S4R-MITC/B31) → CFD (higher-order advection Ghia-verified → **k-ω SST turbulence** → CHT → unsteady URANS Strouhal-verified) → finite-strain + arc-length/Riks + explicit dynamics → surface-to-surface contact + friction + Chaboche/hyperelastic/orthotropic → full joint library + flexible MBD + **motion-capture ingest/retarget** (BVH/C3D — the named 0%-built leg) → Lanczos + parallel/AMG. ~22k LOC, breadth not rewrite; vvuq supplies many in-tree oracles.

**MODEL lane:** **W4.M Train S4 mechatronics/design-opt `bulk_synth_mechatronics.py`** (~1.8M) + **S5 PLM/systems `bulk_synth_plm.py`** (~1.2–1.6M).

*Wave-4 exit:* large-assembly + field-driven AM + Fluent/Abaqus-grade sim + fully-visual-dynamic + mocap; S4+S5 promoted.

---

## WAVE 5 — P-1/Prometheus fold + enterprise UI/UX + eAGI gate (KERNEL+UI lane; MODEL lane trains S6 + the federation)

**KERNEL/UI lane:**
- **K10 — MBSE/function layer + 3 primitive ops + GNN surrogate + fold-ops.** SysML (Req/BDD/IBD/Parametric) + Modelica-style acausal system model; `forge.design.{evaluate,synthesize,repairErrors}` (error-infill is the gap); `forge.simulate.failurePredict` + `coupled{thermoMechanical,fluidStructure}` + field-reconstruction overlays. ~4–6k LOC.
- **UI — enterprise NX/CATIA/Creo UIUX.** G1 live ghosted preview (side-effect-free `preview.<op>`), G2/G9 kernel-backed rollback (`recomputeUpTo/From` on K0's persistent IDs), G3 modal sketch sandbox, G4 per-entity DOF coloring (surface planegcs residuals), G6/G7 Maya-grade mark menu + `keymap.js` + chord input. ~3.5–4.5k LOC front-end; every surface dual-driven. + auto-MBD + autonomous PLM data-graph.

**MODEL lane:**
- **W5.M Train S6 ops/compliance/human + `bulk_synth_outcome.py`** (Prometheus differentiator) + **the federation:** the "lobotomized" structured-rep LLM (LoRA on the Forge tool-DSL + SysML/Modelica), the **GNN performance surrogate** (Forge-generated graph/sim-label pairs), the **VLA/VLM branch** that *acts* from viewport pixels (Qwen2.5-VL, eager-RoPE fix).
- Build the **eAGI "Archie IQ" gate** (North-Star #2) from the kernel simulators: 6-level taxonomy × metadata × 4 templates, tiered scorer, report Archie-vs-human-engineer.

*Wave-5 exit:* P-1/Prometheus full tech in scope and executable; enterprise UIUX shipped; eAGI gate live.

---

## WAVE 6 — CADGenBench round-4 convergence + OCCT deletion + validated submission (both lanes, alternating)

**The CADGenBench round-4 fix (held-out interface/editing overfit):**
- Train the GRPO stage on the **CADGenBench part class** (jigs/bolts/slots/bosses/pockets, full assembly context, multi-view drawings, paired STEP+edit, multimodal) — **never the 81 fixtures themselves** (R9 generalize). Add the **KOR/KIR jig-failure-taxonomy corpus** (wrong-spacing/missing-hole/wrong-Ø/narrow-slot/offset-slot/rotated-boss/shifted-holes) and the **STEP-edit surgical-delta corpus** (paired input.step + instruction + minimal-delta gold). GRPO reward = analytical-gate + ForgeCADScore replay + VVUQ.
- Mecado attack order, re-confirmed by live data: M1 validity (×0 gate) → M2 topology (cheap) → **M3 shape+generation (the field's biggest wall, 0.3728 ceiling — biggest visible lap)** → **M4 interface (highest weight, where everyone dies)** → M5 imported-B-rep editing (hardest kernel frontier; needs K0 persistent-ID + K6 foreign read + feature recognition) → M6 all-axis convergence + CUA self-correction → M7 validated public submission.

**OCCT deletion (Bible §0.3):** only after zero runtime OCCT calls under full regression + CADGenBench, against the frozen golden corpus. Flip per-area, keep the golden corpus as the post-deletion truth source. Parasolid-XT/ACIS-SAT keep their licensed-app golden corpus permanently (no OCCT oracle exists).

*Wave-6 exit:* a **validated ≥0.85-every-axis CADGenBench row**; OCCT deleted; Mecado partnership + Link Ventures signal.

---

## ROUGH SCOPE TOTALS

| Lane | Net-new work |
|---|---|
| Kernel (K0–K10) | **~110–130k LOC** native C++ (K6 data-exchange ~22–24k, K9 sim breadth ~22k, K8 implicit+voxel ~14–16k, K2 ~9–13k, K3 ~8.8k, K0 ~7–9k, K5 ~5.5–6.5k, K7 ~5–6k, K1 ~5–6k, K4 ~3–4k, K10 ~4–6k) + UI ~3.5–4.5k front-end |
| Corpus (S0–S6 + outcome) | **~15–17M unique samples/cycle** (S0 3.0M, S1 1.5M, S1.5 1.7M, S2 2.0M, S3 2.25M, S3.5 2.4M, S4 1.8M, S5 1.4M, S6 0.85M + outcome) all replay-filtered, streamed |

**Top-of-plan invariants:** one heavy step at a time (kernel rebuild XOR GPU train); topology-signature on every gate; frozen golden corpus before any deletion; CUA-only headed e2e; honesty by construction.

---
*Execute wave by wave. Wave 1 (K0 + K1) is the gate — do not start breadth until both keystones pass their A/B + topology-signature gates.*
