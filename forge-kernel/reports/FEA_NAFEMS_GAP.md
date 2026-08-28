# NAFEMS LE1 / LE10 / LE11 — what the gap actually is

**Date:** 2026-08-28  **Branch:** `worktree-wf_7e99c803-95e-4`
**Evidence:** `test/fea_nafems_gate.mjs`, `test/fea_nafems_convergence.mjs`,
`test/fea_tet4_convergence.mjs`, all run against a Release build of this worktree's
`forge-kernel.node`.

---

## 1. The gate could not go red

`test/fea_nafems_gate.mjs` ended with

```js
let hardFail = false;
const note = (m) => { hardFail = true; ... };   // only note() sets it
process.exitCode = hardFail ? 1 : 0;
```

`record()` printed `VERDICT: FAIL` for a missed NAFEMS band without ever calling `note()`.
So a missed published benchmark could not turn the gate red — the only red paths were the
kernel-correctness guards (shell-fallback mesh, NaN, wrong-sign stress, CG non-convergence,
the analytic thermoelastic check). The gate's own last line said so:
`"deferred-mesher gap, not a kernel break. hardFail=false."`

**Fixed by ratchet, not by flipping the flag.** `test/fea_nafems_ratchet.sh` +
`test/fea_nafems_baseline.txt`, modelled on the committed `test/ft/s0_ratchet.sh`:

| condition | result |
|---|---|
| gate `hardFail=true` | RED (exit 2) — kernel guard, never ratcheted |
| misses **>** baseline | RED (exit 1) — accuracy regression |
| misses **<** baseline | RED (exit 1) — lower the baseline in the same commit |
| same count, **different set** | RED (exit 1) — a swap is a regression in disguise |
| summary unparseable / gate died | RED (exit 3) — refuse to guess |
| count and set both match | GREEN, outstanding gaps printed every run |

The set comparison is an addition over `s0_ratchet.sh`, which compares counts only. With
three cases, one fixed and one broken nets to the same number.

`test/fea_nafems_ratchet_selftest.sh` drives all eleven paths and asserts each exit code
(11/11 pass). Two mutations of the **real kernel** were also driven end-to-end:

| mutation in `src/FeaTet.cpp` | effect | ratchet exit |
|---|---|---|
| thermoelastic `e0 *= 1.35` | analytic check off by 35.000 % | **2** (kernel guard) |
| nodal stress recovery `*= 1.76` | LE11 → −105.009 MPa, PASS; misses 3→2 | **1** (improved, lower the baseline) |

Both reverted; the tree builds clean and reproduces the baseline numbers bit-for-bit.

---

## 2. Per-case measured results

Published targets are literals from **The Standard NAFEMS Benchmarks, TNSB Rev.3**
(NAFEMS, Glasgow, October 1990). Material E = 210 GPa, ν = 0.3 throughout.

| case | quantity & probe | published | measured | error | band | observed order `p` |
|---|---|---|---|---|---|---|
| **LE1** elliptic membrane, plane stress | σ_yy at D = (2.0, 0.0) | **+92.7 MPa** | +35.671 MPa | **−61.5 %** | ±5 % | **−0.06** |
| **LE10** thick plate under pressure | σ_yy at D = (2.0, 0.0, top) | **−5.38 MPa** | −2.125 MPa | **+60.5 %** | ±6 % | **−0.18** |
| **LE11** solid cyl/taper/sphere, thermal | σ_zz at A = (1.0, 0.0, 0.0) | **−105 MPa** | −59.664 MPa | **+43.2 %** | ±6 % | **−6.70** |

`p` is the observed order of accuracy with an assumed-exact reference, ASME V&V 20-2009
§2.3 / Roache (1998): `p = ln(e_coarse/e_fine)/ln(r)`, `r = (N_fine/N_coarse)^(1/3)`.

**All three are negative.** The error GREW when the mesh was refined. The prose the gate
used to print — *"the coarse→fine trends above march monotonically toward each NAFEMS
literal"* — was contradicted by the gate's own `NOT converging` trend lines, on the same
screen, on every run. That prose is now deleted.

The cases that ARE exact are unchanged and still exact: the MacNeal-Harder constant-stress
patch test (non-uniformity 9.66 × 10⁻¹⁵) and the Inc1c thermoelastic analytic check
(0.0000 %).

---

## 3. What the gap is NOT: the element

The standing explanation was *linear Tet4 on a faceted boundary under-resolving a curved
stress concentration*, with quadratic Tet10 as the remedy. That was never measured. It has
now been tested directly.

`test/fea_tet4_convergence.mjs` builds a **structured** Tet4 mesh in JS — Freudenthal/Kuhn
6-tet subdivision of a cylindrical hex lattice — and feeds it straight to
`forge.fea.tet.solveLinearStatic`, bypassing `forge::fea::tet::meshShape` entirely. The
benchmark is the **Lamé thick-walled cylinder under internal pressure**, plane strain
(Timoshenko & Goodier, *Theory of Elasticity*, 3rd ed. 1970, §28) — a curved boundary with
a real stress gradient, i.e. the same class as the NAFEMS cases, but with an exact
closed-form answer. Pressure is applied as consistent nodal forces on the **faceted** bore,
so the faceting error is included, not idealised away.

```
 nr×nt×nz     nodes    tets      h[m]     u_r(bore)[µm]   err%    σ_θθ(bore)[MPa]  err%
 2×4×1           30      48   0.05000       8.34046    -8.138        13.9479  -16.313
 4×8×2          135     384   0.02500       8.77635    -3.337        15.0912   -9.453
 8×16×4         765    3072   0.01250       8.99596    -0.919        15.9563   -4.262
 16×32×8       5049   24576   0.00625       9.05754    -0.240        16.3238   -2.057

 u_r  (displacement)  theory O(h²) for a linear P1 tetrahedron
     h 0.05000 -> 0.02500 : |e| 8.1383% -> 3.3374%   p = 1.286
     h 0.02500 -> 0.01250 : |e| 3.3374% -> 0.9186%   p = 1.861
     h 0.01250 -> 0.00625 : |e| 0.9186% -> 0.2404%   p = 1.934   ASYMPTOTIC
 σ_θθ (stress)        theory O(h¹) for a linear P1 tetrahedron
     h 0.05000 -> 0.02500 : |e| 16.3127% -> 9.4526%   p = 0.787
     h 0.02500 -> 0.01250 : |e| 9.4526% -> 4.2623%   p = 1.149
     h 0.01250 -> 0.00625 : |e| 4.2623% -> 2.0571%   p = 1.051   ASYMPTOTIC
```

Theory for a linear P1 tetrahedron (Strang & Fix 1973; Ciarlet 1978) is O(h²) in
displacement and O(h¹) in stress. **Measured: 1.934 and 1.051.** Monotone, clean, at rate.

The Tet4 element, the assembly and the CG solver are therefore **not** the defect. On a
curved-boundary problem the same element reaches 4.3 % stress error at h = 0.0125 and
2.1 % at h = 0.00625 — inside a NAFEMS ±5/6 % band — while the NAFEMS cases sit at 43–62 %.
That is a factor-of-ten discrepancy that no element order explains.

**Tet10 is not the indicated remedy.** It would inherit both problems below unchanged.

---

## 4. What the gap IS: two measured defects, in order

### 4.1 The mesher has a hard-coded refinement ceiling (fixed here: made visible)

`forge::fea::tet::meshShape` seeds interior Steiner points on a lattice inside the shape
AABB and capped that lattice at `kMax = 20000` candidate points. Above the cap it
**inflated the spacing** to fit the budget — silently.

Measured on the LE1 slab (AABB 3.25 × 2.75 × 0.1), local element size at probe D:

```
targetEdge   tets   h_local   interiorSpacing  CAPPED
 0.05       38118   0.05078     0.04851         -
 0.04       57821   0.04367     0.03929         -
 0.032      60907   0.04255     0.03824        YES
 0.026      44563   0.04691     0.03571        YES
 0.020      64230   0.04201     0.03736        YES
```

`h_local` tracks `targetEdge` 1:1 down to 0.040 and then **freezes at ≈ 0.042** while
`targetEdge` is asked to go to 0.020. Tet count is non-monotone (57821 → 60907 → 44563).
An h-refinement study cannot be conducted through that floor, so no convergence claim about
these cases was ever admissible.

**Change made (behaviour-neutral by default):** `Mesh` now records `seedGridCapped`,
`seedGridBudget`, `requestedEdge`, `interiorSpacing`; `meshShape` /
`meshShapeFromHandle` take an optional `seedGridBudget` (0 ⇒ default 20000, overridable by
`FORGE_FEA_TET_SEED_BUDGET`, matching the existing `FORGE_THICKSOLID_NATIVE` /
`FORGE_BRIDGE_FACETED` escape-hatch convention); the N-API `fea.tet.meshShape` takes an
optional third argument and returns the four diagnostics. The gate prints them, and shouts
when the cap bound the run. Verified: with the default budget the gate output is identical
to before, line for line, except elapsed-millisecond fields.

### 4.2 …but the cap is not the whole story, and this is the important part

`test/fea_nafems_convergence.mjs` runs the full sweeps. For **LE10 the cap never binds** —
`h_local` falls from 0.286 to 0.111 (2.6×, tet count 1460 → 29250, 20×) — and the error
**does not move**:

```
targetEdge   tets   h_local   CAPPED   sigma[MPa]    err%
 0.30         1460  0.28607     -        -2.327    56.75
 0.24         2083  0.26790     -        -2.080    61.33
 0.20         3741  0.21775     -        -2.502    53.49
 0.15         7970  0.18143     -        -2.125    60.50
 0.115       15380  0.14358     -        -2.345    56.41
 0.09        29250  0.11085     -        -2.396    55.46
```

A 20× increase in element count buys **1.3 percentage points**. Under-resolution is
**refuted** as the cause for LE10.

**LE11 is worse than flat — it gets worse, then partly recovers**, and its cap never binds
either:

```
targetEdge   tets   h_local   CAPPED   sigma[MPa]    err%
 0.45         1134  0.16035     -       -86.612    17.51
 0.38         1203  0.16038     -       -92.565    11.84
 0.34         1491  0.15626     -       -86.975    17.17
 0.26         2253  0.12317     -       -59.664    43.18
 0.20         2840  0.11548     -       -63.960    39.09
 0.155        5130  0.11002     -       -71.750    31.67
```

The *coarsest* mesh gives the *best* answer (11.8 % at targetEdge 0.38). That is the
signature of an ill-posed setup, not of under-resolution — a converging model does not get
four times worse when you refine it, then start climbing back.

LE1's error improves erratically (−100 % → −41 %) and then stalls near −45 % well before
the cap binds.

Every sequence is non-monotone, so Richardson extrapolation / GCI (ASME V&V 20-2009) does
not apply to any of them — which is why the `p` values in §2 are noise rather than rates.

**Conclusion: the residual 40–60 % is a MODELLING error in the LE1/LE10/LE11 setups inside
`fea_nafems_gate.mjs`, not a discretisation error.** A stress that is flat under refinement
is wrong for a reason that a finer mesh cannot reach.

---

## 5. Costed plan

Ranked by measured evidence, cheapest and highest-value first. Item 4 (Tet10) is last on
purpose: it is the one the previous note proposed, and it is the one the measurements say
to do last.

**1. Audit the three model setups against TNSB Rev.3 clause by clause. — 1–2 days, no
kernel change.**
This is where the 40–60 % lives (§4.2). Specific things to check, in the order they are
most likely to matter:
 - **Probe sampling.** LE10's target is a bending stress on the *top surface*; the gate
   reads a **nodal average** of incident constant-strain elements, whose centroids sit at
   depth ≈ h/2 where the bending stress is lower. LE1's probe requests z = 0.05
   (mid-thickness) but reports landing at z = 0.00 — the face the model pins in z.
 - **Boundary-set tolerance.** `onOuterEllipse` uses `|f − 1| < 0.06` in *normalised*
   ellipse units, which near (3.25, 0) is a radial band ≈ 0.098 m wide — it constrains and
   loads a band of interior nodes, not a surface.
 - **LE1 is plane stress**; the gate pins u_z = 0 over the entire z = 0 face, which is not
   a plane-stress condition.
 - **Load direction.** LE1 applies pressure along each *facet's own normal* to any face
   whose three vertices fall in the outer band — which includes top/bottom-face triangles
   near the rim, loading them along ±z.
 Cheap decisive test for each: re-run the case on the **structured** mesh machinery already
 built in `test/fea_tet4_convergence.mjs`, which removes the mesher from the equation.

**2. Make the mesher affordable, then raise the budget. — 3–5 days.**
Measured cost of `meshShape` on the LE1 slab:

```
targetEdge   tets    meshMs    ms/tet
 0.17         1351     1679    1.2428
 0.12         2260     2852    1.2619
 0.09         7927     9798    1.2360
 0.065       14650    18364    1.2535
 0.05        38118    47722    1.2520
 0.04        57821    73669    1.2741
```

**Read this carefully, because it is not what the code reads like.** `bowyerWatson()`
locates each inserted point by a linear scan over every tet ever created and never compacts
dead ones — O(N·T) by construction — so the obvious prediction is quadratic growth. The
measurement says otherwise: **ms/tet is flat at ~1.25 across a 43× range.** The cost is
roughly *linear* here, with an enormous constant: ~1.25 ms per tetrahedron, about three
orders of magnitude slower per element than a production Delaunay refiner. 60k tets costs
74 s, which is why the 20000-point budget exists.

A constant-factor problem is the cheaper kind. Profile before optimising, and profile the
right thing — the candidates in order of suspicion:
 - `BRepClass3d_SolidClassifier::Perform`, called once per interior seed candidate **and**
   once per Bowyer-Watson tet centroid. Each call walks the B-rep. A cheap discriminating
   test: mesh a box and an ellipsoid-derived solid to the same tet count and compare ms/tet.
 - the uncompacted linear scan in `bowyerWatson()` — real, but not dominant in this range;
   it will start to bite at larger N.
If the scan does become dominant, the standard remedies are spatial point location — a
Delaunay hierarchy (Devillers, *The Delaunay hierarchy*, IJFCS 13(2), 2002) over Bowyer
(1981) / Watson (1981) — or adopting a proven Delaunay refiner rather than maintaining one:
Si, **TetGen**, ACM TOMS 41(2):11, 2015, which also brings constrained boundary recovery and
Shewchuk-style quality guarantees the current seeder has none of.
This is a prerequisite for *any* convergence claim, including Tet10's.

**3. Boundary-layer / graded refinement at the probe. — 2 days, after 2.**
The current seeder is a uniform AABB lattice; the NAFEMS quantities are surface stresses at
a stress riser. Even at rate, uniform O(h) stress convergence is an expensive way to buy
accuracy at one point. Standard remedy: refine toward the boundary, or use the
superconvergent-patch-recovery estimator (Zienkiewicz & Zhu, IJNME 33, 1992) to drive it.

**4. Quadratic Tet10 with curved edges. — 2–3 weeks. Do this LAST.**
It would lift stress convergence from O(h) to O(h²) and remove the faceting error at curved
boundaries, and it is the right long-term element. But it is not what is costing 40–60 %
today (§3), it inherits the O(N²) mesher and the seed ceiling unchanged (§4.1), and it
cannot fix a model setup error (§4.2). Sequencing it first would spend three weeks and move
the measured numbers very little.

---

## 6. What is owed

The three cases stay in `test/fea_nafems_baseline.txt` as known misses. The ratchet keeps
them visible on every CI run and goes red the moment the count or the set changes in either
direction. Lower the baseline — never raise it — when item 1 above closes a case.
