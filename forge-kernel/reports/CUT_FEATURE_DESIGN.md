# CUTFEATURE — design for the missing operation

**Date** 2026-07-30 · **Status** design only (kernel edit owned elsewhere) ·
**Motivating GT** `archie_edit_203` — *"locate 7 radial blade solids; select 2 (symmetric);
defeature/CUT the 2 blades; heal; verify blade count = 5"*.

Everything below that is stated as a measurement was **run today** through
`build/forge_verify` (native, Law 3) on a synthetic 7-blade hub built in the Unified IR.
The reproduction IR is in §2.0. Nothing here is estimated.

---

## 0. TL;DR

| | |
|---|---|
| Does anything close exist? | **No.** There is no feature recognition and no face-group→solid capability anywhere in the kernel. Every *ingredient* exists; the assembly does not. |
| Recommended construction | **(b2)** split the body by a parting cap *trimmed from the neighbour faces' own surfaces*, discard the lump that carries the selected faces. |
| IR surface | a **new op `CUTFEATURE`**, not a mode on `DEFEATURE`. Law 2 constrains the *structure*, not the op count. |
| Hardest sub-problem | **grouping** — deciding which faces form ONE protrusion. Measured today: the current selector gets this wrong and over-removes by a whole blade. |
| Biggest surprise | **`VERIFY "blades=5"` cannot express GT 203's own success criterion** and returns 0 on a correct 5-of-7 result. Measured. See §4.3. |
| Second surprise | **GT 203's recorded output is not a clean 2-blade cut.** Its surviving root faces and surviving tip spheres belong to *different* blades. See §2.5. |

---

## 1. What the kernel can already do

### 1.1 The four edit primitives — `include/forge/DirectEdit.hpp`

| Entry | Line | What it is |
|---|---|---|
| `unifyFaces(body)` | `DirectEdit.hpp:70` | merge same-surface faces; required before any face-level edit on a native-bridge solid |
| `faceInventory(body)` | `DirectEdit.hpp:73` | per-face `{index, kind, area, centroid, direction, radius, minorRadius, axisLocation, vMin, vMax, concave}` (`DirectEdit.hpp:36-60`) |
| `defeature(body, idx[])` | `DirectEdit.hpp:78` | `BRepAlgoAPI_Defeaturing` — `src/DirectEdit.cpp:226` |
| `pushPullFace` / `resizeBore` | `DirectEdit.hpp:83,90` | planar prism ± boolean; annulus ± boolean |

**`faceInventory` carries no adjacency and no grouping.** It is a flat list. Nothing in it
says "these eight bsplines and this sphere are one blade". That absence is the whole gap.

**`defeature` is structurally the wrong algorithm, not a broken one.**
`BRepAlgoAPI_Defeaturing` deletes faces and asks the *neighbours to extend* until the solid
closes again. Its domain is a feature the surrounding surfaces can close over — a hole, a
groove, a pocket, a blend. A blade is a lump of material bounded on all sides *by its own
faces*; there is no neighbour that can extend across it. The op is not missing a flag; it is
answering a different question.

### 1.2 Booleans — `include/forge/Booleans.hpp`

`fuse` / `cut` / `common` at `Booleans.hpp:7-9`. **`cut` is exactly the operation GT 203
names.** What is missing is not the cut, it is the *tool*.

`resetBooleanBudget()` (`Booleans.hpp:23`) exists because the OCCT boolean hang-guard is
process-global with a 20 s window; any op that issues k booleans in a loop must open a fresh
window per body or it inherits a starved budget (this cost 34% of a 6788-tree corpus once).

### 1.3 Splitting — **already present, but mold-private**

`BRepAlgoAPI_Splitter` is used at **`src/Mold.cpp:315`**, inside
`splitCavityCore(moldBlock, part, partingSurface)` (`include/forge/Mold.hpp:100`). It is not
a general kernel op: it takes a mould block, and it picks the two halves **by Z centroid**
(`src/Mold.cpp:326-340`), which is a mould-specific disambiguation, not a lump-selection rule.

**Toolkit cost of using `Splitter`: zero.** `nm -gU libTKBO.7.9.dylib` shows 8
`BRepAlgoAPI_Splitter` symbols and 10 `BRepAlgoAPI_Defeaturing` symbols — the *same* toolkit
that already supplies `BRepAlgoAPI_Cut`. Caveat, stated honestly: in this build tree
`build/CMakeCache.txt` carries `CMAKE_SHARED_LINKER_FLAGS = -undefined dynamic_lookup`
(cmake-js injects it, contradicting the comment at `CMakeLists.txt:947-948`), so
`nm -m build/Release/libforge_kernel_core.dylib` reports the `BRepAlgoAPI_*` symbols as
"dynamically looked up" and `otool -L` shows 8 toolkits without TKBO. The strict-link tree
`build-filletdrop/` records TKBO directly (9 toolkits). Either way **Splitter adds no toolkit
that Cut and Defeaturing do not already require** — the otool number cannot regress.

### 1.4 Shell-from-face-subset → cap → solid — **every link exists, wired backwards**

`forge::direct::deleteFaceAndHeal` (`src/DirectModeling.cpp:623-652`) already:

1. maps the faces (`TopExp::MapShapes`),
2. `BRep_Builder::MakeShell` over a **face subset** (`DirectModeling.cpp:632-644`),
3. hands the open shell to `heal::autoFillMissingFaces` to cap it.

It keeps the **complement**. The same twelve lines with the membership test inverted produce
the *feature* shell. That is the closest existing thing in the codebase, and it is one
boolean-negation away structurally — and a long way away semantically, see §3(a).

`forge::heal::autoFillMissingFaces` (`include/forge/Healing.hpp:65`, `src/Healing.cpp:399`):
`ShapeAnalysis_FreeBounds` → **closed** free wires only (`Healing.cpp:412`) →
`BRepOffsetAPI_MakeFilling` per wire (`Healing.cpp:419-429`) → `BRepBuilderAPI_Sewing` →
`BRepBuilderAPI_MakeSolid` + `ShapeFix_Solid` (`Healing.cpp:439-465`), reporting
`closedAfter`. Its own header comment is the load-bearing caveat:

> `src/Healing.cpp:72` — *"autoFillMissingFaces (`BRepOffsetAPI_MakeFilling`) — **FABRICATES
> a NEW filling patch**"*

Building a face on an **existing** surface bounded by a given wire —
`BRepBuilderAPI_MakeFace(surf, wire, Inside=true)` — exists at
`src/DirectModeling.cpp:692-697` (inside `replaceFace`). This is the primitive that lets a
cap be *trimmed from the hub's own surface* instead of invented.

Edge→face ancestry (the adjacency graph grouping needs): `TopExp::MapShapesAndAncestors` is
already used in 10 translation units — `src/Healing.cpp:128`, `src/Mold.cpp:207`,
`src/OcctImport.cpp:849`, `src/ClassASurfacing.cpp:674`. TKBRep, already linked.

### 1.5 Native (OCCT-zero) counterparts

* `native::brep::sewFaces` — `include/forge/native/brep/Sew.hpp:177`; returns connected
  shells plus a full diagnosis (free / manifold / non-manifold edge counts, `closed`, χ,
  genus — `Sew.hpp:95-125`). This is a *better* watertightness gate than the OCCT path gives.
* `native::geom::fitPlane / fitLine / fitSphere / fitCylinder` —
  `include/forge/native/geom/PrimitiveFit.hpp:146-149`, least-squares with honest RMS.
* **No native splitter, no native surface filling.** A native `CUTFEATURE` defers.

### 1.6 Feature recognition — **honest answer: none**

`grep -rn "recogni[sz]" include/forge/*.hpp` → **0 hits**. The nearest thing is
`forge::direct::inferFeature` (`include/forge/DirectModeling.hpp:73-83`), which classifies
**one** face into `Boss | Hole | Fillet | Blend | Chamfer` from its surface type alone. It has
no concept of a face group and no concept of a volume. Nothing close to "face group → solid"
exists anywhere in the kernel.

---

## 2. MEASURED TODAY — the state of GT 203

### 2.0 Reproduction

Synthetic 7-blade hub (hub r20 h12; blade 45×8×8 rooted at r15 so it truly merges):

```
%1 = CYL(20, 12)
%2 = BOX(45, 8, 8, 37.5, 0, 2)
%3 = PATTERN(%2, POLAR, 7, 360, 0, 0, 0, 0, 0, 1)
%4 = FUSE(%1, %3)
RESULT(%4)
```

`build/forge_verify` → `ok, valid, volume 33059.741692, faceCount 38, genus 0, shellCount 1`,
census `{cylinder:1, plane:37}`. Hub = π·20²·12 = 15079.644737, so **one blade = 2568.585279
mm³** and 7 blades = 17980.096955. Every number below is checked against those.

### 2.1 `VERIFY "blades=7"` passes on the input

`%1 = INPUT()  %2 = VERIFY(%1, "blades=7")` → `PASS blades=7 (got 7)`. The selector's
symmetry detector (`rotationalOrder`, `FeatureTreeCompiler.cpp:153-177`) is correct here.

### 2.2 `DEFEATURE(%1, "blade:2")` removes **three** blades, silently

```
%1 = INPUT()
%2 = DEFEATURE(%1, "blade:2")
```
→ `ok=true`, volume **33059.741692 → 25353.985855**, Δ = **−7705.755837**.
`3 × 2568.585279 = 7705.755838`. **Exactly three blades.** Census of the result: surviving
blade slots `{2,4,5,6}` — four blades, not five.

This is a **different failure from the one already fixed**. The loud guard added at
`FeatureTreeCompiler.cpp:1596-1606` fires only when the volume is *identical*. Here the
volume changed by a large amount, so the guard passed a wrong part. **The
volume-changed check is necessary and not remotely sufficient.**

Root cause, `FeatureTreeCompiler.cpp:1272-1279`:

```cpp
std::vector<int> chosenBins;                       // {0, 3} for want=2, bestN=7  — correct
...
const int b = std::min(bestN - 1,
                       static_cast<int>(it.ang / (2.0 * kPi / bestN)));   // <-- the bug
```

Membership is decided by which **fixed angular sector** a face centroid falls in. A blade is
not a sector: the blade centred on 51.43° has one side-face centroid at ~45.6°, which lands
in sector 0 and is therefore selected along with blade 0. `defeature` then removes that face,
and the healer eats the whole neighbouring blade. The `rotationalOrder` comment
(`FeatureTreeCompiler.cpp:144-152`) already records that binning was the wrong tool for
*symmetry*; the same insight has not yet reached *membership*.

**Design consequence: grouping is a first-class step and must be by face adjacency, not by
angle.**

### 2.3 The cut works — the *tool* is the whole problem

Untrimmed analytic tool (the blade box itself, which reaches inboard of the hub OD):

```
%2 = BOX(45, 8, 8, 37.5, 0, 2)      %3 = ROTATE(%2, 154.2857142857, 0,0,1, 0,0,0)
%4 = CUT(%1, %2)                    %5 = CUT(%4, %3)
```
→ volume **27299.741692**, Δ = **−5760.000000** = 2 × 2880 (the *full* boxes). It removed the
two blades **and gouged 622.829442 mm³ out of the hub**.

Tool trimmed at the parting boundary (`tool = BOX ∖ CYL(20,12)`):

```
%4 = CUT(%2, %3)                    # %3 = CYL(20, 12) — trim at the hub OD
%5 = ROTATE(%4, 154.2857142857, 0,0,1, 0,0,0)
%6 = CUT(%1, %4)                    %7 = CUT(%6, %5)
%8 = VERIFY(%7, "genus=0", "shells=1")
```
→ volume **27922.571134**; predicted `33059.741692 − 2 × 2568.585279 = 27922.571134`.
**Agreement to 1 part in 3·10⁸.** `PASS genus=0`, `PASS shells=1`, `valid=true`,
bbox strictly contained, surviving slots `{1,2,4,5,6}` — five blades, gaps at slots 0 and 3.

Two conclusions, both load-bearing:

1. **`CUT` with a correct tool is exact.** No new boolean capability is needed.
2. **The tool must be trimmed at the parting boundary.** Every candidate construction in §3
   is really a different answer to "how do you trim the tool at the parting boundary".

### 2.4 Face counts: raw ≠ unified

Trimmed cut: raw `faceCount 38 → 32` (−6) but the **unified** census went `38 → 28`
(−10 = 2 blades × 5 faces). The raw count is polluted by the boolean splitting the hub
cylinder into arcs. `VERIFY "faces="` reads the **raw** count
(`FeatureTreeCompiler.cpp:1633`, `forge::direct::faceCount`) while `VERIFY "holes="` reads
the **unified** body (`FeatureTreeCompiler.cpp:1641-1646`). Any face-count invariant for
`CUTFEATURE` must be on the unified census or it is unusable.

### 2.5 GT 203's recorded output is **not** a clean 2-blade cut

Parsed straight from `~/Downloads/archie_edit_203.log` §2 and §4 (format template only,
Law 8 — never a corpus):

| | input | output |
|---|---|---|
| faceCount | 156 | 140 |
| kinds | bspline 125, torus 14, sphere 7, cylinder 8, plane 2 | bspline 109, torus **16**, sphere 5, cylinder 8, plane 2 |
| blade-root faces (area ≈121.2, r = 135.1) | **7** at 42.20, 93.63, 145.06, 196.49, 247.92, 299.35, 350.77 | **5** — missing 145.06 and 299.35 |
| blade-tip spheres | **7** at 1.21, 52.64, 104.07, 155.50, 206.93, 258.36, 309.78 | **5** — missing 1.21 and 206.93 |
| bbox | ±293.34, z ∈ [−74.88, 74.88] | x ∈ [−297.92, 297.91], y ∈ [−297.92, 293.34], z ∈ [−77.68, 74.88] |

Three findings:

1. **The grid survives; the count does not re-space.** Both sets are the original 7-fold grid
   (360/7 = 51.4286°) with two members deleted, **3 grid steps apart** (145.06 → 299.35 is
   154.29° = 3 × 51.43). The GT did *not* rebuild a 5-blade impeller at 72°. That is exactly
   what `chosenBins = {0, 3}` produces for `want=2, bestN=7`
   (`FeatureTreeCompiler.cpp:1271-1274`) — **the symmetric-member choice is right**, and my
   trimmed-cut experiment reproduced the same gap topology.
2. **The roots and the tips disagree.** Root faces survive for blades at
   {42.20, 93.63, 196.49, 247.92, 350.77}; tip spheres survive for blades at
   {42.20, 93.63, 145.06, 247.92, 299.35} (root↔tip offset is a constant +10.44°, the blade
   sweep; the mismatch is the same under the opposite sweep sign). Only **3** blades have both
   a root and a tip. A clean removal of two whole blades cannot produce that.
3. **The envelope grew by 4.58 mm** (x-min −293.34 → −297.92), on an operation that can only
   remove material.

The record itself says it was *"reconstructed from the most complete artifacts recoverable"*
and that *"output envelope/topology differences are retained"* — so (2) and (3) may be
artefacts of the reconstruction rather than of the STEP. Either reading gives the same
instruction: **treat 203 as a format template, not a geometric target.** The invariants in §4
would fail the record. A correct `CUTFEATURE` should produce a *better* part than the GT and
should not be tuned to reproduce it.

---

## 3. The geometric problem, and the three constructions

> Given a set of faces known to belong to one protrusion, produce the SOLID that protrusion
> occupies, so it can be CUT from the body.

Restate it precisely, because the restatement is the design:

> Find the **parting loop** — the closed chain of edges of the face group whose other
> ancestor face is *not* in the group — and close the group across it with a surface that is
> **the body's own geometry**, not a new one.

Everything else follows.

### (a) Build a closed shell from the face group plus a cap on the parting boundary

**Needs**
1. group the selected faces into one protrusion (connected component under edge adjacency);
2. extract the parting loop (edges with exactly one ancestor inside the group);
3. cap it;
4. sew → shell → solid;
5. `cut`.

**What exists** — 1 and 2: `TopExp::MapShapesAndAncestors`, used in 10 TUs
(`src/Healing.cpp:128`). 3: `heal::autoFillMissingFaces` (`src/Healing.cpp:399`) *or*
`MakeFace(surf, wire, Inside)` (`src/DirectModeling.cpp:692`). 4: `Healing.cpp:439-465`;
natively `Sew.hpp:177` with a genuine watertightness diagnosis. 5: `Booleans.hpp:8`.
The face-subset shell build already exists inverted at `DirectModeling.cpp:632-644`.

**Where it fails**
* **The fabricated cap poisons the wound.** `Healing.cpp:72` is explicit that
  `BRepOffsetAPI_MakeFilling` *invents* a surface. The cap is the tool's inboard boundary, so
  the cut wound inherits the cap's error exactly. On a blade rooted on a curved hub the patch
  will bulge or dish; the volume delta is then approximate and the hub carries a scar. This is
  the most plausible mechanism for GT 203's 4.58 mm envelope growth (§2.5).
* **Open parting boundaries are silently skipped.** `autoFillMissingFaces` caps only
  `GetClosedWires()` (`Healing.cpp:412`); a blade that runs off the end of the hub, or one
  rooted on both a hub and a shroud (two loops), is not handled and the report merely shows
  residual open edges.
* **The group must be exactly complete.** One missing blade face and the shell is open there;
  the filler closes across the wrong loop and produces a plausible, wrong tool — the same
  silent-success class of failure this whole exercise exists to kill.
* **Root fillets are ambiguous.** A root-blend torus belongs to the blade *and* the hub. Its
  membership decides between "leave a fillet stub ring" and "gouge the hub". A flat face
  inventory cannot decide it. (GT 203's torus count *rises* 14 → 16, which is what a rebuilt
  root blend looks like.)

### (b) Split the body by the parting surface and discard the outboard lump

**(b1) analytic parting solid — the pie wedge.**
Tool = `(CYL R_out ∖ CYL R_hub) ∩ wedge(θ₁, θ₂) ∩ z-span`. Every primitive already exists in
the IR itself; I built and ran a version of it (§2.3, second experiment).

*Fails* when the blade is not prismatic-radial: it removes anything else in that sector
outboard of `R_hub` (a shroud band, a tip ring, a balance boss); it cuts a flat radial scar
straight through the root blend; and its angular span is wrong the moment the blade is swept
or leaned — which is every real impeller (GT 203's blades are bspline and its root→tip sweep
is +10.44°, §2.5). Exact only for a straight rib.

**(b2) split by the parting CAP only — recommended.**
Build **only** the cap patch(es), trimmed from the *neighbour faces' own surfaces* via
`MakeFace(surf, subWire, Inside)`; feed it to `BRepAlgoAPI_Splitter` as the tool; keep the
lump that does **not** contain the selected faces.

**What exists** — `BRepAlgoAPI_Splitter` (`src/Mold.cpp:315`, TKBO, no new toolkit);
`MakeFace(surf, wire)` (`src/DirectModeling.cpp:692`); ancestry (`src/Healing.cpp:128`);
lump selection is a face-map membership test, deterministic and cheap (`Mold.cpp:326-340`
shows the walk, with a Z-centroid rule that must be *replaced* by face membership).

**Why it beats (a)**
1. The tool never has to be a **closed watertight solid** — the hardest and most
   failure-prone step of (a) disappears entirely.
2. The wound *is* the cap, and the cap is trimmed from the hub's own surface, so **the hub
   geometry after the cut is bit-identical to the hub geometry before it**. Volume delta is
   exact — the property measured at 1 part in 3·10⁸ in §2.3.
3. The lump comes back from OCCT as a solid, so **its volume can be measured before the cut**
   and asserted. That converts every invariant in §4 from a post-hoc check into a pre-flight
   gate, and gives a truthful error instead of a wrong part.

**Where it fails** — the loop must be split into per-neighbour-surface sub-wires when the root
crosses a surface boundary (the same sub-problem (a) has, but here it is the *only* hard
sub-problem); a cap that self-intersects; tolerance defeating the splitter so the tool does
not fully cross. All three are detectable before the cut (`solidCount < 2`, as
`Mold.cpp:341-345` already does).

### (c) Reconstruct the protrusion analytically from its recognised primitive

**Needs** a feature recognizer. **What exists**: `PrimitiveFit.hpp:146-149` — plane, line,
sphere, cylinder, least-squares over a point set with an honest RMS; and single-face
classification `inferFeature` (`DirectModeling.hpp:73-83`). No recognizer, no fitter for
anything freeform.

**Where it fails**: immediately, for the motivating case. 125 of GT 203's 156 input faces are
bspline. No plane/cylinder/sphere fit recovers a twisted impeller blade. And even where it
works, **it still needs the parting trim**: measured in §2.3, the untrimmed analytic box
over-cut by 622.83 mm³ (12.1% of the intended removal) while the trimmed one was exact.

**Verdict**: (c) is a legitimate *accelerator* for the easy sub-family — a cylindrical boss, a
prismatic rib, a rectangular pad — when the fit RMS is under tolerance **and** the tool is
trimmed at the parting boundary. It is never the general path.

### Recommendation

```
AUTO  =  (b2) trimmed-cap split           -- primary; exact
      →  (a)  fabricated-cap shell + cut  -- fallback; volume becomes BOUNDED, not exact,
                                              and the op must SAY SO in its result
      →  DEFER LOUD                       -- never a silent approximation
```
`(c)` available as an explicit `WEDGE` / `PRIM` mode for the prismatic family, never in AUTO.

---

## 4. The IR surface

### 4.1 New op, not a mode — and why that does not violate Law 2

Law 2 mandates **one structure**: the Unified Feature-Tree IR, `%id = OP(args)`, one grammar,
one compiler entry, one vocabulary owned by `opFromName`
(`src/ft/FeatureTreeCompiler.cpp:117-142`, currently 40 ops). It does not mandate one op. A
41st entry in that table is the *same* structure; a second grammar, a side-channel, or an op
whose arguments are a different language would be the violation. Adding `CUTFEATURE` there is
Law-2-conformant by construction.

The three candidates:

| | proposal | verdict |
|---|---|---|
| (i) | `%n = CUTFEATURE(%body, "sel", …)` | **recommended** |
| (ii) | `DEFEATURE(%body, "sel", CUT)` — a mode | **reject** |
| (iii) | `%t = FEATURESOLID(%body, "sel")` then reuse `CUT(%body, %t)` | reject as default; keep as an option |

**(ii) rejected.** GT 203 says "defeature/cut", so the temptation is real. But it puts two
utterly different algorithms, two different domains (closable feature vs. lump) and two
different invariant sets behind one op name, and makes the difference between a right part and
a wrong part a single easily-dropped keyword. The measured failure mode of `DEFEATURE`
(§2.2 — succeeds, changes volume, wrong by a whole blade) is precisely *"it looks like it
worked"*. Do not add a mode flag to an op whose failure mode is invisibility. A distinct op
name also lets `DEFEATURE` keep its new loud guard as an absolute rule: *a lump is never
defeatured*, full stop.

**(iii) rejected as the default.** It composes beautifully and makes the tool inspectable
(`VERIFY` the tool before cutting). But it makes the planner emit two ops where the ground
truth says one; it introduces the IR's first "probe" op (a body in, a *different* body out
that is not the result); and a tree that gets the second op wrong builds a valid, wrong part.
Keep it in reserve as `CUTFEATURE(%body, "sel", KEEP)` returning the tool, if a tree ever
needs to assert on it.

### 4.2 Proposed grammar and semantics

```
%n = CUTFEATURE(%body, "sel" [, "sel2" ...] [, MODE])
     MODE ∈ { AUTO (default) | CAP | SHELL | WEDGE }
```

* **Selection reuses `resolveSelector` unchanged.** No new selection language — `@name`,
  `radial:k`, `blade:2`, `face:i`, `boss:…` all work. Law 2 again: one selector vocabulary.
* **Grouping happens in the OP, not in the selector.** The op takes the union of the resolved
  face indices and partitions it into connected components under edge adjacency. Measured
  justification (§2.2): the selector's angular-sector membership over-selects; and a selector
  answers *"which faces"*, while only the op needs to answer *"which faces are ONE removable
  body"*. Putting grouping in the op means every selector inherits it.
* **The op fails loud** — an `OpError` carrying the op id, matching the existing convention
  (`FeatureTreeCompiler.cpp:328-331`) — on:
  * zero groups, or a group that reaches the whole body;
  * `count(groups) != k` where `k` is what the selector claimed (GT 203: 2). This alone kills
    the measured 3-blade bug;
  * any selected face that is **concave** — a bore/pocket is `DEFEATURE`'s domain, and the op
    must say so. Mirror of the convex-boss refusal already in `RESIZEBORE`
    (`FeatureTreeCompiler.cpp:1553-1558`);
  * a tool that fails to close (SHELL mode) or a split that yields `< 2` solids (CAP mode);
  * any invariant in §4.4.
* **One boolean pass, `resetBooleanBudget()` first** (`Booleans.hpp:23`) — k tools cut in one
  sequence must not share a starved 20 s window.

### 4.3 Two companion changes the op cannot work without

**(A) A kernel-side grouping primitive.** Add next to `faceInventory`:

```cpp
struct FeatureGroup {
    std::vector<int> faces;        // face indices, one connected protrusion
    std::vector<int> partingEdges; // edges with exactly one ancestor inside `faces`
    bool   partingClosed;          // the loop(s) close
    int    loopCount;              // 1 for a simple root; 2 for hub+shroud
    double angle, radius;          // group centroid in cylindrical coords (for radial families)
};
std::vector<FeatureGroup> featureGroups(ShapeHandle body, const std::vector<int>& faces);
```

This is the reusable primitive. `CUTFEATURE` is its first consumer; the frontier B-rep
decomposer (`sacrosanct-per-context-decompose-and-scale`) is its second — it needs exactly the
same "which faces form one feature" answer.

**(B) Expose the groups in the census.** `forge_verify.cpp:298-306` argues that a *summarised*
census is the difference between a measured quantity and a guess, and emits all 156 faces for
that reason. The same argument applies one level up: a planner cannot ground *"select 2 of the
7 blades"* without seeing the 7 groups. Add a `"groups"` block alongside `"census"` under the
same `census:"full"` flag: `[{members: n, angle, radius, faces:[…], volumeEstimate}]`.

### 4.4 The `blades` VERIFY quantity is broken — measured

`VERIFY "blades=N"` (`FeatureTreeCompiler.cpp:1669-1690`) computes `rotationalOrder(angles)`
(`FeatureTreeCompiler.cpp:153-177`) — *the largest N under which the angle set maps onto
itself*. After removing 2 of 7 members the survivors sit on the **original 7-fold grid with
two gaps**, and that set has **no rotational symmetry at all**.

Measured, on the synthetic hub:

| body | assertion | result |
|---|---|---|
| 7 blades (input) | `blades=7` | `PASS blades=7 (got 7)` |
| 5 blades on the 7-grid (correct 2-of-7 cut) | `blades=5` | **`FAIL blades=5 (got 0)`** |

And the same is true of the ground truth's own answer: GT 203's five surviving root faces are
at 42.20, 93.63, 196.49, 247.92, 350.77 — under a 72° rotation 42.20 → 114.20, and the nearest
member is 93.63, 20.6° away. So **`VERIFY "blades=5"` fails on GT 203's correct result.** The
IR literally cannot state the ground truth's success criterion.

**Fix (design):** split the concept in two.

* `blades` / `radial` / `spokes` / `lugs` → a **member count**: the number of angular clusters
  of off-axis faces (gap-based clustering, or — better and free — `featureGroups().size()`).
* `symmetry` → keep `rotationalOrder` under its own honest name.

Correct GT 203 assertions then become, and both are checkable:

```
VERIFY(%in,  "blades=7", "symmetry=7")
VERIFY(%out, "blades=5", "symmetry=1")      # 5 members, NOT 5-fold — that is the point
```

Related: the `0.35 * maxR` on-axis cutoff appears **twice**, once in the selector
(`FeatureTreeCompiler.cpp:1228`) and once in the verifier (`FeatureTreeCompiler.cpp:1679`).
They agree by duplication, not by construction; a part can select 7 and verify 6 the day one
of them is tuned. It should be one named constant, or better, both should call
`featureGroups`.

---

## 5. The VERIFY invariants that prove a correct cut

Ordered by strength. The first three are **self-checks the planner cannot fudge**: the op
computes both sides itself.

| # | Invariant | Tolerance | Evidence it is achievable |
|---|---|---|---|
| **I1** | `Σᵢ vol(toolᵢ) == V_in − V_out` | rel **1e-9** | measured 27922.571134 vs 27922.571133 predicted — 1 part in 3·10⁸ (§2.3) |
| **I2** | `count(groups) == k` requested | exact | kills the measured 3-of-7 bug (§2.2) outright |
| **I3** | pairwise `|vol(toolᵢ) − vol(toolⱼ)|` for a *symmetric* selection | rel **1e-6** | the 7 synthetic blades are 2568.585279 mm³ each; a mis-grouped tool is a different size |
| **I4** | `bbox(out) ⊆ bbox(in)`, strictly | 1e-6 mm | measured: `[−55.79,−59.39,0]..[60,59.39,12]` → `[−55.79,−59.39,0]..[40.54,59.39,12]`. **GT 203 violates this by 4.58 mm** (§2.5) — gate on it anyway |
| **I5** | `genus` and `shellCount` unchanged; `valid` stays true | exact | measured `PASS genus=0`, `PASS shells=1`, `valid=true`. `shellCount > 1` means the tool crossed the hub; a genus change means it opened a passage |
| **I6** | unified face census: for each kind belonging to the group, `Δkind == −k × (per-member count)`; for kinds not in the group, `Δkind == 0`; blend kinds (torus) exempt | exact | GT 203: bspline 125→109 (−16 = −8/blade), sphere 7→5 (−2 = −1/blade), **cylinder 8→8 and plane 2→2 unchanged**, torus 14→16 (the rebuilt root blend — hence the exemption). Synthetic: unified 38→28 = −10 = 2 blades × 5 planes |
| **I7** | radial member count `N → N − k` | exact | **requires the §4.4 fix**; today this assertion returns 0 and fails on a correct part |
| **I8** | `V_out < V_in` strictly | — | the existing guard (`FeatureTreeCompiler.cpp:1596-1606`). Keep it; it is necessary and **not sufficient** — measured §2.2 |

Secondary, useful as a band and never as a gate: **voxel IoU against the input**. Measured
0.830 for a clean 2-of-7 cut on the synthetic (`forge_verify` `refStep` + `iouGrid:96`). A
2-of-7 cut cannot legitimately score 0.99 (nothing removed) or 0.2 (body destroyed).

**Tolerance note.** `opVerify`'s comparator is `tol = max(1e-6, 1e-3·|want|)`
(`FeatureTreeCompiler.cpp:1699`) — 0.1% relative, i.e. 27.9 mm³ on this body, roughly 1% of a
blade. That is tight enough to catch the 3-blade error (9.2% off) and far too loose to catch a
heal bulge. **I1 must therefore be enforced by the op against its own tools, not by a
planner-authored `VERIFY "volume=…"` line.** The planner's assertions are the *outer* gate;
I1–I3 are the *inner* one.

**Fallback honesty.** If AUTO degrades to the fabricated-cap path (§3a), I1 is not achievable.
The op must then (a) relax I1 to a bound — `|Σ vol(toolᵢ) − (V_in − V_out)| ≤ ε·V_in` with ε
declared — and (b) record in its result that the volume is bounded, not exact. It must never
silently downgrade.

---

## 6. What CANNOT be done this way, and still defers

1. **A protrusion with no parting boundary.** A blade blended G1/G2 into the hub with no edge
   where they meet has no loop to cap and no lump to split. The honest alternative is
   reconstructing the hub surface across the blade footprint — that is the *curved-preserving
   native heal* capability the OCCT-zero plan already names as the hard remaining keystone
   (`reports/OCCT_ZERO_NEXT_STEP_2026-07-30.md`, `KERNEL_UNIFIED_STATUS.md`). Defer, loudly.

2. **Anything that is not a lump.** Holes, pockets, grooves, blends stay on `DEFEATURE`.
   `CUTFEATURE` must *refuse* a concave selection rather than produce something.

3. **Removal that must RESTORE geometry the body never had.** Taking a blade out of a
   *shrouded* impeller opens a flow passage between hub and shroud; the correct 5-blade part
   has different passages, not merely a missing lump. No local operation can produce that.

4. **Re-spacing.** "Reduce blades from 7 to 5" means, to an engineer, five blades at 72°.
   Measured (§2.5): GT 203 did **not** do that — the survivors sit on the 7-grid with two
   gaps. `CUTFEATURE` cannot re-space and must not pretend to. A re-space is a *rebuild*
   (`PATTERN POLAR` on the generation half of the IR), a different plan entirely. This is a
   real limit of the whole edit family, not of this op.

5. **Non-manifold / tangent-only protrusions.** Measured: my first synthetic, with the blade
   root exactly tangent to the hub at x=20, built with `shellCount 7` and `valid=false` —
   volume was still exact (32999.644737 = hub + 7 × 2560), but the body is not a solid in the
   sense a parting loop requires. A tool meeting the body along a line or a point has no
   well-posed parting boundary. Detect (`I5`) and defer.

6. **Overlapping or face-sharing protrusions.** A fully-bladed rotor at small pitch merges
   under connected-component grouping into one group. The op must detect
   `count(groups) < k` (I2) and defer rather than cut the merged lump.

7. **A native (OCCT-zero) `CUTFEATURE`.** The construction rests on `BRepAlgoAPI_Splitter`,
   `BRepOffsetAPI_MakeFilling` and `BRepBuilderAPI_MakeFace` — TKBO / TKOffset / TKBRep. The
   native side has `sewFaces` with a real watertightness diagnosis (`Sew.hpp:177`) and nothing
   else. A native port defers behind the native boolean and heal keystones. **No new OCCT
   toolkit is added by this design** (§1.3) — but no toolkit is dropped by it either.

8. **Tolerance-driven failures of the splitter.** When the cap and the body's own faces are
   coincident to within the boolean fuzzy tolerance, the split can produce one solid instead
   of two. `Mold.cpp:341-345` already shows the right response — count the solids and throw
   with a diagnosis. Detectable, therefore honest; not fixable inside this op.

---

## 7. Summary of concrete asks on the kernel (owner: you)

1. `featureGroups(body, faces) -> std::vector<FeatureGroup>` next to `faceInventory`
   (§4.3A). This is the load-bearing new capability; everything else composes.
2. `CUTFEATURE` in `opFromName` (`FeatureTreeCompiler.cpp:117-142`) + `opCutFeature`, with
   AUTO = trimmed-cap split → fabricated-shell → defer loud (§3).
3. Split the `blades` VERIFY quantity into **member count** and **`symmetry`**
   (`FeatureTreeCompiler.cpp:1669-1690`) — today it fails a correct part (§4.4). Fold the
   duplicated `0.35 * maxR` (lines 1228 and 1679) into one source.
4. Fix radial selector membership: replace fixed-sector binning
   (`FeatureTreeCompiler.cpp:1276-1277`) with group membership (§2.2).
5. `"groups"` block in the `census:"full"` output of `forge_verify.cpp:298-348` (§4.3B).
6. Make `VERIFY "faces="` unified-census-consistent with `"holes="` (§2.4).

**Reproduction artefacts** (scratchpad, regenerable from the IR in §2.0):
`…/scratchpad/hub7b.step` (7-blade input), `df2.step` (DEFEATURE result, 4 blades),
`cut2.step` (untrimmed tool, over-cut), `cut2t.step` (trimmed tool, exact).
