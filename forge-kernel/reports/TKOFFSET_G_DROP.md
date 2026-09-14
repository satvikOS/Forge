# TKOffset family G (THICKSOLID) — the OCCT path is DELETED

**`BRepOffsetAPI_MakeThickSolid` and its three symbols are gone from
`src/Features.cpp`. The measured case for removing it is not that the native
engine matches OCCT — it does not — but that OCCT's answers here are 133
BRepCheck-INVALID solids and zero valid ones.**

Base: `origin/archdisc` @ `02de2e15`. Corpus: the 600-part
`expert3d_v5cap_e600/gold_ref_steps`. Derivation, copied from
`test/corpus_ab_coverage.cpp` §2.3 so this is comparable to every other family:
*remove the largest PLANAR face, wall = 0.05 × min bbox extent.*

---

## 1. The symbols, measured before and after

`src/Features.cpp` compiled twice with identical shipped-app flags
(`FORGE_OFFSET_DROP_MAKEOFFSET` deliberately **unset** — the app build has it
OFF, which is why the shipped dylib reads 42 where the in-tree build reads 38):

| | TKOffset symbols in `Features.cpp.o` |
|---|---:|
| before (`02de2e15`) | **31** |
| after | **28** |

Removed — exactly three, with nothing added:

```
BRepOffsetAPI_MakeThickSolid::BRepOffsetAPI_MakeThickSolid()
BRepOffsetAPI_MakeThickSolid::MakeThickSolidByJoin(TopoDS_Shape const&, NCollection_List<TopoDS_Shape> const&, double, double, BRepOffset_Mode, bool, bool, GeomAbs_JoinType, bool, Message_ProgressRange const&)
BRepOffsetAPI_MakeThickSolid::Build(Message_ProgressRange const&)
```

Corroborated at **link level as a measured pair**, not by arithmetic: the
pristine tree at `02de2e15` and this one were each built node-free
(`-DFORGE_BUILD_NODE_ADDON=OFF`, `-DFORGE_NATIVE_BREP=ON`) and `nm -u` on the
resulting `libforge_kernel_core.dylib` intersected with libTKOffset's exports:

| `libforge_kernel_core.dylib` | undefined TKOffset symbols |
|---|---:|
| pristine `02de2e15` | **42** |
| this change | **39** |

42 is also exactly what the census measured on the shipped
`Forge.app` dylib, so this build configuration reproduces the ship.

`nm` on the built objects gives `Features.cpp.o` = 28 — the same number the
standalone compile gave, from a different instrument — and
`NativeThickSolid.cpp.o` = **0**, so the engine work below adds no OCCT
dependency of its own and Features.cpp is the only file whose contribution moved.

`vtable for BRepOffsetAPI_MakeOffsetShape` **stays**, and that is correct:
`MakeThickSolid` derives from `MakeOffsetShape` and has no vtable of its own, so
the shared vtable is family **H**'s to remove, not G's. G alone removes 3.

**This does not drop the toolkit.** `CMakeLists.txt`'s `_FORGE_TKOFFSET_FAMILIES`
removes TKOffset from `OCCT_LIBS` only when all nine families are out. 39 ≠ 0, so
the link record does not move yet. That is the documented design, not a shortfall
of this change.

---

## 2. Why the incumbent could go

Full 600-part A/B, both arms, full observable vector:

| arm | built | BRepCheck **VALID** |
|---|---:|---:|
| OCCT `BRepOffsetAPI_MakeThickSolid` | 133 / 600 | **0** |
| native `occtoffset::makeThickSolid` | 8 / 600 | **8** |

`BOTH_OK` is **0** — the two arms never both succeed on the same part — so there
is **no cross-arm oracle** for this family on this corpus, and an agreement rate
would be a number computed over an empty set. It is not reported for that reason.

The zero in OCCT's valid column reproduces `TKOFFSET_GH_DEFER_CENSUS.md` §4,
which measured it independently and added that 18 of 87 re-measured OCCT results
have a volume above 90 % of the source solid — barely hollowed at all — and that
OCCT SIGSEGVs on 46 of 142 parts when both families run in one process.

**The trade, stated plainly:** 133 invalid solids returned as successes become 8
valid solids and 592 refusals that each name their cause. The deletion bucket —
parts OCCT answers and native does not — is **133**, i.e. all of them, since
`BOTH_OK` is 0 and the 8 native answers are all on parts OCCT declines. That is a
real loss of *coverage*; it is not a loss of *capability*, because not one of
those 133 shapes passes `BRepCheck`.

---

## 3. What was fixed in the engine, and how it was found

The committed census said family G's deletion bucket was one rule
(`S2_planar_wire_edge_not_full_circle`, 126/126). Re-measured at `02de2e15` the
first-binding rung distribution had moved on:

| first binding rung | parts |
|---|---:|
| `q_surface_unsupported` (NURBS) | 223 |
| **`q_sew_shell_count`** | **198** |
| `q_planar_wire_not_circle_or_polygon` | 142 |
| `cn_hole_escapes_rim` | 27 |
| `pcf_collapsed` | 10 |

`q_sew_shell_count` is not in the census at all. Cross-tabulated against input
topology: **198 of 198 are two-solid inputs, and not one single-solid part
reaches that guard.** `makeThickSolid` gathered every body's faces into one
sewing, which closed into as many shells as there were bodies. A missing
dispatch, never a geometry defect — family H has had `offsetManyBodies` for this
since it was written.

Three changes, all inside family G's own entry points:

1. **Multi-body dispatch** (`thickenManyBodies`). Each body is hollowed
   independently with its own share of the removed-face list and the results are
   compounded. Family H's separation precondition (`gap > 2·|dist|`) is
   deliberately **absent**: it exists because H *grows* each body outward, and a
   hollow cannot interpenetrate a neighbour because the wall is a strict subset
   of the body it was cut from.
2. **All-planar CLOSED hollow.** `planarThickSolid` declines a mouthless body on
   its first line; only the quadric path implements the closed hollow (its step
   5a, outer shell + reversed inner shell with a volume-identity self-check). An
   all-planar mouthless body is now routed there. This is a route to proven code,
   not a new construction: `SK::Plane` is one of the quadric path's five analytic
   kinds and its step 4 already rebuilds polygon loops through `planarLoopFace`.
3. **A BRepCheck gate at the public entry.** Measured per body, **63 of the 229
   bodies the engine answered were BRepCheck-INVALID** and were returned as
   results, against a header that promises "a null `TopoDS_Shape` is an HONEST
   DEFER — never a plausible wrong shape". Family H added the same gate
   (`offsetResultIsSound`) when 12 of its 36 results were invalid. The refusal
   label now names the first failing sub-shape and status, assembly-first, so
   `SHELL/NotClosed` is not hidden behind the `FACE/UnorientableShape` it causes.

### A defect this introduced, caught by an existing gate

The half-extent guard was first lifted to apply to **every** body. It measures
the extent over the body's **vertices** — exact for a polyhedron, meaningless for
a curved body, because a full cylinder carries vertices only on its seam and its
vertex box is flat in y. `halfMin` collapsed to 0 and every wall was refused;
`run_thicksolid_nesting_gate.sh` went to **5 of 10**. The guard is now applied
only to all-planar bodies, where the measurement means something. `Bnd_Box` is
not the fix — it inflates by the shape tolerance, which this file already records
as making a separation test read satisfied when it is not. A curved body's
collapsed cavity is caught instead by the two checks that need no extent at all:
step 5a's volume identity and the BRepCheck gate.

---

## 4. Result, paired per part

| | before | after |
|---|---:|---:|
| native built | 0 / 600 | **8 / 600** |
| native BRepCheck-valid | 0 | **8** |
| parts that regressed | — | **0** |

8 gains, 0 losses. The 198-part `q_sew_shell_count` bucket resolved into 8 OK,
73 `q_closed_volume_identity`, and 117 refused by the new validity gate.

Because `BOTH_OK` is 0 there is no cross-arm oracle, so every answered part is
checked against **first principles** instead (`probe/verify_probe.cpp` in the
working notes):

| invariant | result on all 8 |
|---|---|
| I1 outer envelope preserved (vertex bbox identical to source) | **max corner delta 0.0, exactly** |
| I2 `0 < vol(wall) < vol(source)` | pass, ratios 0.26 – 0.48 |
| I3 BRepCheck valid | pass |
| I4 shells ∈ [bodies, 2·bodies] | pass, 3 shells / 2 bodies |
| I5 wall ≈ area·t to first order | 0.75 – 0.84, below 1 as convex corners and the open mouth require |

I1 is the check a volume comparison cannot make: an *outward* offset — which is
what a **positive** offset to `MakeThickSolidByJoin` produces, a different
operation — has a plausible volume and a different envelope.

---

## 5. Gates

| gate | result |
|---|---|
| `test/run_thicksolid_multibody_gate.sh` (**new**) | 19 / 19 |
| `test/run_thicksolid_nesting_gate.sh` | 12 / 12 |
| `test/run_ab_native_thicksolid_mixed.sh` | 39 / 0 |
| `test/run_ab_native_thicksolid_bar_fixture.sh` | 76 / 0 |
| `test/run_ab_native_offsetshape.sh` (family H, unchanged) | 296 / 296 |
| `tools/tkoffset_callsite_gate.py` | family G code references: **0** |
| full node-free core build | configure 0, build 0, linked |

The new gate's closed forms are derived, never fitted: two boxes give
20³−18·18·19 + 10³−8³ = 2332 exactly; the mouthless box gives 488; the cylinder
gives πR²H − π(R−t)²(H−t).

**The new gate is proved able to fail.** Compiled against the *pristine* engine
(same gate source, pre-change engine archive and headers) it scores **9/11** and
fails exactly the two assertions it exists for, naming `p_sew_shell_count` and
`p_no_mouth_face`. Its section 4 passes in both states, so it demonstrates only
that the validity gate is not a blanket refusal — the evidence that the gate
*catches* anything is the corpus measurement (117 parts built and refused as
invalid), and the gate's own banner says so rather than implying more.

`tkoffset_callsite_gate.py` still reports one unguarded reference,
`src/ArcHelix.cpp:157` (`BRepOffsetAPI_MakePipeShell`). It **pre-dates this
change** and belongs to family F. Three transient ones were mine: the new refusal
strings contained the literal class name on code lines, which the gate reads as a
call. The strings now name `MakeThickSolid` without the `BRepOffsetAPI_` prefix
and the comments carry the full names.

---

## 6. What is still open, named rather than glossed

The remaining 592 refusals, by first binding rung:

| rung | parts | what it is |
|---|---:|---|
| `q_surface_unsupported` | 172 | NURBS faces. A genuine capability gap; OCCT fails on these too. |
| `q_planar_wire_not_circle_or_polygon` | 142 | The **mixed line/arc planar wire**. |
| `entry_invalid[…]` | 113 | The inward offset folds over itself. |
| `q_closed_volume_identity` | 73 | Same root cause, surfacing as a volume mismatch. |
| `pcf_collapsed` | 61 | Offset region collapsed. |
| `cn_hole_escapes_rim` | 27 | The nesting guard. |

Two of these are worth naming precisely:

**The mixed planar wire (142) is no longer unbuilt work.** Family H grew the
machinery for it *after* the census was written — `OffSeg`, `OffLoop`,
`planarMixedFace`, `edgeArcCircle`, `solveOffsetVertexWithCyl`,
`solveOffsetVertexWithRuling`, `cylTrimmedFace`, roughly 1,700 lines — and
`quadricThickSolid` does not use any of it. Porting it is a real increment, but
it is a **port**, not a derivation. The census's own warning applies and should
be re-measured before it is costed: suppressing that rung alone once freed
exactly zero parts because a second rung bound immediately behind it.

**The 113 + 73 are the offset self-intersection problem** — offsetting is
injective only below the local feature size, and a wall that exceeds it makes the
cavity loop fold. Closing it needs loop removal (winding-number clipping, Chen &
McMains, ASME IDETC 2005, which `src/native/geom/PolygonOffset2D.cpp` already
implements for family A's 2-D case, or a straight-skeleton treatment). That is
the hard core of offsetting and is not a bounded fix. It is refused, by name,
with the failing sub-shape and BRepCheck status in the message.

**Vestigial:** the CMake option `FORGE_THICKSOLID_DROP_NATIVE` no longer controls
anything in `Features.cpp` — the code it guarded is gone unconditionally. It is
still listed in `_FORGE_TKOFFSET_FAMILIES`, which is harmless (the family is
permanently "dropped"), but `CMakeLists.txt` was outside this task's write set
and the option should be retired by whoever owns that file.

**Not done:** `test/native_thicksolid_closedform.mjs` was not run — it requires
the built Node addon and this worktree has no `node_modules`. It is unaffected in
principle (it exercises `shellNativeThick`, which this change does not touch),
but that is an argument, not a measurement.
