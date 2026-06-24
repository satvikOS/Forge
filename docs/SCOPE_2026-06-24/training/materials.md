# TRAINING CLUSTER — MATERIALS, METALLURGY & POLYMER SCIENCE

**Owner:** SCOPE_2026-06-24 / training · **Date:** 2026-06-24 · **Status:** canonical cluster spec (folds into `programs/archie_corpus_program.md` Pillar B → **Cluster-2 property feeds** + a new dedicated `arch14b-materials` adapter stage)
**Synthesized from:** `research/fields_direct.md §1–3` (Material Science / Metallurgy / Polymer), the corpus-program four-pillar architecture, and verified `forge-kernel/` modules (`Casting.cpp`, `Mold.cpp`, `MoldFlow.cpp`, `Weld*.cpp`, `Fatigue.cpp`/`FeaExtras.cpp`, `HertzPoint.cpp`, `Bearing.cpp`).

> **THESIS.** This cluster makes Archie reason about **real, manufacturable material behaviour** — so that every geometry it drives in Forge carries a *correct, standards-grounded material identity*: the right alloy/polymer/composite for the duty, the right heat-treat/cure that the chosen process can actually deliver, anisotropy that feeds the FEA tensor (not an isotropic lie), and degradation/processing limits that keep the design **makeable and certifiable**. A CAD model that emits a beautiful B-rep with an impossible material spec is wrong. This cluster closes that gap.
>
> **WHY IT MATTERS INSIDE FORGE (not just chat).** Material knowledge is not a side channel — it is the *answer key* that grounds three Forge op families the kernel already exposes: `forge.material.*` (property tensor / laminate / homogenization / heat-treat sim), `forge.metallurgy.*` (Jominy / CCT / carbon-equivalent / tempering), `forge.polymer.*` (Cross-WLF / Tait / viscoelastic / Folgar–Tucker). Every training sample terminates in a **schema-valid tool-call the kernel can replay**, so the material reasoning is *geometry-and-physics-truth scorable*, not free text. This is the property layer under Cluster-2 (CAE) and Cluster-3 (Manufacturing): pick Ti-6Al-4V and the FEA stiffness tensor, the fatigue S-N curve, the CTE thermal map, the weld preheat, and the casting solidification window all change together — and Archie must keep them *consistent*.

> **HARDWARE / HYGIENE (inherited, non-negotiable).** Mac Studio M4 Max, 36 GB unified RAM. 4-bit qLoRA, sequence-budgeted. **Storage-safe streaming: download → process → delete, one item at a time**, parquet via `iter_batches`, accumulator-dedup. Programmatic `bulk_synth`-style generation **only** (agents top out at 40–60 samples; generators emit 10k+ unique in seconds). Never co-host train + serve + Electron + Vite. **Never `--mask-prompt` on long corpora** (all-masked → NaN → silent adapter corruption). Cite open-standards *text* as answer keys; never scrape proprietary handbooks (ASM/MMPDS/CMH-17 are license-gated — embed the *equations and known-answer datapoints*, reference the clause, do not ingest the PDF).

---

## 0. WHERE THIS CLUSTER PLUGS IN

| Layer | This cluster's role |
|---|---|
| **Pillar A (math/logic)** | Consumes it: Arrhenius/Avrami/diffusion ODEs, eigen-problem for the anisotropic stiffness tensor, least-squares for master-curve shifting, lever-rule algebra. No new math — *applies* `bulk_synth_math` primitives to materials. |
| **Pillar B / Cluster-2 (CAE physics)** | **Is the property feed.** Every `forge.fea.*` / `forge.fatigue.*` / `forge.cfd.conjugateHeat` call needs a `MaterialCard`. This cluster authors and validates that card. |
| **Pillar B / Cluster-3 (Manufacturing)** | **Is the makeability gate.** Heat-treat/cure achievability, weldability (CE/preheat), casting cooling-rate→grain-size, injection processing window — all gate `forge.mfg.autoProcess`. |
| **Pillar D (eAGI)** | **Outcome-of-decision pairs.** Material substitution (Al-6061→Ti-6Al-4V) is the canonical owned-kernel sweep: Δmass/Δstiffness/Δcost/Δthermal/Δfatigue, deterministic and free. |
| **Pillar E (CADGenBench)** | Indirect: correct material → correct wall-thickness/shrinkage → correct **shape** axis (polymer Tait shrinkage moves nominal dims); correct CTE → correct fit at temperature (**interface** axis). |
| **New stage** | `arch14b-materials` LoRA, trained between **S1 Geometry** and **S2 Physics** (S2 needs valid material cards to exist before physics can be scored). |

---

## 1. KNOWLEDGE BREAKDOWN (Ivy / top-research-institute grade, BSc → MSc → PhD → industry)

Three sub-clusters. Each carries: **core theory**, **governing equations** (answer keys), **standards** (citable clause references), and **the hard engineering judgment** a senior engineer applies that a textbook does not state.

### 1.1 Material Science & Engineering

**BSc core.** Crystal structure (BCC/FCC/HCP, 14 Bravais lattices, Miller (hkl)/[uvw] indices, slip systems & Schmid factor `τ_RSS = σ·cosφ·cosλ`), point/line/planar defects (vacancies, edge/screw dislocations + Burgers vector, grain boundaries, stacking faults), diffusion (Fick 1st `J=−D∂C/∂x`, 2nd `∂C/∂t=D∂²C/∂x²`, error-function/thin-film solutions, Arrhenius `D=D₀·exp(−Q/RT)`), binary phase diagrams + **lever rule** (`w_α=(C_β−C₀)/(C_β−C_α)`), strengthening (solid-solution, precipitation/age-hardening Orowan looping, grain refinement **Hall–Petch** `σ_y=σ₀+k_y·d^(−1/2)`, strain/work hardening `σ=Kε^n`).

**MSc core.** Generalized Hooke's law `σ_ij=C_ijkl·ε_kl`; the 6×6 stiffness `C` for isotropic / cubic / transversely-isotropic / orthotropic symmetry (and *which* materials demand which — wrought metal ≈ isotropic, rolled sheet = orthotropic with Hill/Barlat anisotropy, UD laminae = transversely isotropic); composite homogenization (**rule of mixtures** `E_c=V_f·E_f+V_m·E_m` for axial, inverse-ROM for transverse, **Halpin–Tsai** `E=E_m(1+ξηV_f)/(1−ηV_f)` for the middle ground); **Classical Laminate Theory** (lamina Q̄ rotation, **ABD** matrix `[N;M]=[A B;B D][ε⁰;κ]`, ply-by-ply stress recovery); composite failure (**Tsai–Wu** interactive, **Hashin** mode-separated fibre/matrix tension/compression, max-stress/max-strain); thermo-elasticity (CTE α(T), residual stress from cure/cool, free vs constrained expansion).

**PhD / research edge.** Crystal plasticity & texture (ODF, Taylor/Sachs bounds), micromechanics (Eshelby, Mori–Tanaka, FFT homogenization), multiscale (RVE → effective tensor), ICME (Integrated Computational Materials Engineering — link composition→process→microstructure→property), uncertainty quantification on allowables (A-basis = 99%/95% confidence, B-basis = 90%/95% — **this is what MMPDS computes**).

**The hard engineering judgment (the part textbooks omit):**
- **An allowable is not a property.** Design to **A/B-basis** allowables (statistical, from MMPDS/CMH-17), *not* the mean tensile strength. A senior engineer never sizes to typical UTS.
- **Anisotropy is a manufacturing fingerprint.** Rolling direction, fibre layup, AM build orientation all create direction-dependent strength. The material card must encode the *as-built* orientation, and the FEA mesh must be aligned to it. Isotropic-only is a *defect*, not a simplification.
- **Property is temperature- and rate-dependent.** σ_y(T), E(T), k(T), creep at >0.4·Tm (homologous). A part fine at 20 °C can fail at 300 °C from creep alone.
- **Galvanic and environmental compatibility** gate the material pair, not just the part. Carbon-fibre + aluminium fastener = galvanic corrosion. Stainless in chloride = pitting/SCC.
- **Cost/availability/lead-time** are first-class constraints — Ti-6Al-4V is "better" until the schedule and budget say 17-4PH.

**Standards (citable answer keys):** ASM Handbook Vols 1–2 (properties); **MMPDS-2024** (aerospace metallic design allowables, A/B-basis); **CMH-17** (composites); ASME BPVC Sec II (materials); **ISO 6892-1** (metal tensile); **ASTM E8/E8M** (tensile), **E18** (Rockwell), **E384** (microhardness), **D638/D790** (polymer tensile/flexural); MIL-HDBK-5J / MIL-HDBK-17 (legacy, → MMPDS/CMH-17); ESDU data sheets.

### 1.2 Metallurgy

**BSc core.** **Fe–C diagram** (ferrite α, austenite γ, cementite Fe₃C, pearlite, **eutectoid 0.76 %C / 727 °C**, eutectic 4.3 %C / 1147 °C, peritectic), phase nomenclature & the lever rule applied to steels (computing %pearlite/%proeutectoid-ferrite at a given carbon), non-ferrous systems (Al-Cu age-hardening, Ti α/β, Ni superalloy γ′, Cu, Mg).

**MSc core.** Diffusional vs diffusionless (martensitic, shear-dominated, athermal) transformations; **TTT** (isothermal) & **CCT** (continuous-cooling) diagrams and *how to read a cooling curve across them*; **hardenability** (Jominy end-quench HRC-vs-distance, Grossmann ideal critical diameter D_I, the multiplying-factor method); heat-treat operations and *what each is for* (full anneal = soften+refine, normalize = refine+homogenize, **quench+temper** = hardness+toughness trade, austemper = bainite/no-quench-crack, martemper, **solution+age** for precipitation alloys, surface: carburize/nitride/carbonitride/induction); grain growth (`D^n−D₀^n=k·t`), recrystallization, segregation/coring, inclusion control.

**PhD / research edge.** Phase-field & **Kirkaldy/Li-type rate** models for CCT prediction; **Scheil–Gulliver** non-equilibrium solidification; **JMAK/Avrami** kinetics `X=1−exp(−k·tⁿ)`; **Hollomon–Jaffe** tempering parameter `HJP=T·(C+log t)`; weld-metallurgy HAZ modelling (Rosenthal/Goldak thermal cycle → **t8/5** cooling time → HAZ hardness via CE).

**The hard engineering judgment:**
- **Hardenability ≠ hardness.** A thick section of a low-hardenability steel will be soft in the core no matter the quench — section size *gates the steel choice* (D_I vs ruling section).
- **Quench severity is a design variable, not free.** Aggressive quench → distortion + quench cracking; the part geometry (sharp corners, section transitions) drives crack risk. Heat-treat is a *DFM constraint*.
- **Weldability is a carbon-equivalent decision, made before the joint is drawn.** High CE → mandatory preheat + controlled t8/5 + PWHT, or hydrogen/cold cracking. The metallurgist sets preheat from CE *and section thickness*, then the welder follows the WPS.
- **Tempering trades hardness for toughness on a known curve** — and temper embrittlement (350–550 °C for some steels) is a *forbidden zone*.
- **Microstructure is location-dependent.** Surface (case) vs core, weld vs HAZ vs base metal — a single part has a *field* of properties, not one number.

**Standards:** IIW carbon equivalent `CE_IIW = C + Mn/6 + (Cr+Mo+V)/5 + (Ni+Cu)/15`; Pcm (Ito-Bessyo) crack-susceptibility for low-C steels; **ASTM A255** (Jominy + calculating hardenability); **AWS D1.1** Annex (preheat tables, CE); **API 5L/6A** (line pipe / wellhead); **EN 10025** (structural steel); ASTM A370 (mechanical testing of steel products); SAE J406/J1268 (hardenability).

### 1.3 Polymer Science

**BSc core.** Chain architecture (linear/branched/cross-linked/network); thermoplastic vs thermoset vs elastomer; molecular weight distribution (Mn number-avg, Mw weight-avg, **PDI=Mw/Mn**); **Tg** (glass transition) & **Tm** (melt, semi-crystalline only); crystallinity, spherulites, nucleation; amorphous vs semi-crystalline mechanical/optical/barrier consequences.

**MSc core.** **Viscoelasticity** — creep `ε(t)=σ·J(t)`, stress relaxation `σ(t)=ε·E(t)`, **Boltzmann superposition**, mechanical analogs (Maxwell, Kelvin–Voigt, **generalized Maxwell / Prony series** `E(t)=E_∞+ΣE_i·exp(−t/τ_i)`); **time–temperature superposition** & **WLF** `log a_T=−C₁(T−T_ref)/(C₂+T−T_ref)` (universal C₁≈17.4, C₂≈51.6 K at Tg) → master curve; rheology (Newtonian vs **shear-thinning** pseudoplastic, **Cross / Cross-WLF** model, melt flow index, power-law); processing-relevant thermophysics (specific heat, melt/mold temperature windows).

**PhD / research edge.** **Cross-WLF 7-parameter** melt-viscosity model `η=η₀/(1+(η₀γ̇/τ*)^(1−n))` with `η₀=D₁·exp(−A₁(T−T*)/(A₂+(T−T*)))`; **2-domain Tait PVT** equation (specific volume vs T,P → shrinkage); **Folgar–Tucker** fibre-orientation evolution (Jeffery + isotropic rotary diffusion) → orientation tensor `a_ij` → anisotropic warpage; crystallization kinetics (non-isothermal Avrami / Nakamura) driving cooling/warp; hydrolytic/photo-oxidative degradation kinetics.

**The hard engineering judgment:**
- **Polymers creep — always.** A snap-fit or bolted polymer joint loses preload over months (stress relaxation). Design to the *isochronous* (time-temperature-specific) modulus, never the short-term tensile modulus.
- **Shrinkage is anisotropic and the nominal CAD must compensate.** Tait PVT gives volumetric shrinkage (typically 0.5–2.5 %), and fibre orientation makes it directional — the mold cavity (and thus the *solid model*) is scaled up by the shrink factor. **This directly moves the geometry Archie emits.**
- **Tg sets the service ceiling, not Tm.** Above Tg the modulus drops 2–3 decades. An amorphous part used near Tg is creeping continuously.
- **Glass-fibre fill helps stiffness/HDT and *hurts* anisotropy, weld-line strength, and warp.** It is a trade, not a free upgrade.
- **The processing window is narrow and coupled.** Too-cold melt = short shot / high stress; too-hot = degradation/burn; the Cross-WLF + Tait coefficients per grade *are* the window.

**Standards:** **ISO 11403** (acquisition of multipoint data, incl. Cross-WLF/PVT for sim); **ISO 294** (injection molding of test specimens); **ASTM D638** (tensile), **D790** (flexural), **D648** (HDT), **D3418** (Tg/Tm by DSC), **D4440** (melt rheology); UL 94 (flammability); ISO 75 (HDT).

---

## 2. DATA SOURCES (premium / authoritative only)

> IP hygiene: **embed equations + known-answer datapoints + clause references** from gated handbooks (cite, don't scrape). **Ingest** only open/CC0/licensed-for-use corpora, streaming download→process→delete. The synthetic engine (§3) is the bulk; these sources are the *answer-key ground truth* the generators are seeded from and validated against.

### 2.1 Textbooks (graduate canon — equation/known-answer extraction only)
- **Callister & Rethwisch — *Materials Science and Engineering: An Introduction*** (the BSc backbone; phase diagrams, defects, strengthening).
- **Courtney — *Mechanical Behavior of Materials*** (constitutive, dislocation, fracture).
- **Ashby — *Materials Selection in Mechanical Design*** + **CES/Granta methodology** (the *selection-reasoning* canon — material-property charts, performance indices `M=σ_f^{2/3}/ρ` etc.). The single best source for the "select a material for X" judgment.
- **Reed-Hill / Abbaschian — *Physical Metallurgy Principles*** and **Krauss — *Steels: Processing, Structure, and Performance*** (Fe–C, TTT/CCT, heat-treat, hardenability).
- **Porter, Easterling & Sherif — *Phase Transformations in Metals and Alloys*** (the PhD transformation-kinetics reference).
- **Ferry — *Viscoelastic Properties of Polymers*** + **Ward & Sweeney — *Mechanical Properties of Solid Polymers*** (WLF, Prony, TTS).
- **Osswald & Menges — *Materials Science of Polymers for Engineers*** and **Tadmor & Gogos — *Principles of Polymer Processing*** (Cross-WLF, Tait, rheology, processing windows).
- **Jones & Soutis — *Mechanics of Composite Materials*** (CLT, ABD, Tsai–Wu/Hashin).

### 2.2 Courses (open, citable, structured)
- **MIT OCW 3.012 Fundamentals of Materials Science**, **3.022 Microstructural Evolution**, **3.21 Kinetic Processes**, **3.40J/22.71J Physical Metallurgy**, **3.91 Mechanical Behavior of Polymers** — full lecture-note + problem-set structure ideal for Q/A seeding.
- **MIT OCW 16.20 Structural Mechanics** + **3.054 Cellular Solids** (Ashby/Gibson — for foams/lattices, ties to `forge.implicit` TPMS).
- **NPTEL** (IIT) materials/metallurgy/polymer series (large, openly-licensed lecture + worked-example corpus).
- **TMS / ASM online courseware** (heat-treat, failure analysis — for *judgment* framing).

### 2.3 Standards bodies (clause-reference answer keys)
ASTM International (E8/E18/E384/D638/D790/D648/D3418/A255/A370); ISO (6892/11403/294/75); **MMPDS** (Battelle, aerospace allowables); **CMH-17** (composites); ASME BPVC Sec II & IX; AWS D1.1; API 5L/6A; SAE J406/J1268; IIW recommendations; UL 94; EN 10025 / EN 1011.

### 2.4 Papers & datasets (open / licensed — for grounding + multimodal)
- **NIST Materials Data:** **MatML / NIST Material Measurement Lab** datasets, **NIST SRD** (alloy phase diagrams, thermophysical), **Citrination/Citrine** open datasets, **Materials Project** (DFT-computed properties, BSD-licensed API), **AFLOW / OQMD / NOMAD** (computational property repositories) — streamed, for property-recall grounding & UQ.
- **MatBench / Matminer** (benchmark ML datasets for property prediction — known-answer pairs).
- **CCT/TTT atlases** (ASM/Atlas of Continuous Cooling Transformation Diagrams — equation-fit extraction for `forge.metallurgy.cctPredict` seeding).
- **PoLyInfo (NIMS)** polymer property database; **NIST polymer Tg/PVT compilations**.
- **Open MMPDS-equivalent A/B-basis statistical method papers** (for the allowables-computation generator).
- Failure-analysis case literature (*Engineering Failure Analysis* journal, ASM Handbook Vol 11 *Failure Analysis and Prevention*) — for the **design→critique** sub-corpus (real failure modes: SCC, hydrogen embrittlement, fatigue, creep-rupture, temper embrittlement).

---

## 3. SYNTHETIC-DATA GENERATION PLAN

> New generator: **`bulk_synth_materials.py`** (mirrors `bulk_synth_physics.py`/`bulk_synth_mfg.py`: deterministic-given-`--seed`, in-memory hash dedup on user-text, hard `--cap`, single JSONL `{messages:[system,user,assistant], meta}`). Every assistant turn **terminates in one or more `forge.material.*` / `forge.metallurgy.*` / `forge.polymer.*` tool-calls** (plus the downstream `forge.fea.*`/`forge.mfg.*` call the material card feeds), so the sample is kernel-replayable and **grounded** — where geometric (shrink-scaled solid, laminate ABD → FEA), the kernel verifies; where property (lookup, CE, HJP), the embedded known-answer is the check. System prompt = the standard Archie CAE/CUA system string used fleet-wide (so the chat template matches inference).

### 3.1 The five generator families (with per-run unique-sample budgets)

| Generator | What it produces | Tool-call target | Grounding check | Budget (unique/run) |
|---|---|---|---|---|
| **G1 `gen_property_lookup`** | Property-recall Q/A across **500+ alloys/polymers/composites/ceramics**: E, ν, G, ρ, α(T), k(T), cₚ(T), σ_y(T), σ_u, S-N/ε-N, K_IC, Tg/Tm, Cross-WLF/Tait. Unit-correct (E in GPa, α in µε/°C, σ in MPa). | `forge.material.lookup(matId)` → full `MaterialCard` | Cross-check vs NIST/Materials-Project/PoLyInfo embedded values; unit-dimension audit | **~600k** |
| **G2 `gen_selection_reasoning`** | "Select a material for [duty/temp/corrosion/weight/cost]" → **Ashby performance-index** ranking → chosen grade + *why the runners-up lose* (galvanic, Tg ceiling, hardenability vs section, allowable basis). Design→critique pairs. | `forge.material.lookup` + `forge.material.selectByIndex(index, constraints)` then assign to body | Index math verified (Pillar-A); constraint-satisfaction logged | **~400k** |
| **G3 `gen_anisotropy_laminate`** | Build the **6×6 stiffness tensor** for a symmetry class; construct a **laminate stacking sequence** → ABD matrix → ply-by-ply Tsai-Wu/Hashin margin; orient the tensor to a build/roll/layup direction and feed FEA. | `forge.material.classicalLaminate(plies)`, `forge.material.ruleOfMixtures`, `forge.material.halpinTsai` → `forge.fea.staticLinear(...,materialCard)` | **Kernel-verifiable:** ABD is deterministic; replay laminate → FEA, compare stress recovery | **~350k** |
| **G4 `gen_heattreat_weld`** | Steel + section + target hardness/toughness → **heat-treat schedule** (austenitize/quench/temper via Jominy + Hollomon–Jaffe); composition → **CE/Pcm → preheat + t8/5 + PWHT**; CCT cooling-rate → phase fractions; quench-crack/distortion risk from geometry. | `forge.metallurgy.jominy`, `forge.metallurgy.cctPredict`, `forge.metallurgy.carbonEquivalent`, `forge.metallurgy.tempering` → couples `forge.weld.thermalCycle` | CE/HJP/Avrami closed-form check; HAZ-hardness vs t8/5 monotonic sanity; couples to verified `WeldHeatInput.cpp` | **~400k** |
| **G5 `gen_polymer_process`** | Resin selection by Tg/chem-resistance/cost; **Cross-WLF/Tait coefficient recall** per grade; **creep/relaxation** prediction (Prony + WLF master curve); **anisotropic shrinkage → shrink-scale the solid model**; processing-window (melt/mold T, hold P); filler→anisotropy/warp trade. | `forge.polymer.crossWLF`, `forge.polymer.tait`, `forge.polymer.viscoelastic`, `forge.polymer.folgarTucker`, `forge.polymer.wlfShift` → `forge.mfg.injection` / `forge.transform.scale(shrinkFactor)` | **Kernel-verifiable:** Tait shrink-scale is a geometric op (volume/bbox check); viscoelastic Prony → FEA relaxation replay; WLF shift least-squares verified | **~450k** |

**Cross-cutting sample shapes (apply across G1–G5):**
- **Q/A** (recall + derivation) — answer key = embedded standard value + the equation worked.
- **Problem→solution** (numeric, fully worked, unit-checked) — e.g. compute D_I from composition; compute master-curve shift; compute laminate margin.
- **Design→critique** — present a material/heat-treat/resin choice with a *latent defect* (Tg below service temp, CE too high with no preheat, isotropic card on a UD laminate, no shrink compensation, A-basis ignored), Archie detects + fixes + re-validates (mirrors the eAGI **error-detection + in-filling** primitive).
- **Tool-call (Forge verb)** — the assistant *operates the CAD*: assigns the card, shrink-scales the cavity, sets the FEA orientation, requests the heat-treat sim, and reads back the verdict.
- **Outcome-of-decision pairs** (Pillar-D feed) — the owned-kernel sweep: `swap Al-6061→Ti-6Al-4V → Δmass/Δstiffness/Δcost/Δthermal/Δfatigue`; `anneal→Q&T → Δhardness/Δtoughness/Δcost/Δdistortion`; `unfilled→30%GF → Δstiffness/Δshrink-anisotropy/Δweld-line-strength`. Deterministic, offline, free — the P-1/Prometheus differentiator done with an owned kernel.

### 3.2 Grounding discipline (how we keep it honest)
1. **Geometric samples are kernel-replayed** (laminate→FEA, Tait shrink-scale, Prony relaxation) — scored by the existing Forge-replay harness; a wrong number fails the replay.
2. **Property samples carry an embedded known-answer** from a named standard/dataset (NIST, Materials Project, ASTM clause) — the generator asserts agreement at author time; mismatches are dropped, not shipped.
3. **Honesty injection** (inherited memory rule): where a property is *not* in the validated DB or a model is out-of-range (e.g. Cross-WLF outside its fitted T-window, CCT for an un-modelled alloy), the sample teaches Archie to **surface the limit** ("this grade lacks validated PVT data; request a measured card") — never fabricate a coefficient.
4. **Coherence/critic gate** (`coherence_gate.py`, `critic_synth.py`) before training; **DPO pairs** (`dpo_synth.py`) rank the standards-grounded answer over the plausible-but-wrong one (Tg-ignored, mean-UTS-instead-of-A-basis, isotropic-on-anisotropic).

### 3.3 How this makes Archie better *inside Forge*
Without this cluster, Archie emits geometry with a placeholder material → FEA runs on a default isotropic steel → the design *looks* analyzed but is physically wrong, and unmanufacturable (impossible heat-treat, no shrink compensation, weld with no preheat). With it, **every body Archie drives carries a correct, consistent, standards-grounded material identity**, and Archie *operates* the material engine (assign card → orient tensor → shrink-scale cavity → request heat-treat/weld sim → read verdict → adjust) exactly as a senior engineer does at the CAD station. That consistency lifts the CADGenBench **shape** axis (shrink-compensated dims) and **interface** axis (CTE-correct fits at temperature), and makes the eAGI outcome-pairs *grounded in owned-kernel truth*.

---

## 4. EXAMPLE TRAINING SAMPLES (depth showcase)

> Format: `{messages:[system,user,assistant], meta}`. System string elided to the fleet-standard Archie CAE/CUA prompt. Assistant ends in replayable tool-call(s).

### Sample 1 — Heat-treat + weldability judgment (G4, design→critique→tool-call)

**user:** "I'm making a 50 mm-thick lifting lug from AISI 4140, quench-and-tempered to 30 HRC, then welding it to an S355 plate. The drawing has no preheat note. Is this OK? Set it up in Forge."

**assistant (ideal):**
"Two problems before any geometry is right.

**1. Hardenability vs section.** 4140 has good hardenability (D_I ≈ 100 mm range with this Cr-Mo), so a 50 mm section *can* through-harden to ~30 HRC on oil quench — that part is fine. But the *as-quenched* surface will be near 55 HRC martensite; you must temper to hit 30 HRC. Using Hollomon–Jaffe `HJP=T(C+log t)` with C≈20: for 4140 to ~30 HRC you need HJP ≈ 16.0×10³, e.g. **595 °C / 2 h** (T in K: 868 K × (20 + log 2) = 868×20.3 ≈ 17.6×10³ → adjust to ~575 °C). Keep the temper *out of* the 350–550 °C tempered-martensite-embrittlement band for 4140 — temper above 550 °C.

**2. Weldability — the real blocker.** 4140 is a high-CE steel. `CE_IIW = C + Mn/6 + (Cr+Mo+V)/5 + (Ni+Cu)/15 = 0.40 + 0.85/6 + (0.95+0.20)/5 + 0 ≈ 0.40+0.142+0.23 = 0.77`. CE = 0.77 is **very high** — mandatory **preheat ≈ 250–300 °C**, low-hydrogen consumables, controlled t8/5, and **PWHT** to avoid hydrogen (cold) cracking in the HAZ. Welding Q&T 4140 also over-tempers/softens the HAZ — for a *lifting* lug this is safety-critical. **Recommendation:** either (a) weld in the annealed/normalized condition then heat-treat the assembly, or (b) switch the lug to a weldable grade (e.g. S355J2 or a low-CE micro-alloyed steel) if the strength allows. The drawing's missing preheat note would have produced HAZ cracking.

Setting up the validated path in Forge:"
```
forge.metallurgy.carbonEquivalent(comp={C:0.40,Mn:0.85,Cr:0.95,Mo:0.20,Ni:0,Cu:0,V:0}, method:"IIW")
forge.metallurgy.tempering(steel:"AISI4140", targetHRC:30, C:20)            // → schedule, embrittlement-band guard
forge.metallurgy.jominy(steel:"AISI4140", section_mm:50, quench:"oil")       // confirm through-hardening
forge.weld.thermalCycle(base:"AISI4140", filler:"low-H", thickness_mm:50, preheat_C:275, CE:0.77)  // → t8/5, HAZ hardness map
forge.material.lookup("AISI4140_QT30HRC")                                    // assign validated card to the lug body
```
**meta:** `{cluster:"metallurgy", gen:"gen_heattreat_weld", level:"L4_analyze", standards:["IIW_CE","AWS_D1.1_preheat","HollomonJaffe"], grounded:"CE+HJP closed-form + WeldHeatInput.cpp replay"}`

### Sample 2 — Polymer shrinkage moves the geometry (G5, problem→solution→geometric tool-call)

**user:** "Glass-filled (30% GF) PA66 housing, nominal cavity dim 120.00 mm across the flow direction. What's the molded part size, and fix the model."

**assistant (ideal):**
"You must scale the *cavity* up so the *part* lands on nominal — and for a fibre-filled grade the shrink is **anisotropic**, so the flow and cross-flow directions differ.

30% GF PA66 typical mold shrinkage (from the grade's Tait PVT + measured data, ISO 11403): **flow ≈ 0.3–0.5 %, cross-flow ≈ 1.0–1.4 %** (fibres align with flow and *restrain* shrink along their axis, so cross-flow shrinks more). The 120.00 mm dimension is *across* flow → use cross-flow ≈ 1.2 %.

Cavity dimension = nominal / (1 − S) = 120.00 / (1 − 0.012) = **121.46 mm**. (Unfilled PA66 would shrink ~1.8–2.0 % isotropically → 122.4 mm — the fibres cut shrink but make it directional, which also drives **warp** if the part isn't symmetric.)

Caveat (honesty): the exact shrink is grade- and process-dependent (hold pressure, melt/mold T, wall thickness). I'm using the validated 30%GF-PA66 Tait card; if you have the supplier's measured S_flow/S_cross, load it and I'll re-scale. Applying the anisotropic shrink-compensation to the cavity solid:"
```
forge.polymer.tait(grade:"PA66-GF30", T_melt_C:290, T_mold_C:80, P_hold_MPa:60)   // → volumetric shrink, S_iso
forge.polymer.folgarTucker(grade:"PA66-GF30", flowField:"<gate-fill>")             // → orientation tensor a_ij → S_flow, S_cross
forge.transform.scaleAnisotropic(body:"housing_cavity", S_flow:0.004, S_cross:0.012, axis_flow:"+X")  // cavity = nominal/(1−S)
forge.material.lookup("PA66-GF30")                                                 // anisotropic stiffness card → warp FEA
forge.fea.warpage(body:"housing", materialCard:"PA66-GF30", orientation:"a_ij")    // verify warp within tol
```
**meta:** `{cluster:"polymer", gen:"gen_polymer_process", level:"L5_create", standards:["ISO_11403","ISO_294","Tait","FolgarTucker"], grounded:"Tait+FT → scaleAnisotropic is a geometric op; bbox/volume kernel-checked"}`

### Sample 3 — Composite laminate design + anisotropy-to-FEA (G3, problem→solution, kernel-verifiable)

**user:** "Design a quasi-isotropic CFRP laminate for a 2 mm panel in T300/epoxy and tell me the ABD and whether a 200 MPa in-plane tension passes. Wire it into the static solve."

**assistant (ideal):**
"Quasi-isotropic needs equal stiffness in all in-plane directions → a balanced, symmetric `[0/+45/−45/90]ₛ` stack. With 8 plies at 0.25 mm each = 2.0 mm. 

Lamina props (T300/epoxy, CMH-17 typical): E₁≈135 GPa, E₂≈10 GPa, G₁₂≈5 GPa, ν₁₂≈0.30, ply 0.25 mm. Build each ply's `Q̄(θ)` by rotation, integrate through thickness for `[A,B,D]`:
- **B = 0** (symmetric → no extension-bending coupling — required, else the panel warps under load).
- **A** is isotropic-in-plane by construction → effective laminate `E_x = E_y ≈ 52 GPa`, `ν_xy ≈ 0.31` (the quasi-isotropic result).
- Membrane strain under N_x = 200 MPa × 2 mm = 400 N/mm: `ε_x = N_x/A₁₁`.

**Failure check (ply-by-ply, Tsai–Wu):** rotate the laminate strain into each ply's material axes, recover ply stresses, evaluate Tsai-Wu `F₁σ₁+F₂σ₂+F₁₁σ₁²+F₂₂σ₂²+F₆₆τ₁₂²+2F₁₂σ₁σ₂ ≤ 1`. The **0° plies** carry σ₁ along the load and govern; the **90° plies** see transverse σ₂ (matrix-dominated, weak — first-ply-failure usually here). At 200 MPa in-plane, first-ply-failure margin is positive (FPF index ≈ 0.6 in the 90° plies) → **passes** with margin, but watch the matrix-cracking onset if the load rises.

Building and solving in Forge (the laminate card is deterministic → kernel-replayable):"
```
forge.material.classicalLaminate(plies:[
  {mat:"T300_epoxy", t:0.25, theta:0},  {mat:"T300_epoxy", t:0.25, theta:45},
  {mat:"T300_epoxy", t:0.25, theta:-45},{mat:"T300_epoxy", t:0.25, theta:90},
  {mat:"T300_epoxy", t:0.25, theta:90}, {mat:"T300_epoxy", t:0.25, theta:-45},
  {mat:"T300_epoxy", t:0.25, theta:45}, {mat:"T300_epoxy", t:0.25, theta:0}],
  failure:"TsaiWu")                          // → ABD, B≈0, E_eff, ply margins
forge.fea.staticLinear(body:"panel", materialCard:"<laminate>", load:{Nx_MPa:200}, recover:"plyByPly")
```
**meta:** `{cluster:"materials", gen:"gen_anisotropy_laminate", level:"L5_create", standards:["CMH-17","CLT","TsaiWu"], grounded:"ABD deterministic; classicalLaminate→staticLinear replay-scored"}`

---

## 5. CURRICULUM PLACEMENT, TRAINING & ACCEPTANCE

| Item | Value |
|---|---|
| **Adapter** | `arch14b-materials` (LoRA on the S1-geometry adapter), trained **between S1 Geometry and S2 Physics** — physics scoring requires valid material cards to exist first. |
| **Corpus mix** | G1 600k · G2 400k · G3 350k · G4 400k · G5 450k = **~2.2M raw → ~1.6–1.8M unique after dedup** (target). |
| **Training** | `mlx_lm.lora` 4-bit qLoRA, sequence-budgeted; **no `--mask-prompt`** (long worked-solution samples → NaN risk); NaN-guard + early-loss verify; process→train→delete; serve XOR train. |
| **Acceptance gate (before promotion)** | (1) Property-recall ≥0.90 vs held-out NIST/Materials-Project/ASTM known-answers, unit-correct. (2) Geometric samples (laminate→FEA, Tait shrink-scale, Prony relaxation) **Forge-replay** consistent ≥0.90. (3) CE/HJP/Avrami/WLF closed-form checks pass. (4) **Honesty held** — out-of-DB / out-of-range prompts surface the limit, never fabricate a coefficient. (5) Design→critique catches the seeded latent defect (Tg-below-service, CE-no-preheat, isotropic-on-anisotropic, no-shrink-comp, mean-UTS-not-A-basis). (6) No NaN; coherence/critic gate green. |
| **Eval seam** | `gauntlet_staged.py` material probes (tagged L1–L5) + `ForgeCADScore` for the geometric subset + DPO (`dpo_synth.py`) ranking standards-grounded over plausible-wrong. |

---

## 6. SUMMARY (for the program ledger)

1. Cluster = **Material Science + Metallurgy + Polymer Science**; it is the **property feed under Cluster-2 (CAE)** and the **makeability gate under Cluster-3 (Manufacturing)** — a beautiful B-rep with an impossible material spec is *wrong*, and this cluster closes that.
2. Knowledge spans **BSc→MSc→PhD→industry**: crystal/defect/diffusion/phase-diagram → tensor/CLT/allowables → ICME/micromechanics/UQ; Fe–C→TTT/CCT/hardenability→Kirkaldy/Scheil/HJP; chain/Tg/Tm→viscoelastic/WLF/Prony→Cross-WLF/Tait/Folgar-Tucker — **with the senior-engineer judgment** (allowable≠property, anisotropy=manufacturing-fingerprint, hardenability≠hardness, weldability=CE-decision, polymers-always-creep, shrinkage-moves-the-CAD).
3. **Sources** = Callister/Ashby/Krauss/Ferry/Osswald/Jones-Soutis + MIT-OCW(3.012/3.022/3.21/3.40J)/NPTEL + ASTM/ISO/MMPDS/CMH-17/AWS-D1.1/IIW + NIST/Materials-Project/PoLyInfo/MatBench/CCT-atlases (embed equations + known-answers from gated handbooks; ingest only open/CC0, streamed download→process→delete).
4. **Synth** = new `bulk_synth_materials.py`, five generators (G1 property-lookup, G2 selection-reasoning, G3 anisotropy-laminate, G4 heat-treat-weld, G5 polymer-process), every sample ending in a replayable `forge.{material,metallurgy,polymer}.*` (+ downstream `forge.fea/mfg`) tool-call; geometric samples kernel-verified, property samples known-answer-checked, honesty-injected, DPO-ranked. **~1.6–1.8M unique samples (target corpus scale).**
5. **This makes Archie operate Forge like a senior engineer**: assign the right card → orient the tensor → shrink-scale the cavity → request heat-treat/weld/warp sim → read the verdict → adjust — not chat about materials, but *drive the CAD with correct, manufacturable material identity*, lifting CADGenBench shape (shrink-compensated dims) + interface (CTE-correct fits) and grounding the eAGI outcome-of-decision pairs in owned-kernel truth.

---

*Authored 2026-06-24 for SCOPE_2026-06-24 / training. Grounded in `research/fields_direct.md §1–3` and verified kernel modules (Casting/Mold/MoldFlow/Weld*/Fatigue/Hertz/Bearing). Storage-safe streaming + programmatic bulk_synth discipline are load-bearing — read the corpus-program §0 hygiene rules before any data pull.*
