# Sister Fields — Capability + Corpus Taxonomy

Scope research for ArchDisc (Forge engine + Archie 14B CUA model). For each of
the 20 sister fields adjacent to MCAD/CAM/CAE: (a) the CORE KNOWLEDGE Archie
must master, (b) the CONCRETE engine/tool/op Forge must provide, (c) key
STANDARDS / tools / algorithms / data-formats, (d) TRAINING-DATA topics and
sources for the corpus. Engineering-grade, exhaustive, no "lite" field, dynamic
features only (mechanisms, flow, state, time — not static templates).

North-star reminder: Archie-drives-Forge must hit **≥ 0.85 on CADGenBench across
every dimension**. Every capability below must be a real algorithm with named
data structures, governing equations, function-level ops — not a generator or a
template. Where a field overlaps an existing Forge kernel module, the headline
calls the seam to bind, not re-scaffold.

---

## 1. PLM — Product Lifecycle Management

**(a) CORE KNOWLEDGE.** The full digital-thread lifecycle: requirements → concept
→ design → V&V → manufacturing → service → disposal. Item/part master, revision
vs version semantics (revision = form-fit-function change, version = working
iteration), effectivity (date/lot/serial/unit effectivity), where-used &
where-referenced graphs, EBOM ↔ MBOM ↔ SBOM transformation, change-impact
propagation. ISO 10303 STEP architecture (700+ parts, EXPRESS schema language,
SDAI), AP242 (managed model-based 3D engineering: geometry + PMI + GD&T + BOM +
material + ECO history), AP239/PLCS (ISO 10303-239, cradle-to-grave through-life
support: product, activity, resource, organization, justification model). PLCS
DEX/OASIS data exchange sets. Digital thread vs digital twin distinction.
Closed-loop lifecycle (BOL/MOL/EOL feedback). Multi-CAD coexistence.

**(b) FORGE CAPABILITY (engine/op).** A `forge.plm` item-master graph store:
persistent `ItemMaster{partNumber, revision, version, effectivity, lifecycleState}`
keyed to kernel `NamedSolid.originalID`. Ops: `plm.promote(item, state)` running a
real state machine (InWork→InReview→Released→Obsolete with gate predicates),
`plm.whereUsed(part)` (reverse-index BFS over assembly graph), `plm.bomTransform(ebom→mbom)`
(phantom-collapse, make/buy split, process-step insertion), `plm.changeImpact(part)`
(propagate dirty-flag through where-used closure + effectivity intersection).
Digital-thread linker binding requirement→feature→FEA-result→drawing→inspection.

**(c) STANDARDS / TOOLS / ALGORITHMS / FORMATS.** ISO 10303 STEP (EXPRESS, Part 21
clear-text, Part 28 XML, AP203/AP214/AP242/AP239); PLCS (10303-239) + OASIS PLCS
DEXs; ISO 8000 (data quality); OSLC (Open Services for Lifecycle Collaboration,
RDF/linked-data); JT (ISO 14306) for lightweight viz; QIF (ISO 23952) for the
metrology thread. Algorithms: directed-acyclic effectivity resolution, BOM
graph diff (tree-edit-distance / largest-common-subtree), revision-rule
evaluation, set-cover for variant rollups.

**(d) TRAINING-DATA TOPICS / SOURCES.** EXPRESS schema text of AP242/AP239 and
worked Part-21 instance files; ECO/ECN/ECR workflow narratives; EBOM→MBOM
transform examples; effectivity-rule Q/A (date vs serial vs lot); where-used
query/answer pairs over synthetic assemblies; OSLC link examples. Sources:
ISO 10303 spec text, AP242.org domain model, Eurostep PLCS DEX library, NIST
STEP test suites, OASIS PLCS schemas.

---

## 2. PDM — Product Data Management

**(a) CORE KNOWLEDGE.** Vaulting (check-in/check-out, optimistic vs pessimistic
locking), file-based vs database-item PDM, lifecycle states & maturity, revision
control with branching/merging of CAD trees, reference/dependency resolution
(parent assembly ↔ child part ↔ drawing ↔ derived STEP), rename/replace
propagation, duplicate detection, family tables / configurations, derived-data
management (thumbnails, neutral exports, tessellations), workflow & approval
routing, access control (role/group ACL, ITAR/export segregation), file
naming/numbering schemes, viewables generation, eDrawings/JT publication.

**(b) FORGE CAPABILITY.** A `forge.pdm` content-addressed vault: every kernel
body serialized to a hashed blob (`brepHash = SHA-256(canonical-BRep)`), with a
metadata graph (item↔file↔derivation). Ops: `pdm.checkout(item)` / `pdm.checkin(item, parent)`
with three-way merge of the feature tree (LCA over feature-history DAG),
`pdm.rename(item)` that rewrites all reference edges atomically, `pdm.where_referenced(file)`,
`pdm.publish_viewable(body)` → JT/glTF tessellation, `pdm.dedupe()` by `brepHash`
+ geometric fingerprint (volume + inertia tensor invariants). Dependency
resolver that loads only the cut-set of a requested assembly.

**(c) STANDARDS / TOOLS / FORMATS.** STEP/JT/3D-PDF for neutral viewables; PLM
Services / OSLC for federation; content-addressable storage (Merkle DAG, git-
LFS-style); CAD reference graphs. Algorithms: three-way merge over a DAG (recursive
LCA), Rabin fingerprinting for blob chunking/dedupe, topological sort for load
order, geometric-hash invariants (volume, surface area, principal inertia) for
near-duplicate detection.

**(d) TRAINING-DATA TOPICS / SOURCES.** Check-in/out workflow narratives; revision
branch/merge scenarios; reference-repair after rename; family-table/configuration
Q/A; vault permission/ITAR segregation cases; derived-data publishing pipelines.
Sources: Aras Innovator / Windchill / Teamcenter object-model docs (structure,
not content), git internals (Merkle DAG), CAD reference-graph literature.

---

## 3. BIM — Building Information Modeling

**(a) CORE KNOWLEDGE.** IFC schema (ISO 16739, IFC2x3→IFC4→**IFC4.3** which adds
alignment/road/rail/bridge/port infrastructure + georeferencing): the inheritance
tree `IfcRoot → IfcObjectDefinition → IfcProduct/IfcProcess/IfcResource`, spatial
structure (`IfcProject→IfcSite→IfcBuilding→IfcBuildingStorey→IfcSpace`), elements
(`IfcWall, IfcSlab, IfcBeam, IfcColumn, IfcDoor, IfcDuctSegment, IfcPipeSegment`),
relationships (`IfcRelAggregates, IfcRelContainedInSpatialStructure,
IfcRelConnectsElements, IfcRelDefinesByProperties`), property sets (Pset_*),
geometry (swept solids, B-Rep, CSG, `IfcExtrudedAreaSolid`,
`IfcAdvancedBrep` w/ NURBS), `IfcAlignment` (horizontal/vertical/cant). openBIM
ecosystem: BCF (issue exchange), IDS (Information Delivery Specification — machine-
checkable requirements), bsDD (data dictionary), COBie (facility handover
spreadsheet). LOD/LOIN (level of information need), MVD (model view definitions),
clash detection, 4D (schedule) / 5D (cost) / 6D (sustainability) / 7D (FM).

**(b) FORGE CAPABILITY.** A `forge.bim` discipline that maps kernel solids to IFC
entities with a real spatial-structure tree, and exports valid IFC-SPF (STEP
Part-21 syntax). Ops: `bim.placeWall(path, height, type)` → `IfcWallStandardCase`
with material layer set; `bim.storey(level)`; `bim.clashDetect(setA, setB)` running
a real broad-phase (AABB/BVH) + narrow-phase (kernel boolean-intersect volume test,
hard vs soft/clearance clash); `bim.exportIFC(model)` / `bim.importIFC`;
`bim.idsValidate(model, ids)` (machine-check property/classification requirements);
`bim.cobie(model)` (derive handover table from psets). 4D linker binding elements
to a schedule (P6/MSP-style task graph) for time-sliced playback.

**(c) STANDARDS / TOOLS / FORMATS.** IFC (ISO 16739-1), IFC4.3, BCF 2.1/3.0
(XML+REST API), IDS (buildingSMART XML), COBie, bsDD, CityGML (urban context),
gbXML (energy), LandXML (civil). MVDs (Coordination View, Reference View). Algorithms:
BVH/AABB-sweep clash broad-phase + boolean narrow-phase, IfcAlignment arc-clothoid-
parabola stationing, spatial-containment point-in-polyhedron.

**(d) TRAINING-DATA TOPICS / SOURCES.** IFC entity/relationship Q/A; Pset lookups;
spatial-structure construction; clash-resolution narratives; IDS rule authoring;
COBie field derivation; LOD/LOIN definitions. Sources: buildingSMART technical
docs (IFC, BCF, IDS, COBie), open IFC sample models (e.g. building-smart sample
files), IfcOpenShell schema, CityGML spec.

---

## 4. CIM — Computer-Integrated Manufacturing

**(a) CORE KNOWLEDGE.** The full CAD→CAPP→CAM→CAQ→shop-floor integration loop;
the CIM wheel (product/process/business/facility integration). Computer-Aided
Process Planning (variant/retrieval via group-technology coding — Opitz/MICLASS,
vs generative CAPP from feature recognition). Feature recognition (machining
features: pockets, slots, holes, bosses, chamfers via graph-based AAG or
volumetric decomposition). Cellular manufacturing & group technology, flexible
manufacturing systems (FMS), automated material handling (AGV/AS-RS routing),
cell control hierarchy, ISA-95 levels 0–4 functional hierarchy bridging
control↔enterprise. Process plan = setup → operation → tool → parameters → time.

**(b) FORGE CAPABILITY.** `forge.cim.recognizeFeatures(body)` — real machining-
feature recognition on the kernel B-Rep via Attributed Adjacency Graph (face
nodes, edge arcs labeled convex/concave) + subgraph isomorphism against a feature
library (pocket, through/blind hole, slot, step, chamfer, fillet). `cim.processplan(part)`
→ ordered setup/operation/tool/feed-speed plan with cycle-time estimate from
material-removal-rate model. `cim.gtCode(part)` (Opitz-style shape code).
`cim.fmsRoute(jobset, cells)` — job-shop routing/sequencing (dispatch rules:
SPT/EDD/critical-ratio) over a cell graph. Binds CAM toolpath + CAPP into one DAG.

**(c) STANDARDS / TOOLS / ALGORITHMS.** ISA-95 (IEC 62264) functional hierarchy;
STEP-NC (ISO 14649 / AP238) for feature-based machine instructions; group-
technology coding (Opitz, MICLASS, DCLASS). Algorithms: AAG feature recognition,
subgraph isomorphism (VF2), volumetric decomposition (convex-hull difference),
MRR cycle-time models, job-shop scheduling (dispatch heuristics, disjunctive
graph).

**(d) TRAINING-DATA TOPICS / SOURCES.** Feature-recognition Q/A (face-graph →
feature); process-plan generation from part geometry; GT-code assignment; setup
planning; tool selection; cycle-time estimation; FMS routing. Sources: ISO 14649
STEP-NC, group-technology textbooks, AAG feature-recognition papers, machining-
feature datasets (e.g. MFCAD / FeatureNet style).

---

## 5. ERP — Enterprise Resource Planning (manufacturing core)

**(a) CORE KNOWLEDGE.** MRP → MRP II → ERP evolution. MRP logic: gross-to-net
explosion (gross requirement − on-hand − scheduled receipts → net requirement →
planned order receipt → offset by lead time → planned order release), low-level
code BOM explosion, lot-sizing (lot-for-lot, EOQ, POQ, Wagner-Whitin optimal),
safety stock & reorder point. MRP II adds CRP (capacity requirements planning,
infinite vs finite loading), MPS (master production schedule), rough-cut capacity.
BOM types (engineering/manufacturing/planning/phantom/super-BOM 150%), routings
(operation → work center → standard time → setup/run), work orders, costing
(standard vs actual, absorption, activity-based), inventory valuation (FIFO/LIFO/
weighted-avg). Demand planning (forecast: moving avg, exponential smoothing,
Holt-Winters). APICS/ASCM body of knowledge.

**(b) FORGE CAPABILITY.** `forge.erp` deriving an MBOM + roll-up cost + roll-up
mass directly from the assembly graph (the one geometry-true seam). Ops:
`erp.mrpExplode(mps, bom, inventory)` — real low-level-code gross-to-net netting
with lead-time offsetting producing planned orders; `erp.lotSize(demand, method)`
(LFL/EOQ/Wagner-Whitin DP); `erp.crp(routing, workcenters)` finite-capacity load
profile; `erp.rollupCost(assembly)` (material + labor·rate + overhead·burden by
BOM level); `erp.forecast(series, method)` (Holt-Winters). B2MML I/O for
ISA-95 level-3↔4 exchange (production orders down, performance up).

**(c) STANDARDS / TOOLS / FORMATS.** ISA-95 / IEC 62264 + **B2MML** (XML schema for
Level3↔4); APICS/ASCM dictionary; lot-sizing algorithms (Wagner-Whitin DP,
Silver-Meal heuristic). Forecasting: exponential smoothing, Holt-Winters,
ARIMA. Costing: standard-cost roll-up, ABC.

**(d) TRAINING-DATA TOPICS / SOURCES.** MRP explosion worked examples (gross→net
tables); lot-sizing comparisons; CRP load profiles; cost roll-up by BOM level;
forecast-method selection; B2MML message structure. Sources: APICS CPIM body of
knowledge, ISA-95/B2MML schema, MRP textbook worked problems, ERP module docs
(SAP/NetSuite/Odoo manufacturing) for structure.

---

## 6. MES — Manufacturing Execution System

**(a) CORE KNOWLEDGE.** MESA-11 functions (resource allocation & status,
operations/detail scheduling, dispatching production units, document control,
data collection/acquisition, labor management, quality management, process
management, maintenance management, product tracking & genealogy, performance
analysis). ISA-95 (IEC 62264) parts 1–8: equipment hierarchy (enterprise→site→
area→work-center→work-unit), object models (personnel/equipment/material/process-
segment), operations management (production/maintenance/quality/inventory),
activity model (detailed scheduling, dispatching, execution, data collection,
tracking, analysis, definition management). ISA-88 batch (procedural/physical/
recipe models — recipe→unit-procedure→operation→phase) sits beneath. OEE =
Availability × Performance × Quality; genealogy/as-built record; SPC (control
charts, Cp/Cpk).

**(b) FORGE CAPABILITY.** `forge.mes` execution layer over the CIM process plan:
`mes.dispatch(workorder, resource)` (real finite-capacity dispatch w/ ISA-95
equipment-hierarchy constraints), `mes.collect(unit, parameter)` time-series sink,
`mes.oee(line, window)` computing A×P×Q from down/run/reject events,
`mes.genealogy(serial)` (as-built BOM + process-history tree per serial),
`mes.spc(parameter)` (X̄-R / X̄-S control charts, Western Electric rules, Cp/Cpk).
ISA-88 recipe executor (phase state machine: idle→running→held→complete).

**(c) STANDARDS / TOOLS / FORMATS.** ISA-95 (IEC 62264) + B2MML; ISA-88
(IEC 61512) batch + BatchML; MESA-11; OEE/TEEP metrics; SPC (ISO 7870, Shewhart).
Algorithms: finite-capacity scheduling, control-chart limit computation,
capability indices, serial-genealogy tree.

**(d) TRAINING-DATA TOPICS / SOURCES.** MESA-11 function definitions; ISA-95
object-model Q/A; ISA-88 recipe hierarchy; OEE computation worked examples; SPC
rule firing; genealogy tracing. Sources: ISA-95/ISA-88 standard text, MESA white
papers, B2MML/BatchML schemas, SPC handbooks (Montgomery).

---

## 7. SCADA — Supervisory Control & Data Acquisition

**(a) CORE KNOWLEDGE.** Purdue/ISA-95 control hierarchy: L0 process (sensors/
actuators), L1 basic control (PLC/RTU/DCS controllers, scan cycle, I/O scanning),
L2 supervisory (SCADA/HMI, alarming, trending), L3 site/MES, L3.5 industrial DMZ,
L4 enterprise. Tag database, polling vs report-by-exception, alarm management
(ISA-18.2 — rationalization, prioritization, shelving, flood suppression),
historian (deadband compression, swinging-door), HMI design (ISA-101, situational
awareness/high-performance HMI). Protocols: **Modbus** (RTU/TCP, coils/registers),
**DNP3** (utility telemetry, event buffering, timestamping, unsolicited responses),
**OPC UA** (information model, address space, sessions, subscriptions, security
profiles), IEC 61850 (substation), EtherNet/IP, PROFINET.

**(b) FORGE CAPABILITY.** A `forge.scada` runtime layer driving the digital-twin/
virtual-commissioning surface: a **tag engine** (`scada.tag(name, type, deadband)`),
a polling/RBX scheduler, an **alarm manager** (`scada.alarm(tag, hi/hihi/lo/lolo,
deadband, priority)` with ISA-18.2 state machine: normal→unack-active→ack-active→
unack-RTN), an **historian** with swinging-door deadband compression
(`scada.historize(tag)` / `scada.query(tag, t0, t1)`), and protocol decoders
(`scada.modbus`, `scada.opcua` address-space browse). HMI mimic rendered on the
viewport bound to live tags from the kinematic twin.

**(c) STANDARDS / TOOLS / FORMATS.** Modbus, DNP3 (IEEE 1815), OPC UA (IEC 62541),
IEC 61850, IEC 61131-3 (PLC languages), ISA-18.2 (alarms), ISA-101 (HMI),
IEC 62443 (OT security). Algorithms: swinging-door / boxcar-backslope historian
compression, deadband filtering, alarm-flood suppression, scan-cycle scheduling.

**(d) TRAINING-DATA TOPICS / SOURCES.** Tag/alarm configuration; Modbus register
map decoding; DNP3 object/variation; OPC UA address-space modeling; alarm
rationalization; historian compression; HMI design rules. Sources: OPC Foundation
specs, Modbus spec (modbus.org), DNP3/IEEE 1815, ISA-18.2/ISA-101 standards,
Purdue model references.

---

## 8. Industrial Automation & Robotics

**(a) CORE KNOWLEDGE.** PLC programming (IEC 61131-3: Ladder LD, Function Block
FBD, Structured Text ST, Instruction List IL, Sequential Function Chart SFC) and
**IEC 61499** distributed event-driven function blocks. Robot kinematics: DH
parameters, forward kinematics (homogeneous transforms), inverse kinematics
(closed-form for 6R with spherical wrist via Pieper; numerical Jacobian/DLS for
redundant), differential kinematics & Jacobian, singularities, workspace.
Trajectory generation (joint-space cubic/quintic/trapezoidal/S-curve velocity
profiles, Cartesian linear/circular interpolation with quaternion SLERP for
orientation). Dynamics (Newton-Euler recursive, Lagrangian, computed-torque
control). Motion planning (RRT*, PRM, OMPL), collision checking. Robot
programming/offline (RoboDK-style), TCP/tool calibration, payload/reach. Safety
(ISO 10218, ISO/TS 15066 collaborative, speed-and-separation, power-and-force
limiting, light curtains/safe-torque-off).

**(b) FORGE CAPABILITY.** `forge.robotics` solver atop the multibody kernel:
`robot.fk(dh, q)` (homogeneous-transform chain), `robot.ik(dh, pose)` (Pieper
closed-form + DLS numerical fallback, all-solutions enumeration),
`robot.jacobian(q)`, `robot.traj(q0, q1, profile)` (trapezoidal/S-curve/quintic),
`robot.plan(start, goal, obstacles)` (RRT*/PRM with kernel-collision narrow-phase),
`robot.dynamics(q, qd, qdd)` (recursive Newton-Euler inverse dynamics), reachability/
workspace map, TCP calibration. Bind to the existing HHT-α multibody DAE solver
for closed-loop and contact dynamics. Cell layout with safety zones.

**(c) STANDARDS / TOOLS / ALGORITHMS.** IEC 61131-3, IEC 61499, ISO 9283 (robot
performance), ISO 10218 / ISO/TS 15066 (safety), DH convention, URDF/SDF robot
description, ROS/MoveIt, OMPL planners. Algorithms: Pieper IK, damped-least-squares,
recursive Newton-Euler, RRT*/PRM, GJK/EPA collision, SLERP orientation interp,
S-curve jerk-limited profiling.

**(d) TRAINING-DATA TOPICS / SOURCES.** DH-table → FK/IK Q/A; Jacobian/singularity
analysis; trajectory profile selection; collision-free path planning; Newton-Euler
torque computation; collaborative-safety zoning; IEC 61131-3 logic. Sources:
Craig / Spong robotics texts, URDF model libraries, OMPL/MoveIt docs, IEC 61131-3
& ISO 10218/TS 15066, robot-kinematics datasets.

---

## 9. Digital Twin Engineering

**(a) CORE KNOWLEDGE.** Twin taxonomy: digital model (no auto sync) → digital
shadow (physical→digital one-way) → digital twin (bidirectional) → twin aggregate.
**ISO 23247** (Digital Twin Framework for Manufacturing: observable manufacturing
element, OME data collection, device-comm, DT-entity, user entity, cross-system).
**Asset Administration Shell (AAS, IEC 63278-1)** — Industrie 4.0 standardized
digital twin: submodels (Nameplate, Technical Data, Documentation, Bill of Material,
etc.), Concept Descriptions, type vs instance (AAS Type 1 file/AASX, Type 2 server/
REST API, Type 3 P2P/I4.0 language). **FMI** (Functional Mock-up Interface 2.0/3.0)
+ FMU for model exchange & co-simulation; **SSP** (System Structure & Parameterization).
Co-simulation master algorithm (Jacobi/Gauss-Seidel coupling, macro/micro stepping,
rollback). Surrogate/ROM models (POD, Kriging, neural). Twin synchronization,
state estimation (Kalman/EKF/UKF/particle filters), predictive maintenance (RUL).

**(b) FORGE CAPABILITY.** `forge.twin` binding a kernel body + multibody/FEA/CFD
state to a live signal stream: `twin.bind(body, signals)`, `twin.aas(body)` →
emit AAS submodels (Nameplate/TechnicalData/BOM derived from geometry+mass-props),
`twin.fmu.import(path)` + `twin.cosim(masters, step)` (Gauss-Seidel/Jacobi master
algorithm over FMUs + the in-house solvers), `twin.estimate(measurements)` (EKF/UKF
state estimation), `twin.rom(fullModel)` (POD/Kriging surrogate for real-time),
`twin.rul(degradationModel)` predictive-maintenance. Drives SCADA tags + the
viewport's live kinematic playback.

**(c) STANDARDS / TOOLS / FORMATS.** ISO 23247, IEC 63278-1 (AAS) + AASX package,
FMI 2.0/3.0 + SSP, OPC UA (transport + companion specs), DTDL (Azure Digital Twins
Definition Language), W3C WoT Thing Description. Algorithms: co-sim master
(Jacobi/Gauss-Seidel, signal extrapolation), Kalman/EKF/UKF/particle filtering,
POD/Kriging/PCE surrogate, RUL (similarity/degradation models).

**(d) TRAINING-DATA TOPICS / SOURCES.** Twin-vs-shadow-vs-model definitions; AAS
submodel structure; FMU import & co-sim coupling; state-estimation filter choice;
ROM construction; RUL estimation. Sources: ISO 23247 / ap238.org, IDTA AAS specs
(admin-shell-io), Modelica/FMI standard, NIST digital-twin standards reports,
DTDL spec.

---

## 10. Mechatronics System Design

**(a) CORE KNOWLEDGE.** V-model & MBSE (SysML 1.x/v2: requirement, block-definition
BDD, internal-block IBD, activity, state-machine, parametric diagrams; RAAML safety
extension). Multi-domain modeling (Modelica acausal equation-based; bond graphs;
signal-flow). Co-design of mechanical plant + sensors + actuators + control +
embedded SW. Actuator/sensor selection (motor sizing: torque-speed, inertia
matching, reflected inertia, gear ratio optimization; sensor resolution/bandwidth/
noise). Control: PID tuning (Ziegler-Nichols, IMC, pole-placement), state-space
(controllability/observability, LQR/LQG, pole placement), frequency response
(Bode/Nyquist, phase/gain margin), discretization (Tustin/ZOH). Functional safety
(ISO 26262 ASIL A–D, HARA, FMEDA, FTA, hardware metrics SPFM/LFM/PMHF; IEC 61508 SIL).

**(b) FORGE CAPABILITY.** `forge.mechatronics` plant-model + controls co-sim atop
the multibody kernel: `mecha.plantModel(assembly)` (derive M·q̈+C·q̇+K·q from the
kinematic/dynamic graph), `mecha.sizeMotor(load, profile)` (reflected-inertia +
torque-RMS sizing with gear-ratio sweep), `mecha.pid(plant, spec)` /
`mecha.lqr(A,B,Q,R)` / `mecha.placePoles(A,B,desired)`, `mecha.bode(sys)` /
`mecha.margins(sys)`, `mecha.discretize(sys, Ts, method)`. SysML-style requirement→
block→parameter trace store; ISO 26262 HARA/FMEDA/FTA tables derived from the
architecture graph. Couples to `forge.twin` FMU co-sim.

**(c) STANDARDS / TOOLS / ALGORITHMS.** SysML (v1.6 / v2, OMG), Modelica, FMI,
bond graphs, ISO 26262 (ASIL), IEC 61508 (SIL), IEC 61511. Algorithms: Lagrangian/
Newton-Euler plant derivation, LQR (algebraic Riccati), pole placement
(Ackermann), Ziegler-Nichols/IMC tuning, controllability/observability Gramians,
Tustin discretization, FTA cut-set computation, FMEDA metric roll-up.

**(d) TRAINING-DATA TOPICS / SOURCES.** SysML diagram authoring; plant-model
derivation; motor sizing; PID/LQR/pole-placement design; Bode/margin analysis;
ISO 26262 ASIL determination + FMEDA/FTA. Sources: SysML spec (OMG), Modelica
standard library, Ogata/Franklin control texts, ISO 26262 / IEC 61508, motor-
sizing handbooks.

---

## 11. Additive Manufacturing Engineering

**(a) CORE KNOWLEDGE.** 7 AM process families (ISO/ASTM 52900: vat photopoly,
material/binder jetting, material extrusion FDM, powder-bed fusion LPBF/EBM/SLS,
directed energy deposition DED, sheet lamination). DfAM (build orientation,
self-supporting angles, minimum feature/wall, residual stress, anisotropy,
overhang/bridging, support generation, nesting). LPBF physics (melt pool,
keyhole/conduction mode, lack-of-fusion vs keyhole porosity, balling, denudation,
spatter, scan strategy: stripe/chessboard/rotation, hatch spacing, energy density
E = P/(v·h·t)). Slicing (planar adaptive, plus non-planar), infill, perimeters,
support (tree/lattice/block). Lattices & TPMS (gyroid, Schwarz-P, diamond, IWP,
Voronoi, strut/BCC/FCC), graded/conformal lattices. Topology-opt → AM workflow.
Process simulation (inherent-strain / thermo-mechanical distortion prediction).
Build prep, recoating, powder management, post-processing (HIP, heat-treat).

**(b) FORGE CAPABILITY.** `forge.am` over the kernel + implicit/SDF layer:
`am.orient(body)` (build-orientation optimizer: support volume + surface quality +
build height objective), `am.support(body, angle)` (overhang detection by
face-normal·build-dir, tree/lattice support generation), `am.slice(body, layerH)`
(adaptive planar slicing via plane-mesh intersection → closed contours),
`am.infill(contours, pattern, density)`, `am.lattice(body, type, cellSize, grading)`
(TPMS gyroid/Schwarz-P via signed-distance field on a voxel grid → marching cubes;
Voronoi/strut lattices), `am.path(layer)` (hatch + contour toolpath, scan strategy),
`am.distortion(body, process)` (inherent-strain FEA predicting warp), `am.export(3MF)`.

**(c) STANDARDS / TOOLS / FORMATS.** ISO/ASTM 52900 (terminology), 52902/52904/
52911 series; file formats **STL, AMF, 3MF** (+ 3MF beam-lattice & volumetric
extensions), G-code; QIF for inspection. Algorithms: SDF/implicit TPMS evaluation,
marching cubes / dual contouring, adaptive slicing, overhang detection, tree-support
generation, inherent-strain distortion, nesting (bin packing).

**(d) TRAINING-DATA TOPICS / SOURCES.** DfAM rule Q/A (orientation, support angle,
min feature); energy-density/scan-strategy; TPMS/lattice equations; slicing &
infill; distortion prediction; 3MF structure. Sources: ISO/ASTM 52900 series,
3MF Consortium spec, nTop/Carbon DfAM guides, LPBF physics papers (NIST AM-Bench),
TPMS literature.

---

## 12. Generative Design Engineering

**(a) CORE KNOWLEDGE.** Generative design = constraints + goals + manufacturing
method → many synthesized candidates (Pareto-explored), distinct from single-
solution topology-opt. Implicit/field-driven modeling (nTop-style: every body a
single function f(x,y,z); booleans = min/max; offset = ±d; blends = smooth-min;
lattices = periodic implicit field; fields drive parameters per point). Signed-
distance fields (SDF), function representation (FRep), R-functions for booleans.
Multi-objective optimization (NSGA-II, MOEA/D, Pareto front), surrogate-assisted
(Bayesian/Kriging), design-space exploration, constraint handling, manufacturing-
aware synthesis (per-process: cast/machined/AM/sheet). Convergent/hybrid modeling
(mesh + B-Rep + implicit in one). Generative for lattices, heat exchangers,
brackets, conformal cooling.

**(b) FORGE CAPABILITY.** A first-class **implicit/SDF engine** `forge.implicit`
beside the B-Rep kernel: `implicit.sphere/box/gyroid(...)` primitives as SDFs,
`implicit.union/subtract/intersect` (min/max + smooth-min `smin`), `implicit.offset(f, d)`,
`implicit.field(scalarFn)` driving per-point parameters, `implicit.lattice(domain, unitCell, gradeField)`,
`implicit.toMesh(f, grid)` (marching cubes / dual contouring), `implicit.toBRep`
(re-fit). Generative loop `gen.explore(goals, constraints, method)` running
NSGA-II / MOEA/D over a parametric+implicit design space with kernel-evaluated
mass/FEA-stress/manufacturability objectives → Pareto set. Convergent modeling
binding mesh+B-Rep+implicit.

**(c) STANDARDS / TOOLS / ALGORITHMS.** FRep/HyperFun, R-functions (Rvachev),
SDF/implicit math, smooth-min blends. Optimizers: NSGA-II, MOEA/D, SPEA2, Bayesian
optimization (GP-EI), CMA-ES. Meshing: marching cubes, dual contouring, surface
nets. Convergent modeling (mesh↔BRep↔implicit). Output: 3MF, STEP.

**(d) TRAINING-DATA TOPICS / SOURCES.** Implicit/SDF construction; smooth-min
blends; field-driven lattice grading; multi-objective Pareto exploration; surrogate-
assisted optimization; manufacturing-method-aware synthesis. Sources: nTop
implicit-modeling blog series, FRep/HyperFun literature, NSGA-II/MOEA/D papers,
Rvachev R-functions, libfive/SDF references.

---

## 13. Topology Optimization

**(a) CORE KNOWLEDGE.** Density methods: **SIMP** (Solid Isotropic Material with
Penalization — E(ρ)=E_min+ρ^p(E0−E_min), penalty p≈3, design var = element
density ρ∈[0,1]), RAMP. **BESO/ESO** (evolutionary, discrete add/remove by
sensitivity ranking). **Level-set** (boundary as zero level-set of φ, Hamilton-
Jacobi evolution, shape derivative), parametric level-set (RBF). Homogenization.
Objective = compliance min s.t. volume fraction; KKT/optimality-criteria update
or MMA (method of moving asymptotes). Sensitivity analysis via **adjoint method**
(∂c/∂ρ_e = −p ρ_e^{p−1} u_e^T k0 u_e for self-adjoint compliance). Regularization:
density/sensitivity filtering (length-scale control), **Heaviside projection**
(crisp 0/1, β-continuation), robust formulation (eroded/intermediate/dilated).
Manufacturing constraints (min member size, overhang for AM, casting/extrusion
mold-removal, symmetry). Multi-load, stress-constrained (p-norm aggregation),
compliant mechanisms, multi-material, thermal/thermoelastic, frequency (eigenvalue),
buckling.

**(b) FORGE CAPABILITY.** `forge.topopt` over the **real** in-house FEA solver
(the validated stiffness solve, not beam-approx): `topopt.simp(domain, loads, BCs,
volFrac, penal)` running the full loop — assemble K(ρ), solve KU=F, compute
compliance + adjoint sensitivities, density+sensitivity filter (conv. radius r_min),
Heaviside projection (β-continuation), OC or MMA update, converge; `topopt.levelset(...)`
(shape-derivative + reinitialized HJ evolution); `topopt.beso(...)`. Manufacturing
constraints: `topopt.constrainOverhang(angle)`, `topopt.minMember(d)`, symmetry/
extrusion/casting filters. Stress-constrained (p-norm), modal (eigenvalue),
thermal variants. Output → smooth surface (marching cubes + Taubin smoothing) →
B-Rep re-fit for downstream CAD/AM.

**(c) STANDARDS / TOOLS / ALGORITHMS.** SIMP/RAMP, BESO/ESO, level-set (HJ + shape
derivative), MMA (Svanberg), optimality criteria, adjoint sensitivity, density/
sensitivity/Heaviside filters, p-norm stress aggregation, eigenvalue derivatives.
Reference: 88-line / top99 educational codes scaled to 3D + real FEA.

**(d) TRAINING-DATA TOPICS / SOURCES.** SIMP formulation & penalty; adjoint
sensitivity derivation; filter/projection choice & length scale; OC vs MMA update;
stress/modal/thermal variants; AM-overhang & casting constraints. Sources: Bendsøe
& Sigmund text, Sigmund's 99/88-line papers, Svanberg MMA, level-set TO papers
(Wang/Allaire), stress-constrained TO literature.

---

## 14. Reverse Engineering & Metrology

**(a) CORE KNOWLEDGE.** Scan→CAD pipeline. Acquisition (laser line, structured-
light, photogrammetry, CT/CMM touch-probe). Point-cloud processing: filtering/
denoising (statistical/radius outlier removal, MLS smoothing), normal estimation
(PCA on k-NN/eigenvectors), downsampling (voxel grid), **registration** (coarse:
FPFH+RANSAC/4PCS; fine: **ICP** point-to-point/point-to-plane, NICP non-rigid,
global multi-view). Surface reconstruction: **ball-pivoting**, **Poisson** (screened
Poisson, octree), Delaunay/alpha-shapes, marching cubes. Segmentation into analytic
primitives (RANSAC plane/cylinder/sphere/cone/torus fitting) → feature tree →
parametric re-build (auto-surfacing, NURBS fitting to regions). **Metrology &
inspection**: best-fit alignment (Gaussian/least-squares, datum/RPS/3-2-1),
deviation color maps (scan vs nominal CAD), GD&T verification (form: flatness/
cylindricity/circularity; orientation; location; profile), measurement uncertainty
(GUM), CMM probing strategy.

**(b) FORGE CAPABILITY.** `forge.reveng`: `re.import(cloud)`,
`re.denoise/normals/downsample`, `re.register(src, dst, method)` (FPFH+RANSAC
coarse → point-to-plane ICP fine, returns SE(3) transform + RMS), `re.reconstruct(cloud, method)`
(Poisson/ball-pivoting → mesh), `re.fitPrimitive(region, type)` (RANSAC + least-
squares plane/cylinder/sphere/cone/torus), `re.autoSurface(mesh)` → NURBS-patch
fit → B-Rep, `re.toFeatureTree`. `forge.metrology`: `met.align(scan, nominal, datums)`
(best-fit / RPS / 3-2-1), `met.deviation(scan, nominal)` (signed-distance color map +
stats), `met.gdtVerify(scan, fcf)` (real **geometric** evaluation of flatness/
cylindricity/position from points — the gap noted in kernel audit), `met.uncertainty(GUM)`.
QIF I/O.

**(c) STANDARDS / TOOLS / ALGORITHMS.** **QIF** (ISO 23952), DMIS, I++DME, ASME
B89 (CMM performance), ISO 10360 (CMM acceptance), GUM (uncertainty), ASME Y14.5 /
ISO GPS (the tolerances being verified). Algorithms: ICP (point/plane), FPFH,
RANSAC fitting, Poisson/screened-Poisson, ball-pivoting, MLS, alpha-shapes,
least-squares Gaussian best-fit, Chebyshev (min-zone) for form tolerances.

**(d) TRAINING-DATA TOPICS / SOURCES.** Registration method choice; ICP variants;
reconstruction (Poisson vs BPA); primitive fitting; auto-surfacing; best-fit
alignment & datum strategy; GD&T-from-points; uncertainty budgeting. Sources:
Open3D/PCL/CGAL docs, QIF (ISO 23952) + DMIS, ASME B89 / ISO 10360, point-cloud
registration & surface-reconstruction literature, GUM.

---

## 15. Computational Geometry

**(a) CORE KNOWLEDGE.** Core structures: doubly-connected edge list (DCEL/half-edge),
winged-edge, quad-edge; BVH, k-d tree, octree, BSP, R-tree for spatial queries.
Core algorithms: convex hull (Graham scan O(n log n), QuickHull, gift-wrapping,
incremental, 3D Clarkson-Shor), Delaunay triangulation (Bowyer-Watson incremental,
divide-&-conquer, Fortune sweep) + Voronoi duality, constrained Delaunay, alpha-
shapes; line-segment intersection (Bentley-Ottmann sweepline), point location
(trapezoidal map), polygon triangulation (ear-clipping, monotone decomposition),
Minkowski sums, polygon offsetting (straight skeleton), boolean on polygons
(Vatti/Greiner-Hormann), arrangement of curves. **Robustness**: exact geometric
computation, **robust predicates** (Shewchuk adaptive-precision orient2d/3d/incircle/
insphere), floating-point filters (interval/static/lazy), simulation of simplicity
(SoS) for degeneracies, snap-rounding. Closest-point/distance (GJK, EPA), mesh
booleans (exact via Nef polyhedra / plane-based / indirect predicates).

**(b) FORGE CAPABILITY.** Harden the kernel's geometry foundation: a `forge.cg`
library exposing `cg.convexHull2d/3d`, `cg.delaunay/voronoi`, `cg.triangulate(polygon)`
(ear-clip + monotone), `cg.segmentIntersect` (Bentley-Ottmann), `cg.minkowski`,
`cg.offsetPolygon` (straight skeleton), `cg.straightSkeleton`, and crucially a
**robust-predicate** core (`orient2d/3d`, `incircle`, `insphere` via Shewchuk
adaptive precision + FP filters) underneath the boolean engine to fix the audit's
known boolean fragility (empty geometry after ~30 sequential subtractions). Spatial
indices (`cg.bvh/kdtree/octree`) for the kernel's picking/raycast and CAM/clash.

**(c) STANDARDS / TOOLS / ALGORITHMS.** CGAL (reference for exact predicates/
constructions, Nef polyhedra, EGC, lazy kernel); Shewchuk robust predicates;
Qhull (hull/Delaunay/Voronoi/halfspace). Algorithms as above. Exact arithmetic
(arbitrary-precision, interval, lazy-exact), snap-rounding, SoS.

**(d) TRAINING-DATA TOPICS / SOURCES.** Hull/Delaunay/Voronoi construction;
sweepline intersection; triangulation; robust-predicate orientation tests; exact
vs filtered arithmetic; degeneracy handling; spatial-index queries. Sources:
de Berg "Computational Geometry", CGAL manual, Shewchuk predicates paper, Qhull
docs, mesh-boolean robustness papers (indirect predicates, Cherchi et al).

---

## 16. Computer Graphics & Geometric Modeling

**(a) CORE KNOWLEDGE.** Geometric modeling: NURBS (B-spline basis via Cox-de Boor,
knot vectors, rational weights, de Boor evaluation, knot insertion/removal/refine,
degree elevation, Bézier extraction, surface-surface intersection by tracing/
subdivision/Newton), subdivision surfaces (Catmull-Clark, Loop, Doo-Sabin),
T-splines, implicit/SDF, mesh processing (decimation/QEM, remeshing, smoothing
Laplacian/Taubin, parameterization LSCM/ARAP, simplification, repair). Rendering:
rasterization pipeline, **physically-based rendering** (Cook-Torrance/GGX BRDF,
microfacet, energy conservation, metallic-roughness), **path tracing/ray tracing**
(Monte-Carlo, importance sampling, BVH traversal, MIS, denoising), global
illumination, shadow/AO/SSR, tone mapping (ACES), color (linear/sRGB), HDRI/IBL.
Animation (skeletal/skinning, kinematics, keyframe, physically-based). Scene graph,
LOD, frustum/occlusion culling.

**(b) FORGE CAPABILITY.** This is the field Forge most overlaps; the seam is
completion not creation. `forge.nurbs`: full NURBS curve/surface (Cox-de Boor,
de Boor eval, knot insert/remove/refine, degree elevation, Bézier extraction,
SSI by subdivision+Newton tracing) — the parasolid-parity plan's Phase 1–3.
`forge.subdiv` (Catmull-Clark/Loop). `forge.meshproc` (QEM decimation, Taubin
smoothing, LSCM/ARAP UV, remesh, repair). Rendering already strong (GPU path
tracer, PBR, IBL per memory) — bind it: `render.pbr(material)`, `render.pathtrace(scene)`,
deterministic for offline harvest. NURBS↔mesh interop (adaptive curvature-driven
tessellation, chord-tolerance).

**(c) STANDARDS / TOOLS / ALGORITHMS.** NURBS (Piegl & Tiller "The NURBS Book"),
STEP B_SPLINE_* entities; glTF 2.0 (+KHR extensions), USD/USDZ, OpenPBR/MaterialX,
ACEScg. Algorithms: Cox-de Boor, de Boor, Oslo knot insertion, SSI tracing,
Catmull-Clark, QEM (Garland-Heckbert), GGX/Cook-Torrance, MIS path tracing, BVH,
LSCM/ARAP parameterization.

**(d) TRAINING-DATA TOPICS / SOURCES.** NURBS evaluation & knot ops; surface
intersection; subdivision rules; mesh decimation/parameterization; PBR BRDF;
path-tracing sampling; glTF/USD structure. Sources: "The NURBS Book", PBR Book
(pbrt), glTF 2.0 / USD specs, CGAL/libigl mesh-processing, OpenPBR/MaterialX.

---

## 17. GIS — Geographic Information Systems

**(a) CORE KNOWLEDGE.** Vector (point/line/polygon, simple-features OGC/ISO 19125,
WKT/WKB) vs raster (DEM, imagery, bands, resampling). **Coordinate reference
systems**: geographic (WGS84 EPSG:4326), projected (UTM, Web-Mercator EPSG:3857,
state-plane), datums & transformations (Helmert 7-param, NTv2 grid shift), geoid/
ellipsoid, EPSG registry, PROJ pipelines. Spatial operations (intersect/union/
buffer/clip/dissolve/overlay — same boolean geometry as CAD), spatial indices
(R-tree, quadtree, grid, geohash, H3), topology (DE-9IM relations), network analysis
(Dijkstra/A* routing, isochrones), interpolation (IDW, kriging, splines), DEM
analysis (slope, aspect, hillshade, watershed, viewshed). 3D city models (**CityGML**,
3D Tiles, LOD0–4), BIM↔GIS integration (georeferenced IFC4.3), terrain.

**(b) FORGE CAPABILITY.** `forge.gis` for siting/civil/infrastructure context:
`gis.crs(from, to)` (PROJ-style CRS transform, Helmert + grid-shift), `gis.import(geojson/gpkg/shp)`,
`gis.buffer/clip/overlay` (reuses the kernel's robust 2D booleans — same straight-
skeleton/Vatti machinery), `gis.rtree` spatial index, `gis.terrain(dem)` →
TIN/mesh, `gis.slope/aspect/hillshade/watershed/viewshed`, `gis.route(graph, a, b)`
(Dijkstra/A*), `gis.cityModel(buildings)` → CityGML/3D-Tiles. Georeference the BIM
model (IFC4.3 + CRS) so site/building/twin share one frame.

**(c) STANDARDS / TOOLS / FORMATS.** OGC simple features (ISO 19125), **WMS/WFS/
WMTS/WCS** + OGC API (Features/Tiles/Maps), **GeoPackage** (SQLite), GeoJSON,
Shapefile, KML, **CityGML**, 3D Tiles, GML, GeoTIFF/COG; EPSG registry, PROJ/GDAL,
WGS84. Algorithms: Helmert/NTv2 transform, R-tree/quadtree/H3, DE-9IM, Dijkstra/A*,
IDW/kriging, Delaunay TIN, viewshed/watershed.

**(d) TRAINING-DATA TOPICS / SOURCES.** CRS/projection transforms; spatial
predicates (DE-9IM); buffer/overlay; spatial indexing; DEM/terrain analysis;
routing; CityGML LODs; BIM-GIS georeferencing. Sources: OGC standards (ogc.org),
GeoPackage spec, EPSG/PROJ docs, GDAL, CityGML spec, GIS algorithm texts.

---

## 18. Configuration Management (engineering CM)

**(a) CORE KNOWLEDGE.** Five CM functions (EIA-649 / SAE EIA-649C): **CM planning,
configuration identification** (CI selection, part/document numbering, baselines:
functional/allocated/product/as-designed/as-built), **change management** (ECR
engineering change request → ECN/ECO engineering change notice/order; CCB control
board; classification major/minor; disposition; effectivity & cut-in),
**configuration status accounting** (CSA — what is the current/historical config of
every CI), **verification & audit** (FCA functional config audit, PCA physical
config audit). Variant/option configuration (constraint-based product configurator,
**150% / super-BOM** with selection rules, option codes, configurable BOM
resolution to a 100% buildable BOM), interchangeability & traceability, CMII
discipline, ISO 10007 guidance, AS9100/DO-178/DO-254 CM requirements.

**(b) FORGE CAPABILITY.** `forge.cm` over the PLM/PDM graph: `cm.baseline(set, type)`
(immutable snapshot of CI configs), `cm.eco(change)` (ECR→ECO state machine + CCB
gate + disposition + effectivity cut-in), `cm.csa(ci, asOf)` (status-accounting
query — config of any CI at any time/serial), `cm.audit(ci)` (FCA: requirements↔
design trace coverage; PCA: as-built ↔ as-designed BOM diff), `cm.configure(superBom,
options)` — a real **constraint-based configurator** (boolean/arithmetic option
rules → resolve 150% BOM to a valid 100% BOM; conflict detection via SAT/CSP).

**(c) STANDARDS / TOOLS / ALGORITHMS.** EIA-649C / EIA-649-1 (defense), ISO 10007,
MIL-HDBK-61A, CMII, ANSI/EIA-649; AS9100, DO-178C/DO-254 (aero CM). Algorithms:
constraint satisfaction / SAT for configurator rule resolution, BOM tree diff
(as-built vs as-designed), effectivity interval algebra, baseline immutability
(content-addressed), trace-coverage matrices.

**(d) TRAINING-DATA TOPICS / SOURCES.** Baseline types; ECR/ECO/CCB workflow;
status-accounting queries; FCA/PCA audit; 150%-BOM option resolution; effectivity
cut-in. Sources: SAE EIA-649C, ISO 10007, MIL-HDBK-61A, CMII training material,
product-configurator/SAT literature.

---

## 19. Virtual Commissioning

**(a) CORE KNOWLEDGE.** Commissioning a control system against a **simulated** plant
before hardware. Loop fidelity ladder: **MiL** (model-in-the-loop — controller
model vs plant model), **SiL** (software-in-the-loop — compiled/emulated PLC code
vs plant model, e.g. PLCSIM Advanced), **HiL** (hardware-in-the-loop — real PLC/
controller vs real-time plant model). Plant/behavior model (mechatronics: kinematics,
sensors/actuators, conveyors, signal logic — e.g. NX MCD, SIMIT). Signal exchange
PLC↔model (PLCSIM Prosim/Softbus, **OPC UA**, shared-memory). Real-time co-simulation,
synchronization/time-stepping, fault injection, cycle-time/throughput validation,
collision & reachability checks, operator-training simulators. Connectivity to
ISA-95 / SCADA / digital twin. Benefits: parallelize commissioning, reduce on-site
time, de-risk control logic.

**(b) FORGE CAPABILITY.** `forge.vcommission` binding the kinematic/multibody twin
to a logic layer: `vc.behaviorModel(assembly)` (kinematics + signal logic: limit
switches, prox sensors, drives from the kernel kinematic graph — the dynamic seam),
`vc.plc(program, mode)` (SiL: embedded IEC 61131-3 ST/LD interpreter, or external
PLCSIM/OPC-UA bridge), `vc.connect(plant, plc, opcua)` signal map, `vc.step(dt)`
real-time-synced co-sim (couples to `forge.twin` master algorithm + multibody DAE
solver), `vc.injectFault(signal)`, `vc.validate(cycleTime, collisions, reach)`.
HMI mimic on the viewport. The watchable headed playback is the demo surface.

**(c) STANDARDS / TOOLS / FORMATS.** OPC UA (signal exchange), IEC 61131-3
(PLC logic), FMI/SSP (plant model packaging), PLCSIM-Advanced API / Prosim
(reference), AutomationML (CAEX plant description exchange). Algorithms: real-time
co-sim master (fixed-step Gauss-Seidel), signal mapping, kinematic/sensor model
evaluation, collision narrow-phase (kernel boolean), state-machine logic.

**(d) TRAINING-DATA TOPICS / SOURCES.** MiL/SiL/HiL distinctions; behavior-model
authoring; PLC↔plant signal mapping; OPC UA connection; cycle-time/collision
validation; fault injection. Sources: Siemens PLCSIM-Advanced / SIMIT / NX-MCD
function manuals, AutomationML spec, FMI/SSP, IEC 61131-3, virtual-commissioning
literature.

---

## 20. Industrial IoT (IIoT) Architecture

**(a) CORE KNOWLEDGE.** Edge→fog→cloud topology; **RAMI 4.0** (3-axis reference
architecture: layers Business/Functional/Information/Communication/Integration/
Asset × lifecycle×value-stream × hierarchy) and IIRA (Industrial Internet Reference
Architecture). Protocols: **MQTT** (pub/sub, QoS 0/1/2, retained, LWT) + **Sparkplug B**
(MQTT topic namespace + birth/death certificates + state mgmt + payload schema for
IIoT — auto-discovery, report-by-exception), **OPC UA** (information model + **PubSub**
over MQTT/UADP), AMQP, CoAP. Edge computing (gateways, protocol normalization,
store-&-forward, edge analytics/ML inference, stream processing). **Time-series
databases** (InfluxDB/TimescaleDB — downsampling, retention, compression).
Device management (provisioning, OTA, identity/PKI, X.509), security (TLS, IEC 62443
zones/conduits, defense-in-depth). UNS (Unified Namespace, MQTT-broker single
source of truth). Data contextualization (ISA-95 model + AAS), digital-thread
ingestion.

**(b) FORGE CAPABILITY.** `forge.iiot` connecting Forge's twin/SCADA layer to a
broker fabric: `iiot.broker()` (embedded MQTT broker), `iiot.sparkplug(node, device)`
(birth/death certs, metric namespace, RBX), `iiot.opcuaPubSub(dataset)`,
`iiot.edge(pipeline)` (protocol-normalize Modbus/OPC-UA→MQTT, edge filter/aggregate),
`iiot.tsdb(metric)` (time-series store w/ downsample/retention + swinging-door
compression shared with SCADA historian), `iiot.uns(topicTree)` (ISA-95-structured
unified namespace), `iiot.contextualize(metric, aasNode)`. Feeds `forge.twin`
state estimation and `forge.scada` tags.

**(c) STANDARDS / TOOLS / FORMATS.** **MQTT** (OASIS), **Sparkplug B** (Eclipse),
**OPC UA + PubSub** (IEC 62541), AMQP, CoAP; RAMI 4.0, IIRA; IEC 62443 (security);
AAS/AASX (semantics); InfluxDB/Timescale; ISA-95 (UNS structure). Algorithms:
pub/sub routing, RBX/deadband, store-&-forward, swinging-door TS compression,
edge stream aggregation, X.509/TLS.

**(d) TRAINING-DATA TOPICS / SOURCES.** MQTT QoS/retained/LWT; Sparkplug B
namespace & birth/death; OPC UA PubSub; edge normalization; UNS design; TSDB
downsampling; IEC 62443 zones. Sources: OASIS MQTT spec, Eclipse Sparkplug B spec,
OPC UA PubSub (IEC 62541-14), RAMI 4.0 / Plattform Industrie 4.0 docs, IEC 62443,
HiveMQ/EMQX IIoT guides.

---

## Cross-cutting binding notes for Forge/Archie

- **Geometry is the spine.** Computational Geometry (§15) + CG/Geometric Modeling
  (§16, NURBS) underpin almost every other field — robust predicates fix the
  audited boolean fragility; NURBS unlocks STEP/BIM/reverse-eng surface fidelity.
- **One solver, many fields.** The validated in-house FEA + HHT-α multibody DAE +
  CFD solvers feed Topology-Opt (§13), Generative (§12), Digital-Twin (§9),
  Mechatronics (§10), Virtual-Commissioning (§19), Robotics (§8). Bind, don't fork.
- **One data graph, many fields.** PLM/PDM/CM/ERP/MES (§1,2,18,5,6) are layers over
  a single item/BOM/effectivity graph keyed to `NamedSolid.originalID` — geometry-
  true roll-ups (mass, BOM, cost) are the credible seam; workflow/state machines
  the rest.
- **One signal fabric, many fields.** SCADA/Twin/Virtual-Commissioning/IIoT
  (§7,9,19,20) share tag-engine + historian (swinging-door) + OPC-UA/MQTT transport
  + ISA-95 hierarchy. Build once.
- **No statics.** Every headline above is a running algorithm/solver/state-machine
  (MRP explosion, ICP, SIMP loop, co-sim master, alarm SM, configurator SAT), not a
  template generator — directly fixing the audit's "generator not analyzer" defects.

---

## Sources

- ISO 10303 / STEP & AP242/AP239 PLCS: https://en.wikipedia.org/wiki/ISO_10303 ,
  https://www.ap242.org/other-related-standards.html ,
  https://eurostep.com/how-the-iso-standards-plcs-and-ap242-empower-erp-and-plm-integration/
- BIM / IFC / openBIM: https://technical.buildingsmart.org/standards/bcf/ ,
  https://www.buildingsmart.org/about/openbim/ ,
  https://biblus.accasoftware.com/en/ifc-format-and-open-bim-all-you-need-to-know/
- MES / ISA-95 / ISA-88 / MESA-11: https://tulip.co/blog/mes-isa-95-mes-11-cmes-namur/ ,
  https://www.advancedtech.com/blog/what-is-isa-95/
- SCADA / protocols / Purdue: https://iotworlds.com/ics-architecture-explained-plc-scada-dcs-and-industrial-protocols-a-practical-guide/ ,
  https://plcprogramming.io/blog/purdue-model-explained ,
  https://nfmconsulting.com/knowledge/modbus-dnp3-opc-ua-comparison/
- Digital twin / ISO 23247 / AAS / FMI: https://www.ap238.org/iso23247/ ,
  https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=957417 ,
  https://www.tandfonline.com/doi/full/10.12688/digitaltwin.17549.2
- Topology optimization: https://www.sciencedirect.com/science/article/pii/S1000936120304520 ,
  https://arxiv.org/pdf/2101.03286
- Additive / LPBF / DfAM: https://www.amazemet.com/laser-powder-bed-fusion/ ,
  https://www.nature.com/articles/s44334-025-00019-y
- Reverse engineering / metrology: https://eureka.patsnap.com/article/mesh-generation-from-point-clouds-poisson-reconstruction-vs-ball-pivoting ,
  https://en.wikipedia.org/wiki/Point_cloud
- Generative / implicit / nTop: https://www.ntop.com/resources/blog/implicit-modeling-for-mechanical-design/ ,
  https://www.ntop.com/resources/blog/implicits-and-fields-for-beginners/
- GIS / OGC: https://www.ogc.org/standards/ , http://www.geopackage.org/spec/
- Computational geometry / CGAL: https://doc.cgal.org/latest/Manual/packages.html ,
  http://www.qhull.org/ , https://arxiv.org/pdf/2405.12949
- Configuration management / EIA-649: https://en.wikipedia.org/wiki/EIA-649_National_Consensus_Standard_for_Configuration_Management ,
  https://www.sae.org/standards/eia649c-configuration-management-standard
- Mechatronics / MBSE / ISO 26262: https://mbse.dev/v-cycle-development-in-automotive-with-aspice-and-iso-26262-a-comprehensive-guide/ ,
  https://www.ansys.com/simulation-topics/what-is-iso-26262
- ERP / MRP / ISA-95 / B2MML: https://www.sap.com/products/erp/what-is-mrp.html ,
  https://en.wikipedia.org/wiki/Manufacturing_resource_planning ,
  https://just-merwan.medium.com/b2mml-isa-95-explained-bridging-business-and-manufacturing-in-the-digital-age-91218c96f03a
- Virtual commissioning: https://www.industry-mobile-support.siemens-info.com/en/article/detail/109799724 ,
  https://www.solisplc.com/tutorials/siemens-simit
- IIoT / MQTT / Sparkplug B / RAMI 4.0: https://www.emqx.com/en/blog/mqtt-sparkplug-bridging-it-and-ot-in-industry-4-0 ,
  https://www.hivemq.com/resources/iiot-protocols-opc-ua-mqtt-sparkplug-comparison/
