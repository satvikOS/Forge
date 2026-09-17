# T-135 — the Native\* engines are native, and that is why they decline

**Measured on `8c7d34ef`** with `tools/kernel/native_engine_composition.py`
(re-runnable; `--audit` prints the classifier's own blind spot). Joined to the
already-measured family A/B in `forge-kernel/reports/CORPUS_AB_COVERAGE.md`.

## What the ledger recorded, and why it needed re-measuring

T-135 was opened on a token count: `gp_Pnt` 497 across the twelve
`Native*.cpp`, `Vec3` 2033 in the rest of the native B-Rep tree — read as
**"14:1 OCCT by composition ... substantially OCCT implementations carrying
native-sounding names, not native computations with an OCCT adapter at the
end."** It left one question open in its own words:

> WHAT IS NOT SETTLED BY COUNTING: whether any INDIVIDUAL engine computes its
> answer natively before converting is a question about control flow, not about
> token frequency, and needs per-file reading.

Two corrections before the answer. There are **fifteen** `Native*.cpp`, not
twelve. And counting OCCT identifiers cannot support the reading, because almost
all of them are how a value is *spelled* at the boundary — consistent with the
546-symbol census finding that **93% of the OCCT surface is representation**.

## The instrument

Every OCCT-looking identifier is classified into one of four buckets, and only
one of them bears on "did OCCT compute this":

| bucket | meaning | examples |
|---|---|---|
| **PRODUCES** | OCCT computes the answer | `BRepAlgoAPI_*`, `BRepOffsetAPI_*`, `BRepFilletAPI_*`, `ShapeUpgrade_*`, `ShapeFix_*`, `GeomAPI_*` |
| checks | OCCT inspects an answer someone else computed | `BRepCheck_*`, `BRepClass3d_*`, `BRepExtrema_*` |
| adapts | OCCT carries an already-computed answer | `BRepBuilderAPI_Make*`, `BRep_Builder`, `Sewing` |
| spells | OCCT names a value | `gp_*`, `TopoDS_*`, `Geom_*`, `TopLoc_*` |

Comments, string literals and `#include` lines are stripped first — this tree
argues about its own OCCT usage in prose, and counting the prose counts the
argument twice.

> **★That stripping is a single-pass scanner, and it had to become one.** The
> first version ran `/\*.*?\*/` *before* removing `//` lines, so a line comment
> containing `/*` opened a phantom block comment that ran to the next `*/`
> anywhere in the file and deleted every line between. Two such lines exist in
> this very corpus (`NativeSectionFill.cpp:28`, `NativeShapeHeal.cpp:578`); both
> happen to close on their own line, and **measured across all fifteen files the
> two versions differ by zero characters**, so no number here moved. It is fixed
> anyway — on `src/native/geom/NativeProjection.cpp` the same pattern swallows
> real code, and *a census that silently deletes source is the exact failure this
> report is about*. `--selftest` carries the four lexical fixtures. Found in
> review.
>
> ★And the self-test that guarded it said **"byte offset"** while measuring
> **characters** — everything runs on a decoded Python `str`, where `len()` and
> `re.Match.start()` count characters. Blanking a non-ASCII character with one
> ASCII space keeps the character count equal while the UTF-8 byte count shrinks.
> MEASURED across the fifteen files: character drift **0**, byte drift **4,491**,
> `NativeLoftPipe.cpp` alone off by 1,225 — exactly its non-ASCII byte count. A
> false statement passing a true test. The assertion deliberately stays on
> characters, because the only consumer compares `m.start()` values from that
> same string.

**The falsifiability check is `--audit`**, which prints every OCCT-looking
identifier that matched no bucket. A producer hiding in that list would
invalidate the table. On `8c7d34ef` it is 13 distinct identifiers, 427
occurrences, **all macros**: `FK_DEFER` (299), `FK_DEFER_F` (74),
`STANDARD_TYPE`, `FORGE_*`, `M_PI`, `DEFINE_STANDARD_ALLOC`. No producer.

> **★That check was itself broken in the first version of this report, which is
> the lesson worth keeping.** The detector matched `CamelCase_with_underscore`
> plus a hand-written allowlist of six underscore-free names, so OCCT classes
> without an underscore — `BRepBndLib`, `ShapeFix`, `GeomConvert`, `GeomPlate`,
> `BRepFill` — were invisible to the classifier **and to `--audit`**. *An audit
> cannot report a hole its detector cannot see.* `NativeAabbBridge.cpp:111`
> calls `BRepBndLib::Add(shape, box)` and the tool reported that engine as
> having zero of everything. Found in review, not by me.
>
> Fixed by matching the OCCT toolkit **naming scheme** rather than a class list,
> restricted to static-call form (`(?=::)`) — without that restriction the
> prefixes swallow the *native* `TopologyBuilder` and the method name
> `ShapeType()`, and an audit that accuses native code of being OCCT is as
> useless as one that cannot see OCCT. `BRepBndLib` is classified as a
> **measurement**, beside `BRepGProp`: it computes a value from a shape rather
> than constructing the shape returned. **The 12-of-15 result survives the
> corrected instrument** — it is now measured rather than accidentally right.
>
> One case bends that rule and a token census cannot see it: `NativeAabbBridge`'s
> answer *is* a box, so for that engine `BRepBndLib::Add` would be producing —
> except the call sits under `#if defined(FORGE_HAVE_OCCT_AABB)` on the path that
> `return false`s, i.e. the OCCT **fallback** taken when the native box declined.

## Composition

```
engine                     PRODUCES  checks  adapts  spells  sites
NativeLoftPipe.cpp               19      20      36     453    294
NativeThickenShell.cpp            5      16      36     376    103
NativeDraftAngle.cpp              3       1       2     106     17
NativeAabbBridge.cpp              0       1       0       4      -
NativeDraft.cpp                   0       1       6      52     25
NativeDraftLocal.cpp              0       2       2     241     54
NativeFilletChamfer.cpp           0       8      40     409     84
NativeFilling.cpp                 0       1       1      15      8
NativeRoute.cpp                   0       0       0       0      -
NativeSectionFill.cpp             0       0       0      42      -
NativeShapeHeal.cpp               0       3       3      88      3
NativeShapeHealBridge.cpp         0       0       0       3     12
NativeThickSolid.cpp              0      22      49     555     79
NativeVariableFillet.cpp          0       3      14     132     21
NativeWireFill.cpp                0       0       1      12      6
```

**OCCT never produces the answer in 12 of the 15 engines.** The open question is
answered, and answered in the *opposite* direction to the ledger's reading: these
are native computations with an OCCT adapter at the end, exactly as the tracker
framed them. The two largest engines — `NativeThickSolid.cpp` (4,105 lines) and
`NativeFilletChamfer.cpp` (2,665) — call **zero** producing classes. Their 568
and 430 OCCT references are `gp_Pnt`, `TopoDS_Face` and friends.

Three engines do delegate, all through booleans and `ShapeUpgrade_UnifySameDomain`:
`NativeLoftPipe` (19), `NativeThickenShell` (5), `NativeDraftAngle` (3).

> **★Those three numbers were 23 / 9 / 6 in the first version and the difference
> is instructive.** `#include <BRepAlgoAPI_Fuse.hxx>` is not a string literal —
> the path sits in angle brackets — so it survived comment/string stripping and
> was counted as a *use* of a producing class. A file that merely includes a
> header has delegated nothing. `PRODUCES` now counts only a **construction or a
> declared instance**, never a bare mention. The twelve zeros are unaffected:
> those files do not include the headers either. Found in review.

## …and it does not matter, which is the finding

Joining the composition to the measured A/B over the same 600-part corpus:

| family | engine | PRODUCES | native coverage | verdict |
|---|---|---:|---:|---|
| FILLING | `NativeFilling.cpp` | **0** | **67.8%** | **PASS** (0 discordant) |
| THICKEN | `NativeThickenShell.cpp` | 9 | 67.8% | FAIL |
| PIPESHELL | `NativeLoftPipe.cpp` | 23 | 51.5% | FAIL |
| FILLET | `NativeFilletChamfer.cpp` | **0** | 32.8% | FAIL |
| OFFSETSHAPE | — | — | 1.2% | FAIL |
| **THICKSOLID** | `NativeThickSolid.cpp` | **0** | **1.2%** | FAIL |
| **PIPE** | `NativeLoftPipe.cpp` | 23 | **0.3%** (2 of 600) | FAIL |
| DRAFT | `NativeDraft.cpp`, `NativeDraftLocal.cpp` | **0** | 0.0% → 65.8% since | FAIL |

**Composition does not predict contribution, and where it points at all it
points the wrong way.** `NativeThickSolid.cpp` is the purest native engine in the
tree by this measure — 4,105 lines, zero producing calls — and it answers **1.2%**
of the corpus. `NativeLoftPipe.cpp` is the most OCCT-delegating, and it carries
PIPESHELL at 51.5%, forty times ThickSolid's rate. The only **PASS** in the whole
table, `FILLING`, is a 309-line engine with zero producing calls and 22 OCCT
references in total.

**The mechanism is visible in the source, and the engines instrument it
themselves.** A native engine that cannot handle an input returns null rather
than guessing, and records *why*. The shared convention is a `defer(why)` helper:
`NativeDraft` and `NativeThickenShell` keep the reason in a thread-local slot,
`NativeFilletChamfer` returns a reason-bearing `Result`, `NativeFilling` fills
`FillDiagnosis.reason`, and `FK_DEFER` is only the **macro form** of it in two
files. `NativeLoftPipe` has 294 such sites, `NativeThickenShell` 106,
`NativeFilletChamfer` 84, `NativeThickSolid` 79, and twelve of fifteen engines
label declines once the result-diagnostic form (`FillDiagnosis.reason`) is
counted too — only `NativeRoute`, `NativeSectionFill` and `NativeAabbBridge` do
not. `NativeLoftPipe`'s own comment
states the consequence outright:

> the corpus A/B measured this engine covering **2 of 600 PIPE inputs**

> **★THE `sites` COLUMN IS STATIC AND MUST NOT BE READ AS COVERAGE.** It counts
> decline sites **in source**, not inputs that reached them. A guard may fire for
> every input, for none, or many times in one call, so these numbers cannot
> re-derive per-engine coverage and must not be read beside the percentages below
> as though they were the same kind of number. Coverage is measured per family in
> `CORPUS_AB_COVERAGE.md` and nowhere else. The first version of this report drew
> exactly that illegitimate inference; it was caught in review.
>
> The same version also claimed the other thirteen engines "decline without
> saying why", on the strength of them not using one macro. **False** — twelve of
> fifteen label their declines, across three spellings: the `FK_DEFER` macro, a
> `defer(why)` helper, and `FillDiagnosis.reason`. Two further corrections came
> out of review: `\bdefer\s*\(` also matched the helper's own *declaration*
> (`Result defer(const std::string& why)`), which is not a decline site, and the
> result-diagnostic form was invisible entirely — so `NativeFilling`, which has
> some of the most detailed decline reasons in the tree, was reported as having
> none.

So a native engine is not OCCT-flavoured code wearing a native name. It is
genuinely native code that **only covers the cases it was written for** and hands
everything else back. Purity of composition is close to a measure of how narrow
that set is.

## What to do with this

1. **Stop reasoning about these engines by composition.** The 14:1 figure is an
   artefact of counting representation. Reason by coverage — measured per family
   in `CORPUS_AB_COVERAGE.md`, and **not** re-derivable from the static site
   counts above.
2. **Labelled declines are the right instrument, and three engines still lack
   them.** `defer(why)` is the established convention, `FK_DEFER` its macro form,
   and `FillDiagnosis.reason` a third spelling. Twelve of fifteen engines record a
   reason; `NativeRoute`, `NativeSectionFill` and `NativeAabbBridge` do not,
   which is precisely the condition the convention was introduced to fix — "a
   bare null shape says nothing about WHICH precondition declined, which made the
   largest deletion bucket in the whole drop plan unattributable." **Counting
   sites is not measuring declines**: turning these into coverage needs runtime
   per-input instrumentation, which is what `CORPUS_AB_COVERAGE.md` already does
   per family and what a per-engine answer would require.
3. T-135's strategic conclusion is unchanged and still governs: converting a
   `Native*` engine to return native types **does not move `OCCT_CLOSURE`** —
   best single engine 16 of 550 exclusive symbols (2.9%), seven of fifteen worth
   zero, all fifteen together 48 of 550 (8.7%). This report changes *why* the
   composition argument fails, not the plan it was being used to justify.
