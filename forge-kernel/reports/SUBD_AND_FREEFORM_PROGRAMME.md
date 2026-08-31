# SubD and Free-Form B-Rep — capability census and op-family design

Design track, 2026-08-31. Pinned to `32ee7485` (origin/main at time of writing).
Every count below was re-derived in this worktree; the method is given so each can be re-run.

---

## 0. Executive summary

| Claim under audit | Verdict |
|---|---|
| "SubD 18 files / Subdiv 17" in `forge-kernel/src` | **1 real, 17 artifacts.** |
| The real SubD is a subdivision *surface* system | **No.** It is Loop subdivision on a triangle soup — no cage, no creases, no B-rep conversion. |
| The real SubD is wired to something | **No.** It is not in `CMakeLists.txt`, so it never enters `forge_kernel`. Its test is not a registered gate. |
| "Class A ZERO" | **False negative.** `ClassASurfacing.cpp` is 760 compiled lines, exposed to JS. The census grepped `"Class A"` with a space. |
| Free-form B-spline machinery exists | **True, and it all compiles** — unlike the mesh tier. |
| Free-form machinery is reachable from the IR | **Almost none of it.** Coons, Gregory, SSI, surface curvature, knot insertion have **zero non-test callers**. |

The headline finding is not the missing SURFACE kind. It is a **measured, presently-firing defect**: `TAG`
— the persistent-naming mechanism the whole edit story rests on — **cannot name a b-spline face at all**,
and throws an ambiguity error that misdiagnoses its own cause. On the owner's own fixture
`archie_edit_214` this makes **92 of 430 faces (21.4%) unnameable**. Section 4 proves it and gives
the fix, which is one predicate replaced in three places.

---

## 1. SubD: what is real

### 1.1 The 17 artifacts

`grep -ril "subd"` matches `subdiag`, `subdivide`, `subdivision`, `subdiv`. Every hit was read:

| File | What "subd" actually is |
|---|---|
| `native/linalg/LinAlg.cpp` | `subdiag` — Householder tridiagonalisation. A substring collision. |
| `native/implicit/IntervalMesh.cpp`, `AdaptiveIntervalMesh.cpp` | Octree *spatial* subdivision in an implicit mesher. |
| `native/brep/NurbsSurfaceIntersect.cpp` | `subdiv` is an **int** — a uniform (u,v) grid resolution for SSI localisation. |
| `native/brep/Boolean.cpp`, `TrimmedFace.cpp`, `SolidTessellate.cpp`, `UnifyFaces.cpp`, `MassProps.cpp`, `Check.cpp`, `Fillet.cpp` | Parameter-domain / quadrature-strip refinement. Comments and tessellation, not surfaces. |
| `DirectModeling.cpp` | `adaptiveSubdivide` — chordal bisection of a curve for viewport display. |
| `Terrain.cpp`, `FeaTet.cpp`, `native/am/Am.cpp`, `OcctNativeMesh.cpp` | Mesh refinement comments (Freudenthal, isoline). |
| `native/geom/Bezier.cpp` | `subdivideCurve` — de Casteljau split. **Real algorithm, but a curve, not a surface.** |

None of these is subdivision-surface machinery.

### 1.2 The one real file

`src/native/mesh/Subdivide.cpp` (344 lines) + `include/forge/native/mesh/Subdivide.hpp` (113 lines).

```cpp
SubdivideReport subdivideLoop(const std::vector<double>&        positions,
                              const std::vector<std::uint32_t>& indices,
                              const SubdivideOptions&           options,   // {levels, repositionOriginals}
                              std::vector<double>&              outPositions,
                              std::vector<std::uint32_t>&       outIndices);
```

It is honest, well-documented work: exact Loop masks (edge `3/8(a+b) + 1/8(c+d)`; vertex
`(1-nβ)v + βΣ`, with Loop's trigonometric β), a convex-combination guard, and an independent
re-audit of the output through `HalfEdgeMesh::validate()`.

**I built and ran it** (standalone, per the recipe in its own test header):

```
=== RESULT: 35 / 35 passed ===
[S1-icosa] surfaceDev: coarse=0.12353 -> L1=0.03933 -> L2=0.01172   (converging to sphere)
[S2-octa]  surfaceDev: coarse=0.29081 -> L1=0.12014 -> L2=0.04492
```

The code works. That is worth saying plainly before the rest of this section takes it apart.

### 1.3 But it is dead code

Method: extract `src/native/mesh/*.cpp` from disk, extract the same pattern from `CMakeLists.txt`
(which uses an **explicit source list**, not a glob), and `comm` the two.

- `Subdivide.cpp` is **absent from `CMakeLists.txt`**. It never enters `libforge_kernel`.
- `grep -c "subdivide_test" CMakeLists.txt` → **0**. Not a registered gate; it runs only if a human types the compile line in its header comment.
- Non-test references to `subdivideLoop` anywhere in the repo: **zero**.
- It is not alone: **21 of 28** `native/mesh` sources are uncompiled, including `QuadDominant.cpp`, `Remesh.cpp`, `Offset.cpp`, `Curvature.cpp`, `HoleFill.cpp` — several of which the SubD path would want.

This is the failure mode already recorded in this repo's own ledger as *"a file nothing compiles cannot break."*
The Loop subdivider has never regressed because nothing has ever linked it.

### 1.4 Why Loop is the wrong scheme anyway

Even fully wired, this does not yield CAD SubD:

| Requirement for parametric SubD | Loop code | Why it matters |
|---|---|---|
| Quad cages | Triangles only | Every CAD SubD UI (Fusion T-Spline, Alias, Catia ICEM) is quad-based. |
| Creases / sharpness | **None** | Without creases SubD cannot represent a hard edge — i.e. cannot make a manufacturable part. |
| Open cages | **Rejected** — `"input mesh is not watertight (open/boundaried) — unsupported"` | A fender, a bottle shoulder, any panel is an open cage. Loop's boundary mask is standard and deliberately absent. |
| Exact B-rep conversion | Impossible in principle | Loop's limit surface is a **box-spline**, not a NURBS. Catmull-Clark's limit surface *is* bicubic B-spline away from extraordinary vertices — that is precisely why every CAD SubD system uses it. |

So: the honest statement is that **Forge has a verified Loop mesh subdivider and zero CAD SubD capability.**
Loop is not a stepping stone to Catmull-Clark; the masks, the cage topology and the conversion story all differ.

---

## 2. Free-form B-rep: the capability census

Unlike the mesh tier, **every one of the 59 `native/brep` sources compiles** (same `comm` method: empty difference).
The machinery is in the library. The question is only whether anything can call it.

| Verb | Exists? | Entry point | Non-test callers | Reachable from IR |
|---|---|---|---|---|
| **create** — fit to points | Yes | `forge::fitSurface` (`NurbsFit.hpp`) | JS binding `fitSurface` | **No** |
| **create** — Coons / Gordon patch | Yes | `fillCoonsPatch`, `exportBicubicSurface` | **none** | **No** |
| **create** — n-sided Gregory patch | Yes | `fillGregoryPatch` (`GregoryFill.hpp`) | **none** | **No** |
| **create** — loft / sweep | Yes | `loftguide::loft` → `BRepOffsetAPI_ThruSections` | compiler | **YES** — `LOFT`, `SWEEP` |
| **evaluate** — point / derivatives | Yes | `evaluatePoint`, `evaluateWithDerivatives` | internal | **No** |
| **evaluate** — normal / curvature | Yes | `surfaceNormal`, `surfaceCurvature` | **none** | **No** |
| **algebra** — knot insert, degree elevate, isocurve | Yes | `insertSurfaceKnot`, `elevateDegree`, `isoCurveU/V` | **none** | **No** |
| **intersect** — surface/surface | Yes | `NurbsSSI` (localize → march → refine) | **none** | **No** |
| **trim** | Yes | `TrimmedFace` + `TrimLoop` | internal | **No** |
| **sew** | Yes | `sewFaces` / `diagnoseShell` (`Sew.hpp`) | JS `sew`, `sewShape` | **No** |
| **offset** | Yes | `offsetSurfaceOutward`, `OffsetShape` | JS `offsetSolid` | **No** |
| **thicken** | Yes | `thickenShell` (`NativeThickenShell.hpp`) | JS `thickenSurface` | **No** |
| **Class-A diagnostics** | Yes | `ClassASurfacing.cpp` — zebra, curvature comb, G0–G3 continuity, G2 stitch, guided sweep | JS `classAAnalyse`, `zebraStripes` | **No** |

Two things follow.

**(a) The census's "Class A ZERO" was wrong.** `ClassASurfacing.cpp` is 760 lines, compiled, and implements
exactly the surfacing diagnostics the label denies. A grep for `"Class A"` cannot match `ClassASurfacing`.
A false negative in a capability census is more dangerous than a false positive: it argues for building
something that already exists.

**(b) The gap is not machinery, it is *addressability*.** Coons, Gregory, SSI, curvature and knot algebra
are A/B-verified against OCCT in `test/native_vs_occt_surfacefill*.cpp` and `native_vs_occt_gregory_nsided.cpp`
— and then called by nothing. They are a library with no door.

### 2.1 The structural reason

The IR's 40 ops produce exactly three value kinds — `PROFILE`, `SOLID`, `WIRE`. The generated vocabulary
asserts its own completeness:

```json
"value_kind_closure": { "produced_by_allowed_ops": ["PROFILE","SOLID","WIRE"], "gaps": [] }
```

`"gaps": []` is computed over the ops that exist. A missing *kind* is invisible to a closure check that
enumerates the ops producing the kinds it already has. The check cannot see its own blind spot.

**Feasibility note that shortens the work considerably:** on the OCCT path a surface needs **no new storage**.
A `TopoDS_Face` *is* a `TopoDS_Shape`, so `ShapeRegistry`'s existing `Kind::Occt` entry already holds one.
`ShapeKind` is a 3-value enum (`Occt`, `NativeSolid`, `NativeMesh`) designed to be extended, and the native
side already has `SurfaceKind::Nurbs`. Adding `SURFACE` to the IR is a *type-system* change, not a
kernel-storage change.

---

## 3. What the IR can do with the 67 b-spline faces today

`archie_edit_214`'s inventory, re-verified from the log: 430 faces — cylinder 167, torus 125, **bspline 67**,
sphere 25, plane 42, cone 4.

`faceInventory` (`DirectEdit.cpp:330`) *does* classify them:

```cpp
case GeomAbs_BSplineSurface:        fi.kind = "bspline";    break;
case GeomAbs_BezierSurface:         fi.kind = "bezier";     break;
case GeomAbs_SurfaceOfRevolution:   fi.kind = "revolution"; break;
```

So Archie can *see* b-spline faces. Can it *select* one? The selector families in `resolveSelector` are:

| Family | Can it reach a b-spline face? |
|---|---|
| `+Z` / `-X` axis-extreme | No — `if (f.kind != "plane") continue;` |
| `plane:max-area` | No — plane-only |
| `bore:` / `hole:` / `boss:` / `shaft:` | No — cylinder-only |
| `radial:` / `blade:` / `lug:` / `spoke:` | Incidentally, by centroid angle — kind-agnostic, but selects *groups*, not a named face |
| `face:N` | **Yes — but by raw index**, the fragile thing `TAG` exists to replace |
| `@name` (TAG) | **No — see §4. It throws.** |

So the single deterministic way to address a b-spline face is a raw integer index into a face map that
every edit renumbers.

---

## 4. ★ The measured defect: `TAG` cannot name a b-spline face

This is a live bug, not a design gap.

### 4.1 The mechanism

`faceInventory` populates `direction`, `axisLocation`, `radius` **only** for plane / cylinder / cone / torus
(and `radius` alone for sphere). For `bspline`, `bezier`, `revolution`, `other` it sets **only** `kind`,
plus `area` and `centroid` from the common prologue. `FaceInfo` defaults leave the rest at zero:

```cpp
std::array<double,3> direction{{0,0,0}};
std::array<double,3> axisLocation{{0,0,0}};
double radius = 0.0;
```

`sigOf` then chooses which anchor to remember (`FeatureTreeCompiler.cpp:1355`):

```cpp
const bool curved = (f.kind != "plane");
s.at[k] = curved ? f.axisLocation[k] : f.centroid[k];
```

A b-spline face is "curved", so its signature anchors on `axisLocation` — **which is never set** — and
**discards `centroid`, the one field that distinguishes it.** Every b-spline face therefore has the
identical signature `at={0,0,0}, dir={0,0,0}, radius=0`.

`sigDistance` between any two of them is consequently **exactly 0.0**, and the ambiguity guard fires:

```cpp
if (secondD < 1e299 && std::fabs(secondD - bestD) < 1e-6)
    throw OpError(opId, "@" + key + " is ambiguous: two faces match it "
                        "equally well (a PATTERN duplicated the feature?)");
```

The diagnosis is wrong in a way that will cost a debugging session: no `PATTERN` is involved. The name
collides because the signature is empty.

### 4.2 Measured on the owner's fixture

I replicated `sigOf`/`sigDistance` exactly, restricted to the kinds the C++ **provably** leaves axis-less,
and ran it over the 430 real face records in `archie_edit_214.log`:

```
kind          total  ambiguous     pct
bspline          67         67    100.0%
sphere           25         25    100.0%
subtotal         92         92
as a share of all 430 faces: 21.4%
```

**21.4% of the ground-truth part cannot be named by the mechanism the entire edit story depends on.**

> **Method correction, recorded deliberately.** My first pass reported 84.7% (including cylinders, tori and
> cones). That was an artifact: `archie_edit_214.log` never emits `axisLocation`/`direction` at all
> (`grep -c` → 0), so I had fed zeros to kinds whose *live* code populates them properly. The 21.4% figure
> is restricted to kinds where the C++ itself leaves the fields unset. Cylinders, cones and tori are fine.

### 4.3 The fix — one predicate, in three places

The discriminating information is already in the inventory — **64 distinct areas across the 67 b-spline
faces**, and all 67 centroids differ. `sigOf` throws it away. The anchor test should ask whether the face
*has an axis*, not whether it is *non-planar*:

```cpp
// axis-bearing kinds anchor on the axis; everything else anchors on its centroid,
// which is always populated. A b-spline face has no axis, and pretending it sits
// at the origin collapses every free-form face onto one signature.
const bool hasAxis = (f.kind == "cylinder" || f.kind == "cone" || f.kind == "torus");
s.at[k] = hasAxis ? f.axisLocation[k] : f.centroid[k];
```

The same predicate appears at `FeatureTreeCompiler.cpp:1356` (`sigOf`), `:1372` (`sigDistance`) and `:1423`
(the `bestPos` check in `resolveSelector`); all three must change together or the signature and the
distance disagree. Sphere is fixed by the same change (it has a centre, not an axis). It is a strict improvement for every
kind: no axis-bearing face changes behaviour.

### 4.4 Why this is the binding constraint in miniature

The owner's rule — *"don't gate anything; a validator that refuses input is a capability gate wearing a
safety hat, and it will fire hardest on the longest, densest, most curved trees"* — describes this bug
exactly. The ambiguity guard is a genuine safety check that fires **only on free-form geometry**, is
**silent on prismatic parts**, and gets **worse the more curved the part is**. A part with one b-spline
face works; the 67-face fixture fails 100% of the time. That is the predicted failure shape, observed.

---

## 5. Proposed op family A — free-form B-rep authoring (near-term, high value)

Signatures follow the existing conventions exactly: uppercase op, `%ref` operands, `[, x=default]`
optionals, `[x y z; ...]` point lists, `UPPERCASE` keyword flags, quoted selector strings.

### 5.1 The one structural prerequisite

Add a fourth value kind, **`SURFACE`** — a single trimmed or untrimmed face. Per §2.1 this costs no new
kernel storage on the OCCT path.

### 5.2 Producers — → `SURFACE`

```
SURFOF(%body, "sel")                     lift an existing face out of a solid as a SURFACE
FITSURF([x y z; ...], nu, nv [, degU=3, degV=3] [, TOL t])
                                         least-squares B-spline through an nu x nv point grid
NET(%w0, %w1 [, %w2 ...] [, VDIR %wv0, %wv1 ...])
                                         Coons/Gordon surface through a curve network
PATCH(%w0, %w1, %w2 [, %w3 ...] [, G1|G2])
                                         n-sided Gregory patch from boundary WIREs
```

`SURFOF` is the important one, and it is the smallest. It makes all 67 b-spline faces addressable
without inventing any geometry. `NET` and `PATCH` are thin wrappers over `fillCoonsPatch` and
`fillGregoryPatch`, which are already OCCT-A/B-verified and called by nothing.

### 5.3 Modifiers — `SURFACE` → `SURFACE`

```
OFFSETSURF(%s, dist)                     -> offsetSurfaceOutward
TRIMSURF(%s, %w [, KEEP INSIDE|OUTSIDE]) -> TrimmedFace / TrimLoop
EXTENDSURF(%s, dist [, U0|U1|V0|V1|ALL]) natural (knot-domain) extension
REFINE(%s, U|V, t)                       -> insertSurfaceKnot; adds control freedom, shape unchanged
ELEVATE(%s, U|V, t)                      -> elevateDegree
```

`REFINE` deserves a note: it is shape-preserving by construction, so it is the safe way for a long tree
to buy the degrees of freedom a later edit needs — the opposite of a gate.

### 5.4 Consumers — `SURFACE` → `SOLID` / `WIRE`

```
SEW(%s0, %s1 [, %s2 ...] [, TOL t])      -> sewFaces; the SURFACE -> SOLID bridge
THICKEN(%s, t [, BOTH])                  -> thickenShell; the other bridge
ISOCURVE(%s, U|V, t)                     -> isoCurveU/isoCurveV, yields a WIRE
SSI(%s0, %s1)                            -> NurbsSSI, yields a WIRE (or several)
REPLACEFACE(%body, "sel", %s)            swap a face's surface in place; keeps the solid a solid
```

`SURFOF` + `REPLACEFACE` together are what make free-form *editing* parametric rather than a rebuild:
lift a face, modify it, put it back, with the rest of the tree untouched.

### 5.5 Queries — for use inside `VERIFY`

```
CURVATURE(%s, u, v)                      -> surfaceCurvature {mean, gaussian}
CONTINUITY(%s0, %s1 [, G0|G1|G2])        -> ClassASurfacing continuityCheck
```

These give `VERIFY` something to assert about free-form geometry. Today it can only assert volumes and
bounding boxes, which §"volume cannot validate geometry" in this repo's ledger already showed to be
insufficient.

### 5.6 Non-gating behaviour — required, not optional

Every op above must **represent, repair, or tolerate** before it refuses:

- **`SEW` must not be all-or-nothing.** When the faces close, return a `SOLID`. When they do not, return
  the sewn shell *and name the unsewn edges* — `diagnoseShell` already computes exactly this and is
  currently unused. A `SEW` that throws on a 300-face tree destroys the whole tree.
- **`PATCH` must degrade, not refuse.** If `G2` is unattainable on a boundary, emit `G1` and say so in the
  report. Refusing a continuity request kills the tree; downgrading it costs a smoothness the caller can
  re-request.
- **`FITSURF` must report residual, not gate on it.** Return the fit plus its max deviation; let `VERIFY`
  decide the tolerance. A hard tolerance inside the constructor is a gate that fires hardest on the most
  organic input.
- **Errors must name the entity.** Existing selector errors already do this well (`"@x no longer matches
  any face … nearest candidate is 60mm away"`). Every new op must match that bar so a repair loop has
  something to act on. §4.1's `PATTERN` misdiagnosis is the counter-example to avoid.

### 5.7 Ordering, by value per unit of work

| # | Change | Why first |
|---|---|---|
| 1 | **`sigOf` anchor fix (§4.3)** | One predicate, three call sites. Unblocks 21.4% of the fixture. No new ops, no new kinds. |
| 2 | `SURFACE` value kind + `SURFOF` | Smallest change that makes free-form geometry addressable. |
| 3 | `REPLACEFACE`, `OFFSETSURF`, `TRIMSURF` | The edit verbs; all wrap compiled, verified code. |
| 4 | `SEW` / `THICKEN` | Closes the loop back to `SOLID`. |
| 5 | `NET` / `PATCH` / `FITSURF` | De-novo authoring; largest surface area, least immediate benchmark pressure. |
| 6 | `SSI`, `ISOCURVE`, `CURVATURE`, `CONTINUITY` | Query/verify tier. |

Steps 1–4 are wrappers over machinery that already compiles and is already A/B-tested against OCCT.
That is the cheap 80%.

---

## 6. Proposed op family B — SubD

**Stated plainly: there is no CAD SubD capability to expose.** What follows is a design, with costs, not a
description of something that exists.

### 6.1 Prerequisite: the scheme must change

Catmull-Clark on quad cages, not Loop on triangles — because CC's limit surface is bicubic B-spline away
from extraordinary vertices, which is the only reason SubD→B-rep is exact rather than a fit. The existing
`Subdivide.cpp` is not a starting point for this beyond `HalfEdgeMesh`, which it uses and which *is*
compiled.

### 6.2 The op family

Introduce `SUBD` as a fifth value kind (a control cage; distinct from `SURFACE`, which is a limit patch).

```
CAGE([x y z; ...], [i j k l; ...])       quad control cage: points, then quad indices
CAGEOF(%body [, "sel"] [, TARGET n])     quad-remesh an existing solid into a cage
CREASE(%cage, "sel", sharpness)          per-edge/vertex sharpness; 0=smooth, INF=hard
SUBDIV(%cage, level)                     -> SUBD, refined
TOBREP(%subd [, TOL t])                  -> SOLID   ** the hard one **
TOSUBD(%body [, "sel"])                  -> SUBD    ** the other hard one **
```

`CREASE` reuses the existing selector grammar, so `TAG`'s persistent names work on cage edges — provided
§4.3 lands first, since a cage has no axis-bearing faces at all.

### 6.3 Costs — honest

| Piece | Est. LOC | Notes |
|---|---|---|
| Quad-capable Catmull-Clark refinement | ~400 | `HalfEdgeMesh` exists and is compiled; needs n-gon support. |
| Creases — sharp + semi-sharp (Hoppe/DeRose) | ~250 | Non-negotiable; without it SubD cannot make a manufacturable part. |
| Boundary rules (open cages) | ~150 | The current code *refuses* open meshes. Must become supported, per §5.6. |
| Limit-surface patch extraction (regular) | ~400 | Regular quads → bicubic B-spline patches directly. |
| Extraordinary-vertex caps | ~400 | **`GregoryFill` already exists and is verified** — this is the piece that makes `TOBREP` tractable rather than research. |
| `TOBREP` assembly + sew + tolerance report | ~300 | Wraps `sewFaces`. |
| `TOSUBD` (quad remesh) | unknown | `QuadDominant.cpp` exists but is **uncompiled and unverified**. Assess before estimating. |
| Wiring, gates, IR plumbing | ~300 | |

Roughly **2,200 LOC of new, verified kernel work**, plus an unknown on `TOSUBD`. Two of the seven pieces
are already built (`HalfEdgeMesh`, `GregoryFill`).

### 6.4 Recommendation

**Do family A first, and do not start family B on benchmark grounds.**

The ground truth argues for it: `archie_edit_214` is 67 b-spline faces and **zero** SubD cages, and
`task_101`'s 14 authoring ops → 329 faces need no SubD either. Free-form B-rep is 15% of a real fixture
today; SubD is 0%. Family A is mostly *wrapping code that already compiles and is already A/B-verified*;
family B is ~2,200 lines of new kernel. The single highest-value change in this entire report is the
single predicate fix in §4.3.

If SubD is wanted for product reasons rather than benchmark reasons, that is a legitimate call — but it
should be made knowing it is a from-scratch build, not an exposure of existing capability.

### 6.5 Meanwhile, one cheap honesty repair

Either wire `Subdivide.cpp` into `CMakeLists.txt` and register `subdivide_test` as a gate (~1 hour, gets a
verified Loop subdivider into the library and under CI), or move it to a clearly-marked `unwired/`
directory. Leaving 344 verified lines that nothing compiles is how a census comes to report "SubD 18 files"
and a reader concludes there is a subdivision system. The same applies to the other 20 uncompiled
`native/mesh` sources.

---

## 7. Reproducing every number here

```bash
# §1.1/1.2 — SubD census
grep -ril "subd" forge-kernel/src/            # 18 hits; read each — 17 are subdiag/octree/param-domain

# §1.3 — dead code (CMakeLists uses an explicit list, not a glob)
ls forge-kernel/src/native/mesh/*.cpp | sed 's|.*/||' | sort > /tmp/disk.txt
grep -o "src/native/mesh/[A-Za-z]*\.cpp" forge-kernel/CMakeLists.txt | sed 's|.*/||' | sort -u > /tmp/cmake.txt
comm -23 /tmp/disk.txt /tmp/cmake.txt          # 21 uncompiled, Subdivide.cpp among them
grep -c "subdivide_test" forge-kernel/CMakeLists.txt   # 0

# §1.2 — the Loop subdivider does work
clang++ -std=c++20 -O2 -I forge-kernel/include \
  forge-kernel/src/native/mesh/Subdivide.cpp \
  forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
  forge-kernel/test/native/mesh/subdivide_test.cpp -o /tmp/k2 && /tmp/k2   # 35/35

# §2 — brep tier all compiles (empty diff), and Class A is real
comm -23 <(ls forge-kernel/src/native/brep/*.cpp | sed 's|.*/||' | sort) \
         <(grep -o "src/native/brep/[A-Za-z]*\.cpp" forge-kernel/CMakeLists.txt | sed 's|.*/||' | sort -u)
wc -l forge-kernel/src/ClassASurfacing.cpp     # 760, and grep -c in CMakeLists -> 2

# §4 — the defect
grep -n 'const bool curved = (f.kind != "plane");' forge-kernel/src/ft/FeatureTreeCompiler.cpp  # 1356,1372,1423
sed -n '330p'             forge-kernel/src/DirectEdit.cpp               # bspline sets kind only
grep -c "axisLocation" ~/"New Folder With Items"/archie_edit_214.log    # 0 — the log omits it entirely
```

Note the last line: it is the reason §4.2's first number was wrong. A field absent from a *log* is not a
field absent from the *code*.
