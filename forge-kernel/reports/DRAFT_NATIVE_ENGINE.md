# The general native draft engine — family J, measured

**Date:** 2026-09-01 · Branch `kernel/draft-native-engine`.
Every number below was produced on this machine by a script in this commit, from
a binary whose build stamp records a CLEAN tree at the commit it was built from.
Nothing here is quoted from another report without being re-derived.

---

## 0. Headline

| | before | after |
|---|---:|---:|
| **OCCT_CLOSURE** (`scripts/occt_closure_count.sh`) | **14** | **14** |
| OCCT_DIRECT | 9 | 9 |
| OCCT_PHANTOM | 2 | 2 |
| family-J native coverage, 565 applicable corpus parts | **0.0 %** | **65.8 %** (372/565) |
| OCCT's own coverage on the same 565 | 88.0 % | **88.0 %** (497/565) |

**THE CLOSURE DID NOT MOVE, AND IT COULD NOT HAVE.** TKOffset leaves the closure
only when all 42 of its symbols are gone; they are spread over NINE unrelated API
families and this work is one of them (`BRepOffsetAPI_DraftAngle`, 6 symbols).
Partial completion of TKOffset is worth exactly zero closure — 42/42 or nothing
(`reports/OCCT_DROP_ORDER.md` §5). The before and after outputs of the ledger
script are byte-identical and are reproduced verbatim in §6.

What did move is the thing that was gating the ladder: family J was **0.0 %
against OCCT's 88.0 %**, and *nothing else in the TKOffset drop can be scored
until DRAFT can do what OCCT does*.

---

## 1. The no-bounded-fix finding HOLDS

`git show 5adc26a0` recorded that all 565 applicable parts violate BOTH
whole-shape guards of `NativeDraft.cpp` and that the number violating exactly one
is 0 and 0. That was re-derived here from the committed probe data
(`reports/corpus_ab/draft_defer_probe.jsonl.gz`, 600 rows), not taken from the
message:

```
rows 600   not-applicable 35   applicable 565
DEFER 565 of 565     OK 0     THREW 0
  375  a face of the solid carries more than one wire (a hole)
  190  a face of the solid is not a plane
has a non-planar face : 565      has a multi-wire face : 565
BOTH                  : 565      exactly one           : 0 and 0
applicable faces 72,201, of which non-planar 26,684 = 37.0%
parts that are polyhedra (zero non-planar faces): 0
```

Two additional facts from the same file that the message did not state, and that
matter for what a fix has to look like:

* `local_all_planar_single_wire` is **true for 0 of 565**. So a LOCAL rebuild
  that still required its touched faces to be single-wire planes would also score
  **zero**. The multi-wire carry is not an optimisation; without it there is no
  engine.
* the recorded ceiling of **424/565 = 75.0 %** was reached, exactly and part for
  part (§4). Its stated MECHANISM was wrong — `test/draft_defer_probe.cpp`'s own
  comment attributes it to a polygon rebuild that "silently replaces a circular
  edge by its chord", and this engine re-trims such an edge instead, same curve,
  new range. That correction was expected to LIFT the number; it did not, because
  the binding predicate is something else entirely: whether the drafted wall
  meets anything that is not a plane. **The prior estimate was right about the
  parts and wrong about the reason, and only the measurement in §4 separates
  those.** It is recorded here in that order because the opposite was believed
  while this engine was being written.

**Conclusion: correct, and the deliverable is a general engine, not a tweak.**
There is no guard whose relaxation moves a single part.

---

## 2. What was built

`src/native/brep/NativeDraftLocal.cpp` (+ its header), a **local incident
rebuild**. Let `W` be the selected walls:

| class | treatment | exactness |
|---|---|---|
| face with no vertex on a wall | the SAME `TopoDS_Face` | verbatim |
| wire with no moved vertex, inside a rebuilt face | the SAME `TopoDS_Wire` | verbatim — **this is the hole carry** |
| edge with no moved endpoint | the SAME `TopoDS_Edge` | verbatim |
| edge with a moved endpoint, NOT on a wall | RE-TRIM: same curve, same pcurves, new range | exact for ANY curve type |
| edge ON a wall, planar neighbour | new line = rotated plane ∩ neighbour plane | exact, closed form |
| edge ON a wall, non-planar neighbour | **DEFER**, named | see §5 |

A moved vertex is re-solved from its own constraints and then VERIFIED against
every one of them; a corner no solve places on all of its surfaces is declined,
never averaged. Three solves: rank-3 plane meet (closed form), slide along an
untouched incident curve to the rotated plane (1-D root find, exact for any
curve), line-of-two-planes against one analytic quadric (closed form).

The result is assembled with `BRep_Builder` over `EmptyCopied()` shells, faces
and edges, so untouched topology is the **same TShape**. Nothing is sewn and no
tolerance is widened to close a seam: the face, edge, vertex and shell counts are
preserved by construction, and the engine asserts that before returning.

**The two whole-shape guards do not get relaxed — they stop applying.** A face
that does not move is never examined, whatever its surface type or wire count.

### Drop hygiene — three toolkits, not one

`test/run_ab_native_draft_local.sh` asserts on the engine's own object file:

```
NativeDraftLocal.o TKOffset   imports: 0     <- the point of the exercise
NativeDraftLocal.o TKGeomBase imports: 0     <- a FREE RIDER, drop step 6
NativeDraftLocal.o TKGeomAlgo imports: 0     <- a FREE RIDER, drop step 5
```

The two free riders cost nothing today only because the kernel has no references
of its own left to them (`OCCT_DROP_ORDER.md` §4.2). One new reference from this
engine would silently convert two zero-cost closure points into funded work
items, and no other gate in the build would notice. That is why they are checked
here, at the only moment they could be reintroduced.

---

## 3. Correctness — the observable VECTOR, against live OCCT

`bash forge-kernel/test/run_ab_native_draft_local.sh --mutations`

**213 assertions passed, 0 failed. 8 of 8 mutations red.**

Seven cases, of which five carry BOTH a non-planar face and multi-wire faces —
the shape of the corpus, and exactly what the prior engine declines. Compared per
case:

> volume · surface **area** · centre of mass (3) · bounding box (6) ·
> face / edge / vertex / **shell** counts · Euler characteristic · **genus** ·
> `BRepCheck_Analyzer` validity

plus, where a closed form exists, the drafted volume derived from first
principles rather than borrowed from either kernel:
`V = (L³ − (L − 2tH)³)/(6t)` for the tapered prism, minus `πr²H` for the bore.

**VOLUME ALONE CANNOT VALIDATE GEOMETRY**, so two negative controls prove the
vector does work:

* an **equal-volume impostor** (a cube of side ∛V) is rejected on **7**
  observables while its volume matches to 1e-9 relative;
* an **equal-topology impostor** (the same part drafted 1° differently — identical
  face, edge, vertex, shell counts, Euler and genus) is rejected on **3**. This is
  the control for the half of the vector the first one cannot exercise.

Every DEFER control additionally asserts the reason is NAMED and names the right
guard, because a defer that cannot say why is what made family J's 0/565
unreadable for a month.

### Two defects the harness found in its own tests

1. **Four mutants stayed green** on the first attempt. All four deleted a GUARD.
   That was the harness being right and the mutants being wrong: removing a defer
   that never fires on valid input changes no answer. Every mutant now injects a
   wrong ANSWER. Recorded in the script so the next author does not repeat it.
2. **Two of three vertex solves fired zero times** — on every fixture and on all
   565 corpus parts. The rank-3 plane meet reaches every moved vertex first. That
   made solve 2 unexecuted code claiming to be capability, and it was hiding a
   real defect: it root-found against `planes[0]`, the first incident plane in
   iteration order, which is often an UNTOUCHED neighbour — and an anchor curve
   already lies on its own faces, so solving against one of those is degenerate.
   `FORGE_DRAFT_LOCAL_NO_PLANE_MEET` (test switch, default off) now drives the
   same fixture down solve 2, and the two solids must agree to 1e-9 on every
   observable. Measured: plane-meet solves 4 / anchor solves 4, identical solids.

   **Solve 3 (line versus quadric) is still unreached and is NOT claimed as
   proved.** It compiles; nothing has executed it.

---

## 4. Coverage — measured on the same 600 parts, scored as AGREEMENT

`test/draft_local_probe.cpp` copies the sideWall pick and the DRAFT arguments
VERBATIM from `draft_defer_probe.cpp`, so the distribution is the one the 0.0 %
row was measured over. **A part counts only if the native solid AGREES WITH OCCT
on the whole observable vector** — "did not defer" is not coverage.

```
applicable            565      not applicable 35      errors 0
OCCT built            497 / 565 = 88.0%     <- reproduces the recorded 88.0%
native built          372 / 565 = 65.8%
native AGREES w/ OCCT 372 / 565 = 65.8%     <- COVERAGE
  built but disagreed   0                   <- not one part
DEFER 193:
  141  a drafted wall meets a non-planar face (a conic needing a new pcurve)
   52  the rebuilt solid is not BRepCheck-valid
```

`test/run_draft_local_probe.sh`, artefact
`reports/corpus_ab/draft_local_probe.jsonl.gz`, manifest stamped
`git_head 627ec888`, `dirty_files_in_src_include_test 0`.

**Measured TWICE, and reproduced exactly.** The first run was at `187f6f22`; the
branch then merged `archdisc` (#164) and the base (#165, SECTION), and the run
was repeated from a binary rebuilt at the merged tip `627ec888`. Every one of the
600 rows is identical on `applicable`, `status`, `reason`, `occt_ok`, `agrees`,
both volumes, the face count and the path counters — 0 rows differ. That is
worth stating because the engine source is byte-identical across those two
commits (`git diff 187f6f22 HEAD -- NativeDraftLocal.{cpp,hpp}` is empty) and a
reproduction is how that becomes evidence rather than an inference.

**Every one of the 372 carries BOTH a non-planar face AND a multi-wire face** —
the two whole-shape preconditions the prior engine declines all 565 on. And not
one part built a solid that disagreed with OCCT: the coverage number and the
build number are the same number.

### The path census — two of three vertex solves never fire

```
moved vertices                 1488
  solved by plane meet         1488     (100%)
  solved by anchor curve          0     <- 0 parts
  solved by quadric               0     <- 0 parts
faces carried VERBATIM        43862     faces rebuilt   1860
wires carried verbatim INSIDE a rebuilt face  3556   (all 372 parts)
edges carried VERBATIM        96935
edges RE-TRIMMED               1488     (all 372 parts)
edges rebuilt as a line        1488
```

The rank-3 linear meet reaches every moved vertex of every part. Solve 2 is
proved equivalent to it only because the A/B forces it
(`FORGE_DRAFT_LOCAL_NO_PLANE_MEET`); **solve 3 is unreached and is not claimed as
proved**. The re-trim, by contrast, fires on all 372 parts — the construction the
prior ceiling analysis assumed would chord those edges is doing real work here.

### An independent confirmation of the recorded 424, part for part

Commit `5adc26a0` computed a **424/565 = 75.0 %** ceiling for a local rebuild and
said it is "a strict SUBSET of OCCT's 497, leaving 73 parts in the deletion
bucket and 0 native-only wins". Measured against that same file:

```
engine OK (validity gate on)          372
  + the 52 the validity gate declines 424
reached == the recorded 424 set ?     True
  in reached, not in 424:  0            in 424, not in reached:  0
reached is a SUBSET of OCCT's 497 ?   True
native-only wins (OCCT cannot)          0
OCCT-only (native cannot)              73
```

Two independent constructions landed on the **same parts**. What the prior note
got wrong is only the MECHANISM: it attributed the ceiling to a polygon rebuild
chording arcs. The real predicate is simply **whether the drafted wall meets
anything that is not a plane** — and 565 − 424 = 141 is exactly the size of that
defer bucket.

### The 52 — the gate is stricter than the incumbent

`test/run_draft_local_validity_diag.sh` re-runs only those 52 with the gate
bypassed:

```
with the gate bypassed, built           52
  of those, AGREE with OCCT             52     on the FULL observable vector
OCCT itself drafted                     52
parts whose INPUT was already invalid    0
native BRepCheck statuses : 38 x IntersectingWires ;
                            14 x SelfIntersectingWire + UnorientableShape
OCCT   BRepCheck statuses : IDENTICAL, part for part, all 52
```

So on these parts the engine produces a solid that is geometrically identical to
OCCT's **and carries the same defect OCCT's carries**, from a valid input. The
gate is holding the native engine to a bar its own incumbent does not meet, and
it costs **52/565 = 9.2 points**.

**That is reported, not acted on.** The gate stays ON in this branch. Relaxing a
check is a behaviour change that deserves its own decision and its own commit,
and a coverage number is not a reason to remove one. What the measurement does
establish is that the 9.2 points are not hiding a defect of this construction:
the two engines fail the same check, in the same way, on the same parts.

---

## 5. What remains, and why it is not one more predicate

The 141 parts that defer on "a drafted wall meets a non-planar face" are the
whole of the rest. `test/run_draft_local_neighbour_census.sh` censuses what the
wall actually meets, because "non-planar" covers three different pieces of work
— a plane section of a cylinder is an ellipse, of a cone a general conic, of a
spline neither — and a count cannot size any of them:

```
NON-PLANAR faces the drafted wall meets, by kind:
    270  cylinder        134  bspline        2  cone
parts, by the SET of kinds their wall meets:
     75  cylinder        62  bspline+cylinder     2  bspline     2  cone

OCCT drafts 73 of the 141; the other 68 defeat OCCT too.
The 73 OCCT DOES draft, by kind set:   73  cylinder    (nothing else)
The 68 neither engine drafts:  62 bspline+cylinder, 2 bspline, 2 cylinder, 2 cone
```

**The entire remaining gap to OCCT is 73 parts, and every one is a drafted plane
meeting a CYLINDER.** Every part whose wall meets a b-spline defeats OCCT as
well, so nothing is owed there.

> ### ★ CORRECTION, 2026-09-02 — that sentence undercounted the gap by 52 parts
>
> The gap was **125**, not 73. The two numbers differ because "73" counted only
> the parts that decline with a CYLINDER neighbour and quietly dropped the ones
> declining on `the rebuilt solid is not BRepCheck-valid`, which are a different
> defect with a different fix:
>
> | declining on | parts | wall neighbour |
> |---|---|---|
> | `a wall edge on a cylinder would have a non-increasing range` | 73 | cylinder |
> | `the rebuilt solid is not BRepCheck-valid` | 52 | **plane only** |
>
> The 52 have no cylinder anywhere near the drafted wall, so no amount of
> pcurve work could ever have reached them, and any plan that scheduled "73
> parts" as the remaining work was scheduling 58 % of it. Measured with
> `test/run_draft_local_probe.sh` over all 565 applicable parts; all 565 inputs
> are BRepCheck-valid, so every one of these is the engine breaking a good
> solid, not carrying a bad one.
>
> **Reading a gap off one defer reason is what caused this.** The histogram of
> reasons was there in the same JSONL the 73 came from; only one row of it was
> quoted.

### Why that is not one more predicate

The 3-D curve is easy and exact: a plane section of a cylinder is an **ellipse**,
closed form (centre where the axis meets the plane, semi-minor `r`, semi-major
`r/|n'·a|`). What blocks it is the **pcurve on the cylinder**. On the cylinder's
own (u, v) parameterisation that section is

```
v(u) = a + b cos u + c sin u
```

a sinusoid. No `Geom2d` conic represents it, so it **must be approximated** — and
that changes the engine's contract from "exact or defer" to "exact except for a
bounded pcurve deviation", which is a decision and not a detail. Three checks
were run before concluding this, and all three failed to find an exact route:

* the section is two straight lines only when the rotated plane contains the
  cylinder axis. For this corpus the pull is +Z, the wall is vertical, and the
  rotation axis is horizontal, so `u = a × n = ±Z` and `n'·Z = ±sin θ ≠ 0`.
  Never parallel.
* the section is a circle only when the axis is perpendicular to the rotated
  plane. Same arithmetic: it is not.
* OCCT derives a pcurve on demand only for PLANAR faces
  (`BRep_Tool::CurveOnSurface`); a cylindrical face with none is
  `BRepCheck_NoCurveOnSurface`, i.e. invalid. And the cylinder is always
  *touched*: it shares an edge with the wall, so it shares the wall's moved
  vertices. There is no version of this where the pcurve is not needed.

### The next commit, scoped by the measurement

A **native 2-D least-squares B-spline fit** for the pcurve. Doing it with OCCT's
approximator would re-import `TKGeomBase` / `TKGeomAlgo` and convert two
**free-rider** closure points (drop steps 5 and 6) into funded work items — the
exact trap `run_ab_native_draft_local.sh` checks for on the object file. The
native half already exists: `forge::occtconv::pointsToBSpline` fits in 3-D
(`src/native/geom/NativeNurbsConvert.cpp`), and `ElSLib` (TKMath) gives the (u,v)
of a point on a cylinder, cone, sphere or torus. The missing piece is the 2-D
sibling of `pointsToBSpline` plus a deviation bound that is asserted rather than
assumed.

Reaching parity is therefore: 424 (this engine, gate relaxed) + 73 = **497 =
OCCT's own count, exactly**. And even then family J alone still moves
`OCCT_CLOSURE` by nothing — TKOffset needs all nine families.

---

## 6. The ledger, verbatim

**BEFORE** — `bash forge-kernel/scripts/occt_closure_count.sh`, at merge commit
`cc5ff493` (this branch before any engine existed), with
`git status --porcelain -- forge-kernel/src forge-kernel/include
forge-kernel/CMakeLists.txt` EMPTY and the `.node` rebuilt from that tree.
VERIFY THE INSTRUMENT IS BUILT FROM COMMITTED SOURCE — a pinned dylib was
available and was not used, because no commit in the repo produces it:

```
== OCCT link accounting: forge-kernel.node ==

  OCCT_DIRECT  = 9   (LC_LOAD_DYLIB/DT_NEEDED records — gameable, NOT the ledger number)
  OCCT_CLOSURE = 14   ★ libraries that actually LOAD at run time — THE LEDGER NUMBER
  OCCT_PHANTOM = 2   (closure libs whose symbols the binary CALLS with no link record)

  direct  (9): TKBRep TKernel TKFillet TKG3d TKMath TKOffset TKPrim TKShHealing TKTopAlgo
  closure (14): TKBO TKBool TKBRep TKernel TKFillet TKG2d TKG3d TKGeomAlgo TKGeomBase TKMath TKOffset TKPrim TKShHealing TKTopAlgo

  HIDDEN — in the closure, no direct record. Removing a DIRECT lib that is these
  libs' only parent is the ONLY way any of them stops loading:
    TKBO           pulled by: TKBool TKFillet TKOffset  ← CALLED DIRECTLY by the binary (32 symbols, masked)
    TKBool         pulled by: TKFillet TKOffset
    TKG2d          pulled by: TKBO TKBool TKBRep TKFillet TKG3d TKGeomAlgo TKGeomBase TKOffset TKPrim TKShHealing TKTopAlgo  ← CALLED DIRECTLY by the binary (24 symbols, masked)
    TKGeomAlgo     pulled by: TKBO TKBool TKFillet TKOffset TKPrim TKShHealing TKTopAlgo
    TKGeomBase     pulled by: TKBO TKBool TKBRep TKFillet TKGeomAlgo TKOffset TKPrim TKShHealing TKTopAlgo

  ⚠ 2 phantom-direct librar(ies). A drop that only converts DIRECT → PHANTOM
    leaves OCCT_CLOSURE unchanged and is worth ZERO. Rank drops by OCCT_CLOSURE.
```

**AFTER** — same command, same worktree, `.node` rebuilt from the committed
branch tip. Measured at `803ff52b` and again at the merged tip `627ec888` after
both merges landed; byte-identical to BEFORE both times, `git status --porcelain` over `src` / `include` /
`CMakeLists.txt` EMPTY, with the engine compiled in and wired at the call site
(`nm | c++filt | grep -c occtdraftlocal` = 42, so it is really in the binary):

```
== OCCT link accounting: forge-kernel.node ==

  OCCT_DIRECT  = 9   (LC_LOAD_DYLIB/DT_NEEDED records — gameable, NOT the ledger number)
  OCCT_CLOSURE = 14   ★ libraries that actually LOAD at run time — THE LEDGER NUMBER
  OCCT_PHANTOM = 2   (closure libs whose symbols the binary CALLS with no link record)

  direct  (9): TKBRep TKernel TKFillet TKG3d TKMath TKOffset TKPrim TKShHealing TKTopAlgo
  closure (14): TKBO TKBool TKBRep TKernel TKFillet TKG2d TKG3d TKGeomAlgo TKGeomBase TKMath TKOffset TKPrim TKShHealing TKTopAlgo

  HIDDEN — in the closure, no direct record. Removing a DIRECT lib that is these
  libs' only parent is the ONLY way any of them stops loading:
    TKBO           pulled by: TKBool TKFillet TKOffset  ← CALLED DIRECTLY by the binary (32 symbols, masked)
    TKBool         pulled by: TKFillet TKOffset
    TKG2d          pulled by: TKBO TKBool TKBRep TKFillet TKG3d TKGeomAlgo TKGeomBase TKOffset TKPrim TKShHealing TKTopAlgo  ← CALLED DIRECTLY by the binary (24 symbols, masked)
    TKGeomAlgo     pulled by: TKBO TKBool TKFillet TKOffset TKPrim TKShHealing TKTopAlgo
    TKGeomBase     pulled by: TKBO TKBool TKBRep TKFillet TKGeomAlgo TKOffset TKPrim TKShHealing TKTopAlgo

  ⚠ 2 phantom-direct librar(ies). A drop that only converts DIRECT → PHANTOM
    leaves OCCT_CLOSURE unchanged and is worth ZERO. Rank drops by OCCT_CLOSURE.
```

`diff` of the two: **byte-identical**.

### Regression suites, against THIS tree's kernel

```
node forge-kernel/test/ft/ft_smoke.mjs           ===== ALL PASS =====
node forge-kernel/test/ft/ft_unified_edit.mjs    20 passed
node forge-kernel/test/directedit.mjs            9/9 DirectEdit tests passed
node forge-kernel/test/ft/ft_organic_smoke.mjs   ===== ALL PASS =====
bash  ui/test/run_op_constraint_gate.sh          PASS, 9/9 gate mutations caught
bash  ui/test/run_ui.sh                          ALL 19 UI GATES PASS
```

"against THIS tree's kernel" is load-bearing: four of those suites hard-coded the
PRIMARY checkout's `forge-kernel.node`, so run from a worktree they printed ALL
PASS about a binary four days old that contained none of the change under test.
That is fixed in this branch and proved with a control that hides this tree's
kernel and requires each of them to fail loud.

All of the above were re-run at the merged tip `627ec888` and are unchanged.

`bash forge-kernel/test/run_ab_all.sh` — **GREEN, all 9 harnesses BUILT** and
each matched its baseline (`draft_local` added; the verdict line used to
hard-code "8" beside the list it describes and now computes it). A GATE THAT
CANNOT BUILD CANNOT FAIL, which is the entire reason that ratchet exists.

---

## 7. What this does NOT claim

* **It does not move OCCT_CLOSURE.** 14 before, 14 after, byte-identical. Family
  J is 6 of TKOffset's 42 symbols and 1 of its 9 families.
* **Solve 3 (line versus quadric) is unproved.** It compiles; nothing has
  executed it, on any fixture or on any of the 565 parts. Solve 2 is proved only
  under a test switch that forces it.
* **The 424 is not parity.** It is 424 of OCCT's 497, a strict subset, with zero
  native-only wins. 73 parts remain, all of one shape (§5).
* **The 52 are not counted.** Coverage is 372, with the validity gate ON. The 424
  figure is what the gate would cost if it were relaxed, and relaxing it is a
  decision this branch does not take.
* **The corpus is one distribution.** 600 gold-reference STEP parts with a single
  drafted wall picked by largest vertical planar area, +Z pull, 3°, neutral plane
  at z-min. Nothing here measures multi-wall drafts, non-vertical walls, or any
  other corpus.


---

## 2026-09-02 — the wall/cylinder meet is BUILT; coverage 65.8 % -> 75.4 %

Paired re-run of `test/run_draft_local_probe.sh` over the SAME 565 applicable
parts, same sideWall pick, same draft arguments, scored the same way (a part
counts only if the native solid AGREES WITH OCCT on the whole observable vector).

```
                              native agrees      OCCT built
before (branch head)          372 / 565 = 65.8%  497 / 565 = 88.0%
after                         426 / 565 = 75.4%  497 / 565 = 88.0%
paired: gained 54, lost 0, built-but-disagreed 0
```

Three defects, all in the same place, none of them visible as a bad edge —
every edge was individually perfect in all three, and only the 2-D WIRE was
wrong, which is why `BRepCheck_Analyzer::IsValid()` alone could not name any of
them:

1. **The 2*pi branch.** `cylinderPCurve` takes a `uNear` that selects which
   period the fitted pcurve lands on. The call site never passed it, so it
   defaulted to `0.0` and put the new pcurve on `[-pi, pi]` while the face's
   untouched edges stayed on `[pi/2, 3pi/2]`. Every endpoint was exactly `2*pi`
   from the neighbour it had to meet. Fixed by anchoring on the OLD edge's own
   pcurve, which is written in the branch the face's 2-D domain already uses.
2. **The closed rim's span.** A bore lying WHOLLY INSIDE the drafted wall meets
   it in one CLOSED edge — one vertex used twice — so both endpoints project to
   the same parameter. Measured signature: `t0 = t1 = 0` with BOTH residuals
   exactly `0`, which is one point, not a failed projection. Such an edge spans
   a whole period. Closedness is read from `v0.IsSame(v1)`, never inferred from
   the parameters.
3. **The closed rim's sense.** With `v0 == v1` there is no vertex order to take
   a direction from, so the span alone left the sense free and the wrong one ran
   `u` from `2*pi` down to `0` against seam edges that needed `0` up to `2*pi`.
   The old curve's tangent at its start decides it.

Anchoring the branch on the old pcurve's MIDPOINT looked equivalent to anchoring
on its start and is not: for a closed rim the midpoint sits exactly half a period
from both candidates, so the nearest-branch `round()` decides a **tie** — measured
landing the rim on `[2*pi, 4*pi]`. All three are mutation-proved
(`run_ab_native_draft_local.sh --mutations`, mutations 9-12).

### What is left: 71 parts, and they are NOT one problem

```
52  plane neighbour only   -- the drafted wall crosses a feature; TOPOLOGY changes
19  cylinder neighbour     -- closed rims this fix does not yet reach
```

The 52 are the harder half and are **out of this engine's stated design**, not a
missing predicate. Diagnosed on `ho1024`: the drafted wall moves INWARD by
2.56274, and a scalloped island bounded by a circle of centre `(9.634, -29.61)`
and radius `24.93` reaches `y = -54.54` — it was inside the original boundary at
`-55.6` and is outside the drafted one at `-53.037`. `BRepCheck_Wire::SelfIntersect`
names the offending pair directly: the moved boundary line and that arc. The
engine "changes geometry and never topology" and asserts equal face/edge/vertex
counts, so it CANNOT represent a wall that has begun to cut a feature. OCCT
drafts these by recomputing the intersection topology. **The validity gate is
catching a real defect here, not costing coverage** — the distinction
`run_draft_local_validity_diag.sh` exists to make, answered for this block.


---

## 2026-09-03 — the 19 cylinder parts were ONE bound; and the 52 are NOT what the section above says they are

Two results. The first closes the tractable half of the remaining gap. The second
**refutes the characterisation of the other half written on 2026-09-02**, and the
refutation is the more important of the two, because a backlog item scheduled
against a wrong cause is work nobody needs.

### 0. Headline — the PRODUCTION CHAIN, paired, over the same 565

`test/run_draft_local_probe.sh`, all 600 parts, same corpus, same sideWall pick,
same DRAFT arguments, scored the same way (a part counts only if the answer
AGREES WITH OCCT on the whole observable vector).

```
                              BEFORE            AFTER
OCCT built                    497/565 = 88.0%   497/565 = 88.0%
local engine agrees           426/565 = 75.4%   445/565 = 78.8%
PRODUCTION CHAIN agrees       426/565 = 75.4%   445/565 = 78.8%
paired: gained 19, lost 0, built-but-disagreed 0
```

BEFORE `4370af80` (instrument only, engine untouched), AFTER `9a959f1a`, both
built from a tree with `dirty_files_in_src_include_test 0`. Raw rows:
`reports/corpus_ab/draft_local_probe_before_edgetol.jsonl.gz` and
`reports/corpus_ab/draft_local_probe.jsonl.gz`.

The 19 gained are exactly the 19 the gap consisted of:
`ho1014 ho1178 ho1209 ho1234 ho1243 ho1278 ho1295 ho1335 ho633 ho710 ho734
ho741 ho749 ho805 ho884 ho898 ho921 ho958 ho982`.

**Two NATIVE-ONLY WINS now exist and this report has been claiming zero.**
`ho296` and `ho857`: OCCT's `BRepOffsetAPI_DraftAngle` fails to build from a
BRepCheck-valid input and the native engine returns a BRepCheck-VALID solid. They
arrived with the wall/cylinder meet in `f1230487` and were never counted. §4's
"native-only wins (OCCT cannot) 0" is superseded — it is 2. They are not coverage
under this probe's own rule (a part with no OCCT answer cannot AGREE with one),
so they are reported and not added to any percentage.

### 1. The instrument was wrong first, and it flattered nothing — it hid 75 points

`src/Features.cpp`'s `forge::part::draftFaces` runs **two** native engines in
order and ships the first non-null answer: `occtdraft::draftFaces` (the plane
arrangement) then `occtdraftlocal::draftFacesLocal`. Every DRAFT number in this
programme, including `CMakeLists.txt`'s coverage table row of **0.0 %**, was
measured by calling ONE of them. `draft_local_probe.cpp` now calls both, in
production's order, and reports the chain beside the local engine rather than
instead of it, so every row this probe has ever written stays comparable.

Measured on all 565: **link 1 answers 0 of them.** 375 decline on `a face of the
solid carries more than one wire (a hole)` and 190 on `a face of the solid is not
a plane`. So the chain number and the local number are the same number — but that
is now a MEASUREMENT and not an inference, and the chain has a control in both
directions (`--selftest`): link 1 must answer a cube, and on a bored plate link 1
must decline BY NAME and link 2 must be the engine that answers.

### 2. What BRepCheck actually said — and the two hours spent not asking it

All 19 build. With `FORGE_DRAFT_LOCAL_SKIP_VALIDITY=1` all 19 agree with OCCT on
volume, area, centre of mass, all six bbox bounds, face/edge/vertex/shell counts,
Euler and genus — and disagree on exactly one observable, `validity`.

Walking `BRepCheck_Analyzer` per sub-shape gives, on every one of the 19:

```
  FACE#nn : UnorientableShape      surf=cylinder  wires=2  orient=REV
```

and nothing else. That is a **consequence**, and reading it as the defect cost
real time: the face's wire imbrication was reproduced by hand
(`BRepTopAdaptor_FClass2d::PerformInfinitePoint` on each wire, on a face carrying
that wire alone) and came back **identical between the input face and the drafted
one** — wire 1 IN, wire 2 OUT, both ways.

The answer was in the statuses that walk did not read. `BRepCheck_Result::Status()`
is a sub-shape's OWN verdict; a defect that exists only RELATIVE to a parent is
recorded per CONTEXT and is invisible to it. Iterating
`InitContextIterator / StatusOnShape` gives, on all 19:

```
  EDGE#nn in FACE : InvalidCurveOnSurface
  EDGE#nn in FACE : InvalidSameParameterFlag
  FACE#nn         : UnorientableShape          <- the only one Status() shows
```

> **A STATUS THAT ONLY EXISTS IN CONTEXT IS INVISIBLE TO A WALK OVER OWN
> STATUSES.** The face-level verdict named a property of the FACE and the cause
> was a property of an EDGE ON that face. Every diagnostic in this tree that
> reads `BRepCheck_Result::Status()` alone is reading two thirds of nothing.

### 3. The cause — the bound was the model's size, not the edge's tolerance

`cylinderPCurve`'s adaptive loop stops at the first span count that meets the
bound **it is given**, and it was given `resTol = 1e-7 * extent`: a MODEL-SCALE
residual. BRepCheck does not compare a pcurve against how big the part is. It
compares it against the tolerance the EDGE advertises.

Measured, per part, with the gate bypassed — the deviation is
`max |C3(t) - S_cyl(C2(t))|` over 2001 samples of the offending edge:

| | min | max |
|---|---:|---:|
| the engine's bound, `1e-7 * extent` | 1.72e-05 | 3.02e-05 |
| the edge's own tolerance | **1e-06** | **1e-06** |
| the fitted pcurve's actual deviation | 8.67e-06 | 1.57e-05 |
| deviation / tolerance | **8.67x** | **15.7x** |

All 19 have an edge tolerance of exactly 1e-06, all 19 peak **at t = pi** — the
far side of the closed loop from the two clamped ends, which is where a
least-squares fit is weakest — and all 19 carry `sameParameter = 1`,
`sameRange = 1`, so the flags were right and only the geometry under them was not.

### 4. The fix, and what it costs

```cpp
const double edgeTol = std::max(std::max(tol, BRep_Tool::Tolerance(oldE)),
                                BRep_Tool::Tolerance(cylFace));
const double pcTol   = std::min(resTol, edgeTol);
```

That `max` is not a guess. `BRep_Builder::MakeEdge` stamps
`max(tol, tol(oldE))`; the `UpdateEdge` in step 7 that attaches this pcurve
raises it to `max(tol, tol(cylFace))`; and `BRep_Builder` only ever RAISES a
tolerance. So the largest of the three is what BRepCheck will hold the pcurve to.
`min()` with `resTol` keeps the old bound wherever it was ALREADY the tighter of
the two, so the change can only tighten and never loosen — which is why nothing
regressed (`lost 0`).

The cost is one span doubling. On `ho1014`'s own geometry (cylinder r = 16.9,
wall normal +X tilted 3 degrees), `cylinderPCurve` at each bound:

```
tol=1.72e-05  ->  8 spans, 13 poles, degree 5, maxDev3d 8.65e-06   <- what shipped
tol=1.0e-06   -> 16 spans, 21 poles, degree 5, maxDev3d 1.15e-07
tol=1.0e-07   -> 32 spans, 37 poles, degree 5, maxDev3d 1.71e-09
```

8.65e-06 against the 8.67e-06 measured on the part itself: the closed-form
reproduction of the defect, from the fitter alone with no B-rep around it.

### 5. THE SCALE IS THE FIXTURE

`case(f)` — the closed rim, 20 x 20 x 10 with a 3 mm bore — **cannot catch this
defect and never could.** Measured: its fitted pcurve deviates **3.43e-08**
against the same 1e-06 edge tolerance, a 29x margin, so it passes whatever bound
the fit is given. The defect only appears once `1e-7 * extent` exceeds the edge
tolerance, i.e. above about 10 mm of extent, and the corpus parts are 172 mm to
302 mm across.

`case(g)` is `case(f)` rebuilt at **200 x 200 x 150 with a 17 mm bore at 3
degrees**, the corpus's own scale. On the unfixed engine it declines `the rebuilt
solid is not BRepCheck-valid`; fixed, it builds, matches OCCT on the whole vector,
and the same pcurve deviates 5.69e-08. It also asserts the defect **by name** and
not only by its symptom: `worstPCurveDeviation()` measures every edge/face pcurve
against THAT EDGE's own tolerance and prints the number.

`case(f)` is KEPT, not rescaled. It is what proves the engine works where the fit
is easy, and rescaling it would have traded one kind of evidence for another.

Mutation 13 reverts the bound to `resTol` and must turn the A/B red; measured, it
does, on case(g). Mutation 9's `sed` anchor moved with the call and was
re-pointed, never dropped — `mutate` aborts on a stale anchor precisely because
one would take that mutant AND every later one silently out of the run.

`bash forge-kernel/test/run_ab_native_draft_local.sh --mutations`:
**280 assertions passed, 0 failed. 13 of 13 mutations red, 0 stayed green.**
Engine object file: TKOffset 0, TKGeomBase 0, TKGeomAlgo 0.

### 6. ★ THE 52 ARE NOT A TOPOLOGY CHANGE — the 2026-09-02 note is REFUTED

The section above says of the remaining 52:

> The 52 are the harder half and are **out of this engine's stated design**, not a
> missing predicate. ... The engine "changes geometry and never topology" and
> asserts equal face/edge/vertex counts, so it CANNOT represent a wall that has
> begun to cut a feature. OCCT drafts these by recomputing the intersection
> topology. **The validity gate is catching a real defect here, not costing
> coverage.**

**Every load-bearing clause of that is false, and each one is refuted by its own
measurement.**

Re-run of all 52 with `FORGE_DRAFT_LOCAL_SKIP_VALIDITY=1`, at `9a959f1a`:

```
built                                     52 / 52
AGREE with OCCT on the full vector        52 / 52   (diff empty on every one)
OCCT itself drafted                       52 / 52
inputs that were already invalid           0 / 52
native BRepCheck statuses                 38 x IntersectingWires
                                          14 x SelfIntersectingWire + UnorientableShape
OCCT   BRepCheck statuses                 IDENTICAL, part for part, all 52
OCCT's own answer is BRepCheck-valid       0 / 52
```

And the claim that OCCT "recomputes the intersection topology" was measured
directly — OCCT's drafted solid against its own input, for all 52:

```
dFaces = dEdges = dVertices = dWires = 0   on 52 of 52
```

**OCCT does not recompute anything.** It emits a solid with the input's exact
topology and a self-intersecting face, which is the same solid the native engine
emits and then refuses to return.

**AND IT IS NOT THE DRAFTED WALL.** The first draft of this paragraph said the
offending face was "the drafted wall itself" and that was an assumption, not a
measurement; measured, it is false on 52 of 52. The offending sub-shape is, on all
52, ONE face, and it is always a **plane whose OUTWARD normal is exactly +Z** — the
**TOP CAP** — carrying **5 to 9 wires**, one outer boundary and 4 to 8 islands. The
drafted wall itself has **ONE wire** on every one of the 52 (min 1, median 1, max 1)
and its outward normal is horizontal on every one (37 x -Y, 8 x +Y, 6 x -X, 1 x +X).

That is the mechanism, and it is a cleaner one than "the wall cuts a feature".
With +Z pull and the neutral plane at z-min the wall leans INWARD as height rises,
so the edge it shares with the top cap moves inward by `height * tan(3 deg)` —
**2.16 mm to 5.07 mm, median 4.18 mm**, on parts 96.8 mm to 258.3 mm across. The
top cap is the face that loses the most, and it is the face carrying the islands.

So the two failure classes are real geometric events on that cap, and neither is a
capability gap against this incumbent:

* **38 parts — `IntersectingWires`.** The cap's moved outer boundary now crosses
  one of the cap's own island wires.
* **14 parts — `SelfIntersectingWire` + `UnorientableShape`.** One wire of the cap
  crosses itself after the move. `ho1024`, diagnosed in the section above, is one of
  these fourteen; the diagnosis of the GEOMETRY was right and it even named the
  right arc, but it attributed the face to the wall and inferred that OCCT does
  something different. Both of those are wrong.

**THE CAPABILITY, NAMED.** To make these 52 *valid* — better than the incumbent,
not equal to it — an engine needs a **2-D boundary arrangement on the CAP face**:
intersect its moved outer boundary against its island wires in that face's own
(u, v), split at the crossings, discard the parts that fall outside, and re-emit
the face with a **different wire, edge and vertex count**. `NativeDraftLocal`
asserts equal counts by construction, so it cannot; and OCCT's
`BRepOffsetAPI_DraftAngle` does not do it either. Nobody in this tree has that
capability and nothing is owed to OCCT for it.

**To reach OCCT PARITY on these 52 costs no capability at all.** It is one
decision: whether `draftFacesLocal` may return a solid carrying the same defect
its own incumbent's answer carries. **This branch does not take that decision and
the gate stays ON.** Relaxing a check to gain 52 parts is weakening an assertion
to obtain a number, and a coverage figure is not a reason to remove one. What the
measurement settles is only what the decision is worth and what it is about:
**52/565 = 9.2 points, and it is a policy question, not an engineering one.**

For the flip-gate ledger this is a distinct disagreement class from the five in
PR #224 — not DIFFERENT OPERATION, ORIENTATION, REPRESENTATION, DECOMPOSITION or
NUMERICAL MARGIN, but **STRICTER THAN THE INCUMBENT**: the two engines produce
the same solid and only one of them is willing to return it.

Note what this costs *today*: nothing. With the OCCT fallback compiled in,
`draftFacesLocal` returning null falls through to `BRepOffsetAPI_DraftAngle`,
which returns the same invalid solid. The 9.2 points are only spent under
`FORGE_DRAFT_DROP_NATIVE=ON`, where the op would throw instead.

### 7. What this section does NOT claim

* **It does not move OCCT_CLOSURE.** Nothing here touches a link record. TKOffset
  leaves at 42/42 symbols across nine families or not at all.
* **It does not reach parity.** 445 of OCCT's 497. The remaining 52 are §6.
* **Solve 3 (line versus quadric) is still unreached** and still not claimed as
  proved. The path census is unchanged: every moved vertex on every part is
  reached by the rank-3 plane meet.
* **`agrees` on the 52 includes "both invalid".** The probe's vector compares
  validity as an observable, so two solids that are both BRepCheck-invalid agree
  on that term. That is stated rather than hidden: the other fifteen observables
  agree to 1e-6 and the BRepCheck status CODES are identical part for part, which
  is the stronger statement and is what §6 rests on.
* **The corpus is one distribution.** 600 gold-reference STEP parts, one drafted
  wall picked by largest vertical planar area, +Z pull, 3 degrees, neutral plane at
  z-min. Nothing here measures multi-wall drafts or non-vertical walls.
