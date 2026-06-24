# Training Curriculum — PLM / Systems / Digital-Enterprise Cluster

### CLUSTER: PLM · PDM · BIM · CIM · ERP · MES · SCADA · Digital Twin · Mechatronics · Systems Eng · Requirement Eng · Configuration Mgmt · Virtual Commissioning · Industrial IoT · GIS
### TARGET: a 14B that reasons like a senior digital-thread / systems / controls engineer and **terminates every task in a schema-valid `forge.<wb>.<op>(args)` tool-call the kernel can replay**

> Generated 2026-06-24. Curriculum spec for ONE cluster of the Archie-14B program
> (`SCOPE_2026-06-21/programs/archie_corpus_program.md`, PILLAR B + the "one data
> graph / one signal fabric" cross-cutting seams). Grounded in the live verb
> surface (`frontend/src/ai/ForgeToolBridge.js`, `ForgeRunner.js` — `pdm.{branch,
> commit,diff,merge}`, `assembly.solve`, `drawing.*`, `material.query`,
> `gdt.datum`, `manufacture.gcode`, `simulate.{cfd,…}`, `part.*`, `io.import`) and
> in the field (a/b/c/d) research blocks in
> `SCOPE_2026-06-21/research/fields_sister.md` (PLM §1, PDM §2, BIM §3, CIM §4,
> ERP §5, MES §6, SCADA §7, Robotics §8, Twin §9, Mechatronics §10, CM §18,
> Virtual-Commissioning §19, IIoT §20, GIS §17). Sibling to the kernel-audit docs
> in `SCOPE_2026-06-24/kernel/`.
>
> **Discipline (Bible §0 carried into data):** real algorithm/equation/standard
> per sample — no template prose; **dynamic-first** (running state machine / MRP
> explosion / co-sim master / alarm SM / configurator SAT, not static catalogues);
> **grounded** — every geometry-true number (mass, BOM roll-up, cost, clash volume,
> CRS transform) must be **kernel-verifiable on replay**, every standards number
> must be **citable**, and where a layer is non-geometric (a workflow state
> machine) the sample teaches Archie the *correct procedure + the call*, not a
> hallucinated value. Honesty: where Forge's engine is present-but-shallow, teach
> Archie to surface the real limit.

---

## 0. WHY THIS CLUSTER, AND THE ONE INSIGHT THAT ORGANIZES IT

These 15 fields look like 15 enterprise products. For training they collapse onto
**three shared substrates** that already exist (or are scoped) inside Forge — so
the curriculum is *not* 15 disjoint syllabi but **three deep spines + the judgment
to route between them**:

| Spine | Fields that ride it | The geometry/kernel truth seam |
|---|---|---|
| **The data graph** (one item/BOM/effectivity/revision graph keyed to `NamedSolid.originalID`) | PLM, PDM, ERP, MES, CIM(plan side), Config-Mgmt, Requirement-Eng, Systems-Eng | mass roll-up, BOM explosion, where-used closure, change-impact, cost roll-up are **derivable from the assembly graph** → replay-verifiable |
| **The signal fabric** (tag engine + swinging-door historian + ISA-95 hierarchy + OPC-UA/MQTT transport) | SCADA, Digital-Twin, Virtual-Commissioning, IIoT | tag values come from the live kinematic/multibody/FEA twin → the dynamic seam |
| **The behavior/plant model** (the validated in-house FEA + HHT-α multibody DAE + CFD solvers, bound not forked) | Digital-Twin, Mechatronics, Virtual-Commissioning, CIM(twin side) | plant `M·q̈+C·q̇+K·q`, co-sim master, FMU coupling all run on real solvers → physics-grounded |

**The senior-engineer judgment we are actually teaching** is *which spine a problem
lives on, what is geometry-true vs. workflow-governed, which standard governs, and
what the manufacturable/operable answer is* — then the `forge.*` call that
realizes it. A junior conflates "BOM" (which BOM — E/M/S/P/phantom?), confuses
revision (form-fit-function) with version (working iteration), applies a date
effectivity where serial effectivity is required, or trusts a CFD twin number that
vvuq honestly caps at AMBER. The curriculum exists to remove exactly those errors.

---

## 1. KNOWLEDGE BREAKDOWN (bachelors → masters → PhD → industry practice)

Each field is given as **sub-topics · key theory/equations · governing standards ·
the hard real-world judgment**. Depth tiers: **[B]** bachelors fluency, **[M]**
masters/specialist, **[P]** PhD/research frontier, **[I]** industry-practice
judgment (the tacit knowledge that separates a senior from a textbook).

### 1.1 PLM — Product Lifecycle Management
- **Sub-topics.** Item/part master; **revision vs version semantics** (revision =
  form-fit-function change → new released identity; version = working iteration,
  same revision); **effectivity** (date / lot / serial / unit), effectivity
  interval algebra & DAG resolution; where-used & where-referenced graphs;
  **EBOM ↔ MBOM ↔ SBOM** transformation (phantom collapse, make/buy split,
  process-step insertion); change-impact propagation; digital thread vs digital
  twin; closed-loop BOL/MOL/EOL feedback; multi-CAD coexistence. **[B/M]**
- **Theory / equations.** Directed-acyclic effectivity resolution; **BOM graph
  diff** (tree-edit-distance / largest-common-subtree); revision-rule evaluation;
  set-cover for variant rollups; mass/cost roll-up recurrence
  `M(a)=Σ_c qty(a→c)·M(c)` over the BOM DAG (the geometry-true seam). **[M/P]**
- **Standards.** **ISO 10303 (STEP)** — EXPRESS schema language, Part-21
  clear-text, Part-28 XML, SDAI; **AP242** (managed model-based 3D: geometry + PMI
  + GD&T + BOM + material + ECO history); **AP239 / PLCS** (ISO 10303-239,
  cradle-to-grave: product/activity/resource/organization/justification) + OASIS
  PLCS DEXs; ISO 8000 (data quality); OSLC (RDF linked-data); JT (ISO 14306); QIF
  (ISO 23952). **[M]**
- **Hard judgment [I].** *When does a change force a new revision vs a new
  version?* (form-fit-function rule, interchangeability). *Which effectivity type?*
  (serial for traceable safety-critical, lot for consumables, date for soft
  cut-ins). *EBOM≠MBOM is normal, not an error* — the MBOM adds consumables,
  process steps, and reflects make/buy. A senior never lets the digital thread
  break at a hand-off (requirement→feature→FEA-result→drawing→inspection must stay
  linked or V&V coverage is unprovable).

### 1.2 PDM — Product Data Management
- **Sub-topics.** Vaulting (check-in/out, **optimistic vs pessimistic locking**);
  file-based vs database-item PDM; lifecycle/maturity states; **branch/merge of
  CAD feature trees**; reference/dependency resolution (assembly↔part↔drawing↔
  derived STEP); rename/replace propagation; duplicate detection; family
  tables/configurations; derived-data mgmt (thumbnails, neutral exports,
  tessellations); workflow/approval routing; ACL (role/group, **ITAR/export
  segregation**); naming/numbering; viewables (eDrawings/JT). **[B/M]**
- **Theory / algorithms.** Content-addressed store (`brepHash = SHA-256(canonical
  B-Rep)`, Merkle DAG); **three-way merge over a DAG** (recursive LCA over feature-
  history); **Rabin fingerprinting** for blob chunking/dedupe; topological sort for
  load order; **geometric-hash invariants** (volume, surface area, principal
  inertia tensor) for near-duplicate detection. **[M/P]**
- **Standards.** STEP/JT/3D-PDF viewables; OSLC/PLM-Services federation; CAS
  (Merkle DAG, git-LFS-style). **[M]**
- **Hard judgment [I].** *Pessimistic lock* for binary CAD (no auto-merge of
  geometry) vs *optimistic* for metadata; a rename must rewrite **all** reference
  edges atomically or the assembly silently loses a child; near-dup detection by
  geometric invariants catches the "saved-as copy" that a hash misses; ITAR
  segregation is a **vault-partition** problem, not a UI filter — get it wrong and
  it's a federal violation.

### 1.3 BIM — Building Information Modeling
- **Sub-topics.** **IFC schema** (ISO 16739, IFC2x3→IFC4→**IFC4.3** adds
  alignment/road/rail/bridge/port + georeferencing): inheritance `IfcRoot →
  IfcObjectDefinition → IfcProduct/IfcProcess/IfcResource`; spatial structure
  `IfcProject→IfcSite→IfcBuilding→IfcBuildingStorey→IfcSpace`; elements
  (`IfcWall, IfcSlab, IfcBeam, IfcColumn, IfcDuctSegment`); relationships
  (`IfcRelAggregates, IfcRelContainedInSpatialStructure, IfcRelDefinesByProperties`);
  Pset_*; geometry (`IfcExtrudedAreaSolid`, `IfcAdvancedBrep` w/ NURBS,
  `IfcAlignment` horizontal/vertical/cant). **openBIM**: BCF (issue exchange),
  **IDS** (machine-checkable requirements), bsDD, COBie; LOD/LOIN, MVD;
  clash detection; 4D/5D/6D/7D. **[B/M]**
- **Theory / algorithms.** **Clash** = BVH/AABB broad-phase + kernel boolean-
  intersect narrow-phase (hard vs soft/clearance, by intersection volume);
  IfcAlignment arc–clothoid–parabola stationing; spatial-containment point-in-
  polyhedron. **[M]**
- **Standards.** IFC (ISO 16739-1), IFC4.3, BCF 2.1/3.0, IDS, COBie, bsDD, CityGML,
  gbXML, LandXML; MVDs (Coordination/Reference View). **[M]**
- **Hard judgment [I].** A *soft* (clearance) clash between a duct and a structural
  member is the one that bites on site; LOD/LOIN must match the *use* (a coordination
  model needs geometry, an FM handover needs psets, not geometry); IFC export is
  only valid if the spatial-structure tree is complete (orphan elements fail
  downstream IDS validation). Georeference (IFC4.3 + CRS) early or BIM↔GIS never aligns.

### 1.4 CIM — Computer-Integrated Manufacturing
- **Sub-topics.** CAD→CAPP→CAM→CAQ→shop-floor loop; **CAPP** variant/retrieval
  (group-technology coding: Opitz/MICLASS) vs **generative** (from feature
  recognition); **machining-feature recognition** (pockets/slots/holes/bosses/
  chamfers via graph-based AAG or volumetric decomposition); cellular mfg & group
  technology; FMS; AGV/AS-RS routing; **ISA-95 levels 0–4**. Process plan = setup →
  operation → tool → parameters → time. **[M]**
- **Theory / algorithms.** **Attributed Adjacency Graph** (face nodes, edge arcs
  labeled convex/concave) + **subgraph isomorphism (VF2)** against a feature
  library; volumetric decomposition (convex-hull difference); **MRR** cycle-time
  `t = V_removed / (MRR)`; job-shop scheduling (dispatch rules **SPT/EDD/critical-
  ratio**, disjunctive graph). **[M/P]**
- **Standards.** ISA-95 (IEC 62264); **STEP-NC** (ISO 14649 / AP238) feature-based
  machine instructions; GT coding (Opitz/MICLASS/DCLASS). **[M]**
- **Hard judgment [I].** Feature recognition is the keystone — get the AAG
  convex/concave edge labels right or a pocket reads as a boss; setup planning
  minimizes re-fixturing (datum consistency drives both CAPP and GD&T); STEP-NC is
  the future-proof handoff but most shops still post G-code (teach both).

### 1.5 ERP — Enterprise Resource Planning (manufacturing core)
- **Sub-topics.** MRP→MRP II→ERP; **MRP logic** (gross-to-net explosion: gross
  requirement − on-hand − scheduled receipts → net → planned order receipt → offset
  by lead time → planned order release); **low-level-code** BOM explosion;
  **lot-sizing** (LFL, EOQ, POQ, **Wagner-Whitin** optimal DP, Silver-Meal
  heuristic); safety stock & reorder point; MRP II (CRP infinite/finite, MPS,
  rough-cut); BOM types (E/M/planning/phantom/**super-BOM 150%**); routings;
  costing (standard vs actual, absorption, **ABC**); inventory valuation
  (FIFO/LIFO/wtd-avg); demand planning (moving-avg, exp-smoothing, **Holt-Winters**).
  APICS/ASCM body of knowledge. **[B/M]**
- **Theory / equations.** EOQ `Q* = √(2DS/H)`; Wagner-Whitin DP recurrence;
  Holt-Winters triple exponential smoothing (level/trend/season); cost roll-up by
  BOM level `C(a)=mat(a)+labor·rate+overhead·burden+Σ qty·C(child)`. **[M]**
- **Standards.** ISA-95 / IEC 62264 + **B2MML** (Level3↔4 XML); APICS/ASCM
  dictionary. **[M]**
- **Hard judgment [I].** The **geometry-true seam** is the MBOM + mass + cost
  roll-up *derived from the assembly graph* — Forge owns that truth; the rest
  (inventory, lead times) is data Archie must *ask for*, not invent. Lot-for-lot
  for expensive/lumpy demand, EOQ for steady cheap parts; finite CRP exposes the
  bottleneck the infinite MPS hides.

### 1.6 MES — Manufacturing Execution System
- **Sub-topics.** **MESA-11** functions; **ISA-95** equipment hierarchy
  (enterprise→site→area→work-center→work-unit) + object models (personnel/equipment/
  material/process-segment) + activity model; **ISA-88** batch (procedural/physical/
  recipe: recipe→unit-procedure→operation→phase); **OEE = Availability × Performance
  × Quality**; genealogy/as-built; **SPC** (control charts, Cp/Cpk). **[M]**
- **Theory / equations.** OEE `A = run/planned`, `P = (ideal·count)/run`,
  `Q = good/total`; **Cp = (USL−LSL)/6σ**, **Cpk = min((USL−μ),(μ−LSL))/3σ**;
  X̄-R / X̄-S control limits (`X̄ ± A₂R̄`); **Western Electric rules** (1-of-1 beyond
  3σ, 2-of-3 beyond 2σ, …); finite-capacity dispatch. **[M/P]**
- **Standards.** ISA-95 (IEC 62264)+B2MML; ISA-88 (IEC 61512)+BatchML; MESA-11;
  OEE/TEEP; SPC (ISO 7870, Shewhart, Montgomery). **[M]**
- **Hard judgment [I].** OEE losses are *categorized* (availability vs performance
  vs quality) — a senior reads which loss dominates before "improving OEE";
  genealogy is the recall-survival capability (as-built BOM + process history per
  serial); a control chart "out of control" by a Western-Electric pattern is *not*
  the same as "out of spec" — confusing the two is the classic junior error.

### 1.7 SCADA — Supervisory Control & Data Acquisition
- **Sub-topics.** **Purdue/ISA-95 hierarchy** (L0 process · L1 basic control
  PLC/RTU/DCS · L2 supervisory SCADA/HMI · L3 site/MES · L3.5 DMZ · L4 enterprise);
  tag database; polling vs **report-by-exception**; **alarm management** (ISA-18.2:
  rationalization, prioritization, shelving, flood suppression; state machine
  normal→unack-active→ack-active→unack-RTN); **historian** (deadband, **swinging-
  door** compression); HMI (ISA-101 high-performance/situational-awareness).
  Protocols: **Modbus** (coils/registers), **DNP3** (event buffering, timestamping,
  unsolicited), **OPC UA** (address space, sessions, subscriptions, security),
  IEC 61850, EtherNet/IP, PROFINET. **[M]**
- **Theory / algorithms.** **Swinging-door** trending compression (slope-corridor
  archival); deadband filtering; alarm-flood suppression; scan-cycle scheduling.
  **[M/P]**
- **Standards.** Modbus; DNP3 (IEEE 1815); OPC UA (IEC 62541); IEC 61850;
  IEC 61131-3 (PLC languages); **ISA-18.2** (alarms); ISA-101 (HMI); **IEC 62443**
  (OT security). **[M]**
- **Hard judgment [I].** Alarm rationalization (every alarm must be actionable,
  prioritized, and have a defined response) is the discipline that prevents alarm
  floods that mask the real fault (Texas City / Three-Mile-Island lessons);
  historian deadband too tight = storage blowup, too loose = lost transients;
  OPC UA over Modbus when you need a semantic information model, Modbus when you
  need cheap registers.

### 1.8 Industrial Automation & Robotics
- **Sub-topics.** **IEC 61131-3** (LD/FBD/ST/IL/SFC) + **IEC 61499** distributed
  event FBs; robot kinematics (**DH parameters**, forward kinematics via homogeneous
  transforms, **inverse kinematics** — Pieper closed-form for 6R spherical-wrist,
  numerical Jacobian/**DLS** for redundant); differential kinematics & Jacobian,
  singularities, workspace; trajectory generation (joint-space cubic/quintic/
  trapezoidal/**S-curve jerk-limited**, Cartesian linear/circular + **SLERP**);
  dynamics (recursive **Newton-Euler**, Lagrangian, computed-torque); motion
  planning (**RRT*/PRM/OMPL**, collision checking); TCP/tool calibration; safety
  (ISO 10218, **ISO/TS 15066** collaborative: speed-and-separation, power-and-force
  limiting). **[M/P]**
- **Theory / equations.** FK = ∏ Aᵢ(θᵢ,dᵢ,aᵢ,αᵢ); IK Pieper decoupling; Jacobian
  `ẋ = J(q)·q̇`, DLS `q̇ = Jᵀ(JJᵀ+λ²I)⁻¹ẋ`; Newton-Euler recursion. **[P]**
- **Standards.** IEC 61131-3, IEC 61499, ISO 9283, ISO 10218/TS 15066, DH
  convention, **URDF/SDF**, ROS/MoveIt, OMPL. **[M]**
- **Hard judgment [I].** Near a singularity, DLS damping λ trades tracking error
  for stability; collaborative safety is a *speed-and-separation OR power-and-force*
  argument backed by a risk assessment, not a fence; S-curve over trapezoidal where
  jerk excites structural modes.

### 1.9 Digital Twin Engineering
- **Sub-topics.** Twin taxonomy (**model → shadow → twin → aggregate**); **ISO
  23247** (DT framework for manufacturing: OME, data collection, DT-entity, user
  entity); **Asset Administration Shell (AAS, IEC 63278-1)** — submodels (Nameplate,
  TechnicalData, Documentation, BillOfMaterial), Concept Descriptions, type vs
  instance (Type-1 AASX file, Type-2 REST server, Type-3 I4.0 P2P); **FMI 2.0/3.0**
  + FMU (model-exchange & co-sim) + **SSP**; **co-simulation master** (Jacobi vs
  Gauss-Seidel, macro/micro stepping, rollback); surrogate/ROM (**POD**, Kriging,
  neural); state estimation (**Kalman/EKF/UKF/particle**); predictive maintenance
  (**RUL**). **[M/P]**
- **Theory / equations.** Gauss-Seidel co-sim coupling + signal extrapolation;
  EKF predict/update; POD `u(x,t)≈Σ aᵢ(t)φᵢ(x)`; RUL similarity/degradation. **[P]**
- **Standards.** ISO 23247; IEC 63278-1 (AAS)+AASX; FMI 2.0/3.0+SSP; OPC UA;
  **DTDL**; W3C WoT TD. **[M]**
- **Hard judgment [I].** *Most "digital twins" are digital shadows* (one-way) —
  a true twin closes the loop back to the asset; co-sim master choice (Gauss-Seidel
  for stability at strong coupling, Jacobi for parallelism) controls whether the
  twin diverges; a ROM is only valid inside its training envelope; **never trust a
  twin number whose underlying solver vvuq caps at AMBER** (e.g. turbulent CFD) —
  surface the limit.

### 1.10 Mechatronics System Design
- **Sub-topics.** **V-model & MBSE** (SysML 1.x/v2: requirement, BDD, IBD, activity,
  state-machine, parametric diagrams; RAAML); multi-domain modeling (**Modelica**
  acausal equation-based; **bond graphs**; signal-flow); co-design of mechanical
  plant + sensors + actuators + control + embedded SW; **motor sizing** (torque-
  speed, **reflected/inertia matching**, gear-ratio optimization); control (**PID**
  Ziegler-Nichols/IMC, **state-space** controllability/observability, **LQR/LQG**,
  pole placement Ackermann, Bode/Nyquist margins, Tustin/ZOH discretization);
  **functional safety** (**ISO 26262** ASIL A–D, HARA, FMEDA, FTA, SPFM/LFM/PMHF;
  IEC 61508 SIL). **[M/P]**
- **Theory / equations.** Plant `M·q̈ + C·q̇ + K·q = F`; reflected inertia
  `J_refl = J_load/N²`; LQR via algebraic Riccati; FTA minimal cut-sets; FMEDA
  metric roll-up. **[P]**
- **Standards.** SysML v1.6/v2 (OMG), Modelica, FMI, **ISO 26262** (ASIL),
  IEC 61508 (SIL), IEC 61511. **[M]**
- **Hard judgment [I].** Inertia matching (J_motor ≈ J_refl) governs both
  responsiveness and stability; ASIL is *derived* from severity×exposure×
  controllability (HARA), it is not picked; a control loop designed against an
  idealized plant fails on the real `M,C,K` — co-design or re-spin.

### 1.11 Systems Engineering & MBSE
- **Sub-topics.** ISO/IEC/IEEE **15288** life-cycle processes; INCOSE SE Handbook;
  **V-model** (decomposition↔integration), stakeholder needs → system requirements
  → architecture → design → V&V; **SysML/MBSE** (the four pillars: structure /
  behavior / requirements / parametrics; SysML v2 textual+graphical); trade studies
  (weighted-objective, AHP, utility), interface management (ICDs), N²-diagram
  coupling; verification methods (**Inspection/Analysis/Demonstration/Test**);
  technical performance measures (TPM), margins. **[M]**
- **Theory / methods.** Requirement-to-test **traceability matrix** (coverage =
  verified-reqs / total-reqs); allocation of TPMs down the architecture; AHP
  eigenvector weighting; N² off-diagonal coupling minimization. **[M/P]**
- **Standards.** ISO/IEC/IEEE 15288, INCOSE SE Handbook, **SysML v2** (OMG),
  ISO/IEC/IEEE 29148 (requirements). **[M]**
- **Hard judgment [I].** An untraceable requirement is unverifiable — every "shall"
  needs a verification method and an owning element; the V-model's left/right
  symmetry is the contract (each decomposition level has a matching V&V level);
  MBSE's value is *single source of truth*, not prettier diagrams.

### 1.12 Requirement Engineering
- **Sub-topics.** Elicitation; **ISO/IEC/IEEE 29148** (requirement attributes:
  necessary, unambiguous, verifiable, complete, consistent, traceable, feasible);
  functional vs non-functional vs constraints; **EARS** patterns (Easy Approach to
  Requirements Syntax: ubiquitous/event/state/option/unwanted); formalization
  (temporal logic, contracts/assume-guarantee); requirement decomposition &
  allocation; rationale & verification-method capture; volatility/change. **[M]**
- **Theory.** EARS templates; assume-guarantee contracts; satisfaction relations
  for verifiable predicates; traceability coverage. **[M/P]**
- **Standards.** ISO/IEC/IEEE 29148, INCOSE Guide for Writing Requirements,
  EARS. **[M]**
- **Hard judgment [I].** "The system shall be fast" is not a requirement (no
  measurable predicate); a verifiable requirement names the trigger, the condition,
  the response, and the bound; over-specifying *how* instead of *what* kills design
  freedom and manufacturability.

### 1.13 Configuration Management (engineering CM)
- **Sub-topics.** **Five CM functions** (EIA-649C): planning; **identification**
  (CI selection, numbering, baselines: functional/allocated/product/as-designed/
  as-built); **change management** (ECR→ECN/ECO; **CCB**; major/minor; disposition;
  **effectivity & cut-in**); **status accounting (CSA)**; **verification & audit
  (FCA functional / PCA physical)**; variant/option configuration (**constraint-
  based configurator**, **150%/super-BOM** with selection rules → resolve to a
  buildable 100% BOM); interchangeability & traceability; CMII; ISO 10007;
  AS9100/DO-178C/DO-254 CM. **[M]**
- **Theory / algorithms.** **SAT/CSP** for configurator rule resolution &
  conflict detection; **BOM tree diff** (as-built vs as-designed); effectivity
  interval algebra; baseline immutability (content-addressed); trace-coverage
  matrices. **[M/P]**
- **Standards.** EIA-649C / EIA-649-1, ISO 10007, MIL-HDBK-61A, CMII, AS9100,
  DO-178C/DO-254. **[M]**
- **Hard judgment [I].** A baseline is *immutable* — you supersede, you don't edit;
  the configurator must *detect conflicts* (incompatible options) not just assemble;
  FCA proves the design meets requirements, PCA proves the build matches the design
  — both are needed before delivery in regulated industries.

### 1.14 Virtual Commissioning
- **Sub-topics.** **Loop-fidelity ladder MiL → SiL → HiL** (controller model vs
  plant; compiled/emulated PLC code vs plant; real controller + real-time plant);
  plant/behavior model (kinematics, sensors/actuators, conveyors, signal logic);
  signal exchange PLC↔model (PLCSIM Prosim/Softbus, **OPC UA**, shared-memory);
  real-time co-sim & time-stepping; fault injection; cycle-time/throughput
  validation; collision & reachability checks; operator-training sims; ISA-95/
  SCADA/twin connectivity. **[M/P]**
- **Theory / algorithms.** Real-time fixed-step **Gauss-Seidel co-sim master**;
  signal mapping; kinematic/sensor-model evaluation; **collision narrow-phase**
  (kernel boolean); IEC 61131-3 state-machine logic. **[M]**
- **Standards.** OPC UA; IEC 61131-3; FMI/SSP; AutomationML (CAEX); PLCSIM-Advanced.
  **[M]**
- **Hard judgment [I].** SiL catches the logic bug that MiL's idealized plant hides;
  the plant model must include sensor *placement & latency* or commissioning passes
  but the line jams; fault injection (a stuck prox sensor) is where VC earns its
  cost.

### 1.15 Industrial IoT (IIoT) Architecture
- **Sub-topics.** Edge→fog→cloud; **RAMI 4.0** (layers × lifecycle×value-stream ×
  hierarchy) & IIRA; **MQTT** (pub/sub, QoS 0/1/2, retained, LWT) + **Sparkplug B**
  (birth/death certs, metric namespace, RBX, state mgmt); **OPC UA + PubSub** (UADP
  over MQTT); edge computing (protocol normalization, store-&-forward, edge
  analytics); **time-series DBs** (downsample/retention/compression); device mgmt
  (provisioning, OTA, X.509/PKI); security (TLS, **IEC 62443** zones/conduits);
  **UNS** (Unified Namespace, ISA-95-structured); contextualization (ISA-95+AAS).
  **[M]**
- **Theory / algorithms.** Pub/sub routing; RBX/deadband; store-&-forward;
  **swinging-door** TS compression (shared with SCADA historian); edge stream
  aggregation. **[M]**
- **Standards.** MQTT (OASIS), **Sparkplug B** (Eclipse), OPC UA+PubSub
  (IEC 62541), AMQP, CoAP; RAMI 4.0, IIRA; IEC 62443; AAS/AASX; ISA-95. **[M]**
- **Hard judgment [I].** Sparkplug B's birth/death certs give *stateful* auto-
  discovery MQTT lacks; UNS is an *information-architecture* decision (one ISA-95
  topic tree as single source of truth) not a protocol; QoS-2 is rarely worth its
  overhead — RBX + retained handles most OT.

### 1.16 GIS — Geographic Information Systems
- **Sub-topics.** Vector (point/line/polygon, OGC simple-features, WKT/WKB) vs
  raster (DEM, imagery, bands); **CRS** (geographic WGS84 EPSG:4326, projected UTM /
  Web-Mercator EPSG:3857 / state-plane, datums, **Helmert 7-param**, **NTv2** grid
  shift, geoid/ellipsoid, EPSG, PROJ pipelines); spatial ops (intersect/union/
  buffer/clip/dissolve/overlay — *same boolean geometry as CAD*); spatial indices
  (R-tree, quadtree, geohash, **H3**); topology (**DE-9IM**); network analysis
  (Dijkstra/A*, isochrones); interpolation (IDW, kriging); **DEM analysis** (slope/
  aspect/hillshade/watershed/viewshed); 3D city models (**CityGML**, 3D Tiles,
  LOD0–4); BIM↔GIS (georeferenced IFC4.3). **[M]**
- **Theory / algorithms.** Helmert/NTv2 transform; DE-9IM predicate matrix;
  Dijkstra/A*; IDW/kriging; Delaunay TIN; viewshed/watershed. **[M/P]**
- **Standards.** OGC simple features (ISO 19125), WMS/WFS/WMTS + OGC API,
  **GeoPackage**, GeoJSON, Shapefile, **CityGML**, 3D Tiles, GeoTIFF/COG; EPSG,
  PROJ/GDAL. **[M]**
- **Hard judgment [I].** *Always know your CRS* — a Web-Mercator area is wrong by
  the secant-of-latitude²; a buffer in degrees is meaningless; BIM↔GIS only aligns
  if both share a projected CRS with the same datum; the boolean ops are the *same
  kernel machinery* as CAD (the reuse seam).

---

## 2. DATA SOURCES (premium / authoritative only)

> Storage-safe streaming discipline (memory `feedback-models-streaming-storage`):
> **download → process → delete, one at a time**, parquet via `iter_batches`,
> accumulator-dedup. Standards bodies' *normative text* is the answer key; OCW/
> texts are the reasoning scaffold; schemas/datasets are the grounding seam.

### 2.1 Standards bodies (the answer keys — cite, embed numbers, never paraphrase loosely)
- **ISO/IEC** — ISO 10303 (STEP: EXPRESS, Part-21, AP203/214/**242**/**239 PLCS**),
  ISO 14306 (JT), ISO 23952 (**QIF**), ISO 16739 (**IFC**, incl. IFC4.3),
  ISO 19125 (simple features), ISO 10007 (CM), ISO 23247 (digital twin),
  IEC 63278-1 (**AAS**), IEC 62264 (**ISA-95**), IEC 61512 (**ISA-88**),
  IEC 62541 (**OPC UA + PubSub**), IEC 61131-3 / 61499 (PLC), IEC 61850,
  IEC 62443 (OT security), IEC 61508 (SIL), ISO 26262 (ASIL), ISO 10218 /
  ISO/TS 15066 (robot safety), ISO/IEC/IEEE **15288** & **29148** (SE/requirements).
- **buildingSMART** — IFC, **BCF**, **IDS**, COBie, bsDD, MVDs (technical docs +
  open sample IFC models, IfcOpenShell schema).
- **OGC** — simple features, WMS/WFS/WMTS, OGC API, **GeoPackage** spec, CityGML,
  3D Tiles, GML; **EPSG registry** + **PROJ/GDAL** for CRS pipelines.
- **OASIS / Eclipse** — **MQTT**, **Sparkplug B**; OASIS PLCS DEX library.
- **OMG** — **SysML v2** (and v1.6), RAAML; UML for traceability semantics.
- **SAE / EIA / MIL** — **EIA-649C** (CM), EIA-649-1, MIL-HDBK-61A, CMII;
  AS9100; DO-178C/DO-254 (aero CM).
- **APICS/ASCM** — CPIM body of knowledge (MRP/MRP II/ERP dictionary).
- **ISA** — ISA-18.2 (alarms), ISA-101 (HMI), ISA-95/88; **B2MML / BatchML** schemas.
- **Plattform Industrie 4.0 / IDTA** — **RAMI 4.0**, AAS specs (admin-shell-io),
  AASX packages.
- **NIST** — STEP test suites, digital-twin standards reports, AM-Bench (where it
  touches CIM/twin), SE references.
- **Modelica Association** — **FMI 2.0/3.0**, **SSP**, Modelica Standard Library.

### 2.2 University courses (reasoning scaffold)
- **MIT OCW** — 16.842 *Fundamentals of Systems Engineering*; 16.355J *Software
  Engineering Concepts* (requirements/V&V); 2.852 *Manufacturing Systems Analysis*;
  2.854/2.853 *Manufacturing*; 6.832/2.165 *Underactuated Robotics* (kinematics/
  dynamics/planning); 2.004 *Dynamics & Control*; 15.761 *Operations Management*
  (MRP/inventory); ESD.33 *Systems Engineering*.
- **Stanford** — CS237A/Principles of Robot Autonomy; MS&E inventory/operations.
- **Georgia Tech** — ISYE supply-chain/inventory (MRP, lot-sizing, forecasting).
- **CMU** — robotics kinematics/planning; INCOSE-aligned SE.
- **TU-Delft / RWTH-Aachen / KIT** — Industrie 4.0, virtual commissioning, MBSE
  (open courseware).

### 2.3 Textbooks (canonical — the depth the model must internalize)
- **PLM/PDM/CM** — Stark *Product Lifecycle Management*; Saaksvuori & Immonen
  *PLM*; EIA-649C + MIL-HDBK-61A (CM); CMII reference.
- **ERP/MRP/MES** — **APICS CPIM** modules; Vollmann/Berry/Whybark *Manufacturing
  Planning & Control*; Montgomery *Statistical Quality Control* (SPC/Cp/Cpk).
- **SE/MBSE/Req** — **INCOSE Systems Engineering Handbook**; Friedenthal/Moore/
  Steiner *A Practical Guide to SysML*; ISO/IEC/IEEE 29148 + INCOSE *Guide for
  Writing Requirements*; NASA Systems Engineering Handbook.
- **Robotics/Mechatronics/Control** — **Craig** *Introduction to Robotics*;
  **Spong/Hutchinson/Vidyasagar** *Robot Modeling & Control*; LaValle *Planning
  Algorithms* (RRT*/PRM); **Ogata** / **Franklin** *Modern/Feedback Control*;
  Karnopp/Margolis/Rosenberg *System Dynamics* (bond graphs).
- **Digital Twin** — Rasheed/San/Kvamsdal twin surveys; NIST DT reports; IDTA AAS
  guides; Modelica/FMI standard.
- **SCADA/IIoT/Automation** — Boyer *SCADA*; IEC 61131-3 (Lewis); ISA-18.2/101;
  HiveMQ/EMQX MQTT/Sparkplug guides; Purdue-model references.
- **CIM/CAPP** — Groover *Automation, Production Systems & CIM*; AAG feature-
  recognition literature (Joshi & Chang attributed adjacency graph).
- **BIM** — Eastman et al. *BIM Handbook*; buildingSMART technical docs.
- **GIS** — de Smith/Goodchild/Longley *Geospatial Analysis*; OGC + PROJ/GDAL docs.

### 2.4 Datasets / schemas / sample files (the grounding seam)
- **NIST STEP test suites** + AP242/AP239 EXPRESS schema text + worked Part-21
  instance files (the PLM/STEP grounding).
- **buildingSMART open sample IFC models** + IfcOpenShell schema + IDS/COBie
  samples (BIM grounding; can be parsed and replayed).
- **B2MML / BatchML / AutomationML (CAEX)** reference XML (ERP/MES/VC grounding).
- **AASX sample packages** (admin-shell-io) (twin/IIoT grounding).
- **EPSG registry + PROJ test suite** (GIS CRS-transform known answers).
- **URDF/SDF robot libraries** (robotics FK/IK grounding — replayable in the MBD
  kernel).
- **Machining-feature datasets** (MFCAD / FeatureNet-style, AAG-labeled) for CIM
  feature-recognition grounding.
- **Forge's own assembly graph** — the *primary* geometry-true source: any BOM /
  mass / cost / where-used / clash sample is generated against a kernel-built
  assembly and **verified on replay** (this is the moat — see §3).

---

## 3. SYNTHETIC-DATA GENERATION PLAN

> Programmatic via `bulk_synth`-style modules (memory `feedback-models-bulk-synth`:
> agents top out at 40–60; generators do 3.5–13k+ per run). Every sample is JSONL
> `{messages:[system,user,assistant]}`, assistant ending in one or more
> `forge.<wb>.<op>(args)` calls (or a structured answer **plus** a call). This
> cluster folds into PILLAR B's data-graph / signal-fabric cluster generators and
> PILLAR C (manufacturing/PLM) of `archie_corpus_program.md`.

### 3.1 The grounding contract (what makes this corpus trustworthy)
Three sample classes, three grounding regimes — **never blur them**:

1. **Geometry-true** (BOM roll-up, mass, cost roll-up, where-used, clash volume,
   feature recognition, CRS transform, MRP-from-assembly, OEE-from-counts).
   → Generate the answer *by running the kernel/algorithm*, embed it, and the
   sample is **replay-verified**: re-execute the terminal `forge.*` call, assert
   the kernel returns the same number (the `ForgeCADScore`/replay seam, replay=1.0
   on correct, ≈0.46 on corrupt). **These are the highest-value samples** — the
   geometry-true spine of the whole cluster.
2. **Standards-cited** (revision-vs-version rule, effectivity choice, IFC entity/
   Pset, ISA-95 level, ISA-18.2 alarm state, ASIL determination, EARS pattern,
   QoS semantics). → Answer key is *normative standard text*; cite the
   clause/entity; no fabricated numbers. A standards-validator gate checks
   entity/clause names against the schema.
3. **Procedure-correct** (workflow state machines, ECO routing, MiL/SiL/HiL choice,
   co-sim master selection, configurator conflict). → Teach the *correct procedure
   and the terminal call*; correctness = the procedure matches the standard and the
   call is schema-valid + executes a real state transition (e.g. `pdm.commit`
   actually advances the state machine).

Honesty rule baked into generation: when the answer depends on a Forge engine that
is shallow (turbulent CFD twin, contact friction), the *ideal answer surfaces the
limit* (cite vvuq AMBER) rather than asserting a number — this is itself a training
signal (`feedback-validate-published-references`).

### 3.2 Generator modules (bulk_synth_*) and what each emits

**`gen_plm_graph`** (PLM/PDM/CM/ERP/MES — the data-graph spine; highest volume)
- **Q/A:** revision vs version; pick the effectivity type for scenario X; EBOM→MBOM
  transform steps; where-used closure; ISA-95 level placement; OEE/Cp/Cpk
  computation; lot-sizing method choice; baseline-type selection; FCA-vs-PCA.
- **problem→solution:** *full MRP gross-to-net explosion* (gross→net table with
  lead-time offset) terminating in `forge.erp.mrpExplode(...)`; *cost roll-up by
  BOM level* → `forge.erp.rollupCost(assembly)`; *EBOM→MBOM* → `forge.plm.bomTransform`;
  *change-impact* → `forge.plm.changeImpact(part)` then `forge.cm.eco(change)`;
  *150%→100% configurator resolution with a conflict* → `forge.cm.configure(superBom,
  options)`; *check-out/branch/merge of a feature tree* → the **live** verb chain
  `pdm.branch` → edit → `pdm.commit` → `pdm.diff` → `pdm.merge` (these exist today).
- **design→critique:** "this BOM uses date effectivity for a serialized
  safety-critical part — wrong; switch to serial effectivity because …".
- **Grounding:** geometry-true (run the roll-up/explosion against a kernel-built
  assembly; replay-verify) + standards-cited (effectivity/baseline rules).

**`gen_signal_fabric`** (SCADA/Twin/VC/IIoT — the signal spine)
- **Q/A:** Modbus register vs OPC-UA node choice; Sparkplug B birth/death; ISA-18.2
  alarm-state transition; swinging-door compression decision; QoS level; UNS topic
  design; MiL/SiL/HiL selection.
- **problem→solution:** configure a tag + alarm → `forge.scada.tag(...)` +
  `forge.scada.alarm(tag, hihi/hi/lo/lolo, deadband, priority)`; bind a twin →
  `forge.twin.bind(body, signals)` + `forge.twin.aas(body)`; co-sim two FMUs →
  `forge.twin.fmu.import` + `forge.twin.cosim(masters, step)`; VC behavior model +
  fault injection → `forge.vcommission.behaviorModel` + `vc.injectFault`; edge
  normalize Modbus→MQTT → `forge.iiot.sparkplug` + `iiot.edge`.
- **design→critique:** "this alarm has no defined operator response → ISA-18.2
  rationalization failure; either remove or add response + priority".
- **Grounding:** procedure-correct + standards-cited; the *twin/VC numbers* are
  geometry/physics-true (run on the multibody/FEA kernel) and **carry the vvuq
  verdict** when the underlying solver is capped.

**`gen_plant_behavior`** (Mechatronics/Robotics/Twin physics — the behavior spine)
- **problem→solution:** derive plant `M·q̈+C·q̇+K·q` from an assembly →
  `forge.mechatronics.plantModel(assembly)`; size a motor → `mecha.sizeMotor`;
  design a controller → `mecha.lqr(A,B,Q,R)` / `mecha.pid` / `mecha.placePoles`;
  Bode margins → `mecha.bode` + `mecha.margins`; robot FK/IK → `forge.robotics.fk/ik`;
  jerk-limited trajectory → `robot.traj(q0,q1,'scurve')`; RRT* plan → `robot.plan`.
- **Grounding:** physics-true on the validated HHT-α multibody DAE + FEA solvers
  (pendulum 0.016%, static 0.33%) — *replay the dynamics and assert energy/
  constraint-drift monitors stay in band*.

**`gen_systems_req`** (Systems-Eng / Requirement-Eng / MBSE — the spec spine)
- **Q/A:** is this a valid requirement (29148 attributes)? which EARS pattern?
  which verification method (I/A/D/T)? trace-coverage of a matrix.
- **problem→solution:** decompose a stakeholder need → system requirements with
  allocation; build a requirement→feature→FEA-result→drawing→inspection trace via
  the digital-thread linker → `forge.plm.*` trace ops; trade study with weighted
  objectives.
- **design→critique:** rewrite "the system shall be fast" into a verifiable EARS
  requirement with a measurable bound and verification method.
- **Grounding:** standards-cited (29148/15288/SysML) + procedure-correct;
  *coverage numbers are graph-true* (computed over the real trace graph).

**`gen_bim_gis`** (BIM/GIS — the spatial-enterprise spine)
- **problem→solution:** place walls/storeys → `forge.bim.placeWall` / `bim.storey`;
  clash detection → `forge.bim.clashDetect(setA,setB)` (broad+narrow phase, hard vs
  clearance); IDS validation → `bim.idsValidate`; export IFC → `bim.exportIFC`;
  CRS transform → `forge.gis.crs(from,to)`; buffer/overlay (reusing CAD booleans) →
  `gis.buffer/clip/overlay`; georeference BIM → IFC4.3 + CRS.
- **Grounding:** **geometry-true** — clash volume and CRS transform are computed by
  the kernel/PROJ-style transform and **replay-verified**; IFC entity/Pset names
  standards-cited.

**`gen_cim_capp`** (CIM/CAPP — the make-the-design spine; manufacturability)
- **problem→solution:** recognize machining features → `forge.cim.recognizeFeatures(body)`
  (AAG + VF2); generate a process plan → `cim.processplan(part)` (setup→op→tool→
  feed/speed→cycle-time); GT code → `cim.gtCode`; FMS routing → `cim.fmsRoute`.
- **design→critique (the manufacturability core):** "this 12 mm-deep, 3 mm-wide
  blind pocket needs a 6:1 L/D tool → chatter + tool deflection; widen, add a
  corner radius ≥ tool radius, or split the operation" — then the corrected
  `part.*` + `cim.processplan` call.
- **Grounding:** geometry-true (feature recognition runs on the real B-Rep; replay-
  verify the recognized feature set against the as-built geometry).

### 3.3 How this makes Archie better *inside Forge* (drive the CAD, not chat)
The whole point (memory `forge-archie-cua-governing`): Archie drives Forge **purely
via CUA**, and every sample **terminates in a real `forge.*` call**. This cluster
specifically buys:

- **The data-graph spine turns geometry into enterprise truth.** Because the BOM /
  mass / cost / where-used roll-ups are *derived from the assembly Archie itself
  builds*, training on `gen_plm_graph` makes Archie produce designs whose
  *downstream artefacts are correct by construction* — a manufacturable part that
  also yields a correct MBOM, a costed roll-up, and a change-impact set. That is
  the difference between "a model" and "a released, buildable, lifecycle-managed
  product."
- **CADGenBench interface/topology axes.** Where-used closure, BOM diff, effectivity
  resolution, and feature recognition are *topological reasoning over the assembly
  graph* — directly the interface + topology dimensions the ≥0.85 gate scores.
- **The live `pdm.{branch,commit,diff,merge}` + `assembly.solve` + `drawing.*`
  verbs already exist** — so `gen_plm_graph` / `gen_systems_req` samples replay
  *today*, no kernel work blocked. The scoped `forge.{plm,erp,cm,bim,gis,twin,scada,
  mechatronics,robotics,cim,iiot,vcommission}` verbs (fields_sister §1–20) are the
  forward targets; samples are authored to that schema so they go live the moment
  the verb binds.
- **Manufacturability + correctness in every aspect.** `gen_cim_capp` design→critique
  + `gen_plant_behavior` physics + `gen_signal_fabric` operability together force
  Archie to reason about *can it be made, will it hold, can it be run* — the senior-
  engineer triad — not just *does the geometry close*.

### 3.4 Quality gates on the corpus (reuse existing scripts)
`coherence_gate.py` (drop incoherent), `critic_synth.py` (self-critique pairs),
`dpo_synth.py` (preference pairs: correct effectivity vs wrong, rationalized alarm
vs orphan), `forge_drive_smoke_14b_v2.py` (replay the terminal call), schema
validator (every `forge.*` call schema-valid against ForgeToolBridge), standards
validator (entity/clause names against the schema text). NaN-guard the run; **drop
`--mask-prompt`** on long samples (memory `feedback-mlx-maskprompt-truncation-nan`);
carry the chat template (raw `--prompt` garbles).

### 3.5 Target corpus scale (this cluster)
~**1.2–1.6M unique samples**, mixed: ~45% geometry-true (data-graph + BIM/GIS +
CIM, replay-verified), ~30% standards-cited, ~25% procedure-correct. Generators ≈
12 (§3.2 modules sub-split per field), each 80k–150k/run, accumulator-deduped to
the unique target. ~**8–10k LOC** of `bulk_synth_*` generator + answer-key +
validator code (mostly answer-key encoders for the standards numbers and the
kernel-replay harness, which is largely the existing `ForgeCADScore`/smoke seam).

---

## 4. EXAMPLE TRAINING SAMPLES (depth illustration)

### Sample A — PLM / Configuration-Management (geometry-true + standards-cited, terminal call)
**system:** You are Archie, a senior digital-thread engineer driving Forge. Reason
step by step, cite the governing standard, and end with the `forge.*` call(s) that
realize the answer.
**user:** A released bracket (P/N BR-1042, Rev C) has a hole moved 2 mm to clear an
interfering harness found in service. It is on a serialized aircraft assembly,
units 001–047 already built and flying. Do I bump the revision or the version, what
effectivity do I use, and what's the change path? Drive it in Forge.
**assistant:**
*Step 1 — revision vs version (ISO 10303 AP242 / EIA-649C).* Moving the hole changes
**form-fit-function** (it changes the mating interface), so this is a **revision
bump C→D**, not a new working version. A version is an in-work iteration of the same
released identity; this is a released, interface-affecting change → new revision.

*Step 2 — effectivity (EIA-649C change management).* The 47 built units are flying;
the change must **cut in** without invalidating the as-built config of 001–047. Use
**serial (unit) effectivity**: Rev D effective **unit 048-on**. Date effectivity is
wrong (units aren't built on a clean date boundary) and lot effectivity doesn't
apply to serialized airframes. Units 001–047 may need a **retrofit ECO** disposition
(rework vs use-as-is per stress re-analysis) — that's a separate disposition line.

*Step 3 — change path (EIA-649C five functions / CCB).* ECR (the interference
finding) → CCB review → **ECO** with disposition + serial cut-in → release Rev D →
status-accounting records both configs. The where-used closure tells me every
assembly that must absorb the change.

*Step 4 — drive Forge.* Find impact, run the change, set effectivity:
```
forge.plm.changeImpact(part="BR-1042")        // where-used closure + effectivity intersect
forge.cm.eco(change={item:"BR-1042", from:"C", to:"D",
                     reason:"harness interference",
                     effectivity:{type:"serial", cutIn:48},
                     disposition:{builtUnits:"1-47", action:"retrofit-review"}})
forge.plm.promote(item="BR-1042/D", state="Released")
```
*Honesty note:* the retrofit disposition for units 1–47 requires a stress re-analysis
before "use-as-is" — I will not assert it is safe without running `forge.simulate`
on the new hole location and checking margins.

---

### Sample B — Mechatronics / Digital-Twin (physics-true, validated solver, terminal call)
**system:** (same persona)
**user:** I have a 5:1 geared rotary axis: load inertia 0.040 kg·m², motor rotor
inertia 0.0012 kg·m², required move 90° in 0.25 s. Is the inertia match sane, what
trajectory profile, and stand up a digital twin of the axis. Drive it in Forge.
**assistant:**
*Step 1 — reflected inertia & match.* Reflected load inertia
`J_refl = J_load / N² = 0.040 / 5² = 0.0016 kg·m²`. Inertia ratio
`J_refl / J_motor = 0.0016 / 0.0012 = 1.33`. That is within the healthy
**1–3:1** band (≈ ideal ≤ 3 for stiff response), so the gear ratio is well chosen —
no inertia-mismatch instability expected.

*Step 2 — trajectory.* 90° = 1.5708 rad in 0.25 s. A **trapezoidal** profile is
fine kinematically, but if the axis structure has a low first mode I prefer an
**S-curve (jerk-limited)** profile to avoid exciting it. Peak accel for a triangular
(no cruise) trapezoid: `a_pk = 4θ/t² = 4·1.5708/0.0625 = 100.5 rad/s²` →
required accel torque on the load side `τ = J_total·a` (size against the motor's
torque-speed curve via `mecha.sizeMotor`).

*Step 3 — plant + twin.* Derive `M·q̈+C·q̇+K·q` for the axis from its assembly and
bind a digital twin (AAS Nameplate/TechnicalData/BOM derived from geometry +
mass-props), running on the validated HHT-α multibody DAE solver (pendulum benchmark
0.016%).
```
forge.mechatronics.plantModel(assembly="rotaryAxis")
forge.mechatronics.sizeMotor(load={J:0.040, N:5}, profile={angle:1.5708, time:0.25, type:"scurve"})
forge.robotics.traj(q0=0, q1=1.5708, profile="scurve", dt=0.25)
forge.twin.bind(body="rotaryAxis", signals=["pos","vel","torque"])
forge.twin.aas(body="rotaryAxis")
```
*Verification:* the twin's dynamics replay on the in-house DAE solver; I'll watch the
energy + constraint-drift monitors stay in band before trusting any twin number.

---

### Sample C — CIM / DFM manufacturability critique (geometry-true feature recognition, terminal call)
**system:** (same persona)
**user:** Here is a plate with a pocket I sketched: 80×40 mm plate, pocket 60×4 mm,
12 mm deep, sharp internal corners, flat floor. Recognize the features, tell me if
it's machinable as drawn, and fix it in Forge.
**assistant:**
*Step 1 — feature recognition (AAG + VF2).* On the B-Rep, the attributed adjacency
graph gives one rectangular **blind pocket** (concave floor-wall edges, 4 vertical
walls + 1 floor) in an 80×40×T plate. Subgraph-isomorphism against the feature
library labels it pocket, not slot (it's closed on all four sides).

*Step 2 — manufacturability (DFM judgment).* Two problems:
1. **Aspect ratio.** Pocket is 4 mm wide, 12 mm deep → an end mill ≤ 4 mm dia must
   cut 12 mm deep = **3:1 L/D minimum** (worse with clearance). At 3:1+ a small
   end mill deflects and chatters → out-of-tolerance walls. Senior call: this needs
   a step-down strategy and is marginal at 4 mm width.
2. **Sharp internal corners are not machinable** — a rotating tool leaves a radius
   = tool radius. A 4 mm-wide pocket forces a ≤ 2 mm tool, so the corners will be
   **R ≤ 2 mm** whether you draw them sharp or not. Drawing sharp corners is a
   spec the process *cannot* meet.

*Step 3 — fix.* Add corner radii ≥ tool radius (model R2), confirm width tolerates a
3 mm tool with ≥0.5 mm radial clearance, and plan the pocket with a step-down. Then
generate the process plan.
```
forge.part.begin(name="plate")
forge.part.box(dx=80, dy=40, dz=12)
forge.part.holes(...)                 // (if any)
forge.part.fillet(edges="pocketCorners", radius=2)   // corners machinable now
forge.cim.recognizeFeatures(body="plate")            // re-verify: pocket + R2 corners
forge.cim.processplan(part="plate")                  // setup→endmill Ø3→step-down→cycle-time
```
*Result:* as-drawn it is **not** manufacturable to print (sharp corners,
marginal L/D); with R2 corners and a step-down plan it is. The recognized feature
set replays against the kernel B-Rep to confirm the fix took.

---

## 5. SEQUENCING NOTE (how this cluster trains)

Per the program's adapter topology: this cluster is the **data-graph / signal-
fabric / spec** lobe — train it as a **per-cluster LoRA** on top of the foundational
(math/logic/reasoning) adapter, *after* the geometry-gen and CAE-physics clusters
(it consumes their assembly/solver truth). Curriculum order within the cluster:
**(1) the data-graph spine** (PLM/PDM/CM/ERP/MES — most replay-verifiable, builds
on existing `pdm.*`+`assembly.solve` verbs) → **(2) systems/requirements** (the
spec discipline that frames everything) → **(3) CIM/manufacturability** (make-the-
design) → **(4) signal-fabric + behavior** (SCADA/twin/VC/IIoT/mechatronics/
robotics, which consume the physics solvers) → **(5) BIM/GIS** (spatial enterprise).
Hardware-calm: serve XOR train, storage-safe streaming throughout.
