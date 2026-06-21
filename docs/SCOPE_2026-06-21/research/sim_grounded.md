# Forge — Grounded, Fully-Visual, Fully-Dynamic Simulation Engine (SCOPE 2026-06-21)

> **Mandate.** Every simulation Forge renders ON the model must be *grounded* (driven by a real, verified numerical solver — never a decorative colormap), *fully-visual* (field-on-geometry, GPU-accelerated, Ansys/Abaqus-grade post), and *fully-dynamic* (time-resolved: NO statics — deformation animates, flow advects, mechanisms move, modes oscillate). North-star: Archie-driving-Forge ≥ 0.85 on CADGenBench across *every* dimension, including the "physics-correct + visually-verifiable" dimension.
>
> **Honesty contract (inherited from `SIM_VALIDATION.md` / Forge Engineering Bible 0/9).** A field is rendered only when the solver ran, converged, and has a characterized error vs an analytical/benchmark truth. If the kernel is offline or diverged, the pipeline returns `{ error }` and paints nothing. The visualizer's `kernel()` guard (`caeViz.js:69`) is the canonical pattern: *never fabricate physics*.

---

## 0. Where we are today (grounding inventory — `file:line` cited)

This spec is an *upgrade plan layered on a working pipeline*, not greenfield. The solver→field→GPU path already exists and is validated:

| Layer | File | Status (per `SIM_VALIDATION.md`) |
|---|---|---|
| Linear static FEA (hex8, **incompatible-modes / Wilson-Q6**) | `forge-kernel/src/Fea.cpp` | **GROUNDED** 0.33 % vs PL³/3EI, monotone h-convergence |
| Modal FEA (hex8, **consistent mass**) | `forge-kernel/src/Fea.cpp:672` | **GROUNDED** 0.2 % vs f₁=(1.8751)²/2π·√(EI/ρAL⁴) |
| Transient FEA (**Newmark-β**, β=¼ γ=½) | `forge-kernel/src/Fea.cpp:711,772` | GROUNDED (stable scheme, linear regime) |
| Steady thermal (∇·(k∇T)+q=0, Robin BCs) | `forge-kernel/src/ThermalNetwork.cpp` | **GROUNDED** 0 % (q=kΔT/L) |
| Buckling (geometric-stiffness eig.) | `forge-kernel/src/FeaExtras.cpp` | GROUNDED 13.7 % within Euler band |
| Fatigue (rainflow ASTM-E1049 + Basquin/Goodman/Miner) | `forge-kernel/src/FeaExtras.cpp:561` | GROUNDED within Basquin band |
| J2 plasticity (radial return, Simo-Hughes) | `forge-kernel/src/FeaContact.cpp:843` + JS `nonlinearFea.js` | **GROUNDED** machine-ε (JS path) |
| Penalty contact (node-to-surface, Wriggers) | `forge-kernel/src/FeaContact.cpp:541` | **ILLUSTRATIVE** — Hertz 59 % off; needs Lagrange + refine |
| Incompressible CFD (**Chorin projection, Harlow-Welch MAC**) | `forge-kernel/src/Cfd.cpp` | **GROUNDED** ∇·u→1e-13, Poiseuille 4 % (LAMINAR only) |
| Multibody dynamics (**index-3 DAE, HHT-α + Baumgarte**) | `forge-kernel/src/MultibodyDynamics.cpp` | **GROUNDED** pendulum 0.016 %, rotor 0.00 % |
| Kinematic motion study (constraint playback) | `forge-kernel/src/MotionStudy.cpp` + `AssemblySolver.cpp` | ILLUSTRATIVE (kinematic, no inertia) |
| **GPU post-processor** (turbo contour, nodal averaging, legend, equation cards, streamlines, deformed-shape) | `frontend/src/forge-v4/caeViz.js` (811 ln) | working, equation-grounded |
| FEA viz (stress field, deform, **modal animation**, iso-contours, min/max markers, probe) | `frontend/src/kernel/simulation/FEAVisualizer.js` (464 ln) | working |
| Solver dispatch + progress bus + residual stream | `frontend/src/forge-v4/simulationDispatch.js` (495 ln) | working |
| Archie trigger verbs (`simulate.fea-static/modal/dynamic/buckling/thermal/fatigue/nonlinear/contact/cfd/multibody-dynamics/dynamics-motion/tolerance-stack`) | `frontend/src/ai/ForgeToolBridge.js:1421-1957` | working |

**Known gaps to close (this scope):** (1) turbulent/RANS CFD — not implemented; (2) Hertz contact not validated; (3) contact-pressure magnitude unphysical; (4) no transient CFD animation (only steady); (5) no FSI; (6) no electromagnetics/acoustics solvers; (7) no AUTO-MBD (mechanism auto-extraction from mates); (8) GPU pipeline is CPU-side Three.js BufferGeometry rebuild per frame — must move to GPU compute (Metal/WebGPU) for ≥60 fps on big fields; (9) no swept-volume / motion-capture trajectory rendering; (10) Archie cannot yet *interpret a field result and act* (close-loop redesign → re-sim).

---

## 1. The universal pipeline: Solver → Field → GPU-Visualization

Every sim type flows through one canonical pipeline so the post-processor, Archie interface, and UI are uniform. The stages:

```
 (A) PRE       (B) SOLVE          (C) FIELD            (D) MAP            (E) RENDER          (F) DYNAMICS
 geometry  →   native kernel   →  raw DOF arrays   →  field recovery  →  GPU primitive   →  time playback /
 + BCs/mesh    (Eigen/Metal)      (u, σ, T, p, v,    (nodal avg, grad,   (vertex colors,    real-time advect /
 + material    converged +        ω(t), ϕ_i)         derived scalars,    glyphs, iso,       morph, motion-capture
               error-checked                         vortex Q/λ₂)        particles, morph)   of moving parts
```

### 1.A Pre-processing (mesh + BC tagging)
- **Mesher.** Today: boundary-clipped axis-aligned **hex8 grid** (`meshFromBRep`, inside-test via `BRepClass3d_SolidClassifier`) + Bowyer-Watson **tet4** path (`FeaTet.cpp`). **Upgrade:** in-house Delaunay/advancing-front **tet10 (quadratic)** + **boundary-layer prism** inflation for CFD walls (y⁺ control), curvature-adaptive sizing. Mesh carries `nodeToFace` bitmask for face-based BC tagging — Archie/UI pin/load a *face*, the pipeline distributes to nodes (`distributeForceFace`, `pinFace`, `rollerFace` in `simulationDispatch.js:411-449`).
- **Material library.** `{E, nu, rho, k, sigmaY, H, alpha_CTE, sn-curve, mu_friction}` — extend with anisotropic `C` (orthotropic/composite Cᵢⱼₖₗ), temperature-dependent `E(T)`, hyperelastic (Neo-Hookean/Mooney-Rivlin/Ogden) constants.

### 1.B Solve (native kernel — grounded numerics)
All linear algebra on **Eigen** (sparse `SimplicialLDLT`/`SparseLU`, dense `GeneralizedSelfAdjointEigenSolver`) + in-house PCG; large eigenproblems move to **Lanczos/subspace iteration** (replacing the dense modal path's ~1500-DOF ceiling). Solver families in §2-§6. **GPU offload:** the hot kernels (element K assembly, mat-vec for PCG, MAC projection, particle advection) move to **Metal compute shaders** via the native addon (M4 Max has 40-core GPU); the saddle-point/Poisson factorizations stay CPU (Eigen) where sparse direct beats iterative at this scale.

### 1.C Field recovery (DOF → engineering field)
- **Nodal averaging** (`caeViz.js:108 nodalAverage`): per-element scalar (von-Mises, |q|) → smooth per-node field by incidence-averaging. This is the standard Abaqus/Ansys *unaveraged→averaged surface stress recovery*, NOT a cosmetic blur (header note `caeViz.js:104`).
- **Super-convergent patch recovery (SPR, Zienkiewicz-Zhu)** — *upgrade* over plain averaging for the contour + a free **error estimator** η (drives adaptive remesh and an honest "mesh-converged?" badge).
- **Derived fields:** principal stresses σ₁₂₃ (eig of stress tensor), strain ε, safety factor σ_Y/σ_vM, displacement magnitude |u|, temperature gradient ∇T, heat flux q=−k∇T, velocity magnitude |u|, vorticity ω=∇×u, **Q-criterion** Q=½(‖Ω‖²−‖S‖²), **λ₂** (2nd eigenvalue of S²+Ω²), pressure coefficient Cp, wall shear τ_w, Mach.

### 1.D Map to GPU primitive (the visual vocabulary)
| Primitive | Used for | GPU technique |
|---|---|---|
| **Per-vertex color contour** | scalar fields (σ, T, p, \|u\|) | vertex `color` attribute + turbo/jet/viridis/coolwarm colormap LUT in fragment shader; smooth-shaded `MeshStandardMaterial` |
| **Deformation morph** | FEA displacement (real scaled) | vertex shader `pos += scale·u_node`; scale auto = 6 % of model diagonal / max-disp (`caeViz.js:171`) so deflection is visible AND honest (label states ×factor) |
| **Iso-surface / iso-line** | 3D scalar threshold, Q/λ₂ vortices | **GPU Marching Cubes** (transform-feedback / compute) over the field grid; iso-lines via marching-triangles (`FEAVisualizer.addStressContours:287`) |
| **Glyphs** (arrows / cones / tensor ellipsoids) | vector (velocity, flux, force) + tensor (stress) | instanced arrows oriented+scaled by field; **tensor glyphs** = ellipsoid from eig(σ) showing principal directions |
| **Streamlines / pathlines / streaklines** | flow topology | **RK4 integration** of the velocity field, colored by local \|u\| (`caeViz.js:637`); pathlines integrate the *unsteady* field, streaklines seed continuously |
| **Particle system** | transient advection ("smoke in the wind tunnel") | GPU particle pool advected by RK4 in a Metal/WebGPU compute pass; ~10⁵-10⁶ particles, re-seeded at inlet, faded by age |
| **LIC (Line Integral Convolution)** | dense 2D flow texture on a cut-plane / surface | GPU texture-advection (½-px step, ~20 RK4 iters per the LIC literature); UFLIC for the unsteady case |
| **Cut-planes / clip / volume slices** | interior fields | section the field grid; **volume ray-march** for translucent 3D scalar (temperature plume, pressure cloud) |
| **Trajectory ribbons + swept volumes** | MBD moving parts | poly-line trace of a body point over the run; swept volume = union/convex-hull sweep of the moving B-rep (kernel boolean) → collision/clearance check |

All overlays are tagged `data-forge-cae` / `userData.forgeCae` so `clearCaeOverlays()` (`caeViz.js:363`) tears them down cleanly before the next field. Legend scale-bar + on-canvas **governing-equation card with live solved numbers** (`renderLegend`, `renderEquationCard`) is mandatory on every field — this is the "engineer reads the PDE next to the result" signature.

### 1.E Render targets
- **Real-time (interactive, ≥30-60 fps):** small/medium fields (≤10⁵ elements), live deformation/flow morph, orbit while it animates. GPU-side morph + particle advect keep the main thread free (the current CPU `BufferGeometry` rebuild per frame is the bottleneck to remove).
- **Offline (high-fidelity, demo/report):** big fields, path-traced contour with AO/shadows, 4K, multi-camera (≥5 angles per `feedback-forge-multicam-e2e`), exported MP4 time-history. Uses the offline render harness (`forge-100k-environment` pattern, `toDataURL` readback).

### 1.F Dynamics layer (the NO-STATICS mandate)
Every field is time-resolved and *plays*:
- FEA transient/modal → **frame buffer of displacement snapshots** `[step][3N]` (`DynamicResult.displacements`) → scrubber + play/pause/loop + speed; modal → sinusoidal mode-shape oscillation `u(t)=ϕ_i·A·sin(2π f_i t)` (`FEAVisualizer.animateMode:136`).
- CFD transient → unsteady velocity frames → animated particle advection + moving streaklines + vortex-shedding iso-surfaces.
- MBD → per-step body transforms → rigid-body animation of the *actual B-rep parts* moving, with joint markers, trajectory ribbons, swept volumes.
- **Time-history plots** (2D): tip-displacement(t), ω(t), residual(t), energy(t) in a dockable chart synced to the 3D scrubber (`forge:fea-residual` event already drives the convergence plot, `simulationDispatch.js:64`).

---

## 2. FEA — structural (static-as-loadstep, modal, transient, thermal, nonlinear, contact)

> *No statics:* even "static" is shown as an **animated load ramp** (load applied 0→100 % over N frames, deformation + stress growing), so the viewer always sees motion. Internally these are still the verified solvers.

### 2.1 Static → animated load-ramp
- **Solver (grounded).** `K u = F`, hex8 **incompatible-modes (Wilson-Q6)** to kill shear locking, `SimplicialLDLT`, pinned-DOF row/col elimination. Element K via 2×2×2 Gauss (8 pts ±1/√3), 6×24 B-matrix, isotropic D (`FORGE_PHYSICS_VERIFICATION.md §3`). Validated 0.33 %.
- **Field.** Per-element von-Mises `r.vonMises[e]` → nodal-averaged → per-vertex turbo contour; `r.u` → deformation morph (real, scaled).
- **Dynamic representation.** Load-factor scrubber 0→1; deformation interpolates `λ·u`, stress `λ²`-ish (re-solve at sub-steps for true nonlinear path). Min/max stress markers (`addMinMaxMarkers`), iso-stress lines, probe-on-click. Governing card: `∇·σ+b=0`, `σ=C:ε`, `Ku=F` with live σ_max, peak displacement, SF (`caeViz.js:518`).

### 2.2 Modal → mode-shape animation
- **Solver (grounded).** Generalized eigenproblem `Kϕ = ω²Mϕ`, **consistent mass**, `GeneralizedSelfAdjointEigenSolver` (→ Lanczos for scale). Validated 0.2 %. Returns `eigenvalues` (ω²) + `eigenvectors` (each 3N).
- **Field + dynamics.** For each mode i: oscillate the geometry `u(t) = ϕ_i · A · sin(2π f_i t)`, f_i = √(λ_i)/2π. Color by modal-strain-energy or |ϕ_i|. Mode selector (1..n), per-mode frequency label, **mass-participation factors** (which modes matter for a base excitation). This is the "wobbling mode shape" every FEA tool shows — already wired (`FEAVisualizer.animateMode`, `caeViz`).

### 2.3 Transient → time-history playback
- **Solver (grounded).** **Newmark-β** (β=¼, γ=½, unconditionally stable), effective matrix `M + γΔt·C + βΔt²·K` factored **once**, forward/back-sub per step (`Fea.hpp:112`). Rayleigh damping `C = αM + βK`. Returns `displacements[step][3N]`, `times[]`, `maxStressEnvelope[]`.
- **Upgrade.** **Modal superposition** path for lightly-damped linear transients: project onto the first m modes (from §2.2), integrate m decoupled SDOF ODEs `q̈_i + 2ζ_iω_i q̇_i + ω_i²q_i = ϕ_iᵀf(t)`, reconstruct `u = Σ q_i ϕ_i` — 100-1000× faster than full Newmark for the same accuracy, enables real-time scrub of long histories. Also **frequency-response (harmonic)** `(-ω²M + iωC + K)u = F` for a Bode/FRF sweep, and **PSD random-vibration** (Miles' equation) for the spectral-input case.
- **Dynamics representation.** Full frame buffer → play/pause/loop/scrub/speed; "stress envelope" mode shows the max-over-time field; time-history chart of a probed node synced to the 3D clock.

### 2.4 Thermal → transient conduction + thermal-stress coupling
- **Solver (grounded steady; transient is the upgrade).** Steady `∇·(k∇T)+q=0` with convective Robin `k∂T/∂n + h(T−T∞)=0` (`Fea.hpp:154`, validated 0 %). **Upgrade:** transient `ρc ∂T/∂t = ∇·(k∇T)+q` via the same Newmark/θ-method machinery (Crank-Nicolson θ=½), + **radiation** σε(T⁴−T∞⁴) (nonlinear, Newton). **Goldak double-ellipsoid moving heat source** already exists for welding (`WeldingFea.cpp:80`) → animate the moving weld pool + heat-affected-zone growth.
- **Field + dynamics.** Temperature contour (T animates as the part heats), heat-flux glyphs/streamlines (q=−k∇T), translucent volume ray-march for the plume. **One-way thermal-stress coupling:** feed T into the structural solve as a thermal load `f_th = ∫Bᵀ D α ΔT dV` → the part visibly warps as it heats (CTE expansion) — a genuinely dynamic, multiphysics shot.

### 2.5 Nonlinear (geometric + material) → incremental load animation
- **Solver.** Geometric: **Newton-Raphson** on `K_T(u)=K_L+K_σ(σ(u))`, load sub-stepped (`Fea.hpp:173 NonlinearConfig`), returns `stepDisplacements[step][3N]` + per-step residual + Newton-iters. Material: **J2 radial-return** with isotropic hardening σ_Y(ε_p)=σ_Y0+H·ε_p (validated machine-ε in JS `nonlinearFea.js`; native at `FeaContact.cpp:843`). **Upgrade:** arc-length (Riks) for snap-through/post-buckling; hyperelastic for rubber.
- **Dynamics.** Each load increment is a frame → animate the part bending into the large-deflection regime, plastic zone (ε_p>0) spreading as a *separate* contour, residual-convergence chart per step.

### 2.6 Contact → animated press-in + contact-pressure patch
- **Solver.** Active-set **node-to-surface penalty** (Wriggers ch.5, `FeaContact.cpp:541`). **Honest gap (`SIM_VALIDATION §3.2`):** Hertz radius 59 % off, force 99 % off — *currently ILLUSTRATIVE*. **Required upgrade to ground it:** (a) **Lagrange-multiplier / augmented-Lagrangian** contact (not raw penalty) for accurate pressure; (b) mesh refinement near the contact pole; (c) **mortar** segment-to-segment for non-matching meshes. Re-bench `errVsDelta` < 15 % vs Hertz `a=√(R*·δ)`, `p_max=3F/2πa²`.
- **Dynamics.** Animate the load ramp → bodies approach, contact patch grows, pressure contour on the contact surface, gap field, slip/stick map for frictional (Coulomb μ).

**Archie verbs:** `simulate.fea-static`, `-modal`, `-dynamic`, `-thermal`, `-nonlinear`, `-contact`, `-buckling`, `-fatigue` (all live, `ForgeToolBridge.js:1421-1745`). Fatigue overlays the **damage/life contour** (cycles-to-failure per element, Miner Σnᵢ/Nᵢ) — the "where will it crack first" shot.

---

## 3. CFD — incompressible / compressible / turbulent, with transient animation + FSI

### 3.1 Incompressible (grounded laminar; transient + SIMPLE/PISO upgrade)
- **Solver (grounded).** **Chorin projection on Harlow-Welch staggered MAC grid** (`Cfd.cpp`): predict u* (1st-order upwind advect + central viscous Laplacian) → pressure-Poisson `∇²p=(ρ/Δt)∇·u*` (sparse LDLT, one pressure pin) → correct `u^{n+1}=u*−(Δt/ρ)∇p`. ∇·u→1e-13 (machine-ε incompressibility = the defining correctness property), Poiseuille peak/mean 1.44 vs 1.5 analytic (4 %).
- **Upgrades (industrial-grade):**
  - **PISO** (2nd corrector) for transient accuracy, **SIMPLE/SIMPLEC** for steady, **PIMPLE** (outer SIMPLE + inner PISO correctors, `nOuterCorrectors`) for large-Δt transient stability — the OpenFOAM-standard coupling family.
  - **Higher-order convection** (≥2nd: QUICK / MUSCL / linear-upwind) to replace 1st-order-upwind numerical diffusion.
  - **Cut-cell / immersed-boundary** so arbitrary B-rep walls are respected (today: AABB-face BCs only).
- **Field + dynamics.** Velocity-magnitude contour on cut-planes, pressure contour, **RK4 streamlines colored by |u|** (`caeViz.js:637`), GPU **particle advection** (transient → animated flow, re-seeded at inlet), **LIC** texture on a slice. Reynolds + regime label (laminar/turbulent gate at Re=2300, honest "no turbulence model" note when Re exceeds envelope, `caeViz.js:622`).

### 3.2 Turbulent (RANS) — the headline new solver
- **Closure.** **k-ω SST** (Menter) — accurate+robust near walls (k-ω inner) blending to k-ε (free-stream), the workhorse for external aero/internal-duct. Add **k-ε** (realizable) and **Spalart-Allmaras** (1-eqn, aero). Wall treatment: y⁺ wall functions + boundary-layer prism mesh from §1.A.
- **Transient turbulence.** **URANS** for vortex shedding (Strouhal St=fD/U), and a **DES / k-ω-SST-DES** hybrid (RANS near wall, LES away) for the demo-grade unsteady wake. Time-march with PIMPLE.
- **Field + dynamics.** Turbulent KE k contour, eddy-viscosity, **vortex cores via Q-criterion (Q>0) and λ₂<0 iso-surfaces** (GPU marching cubes) — the "vortex shedding off the cylinder/wing" animation; wall-shear τ_w + Cp on the surface; pathlines/streaklines for the unsteady field. *This is the single biggest CFD visual win and the largest R&D item (multi-week, in-house on the MAC infra — no OpenFOAM dep).* 

### 3.3 Compressible
- **Solver.** Density-based: compressible RANS with **Roe / HLLC** approximate Riemann flux, ideal-gas EOS, for transonic/supersonic. Captures shocks. **Field:** Mach contour, **shock surfaces** (iso-Mach=1 / pressure-gradient iso), schlieren-style |∇ρ| shading, pressure waves animating.

### 3.4 FSI (Fluid-Structure Interaction) — coupled, animated
- **Scheme.** **Partitioned Dirichlet-Neumann** strong coupling: CFD solves with the structure's interface *velocity/displacement* (Dirichlet); structure (§2) solves with the fluid's interface *traction* (Neumann); iterate to convergence per time step. **Aitken Δ²** adaptive under-relaxation (or **IQN-ILS** quasi-Newton) to handle the added-mass instability (deteriorates with fluid/structure mass ratio). **ALE** mesh deformation moves the CFD mesh with the interface.
- **Dynamics representation.** The killer shot: a flexible wing/blade/valve-flap **bends under the flow while the flow re-routes around the deforming shape** — both fields animate, coupled, in lock-step. Flutter (negative aerodynamic damping) shows as growing oscillation; this exercises modal (§2.2) + transient CFD (§3.1) + structural transient (§2.3) together.

**Archie verb:** `simulate.cfd` (live); add `simulate.cfd-transient`, `simulate.cfd-rans`, `simulate.fsi`.

---

## 4. MBD — mechanism motion, full motion-capture, AUTO-MBD

### 4.1 Grounded inertial dynamics (the real solver, not kinematic playback)
- **Solver (grounded).** **Index-3 DAE** `M q̈ + Φ_qᵀλ = Q(q,q̇,t)`, `Φ(q)=0`, time-marched with **HHT-α (Hilber-Hughes-Taylor)** + **Baumgarte stabilization** (`Φ̈+2ξωΦ̇+ω²Φ=0`), saddle-point (KKT) solve per step (`MultibodyDynamics.cpp:11`). 6 DOF/body (3 trans + axis-angle rot), M=blkdiag(mI₃, J), gyroscopic −ω×(Jω) in Q. Validated: **pendulum period 0.016 %, rotor spin-up 0.00 %**. This is the ADAMS/Simscape-class integrator. Constraints today: BallJoint(3), AxisLock(2), Distance(1).
- **Constraint library upgrade.** Add Revolute(5), Prismatic(5), Cylindrical(4), Universal, Spherical, Planar, Gear/Rack (ratio), Cam-follower, Screw — full lower-pair set, each as analytic `Φ` + `Φ_q` (replacing forward-difference where exact Jacobians pay off). **Force elements:** spring-damper, bushing (6-DOF stiffness), actuator (driven θ(t)/d(t)), contact (impact: Hertzian + Coulomb friction for gear teeth/cams).

### 4.2 Full motion-capture rendering ("where needed")
- **Moving parts.** Per-step body transforms `samples[i].position/orientation` (already returned, `ForgeToolBridge.js:1937`) drive **rigid-body animation of the actual B-rep parts** — the real geometry moves, not a proxy. Play/pause/scrub/loop/speed.
- **Joint markers + reaction forces.** Render each joint (axis arrow, pivot sphere), with live **constraint-reaction force λ** glyphs (force/torque the joint carries) — the "is this bearing overloaded" shot.
- **Trajectory ribbons.** Poly-line trace of any body point over the whole run (the curve a piston-pin / coupler-point traces) — the classic four-bar coupler curve.
- **Swept volumes + interference.** Boolean-union (kernel) the moving B-rep across the trajectory → **swept volume** solid; intersect against static parts → **collision/clearance detection** over the motion cycle. The "does the linkage hit the housing" check, fully visual.
- **Energy/momentum monitors.** Live KE+PE chart (energy drift = conservation proof, `MbdResult.energyDrift`), ω(t)/θ(t)/v(t) time-history per body.

### 4.3 AUTO-MBD — automatic mechanism extraction from mates
The capability that turns *any assembly* into a runnable dynamics study with zero manual setup:
- **Input:** the assembly's mate graph (`AssemblySolver.listMates()`, 8 mate kinds: Coincident/Concentric/Parallel/Perpendicular/Distance/Angle/Tangent/Fixed, `AssemblySolver.hpp:50`).
- **Extraction algorithm:** (1) build the part-connectivity graph (nodes=instances, edges=mates); (2) **map each mate-pair to a kinematic joint** (Concentric+Coincident-face → Revolute; Concentric only → Cylindrical; Coincident-plane+Parallel → Prismatic; Distance → Distance constraint; etc.); (3) compute **mobility (Grübler-Kutzbach)** `M = 6(n−1) − Σ(6−f_i)` to know the DOF count and flag over/under-constraint; (4) derive **mass + inertia per body from geometry** (`MassProps`: ρ·V + solid inertia tensor — already supported via `{shape,density}` in the verb, `ForgeToolBridge.js:1855`); (5) identify the **driver** (a driven mate / motor) and ground (Fixed instances); (6) emit the `{bodies, constraints, loads, gravity}` config and run §4.1 — **no human picks joints**. This is the bridge from "I built an assembly" to "watch it move under real physics" in one Archie call.

**Archie verb:** `simulate.multibody-dynamics` (live: `study:"rotor"|"pendulum"` presets OR explicit bodies/constraints, `ForgeToolBridge.js:1852`). Add `simulate.auto-mbd` (assembly handle → extract → run → animate).

---

## 5. Other physics (where needed) — electromagnetics, acoustics, multiphysics

### 5.1 Electromagnetics (FEM)
- **Magnetostatics/eddy-current:** `∇×(ν∇×A) + σ∂A/∂t = J` (vector-potential A-formulation, **edge/Nédélec elements** to enforce tangential continuity). **Field:** B-field streamlines/glyphs, flux-density contour, force on conductors, torque(θ) for a motor — animate the rotor field as it spins (couples to §4 MBD). Eddy-current loss heat → couples to thermal §2.4.
- **High-frequency (antenna/EMC):** frequency-domain `∇×(∇×E) − k²E = 0`; S-parameters, near/far-field radiation pattern (3D lobe glyph).

### 5.2 Acoustics / aeroacoustics
- **Acoustics:** Helmholtz `∇²p + k²p = 0` (FEM) for cavity modes / muffler transmission-loss; **BEM** for exterior radiation. **Field:** SPL contour (dB), pressure-wave animation, directivity polar.
- **Aeroacoustics:** **Ffowcs-Williams–Hawkings (FW-H)** acoustic analogy — feed the transient CFD surface pressure (§3.2 URANS/DES) into FW-H to predict far-field noise (fan/blade tonal + broadband). The "how loud is this fan" shot, grounded in the CFD it already ran.

### 5.3 Multiphysics coupling (the unifying pattern)
One coupling engine, reused everywhere: **field-transfer + staggered/monolithic iteration** with conservative interpolation between non-matching meshes (mortar/RBF). Couplings: thermal→structural (CTE warp, §2.4), fluid→structural (FSI, §3.4), EM→thermal (Joule heating), EM→structural (Lorentz/Maxwell-stress), acoustic←CFD (FW-H, §5.2), thermal→fluid (buoyancy/natural convection, Boussinesq). Convergence accelerated by Aitken/IQN-ILS as in FSI. Visually: two+ animated fields on the same model, in sync.

---

## 6. GPU visualization architecture (Metal-first, no new deps)

- **Colormaps:** turbo (default, `caeViz.js:37`), jet, viridis, coolwarm, grayscale; perceptually-uniform option; user/Archie-selectable; discrete-banded mode for iso-contour reading.
- **Field upload:** scalar/vector field → **GPU texture** (1D LUT for colormap, 3D texture for volume field). Contour = vertex-color path (current) for surface; **volume = 3D-texture ray-march** for interior.
- **Compute passes (Metal/WebGPU, move off main thread):**
  1. **Deformation morph** — vertex shader adds `scale·u`; per-frame for transient/modal without CPU geometry rebuild (removes today's bottleneck).
  2. **Particle advection** — RK4 over the velocity texture, 10⁵-10⁶ particles, age-fade, inlet re-seed.
  3. **Marching cubes** — GPU iso-surface for Q/λ₂ vortices + 3D scalar thresholds.
  4. **LIC** — texture-space flow convolution (½-px step, ~20 RK4 iters).
  5. **SPR error field** — patch-recovery on GPU for the live convergence badge.
- **Real-time vs offline.** Real-time: interactive morph/advect/orbit at ≥30-60 fps for ≤10⁵ elements. Offline: path-traced contour (AO/shadow/4K), ≥5 camera angles, MP4 time-history export (`feedback-forge-multicam-e2e`, offline harness from `forge-100k-environment`).
- **Overlays (mandatory, present-day pattern):** turbo legend scale-bar with N ticks + units (`renderLegend`), **on-canvas governing-equation card with the LIVE solved numbers + validity scope** (`renderEquationCard`), min/max markers (`addMinMaxMarkers`), click-probe (`probePoint`), 2D time-history chart synced to the 3D scrubber, convergence/residual plot (`forge:fea-residual`). Everything torn down by `clearCaeOverlays()` before the next field.

---

## 7. Archie ⇄ Sim closed loop (trigger → interpret → act)

Archie drives the whole engine **purely via CUA tool-calls** — the same path used today (`ForgeToolBridge.js`), extended to a *reasoning loop*:

1. **Trigger.** Archie emits a `simulate.*` tool-call (`simulate.fea-static`, `-modal`, `-dynamic`, `-thermal`, `-nonlinear`, `-contact`, `-buckling`, `-fatigue`, `-cfd`, `-multibody-dynamics`, `-auto-mbd`, `-fsi`). Each verb takes a **face-based, geometry-grounded** spec (pin face N, load face M, material, mesh size) so Archie reasons in CAD terms, not node IDs. Kernel-offline → `{ error }`, never fabricated (`notReady()`, `simulationDispatch.js:178`).
2. **Solve + render.** Pipeline §1 runs, field renders on the model, progress + residual stream to the UI (`withProgress`, phase-aware: mesh→assemble→factorize→solve→postprocess, `simulationDispatch.js:56`).
3. **Interpret.** The verb returns a **structured, numeric report** Archie reads: `maxVonMises_MPa`, `safetyFactor`, `maxDisplacement_m`, `residual` (FEA); `reynolds`, `peakOverMean`, `regime` (CFD); `omegaErrPct`, `energyDrift`, `maxConstraintDrift`, `stable` (MBD); plus first-N modal frequencies, fatigue min-life, contact max-pressure. Archie compares against the **engineering criterion** (SF≥target, f₁ clear of excitation, Re-regime, stable=true, life≥design-cycles).
4. **Act (the close-loop).** On a failing criterion Archie **edits the model and re-sims**: thicken a rib / add a fillet / change material if SF<1.5; re-route a flow path if a recirculation/separation appears; rebalance / add a counterweight if MBD energy/forces spike; shift a natural frequency by stiffening if f₁ sits on a forcing frequency. It re-runs the *same verb* and re-reads the report — a genuine design-iterate-verify loop, all CUA. This is the CADGenBench "physics-correct + acts-on-results" dimension.

**Validation discipline (every demo).** Vary prompts each run (`feedback-vary-test-prompts`); verify by **headed Playwright e2e** with ≥5 camera angles on the live kernel (`feedback-verify-playwright-rerun`); restart `mlx_lm.server` fresh before any live CUA demo (output degrades over a session, `feedback-models-serve-restart-before-demo`); only quote a number as validated when it has a characterized error vs analytical/benchmark truth (`SIM_VALIDATION.md` contract). Never demo the known-ILLUSTRATIVE items (Hertz contact pressure, turbulent CFD) as validated until upgraded.

---

## 8. Build order (leverage-ranked, hardware-aware)

M4 Max / 36 GB — *one heavy step at a time* (`feedback-hardware-calm`); kernel rebuilds wait for the GPU to be free of training (`FORGE_PHYSICS_VERIFICATION §5`).

1. **GPU compute viz path** (Metal morph + particle advect + marching-cubes) — unblocks real-time animation of *every* existing grounded solver; biggest visual win for least solver risk. No rebuild.
2. **Transient CFD animation** (PISO/PIMPLE + particle/streakline advect over time) — turns the validated steady solver into the "flow moves" shot. [rebuild]
3. **Consistent-hex already done; AUTO-MBD extraction** (mate-graph → joints → run) — turns every assembly into a moving, motion-captured study. Mostly JS over the validated MBD solver.
4. **Modal-superposition transient + harmonic FRF + PSD** — fast, real-time-scrubbable structural dynamics. [rebuild]
5. **Lagrange/augmented-Lagrangian contact** — grounds the currently-ILLUSTRATIVE Hertz to <15 %. [rebuild]
6. **RANS k-ω SST + Q/λ₂ vortex iso-surfaces** — the headline turbulent-CFD visual; the one multi-week R&D item (in-house, no OpenFOAM). [rebuild]
7. **FSI (Dirichlet-Neumann + Aitken/ALE)**, then **EM (Nédélec) / acoustics (Helmholtz+FW-H) / multiphysics coupling engine**.

---

## 9. Sources (methods cited)

- Q-criterion / λ₂ vortex detection (Jeong & Hussain 1995; Q=½(‖Ω‖²−‖S‖²)): [M4 Engineering](https://www.m4-engineering.com/q-criterion-for-vortex-visualization/), [ScienceDirect — λ₂ vortex visualization](https://www.sciencedirect.com/science/article/pii/S0307904X15003777)
- k-ω SST + SIMPLE/PISO/PIMPLE coupling: [OpenFOAM k-ω SST guide](https://www.openfoam.com/documentation/guides/latest/doc/guide-turbulence-ras-k-omega-sst.html), [CFDpilot — pimpleFoam/PIMPLE settings](https://cfdpilot.com/pimplefoam-settings), [OpenFOAM k-ω-SST-DES](https://www.openfoam.com/documentation/guides/latest/doc/guide-turbulence-des-k-omega-sst-des.html)
- FSI partitioned Dirichlet-Neumann + Aitken Δ² / IQN-ILS / ALE: [arXiv — robustness of Dirichlet–Neumann FSI](https://arxiv.org/html/2506.04027v1), [ScienceDirect — multi-level quasi-Newton FSI coupling](https://www.sciencedirect.com/science/article/abs/pii/S0045782512000862)
- GPU LIC + RK4 particle advection / streamlines: [Wikipedia — Line Integral Convolution](https://en.wikipedia.org/wiki/Line_integral_convolution), [MIT — Dynamic LIC for streamline evolution](https://web.mit.edu/8.02t/www/802TEAL3D/visualizations/resources/DLICArticle.pdf)
- External benchmark truths used by the kernel harnesses: Ghia, Ghia & Shin (1982) *J. Comput. Phys.* 48:387–411 (lid-cavity); Simo & Hughes (1998) *Computational Inelasticity* (radial return); Wriggers (2006) *Computational Contact Mechanics* (penalty contact).
- In-repo grounding: `SIM_VALIDATION.md`, `FORGE_PHYSICS_VERIFICATION.md`, `forge-kernel/src/{Fea,Cfd,MultibodyDynamics,FeaContact}.cpp`, `frontend/src/forge-v4/caeViz.js`, `frontend/src/kernel/simulation/FEAVisualizer.js`, `frontend/src/forge-v4/simulationDispatch.js`, `frontend/src/ai/ForgeToolBridge.js`.
