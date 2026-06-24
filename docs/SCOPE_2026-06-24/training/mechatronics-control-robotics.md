# Training Curriculum — MECHATRONICS / CONTROL / ROBOTICS CLUSTER

### Cluster: Electrical & Electronics Engineering · Control Systems · Robotics · Mechatronics System Design · Signals & Systems (DSP) · Dynamics & Multibody (MBD) · Sensors & Instrumentation

> **Generated 2026-06-24** for the Archie 14B "pure CAD/CAM/CAE/mechatronics engineer"
> curriculum. This is the **source taxonomy + grounding contract** for the generator
> `archdisc-Models/scripts/bulk_synth_mechatronics.py` (curriculum stage **S4-mechatronics**,
> 200 k slice in `generate_corpus_v3.sh`). Sibling to `simulation-physics.md` (CAE),
> `gdt-metrology-quality.md`, and `manufacturing.md`.
>
> **THESIS.** Train Archie to reason about a mechatronic system the way a *practising
> controls / robotics / EE engineer* does: (1) write the *correct governing model*
> (transfer function, state space, DH chain, KCL/KVL network, z-transform); (2) carry the
> *units and the algebra* to a closed-form number; (3) *validate that number against a
> named published reference* (Ogata / Franklin & Powell / Nise worked examples, Craig DH
> tables, Oppenheim transform pairs, IEEE / ISO standard limits); and (4) read the result
> against an *engineering criterion* (gain/phase margin ≥ target, |z|<1 stability, det J ≠ 0
> away from singularity, Nyquist ≥ 2× signal bandwidth). Every numeric answer is either a
> closed-form result the generator **asserts in-process** against a reference identity, or
> it is honestly flagged as approximate/empirical.
>
> **GROUNDING CONTRACT (inherited from `feedback-validate-published-references`).** A sample
> is teachable as *validated* only when its number reproduces a closed-form or a named
> benchmark with a characterized tolerance. The generator carries **self-check assertions**
> (e.g. the LQR Riccati root must satisfy the CARE residual to 1e-6; a second-order step
> response's overshoot must match `exp(-πζ/√(1−ζ²))` to machine ε; the routh array sign
> count must equal the count of unstable closed-loop poles found by an independent
> companion-matrix eigen-solve) — when the closed form and the independent computation
> disagree, the sample is **dropped, never emitted with a wrong label**.

---

## 0. WHAT THE GENERATOR PRODUCES (the tool/answer target surface)

This cluster is **largely chat-numeric** (control/signals math) with a **robotics→Forge
tool-call seam** (DH/IK/Jacobian/motion-profile verbs that the kernel's motion/kinematics
modules replay) and a **mechatronics-design seam** (motor sizing, control-law selection,
ASIL/FMEDA functional-safety reasoning). The generator emits JSONL
`{messages:[system,user,assistant], meta:{field,topic,level,validated}}`. The honesty layer
is explicit: where a method is a *heuristic* (Ziegler-Nichols), an *approximation*
(2nd-order phase-margin estimate, beam-spread constant), or an *empirical correlation* (NDT
attenuation, motion-profile edge cases), the assistant states the limitation rather than
implying exact confidence.

| Sub-cluster | What it terminates in | In-generator validation oracle |
|---|---|---|
| **Control (CT)** | closed-form gain/pole/margin number | CARE residual; companion-matrix eigenvalues; Routh sign-count vs eigen-count; `exp(-πζ/√(1−ζ²))` identity |
| **Control (DT)** | z-domain coefficients / stability | bilinear `s=(2/T)(z−1)/(z+1)` round-trip; `\|z\|<1` ⇔ `Re(s)<0` mapping; Jury test vs root magnitude |
| **Signals / DSP** | spectrum / filter / sampling number | Parseval identity; DFT-of-known-signal closed form; Nyquist `f_s>2f_max`; FFT vs analytic transform pair (Oppenheim table) |
| **Robotics** | DH pose / IK angle / det J / τ | FK↔IK round-trip (reconstruct the commanded pose); `det J = L1·L2·sin θ2` identity; recursive Newton-Euler vs Lagrangian τ cross-check |
| **Dynamics / MBD** | natural freq / response / reaction | pendulum `2π√(L/g)`; `ω_n=√(k/m)`, `ζ=c/(2√(km))`; energy conservation; Grübler mobility |
| **EE / circuits** | impedance / pole / power number | KCL/KVL node solution; `f_c=1/(2πRC)`; `δ=√(2/ωμσ)`; per-unit & symmetrical-component identities |
| **Sensors / instrumentation** | resolution / SNR / bandwidth | ADC `q=FSR/2^N`, `SNR=6.02N+1.76 dB`; strain-gauge bridge `ΔV/V=(GF·ε)/4`; thermocouple Seebeck |
| **Mechatronics design** | motor sizing / ASIL / FMEDA | RMS-torque continuous-rating gate; ISO 26262 ASIL decomposition table; IEC 61508 SIL/PFD |

**Known honest gaps the corpus must respect.** Ziegler-Nichols is a *heuristic* starting
point (~25 % overshoot, manual refinement expected); the 2nd-order phase-margin formula and
the `PM ≈ 100ζ` rule are *approximations* valid only for a dominant-second-order loop;
linearized margins assume a well-conditioned single-loop; motion-profile timing has triangular/
trapezoidal edge cases the generator must branch on; sensor noise figures are
device-dependent. These are *teaching points*, surfaced not hidden.

---

## 1. KNOWLEDGE BREAKDOWN — bachelors → masters → PhD → industry

For each sub-field: the sub-topics, the load-bearing theory/equations, the governing
standards, and the *hard engineering judgment* — the tacit knowledge that separates a
senior engineer from a textbook. Each closes with the judgment that ties it back to a
manufacturable, controllable, instrumented system.

### 1.1 Electrical & Electronics Engineering (the substrate)

**Bachelors.** Circuit laws (Ohm, KCL, KVL); node/mesh analysis; Thévenin/Norton/
superposition/max-power-transfer; R-L-C transient (first-order `τ=RC`, `τ=L/R`; second-order
`ω_n=1/√(LC)`, `ζ=(R/2)√(C/L)`); phasors & AC steady-state (impedance Z=R+jX, resonance
`ω_0=1/√(LC)`, quality factor Q, bandwidth); three-phase (line/phase, Δ/Y, power
`P=√3 V_L I_L cosφ`); semiconductor devices (diode, BJT, MOSFET — operating regions,
small-signal models); op-amps (ideal, inverting/non-inverting gain, integrator,
differentiator, GBW product); power electronics (rectifier, buck/boost duty `V_o/V_i`,
PWM averaging).

**Masters.** Network synthesis & two-port (Z/Y/h/ABCD parameters); filter design
(Butterworth/Chebyshev/Bessel transfer functions, order from attenuation spec); machines
(DC motor `τ=K_t i`, `e=K_e ω`, the universal `K_t=K_e` in SI; induction-motor slip & torque-
speed; PMSM/BLDC); power-system per-unit, symmetrical components (positive/negative/zero
sequence, fault analysis); EMC/skin-depth `δ=√(2/(ωμσ))`; switching-converter modeling
(state-space averaging).

**PhD / research.** Robust/optimal power-electronic control; wide-bandgap (SiC/GaN) device
modeling; motor-drive co-design; grid-forming inverters; mixed-signal/RF design; energy-
harvesting transducers.

**Industry judgment.** Pick the device for the regime (MOSFET for fast/low-voltage switching,
IGBT for high-power); size the motor by *RMS torque* for continuous rating and *peak torque*
for acceleration, never by a single operating point; thermal is the silent killer (junction
temperature, `θ_JA`); a buck converter's inductor must keep current continuous (CCM) at the
minimum load; the senior reflex is the *back-of-envelope power balance* before any sim.

**Standards.** IEEE Std 519 (harmonics), IEEE 1547 (interconnection), IEC 60034 (rotating
machines), IEC 61800 (adjustable-speed drives), NEMA MG-1, IEEE 112 (motor test).

### 1.2 Control Systems — the spine of the cluster

**Bachelors.** Modeling (ODE → transfer function via Laplace; state space `ẋ=Ax+Bu, y=Cx+Du`;
block-diagram algebra, Mason's gain formula); first/second-order response (`τ`, `ω_n`, `ζ`;
rise/peak/settling time, % overshoot `M_p=exp(−πζ/√(1−ζ²))`, steady-state error & system
type); **stability** — **Routh-Hurwitz** array, **root locus** (angle/magnitude conditions,
asymptotes, breakaway, departure angle); **frequency response** — Bode (gain/phase),
**Nyquist criterion** (encirclements `Z=N+P`), **gain & phase margins**; **PID** (P/PI/PD/PID
actions, integral windup, **Ziegler-Nichols** ultimate-gain & reaction-curve tuning).

**Masters.** State-space design — **controllability** (`[B AB … A^{n−1}B]` full rank),
**observability** (`[C; CA; …]` full rank), **pole placement / Ackermann's formula**, **LQR**
(algebraic Riccati `A^T P+PA−PBR^{−1}B^T P+Q=0`, `K=R^{−1}B^T P`), **observers/Kalman filter**
(predict-update, steady-state Kalman = LQE dual of LQR), separation principle, LQG; **digital
control** — z-transform, sampling/aliasing, **Tustin/ZOH/matched** discretization, **Jury**
stability test, deadbeat, dynamic range of sampling; describing functions & limit cycles
(nonlinear); **lead/lag compensation** in frequency domain; system identification (ARX/ARMAX,
least squares, FOPDT step-test fit).

**PhD / research.** Robust control (H∞, μ-synthesis, structured singular value, LMIs); model-
predictive control (MPC, receding horizon, constrained QP); adaptive control (MRAC, self-
tuning, Lyapunov design); nonlinear control (feedback linearization, sliding-mode,
backstepping, passivity, **Lyapunov stability** `V̇<0`); optimal control (Pontryagin maximum
principle, HJB, dynamic programming); networked/distributed control; reinforcement-learning
control.

**Industry judgment.** **Margins are the design currency** — target GM ≥ 6 dB and PM ≥ 45°;
a loop with great nominal performance and 2 dB of margin is a field-failure waiting for a
plant tolerance to move. Z-N is a *first cut*, not a final tune (it gives ~25 % overshoot).
Integral action kills steady-state error but *windups* — clamp it. Discretize at ≥10–20×
the closed-loop bandwidth or the phase lag from the ZOH eats your margin. The senior move:
*the controller exists to meet a spec on the real plant* — verify the loop on the linearized
plant, then on the nonlinear/sampled plant, then with actuator saturation, before trusting it.

**Standards.** ISA-5.1 (instrumentation symbols), ISA-95/88 (control hierarchy/batch);
IEC 61131-3 (PLC languages); the canonical texts (Ogata, Franklin-Powell-Emami-Naeini, Nise,
Dorf-Bishop, Åström-Murray) supply the *worked-example answer keys*.

### 1.3 Robotics — kinematics, dynamics, planning

**Bachelors.** Rigid-body pose (homogeneous transforms, rotation matrices, Euler angles,
axis-angle, quaternions); **Denavit-Hartenberg** convention (standard & modified) → forward
kinematics `T = A_1 A_2 … A_n`; planar/spatial **forward kinematics**; **inverse kinematics**
(closed-form 2R/3R, geometric & algebraic); the **geometric Jacobian** (`v=Jq̇`), **singularities**
(`det J = 0`); workspace (reachable/dexterous).

**Masters.** **IK** — Pieper's closed-form (spherical wrist), numerical (Newton, **damped
least squares / Levenberg-Marquardt** near singularities, pseudo-inverse `J^+`, null-space
projection for redundancy); **dynamics** — **recursive Newton-Euler** (O(n) inverse dynamics),
**Euler-Lagrange** `M(q)q̈+C(q,q̇)q̇+g(q)=τ`, the manipulator inertia matrix, Coriolis/
centrifugal, gravity; **motion control** — computed-torque/inverse-dynamics control, PD+gravity-
comp, impedance/admittance control, force control; **trajectory generation** — cubic/quintic
polynomials, **trapezoidal & S-curve (jerk-limited)** profiles, **quaternion SLERP**; **planning**
— configuration space, **RRT / RRT\* / PRM**, A\*/D\*, potential fields, **GJK/EPA** collision.

**PhD / research.** Whole-body/legged control (centroidal dynamics, ZMP, MPC for locomotion);
manipulation & grasping (form/force closure, contact wrenches); SLAM & state estimation
(EKF/UKF/particle filter, factor graphs); learning-based control (imitation, RL, sim-to-real);
soft & continuum robotics; multi-robot/swarm.

**Industry judgment.** **Check the Jacobian before you trust a Cartesian move** — near a
singularity (`det J → 0`) joint rates blow up; damped least squares trades accuracy for
stability there. The IK solution is *not unique* (elbow-up/down, wrist flips) — pick the one
that stays in joint limits and away from singularities and self-collision. Motion profiles
matter: trapezoidal is fast but its acceleration discontinuity excites structural modes;
**S-curve (finite jerk)** is the production choice for smooth, low-vibration motion. The senior
move: *reflected inertia* (`J_load/N²`) sizes the motor/gearbox, and **inertia matching**
(`J_load/N² ≈ J_motor`) gives the fastest response — a coupled CAD + drivetrain decision.

**Standards.** ISO 8373 (robot vocabulary), ISO 9283 (performance/pose accuracy),
ISO 10218-1/-2 & ISO/TS 15066 (collaborative-robot safety, power/force limiting); RIA R15.06.

### 1.4 Mechatronics System Design — the integration discipline

**Bachelors.** Sensor→signal-conditioning→ADC→controller→DAC→driver→actuator chain;
microcontroller I/O (PWM, timers, encoders/quadrature `4×` decoding, ADC); H-bridge & motor
drivers; embedded real-time basics (sample loop, ISR, jitter).

**Masters.** **Motor sizing** (RMS torque, peak torque, speed, reflected inertia, gearbox
ratio, duty cycle, thermal); mechatronic modeling (electromechanical coupling, the DC-motor
2nd-order plant `θ/V`); **sensor fusion** (complementary & Kalman filters for IMU/encoder);
**functional safety** — **ISO 26262** (ASIL A-D, ASIL decomposition, FMEDA, diagnostic
coverage, hardware metrics SPFM/LFM/PMHF), **IEC 61508** (SIL 1-4, PFD/PFH, HFT, SFF),
FMEA/FTA/HAZOP; bus systems (CAN, EtherCAT, real-time Ethernet).

**PhD / research.** Co-design (mechanism + control + actuator joint optimization); model-based
systems engineering (SysML, digital twin); cyber-physical & hardware-in-the-loop; precision
mechatronics (nanopositioning, piezo, flexures).

**Industry judgment.** The system is only as good as its weakest link in the chain — a great
controller behind a 6-bit ADC or a backlash-ridden gearbox is wasted. Functional safety is
*architectural* — ASIL D can be **decomposed** (e.g. D → B(D)+B(D)) only with sufficient
independence; FMEDA proves the metric, it isn't a checkbox. The senior move: budget the
*error chain* end-to-end (sensor resolution × gain × ADC quantization × control bandwidth)
and the *power/thermal* chain before committing geometry.

**Standards.** ISO 26262 (automotive functional safety), IEC 61508 (general functional
safety), IEC 61800-5-2 (drive safety functions STO/SS1/SLS), MISRA-C (embedded code).

### 1.5 Signals & Systems / DSP

**Bachelors.** CT/DT signals & systems (linearity, time-invariance, causality, BIBO
stability); convolution; **Fourier series & transform** (CTFT), **Laplace**; **sampling
theorem** (Nyquist `f_s>2f_max`, aliasing, anti-alias filter); **z-transform** & DTFT;
**DFT/FFT**; basic digital filters (FIR/IIR, difference equations).

**Masters.** **Filter design** — windowed-sinc & Parks-McClellan FIR, bilinear-transformed
IIR (Butterworth/Chebyshev/elliptic), group delay/linear phase; **spectral analysis** —
windowing (Hann/Hamming/Blackman, scalloping/leakage), periodogram, Welch's method, **STFT/
spectrogram**, zero-padding vs resolution `Δf=f_s/N`; **multirate** (decimation/interpolation,
polyphase, noble identities); **Parseval/Plancherel**, power spectral density; quantization
noise & dither.

**PhD / research.** Adaptive filtering (LMS/RLS, Wiener); wavelets & time-frequency;
compressed sensing; statistical signal processing (estimation/detection, CRLB, matched
filter); array processing/beamforming; ML-DSP.

**Industry judgment.** **Anti-alias before you sample** — once aliased, the signal is
unrecoverable; pick `f_s` ≥ 2.5–5× the highest signal frequency in practice (not the textbook
2×). Spectral resolution `Δf=f_s/N` and leakage drive window choice. FIR for linear phase,
IIR for cheap sharp cutoff at the cost of phase distortion. The senior move: the **noise
floor** (quantization `SNR=6.02N+1.76 dB`, plus jitter and analog noise) sets the usable
dynamic range — match the ADC bits to the sensor, no more.

**Standards.** ITU/IEEE signal-processing conventions; IEEE 1241 (ADC test), IEEE 1057
(digitizer test); the Oppenheim, Proakis-Manolakis, Lyons texts supply the transform-pair
and filter-design answer keys.

### 1.6 Dynamics & Multibody (controls-facing)

**Bachelors.** Newton-Euler for rigid bodies; **mass-spring-damper** `mẍ+cẋ+kx=F` → `ω_n=√(k/m)`,
`ζ=c/(2√(km))`, `ω_d=ω_n√(1−ζ²)`; **free & forced vibration**, resonance, transmissibility,
**logarithmic decrement** `δ=(1/n)ln(x_0/x_n)`; **pendulum** `T=2π√(L/g)`; rotating-shaft
critical speed; **mechanism mobility** (Grübler-Kutzbach).

**Masters.** Lagrangian/Hamiltonian mechanics; **multibody** constrained EOM (Lagrange
multipliers, index-3 DAE — shared with the CAE cluster's MBD); modal analysis of MDOF systems
(eigenproblem `([K]−ω²[M])φ=0`); base excitation, vibration isolation, tuned-mass dampers;
gyroscopics; state-space form of mechanical systems for control.

**PhD / research.** Flexible multibody (floating-frame, ANCF); nonlinear dynamics & chaos;
contact/impact; trajectory optimization; rotor dynamics.

**Industry judgment.** **Know `ω_n` before you control** — a controller whose bandwidth
approaches a structural mode will excite it; keep the loop bandwidth a factor below the first
flexible mode or notch it. Damping ratio sets everything (overshoot, settling). The senior
move: *the plant's mechanical resonance is a hard constraint on achievable control bandwidth*
— stiffen the structure (CAD) or add damping before chasing controller gain.

**Standards.** ISO 10816/20816 (machine vibration), ISO 1940 (balance quality), ISO 7626
(modal/FRF); shared MBD oracles with `simulation-physics.md` §1.3.

### 1.7 Sensors & Instrumentation

**Bachelors.** Sensor taxonomy (resistive/capacitive/inductive/piezo/optical/Hall);
**strain gauges** & Wheatstone bridge (`ΔV/V=(GF·ε)/4` quarter-bridge), load cells;
**thermocouples** (Seebeck, cold-junction comp), RTD (`R=R_0(1+αT)`), thermistor; LVDT;
**accelerometers/gyros/IMU**; encoders (incremental/absolute, resolution); pressure; signal
conditioning (amplification, filtering, isolation).

**Masters.** **ADC/DAC** (resolution `q=FSR/2^N`, quantization `SNR=6.02N+1.76 dB`, SAR vs
ΔΣ, sample-and-hold, aperture jitter); calibration & GUM uncertainty; sensor fusion
(complementary/Kalman); **error analysis** (offset, gain, nonlinearity, hysteresis, drift,
repeatability); bandwidth/response time; MEMS sensors; noise (thermal `√(4kTRΔf)`, shot,
flicker, SNR, NEP).

**PhD / research.** Precision metrology sensors (interferometric, capacitive nm); novel
transducers; smart/self-calibrating sensors; sensor networks; bio/chemical sensing.

**Industry judgment.** **Match the sensor to the measurand chain** — a 0.1 % sensor behind a
poorly-conditioned bridge and an 8-bit ADC delivers 8-bit performance. Quarter-bridge needs
temperature compensation (the dummy gauge) or thermal drift swamps the strain. The senior
move: the **resolution budget** (sensor LSB → conditioning gain → ADC LSB → control deadband)
must close, and the **bandwidth** of the slowest element bounds the loop.

**Standards.** ISO/IEC Guide 98-3 (GUM uncertainty), ASTM E251 (strain-gauge), IEC 60751
(RTD), IEC 60584 (thermocouple), IEEE 1057/1241 (digitizer/ADC), ISO 16063 (accelerometer cal).

---

## 2. DATA SOURCES (premium / authoritative only)

> Streaming discipline: this generator is **fully synthetic + closed-form** (stdlib `math`,
> deterministic by `--seed`), so there is no external download — every number is *computed*
> and *self-checked* against an embedded reference identity. Open-standards text is cited as
> answer-key by clause/example number, never reproduced verbatim.

### 2.1 Canonical textbooks (the answer keys)

| Sub-field | Premium references (worked-example answer keys) |
|---|---|
| **Control** | **Ogata** *Modern Control Engineering* (5th); **Franklin, Powell & Emami-Naeini** *Feedback Control of Dynamic Systems* (8th); **Nise** *Control Systems Engineering* (8th); **Dorf & Bishop** *Modern Control Systems*; **Åström & Murray** *Feedback Systems* (free, rigorous); **Skogestad & Postlethwaite** *Multivariable Feedback Control* (robust); Anderson & Moore *Optimal Control* (LQR/Kalman) |
| **Robotics** | **Craig** *Introduction to Robotics: Mechanics & Control* (DH convention, the standard answer keys); **Spong, Hutchinson & Vidyasagar** *Robot Modeling & Control*; **Siciliano, Sciavicco, Villani, Oriolo** *Robotics: Modelling, Planning & Control*; **Lynch & Park** *Modern Robotics* (free, screw theory); **LaValle** *Planning Algorithms* (RRT/PRM); Murray, Li & Sastry *A Mathematical Introduction to Robotic Manipulation* |
| **Signals/DSP** | **Oppenheim & Willsky** *Signals & Systems*; **Oppenheim & Schafer** *Discrete-Time Signal Processing* (the DSP answer keys); **Proakis & Manolakis** *Digital Signal Processing*; **Lyons** *Understanding DSP*; Haykin *Adaptive Filter Theory* |
| **EE / circuits** | **Sedra & Smith** *Microelectronic Circuits*; **Nilsson & Riedel** *Electric Circuits*; **Irwin & Nelms** *Basic Engineering Circuit Analysis*; **Hayt** *Engineering Circuit Analysis*; **Mohan, Undeland & Robbins** *Power Electronics*; **Krause** *Analysis of Electric Machinery*; **Fitzgerald** *Electric Machinery* |
| **Mechatronics** | **Bolton** *Mechatronics*; **Alciatore & Histand** *Introduction to Mechatronics & Measurement Systems*; **de Silva** *Mechatronics: An Integrated Approach*; **Shetty & Kolk** *Mechatronics System Design* |
| **Dynamics/Vibration** | **Rao** *Mechanical Vibrations*; **Inman** *Engineering Vibration*; **Meirovitch** *Fundamentals of Vibrations*; **Greenwood** *Principles of Dynamics* |
| **Sensors/Instrumentation** | **Doebelin & Manik** *Measurement Systems*; **Fraden** *Handbook of Modern Sensors*; **Webster** *Measurement, Instrumentation & Sensors Handbook*; **Pallás-Areny & Webster** *Sensors & Signal Conditioning* |

### 2.2 Open courseware (structured curriculum spine)

- **MIT OCW**: **6.302/6.310** *Feedback System Design*, **2.004** *Dynamics & Control II*,
  **2.14/2.140** *Analysis & Design of Feedback Control Systems*, **2.12/2.120** *Introduction
  to Robotics*, **6.832** *Underactuated Robotics* (Tedrake), **6.003** *Signals & Systems*,
  **6.341** *Discrete-Time Signal Processing*, **6.002** *Circuits & Electronics*, **6.131**
  *Power Electronics*, **2.017** *Design of Electromechanical Robotic Systems*.
- **Stanford**: **EE263** *Linear Dynamical Systems* (Boyd), **EE102A/B** *Signals & Systems*,
  **CS223A/AA274** *Introduction to Robotics*, **AA203** *Optimal & Learning-Based Control*,
  **ME210** *Mechatronics*, **EE364** *Convex Optimization* (Boyd, for MPC/LMI).
- **CMU Robotics Institute (RI)**: **16-311/16-741** *Robot Kinematics & Dynamics*,
  **16-715** *Advanced Robot Dynamics*, **16-745** *Optimal Control & Reinforcement Learning*,
  **24-677** *Modern Control Theory*.
- **Berkeley** EECS C106A/B (robotics); **Caltech** CDS 110/112 (Åström-Murray); **Georgia
  Tech** robotics specialization; **NPTEL (IIT)** full courses on Control, Robotics, DSP,
  Power Electronics, Mechatronics.

### 2.3 Standards bodies & validation references

- **IEEE** — Std 519 (harmonics), 1547 (DER), 112 (motor test), 1241/1057 (ADC/digitizer
  test), 1812 (motor simulation).
- **ISO** — 8373/9283/10218/TS 15066 (robotics), 26262 (automotive functional safety),
  10816/20816/1940 (vibration/balance), Guide 98-3 GUM (uncertainty), 16063 (accel cal).
- **IEC** — 61508 (functional safety SIL), 61131-3 (PLC), 61800 (drives), 60034 (machines),
  60751/60584 (RTD/thermocouple), 60404 (magnetic materials, skin-depth context).
- **ISA** — 5.1 (instrumentation symbols), 95/88 (control hierarchy/batch).
- **NIST** — fundamental constants (the embedded `g`, `μ_0`, `k_B`, material α/σ values are
  NIST/CODATA-grounded answer-key constants).

### 2.4 Papers / canonical results (the PhD layer + the named known-answers)

- **Kalman 1960** (*A New Approach to Linear Filtering & Prediction*) — the Kalman filter /
  LQE duality; **Kalman 1963** (controllability/observability canonical forms).
- **Riccati / LQR** — Kalman's LQR; the algebraic Riccati equation is the embedded gate.
- **Denavit & Hartenberg 1955** — the DH parameter convention (the FK/IK answer-key tables in
  Craig).
- **Pieper 1968** — closed-form IK for 6-DOF with a spherical wrist.
- **LaValle 1998 / LaValle & Kuffner 2001** — RRT / RRT-Connect; **Kavraki et al. 1996** — PRM.
- **Ziegler & Nichols 1942** — the PID tuning rules (explicitly taught *as a heuristic*).
- **Cooley & Tukey 1965** — the FFT; **Oppenheim & Schafer** transform-pair tables are the
  embedded DSP known-answers.
- **Featherstone 1983** — O(n) articulated-body dynamics; **Luh, Walker & Paul 1980** —
  recursive Newton-Euler (the inverse-dynamics oracle).
  *(Cited as method-provenance + embedded known-answer per `feedback-validate-published-
  references`; tier-1 samples carry the named benchmark target and assert it in-generator.)*

### 2.5 KNOWN-ANSWER VALIDATION ANCHORS (the embedded answer keys)

These are the *specific named published reference values* the generated samples reproduce and
the generator **asserts** before emitting (a mismatch drops the sample):

| Anchor | Closed-form / reference value | Where validated |
|---|---|---|
| **2nd-order overshoot** | `M_p = exp(−πζ/√(1−ζ²))` — e.g. ζ=0.5 → 16.30 %, ζ=0.707 → 4.33 % (Ogata Tab. 5-1; Nise) | `g_control` overshoot, asserted vs identity |
| **2nd-order settling** | `t_s(2%) ≈ 4/(ζω_n)`, `t_s(5%) ≈ 3/(ζω_n)` (Ogata §5-3) | `g_control` settling |
| **Routh-Hurwitz** | sign-changes in 1st column = # RHP poles (Ogata §5-6; Nise §6) | asserted vs companion-matrix eigen-count |
| **LQR scalar Riccati** | `A_R P²−2aP−Q=0`, `K=R^{−1}bP`, closed-loop `a−bK<0` | CARE residual asserted to 1e-6 |
| **Bilinear (Tustin)** | `s=(2/T)(z−1)/(z+1)`; CT-stable ⇒ DT-stable (\|z\|<1) | round-trip mapping asserted |
| **DC-motor 2nd order** | `ω_n=√(K_t K_e/(L_a J)+…)`, time-constant `τ_m=R J/(K_t K_e)` | electrical/mechanical identity |
| **Planar 2R Jacobian** | `det J = L_1 L_2 sin θ_2` (Craig §5; Spong §4) | asserted vs full 2×2 determinant |
| **2R FK↔IK round-trip** | IK angles re-substituted into FK reproduce the commanded (x,y) to 1e-6 | asserted |
| **Pendulum period** | `T = 2π√(L/g)`, g=9.80665 (NIST) | dynamics oracle |
| **MSD natural freq** | `ω_n=√(k/m)`, `ζ=c/(2√(km))`, `M_p` from ζ | asserted vs overshoot identity |
| **Sampling/Nyquist** | `f_s>2f_max`; alias `f_a=\|f − round(f/f_s)·f_s\|` | asserted |
| **DFT resolution** | `Δf = f_s/N` | asserted |
| **ADC SNR** | `SNR_dB = 6.02 N + 1.76` (IEEE 1241; Oppenheim-Schafer quantization) | asserted vs `6.02N+1.76` |
| **RC corner freq** | `f_c = 1/(2πRC)`; `\|H(f_c)\| = 1/√2` (−3.01 dB) | asserted |
| **Skin depth** | `δ = √(2/(ωμσ))` = `1/√(πfμσ)`; Cu @1 MHz ≈ 0.0661 mm (NIST σ) | asserted |
| **Strain bridge** | quarter-bridge `ΔV/V = (GF·ε)/4` | asserted |
| **Quantization step** | `q = FSR/2^N` | asserted |
| **ISO 26262 ASIL decomp** | D→{C+A, B+B}, C→{B+A, …} (ISO 26262-9 Tab.) | table-checked |
| **6-sigma PPM** | shifted 4.5σ one-sided = 3.4 PPM (Motorola/AIAG) | asserted vs erfc |
| **Grübler mobility** | planar `M=3(n−1)−2j₁−j₂` (slider-crank → 1) | asserted |

---

## 3. SYNTHETIC-DATA GENERATION PLAN (`bulk_synth_mechatronics.py`)

> **Programmatic, deterministic, self-validating.** The generator sweeps physically-sensible
> parameter ranges by `seed+index`, computes every number in Python `math`, and **asserts the
> result against an embedded reference identity** before emitting. Chat-JSONL
> `{messages:[system,user,assistant], meta:{field,topic,level,validated}}`. In-memory hash
> dedup on the user text; hard `--cap`. CLI **PRESERVED** exactly:
> `--out --cap --seed --report-every`. All logging to `sys.stderr` (so `--out /dev/stdout`
> stays pure JSONL). Stdlib only.

### 3.1 Sample archetypes (Bloom-tagged, level-tagged)

- **(A) Knowledge / recall (L1-L2)** — governing equation, standard clause, model-selection
  recall, with derivation + the named source. *Tagged `BSc`.*
- **(B) Problem → closed-form solution (L3)** — a fully-specified problem solved end-to-end:
  governing model → substitute → number → **reference cross-check** → engineering verdict.
  *Tagged `BSc`/`MSc`.*
- **(C) Design / selection → critique (L4)** — pick the control law / motor / filter / safety
  decomposition, justify against a criterion (margin, RMS torque, Nyquist, ASIL). *Tagged `MSc`/`industrial`.*
- **(D) Research-depth derivation (L5-L6)** — derive the result from first principles (Riccati
  from the Hamiltonian, Routh from the Hurwitz determinants, the DC-motor 2nd-order plant from
  the coupled electrical+mechanical ODEs), with the rigor of the named graduate course.
  *Tagged `PhD`.*

### 3.2 Per-sub-field generator functions

| Generator | Sub-field | Answer-key equations (modeled-on, cited) | Validation oracle |
|---|---|---|---|
| `g_control` | Control CT/DT | `M_p`, `t_s`, Routh, root-locus, LQR Riccati, Bode margins, Tustin, controllability | CARE residual, companion eigen vs Routh, `M_p` identity, bilinear round-trip |
| `g_signals` | Signals/DSP | Nyquist, alias, `Δf=f_s/N`, DFT pair, Parseval, FIR/IIR, `SNR=6.02N+1.76` | analytic transform pair, `f_s>2f_max`, SNR identity |
| `g_robotics` | Robotics | DH FK, 2R IK, `det J=L₁L₂sinθ₂`, Newton-Euler τ, trapezoid/S-curve, SLERP, RRT\* | FK↔IK round-trip, det-J identity, NE↔Lagrange τ |
| `g_dynamics` | Dynamics/MBD | `ω_n=√(k/m)`, ζ, `ω_d`, pendulum, log-dec, Grübler, modal | overshoot↔ζ, pendulum 2π√(L/g), mobility |
| `g_ee` | EE/circuits | KCL/KVL, `f_c=1/2πRC`, resonance, three-phase power, motor `K_t=K_e`, δ skin | node-solution, `f_c` identity, δ vs NIST σ |
| `g_sensors` | Sensors/instr. | ADC `q,SNR`, strain bridge, thermocouple, RTD, encoder resolution | `q=FSR/2^N`, `SNR=6.02N+1.76`, bridge identity |
| `g_mechatronics` | Mechatronics design | RMS torque, reflected inertia, ISO 26262 ASIL/FMEDA, IEC 61508 SIL/PFD | RMS gate, ASIL-decomp table, SIL/PFD band |
| `g_metrology` `g_ndt` `g_ergonomics` `g_gdt` `g_tolstack` | (retained legacy folds — adjacent quality/inspection) | as `bulk_synth_mechatronics` v1 | as v1 |

### 3.3 GROUNDING (closed-form-verifiable, self-asserting)

1. **Every number is computed, never fabricated** — `import math`, deterministic by seed.
2. **Reference identities are asserted in-process** — the LQR root satisfies the CARE residual
   to 1e-6; the Jacobian determinant equals both the full 2×2 expansion and `L₁L₂sinθ₂`; the
   IK angles re-substituted into FK reproduce the commanded pose; the Routh sign-count equals
   the companion-matrix RHP-eigenvalue count; the overshoot equals `exp(−πζ/√(1−ζ²))`. On
   mismatch the sample is **dropped**, so the corpus cannot carry a wrong label.
3. **Honesty layer** — heuristics (Z-N), approximations (2nd-order PM, `PM≈100ζ`), and
   empirical correlations are *labeled as such* in the assistant text.
4. **NaN/Inf guard** — `fnum` returns `"undefined"` for non-finite; the writer rejects any row
   whose answer contains a non-finite token (inherited from v1).

### 3.4 How this makes Archie better

Archie becomes the **mechatronics/controls engineer in the loop**: write the correct model,
carry the algebra, validate the number against the textbook/standard, read it against a
margin/criterion, and (robotics seam) emit the DH/IK/motion verb the kernel replays. This
feeds curriculum stage **S4-mechatronics** with the acceptance gate that every numeric answer
reproduces its named reference within tolerance and every heuristic is honestly flagged.

---

## 4. EXAMPLE TRAINING SAMPLES (depth illustration)

### Sample 1 — LQR via the scalar algebraic Riccati equation, self-validated (PhD, L5)

```
user:  Scalar LQR: plant ẋ = a·x + b·u with a=1.5, b=0.8; cost weights Q=4, R=1.
       Solve the continuous algebraic Riccati equation and give the optimal gain K and
       the closed-loop pole. (per Ogata, Modern Control; Anderson & Moore, Optimal Control)
assistant:  The infinite-horizon LQR minimizes J=∫(Qx²+Ru²)dt; the optimal control is
       u=−Kx with K=R⁻¹bP, where P>0 solves the CARE 2aP − (b²/R)P² + Q = 0.
       Let A_R=b²/R=0.64. Then A_R·P² − 2a·P − Q = 0 → 0.64P² − 3P − 4 = 0.
       P = (2a+√((2a)²+4A_R·Q))/(2A_R) = (3+√(9+10.24))/1.28 = (3+4.386)/1.28 = 5.770 (>0).
       Check (CARE residual): 2·1.5·5.770 − 0.64·5.770² + 4 = 17.31 − 21.31 + 4 = 0.00 ✓.
       K = R⁻¹bP = 1·0.8·5.770 = 4.616. Closed-loop pole a−bK = 1.5 − 0.8·4.616 = −2.193 < 0
       (stable, as the LQR guarantees). The positive Riccati root is selected (the stabilizing
       solution); the negative root gives an anti-stable pole and is discarded.
```

### Sample 2 — Routh-Hurwitz vs independent eigen-solve (MSc, L3-L4)

```
user:  For the closed-loop characteristic polynomial s³ + 6s² + 11s + 6, determine the number
       of right-half-plane poles by Routh-Hurwitz, and state stability. (per Nise, Ch. 6)
assistant:  Routh array (rows s³,s²,s¹,s⁰):
       s³: 1   11
       s²: 6   6
       s¹: (6·11 − 1·6)/6 = 60/6 = 10
       s⁰: 6
       First column [1, 6, 10, 6] — all positive, zero sign changes → 0 RHP poles → STABLE.
       Cross-check: s³+6s²+11s+6 = (s+1)(s+2)(s+3), roots −1,−2,−3 — all LHP, confirming the
       Routh verdict (zero sign changes ⇔ zero RHP roots, Routh-Hurwitz theorem).
```

### Sample 3 — robotics FK↔IK round-trip, det-J singularity (MSc, L3)

```
user:  A planar 2R arm (L1=0.5 m, L2=0.4 m) must reach (0.6, 0.3) m. Solve the elbow-up
       inverse kinematics, then verify by forward kinematics, and report det J. (per Craig, Ch.4-5)
assistant:  cos θ2 = (x²+y²−L1²−L2²)/(2L1L2) = (0.45−0.25−0.16)/(0.4) = 0.04/0.4 = 0.100;
       θ2 = atan2(+√(1−0.01), 0.100) = atan2(0.995, 0.100) = 84.26° (elbow-up).
       θ1 = atan2(y,x) − atan2(L2 sinθ2, L1+L2 cosθ2) = atan2(0.3,0.6) − atan2(0.398,0.540)
          = 26.57° − 36.39° = −9.82°.
       FK check: x = 0.5cos(−9.82) + 0.4cos(74.44) = 0.4927 + 0.1073 = 0.600 ✓;
                 y = 0.5sin(−9.82) + 0.4sin(74.44) = −0.0853 + 0.3853 = 0.300 ✓ (round-trip to 1e-3).
       det J = L1·L2·sin θ2 = 0.5·0.4·sin(84.26°) = 0.20·0.9950 = 0.199 m² — non-zero, so the
       arm is away from a singularity (det J=0 only at θ2=0° or 180°, the fully extended/folded
       poses where Cartesian motion along the link axis becomes uncontrollable).
```

### Sample 4 — ADC resolution budget, honest noise floor (industrial, L4)

```
user:  A 12-bit SAR ADC has a 5 V full-scale range. Give the LSB size and the ideal SNR, and
       state the usable resolution for a sensor with 1 mV RMS noise. (per IEEE 1241; Oppenheim-Schafer)
assistant:  q = FSR/2^N = 5/2¹² = 5/4096 = 1.221 mV/LSB.
       Ideal quantization SNR = 6.02N + 1.76 = 6.02·12 + 1.76 = 74.0 dB (this is the ceiling,
       no analog noise). But the sensor contributes 1 mV RMS, which is ~0.82 LSB — comparable
       to the quantization noise (q/√12 = 0.353 mV RMS). The *effective* number of bits drops:
       total noise = √(0.353² + 1²) = 1.060 mV RMS → ENOB ≈ N − log2(1.060/0.353) = 12 − 1.59
       = 10.4 bits. Honest verdict: this is a ~10-bit system, not 12 — the sensor noise, not the
       ADC, sets the floor; a quieter front end (or averaging) is the fix before adding ADC bits.
```

---

## 5. CORPUS SCALE & CURRICULUM PLACEMENT

- **Curriculum stage:** **S4-mechatronics** (`generate_corpus_v3.sh` 200 k slice), on the
  S0-math + S1-geometry + S2-physics base. Distribution across the new generators is roughly
  even (control ~22 %, robotics ~16 %, signals ~14 %, EE ~12 %, dynamics ~10 %, sensors ~10 %,
  mechatronics-design ~8 %, retained quality/inspection folds ~8 %).
- **Generation engine:** `bulk_synth_mechatronics.py` — deterministic, self-asserting, stdlib;
  CLI preserved (`--out --cap --seed --report-every`); storage-safe single JSONL + hash dedup
  + hard cap; no `--mask-prompt`; chat-template at train time.
- **Acceptance gate:** every numeric answer reproduces its named reference identity within the
  asserted tolerance (the generator drops mismatches), every heuristic/approximation honestly
  flagged, every robotics verb schema-valid.

> **Bottom line.** This cluster trains Archie to *be the controls/robotics/mechatronics
> engineer*: correct governing model, units-carried algebra, a number validated against
> Ogata / Franklin-Powell / Craig / Oppenheim / IEEE / ISO, read against a real engineering
> margin — every result grounded in a closed-form identity the generator asserts, every
> honest limit surfaced not faked.
```
