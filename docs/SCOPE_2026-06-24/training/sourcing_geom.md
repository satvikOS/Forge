# Source Taxonomy — CLUSTER: Geometry · Computational Geometry · Differential Geometry · CAD-math · Parametric / B-rep math

> SCOPE_2026-06-24 / training. Research-grade **sourcing taxonomy** for the geometry
> field cluster that grounds `scripts/bulk_synth_geom.py` (Archie 14B; Qwen2.5-14B +
> DeepSeek-R1 reasoning, 4-bit qLoRA, 36 GB M4-Max ceiling).
>
> This is the **answer key + provenance** for the synth generator: every numeric a
> sample asserts must reproduce a value that is either (a) computed exactly in Python
> from a closed-form theorem, or (b) a *named published reference constant* listed in
> §5. Companion to `cad-cam-cae-core.md` (which owns the validity / shape / topology
> CADGenBench axes); this doc owns the *mathematical substrate* — the geometry,
> differential geometry, and CAD-math that the kernel and the model must agree on.
>
> **House discipline (memory rules):** bulk_synth programmatic generation (agents top
> out at 40–60 samples; bulk_synth = millions); deterministic given `--seed`; every
> numeric COMPUTED in Python, never fabricated; honesty (state when a method is
> approximate / probabilistic / locally convergent); inline source citation
> (modeled-on, **not** verbatim copyrighted text); every sample tagged with a
> curriculum level (BSc / MSc / PhD / industrial).

---

## 0. SCOPE — what this cluster covers

The cluster spans the full chain from *exact rational arithmetic on geometric
primitives* up to *Class-A differential-geometric surface quality*, organised as
13 sub-fields (matching the generator's FIELD A–M):

| Tag | Sub-field | Core question class |
|-----|-----------|---------------------|
| A | **Robust geometric predicates** | orient2d/3d, incircle, insphere, FP error filters, adaptive precision, Simulation of Simplicity |
| B | **Convex hull** | Graham scan, QuickHull, gift-wrapping, Chan, shoelace, complexity |
| C | **Delaunay / Voronoi** | circumcircle, empty-circle, Lawson flip, Euler relations, Bowyer–Watson, duality |
| D | **Sweep / segment intersection** | Bentley–Ottmann, parametric line intersection, point–line distance |
| E | **Minkowski sum / straight skeleton** | offset area (Steiner), C-space obstacles, skeleton events, clearance |
| F | **NURBS / B-splines** | Cox–de Boor, knot insertion (Boehm), degree elevation, rational eval, SSI, Bézier extraction |
| G | **Subdivision surfaces** | Catmull–Clark, Loop (Warren β), limit positions, extraordinary vertices |
| H | **Mesh decimation** | quadric error metric (Garland–Heckbert), edge collapse, guards |
| I | **Surface parameterization** | LSCM (conformal), ARAP, angle/area distortion, gauge / pinning |
| J | **Point-cloud registration** | ICP (point-to-plane), RANSAC iteration count, plane fit, FPFH, voxel downsample |
| K | **Surface reconstruction** | screened Poisson vs ball-pivoting, PCA normals, octree depth |
| L | **Curve/surface continuity & Class-A** | G0–G3, curvature combs, zebra/reflection, G2 control-row conditions |
| M | **Metrology / GD&T-from-points** | flatness, circularity, cylindricity, best-fit RMS, GUM uncertainty, true position |
| N | **Differential-geometry & CAD-math anchors** *(new)* | curvature/torsion, Gauss–Bonnet, mean/Gaussian curvature, first/second fundamental form, Frenet, geodesics, exact-conic NURBS — each pinned to a published reference value |

Sub-field **N** is the new *known-answer validation* spine: every row asserts a
computed quantity against a theorem-exact constant (see §5).

---

## 1. NAMED INSTITUTIONS & COURSES (the curriculum these samples emulate)

> The generator's framing, topic ordering, and rigor target are modeled on these
> canonical graduate/undergraduate courses. (We do not reproduce any course text;
> we reproduce the *standard results* those courses teach, which are public domain
> mathematics.)

**Computational geometry**
- **MIT 6.838 — Algorithms for Computer Animation / Geometry Processing** (and the
  older 6.850 Geometric Computing) — predicates, hulls, Delaunay, mesh processing.
- **MIT 18.S190 / Geometry Processing** and **MIT CSAIL** (Solomon, *A Course in
  Discrete Differential Geometry*).
- **Stanford CS268 — Geometric Algorithms** and **CS348a — Computer Graphics:
  Geometric Modeling** (NURBS, subdivision).
- **CMU 15-462/662 — Computer Graphics** + **CMU 15-869 Geometry Processing**
  (Crane's *Discrete Differential Geometry: An Applied Introduction*).
- **Princeton COS 526 — Advanced Computer Graphics** (mesh, reconstruction).
- **Caltech / Multi-Res Modeling Group** (Schröder, Desbrun) — subdivision,
  discrete exterior calculus.
- **UC Berkeley CS 274 — Computational Geometry** (Shewchuk) — robust predicates,
  Delaunay refinement, mesh generation.
- **ETH Zürich / EPFL — Computer Graphics & Geometry Processing** (Sorkine-Hornung,
  Pauly) — ARAP, parameterization, libigl.

**Differential geometry**
- **MIT 18.950 — Differential Geometry** (curves & surfaces, do Carmo level).
- **Harvard Math 136 — Differential Geometry**; **Princeton MAT 365**.
- **Stanford Math 143 — Differential Geometry of Curves and Surfaces.**

**CAD-math / geometric modeling**
- **University of Cambridge — CAD/CAM** and the **Geometric Modelling** tradition
  (Martin, Sabin).
- **Rensselaer / Cornell — Geometric & Solid Modeling** (B-rep, Euler operators).
- Industry kernel teams (Parasolid/Siemens, ACIS/Spatial, OpenCASCADE) — the
  *engineering* tier of §2.

---

## 2. AUTHORITATIVE TEXTS & REFERENCE STANDARDS

**Computational geometry**
- **de Berg, Cheong, van Kreveld, Overmars — *Computational Geometry: Algorithms
  and Applications* (3rd ed.)** — the canonical text: line-segment intersection
  (Bentley–Ottmann), convex hulls, Delaunay/Voronoi, arrangements.
- **Preparata & Shamos — *Computational Geometry: An Introduction*.**
- **O'Rourke — *Computational Geometry in C*.**
- **J. R. Shewchuk — *Adaptive Precision Floating-Point Arithmetic and Fast Robust
  Geometric Predicates* (Discrete & Computational Geometry, 1997)** — orient2d/3d,
  incircle, insphere, the error-filter bound `(3 + 16ε)·ε·permanent`.
- **Edelsbrunner & Mücke — *Simulation of Simplicity* (ACM TOG, 1990)** — symbolic
  perturbation εᶦ tie-breaking.

**Differential geometry**
- **do Carmo — *Differential Geometry of Curves and Surfaces*** — Frenet frame,
  first/second fundamental forms, Gaussian & mean curvature, Gauss–Bonnet, geodesics.
- **Pressley — *Elementary Differential Geometry*** (worked-example companion).
- **Kreyszig — *Differential Geometry*.**
- **Crane — *Discrete Differential Geometry: An Applied Introduction* (CMU)** —
  discrete curvature, cotangent Laplacian.

**NURBS / CAGD**
- **Piegl & Tiller — *The NURBS Book* (2nd ed.)** — knot vectors, Cox–de Boor,
  Boehm knot insertion, degree elevation, exact-conic weights, surface evaluation.
- **Farin — *Curves and Surfaces for CAGD: A Practical Guide* (5th ed.)** — Bézier,
  de Casteljau, blossoming, continuity (Cⁿ vs Gⁿ).
- **Hoschek & Lasser — *Fundamentals of Computer Aided Geometric Design*.**
- **Cohen, Riesenfeld, Elber — *Geometric Modeling with Splines*.**

**Subdivision / mesh processing**
- **Warren & Weimer — *Subdivision Methods for Geometric Design*** (Loop β,
  Catmull–Clark masks, limit-position stencils).
- **Botsch, Kobbelt, Pauly, Alliez, Lévy — *Polygon Mesh Processing*** — QEM
  decimation, LSCM/ARAP parameterization, remeshing, reconstruction.
- **Garland & Heckbert — *Surface Simplification Using Quadric Error Metrics*
  (SIGGRAPH 1997).**
- **Catmull & Clark (1978); Loop (1987 MSc thesis); Doo–Sabin (1978).**

**Reconstruction / registration**
- **Kazhdan & Hoppe — *Screened Poisson Surface Reconstruction* (ACM TOG 2013).**
- **Bernardini et al. — *The Ball-Pivoting Algorithm* (IEEE TVCG 1999).**
- **Besl & McKay — *A Method for Registration of 3-D Shapes* (ICP, IEEE PAMI 1992)**;
  **Chen & Medioni** (point-to-plane); **Rusu et al. — FPFH (ICRA 2009).**

**CAD literature (Forge alignment)**
- **DeepCAD (Wu et al., ICCV 2021)**, **Fusion 360 Gallery (Willis et al.)**,
  **BRepNet (Lambourne et al., CVPR 2021)**, **AutoBrep**, **SolidGen** —
  command-sequence / B-rep representation learning (see
  `../../SCOPE_2026-06-21/research/parametric_cad_literature_2026.md`).

**Standards & reference frameworks**
- **ASME Y14.5-2018 — Dimensioning and Tolerancing** (true position, flatness,
  circularity, cylindricity definitions; min-zone vs least-squares).
- **ISO 1101 / ISO 12781 (flatness) / ISO 12180 (cylindricity) / ISO 12181
  (roundness)** — GPS geometrical tolerancing.
- **JCGM 100:2008 — *Evaluation of measurement data — GUM*** (combined & expanded
  uncertainty, coverage factor k).
- **ISO 10303 (STEP) AP242** — B-rep + PMI exchange (the geometry the kernel writes).
- **Euler–Poincaré formula** `V − E + F = 2(S − H) + R` — topological invariant.

---

## 3. KEY RESEARCH LITERATURE (beyond the textbooks)

- Shewchuk (1997) — robust predicates; Shewchuk (2002) — *Delaunay refinement*.
- Edelsbrunner & Mücke (1990) — Simulation of Simplicity.
- Bentley & Ottmann (1979) — *Algorithms for reporting and counting geometric
  intersections* (O((n+I) log n)).
- Barber, Dobkin, Huhdanpaa (1996) — *The Quickhull Algorithm* (Qhull).
- Chan (1996) — optimal output-sensitive convex hull O(n log h).
- Fortune (1987) — sweepline Voronoi; Bowyer (1981) / Watson (1981) — incremental
  Delaunay.
- Lévy, Petitjean, Ray, Maillot (2002) — *Least Squares Conformal Maps* (LSCM).
- Liu, Zhang, Xu, Gotsman, Gortler (2008) — *A Local/Global Approach to Mesh
  Parameterization* (ARAP).
- Garland & Heckbert (1997) — QEM; Hoppe (1996) — progressive meshes.
- Kazhdan, Bolitho, Hoppe (2006) / Kazhdan & Hoppe (2013) — (screened) Poisson.
- Rusu, Blodow, Beetz (2009) — FPFH; Besl & McKay (1992) — ICP.
- DeepCAD, BRepNet, Fusion360 Gallery, AutoBrep, SolidGen (CAD-ML; Forge alignment).

---

## 4. CURRICULUM LADDER (BSc → MSc → PhD → industry) per sub-field

> The generator tags **each** sample with one of these four levels; the level is
> driven by the *intrinsic difficulty of the question*, not chosen at random.

### A · Robust predicates
- **BSc** — sign of a 2×2/3×3 determinant; orient2d as signed area; left/right test.
- **MSc** — incircle/insphere as 4×4/5×5 determinants; Delaunay empty-circle.
- **PhD** — adaptive-precision expansions; the `(3+16ε)·ε·permanent` static filter;
  Simulation of Simplicity εᶦ perturbation; exact vs filtered escalation.
- **Industry** — *why* a kernel boolean fails after ~30 subtractions when predicates
  are naive floats; choosing the filter to keep 99 % of calls fast yet 100 % correct.

### B · Convex hull
- **BSc** — shoelace area; left-turn test in a Graham scan.
- **MSc** — QuickHull apex by max perpendicular distance; gift-wrapping O(nh).
- **PhD** — Chan's O(n log h) optimality; output-sensitivity proofs.
- **Industry** — hull choice for a point cloud (n, h regimes); degeneracy handling.

### C · Delaunay / Voronoi
- **BSc** — circumcenter/circumradius of a triangle.
- **MSc** — Lawson edge flip via incircle; Euler triangle/edge counts (2n−2−h).
- **PhD** — Bowyer–Watson star-shaped-cavity invariant; randomized O(n log n).
- **Industry** — Voronoi duality for tool-path / lattice seeding; robustness coupling.

### D · Sweep / intersection
- **BSc** — point–line distance; parametric line intersection by Cramer.
- **MSc** — segment-intersection by four orient2d signs; on-segment sub-test.
- **PhD** — Bentley–Ottmann O((n+I) log n); status BST + event queue invariants.
- **Industry** — robust near-parallel handling (error bound vs `==0`); 3-way crossings.

### E · Minkowski / skeleton
- **BSc** — Minkowski sum of two AABBs (summed extents).
- **MSc** — convex–convex sum has m+n edges; Steiner outward-offset area.
- **PhD** — straight-skeleton edge vs split events; non-convex decomposition O(m²n²).
- **Industry** — C-space obstacle for tool clearance; pocketing offsets.

### F · NURBS / B-splines
- **BSc** — clamped knot count = #cp + p + 1; partition-of-unity basis.
- **MSc** — Cox–de Boor recursion; Boehm knot insertion α-blend; degree elevation.
- **PhD** — rational exact conics (corner weight = cos(half-angle)); SSI marching/Newton.
- **Industry** — Bézier extraction for tessellation/IGA; continuity vs knot multiplicity.

### G · Subdivision
- **BSc** — face-count ×4 per Catmull–Clark step.
- **MSc** — Catmull–Clark vertex rule (Q+2R+(n−3)P)/n; Loop Warren β.
- **PhD** — subdivision-matrix eigenstructure; C² vs C¹ at extraordinary vertices.
- **Industry** — push-to-limit positions/normals; minimizing extraordinary vertices for Class-A.

### H · Decimation (QEM)
- **BSc** — squared point–plane distance (n·v + d)².
- **MSc** — quadric Q = Σ ppᵀ; greedy min-cost edge collapse; Q_new = Q_a + Q_b.
- **PhD** — optimal vertex placement via 3×3 solve; error bounds; feature preservation.
- **Industry** — normal-flip / boundary guards; LOD pipelines.

### I · Parameterization
- **BSc** — angle/area distortion definitions.
- **MSc** — LSCM conformal energy; 2-pin gauge fixing; ARAP local/global.
- **PhD** — discrete conformal theory; ARAP convergence; cone singularities.
- **Industry** — UV unwrap quality (distortion histograms); seam/cut choice.

### J · Registration
- **BSc** — RMS residual; least-squares plane through 3 points.
- **MSc** — point-to-plane residual; RANSAC iteration count N = log(1−p)/log(1−wˢ).
- **PhD** — ICP local-convergence theory; FPFH Darboux descriptor; global registration.
- **Industry** — voxel downsample for speed; coarse→fine pipeline; leaf-size choice.

### K · Reconstruction
- **BSc** — PCA normal as least-variance eigenvector; sign ambiguity.
- **MSc** — ball-pivoting radius vs spacing; octree depth → grid resolution.
- **PhD** — screened-Poisson PDE; oriented-normal field; watertight isosurface.
- **Industry** — Poisson vs BPA selection; hole-filling vs feature fidelity trade-off.

### L · Continuity / Class-A
- **BSc** — curvature κ = 1/R; curvature-comb tooth length.
- **MSc** — G0–G3 hierarchy; zebra-stripe diagnosis; curvature jump.
- **PhD** — G2 control-row conditions (cross-derivative matching); torsion continuity.
- **Industry** — reflection-line acceptance; rebuilding joins to G2/G3 highlights.

### M · Metrology / GD&T
- **BSc** — flatness = peak-to-valley; circularity = R_max − R_min.
- **MSc** — best-fit RMS; cylindricity; true position = 2√(dx²+dy²).
- **PhD** — min-zone (Chebyshev) vs least-squares; GUM combined/expanded uncertainty.
- **Industry** — datum/3-2-1/RPS alignment; MMC bonus tolerance; certify with min-zone.

### N · Differential geometry & CAD-math anchors
- **BSc** — circle κ = 1/R; sphere area/volume.
- **MSc** — helix curvature/torsion; Frenet frame; arc length.
- **PhD** — Gaussian/mean curvature from fundamental forms; Gauss–Bonnet; minimal surfaces.
- **Industry** — exact-conic NURBS weights; curvature continuity tie-back to Class-A.

---

## 5. KNOWN-ANSWER VALIDATION ANCHORS (the answer key)

> These are *named published reference values*. The generator **asserts** each
> computed result equals (to tolerance) the constant below. If any assert fails the
> generator aborts — so a shipped corpus is provably anchored. (Sources cited inline.)

| # | Anchor (named) | Reference value | Source |
|---|----------------|-----------------|--------|
| N1 | Curvature of a circle radius R | κ = 1/R (e.g. R=2 → κ=0.5) | do Carmo §1-5 |
| N2 | Helix x=a cos t, y=a sin t, z=b t curvature | κ = a/(a²+b²) | do Carmo §1-5; Pressley §1.3 |
| N3 | Same helix torsion | τ = b/(a²+b²) | do Carmo §1-5 |
| N4 | Unit sphere radius R Gaussian curvature | K = 1/R² (R=1 → K=1) | do Carmo §3-3 |
| N5 | Sphere radius R mean curvature | H = 1/R (sign per normal) | do Carmo §3-3 |
| N6 | Sphere surface area / volume | A = 4πR², V = (4/3)πR³ | classical |
| N7 | Catenoid (minimal surface) mean curvature | H = 0 everywhere | do Carmo §3-3; minimal-surface defn |
| N8 | Gauss–Bonnet over a closed surface genus g | ∬K dA = 2πχ = 2π(2−2g); sphere → 4π, torus → 0 | do Carmo §4-5 |
| N9 | Euler characteristic of any convex polyhedron | V − E + F = 2 (χ=2) — tetra 4-6-4, cube 8-12-6, octa 6-12-8, dodeca 20-30-12, icosa 12-30-20 | Euler; Coxeter |
| N10 | Torus (R,r) surface area / volume | A = 4π²Rr, V = 2π²Rr² | Pappus |
| N11 | NURBS exact quarter-circle middle weight | w = cos(45°) = √2/2 ≈ 0.7071 | Piegl & Tiller §7.5 (conic via rational Bézier) |
| N12 | Cox–de Boor basis partition of unity | Σᵢ Nᵢ,p(u) = 1 for any u in span | Piegl & Tiller §2.2; Farin |
| N13 | Clamped B-spline knot count | #knots = #cp + p + 1 | Piegl & Tiller §2.5 |
| N14 | Delaunay triangle / edge count (n pts, h hull) | T = 2n − 2 − h, E = 3n − 3 − h | de Berg §9 |
| N15 | Convex polygon shoelace area (unit square) | A = 1 for (0,0),(1,0),(1,1),(0,1) | classical |
| N16 | Regular tetrahedron edge a circumradius | R = a·√(3/8) = a√6/4 | Coxeter, *Regular Polytopes* |
| N17 | Shewchuk orient2d static error filter | errbound = (3 + 16ε)·ε·permanent | Shewchuk 1997 |
| N18 | RANSAC iteration count | N = ⌈log(1−p)/log(1−wˢ)⌉ | Fischler & Bolles 1981 |
| N19 | Loop subdivision regular β (valence 6) | β = 3/(8·6) = 1/16 = 0.0625 | Loop 1987; Warren |
| N20 | GUM expanded uncertainty (k=2) | U = 2·√(Σuᵢ²), ~95 % coverage | JCGM 100:2008 |
| N21 | Viviani curve (sphere∩cylinder) max curvature etc. | analytic closed form | do Carmo exercises |
| N22 | True position deviation | dev = 2√(dx²+dy²) | ASME Y14.5 |
| N23 | Catmull–Clark face growth | F·4ᴸ after L steps | Catmull & Clark 1978 |
| N24 | Cube (edge a) → sphere area ratio sanity | — used as cross-check only | — |

These 24 anchors are embedded in the new **FIELD N (`g_anchors`)** generator and in
the generator's **`--selfcheck`** path, which recomputes each and asserts equality to
the published constant before any corpus is written.

---

## 6. HOW THE GENERATOR USES THIS DOC

1. **Inline citation** — every assistant answer names its governing source
   (`(de Berg §2)`, `(Piegl & Tiller §2.5)`, `(do Carmo §3-3)`, `(per ASME Y14.5)`,
   `(Shewchuk 1997)`, `(JCGM 100:2008 / GUM)`, …) — modeled-on, never verbatim.
2. **Validated numerics** — FIELD N computes each anchored quantity and `assert`s it
   against the §5 reference; non-N fields compute every numeric in Python (no fabricated
   answers).
3. **Curriculum spread** — each sample is tagged BSc/MSc/PhD/industrial by intrinsic
   difficulty (§4), carried in `meta.level`.
4. **PhD-grade reasoning** — derivations state the theorem, the regime of validity, and
   the *honest limitation* (approximate/probabilistic/locally-convergent) where one applies.
5. **CLI/schema unchanged** — `--out/--cap/--seed/--report-every` and the chat-JSONL row
   shape `{messages:[system,user,assistant], meta:{field,topic,level}}` are preserved so
   `generate_corpus_v3.sh` (`bulk_synth_geom:250000:S1-geometry`) keeps working; a new
   `--selfcheck` flag runs the anchor asserts without writing a corpus.
