# Numerical robustness — tolerance and predicate policy

Companion to `MIGRATION.md` and the generated `OCCT_REMOVAL_TRACKER.md`. Those two
answer *what still depends on OCCT*. This one answers *what decides a sign, and
what decides it with a tolerance*. The tracker marks Predicates `[x]` on an
include count alone; that is true and it is not the interesting question. A
predicate that is OCCT-free and wrong is still wrong, and silently — which is
why every claim below is a use count or a run, not an include count.

Everything below is MEASURED at **`ddef657b`** on 2026-09-12, and re-measured
adversarially at the same SHA later the same day. The commands are in the
appendix; run them before you trust a number here.

**Tree state, stated precisely, because this worktree is shared.** `HEAD` is
`ddef657b` throughout. The tree was clean at first measurement; by the re-measure
a sibling agent had modified `forge-desktop/CMakeLists.txt` (an OCCT-removal edit)
and added two more `docs/kernel/*.md`. Neither touches anything this doc measures
— `git status --porcelain -- forge-kernel tools .github frontend` is **empty** at
both times, and that, not "the tree is clean", is the check that makes these
numbers reproducible. Do not assert whole-tree cleanliness in a worktree other
agents are writing to; assert cleanliness of the paths you measured.

## The one-paragraph answer

Forge has **three** numerical layers, and only the first two are a policy. The
robust predicates (`forge/native/Predicates.hpp`) decide orientation and
in-circle/in-sphere signs EXACTLY, with no tolerance at all, and 25 files use them
(23 excluding the two N-API binding TUs). The exact-construction layer (`ExactReal.hpp` +
`ExactPredicates3D.hpp`) makes intersection *coordinates* exact as well, and four
production files use it. The third layer is everything else: **931 inline
epsilon literals in 103 of the 156 `src/native/*.cpp` files, 21 distinct values,
no central constant and no gate**. That is not a tolerance policy; it is a
tolerance census. Say so out loud when planning, because the first two layers are
genuinely finished and the third has not been started.

---

## Layer 1 — the exact predicates (BUILT, SHIPPED, ADOPTED)

`forge-kernel/include/forge/native/Predicates.hpp` (148 lines) declares four
sign-returning predicates — `orient2d`, `orient3d`, `incircle`, `insphere` —
implemented in `forge-kernel/src/native/Predicates.cpp` (586 lines). Zero OCCT
includes, zero external dependencies, C++20 + stdlib only. (The header also
declares four `*Naive` twins at lines 125-139; those exist for the test's
differential arm and are not called by production code.)

**Shipped, not merely built.** `forge-kernel/CMakeLists.txt:2194` lists
`src/native/Predicates.cpp` in `FORGE_KERNEL_SOURCES`. That variable feeds **two**
targets, and which one you cite matters:
`add_library(forge_kernel SHARED …)` at line 2509 is the **N-API addon** — it sits
inside `if(FORGE_BUILD_NODE_ADDON)` (default **ON**), and the CMakeLists' own
comment at line 55 calls it "an OPTIONAL ADD-ON TARGET, not the core".
`add_library(forge_kernel_core SHARED …)` at line 2592 is the node-free core; it
takes the same list minus the `binding*.cpp` TUs, so `Predicates.cpp` is in it,
but it is gated on `FORGE_BUILD_DESKTOP_FOUNDATION` (default **OFF**). So the
predicate ships in the default build and is present in the node-free core, but
"shipped" evidence that names only line 2509 rests on the layer this repo's own
invariant #1 says is not the product.

**Adopted, not merely shipped.** 69 files tree-wide include the header (31 of
them under `forge-kernel/src`); that is the weaker observable and the one
`MIGRATION.md` warns about. The stronger one: stripping comments first, **25
files make 105 real calls**. Two of the 25 are the N-API binding TUs
(`src/binding.cpp` ×6, `src/binding_geom.cpp` ×2), which `forge_kernel_core`
excludes — so the native-geometry adoption count is **23 files / 97 calls**. The
heaviest are
`geom/ConstrainedDelaunay2D.cpp` (15), `csg/Extrude.cpp` (13),
`mesh/MeshBooleanNative.cpp` (12), `geom/Delaunay3D.cpp` (8), `geom/Delaunay.cpp`
(7). Five more files name a predicate only inside a comment —
`brep/Loft.cpp`, `geom/AlphaShape3D.cpp`, `mesh/Remesh.cpp`, `mesh/Smooth.cpp`,
`ExactPredicates3D.cpp` — so the adoption count is 25, not the 30 a naive grep
returns. (`geom/Delaunay3D.cpp` alone drops from 22 raw matches to 8 real
calls.)

### How the guarantee is actually obtained

Each predicate runs a static forward-error filter in plain double and escalates
to an error-free-transformation expansion only when the filter cannot certify the
sign. The bound constants are derived from the binary64 unit roundoff in
`Predicates.cpp:223-228`:

| constant | value | predicate |
|---|---|---|
| `kEpsilon` | `1.1102230246251565e-16` (2^-53) | unit roundoff |
| `o2dErrBoundA` | `(3.0 + 16.0*kEpsilon) * kEpsilon` | `orient2d` |
| `o3dErrBoundA` | `(7.0 + 56.0*kEpsilon) * kEpsilon` | `orient3d` |
| `icErrBoundA` | `(10.0 + 96.0*kEpsilon) * kEpsilon` | `incircle` |
| `isErrBoundA` | `(16.0 + 224.0*kEpsilon) * kEpsilon` | `insphere` |

All four have a real exact fallback — `signOfExpansion` over expansion buffers of
8/64/288/4096 doubles respectively. None of them stops at the filter.

### The validation is real and it can fail

`forge-kernel/test/native/predicates_test.cpp` (557 lines), built and run
directly:

```
RESULT: 39 passed, 0 failed, 39 total
over 40000 trials each: naive errors -> orient2d=0 orient3d=1441 incircle=0 insphere=0
```

The differential arm is not decorative: on 40 000 random near-degenerate
`orient3d` inputs the naive double evaluation returns **1441 wrong signs** and the
robust path returns **zero**, against an independent exact-integer oracle. Two
hand-built contrast cases are printed by name (an ulp-inside `incircle` where
naive says ZERO, an exact-coplanar `orient3d` at coordinates ~5e7 where naive says
NEGATIVE).

### The one hole in the guarantee, and it is not asserted

`Predicates.hpp:43-50` documents a KNOWN LIMIT: on **subnormal** inputs the
error-free-transformation identities themselves underflow, so a tiny true
determinant can collapse to ZERO. The test exercises it and prints:

```
(boundary) subnormal dz=4.941e-324 -> robust=ZERO(0) (true sign is NEGATIVE; …)
```

Read that carefully. The limit is real, it is documented honestly, it is
exercised — and it is **reported, not asserted**. That line is not one of the 39
assertions, so a regression that widened the subnormal hole would not turn the
suite red. The header's own TODO (a sign-invariant power-of-two pre-scaling pass)
is **not implemented**; no such pre-pass exists in `Predicates.cpp`.

### One file shadows the predicates with a naive copy

`forge-kernel/src/native/brep/Hlr.cpp:43` defines its **own** `inline double
orient2d(...)` — the naive expression, no filter, no exact path — and does not
include `Predicates.hpp`. It has 11 call sites (lines 350-385). It is the only
such file: nothing else in `forge-kernel/src` or `include` redeclares any of the
four names. Read that scope honestly — the instrument finds *name shadowing*, so
a file that open-codes a cross product under some other name would not show up
here, and no measurement in this doc rules that out. This is not
simply an oversight to sweep up: Hlr uses the returned **magnitude**, not just the
sign, as a triangle area and as a barycentric denominator (`orient2d(...)/area`),
so the `Sign`-returning robust predicate is not a drop-in replacement. Converting
it means splitting the sign decision from the area computation. Nothing measures
this today.

---

## Layer 2 — exact constructions (BUILT, SHIPPED, PARTIALLY ADOPTED)

Exact *signs* over double *coordinates* still put three near-coincident
intersection hits at three different points. `forge/native/ExactReal.hpp` (a
self-contained EPECK-class lazy-exact rational: sign + base-2^32 big-int
numerator/denominator, carried with a double interval) and
`forge/native/ExactPredicates3D.hpp` close that. Both compile into the shipped
library (`CMakeLists.txt:2195-2196`). Zero external deps — no GMP, no OCCT.

The number is genuinely lazy: `exactOrient3D` and `exactPlanarOrient3D` run a
conservative `nextafter`-rounded interval filter first
(`ExactPredicates3D.cpp:57-107, 126-135`, with a `kIvFilterMax = 1e90` overflow
guard) and reach BigInt arithmetic only when the interval straddles zero.
`exactInSphere` has **no** interval filter — it always pays the exact cost.

### What is actually called — the honest census

| entry point | non-comment call sites outside its own .cpp |
|---|---|
| `exactOrient3D` | `mesh/MeshBooleanExact.cpp` ×8, `brep/Check.cpp` ×2, `geom/ConvexHull3D.cpp` ×1, `test/native_vs_occt_convexhull.cpp` ×1 |
| `segmentTriangleClassify` | `mesh/MeshBooleanExact.cpp` ×1, `brep/Heal.cpp` ×1 |
| `exactPlanarOrient3D` | `mesh/MeshBooleanExact.cpp` ×1 |
| `exactEdgePlaneIntersection` | **none** — reached only from inside `segmentTriangleClassify` (`ExactPredicates3D.cpp:274`) |
| `exactPointInTriangle` | **none** — same, `ExactPredicates3D.cpp:277` |
| `exactSegmentSegmentIntersection` | **NONE ANYWHERE.** Declared, implemented, never called by any file, production or test. |
| `exactInSphere` | **NONE ANYWHERE.** Same. |

So the coplanar-segment construction and the exact in-sphere test are built and
shipped dead weight today. They are not wrong; they are unexercised, and an
unexercised exact routine is exactly the thing that rots quietly.

### Both mesh-boolean paths ship, and only one is exact

`brep/Boolean.cpp` includes **both** `mesh/MeshBooleanExact.hpp` and
`mesh/MeshBooleanNative.hpp`. `MeshBooleanNative.cpp:327` still defines the double
`edgePlanePoint(...)` and calls it at line 358. The header comment at
`ExactPredicates3D.hpp:90` says `exactEdgePlaneIntersection` "replaces the double
`edgePlanePoint` in the mesh boolean's cut step" — true for the *Exact* path,
false for the *Native* path, which still ships and still constructs its cut
points in double. The epsilon spread matches: `MeshBooleanNative.cpp` uses five
distinct epsilon values (1e-5, 1e-6, 1e-7, 1e-9, 1e-12) against
`MeshBooleanExact.cpp`'s two (1e-6, 1e-9).

### Two things the header says that the code does not, for the next reader

- `ExactPredicates3D.hpp:20` names `exactEdgeTriangleIntersection`. **No such
  symbol exists anywhere in the tree** — the routine is
  `exactEdgePlaneIntersection`.
- Nothing tests that `exactOrient3D` and `Predicates.hpp`'s `orient3d` agree,
  though the header asserts they "agree by construction". The only direct test
  call (`test/native_vs_occt_convexhull.cpp:123`) uses `exactOrient3D` as an
  inside-the-hull certificate, not as a differential against `orient3d`.

---

## Layer 3 — the epsilon census (NOT a policy; NOT started)

| measured over `forge-kernel/src/native` | |
|---|---:|
| `1e-<n>` literal occurrences | **931** |
| distinct values | **21** |
| `.cpp` files containing at least one | **103 of 156** |
| lines containing one | 817 |
| …of those, lines declaring a **named** constant | **120** |

Frequency — the whole distribution, all 21 values, summing to 931:

| value | uses | value | uses | value | uses |
|---|---:|---|---:|---|---:|
| `1e-12` | 209 | `1e-4` | 18 | `1e-24` | 3 |
| `1e-9` | 201 | `1e-18` | 18 | `1e-2` | 3 |
| `1e-6` | 143 | `1e-5` | 17 | `1e-11` | 3 |
| `1e-7` | 110 | `1e-30` | 16 | `1e-10` | 3 |
| `1e-300` | 110 | `1e-3` | 15 | `1e-8` | 3 |
| `1e-15` | 24 | `1e-20` | 4 | `1e-16` | 2 |
| `1e-14` | 24 | `1e-13` | 4 | `1e-06` | 1 |

`1e-06` is one lone alternate spelling of `1e-6`, counted separately because it
is literally a different token — which is itself the point: nothing in the tree
normalises these.

**Fifteen** files carry six or more *different* epsilon values each; the worst
are `brep/StepRead.cpp` and `brep/Boolean.cpp` at **11 distinct values apiece**,
then `brep/StepReadOcct.cpp` at 9 and five files at 7.

**There is no central tolerance constant and no gate over any of this.**
`tools/kernel/` holds four gates (`occt_dependency_graph.py`,
`topology_honesty_gate.py`, `vec3_unification_gate.py`,
`js_gate_registration_gate.py`); only `vec3_unification_gate.py` mentions
tolerance at all, and only for the two normalize guards below.

**`forge-kernel/include/forge/Tolerance.hpp` is NOT this.** It is
`forge::tolerance::compute` — manufacturing 1-D tolerance stack-up, worst-case /
RSS / Monte-Carlo, Cp and Cpk. Anyone searching for "the tolerance header" finds
it first and finds the wrong thing.

### OCCT's tolerance vocabulary is already confined

`Precision::Confusion()` is `1.e-7` and `Precision::Angular()` is `1.e-12`
(`/opt/homebrew/include/opencascade/Precision.hxx:165,123`). In
`forge-kernel/src/native` it appears on **33 lines across exactly 8 files** —
`brep/{NativeDraftAngle, NativeFilletChamfer, NativeShapeHeal, NativeThickenShell,
NativeThickSolid, NativeVariableFillet, NativeWireFill, StepReadOcct}.cpp` —
**every one of which already includes OCCT headers** (12 to 72 `#include <*.hxx>`
lines each; OCCT headers are the `.hxx` ones, and the count moves by a line or
two under a narrower prefix list, so quote the range with its instrument or not
at all). So OCCT's tolerance vocabulary does not leak past the OCCT bridge inside
`src/native`; it leaves with those files. The rest of the kernel is a different
story: 114 more lines outside `src/native`, and 17 in `frontend/src/kernel`.

Note the coincidence and do not over-read it: `1e-7` is the 4th most common
literal in `src/native` (110 uses) and is also `Precision::Confusion()`. Five
files spell **both** — `NativeFilletChamfer.cpp:101` declares
`constexpr double kTol = 1e-7; // geometric coincidence tolerance (mm-ish)` and
calls `Precision::Confusion()` on **10** lines
(924/951/952/1315/1334/2212/2243/2308/2488/2542). Whether every other `1e-7` was
chosen to match OCCT is **not measured** and is not claimed here. Two files state
the tie in prose: `StepReadOcct.cpp:295,921,1011,1096` ("rejecting such a file
with the hard `Precision::Confusion()` 1e-7 was the dfm_critic finding") and
`NativeDraftAngle.cpp:505` ("Feeding a span loose by 1e-7 … puts their end caps
within OCCT's confusion tolerance").

Two further facts about the shape of these tolerances:

- Many are **absolute lengths in model units** (the comments say "mm-ish") — but
  scale-relative tolerance is **not rare, and there is no shared helper**. Every
  site rolls its own `epsilon × magnitude`. **27 lines in 21 files** bind a name
  matching `tol`/`eps` to such a product; loosening to *any* `1e-N` literal
  multiplied by a non-literal gives **143 lines in 49 files** (that looser
  instrument over-collects — some hits are unit conversion or coefficient math —
  so treat 21 as the floor and 49 as the ceiling). Read samples, all genuine:
  `brep/Boolean.cpp:154` (`1e-7 * scale`), `brep/Query.cpp:258`
  (`1e-9 * max(1.0, bbox extents)`), `brep/Section.cpp:158` and `mesh/Slice.cpp:165`
  (`extent * 1e-9`), `brep/Check.cpp:852` (`1e-6 * bboxDiag`),
  `mesh/TriTriIntersect.cpp:298` (`1e-12 * span`), `geom/PolygonOffset2D.cpp:94`
  (`max(1e-6, |signedDist| * 1e-3)`), `composites/Composites.cpp:99`
  (`1e-9 * max(|Q11|,1.0)`), `geom/MinEnclosingSphere.cpp:200,225`
  (`1e-9 * (1.0 + radius)`), `mesh/Decimate.cpp:111` (`1e-12 * s*s*s`),
  `brep/Hlr.cpp` (`relTol * scale`, lines 101-182),
  `brep/NurbsSurfaceIntersect.cpp:454` (`modelScale(s1,s2)`). Do **not** scope this
  as "three files roll their own" — an earlier revision of this doc said exactly
  that and it was wrong by an order of magnitude. The missing thing is the shared
  helper, not the technique.
- 84 parameters named `tol`/`tolerance`/`eps`/`epsilon` cross 43 public headers
  under `forge-kernel/include/forge`, so a large part of the tolerance surface is
  the *caller's* choice, not the kernel's.

---

## The divergent zero-length normalize epsilons — deliberate, gated, and measured

Three normalize routines, three different zero-length guards, all computing the
norm identically as `sqrt(x*x + y*y + z*z)`:

| routine | guard | source |
|---|---|---|
| `materials::normalizeV` | `n <= std::numeric_limits<double>::min()` (2.2250738585072014e-308) | `src/native/materials/Materials.cpp:45` |
| `composites::normalize3` | `n < 1e-300` | `src/native/composites/Composites.cpp:31` |
| `forge::math::Vec3::normalized` / `::normalize` / `::isZero` | `n <= eps`, default `1e-15` | `include/forge/math/Vec3.hpp:75,85,93` |

This divergence is **deliberate**. It is the reason the canonical header carries
no free `normalize` at namespace scope, and
`tools/kernel/vec3_unification_gate.py` check (4) fails if either module loses its
own guarded function. The gate is green and its `--selftest` shows all five
invariants go RED when broken, including *"a module's guarded normalize is
deleted"*.

Measured, compiling the real `forge/math/Vec3.hpp` against the two module guards
transcribed verbatim, on `v = {L, 0, 0}`:

| L | `length()` returns | materials | composites | canonical |
|---|---|---|---|---|
| 1e-3, 1e-14 | L exactly | `{1,0,0}` | `{1,0,0}` | `{1,0,0}` |
| **1e-15, 1e-16, 1e-20, 1e-100, 1e-154** | L exactly | **`{1,0,0}`** | **`{1,0,0}`** | **`{0,0,0}`** |
| 1e-160 | 9.99994e-161 | `{1.0000055664551362,0,0}` | same | `{0,0,0}` |
| 1e-200, 1e-300, 1e-320 | **0.0** (x·x underflowed) | `{0,0,0}` | `{0,0,0}` | `{0,0,0}` |

Three things that table says which the source does not:

1. **The divergence is real and it is ~139 decades wide** — every length from
   1e-15 down to 1e-154 — not a boundary case. The gate's own worked example
   (length 1e-20, `vec3_unification_gate.py:19`) sits well inside the band, though
   near its top: 5 decades below the 1e-15 edge, with ~134 decades still below it.
2. **The two module constants are not actually different from each other.** The
   smallest non-zero value `sqrt()` can return is `sqrt(denorm_min)` =
   **2.22276e-162**, which is larger than `1e-300` *and* larger than `DBL_MIN`.
   So both module guards fire if and only if the norm is exactly `0.0`: they are
   `n == 0.0` written two ways. The real divergence in the tree is
   **(materials ≡ composites) vs canonical `1e-15`**, a two-way split, not the
   three-way split the constants suggest.
3. **In the denormal band the module guards return a non-unit "unit" vector.**
   At L = 1e-160, `x*x` is subnormal, `sqrt` loses bits, and `x/n` comes back as
   `1.0000055664551362` — a 5.6e-6 relative error on something a caller will
   assume is normalised. The canonical `1e-15` guard returns zero there, which a
   caller can at least test for.

### What the gate protects, precisely — and what it does not

MEASURED by mutating a green clone and re-running the gate's own `check()`:

| mutation | gate |
|---|---|
| delete a module's `normalize3` | **RED** |
| a tenth `struct Vec3` reappears (multi-line or single-line) | **RED** |
| a second `struct Point3` reappears | **RED** |
| canonical header regains a free `dot()` | **RED** |
| **change composites' `1e-300` → `1e-15`** | **GREEN — not caught** |
| **change materials' `DBL_MIN` → `1e-15`** | **GREEN — not caught** |

The gate defends the **structure** (each module keeps its own guard, so a
"tidy-up" cannot silently re-route nine subsystems onto a different epsilon). It
does **not** defend the **values**. Editing the constant in place changes numerics
in nine subsystems and every check stays green. If that matters, the gate needs a
value assertion; today it has none, and the CI step at
`.github/workflows/gate-registration.yml:210-211` runs only the two commands
above. (`tools/gates/preflight.sh:44` invokes the gate a second time, without
`--selftest`; it is the same value-blind `check()`.)

---

## What is NOT built — plainly

- **No shared tolerance constant, header, or policy.** 931 inline epsilons, 21
  values, 103 files. Nothing generates, checks, or ratchets them.
- **No shared relative/scale-aware tolerance HELPER** — but the technique is
  already everywhere: 27 named `eps = 1e-N × magnitude` bindings across 21 files
  (up to 143 lines / 49 files on a looser instrument), each hand-rolled. This is a
  consolidation job, not a greenfield one.
- **No denormal-safe pre-scaling in `Predicates.cpp`.** The header's TODO stands;
  the subnormal case is printed by the test but not asserted, so it cannot fail.
- **No differential test between `exactOrient3D` and `orient3d`,** despite the
  header claiming they agree by construction.
- **`exactInSphere` and `exactSegmentSegmentIntersection` have zero callers** in
  production or test.
- **`brep/Hlr.cpp` keeps a private naive `orient2d`** with 11 call sites, and uses
  its magnitude, so the fix is a refactor rather than a substitution.
- **The Native mesh-boolean path still constructs cut points in double**
  (`MeshBooleanNative.cpp:327`), and `brep/Boolean.cpp` includes both paths.

What IS built, equally plainly: the exact predicate layer is finished, shipped in
`forge_kernel` (and present in the node-free `forge_kernel_core`), adopted by 25
files — 23 of them native geometry — and validated against an
independent exact-integer oracle with a differential arm that demonstrably
catches 1441 naive failures per 40 000 trials. The exact-construction layer is
finished and shipped, and its orientation half is adopted. Neither needs
rebuilding. Do not schedule it.

---

## Appendix — every command behind a number above

Run from the repo root, at `ddef657b`. Check the paths you measure, not the whole
tree — this worktree is shared:

```sh
git rev-parse --short HEAD                                    # ddef657b
git status --porcelain -- forge-kernel tools .github frontend # must be empty
```

```sh
# Layer 1 — existence, size, shipping, adoption
wc -l forge-kernel/include/forge/native/Predicates.hpp \
      forge-kernel/src/native/Predicates.cpp          # 148 and 586
# NOTE: 286 is ExactPredicates3D.cpp. An earlier revision of this doc mis-attributed
# it to Predicates.cpp by reading a multi-file `wc -l` in the wrong row order.
grep -n 'native/Predicates.cpp' forge-kernel/CMakeLists.txt
grep -n 'FORGE_KERNEL_SOURCES\|add_library(forge_kernel' forge-kernel/CMakeLists.txt
sed -n '2507,2509p;2573,2592p' forge-kernel/CMakeLists.txt   # both targets + their gates
grep -rl 'native/Predicates.hpp' --include='*.cpp' --include='*.hpp' . | wc -l   # 69
grep -rl 'native/Predicates.hpp' --include='*.cpp' forge-kernel/src | wc -l      # 31
for f in $(grep -rlE '\b(orient2d|orient3d|incircle|insphere)\s*\(' forge-kernel/src \
             --include='*.cpp' --include='*.hpp' \
           | grep -v 'native/Predicates.cpp' | grep -v 'brep/Hlr.cpp'); do
  n=$(sed 's|//.*||' "$f" | grep -coE '\b(orient2d|orient3d|incircle|insphere)\s*\(')
  [ "$n" -gt 0 ] && echo "$n $f"
done | sort -rn                      # -> 25 files, 105 calls

# Layer 1 — error bounds, exact fallback, validation
grep -n 'kEpsilon *=\|ErrBoundA *=' forge-kernel/src/native/Predicates.cpp
clang++ -std=c++20 -O2 -I forge-kernel/include \
  forge-kernel/test/native/predicates_test.cpp \
  forge-kernel/src/native/Predicates.cpp -o /tmp/predtest && /tmp/predtest

# Layer 1 — the bypass
grep -n 'orient2d' forge-kernel/src/native/brep/Hlr.cpp
grep -c 'Predicates' forge-kernel/src/native/brep/Hlr.cpp     # -> 0

# Layer 2 — interval filter, call census, dead entry points
sed -n '57,107p' forge-kernel/src/native/ExactPredicates3D.cpp
for fn in exactOrient3D exactInSphere exactPlanarOrient3D \
          exactEdgePlaneIntersection exactSegmentSegmentIntersection \
          segmentTriangleClassify exactPointInTriangle; do
  echo "--- $fn"; grep -rnE "\b${fn}\s*\(" --include='*.cpp' . \
    | grep -v 'src/native/ExactPredicates3D.cpp' | grep -vE ':[0-9]+: *//'
done
grep -rn 'exactEdgeTriangleIntersection' .        # -> only the stale comment
grep -rn 'edgePlanePoint' .                       # -> MeshBooleanNative.cpp:327,358

# Layer 3 — the census
grep -roE '\b1e-[0-9]+\b' forge-kernel/src/native | wc -l                    # 931
grep -rhoE '\b1e-[0-9]+\b' forge-kernel/src/native | sort | uniq -c | sort -rn
find forge-kernel/src/native -name '*.cpp' -print0 \
  | xargs -0 grep -lE '\b1e-[0-9]+\b' | wc -l                                # 103/156
grep -rhnE '(constexpr|const\s+double|static\s+const).*\b1e-[0-9]+\b' \
  forge-kernel/src/native | wc -l                                            # 120
for f in $(grep -rlE '1e-[0-9]+' forge-kernel/src/native); do
  echo "$(grep -ohE '\b1e-[0-9]+\b' "$f" | sort -u | wc -l) $f"; done | sort -rn | head -15
grep -rn 'Precision::Confusion' forge-kernel/src/native | wc -l              # 33
grep -rln 'Precision::Confusion' forge-kernel/src/native                     # 8 files
# OCCT headers are the .hxx ones -- state the instrument, the range moves without it:
for f in $(grep -rln 'Precision::Confusion' forge-kernel/src/native | sort); do
  echo "$(grep -cE '^#include <[A-Za-z0-9_]+\.hxx>' "$f") $f"; done   # 12 .. 72
grep -c 'Precision::Confusion' \
  forge-kernel/src/native/brep/NativeFilletChamfer.cpp                      # 10, not 5
grep -rn '1e-7' forge-kernel/src/native | grep -iE 'confusion|occt'
#   -> StepReadOcct.cpp:295,921,1011,1096 AND NativeDraftAngle.cpp:505

# Layer 3 -- scale-relative tolerance is COMMON, not three files. Floor and ceiling:
grep -rnE '\b(tol|Tol|eps|Eps|epsilon|EPS)[A-Za-z0-9_]*\s*=\s*[^;]*\b1e-[0-9]+\b\s*\*|\b(tol|Tol|eps|Eps|epsilon)[A-Za-z0-9_]*\s*=\s*[^;]*\*\s*\b1e-[0-9]+\b' \
  forge-kernel/src/native --include='*.cpp' | grep -vE ':[0-9]+:\s*//'      # 27 lines / 21 files
grep -rnE '\b1e-[0-9]+\s*\*\s*[A-Za-z_(]|[A-Za-z_)]\s*\*\s*\b1e-[0-9]+\b' \
  forge-kernel/src/native --include='*.cpp' | grep -vE ':[0-9]+:\s*//'      # 143 lines / 49 files
grep -n 'static constexpr Standard_Real \(Confusion\|Angular\)()' \
  /opt/homebrew/include/opencascade/Precision.hxx      # -> 165 Confusion 1.e-7, 123 Angular 1.e-12
cat forge-kernel/include/forge/Tolerance.hpp      # stack-up analysis, not epsilons

# Normalize epsilons — the divergence and the sqrt floor
sed -n '43,47p' forge-kernel/src/native/materials/Materials.cpp
sed -n '26,33p' forge-kernel/src/native/composites/Composites.cpp
sed -n '64,93p' forge-kernel/include/forge/math/Vec3.hpp
# then the two throwaway programs in the scratchpad: tabulate
#   materials/composites/canonical normalize over L = 1e-3 … 1e-320, and print
#   sqrt(denorm_min) -> 2.22276e-162 > 1e-300 > DBL_MIN.

# The gate: green, falsifiable, and value-blind
python3 tools/kernel/vec3_unification_gate.py
python3 tools/kernel/vec3_unification_gate.py --selftest
grep -rn 'vec3_unification_gate' .github/workflows/ tools/gates/   # 2 CI lines + preflight.sh:44
# value-blindness, via the gate's own _baseline() clone + check():
#   replace '1e-300' with '1e-15' in Composites.cpp  -> check() returns []  (GREEN)
#   replace DBL_MIN with '1e-15' in Materials.cpp    -> check() returns []  (GREEN)
sed -n '205,212p' .github/workflows/gate-registration.yml
```
