# DIRECT FIELDS — Capability + Corpus Taxonomy

**Scope deep-dive — 2026-06-21.** Per-field block: **(a) core knowledge**, **(b) concrete Forge engine/capability** (named ops, modules, data structures), **(c) governing standards / equations / methods**, **(d) Archie training-data topics**. Industrial-grade, no lite versions, dynamic features only. North-star: Archie-drives-Forge ≥ 0.85 on CADGenBench across every dimension.

> **Codebase grounding (verified 2026-06-20/21).** `forge-kernel/` is a C++20 Node-API addon: **OCCT 7.9.3** exact B-rep oracle + vendored **planegcs** 2D solver + **Eigen** numerics, with an in-house pure-C++20 `forge::native::` kernel (Predicates/brep/mesh/geom/implicit/voxel) being built bottom-up to retire OCCT/manifold-3d/WASM (`KERNEL_PARITY.md`, `KERNEL_INHOUSE_ROADMAP.md`). **291 `.cpp` modules**; `binding.cpp` exposes thousands of fields; op naming is `forge.<workbench>.<op>` (e.g. `forge.mold.analyseDraft`, `forge.native.meshBoolean`). Existing domain modules already present and cited below: `Fatigue.cpp`/`FeaExtras.cpp` (rainflow+Basquin+Goodman/Soderberg+Miner), `Casting.cpp` (transient solidification + **Niyama** `G/√R`), `Mold.cpp`+`MoldFlow.cpp` (draft/parting/cooling), `SheetMetal*.cpp` (flat-pattern/K-factor), `Weld*.cpp` (heat-input/weld-group/FEA), `Tolerance.cpp`+`gdt/Gdt.cpp`+`BooleanTol.cpp`, `MultibodyDynamics.cpp` (HHT-α DAE, pendulum 0.016%), `Cfd.cpp`, `Machining.cpp`+`Cam*.cpp`. The work below is **extend-to-parity**, not greenfield.

---

## 1. Material Science & Engineering

**(a) Core knowledge.** Crystal structure (BCC/FCC/HCP, Bravais lattices, Miller indices, slip systems), defects (point/line/planar — vacancies, dislocations, grain boundaries), diffusion (Fick's 1st/2nd laws, Arrhenius `D = D₀·exp(−Q/RT)`), phase diagrams & lever rule, strengthening mechanisms (solid-solution, precipitation/age-hardening, grain refinement via Hall–Petch, work hardening), elastic/plastic constitutive behavior, anisotropy/orthotropy, composites (rule of mixtures, Halpin–Tsai, classical laminate theory), polymers vs ceramics vs metals, electronic/thermal/optical material properties, environmental degradation (corrosion, oxidation, UV, creep, hydrogen embrittlement).

**(b) Concrete Forge engine/capability.** A **unified material database engine** `forge.material.*` backing every solver: `forge.material.lookup(matId)` → full anisotropic property tensor (E, ν, G, ρ, CTE α(T), k(T), cₚ(T), σ_y(T), σ_u, SN/εN curves, Paris C/m, Cross-WLF coefficients, Tait PVT). Data structures: `MaterialCard{ elasticTensor C[6][6], yield: J2/Hill48/Barlat, thermal: piecewise λ(T), fatigue: SNCurve+EpsilonNCurve, fracture: K_IC+J_IC+da/dN }`. `forge.material.classicalLaminate(plies)` → ABD stiffness matrix + ply-by-ply failure (Tsai–Wu, Hashin, max-stress). `forge.material.ruleOfMixtures` / `forge.material.halpinTsai` for composite homogenization. `forge.material.heatTreatSim` (TTT/CCT-driven phase fraction → property map, ties to `Casting.cpp`/`WeldingFea.cpp` thermal histories). Anisotropic property tensors feed `FeaTet.cpp`/`FeaExtras.cpp` directly (no isotropic-only lite path).

**(c) Governing standards / equations / methods.** Hall–Petch `σ_y = σ₀ + k_y·d^(−1/2)`; Hooke's generalized law `σ_ij = C_ijkl·ε_kl`; rule of mixtures `E_c = V_f·E_f + V_m·E_m`; Halpin–Tsai; Tsai–Wu/Hashin failure; ASM Handbook material data; **MMPDS-2024** (aerospace design allowables, A/B-basis), **ASME BPVC Sec II** materials, **ISO 6892** tensile, **ASTM E8/E18** (tensile/hardness), **MIL-HDBK-5/17**, ESDU data sheets. Composites: **CMH-17**.

**(d) Training-data topics.** Property lookup Q/A across 500+ alloys/polymers/composites/ceramics; "select a material for [duty/temp/corrosion/weight]" reasoning; anisotropy tensor construction; laminate stacking-sequence design; heat-treat schedule → microstructure → property; material substitution under cost/availability constraints; unit-correct property recall (E in GPa, α in µε/°C).

---

## 2. Metallurgy

**(a) Core knowledge.** Ferrous (Fe–C diagram: ferrite/austenite/cementite/pearlite/bainite/martensite, eutectoid 0.76% C / 727 °C), non-ferrous (Al, Ti, Ni, Cu, Mg alloys), phase transformations (diffusional vs diffusionless/martensitic), TTT & CCT diagrams, hardenability (Jominy end-quench, Grossmann ideal diameter), heat treatment (annealing, normalizing, quench+temper, austempering, martempering, solution+age, carburizing/nitriding/case-hardening), grain growth kinetics, recrystallization, segregation, inclusion control, weld metallurgy (HAZ, dilution, carbon equivalent).

**(b) Concrete Forge engine/capability.** `forge.metallurgy.*`: `forge.metallurgy.jominy(steel)` → hardenability curve (HRC vs distance); `forge.metallurgy.cctPredict(comp, coolRate)` → phase fractions via Kirkaldy/Li-type rate equations; `forge.metallurgy.carbonEquivalent` (IIW CE & Pcm) → weldability + preheat; `forge.metallurgy.tempering(hardness, T, t)` (Hollomon–Jaffe parameter `HJP = T·(C + log t)`). Couples to `WeldingFea.cpp`/`WeldHeatInput.cpp` (Rosenthal/Goldak thermal cycles → HAZ hardness map) and `Casting.cpp` (cooling-rate → grain size via dendrite arm spacing). Output: per-element microstructure field rendered in viewport.

**(c) Governing standards / equations / methods.** IIW carbon equivalent `CE = C + Mn/6 + (Cr+Mo+V)/5 + (Ni+Cu)/15`; Pcm crack-susceptibility; Hollomon–Jaffe; Avrami kinetics `X = 1 − exp(−k·tⁿ)`; Scheil–Gulliver segregation; **ASTM A255** (Jominy), **AWS D1.1** preheat tables, **API 5L/6A**, **EN 10025**.

**(d) Training-data topics.** Fe–C reading; heat-treat selection for target hardness/toughness; preheat/PWHT calculation; weldability screening by CE; failure-mode attribution (temper embrittlement, hydrogen cracking, sensitization); quench-crack risk; dendrite-arm-spacing → cooling-rate inference.

---

## 3. Polymer Science

**(a) Core knowledge.** Chain architecture (linear/branched/cross-linked), thermoplastics vs thermosets vs elastomers, MW distribution (Mn, Mw, PDI), Tg & Tm, crystallinity & spherulites, viscoelasticity (creep, stress relaxation, WLF time–temperature superposition), rheology (shear-thinning, melt flow index), additives/fillers/reinforcement, degradation (thermal, hydrolytic, photo-oxidative), processing windows.

**(b) Concrete Forge engine/capability.** `forge.polymer.*` feeding `MoldFlow.cpp`: `forge.polymer.crossWLF(T,P,γ̇)` → melt viscosity; `forge.polymer.tait(T,P)` → specific volume / shrinkage; `forge.polymer.viscoelastic` (Prony series → generalized Maxwell for creep/relaxation FEA); `forge.polymer.wlfShift(T)` master-curve construction. Fiber-filled: `forge.polymer.folgarTucker` orientation tensor a_ij feeding anisotropic stiffness in warpage. Glass-transition & crystallization kinetics drive cooling/warp in injection sim (§24/§19).

**(c) Governing standards / equations / methods.** **Cross-WLF** 7-parameter `η = η₀/(1+(η₀γ̇/τ*)^(1−n))`, `η₀ = D₁·exp(−A₁(T−T*)/(A₂+T−T*))`; **2-domain Tait PVT**; **WLF** `log a_T = −C₁(T−T_ref)/(C₂+T−T_ref)`; Prony `E(t)=E_∞+Σ E_i·exp(−t/τ_i)`; Folgar–Tucker (Jeffery + isotropic rotary diffusion); **ISO 11403**, **ISO 294** (molding), **ASTM D638/D790**.

**(d) Training-data topics.** Resin selection by Tg/chemical-resistance/cost; Cross-WLF/Tait coefficient recall per grade; creep/relaxation prediction; shrinkage & warp drivers; processing-window Q/A (melt/mold temp, hold pressure); filler effect on anisotropy.

> **Cite:** Folgar–Tucker (Wikipedia); Moldflow Cross-WLF + 2-domain Tait — https://en.wikipedia.org/wiki/Folgar-Tucker_Model

---

## 4. Finite Element Analysis (FEA)

**(a) Core knowledge.** Weak/variational form, shape functions & isoparametric mapping, element zoo (CST/Q4/Q8, TET4/TET10, HEX8/HEX20, beam/shell — MITC, plate Mindlin/Kirchhoff), Gauss quadrature, assembly of global K, BCs (essential/natural, MPCs), solvers (direct Cholesky/LDLᵀ, sparse skyline, iterative PCG/AMG), nonlinearity (geometric large-strain, material plasticity, contact), dynamics (modal/eigen, transient Newmark/HHT, harmonic/frequency response, spectrum), thermal & coupled-field, locking (shear/volumetric) & remedies (reduced/selective integration, B-bar, incompatible modes, Wilson-Q6, EAS).

**(b) Concrete Forge engine/capability.** In-house `FeaTet.cpp`/`FeaExtras.cpp` (Eigen-backed): `forge.fea.staticLinear`, `forge.fea.modal` (Lanczos eigen), `forge.fea.transient` (Newmark-β / HHT-α), `forge.fea.harmonic`, `forge.fea.responseSpectrum` (`ResponseSpectrum.cpp`), `forge.fea.nonlinearStatic` (Newton–Raphson + arc-length), `forge.fea.contact` (penalty/augmented-Lagrange), `forge.fea.thermalTransient`, `forge.fea.buckling` (linear eigenvalue + nonlinear). **Validated:** static 0.33%, modal 0.2% via **Wilson-Q6 de-locking** (per `FORGE_PHYSICS_VERIFICATION.md`). Mesher: `mesh::Remesh`/`Tessellate.cpp` + TET10. **Dynamic-first** mandate satisfied: modal/transient/harmonic/spectrum/explicit all first-class, not afterthoughts.

**(c) Governing standards / equations / methods.** `[K]{u}={F}`; `([K]−ω²[M]){φ}=0`; Newmark `(γ,β)`, HHT-α (`α∈[−1/3,0]`, unconditional stability + numerical damping); `[M]ü+[C]u̇+[K]u={F(t)}`; convergence (h/p refinement, energy norm), MAC for mode correlation. **NAFEMS** benchmarks (LE1, LE10, T1–T4, FV2–FV5), **ISO 16407**, V&V per ASME V&V 10/40.

**(d) Training-data topics.** Element-type selection; mesh-density/convergence judgment; BC/load setup from a design intent; modal-frequency interpretation; result sanity (singularities, hot-spots); when to go nonlinear/contact/dynamic; NAFEMS-benchmark replication.

---

## 5. Computational Fluid Dynamics (CFD)

**(a) Core knowledge.** Navier–Stokes (compressible/incompressible), conservation (mass/momentum/energy), FVM discretization (upwind/QUICK/MUSCL/TVD), pressure–velocity coupling (SIMPLE/SIMPLEC/PISO/PIMPLE), turbulence (RANS k-ε/k-ω/**SST**, RSM; scale-resolving **LES**/**DES**/DDGI-style hybrids; transition γ-Reθ), boundary layers & y⁺/wall functions, multiphase (VOF, Euler–Euler), conjugate heat transfer, compressible/shock capturing, mesh (structured/unstructured, prism BL, polyhedral).

**(b) Concrete Forge engine/capability.** `Cfd.cpp` → `forge.cfd.*`: `forge.cfd.steadyIncompressible` (SIMPLE/SIMPLEC), `forge.cfd.transient` (PISO/PIMPLE), `forge.cfd.turbulence` selector (`kEpsilon|kOmegaSST|SpalartAllmaras|LES|DES`), `forge.cfd.conjugateHeat`, `forge.cfd.compressible` (density-based, Roe/AUSM flux). Channel-flow validated (`FORGE_PHYSICS_VERIFICATION.md`); **honest open gap: turbulent CFD** (laminar/channel solid, full turbulent-validation pending — flagged, no fake). Courant control `CFL = u·Δt/Δx`, adaptive Δt. Couples to `Aeroacoustics` (§7, FW-H) and `MoldFlow.cpp`.

**(c) Governing standards / equations / methods.** `∂u/∂t + (u·∇)u = −(1/ρ)∇p + ν∇²u + f`; SST blending of k-ω (wall) ↔ k-ε (freestream); `y⁺ = u_τ·y/ν`; CFL ≤ 1 (explicit) / ≤ 5 (PIMPLE); Reynolds/Mach/Prandtl. Verification: **ERCOFTAC** cases, **AIAA CFD V&V**, NASA Turbulence Modeling Resource.

**(d) Training-data topics.** Turbulence-model selection by Re/flow regime; BL meshing & y⁺ targeting; convergence/residual reading; pressure-coupling choice; steady vs transient decision; drag/lift/Nu extraction; cite SST blending behavior.

> **Cite:** SST k-ω (CFD-Online Wiki); PIMPLE/Courant (OpenFOAM pimpleFoam) — https://www.cfd-online.com/Wiki/SST_k-omega_model

---

## 6. Multibody Dynamics (MBD)

**(a) Core knowledge.** Rigid/flexible bodies, joints (revolute/prismatic/spherical/cylindrical/universal/planar/screw), constraint equations Φ(q,t)=0 & Jacobian Φ_q, formulations (Newton–Euler recursive, Lagrangian, Kane), DAE index (1/2/3) & drift, redundant constraints, contact/impact (penalty, complementarity/LCP), flexible MBD (modal/floating-frame), forward vs inverse dynamics.

**(b) Concrete Forge engine/capability.** `MultibodyDynamics.cpp` + `MotionStudy.cpp` → `forge.simulate.multibodyDynamics`, `forge.mbd.assemble(joints)`, `forge.mbd.forwardDynamics`, `forge.mbd.inverseDynamics`. **Validated:** **HHT-α index-3 DAE solver, pendulum 0.016% error** (`FORGE_PHYSICS_VERIFICATION.md`). Joint library via `MateLibrary.cpp`. Baumgarte/projection constraint stabilization; augmented-Lagrange (ALF-3) option. Contact via penalty + restitution. Drives mechanism animation in viewport (§11).

**(c) Governing standards / equations / methods.** `[M Φ_qᵀ; Φ_q 0]{q̈;λ} = {Q; γ}`; HHT-α extension to index-3 DAE (good Jacobian conditioning, ADAMS-style, 1,600+ systems validated); Baumgarte `Φ̈+2αΦ̇+β²Φ=0`; Kane's equations; floating-frame-of-reference.

**(d) Training-data topics.** Joint/constraint topology from a mechanism description; DOF (Gruebler/Kutzbach) counting; forward/inverse-dynamics setup; integrator selection (stiff → HHT-α); detecting redundant constraints; reaction-force extraction.

> **Cite:** HHT-α index-3 DAE (Negrut et al., ANL P1278) — https://www.mcs.anl.gov/papers/P1278.pdf

---

## 7. Aeroacoustics

**(a) Core knowledge.** Lighthill acoustic analogy, Ffowcs Williams–Hawkings (FW-H) for moving surfaces, Curle's solid-surface extension, monopole/dipole/quadrupole sources, broadband vs tonal noise, Blade Passing Frequency, trailing-edge & boundary-layer noise, jet noise, Helmholtz/wave equation, sound power/pressure (dB, SPL, PWL, A-weighting), aeroacoustic CAA (high-order low-dissipation schemes).

**(b) Concrete Forge engine/capability.** `forge.aeroacoustics.*` coupled to `Cfd.cpp` unsteady output + `NRCAcoustic.hpp`/`DuctSilencer.cpp`: `forge.aeroacoustics.fwh(cfdHistory, observers)` → far-field SPL spectrum; `forge.aeroacoustics.bpf(rpm, blades)` → tonal peaks; `forge.aeroacoustics.curle` (surface dipole); `forge.acoustics.ductTL` (duct/silencer transmission loss). Fan/blower noise via `FanBlower.cpp`. Output: 1/3-octave band SPL + directivity polar plot.

**(c) Governing standards / equations / methods.** Lighthill `∂²ρ'/∂t² − c₀²∇²ρ' = ∂²T_ij/∂x_i∂x_j`; FW-H integral (thickness+loading+quadrupole); `BPF = N_blades·RPM/60`; `SPL = 20·log₁₀(p/p_ref)`, p_ref=20 µPa; **ISO 3744/3745** (sound power), **ISO 5136** (fan in-duct), **AHRI 250**.

**(d) Training-data topics.** FW-H observer setup; tonal-vs-broadband diagnosis; BPF computation; A-weighting & octave-band conversion; silencer/duct TL; noise-source ranking; fan-law scaling of noise.

---

## 8. Electromagnetics Simulation

**(a) Core knowledge.** Maxwell's equations (differential/integral), electrostatics/magnetostatics, eddy currents, full-wave (FEM/MoM/FDTD/FIT), low-frequency (A-V formulation), waveguides & S-parameters, antennas (radiation patterns, gain, directivity), EMC/EMI, motor/transformer magnetics (B-H curves, hysteresis, core loss Steinmetz), Lorentz force, skin & proximity effects.

**(b) Concrete Forge engine/capability.** `forge.emag.*` (Eigen FEM): `forge.emag.magnetostatic` (A-formulation, nonlinear B-H), `forge.emag.eddyCurrent` (A-V harmonic), `forge.emag.thermalCoupled` (Joule → thermal), `forge.emag.motorTorque` (Maxwell stress tensor). Couples to `InductionMotor.cpp`/`SyncMachine.cpp`/`TransmissionLine.cpp`/`PowerFlow.cpp`. Core loss `forge.emag.steinmetz(B,f)`. Output: flux-density field, force/torque, loss map.

**(c) Governing standards / equations / methods.** `∇×H=J+∂D/∂t`, `∇×E=−∂B/∂t`, `∇·D=ρ`, `∇·B=0`; `B=∇×A`; Steinmetz `P_core=k·f^α·B^β`; Maxwell stress `T_ij=μ₀(H_iH_j−½δ_ijH²)`; skin depth `δ=√(2/(ωμσ))`; **IEC 60404** (magnetic materials), **IEEE Std 1812** (motor sim), CISPR/EMC limits.

**(d) Training-data topics.** Formulation choice (static vs eddy vs full-wave); B-H nonlinearity; torque/force extraction; core-loss estimation; skin-depth/conductor sizing; S-parameter/antenna basics; coupled magneto-thermal.

---

## 9. Structural Mechanics

**(a) Core knowledge.** Statics & equilibrium, beam theory (Euler–Bernoulli/Timoshenko), torsion (St-Venant/warping), plates & shells (Kirchhoff/Mindlin), stress/strain transformation & Mohr's circle, principal stresses, failure theories (von Mises, Tresca, max-principal, Mohr–Coulomb), buckling (Euler, plate local, lateral-torsional), energy methods (Castigliano, virtual work, unit-load), influence lines, frame/truss analysis (stiffness/flexibility), composite/sandwich, plasticity (limit/yield-line).

**(b) Concrete Forge engine/capability.** Rich existing suite: `BeamDeflection.cpp`, `BeamReactions.cpp`, `FrameTruss.cpp`, `Mohr.hpp`, `PlateBucklingLocal.cpp`, `SteelBeamLtb.hpp` (lateral-torsional), `SteelColumn.cpp`, `TensionMember.hpp`, `WebShear.cpp`, `TorsionalVibration.hpp`, `PressureVessel.hpp`, `ResponseSpectrum.cpp`. `forge.struct.beam/frame/truss/plate/buckling/mohr/...`. Section properties via `SectionClass.cpp` + `PolygonSection`. Couples to FEA (§4) for continuum.

**(c) Governing standards / equations / methods.** `EI·d⁴w/dx⁴=q`; Euler buckling `P_cr=π²EI/(KL)²`; von Mises `σ_vm=√(½[(σ₁−σ₂)²+...])`; Mohr's circle; **AISC 360** (steel), **Eurocode 3** (EN 1993), **ASME BPVC VIII** (vessels), **ACI 318** (concrete), **AISC seismic 341**.

**(d) Training-data topics.** Load-path reasoning; beam/column/plate sizing to code; buckling-mode ID; failure-theory selection by ductility; Mohr's-circle computation; section-property recall; code-check (DCR/utilization) interpretation.

---

## 10. Fracture Mechanics & Fatigue Analysis

**(a) Core knowledge.** LEFM (stress-intensity K_I/II/III, geometry factor Y, K_IC), crack-tip plasticity (Irwin, Dugdale), EPFM (J-integral, CTOD), R-curve, mixed-mode, fatigue (stress-life S-N/Basquin, strain-life ε-N/Coffin–Manson, mean-stress Goodman/Gerber/Soderberg/SWT), crack growth (Paris/Forman/NASGRO, threshold ΔK_th, retardation), cumulative damage (Miner, nonlinear), variable-amplitude (rainflow), multiaxial (critical-plane: Fatemi–Socie, Smith–Watson–Topper, Brown–Miller), HCF/LCF, weld fatigue (hot-spot/notch-stress), damage tolerance.

**(b) Concrete Forge engine/capability.** **Already built:** `Fatigue.cpp` + `FeaExtras.cpp::fatigueLife` = **rainflow counting + Basquin S-N + Goodman/Soderberg mean-stress + Miner linear damage, per element** (verified in source). Extend: `forge.fatigue.strainLife` (Coffin–Manson + SWT), `forge.fatigue.criticalPlane` (Fatemi–Socie/Brown–Miller), `forge.fracture.sif` (K via FEA J-integral/interaction integral), `forge.fracture.crackGrowth` (Paris/NASGRO `da/dN`), `forge.fatigue.fkm` (FKM-Guideline component assessment), `forge.fatigue.weldHotSpot` (IIW). Couples to FEA stress history + `WeldGroup.cpp`.

**(c) Governing standards / equations / methods.** `K_I=Y·σ·√(πa)`; Paris `da/dN=C·(ΔK)^m`; Basquin `σ_a=σ_f'(2N_f)^b`; Coffin–Manson `ε_a=σ_f'/E·(2N_f)^b+ε_f'(2N_f)^c`; Goodman `σ_a/σ_e+σ_m/σ_u=1`; Miner `Σn_i/N_i=1`; J-integral. **FKM Guideline 7th ed. (2020)** (local-stress, Kt/Kf Siebel–Stieler, steel/cast-iron/Al/cast-Al, critical-plane), **IIW** weld recommendations, **BS 7910**, **ASTM E647** (da/dN)/E399 (K_IC)/E1820 (J), **API 579** FFS.

**(d) Training-data topics.** S-N vs ε-N regime choice; mean-stress correction selection; rainflow on a load history; K_IC/critical-crack-size; Paris-law life; FKM assessment workflow; weld hot-spot extrapolation; multiaxial critical-plane reasoning.

> **Cite:** FKM 7th ed. 2020 (VDMA / Sciencedirect S0142112324000239); Niyama steel `G/√R<2.5` (Beckermann/Carlson) — https://www.sciencedirect.com/science/article/pii/S0142112324000239

---

## 11. Kinematics & Dynamics of Machinery

**(a) Core knowledge.** Mechanism mobility (Gruebler/Kutzbach), four-bar & slider-crank kinematics, position/velocity/acceleration analysis (loop-closure, instant centers, Kennedy's theorem), cam design (follower motion laws — cycloidal/harmonic/polynomial 3-4-5, pressure angle, undercutting), gear kinematics (involute, ratio trains, planetary/epicyclic, AGMA geometry), balancing (static/dynamic, rotating/reciprocating), flywheels (coefficient of fluctuation), vibration of machines, gyroscopics.

**(b) Concrete Forge engine/capability.** `Cam.cpp`/`CamAdvanced.cpp`/`CamExtended.cpp` (motion laws, pressure angle, cam profile gen), `GearPair.hpp`/`BevelGear.cpp` (involute + AGMA), `ChainDrive.cpp`, `MotionStudy.cpp`, `MateLibrary.cpp`. `forge.kinematics.fourBar`, `forge.kinematics.camProfile`, `forge.kinematics.gearTrain`, `forge.kinematics.balance`, `forge.machinery.flywheel`. Bridges to MBD (§6) for full dynamics + animation. **Dynamic-first**: outputs animated motion, not static plots.

**(c) Governing standards / equations / methods.** Gruebler `DOF=3(n−1)−2j₁−j₂`; loop-closure vectors; involute `inv(α)=tan α−α`; cam 3-4-5 polynomial; balancing `Σmrω²=0`; coefficient of fluctuation `C_s=(ω_max−ω_min)/ω_avg`. **AGMA 2001/2101** (gear rating), **AGMA 908** (geometry), **ISO 6336**.

**(d) Training-data topics.** Mobility counting; four-bar/cam synthesis; gear-train ratio & sizing; pressure-angle/undercut check; balancing computation; flywheel sizing from C_s; mechanism-type selection for a motion task.

---

## 12. Industrial Design (ID)

**(a) Core knowledge.** Form & aesthetics, ergonomics/anthropometry (percentile dimensions, reach/clearance, grip), human factors, surfacing (Class-A continuity G0/G1/G2/G3 — curvature & reflection-line quality), CMF (color/material/finish), proportion & golden-ratio, design language/brand, sketch→CAD workflow, user-centered design, sustainability/circularity.

**(b) Concrete Forge engine/capability.** `ClassASurfacing.cpp` → `forge.surf.classA` (G2/G3 NURBS surfacing, curvature-comb & zebra/reflection analysis), `forge.surf.continuityCheck`, `LoftGuide.cpp`/`NurbsSurface.cpp`/`Loft.cpp`/`Sweep.cpp` for free-form. Ergonomics: `forge.id.anthropometry(percentile)` clearance checks against assembly. Surface quality metrics via `mesh::Curvature`. CMF/render via path tracer (`PathTrace.cpp`).

**(c) Governing standards / equations / methods.** NURBS continuity G0/G1/G2/G3 (position/tangent/curvature/curvature-rate); curvature comb κ=1/R; reflection-line/zebra analysis; **ISO 7250** (human body measurements), **ISO 9241** (ergonomics of interaction), DIN 33402 anthropometry, **SAE J833** (human dims).

**(d) Training-data topics.** Class-A surface-quality reasoning; continuity-defect diagnosis from zebra; anthropometric clearance; CMF selection; form-proportion critique; surfacing-strategy (loft vs sweep vs network).

---

## 13. Design for Manufacturing (DFM)

**(a) Core knowledge.** Process selection (machining, casting, molding, sheet, AM, forging), process-specific design rules (min wall, draft, fillet/radii, undercuts, tool access, uniform thickness), tolerancing-for-cost, near-net-shape, standardization, cost drivers (cycle time, tooling, material utilization), DFM by process, supplier/PFMEA constraints.

**(b) Concrete Forge engine/capability.** `forge.dfm.*` rule-checker over the B-rep: `forge.dfm.wallThickness` (`mesh::WallThickness` — min/uniformity map), `forge.dfm.draftCheck` (reuses `Mold.cpp::analyseDraft`), `forge.dfm.toolAccess` (undercut/cavity reachability), `forge.dfm.minRadius`, `forge.dfm.cornerRadius`, `forge.dfm.holeRules`. Cost via `CostEstimation.cpp` (`forge.dfm.costEstimate` — material+cycle+tooling). Carbon via `CarbonLca.cpp`. Output: ranked manufacturability issues with geometric highlight + fix suggestion.

**(c) Governing standards / equations / methods.** Boothroyd–Dewhurst DFMA cost/complexity scoring; process capability windows; min-wall/draft/radius tables per process; **ISO 2768** (general tolerances), **DIN 6784** (edges), DFM checklists (machining/casting/molding); tooling-amortization economics.

**(d) Training-data topics.** Process selection by volume/material/geometry; rule-violation detection (thin wall, no draft, sharp internal corner, tool-inaccessible feature); cost-driver identification; redesign-for-cost suggestions; tolerance-vs-cost trade-off.

---

## 14. Design for Assembly (DFA)

**(a) Core knowledge.** Part-count reduction, minimize fastener variety, self-locating/self-aligning features, poka-yoke (mistake-proofing), insertion direction (single-axis top-down), handling (symmetry/asymmetry α+β, tangling, nesting), accessibility, modular/platform design, Boothroyd–Dewhurst DFA index & theoretical minimum parts, assembly sequence.

**(b) Concrete Forge engine/capability.** `forge.dfa.*` over the assembly graph: `forge.dfa.partCountAnalysis` (DBD 3-question theoretical-minimum test), `forge.dfa.handlingTime` (symmetry α+β scoring), `forge.dfa.insertionCheck` (single-direction feasibility), `forge.dfa.interferenceFree` (uses `InterferenceDetection.hpp` + `forge.simulate.interference`), `forge.dfa.fastenerConsolidation`. Assembly-sequence + collision via MBD path. Output: DFA efficiency index + part-elimination candidates.

**(c) Governing standards / equations / methods.** Boothroyd–Dewhurst DFA index `E_ma = (N_min·t_a)/t_ma`; handling-time tables from symmetry (α=rotational, β=insertion); 3-criteria minimum-part rule (relative motion / different material / assembly access); poka-yoke principles.

**(d) Training-data topics.** Part-count-reduction reasoning (3-question test); symmetry/handling scoring; insertion-direction feasibility; fastener consolidation; poka-yoke feature suggestion; DFA-index computation; sequence planning.

---

## 15. Design for Additive Manufacturing (DfAM)

**(a) Core knowledge.** AM processes (LPBF/SLM, EBM, DED, FDM/FFF, SLA/DLP, binder jet, MJF), orientation strategy, support generation (overhang ≤45° self-support, anchor density), residual stress & distortion (thermal cycling), lattice/TPMS infill, topology optimization for AM, min feature size & layer-height ratio, surface roughness by orientation, powder/recoat constraints, part consolidation, channel/conformal-cooling freedom.

**(b) Concrete Forge engine/capability.** Strong existing voxel/implicit base: `voxel/Lattice.cpp` + `voxel/Tpms.cpp` (gyroid/Schwarz/diamond, vol-frac controllable 0→1), `implicit/SdfTree.cpp`/`SdfOps.cpp`/`IsoMesher.cpp`/`DualContour.cpp`. `forge.dfam.topOpt` (SIMP density `ρ^p`, p=3 penalization → already cited in PARITY as in-house SIMP), `forge.dfam.latticeInfill(tpms, gradedDensity)`, `forge.dfam.supportGen(overhangDeg=45)`, `forge.dfam.orientationOptimize` (minimize support+roughness+height), `forge.dfam.residualStress` (inherent-strain / thermal LPBF). Wall-check via `mesh::WallThickness`; min-feature gate.

**(c) Governing standards / equations / methods.** SIMP `E(ρ)=ρ^p·E₀`, p≈3, density filter + Heaviside projection; self-support 45° rule; min feature ≥0.4 mm (FFF) / process-dependent; layer-height/nozzle ≤0.3; inherent-strain residual-stress model; TPMS implicit `cos x sin y + cos y sin z + cos z sin x = c` (gyroid). **ISO/ASTM 52900** (AM terminology), **52902/52911** (design), **52904** (LPBF process).

**(d) Training-data topics.** Build-orientation reasoning (support vs roughness vs strength vs time); TPMS/lattice selection & grading; support-need detection from overhang map; topology-optimization setup & interpretation; residual-distortion mitigation; min-feature/wall checks; process selection.

> **Cite:** SIMP + TPMS gyroid + 45° self-support + min 0.4 mm (Nature s41598/Simcenter DfAM) — https://www.nature.com/articles/s44334-025-00057-6

---

## 16. Mold/Tool/Die Design

**(a) Core knowledge.** Cavity/core split, parting-line/surface selection, draft, shut-offs, slides/lifters for undercuts, gating (sprue/runner/gate types — edge/sub/pin/hot-tip), runner balancing, cooling-channel layout (conformal), ejection (pins/sleeves/stripper), venting, shrinkage compensation, mold-base standards (DME/HASCO), tool steels & hardness, die design (progressive/transfer dies, blank layout/nesting, strip development), die clearance.

**(b) Concrete Forge engine/capability.** `Mold.cpp` (built): `forge.mold.analyseDraft` (per-face draft angle vs threshold), `forge.mold.computeParting` (parting-line/surface extraction). Extend: `forge.mold.coreCavitySplit` (B-rep split along parting surface), `forge.mold.undercutDetect` → slide/lifter suggestion, `forge.mold.runnerBalance`, `forge.mold.coolingLayout` (conformal channels via implicit/voxel), `forge.mold.shrinkComp(scaleFactor)`. Couples to `MoldFlow.cpp` (§24). Die: `forge.die.blankLayout`/`forge.die.stripDevelopment` (nesting + `SheetMetalFlatPattern.hpp`).

**(c) Governing standards / equations / methods.** Draft ≥0.5–2°; gate-freeze/hold logic; runner ΔP balance (Hagen–Poiseuille); cooling Reynolds/turbulent channel; shrinkage compensation `L_cav=L_part/(1−S)`; nesting utilization. **SPI/SPE** mold classifications, **DME/HASCO** mold-base catalogs, **DIN 16742** (plastic tolerances).

**(d) Training-data topics.** Parting-line selection; draft analysis & fix; undercut→slide/lifter reasoning; gate-type/location selection; runner balancing; conformal-cooling layout; shrinkage scaling; blank nesting & strip layout.

---

## 17. CNC Programming & G-code Optimization

**(a) Core knowledge.** G/M-code (G0/G1/G2/G3, canned cycles G81–G89, cutter comp G41/42, work offsets G54–G59), 3-/4-/5-axis toolpaths, milling strategies (adaptive/trochoidal HSM, contour, pocket, rest-machining, scallop/parallel finishing), turning, drilling, feeds & speeds (SFM/Vc, chip load f_z, MRR), tool engagement (radial/axial DOC, TEA), post-processors, collision/gouge avoidance, tool-life (Taylor), simulation/verification.

**(b) Concrete Forge engine/capability.** `Machining.cpp` + `Cam.cpp`/`CamAdvanced.cpp`/`CamExtended.cpp`: `forge.cam.adaptiveClear` (verified in binding — trochoidal/HSM), `forge.cam.contour`, `forge.cam.pocket`, `forge.cam.drill`, `forge.cam.scallop`, `forge.cam.restMachine`, `forge.cam.fiveAxis`, `forge.cam.postProcess(controller)` → G-code, `forge.cam.simulate` (material-removal verification via voxel `VoxelBoolean`), `forge.cam.feedsSpeeds(tool,mat)`. MRR/scallop-height optimization; gouge check via SDF distance.

**(c) Governing standards / equations / methods.** `Vc=π·D·N/1000`; `f_z` chip load; `MRR=a_e·a_p·v_f`; scallop `h=R−√(R²−(stepover/2)²)`; Taylor tool life `V·Tⁿ=C`; **ISO 6983** (G-code), **STEP-NC ISO 14649/10303-238**, **ISO 3685** (tool-life). Adaptive/HSM constant tool-engagement.

**(d) Training-data topics.** Strategy selection by feature/material; feeds-speeds computation; stepover/scallop trade-off; G-code generation & reading; canned-cycle selection; collision/gouge reasoning; 3- vs 5-axis decision; tool-life estimation.

---

## 18. Sheet Metal Forming Analysis

**(a) Core knowledge.** Bending (K-factor/neutral-axis, bend allowance/deduction, springback, min bend radius, V-die), flat-pattern unfolding, forming limit diagram (FLD, major/minor strain), deep drawing (LDR, draw ratio, blank-holder force, wrinkling/tearing), stretch forming, hemming, relief cuts, formability (n & r anisotropy values), incremental forming, hydroforming.

**(b) Concrete Forge engine/capability.** Built: `SheetMetal.cpp`/`SheetMetalExtended.cpp`/`SheetMetalFlatPattern.hpp` + `HSSRoundBending.cpp`: `forge.sheet.bend` (K-factor, bend allowance), `forge.sheet.flatPattern` (unfold), `forge.sheet.springback`. Extend: `forge.sheet.fld` (forming-limit-diagram check on a formed mesh), `forge.sheet.deepDraw` (LDR + BHF + wrinkle/tear), `forge.sheet.minBendRadius(mat,t)`, `forge.sheet.reliefCut`. Anisotropy (r-bar/Δr) feeds Hill-48 yield in FEA. Forming sim via shell elements + Barlat yield.

**(c) Governing standards / equations / methods.** Bend allowance `BA=(π/180)·θ·(r+K·t)`, K≈0.33–0.5; springback ΔΚ; LDR=D_blank/d_punch (≈2.0–2.2); FLD (Keeler–Goodwin); Hill-48 `r=ε_w/ε_t`; Barlat Yld2000; Lankford r-value. **DIN 6935** (bending), **ISO 12004** (FLC determination), Marciniak–Kuczyński instability.

**(d) Training-data topics.** K-factor/bend-allowance computation; flat-pattern unfold; springback compensation; min-bend-radius check; FLD strain-safety reasoning; deep-draw feasibility (LDR/BHF); wrinkle/tear prediction; relief-cut placement.

---

## 19. Plastic Injection Molding Simulation

**(a) Core knowledge.** Fill/pack/cool/warp stages, melt rheology (shear-thinning), flow-front & weld/meld lines, air traps, gate-freeze & hold pressure, sink marks, cooling (channel layout, cycle time), shrinkage (volumetric vs linear, isotropic/anisotropic), warpage (differential shrinkage, fiber orientation, residual stress), short shots, gas-assist, multi-cavity balance.

**(b) Concrete Forge engine/capability.** `MoldFlow.cpp` (built) → `forge.moldflow.*`: `forge.moldflow.fill` (Hele-Shaw/3D, Cross-WLF viscosity from §3), `forge.moldflow.pack`, `forge.moldflow.cool` (transient + channel BCs), `forge.moldflow.warp` (Tait shrinkage + Folgar–Tucker fiber-orientation anisotropic stress → FEA), `forge.moldflow.weldLineDetect` (flow-front merge), `forge.moldflow.airTrap` (from `binding.cpp` field `airTrapTriangles`), `forge.moldflow.gateLocation` (fill-balance optimizer), `forge.moldflow.sinkMark`. Output: fill-time/pressure/temperature contour + warp deformation.

**(c) Governing standards / equations / methods.** Hele-Shaw `∇·(S∇p)=0`, S=fluidity; Cross-WLF η; 2-domain Tait PVT (§3); Folgar–Tucker `Dȧ/Dt = ... + 2C_I·γ̇(I−3a)`; cooling Fourier `ρc_p ∂T/∂t=∇·(k∇T)`; residual-stress thermal. Validated against Moldflow/Moldex3D methodology.

**(d) Training-data topics.** Gate-location selection; fill-balance/short-shot prediction; weld-line/air-trap location; hold-pressure & gate-freeze reasoning; warpage-driver attribution (differential shrink vs fiber); cooling-time estimation; sink-mark prediction; cite Cross-WLF/Tait/Folgar–Tucker.

> **Cite:** Moldflow Cross-WLF + 2-domain Tait + Folgar–Tucker — https://en.wikipedia.org/wiki/Folgar-Tucker_Model

---

## 20. Castings & Forgings Engineering

**(a) Core knowledge.** Casting processes (sand, investment, die, permanent-mold, centrifugal, continuous), solidification (heat extraction, dendrites, mushy zone, fraction-solid), feeding & risering (Chvorinov, riser sizing, directional solidification, hot spots), gating-system design, defects (shrinkage porosity, gas porosity, cold shut, misrun, hot tear, inclusions), Niyama criterion. Forging (open/closed-die, flash, forging load, flow lines, preform/blocker, die-fill, forgeability, grain flow, hammer vs press).

**(b) Concrete Forge engine/capability.** `Casting.cpp` (built) → transient solidification FD solver computing solidification-time field + peak temp + **Niyama `G/√R`** porosity map (verified in source). `forge.casting.solidify` → `{ niyama[], solidTime[], hotSpots }`; `forge.casting.riserSize` (Chvorinov modulus matching), `forge.casting.feedingPath`, `forge.casting.gatingDesign`, `forge.casting.defectPredict` (shrink/gas/cold-shut/hot-tear). Forging: `forge.forge.load` (load = flow-stress·area·shape-factor), `forge.forge.dieFill`, `forge.forge.flowLines`, `forge.forge.preform`.

**(c) Governing standards / equations / methods.** Chvorinov `t=B·(V/A)ⁿ`, n≈2; **Niyama `Ny=G/√Ṙ`**, steel critical `G/√R < 2.5 °C·s^0.5·mm^−1.5` (and dimensionless Niyama for alloy-independence); riser modulus `M_r≥1.2·M_c`; forging load (slab/upper-bound); flow stress `σ=K·εⁿ·ε̇^m`. **ASTM A356/A781** (steel cast), **AMS** forging specs, NADCA die-cast guidelines.

**(d) Training-data topics.** Riser sizing (Chvorinov modulus); Niyama porosity-risk reading; gating-system design; hot-spot/feeding-path ID; defect attribution; forging-load estimation; preform/die-fill reasoning; process selection (investment vs die vs sand).

> **Cite:** Niyama steel `G/√R<2.5` (Carlson & Beckermann, dimensionless Niyama) — https://beckermann.lab.uiowa.edu/sites/beckermann.lab.uiowa.edu/files/2023-10/NiyamaCarlson.pdf

---

## 21. Welding & Joining Technology

**(a) Core knowledge.** Processes (SMAW/MIG-GMAW/TIG-GTAW/SAW/FCAW, resistance/spot, laser/EBW, friction/FSW, brazing/soldering), weld metallurgy (HAZ, dilution, cooling rate t8/5), heat input & thermal cycle (Rosenthal/Goldak double-ellipsoid), residual stress & distortion, joint design (groove/fillet/butt), weld symbols, defects (porosity, lack-of-fusion, cracking — hot/cold/hydrogen), weld sizing & strength, fatigue of welds (hot-spot/notch), preheat/PWHT, WPS/PQR.

**(b) Concrete Forge engine/capability.** Built: `WeldHeatInput.cpp`, `WeldingFea.cpp` (thermal-mechanical), `WeldGroup.hpp`, `FilletWeld.cpp`, `WeldElectrode.cpp`, `Weldments.cpp`. `forge.weld.heatInput` (`HI=η·V·I/v`), `forge.weld.thermalCycle` (Rosenthal/Goldak → t8/5 → HAZ hardness, couples to §2 metallurgy), `forge.weld.residualStress` (`WeldingFea` thermal-mechanical FEA), `forge.weld.distortion`, `forge.weld.group` (weld-group elastic/plastic analysis under load), `forge.weld.filletSize`, `forge.weld.fatigue` (IIW hot-spot). Weldment modeling via `Weldments.cpp` (structural-member + trim/extend).

**(c) Governing standards / equations / methods.** Heat input `HI=η·(V·I)/v` (kJ/mm); Rosenthal moving point/line source; Goldak double-ellipsoid; t8/5 cooling time; carbon-equivalent preheat (§2); fillet throat `a=0.707·leg`. **AWS D1.1** (structural steel), **ASME BPVC IX** (qualification), **ISO 5817** (quality levels), **IIW** fatigue recommendations, **EN 1011** (preheat).

**(d) Training-data topics.** Process selection by material/thickness/position; heat-input & t8/5 computation; preheat/PWHT from CE; residual-distortion mitigation (sequence/clamping); weld-group force analysis; fillet sizing; weld-symbol interpretation; weld-fatigue hot-spot.

---

## 22. Surface Engineering & Tribology

**(a) Core knowledge.** Friction (Coulomb, Stribeck regimes — boundary/mixed/hydrodynamic), wear (adhesive/abrasive/fatigue-pitting/fretting/erosion, Archard law), lubrication (hydrodynamic Reynolds equation, EHL, film thickness, viscosity-pressure Barus), contact mechanics (Hertzian point/line, asperity/Greenwood–Williamson), surface texture (Ra/Rz/Rq/Sa, bearing-area Abbott curve), coatings (PVD/CVD, thermal spray, anodizing, electroplating, DLC, nitriding), surface treatments (shot peening residual stress, case hardening), rolling-contact fatigue.

**(b) Concrete Forge engine/capability.** `HertzPoint.hpp` (built) + `Bearing.hpp`: `forge.tribo.hertzContact` (point/line — contact pressure, area, subsurface shear). Extend: `forge.tribo.archardWear(load,distance,H)`, `forge.tribo.stribeck` (regime from speed·visc/load), `forge.tribo.reynoldsFilm` (hydrodynamic film thickness), `forge.tribo.ehl` (elastohydrodynamic min-film), `forge.surface.roughness` (Ra/Rz/Sa from a scanned/meshed surface via `mesh` analysis), `forge.surface.peeningResidual`, `forge.surface.rcf` (rolling-contact-fatigue life). Couples to bearing/gear (§11) and fatigue (§10).

**(c) Governing standards / equations / methods.** Hertz `p_max=(3F)/(2πa²)`, `a=(3FR/4E*)^{1/3}`; Archard `V=k·F·s/H`; Reynolds eqn `∂/∂x(h³/η·∂p/∂x)+...=6U·∂h/∂x`; Barus `η=η₀·e^{αp}`; Stribeck (Hersey number ηN/P); Greenwood–Williamson; Ra/Rz/Sa per **ISO 4287/25178**; **ISO 281** (bearing life), **ISO 6336** (gear pitting), shot-peen Almen intensity (**SAE J442/J443**).

**(d) Training-data topics.** Hertzian contact-pressure computation; wear-rate (Archard) & coating selection; lubrication-regime (Stribeck) ID; min-film/EHL estimation; roughness-parameter interpretation; shot-peen/coating selection for wear/fatigue; bearing/gear-life surface check.

---

## 23. Geometric Dimensioning & Tolerancing (GD&T)

**(a) Core knowledge.** 14 characteristics (form: flatness/straightness/circularity/cylindricity; orientation: parallel/perpendicular/angularity; location: position/concentricity/symmetry; profile: line/surface; runout: circular/total), feature control frames, datum reference frame (DRF, 3-2-1, datum precedence/sequence), material modifiers (MMC Ⓜ/LMC Ⓛ/RFS), bonus & datum-shift tolerance, virtual condition, tolerance zones, composite position, basic dimensions, projected tolerance zone, datum targets.

**(b) Concrete Forge engine/capability.** Built: `gdt/Gdt.cpp` + `Tolerance.cpp` + `BooleanTol.cpp` (tolerant booleans). `forge.gdt.applyFCF(feature, char, tol, datums, modifier)`, `forge.gdt.datumFrame` (3-2-1 DRF construction), `forge.gdt.evaluate` (measure actual deviation vs zone — flatness/position/profile from a measured/meshed surface), `forge.gdt.bonusTolerance` (MMC departure → bonus), `forge.gdt.virtualCondition`, `forge.gdt.compositePosition`. PMI annotation on the B-rep (semantic, machine-readable — STEP AP242). Couples to inspection/CMM point clouds (`PointCloud.cpp`).

**(c) Governing standards / equations / methods.** **ASME Y14.5-2018** (14 symbols in 5 categories: form 4, profile 2, orientation 3, location 3, runout 2) and **ISO 1101 / GPS** (ISO 5458 position, ISO 2692 MMR/LMR, ISO 8015 independency); position `Ø2√(Δx²+Δy²)`; MMC bonus = |actual−MMC|; virtual condition `VC=MMC±geo_tol`; **STEP AP242** semantic PMI, **ISO 16792** (digital product definition).

**(d) Training-data topics.** FCF reading/authoring; datum-precedence selection; position + bonus-tolerance computation; MMC/LMC/RFS reasoning; profile-vs-position choice; virtual-condition & fit; Y14.5-2018 vs ISO-GPS differences; PMI placement.

> **Cite:** ASME Y14.5-2018 (14 symbols / 5 categories, MMC bonus, DRF) — https://www.sigmetrix.com/blog/ultimate-guide-to-asme-y14.5

---

## 24. Tolerance Stack-up Analysis

**(a) Core knowledge.** 1D/2D/3D stacks, worst-case (arithmetic), statistical RSS (root-sum-square), Monte Carlo (distribution sampling), process capability (Cp/Cpk, Pp/Ppk, σ-level, PPM), gap/clearance & interference analysis, sensitivity & contributor ranking, GD&T-aware stacks (bonus/datum-shift propagation), float/play, assembly-shift, tolerance allocation/optimization (cost-tolerance curves).

**(b) Concrete Forge engine/capability.** `Tolerance.cpp` + `Variants.cpp` → `forge.tolstack.*`: `forge.tolstack.worstCase(loop)` (Σ|t_i| arithmetic min/max), `forge.tolstack.rss(loop)` (`t_asm=√Σt_i²`), `forge.tolstack.monteCarlo(loop, N)` (sample each feature from its distribution, N≥10⁶ → histogram + yield/PPM), `forge.tolstack.cpk(spec, process)`, `forge.tolstack.sensitivity` (contributor ranking ∂gap/∂t_i), `forge.tolstack.allocate` (optimize tolerances to cost target). GD&T-linked: pulls bonus/datum-shift from §23. Auto-extracts the dimension loop from the assembly mate graph.

**(c) Governing standards / equations / methods.** Worst-case `Gap=ΣD_i±Σt_i`; RSS `t_asm=√(Σt_i²)` (≈√n reduction — 50% for 4 parts, 75% for 16); Monte Carlo (normal/uniform sampling, ≥10⁵–10⁶ trials); `Cp=(USL−LSL)/6σ`, `Cpk=min((USL−µ)/3σ,(µ−LSL)/3σ)`; 6σ → 3.4 PPM; **ASME Y14.5** + **Y14.41** + **ISO** capability **ISO 22514**.

**(d) Training-data topics.** Loop identification; worst-case vs RSS vs Monte Carlo selection (criticality/volume); Cp/Cpk & PPM computation; contributor/sensitivity ranking; tolerance allocation for cost; GD&T-aware stack (bonus propagation); yield prediction; when RSS under-predicts → Monte Carlo.

> **Cite:** Worst-case/RSS(√n)/Monte Carlo + Cp/Cpk + 3.4 PPM — https://www.blackrock-engineering.ca/blog/statistical-tolerance-analysis-rss-monte-carlo/

---

## Cross-cutting corpus principles (apply to every field)

1. **Tool-call grounding.** Every Q/A pair must terminate in a valid `forge.<workbench>.<op>(args)` matching the Studio/Forge Tool Registry schema Archie was trained on (per fleet schema memory), so CADGenBench geometry-truth scoring can replay it.
2. **Unit-correctness & dimensional analysis** baked into every numeric answer (SI primary, with imperial recall).
3. **Dynamic-first** (user mandate "no statics"): prefer transient/modal/forming/solidification/motion outputs over static snapshots.
4. **Full assembly context + multimodal** (memory): geometry-gen, GD&T, and tolerance tasks must see the surrounding design (text + drawing image + 3D), not isolated parts.
5. **Honesty:** where a Forge engine is present-but-unverified (e.g. turbulent CFD) the corpus must teach Archie to surface the real limit, never fabricate a number.

---

## Sources
- FKM Guideline 7th ed. 2020 — https://www.sciencedirect.com/science/article/pii/S0142112324000239 ; https://www.vdmashop.de/en/fkm-guidelines/483/analytical-strength-assessment-7th.-ed.-2020-en
- Niyama criterion (dimensionless, steel G/√R<2.5) — https://beckermann.lab.uiowa.edu/sites/beckermann.lab.uiowa.edu/files/2023-10/NiyamaCarlson.pdf ; https://link.springer.com/article/10.1007/s11661-008-9715-y
- ASME Y14.5-2018 GD&T — https://www.sigmetrix.com/blog/ultimate-guide-to-asme-y14.5 ; https://www.asme.org/codes-standards/find-codes-standards/y14-5-dimensioning-tolerancing
- Injection molding Cross-WLF / Tait / Folgar–Tucker — https://en.wikipedia.org/wiki/Folgar-Tucker_Model
- CFD SST k-ω + PIMPLE/Courant — https://www.cfd-online.com/Wiki/SST_k-omega_model
- MBD HHT-α index-3 DAE — https://www.mcs.anl.gov/papers/P1278.pdf ; https://link.springer.com/article/10.1007/s12206-019-0208-2
- Tolerance stack-up (worst-case/RSS/Monte Carlo, Cp/Cpk) — https://www.blackrock-engineering.ca/blog/statistical-tolerance-analysis-rss-monte-carlo/ ; https://enventive.com/tolerance-analysis-resources/worst-case-rss-and-monte-carlo-simulation-calculations-for-tolerance-analysis/
- DfAM SIMP / TPMS / 45° self-support — https://www.nature.com/articles/s44334-025-00057-6 ; https://blogs.sw.siemens.com/simcenter/four-key-principles-of-design-for-additive-manufacturing-dfam/
