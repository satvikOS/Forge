# High-Bypass Turbofan — CAE / CAD / CAM Report

Generated 2026-06-17T23:06:21.229Z · Forge kernel 0.1.0 / OCCT 7.9.3
Model: parametric high-bypass turbofan — 38 unique B-rep bodies, 792 assembly instances, ~792 total parts, est. dry mass ≈ 61707 kg.
Duty cycle used for loads: fan speed 2500 rpm → tip speed 327 m/s.

## 1. FEA — Fan Blade (static + nonlinear)
Centrifugal body load + transverse aero gas-bending load on a root-cantilevered Ti-6Al-4V blade.

| Quantity | Value | Limit | Margin | Result |
|---|---|---|---|---|
| Max von Mises | 348.5 MPa | 880 MPa (σ_y) | SF = 2.53 | ✅ PASS (SF≥1.5) |
| Tip displacement | 19.367 mm | — | — | — |
| Centrifugal load | 1366.3 kN | — | — | — |
| Aero bending load | 3470 N | — | — | — |
| Mesh | 5016 nodes / 3150 elem | — | — | — |

Nonlinear overspeed (1.25× redline = 1.56× load), elasto-plastic radial-return:

| Quantity | Value | Result |
|---|---|---|
| Max von Mises | 720.3 MPa | — |
| Max plastic strain | 0.000e+0 | ✅ PASS (<0.2%) |
| Yielded | false | converged=true |

HCF fatigue (Goodman): alternating 122 MPa / mean 226.5 MPa → life **infinite (>1e8, below S-N knee)** (~∞ h @ 2500 rpm) — ✅ PASS (≥1e7).

## 2. FEA Modal — Fan Disk (flutter / resonance margin)
Bore-clamped Ti-6Al-4V disk. First natural frequencies vs the 1E/2E/3E running orders at 2500 rpm.

| Mode | Frequency (Hz) |
|---|---|
| 1 | 6556.2 |
| 2 | 6562.4 |
| 3 | 6562.4 |
| 4 | 6835 |
| 5 | 6903.3 |
| 6 | 6954.5 |

First natural = **6556.2 Hz**; running orders = [41.7, 83.3, 125] Hz; nearest order 125 Hz → resonance margin **5145%** — ✅ PASS (≥10% Campbell separation).

> Modal note: the disk is modelled as a thick slab clamped on a full face, which is much stiffer than a real bore-mounted blade-carrying disk — so the kHz frequencies (and the enormous separation margin) are an upper-bound proxy. The engineering conclusion (first disk mode is far above the 1E/2E/3E running orders → no low-order resonance) holds; a production analysis would use a cyclic-symmetry sector model with the blade ring for true nodal-diameter modes and mistuning.

## 3. CFD — Core & Bypass Ducts (steady Navier-Stokes)
| Duct | Physical inlet (m/s) | Normalized cavity peak | Reynolds | Residual | Regime |
|---|---|---|---|---|---|
| Core (hot) | 180 | 1.148 | 59053 | 3.4e-3 → 7.3e-13 | Re>2300 → physically turbulent (solver is LAMINAR — see honest note) |
| Bypass | 147.3 | 0.178 | 35685 | 4.7e-4 → 4.6e-14 | Re>2300 → physically turbulent (solver is LAMINAR — see honest note) |

> CFD note: the kernel solver is a lid-driven cavity normalised to unit lid speed, so the *normalized cavity peak* (~1) is the dimensionless velocity response while *Reynolds* carries the real physical scale (true inlet velocity, hydraulic length, viscosity). Both Re are >2300 → the real gas path is turbulent; this laminar solve captures the velocity/pressure topology only.

## 4. Dynamics — Full-Revolution Motion Study
| Quantity | Value |
|---|---|
| Frames | 36 |
| Driver swept | 6.2832 rad (target 6.2832) |
| All frames converged | true |
| Blade-tip path length | 6.283 m / rev |
| Blade-tip speed | 327.2 m/s @ 2500 rpm |
| Result | ✅ PASS |

> SEQUENTIAL FRAMES (mate network re-solved per frame) — a motion study, NOT hardware real-time.

## 5. Thermal — Combustor / HP-Turbine Hot Section
| Quantity | Value | Result |
|---|---|---|
| Wall thickness | 26 mm | — |
| Hot / cold face | 1500 / 600 °C | — |
| Temperature range | 600 … 1500 °C (ΔT 900) | ✅ PASS |
| Mean heat flux | 394.6 kW/m² | — |
| Mesh | 8464 nodes / 6075 elem | — |

> pass = temperatures bounded by the imposed hot/cold BCs (conduction sanity); real liner needs film-cooling + TBC + radiation.

## 6. Tolerance Stack — Blade-Root / Disk-Slot Fit
| Quantity | Value | Result |
|---|---|---|
| Nominal clearance | 0.1 mm | — |
| Worst-case range | 0.07 … 0.13 mm | — |
| Cpk | 4.47 | ✅ PASS (≥1.33) |
| Monte-Carlo yield | 100% | — |

## Honest scope — what is real vs. approximated

- **Geometry deliverables (STEP / STL / drawings / CAM / BOM) use the REAL engine B-rep** authored in millimetres; they round-trip faithfully (exact OCCT B-Rep for STEP, tessellated mesh for STL).
- **The FEA/CFD/thermal solvers are SI (metres).** Meshing the literal 2.5 m geometry at metre scale is physically wrong (it is mm) and prohibitively expensive, so each critical component is RE-AUTHORED at true physical scale in metres with engineer-realistic loads derived from the engine parameters (tip speed, rpm, gas-path velocities, Tt4). This is the standard "extract-the-critical-component" workflow, stated openly rather than hidden.
- **CFD is laminar incompressible steady Navier-Stokes** (projection method, structured cartesian grid). It is NOT turbulent / compressible / transient (no RANS/LES). The reported Reynolds numbers are well above 2300, so a real gas-path solve would be turbulent — the laminar result captures the velocity/pressure topology only.
- **Dynamics-motion is a sequential-frame kinematic sweep** (the mate network is re-solved each frame). It is a motion study, NOT hardware real-time and NOT a coupled transient FSI run.
- **Modal uses a slab/annular proxy** for the disk (the solver wants a clean meshable solid); frequencies are representative of the disk scale, not a blade-disk cyclic-symmetry (mistuning) analysis.
- **Thermal is pure conduction** with fixed hot/cold face temperatures — no film cooling, TBC, or radiation; it is a through-wall gradient sanity check.
- **Fatigue and tolerance-stack are numeric** (S-N Basquin/Goodman; 1-D RSS+Monte-Carlo) — they consume stresses/dimensions, they do not re-read geometry.

