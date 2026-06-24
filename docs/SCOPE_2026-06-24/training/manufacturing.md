# Training Curriculum — MANUFACTURING & MANUFACTURABILITY Cluster

**Scope owner:** SCOPE_2026-06-24 / training
**Date:** 2026-06-24
**Cluster:** Manufacturing-process engineering — DFM, DFA/DFMA, DfAM, Mold/Tool/Die design, CNC programming & G-code, Sheet-metal forming, Plastic injection-molding sim, Castings & Forgings, Welding & Joining, Surface engineering & Tribology, Additive-Manufacturing engineering.
**Corpus module:** `bulk_synth_mfg.py` (Pillar C of `programs/archie_corpus_program.md`), feeding Stage **S3 `arch14b-mfg`** of the curriculum, with spillover into S4 (lifecycle/CAPP) and S5 (drawing→process multimodal).
**North-star:** Archie-drives-Forge ≥ **0.85 on CADGenBench across EVERY axis**. This cluster is the highest-leverage one for the **interface** axis (semantic PMI + auto-datums + MMC clearance bonus) and a co-owner of the **validity** axis (every design this cluster teaches must be *makeable*, not merely renderable).

> **Curriculum thesis.** A senior manufacturing engineer does not "know rules"; they hold a *process physics model* in their head and run it backwards from "this must be makeable at this cost/tolerance/volume" to "therefore the geometry must look like *this*." The corpus must teach Archie that backward reasoning so that **the geometry it emits is already manufacturable** — draft where the die pulls, uniform walls where the polymer freezes, fillets where the metal flows, reachable corners where the tool spins, supportable overhangs where the laser scans. Every sample terminates in a kernel-replayable `forge.<wb>.<op>(args)` call or a structured, geometry-truth-checkable verdict.

This document is the **training-data** companion to the engine spec `SCOPE_2026-06-21/research/manufacturing.md` (which defines the kernel/JS engines and the 101 numbered DFM/CAPP/MBD/PLM requirements). That doc says *what the kernel computes*; this doc says *what knowledge Archie must internalize and how to manufacture the data that installs it.*

---

## 0. Grounding in the live kernel (build ON, do not duplicate)

The synthetic data must terminate in verbs the kernel actually replays. Verified verb surface (grep of `frontend/src` + `forge-kernel`):

| Sub-discipline | Live verbs / engines (answer-key oracle) | Header |
|---|---|---|
| CNC / CAM / G-code | `forge.cam.{profile,pocket,drill,faceMill,adaptiveClear,multiAxisIndexed,multiAxisContinuous,sweep,simulateStock,gcode,generateCmm}` | `Cam.hpp`, `CamAdvanced.hpp`, `native/cam/Cam.hpp` |
| Feeds/speeds/power | `forge::machining::{turning,milling,drilling}` (Kienzle K_c, MRR, power) | `Machining.hpp` |
| Mold / tool / die | `forge.mold.{analyseDraft,computeParting,splitCavityCore,buildRunnerSystem,insertCoolingChannels,heleShawFill}` | `Mold.hpp` |
| Injection-molding sim | `forge.mold.heleShawFill` + `MoldFlow.cpp` (native fill, 362 LOC) | `MoldFlow.hpp` |
| Casting / forging | `forge.casting.solidify` (enthalpy FD + Niyama G/√R) | `Casting.hpp` |
| Sheet metal | `forge::sheetmetal` baseFlange/unfold/flatPattern (K-factor, `BendRecord`) | `SheetMetal.hpp`, `SheetMetalFlatPattern.hpp`, `SheetMetalExtended.hpp` |
| Welding / joining | `forge.welding.simulateWeld` (Goldak FEA, 436 LOC), weld-group/fillet/heat-input | `WeldingFea.hpp`, `WeldGroup.hpp`, `FilletWeld.hpp`, `WeldHeatInput.hpp` |
| Tolerance / stack-up | `forge.tolerance.compute` (worst-case/RSS/MC + Cp/Cpk) | `Tolerance.hpp` |
| GD&T / MBD eval | `forge::native::gdt` (DRF 3-2-1, true-position+MMC bonus, flatness, perpendicularity) | `native/gdt/Gdt.hpp` |
| AM / DfAM / topology-opt / surface | **partial / to-extend** — `forge.manufacturing.dfm.additive`, `forge.dfam.*`, `forge.topopt.*`, `forge.am.*`, `forge.tribo.*` per the engine spec | — |
| Unified facade (target) | `forge.mfg.autoProcess(shape, intent)`, `forge.manufacturing.dfm.<process>(...)`, `forge.capp.plan(...)` | engine spec §A–§D |

**Honesty rule (memory):** where an engine is present-but-shallow (e.g. full 3D moldflow vs. the Hele-Shaw 2.5D approximation; turbulent CFD), the corpus teaches Archie to **surface the verified limit and recommend the validated path**, never to fabricate a precision the kernel cannot deliver. Surface-engineering/tribology DfAM lattice and some forging verbs are to-be-extended; samples for those are authored against the engine-spec signatures and gated as "engine-target" until bound.

---

## 1. KNOWLEDGE BREAKDOWN — bachelors → masters → PhD → industry practice

The breakdown is per sub-discipline. Each gives: **(L1 BSc)** the canonical theory/equations, **(L2 MSc)** the modeling/analysis depth, **(L3 PhD/frontier)** the research-grade reasoning, **(IND)** the hard real-world judgment a senior engineer applies, and **standards** that bound "correct." These are the *answer keys* for the generators in §3.

### 1.1 DFM — Design for Manufacturing (process-agnostic + per-process)

- **L1.** Tolerance↔cost curve (cost rises hyperbolically as tolerance tightens below process capability); standard vs. precision tolerance bands per process (mill ±0.125 mm standard / ±0.025 mm precision; turning ±0.0125 mm; casting ±0.5–1.5 mm; sheet ±0.13 mm; molding ±0.05–0.2 mm). Surface-finish economics (Ra ladder: rough mill 3.2 µm → finish 1.6 µm → grind 0.4 µm → lap 0.05 µm, each step ~2–3× cost). Process-capability index **Cp = (USL−LSL)/6σ**, **Cpk = min((USL−µ)/3σ, (µ−LSL)/3σ)**; 6σ ⇒ Cp ≈ 2.0, Cpk ≥ 1.33 = industry floor, 1.67 = automotive.
- **L2.** Feature-based DFM: corner-radius 130% rule (`r ≥ 1.3·r_tool`) and 6:1 corner-depth rule; pocket depth ≤ 3–4× tool Ø (deflection δ ∝ L³/EI); thin-wall limits (metal 0.8 mm, plastic 1.5 mm) and aspect cap 15:1; hole L/D ≤ 10 before peck-drilling; undercut detection (no tool-axis access cone). Cost = material + Σ(t_op·rate) + setup + tooling.
- **L3.** Manufacturability *as a field over the geometry* — medial-axis thickness fields, access-cone fields, draft-angle fields; automatic re-routing of process when a feature is infeasible (true zero-radius internal corner ⇒ EDM, not milling). Generative DFM where the rule-checker drives an auto-fix back into the geometry (add draft, grow fillet, thicken wall, split into 2 setups).
- **IND.** "Standard tolerances are free; every tight callout must earn its place from a functional requirement traced to an interface." Recognize the **process signature** of a part on sight (parting line, draft, ejector marks ⇒ molded; bend reliefs ⇒ sheet; fillet-everywhere + draft ⇒ cast). Quote-killer features: undercuts, deep narrow pockets, sharp internal corners, mixed bend radii, non-standard hole sizes.
- **Standards:** ISO 2768 (general tolerances -f/-m/-c), ISO 286 (limits & fits, H7/g6 etc.), ASME B4.1, ISO 1101 (geometrical tolerancing), GD&T per §1.10.

### 1.2 DFA / DFMA — Design for Assembly / Manufacture-and-Assembly

- **L1.** Boothroyd–Dewhurst method: **design efficiency E = (3·N_min)/t_assembly**, where N_min is theoretical minimum part count from the three questions (relative motion? different material/isolation? required for assembly/service access?). Handling code (size, symmetry α+β, nesting/tangling) → handling time; insertion code (access, vision, alignment, resistance) → insertion time.
- **L2.** Part-count consolidation as the primary lever (each part eliminated removes handling + insertion + a fastener + an inventory line + a tolerance stack contributor). Self-locating features, lead-in chamfers, snap-fit cantilever beam design (**σ_max = 3·E·δ·t/(2·L²)** for a constant-section cantilever snap; permissible strain ε per polymer). Poka-yoke: asymmetric features prevent mis-orientation.
- **L3.** Concurrent DFMA across the BOM (consolidate while preserving tolerance chains and serviceability); multi-objective trade between part-count, tooling amortization, and assembly-line takt.
- **IND.** "The cheapest part is the one you deleted." Standardize fasteners to ≤3 types; design for top-down vertical assembly (gravity-fed, no re-orientation); avoid flexible parts and parts that tangle. Service access is a hard constraint, not a nicety.
- **Standards:** Boothroyd-Dewhurst DFMA; MIL-HDBK handling guidelines; company assembly takt/ergonomics (RULA/REBA cross-link).

### 1.3 DfAM — Design for Additive Manufacturing

- **L1.** Self-support overhang angle from build plate (generic 45°; metal-PBF material-specific: SS 30°, Ti 30°, Al 45°, Inconel 55°, CoCr 30°); min wall/feature by process (FDM 0.8–1.0 mm, SLA 0.5 mm, metal-PBF 0.4–0.5 mm); bridging span limits (FDM 5–10 mm); anisotropy (Z/inter-layer strength 50–80% of in-plane); trapped-powder drain holes (≥2–5 mm) for metal PBF.
- **L2.** Build-orientation optimization (minimize support volume + Z-height + down-skin area + flag worst-strength axis ∥ primary load); lattice/TPMS infill (gyroid implicit `sin x cos y + sin y cos z + sin z cos x = c`; relative density ↔ effective modulus by Gibson-Ashby **E/E_s = C(ρ/ρ_s)^n**, n≈2 for bending-dominated, n≈1 for stretch-dominated); part consolidation enabled by AM (conformal channels, monolithic assemblies).
- **L3.** Topology optimization + lattice gradation as the native AM design language (SIMP **min compliance s.t. volume**, penalty ρ^p, p=3; level-set/BESO); residual-stress & distortion prediction (inherent-strain / thermo-mechanical); design *for* the process window (overheating in thin struts, recoater-crash from tall flat down-skins, warpage from abrupt section change). Manufacturing-constrained topopt (min member size = beam Ø, overhang projection filter).
- **IND.** "AM is not 'free complexity' — every overhang is a support you pay to print and remove, every internal channel must drain, every lattice must be inspectable." Consolidate, conformal-cool, lightweight — but down-skin finish is poor and inter-layer is the weak axis; orient the load into the build plane.
- **Standards:** ISO/ASTM 52900 (terminology), 52910 (DfAM requirements), 52911-1/-2 (PBF metal/polymer guidelines), ASTM F3301.

### 1.4 Mold / Tool / Die Design

- **L1.** Two-plate vs three-plate mold; parting-line selection (largest planar cross-section, minimal flash); draft (smooth 1–2°/side, +1° per 0.025 mm texture depth, ≥3–5° textured); shrinkage compensation (mold cavity = part × (1+shrink), e.g. ABS 0.4–0.7%, POM 1.8–2.5%, glass-filled lower & anisotropic); ejection (pin/sleeve/stripper) and ejector-mark placement.
- **L2.** Cavity/core split from pull direction (`splitCavityCore`); runner/gate/cooling design — full-round runner Ø ≈ wall + 1.5 mm, sub-runner 0.6–0.75× main, gate Ø ≈ 0.5–0.75× wall (edge gate); cooling-channel layout (Ø, pitch, distance-to-surface for uniform `ΔT`; conformal vs straight-drilled); side-actions (slides/lifters) for undercuts. Die design (stamping/forging) — die-set, clearance (sheet blanking clearance = 5–10% of t per side), spring-back compensation.
- **L3.** Mold thermal balancing (target uniform freeze; couple to moldflow + cooling sim); family/multi-cavity balancing (naturally-balanced vs artificially-balanced runners; flow-imbalance → short shots in outer cavities); progressive-die strip layout optimization (minimize scrap, station count).
- **IND.** "The mold is a heat exchanger and a flow network before it is a cavity." A degree of draft is cheaper than a polished ejector failure; a balanced runner beats a fast one; tooling is amortized — at low volume re-route to machining/AM, the cost-crossover gates the whole decision.
- **Standards:** DME/Hasco mold-base standards; SPI/SPE surface-finish (SPI A1–D3); shrinkage per resin datasheet; ISO 294 (molding test specimens).

### 1.5 CNC Programming & G-code

- **L1.** G/M-code semantics: motion (G0 rapid, G1 linear feed, G2/G3 CW/CCW arc with I/J/K or R), plane (G17/18/19), units (G20/G21), absolute/incremental (G90/G91), work offsets (G54–G59), tool-length/cutter-comp (G43/H, G41/G42/D, G40 cancel), canned cycles (G81 drill, G83 peck, G73 chip-break, G84 tap, G85 bore), spindle (M3/M4/M5), coolant (M8/M9), tool change (M6 T). Feeds/speeds: **N = 1000·v_c/(π·D)** rpm, **f = N·f_z·z** mm/min, **MRR = a_p·a_e·f** (mill), cutting power **P = MRR·K_c/(60·10⁶·η)** kW with Kienzle **k_c = k_c1.1·h^(−m_c)**.
- **L2.** 2.5D / 3-axis toolpath strategies (contour/profile, pocket: zig-zag vs trochoidal/adaptive constant-engagement, face-mill, drill, rest-machining); climb vs conventional milling (climb = lower forces, better finish on rigid setups); stepover/scallop-height **h = R − √(R²−(a_e/2)²)** for ball-nose; lead-in/lead-out arcs; work-coordinate and tool-table setup; post-processor (CL-data → machine dialect: Fanuc/Heidenhain/Siemens 840D/Haas).
- **L3.** 4/5-axis indexed and continuous (tool-axis vector control, tilt to avoid collision & improve effective cutting Ø on the ball-nose, sturz angle); collision/gouge avoidance (holder vs stock swept volume); high-speed machining (HSM: constant chip load, smooth tool motion, look-ahead); stock simulation/material removal (`simulateStock`) and gouge-free verification; on-machine probing → CMM (`generateCmm`).
- **IND.** "Rigidity first, then feeds." Tool deflection, chatter (stability lobes — choose spindle speed at a lobe peak), and chip evacuation kill more parts than wrong feeds. Minimize setups (each re-fixture loses datum and tolerance); program the *machine you have* (envelope, power, kinematics).
- **Standards:** ISO 6983 (G-code), ISO 14649 / STEP-NC (AP238), RS-274; ISO 13399 (tool data); machine kinematics & power limits.

### 1.6 Sheet-Metal Forming

- **L1.** Bending: bend allowance **BA = (π/180)·θ·(R + K·t)**, bend deduction, neutral-axis K-factor (0.33 air bend … 0.44 … 0.50 bottoming, material-dependent); min inside radius by alloy/temper (annealed/soft 1T; 5052-H32 ≈1–2T; 6061-T6 ≈3–6T; SS ≈1–2T) — below floor ⇒ cracking; springback (ΔR/R from elastic recovery, K_springback ∝ R·σ_y/(E·t)). Blank development (flat pattern length = Σ flats + Σ devLength).
- **L2.** Bend relief (width ≥ t, depth ≥ R+relief) to prevent tearing; feature-to-bend distance ≥ 2.5t+R; hole-to-edge ≥ 2t; consistent radii (each unique radius = a tool/setup); grain direction (bend ⊥ grain to avoid cracking); bend sequence to avoid back-gauge/flange collision. Deep drawing: limiting draw ratio LDR = D_blank/D_punch (~1.8–2.2), draw force, blank-holder force, FLD (forming-limit diagram — major/minor strain envelope).
- **L3.** Springback compensation by die geometry (over-bend, coining); incremental sheet forming; non-developable surface detection (a flat pattern that self-overlaps ⇒ requires draw/stretch, not bend); formability via FLD + thinning prediction (FEA — explicit shell).
- **IND.** "Design to the press brake you have: standard tooling radii, reliefs at every bend that meets an edge, holes far from bends, one material grain orientation." A part that won't unfold to a single non-overlapping blank is not a sheet-metal part.
- **Standards:** DIN 6935 (bending), ISO 2768 sheet, material temper specs (AMS/EN), FLD per ISO 12004.

### 1.7 Plastic Injection-Molding Simulation

- **L1.** The process cycle (fill → pack/hold → cool → eject); wall-thickness windows per resin (ABS 1.2–2.8 mm, PC ~1.0, POM 0.8–2.5, PP 0.8–3.0, Nylon 0.8–3.0) and the **uniform-wall imperative** (±10%); sink-mark physics (local thickness >1.2× nominal at rib/boss junctions ⇒ sink on cosmetic face); rib root ≤ 50–60% nominal wall, height ≤3×wall.
- **L2.** Flow simulation: **Hele-Shaw / generalized-Newtonian** thin-cavity fill (the kernel's `heleShawFill` / `MoldFlow.cpp`), pressure & flow-front advance; **Cross-WLF viscosity** η(γ̇,T,p) = η₀/(1+(η₀γ̇/τ*)^(1−n)); **Tait PVT** for shrinkage/pack; weld-line prediction (two flow fronts meeting behind a hole/core → strength knockdown 10–60%, worse for fiber-filled); air-trap detection; gate-freeze / pack analysis; flow-length-to-thickness L/t vs material limit (ABS 150–250, PC 100–150) → short-shot risk.
- **L3.** Fiber-orientation (Folgar–Tucker / RSC) → anisotropic shrink & warpage; coupled fill-pack-cool-warp; conformal-cooling thermal optimization; 3D (vs 2.5D Hele-Shaw) solver for thick/complex parts (honesty: kernel is 2.5D Hele-Shaw — surface this and recommend full-3D path where the thin-shell assumption breaks).
- **IND.** "Pack and cool make the part, not fill." Uniform wall and balanced gating fix 80% of defects; weld lines go where you don't want them unless you place the gate; warpage is differential shrinkage — control cooling and fiber orientation. Sink is a thickness problem, not a pressure problem.
- **Standards:** ISO 294, resin datasheets (viscosity/PVT/shrink), Moldflow validation literature (Autodesk/Moldex3D benchmark cases).

### 1.8 Castings & Forgings

- **Casting L1.** Draft (external 1–2°, internal 2–3° die; sand ≥1°); wall uniformity (thick:thin ≤ 3:1); fillets at all junctions (min 0.5–1.0 mm) to kill hot spots/stress risers; per-alloy linear shrink (gray iron 1.0%, Al 1.3%, steel 2.0%, brass 1.5%) — pattern = part×(1+shrink); minimum castable wall by alloy/process (die-cast Al 0.8–1.0 mm, sand ~3 mm).
- **Casting L2.** **Chvorinov's rule** t_solidify = C·(V/A)² (modulus M = V/A); riser must out-modulus the section it feeds (M_riser ≥ 1.2·M_section); gating system (sprue/runner/gate ratio, non-pressurized 1:4:4 to reduce turbulence); directional solidification toward risers; **Niyama criterion** Ny = G/√Ṙ for shrinkage-porosity (threshold ~1.0 steel, ~0.7 Al — the kernel's `solidify` computes this field). Hot-spot detection from the solidification-time field = the **dynamic** check.
- **Forging L1/L2.** Forging draft larger than casting (external 3–5°, internal 5–7° hot); single-plane parting through largest cross-section; generous fillets/corners (1.5–3 mm, scaled) for metal flow (sharp ⇒ laps/cold-shuts); rib height:thickness ≤ ~6:1 (die-fill); web min thickness by plan area; flash land + machining allowance (1.5–3 mm) on functional surfaces; **grain-flow (fibering) follows the forged shape** — orient grain ∥ principal stress.
- **L3.** Coupled solidification + shrinkage-porosity + macrosegregation; gating optimization (minimize turbulence/oxide entrainment, Campbell's rules — no free-fall > critical height); forging die-fill simulation (rigid-viscoplastic FEM, flow stress σ = K·ε^n·ε̇^m·f(T)); residual stress and quench distortion.
- **IND.** "Cast for shape, forge for strength." Feed every heavy section or accept porosity; never a sharp corner (casting hot spot / forging lap); grain flow is the forged part's hidden FoS; the riser is sacrificial — size it from the modulus, not by feel.
- **Standards:** ASTM casting specs, NADCA (die casting), AFS gating/risering; forging: ASM Handbook Vol. 14A, DIN 7523 (forging design), grain-flow per part criticality.

### 1.9 Welding & Joining

- **L1.** Joint types (butt/lap/tee/corner/edge) and weld types (fillet/groove/plug); **fillet effective throat = 0.707·leg** (equal-leg); AWS D1.1 minimum fillet leg by thicker-member thickness (≤¼″ → 1/8″; >¾″ → 5/16″); weld-symbol semantics (AWS A2.4 — arrow side / other side, size, length-pitch, contour). Process selection (GMAW/MIG productivity, GTAW/TIG quality/thin, SMAW field, SAW thick).
- **L2.** Heat input **HI = η·V·I/v** (kJ/mm), and its grip on HAZ size, cooling rate, microstructure, and **distortion** (angular, longitudinal, transverse — ∝ weld volume & asymmetry about neutral axis); distortion control (balanced/symmetric welds, intermittent/stitch welds to cut heat, back-step, fixturing, pre-set); residual stress; weldability (carbon equivalent **CE = C + Mn/6 + (Cr+Mo+V)/5 + (Ni+Cu)/15**; CE > 0.45 ⇒ preheat/PWHT); groove prep for full penetration on thick sections (60° included, 1.6 mm root).
- **L3.** Goldak double-ellipsoid moving heat source (the kernel's `simulateWeld` / `WeldingFea.cpp`): q(x,y,z,t) double-ellipsoid power density → transient thermal → thermo-mechanical distortion & residual stress; weld-sequence optimization to minimize distortion; fracture/fatigue of welded joints (hot-spot stress, IIW S-N classes, notch stress).
- **IND.** "Heat goes in, distortion comes out — minimize and balance it." Don't over-weld (shrinkage ∝ volume = distortion + cost); size to the load (0.707·leg throat × length × allowable); torch access is a hard constraint (ray-cast the cone); dissimilar/high-CE metals need preheat. Symmetric weld layout about the neutral axis beats any post-straightening.
- **Standards:** AWS D1.1 (structural steel), AWS A2.4 (symbols), AWS A3.0 (terms), ISO 5817 (quality levels), ISO 3834 (QA), ASME BPVC IX (qualification), IIW fatigue recommendations.

### 1.10 GD&T / Tolerance Stack-up / MBD (the interface backbone)

- **L1.** ASME Y14.5-2018: 14 characteristics in 5 categories (form: flatness/straightness/circularity/cylindricity; orientation: perpendicularity/angularity/parallelism; location: position/concentricity/symmetry; profile: of-a-line/of-a-surface; runout: circular/total). Feature control frame, datum reference frame (DRF, 3-2-1 immobilization), material condition modifiers MMC/LMC/RFS and **bonus tolerance** (clearance hole at MMC gets Ø-of-(actual−MMC) extra positional tolerance). **True position** Ø2·√(Δx²+Δy²).
- **L2.** Tolerance stack-up: **worst-case** (Σ|tol|), **RSS / statistical** (√Σtol²), **Monte-Carlo** (the kernel's `tolerance.compute` does all three + Cp/Cpk); 1D loop diagrams; datum shift; the cost of over-tight stacks; selecting the loop that controls the functional gap.
- **L3.** Semantic PMI / MBD (ASME Y14.41, ISO 16792, STEP AP242 ed2/ed3 semantic PMI, QIF ISO 23952): the annotation as a machine-readable graph (feature ref + FCF type + zone + datum refs + modifier), not polyline graphics; auto-datum selection from functional faces; rule-driven GD&T scheme by feature type (holes→position@MMC, mating faces→flatness/parallelism/perpendicularity, bores→cylindricity, profiles→surface profile); the **interface contract** for CNC/CMM (DMIS, QIF) — this is what makes a model machine-consumable downstream.
- **IND.** "Datums are functional, not geometric — pick the faces the part *seats and registers on*." Tolerance only what the interface demands; MMC on clearance holes buys free assemblability; an un-resolvable datum or an infeasible tolerance is a design defect. The model *is* the drawing (MBD) — semantic PMI or it didn't happen.
- **Standards:** ASME Y14.5-2018, Y14.41, ISO 1101 / 5458 / 2692 / 8015, ISO 16792, STEP AP242 (ISO 10303-242), QIF (ISO 23952), ISO 286 fits, DMIS.

### 1.11 Surface Engineering & Tribology

- **L1.** Surface texture parameters (Ra/Rz/Rq; bearing-area Abbott-Firestone); friction (Coulomb µ, static>kinetic); wear modes (adhesive, abrasive, fatigue/pitting, corrosive, fretting); **Archard wear** V = k·W·s/H (wear volume ∝ load·sliding distance / hardness).
- **L2.** Lubrication regimes (Stribeck curve: boundary → mixed → hydrodynamic vs µ–(ηN/P)); **Hertzian contact** (max contact pressure p₀, contact half-width a, sub-surface shear); **Reynolds equation** for film pressure ∂/∂x(h³/η·∂p/∂x)+∂/∂z(...) = 6U·∂h/∂x; coatings & treatments (carburizing/nitriding case depth, PVD/CVD TiN/DLC, anodizing thickness class, electroplating, shot-peen residual-compressive for fatigue, thermal spray). Specifying Ra by function (machined 3.2 µm default, sealing/sliding 0.8 µm, optical 0.05 µm).
- **L3.** Elastohydrodynamic lubrication (EHL — pressure-viscosity, film at non-conformal contacts); surface-texturing for friction reduction (laser dimples); coating residual-stress/adhesion; fretting-fatigue at interference fits; tribo-corrosion.
- **IND.** "Surface finish is a function spec, not a vanity number — and it's expensive, so specify only where the interface slides, seals, or fatigues." Coatings are a system (substrate + interlayer + topcoat + residual stress); shot-peen and case-harden where fatigue lives; lubricate to leave the boundary regime.
- **Standards:** ISO 4287/4288/21920 (texture), ISO 25178 (areal), ASTM G99 (pin-on-disk), coating specs (ISO 2081 zinc plating, AMS nitride/carburize, ISO 7599 anodize), ISO 6336 gear surface durability (pitting).

---

## 2. DATA SOURCES — premium / authoritative only

> Hard IP hygiene (memory): cite open standards as answer-key references; **do not scrape proprietary standards text**. Use the equations/limits as ground truth; use named open courses/datasets/papers as the streamed corpus. Strict **download → process → delete**, `iter_batches`, accumulator-dedup.

### 2.1 Textbooks (the canon — answer keys for the generators)

| Sub-discipline | Authoritative texts |
|---|---|
| Manufacturing fundamentals | Kalpakjian & Schmid, *Manufacturing Engineering & Technology*; Groover, *Fundamentals of Modern Manufacturing*; DeGarmo, *Materials & Processes in Manufacturing* |
| DFM / DFMA | Boothroyd, Dewhurst & Knight, *Product Design for Manufacture and Assembly* (the canonical method); Bralla, *Design for Manufacturability Handbook*; Poli, *Design for Manufacturing* |
| CNC / machining | Tlusty, *Manufacturing Processes & Equipment*; *Machinery's Handbook* (Industrial Press — feeds/speeds, threads, fits); Smid, *CNC Programming Handbook*; Stephenson & Agapiou, *Metal Cutting Theory and Practice* |
| Sheet metal | Boljanovic, *Sheet Metal Forming Processes and Die Design*; Marciniak/Duncan/Hu, *Mechanics of Sheet Metal Forming* |
| Injection molding | Beaumont, *Runner and Gating Design Handbook*; Kennedy & Zheng, *Flow Analysis of Injection Molds*; Osswald/Turng/Gramann, *Injection Molding Handbook*; Malloy, *Plastic Part Design for Injection Molding* |
| Mold/tool/die | Menges/Michaeli/Mohren, *How to Make Injection Molds*; Tool & Manufacturing Engineers Handbook (SME) |
| Casting | Campbell, *Complete Casting Handbook*; *ASM Handbook Vol. 15 — Casting*; Flinn, *Fundamentals of Metal Casting* |
| Forging | *ASM Handbook Vol. 14A — Metalworking: Bulk Forming*; Altan, *Cold and Hot Forging* |
| Welding | *AWS Welding Handbook*; *ASM Handbook Vol. 6 — Welding, Brazing, Soldering*; Masubuchi, *Analysis of Welded Structures* (distortion/residual stress); Goldak & Akhlaghi, *Computational Welding Mechanics* |
| Additive / DfAM | Gibson, Rosen & Stucker, *Additive Manufacturing Technologies*; *ASM Handbook Vol. 24 — Additive Manufacturing*; Yang et al., *Additive Manufacturing of Metals* |
| GD&T / MBD | Drake, *Dimensioning and Tolerancing Handbook*; ASME Y14.5-2018 (concepts); Krulikowski, *Fundamentals of GD&T*; Henzold, *Geometrical Dimensioning and Tolerancing for Design, Manufacturing and Inspection* |
| Tribology | Bhushan, *Introduction to Tribology*; Stachowiak & Batchelor, *Engineering Tribology*; Hamrock, *Fundamentals of Fluid Film Lubrication* |

### 2.2 Open courseware (streamable lecture/problem text)

- **MIT OpenCourseWare:** 2.008 *Design and Manufacturing II* (injection molding, casting, DFM, SPC), 2.810 *Manufacturing Processes and Systems* (process physics, GD&T, tolerancing), 2.810/2.875, 2.007/2.72 (DFA), 3.054 cellular solids (Gibson-Ashby lattice), 16.810 (engineering design + manufacturing).
- **NPTEL (IIT):** *Manufacturing Processes*, *Theory of Metal Cutting*, *Welding Engineering*, *Metal Forming*, *Manufacturing Process Technology*, *Tribology* — full transcript sets with worked numericals (excellent problem→solution density).
- **Penn State / Georgia Tech / Cambridge** open lecture notes on CAPP, GD&T, and metrology.

### 2.3 Standards bodies (answer-key limits — cite, don't redistribute text)

ASME (Y14.5-2018, Y14.41, BPVC IX, B4.x), ISO (286, 2768, 1101, 16792, 10303-242/AP242, 23952 QIF, 4287/25178 texture, 6336 gears, 5817 weld quality), AWS (D1.1, A2.4, A3.0), ASTM/ASM (casting, AM ISO/ASTM 52900-series, surface), NADCA (die casting), AFS (gating/risering), DIN (6935 bending, 7523 forging), SAE/AMS (materials, coatings, tempers), AGMA (gears).

### 2.4 Datasets (geometry-grounding, CC0/clean)

- **DeepCAD** (~150k sketch-and-extrude sequences) + **Fusion360 Gallery** (human design + assembly sequences) + **ABC dataset** (1M+ B-reps) → streamed via `ingest_deepcad.py`; feature-recognition and process-route labels are **kernel-derived** (run `forge.capp` / DFM engines over them to auto-label process, draft, thickness, holes).
- **CADGenBench public inputs** (`HuggingAI4Engineering/cadgenbench-data`, ODC-BY) → exact part-class mirror for the interface axis (jigs, bolt-patterns, slots, bosses).
- **MFCAD / MFCAD++ / FeatureNet** — machining-feature-recognition labeled B-reps (pockets/slots/holes/chamfers) → train the feature→operation mapping.
- **Manufacturing-feature & DFM datasets** from open papers (CADNet, BRepNet feature-seg labels).
- **Poly Haven CC0** PBR/HDRI — only for the surface-finish/render branch, not for engineering ground truth.

### 2.5 Papers (frontier reasoning)

CAPP & feature recognition (generative CAPP via FR; BRepNet/UV-Net/MFCAD++ learned feature segmentation); moldflow (Hele-Shaw fill, Cross-WLF, Folgar-Tucker fiber orientation, weld-line prediction); casting (Niyama criterion original, Chvorinov, Campbell's filling rules); welding (Goldak double-ellipsoid, computational welding mechanics, IIW fatigue); DfAM (inherent-strain distortion, support generation, topology-opt with overhang constraint, Gibson-Ashby lattice mechanics); GD&T/MBD (semantic PMI in AP242, tolerance-stack statistical methods); tribology (Archard, Hertz, EHL). Synthesize into `research/` notes; the equations are the answer keys.

---

## 3. SYNTHETIC-DATA GENERATION PLAN (`bulk_synth_mfg.py`)

> **Governing rule (memory):** programmatic bulk_synth, never agent hand-authoring (agents top out at 40–60 samples; bulk_synth does 10k+ in seconds). Every sample is JSONL `{messages:[system,user,assistant]}` with the chat template Archie was trained on; the assistant ends in a schema-valid `forge.<wb>.<op>(args)` call or a structured, geometry-truth-checkable verdict. **Drop `--mask-prompt` on long samples (NaN risk).** SI primary, imperial recall. Dynamic-first (solidification/fill/forming/distortion over static lookups). Honesty injected where the engine is shallow.

### 3.0 Generation architecture — five sample *shapes* × eleven sub-disciplines

Every sub-discipline (§1.1–§1.11) is crossed with five sample shapes. The generator iterates parametric templates over **sampled values** (material, thickness, tolerance, quantity, feature dims) so each row is unique, and **grounds the answer in the kernel** wherever it is geometric.

| Shape | What it teaches | Grounding / verifier |
|---|---|---|
| **Q/A (recall+reason)** | the equations, limits, standards, the *why* | symbolic check + standard-citation; analytical known-answer |
| **Problem → solution** | numeric application (feeds/speeds, BA, modulus, throat, Cp/Cpk, Niyama) | closed-form recompute; cross-check vs `forge::machining`/`tolerance.compute` |
| **Design → critique (DFM report)** | spot the unmanufacturable feature + the fix verb | run the matching `forge.manufacturing.dfm.<process>` over the part → the emitted `DFMReport` IS the label |
| **Tool-call (drive Forge)** | issue the makeable geometry / process op | **kernel replay** — build, then verify watertight/Betti/draft/flat-pattern with the DFM engine; reject if invalid |
| **Self-correction (multi-turn)** | consume a DFM/sim verdict and converge to makeable | each turn re-runs the engine; sample converges to `makeable:true` |

### 3.1 Per-process generators (the heart)

For each of the 7 processes (machining, casting, injection, sheet, additive, welding, forging) + DFMA + GD&T/MBD + tribology, `bulk_synth_mfg.py` exposes a `gen_<process>_<shape>` function. Examples of what they bulk-generate:

- **`gen_machining`** — (Q/A) "min internal corner radius for an 8 mm endmill in a 30 mm-deep pocket?" → 130%/6:1 reasoning; (problem) feeds/speeds/power/cycle for sampled material+tool+geometry, cross-checked against `forge::machining::milling`; (critique) parts with `depth>4D` pockets / sub-tool corners / undercuts → `forge.manufacturing.dfm.machining` report + autofix verb; (tool-call) `forge.cam.{pocket,drill,adaptiveClear,gcode}` with feasible params + `simulateStock` gouge-check; (self-correct) reduce pocket depth / split setup until access-clean.
- **`gen_injection`** — (critique) sample a part with a fat rib (root > 60% wall) or thick boss junction → predict sink/weld-line; (tool-call) `forge.mold.{computeParting,analyseDraft,splitCavityCore,buildRunnerSystem,insertCoolingChannels}` + `heleShawFill` to get the flow-front/short-shot verdict; honesty sample: "this is a thick/3D part — the 2.5D Hele-Shaw fill is an approximation; flag and recommend full-3D validation."
- **`gen_casting`** — (problem) Chvorinov modulus + riser sizing for sampled section; (tool-call) `forge.casting.solidify` → read the Niyama field → flag last-to-freeze unfed region → recommend riser at thermal centre; pattern-shrink scaling.
- **`gen_sheetmetal`** — (problem) BA/flat-length for sampled θ/R/t/K; (critique) radius below alloy floor, hole-too-close-to-bend, missing relief; (tool-call) baseFlange/bend/unfold/`flatPattern` → verify single non-overlapping blank.
- **`gen_welding`** — (problem) fillet throat 0.707·leg, AWS-D1.1 min leg, heat-input, CE preheat; (tool-call) `forge.welding.simulateWeld` (Goldak) → distortion/residual prediction + balanced-weld recommendation; weld-symbol authoring (AWS A2.4).
- **`gen_additive`** — (critique) overhang faces below material self-support angle, trapped powder, anisotropy-vs-load; (tool-call) `forge.dfam.*`/`forge.am.*` orientation-optimize + support estimate + drain holes; lattice density↔modulus (Gibson-Ashby) sizing.
- **`gen_forging`** — draft 3–5°/5–7°, parting through largest section, fillet flow, flash+stock, grain-flow ∥ stress.
- **`gen_gdt_mbd`** — (the interface-axis engine) auto-datum (3-2-1 from functional faces) → rule-driven FCF scheme (holes→position@MMC, faces→flatness/perp) → validate every FCF passes at nominal via `forge::native::gdt` → feed `forge.tolerance.compute` stack → emit semantic-PMI tool-calls. **Mirror the CADGenBench jig failure taxonomy** (wrong spacing/missing-hole/wrong-Ø/narrow-slot/offset-slot/rotated-boss/shifted-holes) so the model learns to place mating features within ~5%/1%.
- **`gen_dfma`** — Boothroyd-Dewhurst N_min/efficiency, part-consolidation candidates, snap-fit beam sizing, fastener rationalization.
- **`gen_tribology`** — Archard wear life, Hertzian contact pressure, Stribecky regime selection, Ra-by-function, coating/case-depth specification.

### 3.2 The single-intent payload (highest leverage) — `gen_autoprocess`

The contract Archie must learn (engine-spec §D.90): one structured intent → a full makeable definition.

```
{ material, quantity, toleranceClass, primaryLoadAxis?, faceIntents?, shopProfile? }
        → forge.mfg.autoProcess(shape, intent)
        → { makeable, process, dfmReport, mbd, plan, cost, cycleTime, artifacts }
```

`gen_autoprocess` bulk-generates: a part + an intent → the correct **process selection** (qty/tolerance/material/geometry cost-crossover: low-qty/AM/mill vs high-qty draftable cast/mold), the DFM gate verdict, the auto-MBD scheme, the CAPP plan (setups/ops/tools/feeds/time/cost), and the `makeable` boolean. This is what teaches Archie to *drive the manufacturing engines from one design intent*, not to memorize isolated verbs — the corpus implication called out in both the engine spec and the corpus program.

### 3.3 Keeping it GROUNDED (the non-negotiable)

1. **Geometric ⇒ kernel-verified.** Any sample whose answer is a shape or a DFM verdict is *generated by running the kernel*: build the part, run `forge.manufacturing.dfm.<process>` / `forge.casting.solidify` / `forge.mold.heleShawFill` / `flatPattern` / `gdt::evaluate*`, and use the engine's structured output as the label. A draft-angle critique is true because `analyseDraft` measured it; a flat-pattern is valid because `flatPattern` produced a non-overlapping blank.
2. **Numeric ⇒ closed-form + cross-check.** Feeds/speeds, BA, throat, modulus, Cp/Cpk are recomputed by an independent closed-form *and* the kernel engine; mismatches are dropped (this catches generator bugs).
3. **Tool-calls ⇒ replay or reject.** Every `forge.*` call is schema-validated and replayed; sequences that yield non-watertight / non-manifold / wrong-Betti / DFM-`error` geometry are filtered out (the **validity** axis is enforced *at data-generation time*, so Archie never trains on an unmakeable example).
4. **Standards ⇒ cited limits.** Each rule carries its standard (ISO 2768, AWS D1.1, ASME Y14.5, ISO/ASTM 52911) so the recall samples teach the *authority*, not a folk number.
5. **Honesty ⇒ shallow-engine samples** teach Archie to surface the verified limit (2.5D Hele-Shaw, laminar-only CFD coupling, engine-target verbs) and recommend the validated path.

### 3.4 How this makes Archie better INSIDE Forge (drive the CAD, not chat)

- **Validity axis:** because every training shape is DFM-clean and watertight (filtered at generation), Archie's prior shifts toward *emitting makeable solids* — draft on pull faces, uniform walls, reachable corners, single-blank sheet — directly defending the ≥0.95 validity rate.
- **Interface axis (the differentiator):** `gen_gdt_mbd` + the jig failure taxonomy + MMC clearance-bonus teach Archie to place mating features (bolt holes, bolt-circles, bosses, slots) within the benchmark's ±5%/1% interface tolerance and to attach a semantic-PMI/auto-datum scheme — exactly the KOR/KIR interface metric.
- **Shape/topology axes:** process-aware geometry (correct fillet/draft/thickness, exact hole counts, no fantasy voids) holds Betti/shape fidelity through the makeable transformation.
- **Driving, not chatting:** the dominant sample shape is the **tool-call** and **single-intent `autoProcess`** — Archie learns the verb sequence + the structured payload that *operates Forge*, so at inference it types a prompt and drives the kernel to a makeable, MBD-complete, costed result.

### 3.5 Curriculum placement & budget

| Stage | Adapter | This cluster's corpus | Gate |
|---|---|---|---|
| **S3** | `arch14b-mfg` (on S2-physics) | §3.1 per-process + §3.2 `autoProcess` + GD&T/MBD interface | Interface axis ≥0.85 on jig smoke; `autoProcess` makeable-verdict valid; DFM tool-calls schema-valid & replay-clean |
| **S4** | `arch14b-data` | CAPP plans + PLM handoff (cross-link to lifecycle cluster) | CAPP plan feasible (power/tolerance/access); BOM/cost rollups correct |
| **S5** | `arch14b-vlm` | drawing(orthographic+GD&T+hole-table) → process intent | drawing→process intent matches on held-out set |

**Per-run unique-sample target (bulk_synth scale, accumulator-dedup):**
- per-process generators (9 generators × ~5 shapes × parametric sweep): **~1.2–1.5M**
- `gen_gdt_mbd` interface corpus (the jig taxonomy is dense): **~400–600k**
- `gen_autoprocess` single-intent payloads: **~200–300k**
- self-correction multi-turn + honesty + DPO pairs (via `dpo_synth.py` ranked by ForgeCADScore): **~150–250k**

**Cluster total target: ~2.0–2.5M unique samples per generation cycle** (storage-safe streaming, accumulator-dedup, process→train→delete).

---

## 4. EXAMPLE TRAINING SAMPLES (depth illustration)

> Format = `{messages:[system,user,assistant]}` with chat template applied at generation; system message omitted here for brevity (it sets the Forge-engineer persona + tool schema). Tool-call args abbreviated; the real generator emits schema-valid JSON.

### Sample A — Injection-molding DFM critique → fix (design→critique→tool-call, kernel-grounded)

**User:** "Review this ABS housing for injection molding. Nominal wall 2.4 mm. There's a structural rib 2.2 mm thick at the root, 14 mm tall, and a boss 8 mm OD over a 4 mm hole, solid to the wall. Gate is a single edge gate at one end; the part is 180 mm long. Tell me what will go wrong and fix it."

**Assistant (ideal):**
"Three defects, two of them cosmetic-fatal, plus a fill risk.

1. **Rib too thick → sink mark.** Rib root 2.2 mm is **92%** of the 2.4 mm nominal wall; the guideline is **≤50–60%** (so ≤1.2–1.4 mm) to keep the rib-to-wall junction from forming a local thick spot that shrinks and pulls a visible sink on the opposite (cosmetic) face. Severity scales with thickness ratio — at 0.92 this is a guaranteed sink. *Fix:* thin the rib root to **1.3 mm** (≈54%), add a **0.5° draft** per side, keep height ≤ 3× wall (14 < 7.2 fails — also reduce rib height to ≤7 mm or split into two shorter ribs).
2. **Boss solid to wall → sink + long cool.** A boss solid into the nominal wall creates a thick junction (same sink physics) and a hot spot that lengthens cycle. *Fix:* core the boss so its wall at the base is **≤60% of nominal (≤1.44 mm)**, blend with a fillet, and gusset rather than thicken for strength. Boss OD 8 mm over a 4 mm hole is fine (OD ≤ 2.5× hole = 10 mm).
3. **Single edge gate, L/t = 180 / 2.4 = 75.** That's within ABS's flow-length-to-thickness window (~150–250), so fill is OK — *but* a single end gate makes a long unidirectional flow with high end-of-fill pressure and a likely weld line behind the boss/hole. Confirm with a fill sim and check for a weld line at the boss.

I'll apply the geometry fixes and run the fill to confirm.
`forge.feature.modifyRib(ribId='R1', rootThickness=1.3, draftDeg=0.5, maxHeight=7.0)`
`forge.feature.coreBoss(bossId='B1', baseWallFrac=0.6, fillet=0.8, gusset=true)`
`forge.mold.computeParting(pullDir=[0,0,1])`
`forge.mold.heleShawFill(resin='ABS', gates=[{pos:'end',dia:1.3}], meltC=230, moldC=50)`

Note: `heleShawFill` is a **2.5D Hele-Shaw** solver — valid for this thin-wall housing (wall ≪ in-plane extent). If the wall/thickness assumption breaks anywhere I'll flag it and recommend a full-3D fill check; I won't report a precision the 2.5D model can't give. Gate Ø sized at 0.5–0.75× wall = 1.2–1.8 mm (used 1.3). If the fill shows the weld line landing on a load path, I'll add a second gate to move it."

*Grounding:* the rib/boss ratios are checked by `forge.manufacturing.dfm.injection`; `heleShawFill` returns the real flow-front/pressure/short-shot/weld-line, which is the label. Honesty note is mandatory for the 2.5D engine.

---

### Sample B — CNC feeds/speeds + DFM + G-code (problem→solution→tool-call, closed-form + kernel cross-check)

**User:** "Rough a 60 mm × 40 mm × 12 mm-deep pocket in 6061-T6 with a Ø10 mm 3-flute carbide endmill, full slot entry. Internal corners must be R3. Give feeds/speeds, MRR, spindle power, flag any DFM issue, and emit the toolpath + a G-code header."

**Assistant (ideal):**
"**DFM first.** Corner R3 with a Ø10 (r_tool = 5 mm) endmill is **impossible** — a Ø10 tool leaves a minimum internal corner radius of 5 mm, and R3 needs r_tool ≤ 3 mm. Two options: (a) relax corners to **R5** (matches the Ø10 tool, satisfies the 130% finish rule if a separate finish pass uses a Ø6 → 1.3×3 = 3.9 < tool), or (b) rough with Ø10 then **rest-machine the corners with a Ø6 tool** to reach R3. Pocket depth 12 mm / Ø10 = 1.2× — well under the 3–4× reach limit, so rigidity is fine. I'll rough with Ø10 and leave R3 corners for a Ø6 finish pass.

**Feeds/speeds (rough, Ø10 3FL carbide, 6061-T6):**
- Cutting speed v_c ≈ 250 m/min (carbide in Al) → **N = 1000·v_c/(π·D) = 1000·250/(π·10) ≈ 7958 rpm**.
- Chip load f_z ≈ 0.05 mm/tooth → **f = N·f_z·z = 7958·0.05·3 ≈ 1194 mm/min**.
- Full-slot rough: a_e = 10 mm, a_p = 6 mm (2 passes for 12 mm depth) → **MRR = a_p·a_e·f = 6·10·1194/1000 ≈ 71.6 cm³/min**.
- Power: K_c(6061) ≈ 800 N/mm² → **P = MRR·K_c/(60·10⁶·η)** = (71.6e3·800)/(60e6·0.8) ≈ **1.2 kW** — within a hobby/VMC spindle. *But* full-slot at a_e = D loads the tool fully; prefer **trochoidal/adaptive** (a_e ≈ 1–1.5 mm, a_p = full 12 mm) for constant engagement, less heat, longer tool life.

**Toolpath + header:**
`forge.cam.adaptiveClear(tool={dia:10,flutes:3}, pocket='P1', ae:1.2, ap:12, feed:1194, rpm:7958, stockToLeave:0.3)`
`forge.cam.profile(tool={dia:6}, pocket='P1', cornerR:3, finish:true, feed:900, rpm:9000)`
`forge.cam.simulateStock()`  // gouge/leftover check
`forge.cam.gcode(post='haas', units='G21')`
→ header: `%` / `O0001` / `G21 G90 G54 G17` / `G43 H01 Z25.` / `M3 S7958` / `M8` …

Cycle estimate from the generated path (`Toolpath.cycleTimeSec`) — adaptive raises path length but the higher safe feed nets a shorter cut. If the spindle tops out below 7958 rpm, derate v_c and recompute."

*Grounding:* N/f/MRR/P recomputed closed-form *and* cross-checked against `forge::machining::milling`; `simulateStock` verifies no gouge and that the Ø6 pass actually reaches R3; the corner-radius DFM flag is the `forge.manufacturing.dfm.machining` 130% rule.

---

### Sample C — Casting riser sizing from solidification + GD&T interface (problem→tool-call→MBD, dynamic kernel grounding)

**User:** "A gray-iron bracket has a heavy boss (Ø50 × 40 mm) blending into a 12 mm web, sand cast. Will it have shrinkage porosity, and where should the riser go? Then put the two mounting holes (Ø10, 80 mm apart) under position control so they assemble to a mating plate."

**Assistant (ideal):**
"**Solidification — the dynamic check.** The boss is the heavy section: modulus **M = V/A**. For the Ø50×40 boss, V ≈ 78.5e3 mm³, cooling surface A ≈ (2·π·25²)+(π·50·40) ≈ 3.93e3 + 6.28e3 ≈ 10.2e3 mm² → **M_boss ≈ 7.7 mm**. The 12 mm web is thin (M ≈ 3 mm) and freezes first, so the boss is a **last-to-freeze isolated hot spot** — it *will* draw shrinkage porosity unless fed. I'll confirm with the thermal solver and read the Niyama field (gray-iron threshold ≈ 1.0):
`forge.casting.solidify(alloy='gray-iron', pourC=1380, moldC=25, h_wall=1000)`
→ inspect solidification-time field for the last-to-freeze region and Niyama < 1.0 zones.

**Riser:** place a top riser **on the boss** (the thermal centre), sized to out-modulus the section it feeds: **M_riser ≥ 1.2·M_boss = 9.2 mm**. A cylindrical riser Ø60×90 mm gives M ≈ 11 — adequate; add a neck so it feeds but knocks off. Gate into the thin web (non-pressurized ~1:4:4, no free-fall above the critical height to avoid oxide entrainment — Campbell). Apply gray-iron shrink **1.0%**: pattern = part × 1.010.

**GD&T for the mounting interface (so it assembles):**
- Datums: primary **A** = the large mounting face (3-point, seats the part), secondary **B** = the boss bore axis or a registration edge, tertiary **C** = a side face. `forge.gdt.buildDrf(A,B,C)`.
- Both Ø10 holes are clearance holes → **position Ø0.3 at MMC** wrt |A|B|C. MMC gives bonus tolerance as the holes depart from max material, so the 80 mm spacing assembles to the mating plate's pins/bolts even with the cast-then-machined variation.
`forge.gdt.position(features=['H1','H2'], zoneDia=0.3, modifier='MMC', drf='A|B|C')`
`forge.tolerance.compute(loop=['H1->H2'], method='RSS')`  // confirm 80 mm ± stack assembles
Each FCF is validated against the nominal model (must pass at nominal) and exported as **semantic PMI (AP242)**, not graphics, so the CMM/CNC can consume it:
`forge.mbd.exportStepWithPmi(semantic=true)`

So: yes, porosity at the boss without feeding; riser on the boss at M ≥ 9.2 mm; holes at position-Ø0.3-MMC to A|B|C so the bracket bolts up. I'll run `solidify` to confirm the hot-spot location before finalizing the riser neck."

*Grounding:* the modulus/riser numbers are closed-form (Chvorinov) and *confirmed* by the `forge.casting.solidify` Niyama/solidification-time field (the dynamic label); the position-at-MMC scheme is validated by `forge::native::gdt` at nominal and fed to `forge.tolerance.compute` — directly the **interface** axis the benchmark scores.

---

## 5. How this cluster lifts the ≥0.85 north-star (summary)

- **Interface axis (its headline contribution):** `gen_gdt_mbd` + jig failure taxonomy + MMC clearance-bonus + auto-datum → mating features placed within ±5%/1%, semantic PMI attached. This is where general models collapse and where this cluster is the differentiator.
- **Validity axis (co-owner):** every training shape is DFM-clean + watertight, filtered at generation by replay — Archie's prior shifts to emitting *makeable* solids (the ≥0.95 rate).
- **Shape/topology axes:** process-aware geometry (correct draft/fillet/thickness, exact hole/void counts) preserves Betti/shape fidelity.
- **Drives the CAD, not chats:** dominant sample shapes are the **tool-call** and **single-intent `autoProcess`** — Archie learns to operate Forge to a makeable, MBD-complete, costed result, which is the whole point of an Archie-drives-Forge system.

**Process discipline (memory):** bulk_synth programmatic; download→process→delete + `iter_batches` streaming; no `--mask-prompt` on long corpora (NaN guard + loss watch per run); serve fresh before any eval; track all four CADGenBench axes separately (a 0.85 mean with weak interface fails); honesty held where the engine is shallow.
