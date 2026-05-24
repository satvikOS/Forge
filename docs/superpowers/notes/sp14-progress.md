# SP-14 — First hardening pass — adversarial fuzz corpus

**Date:** 2026-05-24.
**Scope:** First pass of the SP-14 hardening campaign per
`docs/superpowers/plans/2026-05-21-kernel-parity-program.md` §6 — "an
adversarial corpus, fuzzing of long op chains, and degeneracy handling
that grows as ArchDisc gets real use." Framing: **ongoing, not a finish
line**.
**Deliverable:** the fuzz suite + this written hardening report. NO
kernel changes this pass. Pure e2e + docs. Future hardening passes will
fix the failures one by one.

---

## What ran

| Artefact | Path |
|---|---|
| Fuzz suite | `e2e/sp14-hardening-pass1-electron.spec.js` |
| Corpus organiser | `e2e/helpers/fuzzCorpus.js` (28 cases, 10 categories, ~620 lines) |
| Full per-case JSON report | `test-results/sp14-hardening/report.json` |
| Session video + 2 stills | `test-results/motion/sp14-hardening/` (≈ 500 KB webm) |

Headed Electron, `--workers=1`, ONE `test()`, no `node:` imports.
Corpus runs entirely inside one `win.evaluate` block — each case is a
plain object whose `body` string is rehydrated as an `AsyncFunction(K)`
and raced against a 90s timeout. Per-case `try/catch` keeps one CRASH
from blowing the whole run.

## Headline numbers — first pass

```
Total cases:               28 across 10 categories
PASS:                       7    polite-success or expected-rejection
CAUGHT (polite reject):    12    op threw or returned-null cleanly on bad input
UNEXPECTED-EXCEPTION:       2    op threw on input it should handle
SILENT-BAD-OUTPUT:          5    op ran cleanly but result is wrong (vol=0, …)
CRASH:                      2    Embind BindingError — kernel-WASM bridge dropped
```

Corpus completion time: ≈ 2.0 s (the kernel ops themselves are fast; the
spec total including launch + UI seed is 8.6 s).

Spec PASSES (the survey ran to completion + every category exercised);
the CRASH / UEX / SBO counts are INVENTORY findings for future
hardening passes per the §6 framing.

## Per-category breakdown

| Cat | Theme | Total | PASS | CAUGHT | UEX | SBO | CRASH |
|---|---|---:|---:|---:|---:|---:|---:|
| 1 | Degenerate primitives | 7 | 0 | 6 | 0 | 0 | 1 |
| 2 | Near-tangent booleans | 3 | 0 | 2 | 0 | 1 | 0 |
| 3 | Self-intersecting inputs | 2 | 1 | 0 | 0 | 1 | 0 |
| 4 | Zero/extreme parameters | 4 | 1 | 3 | 0 | 0 | 0 |
| 5 | Hairline geometry | 3 | 2 | 0 | 0 | 0 | 1 |
| 6 | Sliver faces | 2 | 0 | 1 | 0 | 1 | 0 |
| 7 | Long op chains | 1 | 0 | 0 | 1 | 0 | 0 |
| 8 | Tolerance stress | 2 | 1 | 0 | 0 | 1 | 0 |
| 9 | Massive count | 2 | 1 | 0 | 0 | 1 | 0 |
| 10 | Round-trip torture | 2 | 1 | 0 | 1 | 0 | 0 |
| **Total** | | **28** | **7** | **12** | **2** | **5** | **2** |

## Reading the verdict bands

* **PASS** — the op did what the expected-band claims (polite success
  on accept-band cases; polite rejection on reject-band cases).
* **CAUGHT** — the op politely refused bad input. For reject-band
  cases this IS the desired outcome — the op detected the degeneracy
  and threw a clear error or returned `null` instead of producing
  bad geometry. Category 1 (degenerate primitives) is dominated by
  CAUGHT — exactly what a hardened kernel should do.
* **UNEXPECTED-EXCEPTION** — the op threw on input that should
  succeed. Partial fail — the op recognised it couldn't proceed
  but the user expected the op to handle this case.
* **SILENT-BAD-OUTPUT** — the op returned a result but the
  geometry is observably wrong (volume = 0 on a body that should
  have positive volume, etc.). This is the worst non-CRASH band —
  the caller has no way to know the op failed.
* **CRASH** — the WASM bridge dropped (Embind `BindingError`,
  `table index out of bounds`, etc.). Critical fail — the JS-side
  try/catch caught it, but the kernel hit an internal assertion or
  null-pointer-deref that should never happen.

## Top 10 honest weaknesses surfaced — ordered by severity

### Critical (CRASH band — kernel-side assertion / null-deref)

**1. `makeCone(r1=r2)` — degenerate-to-cylinder crashes with `BindingError`.**
A cone with equal top + bottom radii IS a cylinder. The OCCT
`BRepPrimAPI_MakeCone` call presumably hits an internal assertion when
r1=r2 because the apex direction is undefined. The kernel facade should
detect r1≈r2 and either reject with a clear message OR fall through to
`makeCylinder`. Severity: HIGH — a user picking the Cone tool with two
equal radii crashes the bridge.
Recommended fix: facade-level shim in `makeCone(r1, r2, h)`: if
`|r1 - r2| < ε`, call `makeCylinder(r1, h)` instead.

**2. `makeBox(1e-7, 1e-7, 1e-7)` — sub-tolerance dimensions crash with
`BindingError`.** OCCT's default `Precision::Confusion()` is ≈ 1e-7;
asking for a body whose entire extent is at that tolerance puts the
constructor into a corner of its precondition space. The facade rejects
zero / negative dims (cat1 PASS); it needs to also reject (or clamp)
sub-confusion dimensions. Severity: HIGH — any user with a unit
mistake (mm vs m vs ft, dividing instead of multiplying) can hit this.
Recommended fix: add lower-bound validation against
`Precision_Confusion()` in `makeBox` / `makeCylinder` /
`makeSphere` / `makeCone` / `makeTorus`.

### Severe (SILENT-BAD-OUTPUT — wrong result, no error)

**3. `fuse` with exactly-coincident faces returns volume = 0.** Two
10×10×10 boxes touching face-to-face (shared X=10 face). Expected
volume 2000 mm³; actual 0. The OCCT BOP appears to produce a result
whose `BRepGProp.VolumeProperties_1.Mass()` reads 0 — likely because
the result is a compound or the shared face isn't being absorbed
correctly. Severity: HIGH — this is a normal CAD workflow (e.g.,
stacking two parts in an assembly and unioning them).
Recommended diagnostic: re-tessellate the result manually + sum
triangle-volumes — if mesh volume is positive but `BRepGProp` says 0,
the fuse produced a non-watertight result that the area-A spine
should classify as `kind:'sheet'` not `'solid'`.

**4. `fuse` with strong overlap (50% co-located) returns volume = 0.**
Two 20×20×20 boxes, second offset by [10,10,10] — expected merged
volume 15000 mm³ (8000 + 8000 - 1000 overlap); actual 0. Same
pathology as #3 — the OCCT boolean produces a result whose volume
reads zero. This is the more common path of #3 (proper interior
overlap rather than face-coincidence) so the bug is broader than
just the coincident-face case. Severity: VERY HIGH — most CAD users
expect `union` to "just work" on overlapping bodies; getting `vol=0`
is silent corruption.

**5. `fuse` with thin-strip touch returns volume = 0.** A 10×10×10
box fused with a 10×0.001×10 strip — expected positive volume; actual
0. Generalises #3 / #4 — the fuse result-volume is unreliable when
the operands share any near-zero-thickness contact.

**6. `makeCompound([200 spheres])` reports volume = 0.** 200 small
spheres assembled into a compound; expected merged volume > 100 mm³;
actual 0. `BRepGProp.VolumeProperties_1` does not aggregate across
the children of a `TopoDS_Compound` (or does so in a way that loses
the per-child volume). Severity: MEDIUM — instanced-fastener and
massive-assembly workflows hit this immediately.

**7. SP-11 mixed-tolerance `fuse` doesn't propagate body-level
tolerance MAX.** Fuse two boxes with body tolerances 0.05 and 0.1;
result body has tolerance 0.05 — should be MAX(0.05, 0.1) = 0.1 per
the SP-11 §4 contract. AND the result volume reads 0 (same bug as
#3-#6). Severity: HIGH for the tolerance contract violation;
volume=0 piles on. Cross-references the SP-11 "Body-level MAX rule"
which should have made this a PASS.
Recommended diagnostic: re-run `cat8-fuse-mixed-tolerance` after
fixing #3-#6 and check whether `body.metadata.tolerance` propagation
ALSO breaks, or whether the volume bug masked a working tolerance
carry.

### Partial-fail (UNEXPECTED-EXCEPTION — op declined valid input)

**8. Long op chain — 50-step fuse/cut fails at step 0 with `"fuse:
kernel boolean did not complete"`.** The case stacks 50 alternating
fuse+cut ops on a 100³ box, each with small cylinders/boxes at
varying positions. Step 0 (the very first fuse) fails because the
first cylinder is at z=[95, 100] which is exactly tangent to the box
top — generalisation of cat 2's near-tangent boolean fragility. The
op throws `"fuse: kernel boolean did not complete"` instead of
absorbing the tangency. Severity: HIGH — exposes that any
boundary-tangent fuse is unreliable, which limits the kernel for
real workflows (drilling a hole exactly to the surface, mounting a
boss exactly on a face).
Recommended fix: catch the OCCT BOP failure for tangent contacts +
fall through to fuzzy boolean with `setFuzzyTolerance(Precision::
Confusion() * 10)` automatic widening.

**9. STEP round-trip after a 5-cut chain throws `"cut: kernel boolean
did not complete"`.** The cut chain itself fails before the export
runs — same tangency fragility as #8. The 5 cuts are placed so the
fifth cylinder lies right at the bottom face boundary.
Recommended fix: same as #8 — fuzzy-tolerance retry on BOP failure.

### Workflow / API contract

**10. `K.brep.volume` returns 0 for any non-watertight or compound
result without telling the caller.** Multiple cases above show
`volume === 0` for results that clearly carry geometry (cat 2/3/6/8/9
all hit this). The user has no way to distinguish "real zero-volume
body" from "BRepGProp couldn't compute volume on this shape kind".
Recommended fix: when `Mass()` returns 0, run a sanity probe (e.g.,
tessellate and sum signed triangle volumes — already used inside
`harmonizeNormals` as a "consistencyAfter" metric) and surface a
diagnostic on `meta.measureDiagnostic = 'compound-volume-zero'` or
similar.

## Categories that performed BEST — the kernel is actually solid here

| Category | What passed |
|---|---|
| **1 Degenerate primitives** | Every facade primitive (Box / Cylinder / Sphere / Torus) explicitly rejects zero / negative dimensions with a clear error message. 6/7 cases CAUGHT politely. Only Cone (r1=r2) crashed, and the Torus (R<r) was caught. |
| **4 Zero/extreme parameters** | `filletAll(r=0)` no-op handled, `filletAll(r=1e6 on a 1mm body)` rejected, `shell` over-thick rejected. 3/4 CAUGHT cleanly. |
| **9 Massive count** | `partition` with 20 tools at once worked correctly. WASM heap discipline holds under pressure (no `table index out of bounds`). |
| **5 Hairline geometry** | 1M:1 aspect ratio worked (1000×0.001×0.001 box). 1µm sliver cut worked. The only crash was the all-1e-7 case (#2). |

## Categories that performed WORST — the hardening targets

| Category | Why |
|---|---|
| **2 Near-tangent booleans** | 1 SBO + 2 CAUGHT. The fuze-with-1um-gap & cut-tangent-edge CAUGHT (good), but the coincident-face fuze SBO is severe. |
| **3 Self-intersecting** | 1 PASS + 1 SBO. The half-overlap fuze (the most common boolean!) returns vol=0 silently. |
| **6 Sliver faces** | 1 CAUGHT + 1 SBO. Thin-strip touch SBO compounds the cat-2/3 pathology. |
| **8 Tolerance stress** | 1 PASS + 1 SBO. The mixed-tolerance fuze violates the SP-11 MAX-tolerance contract. |
| **7 Long op chains** | 1/1 UEX. The chain fails AT STEP 0 because of boundary tangency. |
| **10 Round-trip torture** | 1 PASS + 1 UEX. Simple round-trip works; round-trip after a chain fails (because the chain itself fails — same tangency root cause). |

## Recommended next hardening targets (in order)

1. **Boolean robustness on coincident / tangent / overlapping inputs**
   — items #3, #4, #5, #8, #9 above all trace to the same root: OCCT
   BOP fragility when operands share boundary geometry. The single
   highest-leverage fix.
   *Approach:* catch BOP failures + retry with fuzzy tolerance
   widening (already used in `fuseCoincident` — generalise to the
   default `fuse` / `cut` / `common` path with an `opts.autoFuzzy`
   default-on flag). Verify on every cat-2/3 case.

2. **Facade input validation against `Precision::Confusion()`** —
   item #2. Add lower-bound validation to every primitive constructor
   so sub-confusion dimensions are caught with a clear message rather
   than crashing the bridge. Trivial fix; high user-experience win.

3. **`makeCone(r1=r2)` shim** — item #1. Facade-level fall-through to
   `makeCylinder` when |r1-r2| < ε. Trivial.

4. **`K.brep.volume` diagnostic when `Mass()` returns 0** — item #10.
   Cross-check via tessellation sum; surface `measureDiagnostic` on
   the returned record. This unblocks ALL of the SBO cases above for
   meaningful caller feedback even before the underlying booleans are
   fixed.

5. **Compound-body mass-properties aggregation** — item #6.
   `BRepGProp.VolumeProperties_1` should walk the compound and sum
   children. Investigate whether the existing call's `byOrientation`
   / `byVerify` flags affect this; if not, add an explicit compound-
   walking helper in `BrepMeasure.js`.

6. **SP-11 tolerance carry through `fuse`** — item #7 sub-finding.
   Verify (after #1-#5) whether `body.metadata.tolerance` propagates
   correctly when fuse genuinely runs. The `tolerancesCarried` lineage
   counter SP-11 ships should expose this independently.

7. **Expand cat 7 (long op chains) to non-tangent inputs.** The
   current case is dominated by the cat-2/3 tangency root cause.
   Add a chain that uses interior-only ops (e.g., 50 small concentric
   fillets at varying radii on a sphere) to exercise the
   carryLineage WASM-heap discipline on its own.

8. **Mesh-level self-intersect repair beyond the toy case.** SP-8
   ships `autoRepairSelfIntersection`; the `cat8-heal-after-tolerance
   -fuze` case PASSES on a clean body. A genuine adversarial case
   would feed it a body with real Möller-detected intersections and
   measure pairsBefore → pairsAfter reduction.

## Honest limits of THIS pass

This is the FIRST hardening pass. Specific honest limits:

- **Corpus size is 28 cases, not 28,000.** Real-world hardening
  (the Parasolid moat per §6 of the parity plan) is millions of real
  parts hitting every edge of the kernel for years. 28 cases is a
  starting CORPUS — every future hardening pass should extend it.
- **No mutation-based fuzzing** — every case is hand-crafted. A
  next pass should add a property-based / mutation-based generator
  (random primitive + random op + random transform composition,
  bounded by reasonable dimensions, asserting only "no CRASH").
- **No long-running stress tests** — the longest case (cat 9's
  200-sphere compound) ran in 389 ms. A next pass should include
  cases that intentionally push WASM heap pressure for minutes.
- **No diff-against-reference-kernel verification** — for cases that
  PASS, we only verified "the result looks plausible," not "the
  result matches Parasolid / ACIS to N decimal places." A reference-
  comparison pass would catch SILENT-BAD-OUTPUT cases that produce
  *plausible but subtly wrong* geometry — strictly stronger than
  this pass's expected-band assertions.
- **Survey timing is fast** because most CAUGHT cases throw
  immediately. A future pass should add cases that EXERCISE the op
  fully (compute volume, build tessellation, write STEP) so a
  silent corruption is more likely to surface downstream.
- **Some "expect=either" cases hide real findings.** When a case is
  borderline-defensible either way (e.g., `makeCone(r1=r2)` could
  legitimately be a cylinder OR a rejection), I marked `expect=either`
  so the verdict is generous. A stricter future pass should pick a
  contract and assert it.
- **No regression band run.** Per the SP-14 brief: "Targeted
  regression: just the new `sp14-*` spec. Pre-existing failures out of
  scope." The full brep-* / spine-* / sp* bands were NOT re-run this
  pass because SP-14 changes no kernel code — only adds a new spec
  + new helper + new docs. Future hardening passes that DO modify
  kernel code MUST run the regression band.

## What the suite proves WORKS already

The CAUGHT band is the kernel doing the right thing — 12 polite
rejections show that:
- Every primitive constructor validates positive dimensions.
- `makeTorus` correctly rejects `R < r` with a clear message.
- `filletAll` rejects oversized radii.
- `shell` rejects over-thick requests.
- Cylinders separated by 1µm gap fuze cleanly (no silent merge — the
  bodies stay distinct).
- Cylinders exactly tangent to a face cut cleanly.
- Fillet on already-slivery geometry rejects cleanly.

This is real, working defensive code in the facade. The 12 CAUGHT
verdicts are credit-where-due — not failures.

## Files

- `e2e/sp14-hardening-pass1-electron.spec.js` (new, 256 lines) — the
  spec; ONE `test()`; bare-imports only; bounded per-case timeout;
  writes `test-results/sp14-hardening/report.json`; ONE seed-box
  ribbon click + one end-of-run summary still; no per-case capture.
- `e2e/helpers/fuzzCorpus.js` (new, ~620 lines) — the 28-case corpus
  + the `classifyOutcome` verdict-band classifier; cases serialised
  as JSON-cloneable plain objects with `body` strings rehydrated as
  `AsyncFunction(K)` in the page context.
- `docs/superpowers/notes/sp14-progress.md` (this file).

## Files NOT touched (per allowlist)

- ANY file under `frontend/src/`, ribbon, handlers, workbenches,
  components, kernel.
- Any other spec, including the prior SP-1..13 specs.
- `playwright.config.js`, `package.json`, `package-lock.json`.

Pure e2e + docs. NO kernel changes this pass.

## Commit chain

- `test(sp14): adversarial fuzz corpus organiser + 28 cases across 10 categories`
- `test(sp14): first hardening pass spec — runs corpus, classifies verdicts, writes report.json`
- `docs(sp14): first hardening pass progress note — failure inventory + 10 recommended next targets`

## Bottom line

The SP-14 program is now ACTIVE. First-pass headline: **7 PASS / 12
CAUGHT / 2 UEX / 5 SBO / 2 CRASH** across 28 cases in 10 categories.
The kernel's *defensive validation* is good (12 CAUGHT — every
primitive's zero / negative / out-of-range guards work). The kernel's
*boolean robustness on coincident / tangent / overlapping inputs* is
the single biggest weakness — 5 of the 7 non-PASS, non-CAUGHT cases
trace to this root, plus the volume-measurement API silently returns
0 on the resulting non-watertight outputs. Next hardening pass: take
the cat 2 / 3 / 6 boolean robustness gap as the first fix-list, with
the trivial wins (cat 1 cone shim + sub-Confusion validation) as
warm-up commits. Per §6: this is ONGOING. The corpus grows. The
report becomes the moving record.
