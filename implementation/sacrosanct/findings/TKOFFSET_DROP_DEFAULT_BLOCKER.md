# The TKOffset drop is real. Enabling it by default costs one measured capability.

**Date:** 2026-08-28 · **Verified independently of the authoring agent**, on a clean detached
worktree at `8d4e7130`, with my own configure + build + measurement.

## 1. The drop is real

`forge-kernel/scripts/tkdrop_build_variant.sh allon` with all nine families ON, measured with
`occt_closure_count.sh` on the resulting binary:

| | default build | all nine families ON |
|---|---|---|
| OCCT_DIRECT | 9 | **8** |
| **OCCT_CLOSURE** (the ledger number) | 14 | **13** |
| OCCT_PHANTOM | 2 | **2** |
| TKOffset in the closure | present | **absent** |
| undefined `BRepOffset*` / draft symbols | — | **0** |

`OCCT_PHANTOM did not rise.` That is the check that separates a real drop from
`-undefined dynamic_lookup` masking a still-referenced toolkit, and it is the failure mode
`CMakeLists.txt`'s `_FORGE_TKOFFSET_FAMILIES` guard exists to refuse. This is the first OCCT
toolkit whose LINK RECORD the programme has removed.

Equivalence gates, re-run by me on my own binary:
`run_ab_native_thicken.sh` **227 passed / 0 failed** · `run_ab_native_draft.sh` **114 / 0** ·
`run_ab_tkoffset_mutations.sh` **12 ok / 0 failed**, including mutation T4 — a *volume-preserving*
direction flip that is still caught, so the gate does not rest on volume alone.

## 2. Why the defaults nevertheless stay OFF

All nine options default OFF, so the SHIPPED kernel still links TKOffset and CLOSURE is still 14.
Flipping them is the whole user-visible value of the work, so I measured what flipping costs.

Full shipped suite against the all-on binary: **21 passed, 2 failed.**

**(a) `native_analytic_offset_ab` — A REAL CAPABILITY LOSS. This is the blocker.**

```
[ab] FAIL cyl defer: NATIVE build threw — forge.part.offsetSolid: native whole-solid offset
DECLINED this shape ... the OCCT BRepOffsetAPI_MakeOffsetShape fallback is compiled out
(FORGE_OFFSETSHAPE_DROP_NATIVE=ON)
```

`part.offsetSolid` on a **cylinder** works today via OCCT and would **throw** under the drop. The
four analytic box cases still pass 4/4 against closed form. So family H (`MakeOffsetShape`) is not
yet a replacement — it is a subset. Turning it on by default would remove a working operation to
obtain a better dependency number, which is the one trade this programme does not make.

**(b) `part_features_smoke` — NOT a geometry error.** `shell f0 occt face count: actual 14,
expected 11`. The test calls both engines and asserts each one's *representation*: OCCT 11 faces /
24 edges, native 14 / 28. Under the drop `part.shell` IS the native path, so the OCCT-representation
assertion is asserting a fallback that no longer exists. Volume, area, bbox, Euler and genus pass on
**both** paths — the invariants are intact; only the engine-identity assumption breaks.

## 3. What would unblock it

1. **FIX** the native whole-solid offset for quadrics — not merely enable it. I first assumed the
   cylinder was simply unimplemented and that widening the planar-only eligibility gate at
   `Features.cpp:1274` would unblock family H. **Measured, that is wrong, and the existing
   deferral is correct.** With eligibility widened to Plane/Cylinder/Cone/Sphere and rebuilt:

   | case | volume vs OCCT | position |
   | --- | --- | --- |
   | cylinder r=3 h=8 d=+0.5 | rel err **8.2e-15** | **`|dCOM| = 4.00`** — native COM at the origin, OCCT at z=4 |
   | cylinder r=3 h=8 d=-0.5 | rel err **5.0e-15** | **`|dCOM| = 4.00`** |
   | sphere r=5 d=+1.0 | rel err **1.6e-14** | bbox **`[-6,-6,-5]..[6,6,5]`** vs OCCT `[-6,-6,-6]..[6,6,6]` — grew in x/y, **not in z** |

   Every one of those volumes is right to ~1e-14 and matches the closed form. The *shapes* are
   wrong. This is the third recorded instance in this programme of a wrong solid matching the
   right volume to 10+ significant figures, and it is why the comment at
   `native_analytic_offset_ab.mjs:155` — "curved solids to OCCT rather than shipping a wrong
   (mispositioned) native shape" — is **current, not stale**. The cylinder bbox even matches
   exactly, so only COM catches it; the sphere's COM matches, so only bbox catches it. **No single
   observable catches both.**

   The defect is in the vertex re-meet, not in `offsetSurfaceOutward` (whose cylinder/cone/sphere
   closed forms are present and look right): quadric-only vertices fall to the case-(c) averaged
   normal fallback, which does not reproduce the true offset position along the axis.

   **Anyone widening that gate on volume evidence alone would ship broken geometry.** The existing
   test already guards this by asserting `nat.kind === 'occt'` — that assertion is load-bearing and
   must not be relaxed.

   Consequence for the drop: family H is further from default-on than the ledger entry above
   implies. The other eight families are unaffected by this finding.
2. Give the binary a way to report which fallbacks were compiled out, so
   `part_features_smoke` can assert engine representation only when that engine is present —
   without weakening the default build's 11/24 assertion. There is no such export today
   (341 exports, `version` among them, nothing describing the build). This is the same
   capability-manifest the APP SURFACE track needs and the same one Archie needs in order to
   emit only operations a user can actually reach.

**Until (1) lands, the honest ledger number is CLOSURE 14.** The 13 is real, reproducible, and
opt-in — and it is not what users get.

## 4. Do not merge `worktree-wf_41f62d36-39b-1` wholesale

Its tip `8d4e7130` is **behind** the execution branch by 102 files / 25,838 deletions (all of
`ui/`). The kernel work was already integrated by `65b52836`, deliberately excluding the two files
that worktree did not own. Nothing further is owed from that branch.
