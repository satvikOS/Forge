## What this is

D-022 left THICKEN at **native 67.8% vs OCCT 100.0%** over 600 real parts — 193 parts where OCCT builds and the native engine declines. Its *geometric* disagreement was already understood and was **not** a native defect (OCCT's `MakeThickSolid` returns a negatively oriented solid, which is why `Features.cpp` normalises orientation). So the open question was pure coverage: **why does native defer on 193 parts?**

## Instrument first — and the answer was not a scatter

`runArm` in `test/corpus_ab_coverage.cpp` has carried a `reasonFn` hook since the PIPE family's 598-part bucket was unattributable. THICKEN simply never passed one. That is a **one-line** change, and it attributed the bucket completely:

> **193 of 193** deferred with the single reason `"a face is not a Geom_Plane"`.

Not 193 spread across the file's twenty-odd named defers. One. A surface census of the same picked face over the same 600 parts then named the type:

| surface type of the picked face | BOTH_OK | OCCT_ONLY |
|---|---:|---:|
| Plane | 407 | 0 |
| Cylinder | 0 | **193** |

No third surface type appears in that slot, and every one of the 193 spans a full 2π turn.

## The offset sign was read off live OCCT, not reasoned about

Which way a cylindrical face offsets is easy to argue and easy to get backwards, so the same `BRepOffset_MakeOffset` call `src/Features.cpp` makes was run on all 193 picked faces and its volume compared with **both** candidates:

```
face REVERSED (119 parts) -> OCCT's volume == the R-t form   rel < 1e-9
face FORWARD   (51 parts) -> OCCT's volume == the R+t form   rel < 1e-9
the remaining  (23 parts) -> NEITHER form                    rel 2e-2 .. 9e-2
```

**That measurement also handed over the guard.** The 170 that match are *exactly* the parts passing a **rectangle certificate**, and the 23 that miss are *exactly* the ones failing it. The certificate is exact rather than heuristic: a cylindrical face trims its surface to some UV region D inside the adaptor box and its area is exactly `R * area(D)`, so `area(face) == R*du*dv` **iff** D is the whole rectangle. A hole cut in the tube wall has strictly less area. The predicate was not invented — it was found by measuring where the formula stops holding.

## The construction was changed *after* measuring it

`forge::occtRevol` of the axial-section rectangle gives the right volume, is TKPrim-free, and was written and measured first. On corpus part `ho1002` it returned **4F/8E** where OCCT returns **4F/6E**: every face a `Geom_SurfaceOfRevolution`, the annular caps carrying a seam a planar annulus does not have. That is a coverage gain paid for with a **surface-type regression** — every downstream consumer asking "is this face a cylinder" would start getting "no", including the corpus picker itself.

Replaced with `occtCylinderSolid(Rhi) CUT occtCylinderSolid(Rlo)`, which leaves exactly two `Geom_CylindricalSurface` walls and two `Geom_Plane` caps — the same inventory OCCT returns, now 4F/6E/4V on both sides. The rejected construction is named in the engine banner so it is not rediscovered, and the face inventory is a runtime **check**, not a comment.

## Measured — paired, same 600 parts, same derivation

| | native | OCCT | deletion bucket |
|---|---:|---:|---:|
| before | 407/600 = **67.8%** | 600 = 100.0% | **193** |
| after | 577/600 = **96.2%** | 600 = 100.0% | **23** |

**170 parts gained, 0 lost. McNemar exact two-sided p = 1.34e-51.**

Of the 170 newly-built parts: **all 170 are BRepCheck-VALID**, and the worst |volume| difference against live OCCT over all 170 is **0.000e+00** — bit-exact, not merely inside tolerance. 165 of 170 agree with OCCT on the full observable vector up to solid orientation; the 5 that do not differ *only* in face/edge counts, where native emits the canonical 4F/6E/4V and OCCT emits a redundantly split 6F/13E/8V of the identical body.

### The untouched control families did not move

Run in the same process, same corpus, same commit — both reproduce their known rows to the decimal:

```
FILLING      native 67.8%  OCCT 67.8%   deletion  0
MAKEOFFSET   native 94.5%  OCCT 99.0%   deletion 27
```

That is what makes the THICKEN delta readable as the change and not as the harness.

## The option still does not flip

The gate is `>=` and **96.2 < 100.0**, so `FORGE_THICKEN_DROP_NATIVE` stays OFF. The surviving 23 are **one named cause** — `"cylindrical path: the face is not the full parametric rectangle (a trimmed or holed patch)"` — the certificate declining exactly the inputs on which the closed form is measurably not OCCT's answer. That is the next bounded target, attributable rather than silent.

## A withheld gate restored — and the scope of that is smaller than it first reads

`ab_native_thicken_occt` was excluded from `FORGE_AB_GATES` with a note recording it RED at `a70dd1da` (208 passed, 19 failed, all surface-type counts). **That note had gone stale** — the case5 `want`s were re-measured and pinned on 2026-08-28. Measured on this tree *before any change here*: **227 passed, 0 failed, exit 0**. It is re-registered on that measurement and now builds and passes through ctest as `kernel.ab.ab_native_thicken_occt`.

> **★ Correction, checked rather than assumed.** `FORGE_AB_GATES` is the *ctest* list, and `.github/workflows/kernel-tests.yml` does **not** invoke ctest for it — it runs `forge-kernel/test/run_ab_all.sh`, whose `HARNESSES` line **already contained `thicken`**. This branch's own CI run prints `[ab-all] ok thicken: 0 failure(s), baseline 0`. So the harness was never dark: it was running through the shell ratchet the whole time, and what the re-registration restores is its **ctest membership, not its execution**. Claiming otherwise would have been a bigger number than the measurement supports. Both the ledger entry and the CMakeLists note say so.

## Nothing was weakened

The gate's defer control (a) fed a cylinder's lateral face and required a **decline**. That face is now built, so the assertion is *obsolete*, not inconvenient — and it was **replaced by two stronger controls, not deleted**:

- a **holed** cylindrical patch must decline with the certificate's own reason;
- a **spherical** face must still decline with `"a face is not a Geom_Plane"` — the engine gained *one* surface type, not a licence to approximate every one.

Plus a new **case 6** asserting the cylindrical result against live OCCT *and* against both closed forms (240π and 160π), with the surface inventory pinned on both sides. The gate goes **227 → 285 passed, 0 failed**. Not one `want` was relaxed.

## Drop hygiene — checked on the object file, not the comment

`NativeThickenShell.cpp.o` imports **0** `BRepOffset*`, **0** `BRepOffsetAPI*`, **0** `BRepPrimAPI*` symbols. The new path adds only `BRepAlgoAPI_Cut` (TKBO — the toolkit the file's n-ary fuse already needed) and `forge::occtCylinderSolid` (in-house, TKPrim-free). No toolkit enters the closure.

## Verification run

| check | result |
|---|---|
| `ctest -R '^kernel\.ab\.'` | **45/45 passed, 0 failed** (44 before; +1 is the re-registration) |
| `run_ab_native_thicken.sh` | **285 passed, 0 failed** (227 before) |
| `build_thicken_orientation_gate.sh` | **PASS** |
| `run_corpus_ab_coverage.sh --selftest-guard` | both tree guards fire |
| `gen_archie_op_vocabulary.py --check` | exits 0 (regenerated: `CMakeLists.txt` is a hashed source) |

**Not run locally, but run by CI:** the two JS smoke tests (`thicken_surface_smoke.js`, `knit_surface_smoke.js`). The node addon does not configure in this worktree — `napi.h` cannot find `node_api.h`, a pre-existing environment gap unrelated to this change. Both exercise the **coplanar** path, which the new path cannot reach (it is guarded on a single face carrying a `Geom_CylindricalSurface`). This PR's CI run executes both on the runner and both **PASS**: `thicken_surface_smoke` volume 30000 / area 13600 exact, `knit_surface_smoke` 48000 exact. So the coplanar path is confirmed untouched by a real execution, not only by the guard's shape.

## Reversible

One guarded early-return in `thickenShell`, live only when the input is a **single** face carrying a `Geom_CylindricalSurface`. A shell with two or more faces, or one planar face, falls straight through to the code that has always handled it. Deleting that block restores 67.8% exactly.

Recorded as **D-024** in `implementation/sacrosanct/DECISIONS.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01RJoSd5PSVrVfK37Sn7tSHB
