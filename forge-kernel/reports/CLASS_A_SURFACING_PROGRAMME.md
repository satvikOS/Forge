# Class A / B / C / D surfacing — what it means for this kernel, and what it would take

Design track. Pinned to `32ee7485`. Every count and every number below was
re-measured in this worktree; where a number came from running code, the binary
and the probe are named so it can be re-run.

**One-line summary.** The surfacing *machinery* is largely present — about 5,700
lines of real NURBS, Coons, Gregory and diagnostic code — and the honest blocker
is not missing math. It is that (a) none of it is nameable in the feature-tree
IR, so Archie cannot reach it, and (b) **two of the four continuity metrics the
kernel would grade a Class A surface with were not measuring anything.** One was
inverted; one was identically zero. Both are demonstrated below with a positive
control. A Class A claim graded on those metrics would have been marketing.

---

## 0. Three corrections to the starting brief

The brief asked me to verify its own ground truth before relying on it. Three
items did not survive.

**0.1 — `"Class A" ZERO` is a spelling artifact, not an absence.** Reproduced in
`forge-kernel/src`:

| pattern | files |
|---|---|
| `Class A` (with a space) | **0** |
| `ClassA` | **6** |
| `Class-A` | **4** |

`src/ClassASurfacing.cpp` is 760 lines of live, compiled, bound, *working*
Class-A diagnostics. The brief's premise that surfacing capability is absent
because there is no SURFACE value kind is half right: the *authoring* story is
gated that way, but a substantial *analysis* story already exists and is being
overlooked because of one space character.

**0.2 — the other greps are real, and reproduce exactly.** `NURBS 58 · Sweep 68
· G2 32 · Loft 27 · curvature 21 · SubD 18 · Bezier 16 · BSpline 24` all
reproduce to the file. Spot-checked for substance, not comments — see §2.

**0.3 — the IR premise is confirmed.** `forge/ft/FeatureTree.hpp` `enum class
OpCode` carries exactly the 40 ops listed, and
`implementation/sacrosanct/archie_op_vocabulary.json` computes
`value_kind_closure.produced_by_allowed_ops = ["PROFILE","SOLID","WIRE"]` with
`gaps: []`. `kernel_ops: 40`, `user_invocable_ops: 18`, `forbidden_ops: 22`, and
all 22 carry the identical reason string *"no command in the forge::ui registry
emits it"*. There is no SURFACE value kind. That part of the brief is exactly
right.

---

## 1. The four classes, in engineering terms, with measurable acceptance criteria

Class A/B/C is a *surface quality* classification, not a geometry type. It says
who looks at the surface and therefore what continuity and tolerance it must
hold. Conventions differ between OEMs; Class D in particular is not universal
(some houses stop at C, some use D for non-geometric or mesh-only data). The
definitions below are the defensible engineering core, stated so that each one
is checkable on a B-rep rather than argued about.

The acceptance criterion for each class is **(continuity order) × (tolerance) ×
(instrument)**, evaluated on *every internal boundary within the region of that
class* — not on the part as a whole. A part is normally a mixture of classes.

### Class A — styled show surface
The customer sees it and judges it by its reflections: exterior body panels,
visible interior trim, a consumer product's outer shell.

* **Continuity:** G2 across every patch boundary inside the show region; G3
  where a highlight sweeps *across* a boundary (long, shallow, near-planar
  panels — the case where a G2 join is still visible as a "flat spot").
* **Tolerance:** position ≤ 0.001 mm; tangent ≤ 0.05°; curvature ≤ 0.5%
  relative.
* **Additional, and this is the one that separates Class A from "a G2 model":**
  highlight behaviour must be *controlled* — reflection lines continuous and
  monotone, no unintended curvature sign flips, no isolated curvature spikes.
  A surface can be mathematically G2 and still be rejected by a reviewer for an
  ugly highlight. This is why the zebra and curvature-comb instruments exist and
  why a continuity number alone is not a Class A certificate.
* **Instrument:** per-edge continuity report over the region, *plus* zebra
  stripe-continuity, *plus* a curvature-comb sign/spike check.

### Class B — functional surface derived from A
Visible only on inspection, or visible but not styled: door jambs, under-hood
visible panels, inner panels offset from the A-surface, the back of a bezel.

* **Continuity:** G1 across internal boundaries; G2 only where the surface runs
  into a Class A region (the transition must not import a defect into A).
* **Tolerance:** position ≤ 0.01 mm; tangent ≤ 0.5°.
* **Instrument:** per-edge continuity report. Highlight quality is *not*
  assessed.

### Class C — unseen structural / functional surface
Never seen in use: brackets, mounting bosses, ribs, weld flanges, internal
structure. Judged by fit, strength and manufacturability.

* **Continuity:** G0 with clean, watertight topology. Tangency required only
  where manufacturing demands it (draft faces, tool radii, sealing surfaces).
* **Tolerance:** position ≤ 0.05 mm; tangent unconstrained except on
  called-out faces.
* **Instrument:** shape/watertightness check plus the existing solid
  invariants (`genus`, `shells`, `volume`). Curvature is not assessed.

### Class D — representation-only surface
Not a manufacturing surface at all: visualisation meshes, packaging/envelope
volumes, simplified stand-ins for downstream CAE or layout. Stated here because
the brief asked for four, with the honest note that this is the least
standardised of the four and several OEMs do not use it.

* **Continuity:** none required. Must be watertight enough for its consumer
  (a mesher, a clash check).
* **Tolerance:** position ≤ 0.1 mm or whatever the consumer needs; no
  continuity claim is made or implied.
* **Instrument:** watertightness / closure only.

### The criteria as assertions

The point of stating the criteria this way is that each becomes a line a
`VERIFY` can carry. With the surface keys proposed in §5:

```
# a Class A show region
%40 = TAG(%39, "@hood", "kind=bspline & area>500")
%41 = VERIFY(%40, "@hood.continuity.order >= 2",
                  "@hood.g0.max.mm <= 0.001",
                  "@hood.g1.max.deg <= 0.05",
                  "@hood.g2.max.pct <= 0.5",
                  "@hood.zebra.breaks = 0",
                  "@hood.curvature.signflips = 0")

# a Class C bracket
%42 = VERIFY(%41, "genus = 0", "shells = 1", "g0.max.mm <= 0.05")
```

That is the whole design goal in six lines: a class is a *named region plus a
set of asserted numbers*, and nothing about it is a matter of opinion.

---

## 2. Capability census — verified, not grepped

Counts are lines of implementation, and every entry point marked **live** was
called against a real built binary
(`forge-kernel/build-makepipe/forge-kernel.node`) in this session.

### 2.1 Analysis — `forge::classa` (`src/ClassASurfacing.cpp`, 760 lines) — LIVE

All six entry points are exported and callable; verified by enumerating the
namespace on the built binary:

```
classa:    zebraStripes, curvatureComb, continuityCheck,
           gaussianAndMeanCurvature, stitchG2, sweepWithGuides
surfacing: buildPatch, trim, sew, refine, eval, intersect,
           projectPoint, classAAnalyse
```

| function | what it actually does | status |
|---|---|---|
| `zebraStripes` | normals on a UV grid via `BRepLProp_SLProps`, projected through a virtual light, bucketed into stripes | real |
| `curvatureComb` | signed curvature + Frenet normal along an edge via `BRepLProp_CLProps` | real |
| `continuityCheck` | G0/G1/G2/G3 maxima across a shared edge | **G0/G1 real; G2 was inverted; G3 inert — §3** |
| `gaussianAndMeanCurvature` | per-UV K, H, κmin, κmax via `GeomLProp_SLProps` | real |
| `stitchG2` | `BRepBuilderAPI_Sewing` + per-shared-edge continuity report | real (inherits the continuity defects) |
| `sweepWithGuides` | guided `BRepOffsetAPI_MakePipeShell` | real |

### 2.2 Authoring — `forge::surfacing` (`src/Nurbs.cpp`, 811 lines) — LIVE

`buildNurbsPatch` (control grid → `Geom_BSplineSurface`, custom degree and knot
vectors accepted), `trimNurbsFace` (UV trim wire), `sewNurbsFaces`,
`refineNurbs` (degree elevation via `ShapeUpgrade_ShapeDivideContinuity`),
`evalSurface`, `intersectSurfaces`, `projectPointToSurface`, `classAAnalyse`
(curvature spread + isophote bucket count).

### 2.3 Native (OCCT-zero) surface family

| file | lines | what it provides |
|---|---|---|
| `native/brep/GregoryFill.cpp` | 904 | N-sided (N≥3) rational Gregory hole fill, **G1**, with an **additive G2 mode** (`GregoryBoundary::g2`). Interpolates boundary curves exactly and matches a prescribed cross-boundary tangent field. |
| `native/brep/SurfaceFill.cpp` | 840 | 4-sided Coons patch fill, **G1/G2**. |
| `native/brep/NurbsAlgebra.cpp` | 846 | `insertKnotR`, `removeKnot`, `elevateDegree` (curves); `elevateSurfaceDegree` (surfaces). |
| `native/brep/NurbsCalculus.cpp` | 372 | curve/surface derivative evaluation. |
| `native/surfit/Surfit.cpp` | 535 | `fitNurbsSurface` — point cloud → NURBS patch, with honest residual reporting (Chamfer, RMS, max). |
| `native/brep/NurbsSurface.cpp` | 326 | validation, evaluation with derivatives, tessellation. |

Core surface implementation across the ten principal files: **5,708 lines.**
This is a real capability base, not scaffolding.

### 2.4 What is genuinely absent

* **Surface fairing.** Documented as a follow-up *in both fill headers*
  (`GregoryFill.hpp`: "energy-minimising optimum … remains the documented
  Class-A follow-up"; `SurfaceFill.hpp`: "reflection-line / highlight-line
  FAIRING"). `Surfit`'s `lambda = 1e-8` is a **Tikhonov conditioning term on the
  diagonal, not a fairing energy** — it stabilises the solve, it does not
  minimise curvature variation. There is no thin-plate or curvature-variation
  energy anywhere in the kernel.
* **Surface knot insertion/removal.** Only `elevateSurfaceDegree` exists at
  surface level; `insertKnotR`/`removeKnot` are curve-only.
* **Patch boundary matching.** Nothing solves a patch's control net to meet a
  neighbour to a specified order.
* **Reflection/highlight-line analysis as a *metric*.** `zebraStripes` returns
  per-sample stripe indices — the raw material — but nothing reduces it to a
  number ("stripe breaks") that a gate could assert on.

---

## 3. ★ The instrument was broken — measured

This is the most important finding in the report, and it is the reason the
brief's requirement 5 ("a Class A claim that cannot be measured is marketing")
is not a hypothetical here.

### 3.1 The positive control

Two cubic B-spline patches sharing an edge. A clamped cubic interpolates its
first control row and leaves it along `(row1 − row0)`, so driving the join from
the **control net** — rather than sampling an analytic surface into it — makes
the tangent plane exact. Both patches put row 0 on the line `y=0, z=0` and row 1
flat in the `z=0` plane, so the join is G1 **by construction**; row 2 onward sets
each side's curvature independently. Sweeping only the curvature ratio isolates
G2 as the single variable.

The control is sound: `g0 = 1.8e-15 mm` and `g1 = 0.0000°` in every case below.

*(My first attempt at this control was wrong — I sampled `z = c·y²` into the
control net, which produces a genuine 4.58° kink, and I nearly reported that
kink as instrument noise. The control-net construction above is the corrected
one. Recorded because the failure mode is the point: an instrument check is only
as good as the positive control under it.)*

### 3.2 G2 ran inverted

Measured on `build-makepipe/forge-kernel.node`:

| join | true quality | `g2_max_pct` reported |
|---|---|---|
| identical curvature | **perfect G2** | **200.00%** |
| 2× curvature ratio | slight break | 150.00% |
| 10× curvature ratio | clear break | 110.00% |
| 40× curvature ratio | bad break | 102.50% |
| curved meets **flat** | **worst** | **100.00%** |

Monotonically **decreasing**. The perfect join scored worst; the worst join
scored best. Any gate of the form `g2 < tol` accepted **nothing** — and a
tolerance tuned until parts started passing would have been selecting *for the
flattest, worst joins*.

**Cause, measured directly.** Reading mean curvature off each face at the shared
edge:

```
faceA H at shared edge = 0.021467 , 0.021467 , 0.021467
faceB H at shared edge = -0.021467 , -0.021467 , -0.021467
```

Equal magnitude, opposite sign. Mean curvature is signed *with respect to the
face normal*, and two faces meeting on a sewn shell routinely carry opposite
outward normals. The G1 branch immediately above already corrects for this with
`std::abs(cosAng)`; the G2 branch did not, so it compared `+k` against `−k`:
`|k − (−k)| / k = 2 → 200%`. Every one of the five measured points is
reproduced exactly by `(kA + |kB|)/max(kA,|kB|)`, which confirms the model.

**Fixed in this PR** (`src/ClassASurfacing.cpp`): reuse the sign of the
normal dot product to orient `kB` before comparing. With the flip applied the
same sweep becomes `0%, 50%, 90%, 97.5%, 100%` — monotonic and thresholdable.

> **Honest status of the fix.** The defect and its cause are *measured*. The
> corrected numbers are *derived* from a model validated against all five
> measured points to the digit, **not yet observed from a rebuilt binary** — a
> from-scratch build of the 540-source OCCT-linked kernel was not a reasonable
> use of a machine currently shared with a 600-part A/B sweep. The regression
> test below is committed and **demonstrated to fail on the unfixed binary**, so
> the next build settles it either way.

### 3.3 G3 measures nothing at all

`g3_max_pct` is computed as `|(d1·nA) − (d1·nB)| · torsion(edge)`, where `d1` is
the **shared edge's tangent**. The edge lies on both faces, so `d1` is
perpendicular to both surface normals *by construction* and both projections are
identically zero.

Measured: `g3_max_pct = 0.000e+00` in **all five** cases above — including the
40× curvature jump and the curved-meets-flat join.

The `g3_max_pct < 5.0` clause in the verdict therefore never fails, and
`g3_continuity` is in truth a G0∧G1∧G2 verdict wearing a G3 label. This survived
because the existing `push07_classa_smoke.js` asserts only
`typeof cont.g3_max_pct === 'number'` — which a hardcoded zero passes.

I have **not** fabricated a fix. The computation is left in place with the field
shape intact, and the header and the call site now say plainly that the term is
inert and must not be thresholded. A real G3 needs third-order surface
derivatives (`Geom_Surface::D3`) compared across the boundary — scheduled in §6.

### 3.4 Even a correctly-oriented G2 is the wrong instrument

Worth stating now rather than discovering later. `continuityCheck` compares
**mean** curvature `H = (κ₁+κ₂)/2`. Two surfaces can share `H` and still differ
in their principal curvatures, so a genuine curvature break can score zero. The
textbook cross-boundary test is **normal curvature in the direction across the
edge**, from the second fundamental form — available from `BRepLProp_SLProps`
via the principal curvatures and directions and Euler's formula
`κ_n = κ₁cos²θ + κ₂sin²θ`. The orientation fix makes the current metric
*monotonic and usable*; this makes it *correct*. Scheduled in §6.

### 3.5 What this means for the Class A claim today

Forge cannot presently certify any surface to Class A, and could not have done
so before this PR — not because the surfaces are bad, but because the
instrument was inverted on one axis and dead on another. **The measurement work
is the prerequisite for the capability claim, not a follow-up to it.**

---

## 4. The gap, precisely

Three gaps, in descending order of how much they actually block.

**Gap 1 — representation.** No SURFACE value kind, so no op can produce or
consume a surface, so none of §2.2/§2.3 is reachable from the feature tree.
Archie emits IR; therefore Archie cannot author a surface. This is the
structural gap the brief identified and it is real. *(Being addressed by the
parallel SURFACE value-kind track — not duplicated here.)*

**Gap 2 — reachability of the analysis.** The `forge.classa` diagnostics are
reachable **only from JavaScript**, through the napi bindings. There is no IR op
and no `VERIFY` key for continuity, curvature, or zebra. So even for solids that
exist today, **Archie cannot ask a question about a surface, and cannot assert
on the answer.** Note that this gap does *not* depend on Gap 1 — see §6.

**Gap 3 — authoring depth.** Fairing absent; surface knot control partial; no
boundary matching; no reduction of zebra output to an assertable number.

### 4.1 The gap has teeth on the real ground truth

`archie_edit_214.log`, verified in this session — the INPUT face inventory is
**430 faces**: `cylinder 167, torus 125, bspline 67, sphere 25, cone 4, plane
42` (sums to 430). **67 faces, 15.6%, are B-spline.**

The compiler *does* classify them: `DirectEdit.cpp:330` maps
`GeomAbs_BSplineSurface → fi.kind = "bspline"`, so a selector can in principle
name one. But the edit ops refuse them:

* `PUSHFACE` — `throw "selector ... is a <kind> face"` unless `kind == "plane"`.
* `RESIZEBORE` — throws unless `kind == "cylinder"`.

So on the owner's own canonical fixture, roughly one face in six is
**selectable but not editable**. That is the gap made concrete.

---

## 5. Proposed op family

Signatures follow the existing `FeatureTree.hpp` style: `OP(%ref, args…)`,
optional keyword arguments with defaults, `%`-refs for values, quoted predicate
strings for selectors.

### 5.1 Authoring ops — all require the SURFACE value kind

| op | signature | consumes → produces | maps to |
|---|---|---|---|
| `PATCH` | `PATCH(nu, nv, [x y z; …] [, degU=3, degV=3])` | — → **SURFACE** | `surfacing::buildNurbsPatch` |
| `FITSURF` | `FITSURF([x y z; …] [, degU=3, degV=3, nu=6, nv=6])` | — → **SURFACE** | `surfit::fitNurbsSurface` |
| `FILLPATCH` | `FILLPATCH(%wire [, G1\|G2])` | WIRE → **SURFACE** | `fillCoonsPatch` (4-sided) / `fillGregoryPatch` (N-sided) |
| `TRIMSURF` | `TRIMSURF(%surf, [u v; …])` | SURFACE → **SURFACE** | `surfacing::trimNurbsFace` |
| `OFFSETSURF` | `OFFSETSURF(%surf, dist)` | SURFACE → **SURFACE** | `brep::offsetShape` |
| `ELEVATE` | `ELEVATE(%surf, U\|V, n)` | SURFACE → **SURFACE** | `elevateSurfaceDegree` |
| `MATCH` | `MATCH(%surf, "edge-sel", %target, "target-sel", G0\|G1\|G2)` | SURFACE → **SURFACE** | **new** — control-net solve |
| `FAIR` | `FAIR(%surf, strength [, FIXBOUNDARY])` | SURFACE → **SURFACE** | **new** — energy minimisation |
| `SEWSURF` | `SEWSURF(%s0, %s1 [, %s2 …] [, tol=1e-3])` | SURFACE… → **SOLID** | `classa::stitchG2` |
| `THICKEN` | `THICKEN(%surf, t)` | SURFACE → **SOLID** | `brep::thicken` |

`SEWSURF` and `THICKEN` are the bridges back to SOLID; without them a SURFACE is
a dead end and the rest of the 40-op vocabulary cannot consume the result.

`FITSURF` is the one that matters most for the ground truth: it is what lets a
reconstructed free-form face — one of the 67 — be *authored* rather than only
observed.

### 5.2 ★ Analysis ops — these are the ones that make a class claim checkable

Requirement 5 asks for an op that reports continuity order across an edge, whose
output is a number a `VERIFY` can assert on. `VERIFY`'s existing contract is a
keyed scalar assertion — `VERIFY(%body, "key <cmp> value", …)` over keys
`faces, edges, volume, holes, genus, shells, bbox.*, radial…` — so the natural
shape is a **pass-through measurement op in the `TAG`/`VERIFY` idiom** that binds
a named measurement, plus new `VERIFY` keys that read it.

```
CONTINUITY(%body, "@name", "selA", "selB" [, samples=32])
```

* consumes **SOLID**, produces **SOLID** — a pass-through, returning `%body`
  unchanged. (`TAG` sets the precedent, and for the stated reason: *"a naming
  mechanism that can alter the solid is a defect generator."* The same applies
  to a measuring one.)
* binds under `@name` the five numbers `continuityCheck` already computes, plus
  the derived **order**.
* maps to `forge::classa::continuityCheck`.

New `VERIFY` keys, readable either globally (worst over every shared edge of the
body) or scoped to a `CONTINUITY`/`TAG` name:

| key | meaning |
|---|---|
| `continuity.order` | **highest continuity order satisfied: 0, 1, 2, or 3** |
| `g0.max.mm` | worst position gap |
| `g1.max.deg` | worst tangent deviation |
| `g2.max.pct` | worst curvature deviation |
| `g3.max.pct` | worst curvature-rate deviation — *reserved until §3.3 is fixed* |
| `zebra.breaks` | count of stripe discontinuities (needs the reduction in §2.4) |
| `curvature.signflips` | principal-curvature sign changes within a face |
| `classa.pct` | fraction of faces in scope meeting the Class A criterion |

`continuity.order` is the direct answer to requirement 5 — the continuity order
across an edge, as an integer:

```
%50 = CONTINUITY(%49, "@seam", "face:12", "face:13")
%51 = VERIFY(%50, "@seam.continuity.order >= 2", "@seam.g2.max.pct <= 0.5")
```

**These ops do not need the SURFACE value kind.** They consume and produce
SOLID, and they measure faces of a solid that already exists. This is the
sequencing lever in §6.

### 5.3 ★ Designing against the "don't gate anything" constraint

The owner's constraint — *"don't gate anything; if you do that, how will Archie
generate ultra-long feature trees for the kernel to execute?"* — is the sharpest
design pressure on this family, because surfacing is exactly where a vocabulary
is tempted to start refusing things. Rules adopted:

1. **No op refuses a surface for being hard.** No cap on degree, patch count,
   knot count, or boundary-curve count. A gate on "too complex" fires hardest on
   the longest, densest, most curved trees — the valuable ones.

2. **Degrade and report; never throw.** `FILLPATCH(%w, G2)` on boundary data
   that cannot support G2 must produce the **G1** fill and report
   `achieved.order = 1`. The tree keeps building; the number tells the repair
   loop exactly what happened. This is the single most important rule here —
   the alternative (throwing) turns one difficult boundary into a dead
   thousand-op tree.

3. **Every measurement is a number, never a verdict.** `continuity.order` is an
   integer a planner can compare, not a boolean "Class A: pass". Booleans cannot
   be repaired toward.

4. **Errors, where genuinely unavoidable, name the face/edge/op.** The existing
   selector code is already good at this — `"@name no longer matches any face …
   nearest candidate is …"` is exactly right — and the surfacing ops should
   match it.

Two existing behaviours violate rule 1 and 2 and should be changed as part of
this programme:

* **`VERIFY` throws on an unknown key** — `"VERIFY: unknown quantity <key>"`
  aborts the whole tree. As surface keys are added incrementally, a planner that
  writes a key one version ahead of the kernel loses a thousand-op tree over a
  spelling. It should record the assertion as **UNMEASURED, naming the key**,
  and let the rest of the tree build. (The op vocabulary already reasons this
  way about spelling — it accepts `faces`/`faceCount`/`nfaces` precisely because
  *"rejecting `faceCount` while accepting `faces` fails a tree for spelling, not
  for being wrong about the geometry"*. The unknown-key path never got the same
  treatment.)
* **`PUSHFACE`/`RESIZEBORE` refuse non-planar / non-cylindrical faces** — §4.1.
  A free-form counterpart (`PUSHFACE` on a B-spline face = offset that face and
  re-trim its neighbours) removes the refusal on ~15.6% of the ground truth's
  faces. This is impediment removal, not a new feature.

---

## 6. Cost and sequencing — honestly

### ★ The key sequencing insight

**The analysis half is unblocked today.** `CONTINUITY` and the `VERIFY` surface
keys consume and produce SOLID, so they do **not** wait on the SURFACE value
kind. The authoring half does. And since §3 shows the instrument was broken,
measurement is also the thing that has to come first on the merits: every
authoring claim made before the instrument is trustworthy is unfalsifiable.

**Recommendation: ship measurement first.** It is unblocked, it is cheap, and it
is what makes everything after it checkable.

### Days

| work | estimate | depends on SURFACE? |
|---|---|---|
| G2 orientation fix + regression test | **done in this PR** (needs a build to confirm) | no |
| `VERIFY` unknown key → UNMEASURED instead of throw | 1 day | no |
| Reduce `zebraStripes` output to `zebra.breaks` | 2 days | no |
| `VERIFY` surface keys wired to `continuityCheck` (shared-edge enumeration already exists in `stitchG2`) | 3 days | no |
| `CONTINUITY` pass-through op | 3 days | no |

### Weeks

| work | estimate | depends on SURFACE? |
|---|---|---|
| Cross-boundary **normal** curvature G2 (§3.4) | 1–2 weeks | no |
| Real G3 via `Geom_Surface::D3` (§3.3) | 2 weeks | no |
| `PATCH` / `TRIMSURF` / `ELEVATE` / `SEWSURF` / `THICKEN` | 2–3 weeks after SURFACE lands | **yes** |
| `FITSURF` (wire up `surfit`) | 2 weeks | **yes** |
| `FILLPATCH` (wire up Coons + Gregory, with the degrade-and-report rule) | 3 weeks | **yes** |
| Free-form `PUSHFACE` (§4.1) | 2–3 weeks | no |

### Months

| work | estimate | note |
|---|---|---|
| `FAIR` — surface fairing | **2–3 months** | Genuinely absent. Needs a curvature-variation energy, a constrained solver, boundary preservation, and validation that it does not *degrade* continuity while smoothing. The two fill headers have flagged it as the Class-A follow-up for a reason. |
| `MATCH` — patch boundary matching to G2 | **2–3 months** | Control-net solve against a neighbour's boundary derivatives; the classical hard part of a Class A toolkit. |
| Highlight/reflection-line driven automatic fairing | **3+ months** | Depends on `FAIR`. |
| A genuine interactive Class A authoring environment | **6+ months**, mostly UI | Out of kernel scope. |

### Honest bottom line

* Forge can be made to **measure** toward Class A in roughly **two weeks**, all
  of it unblocked by the SURFACE track.
* Forge can be made to **author** Class-A-shaped geometry in roughly **two
  months** after the SURFACE value kind lands, reusing the Coons/Gregory/NURBS
  base that already exists.
* Forge is **months** away from Class A in the sense an automotive surfacing
  reviewer means it, and the gating item is **fairing**, which does not exist in
  any form.
* Nothing in this report supports a Class A capability claim today. §3 is the
  reason, and fixing §3 is the prerequisite for ever making one.

---

## 7. What this PR changes

Confined to files the SURFACE value-kind track does not touch (no
`FeatureTree.hpp`, no vocabulary JSON, no `forge::ui` registry).

1. `src/ClassASurfacing.cpp` — G2 orientation fix (§3.2), with the measured
   sweep recorded at the fix site; G3 inertness documented at the call site
   (§3.3). No behaviour change to G3.
2. `include/forge/ClassASurfacing.hpp` — corrected the `g3_continuity` contract
   (the old comment listed three terms where the code has always used four, and
   wrote the g2 bound as `0.05` where the code uses `5.0`); added the honest
   per-metric status block.
3. `test/classa_continuity_orientation_test.js` — new regression test asserting
   the perfect join scores ~0%, the metric is monotonic in defect size, and a
   gross break scores high. **Verified to fail against the unfixed binary**
   (`200.00%`, with the G0/G1 positive controls passing at `1.8e-15 mm` and
   `0.0000°`).
4. This report.
