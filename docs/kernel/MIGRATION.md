# OCCT -> native kernel migration

The tracker beside this file (`OCCT_REMOVAL_TRACKER.md`) is generated from the tree
on every run and gated in CI. This file is the part that needs judgement.

## Where this actually stands, measured 2026-09-12 at c6718bc3

The shipped app links **6 OCCT toolkits** (TKBRep, TKG3d, TKGeomBase, TKMath,
TKTopAlgo, TKernel) and the bundle ships **14** dylibs. Production OCCT include
lines: **13 in the application, 1386 in the kernel, 23 in tooling**. A further
1919 lines live in `forge-kernel/test` and are deliberately kept — they are the
differential oracle the native path is validated against.

## The finding that decides the order

The existing `src/native/brep` tree is named native but is **not independent of
OCCT**: it computes in OCCT's own geometry and topology vocabulary. Measured uses
inside it:

| type | uses |
|---|---:|
| `gp_Pnt` | 594 |
| `gp_Vec` | 549 |
| `TopoDS_Face` | 332 |
| `gp_Dir` | 319 |
| `TopoDS_Shape` | 291 |

So finishing the current native path does not reach OCCT-zero. Whatever fraction of
operations it covers, the result is still expressed in OCCT types, and removing the
library removes the types the "native" code is written in. This is not a criticism
of that work — it made the native algorithms possible — but it means the removal
programme needs a Forge-owned type vocabulary underneath it, and every estimate
based on "the native path already covers N%" is measuring coverage, not independence.

The good news is where the floor already is:

- `forge/math` (Vec3, Mat3, Transform, Quaternion, Axis) is Forge-owned, **0 OCCT**.
- `forge/native/Predicates.hpp` and `ExactPredicates3D.hpp` are Forge-owned, **0 OCCT**.
- `src/native/mesh` and `src/native/csg` are **0 OCCT**.

Read "0 OCCT" carefully: it is a statement about includes, not about use. `forge/
math/Vec3.hpp` was 0 OCCT **and included by no file under `native/` at all**, while
nine modules each declared their own layout-identical `struct Vec3` — ten types
with ten names and no way to interoperate, so every module seam paid a conversion
and there was no single type to migrate the OCCT uses ONTO. A directory can be
OCCT-free by being unused, and the tracker could not tell the difference.

Vec3 is now ONE type: the nine declarations are `using Vec3 = forge::math::Vec3;`
aliases, `tools/kernel/vec3_unification_gate.py` fails if a tenth appears, and the
tracker counts declarations directly. That is the first rung — Math → Geometry
Primitives — ADOPTED rather than merely built.

The same question is still open for the rest of the vocabulary: Plane has 7
declarations, AABB 4, Mat3 3 (Mat3 has a canonical type already, so it is a direct
repeat), and Point3 3 with no canonical type — though `forge/math/Vec3.hpp` already
defines Vec3 as serving for both points and directions, exactly as OCCT's gp_Pnt/
gp_Vec pair does. 28 functions in the tree exist only to repack Point3 into Vec3.

So: math, transforms, predicates and tessellation are clear of OCCT *and* Vec3 is
now adopted. The work starts at the rest of the primitive vocabulary, then
geometry primitives proper.

## A prior measurement worth not repeating

`forge-kernel/OCCT_DEPENDENCY_TRUTH.md` records that the native path's bridge emits
an analytic cylinder as **128 independent angular faces** where OCCT emits **1**,
while both agree on volume to 1e-12. Every A/B gate passed because the gates checked
volume, centre of mass, genus and tessellation — none checked **face identity**.

That is the single most important lesson for this migration: a differential test
that compares only invariants will certify a representation that cannot support
"select the bore", "remove this hole" or "fillet that edge". Face identity is a
first-class acceptance criterion here, not an extra.

## Order

Math -> geometry primitives -> transforms -> curves -> surfaces -> topology -> B-Rep
-> predicates -> intersections -> tessellation -> modelling features -> booleans ->
healing -> fillets/chamfers -> import/export -> assemblies -> final removal.

Stage gate for each: the native subsystem matches the OCCT oracle on topology counts,
bounding box, volume, area, centre of mass **and face identity**, and the differential
test proves it can fail.
