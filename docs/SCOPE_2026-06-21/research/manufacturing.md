# Manufacturing, Manufacturability, Auto-MBD & Autonomous PLM — Engine Spec

**Scope owner:** SCOPE_2026-06-21 / research
**Date:** 2026-06-21
**North-star:** Archie-driving-Forge ≥ 0.85 on CADGenBench across **every** dimension. Every Forge model must be **real-world makeable**, not just renderable. No lite versions; industrial-grade, dynamic (process simulations, not static lookups), verified for real engineers.

This spec defines (A) per-process DFM/DFMA engines with concrete rules + numbers, (B) automatic process planning (CAPP), (C) auto-MBD (semantic PMI / GD&T), (D) the auto model→process pipeline, and (E) full autonomous pre-manufacturing PLM run by Archie. For each, it names the concrete kernel/JS engine, the governing equations/standards, function signatures, and **the data Archie needs to drive it**.

---

## 0. Current state of the codebase (baseline — build ON this, do not duplicate)

Verified by reading the repo. The manufacturing engines that **already exist** (so the spec extends, not re-creates):

| Area | Existing engine | Evidence | Gap to close |
|---|---|---|---|
| Feeds/speeds/power | `forge::machining` turning/milling/drilling | `forge-kernel/include/forge/Machining.hpp` | No DFM verdict layer; no tool DB; per-feature only |
| Casting solidification | `forge::casting::solidify` enthalpy-method FD + Niyama | `forge-kernel/include/forge/Casting.hpp` | No DFM rule engine (draft/wall/shrink) on top |
| Mold tooling | `forge::mold` draft/parting/cavity-core/cooling/runner | `forge-kernel/include/forge/Mold.hpp` | No moldflow weld-line/sink prediction layer |
| Sheet metal | `forge::sheetmetal` baseFlange…unfold/flatPattern, K-factor | `forge-kernel/include/forge/SheetMetal.hpp` | No DFM check (relief, edge-distance, min radius verdict) |
| Tolerance stackup | `forge::tolerance::compute` worst-case/RSS/MC + Cp/Cpk | `forge-kernel/include/forge/Tolerance.hpp` | Not auto-driven from PMI graph |
| CAM 2.5D | `forge::cam` profile/pocket/drill/faceMill toolpaths | `forge-kernel/include/forge/Cam.hpp` | No op sequencing/setup planning (CAPP) |
| GD&T eval | `forge::native::gdt` DRF, true-position+MMC bonus, flatness, perpendicularity | `forge-kernel/include/forge/native/gdt/Gdt.hpp` | Eval-only; **no authoring / no semantic PMI graph** |
| DFM (JS) | `checkManifoldDFM` — bbox/aspect/charThickness/mass | `frontend/src/foundation/DFMCheck.js` (154 lines) | Single process (3-axis Al), threshold-only, no per-process engines |
| Vendor handoff | `buildVendorPackage` ZIP (drawing+gcode+cost+DFM) | `frontend/src/foundation/VendorPackage.js` | OK as sink for autonomous PLM |
| PLM | **3 unwired stacks** (`electron/pdmVault.js`, `forge-v4/pdmStore.js`, `kernel/pdm/VersionControl.js`) | `PLM_STATUS.md` | **Not unified**; config mgmt NOT STARTED; needs one source of truth |

**Governing decision:** consolidate to ONE `forge::manufacturing` C++ namespace for the geometry-truth checks (access, draft, thickness, undercut, flat-pattern) and ONE `forge.mfg.*` JS facade Archie calls; collapse the 3 PLM stacks into one `forge::plm` item-graph with file-backed persistence.

---

## A. DFM / DFMA ENGINES — PER PROCESS

Each process gets a kernel analyzer that emits a structured **`DFMReport`** (not prose): `{ process, ruleId, severity (error|warn|info|pass), faceIds/edgeIds, measured, threshold, message, autoFixVerb? }`. Severity gates: any `error` blocks "release"; `warn` requires Archie acknowledgement. All checks operate on the BRep + tessellation already in the kernel — no external CAD deps.

### A.1 CNC machining (3/4/5-axis milling + turning)

**Engine:** `forge::manufacturing::dfm::machining(shape, MachiningContext)` → `DFMReport`.
**Geometry primitives used:** face-normal vs. tool-axis access cones, concave-edge radius extraction, ray-cast tool-reach test, thin-wall medial-axis estimate.

Numbered requirements (rules + numbers, sourced):

1. **Internal corner radius:** flag any concave vertical fillet `r < tool_radius`. Recommend `r ≥ 1.3 × tool_radius` (130% rule) for finish + tool life; minimum machinable = `tool_radius` exactly. Also enforce `r ≥ pocket_depth / 6` (the 6:1 corner rule). [hardwarecustom, makerstage]
2. **Tool length-to-diameter / pocket depth:** flag pocket/feature where `depth > 4 × tool_diameter` (standard reach 3:1, extended ≤6:1 at cost penalty). Deflection risk → surface-finish + dimensional warning above 3:1. [search: "depth should not exceed 3–4× diameter", makerstage 3:1/6:1]
3. **Thin walls:** min wall `0.8 mm` (metal), `1.5 mm` (plastic); unsupported wall aspect cap `height ≤ 15 × thickness` (15:1). Flag below min, warn above 15:1. [rapiddirect, makerstage]
4. **Undercuts:** detect faces unreachable by any of the active tool axes (3/4/5-axis) via access-cone test; flag as undercut. Tag cost penalty **+30–50%** vs same-depth open pocket (specialty tooling, extra setup). T-slot depth ≤ `3–4 × cutter blade diameter`. [baoshengindustry, makerstage]
5. **Tool access / collision:** ray-cast from each machinable face along candidate tool axes; if the holder/shank collides before reaching depth, flag "no access — needs reorientation or longer tool." Drives CAPP setup count.
6. **Deep holes / drilling:** flag holes with `depth > 10 × diameter` (peck-drilling regime, +cost); blind-hole flat bottom not drillable (needs end mill); min hole Ø ≥ 1 mm typical (smaller = micro-tooling cost).
7. **Tolerance feasibility:** flag dimensions tighter than process baseline (mill ±0.025 mm / ±0.001″ standard, ±0.0125 mm precision; turning ±0.0125 mm). Compare against PMI tolerance graph (links to §C/Tolerance).
8. **Sharp internal edges at floor:** a flat floor meeting a vertical wall always leaves a corner radius = tool radius; flag any model demanding a true zero-radius internal corner (needs EDM → process re-route).
9. **Text/engraving min:** engraved feature width ≥ 0.5 mm, depth ≥ 0.25 mm.
10. **Material selection coupling:** carry `specificCuttingForceN_mm2 (K_c)` per material into feasibility (e.g. Al 6061 ≈ 700–900, mild steel ≈ 1700–2100, Ti ≈ 1300–1500) so the same geometry that is fine in Al is flagged un-rigid in steel.

**Data Archie needs to drive it:** active machine kinematics (3/4/5-axis), tool catalogue (`{diameter, fluteLength, shankLength, type}` — already `forge::cam::Tool`), stock material → `K_c`, target tolerance class. Archie supplies these as the `MachiningContext` payload; defaults are inferred from material + part size when omitted.

### A.2 Casting (sand / investment / die)

**Engine:** `forge::manufacturing::dfm::casting(shape, CastingContext)` layered ON the existing `forge::casting::solidify` thermal solver (which already gives solidification-time field + **Niyama porosity** G/√R and snapshots). The DFM layer adds geometric rules:

11. **Draft:** every face along pull direction needs draft. Targets: external **1–2°**, internal **2–3°** (die casting); sand casting more forgiving but still ≥1°. Reuse `forge::mold::analyseDraft`. Flag zero/negative-draft faces. [jiga, cast-mold]
12. **Wall uniformity:** flag thick:thin section ratio `> 3:1` (porosity/warp risk); structural housings target `2.5–4.5 mm` wall for die cast Al. Use medial-axis thickness field. [casting-yz]
13. **Fillets at all junctions:** min internal fillet ≥ **0.5–1.0 mm** (larger better) — sharp corners create hot spots + stress risers; flag any sharp concave junction. [search]
14. **Shrinkage allowance:** apply per-alloy linear shrink before tooling sizing — gray iron ≈ 1.0%, Al ≈ 1.3%, steel ≈ 2.0%, brass ≈ 1.5%. Emit the scaled pattern dimensions (pattern = part × (1+shrink)). Engine auto-scales the tooling cavity.
15. **Hot-spot / isolated-heavy-section detection:** from the solidification-time field, flag last-to-freeze regions not fed by a riser/gate → predicted shrinkage porosity. This is the **dynamic** check (real FD sim, not a lookup) — couples directly to Niyama threshold (≈1.0 steel, 0.7 Al; already in kernel).
16. **Gating/risering advisory:** compute modulus M = V/A per heavy section (Chvorinov: `t_solidify = C·(V/A)²`); riser must have **larger modulus** than the section it feeds (riser M ≥ 1.2 × section M). Recommend riser size + gate location at the thermal centre.
17. **Cores & undercuts:** internal undercuts require cores; flag and tag core cost.
18. **Minimum section / fluidity:** min castable wall by alloy + process (die cast Al ≈ 0.8–1.0 mm; sand ≈ 3 mm). Flag thinner than fluidity limit.

**Data Archie needs:** alloy props (already `forge::casting::AlloyProps`: ρ, cp, k, L, T_sol, T_liq), pull direction, process (sand/investment/die), pour temp, mold temp, wall heat-transfer coeff h_wall. Archie picks alloy by name → engine fills the property table.

### A.3 Injection molding (thermoplastic)

**Engine:** `forge::manufacturing::dfm::injection(shape, MoldContext)` + a **moldflow** advisory using the existing `forge::moldflow` and `forge::mold` (parting/runner/cooling already present).

19. **Wall thickness:** nominal `1.2–3.5 mm`, material-specific: ABS `1.2–2.8`, PC `~1.0`, POM `0.8–2.5`, PP `0.8–3.0`, Nylon `0.8–3.0`. Flag below min (short shot) and above max (sink/cycle). Enforce **uniform** wall (target ±10%). [rpproto, protolabs]
20. **Draft:** ≥ **1–2° per side** for smooth faces; **+1° per 0.025 mm (0.001″)** of texture depth, or ≥3–5° for textured surfaces. Flag undrafted/insufficient faces (reuse `analyseDraft`). [protolabs draft guide]
21. **Rib thickness:** rib root ≤ **50–60%** of nominal wall to avoid sink on the cosmetic opposite face; rib height ≤ 3× wall; draft ribs ≥0.5°. Flag fat ribs. [makerstage, rpproto]
22. **Boss design:** boss OD ≤ 2.5× hole Ø, wall at base ≤ 60% nominal, gusseted not solid-thick.
23. **Sink-mark prediction:** at any local thickness > 1.2× nominal (rib-to-wall, boss-to-wall junctions), flag predicted sink; severity scales with thickness ratio.
24. **Weld-line prediction:** run flow-front advance (existing/extended moldflow) from gate(s); where two fronts meet behind holes/around cores, mark a **weld line** with predicted strength knockdown (typ. 10–60% of base, worse for fiber-filled). Recommend gate relocation / flow-leader. [search: moldflow predicts weld line position]
25. **Gate & runner sizing:** gate Ø ≈ **0.5–0.75 × wall** (edge gate); runner Ø sized so it freezes after the part (round full-round runner Ø ≈ part wall + 1.5 mm typical; sub-runner ≈ 0.6–0.75 × main). Build the runner via `forge::mold::buildRunnerSystem`. Flag undersized gates (jetting / premature freeze) and oversized runners (scrap/cycle).
26. **Undercut → side action:** detect undercuts needing slides/lifters (reuse `analyseDraft` negative classification + shadow-ray undercut analysis already in `ToolParamSchemas`), tag tooling-cost penalty.
27. **Cooling uniformity:** from the cooling-channel layout, flag sections >2× the median distance-to-coolant (long cycle / warp).
28. **Fill/pressure feasibility (dynamic):** estimate flow-length-to-thickness ratio L/t vs material limit (e.g. ABS ≈ 150–250, PC ≈ 100–150); flag short-shot risk; this is the live moldflow check.

**Data Archie needs:** polymer (name → viscosity/PVT/L-t limit table), gate count/locations, parting direction, melt + mold temp, ejection method. Archie names the resin; engine fills properties.

### A.4 Sheet metal

**Engine:** `forge::manufacturing::dfm::sheetmetal(shape, SheetMetalParams)` ON the existing `forge::sheetmetal` (bends, unfold, **flatPattern** already produce K-factor flat patterns with `BendRecord`).

29. **Min bend radius:** inner radius ≥ material-thickness-dependent floor by alloy/temper — annealed Al / soft steel **1T**; 5052-H32 ≈ 1–2T; **6061-T6 ≈ 3–6T**; stainless ≈ 1–2T. Flag radius below alloy floor (cracking). [rivcut, hotean]
30. **K-factor / bend allowance:** `BA = (π/180)·angle·(R + K·t)`, K typically **0.33 (air bend) … 0.44 … 0.50 (bottoming)**. Use per-material K; expose in flat-pattern (already `kFactor=0.44` default — make material-driven). [search]
31. **Bend relief:** when a bend ends at an edge, require relief slot width ≥ **t** and depth ≥ bend radius + relief, to prevent tearing. Flag missing relief; auto-add via `cornerRelief` verb.
32. **Hole/feature-to-bend distance:** min from bend line to any hole/cutout ≥ **2.5·t + R** (else distortion). Flag closer features. [search]
33. **Hole-to-edge distance:** ≥ **2·t** (min 1.5·t). Min hole Ø ≥ t (≥1.0·t pierced).
34. **Flat-pattern producibility:** verify the part unfolds to a single flat blank without self-overlap (run `unfold`/`flatPattern`; if it throws or overlaps → flag non-developable geometry).
35. **Consistent bend radius:** flag mixed radii (each unique radius = a separate tool/setup, +cost). Recommend standardizing to a tooling radius set.
36. **K-factor → flat blank length:** emit blank developed length = Σ flat segments + Σ `devLength` (already `(R+K·t)·angle` per `BendRecord`). This feeds nesting + cost.
37. **Bend sequence / collision:** order bends so the press brake can reach each (no back-gauge/flange collision); feeds CAPP.

**Data Archie needs:** thickness, alloy+temper (→ min-radius + K), bend list (already captured), grain direction (bends ⊥ grain preferred). Archie sets `thickness` + material; engine sets the rest.

### A.5 Additive manufacturing (FDM / SLA / SLS / metal PBF)

**Engine:** `forge::manufacturing::dfm::additive(shape, AMContext)`.

38. **Overhang / self-supporting angle:** flag down-facing faces below the self-support angle from build plate. Defaults: generic **45°**; metal PBF material-specific — **stainless ≈ 30°, Ti ≈ 30°, Al ≈ 45°, Inconel ≈ 55°, CoCr ≈ 30°**. Generate predicted support volume. [intechopen / Smith & Storey]
39. **Min feature / wall:** wall ≥ **0.8–2.0 mm** (process/material dependent; FDM ≥ 0.8–1.0 mm, SLA ≥ 0.5 mm, metal PBF ≥ 0.4–0.5 mm). Min pin/hole Ø per process. Flag below resolution.
40. **Bridging:** flag unsupported horizontal spans > process limit (FDM ≈ 5–10 mm bridge) → sag/support.
41. **Anisotropy:** report build orientation vs. principal load direction; flag when the worst (Z / inter-layer) strength axis aligns with primary tensile load (inter-layer ≈ 50–80% of in-plane). Recommend reorientation.
42. **Support accessibility:** flag internal supports that cannot be removed (enclosed cavities) and trapped powder (metal PBF — needs drain holes ≥ 2–5 mm).
43. **Min hole / channel:** self-supporting hole diameters; teardrop/diamond holes for horizontal channels to avoid supports.
44. **Build-volume fit + orientation cost:** check part fits the machine envelope; emit a recommended orientation minimizing support volume + Z-height (cycle) — a small optimization over candidate orientations using the overhang metric.
45. **Thermal/residual-distortion advisory (metal):** flag large flat down-skins + abrupt thickness jumps (warp/recoater-crash risk).

**Data Archie needs:** process (FDM/SLA/SLS/PBF), material, machine build envelope, primary load axis. Archie names process+material; engine fills thresholds.

### A.6 Welding / joining

**Engine:** `forge::manufacturing::dfm::welding(assembly, WeldContext)`.

46. **Torch/electrode access:** for each specified joint, ray-cast the torch access cone; flag joints with no clear approach angle or < min clearance (tight pockets, awkward angles). [manufyn]
47. **Fillet weld sizing:** effective throat = **0.707 × leg** (equal-leg). Enforce AWS D1.1 minimum fillet leg by thickness of the thicker part (e.g. up to ¼″ → 1/8″ min leg; >¾″ → 5/16″). Flag undersized/oversized welds. [welders-supply, kobelco]
48. **Distortion control:** detect unbalanced weld layout (welds on one side of neutral axis) → predicted angular/longitudinal distortion; recommend symmetric/balanced welds, intermittent (stitch) welds to cut heat input, or added stiffeners. [manufyn, toolgrit]
49. **Over-welding:** flag welds larger than needed for the load (shrinkage ∝ weld volume) → distortion + cost. Recommend min weld meeting strength.
50. **Joint prep / groove:** for full-penetration butt welds on thick sections, require groove prep (V/U) with root opening + bevel angle (e.g. 60° included, 1.6 mm root); flag thick square-butt joints. Emit weld symbol per AWS A2.4.
51. **Fit-up / gap:** flag root gaps outside process window; tag fixturing need.
52. **Material weldability:** flag dissimilar/hard-to-weld pairs (e.g. high-carbon, certain Al tempers) → preheat/PWHT note.

**Data Archie needs:** joint list with member thicknesses, weld process (GMAW/GTAW/SMAW), load on each joint, access geometry. Archie defines joints between bodies; engine sizes + checks.

### A.7 Forging

**Engine:** `forge::manufacturing::dfm::forging(shape, ForgingContext)`.

53. **Draft:** forging draft larger than casting — external **3–5°**, internal **5–7°** (hot forging) for die release. Flag insufficient.
54. **Parting-line placement:** prefer a single planar parting line through the largest cross-section; flag complex/multi-plane partings (die-cost, flash).
55. **Fillet & corner radii:** generous radii (min ≈ 1.5–3 mm, scaled to section) to allow metal flow; sharp corners → laps/cold shuts. Flag sharp transitions.
56. **Rib/web proportions:** ribs not too thin/tall vs web (flow + die-fill); flag high rib-height : thickness ratios (>6:1 risk of unfilled dies).
57. **Web thickness:** min web thickness scaled to plan area (thin webs don't fill); flag below limit.
58. **Flash + machining allowance:** add flash land at parting line and machining stock (1.5–3 mm) on functional surfaces; emit the forged near-net shape vs. finished.
59. **Grain-flow advisory:** report that fibering follows the forged shape — recommend orienting the part so grain flow aligns with principal stress (qualitative + load-axis input).

**Data Archie needs:** material + temp regime (hot/cold), die parting direction, finished-machined surfaces. Archie names material + forging type.

### DFMA (assembly) — cross-cutting

60. **Part-count reduction (Boothroyd-Dewhurst-style):** for each part in an assembly, run the 3 theoretical-minimum-parts questions (relative motion? different material? required for assembly/service access?) → flag candidates for consolidation; compute a **design efficiency** `E = (3 × N_min) / t_assembly`.
61. **Handling & insertion:** flag symmetric-ambiguous parts (need orientation), tangling/nesting risk, no-chamfer insertions; recommend self-locating features + lead-in chamfers.
62. **Fastener rationalization:** count distinct fasteners; flag excessive variety; recommend snap-fits/standardized hardware. Feeds BOM (§E).

---

## B. AUTOMATIC PROCESS PLANNING (CAPP)

**Engine:** `forge::capp` (generative, feature-based) → a structured **ProcessPlan**. Drives the existing `forge::cam` toolpaths. JS facade: `forge.capp.plan(shape, context)`.

63. **Feature recognition (FR):** convex/concave decomposition of the BRep into machinable features — pockets, slots, holes (through/blind/counterbored/tapped), bosses, faces, chamfers, fillets, threads. Use face-adjacency graph + concave-edge loops (volumetric/projective FR). This is the input to all downstream CAPP steps. [sciencedirect generative CAPP]
64. **Operation selection:** map each feature → operation set with precedence (e.g. hole = center-drill → drill → bore → ream → tap; pocket = rough → semi-finish → finish floor + walls). Tolerance/finish drives whether finish/grinding ops are needed.
65. **Setup planning:** group features by required tool-access direction (TAD); minimize the **number of setups/orientations** (each setup = re-fixturing + datum transfer + cost + tolerance loss). Output setup list with orientation + datum face per setup. [search: minimize set-up orientations]
66. **Operation sequencing:** order ops respecting precedence constraints (datums first, roughing before finishing, holes after the face they sit on) to minimize tool changes + cost; resolve with a precedence-graph topological sort + cost-minimizing heuristic. [search: operation sequencing minimizes machining cost]
67. **Tool selection:** for each op pick a tool from the catalogue satisfying access (Ø ≤ corner radius, reach ≥ depth) and maximizing MRR; fall back to smaller tools for tight corners (rest-machining). Couples to A.1 access test.
68. **Feeds & speeds:** call `forge::machining::{turning,milling,drilling}` per op → spindle rpm, feed, MRR, cutting force, power; verify spindle power/torque ≤ machine limit, deflection ≤ tolerance budget; auto-derate if exceeded. (Engine already exists — CAPP just orchestrates it.)
69. **Fixturing:** recommend workholding (vise/chuck/soft-jaws/fixture plate) per setup; flag thin-wall clamping distortion; pick datum/locating scheme (3-2-1).
70. **Cycle-time estimation (dynamic):** per op `t_cut = removed_volume / MRR`; total = Σ(t_cut + t_approach/retract + t_toolchange[~3–10 s each] + t_rapid + t_load/unload + t_inspect). Cutting is typically **40–70%** of cycle. Toolpath length from the actual generated `forge::cam` `Toolpath.cycleTimeSec`. [cncoptimization]
71. **Cost estimation (dynamic, feature/activity-based):** `cost = material_cost + Σ(t_op × machine_rate) + setup_cost + tooling_cost + handling + margin`. Machine rate = machine-hour-rate (depreciation + power + labor + overhead). Material = stock_volume × density × price/kg (link `bomAggregator` density/cost tables). Undercuts/EDM/extra-setups add their penalties from §A. [mdpi/ieee feature-based cost]
72. **Process-plan output:** machine-readable plan {setups[], ops[ {feature, tool, params, toolpathHandle, time, cost} ], total time, total cost, DFM report} — consumable by Archie, by the drawing/BOM, and by the vendor package.
73. **Process selection (which process at all):** given the part + qty + tolerance + material, recommend the primary process (machining vs casting+machining vs sheet metal vs molding vs AM) by a rule + cost-crossover model (e.g. low qty → machining/AM; high qty + draftable → casting/molding). This is the front gate of the pipeline (§D).

**Data Archie needs:** machine list (kinematics, power, envelope, rate), tool catalogue, stock material + price, target tolerance/finish, **production quantity** (drives process choice + amortized tooling). Archie supplies qty + material + tolerance; the machine/tool catalogue is a configured shop profile (reuse `VendorProfiles.js`).

---

## C. AUTO-MBD — MODEL-BASED DEFINITION (semantic PMI / GD&T)

The kernel today **evaluates** GD&T (`forge::native::gdt`) but cannot **author** a semantic, machine-readable annotation graph. MBD adds that.

**Engine:** `forge::mbd` — a semantic PMI graph attached to the BRep + a presentation layer; export through the existing `forge.io.exportStepWithPmi` (already present) and add QIF.

Standards (must conform): **ASME Y14.5** (GD&T semantics), **ASME Y14.41 / ISO 16792** (3D digital-product-definition / annotation), **STEP AP242 ed2/ed3 (ISO 10303-242)** for semantic PMI interchange, **QIF (ISO 23952)** for the metrology/inspection digital thread. [novedge, capvidia, cmm-quarterly]

74. **Semantic vs. presentation PMI:** store every annotation as **semantic** (machine-readable: feature reference, FCF type, zone, tolerance value, datum refs, material modifier) AND optionally render **presentation** (graphic placed in 3D). Semantic is the source of truth (CNC/CMM-consumable); presentation is for humans. [search: graphic vs semantic PMI]
75. **Datum auto-identification:** auto-pick primary/secondary/tertiary datums from the largest planar/cylindrical functional faces; build the **DatumReferenceFrame** via the existing `gdt::buildDrf(A,B,C)` (3-2-1). Emit A|B|C labels.
76. **GD&T auto-annotation (rule-driven):** apply default tolerance scheme by feature type: holes → **position** (Ø tol, MMC) wrt DRF; mating faces → **flatness/parallelism/perpendicularity**; bores → **cylindricity/concentricity**; profiles → **profile of a surface**. Tolerance magnitudes from the part's tolerance class (default ISO 2768-m / ±0.1 mm linear unless tighter functionally required). Each annotation is validated by the corresponding `gdt::evaluate*` against the nominal model (must pass at nominal).
77. **Material condition modifiers:** attach MMC/LMC/RFS appropriately (clearance holes → MMC for assemblability bonus) — leverages existing `evaluateTruePosition` MMC-bonus math.
78. **Feature-of-size + general tolerances:** auto-apply a general tolerance block (ISO 2768 or ASME) for un-toleranced dimensions; flag over-/under-constrained dimensioning.
79. **Surface finish + notes:** attach Ra requirements (e.g. machined 3.2 µm default, sealing faces 0.8 µm), material spec, heat-treat/coating notes as semantic attributes.
80. **PMI ↔ tolerance-stack link:** the semantic PMI graph feeds `forge::tolerance::compute` automatically — a dimension chain across mating features auto-extracts nominals + tolerances → worst-case/RSS/Cpk, closing the loop with §A.7 and §B.68 (deflection/tolerance budget).
81. **Validation:** an MBD model is "valid" iff every FCF references resolvable datums, every datum is realizable, no tolerance is geometrically infeasible, and all annotations pass at nominal. Emit an MBD-completeness score.
82. **Export:** STEP AP242 with **semantic** PMI (not just polyline graphics) + QIF for inspection; the existing STEP-with-PMI exporter is the seam — extend to write semantic FCFs, not annotation curves only.

**Data Archie needs:** functional intent per face (mating / clearance / sealing / datum / cosmetic), tolerance class, and which features mate with which (assembly context). Archie classifies faces (it has the design intent from the prompt); the engine applies the standard-conformant scheme. **This is exactly what makes the model machine-readable for CNC/CMM and is a CADGenBench interface-match driver.**

---

## D. "AUTO MBD AND MODEL PROCESS" — the automatic model→process pipeline

One command, `forge.mfg.autoProcess(shape, intent)`, chains everything so Archie issues a single high-level call and gets a complete, makeable definition:

83. **Stage 1 — Process selection:** §B.73 picks the primary process from material + qty + tolerance + geometry.
84. **Stage 2 — DFM gate:** run the matching §A engine; if `error`-severity issues exist, either (a) auto-fix via the suggested verbs (add draft, increase fillet, add relief, thicken wall, add drain hole) and re-check, or (b) return the report for Archie to resolve. **No release with open errors.**
85. **Stage 3 — Auto-MBD:** §C auto-applies datums + GD&T + finishes → semantic PMI graph; runs tolerance stack to confirm the scheme is producible.
86. **Stage 4 — CAPP:** §B generates setups, ops, tools, feeds/speeds, toolpaths (`forge::cam`), cycle time + cost.
87. **Stage 5 — Process artifacts:** emit the makeable package — toolpaths/G-code (machining), flat pattern + bend table (sheet metal), mold/cavity-core + runner + cooling (molding/casting), build orientation + support estimate (AM), weld map + symbols (welding).
88. **Stage 6 — Drawing + MBD doc:** auto-generate the 2D drawing (existing `Drawing2D.js`/BomRollup auto-balloon) AND the annotated 3D MBD as the released definition.
89. **Stage 7 — Verdict + score:** return `{ makeable: bool, process, dfmReport, mbd, plan, cost, cycleTime, artifacts }`; "makeable" = DFM clean + MBD valid + plan feasible (power/tolerance/access all satisfied).
90. **Idempotent + revisable:** re-running after a geometry edit recomputes the whole chain and diffs against the prior revision (feeds ECO in §E).

**Data Archie needs (the single payload):** `{ material, quantity, toleranceClass, primaryLoadAxis?, faceIntents?, shopProfile? }`. Everything else is derived. This is the contract Archie's training corpus must teach — one structured intent → a full process definition.

---

## E. FULL AUTONOMOUS PRE-MANUFACTURING PLM (run by Archie)

Collapse the 3 unwired PLM stacks (`pdmVault.js` / `pdmStore.js` / `kernel/pdm/VersionControl.js`) into ONE item-graph, `forge::plm`, file-backed (extend `pdmVault.js`'s content-addressed SHA-256 store as the persistence). Single source of truth: **Item → Revision → BOM-line** with state machine + change objects.

91. **BOM generation (auto, multi-level indented):** from the assembly tree, generate the indented eBOM: each line `{ level, itemNo, partNo, rev, qty, refDes, material, mass, makeOrBuy }`. Mass from kernel `massProps`; material/cost from the density+cost tables. Roll up mass + cost bottom-up. Replace the 3 conflicting BOM notions with this one. (Build on `BomRollup.js` auto-balloon + `pdmStore.js` item graph — both exist.)
92. **Part numbering + classification:** auto-assign part numbers (configurable scheme: intelligent vs sequential), classify by type (machined/sheet/molded/purchased/fastener) — drives make/buy and supplier routing.
93. **Revision control (SemVer + rev-letter):** immutable, content-addressed revisions (SHA-256 of the geometry+PMI) — already in `pdmVault.js`. Rev letters A,B,C… for released; numeric working revs. Geometry hash detects real change vs. no-op.
94. **ECR → ECO/ECN workflow (industry-standard 3-stage):** Issue/Problem report → **ECR** (request: describe + justify + impact) → review/approve → **ECO/ECN** (order: implement, with affected items, disposition use-up/scrap/rework, new revs). Track state, approvers, dates. Archie can draft the ECR (reason + impact) autonomously. [arena, ptc, erp-software]
95. **Where-used + impact analysis:** reverse-BOM `whereUsed(item)` (exists in all 3 stacks — unify) so an ECO on a child surfaces every affected parent/assembly. Run automatically when a change is proposed → impact report. [search: impact analysis in PLM]
96. **Configuration management + effectivity:** the gap PLM_STATUS flags as NOT STARTED. Add date-effectivity and serial/lot-effectivity to BOM lines + a variant/option model (configurable BOM: option → which lines are included). Baselines = frozen, named BOM snapshots. This makes the BOM "as-designed/as-planned" configurable.
97. **Lifecycle state machine:** `InWork → InReview → Released → (Superseded | Obsolete)`, plus `Rejected`. Released revisions are immutable; changes require a new rev via ECO. Gate: cannot release with open DFM `error`s (ties §D to PLM). [search: lifecycle states]
98. **Supplier + cost rollup:** per make/buy line attach supplier(s) + quoted/standard cost; roll up assembly cost bottom-up (extend `AssemblyCost.js`/`bomAggregator.js`). Material cost from index tables (currently hard-coded — flag as "unverified" until a real feed, per honesty rules). Make-cost from §B.71 CAPP estimate.
99. **Traceability / digital thread:** link each item → its CAD model rev → MBD/PMI → process plan → drawing → certs → ECOs. `CertTraceabilityPanel.jsx` exists as a sink. Full audit history of every change (who/when/why).
100. **RFQ / vendor handoff (autonomous):** auto-assemble the vendor package (`buildVendorPackage` already bundles drawing + G-code + cost + DFM + manifest into a ZIP) and an RFQ email (`VendorRFQEmail.js` exists) per make-line, gated on Released state. Archie runs this end-to-end as the final pre-manufacturing step.
101. **Autonomous run contract:** Archie can execute the whole pre-manufacturing flow — generate BOM → run DFM/CAPP/cost per item → draft ECR if a fix changes geometry → push to Released → emit RFQ packages — as a sequence of `forge.plm.*` + `forge.mfg.*` tool-calls, with every state transition logged and reversible.

**Data Archie needs:** assembly tree (has it from the model), material per body, make/buy intent, supplier/shop profile, production quantity, and the change reason (for ECR text). Archie owns design intent + reasoning; the PLM engine owns the deterministic state machine + rollups.

---

## Cross-cutting: how this lifts the CADGenBench ≥0.85 north-star

- **Validity gate:** the DFM `makeable` verdict (§D) and watertight/manifold checks the kernel already runs ensure submissions pass the hard validity gate (a non-makeable solid is worthless even if it renders).
- **Interface match:** semantic PMI + auto-datums + MMC clearance bonus (§C) make mating features correct (keep-in/keep-out sub-volume correctness) — the interface axis.
- **Shape/topology:** process-aware geometry (draft, fillets, uniform walls) keeps real Betti/shape fidelity through the makeable transformation rather than producing fantasy geometry.
- **Training corpus implication:** Archie must be trained on the **single structured intent payloads** of §D.90 and §E.101 (material/qty/tolerance/face-intent → full process+PLM definition), not on isolated geometry verbs — this is the data that teaches it to drive the manufacturing engines.

---

## Sources

CNC machining DFM: [hardwarecustom — internal corner radius](https://www.hardwarecustom.com/cnc-internal-corner-radius/), [makerstage — CNC walls/pockets/threads](https://www.makerstage.com/resources/cnc-design-guidelines), [rapiddirect — thin wall](https://www.rapiddirect.com/blog/cnc-thin-wall-machining-guide/), [baoshengindustry — undercuts](https://baoshengindustry.com/resources/cnc-machining/undercut-design-guide-cnc-machining/).
Injection molding DFM: [rpproto — DFM injection molding](https://www.rpproto.com/blog/dfm-injection-molding), [protolabs — wall thickness](https://www.protolabs.com/resources/design-tips/improving-part-design-with-uniform-wall-thickness/), [protolabs — draft](https://www.protolabs.com/resources/design-tips/improving-part-moldability-with-draft/), [makerstage — DFM best practices](https://www.makerstage.com/resources/dfm-best-practices).
Casting DFM: [jiga — die casting DFM](https://jiga.io/articles/die-casting-dfm-2/), [cast-mold — 14 principles](https://cast-mold.com/blog/die-casting-part-design-14-principles/), [casting-yz — Al die casting guide](https://casting-yz.com/aluminum-die-casting-design-guide-for-better-parts-and-lower-cost/).
Sheet metal DFM: [rivcut — bend radius chart](https://www.rivcut.com/resources/bend-radius-chart), [hotean — min bend radius](https://hotean.com/blogs/hotean-blog/minimum-sheet-metal-bend-radius-to-prevent-cracking), [protolabs — bend radii](https://www.protolabs.com/resources/design-tips/the-basics-of-bend-radii-in-sheet-metal/).
Additive DFM: [intechopen — DfAM metal](https://www.intechopen.com/chapters/1195962), [ntop — 3 levels of DfAM](https://www.ntop.com/resources/blog/what-is-design-for-additive-manufacturing/), [altair — 4 principles](https://altair.com/blog/articles/four-key-principles-of-design-for-additive-manufacturing-dfam).
Welding DFM: [welders-supply — fillet sizing AWS D1.1](https://welders-supply.com/welding-techniques/joint-design/fillet-weld-sizing-guide-leg-size-throat-and-aws-d1.1-minimums/), [manufyn — welding design](https://manufyn.com/resources/design-guides/sheet-metal/welding-design/), [kobelco — fillet legs/throat](https://www.kobelco-welding.jp/education-center/abc/ABC_2000-01.html).
CAPP: [sciencedirect — generative CAPP via FR](https://www.sciencedirect.com/science/article/abs/pii/S0360835207001052), [sciencedirect — CAPP overview](https://www.sciencedirect.com/topics/computer-science/computer-aided-process-planning), [mdpi — machining cost tool](https://www.mdpi.com/2075-4701/12/7/1205), [cncoptimization — machining time/cost](https://www.cncoptimization.com/calculators/machining-time/).
MBD/PMI: [novedge — MBD authoring/interop](https://novedge.com/blogs/design-news/model-based-definition-mbd-authoring-governance-and-interoperability-for-cross-disciplinary-teams), [capvidia — MBD guide](https://www.capvidia.com/blog/mbd-model-based-definition-guide), [cmm-quarterly — Y14.41](https://cmm-quarterly.squarespace.com/articles/asme-y1441-pioneering-model-based-definition-in-modern-metrology), [saratech — PMI](https://saratech.com/2026/03/what-is-pmi/).
PLM/ECO: [arena — ECO](https://www.arenasolutions.com/resources/articles/engineering-change-order/), [ptc — ECO](https://www.ptc.com/en/blogs/plm/what-is-an-engineering-change-order), [erp-software — ECR/ECO workflows](https://erp-software.org/en/glossary/engineering-change-management/), [plmadvisors — change management](https://plmadvisors.com/plm-and-configuration-management-best-practices-the-engineering-change-management-process/).
