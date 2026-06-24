# SOURCE TAXONOMY — CLUSTER: MATHEMATICS · LOGIC · NUMERICAL METHODS · OPTIMIZATION · DEEPEST-REASONING

**Owner:** SCOPE_2026-06-24 / training · **Date:** 2026-06-24 · **Status:** canonical sourcing spec
**Pairs with:** `math-logic-reasoning.md` (the curriculum/generation plan — this doc is its *sourcing + validation-anchor* companion).
**Generator it governs:** `archdisc-Models/scripts/bulk_synth_math.py` (Pillar A / stage **S0 `arch14b-math`**).
**Role:** this is the **research-grade source-of-truth registry** for the S0 math cluster. It names (1) the sub-fields, (2) the Ivy / top-national-research-institute courses, (3) the authoritative texts + reference standards, (4) the key research literature, (5) the BSc→MS→PhD→industry **curriculum ladder** per sub-field, and (6) the **KNOWN-ANSWER VALIDATION ANCHORS** — the *specific published reference values* every generated numeric sample must reproduce. The generator does not redistribute any copyrighted text; it encodes the *numbers and methods* into deterministic, in-process-asserted answer keys with inline citations ("modeled-on", per the IP-hygiene rule).

> **Grounding contract.** A sample is only allowed into the corpus if its final number matches a *closed-form*, a *published constant*, or a *named benchmark* in §6 within a stated tolerance. The generator asserts this **in-process** (`_anchor_check`) for the anchored generators; a draw that fails the assert is *raised and skipped*, never emitted. This is the same analytical-gate discipline as the kernel-grounding loop in `math-logic-reasoning.md` §3.3, lifted into the generator itself.

---

## 1. SUB-FIELDS COVERED (the eight S0 domains → generator families)

| Code | Sub-field | What it underwrites in Forge | Generator family |
|---|---|---|---|
| **A1** | Linear algebra & matrix computation (direct/iterative/eigen/conditioning) | FEA assembly+solve, NURBS fitting, KKT systems, modal | `g_lu_solve … g_fillin`, + new `g_svd_lstsq`, `g_hilbert_cond`, `g_gershgorin`, `g_lanczos_ritz` |
| **A2** | Nonlinear & differential systems (Newton, ODE/DAE, time integration, stability) | nonlinear-static, transient, contact, multibody | `g_newton_* … g_genalpha`, + new `g_logistic_chaos`, `g_dahlquist_test`, `g_cfl_explicit` |
| **A3** | Approximation, interpolation & quadrature (splines/NURBS, Gauss, FFT, LSQ) | geometry exactness, per-element integration, signal/modal post | `g_gauss_legendre … g_fft_bins`, + new `g_chebyshev_runge`, `g_clenshaw_curtis`, `g_romberg` |
| **A4** | Optimization theory & practice (KKT, duality, convexity, SIMP, global) | generative/topology design, tolerance allocation | NEW family `g_kkt_qp`, `g_lp_duality`, `g_lagrange_dual`, `g_rosenbrock_newton`, `g_simp_sens`, `g_pareto_weighted` |
| **A5** | Error estimation, adaptivity & V&V (ZZ, h/p/hp, MMS, Richardson/GCI) | trustworthy analysis, the honesty pillar | `g_zz_estimator … g_verification`, + new `g_mms_source`, `g_vv20_metric` |
| **A6** | Formal logic, proof & constraint reasoning (proof, SAT/CSP, DOF, Π-theorem) | configurators, sketcher well-posedness, spec reading | `g_induction … g_interval`, + new `g_grubler_dof`, `g_euler_characteristic`, `g_putnam_telescope` |
| **A7** | Number theory & discrete reasoning (gcd, modular, combinatorics, recurrences) | hashing/indexing, parametric counting, competition-grade rigor | NEW family `g_euclid_gcd`, `g_modexp_fermat`, `g_crt`, `g_binomial_identity`, `g_catalan`, `g_fib_matrix` |
| **A8** | Analysis, special constants & series (limits, fixed-point, Taylor error, ζ/Γ/π) | convergence-rate theorems, named-constant recall, asymptotics | NEW family `g_banach_fixedpoint`, `g_taylor_remainder`, `g_basel_zeta`, `g_machin_pi`, `g_newton_quadratic_rate` |

A7/A8 are **new** in this upgrade: they push the cluster from "engineering numerics" into **Putnam/IMO-grade discrete + analysis rigor** demanded by the brief, and they are the easiest to *anchor to exact published constants* (ζ(2)=π²/6, Catalan numbers, Fibonacci, machine-ε), giving the corpus a hard validity floor.

---

## 2. NAMED INSTITUTIONS / COURSES (Ivy + top national research institutes)

> Used as **lecture/problem scaffolds and rigor calibration** — the framing and topic coverage are *modeled on* these named curricula; no course text is reproduced.

### Linear algebra & numerical linear algebra (A1)
- **MIT** 18.06 *Linear Algebra* (Strang); 18.065 *Matrix Methods in Data Analysis*; **18.335** *Introduction to Numerical Methods* (graduate, Johnson); 18.085/18.086 *Computational Science & Engineering* (Strang — the FEA/numerics bridge).
- **Stanford** CME 302 *Numerical Linear Algebra*; CME 335 *Advanced topics*; EE263 *Linear Dynamical Systems*.
- **Princeton** MAT 322 / APC 523 *Numerical Algorithms for Scientific Computing*.
- **Caltech** ACM 106 *Intro to Numerical Analysis*; ACM 104 *Linear Algebra & Applications*.
- **Cornell** CS 4220/6210 *Numerical Analysis: Linear & Nonlinear Problems*.

### Nonlinear, ODE/PDE, scientific computing (A2, A5)
- **MIT** 18.336 *Numerical Methods for PDEs*; 16.90 *Computational Methods in Aerospace Engineering*; 2.094/2.092 *Finite Element Analysis of Solids & Fluids* (Bathe).
- **Stanford** CME 306 *Numerical Solution of PDEs*; CS 205 / ME 469 *Computational methods in fluid dynamics*.
- **Caltech** ACM 106b/116; **Princeton** APC 523.
- **Brown** APMA 1180/2550 (scientific computing — Trefethen lineage via Gottlieb/Hesthaven).

### Optimization (A4)
- **Stanford EE364a/EE364b** *Convex Optimization I & II* (Boyd — the global gold standard); MS&E 211/311.
- **MIT** 6.255J/15.093 *Optimization Methods*; 6.7220/18.S096 *Nonlinear Optimization*; 15.084 *Nonlinear Programming*.
- **Cornell** ORIE 6300 *Mathematical Programming*; **Princeton** ORF 363 *Computing & Optimization*; **CMU** 10-725 / 15-859 *Convex Optimization*.

### Logic, proof, theory of computation, discrete math (A6, A7)
- **MIT** 6.042J *Mathematics for Computer Science* (proof/induction/number-theory/combinatorics); 18.404/6.840 *Theory of Computation*; 6.5151/6.046 *Design & Analysis of Algorithms*.
- **Princeton** COS 340 *Reasoning About Computation*; MAT 215 *Honors Analysis* (proof rigor).
- **Harvard** CS121 *Theory of Computation*; Math 55 (proof/algebra/analysis — the rigor ceiling).
- **Stanford** CS103 *Mathematical Foundations of Computing*; CS157 *Logic & Automated Reasoning*.

### Real/numerical analysis, special functions (A8)
- **MIT** 18.100A/B *Real Analysis*; 18.330 *Introduction to Numerical Analysis*.
- **Princeton** MAT 215/300 *Analysis*; **Caltech** Ma 108 *Classical Analysis*.
- **Harvard** Math 112/55 *Real Analysis*.
- **NIST** *Digital Library of Mathematical Functions (DLMF)* — the canonical special-function/quadrature reference (a national-research-institute "course-equivalent").

### Competition rigor (cross-cutting, A6/A7/A8)
- **Putnam** (MAA) and **IMO** problem corpora — the calibration target for "deepest reasoning": telescoping, generating functions, extremal/invariant arguments, induction, modular arithmetic. The generator models problem *style and rigor*, computing exact answers (e.g. closed-form telescoping sums) it then asserts.

---

## 3. AUTHORITATIVE TEXTS + REFERENCE STANDARDS (the answer-key canon)

### 3.1 Texts (cited inline in the answers as "(per <Author>, <topic>)")
| Sub-field | Canonical texts |
|---|---|
| **A1** | Golub & Van Loan *Matrix Computations* (4e); **Trefethen & Bau *Numerical Linear Algebra*** (the SVD/conditioning/QR canon); Saad *Iterative Methods for Sparse Linear Systems* (Krylov/precond); Demmel *Applied Numerical Linear Algebra*; **Higham *Accuracy & Stability of Numerical Algorithms*** (FP error analysis); Horn & Johnson *Matrix Analysis* (Gershgorin). |
| **A2** | Hairer/Nørsett/Wanner *Solving ODEs I* & *II (stiff/DAE)*; Ascher & Petzold *ODEs & DAEs*; **Butcher *Numerical Methods for ODEs*** (RK/stability); LeVeque *Finite Difference Methods*; Strogatz *Nonlinear Dynamics & Chaos* (logistic map / Feigenbaum). |
| **A3** | **Trefethen *Spectral Methods in MATLAB / Approximation Theory & Practice*** (Chebyshev, Clenshaw–Curtis, Runge); Piegl & Tiller *The NURBS Book* (Cox–de Boor, knot insertion); Davis & Rabinowitz *Methods of Numerical Integration*; Oppenheim & Schafer *Discrete-Time Signal Processing* (DFT/FFT). |
| **A4** | **Boyd & Vandenberghe *Convex Optimization*** (free PDF — KKT/duality/convexity); **Nocedal & Wright *Numerical Optimization*** (Newton/SQP/IP, the Rosenbrock test); Bertsekas *Nonlinear Programming*; Bendsøe & Sigmund *Topology Optimization* (SIMP); Boyd *LP duality*. |
| **A5** | Hughes *The Finite Element Method*; Bathe *Finite Element Procedures*; Zienkiewicz, Taylor & Zhu *FEM* (ZZ estimator); Roache *Verification & Validation in Computational Science*; Oberkampf & Roy *Verification & Validation in Scientific Computing*. |
| **A6** | Huth & Ryan *Logic in Computer Science*; Bradley & Manna *The Calculus of Computation* (SAT/SMT); Lehman/Leighton/Meyer *Mathematics for CS* (MIT 6.042 text — induction/number-theory); Barber *Topology* / any combinatorial-topology text (Euler characteristic). |
| **A7** | **Hardy & Wright *An Introduction to the Theory of Numbers*** (gcd, modular, Fermat); Niven/Zuckerman/Montgomery; Graham, Knuth & Patashnik *Concrete Mathematics* (recurrences, binomial identities, Catalan); Rosen *Discrete Mathematics*. |
| **A8** | **Rudin *Principles of Mathematical Analysis*** (limits, fixed points, series — the rigor canon); Apostol *Mathematical Analysis*; Abramowitz & Stegun / **NIST DLMF** (ζ, Γ, special constants); Whittaker & Watson *Modern Analysis*. |
| **Engineering bounding** | Roark's *Formulas for Stress & Strain*; Shigley's *Mechanical Engineering Design*; Timoshenko *Theory of Elasticity* — the closed-form brackets the deep-reasoning samples must agree with. |

### 3.2 Reference standards (the answer-key authorities)
- **NIST** — DLMF (special-function values), the *e-Handbook of Statistical Methods (NIST/SEMATECH)*, **NIST StRD** (Statistical Reference Datasets — certified least-squares / linear-regression answers), and IEEE-754 machine-ε constants.
- **IEEE 754-2019** — floating-point: machine epsilon (binary64 = 2⁻⁵² ≈ 2.220446e-16), unit roundoff, catastrophic cancellation model.
- **ASME V&V 10** (computational solid mechanics V&V) and **V&V 20** (CFD/heat-transfer V&V) — the verification methodology + the validation-uncertainty metric of A5.
- **NAFEMS** benchmark challenge problems — the de-facto FEA known-answer set.
- **Ghia, Ghia & Shin (1982)** lid-driven-cavity centerline velocities — the canonical CFD verification dataset (kept as the cross-cluster physics anchor; A5 samples cite it as the V&V exemplar).
- **ISO/IEC 80000** (quantities & units — the dimensional-analysis type system); **JCGM 100 (GUM)** (measurement-uncertainty backbone for tolerance/RSS).

---

## 4. KEY RESEARCH LITERATURE (graduate frontier)

- **Numerical LA / Krylov:** Hestenes & Stiefel (1952, CG); Saad & Schultz (1986, GMRES); van der Vorst (1992, BiCGStab); Paige & Saunders (1975, MINRES); Lanczos (1950).
- **Conditioning / FP:** Wilkinson (backward error analysis); Shewchuk (1997, *Adaptive Precision FP Arithmetic & Fast Robust Geometric Predicates*); Kahan summation.
- **Time integration:** Newmark (1959); **Hilber–Hughes–Taylor (1977, HHT-α)**; **Chung & Hulbert (1993, generalized-α)**; Dahlquist (1963, *A special stability problem for LMMs* — the second barrier & A-stability).
- **Optimization:** Karush (1939) / Kuhn & Tucker (1951, KKT); Wolfe (1969, line-search conditions); Byrd–Nocedal–Schnabel (trust region); **Bendsøe & Sigmund** SIMP; **Sigmund (2001) 99-line** & Andreassen et al. (2011) 88-line topology-opt; Svanberg (1987, MMA).
- **V&V:** Roache (1994/1998, GCI); Richardson (1911, extrapolation); ASME V&V 10/20 committee reports; Oberkampf & Roy (2010).
- **CFD verification:** **Ghia, Ghia & Shin (1982)**, *High-Re solutions for incompressible flow using the Navier–Stokes equations and a multigrid method*, J. Comput. Phys. 48:387.
- **Discrete / analysis classics:** Euclid (gcd); Fermat (little theorem); Euler (ζ(2)=π²/6, the Basel problem); Machin (1706, arctan series for π); Banach (1922, fixed-point theorem); Catalan / Segner recurrence.
- **CAD-ML training strategy (how the corpus is *used*):** the SFT→GRPO/geometry-truth-reward synthesis in `../../SCOPE_2026-06-21/research/parametric_cad_literature_2026.md`.

---

## 5. CURRICULUM LADDER (bachelors → MS → PhD → industry) PER SUB-FIELD

Each generated sample is **tagged** `level ∈ {BSc, MSc, PhD, industrial}` in `meta.level`, drawn so the four levels are represented across the corpus. The ladder below defines what each level *means per sub-field* (so the tagging is principled, not random):

| Sub-field | **BSc** | **MSc** | **PhD** | **Industrial** |
|---|---|---|---|---|
| **A1 Linear algebra** | LU/Cholesky/QR by hand; norms; det/eig of 2×2 | SVD/least-squares, κ(A), Krylov bounds, Gershgorin | Lanczos/Arnoldi convergence, backward-error analysis, AMG theory | "pick the solver+precond for this sparse SPD/indefinite system at scale" |
| **A2 Nonlinear/ODE** | Newton scalar, one RK4 step | Newton systems, stiffness, A-stability, Dahlquist barrier | HHT-α/gen-α amplification spectra, DAE-index reduction, chaos onset | "explicit blew up at Δt=1e-4 — diagnose CFL, switch integrator" |
| **A3 Quad/interp** | Simpson, Gauss-2/3, Lagrange | Chebyshev/Runge, Clenshaw–Curtis, Romberg, NURBS eval | spectral-accuracy proofs, knot-insertion refinement theory | "which Gauss order for this integrand; min-zone vs LSQ datum fit" |
| **A4 Optimization** | gradient descent, 1-D line min, LP by simplex | KKT/duality, convexity test, Newton on Rosenbrock | SQP/interior-point convergence, SIMP adjoint sensitivity, Pareto theory | "this SIMP result checkerboards — fix the filter; allocate the tolerance" |
| **A5 V&V** | error vs residual, Simpson error order | ZZ estimate, h/p/hp choice, Richardson order | GCI/observed-order theory, DWR goal-oriented, locking variational crimes | "report the GCI error bar; refuse the unverified turbulent number" |
| **A6 Logic/proof** | induction, contradiction, truth tables | SAT/CSP, DOF (Grübler), Buckingham-π | DM-decomposition genericity, generic-rigidity, completeness/soundness | "this sketch is over-constrained — name the redundant constraint" |
| **A7 Number theory/discrete** | gcd, modular arithmetic, binomial | CRT, Fermat/Euler, generating functions | analytic number-theory asymptotics, recurrence closed forms | "hash-distribution / counting / indexing correctness" |
| **A8 Analysis/series** | limits, Taylor of low order | Banach fixed-point rate, Taylor remainder bound | convergence-rate theorems (quadratic Newton, linear FP), ζ/Γ asymptotics | "is this iteration converging at the claimed rate — verify" |

---

## 6. KNOWN-ANSWER VALIDATION ANCHORS (the hard validity floor)

> These are the **specific named published reference values** the generator computes and **asserts in-process**. Each anchored generator carries an `_anchor_check(...)` (or an explicit closed-form recomputation) so a wrong draw is *raised and skipped*, never written. "Validated vs" names the published source; the generator cites it inline in the answer.

### 6.1 Exact mathematical constants & closed forms (asserted to machine tolerance)
| Anchor | Reference value | Source | Generator |
|---|---|---|---|
| **Basel problem** Σ 1/n² → π²/6 | 1.6449340668… | Euler; NIST DLMF 25.6 | `g_basel_zeta` (partial-sum error bounded by 1/N) |
| **ζ(4)** = π⁴/90 | 1.0823232337… | DLMF 25.6 | `g_basel_zeta` |
| **Machin π** π/4 = 4·arctan(1/5) − arctan(1/239) | π = 3.14159265358979… | Machin 1706; DLMF | `g_machin_pi` (asserts |est − math.pi| < tol) |
| **e** via Σ1/k! | 2.718281828459045 | DLMF | `g_taylor_remainder` |
| **Catalan numbers** Cₙ = C(2n,n)/(n+1) | C₀..C₁₀ = 1,1,2,5,14,42,132,429,1430,4862,16796 | OEIS A000108; Concrete Math | `g_catalan` (asserts table) |
| **Fibonacci** via fast-doubling / matrix power | F₁₀=55, F₂₀=6765, F₃₀=832040 | OEIS A000045 | `g_fib_matrix` (asserts vs iterative) |
| **golden ratio** φ = (1+√5)/2 | 1.6180339887… | — | `g_fib_matrix` (Fₙ₊₁/Fₙ→φ) |
| **Binomial / Vandermonde / hockey-stick identities** | exact integer equalities | Concrete Math | `g_binomial_identity` (asserts identity holds) |

### 6.2 Number-theory anchors (exact integer assertions)
| Anchor | Check | Source | Generator |
|---|---|---|---|
| **Euclid gcd** | gcd(a,b)·lcm(a,b) = a·b; Bézout `ax+by=g` | Euclid; Hardy & Wright | `g_euclid_gcd` (asserts identity + Bézout) |
| **Fermat's little theorem** | a^(p−1) ≡ 1 (mod p) for prime p∤a | Fermat | `g_modexp_fermat` (asserts congruence) |
| **Chinese Remainder Theorem** | unique x mod ∏mᵢ reproduces each residue | Sun-tzu / CRT | `g_crt` (asserts x ≡ rᵢ mod mᵢ) |

### 6.3 Numerical-analysis convergence-rate theorems (asserted empirically)
| Anchor | Theorem / value | Source | Generator |
|---|---|---|---|
| **Newton quadratic convergence** | e_{k+1} ≈ (f″/2f′)·e_k² ; error roughly squares | Nocedal & Wright; Rudin | `g_newton_quadratic_rate` (asserts log-ratio ≈ 2) |
| **Banach fixed-point linear rate** | |x_{k+1}−x*| ≤ L·|x_k−x*|, L=|g′(x*)|<1 | Banach 1922; Rudin | `g_banach_fixedpoint` (asserts geometric decay at L) |
| **Taylor remainder** | |R_n| ≤ M·|x−a|^{n+1}/(n+1)! | Rudin | `g_taylor_remainder` (asserts true error ≤ bound) |
| **Gauss–Legendre exactness** | n-pt exact for deg ≤ 2n−1 | Davis & Rabinowitz | `g_gauss_legendre` (asserts error≈0 on cubic) |
| **Composite Simpson order** | error = O(h⁴), −(b−a)h⁴f⁗(ξ)/180 | Davis & Rabinowitz | `g_simpson` (reports/bounds error) |
| **Romberg / Richardson** | T(h) extrapolation kills the leading O(h²) term | Trefethen | `g_romberg` (asserts extrapolated < trapezoid error) |
| **Clenshaw–Curtis / Chebyshev** | Runge cured by Chebyshev nodes; spectral decay | Trefethen *ATAP* | `g_chebyshev_runge` (asserts Chebyshev max-err < equispaced) |
| **CG convergence bound** | k ≈ ½√κ·ln(2/tol) | Hestenes–Stiefel; Trefethen | `g_cg_iters` (closed form) |
| **Newmark/HHT/gen-α amplification** | |R|=1 for trapezoidal undamped; ρ∞ control | Newmark; HHT; Chung–Hulbert | `g_stability`, `g_genalpha` (computed factors) |
| **Dahlquist second barrier** | no A-stable explicit LMM; A-stable LMM order ≤ 2 | Dahlquist 1963 | `g_dahlquist_test` (states + tests trapezoid |R|≤1) |

### 6.4 Linear-algebra / conditioning anchors
| Anchor | Reference value | Source | Generator |
|---|---|---|---|
| **Hilbert-matrix condition number** | κ₂(H₂)≈19.28, κ₂(H₃)≈524.06, κ₂(H₄)≈1.55e4, κ₂(H₅)≈4.77e5 | Higham; Todd | `g_hilbert_cond` (asserts against published table) |
| **Gershgorin disc theorem** | every eigenvalue lies in ∪ discs; bounds spectrum | Horn & Johnson; Gershgorin 1931 | `g_gershgorin` (asserts true 2×2 eigs inside the union) |
| **SVD least-squares = normal-eqn solution** | x = V Σ⁺ Uᵀ b matches normal-eqn x | Trefethen & Bau | `g_svd_lstsq` (asserts the two agree) |
| **machine epsilon (binary64)** | ε = 2⁻⁵² ≈ 2.220446049250313e-16 | IEEE 754-2019 | used in `g_taylor_remainder` cancellation note |
| **Lanczos/Ritz bound** | Ritz values bracket extreme eigenvalues | Saad; Paige | `g_lanczos_ritz` (asserts Ritz ∈ [λmin,λmax]) |

### 6.5 Optimization anchors (closed-form optima)
| Anchor | Reference value | Source | Generator |
|---|---|---|---|
| **Rosenbrock minimum** | x* = (1,1), f* = 0 | Rosenbrock 1960; Nocedal & Wright | `g_rosenbrock_newton` (asserts Newton step reduces f toward 0) |
| **Equality-QP KKT solution** | x* = solve of [[H,Aᵀ],[A,0]]{x;λ}={−c;b} | Boyd & Vandenberghe | `g_kkt_qp` (asserts KKT residual ≈ 0) |
| **LP weak/strong duality** | primal opt = dual opt; cᵀx* = bᵀy* | Boyd; Bertsekas | `g_lp_duality` (asserts the two objectives equal) |
| **Lagrangian dual of equality-QP** | dual = −½ gᵀH⁻¹g + … ; stationarity ∇L=0 | Boyd & Vandenberghe | `g_lagrange_dual` (asserts ∇L=0 at solution) |
| **SIMP sensitivity** | ∂c/∂ρ = −p·ρ^{p−1}·uᵀk₀u (self-adjoint compliance) | Bendsøe & Sigmund; Sigmund 99-line | `g_simp_sens` (asserts sign/formula) |

### 6.6 V&V / geometry anchors
| Anchor | Reference | Source | Generator |
|---|---|---|---|
| **MMS source term** | S = L(u*) reproduces a chosen analytic u* exactly | Roache; Oberkampf & Roy | `g_mms_source` (asserts substituting u* gives S) |
| **Roache GCI** | GCI = Fs·|ε|/(rᵖ−1), Fs=1.25 (≥3 grids) | Roache 1994; ASME V&V 20 | `g_verification` (closed form) |
| **Richardson observed order** | p = ln[(f1−f2)/(f2−f3)]/ln r | Richardson; ASME V&V | `g_verification` |
| **Euler characteristic** | V−E+F = 2 for a simple polyhedron (sphere genus 0) | Euler; Poincaré | `g_euler_characteristic` (asserts on Platonic solids) |
| **Grübler/Kutzbach DOF** | M = 3(n−1) − 2j₁ − j₂ (planar); 4-bar = 1 DOF | Norton *Design of Machinery* | `g_grubler_dof` (asserts known mechanism DOFs) |
| **Ghia lid-driven cavity** | u-centerline at Re=100 published table (cross-cluster) | Ghia, Ghia & Shin 1982 | cited as the V&V exemplar in A5 answers |

---

## 7. HOW THE GENERATOR ENFORCES THIS (implementation contract)

1. **Inline citation.** Every answer names its source/standard, modeled-on not verbatim: `"(per Trefethen & Bau, NLA)"`, `"(Euler, Basel problem; NIST DLMF 25.6)"`, `"(Roache GCI; ASME V&V 20)"`, `"(Higham, condition number table)"`.
2. **In-process assertion.** Anchored generators call `_anchor_check(name, computed, reference, tol)` (relative or absolute), which `raise`s on mismatch; `main()` already catches `(ValueError, ZeroDivisionError, OverflowError)` and skips — so a bad draw can never enter the corpus.
3. **Level tagging.** Each generator returns a `level` (or `main()` draws one weighted by the per-sub-field ladder of §5) and writes it to `meta.level`.
4. **Deepened reasoning.** Anchored answers state the *theorem name*, the *closed form*, the *substitution*, the *numeric*, and the *validation line* ("matches the published value to <tol>"), pushing each trace to PhD/research rigor.
5. **Determinism & hygiene preserved.** Same `--seed/--cap` ⇒ identical output; stdlib-only; in-memory hash dedup on the user text; all logging → `stderr`; the `--out/--cap/--seed/--report-every` CLI is untouched so `generate_corpus_v3.sh` keeps working.

---

## 8. SUMMARY (for the S0 sourcing row)

- **Cluster:** Pillar A / S0 — math · logic · numerical methods · optimization · deepest-reasoning; eight sub-fields A1–A8 (A7 number-theory/discrete and A8 analysis/series are new, adding Putnam/IMO-grade rigor + hard exact-constant anchors).
- **Institutions:** MIT (18.06/18.335/18.085/6.042/18.100), Stanford (EE364a/b, CME 302/306), Princeton (APC 523, MAT 215), Caltech (ACM 106), Cornell (CS 4220), Harvard (Math 55, CS121), CMU (10-725), plus Putnam/IMO rigor and NIST DLMF.
- **Texts/standards:** Trefethen & Bau, Golub & Van Loan, Higham, Saad; Nocedal & Wright, Boyd & Vandenberghe; Hairer-Wanner, Butcher; Rudin, Apostol; Hardy & Wright, Concrete Mathematics; NIST DLMF/StRD, IEEE-754, ASME V&V 10/20, NAFEMS, ISO-80000, GUM.
- **Validation anchors:** ζ(2)=π²/6 & ζ(4)=π⁴/90, Machin-π, e, Catalan/Fibonacci/φ, binomial identities (exact); Euclid/Fermat/CRT (exact integer); Hilbert-matrix κ table, Gershgorin, SVD=normal-eqn, machine-ε (IEEE-754); Newton-quadratic & Banach-linear & Taylor-remainder & Gauss-exactness & Romberg & Chebyshev rate theorems; Rosenbrock x*=(1,1), KKT/LP duality, SIMP adjoint; Roache GCI / Richardson order / MMS / Euler χ / Grübler DOF / Ghia cavity.
- **Enforcement:** inline citation + in-process `_anchor_check` assert (bad draws raised & skipped) + four-level tagging + deepened theorem→closed-form→numeric→validation traces; CLI/schema/dedup/determinism preserved.
