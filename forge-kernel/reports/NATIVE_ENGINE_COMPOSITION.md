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

Comments and string literals are stripped first — this tree argues about its own
OCCT usage in prose, and counting the prose counts the argument twice.

**The falsifiability check is `--audit`**, which prints every OCCT-looking
identifier that matched no bucket. A producer hiding in that list would
invalidate the table. On `8c7d34ef` it is 13 distinct identifiers, 427
occurrences, **all macros**: `FK_DEFER` (299), `FK_DEFER_F` (74),
`STANDARD_TYPE`, `FORGE_*`, `M_PI`, `DEFINE_STANDARD_ALLOC`. No producer.

## Composition

```
engine                     PRODUCES  checks  adapts  spells  declines
NativeLoftPipe.cpp               23       3      43     477       294
NativeThickenShell.cpp            9       7      47     399         -
NativeDraftAngle.cpp              6       0       4     121         -
NativeAabbBridge.cpp              0       0       0       6         -
NativeDraft.cpp                   0       0      12      67         -
NativeDraftLocal.cpp              0       2       3     254         -
NativeFilletChamfer.cpp           0       6      49     430         -
NativeFilling.cpp                 0       0       2      22         -
NativeRoute.cpp                   0       0       0       0         -
NativeSectionFill.cpp             0       0       0      51         -
NativeShapeHeal.cpp               0       0       6     103         -
NativeShapeHealBridge.cpp         0       0       0       4         -
NativeThickSolid.cpp              0       7      58     568        79
NativeVariableFillet.cpp          0       0      23     153         -
NativeWireFill.cpp                0       0       2      19         -
```

**OCCT never produces the answer in 12 of the 15 engines.** The open question is
answered, and answered in the *opposite* direction to the ledger's reading: these
are native computations with an OCCT adapter at the end, exactly as the tracker
framed them. The two largest engines — `NativeThickSolid.cpp` (4,105 lines) and
`NativeFilletChamfer.cpp` (2,665) — call **zero** producing classes. Their 568
and 430 OCCT references are `gp_Pnt`, `TopoDS_Face` and friends.

Three engines do delegate, all through booleans and `ShapeUpgrade_UnifySameDomain`:
`NativeLoftPipe` (23), `NativeThickenShell` (9), `NativeDraftAngle` (6).

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
themselves.** `FK_DEFER(label)` expands to *record a reason, return null* — the
native arm declining an input it was not written for, after which the caller uses
OCCT. `NativeLoftPipe.cpp` has **294** such sites and `NativeThickSolid.cpp`
**79**. The macro's own comment states the consequence outright:

> the corpus A/B measured this engine covering **2 of 600 PIPE inputs**

So a native engine is not OCCT-flavoured code wearing a native name. It is
genuinely native code that **only covers the cases it was written for** and hands
everything else back. Purity of composition is close to a measure of how narrow
that set is.

## What to do with this

1. **Stop reasoning about these engines by composition.** The 14:1 figure is an
   artefact of counting representation. Reason by coverage, which is already
   measured per family in `CORPUS_AB_COVERAGE.md` and re-derivable per engine
   from the decline counts above.
2. **`FK_DEFER` is the right instrument and only two engines have it.** The
   thirteen others decline without saying why, which is precisely the condition
   the macro was introduced to fix — "a bare null shape says nothing about WHICH
   precondition declined, which made the largest deletion bucket in the whole
   drop plan unattributable."
3. T-135's strategic conclusion is unchanged and still governs: converting a
   `Native*` engine to return native types **does not move `OCCT_CLOSURE`** —
   best single engine 16 of 550 exclusive symbols (2.9%), seven of fifteen worth
   zero, all fifteen together 48 of 550 (8.7%). This report changes *why* the
   composition argument fails, not the plan it was being used to justify.
