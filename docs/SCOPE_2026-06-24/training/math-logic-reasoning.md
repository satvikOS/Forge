# TRAINING CURRICULUM — CLUSTER: APPLIED MATHEMATICS, LOGIC & ULTRA-DEEP REASONING

**Owner:** SCOPE_2026-06-24 / training · **Date:** 2026-06-24 · **Status:** canonical curriculum spec
**Cluster role:** Pillar A of the Archie 14B corpus program (`archie_corpus_program.md` §2-A) — the **reasoning spine** under every physics, geometry, manufacturing and lifecycle dimension. This is stage **S0 `arch14b-math`**, trained FIRST because every downstream pillar rests on it.
**Companions:** `../../SCOPE_2026-06-21/programs/archie_corpus_program.md` (master plan), `../kernel/sim-grounding.md` + `../kernel/predicates-geom.md` (the kernel facts these samples must agree with), `../kernel/sketcher-constraints.md` (the constraint-solver math), `../../SCOPE_2026-06-21/research/parametric_cad_literature_2026.md` (SFT→GRPO training strategy).

> **THESIS.** A pure-CAD engineering model is not a chatbot that happens to know calculus; it is a **numerical-reasoning engine** whose every CAD/CAM/CAE decision bottoms out in linear algebra, optimization, ODE/PDE discretization, error control, and formal logic. Train Archie so that when it is asked to *make a manufacturable part* it reasons the way a senior analyst does — picks the right solver, justifies the discretization, bounds the error, proves the constraint system is well-posed, and only then emits a kernel-replayable `forge.<wb>.<op>(args)` call. NO general-knowledge ballast: only mathematics, logic, deepest multi-step reasoning, proof, numerical methods, and optimization — the minimal-but-complete cognitive substrate of a practising mechanical/structural/manufacturing engineer.

> **NORTH-STAR for this cluster (S0 acceptance).** Analytical-gate Q/A ≥ **0.90** (every numeric answer matches a closed-form / benchmark truth within stated tolerance); reasoning traces coherent and non-degenerate; **no NaN** in the adapter; and — the load-bearing test — when a Pillar-B/C physics or geometry sample needs a solver choice, the math adapter's reasoning makes that choice **correct and justified** rather than guessed. S0 is the foundation under the ≥0.85-every-axis CADGenBench gate; if S0 is weak, no later stage recovers.

> **HARDWARE / DISCIPLINE.** Mac Studio M4 Max, 36 GB. 4-bit qLoRA, sequence-budgeted. **Storage-safe streaming throughout: download→process→delete, parquet `iter_batches`, accumulator-dedup** (memory rule, nearly killed M4 Max storage once). **Programmatic bulk_synth, never agent hand-authoring** (agents top out at 40-60 samples; generators do 3.5-13k/run). **Never `--mask-prompt` on long reasoning corpora** (all-masked → NaN → silent adapter corruption); NaN-guard + early loss-verify every run. Every sample carries the chat template Archie was trained on.

---

## 0. WHY THIS CLUSTER IS REQUIREMENT-ZERO (the engineering argument)

Every failure mode the kernel docs report is, at root, a **math/reasoning** failure the model must learn to avoid or repair:

| Downstream symptom (from the kernel audits) | Underlying math the model must own |
|---|---|
| Boolean fragility — empty geometry after ~30 subtractions (`predicates-geom.md`) | floating-point error analysis; **exact predicates** (Shewchuk adaptive precision, static error-bound filters, expansion arithmetic); robustness vs speed trade |
| Sketch over/under-constrained, won't solve (`sketcher-constraints.md`) | **DOF counting** (Grübler/Witkin), Jacobian rank / null-space, Newton on the constraint residual, witness-configuration genericity, **DM-decomposition** of the constraint graph |
| FEA shear/volumetric locking; spurious modes (`sim-grounding.md` Q6) | variational consistency, **patch test**, incompatible-mode/B-bar/EAS, generalized eigenproblem conditioning, mass-matrix SPD-ness |
| Snap-through / post-buckling unreachable — "no arc-length/Riks" (`sim-grounding.md` S-E1) | **continuation methods**, arc-length constraint, turning-point detection, bifurcation theory |
| Stiff transients diverge; wrong time integrator picked | A-/L-stability, spectral radius, **Newmark/HHT-α/generalized-α** amplification-matrix analysis, stiffness ratio |
| Solver too slow / fails to converge at scale — "no AMG, no domain decomposition" (`sim-grounding.md` S-H1) | Krylov theory (CG/MINRES/GMRES/BiCGStab), **preconditioning** (Jacobi/ILU/AMG), condition number κ, convergence-rate bounds |
| Over-/under-refined mesh; trusted a wrong field | **a-posteriori error estimation** (ZZ/residual), **h/p/hp adaptivity**, Richardson extrapolation / GCI, MMS verification |
| Optimizer returns an un-manufacturable or non-optimal design | KKT conditions, convexity, Lagrangian duality, **SIMP** sensitivity/adjoint, trust-region/SQP/interior-point, constraint qualification |
| Tolerance stack-up wrong → parts don't assemble | worst-case vs **RSS (√n)** vs Monte-Carlo, statistical convolution, Cp/Cpk, propagation of variance |

**Conclusion:** these are not "nice to have" academics — they are the exact decision points where a CAD model produces a part that **does not build, does not solve, or does not assemble**. The cluster teaches Archie to make each decision correctly and to *show the reasoning*, because the reasoning is what generalizes to unseen parts.

---

## 1. KNOWLEDGE BREAKDOWN (bachelors → masters → PhD → industry)

Organized as **eight knowledge domains (A1–A8)**, each tagged with the level, the key theory/equations, the named standards where they exist, and — crucially — the **engineering judgment** (the senior-engineer "when/why", not just the "what"). The eight map 1:1 to the eight bulk_synth generators in §3.

### A1 — Linear Algebra & Matrix Computation  *(bachelors → PhD)*
The substrate under FEA assembly/solve, NURBS fitting, registration, optimization KKT systems.
- **Direct factorizations:** LU (partial/complete pivoting, growth factor), **Cholesky** `A=LLᵀ` (SPD; the FEA static path, `Fea.cpp` `la::LLT`/`la::SparseLDLT`), **LDLᵀ** for symmetric-indefinite (saddle-point/KKT, the multibody `[M Φqᵀ; Φq 0]` system), **QR** (Householder/Givens/Gram-Schmidt — modified vs classical stability), **SVD** `A=UΣVᵀ` (rank, pseudo-inverse, least-squares, PCA, the **damped-least-squares** IK).
- **Eigenproblems:** symmetric QR, **Lanczos** (modal, sparse SPD), **Arnoldi** (nonsymmetric), generalized `Ax=λBx` (modal FEA — `solveModal`'s Cholesky-of-B reduction), **shift-invert** for interior eigenvalues, spurious/rigid-body mode handling.
- **Sparse direct:** multifrontal/supernodal; **fill-reducing orderings** (AMD, METIS nested-dissection); symbolic vs numeric factorization; out-of-core.
- **Iterative (Krylov):** **CG** (SPD), **MINRES** (symmetric indefinite), **GMRES**(m) (nonsymmetric, restart trade), **BiCGStab**; convergence as a function of κ and eigenvalue clustering; the `√κ` CG bound.
- **Preconditioning:** Jacobi, block-Jacobi, **ILU(0)/ILU(p)**, **algebraic multigrid (AMG)** (the named kernel gap, `sim-grounding.md` S-H1), domain decomposition (additive/multiplicative Schwarz), FETI/BDDC.
- **Conditioning & error:** **condition number κ(A)=‖A‖‖A⁻¹‖**, backward error, residual vs error, iterative refinement, the `‖δx‖/‖x‖ ≤ κ·‖δb‖/‖b‖` bound.
- **Judgment:** SPD → Cholesky/CG; symmetric-indefinite saddle point → LDLᵀ or MINRES + block preconditioner (NEVER plain CG); dense-small → direct, sparse-large → iterative + AMG; ill-conditioned least-squares → SVD/QR not normal-equations (κ squares). *When the matrix is the FEA stiffness with a near-mechanism, expect κ→∞ and read it as a constraint/DOF bug, not a solver bug.*

### A2 — Numerical Solution of Nonlinear & Differential Systems  *(bachelors → PhD)*
The engine of every nonlinear-static, transient, contact, and multibody analysis.
- **Root-finding / nonlinear systems:** Newton-Raphson (quadratic convergence, the Jacobian/tangent `K_T`), modified/quasi-Newton (BFGS, Broyden), **line search** (Armijo/Wolfe), **trust-region** (dogleg, Levenberg-Marquardt), **continuation / arc-length (Riks/Crisfield)** for limit points & snap-through (kernel gap S-E1), turning-point & bifurcation detection.
- **ODE IVPs:** explicit **RK45 (Dormand-Prince)** with embedded error control & adaptive stepping; stiff → implicit **BDF**(Gear), Radau, Rosenbrock; **stability** (A-stability, L-stability, stiff-decay), stiffness ratio, the absolute-stability region.
- **Structural-dynamics time integration:** **Newmark-β** (β=¼ γ=½ = average-acceleration, unconditionally stable — the kernel's `solveDynamic`), **HHT-α / generalized-α** (controllable numerical damping of spurious high modes — the kernel's multibody DAE solver), central-difference explicit (conditionally stable, the CFL/`Δt ≤ 2/ω_max` limit), spectral-radius/amplification-matrix analysis, period elongation & amplitude decay.
- **DAEs:** index-1/2/3, the **index-3 constrained-multibody form** `[M Φqᵀ; Φq 0]{q̈;λ}={Q;γ}`, **Baumgarte stabilization** & projection (the kernel's `MultibodyDynamics.cpp`), GGL.
- **PDE discretization (the math under FEA/CFD):** weak/variational form, Galerkin, the **Bubnov vs Petrov-Galerkin** choice, **SUPG/streamline-upwind** stabilization for advection, the inf-sup / **LBB** condition for mixed (velocity-pressure) elements, MAC staggered grid + projection (the kernel's `Cfd.cpp`), CFL & Péclet numbers.
- **Judgment:** smooth & near-solution → full Newton; far/ill-conditioned → line-search or trust-region; limit point ahead → switch load-control → arc-length; non-stiff transient → RK45; stiff (thermal, chemically-reacting, stiff structural) → BDF/Newmark; need to kill spurious high-frequency content in a contact/impact run → HHT-α with α∈[-1/3,0]. *A diverging Newton is usually a bad tangent or a real bifurcation, not "more iterations".*

### A3 — Approximation, Interpolation & Quadrature  *(bachelors → masters)*
The math that makes geometry exact and integrals correct.
- **Polynomial & spline interpolation:** Lagrange/Newton-divided-difference, Hermite, **Runge phenomenon** → Chebyshev nodes, cubic & natural splines.
- **NURBS / CAGD (the geometry core):** **Cox-de-Boor** recursion, the **de Boor algorithm** (numerically stable evaluation), knot insertion/removal/refinement, degree elevation, **Bézier↔B-spline** (de Casteljau), rational weights & projective interpretation, **G⁰–G³ / C⁰–C³ continuity** (the Class-A surfacing bar), curvature/torsion, surface-surface intersection (SSI) marching, least-squares & energy-minimizing curve/surface **fitting** (the reverse-engineering path).
- **Numerical integration:** **Gauss-Legendre** (the per-element FEA rule, exactness `2n-1`), Gauss-Lobatto, reduced/selective integration (& its hourglass risk), adaptive Simpson, the **FFT** (DFT, Cooley-Tukey, for harmonic/modal post & convolution).
- **Least squares & regression:** normal equations vs QR vs SVD, weighted/total least squares (errors-in-variables → the metrology/best-fit-datum problem), regularization (Tikhonov/ridge).
- **Judgment:** integrand-degree drives Gauss order; reduced integration cures locking but invites hourglassing — pair with stabilization; fit a NURBS with energy/fairness terms to avoid wiggles; never fit datums with ordinary LSQ when the spec calls **minimum-zone (Chebyshev)** — the answer differs and the part is rejected on the wrong one.

### A4 — Optimization Theory & Practice  *(bachelors → PhD → industry)*
The engine under generative design, topology optimization, tolerance allocation, and every "best" decision.
- **Unconstrained:** gradient/steepest-descent, Newton & quasi-Newton (BFGS/L-BFGS), conjugate-gradient, convergence rates, the role of the Hessian/condition number.
- **Constrained:** **KKT conditions** (stationarity, primal/dual feasibility, complementary slackness), constraint qualifications (LICQ/MFCQ), **Lagrangian duality** & weak/strong duality, **convexity** (when a local optimum is global), **SQP**, **interior-point/barrier**, augmented-Lagrangian, active-set, penalty.
- **Linear & mixed-integer:** simplex, LP duality, **branch-and-bound / branch-and-cut** (the discrete-sizing & nesting problems), cutting planes.
- **Structural/topology optimization (the CAD-relevant core):** **SIMP** (`ρ^p`, p=3, the kernel's topology-opt path), the **adjoint/sensitivity** method `∂c/∂ρ`, the **optimality-criteria** & MMA updaters, **density/sensitivity filtering** (Sigmund) to kill checkerboarding & mesh-dependence, level-set & BESO, compliance-minimization vs stress-constrained, manufacturing constraints (overhang/min-member-size) baked into the formulation.
- **Global / derivative-free:** genetic/evolutionary, particle-swarm, simulated annealing, Bayesian optimization / surrogate-assisted (the DOE→surrogate→optimize loop), multi-objective & **Pareto fronts** (NSGA-II, ε-constraint, weighted-sum pitfalls).
- **Judgment:** convex (LP/QP/SOCP) → trust the optimum, use interior-point; nonconvex with gradients → SQP/IP from multiple starts; topology → SIMP+filter+continuation-on-p; expensive black-box sim → Bayesian/surrogate; *always interrogate the optimizer's answer for manufacturability before trusting it* (an unfiltered SIMP result is a checkerboard you cannot machine).

### A5 — Error Estimation, Adaptivity & Verification/Validation  *(masters → PhD → industry)*
What separates a trustworthy analysis from a colored picture. This is the **honesty pillar** in math form.
- **A-posteriori error estimators:** **Zienkiewicz-Zhu (ZZ)** recovery-based, explicit/implicit **residual** estimators, goal-oriented (DWR / dual-weighted-residual) for a quantity of interest.
- **Adaptivity:** **h-refinement** (element subdivision), **p-refinement** (order elevation), **hp-adaptivity** (exponential convergence for smooth fields, h near singularities), refinement indicators & marking (Dörfler).
- **Locking & spurious modes (the variational-crime catalogue):** shear locking (thin bending), **volumetric locking** (near-incompressible, ν→0.5), the **patch test**, cures: **Wilson-Q6 incompatible modes** (the kernel's de-locking, static 0.33% / modal 0.2%), **B-bar / selective-reduced integration**, **EAS**, hourglass control, the **inf-sup/LBB** test for mixed elements.
- **Verification & Validation (V&V):** **Method of Manufactured Solutions (MMS)**, **Richardson extrapolation** & the **Grid Convergence Index (GCI)** with observed order-of-accuracy, code-verification vs solution-verification vs validation, **ASME V&V 10** (computational solid mechanics) & **V&V 20** (CFD/heat transfer), NAFEMS benchmarks, uncertainty quantification (aleatory vs epistemic, the VVUQ credibility layer the kernel already exposes).
- **Judgment:** never trust a single mesh — run ≥2-3 and compute observed order + GCI; a stress at a re-entrant corner is **singular** (don't h-refine to chase a diverging peak — use a fillet or a notch-stress method); report the error bar, and *if the solver diverged or is unverified for the regime (e.g. turbulent CFD), say so and paint nothing* (the kernel's honesty contract — `caeViz.js` returns `{error}`, never fabricates).

### A6 — Formal Logic, Proof & Constraint Reasoning  *(masters → PhD)*
The deductive backbone — what lets Archie *verify* rather than guess, and what powers configurators and constraint solvers.
- **Propositional & first-order logic:** soundness/completeness, natural deduction, the structure of a rigorous **proof** (direct, contrapositive, contradiction, induction, well-ordering); quantifier reasoning; the difference between *necessary* and *sufficient* (the #1 spec-reading error).
- **Decision procedures:** **SAT** (DPLL/CDCL), **SMT** (linear arithmetic, bit-vectors), **CSP** (arc-consistency AC-3, backtracking + forward-checking, the configurator/feature-interaction engine), **interval arithmetic & constraint propagation** (rigorous enclosure — the robust path under tolerance & the "is this constraint system feasible?" question).
- **Geometric constraint solving (the sketcher math):** **structural DOF analysis** (Grübler / Laman graphs / Witkin), **DM (Dulmage-Mendelsohn) decomposition** to find over/under/well-constrained subgraphs, witness-configuration / generic-rigidity testing, **Newton on the constraint residual** with the constraint Jacobian, redundant-vs-conflicting constraint diagnosis (the exact errors a real sketcher must explain to the user).
- **Dimensional analysis & invariants:** the **Buckingham-π theorem**, unit-consistency as a *type system* (SI primary, imperial recall), order-of-magnitude/Fermi reasoning, similitude & nondimensional groups (Re, Nu, Bi, Fo, Pe, Ma, Wo) as sanity checks on every result.
- **Judgment:** treat units as types — a dimensionally-inconsistent equation is *proof* of an upstream error; a sketch that "won't solve" is a graph problem (DM-decompose, name the conflicting constraint), not a numerical nuisance; use interval arithmetic when a tolerance must be *guaranteed*, not merely sampled.

### A7 — Ultra-Deep Multi-Step Reasoning & Decomposition  *(the integrative skill — PhD → senior practice)*
This is the cluster's apex: chaining A1–A6 across many steps without dropping a constraint, the thing that makes Archie reason "like a practising senior engineer."
- **Decomposition discipline:** break an open spec into a *requirements object* → architecture → first-order sizing (analytical) → detailed analysis (numerical) → verification → manufacturability check → tool-call. Carry **every** constraint forward; never silently relax one.
- **First-principles / order-of-magnitude before FEA:** beam/plate/shell closed forms (Euler-Bernoulli, Timoshenko, Roark's), Hertz contact, thin-wall pressure, lumped thermal — *the sanity bound the numerical answer must match* (within %). A senior engineer predicts the answer, then computes it; a disagreement of >~15% means a setup bug, not a surprise.
- **Self-critique & uncertainty:** stating assumptions, flagging out-of-distribution conditions (e.g. altitude-density correction for a prop sized at sea level), distinguishing what is computed from what is assumed, attaching an error bar, and proposing the *next* verification — the eAGI L6 "reflect" behavior.
- **Cross-domain coupling reasoning:** thermal→structural (CTE-driven stress), fluid→structural (FSI pressure load), tolerance→performance (how a 0.1→0.02 mm tolerance moves a fit and a cost), staged correctly so an upstream number feeds a downstream model with units intact.
- **Judgment:** the senior move is *bounding before solving* and *verifying after* — the trace must show the closed-form bracket, the numerical result inside it, the error estimate, and the explicit constraint check. **This trace is the training signal** — it's what transfers to parts Archie has never seen.

### A8 — Computational Geometry Robustness & Algorithmic Numerics  *(masters → PhD)*
The numeric reasoning specific to making a *geometry kernel* not crash — the bridge from "math" to "the boolean actually closed."
- **Floating-point reality:** IEEE-754, machine epsilon, catastrophic cancellation, the **TwoSum/TwoProduct (FMA)** error-free transforms, **non-overlapping expansions** (Shewchuk), summation error (Kahan).
- **Exact geometric predicates:** `orient2d/orient3d/incircle/insphere` as **signs of determinants**, **static error-bound filters** → adaptive-precision exact fallback (exactly the kernel's `Predicates.cpp` design — filter-then-exact), the difference between **exact predicates (signs)** and **exact constructions (EPECK coordinates)** and why robust intersection needs the latter (the kernel gap).
- **Robustness strategies:** symbolic perturbation (**Simulation of Simplicity**), snap-rounding, tolerance-based (epsilon-geometry) vs exact-arithmetic kernels and their failure modes (the "empty geometry after 30 subtractions" symptom is epsilon-kernel fragility).
- **Core algorithms with complexity:** convex hull (incremental/QuickHull), Delaunay/Voronoi (incircle predicate), Bentley-Ottmann sweep (orient predicate), Minkowski/offset/straight-skeleton, point-in-polygon/solid (ray-cast parity, winding), QEM/spatial hashing/BVH/k-d-tree.
- **Judgment:** when a boolean produces empty/garbage geometry, the cause is almost always a near-degenerate predicate evaluated in epsilon-arithmetic — the fix is exact predicates + (for coordinates) exact construction or robust snapping, *not* a looser tolerance (which moves the failure, doesn't remove it). This judgment directly defends the CADGenBench **validity** & **topology** axes.

---

## 2. DATA SOURCES (premium / authoritative only)

> Used as **answer keys and question templates**, not scraped wholesale. Open/CC where ingested; proprietary standards/texts are *cited references the generator's answer key encodes*, never redistributed. Honor download→process→delete and IP hygiene (Mecado rule).

### 2.1 Courses (free, authoritative — primary lecture/problem scaffolds)
- **MIT OpenCourseWare:** 18.085/18.086 *Computational Science & Engineering* (Strang — the canonical FEA/numerics bridge), 18.06 *Linear Algebra* (Strang), 18.335 *Introduction to Numerical Methods* (graduate), 6.255J/15.093 *Optimization Methods*, 16.90 *Computational Methods in Aerospace Engineering*, 2.094/2.092 *Finite Element Analysis of Solids & Fluids* (Bathe), 18.S096/6.7220 *Nonlinear Optimization*, 6.045/6.840 *Logic/Theory of Computation*.
- **Stanford:** CME 302/306 (numerical linear algebra), EE364a/b *Convex Optimization* (Boyd — the optimization gold standard), CS357.
- **Others:** Cornell CS 4220/6210 (numerical analysis), CMU 15-859 / convex-opt, TU-Delft & ETH numerical-methods OCW, **NPTEL** FEA/numerical-methods/optimization series.

### 2.2 Textbooks (the answer-key canon)
- **Linear algebra & numerics:** Golub & Van Loan *Matrix Computations*; Trefethen & Bau *Numerical Linear Algebra*; Saad *Iterative Methods for Sparse Linear Systems* (Krylov/preconditioning); Demmel *Applied Numerical Linear Algebra*; Higham *Accuracy & Stability of Numerical Algorithms* (FP error analysis); Nocedal & Wright *Numerical Optimization*.
- **ODE/PDE/FEM:** Hairer/Nørsett/Wanner *Solving ODEs I & II* (stiff/DAE); Ascher & Petzold *Computer Methods for ODEs & DAEs*; Hughes *The Finite Element Method* (linear & stabilized); Bathe *Finite Element Procedures*; Zienkiewicz, Taylor & Zhu *The Finite Element Method* (incl. ZZ error estimation); Belytschko/Liu/Moran *Nonlinear Finite Elements*; Simo & Hughes *Computational Inelasticity* (the J2 radial-return the kernel uses); Crisfield *Non-linear FE Analysis of Solids & Structures* (arc-length); Ferziger & Perić *Computational Methods for Fluid Dynamics*.
- **Optimization (design):** Boyd & Vandenberghe *Convex Optimization* (free PDF); Bendsøe & Sigmund *Topology Optimization*; Christensen & Klarbring *Intro to Structural Optimization*; Arora *Introduction to Optimum Design*; Sigmund's *99/88-line* topology-opt papers (the SIMP reference implementation).
- **Logic/CS theory & geometry:** Huth & Ryan *Logic in Computer Science*; Bradley & Manna *Calculus of Computation* (SMT); de Berg et al. *Computational Geometry: Algorithms & Applications*; Preparata & Shamos; Shewchuk's *Adaptive Precision FP Arithmetic & Fast Robust Geometric Predicates* (the kernel's predicate basis); Hoffmann *Geometric & Solid Modeling*.
- **Engineering judgment / closed-forms (the bounding canon):** Roark's *Formulas for Stress & Strain*; Shigley's *Mechanical Engineering Design*; Timoshenko *Theory of Elasticity / Plates & Shells*; Den Hartog *Mechanical Vibrations*; Barber/Johnson *Contact Mechanics* (Hertz); NAFEMS benchmark suites; the **Schaum's Outlines** problem banks (high-volume worked-problem templates).

### 2.3 Standards bodies (answer-key authorities)
- **ASME V&V 10** (computational solid mechanics V&V), **ASME V&V 20** (CFD & heat-transfer V&V) — the verification methodology spine of A5.
- **NAFEMS** benchmark challenge problems (the de-facto FEA known-answer set).
- **ISO/IEC 80000** (quantities & units — the dimensional-analysis type system); **NIST DLMF** (Digital Library of Mathematical Functions — special functions/quadrature answer keys); **NIST/SEMATECH e-Handbook of Statistical Methods** (DOE/SPC/uncertainty).
- **JCGM 100 (GUM)** — *Guide to the Expression of Uncertainty in Measurement* (the metrology/tolerance uncertainty backbone).

### 2.4 Papers / datasets (graduate frontier + grounding)
- **Numerics/optimization classics:** Shewchuk predicates (1997); Sigmund 99-/88-line SIMP; Svanberg MMA; the Newmark (1959) & Hilber-Hughes-Taylor (1977, HHT-α) & Chung-Hulbert (generalized-α) integration papers; Saad-Schultz GMRES; the BiCGStab (van der Vorst) paper.
- **Constraint/geometry:** Hoffmann-Lomonosov-Sitharam (geometric-constraint DOF analysis & DM-decomposition); Bottema/Witkin energy-constraint solving.
- **CAD-ML training strategy (how the corpus is *used*):** the SFT→GRPO/Dr.CPPO recipe and geometry-truth-reward findings synthesized in `../../SCOPE_2026-06-21/research/parametric_cad_literature_2026.md` — directly informs §3's grounding loop.
- **Open math/reasoning corpora (for streaming ingest, CC/permissive):** **OpenWebMath**, **AMPS / Hendrycks MATH** (competition math, step solutions), **NuminaMath / MetaMathQA** (reasoning chains), **TheoremQA**, **NuminaMath-CoT**, **GSM-style multi-step** sets — ingested via `iter_batches`, filtered to *engineering-relevant* numerics/proof/optimization, re-formatted into the tool-call-terminated schema. (These supply *reasoning-trace style*; the *answer keys* come from §2.2/2.3 and from Forge-kernel execution.)

> **Hygiene note.** Proprietary texts/standards are not redistributed; the generator encodes the *numbers and methods* into deterministic answer keys with citations. Synthetic, kernel-verified data dominates the corpus (see §3) — the open corpora are a *style/diversity* seasoning, capped and deduped.

---

## 3. SYNTHETIC-DATA GENERATION PLAN (bulk_synth, kernel-grounded)

> **Module:** `scripts/bulk_synth_math.py` + `scripts/bulk_synth_numerics.py` (the two named Pillar-A generators), reusing `corpus_factory.py` / `merge_accumulator.py` / `compact_batches.py` for dedup+mix, `coherence_gate.py` + `critic_synth.py` for quality, `dpo_synth.py` for preference pairs. Every sample is JSONL `{messages:[system,user,assistant]}` with the Archie chat template; the assistant emits a **reasoned chain-of-thought + a verifiable answer + (where geometric/physical) a kernel-replayable `forge.<wb>.<op>(args)` call**.

### 3.1 The four sample archetypes (every generator emits a mix)
1. **Q/A (recall + derive):** "state the KKT conditions / Buckingham-π / the CG convergence bound and apply them." Answer key = closed form from §2.2/2.3. *Teaches L1–L3 (remember/understand/apply).*
2. **Problem→Solution (numeric, gated):** a fully-worked multi-step numeric problem whose **final number is checkable** against an analytical/benchmark truth or against a Forge solver. *Teaches L3–L4 and the bounding-then-solving discipline.*
3. **Design→Critique (diagnose/repair):** a flawed setup (locked element, ill-conditioned solve, over-constrained sketch, unfiltered SIMP, dimensionally-inconsistent eqn) → detect the math error → propose+justify the fix. *Teaches L4 and the failure-mode catalogue.*
4. **Tool-call (Forge verb, kernel-verified):** the reasoning **terminates in** a schema-valid call — `forge.num.*` solver-config, `forge.fea.*`/`forge.cfd.*`/`forge.simulate.*`, `forge.optimize.*`/`forge.topopt.*`, `forge.sketch.*` constraint ops, `forge.cg.*` robust-predicate ops — that the kernel replays so the *answer can be scored geometrically/physically*. **This is what makes Archie drive Forge, not just chat.**

### 3.2 Per-generator plan (maps to §1 A1–A8)

| Gen | Domain | Question templates (what to bulk-generate) | Answer key / **grounding** | Terminating tool-call |
|---|---|---|---|---|
| **G1 `gen_linear_algebra`** | A1 | factorization choice; κ estimate & error bound; eigen-method selection; solver+preconditioner pick for a given sparsity/SPD-ness; least-squares via QR/SVD | closed-form κ/convergence bounds; **A/B vs `la::` solver in the kernel** for residual check | `forge.num.solve({system,method,precond})`, `forge.num.eig({type})` |
| **G2 `gen_nonlinear_ode`** | A2 | Newton vs line-search vs trust-region vs arc-length selection + justification; integrator pick (RK45/BDF/Newmark/HHT-α) + stability proof; DAE-index reduction | amplification-matrix/stability analysis; **replay against `forge.fea.transient`/`forge.simulate.multibodyDynamics`** (Newmark/HHT-α already in kernel) | `forge.fea.transient({integrator,β,γ,α})`, `forge.fea.nonlinearStatic({continuation})` |
| **G3 `gen_quadrature_interp`** | A3 | Gauss-order for an integrand; NURBS eval/knot-insert/fit; Runge→Chebyshev; FFT of a signal; min-zone vs LSQ datum fit | de-Boor/Cox-de-Boor exact eval; **kernel `forge.nurbs.*` + `forge.cmm.fit` replay** for geometry truth | `forge.nurbs.fit/insertKnot`, `forge.cmm.fit({method:minZone})` |
| **G4 `gen_optimization`** | A4 | KKT/duality/convexity classification; SQP vs IP vs GA selection; SIMP setup + filter + sensitivity; Pareto/multi-objective; tolerance allocation as an optimization | KKT/duality theorems; **SIMP/adjoint vs `forge.topopt.simp` replay** (compliance check) | `forge.topopt.simp({p,filter,vol})`, `forge.optimize.run({method})` |
| **G5 `gen_verification`** | A5 | ZZ/residual estimate; h/p/hp choice; patch-test reasoning; locking diagnosis+cure; **MMS / Richardson-GCI / V&V** workflow; report the error bar | MMS exact source; GCI/observed-order formulas; **ASME V&V 10/20, NAFEMS known answers**; kernel VVUQ layer | `forge.fea.*({elementTech:Q6/Bbar})`, `forge.vvuq.gci({meshes})` |
| **G6 `gen_proof_logic`** | A6 | proofs (induction/contradiction); dimensional-analysis derivations; SAT/CSP/feature-interaction; **DOF analysis & DM-decomposition** of a sketch; necessary-vs-sufficient spec reading | formal proof rules; Buckingham-π; **Grübler/Laman + DM-decomp answer key, replayed via `forge.sketch.solve` constraint diagnostics** | `forge.sketch.addConstraint/solve`, `forge.config.solveCSP` |
| **G7 `gen_deep_reasoning`** | A7 | open-ended sizing brief → requirements→architecture→first-order bound→numerical analysis→verify→manufacturability→tool-call; cross-domain coupling (thermal→structural, FSI); self-critique/OOD-flag | closed-form bracket (Roark/Shigley/Timoshenko) **must bracket** the Forge-sim result; coupling staged with units | full `forge.simulate.*` multiphysics vector + sizing calls |
| **G8 `gen_geom_robustness`** | A8 | FP cancellation/expansion arithmetic; predicate sign via filter→exact; "boolean returned empty — diagnose"; complexity of hull/Delaunay/sweep | Shewchuk predicate exactness; **kernel `Predicates.cpp` filter→exact A/B**; validity-after-boolean check | `forge.cg.orient/incircle`, `forge.boolean.*` + `forge.validate.brep` |

### 3.3 Grounding discipline (how every numeric/geometric sample stays TRUE)
- **Analytical-gate first:** for A1–A6 the answer key is a closed form or a published benchmark (MMS, NAFEMS, Ghia, GCI, KKT). The generator computes the gold number deterministically and **rejects any sample whose drafted answer disagrees** — no model-in-the-loop hallucination enters the corpus.
- **Kernel-replay second (the Forge tie-back):** wherever the sample ends in a `forge.*` call, the generator *executes it in the live kernel* and confirms the predicted result (residual, eigenvalue, compliance, von-Mises, validity, Betti numbers, GCI) matches the kernel's own output within tolerance. **ForgeCADScore / VVUQ are the offline reward.** A sample that the kernel won't replay or that disagrees is dropped. This is exactly the SFT-then-geometry-truth-reward recipe from `parametric_cad_literature_2026.md` (D2): SFT on these tool-call corpora, then **GRPO with reward = analytical-gate + kernel-execution match**.
- **Self-correction multi-turn:** include trajectories where Archie receives kernel feedback (residual too high / mesh-not-converged / boolean-empty / over-constrained) and *iterates the math decision* (tighter precond, finer mesh, arc-length switch, exact predicate) until the gate passes — teaching self-heal, the eAGI-repair behavior.
- **Honesty injection:** seed samples where the correct answer is "this regime is unverified — return `{error}`, paint nothing" (turbulent CFD, post-buckling without arc-length, a singular re-entrant stress). The math cluster is where Archie learns *to bound its own competence*.
- **Why this makes Archie better INSIDE Forge:** every Pillar-B/C/D/E sample inherits these reasoning habits — pick the right solver, bound before solving, verify after, refuse to fabricate. When Archie drives Forge via CUA, the *math adapter is the layer that decides the analysis is set up correctly and the geometry will build*, so the terminating tool-call is one the kernel accepts and the result one the V&V gate trusts. S0 is literally the difference between a tool-call that replays to a manufacturable, verified part and one that returns empty geometry.

### 3.4 Scale, budget & hygiene
- **Target ~3.0M unique S0 samples** (bulk_synth scale; agents would manage ~50). Rough split: A1 0.4M · A2 0.45M · A3 0.35M · A4 0.4M · A5 0.35M · A6 0.35M · A7 0.45M (the deep-reasoning, longest, highest-value traces) · A8 0.25M.
- **Streaming:** generate → `merge_accumulator.py` dedup → `compact_batches.py` → train → **delete intermediates** (iter_batches, never materialize the full corpus on disk). One heavy step at a time (no train+serve+Electron co-host).
- **NaN safety:** A7's long reasoning traces are exactly the corpus where `--mask-prompt` causes all-masked→NaN — **drop `--mask-prompt`**, early-verify loss, NaN-guard the run (memory rule).
- **Quality gates:** `coherence_gate.py` (no degenerate number-loops) + `critic_synth.py` (math correctness) + analytical-gate (numeric truth) + kernel-replay (geometric/physical truth) before a sample enters the train mix; `dpo_synth.py` builds preference pairs (correct-reasoning ≻ plausible-but-wrong) ranked by the analytical/ForgeCADScore reward for the S8 DPO stage.

---

## 4. EXAMPLE TRAINING SAMPLES (depth illustration)

> Format abbreviated for the doc; production samples carry the full Archie chat template and end in schema-valid tool-calls. CoT shown because the *trace* is the training signal.

### Sample 1 — Solver/integrator selection with a stability *proof* (G2, level L3–L4)

**System:** You are Archie, a CAD/CAM/CAE engineering reasoner. Reason step-by-step, bound before you solve, then emit one schema-valid Forge tool-call.

**User:** I'm running a transient drop-impact of a bracket onto a rigid floor. My explicit central-difference run blew up at Δt = 1e-4 s. The bracket's smallest element is 0.5 mm and the material is steel (E = 200 GPa, ρ = 7850 kg/m³). What's going on and how should I integrate this instead?

**Assistant (ideal):**
*Diagnosis.* Central difference is **conditionally stable**: Δt must satisfy Δt ≤ 2/ω_max, and for a wave problem ω_max ≈ 2c/L_min with dilatational wave speed c = √(E/ρ). Here c = √(200e9/7850) ≈ 5048 m/s, L_min = 0.5e-3 m ⇒ the element CFL limit Δt_cr ≈ L_min/c ≈ 0.5e-3/5048 ≈ **9.9e-8 s**. Your Δt = 1e-4 s exceeds the stability limit by ~1000×, so the explicit scheme is unstable — this is a numerical blow-up, not a physical one.
*Two correct paths.* (1) Stay explicit but cut Δt below ~9.9e-8 s (≈ 5e-8 s with a safety factor) — costly but accurate for the high-frequency contact transient. (2) Switch to an **implicit, unconditionally-stable** integrator. For impact you also want to *damp spurious high-frequency content* the contact injects, which average-acceleration Newmark (β=¼, γ=½) does **not** do. The right tool is **HHT-α / generalized-α** with α ∈ [−1/3, 0]: it is second-order accurate, unconditionally stable, and introduces controllable high-frequency numerical dissipation while preserving the low modes. Pick α = −0.05 → β = (1−α)²/4, γ = ½ − α.
*Bound/check.* Implicit Δt can be ~10³× the explicit limit (say Δt = 1e-5 s) at the cost of a Newton solve per step; verify by halving Δt once (Richardson) and confirming the peak contact force changes < ~2%.

```
forge.fea.transient({
  body: "bracket",
  loadCase: "drop_impact",
  contact: { target: "rigid_floor", method: "penalty" },
  integrator: "generalized_alpha",
  alpha: -0.05, beta: 0.275625, gamma: 0.55,
  dt: 1.0e-5, tEnd: 5.0e-3,
  material: { E: 200e9, rho: 7850, nu: 0.3 }
})
```
*(If the kernel reports non-convergence at this Δt, halve it and re-run; if contact chatter persists, increase α-dissipation toward −1/3.)*

---

### Sample 2 — Over-constrained sketch: DOF + DM-decomposition diagnosis (G6, level L4)

**User:** My sketch won't solve — the solver says "over-constrained." It's a rectangle (4 lines) with: coincident corners (4), horizontal on the 2 horizontal lines, vertical on the 2 vertical lines, a width dimension, a height dimension, and an equal-length constraint between the two horizontal lines. Why, and what do I remove?

**Assistant (ideal):**
*DOF count.* 4 lines = 8 endpoints = 16 coordinate DOFs, but coincidence fuses them into 4 shared corners = **8 DOFs**. Rigid-body freedom in 2D is 3 (2 translation + 1 rotation), so a fully-constrained sketch needs 8 − 3 = **5 independent dimensional/geometric constraints** beyond the topological/coincidence ones. Count the *non-coincidence* constraints: 2 horizontal + 2 vertical + width + height + equal-length = **7**. That's 2 more than the 5 the system can absorb ⇒ over-constrained by 2.
*Which are redundant (DM-decomposition view).* Build the constraint Jacobian and Dulmage-Mendelsohn–decompose it; the **over-constrained block** contains the conflicting subset. Geometrically: once you have *horizontal on both horizontals + vertical on both verticals*, the shape is already a rectangle, so the two horizontal lines are **necessarily equal** — the `equal-length` constraint is **redundant** (its Jacobian row is linearly dependent on the others), contributing one excess. The second excess is that giving a `width` dimension *and* both verticals being parallel/equal-by-construction double-specifies one length only if the width is also tied to the equal — but the primary redundancy to remove is the **equal-length** constraint. Removing it drops the count to 6; if the solver still flags redundancy, the width/height pair is fine (independent), so the remaining excess is the equal-length's transitive partner — remove `equal-length` and re-solve; the sketch becomes well-constrained at 5 driving constraints.
*Action.*

```
forge.sketch.deleteConstraint({ sketch: "rect", constraintId: "equalLen_h1_h2" })
forge.sketch.solve({ sketch: "rect", diagnose: true })   // expect: fully-constrained, DOF = 0
```
*(General rule: an `over-constrained` sketch is a rank-deficient constraint Jacobian — DM-decompose, find the dependent row, remove the constraint that is implied by the others rather than a dimensional driver.)*

---

### Sample 3 — Topology optimization done correctly + manufacturability self-critique (G4/G7, level L5–L6)

**User:** Generate a lightweight steel bracket for a 5 kN downward load on a 60×40×10 mm design space, fixed on the left face, target 40% volume. Just give me the optimized shape.

**Assistant (ideal):**
*First-order bound (before optimizing).* Treat it as a cantilever, L ≈ 60 mm, load 5 kN. A solid bar of this section has tip deflection δ ≈ FL³/(3EI); this brackets the stiffness the optimizer should approach at 100% volume and tells me 40% volume will roughly *double-to-triple* compliance — useful as a sanity check on the result.
*Method.* Compliance-minimization via **SIMP**: penalize intermediate densities with E(ρ) = E₀·ρ^p, **p = 3** (the standard penalization that drives ρ→{0,1}); enforce the 40% volume constraint; update by optimality-criteria/MMA using the **adjoint sensitivity** ∂c/∂ρ_e = −p·ρ_e^(p−1)·uₑᵀk₀uₑ (self-adjoint for compliance). **Critically, apply a density/sensitivity filter** (radius r_min ≈ 1.5–2× element size) — without it the result checkerboards and is *mesh-dependent and un-manufacturable*. Use continuation on p (1→3) to avoid local minima.
*Manufacturability self-critique (the senior move).* A raw SIMP result has 0.3–0.7 grey transition members. Before trusting it I will (a) threshold/project to a clean 0/1 boundary, (b) check **minimum member size** ≥ the chosen machining/AM process minimum, and (c) if it's to be machined, flag thin internal voids as un-reachable and re-run with a min-feature constraint; if AM, check overhang < 45° self-support. I will *not* hand back a checkerboard.
*Verify after.* Re-run a clean FEA on the thresholded geometry and confirm the FoS and that compliance sits inside my first-order bracket; report the achieved volume fraction and peak von-Mises with an error estimate (run 2 meshes, GCI).

```
forge.topopt.simp({
  designSpace: { box: [60, 40, 10] },
  load: { face: "right", vector: [0, -5000, 0] },
  fixed: { face: "left" },
  volFrac: 0.40,
  penalty: 3, penaltyContinuation: [1, 2, 3],
  filter: { type: "density", rmin: 1.5 },
  material: { E: 200e9, nu: 0.3 }
})
// then, on the thresholded result:
forge.fea.staticLinear({ body: "bracket_opt", loadCase: "5kN", reportFoS: true })
forge.vvuq.gci({ body: "bracket_opt", meshes: ["coarse","fine"] })
```
*(If the FoS is below target or compliance exceeds the first-order bracket by >15%, the threshold removed load-bearing material — lower the projection cutoff or raise volFrac and re-optimize. Honesty: report the achieved fraction and the error bar, not a single number.)*

---

## 5. INTEGRATION & SEQUENCING (where this cluster sits)

- **Stage S0 `arch14b-math`** of the curriculum ladder (`archie_corpus_program.md` §6). Trained **first** on a fresh base (Qwen2.5-14B + DeepSeek-R1 reasoning merge), because every later adapter (geom, physics, mfg, lifecycle, mechatronics, eAGI) composes on top of it and inherits its reasoning habits.
- **Acceptance gate before promotion:** analytical-gate Q/A ≥ 0.90; reasoning traces coherent (no degenerate loops); no NaN; on the held-out solver-selection / V&V / DOF probes the adapter's choice is correct ≥ 0.90. Restart serve fresh before eval (output degrades over a session).
- **Feeds the geometry-truth reward loop:** the tool-call-terminated, kernel-verified samples are the SFT seed for the **S8 DPO / GRPO** stage where `ForgeCADScore` + analytical-gate become the RL reward (the SOTA SFT→geometry-truth-RL recipe). S0 makes the later RL *sample-efficient* because the model already reasons correctly about the analysis.
- **DoD contribution:** S0 is the foundation under "CADGenBench ≥ 0.85 on EVERY axis" — directly defends **validity & topology** (via A8 robustness reasoning), **shape** (via A3 NURBS/quadrature), and underwrites **interface** & the editing axis through the constraint/DOF reasoning (A6) and the verify-before-trust discipline (A5/A7). Runs local on 36 GB; honest by construction; CI-green between stages.

---

## 6. TEN-LINE SUMMARY (for the mission bible / S0 row)

1. **Cluster = Pillar A / stage S0 `arch14b-math`** — the reasoning spine trained FIRST; a pure-CAD model is a numerical-reasoning engine, not a chatbot.
2. **Eight knowledge domains A1–A8:** linear algebra & matrix computation; nonlinear/ODE/DAE & time-integration; approximation/NURBS/quadrature; optimization & topology-opt; error-estimation/adaptivity/V&V; logic/proof/constraint-DOF; ultra-deep multi-step reasoning; geometry-robustness/exact-predicates — each chosen because it is a real CAD/CAE failure point.
3. **Judgment, not just theory:** every domain teaches the senior-engineer *when/why* (SPD→Cholesky/CG; limit-point→arc-length; near-incompressible→B-bar/Q6; nonconvex→multi-start SQP; boolean-empty→exact predicates not looser tolerance; bound-before-solve, verify-after).
4. **Data sources, premium only:** MIT-OCW (18.085/18.06/18.335/2.094) + Stanford EE364 + NPTEL; Golub-VanLoan/Trefethen/Saad/Nocedal-Wright/Hughes/Bathe/Boyd/Bendsøe-Sigmund/Shewchuk; ASME V&V 10/20, NAFEMS, ISO-80000, NIST-DLMF, GUM; open math corpora (OpenWebMath/MATH/NuminaMath) as style seasoning only.
5. **Synthetic plan = 8 generators (`bulk_synth_math.py`/`bulk_synth_numerics.py`)** emitting Q/A + problem→solution + design→critique + **tool-call-terminated** samples, mixed via `corpus_factory`/`merge_accumulator`.
6. **Grounded two ways:** analytical-gate (closed-form/benchmark truth deterministically computed, disagreeing samples dropped) **and** kernel-replay (the `forge.*` call executed in the live kernel; ForgeCADScore/VVUQ as offline reward). No model-in-the-loop hallucination enters the corpus.
7. **Tie-back to Forge:** every sample ends in a schema-valid `forge.num/fea/cfd/simulate/optimize/topopt/sketch/cg.*` call the kernel replays — so the math adapter is the layer that makes Archie's CUA tool-calls *build and verify*, not just chat.
8. **Honesty injection + self-correction:** samples that teach "this regime is unverified → return {error}, paint nothing" and multi-turn traces that consume kernel feedback (residual/mesh/boolean/over-constrained) and iterate the math decision to convergence.
9. **Scale ~3.0M unique S0 samples** (bulk_synth, never hand-authored), storage-safe download→process→delete + `iter_batches`; **no `--mask-prompt`** on the long reasoning traces (NaN risk), early loss-verify + NaN-guard, chat-template on every sample.
10. **Gate:** analytical-gate ≥ 0.90, coherent, NaN-free, solver-choice correct ≥ 0.90 → promote; S0 is requirement-zero under the CADGenBench ≥ 0.85-every-axis DoD and the SFT→geometry-truth-RL recipe.
