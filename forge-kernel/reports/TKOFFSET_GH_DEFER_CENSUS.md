# TKOffset families G and H — the per-part cause census

**THICKSOLID and OFFSETSHAPE both sit at 1.2% native coverage. This measures
*why*, per part, and finds two different answers plus a live defect.**

Harness `forge-kernel/test/tkoffset_gh_defer_census.cpp`, driver
`test/run_tkoffset_gh_defer_census.sh`, 600 rows in
`reports/corpus_ab/tkoffset_gh_defer_census_600.tsv`.

---

## 0. Why this exists

`reports/CORPUS_AB_COVERAGE.md` §3.2 records the most instructive error in this
programme:

> A success rate cannot distinguish "the corpus has nothing this engine covers"
> from "the engine has a defect on the corpus's most common input" — the two
> produce the same number.

THRUSECTIONS was read the first way because its header made that plausible; a
per-part census measured the second and moved the row 51.5 points. That document
names the families that had **not** had one. G and H were among them. Their
explanations in §3.2 —

> **`THICKSOLID` 126 deleted on a 22.2% OCCT baseline.** … this family is hard
> for both.
> **`OFFSETSHAPE` has the weakest OCCT baseline of all, 6.3%** …

— were true as far as they went and said nothing about *which* precondition
binds. This closes that.

---

## 1. Method, and the control that makes the answer an engine answer

The census TU **`#include`s `src/native/brep/NativeThickSolid.cpp`**, so the
ladder below is walked with the engine's own helpers (`surfKind`,
`basisSurface`, `edgeFullCircle`, `faceSample`, `offsetSurfaceOf`, `vParamOf`,
`offsetCircle`) rather than a re-derivation that could drift from them. The
input derivation is copied from `test/corpus_ab_coverage.cpp` §2.3, so the
census is over exactly the operations the coverage baseline measured:

| family | derived operation |
|---|---|
| THICKSOLID | remove the largest PLANAR face, wall `0.05 * min bbox extent` |
| OFFSETSHAPE | grow the whole solid by `0.02 * min bbox extent` |

**Control.** Every part also *runs* the real public entry points, and the
invariant

> the ladder said DEFER ⟹ the engine returned a null shape

is asserted on every row. **0 violations in 600 parts**, and the census's
native OK/DEFER verdict matches the committed `full600_results.jsonl.gz`
baseline on **all 1,200 (part, family) pairs**. One process per part, so a
SIGSEGV inside an engine costs that row and not the run; **600 parts, 600 rows.**

---

## 2. Result — the first binding precondition, all 600 parts

| first binding rung | THICKSOLID | OFFSETSHAPE |
|---|---:|---:|
| `S1_unsupported_surface` — a face is not one of the 5 analytic types | **223** (37.2%) | **223** (37.2%) |
| `S2_planar_wire_edge_not_full_circle` — a planar face's wire has a non-circular edge | **370** (61.7%) | **368** (61.3%) |
| `S1_offset_surface_null` | 0 | 2 (0.3%) |
| passed steps 1–3 | 7 (1.2%) | 7 (1.2%) |

**The two families have the same shape of failure**, because
`quadricThickSolid` and `quadricOffsetShape` share steps 1–3 verbatim.

### 2.1 The corpus, measured rather than assumed

Per-face census over all 600 parts (73,368 faces):

| | faces | parts |
|---|---:|---:|
| planar | 45,788 | 600 |
| curved (cyl/cone/sphere/torus) | 13,702 | — |
| **not one of the 5 analytic types** | 13,878 | 223 |
| planar faces blocked by the one-full-circle rule | **43,179 of 45,788 (94.3%)** | 593 |
| planar faces that ARE a single full circle | 2,609 | — |
| curved faces in scope (one wire, full revolution) | 10,577 | — |
| curved faces blocked (partial revolution 2,912 / multi-wire 213) | 3,125 | — |

**Zero of the 600 parts is all-planar.** Every part carries a cylindrical face,
so `makeThickSolid`/`offsetSolidShape` dispatch **every** part to the quadric
path and the proven all-planar prismatic path (`planarThickSolid`,
`planarOffsetShape`) is **dead code on this corpus** — matching the header's own
note that 0 of 1,613 kernel-verified trees are all-planar.

---

## 3. The answer, per family

### 3.1 THICKSOLID — a NARROW APPLICABILITY PREDICATE, not a capability gap

It is **not** a wiring defect: the census reaches the engine (the control
above), and `CORPUS_AB_COVERAGE.md` §2.6's per-family positive control already
showed the engine answers `OK` on an input its header documents as in scope.

It is **not** principally a NURBS capability gap either. **The entire deletion
bucket is one rule:**

> Of the **126** parts where OCCT built a THICKSOLID and the native engine
> declined, **126/126** are blocked by `S2_planar_wire_edge_not_full_circle`.
> Not one is blocked by an unsupported surface.

And **133/133 of OCCT's THICKSOLID successes are on parts that are entirely
inside the native engine's surface-type scope.** OCCT is not covering NURBS
parts here; it fails on those too. Both engines succeed on the same analytic
class and the native one declines inside it.

The binding rule is the *mixed polygon + quadric* exclusion. In the quadric
path every planar face must have **every wire be exactly one full circle**, so a
solid is accepted only if it is essentially a body of revolution. A prismatic
body with cylindrical holes — the corpus's dominant part, and the dominant real
mechanical part — has a flat face bounded by lines and is declined
categorically.

**The predicate excludes the common case, and the exclusion is not geometrically
forced.** The engine already contains both halves of what a mixed face needs:
the all-planar path meets offset planes at corners, and the quadric path
re-trims circle edges in closed form. A plane offsets by translation; its edge
against an offset plane is a line, against an offset cylinder a circle. What is
missing is the planar face rebuild for a wire that mixes them — a real engine
increment, not a bounded fix.

**The prize is measurable.** Of the 600 parts, **232** are all-analytic, have
every curved face in scope, and are blocked *only* by this planar-wire rule.
Lifting it puts up to **239/600 (39.8%)** in reach — above OCCT's 133 (22.2%),
i.e. the flip gate would pass. That is an upper bound: passing steps 1–3 does
not guarantee the sew and self-check tail succeeds.

### 3.2 OFFSETSHAPE — the same predicate, and a much weaker case for OCCT

Same first rung, same proportions: **33 of the 38** deletion-bucket parts are
the planar-wire rule, 4 are unsupported surfaces, 1 is an offset-surface
failure. The roadmap is the same increment; the family is smaller because OCCT
itself only manages 38/600.

---

## 4. Is the OCCT dependency buying anything for these two families?

Stated plainly, because a family where both arms fail is a different shipping
argument from one where OCCT works.

Measured on the same 600 parts, **counting validity, which the coverage gate
deliberately excludes** (`CORPUS_AB_COVERAGE.md` §2.2 — the right choice for a
coverage gate, the wrong one for a shipping decision):

| family | OCCT built | OCCT **valid** | native built | native **valid** |
|---|---:|---:|---:|---:|
| THICKSOLID | 133 | **0** | 7 → 0 after §5 | **0** |
| OFFSETSHAPE | 38 | **5** | 7 | **7** |

Independently re-measured by `test/tkoffset_gh_quality_probe`, run over the 142
parts where either arm built anything in either family: OCCT THICKSOLID produced
a shape on 87 and **0 were valid**; OCCT OFFSETSHAPE on 38 with **5 valid**;
native OFFSETSHAPE 7 of 7 valid.

> **The probe's denominator is 96, not 142, and the difference is the point.**
> Unlike `corpus_ab_coverage`, the probe runs both families in ONE process with
> no per-arm fork, so **46 of the 142 parts died with SIGSEGV inside OCCT's own
> offset engines** and produced no row at all. The 87 above is therefore a
> subset of the baseline's 133, not a contradiction of it — and it is a second,
> independent sighting of the crash the coverage harness already contained
> (66/600 on OFFSETSHAPE). It does not weaken the validity finding, which is a
> count of zero over every OCCT THICKSOLID result the probe did observe, and
> which the committed baseline reports independently as 0 of 133.

**THICKSOLID: no. OCCT's 22.2% is 133 invalid solids — not one passes
`BRepCheck_Analyzer`, and 18 of 87 re-measured have a volume above 90% of the
source solid, i.e. they are barely hollowed at all.** `reports/TKOFFSET_DECOMPOSITION.md`
§4.2 already recorded `MakeThickSolid` returning the cavity with
`IsDone() == true`; this says it is not an edge case on real parts. Keeping
TKOffset for family G buys a call that returns a shape, not a call that returns
a correct one. The shipping argument here is **"neither engine works"**, and the
native engine's advantage is only that it says so.

**OFFSETSHAPE: barely, and the native engine is already ahead on validity —
7 valid against 5.** OCCT additionally **CRASHED on 66/600** parts (SIGSEGV,
contained only because the coverage harness forks per arm) and threw on 6. It
does cover 4 NURBS parts the native engine cannot, which is a real if small
capability.

> **Caveat on "7 against 5", stated because validity is not correctness.**
> OFFSETSHAPE's `BOTH_OK` bucket is **0** — the two engines never both succeed on
> the same part — so on this corpus there is **no cross-arm oracle** for either
> side. Validity says a solid is closed, manifold and non-self-intersecting; it
> does not say it is the right solid. The independent check available here is the
> first-order volume identity for an outward offset, `V ≈ V₀ + A₀·d`: measured on
> ho1041 536314.7 against 538804.2, ho519 99269.1 against 99778.4, ho980 304695.7
> against 306072.0 — **0.45–0.51% under** in every case, the sign and scale a
> second-order term produces on a part whose concave features lose volume as the
> skin grows outward. Consistent with a correct offset, and not a proof of one.
> The dedicated oracle remains `test/run_ab_native_offsetshape.sh` (206/206
> against closed forms and against OCCT on shapes where both engines work).

Neither family is a case where OCCT works and native does not.

---

## 5. The defect this census found, and the fix

**All seven native THICKSOLID "successes" were invalid solids**, and the
coverage baseline recorded it in plain sight — `valid results: native 0, OCCT 0`
— while the 1.2% was quoted as coverage.

Localised: exactly **one face** per result, `BRepCheck_IntersectingWires`.
Measured on `ho1041` (wall 2.3808), the cavity face at z = 135.119 came back
with outer **R = 24.0192** and eight holes of **r = 4.6848** centred **23.808**
from the axis — reaching **28.493**, i.e. **4.47 mm past its own rim**.

**Cause.** Offsetting is injective only below the local feature size. On
`ho1041` the material between each bore (r = 2.304 at radius 23.808) and the
outer cylinder (R = 26.4) is **0.288 mm**; a 2.3808 mm wall shrinks the rim by
`t` and grows every hole by `t`, closing `2t = 4.76 mm` across it. The two
openings have merged — a real geometric operation this engine does not
implement.

**Why nothing caught it.** `planarCircularFace` self-checks the built face
against `π(R² − Σrᵢ²)`, and `quadricThickSolid` self-checks the assembled
solid's volume. Both are **algebraic identities in the radii and are blind to
containment**: the face's measured area was **589.43237** against a `want` of
**589.4325** — passing to 2e-7 relative on a face whose wires cross. This is
this programme's own recorded lesson (*volume cannot validate geometry*)
reproduced inside the engine, and it is why the guard had to be a **distance**
test rather than another measure.

**Fix.** `circlesNest` in `src/native/brep/NativeThickSolid.cpp`: every hole
strictly inside the outer circle, no two holes overlapping, tangency rejected
(it makes a non-manifold vertex). One guard covers both families —
`planarCircularFace` is shared by `quadricThickSolid`, `lipFace` and
`quadricOffsetShape`.

**Measured effect, paired over the same 600 parts:**

| | before | after |
|---|---:|---:|
| THICKSOLID native builds | 7 (1.2%) | **0 (0.0%)** — the 7 were exactly the invalid ones |
| OFFSETSHAPE native builds | 7 (1.2%) | **7 (1.2%)** — unchanged |

Both directions on the same parts: the guard fires on every wrong answer and on
nothing else. It does not fire in the grow direction, where holes shrink away
from the rim.

**This lowers a native coverage number. It is a correction, not a regression:**
the capability it removes never existed, and the engine's own header promises "a
null `TopoDS_Shape` is an HONEST DEFER — never a plausible wrong shape". It also
makes the opt-in `FORGE_THICKSOLID_NATIVE=1` route safe; before it, that switch
substituted an invalid solid for OCCT's answer on exactly these parts.

**Gates.**

```sh
forge-kernel/test/run_thicksolid_nesting_gate.sh   # NEW, two-sided: 9/9
forge-kernel/test/run_ab_native_offsetshape.sh     # 206/206, unchanged
node forge-kernel/test/native_thicksolid_closedform.mjs   # 11/11, unchanged
forge-kernel/test/run_tkoffset_gh_defer_census.sh  # 600 rows, 0 control violations
```

The new gate is one solid at two wall thicknesses either side of a threshold
**derived from the geometry** (`t* = 0.25` for a bore whose wall to the skin is
0.5): `t = 0.2` must build *and be valid*, `t = 0.4` must defer, and `t = 0.24`
/ `t = 0.26` must follow the same rule. **It is proved falsifiable**: built
against the pre-fix engine it fails 2 of 9, and prints that the shape the engine
returned instead is `BRepCheck VALID=0`.

---

## 6. Wiring — the third hypothesis, answered

Neither family's number is a wiring defect, but the two are wired differently
and it is worth stating:

- **OFFSETSHAPE** — `occtoffset::offsetSolidShape` runs **unconditionally** in
  `forge::part::offsetSolid` (`src/Features.cpp:1340`), ahead of the OCCT
  fallback. Fully reachable in a default build.
- **THICKSOLID** — `occtoffset::makeThickSolid` in `forge::part::shell` is
  behind `getenv("FORGE_THICKSOLID_NATIVE")` **and** `multiThickness.empty()`
  (`src/Features.cpp:1110`), so in a default build it is **never called**. That
  is deliberate and documented, not a defect; it does not affect the coverage
  number (the A/B calls the engine directly) and it loses no capability (OCCT
  still runs). Given §5, it is also the reason the invalid solids never reached
  production.

---

## 7. What this does and does not license

- **It does not move any drop option.** Both remain far below their OCCT
  baselines and both stay OFF.
- **It does name the single increment that would move them**: the planar face
  whose wire mixes lines and circles. One rule, 126/126 of the THICKSOLID
  deletion bucket and 33/38 of OFFSETSHAPE's, up to 232 parts of headroom.
- **It removes seven silent wrong answers** and gates against their return.
- **It says the OCCT dependency is not load-bearing for family G**, because
  OCCT's answers there are 0/133 valid. That is a claim about *this* corpus and
  *this* derivation (§2.3), and both are stated so it can be re-run.
