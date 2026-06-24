# Source Taxonomy — PLM · PDM · BIM · MES · ERP · Systems Engineering · Digital Twin · Lifecycle

> **Scope.** Research-grade sourcing map for the *data-graph / lifecycle* field
> cluster that grounds the training generator
> `archdisc-Models/scripts/bulk_synth_plm.py`. This is the SOURCE TAXONOMY
> companion to the curriculum doc
> `SCOPE_2026-06-24/training/plm-systems-digital.md` (which is the tool-call /
> CADGenBench curriculum). Where that doc says *what Archie must do*, this doc says
> *which named institutions, texts, standards, papers, and published reference
> values the generator's framing and numbers must be faithful to* — the bar being
> Ivy / top national-research-institute (MIT SDM, MIT-LMP, CMU INI, Stanford,
> Georgia Tech, Purdue, TU Delft/Munich, Cambridge, Penn GRASP/ESE, INCOSE/SERC,
> NIST/NAFEMS).
>
> **Discipline.** Every generated numeric answer is *computed* in Python (never
> fabricated), carries units, names the governing equation/standard, and — where a
> published canonical value exists — reproduces that **known-answer anchor** and
> the generator `assert`s it at import time (`--selfcheck`). Modeled-on, never
> verbatim-copyrighted: citations are `(per ISA-95 / IEC 62264)` style anchors, not
> reproduced standard text.

---

## 0. SUB-FIELDS COVERED

The cluster decomposes into 18 sub-fields, each mapped to one generator family in
`bulk_synth_plm.py`:

| # | Sub-field | Generator | Governing standard / canon |
|---|---|---|---|
| 1 | **PLM** — Product Lifecycle Mgmt | `g_plm` | ISO 10303 (STEP) AP203/214/242/239-PLCS; Stark |
| 2 | **PDM / Configuration Mgmt** | `g_pdm` | EIA-649 / ANSI-EIA-649C; ISO 10007; MIL-HDBK-61 |
| 3 | **ERP / MRP / lot-sizing** | `g_erp` | APICS/ASCM CPIM; Wagner-Whitin (1958); Harris EOQ (1913) |
| 4 | **MES** — Mfg Execution | `g_mes` | ISA-95 / IEC 62264; ISA-88 / IEC 61512; SEMI E10/E79 (OEE) |
| 5 | **SCADA / historian / fieldbus** | `g_scada` | Modbus spec; OPC-UA (IEC 62541); ISA-18.2 alarms |
| 6 | **Digital Twin / Virtual Commissioning** | `g_twin` | FMI 2.0/3.0; IEC 63278 (AAS); ISO 23247 (DT mfg) |
| 7 | **Industrial IoT** | `g_iiot` | MQTT (OASIS/ISO 20922); Sparkplug B; OPC-UA PubSub |
| 8 | **BIM** — Building Info Modeling | `g_bim` | ISO 19650; ISO 16739 (IFC); COBie / ISO 12006-2 |
| 9 | **Systems Engineering / Requirements** | `g_syseng` | INCOSE SE Handbook v5; ISO/IEC/IEEE 15288; ISO 29148; OMG SysML v2 |
| 10 | **QA / TQM / SPC** | `g_qa` | AIAG SPC & MSA; Montgomery (SQC); ISO 22514 |
| 11 | **Lean / VSM** | `g_lean` | Ohno (TPS); Rother & Shook (Learning to See); Little (1961) |
| 12 | **Operations Research** | `g_or` | Hillier & Lieberman; Winston; Erlang (1917); Kleinrock (queueing) |
| 13 | **RAMS** — Reliability/Availability | `g_rams` | MIL-HDBK-217; IEC 61078 (RBD); IEC 61025 (FTA); Weibull (1951) |
| 14 | **FMEA / FMECA** | `g_fmea` | AIAG-VDA FMEA Handbook (2019); MIL-STD-1629A; IEC 60812 |
| 15 | **Pressure-vessel compliance** | `g_compliance` | ASME BPVC VIII Div 1 (UG-27) & Div 2; PED 2014/68/EU |
| 16 | **LCA / sustainability** | `g_lca` | ISO 14040/14044; IPCC AR6 GWP; Ellen MacArthur MCI |
| 17 | **Project Management / EVM** | `g_pm` | PMBOK 7; ANSI/EIA-748 (EVM); Malcolm et al. (PERT, 1959); Kelley-Walker (CPM, 1959) |
| 18 | **Facility Layout** | `g_layout` | Tompkins *Facilities Planning*; Koopmans-Beckmann QAP (1957); Salveson (line balancing) |

---

## 1. NAMED INSTITUTIONS & COURSES (the rigor bar)

**Systems engineering & lifecycle**
- **MIT — System Design & Management (SDM)** joint Engineering/Sloan program;
  **ESD.33 Systems Engineering**, **ESD.34 System Architecture** (Edward Crawley);
  **16.842 Fundamentals of Systems Engineering** (Oli de Weck — budget/margin
  management, the V-model, requirements flowdown). *Crawley, Cameron, Selva,
  System Architecture (2015)* is the SDM canon.
- **INCOSE / SERC (Stevens-led Systems Engineering Research Center)** — the
  **INCOSE SE Handbook v5 (2023)** and the *SE Body of Knowledge (SEBoK)*; CSEP/
  ESEP certification body of knowledge.
- **Georgia Tech — ASDL** (Aerospace Systems Design Lab, Mavris) — trade studies,
  surrogate-based design, DSM/N²; **ISyE** for OR & facility layout.

**PLM / PDM / digital thread**
- **Penn State** (Industrial & Mfg Eng) PLM curriculum; **Purdue PLM Center of
  Excellence**; **Clemson — CU-ICAR / Digital Thread**. Text canon: *Stark, Product
  Lifecycle Management* (Vol 1–3, Springer); *Saaksvuori & Immonen, PLM*.
- **NIST** — Engineering Laboratory: STEP/AP242 conformance, **QIF (ISO 23952)**,
  Digital-Thread/Model-Based-Enterprise testbeds; *NIST IR* series on MBD.

**Manufacturing / MES / ERP / lean / OR**
- **MIT — Laboratory for Manufacturing & Productivity (LMP)** and **Leaders for
  Global Operations (LGO)**; **2.810 Manufacturing Processes**, **15.760 Operations
  Management**, **15.761 / 15.762 Operations**. *Hopp & Spearman, Factory Physics*
  is the LGO canon (Little's law, VUT, CONWIP).
- **ASCM/APICS** CPIM/CSCP body of knowledge (MRP/MPS/lot-sizing/DDMRP).
- **Stanford — MS&E**; **Northwestern — IEMS**; **Georgia Tech — ISyE** (Hillier &
  Lieberman, Nahmias) for OR / queueing / inventory.

**Digital twin / controls / IIoT / virtual commissioning**
- **TU Munich (iwb)**, **RWTH Aachen (WZL)**, **Fraunhofer IPA/IOSB** — virtual
  commissioning, AAS, OPC-UA, Industrie 4.0 reference architecture (RAMI 4.0).
- **MIT 2.171 / 6.302** (digital control, estimation — Kalman/EKF/UKF);
  **Stanford AA273 / Penn ESE 650** (state estimation). FMI from the *Modelica
  Association*.

**BIM / built environment**
- **Georgia Tech — Digital Building Lab (Chuck Eastman, the *BIM Handbook*)**;
  **Stanford — CIFE (Center for Integrated Facility Engineering)**; **TU Delft**,
  **Cambridge CDBB (Centre for Digital Built Britain — UK BIM / ISO 19650)**.

**Reliability / quality / safety**
- **University of Maryland — CALCE** (Pecht — reliability physics, prognostics/RUL,
  Weibull); **Arizona State / Georgia Tech** reliability programs. *O'Connor &
  Kleyner, Practical Reliability Engineering*; *Montgomery, Introduction to
  Statistical Quality Control*.

---

## 2. AUTHORITATIVE TEXTS + REFERENCE STANDARDS

**Texts (modeled-on, cited inline in generated answers):**
- Crawley, Cameron, Selva — *System Architecture* (2015) — SysML, DSM/N², modularity.
- de Weck, Roos, Magee — *Engineering Systems* (2011) — margins, ilities, budgets.
- Stark — *Product Lifecycle Management* (Springer, 3 vols) — EBOM↔MBOM, effectivity.
- Hopp & Spearman — *Factory Physics* (3e) — Little's law, VUT equation, CONWIP.
- Hillier & Lieberman — *Introduction to Operations Research* (11e) — LP/simplex, M/M/c, B&B.
- Nahmias & Olsen — *Production and Operations Analysis* — EOQ, ROP, Wagner-Whitin, newsvendor.
- Montgomery — *Introduction to Statistical Quality Control* (8e) — Shewhart, Cp/Cpk, A2/D3/D4.
- O'Connor & Kleyner — *Practical Reliability Engineering* (5e) — Weibull, RBD, MTBF/MTTR.
- Eastman, Teicholz, Sacks, Liston — *BIM Handbook* (3e) — IFC, clash, COBie, QTO.
- Tompkins, White, Bozer, Tanchoco — *Facilities Planning* (4e) — SLP, QAP, line balancing.
- Modarres, Kaminskiy, Krivtsov — *Reliability Engineering and Risk Analysis*.

**Reference standards (the validation anchors live in these):**
- **ISO 10303** (STEP): Part 11 (EXPRESS), Part 21 (clear-text), Part 28 (XML);
  AP203 (config-controlled 3D), AP214 (automotive), **AP242** (managed MBD,
  supersedes 203/214), **AP239 / PLCS**. JT = ISO 14306; QIF = ISO 23952.
- **ISO 19650** (BIM information management); **ISO 16739 / IFC**; ISO 12006-2 (COBie taxonomy).
- **ISA-95 / IEC 62264** (enterprise-control integration, the 5-level equipment
  hierarchy + the Level-3/Level-4 boundary + B2MML); **ISA-88 / IEC 61512** (batch).
- **IEC 62541** (OPC-UA); **ISO 20922** (MQTT); **Sparkplug B** (Eclipse Foundation).
- **FMI 2.0 / 3.0** (Modelica Assoc.); **IEC 63278** (Asset Administration Shell);
  **ISO 23247** (digital-twin framework for manufacturing).
- **ISO/IEC/IEEE 15288** (system life-cycle processes); **ISO/IEC/IEEE 29148**
  (requirements engineering); **OMG SysML v2**.
- **AIAG SPC** (control-chart constants) & **AIAG MSA** (Gage R&R, ndc);
  **AIAG-VDA FMEA Handbook (2019)** (7-step + Action Priority tables).
- **MIL-HDBK-217F** (parts-count/parts-stress reliability); **MIL-STD-1629A**
  (FMECA criticality); **IEC 61078** (RBD), **IEC 61025** (FTA), **IEC 60812** (FMEA).
- **ASME BPVC Section VIII** Div 1 (UG-27 shell formula) & Div 2 (stress
  linearization, Pm/Pm+Pb); **PED 2014/68/EU** (Annex II hazard categories).
- **ISO 14040 / 14044** (LCA framework + LCIA); **IPCC AR6 (2021)** 100-yr GWP factors.
- **ANSI/EIA-748** (EVM); **EIA-649C** (configuration management).

**Key research literature (foundational papers anchored in framing):**
- Harris, F.W. (1913) — EOQ "How many parts to make at once".
- Wagner & Whitin (1958) — *Dynamic version of the economic lot size model*, Mgmt Sci.
- Little, J.D.C. (1961) — *A proof for the queuing formula L = λW*, Ops Research.
- Erlang, A.K. (1917) — loss/delay formulas (Erlang-B/C).
- Weibull, W. (1951) — *A statistical distribution function of wide applicability*.
- Koopmans & Beckmann (1957) — *Assignment problems and the location of economic
  activities* (the QAP).
- Kelley & Walker (1959) — CPM; Malcolm, Roseboom, Clark, Fazar (1959) — PERT.
- Kalman, R.E. (1960) — recursive estimation (the EKF lineage).
- Crawley & Cameron — Design Structure Matrix / N² literature (MIT).

---

## 3. CURRICULUM LADDER (BSc → MSc → PhD → industry) PER SUB-FIELD

Each generated sample is tagged `meta.level ∈ {BSc, MSc, PhD, industrial}`. The
ladder below defines what each tier means per sub-field; the generator picks the
tier that matches the *cognitive demand of the specific template*, not at random.

| Sub-field | **BSc** (fluency) | **MSc** (specialist) | **PhD** (research frontier) | **Industrial** (tacit/senior judgment) |
|---|---|---|---|---|
| PLM | what EBOM/MBOM is; rev vs version | effectivity interval algebra; AP242 scope | BOM-graph diff = tree-edit-distance; DAG roll-up recurrence | which effectivity type for a safety-critical recall; multi-CAD coexistence |
| PDM/CM | checkout/checkin, baseline | 150% BOM = product of option families; CSA | content-addressed merge = LCA over feature DAG | EIA-649 major/minor disposition; FCA 100% gate |
| ERP/MRP | gross-to-net netting | EOQ, ROP with z·σ·√L | Wagner-Whitin DP optimality vs Silver-Meal heuristic | lead-time-offset past-due, expedite vs stockout |
| MES | OEE = A·P·Q | ISA-95 5-level hierarchy; ISA-88 batch | RTY compounding & genealogy back-trace | world-class OEE 85%; reject/down logging integrity |
| SCADA | scan-rate sample count | deadband/swinging-door compression | OPC-UA pub/sub vs report-by-exception load | ISA-18.2 alarm flood rationalization |
| Digital Twin | RUL linear extrapolation | EKF scalar gain; FMI macro/micro step | co-sim coupling error; UKF vs EKF linearization | MiL→SiL→HiL fidelity ladder; AAS submodels |
| IIoT | MQTT QoS packet count | Sparkplug birth/death + LWT | TSDB downsample/compression ratio bounds | edge aggregation vs forensic resolution |
| BIM | quantity take-off (V=L·W·H·n) | IFC spatial hierarchy; AABB clash | broad→narrow clash; FAR/GFA zoning | ISO 19650 CDE state; COBie handover |
| Systems Eng | mass budget + margin | DSM N²=N(N−1) interfaces; EARS | trade-study AHP eigenvector + consistency | requirement verifiability (I/A/D/T) |
| QA/SPC | X̄-R limits via A2/D3/D4 | Cp vs Cpk centering; Ppk long-term | DPMO ↔ sigma, 1.5σ shift convention | Gage-R&R %GRR & ndc acceptance |
| Lean | takt time | Little's law; PCE | kanban sizing under variability | SMED internal→external; OEE drivers |
| OR | 2-var LP corner | M/M/1 ρ,Lq,Wq; EOQ | Erlang-C P(wait); B&B bound pruning | FFD nesting; newsvendor critical ratio |
| RAMS | series/parallel RBD | Weibull R(t), β regime | k-of-n binomial; Markov availability | inherent vs operational availability |
| FMEA | RPN = S·O·D | AIAG-VDA Action Priority bands | FMECA criticality Cr = β·α·λ·t | why detection-only actions don't cut real risk |
| Compliance | UG-27 shell thickness | MAWP rearrangement | Div 2 Pm / Pm+Pb linearization | thin-wall validity limit; PED category route |
| LCA | GWP = Σ mᵢ·CFᵢ | embodied vs use-phase split | MCI / linear-flow index | EF dataset/grid-mix sensitivity |
| PM/EVM | PERT tₑ, σ | CPM float; CPI/SPI | path-variance P80 normal approx; Monte-Carlo | EAC=BAC/CPI assumption; TCPI feasibility |
| Layout | rectilinear vs Euclidean | line-balance min stations & efficiency | QAP NP-hardness; CRAFT/SA | aisle vs AGV metric choice |

---

## 4. KNOWN-ANSWER VALIDATION ANCHORS

These are the **specific named published reference values** the generator must
reproduce. Each is `assert`ed at import time via `bulk_synth_plm.py --selfcheck`.
"Source" names the standard/text/paper; "Anchor value" is the canonical number.

### 4.1 Standards / taxonomy anchors (string/structure)
| Source | Anchor |
|---|---|
| ISO 10303 (STEP) | Part 21 = clear-text encoding; Part 11 = EXPRESS; AP242 supersedes AP203+AP214 |
| ISA-95 / IEC 62264 | hierarchy = Enterprise → Site → Area → Work Center → Work Unit (5 levels) |
| ISA-88 / IEC 61512 | Procedure → Unit Procedure → Operation → Phase (4 levels) |
| IFC / ISO 16739 | IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey → IfcSpace |
| IEC 63278 (AAS) | Type 1 = AASX file, Type 2 = REST server, Type 3 = I4.0 P2P |
| MQTT QoS | QoS0=1 pkt (PUBLISH), QoS1=2 (PUBLISH/PUBACK), QoS2=4 (PUBLISH/PUBREC/PUBREL/PUBCOMP) |

### 4.2 Numeric known-answer anchors (computed & asserted)
| # | Source | Anchor input | Anchor output |
|---|---|---|---|
| A1 | **Harris/Nahmias EOQ** (textbook canonical) | D=1000, S=$10, H=$0.50/yr | EOQ = **200** units exactly (√(2·1000·10/0.5)) |
| A2 | **Wagner-Whitin (1958)** worked case | demand [10,20,30], S=$100, h=$1 | optimal = order period 1 covers all (1 setup), cost **$180** ≤ all alternatives |
| A3 | **Little's law (1961)** | λ=throughput 5/h, W=lead 4 h | L = WIP = **20** units |
| A4 | **Montgomery SQC** control-chart constants | n=5 | A2=0.577, D3=0, D4=2.114 (table value) |
| A5 | **Erlang-C** (Hillier & Lieberman) | a=ρ·c with c=2, a=1 erlang | P(wait) = a²/(c!(1−ρ)) / (Σ + …) = **0.3333** for a=1,c=2 |
| A6 | **Weibull (1951)** | t=η, any β | R(η) = e⁻¹ = **0.3679** (the characteristic-life identity) |
| A7 | **MTBF/MTTR availability** (IEC) | MTBF=9 h, MTTR=1 h | A = 9/10 = **0.90** |
| A8 | **IPCC AR6 (2021)** 100-yr GWP | 1 kg CH4 | **29.8** kg CO2e; 1 kg N2O = **273** kg CO2e |
| A9 | **ASME VIII Div 1 UG-27** | P=1 MPa, R=500 mm, S=100 MPa, E=1.0 | t = P·R/(S·E−0.6P) = 500/99.4 = **5.030** mm |
| A10 | **PERT** (Malcolm 1959) | o=2, m=4, p=6 | tₑ=(2+16+6)/6 = **4.0** days; σ=(6−2)/6 = **0.667** |
| A11 | **EVM** (ANSI/EIA-748) | PV=100, EV=80, AC=100 | CPI=0.80, SPI=0.80, EAC=BAC/CPI |
| A12 | **OEE** (SEMI E79) worked | A=0.90, P=0.95, Q=0.99 | OEE = 0.90·0.95·0.99 = **0.84645** (≈ world-class 85%) |
| A13 | **M/M/1** (Kleinrock) | λ=8, μ=10 → ρ=0.8 | Lq = ρ²/(1−ρ) = 0.64/0.2 = **3.2**; Wq = Lq/λ = **0.40** h |
| A14 | **DSM/N²** (Crawley) | N blocks | off-diagonal interfaces = N(N−1); N=10 → **90** |
| A15 | **Cp/Cpk** (Montgomery) | USL=10,LSL=4,μ=7,σ=1 | Cp=6/6=**1.0**, Cpk=min(3,3)/3=**1.0** (centered) |

These anchors are embedded as deterministic "anchor templates" in each generator
(fired on a fixed sub-key) so that — even with random parameters elsewhere — the
exact published case appears in the corpus and the in-generator `assert` guards it
against regression. Validation method: `bulk_synth_plm.py --selfcheck` runs all
anchors and exits non-zero on any mismatch; CI / the smoke run prints `SELFCHECK OK`.

---

## 5. HOW THE GENERATOR USES THIS DOC

1. **Framing rigor** — every template's answer cites the governing source inline
   (`(per ISA-95 / IEC 62264)`, `(Wagner-Whitin 1958)`, `(per ASME VIII UG-27)`),
   matching the named curricula/texts above; honesty caveats stay where a method
   is approximate (RANS, empirical priors, the 1.5σ DPMO convention, PED proxy).
2. **Numeric reference-validation** — the 15 numeric anchors (§4.2) are reproduced
   exactly and `assert`ed; all other rows compute real numbers in Python.
3. **Curriculum levels** — `meta.level` is chosen per template by cognitive tier
   (§3), not uniformly at random, so the corpus spans BSc→MSc→PhD→industrial with
   the intended distribution.
4. **PhD-rigor reasoning** — derivations name the recurrence/DP/eigenvector/
   binomial structure, state assumptions and validity regimes, and contrast the
   exact method with its heuristic (Silver-Meal vs WW, nearest-neighbor vs exact
   TSP, EKF vs UKF, RPN vs Action Priority).
