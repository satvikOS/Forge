# Training Curriculum — SIMULATION / PHYSICS CLUSTER (CAE)

### Cluster: FEA · CFD · Multibody Dynamics · Aeroacoustics · Electromagnetics Simulation · Structural Mechanics · Fracture Mechanics & Fatigue · Kinematics & Dynamics of Machinery

> **Generated 2026-06-24** for the Archie 14B "pure CAD/CAM/CAE engineer" curriculum. Sibling
> to `kernel/sim-grounding.md` (what the kernel CAN do) and the SCOPE_2026-06-21
> `programs/archie_corpus_program.md` Pillar B → **Cluster 2 (CAE/Physics) `bulk_synth_physics.py`**.
> This is the *deep* curriculum spec for that cluster: bachelors → masters → PhD →
> industry practice, the data sources, the synthetic-generation plan, and grounding contract.
>
> **THESIS.** Train Archie to reason about every physical field the way a *practising
> senior CAE engineer* does — not to recite formulae, but to (1) pick the right physics
> and the right model fidelity, (2) set up the analysis (mesh, element, BC, solver,
> turbulence/contact/material model) defensibly, (3) read the result against an
> engineering criterion, and (4) **act on it inside Forge** by emitting a schema-valid
> `forge.<wb>.<op>(args)` tool-call the kernel replays — closing the design→simulate→
> critique→redesign loop. Every geometric claim is kernel-verifiable; every physics
> number is validated against a *named published benchmark* or honestly flagged.
>
> **GROUNDING CONTRACT (inherited from `SIM_VALIDATION.md` / Bible §0/§9).** A solver
> result is teachable as *validated* only when it has a characterized error vs an
> analytical or benchmark truth. Where the kernel is validated-laminar / unverified-
> turbulent (CFD), the corpus teaches Archie to **surface the real limit, never fabricate**.
> The VVUQ honesty layer (`native/vvuq/Vvuq.cpp`, RED/AMBER/GREEN) is the in-tree oracle
> and is itself a curriculum topic.

---

## 0. WHAT THE KERNEL ALREADY DOES (the tool-call target surface)

The corpus must terminate in calls the kernel can actually replay. Grounded inventory
(from `kernel/sim-grounding.md`, `file:line` verified):

| Subsystem | File | Validated to | JS verb (binding.cpp) |
|---|---|---|---|
| Structural FEA static (hex8 Wilson-Q6 incompatible modes) | `Fea.cpp` | **0.33 %** vs PL³/3EI | `fea.solveStatic` |
| Modal (consistent mass, generalized eig) | `Fea.cpp` | **0.2 %** vs (1.875)²/2π·√(EI/ρAL⁴) | `fea.solveModal` |
| Transient (Newmark-β ¼,½, Rayleigh C) | `Fea.cpp` | stable, linear regime | `fea.solveDynamic` |
| Steady thermal ∇·(k∇T)+q=0, Robin | `FeaExtras.cpp` | **0 %** (q=kΔT/L) | `fea.solveThermal` |
| Geometric-nonlinear (Newton, K_T=K_L+K_σ) | `FeaExtras.cpp` | linear regime | `fea.solveNonlinearStatic` |
| Buckling (linear eig, geometric stiffness) | `FeaContact.cpp` | ±20 % Euler band | `fea.solveBuckling` |
| Penalty contact (node-to-surface, active set) | `FeaContact.cpp` | **ILLUSTRATIVE** (Hertz 59 % off) | `fea.solveContact` |
| J2 plasticity (radial return, Simo-Hughes Box 3.2) | `FeaContact.cpp` | machine-ε | `fea.solveNonlinearPlastic` |
| Fatigue (rainflow ASTM-E1049 + Basquin/Goodman/Miner) | `FeaExtras.cpp` | within Basquin band | `fea.fatigueLife` |
| Tet4 FEA (Bowyer-Watson, PCG static, inv-power modal) | `FeaTet.cpp` | native solver | `feaTet.{meshShape,solveLinearStatic,solveModal}` |
| Incompressible CFD (Chorin projection, Harlow-Welch MAC) | `Cfd.cpp` | ∇·u→1e-13, Poiseuille 4 % (**LAMINAR ONLY**) | `cfd.solveSteadyNS` |
| Multibody (index-3 DAE, HHT-α + Baumgarte, KKT) | `MultibodyDynamics.cpp` | **pendulum 0.016 %** | `simulate.multibodyDynamics` |
| Welding distortion (Goldak double-ellipsoid → thermo-elasto-plastic) | `WeldingFea.cpp` | native | `welding.simulateWeld` |
| Mold-fill flow | `MoldFlow.cpp` | native | (mold verbs) |
| Acoustics | (`acoustics.simulate`) | — | `acoustics.simulate` |
| VVUQ credibility (singularity, Richardson/GCI, energy audit, y+) | `native/vvuq/Vvuq.cpp` | dep-free oracle | `vvuqConvergence`, `vvuqEnergyAudit`, … |

**Known honest gaps the corpus must teach Archie to respect** (from `sim-grounding.md` §2):
no 2nd-order/shell/beam continuum elements, voxel/AABB mesher (staircase stress on
curved boundaries), **no turbulence model** (CFD capped at AMBER), Hertz contact
illustrative, no explicit dynamics, no frequency-domain FE step, no compressible CFD,
no EM/aeroacoustic FE solver yet, **motion-capture leg 0 % built**. Two corpus uses of
these gaps: (a) teach Archie to pick the validated path and flag the unvalidated one;
(b) generate the *aspirational* verb sequences (`forge.cfd.turbulence`, `forge.fea.harmonic`,
`forge.fracture.sif`, `forge.emag.*`, `forge.aeroacoustics.fwh`) so the model is
in-distribution the moment the kernel lands them (per `archie_corpus_program §3` the verb
targets are already enumerated).

---

## 1. KNOWLEDGE BREAKDOWN — bachelors → masters → PhD → industry

For each of the 8 disciplines: the sub-topics, the load-bearing theory/equations, the
governing standards, and the *hard engineering judgment* — the tacit knowledge that
separates a senior engineer from a textbook. "Manufacturable + correct in every
engineering aspect" means the simulation reasoning must connect back to a design that
survives in the real world, so every discipline closes with the judgment that ties it
to geometry the kernel builds.

### 1.1 Finite Element Analysis (FEA) — the substrate of structural CAE

**Bachelors.** Strong/weak/variational form (principle of virtual work, minimum potential
energy); Galerkin method; 1D bar/beam stiffness; isoparametric mapping & the Jacobian;
shape functions (Lagrange/serendipity); Gauss-Legendre quadrature (n points integrate
2n−1 order exactly); element zoo — CST/LST, Q4/Q8, TET4/TET10, HEX8/HEX20, beam
(Euler-Bernoulli/Timoshenko B31), plate/shell (Kirchhoff/Mindlin, MITC4/MITC9, DKT);
global assembly `[K]{u}={F}`; essential vs natural BCs; direct solve (Cholesky/LDLᵀ for SPD).

**Masters.** Convergence theory (completeness + compatibility → patch test; h/p/hp
refinement; energy-norm convergence rate O(h^p)); **locking & cures** — shear locking
(thin beams/plates) → reduced/selective integration, MITC, DKT; **volumetric locking**
(near-incompressible ν→0.5) → B-bar, EAS, **incompatible modes / Wilson-Q6** (exactly the
kernel's de-locking), F-bar, u-p mixed; hourglass control for reduced integration (the
energy vvuq audits); error estimation (Zienkiewicz-Zhu superconvergent patch recovery →
η error field → adaptive remesh); MPCs & coupling (RBE2 rigid, RBE3 distributing, TIE,
EQUATION); sub-modeling & sub-structuring (Guyan/Craig-Bampton component-mode synthesis);
**dynamics** — generalized eigenproblem `([K]−ω²[M]){φ}=0`, consistent vs lumped mass,
Lanczos/subspace iteration, modal participation & effective mass, MAC correlation,
Newmark-β/HHT-α/generalized-α time integration (stability & numerical damping), modal
superposition, harmonic/frequency response `(−ω²M+iωC+K)u=F`, response spectrum, PSD
random vibration (Miles' equation); thermal `ρc∂T/∂t=∇·(k∇T)+q` + thermal-stress coupling.

**PhD / research.** Mixed & hybrid formulations (Hu-Washizu, Hellinger-Reissner);
isogeometric analysis (NURBS as basis → exact CAD geometry, k-refinement); XFEM/GFEM
(enrichment for cracks/interfaces without remeshing); contact variational inequalities
(KKT, mortar methods, augmented Lagrange, Nitsche); finite-strain continuum mechanics
(deformation gradient F, polar decomposition, PK1/PK2 stress, total/updated Lagrangian);
multiscale (FE², homogenization, RVE); reduced-order modeling (POD/Galerkin, hyper-
reduction DEIM); a-posteriori goal-oriented error (dual-weighted residual); stochastic FEM.

**Industry judgment (the part that makes designs survive).** *Never* use CST-TET4 for
stress (artificially stiff — the kernel's own gap note); choose TET10/HEX20 near stress
concentrations; **a fillet is mandatory at any re-entrant corner** — a sharp corner is a
stress singularity that *never converges* (vvuq's Williams-corner detector exists for
exactly this), so a "high stress" at a sharp internal corner is a meshing artifact, not a
real failure — *and the fix is geometric: add a fillet, which is also what makes the part
castable/machinable*. Mesh-convergence discipline: report a result only with ≥3 mesh
levels and a Richardson/GCI band (vvuq `vvuqConvergence`). Distinguish a real hot-spot
from a point-load/point-BC singularity. Know when linear static is enough vs when you
*must* go nonlinear (deflection > ~½ thickness → geometric; stress > yield → material;
gaps/preload → contact) or dynamic (loading rate near a natural period). Symmetry/cyclic
BCs to cut cost. The senior move: *the analysis exists to change the design* — thicken a
rib, add a gusset, move a hole off the load path, fillet the corner — not to produce a
pretty contour.

**Standards.** NAFEMS benchmarks (LE1/LE10 linear-elastic, T1-T4 thermal, FV2-FV5
free-vibration, the Scordelis-Lo roof & pinched-cylinder shell benchmarks); ASME V&V 10
(computational solid mechanics) & V&V 40 (medical-device credibility); ISO 16407.

### 1.2 Computational Fluid Dynamics (CFD)

**Bachelors.** Continuity, Navier-Stokes (incompressible & compressible), energy
equation; non-dimensional groups (Re, Ma, Pr, Nu, Gr, We, Fr, St); laminar vs turbulent
transition (pipe Re≈2300); boundary-layer theory (Blasius flat plate, displacement/
momentum thickness, separation); internal flow (Poiseuille, Moody chart, Darcy-Weisbach);
control-volume analysis; potential flow / Bernoulli for first-order sizing.

**Masters.** FVM discretization (conservative flux form); convection schemes — first-
order upwind (diffusive, the kernel's current limit), central, **QUICK / MUSCL / TVD with
flux limiters** (Sweby diagram, the higher-order upgrade); pressure-velocity coupling on
collocated/staggered grids — **SIMPLE/SIMPLEC/PISO/PIMPLE** (the Rhie-Chow interpolation,
Chorin projection — exactly the kernel's MAC scheme); **RANS turbulence** — mixing-length,
Spalart-Allmaras (1-eq, aero), k-ε (realizable, free-shear), **k-ω SST (Menter)** the
external/internal workhorse blending k-ω at the wall to k-ε in freestream; **wall
treatment** — y⁺ (≈1 for resolved, 30-300 for wall functions, the band vvuq's `checkYPlus`
guards), u_τ, log-law; boundary-layer/inflation prism meshing; CFL = u·Δt/Δx and adaptive
timestepping; conjugate heat transfer; buoyancy (Boussinesq, Rayleigh number).

**PhD / research.** Scale-resolving — **LES** (Smagorinsky/WALE/dynamic SGS), **DES/DDES/
IDDES** hybrids, wall-modeled LES; transition models (γ-Reθ, Langtry-Menter); compressible
shock capturing (Roe/HLLC/AUSM approximate Riemann solvers, MUSCL reconstruction, TVD
limiters, entropy fixes); multiphase (VOF, Euler-Euler, level-set, cavitation); reacting
flow/combustion (flamelet, PDF); rotating machinery (MRF, sliding mesh); high-order CFD
(spectral/DG); adjoint-based shape optimization; uncertainty quantification.

**Industry judgment.** **Turbulence-model selection is the single biggest skill** — SST
for adverse-pressure-gradient/separation (external aero, diffusers), k-ε for free shear,
SA for attached aero; the model is only as good as the y⁺ band and the boundary-layer
mesh (a great solver on a y⁺=80 mesh with k-ω resolution is garbage). *Mesh independence
is mandatory* — quote a drag/Nu only with grid convergence. Read residuals AND a physical
monitor (does lift plateau?) — converged residuals with a drifting force = not converged.
Know the **honest envelope**: the kernel is validated-laminar; for any Re past transition
on customer geometry, surface the AMBER cap (this is a *teaching point*, not a failure).
First-order upwind smears wakes — never quote a wake/heat-transfer result off it. Connect
back to design: a separated diffuser → re-loft the wall angle (geometry the kernel builds);
a hot-spot in conjugate HT → add a fin / open a vent.

**Standards / V&V truths (the embedded answer keys).** Lid-driven cavity **Ghia, Ghia &
Shin 1982** (centerline u/v at Re=100/400/1000 — tabulated, embed); flat-plate **Blasius**
(δ, Cf=0.664/√Re_x); backward-facing-step reattachment length; cylinder-in-crossflow
**Strouhal St≈0.2** at Re=100; differentially-heated cavity **de Vahl Davis** Nusselt;
ERCOFTAC cases; **NASA Turbulence Modeling Resource**; AIAA CFD V&V guidelines.

### 1.3 Multibody Dynamics (MBD)

**Bachelors.** Rigid-body kinematics & kinetics (Newton-Euler); generalized coordinates;
joints/lower pairs (revolute, prismatic, cylindrical, spherical, universal, planar,
screw); degrees of freedom; rotation parameterization (Euler angles, axis-angle,
quaternions, the singularity-free choice).

**Masters.** Constrained equations of motion — Lagrange multipliers, the **index-3 DAE**
`[M Φ_qᵀ; Φ_q 0]{q̈;λ}={Q;γ}` (exactly the kernel's KKT saddle-point); constraint
Jacobian Φ_q; DAE index reduction (3→2→1) and the drift problem; **stabilization** —
Baumgarte `Φ̈+2αΦ̇+β²Φ=0`, projection, GGL; integrators — Newmark, **HHT-α (Hilber-Hughes-
Taylor)** α∈[−1/3,0] for index-3 with controllable numerical damping (the kernel's
validated choice, pendulum 0.016 %); formulations — augmented, recursive (O(n)
articulated-body, Featherstone), Kane's equations; forward vs inverse dynamics; redundant-
constraint detection (rank-deficient Φ_q); reaction-force/torque recovery (the bearing-
load shot).

**PhD / research.** Flexible multibody — floating-frame-of-reference (modal-reduced FE
bodies, the S-G2 leg), absolute nodal coordinate formulation (ANCF, large deformation);
contact/impact — penalty vs complementarity/LCP, continuous (Hertzian + Hunt-Crossley
dissipation) vs event-driven; joint friction (Coulomb, LuGre); clearance/backlash joints;
hydraulics/control co-simulation; real-time/HIL formulations; **motion capture** ingest
(BVH/C3D markers) + inverse kinematics retargeting onto a mechanism (the named, 0 %-built
AREA leg — corpus teaches the verb sequence ahead of the kernel).

**Industry judgment.** **Mobility first** — Grübler-Kutzbach `M = 6(n−1) − Σ(6−f_i)`
(spatial) / `3(n−1)−2j_1−j_2` (planar) tells you the DOF and flags over/under-constraint
*before* you simulate; a mechanism that won't move or is statically indeterminate is a
design bug found in 30 seconds. Choose a stiff integrator (HHT-α) for stiff
springs/contact. Energy drift is your conservation proof — a growing-energy sim is wrong
(the kernel monitors `energyDrift`). Inertia *comes from the geometry* (ρ·V + solid
inertia tensor via `MassProps`) — this is the AUTO-MBD bridge: an assembly's mate graph →
joints → run, no manual setup. The senior move: a coupler-curve that clips the housing
(swept-volume interference) is a redesign trigger; a bearing reaction that exceeds rated
load means re-size the joint — both feed back to CAD.

**Standards / truths.** ADAMS/Simscape are the reference tools; HHT-α index-3 validated
on 1,600+ systems (Negrut et al., ANL P1278); slider-crank & four-bar closed-form
kinematics are the embedded known-answers; pendulum period 2π√(L/g) and a spinning rotor's
conserved angular momentum are the analytic gates.

### 1.4 Aeroacoustics

**Bachelors.** Wave equation; SPL/PWL/SWL (dB, p_ref=20 µPa), A/C-weighting,
octave/third-octave bands; monopole/dipole/quadrupole sources; sound power vs pressure;
free-field vs reverberant.

**Masters.** **Lighthill's acoustic analogy** `∂²ρ'/∂t² − c₀²∇²ρ' = ∂²T_ij/∂x_i∂x_j`;
**Curle's** solid-surface extension (dipole); **Ffowcs Williams-Hawkings (FW-H)** for
moving surfaces (thickness + loading + quadrupole terms) — the integral that turns a
transient CFD surface-pressure history into far-field noise; **Blade Passing Frequency**
`BPF = N_blades·RPM/60` and its harmonics (tonal); trailing-edge/boundary-layer/jet noise
(broadband); duct/silencer transmission loss; fan-law noise scaling.

**PhD / research.** Computational aeroacoustics (high-order low-dissipation/low-dispersion
schemes, DRP); LES/DES → FW-H hybrid for broadband; vortex-sound theory; trailing-edge
serrations; liner impedance (Helmholtz resonators); psychoacoustics.

**Industry judgment.** Tonal-vs-broadband diagnosis sets the fix (tonal BPF → blade count /
spacing / lean & sweep; broadband → trailing-edge treatment / liner). FW-H needs a clean
*unsteady* CFD surface history (URANS/DES) — garbage transient flow → garbage noise. The
result is grounded *in the CFD it already ran* — couples §1.2. Connects to design: blade
sweep/lean, serrations, liner geometry are all CAD edits.

**Standards.** ISO 3744/3745 (sound power), ISO 5136 (fan in-duct), AHRI 250; FW-H is
the universal industrial method (Ansys/Star-CCM/PowerFLOW all implement it).

### 1.5 Electromagnetics Simulation

**Bachelors.** Maxwell's equations (differential & integral); electrostatics/
magnetostatics; B = ∇×A vector potential; B-H curves & magnetic circuits; Faraday/Ampère/
Lorentz; skin depth `δ=√(2/(ωμσ))`; capacitance/inductance.

**Masters.** Low-frequency FEM — A-formulation magnetostatics (nonlinear B-H, Newton),
**A-V eddy-current** (harmonic & transient); **edge/Nédélec elements** (tangential
continuity — *the* reason scalar nodal FE fails for EM); Maxwell stress tensor →
force/torque (motor torque); **Steinmetz core loss** `P_core = k·f^α·B^β`; hysteresis
(Jiles-Atherton, Preisach); skin & proximity effects (Litz wire); coupled magneto-thermal
(Joule heating → thermal).

**PhD / research.** Full-wave high-frequency — FEM/MoM/FDTD/FIT; waveguides &
S-parameters; antennas (radiation pattern, gain, directivity, near/far-field
transformation); EMC/EMI; periodic structures/metamaterials; PML absorbing boundaries;
multiphysics (EM→thermal→structural for motors/transformers).

**Industry judgment.** Formulation choice by frequency regime (static → eddy → full-wave;
A-V for low-freq machines, full-wave for antennas/EMC). Mesh the skin depth (skin effect
needs ≥2-3 elements through δ). Torque-ripple/cogging in a motor → re-shape the slot/
magnet geometry (CAD). Core-loss & efficiency drive lamination/material choice. Connects
to MBD (spinning rotor field, §1.3) and thermal (loss → heat, §1.1).

**Standards.** IEC 60404 (magnetic materials), IEEE Std 1812 (motor sim), CISPR/EMC
limits; TEAM problems (the EM-FEA benchmark suite).

### 1.6 Structural Mechanics (analytical / code-based)

**Bachelors.** Statics & equilibrium; axial/torsion/bending/shear; **Euler-Bernoulli &
Timoshenko beam theory** (EI·d⁴w/dx⁴=q); torsion (St-Venant + warping); stress/strain
transformation & **Mohr's circle**; principal stresses; **failure theories** — von Mises
(ductile), Tresca, max-principal (brittle), Mohr-Coulomb; **Euler buckling**
`P_cr=π²EI/(KL)²` + effective-length K; section properties (I, S, Z, r, J, warping).

**Masters.** Energy methods (Castigliano, virtual work, unit-load, Rayleigh-Ritz); plates
& shells (Kirchhoff/Mindlin, Navier/Lévy solutions); plate local & lateral-torsional
buckling; matrix structural analysis (direct stiffness, flexibility); influence lines;
**plasticity & limit analysis** (yield-line, plastic hinge, lower/upper-bound theorems,
shakedown); pressure vessels (Lamé thick-wall, ASME stress linearization — membrane +
bending + peak); composite/sandwich (classical laminate theory, ABD matrix).

**PhD / research.** Stability theory (Koiter post-buckling, imperfection sensitivity);
shell theory (Donnell/Sanders/Koiter); fracture-coupled limits; structural optimization
(topology/SIMP, sizing, shape); reliability-based design (FORM/SORM, β reliability index).

**Industry judgment.** **Load-path reasoning** — trace force from application to ground;
a member off the load path is dead weight (DFM + cost win). Effective length K is where
buckling designs live or die (pinned 1.0, fixed-fixed 0.5, cantilever 2.0, sway frames
>1). Pick the failure theory by ductility (von Mises for steel/Al, max-principal for cast
iron/ceramics). Hand-calc *first* to sanity-check every FEA (order-of-magnitude is a
senior reflex — `BeamDeflection.cpp` is the in-tree oracle). Code utilization/DCR
(demand-capacity ratio) is the deliverable, not raw stress. Sizing connects directly to
manufacturable sections (rolled shapes, plate thickness, weld access).

**Standards.** AISC 360 & seismic 341 (steel), Eurocode 3 (EN 1993), ASME BPVC VIII
(vessels), ACI 318 (concrete), Eurocode 2; the kernel suite (`BeamDeflection.cpp`,
`FrameTruss.cpp`, `SteelBeamLtb.hpp`, `SteelColumn.cpp`, `PressureVessel.hpp`, `Mohr.hpp`,
`ResponseSpectrum.cpp`) are the analytic oracles.

### 1.7 Fracture Mechanics & Fatigue Analysis

**Bachelors.** Stress concentration (Kt, Peterson/Neuber charts); S-N curve & endurance
limit; **Basquin** `σ_a=σ_f'(2N_f)^b`; mean-stress corrections — **Goodman** `σ_a/σ_e +
σ_m/σ_u = 1`, Gerber, Soderberg; **Miner's rule** `Σn_i/N_i = 1`; LEFM intro — stress
intensity `K_I = Y·σ·√(πa)`, fracture toughness K_IC, critical crack size.

**Masters.** **LEFM** — K_I/II/III, geometry factor Y, crack-tip plasticity (Irwin r_p,
Dugdale strip-yield), R-curve; **EPFM** — J-integral, CTOD, HRR field; **strain-life
(ε-N)** — Coffin-Manson `ε_a = σ_f'/E·(2N_f)^b + ε_f'(2N_f)^c`, Neuber's rule for notches,
Smith-Watson-Topper (SWT) mean-stress; **crack growth** — **Paris** `da/dN = C·(ΔK)^m`,
Forman, **NASGRO**, threshold ΔK_th, closure & retardation; **variable amplitude** —
rainflow counting (ASTM E1049, the kernel's method), cycle-by-cycle; **multiaxial** —
critical-plane (Fatemi-Socie, Brown-Miller, SWT); weld fatigue (hot-spot/notch-stress).

**PhD / research.** Mixed-mode & non-planar crack growth; XFEM/phase-field fracture;
cohesive-zone & VCCT (delamination); ductile damage (Gurson-Tvergaard-Needleman);
probabilistic fatigue (Weibull, P-S-N); very-high-cycle fatigue (VHCF, internal
initiation); environmentally-assisted cracking (corrosion fatigue, creep-fatigue
interaction); short-crack mechanics.

**Industry judgment.** **Regime selection** — HCF (>10⁵ cycles, elastic) → S-N; LCF
(<10⁴, plastic) → ε-N; this choice is the whole analysis. Mean-stress correction by
material/ductility. **Fatigue lives at the geometry**: the killer is the stress
concentration, so the design fix is a *bigger fillet, a smoother transition, a shot-peened/
ground surface* — directly manufacturable and the single highest-leverage change. Damage-
tolerance vs safe-life philosophy (aerospace). FKM-Guideline is the European component-
assessment workflow (Kt/Kf via Siebel-Stieler). Surface finish, residual stress, size
effect, and notch sensitivity are the factors that move life by 10×. Weld hot-spot
extrapolation (IIW) for welded structures. The senior move: a fatigue contour's hot-spot →
add a fillet / change weld detail / specify a finish → re-run, all CAD/PMI edits.

**Standards.** **FKM-Guideline 7th ed. (2020)**; IIW weld recommendations; BS 7910;
ASTM E647 (da/dN), E399 (K_IC), E1820 (J/CTOD), E1049 (rainflow); API 579 fitness-for-
service; the kernel's `Fatigue.cpp`/`FeaExtras.cpp::fatigueLife` is the in-tree oracle.

### 1.8 Kinematics & Dynamics of Machinery

**Bachelors.** Mechanism mobility (Grübler-Kutzbach); four-bar & slider-crank position/
velocity/acceleration (loop-closure equations, vector loops); instant centers &
**Kennedy's theorem**; Grashof criterion (crank-rocker/double-crank/double-rocker);
**cam design** — follower motion laws (uniform/parabolic/SHM/**cycloidal**/3-4-5 & 4-5-6-7
polynomial), pressure angle, undercutting, base-circle sizing; **gear kinematics** —
involute profile, fundamental law of gearing, ratio, interference/undercut, contact ratio.

**Masters.** Gear trains (ordinary, reverted, **planetary/epicyclic** via tabular/formula
method, Willis equation); **AGMA gear geometry & rating** (Lewis bending, Hertzian
contact/pitting); **balancing** — static & dynamic, rotating (correction planes) &
reciprocating (primary/secondary, Lanchester); flywheel sizing (coefficient of
fluctuation, energy method); machine vibration (rotor dynamics intro, critical speed,
Jeffcott rotor, Campbell diagram); gyroscopic effects.

**PhD / research.** Kinematic synthesis (Burmester theory, type/dimensional synthesis,
function/path/motion generation); parallel manipulators & singularity analysis
(Jacobian, workspace); compliant mechanisms (pseudo-rigid-body); rotor dynamics (gyroscopic
matrices, whirl, instability); nonlinear vibration; trajectory optimization.

**Industry judgment.** Mobility & Grashof *before* CAD — they tell you if the linkage even
works. Pressure angle <30° for cams, contact ratio >1.2 for gears, or the mechanism binds/
chatters (these are *geometric* constraints the kernel enforces). Balance rotating
machinery or it fails the bearings (vibration → fatigue, couples §1.7). Critical speed
must clear operating speed by a margin (couples to modal §1.1). Cam motion law choice
(cycloidal for low jerk/noise) drives follower dynamics. The senior move: a coupler curve
that doesn't trace the required path → re-synthesize link lengths (Burmester → CAD
parameters); an undercut gear → increase teeth / use profile shift (CAD geometry).

**Standards.** AGMA 2001/2101 (gear rating), AGMA 908 (geometry factors); ISO 6336;
Shigley's & Norton's as the canonical texts; the kernel's `MultibodyDynamics.cpp` +
`MotionStudy.cpp` + gear/cam kinematic modules are the oracles.

---

## 2. DATA SOURCES (premium / authoritative only)

> Streaming discipline: download → process → delete one source at a time (`iter_batches`
> for parquet), accumulator-dedup. Open-standards *text* is cited as answer-key, not
> scraped wholesale; proprietary standards are referenced by clause, not reproduced.

### 2.1 Canonical textbooks (the answer keys)

| Discipline | Premium references |
|---|---|
| **FEA** | Hughes *The Finite Element Method* (linear); Bathe *Finite Element Procedures*; Zienkiewicz & Taylor *The FEM* (3 vols); Belytschko, Liu, Moran *Nonlinear FE for Continua & Structures*; Cook, Malkus, Plesha *Concepts & Applications of FEA*; Wriggers *Nonlinear FEM* & *Computational Contact Mechanics*; Simo & Hughes *Computational Inelasticity* (the kernel's J2 radial-return source) |
| **CFD** | Ferziger & Perić *Computational Methods for Fluid Dynamics*; Versteeg & Malalasekera *An Introduction to CFD: The FVM*; Pope *Turbulent Flows*; Wilcox *Turbulence Modeling for CFD*; Anderson *Computational Fluid Dynamics*; Toro *Riemann Solvers & Numerical Methods*; White *Viscous Fluid Flow* |
| **MBD** | Shabana *Dynamics of Multibody Systems* & *Computational Dynamics*; Haug *Computer-Aided Kinematics & Dynamics*; Nikravesh *Computer-Aided Analysis of Mechanical Systems*; Featherstone *Rigid Body Dynamics Algorithms* |
| **Aeroacoustics** | Howe *Theory of Vortex Sound* & *Acoustics of Fluid-Structure Interactions*; Goldstein *Aeroacoustics*; Crighton et al. *Modern Methods in Analytical Acoustics* |
| **EM** | Jin *The FEM in Electromagnetics*; Bossavit *Computational Electromagnetism*; Jackson *Classical Electrodynamics*; Bianchi *Electrical Machine Analysis Using FE* |
| **Structural Mech.** | Timoshenko & Gere *Theory of Elastic Stability* & *Mechanics of Materials*; Boresi & Schmidt *Advanced Mechanics of Materials*; Ugural & Fenster; Roark's *Formulas for Stress & Strain*; AISC *Steel Construction Manual* |
| **Fracture/Fatigue** | Anderson *Fracture Mechanics: Fundamentals & Applications*; Suresh *Fatigue of Materials*; Dowling *Mechanical Behavior of Materials*; Stephens et al. *Metal Fatigue in Engineering*; FKM-Guideline 7th ed. |
| **Kinematics** | Norton *Design of Machinery*; Shigley & Uicker *Theory of Machines & Mechanisms*; Erdman & Sandor *Mechanism Design*; Wilson & Sadler *Kinematics & Dynamics of Machinery* |

### 2.2 Open courseware (structured curriculum spine)

- **MIT OCW**: 2.092/2.093 *Finite Element Analysis of Solids & Fluids* (Bathe);
  16.920 *Numerical Methods for PDEs*; 2.06/2.080 *Structural Mechanics*; 2.25 *Advanced
  Fluid Mechanics*; 16.110 *Flight Vehicle Aerodynamics*; 2.003/2.004 *Dynamics & Control*;
  6.013 *Electromagnetics*; 3.11 *Mechanics of Materials*.
- **Stanford** ME335 (FEM), ME469 (CFD); **Cornell** ANSYS/SimCafe CFD & FEA tutorials
  (verification-focused); **CU Boulder** ASEN FE courses (Felippa's free, rigorous FEM
  notes — excellent answer-key derivations); **NPTEL** (IIT) full courses on FEM/CFD/ToM/
  fracture; Caltech/Ae aeroacoustics.

### 2.3 Standards bodies & validation references

- **NAFEMS** (FE/CFD benchmark library — LE1/LE10/T-series/FV-series, Scordelis-Lo,
  pinched cylinder) — *the* known-answer set for structural FE.
- **NASA Turbulence Modeling Resource** + **AIAA CFD V&V** + **ERCOFTAC** classic database
  (Ghia cavity, backward-step, periodic hills) — CFD known-answers.
- **ASME V&V 10/20/40**, **ISO 16407** — credibility process (drives the VVUQ corpus).
- **TEAM problems** — EM-FEA benchmarks.
- Domain codes: AISC 360, Eurocode 2/3, ASME BPVC II/VIII, ACI 318, AGMA 2001/2101 &
  ISO 6336, FKM-Guideline, IIW, BS 7910, API 579, ISO 3744/5136, IEC 60404.

### 2.4 Papers (canonical methods — the PhD layer)

Ghia, Ghia & Shin 1982 (cavity); Menter 1994 (k-ω SST); Spalart-Allmaras 1992; Jeong &
Hussain 1995 (λ₂ vortex); Hilber, Hughes & Taylor 1977 (HHT-α); Negrut et al. ANL P1278
(index-3 DAE); Ffowcs Williams & Hawkings 1969; Lighthill 1952; Simo & Hughes (radial
return); Zienkiewicz & Zhu 1987 (SPR error estimator); Paris & Erdogan 1963 (da/dN);
Bathe MITC shell papers; de Vahl Davis 1983 (buoyant cavity); Belytschko XFEM. *(These are
cited as method-provenance + embedded known-answer data, per `feedback-validate-published-
references` — tier-1 samples carry the named benchmark target.)*

### 2.5 Datasets (real-data seam — CC0/clean)

- **NASA/AIAA workshop geometries** (drag-prediction, high-lift) — CFD validation cases.
- **NAFEMS / open FE benchmark meshes** — structural known-answers.
- **DeepCAD / Fusion360 Gallery / ABC** — geometry to *attach* simulation BCs to (so the
  physics corpus is grounded on real CAD, not abstract domains), via `ingest_deepcad.py`.
- The **kernel itself is the dominant dataset**: every synthetic sample's geometry is
  built and solved by Forge, producing a *Forge-labeled performance vector* (the owned-
  kernel advantage — deterministic, offline, free; what P-1/Prometheus must license sim for).

---

## 3. SYNTHETIC-DATA GENERATION PLAN (`bulk_synth_physics.py`, Cluster 2)

> **Programmatic, not hand-authored.** `bulk_synth_physics.py` exists
> (`archdisc-Models/scripts/`). Agents top out at 40-60 samples; bulk_synth emits
> millions. Every generator emits JSONL `{messages:[system,user,assistant]}`, the
> assistant ending in one or more schema-valid `forge.<wb>.<op>(args)` calls (or a
> structured numeric answer + call). **Dynamic-first** (transient/modal/forming/motion
> over static snapshots, per the bible). **Target ~2M unique** for the cluster.

### 3.1 Sample archetypes (what to generate)

**(A) Knowledge / recall Q→A (Bloom L1-L2, ~25 %).** Equation, property, standard-clause,
model-selection recall. *"What is the geometry factor Y in K_I=Y·σ√(πa) for an
edge crack in a finite-width plate?"* → derivation + value. Grounds the answer keys
(§1, §2). Verified against the textbook/standard.

**(B) Problem → solution (Bloom L3, ~30 %).** A fully-specified analysis problem solved
end-to-end with the governing equation, the numbers, units, and a sanity check. *"A
cantilever, L=200 mm, 20×10 mm rectangular Al-6061, tip load 500 N — tip deflection,
max bending stress, FoS, and which solver verb."* → hand-calc (PL³/3EI, Mc/I) → **then the
`forge.fea.staticLinear` call** → and the cross-check that the verb's σ_max should match
the hand-calc within mesh tolerance. **The hand-calc IS the kernel oracle** (`BeamDeflection.cpp`,
the cantilever vvuq gate) — this is the grounding.

**(C) Design → critique (Bloom L4, ~20 %).** A design + a simulation result → diagnose the
problem → propose the fix → **emit the CAD/CAE edit verb**. *"FEA shows 480 MPa von Mises
at a sharp internal corner of this bracket (yield 276 MPa). Diagnose and fix."* → "that's a
re-entrant-corner singularity (Williams), not a real stress — vvuq would flag RED; the fix
is a fillet, which is also what makes it castable" → `forge.fillet(edge, r=3)` → re-run
`forge.fea.staticLinear` → confirm SF≥1.5. **This is the heart of the senior-engineer
behavior and the manufacturability tie-in.**

**(D) Tool-call sequencing (Bloom L3-L5, ~15 %).** Multi-step Forge workflows: build
geometry → assign material → apply face-based BCs → mesh → solve → read structured report.
Every step a real verb. E.g. modal study: `forge.material.lookup` → `forge.fea.meshFromBrep`
→ `forge.fea.solveModal({nModes:6})` → interpret f₁ vs an excitation frequency → if f₁
lands on a forcing freq, stiffen and re-run. Face-based, geometry-grounded specs (pin face
N, load face M) so Archie reasons in CAD terms, not node IDs.

**(E) Honesty / OOD samples (Bloom L6, ~10 %).** Teach the validated envelope. *"Simulate
turbulent flow over this wing at Re=2×10⁶."* → "the kernel's CFD is validated-laminar
(Chorin projection, Poiseuille 4 %); there is no turbulence model yet, so vvuq caps this at
AMBER — I'll run the laminar solve and *flag* that the result is not turbulence-validated;
for a trustworthy answer we need k-ω SST + a y⁺-resolved inflation mesh." → runs
`forge.cfd.steadyIncompressible` *with the honest caveat in the report*. Never fabricate a
turbulent number. Same pattern for Hertz contact (illustrative), sharp-corner singularities,
under-converged meshes.

### 3.2 Per-discipline generator functions (inside `bulk_synth_physics.py`)

| Generator | Discipline | Answer-key equations (verbatim) | Tool-call target(s) |
|---|---|---|---|
| `gen_fea_static` | FEA | `[K]{u}={F}`, Mc/I, PL³/3EI, von Mises | `forge.fea.staticLinear` |
| `gen_fea_modal` | FEA | `([K]−ω²[M])φ=0`, f_n, MAC, eff. mass | `forge.fea.modal` |
| `gen_fea_transient` | FEA | Newmark β¼γ½, HHT-α, Rayleigh C | `forge.fea.transient` |
| `gen_fea_thermal` | FEA | ρc∂T/∂t=∇·(k∇T)+q, Robin, CTE warp | `forge.fea.thermalTransient` |
| `gen_fea_nonlinear` | FEA | K_T=K_L+K_σ, Newton, arc-length, J2 radial return | `forge.fea.nonlinearStatic`, `.contact`, `.buckling` |
| `gen_locking_amr` | FEA | Wilson-Q6/B-bar/EAS, ZZ-SPR η, h/p, Richardson/GCI | `vvuqConvergence` |
| `gen_cfd_laminar` | CFD | NS, Chorin projection, ∇·u→0, Re, CFL, Poiseuille | `forge.cfd.steadyIncompressible`, `.transient` |
| `gen_cfd_turbulence` | CFD | SST k-ω blending, y⁺, log-law, Ghia/Blasius/Strouhal | `forge.cfd.turbulence` *(aspirational verb)* |
| `gen_cfd_thermal` | CFD | energy eq, Nu, Ra, Boussinesq, de Vahl Davis | `forge.cfd.conjugateHeat` |
| `gen_mbd` | MBD | index-3 DAE KKT, HHT-α, Baumgarte, Grübler M | `forge.simulate.multibodyDynamics`, `forge.mbd.assemble` |
| `gen_autombd` | MBD | mate-graph→joints, Grübler mobility, MassProps inertia | `forge.simulate.auto-mbd` *(aspirational)* |
| `gen_aeroacoustics` | Aeroacoustics | Lighthill, FW-H, BPF=N·RPM/60, SPL=20log(p/p_ref) | `forge.aeroacoustics.fwh`, `.bpf` *(aspirational)* |
| `gen_emag` | EM | Maxwell, B=∇×A, Steinmetz, Maxwell stress, δ skin | `forge.emag.magnetostatic`, `.eddyCurrent`, `.motorTorque` *(aspirational)* |
| `gen_structural` | Struct. Mech. | EI w''''=q, P_cr=π²EI/(KL)², Mohr, von Mises, Lamé | `forge.struct.beam/frame/truss/buckling/mohr/vessel` |
| `gen_fracture` | Fracture | K_I=Y·σ√(πa), J-integral, K_IC, critical a | `forge.fracture.sif`, `.crackGrowth` |
| `gen_fatigue` | Fatigue | Basquin, Coffin-Manson, Goodman, Miner, Paris da/dN, FKM | `forge.fea.fatigueLife`, `forge.fatigue.strainLife/criticalPlane/fkm` |
| `gen_kinematics` | Kinematics | Grübler, loop-closure, involute, AGMA, balancing, cam laws | `forge.kinematics.*`, `forge.mbd.*` |
| `gen_eval` (eAGI P1) | all | full multiphysics performance vector in one call | `forge.simulate.*` |
| `gen_outcome` (Prometheus) | all | design-change → simulated outcome-delta (sweeps) | parametric edit + re-`forge.simulate.*` |

`gen_outcome` is the **owned-kernel differentiator**: run real Forge solvers over
parametric sweeps to label `(design-change → outcome-delta)` pairs — *fillet R2→R5 →
Δpeak-stress*, *Al-6061→Ti-6Al-4V → Δmass/Δstiffness/Δf₁*, *wall 2→3 mm → ΔFoS*. These are
deterministic, offline, free — P-1/Prometheus must license third-party sim for the same.

### 3.3 GROUNDING (kernel-verifiable wherever geometric)

The non-negotiable that keeps this corpus from hallucinating:

1. **Geometry is built and solved by Forge.** Each generated problem instantiates a real
   parametric body via kernel verbs; the BCs are face-based (the kernel distributes to
   nodes); the solver actually runs. The "ideal answer" σ_max / f₁ / deflection is the
   *kernel's own output*, not an invented number — so the label is correct by construction.
2. **Analytical gates as the truth.** Where a closed form exists (cantilever PL³/3EI &
   Mc/I, SS-beam 5wL⁴/384EI, Euler P_cr, pendulum 2π√(L/g), Lamé hoop stress, lid-cavity
   Ghia, Strouhal 0.2, Blasius Cf), the sample embeds the *named published target* and the
   answer must land within the characterized error band (the same gates vvuq ships:
   `cantileverTipDeflection`, `lamePressurizedStress`, the convergence/GCI/energy/y⁺ checks).
   This is the `feedback-validate-published-references` mandate.
3. **VVUQ in the loop.** Singularity samples must say RED at a sharp re-entrant corner;
   under-converged-mesh samples must show the GCI band; turbulent-CFD samples must cap at
   AMBER. The honesty layer is both a topic *and* a grader.
4. **ForgeCADScore / replay scoring offline.** Geometric tool-call sequences are scored by
   replaying them in the kernel (validity/shape/topology) — the same offline reward used
   for DPO. A physics sample that builds invalid geometry is rejected before training.
5. **Self-correction multi-turn.** A fraction of samples are multi-turn: Archie reads the
   solver's structured report + a render/validation feedback and converges (thicken rib →
   re-sim → SF now 1.7 → done) — mirroring the closed loop §3.1-C.

### 3.4 How this makes Archie better INSIDE Forge (not just chat)

The whole point: Archie *drives the CAD*. Every archetype terminates in a verb the kernel
replays, so training optimizes the exact behavior the demo needs:

- **Trigger** — Archie emits `forge.fea.*` / `forge.cfd.*` / `forge.simulate.*` with a
  geometry-grounded (face-based) spec.
- **Interpret** — it reads the structured numeric report (`maxVonMises_MPa`,
  `safetyFactor`, `f_n[]`, `reynolds`, `regime`, `energyDrift`, `minLife_cycles`,
  `maxContactPressure`) against an engineering criterion (SF≥target, f₁ clear of excitation,
  Re-regime, stable=true, life≥design-cycles).
- **Act (close the loop)** — on a failing criterion it *edits the model and re-sims*:
  thicken a rib / add a fillet / change material if SF<1.5; re-route a flow path on
  separation; add a counterweight if MBD forces spike; stiffen to shift f₁ off a forcing
  frequency. Same verb, re-read the report — a genuine design-iterate-verify loop, all CUA.

This trains the CADGenBench *physics-correct + acts-on-results* dimension *and* keeps every
output manufacturable (the fix is always a real geometric/material/PMI edit, not a
fictional patch). It feeds curriculum stage **S2 Physics** (`arch14b-physics` adapter) with
acceptance gate eAGI L1-L3 ≥0.85 + turbulent-CFD honesty held (per `archie_corpus_program §6`).

---

## 4. EXAMPLE TRAINING SAMPLES (depth illustration)

> Schema: `{messages:[{role:system},{role:user},{role:assistant}]}`. System prompt
> (abbreviated here) establishes Archie as the Forge CAE engineer with the tool schema.
> Assistant shows the *reasoning trace then the verb* — the R1-style chain the base model
> carries, terminating in a replayable call.

### Sample 1 — FEA static, problem→solution→tool-call, analytically grounded (Bloom L3)

```json
{"messages":[
 {"role":"system","content":"You are Archie, a senior CAE engineer who drives Forge via tool-calls. Reason rigorously, validate against analytical truth, end in a schema-valid forge.* call."},
 {"role":"user","content":"A cantilever beam, length 200 mm, rectangular cross-section 20 mm wide x 10 mm deep, Aluminum 6061-T6 (E=68.9 GPa). A 500 N downward tip load. Give tip deflection, max bending stress, factor of safety against yield, and run the analysis in Forge."},
 {"role":"assistant","content":"Analytical first (this is my sanity check on the FE result).\n\nSecond moment of area about the bending axis: I = b·h^3/12 = 20·10^3/12 = 1666.7 mm^4.\nTip deflection (Euler-Bernoulli, end load): delta = P·L^3/(3·E·I) = 500·200^3/(3·68900·1666.7) = 4.0e9 / 3.446e8 = 11.6 mm.\nMax bending moment at the root: M = P·L = 500·200 = 1.0e5 N·mm.\nMax bending stress (outer fiber, c = h/2 = 5 mm): sigma = M·c/I = 1.0e5·5/1666.7 = 300 MPa.\nAl-6061-T6 yield sigma_y = 276 MPa, so FoS = 276/300 = 0.92 < 1 -> this beam YIELDS. Linear-elastic FEA will report ~300 MPa but the real part has plastically deformed; the linear result is the elastic-predicted stress and the design is inadequate.\n\nNote: 11.6 mm tip deflection is ~6% of the 200 mm length, near the small-deflection validity edge; flag if it grows. I model this with a Wilson-Q6 incompatible-modes hex mesh (kills shear locking; validated to 0.33% vs PL^3/3EI), pin the root face, distribute the load on the tip face.\n\nVerdict for the engineer: increase depth h. To get FoS=1.5, sigma must drop to 184 MPa; since sigma ~ 1/h^2 for fixed load/length, h_new = 10·sqrt(300/184) = 12.8 -> use h=14 mm (FoS~1.65, also reduces deflection ~3.6x). That is a single parametric edit, fully manufacturable.\n\nforge.fea.staticLinear({\n  body: extrude(rect(20,10), 200),\n  material: { id: 'AL6061T6', E: 68900, nu: 0.33, rho: 2.70e-9, sigmaY: 276 },\n  bc: [ { type:'fixed', face:'x_min' } ],\n  load: [ { type:'force', face:'x_max', vector:[0,-500,0] } ],\n  mesh: { element:'hex8_q6', size: 2.5 },\n  outputs: ['maxVonMises_MPa','tipDisplacement_mm','safetyFactor']\n})\n// Expect: tipDisplacement ~ 11.6 mm, maxVonMises ~ 300 MPa, safetyFactor ~ 0.92.\n// Cross-check the FE sigma against my hand-calc 300 MPa within mesh tolerance; if they disagree >5%, the mesh or BC is wrong, not the design."}
]}
```

### Sample 2 — design→critique→fix, manufacturability + VVUQ honesty (Bloom L4)

```json
{"messages":[
 {"role":"system","content":"You are Archie ... end in a schema-valid forge.* call."},
 {"role":"user","content":"My FEA of this cast steel lever shows 612 MPa von Mises at the inside corner where the arm meets the boss (material yield 350 MPa). The applied load is correct. Is the part failing, and what do I do?"},
 {"role":"assistant","content":"Before condemning the part: a 612 MPa peak at a SHARP inside (re-entrant) corner is the classic FEA red flag, not necessarily a real stress. A perfectly sharp re-entrant corner is a Williams stress singularity -- the elasticity solution there is unbounded, so the FE stress just keeps climbing as you refine the mesh and NEVER converges. The honest test is a mesh-convergence check: if the corner stress rises monotonically with refinement (no plateau), it is a singularity artifact. Forge's VVUQ layer detects exactly this (Williams re-entrant-corner check) and will return RED / 'not fit for purpose' for that location.\n\nMy diagnosis: this is almost certainly a meshing/geometry artifact AT THE SHARP CORNER. The cure is geometric and is also what makes the casting sound: ADD A FILLET. Cast steel needs generous internal radii anyway (to avoid hot tears and stress risers and to let metal feed), so this is doubly correct -- it fixes the FE singularity AND improves manufacturability. A fillet gives a finite, mesh-convergent stress I can actually trust.\n\nPlan: (1) confirm it's a singularity with a 3-level convergence run; (2) add a fillet (start R = 0.5x the local wall thickness, a standard casting rule); (3) re-mesh with refinement at the fillet and re-solve; (4) verify the corner stress now CONVERGES (GCI band tight) and check FoS.\n\nStep 1 -- prove the singularity:\nvvuqConvergence({ body: currentBody, location:'arm_boss_corner', meshLevels:[4.0, 2.0, 1.0], solver:'fea.staticLinear' })\n// Expect: monotone-rising corner stress, no asymptote -> verdict RED (singularity). Confirms it's an artifact.\n\nStep 2+3 -- fix geometry and re-solve:\nforge.fillet({ edges:['arm_boss_inner_corner'], radius: 6 })  // ~0.5x the 12 mm wall; castable internal radius\nforge.fea.staticLinear({\n  body: currentBody,\n  material:{ id:'CAST_STEEL', E:200000, nu:0.30, sigmaY:350 },\n  bc:[{type:'fixed', face:'mount'}],\n  load:[{type:'force', face:'arm_tip', vector:[0,-1200,0]}],\n  mesh:{ element:'tet10', size:3.0, refine:[{feature:'fillet', size:0.75}] },\n  outputs:['maxVonMises_MPa','safetyFactor']\n})\n// Now the stress is finite and convergent. If FoS still < 1.5, increase the fillet to R=8 or thicken the arm and re-run -- both single parametric edits. I will NOT report the 612 MPa singular value as a real stress; that would be fabricating a failure."}
]}
```

### Sample 3 — MBD mechanism, mobility + dynamics + interference, tool-call sequence (Bloom L3-L5)

```json
{"messages":[
 {"role":"system","content":"You are Archie ... end in a schema-valid forge.* call."},
 {"role":"user","content":"I built a slider-crank assembly: crank 50 mm, connecting rod 150 mm, driven at 3000 rpm. Will it run, and can you simulate the dynamics and check the rod doesn't hit anything?"},
 {"role":"assistant","content":"First the kinematic gate -- I check mobility BEFORE simulating, because a bad linkage is a 30-second find, not a 10-minute solve. A planar slider-crank has n=4 links (ground, crank, rod, slider), j1=4 lower pairs (3 revolutes + 1 prismatic), j2=0. Grubler (planar): M = 3(n-1) - 2*j1 - j2 = 3*3 - 2*4 - 0 = 9 - 8 = 1. One DOF -> exactly right for a single driver. It will run, fully constrained, no redundancy.\n\nKinematics check (closed form, my oracle for the sim): with crank r=50, rod l=150, ratio n=l/r=3. Piston stroke = 2r = 100 mm. At omega = 3000 rpm = 314.16 rad/s, peak piston acceleration ~ r*omega^2*(1 + 1/n) = 0.050*314.16^2*(1+1/3) = 4935*1.333 = 6580 m/s^2 (~670 g) -- large reciprocating inertia, so I expect significant secondary (2x) forces; this drives balancing and bearing-load concerns.\n\nI'll AUTO-extract the mechanism from the assembly mates (no manual joint setup): concentric+coincident crank-pin -> revolute, etc., inertia from geometry via MassProps. Then run the validated index-3 DAE solver (HHT-alpha + Baumgarte, pendulum-validated 0.016%, energy-drift monitored), and sweep the rod through the cycle as a swept volume to check clearance against the housing.\n\nStep 1 -- extract + run dynamics:\nforge.simulate.auto-mbd({\n  assembly: currentAssembly,\n  driver:{ joint:'crank_revolute', type:'angularVelocity', value: 314.16 },  // 3000 rpm\n  gravity:[0,-9810,0],\n  integrator:'hht-alpha', alpha:-0.05,\n  duration: 0.04, // 2 crank revolutions at 3000 rpm\n  outputs:['bodyTransforms','jointReactions_N','energyDrift','stable']\n})\n// Read: peak jointReactions at the crank-pin bearing vs its rated load; energyDrift must be ~0 (conservation proof); stable=true.\n\nStep 2 -- interference / clearance over the full cycle:\nforge.mbd.sweptVolume({ body:'connecting_rod', motion:'<from step 1>', against:['housing','cylinder_wall'], report:'minClearance_mm' })\n// If minClearance <= 0 the rod collides -> redesign (shorten rod throw, widen housing relief -- a parametric CAD edit). If the crank-pin reaction exceeds the bearing rating -> up-size the bearing or counterweight the crank to cut the reciprocating force. Both are real, manufacturable design changes I would apply and re-run."}
]}
```

---

## 5. CORPUS SCALE & CURRICULUM PLACEMENT

- **Target ~2M unique samples** for the CAE/physics cluster (per `archie_corpus_program §3`,
  Cluster 2, dynamic-first), distributed roughly: FEA 30 %, CFD 18 %, Fracture/Fatigue 12 %,
  Structural Mechanics 12 %, MBD 10 %, Kinematics 8 %, EM 5 %, Aeroacoustics 5 %, with the
  eAGI `gen_eval`/`gen_outcome` cross-cut woven through all (~10 % overlap).
- **Generation engine:** extend `bulk_synth_physics.py` with the §3.2 generator functions;
  each draws random-but-physical parameters, builds+solves in Forge for the label, embeds
  the analytical/benchmark gate, and emits the verb. **Storage-safe streaming**
  (download→process→delete, `iter_batches`, accumulator-dedup); **no `--mask-prompt`** on
  long reasoning samples (NaN risk per memory); chat-template every sample.
- **Curriculum stage:** feeds **S2 Physics** → `arch14b-physics` adapter (on the S0-math +
  S1-geometry base). **Acceptance gate:** eAGI L1-L3 objective ≥0.85 (symbolic solver +
  Forge-sim graded), turbulent-CFD honesty held, every tool-call schema-valid & kernel-
  replayable. Promote only on green; restart serve fresh before eval.
- **Eval:** `gauntlet_staged.py` per-discipline probes scored against the analytical gates
  (the same vvuq oracles) + ForgeCADScore replay for the geometric verbs + genuine-CUA
  Forge smoke (varied prompts, ≥5 cam angles, headed).

> **Bottom line.** This cluster trains Archie to *be the CAE engineer in the loop*: pick the
> physics + fidelity, set it up defensibly, read it against a criterion, and drive a real
> manufacturable CAD/PMI edit through a Forge verb — every number grounded in the kernel's
> own validated solvers or a named published benchmark, every honest gap surfaced not faked.
