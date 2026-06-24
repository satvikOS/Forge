# Forge Kernel — Simulation Pillar Grounding & Gap Analysis
### AREA: Grounded fully-visual fully-dynamic FEA/CFD/MBD sim + motion capture
### Target: industrial 1:1 parity with NASTRAN / Abaqus / Fluent (the sim pillar)

> Generated 2026-06-24 by a per-file audit of the live kernel at
> `forge-kernel/src/` (Fea/Cfd/MBD + native/vvuq + simulate binders), grounded in
> source actually read, not recall. Sibling to `OCCT_ZERO_ROADMAP.md` (which is
> CAD-geometry-scoped and **does not cover the sim pillar** — this doc fills that
> gap). Discipline per Bible §0: real impl only; the dependency (OCCT for the
> mesher's inside-test only) stays as oracle until each native op is A/B-proven;
> CI-green per increment; **dynamic, not static**.

---

## 0. Scope note — where the sim code actually lives

The sim solvers are **flat in `src/`**, not under `src/Fea` or `src/Cfd` (those
dirs do not exist). Confirmed source set (LOC read):

| Subsystem | File(s) | LOC | Native? |
|---|---|---|---|
| Structural FEA (static/modal/transient) | `Fea.cpp` | 1286 | **Native solver**; OCCT only in mesher |
| Thermal / nonlinear-geom / fatigue | `FeaExtras.cpp` | 780 | **100% native** |
| Buckling / contact / J2 plasticity | `FeaContact.cpp` | 1202 | **100% native** |
| Tet4 FEA (static/modal) | `FeaTet.cpp` | 1183 | Native solver; **OCCT surface mesher** |
| Incompressible CFD (MAC projection) | `Cfd.cpp` | 913 | **100% native** |
| Constrained multibody (index-3 DAE) | `MultibodyDynamics.cpp` | 559 | **100% native** |
| Welding distortion FEA (Goldak) | `WeldingFea.cpp` | 436 | **100% native** |
| Mold-fill flow | `MoldFlow.cpp` | 362 | **100% native** |
| VVUQ credibility layer | `native/vvuq/Vvuq.cpp` (+ `.hpp`) | 720 | **100% native, dep-free** |

**Key finding for OCCT-zero:** unlike the CAD path (~65% OCCT-bound), the sim
pillar is **almost fully native already**. OCCT appears in only TWO sim files,
and only inside the *mesher* (geometry→volume-mesh), never in a solver:
- `Fea.cpp`: `BRepBndLib` (AABB) + `BRepClass3d_SolidClassifier` (point-in-solid
  test for voxel seeding) — `meshFromBRep`, lines 699–858.
- `FeaTet.cpp`: `BRepMesh_IncrementalMesh` (boundary triangulation) +
  `BRepClass3d_SolidClassifier` (centroid interior test).

Everything else (`Cfd`, `FeaExtras`, `FeaContact`, `MultibodyDynamics`,
`WeldingFea`, `MoldFlow`, `vvuq`) has **zero OCCT includes** (grep-verified). The
sim pillar's gap to NASTRAN/Abaqus/Fluent is therefore **physics-capability
depth**, not dependency removal.

---

## 1. What Forge has TODAY (grounded, cited)

### 1.1 Structural FEA — `Fea.cpp`
Genuinely sophisticated, not a calculator:
- **Element: 8-node hex with Wilson/Taylor Q6 incompatible modes** (`buildElement`,
  lines 261–389). Three internal bubble modes P1=1−ξ², P2=1−η², P3=1−ζ² (9 internal
  DOFs α) statically condensed at element level: `Ke = Kcc − Kci·Kii⁻¹·Kciᵀ` via
  Cholesky (`la::LLT`, line 358). This kills first-order shear locking — a single
  brick through bending depth recovers pure-bending energy.
- **Consistent mass** M=ρ∫NᵀN dV on the 2×2×2 Gauss rule (`Mnn`, lines 290–352),
  giving SPD mass for the generalized eigensolve.
- **3 solvers:** `solveStatic` (LDLT, `la::SparseLDLT`, line 886) with per-element
  von-Mises + residual; `solveModal` (dense `GeneralizedSymmetricEigen`, Ax=λBx
  Cholesky, line 988) with spurious-pinned-mode filtering; `solveDynamic`
  (Newmark-β β=¼ γ=½, Rayleigh C=αM+βRK, factored once, lines 1039–1284) with
  energy tracking + per-element stress envelope.
- **BC handling** via triplet-level row/col elimination (`applyPinnedBCs`, 573).
- Validated (per memory `forge-physics-rigor-met`): static **0.33%**, modal
  **0.2%** vs Euler-Bernoulli (`test/fea_smoke.js`).

### 1.2 FEA extras — `FeaExtras.cpp`
- `solveThermal` — steady ∇·(k∇T)=q with Dirichlet + Robin convection BCs.
- `solveNonlinearStatic` — Newton-Raphson **geometric** nonlinearity (K_T=K_L+K_σ).
- `fatigueLife` — rainflow + Basquin/Goodman/Soderberg per element.

### 1.3 FEA contact / plasticity / buckling — `FeaContact.cpp`
- `solveBuckling` — linearized Euler: static pre-load → geometric stress stiffness
  K_g → generalized eigenproblem (K+λK_g)φ=0. ±20% vs P_cr.
- `solveContact` — **penalty node-to-surface** contact, active-set iteration,
  auto-α from diag(K).
- `solveNonlinearPlastic` — **small-strain J2 plasticity, isotropic linear
  hardening, radial return + consistent elasto-plastic tangent** (Simo & Hughes
  Box 3.2).

### 1.4 Tet4 FEA — `FeaTet.cpp`
- Bowyer-Watson Delaunay tetrahedralization, Tet4 CST, Jacobi-PCG static, inverse-
  power-iteration modal with M-orthogonal deflation. Coexists with the hex path.

### 1.5 CFD — `Cfd.cpp`
- **Incompressible Navier-Stokes, staggered MAC (Harlow-Welch)**, Chorin-Temam
  pressure projection: predictor (first-order upwind advection + central diffusion)
  → pressure Poisson (Jacobi-PCG on SPD CSR Laplacian, warm-started) → corrector.
- Real BC machinery: walls (no-slip ghost mirror), inlets (Dirichlet), outlets
  (zero-gradient + **bounded additive mass-conservation correction**, the
  channel-NaN fix), adaptive CFL timestep, NaN/runaway guards.
- Validated at lid-driven cavity Re≈100 (`test/cfd_smoke.js`).

### 1.6 Multibody dynamics — `MultibodyDynamics.cpp`
- **Index-3 DAE, HHT-α + Baumgarte stabilization**, KKT saddle-point solve per
  step (`solveKKT`, line 349). Newton-Euler with gyroscopic −ω×(Jω), world-frame
  inertia R·J·Rᵀ. Constraints: BallJoint, AxisLock, Distance, Spherical (loop-
  closing), PointOnLine (slider). Energy + constraint-drift monitors. Validated
  pendulum **0.016%** (per memory).

### 1.7 Multiphysics — `WeldingFea.cpp`, `MoldFlow.cpp`
- Welding: moving **Goldak double-ellipsoid** heat source, sequentially-coupled
  transient thermal → thermo-elasto-plastic, on a Tet mesh; outputs residual
  distortion + plastic strain + HAZ peak temp.
- MoldFlow: injection fill-front flow.

### 1.8 Credibility — `native/vvuq/Vvuq.cpp` (a genuine differentiator)
- **VVUQ honesty layer** (NAFEMS / ASME V&V 10/20/40 spirit): singularity
  detection (Williams re-entrant corner / point-load / point-BC), Richardson/GCI
  mesh-convergence classification from ≥3 levels, energy-ratio monitors
  (hourglass/KE-IE/contact-stab), y+ wall-treatment check (honestly caps CFD at
  AMBER since turbulence is unverified), analytic benchmark cross-checks, RED/
  AMBER/GREEN fit-for-purpose aggregator. Dep-free. Bound at
  `binding.cpp:16428+` (`vvuqConvergence`, `vvuqEnergyAudit`, …).

### 1.9 JS surface (binding.cpp)
`fea.{meshFromBrep,solveStatic,solveModal,solveDynamic,solveThermal,
solveNonlinearStatic,fatigueLife,solveBuckling,solveContact,solveNonlinearPlastic}`
(5423–5432); `feaTet.{meshShape,solveLinearStatic,solveModal}` (5442–5444);
`cfd.solveSteadyNS` (5481); `simulate.multibodyDynamics` (5486);
`welding.simulateWeld` (6125); `acoustics.simulate`; plus the native vvuq verbs.

---

## 2. THE GAP vs NASTRAN / Abaqus / Fluent — concrete missing pieces

The kernel is at the level of "a correct, validated *teaching/mid-fidelity*
solver." A practising NASTRAN/Abaqus/Fluent engineer relies on a far larger
feature set, data structures, and operational paradigms. Concrete gaps:

### 2.1 Element library (CRITICAL — Abaqus/NASTRAN have ~100s)
Forge has exactly **two structural elements**: 8-node hex (C3D8 + incompatible-
modes ≈ C3D8I) and 4-node tet (C3D4). Missing:
- **No 2nd-order elements**: no C3D10 (quadratic tet), no C3D20/C3D20R (20-node
  hex) — the workhorse for stress concentration accuracy. CST-tet (C3D4) is
  notoriously stiff; real practice forbids it for stress.
- **No shell elements** (S3/S4/S4R, MITC) — *the* element class for sheet-metal,
  aerospace skins, pressure vessels. Forge cannot do thin-walled structures at all.
- **No beam/frame elements** (B31/B33 Timoshenko/Euler) as a continuum-coupled
  element. (`FrameTruss.cpp` exists as a standalone calculator but is not in the
  FE assembly.)
- **No reduced-integration + hourglass control** (C3D8R) — vvuq *monitors*
  hourglass energy but no element *produces* it.
- No membrane, plane-stress/plane-strain 2D (CPS4/CPE4), axisymmetric (CAX4),
  gasket, cohesive, connector, rigid, or mass/spring/dashpot (MASS/SPRING/DASHPOT)
  elements.

### 2.2 Mesher (CRITICAL)
- **Structural hex mesher is a voxel/brick-grid clipped to AABB** (`Fea.cpp:699`).
  This is staircased — it cannot represent a curved/sloped boundary; stress on any
  non-box-aligned surface is wrong. NASTRAN/Abaqus use body-fitted hex-dominant or
  conforming tet meshes.
- **No boundary-layer/inflation meshing** (required for any real CFD wall result).
- **No mesh adaptivity / error-driven h- or p-refinement** (vvuq *classifies*
  convergence from externally-supplied levels but the kernel can't *drive*
  refinement).
- No mid-side node generation, no quad/hex-dominant surface meshing, no
  tet→hex conversion, no mesh quality repair loop wired to the solver.

### 2.3 Material models (MAJOR)
Have: isotropic linear elastic; J2 plasticity (isotropic linear hardening);
thermal isotropic conduction; thermal expansion (welding).
Missing the Abaqus material-card universe:
- **No kinematic / combined hardening** (Chaboche), no nonlinear isotropic
  hardening curve, no rate dependence (Johnson-Cook), no creep, no
  viscoelasticity/viscoplasticity.
- **No hyperelasticity** (Neo-Hookean / Mooney-Rivlin / Ogden) — no rubber/seals.
- **No anisotropic / orthotropic elasticity** (composites laminate, *ELASTIC,
  TYPE=ENGINEERING CONSTANTS / LAMINA), no Hill/Tsai-Wu failure.
- **No damage/fracture** (ductile damage, XFEM, cohesive-zone, VCCT).
- No temperature-dependent property tables; no UMAT/user-material hook.

### 2.4 Nonlinearity (MAJOR)
- `solveNonlinearStatic` is **geometric-only and first-order truncated**
  (header line ~190 admits "material nonlinearity queued"). No true **finite-
  strain** total/updated-Lagrangian (deformation gradient F, PK2 stress, etc.).
- **No arc-length / Riks** solver → cannot trace snap-through/post-buckling.
- **No line search, no automatic incrementation / cutback**, no
  unsymmetric solver, no contact+plasticity+large-strain coupled in one Newton.
- Buckling is **linear eigenvalue only** — no nonlinear (geometrically
  imperfect) buckling.

### 2.5 Contact (MAJOR)
- Penalty **node-to-AABB-face only** (`ContactPair{nodeA, faceB∈0..5}`). Real
  contact needs:
  **No general surface-to-surface / node-to-segment with arbitrary master
  surfaces**, no **Lagrange-multiplier or augmented-Lagrange** enforcement, no
  **friction** (Coulomb/stick-slip), no **self-contact**, no smoothing, no
  **mortar** method, no thermal/electrical contact conductance, no contact in the
  dynamic/explicit path.

### 2.6 Dynamics (MAJOR)
- **No explicit central-difference dynamics** (Abaqus/Explicit, LS-DYNA) — i.e.
  no crash/impact/drop-test capability; only implicit Newmark.
- **No frequency-domain**: no harmonic/steady-state-dynamics (complex response),
  no **random vibration / PSD**, no **response spectrum** as an FE step
  (a standalone `ResponseSpectrum.cpp` calculator exists, not modal-coupled).
- **No modal superposition transient** / modal dynamics step; no **modal
  damping** table, only Rayleigh.
- **No complex-eigenvalue** (damped modes, brake-squeal/flutter), no
  **prestressed/spinning** modal (centrifugal/Coriolis softening), no
  **substructuring / Craig-Bampton superelements**, no component-mode synthesis.
- Modal solver is **dense, capped at 1500 DOF** (`Fea.cpp:962`) — no Lanczos/
  subspace iteration → cannot do a real model's thousands of modes.

### 2.7 CFD (CRITICAL — the largest single gap to Fluent)
- **Laminar only. NO turbulence model whatsoever** (header line ~6 admits it):
  no k-ε, k-ω SST, Spalart-Allmaras, RSM, LES/DES. vvuq honestly caps every CFD
  result at AMBER for this reason.
- **First-order upwind advection only** (`Cfd.cpp:638`) — numerically diffusive;
  no MUSCL/QUICK/TVD higher-order scheme, no flux limiters.
- **Cartesian regular grid clipped to AABB; NO body-fitted / cut-cell / immersed-
  boundary** — cannot mesh real geometry; a sphere/airfoil in the domain is not
  representable.
- **Incompressible only**: no compressible/density-based solver (no transonic/
  supersonic, no shocks), no Mach>0.3, no ideal-gas energy equation.
- **No energy equation / conjugate heat transfer**, no buoyancy/natural
  convection, no species transport / combustion, no multiphase (VOF/Euler-Euler),
  no cavitation, no porous media, no rotating reference frame / MRF / sliding mesh
  (no turbomachinery), no radiation.
- **Steady (pseudo-transient) only** — no true unsteady (URANS) time-accurate
  CFD, no PISO second corrector (header admits single-corrector), no
  fluid-structure interaction (FSI / co-simulation with the FE path).
- No wall functions (the very thing vvuq's y+ check presupposes).

### 2.8 Multibody (MODERATE)
- 5 constraint primitives only (ball, axis-lock, distance, spherical, point-on-
  line). Missing: **revolute (with limits/locks), prismatic with stops,
  cylindrical, universal, gear, cam, screw, planar, rack-pinion**, and
  **bushing/force elements** (springs, dampers, bushings, contact joints).
- **No flexible multibody** (FE bodies in the MBD loop / modal-flexible bodies).
- **No friction in joints**, no motor/driver as a closed-loop actuator with
  control, no clearance/backlash joints, no contact between bodies.
- Forward-difference Jacobian (`buildJacobian`, line 186) is O(n·m) per step —
  fine for small mechanisms, not for large assemblies.

### 2.9 Loads / BCs (MODERATE)
- **Pressure is applied only to the 6 AABB faces, distributed equally to face
  nodes** (`applyPressureLoads`, `Fea.cpp:651`, self-described "deliberate
  simplification"). No true **traction integration on real surface elements**, no
  follower/pressure-stiffness, no body-force/centrifugal/gravity load, no
  thermal-strain coupling into the structural path, no bolt-preload, no imported
  field (mapped) loads, no time-history/amplitude curves on BCs.
- BCs are pin-to-zero only (`BCPinned`) — no **prescribed nonzero displacement**,
  no enforced rotation, no MPC / coupling constraints (RBE2/RBE3/TIE/EQUATION), no
  symmetry/cyclic-symmetry BCs.

### 2.10 Solvers / scale (MAJOR for "industrial")
- Sparse direct LDLT + Jacobi-PCG only. **No multifrontal/supernodal direct
  solver, no algebraic multigrid (AMG), no domain decomposition**, no out-of-core,
  **no parallelism** (no OpenMP/MPI/GPU in the solve). Real models are 10⁶–10⁸ DOF;
  the dense modal cap (1500 DOF) and the per-step dense KKT in MBD show the current
  ceiling is ~10⁴ DOF.

### 2.11 The "fully-visual fully-dynamic" + motion-capture requirement (CRITICAL — UNBUILT)
The AREA title demands *grounded fully-visual fully-dynamic* sim **and motion
capture**. Today:
- **No streaming/incremental result protocol.** All solvers return the full result
  by value at the end (`DynamicResult` holds every snapshot; `MbdResult` holds all
  samples). There is **no per-step callback / frame stream / progressive viewport
  push** — so "real-time visual dynamic representation" is not actually wired; the
  viewport gets one big blob after the solve completes.
- **No field-result visualization data structures bound for the viewport**: no
  nodal-result interpolation to a render mesh, no iso-surface/cutting-plane/
  streamline/vector-glyph extraction in the kernel, no deformed-shape animation
  buffer, no contour color-mapping. Stress is per-element only (`vonMises[nElem]`)
  with no nodal averaging/extrapolation for smooth contours.
- **No "motion capture" subsystem at all.** Nothing in the kernel ingests mocap
  (BVH/C3D/marker streams) or maps captured motion onto an MBD model as a driver
  / inverse-kinematics target. This is a 0%-built leg of the AREA.
- **No co-simulation clock / scene-time master** to drive multiple solvers
  (FE + MBD + CFD) on one timeline for a coherent dynamic scene.

---

## 3. Prioritized, incremental, A/B-verifiable build plan

Respecting Bible §0 (real impl, no MVP/stub; keep an oracle until A/B-proven; CI-
green per increment; dynamic). Each step lists the native subsystem, the oracle to
verify against, and a rough LOC. Order is chosen so each unblocks the next and each
is independently demoable.

### PHASE S-A — Result streaming + visualization substrate (unblocks the AREA title)
This is sequenced FIRST because "fully-visual fully-dynamic" is the stated goal and
is currently the weakest leg, yet it needs no new physics.
- **S-A1. Per-step frame-stream callback** for `solveDynamic` + `simulateMultibody`
  + welding transient. Add a `std::function<void(const Frame&)>`-style sink (bound
  to a JS callback / Napi ThreadSafeFunction) emitting {t, deformed nodal coords,
  scalar field}. *Verify:* A/B the streamed final frame == the existing by-value
  final result, bit-for-bit. *Subsystem:* `Fea.cpp`/`MultibodyDynamics.cpp` +
  `binding.cpp`. **~400 LOC.**
- **S-A2. Nodal result recovery** (stress extrapolation from Gauss points +
  inter-element averaging) for smooth contours; produce a per-node tensor →
  von-Mises/principal field. *Verify:* averaged nodal field reproduces element
  field within superconvergent-patch tolerance on the cantilever; compare to the
  analytic bending-stress line. **~300 LOC.**
- **S-A3. In-kernel field extraction:** cutting plane, iso-surface (reuse the
  existing `native/implicit` marching path), vector glyphs, streamline integrator
  for CFD. *Verify:* iso-surface of a known analytic field matches the level set;
  streamline in the cavity matches the projected velocity. **~600 LOC.**

### PHASE S-B — Element library depth (the #1 accuracy gap)
- **S-B1. C3D10 quadratic tet** (10-node) + C3D8R reduced-integration hex with
  hourglass control. *Verify:* A/B vs the existing C3D8I on the cantilever; the
  quadratic tet must match Euler-Bernoulli at coarser mesh; hourglass energy read
  back through **vvuq's existing `auditEnergy`** (oracle already in-tree).
  **~700 LOC.**
- **S-B2. Shell element (S4R, MITC4)** + drilling-DOF handling. *Verify:* pinched-
  cylinder + Scordelis-Lo roof **NAFEMS benchmarks** (known-answer, embed targets).
  Unblocks all sheet-metal/aerospace sim. **~1200 LOC.**
- **S-B3. Timoshenko beam (B31) coupled into the FE assembly.** *Verify:* tip
  deflection vs `cantileverTipDeflection` (already in `vvuq`). **~400 LOC.**

### PHASE S-C — Body-fitted meshing (removes the staircase-stress error + the OCCT mesher)
- **S-C1. Native conforming tet mesher** (advancing-front or Delaunay-refinement
  with curvature-adaptive surface sizing) to replace both the voxel hex grid and
  the OCCT `BRepMesh` surface step in `FeaTet.cpp`. *Verify:* A/B mesh quality
  (min dihedral, volume sum vs `MassProps`) against the OCCT-seeded mesh; solver
  result on a curved part converges where the voxel mesh did not. **Removes the
  last two OCCT calls in the sim pillar.** *Subsystem:* new `native/mesh` volume
  mesher. **~1500 LOC.**
- **S-C2. Boundary-layer / inflation** prisms for CFD walls. *Verify:* y+ band via
  **vvuq `checkYPlus`** (in-tree oracle); flat-plate Blasius skin-friction. **~600
  LOC.**

### PHASE S-D — CFD to Fluent-grade (the largest single physics gap)
- **S-D1. Higher-order advection** (MUSCL/QUICK + flux limiter) replacing first-
  order upwind. *Verify:* lid-driven cavity **Ghia et al. 1982** centerline
  u/v profiles at Re=100/400/1000 (canonical known-answer — embed the tables).
  **~500 LOC.**
- **S-D2. RANS turbulence: k-ω SST** (+ wall functions). *Verify:* flat-plate
  Blasius/log-law, backward-facing-step reattachment length vs experiment; this is
  what lifts vvuq's CFD verdict off its AMBER cap. **~1500 LOC.**
- **S-D3. Energy equation + conjugate heat transfer + buoyancy.** *Verify:*
  differentially-heated cavity Nusselt number (de Vahl Davis benchmark).
  **~700 LOC.**
- **S-D4. True unsteady (URANS) + PISO second corrector** → time-accurate vortex
  shedding. *Verify:* cylinder-in-crossflow **Strouhal ≈ 0.2** at Re=100.
  **~500 LOC.** (This is also what makes CFD "fully-dynamic" for the viewport.)

### PHASE S-E — Nonlinear + dynamics breadth
- **S-E1. Finite-strain (updated-Lagrangian) + arc-length/Riks.** *Verify:* large-
  deflection cantilever vs the elastica (analytic); snap-through of a shallow arch
  (known load-displacement). **~1200 LOC.**
- **S-E2. Explicit central-difference dynamics** (lumped mass, stable-dt) for
  impact/drop. *Verify:* 1D wave-propagation speed = √(E/ρ); energy balance via
  **vvuq `auditEnergy`**. **~800 LOC.**
- **S-E3. Frequency-domain: harmonic response + modal superposition transient +
  response-spectrum FE step + PSD random vibration.** *Verify:* SDOF transfer-
  function peak at resonance (analytic); spectrum result vs the standalone
  `ResponseSpectrum.cpp` calculator (in-tree oracle). **~900 LOC.**
- **S-E4. Lanczos/subspace eigensolver** to lift the 1500-DOF dense cap. *Verify:*
  A/B lowest modes vs the dense solver on a sub-1500-DOF model, then scale.
  **~700 LOC.**

### PHASE S-F — Contact + material breadth
- **S-F1. Surface-to-surface contact + Coulomb friction + augmented Lagrange.**
  *Verify:* **Hertz** contact pressure/half-width (closed form; `HertzPoint.cpp`
  already encodes it as an in-tree oracle). **~1200 LOC.**
- **S-F2. Material models: Chaboche kinematic hardening, hyperelasticity
  (Neo-Hookean/Ogden), orthotropic + Hill/Tsai-Wu.** *Verify:* uniaxial cyclic
  hysteresis loop (Chaboche analytic), incompressible block under tension
  (Neo-Hookean closed form). **~1500 LOC.**

### PHASE S-G — Multibody breadth + MOTION CAPTURE (the unbuilt AREA leg)
- **S-G1. Full joint library** (revolute/prismatic with limits, cylindrical,
  universal, gear, cam, screw) + force elements (springs/dampers/bushings) +
  joint friction. *Verify:* slider-crank kinematics vs closed-form; energy drift
  monitor (in-tree). **~900 LOC.**
- **S-G2. Flexible multibody** (modal-reduced FE bodies in the MBD loop, reusing
  S-E4 modes). *Verify:* spinning flexible beam tip vs analytic; rigid limit
  recovers S-G1. **~800 LOC.**
- **S-G3. MOTION CAPTURE ingest + retargeting.** Parse BVH/C3D marker/skeleton
  streams; map onto MBD bodies as **prescribed-motion drivers** or solve
  **inverse kinematics** to drive a mechanism from captured markers; emit through
  the S-A1 frame stream. *Verify:* round-trip a synthetic captured trajectory →
  driver → simulated motion reproduces the input within tolerance; a known gait
  clip drives a linkage coherently. **~1000 LOC.** *This is the single piece that
  is 0% built today and is named in the AREA title.*

### PHASE S-H — Industrial solver scale
- **S-H1. OpenMP-parallel element assembly + AMG (or supernodal direct) for the
  static/Newton solve.** *Verify:* A/B identical result to the serial LDLT on every
  prior benchmark; wall-time scaling. **~1000 LOC.**
- **S-H2. MPC / coupling (RBE2/RBE3/TIE), prescribed-nonzero & cyclic-symmetry
  BCs, real surface-traction load integration.** *Verify:* rigid-link patch test;
  pressurized thick cylinder hoop stress vs **vvuq `lamePressurizedStress`**
  (in-tree oracle). **~700 LOC.**

> **Rough total to credible Fluent/Abaqus-class breadth:** ~22k LOC across S-A→S-H.
> The kernel quality bar is already high (Q6 incompatible modes, HHT-α DAE,
> validated to <0.4%), so this is *breadth* work on a sound foundation, not a
> rewrite. Crucially, the **vvuq layer already supplies many of the verification
> oracles in-tree** (cantilever, SS-beam, Lamé, plate, convergence/GCI, energy,
> y+), and named published benchmarks (Ghia, NAFEMS, de Vahl Davis, Strouhal,
> Blasius, Hertz, Scordelis-Lo) supply the rest — matching the
> `feedback-validate-published-references` mandate.

---

## 4. The single biggest blocker + the critical path

### Biggest blocker: **no body-fitted mesher (S-C1) + no turbulence (S-D2).**
Two co-equal blockers, depending on which target dominates:

- **For Abaqus/NASTRAN parity:** the **voxel/AABB brick mesher** (`Fea.cpp:699`)
  is the keystone limiter. Every structural result on a non-box geometry is
  staircase-corrupted, so *element-library depth (S-B) cannot pay off until the
  mesh conforms to the boundary*. S-C1 (native conforming tet/hex-dominant mesher)
  is the gate — and it also deletes the last two OCCT calls in the sim pillar,
  achieving sim-pillar OCCT-zero.

- **For Fluent parity:** the **total absence of a turbulence model** (S-D2). Every
  real industrial flow is turbulent; vvuq *honestly caps CFD at AMBER* precisely
  because of this. Until k-ω SST + wall functions land (on top of the body-fitted/
  inflation mesh from S-C2), Forge cannot claim a usable CFD result for any
  customer geometry.

### Critical path (must-precede chain):
```
S-A1 frame stream ─┐ (unblocks "fully-visual fully-dynamic" + feeds S-G3 mocap)
                   │
S-C1 body-fitted mesh ──► S-B (elements pay off) ──► S-E/S-F (NL, contact, materials)
        │
        └─► S-C2 inflation ──► S-D2 turbulence ──► S-D3/S-D4 (CHT, unsteady CFD)

S-A1 ──► S-G1 joints ──► S-G2 flexible MBD ──► S-G3 MOTION CAPTURE (the named, 0%-built leg)

S-E4 Lanczos ──► (lifts 1500-DOF cap, prerequisite for S-E3 modal-superposition & S-G2)
S-H solver-scale runs in parallel; A/B-gated against the serial path throughout.
```

**Recommended first three increments** (each CI-green, A/B-proven, demoable):
1. **S-A1** (frame stream) — turns the existing validated transient/MBD solvers
   into a genuinely *real-time visual dynamic* demo with zero new physics risk.
2. **S-C1** (body-fitted mesher) — the highest-leverage accuracy unlock and the
   move that takes the sim pillar to OCCT-zero.
3. **S-D1** (higher-order CFD advection, Ghia-verified) — the cheapest concrete
   step toward Fluent credibility, prerequisite framing for S-D2 turbulence.

> **Bottom line:** the sim pillar is *already native and validated* at the core
> (Q6 hex, HHT-α DAE, projection CFD, J2 plasticity, VVUQ honesty) — far healthier
> than the CAD geometry path. The gap to NASTRAN/Abaqus/Fluent is **breadth**
> (element zoo, turbulence, body-fitted meshing, nonlinear/contact/material depth,
> solver scale) plus the **entirely-unbuilt "fully-visual streaming + motion-
> capture" leg named in the AREA title**. The keystone is the body-fitted mesher
> (also the OCCT-zero move for sim); the named-but-missing piece is motion capture.
