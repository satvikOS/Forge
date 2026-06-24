# Research-Grade SOURCE TAXONOMY — MANUFACTURING · DFM · DFA/DFMA · CNC/CAM · GD&T · Tolerancing · Process Planning

**Scope owner:** SCOPE_2026-06-24 / training
**Date:** 2026-06-24
**Cluster:** Manufacturing-process engineering field cluster (Pillar C).
**Corpus module:** `archdisc-Models/scripts/bulk_synth_mfg.py` → Stage **S3 `arch14b-mfg`**.
**Companion docs:** the engine spec `SCOPE_2026-06-21/research/manufacturing.md` (what the kernel computes) and the curriculum companion `SCOPE_2026-06-24/training/manufacturing.md` (knowledge ladder + generator program). **This doc is the SOURCE/PROVENANCE layer**: *which* named institutions, courses, authoritative texts, reference standards, and key literature ground each sub-field — and the **named published known-answer values** every generated sample must reproduce.

> **Provenance thesis.** A research-grade corpus is not "rules a model memorized"; it is *traceable to a named authority and validated against a published number*. Every numeric answer in `bulk_synth_mfg.py` must be reconstructible from a cited standard or canonical text, and the load-bearing constants (0.707 throat, IT-grade tolerances, Chvorinov modulus, Boothroyd 3 s ideal handle, AWS D1.1 min-leg table, ISO 286 fundamental deviations) are *asserted in-generator* against their published values so a drift bug fails the build, not the model.

---

## 0. SUB-FIELDS COVERED (the cluster's partition)

| # | Sub-field | Generator(s) | Governing authority anchor |
|---|---|---|---|
| 1 | **DFM** — design-for-manufacturing, feature/process rules, tolerance↔cost | `g_cnc`, `g_dfm_econ` | Bralla; Boothroyd–Dewhurst–Knight; ISO 2768 / ISO 286 |
| 2 | **DFA / DFMA** — Boothroyd–Dewhurst method, part consolidation, snap-fits | `g_dfma` | Boothroyd, Dewhurst & Knight, *Product Design for Manufacture and Assembly* |
| 3 | **CNC / CAM** — feeds/speeds, MRR, spindle power, Kienzle force | `g_cnc`, `g_capp` | *Machinery's Handbook*; Kalpakjian; Stephenson & Agapiou; Kienzle (1952) |
| 4 | **GD&T** — ASME Y14.5 14 characteristics, DRF 3-2-1, MMC bonus, true position | `g_mbd` | **ASME Y14.5-2018**; ISO 1101 / 5458 / 2692 |
| 5 | **Tolerancing & fits** — ISO 286 limits/fits, IT grades, stack-up (WC/RSS/MC), Cp/Cpk | `g_tolerance`, `g_mbd` | **ISO 286-1/-2**; ASME B4.1/B4.2; AIAG SPC |
| 6 | **Process planning (CAPP)** — op sequencing, setup/TAD, cycle time, cost | `g_capp` | Groover; *Machinery's Handbook*; CAPP literature (Halevi, Chang) |
| 7 | **Casting** — Chvorinov, modulus/riser, Niyama, shrink, draft | `g_casting` | Campbell, *Castings*; Chvorinov (1940); Niyama (1982) |
| 8 | **Injection molding** — wall/rib/boss/draft, Cross-WLF, Tait PVT, weld-line | `g_injection` | Osswald & Menges; Autodesk/Moldex3D validation; ISO 294 |
| 9 | **Sheet metal** — K-factor, bend allowance, min radius, relief | `g_sheetmetal` | *Machinery's Handbook*; SME *Die Design Handbook*; ASM Handbook V14B |
| 10 | **Welding & joining** — fillet throat, AWS D1.1 min-leg, distortion, capacity | `g_welding` | **AWS D1.1**; AWS A2.4; Blodgett, *Design of Weldments* |
| 11 | **Forging** — draft, radii, rib/web, near-net stock | `g_forging` | ASM Handbook V14A; Altan, *Cold and Hot Forging* |
| 12 | **DfAM / additive** — overhang, min wall, anisotropy, Gibson-Ashby lattice | `g_additive`, `g_topopt` | ISO/ASTM 52911; Gibson & Ashby, *Cellular Solids* |
| 13 | **Topology / generative** — SIMP, BESO, level-set, TPMS gyroid, compliance | `g_topopt` | Bendsøe & Sigmund, *Topology Optimization*; Sigmund 99-line |
| 14 | **PLM / process integration** — BOM rollup, ECO, where-used, make/buy | `g_plm`, `g_autoprocess` | ISO 10303 (STEP); industry PLM practice |

---

## 1. NAMED INSTITUTIONS & COURSES (the curriculum spine)

The framing/derivation rigor of each generator is modeled on these graduate-and-undergraduate courses (notes/syllabi, not verbatim text):

| Institution | Course / program | What it grounds |
|---|---|---|
| **MIT** | **2.810 Manufacturing Processes & Systems** (Hardt); 2.008 Design & Manufacturing II; 2.875 Mechanical Assembly | Process-physics models (cutting, casting, injection, forming), variation/Cp-Cpk, assembly. The L2/L3 framing for `g_cnc`, `g_casting`, `g_injection`, `g_capp`. |
| **MIT** | **2.71/2.72**, 2.51 Metrology; *Quality control* lectures | tolerance-stack statistics, GD&T, measurement-system framing for `g_mbd`, `g_tolerance`. |
| **Penn State** | IE 322/327 Manufacturing Processes; IE 425/450 CAPP & automation; GD&T short courses (Applied GD&T) | CAPP op-sequencing, feature-based planning, GD&T application → `g_capp`, `g_mbd`. |
| **Georgia Tech (GTIE/ME)** | ME 4210 Manufacturing Processes; ISYE 3025; computational-manufacturing & DfAM labs | feeds/speeds, DfAM, topology — `g_cnc`, `g_additive`, `g_topopt`. |
| **University of Rhode Island** | Boothroyd & Dewhurst DFMA origin program | the canonical DFMA method → `g_dfma`. |
| **Cambridge / Imperial** | Engineering Tripos manufacturing; Gibson-Ashby cellular-solids lineage | lattice mechanics, casting (Campbell at Birmingham) → `g_additive`, `g_casting`. |
| **DTU (Denmark)** | TopOpt group (Bendsøe/Sigmund) — 99-line / 88-line SIMP | SIMP/level-set/BESO answer keys → `g_topopt`. |
| **Ohio State (ERC/NSM, Altan)** | net-shape & forging research center | forging fill, near-net → `g_forging`. |
| **NIST** | Engineering Lab — *Smart Manufacturing*, model-based GD&T, QIF | semantic PMI/MBD validity, measurement traceability → `g_mbd` provenance. |
| **SME** (Society of Manufacturing Engineers) | *Tool and Manufacturing Engineers Handbook*; *Fundamentals of Tool Design* | shop-floor reference values across all process generators. |

---

## 2. AUTHORITATIVE TEXTS & REFERENCE STANDARDS (the answer keys)

### 2.1 Canonical texts (modeled-on; cited inline, never copied verbatim)

| Domain | Text |
|---|---|
| Manufacturing fundamentals | **Kalpakjian & Schmid**, *Manufacturing Engineering & Technology*; **Groover**, *Fundamentals of Modern Manufacturing*; DeGarmo, *Materials & Processes in Manufacturing* |
| DFM / DFMA | **Boothroyd, Dewhurst & Knight**, *Product Design for Manufacture and Assembly* (THE method); **Bralla**, *Design for Manufacturability Handbook*; Poli, *Design for Manufacturing* |
| CNC / machining | ***Machinery's Handbook*** (Industrial Press) — feeds/speeds, threads, fits, IT grades; Stephenson & Agapiou, *Metal Cutting Theory and Practice*; Smid, *CNC Programming Handbook* |
| GD&T / MBD | **ASME Y14.5-2018** (concepts); Krulikowski, *Fundamentals of GD&T*; Drake, *Dimensioning & Tolerancing Handbook*; Henzold, *GD&T for Design, Manufacturing and Inspection* |
| Casting | **Campbell**, *Castings*; ASM Handbook Vol 15 (Casting) |
| Injection molding | **Osswald, Turng & Gramann**, *Injection Molding Handbook*; Osswald & Menges, *Materials Science of Polymers for Engineers* |
| Sheet metal | SME *Die Design Handbook*; ASM Handbook Vol 14B (Metalworking: Sheet Forming) |
| Welding | **Blodgett**, *Design of Weldments* (Lincoln); AWS Welding Handbook |
| Forging | Altan, Ngaile & Shen, *Cold and Hot Forging*; ASM Handbook Vol 14A (Bulk Forming) |
| Lattices / AM | **Gibson & Ashby**, *Cellular Solids: Structure & Properties*; Gibson, Rosen & Stucker, *Additive Manufacturing Technologies* |
| Topology opt | **Bendsøe & Sigmund**, *Topology Optimization: Theory, Methods, and Applications* |

### 2.2 Reference standards (the bounding authority — cited by number)

| Standard | Scope used |
|---|---|
| **ASME Y14.5-2018** | GD&T: 14 characteristics, DRF 3-2-1, MMC/LMC bonus, true position Ø2·√(Δx²+Δy²) |
| **ISO 286-1 / 286-2** | limits & fits, IT grade tolerances, fundamental deviations (H7/g6 etc.) |
| **ISO 2768-1/-2** | general (title-block) tolerances -f/-m/-c |
| **ISO 1101 / 5458 / 2692** | geometrical tolerancing, position, maximum-material requirement |
| **AWS D1.1 / D1.2** | structural welding — Table 7.7 minimum fillet weld size by thickness |
| **AWS A2.4** | weld & NDE symbols |
| **ASME B4.1 / B4.2** | preferred limits & fits (inch) — cross-check to ISO 286 |
| **ISO/ASTM 52911 / 52900** | DfAM design + AM terminology |
| **ISO 294 / ASTM D955** | injection-molding test conditions, mold-shrinkage measurement |
| **AIAG SPC** | Cp/Cpk capability indices, 1.33 floor / 1.67 automotive |
| **ISO 10303-242 (STEP AP242) / ISO 23952 (QIF)** | semantic PMI / MBD machine-readability |

---

## 3. KEY RESEARCH LITERATURE (the frontier / L3 answer keys)

- **Chvorinov, N. (1940)** — solidification time t = B·(V/A)²; the casting modulus M = V/A. (`g_casting`)
- **Niyama, E. et al. (1982)** — shrinkage-porosity criterion Ny = G/√Ṙ; thresholds ~1.0 (steel) / ~0.7 (Al). (`g_casting`)
- **Kienzle, O. (1952)** — specific cutting force k_c1.1 with exponent m_c; F_c = k_c·b·h^(1−m_c). (`g_cnc`, `g_capp`)
- **Cross (1965) / Williams–Landel–Ferry (1955)** — Cross-WLF melt viscosity model. (`g_injection`)
- **Tait equation (Tait 1888; 2-domain modified Tait)** — polymer PVT, C = 0.0894 universal. (`g_injection`)
- **Folgar & Tucker (1984)** — fiber-orientation in molding (weld-line knockdown context). (`g_injection`)
- **Goldak, Chakravarti & Bibby (1984)** — double-ellipsoid weld heat source (CWM). (`g_welding`)
- **Gibson & Ashby** — cellular-solid scaling E/E_s = C·(ρ/ρ_s)^n, n≈2 bending-dominated. (`g_additive`, `g_topopt`)
- **Bendsøe & Kikuchi (1988); Sigmund (2001) "99-line"; Xie & Steven (BESO, 1993); Allaire/Wang (level-set, 2002/2003)** — topology-optimization families. (`g_topopt`)
- **Boothroyd & Dewhurst (1980s–)** — DFMA design-efficiency E = (3·N_min)/t_a; 3 s ideal handle+insert. (`g_dfma`)
- **NIST MBE/QIF program** — model-based definition validity, GD&T semantic interoperability. (`g_mbd`)

---

## 4. CURRICULUM LADDER — BSc → MS → PhD → INDUSTRY (per sub-field)

Each generator tags every sample with one of `{BSc, MSc, PhD, industrial}`. The ladder defines what "research-grade rigor at that level" means; the generator's reasoning chain deepens accordingly (BSc = closed-form recall+substitution; MSc = modeling depth + regime/assumption; PhD = derivation/sensitivity/frontier caveat; industrial = the hard judgment + cost/standard trace).

| Sub-field | BSc (recall + formula) | MS (modeling depth) | PhD / frontier | Industry judgment |
|---|---|---|---|---|
| **DFM** | tolerance↔cost curve; mill ±0.025 mm precision; corner = r_tool | medial-thickness & access-cone fields; deflection δ∝L³/EI | manufacturability as a field over geometry; auto-reroute (true 0-radius ⇒ EDM) | "standard tolerances are free; every tight callout earns its place" |
| **DFA/DFMA** | E=(3·N_min)/t_a; the 3 part-tests | handling/insertion codes; snap-fit σ=3Eδt/2L² | concurrent DFMA across BOM w/ tolerance-chain preservation | "the cheapest part is the one you deleted"; ≤3 fastener types |
| **CNC/CAM** | n=vc·1000/πD; vf=z·fz·n; MRR=ae·ap·vf | Kienzle k_c force, power P=MRR·k_c, chip thinning | tool-deflection FRF / chatter stability lobes | rough-then-rest-machine corners; reach-vs-rigidity trade |
| **GD&T** | 14 chars; TP=2√(Δx²+Δy²); flatness=2-plane zone | DRF 3-2-1 immobilization; MMC bonus = actual−MMC | semantic PMI completeness; datum-feature simulator | datums by function, largest face first; AP242 export |
| **Tolerancing** | IT grades; H7/g6 clearance; Cp=(USL−LSL)/6σ | WC vs RSS vs Monte-Carlo stacks; Cpk arms | non-normal/skewed process capability, drift | 1D loop that controls the functional gap; 1.33 floor |
| **CAPP** | feeds/speeds; cycle = V/MRR | TAD/setup grouping; precedence graph topo-sort | generative CAPP via learned feature recognition | minimize setups + tool changes; datum transfer loss |
| **Casting** | Chvorinov t=B(V/A)²; shrink % | modulus riser M_r≥1.2·M_s; Niyama field | coupled solidification + porosity prediction | riser at thermal center; thick:thin ≤3:1 |
| **Injection** | wall/rib/boss/draft rules | Cross-WLF η; Tait PVT pack profile | 3D vs Hele-Shaw fidelity; fiber orientation | weld-line to a hidden region; gate freeze after part |
| **Sheet metal** | min radius nT; BA=(π/180)θ(R+Kt) | K-factor neutral-axis shift; springback | forming-limit-diagram strain paths | one tooling radius; hole-to-bend 2.5t+R |
| **Welding** | throat=0.707·leg; AWS min leg | Goldak heat input; distortion balance | computational welding mechanics, residual stress | "heat in, distortion out"; size to load, don't over-weld |
| **Forging** | draft/radii/web rules | die-fill flow; near-net stock | flow-stress + microstructure modeling | single planar parting through max section |
| **DfAM** | overhang angle; min wall; Z-anisotropy | build-orientation opt; Gibson-Ashby lattice | inherent-strain distortion; support topology | reorient to kill support + worst-axis ∥ load |
| **Topology** | SIMP E=ρ^p·E0; compliance C=F·u | volume-fraction constraint; BESO evolution | level-set Hamilton-Jacobi; manufacturability constraints | interpret to a makeable, draftable shape |

---

## 5. KNOWN-ANSWER VALIDATION ANCHORS (the published numbers the samples MUST reproduce)

These are the named published reference values asserted inside `bulk_synth_mfg.py` (see `_assert_anchors()` self-test, run on import / at startup). A drift in any constant fails fast.

| Anchor | Published value | Source | Generator |
|---|---|---|---|
| **Fillet weld effective throat** | throat = 0.707·leg (10 mm leg → **7.07 mm**) | AWS D1.1; Blodgett | `g_welding` |
| **AWS D1.1 min fillet leg** | thicker member >19 mm (¾″) → **8 mm (5/16″)**; ≤6 mm → 3 mm (1/8″) | AWS D1.1 Table 7.7 | `g_welding` |
| **ISO 286 — 30 H7/g6** | hole [0, **+0.021**] mm, shaft [**−0.007**, −0.020] mm; clearance **0.007–0.041 mm** | ISO 286-2 (IT7=21 µm, IT6=13 µm, g-dev=−7 µm @ 18–30 mm) | `g_tolerance` |
| **ISO 286 IT grades @ 18–30 mm** | IT6 = **13 µm**, IT7 = **21 µm**, IT8 = 33 µm | ISO 286-1 | `g_tolerance` |
| **True position** | dx=dy=0.1 mm → Ø = 2·√(0.1²+0.1²) = **0.2828 mm** | ASME Y14.5-2018 | `g_mbd` |
| **MMC bonus** | actual 10.3, MMC 10.0 → bonus **0.3 mm** added to stated position | ASME Y14.5-2018 | `g_mbd` |
| **Chvorinov** | 100 mm cube: V/A = **16.667 mm**; t/B = (V/A)² = **277.8** | Chvorinov 1940 | `g_casting` |
| **Niyama** | Ny = G/√Ṙ; steel threshold ≈ **1.0**, Al ≈ 0.7 | Niyama 1982 | `g_casting` |
| **Bend allowance** | 90°, R=1, t=1, K=0.44 → BA = (π/180)·90·(1+0.44) = **2.262 mm** | *Machinery's Handbook* | `g_sheetmetal` |
| **Turning RPM** | vc=100 m/min, D=50 mm → n = vc·1000/(π·D) = **636.6 rpm** | Kalpakjian; *Machinery's Handbook* | `g_capp` |
| **DFMA efficiency** | N_min=10, t_a=120 s → E = 30/120 = **0.25 (25%)**; ideal 3 s/part | Boothroyd–Dewhurst | `g_dfma` |
| **Cp / Cpk** | 6σ process, centered → Cp = **2.0**; Cpk floor **1.33** (auto 1.67) | AIAG SPC | `g_tolerance` |
| **Gibson-Ashby** | open-cell foam, C=1, n=2, ρ/ρs=0.3 → E/Es = **0.09** | Gibson & Ashby | `g_additive` |
| **SIMP** | ρ=0.5, p=3 → E/E0 = 0.5³ = **0.125** (12.5% stiffness for 50% mass) | Bendsøe & Sigmund | `g_topopt` |
| **TPMS gyroid** | level set at c=0 → ~**50%** relative density (split labyrinths) | Schoen gyroid geometry | `g_topopt` |

**How validation is enforced:** `_assert_anchors()` recomputes each of the above with the generator's own helper functions and `assert`s equality to the published value (within a published-precision tolerance). It runs at module import so the corpus build *cannot* ship a drifted constant. Per-sample, every numeric is recomputed in Python from the cited closed form (no fabricated digits), and where a regime is empirical/unverified (turbulent CFD, 3D-vs-Hele-Shaw fill, weld-line strength knockdown, shop cost rates) the answer states the limitation rather than asserting false precision.

---

## 6. PROVENANCE RULES FOR THE GENERATOR (binding)

1. **Cite-the-authority inline.** Every reasoning chain names its source/standard, e.g. `(per ASME Y14.5-2018)`, `(Chvorinov 1940)`, `(AWS D1.1 Table 7.7)`, `(ISO 286-2, IT7=21 µm)` — modeled-on, never verbatim copyrighted prose.
2. **Numeric ⇒ closed-form recompute.** No constant is typed into an answer string; it is computed by a helper and the helper is anchor-asserted.
3. **Tag the level.** Each sample carries `meta.level ∈ {BSc, MSc, PhD, industrial}`; the depth of derivation matches the tag.
4. **Honesty over precision.** Empirical/unverified regimes are flagged; the answer recommends the validated path (sim/coupon/quote) instead of inventing confidence.
5. **CLI + schema frozen.** `--out/--cap/--seed/--report-every`, the chat-JSONL `{messages, meta}` shape, and hash dedup on the user text are preserved so `generate_corpus_v3.sh` keeps working unchanged.
