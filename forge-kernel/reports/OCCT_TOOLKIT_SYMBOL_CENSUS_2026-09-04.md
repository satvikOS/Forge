# OCCT per-toolkit called-symbol census — ONE pinned binary, 2026-09-04

**Why this exists.** Two earlier censuses disagreed (TKTopAlgo 110 vs 106, TKMath 32 vs 31),
and a ceiling must never be set from a contested number. This is a single measurement from a
single binary, reproducible from the commands at the bottom.

**Subject.** `forge-kernel.node`, 9,425,344 bytes, built by the CI job on PR #232
(`ci/wire-ledger-gate`), preserved before its worktree was reaped.

**Method.** Undefined symbols of the binary (`nm -u -j`) intersected with the exported
symbols (`nm -g -j -U`) of each of the 14 OCCT closure toolkits as installed at
`/opt/homebrew/opt/opencascade/lib` (201 toolkits present; 14 in this closure).

## Result

| toolkit | symbols called | uniquely attributed |
|---|---:|---:|
| TKernel | 27 | 27 |
| TKMath | 32 | 32 |
| TKG2d | 27 | 27 |
| TKG3d | 147 | 147 |
| TKGeomBase | 0 | 0 |
| TKBRep | 101 | 101 |
| TKGeomAlgo | 0 | 0 |
| TKTopAlgo | 110 | 110 |
| TKPrim | 0 | 0 |
| TKShHealing | 12 | 12 |
| TKBO | 32 | 32 |
| TKBool | 0 | 0 |
| TKFillet | 11 | 11 |
| TKOffset | 42 | 42 |
| **distinct total** | **541** | **541** |

★**Every symbol this binary calls is exported by EXACTLY ONE of the fourteen.** `called` and
`uniquely attributed` are equal on every row, and the rows sum to the distinct total
(541 = 541). There is no double-counting anywhere in this table, so
no attribution judgement was required and none was made.

## What it settles

- **TKTopAlgo = 110**, not 106. **TKMath = 32**, not 31.
- **TKBO = 32** — this CORRECTS the figure of 59 carried in the
  running notes, which came from a different arm and was never re-measured on one binary.
- **Four pure free riders confirmed at ZERO called symbols**: TKGeomBase, TKGeomAlgo, TKPrim,
  TKBool. They are in the closure only because `libTKOffset` DT_NEEDs them.
- **The bottom six hold 444 of 541** (TKernel 27 + TKMath 32 + TKG2d 27 + TKG3d 147 +
  TKBRep 101 + TKTopAlgo 110 = 444), confirming the architecture-floor arithmetic exactly.
- **DIRECT = 9**, as ledgered: TKBRep TKernel TKFillet TKG3d TKMath TKOffset TKPrim TKShHealing TKTopAlgo.

## The pair {TKOffset, TKFillet} is 53 symbols and TWELVE classes

The only unit that moves CLOSURE (14 -> 11) reduces to twelve OCCT classes:

| class | symbols | A/B family |
|---|---:|---|
| BRepOffsetAPI_MakePipeShell | 7 | PIPESHELL |
| BRepOffsetAPI_ThruSections | 6 | THRUSECTIONS |
| BRepOffsetAPI_DraftAngle | 6 | DRAFT |
| BRepOffset_MakeOffset | 5 | (internal) |
| BRepOffsetAPI_MakeFilling | 5 | FILLING |
| BRepFilletAPI_MakeFillet | 5 | FILLET |
| BRepFilletAPI_MakeChamfer | 5 | **NONE** |
| BRepOffsetAPI_MakeThickSolid | 3 | THICKSOLID |
| BRepOffsetAPI_MakeOffset | 4 | MAKEOFFSET |
| BRepOffsetAPI_MakePipe | 3 | PIPE |
| BRepOffsetAPI_MakeOffsetShape | 3 | OFFSETSHAPE |
| ChFi3d_Builder | 1 | (internal) |

★**Nine of the twelve are exactly the families the current programme is working**, which is
independent evidence that the effort is aimed at the right unit. ★**One is not covered at all.**

## The finding: the FILLET seam drops two classes and the gate measures one

`FORGE_FILLET_DROP_NATIVE` guards BOTH `BRepFilletAPI_MakeFillet` AND
`BRepFilletAPI_MakeChamfer` — the includes at `src/Features.cpp:70-76` and the chamfer paths
at `:2040-2147` are under the same macro, correctly, because both classes live in TKFillet.
The corpus A/B harness includes only `BRepFilletAPI_MakeFillet.hxx`
(`test/corpus_ab_coverage.cpp:179`) and its family list has ten entries, none of them CHAMFER.

**So the seam that would drop TKFillet is measured on half of what it drops.** TKFillet's 11
symbols are MakeFillet 5 + MakeChamfer 5 + ChFi3d_Builder 1: even a perfect FILLET result
cannot justify dropping TKFillet, because chamfer's corpus-scale behaviour has never been
measured. This is the same shape as the defect where a status label absorbed the endpoint
beside it — two quantities treated as one.

★**It is NOT a missing seam and NOT a missing implementation.**
`src/native/brep/NativeFilletChamfer.cpp` (118 KB, "ROUTINE R3 of the OCCT-zero drop plan")
already re-implements both classes with no BRepFilletAPI/ChFi3d symbol, and the native chamfer
path REFUSES on decline rather than faking (`Features.cpp:2047`). The gap is measurement only:
an eleventh A/B family, CHAMFER, built the way the other ten are.

## Reproduce

```sh
nm -u -j forge-kernel.node | sed 's/^_//' | sort -u > undef.txt
for t in TKernel TKMath TKG2d TKG3d TKGeomBase TKBRep TKGeomAlgo TKTopAlgo \
         TKPrim TKShHealing TKBO TKBool TKFillet TKOffset; do
  nm -g -j -U /opt/homebrew/opt/opencascade/lib/lib$t.dylib | sed 's/^_//' | sort -u > exp_$t.txt
  echo "$t $(comm -12 undef.txt exp_$t.txt | wc -l)"
done
```
