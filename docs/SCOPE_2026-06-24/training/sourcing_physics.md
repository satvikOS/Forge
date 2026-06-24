# Source Taxonomy — PHYSICS CLUSTER (Solid mechanics · Structures · Dynamics · Thermodynamics · Fluids · Heat transfer · Materials)

> **Generated 2026-06-24** for the Archie 14B "pure CAD/CAM/CAE engineer" curriculum.
> This is the **research-grade SOURCE TAXONOMY** that grounds the synthetic generator
> `scripts/bulk_synth_physics.py` (archdisc-Models). It is the sibling of the *deep
> curriculum* doc `simulation-physics.md` (which enumerates the FEA/CFD/MBD topic ladder)
> — this doc answers the orthogonal questions: **WHO** (institutions/courses), **WHAT TEXT**
> (canonical authoritative books + reference standards), **WHAT LITERATURE** (the seminal
> research papers), **WHAT LADDER** (BSc→MS→PhD→industry per sub-field), and — load-bearing —
> **WHAT KNOWN-ANSWER ANCHORS** (the specific *named, published* reference values the
> generated samples must reproduce). Every numeric a sample emits is either (a) computed
> from a first-principles closed form and asserted against a hand-checked invariant, or
> (b) pinned to a named published benchmark (NIST / NAFEMS / Ghia-Ghia-Shin / ASME /
> Incropera worked-example / spec). The generator's `LEVELS = ['BSc','MSc','PhD','industrial']`
> tag mirrors §3 of this doc; the `KNOWN_ANSWER_ANCHORS` table in the generator mirrors §5.
>
> **HONESTY (inherited from the Bible §0/§9 and `feedback-validate-published-references`).**
> A number is teachable as *validated* only with a characterized error vs an analytical or
> benchmark truth. The CFD turbulent regime is `validated-laminar / unverified-turbulent` in
> the kernel — the corpus teaches Archie to surface that limit, never fabricate a RANS number.

---

## 0. SUB-FIELDS COVERED (and their generator function)

The cluster spans seven named physics sub-fields. The generator (`bulk_synth_physics.py`)
realizes them through ten generator functions (`g_*`), each tagged with `meta.field`:

| # | Sub-field (prompt) | Generator fn(s) | Core governing law |
|---|---|---|---|
| 1 | **Solid mechanics / elasticity** | `g_struct` (stress transform, beams, torsion, vessels) | Cauchy stress, Hooke σ=Eε, Navier–Lamé |
| 2 | **Structures** | `g_struct` (Euler buckling, von Mises/Tresca/Mohr) | Pcr=π²EI/(KL)²; von Mises J2 |
| 3 | **Dynamics** | `g_fea` (modal/transient), `g_mbd` (MBD/DAE), `g_kinematics` | ([K]−ω²[M])φ=0; index-3 DAE; Gübler |
| 4 | **Thermodynamics** | `g_thermo` *(NEW)* | 1st/2nd law, Carnot, ideal gas, isentropic |
| 5 | **Fluids** | `g_cfd` (laminar verified; turbulent honest) | Navier–Stokes; Re; Bernoulli; Moody |
| 6 | **Heat transfer** | `g_heat` *(NEW)* | Fourier ∇·(k∇T)+q̇=ρc∂T/∂t; Nu=hL/k |
| 7 | **Materials** | `g_materials_feed`, `g_fatigue`, `g_tribology` | E/ν/ρ/σy/K1C; Paris; Hertz; Hall–Petch |

The pre-existing CAE auxiliaries (`g_aero` aeroacoustics, `g_emag` electromagnetics) are
retained — they are the simulation physics the kernel's verb surface also targets — but the
seven *named* sub-fields above are the cluster's spine, and **thermodynamics + heat transfer
are added in this upgrade** to close the gap (the prompt names them explicitly; the prior
generator had only CFD-side `prandtl`/`thermal_stress` fragments).

---

## 1. NAMED INSTITUTIONS / COURSES (the rigor target)

Each sample's framing is modeled on the depth and notation of these courses (modeled-on,
**not** verbatim — no copyrighted text is reproduced). Cited inline as
`(per MIT 2.001 / Crandall–Dahl–Lardner)` etc.

### MIT (OpenCourseWare — the primary anchor)
- **2.001 Mechanics & Materials I**, **2.002 Mechanics & Materials II** — solid mechanics, stress/strain, beams, energy methods.
- **2.003 / 2.004 Dynamics & Control** — Lagrangian/Newton-Euler dynamics, vibration.
- **2.005 / 2.006 Thermal-Fluids Engineering I & II** — thermodynamics + fluids + heat transfer (the unified MIT thermal-fluids sequence).
- **2.051 Introduction to Heat Transfer**, **2.55 Advanced Heat & Mass Transfer**.
- **2.06 Fluid Dynamics**, **2.25 Advanced Fluid Mechanics** (Ain Sonin).
- **2.080 Structural Mechanics** (Wierzbicki), **16.20 Structural Mechanics** (aero).
- **2.094 Finite Element Analysis of Solids & Fluids** (Bathe — the FEA anchor).
- **3.012 / 3.40 Materials** — thermodynamics of materials, mechanical behavior.
- **16.100 Aerodynamics**, **16.512 Rocket Propulsion** (compressible flow).

### Stanford ME
- **ME 70 Engineering Thermodynamics**, **ME 131A/B Fluid Mechanics & Heat Transfer**.
- **ME 232 Advanced Fluid Mechanics**, **ME 351A/B Fluid Mechanics** (graduate).
- **ME 335A/B/C Finite Element Analysis** (graduate FEA, the Hughes lineage).
- **ME 238 Mechanical Behavior of Materials**, **ME 281 Continuum Mechanics**.
- **CME 206 Numerical Methods for PDEs**.

### Caltech GALCIT (Graduate Aerospace Laboratories)
- **Ae/AM 102 abc Mechanics of Structures & Solids**.
- **Ae 101 abc Fluid Mechanics**, **Ae 232 abc Computational Fluid Dynamics**.
- **Ae/APh/CE/ME 101 abc** — fluid mechanics / heat & mass transfer.
- **ME 12 abc Thermodynamics**; **Ae 121 Aeroelasticity**.

### Cross-checks (national research institutes / professional bodies)
- **NIST** — thermophysical property data (REFPROP / Webbook), fundamental constants (CODATA).
- **NAFEMS** — the FE/CFD benchmark authority (LE/T/FV series, Scordelis-Lo, pinched cylinder).
- **NASA Turbulence Modeling Resource (TMR)** + **ERCOFTAC** — CFD validation cases.
- **ASME** — BPVC (pressure vessels), V&V 10/20/40, PTC (performance test codes).
- **AGMA** (gears), **ASTM** (E8 tension, E647 da/dN, E1049 rainflow, E399 K_IC), **ISO 281** (bearings).

---

## 2. AUTHORITATIVE TEXTS + REFERENCE STANDARDS (per sub-field)

Canonical texts cited inline in samples as method-provenance, e.g. `(Incropera, §3.6)`,
`(Shigley, Marin factors)`, `(Timoshenko, beam theory)`.

### Solid mechanics / elasticity
- **Timoshenko & Goodier, *Theory of Elasticity*** — the elasticity bedrock (Airy stress functions, St-Venant).
- **Crandall, Dahl & Lardner, *An Introduction to the Mechanics of Solids*** (the MIT 2.001 text).
- **Boresi & Schmidt, *Advanced Mechanics of Materials***; **Fung, *Foundations of Solid Mechanics***.
- *Standard:* none numeric here — these are the closed-form truth sources.

### Structures
- **Hibbeler, *Mechanics of Materials*** (the BSc workhorse — beams, torsion, Mohr, buckling).
- **Gere & Goodno, *Mechanics of Materials***; **Timoshenko, *Theory of Elastic Stability*** (buckling).
- **Boresi; Roark's *Formulas for Stress and Strain*** (Young & Budynas — the formula reference).
- *Standards:* **ASME BPVC VIII** (pressure-vessel hoop/longitudinal stress), **AISC 360** (column/buckling).

### Dynamics (vibration + multibody + machinery)
- **Rao, *Mechanical Vibrations*** / **Meirovitch, *Fundamentals of Vibrations*** (SDOF, modal, harmonic).
- **Shabana, *Computational Dynamics* / *Dynamics of Multibody Systems*** (index-3 DAE, joints).
- **Nikravesh, *Computer-Aided Analysis of Mechanical Systems*** (Baumgarte, DAE).
- **Norton, *Design of Machinery*** (Gübler, four-bar/Grashof, cams); **Uicker–Pennock–Shigley, *Theory of Machines and Mechanisms***.
- *Standard:* **AGMA 2001** (gear bending/contact).

### Thermodynamics  *(NEW sub-field this upgrade)*
- **Moran, Shapiro, Boettner & Bailey, *Fundamentals of Engineering Thermodynamics*** (the BSc anchor).
- **Çengel & Boles, *Thermodynamics: An Engineering Approach***.
- **Borgnakke & Sonntag, *Fundamentals of Thermodynamics***.
- **Callen, *Thermodynamics and an Introduction to Thermostatistics*** (graduate/axiomatic).
- *Reference data:* **NIST Chemistry WebBook / REFPROP** (steam tables, gas properties); **CODATA** (R=8.314462618 J/mol·K).

### Fluids
- **White, *Fluid Mechanics*** / **Fox, McDonald & Pritchard, *Introduction to Fluid Mechanics*** (BSc).
- **Munson, *Fundamentals of Fluid Mechanics***; **Kundu & Cohen, *Fluid Mechanics*** (graduate).
- **Versteeg & Malalasekera, *An Introduction to Computational Fluid Dynamics: The Finite Volume Method*** (the CFD anchor — SIMPLE, discretization, turbulence).
- **Pope, *Turbulent Flows*** (graduate turbulence); **Anderson, *Computational Fluid Dynamics***.
- *Standards/refs:* **Moody chart** (Colebrook 1939), **Blasius** flat-plate solution.

### Heat transfer  *(NEW sub-field this upgrade)*
- **Incropera & DeWitt, *Fundamentals of Heat and Mass Transfer*** (the canonical anchor — conduction/convection/radiation, correlations).
- **Bergman, Lavine, Incropera, DeWitt** (current edition).
- **Holman, *Heat Transfer***; **Mills, *Heat Transfer***; **Bejan, *Convection Heat Transfer*** (graduate).
- *Reference data:* property tables (Incropera App. A), **σ = 5.670374e-8 W/m²K⁴** (Stefan-Boltzmann, CODATA).

### Materials
- **Callister & Rethwisch, *Materials Science and Engineering: An Introduction*** (the materials anchor).
- **Ashby, *Materials Selection in Mechanical Design*** (selection charts, indices).
- **Dieter, *Mechanical Metallurgy***; **Courtney, *Mechanical Behavior of Materials***.
- **Shigley (Budynas & Nisbett), *Mechanical Engineering Design*** (fatigue: Marin, Goodman, S-N).
- **Anderson, *Fracture Mechanics: Fundamentals and Applications*** (LEFM, K, Paris).
- **Suresh, *Fatigue of Materials*** (graduate fatigue).
- **Hamrock / Stachowiak & Batchelor, *Engineering Tribology*** (Hertz, Archard, Reynolds).
- *Data/standards:* **MMPDS** (formerly MIL-HDBK-5, aerospace design allowables), **NIST SRD** alloy data,
  **ASTM E8** (tension), **E399/E1820** (fracture toughness), **E647** (da/dN), **E1049** (rainflow).

### FEA / numerics (cross-cutting)
- **Bathe, *Finite Element Procedures*** (the FEA anchor — the MIT 2.094 text).
- **Zienkiewicz, Taylor & Zhu, *The Finite Element Method***; **Hughes, *The Finite Element Method*** (Stanford lineage).
- **Cook, Malkus, Plesha & Witt, *Concepts and Applications of Finite Element Analysis***.
- *Standards:* **NAFEMS** benchmark library; **ASME V&V 10** (CSM), **V&V 20** (CFD/HT).

---

## 3. CURRICULUM LADDER — BSc → MS → PhD → industry (per sub-field)

Every sample carries a `meta.level ∈ {BSc, MSc, PhD, industrial}` matching this ladder.

### Solid mechanics / structures
- **BSc** — Hooke's law, axial/bending/torsion stress, Mohr's circle, beam deflection, Euler buckling, thin-wall vessels, von Mises/Tresca yield, FoS.
- **MS** — energy methods (Castigliano), plane stress/strain elasticity (Airy), plates/shells, elastic stability with imperfections, anisotropy/composites (rule of mixtures, classical laminate theory).
- **PhD** — finite-strain continuum mechanics (deformation gradient F, PK1/PK2), nonlinear elasticity, fracture/XFEM, homogenization/RVE, variational inequalities (contact).
- **Industry** — code-driven sizing (ASME BPVC, AISC), allowable-stress design, weld/joint detailing, fillet-the-corner singularity judgment, design allowables (MMPDS) vs nominal handbook values.

### Dynamics
- **BSc** — SDOF mass-spring-damper, natural frequency, damping ratio, harmonic response, rigid-body kinematics, Gübler mobility, Grashof.
- **MS** — MDOF modal analysis ([K]−ω²[M])φ=0, modal superposition, Newmark/HHT time integration, multibody index-3 DAE, gear/cam dynamics, balancing.
- **PhD** — generalized-α & energy-momentum integrators, nonlinear/flexible multibody, model-order reduction (Craig-Bampton, POD), random vibration (PSD, Miles), aeroelasticity.
- **Industry** — resonance avoidance (Campbell diagrams, separation margins), modal test correlation (MAC), fatigue from vibration, bearing/joint reaction sizing, NVH.

### Thermodynamics
- **BSc** — 1st/2nd law, ideal-gas law, Carnot efficiency, isentropic relations, control-volume energy balance, basic cycles (Otto, Brayton, Rankine).
- **MS** — exergy/availability, real-gas EoS, combustion/chemical equilibrium, advanced cycles & cogeneration, psychrometrics.
- **PhD** — statistical thermodynamics, irreversible thermo (Onsager), non-equilibrium, molecular simulation links.
- **Industry** — cycle performance per **ASME PTC**, NIST property data for sizing, efficiency guarantees, off-design analysis.

### Fluids
- **BSc** — hydrostatics, Bernoulli, continuity, Reynolds number & regime, Moody chart / Darcy-Weisbach head loss, drag/lift coefficients, control-volume momentum.
- **MS** — Navier-Stokes derivation, boundary-layer theory (Blasius, Falkner-Skan), potential flow, dimensional analysis (Buckingham Π), compressible flow (isentropic, normal shock), intro CFD (FVM, SIMPLE).
- **PhD** — turbulence (RANS k-ε/k-ω SST, LES/DNS), stability/transition, multiphase, high-order schemes, spectral methods.
- **Industry** — pump/fan/pipe-network sizing, CFD with **mandatory benchmark validation + y⁺ compliance**, the honest laminar-verified / turbulent-unverified line.

### Heat transfer
- **BSc** — Fourier conduction, thermal resistance networks, fins, lumped capacitance (Biot), convection correlations (Nu, Re, Pr), Stefan-Boltzmann radiation.
- **MS** — transient conduction (Heisler/1-term), external/internal convection correlations (Dittus-Boelter, Churchill-Chu), heat exchangers (LMTD, ε-NTU), view factors.
- **PhD** — conjugate heat transfer, turbulent heat transfer, radiation in participating media, microscale/phonon transport, inverse problems.
- **Industry** — electronics cooling, HX rating/sizing, thermal-stress coupling, CFD-thermal per **ASME V&V 20**.

### Materials
- **BSc** — E/ν/ρ, yield/ultimate, Hooke, thermal expansion, S-N fatigue, Hall-Petch, rule of mixtures, phase diagrams basics.
- **MS** — dislocation strengthening, fracture toughness & LEFM (K, K_IC), Paris crack growth, strain-life (Coffin-Manson), creep, composites (CLT).
- **PhD** — crystal plasticity, micromechanics/homogenization, fatigue short-crack mechanics, multiscale materials modeling, ICME.
- **Industry** — material selection (Ashby indices), design allowables (MMPDS), weldability (carbon equivalent, AWS D1.1), heat-treat (Hollomon-Jaffe), datasheet-driven grade selection.

---

## 4. KEY RESEARCH LITERATURE (cited as method provenance)

- **Williams (1952)** — stress singularity at re-entrant corners (the "never-converges" fillet rule).
- **Newmark (1959)** — implicit time integration; **Hilber, Hughes & Taylor (1977)** — HHT-α.
- **Wilson, Taylor, Doherty & Ghaboussi (1973)** — incompatible modes (Q6, the kernel's de-locking).
- **Baumgarte (1972)** — constraint stabilization for DAEs; **Gear-Gupta-Leimkuhler** index reduction.
- **Ghia, Ghia & Shin (1982)** — lid-driven cavity benchmark (the CFD known-answer table).
- **Menter (1994)** — SST k-ω; **Spalart & Allmaras (1992)**; **Launder & Spalding (1974)** — k-ε.
- **Blasius (1908)** — laminar flat-plate boundary layer; **Colebrook (1939)** — turbulent friction.
- **Paris & Erdogan (1963)** — fatigue crack growth law; **Irwin (1957)** — SIF & plastic-zone.
- **Basquin (1910); Coffin (1954) & Manson (1953)** — stress-life / strain-life.
- **Hertz (1882)** — elastic contact; **Archard (1953)** — wear; **Reynolds (1886)** — lubrication.
- **Hall (1951) & Petch (1953)** — grain-size strengthening; **Steinmetz** — core loss.
- **Lighthill (1952)** — aeroacoustic analogy; **Ffowcs Williams & Hawkings (1969)** — FW-H.

---

## 5. KNOWN-ANSWER VALIDATION ANCHORS (the answer keys)

These are the **specific named published reference values** the generated samples must
reproduce. The generator embeds them in a `KNOWN_ANSWER_ANCHORS` table, emits at least one
sample *per anchor* whose numeric is computed and `assert`-checked against the published
value, and cites the source inline. (If an `assert` ever fails the generator crashes — a
deliberate fuse against silent numeric drift.)

| # | Anchor (named source) | Reference value | What the sample reproduces |
|---|---|---|---|
| A1 | **Euler-Bernoulli cantilever 1st mode** (Blevins; NAFEMS FV) | β₁L = **1.875104**, f₁=(β₁L)²/(2πL²)·√(EI/ρA) | modal cantilever — matches kernel's 0.2 % modal anchor |
| A2 | **Ghia, Ghia & Shin (1982)** lid-driven cavity, Re=100 | u-velocity at cavity centerline x=0.5: published profile; primary-vortex location | CFD benchmark identity (laminar, verified regime) |
| A3 | **Blasius (1908)** flat-plate laminar BL | δ/x = **5.0/√Re_x**, C_f = **0.664/√Re_x** | laminar skin-friction / BL thickness |
| A4 | **Darcy laminar friction** (White; Moody) | f = **64/Re** (exact closed form, Re<2300) | pipe friction laminar |
| A5 | **von Kármán vortex Strouhal** (Roshko 1954) | St = fD/U ≈ **0.21** for cylinder, Re 10²–10⁵ | shedding frequency |
| A6 | **Carnot efficiency** (Moran/Çengel) | η = **1 − T_C/T_H** (T in K) | thermodynamic 2nd-law bound |
| A7 | **Air speed of sound at 288.15 K** (ideal gas) | a=√(γRT)=√(1.4·287·288.15) ≈ **340.3 m/s** | compressible reference |
| A8 | **Stefan-Boltzmann** (CODATA) | σ = **5.670374e-8 W/m²K⁴**; q″=εσ(T⁴−T_s⁴) | radiation flux |
| A9 | **Lumped-capacitance Biot gate** (Incropera §5.1) | Bi=hL_c/k; lumped valid iff **Bi < 0.1** | transient conduction validity |
| A10 | **Dittus-Boelter** (Incropera §8.5) | Nu = **0.023·Re^0.8·Pr^n** (n=0.4 heating) | internal forced-convection |
| A11 | **Simple pendulum period** (any dynamics text) | T = **2π√(L/g)** | MBD/dynamics oracle; kernel 0.016 % MBD anchor |
| A12 | **Hagen-Poiseuille** (White) | Q=πR⁴Δp/(8μL); kernel CFD validated **4 %** vs this | laminar tube flow (verified regime) |
| A13 | **Hertz sphere contact** (Johnson, *Contact Mechanics*) | a=(3FR/4E*)^⅓, p_max=3F/(2πa²)=1.5·p_mean | tribology contact |
| A14 | **Paris law** (Paris-Erdogan 1963; ASTM E647) | da/dN=C(ΔK)^m; ΔK=Yσ√(πa) | fatigue crack growth |
| A15 | **NAFEMS LE1** (elliptic membrane) | tangential stress at point D = **92.7 MPa** | linear-elastic FE benchmark |
| A16 | **Ideal-gas isentropic** (Moran) | T₂/T₁=(p₂/p₁)^((γ−1)/γ); pv^γ=const | compression/expansion |
| A17 | **Stefan-Boltzmann / Wien** check, water triple point | R = **8.314462618 J/mol·K** (CODATA) | ideal-gas constant fidelity |
| A18 | **Mohr's circle invariant** | σ₁+σ₂ = σx+σy (trace invariant); τ_max=R | stress-transform self-check |

**Self-check invariants additionally asserted in-generator** (cheap, exact, catch coding
errors): Mohr trace invariance (A18), von Mises ≤ Tresca·(2/√3) ordering, p_max=1.5·p_mean
for Hertz (A13), f=64/Re exactness (A4), Carnot η<1 and η→0 as T_C→T_H (A6),
speed-of-sound 340.3 m/s at 288.15 K within 0.2 % (A7), Stefan-Boltzmann constant to 6 sig
figs (A8/A17), Biot<0.1 ⇒ lumped (A9).

---

## 6. GROUNDING CONTRACT (how the generator uses this doc)

1. **Provenance inline.** Every sample's answer cites its source/standard, e.g.
   `(per Incropera §8.5, Dittus-Boelter)`, `(Timoshenko, beam theory)`, `(Ghia-Ghia-Shin 1982)`,
   `(ASME BPVC VIII)`. Modeled-on, never verbatim.
2. **Numeric truth.** Numbers are computed in Python from the closed form — never hand-typed —
   and the *anchor* samples additionally `assert` the result against the §5 published value
   (the generator exits non-zero if any anchor drifts).
3. **Level tag.** `meta.level` ∈ {BSc, MSc, PhD, industrial} per §3 ladder; the reasoning
   depth scales with the level (BSc = formula+substitution; PhD/industrial = model-choice
   justification, regime check, validation/benchmark gate, design action).
4. **Honesty.** Turbulent CFD numbers are never asserted as fact; the sample states the
   `validated-laminar / unverified-turbulent` limit and the required ERCOFTAC/NASA-TMR
   benchmark + y⁺ + characterized error band — mirroring the kernel's VVUQ RED/AMBER/GREEN.
5. **Schema/CLI unchanged.** Chat-JSONL `{messages:[system,user,assistant], meta}`, the
   `--out/--cap/--seed/--report-every` CLI, stderr-only logging, in-memory hash dedup, hard
   `--cap` — all preserved so `generate_corpus_v3.sh` keeps working unchanged.
