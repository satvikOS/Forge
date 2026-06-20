# Forge — Simulation Grounding Status (SIM_VALIDATION.md)

**Bible 5.3.** This document states, honestly and per-case, which Forge
simulation capabilities are **GROUNDED** (real solver + converged + checked
against an external analytical/benchmark truth with a characterized error) and
which are only **ILLUSTRATIVE** (the solver runs and produces a finite,
qualitatively-correct result, but the displayed number is not validated against
a ground-truth reference, or the magnitude/units are uncharacterized).

A result is called **validated** here ONLY when there are real measured numbers
AND a characterized error versus an external closed-form / benchmark truth.
Everything else is labeled ILLUSTRATIVE. Where a thing is not built, diverges,
or is self-referential, it is said so explicitly and marked TODO/UNVERIFIED.

**Honesty rules followed (Forge Engineering Bible 0/9):** every repo claim
below carries a real `file:line` citation; every error number was *measured* by
running the harness in this session (commands listed in §0), not copied from
prose; external references are the published papers/tables the harnesses use.
Nothing is fabricated. Where I could not verify something, it is marked.

---

## 0. How every number below was produced (reproduce)

All commands run from the repo root `/Users/account_clawteam1/archdisc-Mech`,
against the **already-built** kernel binary
`forge-kernel/build/Release/forge-kernel.node`
(5,019,840 bytes, built **2026-06-18 06:12**, measured via `stat`). No rebuild.

| # | Layer | Command | Result this session |
|---|-------|---------|---------------------|
| A | Native kernel analytical gates | `node forge-kernel/test/physics_validation_harness.mjs` | **ALL 7 RIGOR GATES PASS** (exit 0) |
| B | Native simulate.* bridge verbs | `node forge-kernel/test/simulate_verbs_test.mjs` | **ALL PASS** |
| C | JS J2-plasticity validators | `nonlinearFea.validateUniaxialTension` / `validateBarHardening` | both **passed** |
| D | JS penalty-contact Hertz | `contactFea.driveTwoSpheresHertz` | converged; see §3 caveat |
| E | JS Navier–Stokes Ghia/Taylor–Green | `navierStokes3d.driveLidDrivenCavity` + `compareToGhia` | L1 = 3.1 %, L∞ = 6.1 % |

> **IMPORTANT — the existing `FORGE_PHYSICS_VERIFICATION.md` is STALE.** It
> describes the **2026-06-17 18:07** binary (lumped-mass hex, locking, diverging
> duct): 35 % static / 24 % modal / NaN channel. The binary on disk now
> (**2026-06-18 06:12**, after `MultibodyDynamics.cpp` + the incompatible-modes /
> consistent-mass / channel-stabilization rebuild) measures **0.33 % static,
> 0.2 % modal, a stable channel, and a working inertial multibody solver.** The
> numbers in this file are the *current* measured ones. `FORGE_PHYSICS_VERIFICATION.md`
> should be regenerated; until then treat THIS file as authoritative for the
> on-disk kernel. (TODO: refresh that doc.)

---

## 1. Native kernel — analytical benchmark cases (the load-bearing evidence)

Harness: `forge-kernel/test/physics_validation_harness.mjs`. Steel
E = 210 GPa, ν = 0.3, ρ = 7850 kg/m³; beam L = 1 m, b = 0.05 m, I = 5.208e-7 m⁴.
Every error below is the literal harness print from this session.

| # | Benchmark | Solver (source) | Reference truth | Forge result | Error | Status |
|---|-----------|-----------------|-----------------|--------------|-------|--------|
| 1 | Cantilever tip deflection, h-refined (84→976 nodes) | hex8 FEA, **incompatible-modes (Wilson Q6)**, `src/Fea.cpp` | δ = PL³/3EI = 3.0476e-3 m | 3.0337e-3 → 3.0343e-3 → **3.0375e-3** m | **0.5 % → 0.4 % → 0.33 %** | **GROUNDED** |
| 2 | Cantilever 1st bending frequency | hex8 modal, **consistent mass**, `src/Fea.cpp:672` | f₁ = (1.8751)²/2π·√(EI/ρAL⁴) = 41.8 Hz | 41.9 Hz | **0.2 %** | **GROUNDED** |
| 3 | Truss bar axial extension | direct stiffness, `src/FrameTruss.cpp` | δ = PL/EA = 4.761905e-4 m; F = 5000 N | 4.761905e-4 m; 5000.0 N | **0.00 %** | **GROUNDED (exact)** |
| 4 | Frame longitudinal 1st mode (20-seg bar) | direct-stiffness modal, `src/FrameTruss.cpp` | f₁ = (1/4L)√(E/ρ) = 646.5 Hz | 646.4 Hz | **0.0 %** | **GROUNDED (exact)** |
| 5 | CFD straight channel, peak/mean velocity ratio | projection/MAC laminar NS, `src/Cfd.cpp` | parallel-plate Poiseuille peak/mean = **1.5** (analytic) | 1.44 (band), residual 6.8e-13 | **~4 %** (within ±25 % gate) | **GROUNDED (laminar, low-Re)** |
| 5d | (same run) full square-duct peak/mean | `src/Cfd.cpp` | square-duct analytic ≈ **2.10** | 2.06 | **~2 %** | **GROUNDED (reported on the record)** |
| 6a | Multibody pendulum period | **inertial DAE: M q̈ + Φqᵀλ = F, HHT-α + Baumgarte**, `src/MultibodyDynamics.cpp` | T = 2π√(L/g) = 2.006409 s | 2.006723 s (3 periods); drift 3.2e-8, energy 8.8e-9, stable | **0.016 %** | **GROUNDED** |
| 6b | Multibody rotor spin-up, constant torque | `src/MultibodyDynamics.cpp` | ω = αt = 4.0 rad/s; θ = ½αt² = 2.0 rad | ω 4.0000, θ 2.0000 | **0.00 % / 0.00 %** | **GROUNDED** |

**Why these are GROUNDED, not illustrative.**
- Cases 1–4 are checked against *closed-form* solutions and hit them to ≤0.5 %;
  case 1 additionally shows monotone h-convergence (0.5 → 0.4 → 0.33 %), the
  signature of a correctly assembled/integrated FE operator.
- Case 5 is the canonical incompressible-flow check: incompressibility is
  enforced to **machine precision** (finalResid 6.8e-13) and the developed
  velocity profile matches the analytic parallel-plate peak/mean ratio (1.44 vs
  1.5). The honest 3D square-duct value (2.06 vs analytic 2.10) is reported too.
- Cases 6a/6b validate the **new inertial multibody integrator** against the two
  textbook closed forms (pendulum period; constant-torque kinematics). The tiny
  constraint drift (3.2e-8) and energy drift (8.8e-9) confirm the DAE constraint
  is actually being satisfied, not ignored.

Source provenance for each method (read in this session):
`src/MultibodyDynamics.cpp:11` ("index-3 DAE, HHT-α + Baumgarte"), bound at
`src/binding.cpp:5093–5095` as `forge.simulate.multibodyDynamics`. Static/modal
hex in `src/Fea.cpp`; truss/frame in `src/FrameTruss.cpp`; CFD in `src/Cfd.cpp`.

---

## 2. Native simulate.* bridge verbs (engineering-sane, smoke-checked)

Harness: `forge-kernel/test/simulate_verbs_test.mjs`, dispatching the same verbs
the Archie agent calls through `frontend/src/ai/ForgeToolBridge.js`. All PASS
this session. These are **cross-checked against analytics where the harness has
an analytic value, ILLUSTRATIVE where it only checks bounds/finiteness.**

| Verb | Test case | Analytic check in harness | Measured | Status |
|------|-----------|---------------------------|----------|--------|
| `simulate.fea-buckling` | 100×10×10 steel column, 1 kN | Euler P_cr = 4.318e4 N (±20 %) | 4.910e4 N → **13.7 %** | **GROUNDED** (within Euler band; pinned-end idealization gap) |
| `simulate.fea-thermal` | 100 mm bar 100→0 °C | q = kΔT/L = 50 000 W/m² (±10 %) | 50 000 W/m² → **0 %** | **GROUNDED** |
| `simulate.fea-fatigue` | 250 MPa amplitude, steel S-N | Basquin life ∈ [200k, 600k] | 247 078 cycles | **GROUNDED** (matches Basquin closed-form band) |
| `simulate.fea-nonlinear` | steel cantilever, −10 kN tip | yields (ε_p>0), σ_vM finite | ε_p = 2.139, σ_vM = 2389 MPa, yielded | **ILLUSTRATIVE** — only checks "it yielded"; the 2389 MPa value is unvalidated (large-deformation/penetration regime; no ground-truth comparison) |
| `simulate.fea-contact` | two stacked 10 mm steel cubes, 1 kN | active pairs > 0, no blow-through | active 9/9, press-in 0.00125 mm, **maxContactPressure 5.265e8 MPa** | **ILLUSTRATIVE / suspect** — the pressure (≈5.3e14 Pa) is physically implausible for a 1 kN press; penalty pressure magnitude is uncharacterized (see §3). The displacement bound check passes. |
| `simulate.cfd` | lid-driven cavity Re≈100 | peak\|u\| ∈ [0.8,1.2], resid ↓≥1000× | peak 0.8716, Re 87.2, resid 3.0e-1→5.1e-15 | **GROUNDED (incompressibility)**; ILLUSTRATIVE for the velocity *field* (no Ghia comparison in this verb) |
| `simulate.dynamics-motion` | 3-bar linkage, 2π sweep | 36 frames, all converged, swept 2π | 36 frames, swept 6.2832, path 6.283 | **ILLUSTRATIVE — kinematic only.** This is constraint playback, NOT inertial dynamics. (Inertial dynamics is the separate `simulate.multibodyDynamics`, §1 case 6.) |

**Honest gap (contact pressure units/magnitude).** `ForgeToolBridge.js:1747`
reports `maxContactPressure_MPa = maxP / 1e6`; the smoke test printed 5.265e8 MPa,
i.e. raw maxP ≈ 5.3e14 Pa. The smoke assertion only checks *finiteness*
(`simulate_verbs_test.mjs:140`), never magnitude, so an unphysical penalty
pressure passes. **Do not quote contact pressure as a validated number.** The
press-in displacement (sub-µm, plausible) is the only contact quantity with a
sanity bound.

---

## 3. Standalone JS solvers (Simulation/Contact/Nonlinear panels)

These are dependency-free, from-scratch JS PDE solvers powering dedicated panels
(`ContactFeaPanel.jsx`, `NonlinearFeaPanel.jsx`) and the Navier–Stokes demo,
**separate from the native kernel.** They each ship their own analytic harness.

### 3.1 Nonlinear J2 plasticity — `frontend/src/forge-v4/nonlinearFea.js` — **GROUNDED**

Real radial-return mapping (Simo & Hughes 1998, box 3.1), H8 elements, Newton +
Jacobi-PCG. Measured this session:

| Validator | Check | External truth | Measured error | Status |
|-----------|-------|----------------|----------------|--------|
| `validateUniaxialTension` | stress at yield = σ_y0 | σ_y0 = 250 MPa | **3.6e-16** (machine ε) | **GROUNDED** |
| (same) | plastic strain > 0 post-yield | ε_p>0 | 0.003555 | **GROUNDED** |
| `validateBarHardening` | post-yield tangent = E·H/(E+H) | E_t = 995.26 MPa | **1.1e-10** | **GROUNDED** |

These hit the closed-form elasto-plastic answers to machine precision —
genuinely validated. (`nonlinearFea.js:1541` uniaxial, `:1598` bar-hardening.)

### 3.2 Penalty contact / Hertz — `frontend/src/forge-v4/contactFea.js` — **ILLUSTRATIVE (Hertz NOT validated)**

Real Wriggers (2006, ch. 5) node-to-surface penalty contact + tet-4 elastic core
+ active-set Newton. The *solver runs and converges* (this session: two-sphere
Hertz converged in 15 Newton iters, 19 active pairs; two-cube case converged 11
iters). **But the contact-radius comparison to the Hertz analytic ground truth
is poor and the panel's "match" is self-referential:**

| Metric (this session, `driveTwoSpheresHertz` defaults) | Value | Meaning |
|--------------------------------------------------------|-------|---------|
| `aSim` (sim contact radius) | 1.162e-3 m | measured patch radius |
| `aAnalyticDelta` (Hertz a = √(R*·δ) from the prescribed overlap) | 2.828e-3 m | **ground-truth** radius |
| **`errVsDelta`** | **0.589 (≈ 59 %)** | sim vs ground truth — **fails any 15 % bar** |
| `Fnumeric` vs `hertz.F` (developed vs analytic force) | 0.106 N vs 16.58 N → `errF` **0.994 (99 %)** | the solver develops ~1 % of the analytic contact force |
| `errVsSimF` (what the panel shows as the headline) | 0.047 (4.7 %) | **circular**: compares aSim to the Hertz radius computed *from the force the sim itself produced* — passes by construction |

`ContactFeaPanel.jsx:714` gates the green "match" badge on `errVsSimF < 0.15`,
i.e. the self-consistent metric, not on `errVsDelta` (the true error). The header
comment at `ContactFeaPanel.jsx:36` ("Hertz benchmark must match analytical
within 15 %") is therefore **not** met against ground truth (59 % off).

**Verdict: the penalty contact solver is real and converges, but it is NOT a
validated Hertz solver.** Coarse tet spheres + penalty regularization under-resolve
the sub-element contact patch. Treat all contact-pressure/contact-radius outputs
(native verb §2 and this JS panel) as **ILLUSTRATIVE**. TODO: refine mesh near
the pole + use Lagrange-multiplier (not penalty) contact, then re-bench `errVsDelta`.

### 3.3 Navier–Stokes (JS) — `frontend/src/forge-v4/navierStokes3d.js`

Projection/MAC solver with two analytic harnesses.

| Case | External truth | Measured this session | Status |
|------|----------------|------------------------|--------|
| Lid-driven cavity, Re=100, 48×48 (mid-plane) vs **Ghia, Ghia & Shin (1982)** centreline u | Ghia Re=100 table (bundled `GHIA_U_RE100`) | **L1 = 3.1 %, L∞ = 6.1 %** of U_lid; but final divergence 5.24 (not driven to 0 in the thin-slab config) | **ILLUSTRATIVE→borderline.** Profile tracks Ghia to a few %, but residual/divergence not converged → not a clean validation. |
| Taylor–Green vortex, 24³, 20 steps | analytic decaying vortex | L∞ = 0.244 at t≈2.1 s | **ILLUSTRATIVE** — first-order/coarse; qualitatively correct decay, error too large + uncharacterized vs dt/h to call validated |

The **native** `src/Cfd.cpp` solver (§1 case 5, §2 `simulate.cfd`) is the better
CFD path (machine-precision incompressibility + 4 % Poiseuille match). This JS
solver is the panel/demo implementation and is weaker; use the native one for any
quantitative claim.

---

## 4. Known gaps (do NOT demo or quote as validated)

1. **Turbulent / RANS CFD — NOT IMPLEMENTED.** Both the native `src/Cfd.cpp` and
   the JS `navierStokes3d.js` are **laminar, first-order-upwind** only. No
   turbulence closure (no k-ω SST, no k-ε), no ≥2nd-order convection. Anything
   above low Reynolds number is out of envelope. (Confirmed: no RANS symbols in
   `src/Cfd.cpp`; `FORGE_PHYSICS_VERIFICATION.md:230` queues it as multi-week R&D.)
2. **Hertz contact NOT validated against ground truth** (§3.2): 59 % radius error,
   99 % force error vs analytic; the panel's pass uses a self-referential metric.
   All contact pressures (native verb + JS panel) are ILLUSTRATIVE.
3. **`simulate.fea-contact` pressure magnitude is unphysical** (~5.3e14 Pa for a
   1 kN press) and only finiteness-checked (§2). Uncharacterized.
4. **`simulate.dynamics-motion` is kinematic playback, not dynamics** (§2): no
   mass/inertia. The *real* inertial solver is the separate
   `simulate.multibodyDynamics` (§1, validated). Do not present motion-study as a
   dynamics sim.
5. **`simulate.fea-nonlinear` value unvalidated** (§2): pass criterion is only
   "it yielded"; σ_vM = 2389 MPa is in a large-deformation regime with no
   ground-truth check. (The *standalone* JS J2 solver §3.1 IS validated to machine
   precision — that is the trustworthy plasticity path.)
6. **`FORGE_PHYSICS_VERIFICATION.md` is stale** (§0): it describes the prior
   binary's locking-hex / lumped-mass / NaN-channel numbers, which the current
   on-disk binary no longer exhibits. TODO: regenerate it.
7. **JS lid-cavity divergence not converged** (§3.3): the few-percent Ghia match is
   on a non-divergence-free field; treat as borderline, not validated.

---

## 5. One-line summary per capability

| Capability | Path | Verdict |
|------------|------|---------|
| Linear static FEA (hex8, incompatible-modes) | native `src/Fea.cpp` | **GROUNDED** (0.33 %) |
| Modal FEA (hex8, consistent mass) | native `src/Fea.cpp` | **GROUNDED** (0.2 %) |
| Truss/frame static + modal | native `src/FrameTruss.cpp` | **GROUNDED** (exact) |
| Buckling (Euler) | native, `simulate.fea-buckling` | **GROUNDED** (13.7 %, within band) |
| Steady thermal conduction | native, `simulate.fea-thermal` | **GROUNDED** (0 %) |
| Fatigue (Basquin/Miner) | native, `simulate.fea-fatigue` | **GROUNDED** (within band) |
| Laminar incompressible CFD | native `src/Cfd.cpp` | **GROUNDED** (incompressibility machine-ε; Poiseuille 4 %) |
| Inertial multibody dynamics | native `src/MultibodyDynamics.cpp` | **GROUNDED** (0.016 % / 0.00 %) |
| J2 plasticity (standalone) | JS `nonlinearFea.js` | **GROUNDED** (machine-ε) |
| Nonlinear FEA bridge verb | native, `simulate.fea-nonlinear` | **ILLUSTRATIVE** (value unchecked) |
| Penalty contact / Hertz | JS `contactFea.js` + native verb | **ILLUSTRATIVE** (Hertz 59 % off ground truth) |
| Navier–Stokes (JS demo) | JS `navierStokes3d.js` | **ILLUSTRATIVE** (Ghia ~few %, not converged) |
| Kinematic motion study | native, `simulate.dynamics-motion` | **ILLUSTRATIVE** (kinematic, not dynamics) |
| Turbulent / RANS CFD | — | **NOT IMPLEMENTED (TODO)** |

---

## 6. Provenance

- Kernel binary: `forge-kernel/build/Release/forge-kernel.node` (built 2026-06-18 06:12, not rebuilt for this report).
- Harnesses run this session: `forge-kernel/test/physics_validation_harness.mjs` (7 gates PASS, exit 0); `forge-kernel/test/simulate_verbs_test.mjs` (ALL PASS).
- JS solvers driven directly via Node ESM import: `frontend/src/forge-v4/nonlinearFea.js`, `contactFea.js`, `navierStokes3d.js`.
- Solver sources cited inline: `src/Fea.cpp`, `src/FrameTruss.cpp`, `src/Cfd.cpp`, `src/MultibodyDynamics.cpp` (binding `src/binding.cpp:5093`).
- Agent dispatch + unit handling: `frontend/src/ai/ForgeToolBridge.js:1712,1747`; workbench routing `frontend/src/forge-v4/simulationDispatch.js` (honest `{ error: 'kernel not ready' }`, no fabrication, `:172,179`).
- External references (used by the harnesses): Ghia, Ghia & Shin (1982) *J. Comput. Phys.* 48:387–411 (lid-cavity table); Simo & Hughes (1998) *Computational Inelasticity* box 3.1 (radial return); Wriggers (2006) *Computational Contact Mechanics*, 2nd ed., ch. 5 (penalty contact).
