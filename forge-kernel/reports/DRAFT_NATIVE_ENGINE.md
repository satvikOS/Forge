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

## 2026-09-03 — PARITY. 75.4 % -> 88.0 %, deletion bucket 0, closure still 14

Branch `draft-j-20260903`, measured from a worktree pinned to `origin/archdisc`
`f53deeae` plus this branch. Every number below was produced on this machine by a
script in this commit. The BEFORE column is a full 600-part run of
`test/run_draft_local_probe.sh` taken from the UNMODIFIED tree at `f53deeae`
before a line of this work existed, so the comparison is paired and not quoted.

| | before (`f53deeae`) | after | OCCT, both runs |
|---|---:|---:|---:|
| applicable / not applicable / errors | 565 / 35 / 0 | 565 / 35 / 0 | — |
| native **BUILT** | 428 / 565 = 75.8 % | **499 / 565 = 88.3 %** | 497 / 565 = 88.0 % |
| native **AGREES with OCCT** (= COVERAGE) | 426 / 565 = 75.4 % | **497 / 565 = 88.0 %** | 497 / 565 = 88.0 % |
| paired | — | **gained 71, lost 0** | — |
| built but DISAGREED with OCCT | 0 | **0** | — |
| **parts DELETED by flipping the flag** | 71 | **0** | — |
| native-only wins (OCCT failed, native built) | 2 | **2** | — |
| `OCCT_CLOSURE` | 14 | **14** | — |

McNemar exact, before vs after: 71 discordant one way, 0 the other, two-sided
**p = 8.5e-22**. McNemar exact, native vs OCCT after: **0 discordant pairs**.

**★ FAMILY J NOW PASSES ITS FLIP GATE AND THAT MOVES `OCCT_CLOSURE` BY NOTHING.**
The gate is "native success rate >= the measured OCCT baseline"; it is 88.0 % vs
88.0 % with a deletion bucket of 0. TKOffset leaves the link line only when ALL
NINE families are compiled out (`CMakeLists.txt:1170`) and eight are still open.
Measured on this branch's own `.node`, built here with every drop option at its
default: `OCCT_DIRECT 9, OCCT_CLOSURE 14, OCCT_PHANTOM 2, TKOffset symbols 42` —
`scripts/tkoffset_ledger_gate.sh` PASS, every ceiling held, byte-identical to the
`origin/archdisc` ledger. **A family that passes its gate becomes CAPABLE of
being dropped; it drops nothing on its own.**

### 1. The 12.6-point deficit was ONE guard, and BOTH halves were mis-diagnosed

Re-measured, not inherited. At `f53deeae` all 71 parts of the gap declined on
**the same guard**. The 2026-09-02 note above split them 52 / 19 by what the
drafted wall meets, and **that split is right**; what was wrong is the diagnosis
of each half, and each is wrong in the opposite direction:

* it called the 52 a defect the gate is "catching, not costing coverage". They
  are not a defect: the native answer is OCCT's answer, status code for status
  code (§2).
* it called the 19 "closed rims this fix does not yet reach". They are reached —
  they build — and the defect is the pcurve's deviation BOUND, which is a
  different thing with a different fix (§3).

Neither could be told from the defer histogram, because both read `the rebuilt
solid is not BRepCheck-valid`:

```
DEFER taxonomy, 565 applicable, before:
   71  the rebuilt solid is not BRepCheck-valid          <- the WHOLE gap to OCCT
   66  a drafted wall meets a non-planar face            <- OCCT fails all 66 too

the 71, by what the drafted wall meets:
   52  plane only        OCCT's answer is INVALID TOO
   19  cylinder          OCCT's answer is VALID
```

Separating them needed a face-level walk of BOTH engines' output and an angle
sweep, not a count and not a neighbour-kind label.

### 2. The larger block (52) — the engine's answer is OCCT's answer

Walked face by face, on both engines, with `BRepCheck_Analyzer::Result()` over
VERTEX / EDGE / WIRE / FACE / SHELL / SOLID, on all 52:

```
parts native returned that BRepCheck rejects              52
  native status multiset == OCCT status multiset          52   <- all of them
  signatures:   38 x FACE:IntersectingWires
                14 x FACE:UnorientableShape + WIRE:SelfIntersectingWire
  parts whose OCCT arm is VALID                            0
  parts whose INPUT was already invalid                    0
  statuses on an EDGE, VERTEX, SHELL or SOLID              0   <- none, on any part
```

Nothing about a curve, a pcurve, a range, a flag, closure or connectivity. The
only complaint, on either engine, is that two 2-D wires **cross**.

**The decisive control is the ANGLE.** Two engines agreeing at 3 degrees have
agreed once. Bisecting the draft angle at which each engine's answer first stops
being BRepCheck-valid, independently per arm, 17 iterations on `[0.01, 8]`
degrees (resolution 6.1e-5 deg), over all 52:

```
52 parts, 52 DISTINCT thresholds, spanning 0.0433 deg .. 2.9835 deg
max |native threshold - OCCT threshold| over the 52  =  0.0
```

Every part has its own threshold and both engines cross it at the same angle. On
`ho1152` the wire-to-wire clearance on the offending face falls linearly with the
angle — 0.65, 0.617, 0.583, 0.516, 0.382, 0.248, 0.114 mm at 0, 0.05, 0.1, 0.2,
0.4, 0.6, 0.8 deg — and reaches zero between 0.8 and 1.0 deg, where BOTH engines
turn invalid. **The crossing is a property of the draft that was asked for, not
of either construction.** No engine that moves geometry while keeping topology
can answer otherwise, and `BRepOffsetAPI_DraftAngle` does not.

So the blanket gate was holding the native engine to a bar its own incumbent does
not meet, on parts where the two produce the same solid. That is the exact
inversion of the rule this programme already wrote down for the OTHER arm:
`CORPUS_AB_COVERAGE.md` §2.2 keeps validity **out** of the success predicate
because folding it in "would quietly re-score the OCCT baseline downward and
flatter the native side". Folding it into the native side alone flatters OCCT by
52 parts.

#### What was changed, and why it is not a relaxation

`inspectCheck()` in `NativeDraftLocal.cpp` classifies what BRepCheck found instead
of reading one boolean. **Every status outside `SelfIntersectingWire` /
`IntersectingWires` still declines, named** — the defer text now carries the
status, e.g. `"the rebuilt solid is not BRepCheck-valid: UnorientableShape"`.
`UnorientableShape` is admitted only on a face that already carries a crossing,
because that is the pair OCCT itself reports on 14 of the 52. And a crossing is
carried only when THREE further conditions hold, each of which is a tightening
and not a widening:

1. **nothing in the rebuild was approximated** — if any pcurve was fitted, the
   strict gate stands, because an approximation can manufacture a crossing;
2. **the offending face is one this engine rebuilt** — a crossing on a face
   carried verbatim is an INPUT defect and is not this gate's to bless;
3. **a crossing is the only complaint.**

`FORGE_DRAFT_LOCAL_STRICT_VALIDITY=1` restores the blanket `IsValid()` gate, so
the before number is reproducible from the same binary.

**Four proofs that this is not a weakened gate.**

* the corpus: of the 71 parts it admits, **0 disagree with OCCT** on the full
  observable vector, and 0 parts anywhere in the run built a solid that disagreed;
* the four defects the gate was ever proved on — the 2*pi branch, the closed
  rim's span, the closed rim's sense, the branch anchor — arrive as `NotClosed` /
  `BadOrientationOfSubshape`, which the classifier rejects. **Mutations 9-12 are
  still RED**;
* a new **mutation 13** re-injects the 2*pi defect and removes **all four**
  conditions on the carry. Removing them one at a time was measured and the
  engine still declined each time, on the next condition down — the guard is
  layered — so a one-layer mutant proves nothing. With all four gone the wrong
  solid escapes and the A/B fails on validity AND volume AND area AND all three
  centre-of-mass components;
* a new **case(g)** fixture holds the carry end to end: below the threshold both
  engines are valid and nothing is carried; above it both are invalid with the
  IDENTICAL status multiset and exactly one carry, counted; the two engines'
  thresholds are the same angle, and it is `atan(clearance / height)` to 0.05 deg;
  and `STRICT_VALIDITY=1` declines the same input.

### 3. The smaller block (19) — a real defect, and the third of its exact shape

These are NOT the same thing. OCCT drafts all 19 to a **VALID** solid; native's
was invalid, uniformly `FACE:UnorientableShape x1`, with **no** crossing status
and no edge, wire, vertex, shell or solid status anywhere. One face, one
complaint, all 19.

Localised by **substitution**, not by inference: native's offending face and
OCCT's have the same wires, the same 14 edges in the same order, the same
orientations, the same `SameParameter` / `SameRange` / degenerate flags, and 2-D
pcurve samples agreeing to 1e-5. Copying **only OCCT's pcurve for the one rebuilt
edge** onto native's own face makes that face `VALID`. The pcurve is the cause.

**The bound was the model's size, not the tolerance the pcurve lives under.** The
fit was graded against `resTol = 1e-7 * the model's extent`, which is the right
yardstick for a residual on a solved point and the wrong one for a pcurve: on a
200 mm part it is 2e-5, twenty times the tolerance stamped on the edge and two
hundred times the cylinder face's own 1e-7. `BRepTopAdaptor_FClass2d` closes the
face's 2-D wire with the FACE's tolerance, so the wire read open, and
`BRepCheck_Face` reported the whole face unorientable with every edge, curve and
pcurve of it individually perfect. That is the **same shape of defect** as the
2*pi branch and the closed rim — the third of its kind in this engine, and the
third time only the 2-D WIRE was wrong.

The fix is one line and it is a TIGHTENING: grade the fit against
`min(resTol, max(face tolerance, edge tolerance))`. The fitter's adaptive loop
must now reach it and returns an honest defer when it cannot. **All 19 build,
all 19 are BRepCheck-VALID, all 19 agree with OCCT on the full vector.**

A bound needs a fixture whose SCALE exercises it. Case (f) is the same topology
at L = 20, where the two bounds differ by 20x and nothing moves; new **case (h)**
is case (f) at L = 2000, where they differ by 2000x. **Mutation 14** puts the old
bound back and case (h) is what turns red — without case (h) that mutant stays
green and the bound is untested.

### 4. The OFFICIAL flip-gate harness now says the same thing

`FAMILIES=DRAFT bash test/run_corpus_ab_coverage.sh all`, all 600 parts, at commit
`97969e33` with `dirty_files_in_src_include_test = 0`. This is the harness whose
output the `CMakeLists.txt` table is written from, and it is a DIFFERENT program
from the probe above with its own derivation, its own success predicate and its
own arms. Artefact: `reports/corpus_ab/draft_family_j_20260903/`.

```
| family | option                  |   N | both | nat only | OCCT only | neither |
| DRAFT  | FORGE_DRAFT_DROP_NATIVE | 565 |  497 |        2 |     **0** |      66 |
  nat 88.3%   occt 88.0%   agree 497/497 (100.0%)
  delta 0.4% [-0.1, 0.8]   McNemar p = 0.5000   verdict PASS
  native arm statuses: DEFER:66  OK:499
  OCCT   arm statuses: THREW:66  OK:497  DEFER:2
  BRepCheck_Analyzer valid results: native 447, OCCT 445
```

**READ THE `agree` COLUMN BESIDE THE VERDICT**, which is what that summary's own
text tells the reader to do: families E and F pass on coverage while agreeing on
0 of 599 parts, which means their two arms are computing different operations.
Here it is **497 of 497, and 0 disagree**. And the native arm is never LESS valid
than the incumbent: 447 BRepCheck-valid results against OCCT's 445.

### 4b. What that harness was measuring before

`CMakeLists.txt:242` records family J as `native 0.0 %, OCCT 88.0 %, 497/565
deleted`. That row could never have moved, for a reason that has nothing to do
with the engine: **`corpus_ab_coverage.cpp`'s native arm called only the FIRST of
the two native engines.** `Features.cpp` runs a chain — `occtdraft::draftFaces`
at :2275, then `occtdraftlocal::draftFacesLocal` at :2285 on a defer, and only
when both decline does the OCCT fallback at :2291 run. The harness called just
:2275, which is an arm the call site does not have, and the harness's own rule
(§2.1) is that each arm is the exact call the call site makes. Fixed here; the
superseded row is left in `CMakeLists.txt` with a note beside it rather than
rewritten, exactly as the OFFSETSHAPE row was.

### 5. Two things the previous census got wrong, corrected by re-measurement

* **The anchor solve is no longer unexecuted.** §4 recorded "solved by anchor
  curve 0 — 0 parts". At `f53deeae` it fires on **150 moved vertices across 75 of
  the 565 parts**, 73 of which agree with OCCT and the other 2 of which are the
  native-only wins. The cylinder work made it reachable. Solve 3 (line versus
  quadric) is **still 0 and is still NOT claimed as proved.**
* **"0 native-only wins" is no longer true.** `ho296` and `ho857` are parts where
  `BRepOffsetAPI_DraftAngle` fails outright and the native chain returns a
  BRepCheck-VALID solid.

### 6. What remains, and what this does NOT claim

* **66 parts still defer**, all on `a drafted wall meets a non-planar face`, and
  **OCCT fails on all 66 as well**. Nothing is owed there against this incumbent.
* **The 52 are returned INVALID.** That is parity, not perfection: flipping the
  flag hands the caller exactly the solid the incumbent hands it today, carrying
  the same defect. A bar of "the drop must ship no invalid geometry" is not met —
  and is not met by `BRepOffsetAPI_DraftAngle` either, on the same 52 inputs.
* **One corpus, one derived operation.** 600 gold-reference STEP parts, the
  largest planar side wall, +Z pull, 3 degrees, neutral plane at z-min, ONE wall.
  Nothing here measures multi-wall drafts on the corpus, non-vertical walls, or
  any other distribution. The A/B fixtures cover a rotated frame, a negative
  angle, two walls at once and two bores, but seven fixtures are not a
  distribution.
* **Solve 3 is unreached**, on every fixture and on all 565 parts.
* **The closure did not move and could not have.** 14 before, 14 after.

### 6b. THE FLAG WAS ACTUALLY FLIPPED, AND THE LEDGER STILL DID NOT MOVE

A coverage gate that passes is a claim about what a build WOULD do. This one was
built. `cmake -DFORGE_DRAFT_DROP_NATIVE=ON`, full Release build of the `.node`
from the committed tree:

```
compiles and links clean; configure prints
  "TKOffset KEPT on the link line - still called by: FORGE_OFFSET_DROP_MAKEOFFSET;
   FORGE_FILLING_DROP_NATIVE;FORGE_THRUSECTIONS_DROP_NATIVE;FORGE_PIPE_DROP_NATIVE;
   FORGE_PIPESHELL_DROP_NATIVE;FORGE_THICKSOLID_DROP_NATIVE;
   FORGE_OFFSETSHAPE_DROP_NATIVE;FORGE_THICKEN_DROP_NATIVE"     <- J is gone from this list

                     default build     FORGE_DRAFT_DROP_NATIVE=ON
  OCCT_DIRECT              9                    9
  OCCT_CLOSURE            14                   14      <- UNMOVED
  OCCT_PHANTOM             2                    2
  TKOffset symbols        42                   36      <- the six family-J symbols
```

ft_smoke ALL PASS, ft_unified_edit 20 passed, directedit 9/9, ft_organic_smoke
ALL PASS — **against the drop build**, not the default one.

**Six of forty-two symbols, and zero of fourteen libraries.** That is the whole
shape of the TKOffset problem stated as a measurement rather than an argument:
family J is now genuinely droppable and dropping it buys nothing on its own,
because eight families still hold the toolkit on the link line.

### 7. Reproduced from a CLEAN, COMMITTED tree

The headline run above was taken from a dirty worktree (2 modified files under
`src`/`include`), which is a measurement of a tree nobody can check out. It was
therefore repeated after the commit, from `97969e33` with
`dirty_files_in_src_include_test = 0`, and compared row by row:

```
600 rows vs 600 rows, on applicable / status / reason / occt_ok / agrees /
nat_vol / occt_vol / nat_valid / occt_valid / nat_bc / occt_bc /
edges_rebuilt / edges_retrim / solve_anchor

rows differing on any of those 14 fields : 0
clean run: applicable 565, native agrees 497, OCCT 497, deletion bucket 0
```

Committed artefacts, both stamped with the commit they were run at:

| file | what |
|---|---|
| `corpus_ab/draft_local_probe.jsonl.gz` + `_manifest.json` | the AFTER run, clean tree, `97969e33` |
| `corpus_ab/draft_local_probe_BEFORE_f53deeae.jsonl.gz` + manifest | the BEFORE run, unmodified `f53deeae` |
| `corpus_ab/draft_validity_forensics_52.txt` | per-part thresholds and status multisets for all 52 carried parts |
| `corpus_ab/draft_family_j_20260903/` | the OFFICIAL flip-gate harness run for family J |

### 8. Reproduce

```
bash forge-kernel/test/run_ab_native_draft_local.sh --mutations
      -> 330 passed, 0 failed; 14/14 mutations RED
         NativeDraftLocal.o TKOffset/TKGeomBase/TKGeomAlgo imports: 0/0/0
bash forge-kernel/test/run_draft_local_probe.sh all <outdir>
      -> 600 rows; applicable 565; native agrees 497; OCCT 497; deletion bucket 0
bash forge-kernel/scripts/tkoffset_ledger_gate.sh forge-kernel/build/forge-kernel.node
      -> DIRECT 9, CLOSURE 14, PHANTOM 2, TKOffset syms 42 — PASS
bash forge-kernel/test/run_draft_validity_forensics.sh <outdir>
      -> 52 examined; 52 identical status multisets; max threshold diff 0.0e+00 deg;
         52 distinct thresholds; PASS
FAMILIES=DRAFT bash forge-kernel/test/run_corpus_ab_coverage.sh all <outdir>
      -> DRAFT PASS: both 497, nat-only 2, OCCT-only 0, agree 497/497 = 100.0%
bash forge-kernel/test/run_ab_all.sh          -> GREEN, all 9 harnesses built and
                                                 each matched its baseline
node forge-kernel/test/ft/ft_smoke.mjs        -> ALL PASS
node forge-kernel/test/ft/ft_unified_edit.mjs -> 20 passed
node forge-kernel/test/directedit.mjs         -> 9/9
node forge-kernel/test/ft/ft_organic_smoke.mjs-> ALL PASS
```

The engine's own object file is unchanged in what it needs from OCCT. Compiling
`origin/archdisc`'s `NativeDraftLocal.cpp` and this branch's with identical flags
and diffing `nm -u`: **141 undefined symbols each, 0 added, 0 removed, and the
per-toolkit counts identical across all fourteen toolkits** (TKOffset 0, TKGeomBase
0, TKGeomAlgo 0 in both).
