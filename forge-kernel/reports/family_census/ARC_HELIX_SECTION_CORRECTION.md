# ARC and HELIX are not missing. SECTION is. — measured 2026-08-31

> ## ★★ THIS DOCUMENT IS RETRACTED ON ITS CENTRAL CLAIM (2026-09-01)
> **ARC and HELIX ARE missing.** The benchmark census (PR #150) was right and I overturned it with
> a bad instrument. Only the `SECTION` half survives — and `SECTION` has since shipped as **#165**.
>
> **What went wrong.** I probed `archdisc-Models/tools/pinned/libforge_kernel_core.dylib`, got
> `ARC expects [x y; x y mx my; ...]`, and concluded the op exists. That binary was built
> **2026-08-07 with `-DFORGE_FT_ARCHELIX=ON`, and NO COMMIT IN THIS REPOSITORY PRODUCES IT**:
>
> ```
> git log --all -S"ARC expects"       -- forge-kernel/src/ft/FeatureTreeCompiler.cpp  -> nothing
> git log --all -S"FORGE_FT_ARCHELIX" -- forge-kernel/src/ft/FeatureTreeCompiler.cpp  -> nothing
> git log --all                       -- forge-kernel/src/ArcHelix.cpp                -> nothing
> ```
>
> The source exists only as uncommitted working-tree state in the shared checkout, already recorded
> in `implementation/sacrosanct/RECONCILIATION_OWED.md` as "+1451 lines, pre-session".
> `opFromName` has 40 entries on every pushed branch and neither name is among them.
>
> **The form argument was backwards too.** I claimed the 48 GT programs "fail on FORM, not on
> absence". Measured over `benchcad_ir_reharvest.jsonl` (1317 rows): **0 form violations in 1635
> rows**, all 86 `ARC` statements matching the accepted grammar, every row 2 numbers (`x y`) or 4
> (`x y mx my`), row 0 always 2 so the closing segment is straight. **The GT form IS the accepted
> form.** Those programs fail on ABSENCE. See PR #166, which raises GT parse coverage 1268 -> 1316
> of 1317.
>
> ★**THE RULE THIS AMENDS IS ONE OF THIS PROJECT'S OWN.** *Probe the instrument* is right and
> INCOMPLETE: **VERIFY THAT THE INSTRUMENT IS BUILT FROM COMMITTED SOURCE.** A pinned binary
> carrying uncommitted local work answers confidently about capability the repository does not
> have — and it sounds exactly like ground truth, because it IS a real measurement, of the wrong
> artifact. The check is one command:
> `git log --all -S"<a string only that build contains>"`.
>
> Everything below is left unedited as the record of the error.


Correcting the benchmark-requirements census (PR #150) on one point. The correction **strengthens
its own headline** rather than weakening it, which is why it is worth recording carefully.

## What the census said

> The residual not already scheduled is **1.8 points**, and it is two names: `ARC` (48 programs)
> and `HELIX` (1). Both absent — `grep -c ARC FeatureTreeCompiler.cpp` = 0.

## What the instrument says

`grep -c` over the source is not the authority. The verifier binary is. Probing
`tools/pinned/forge_verify` directly:

| probe | verdict |
|---|---|
| `%1 = ARC(1,2,3)` | `ft parse line 1: ARC expects [x y; x y mx my; ...]` |
| `%1 = HELIX(1,2,3)` | `RESULT %1 is not a defined SOLID or ASSEMBLY` |
| `%1 = SECTION(1,2,3)` | ★`ft parse line 1: unknown op `SECTION`` |

**`ARC` is not unknown — it is a profile form with a specific syntax**, a polyline carrying arc
midpoints. Given that syntax it compiles:

```
%1 = ARC([0 0; 10 0 5 5; 20 0 15 -5])
%2 = EXTRUDE(%1, 5)                     ->  ok=True
```

(The `EXTRUDE` then fails on *my* hand-written polyline not being a consistent closed profile —
a defect in the test data, not in `ARC`.)

**`HELIX` is not unknown either.** It parses; the error is that `RESULT` wanted a SOLID and a
helix is a wire. That is the op behaving correctly.

**`SECTION` genuinely is unknown** — and the census did not flag it. It is one of OCCT's four
Boolean operators (Fuse, Cut, Common, **Section**), and Forge's IR has three.

## Why this makes the census's conclusion *stronger*

The census's headline is that **fidelity, not vocabulary, is the binding constraint**. It then
carved out 1.8 points as a genuine vocabulary gap. That carve-out mostly dissolves:

* If `ARC` exists and 48 GT programs use it, then those programs fail because the model emits the
  **wrong form** for an op it already has — not because the op is missing.
* That is precisely the failure the census itself measured elsewhere: **zero counterbores emitted
  across 32 parts, using an op it already has**, and 311 bores expected against 48 found.

So the residual is not "add two ops". It is **the same fidelity problem**, one layer down: the
model knows the name and not the shape of the argument. **That is trainable and it is cheaper
than a kernel change.**

## The rule this is the second instance of, today

★**A GREP MISS IS NOT AN ABSENCE.** Earlier today "Class A appears in zero files" was recorded
from `grep "Class A"` with a space; the code spells it `ClassA` and
`forge-kernel/src/ClassASurfacing.cpp` is 760 live compiled lines. Now `grep -c ARC` over one file
produced "ARC is absent" for an op the parser accepts.

Both are the mirror of the rule this project already had — *a grep hit is not a capability* — and
both were caught the same way: **ask the instrument, not the source.** `scripts/oov_op_rate.py`
already encodes this ("truth comes from the instrument"); the technique should be the default for
any claim of the form "op X does/does not exist".

## What to do

1. **Do not schedule `ARC` or `HELIX` as kernel work.** Check the GT programs' actual `ARC` syntax
   against the parser's expected form, and if they agree, the gap is corpus/training.
2. **Do schedule `SECTION`** — a real absence, in the Boolean family, that nothing had noticed
   because no benchmark row demanded it.
3. **Re-run the census's 96.3% sufficiency number** counting `ARC`/`HELIX` as present. It can only
   go up, and the "1.8 points of missing vocabulary" line should be retired or restated as
   "1.8 points of wrong-form emission".
