# The toolkit elimination map — what must land before each OCCT library stops loading

**Measured 2026-08-30** on a worktree pinned to `origin/claude/sacrosanct-execution-20260828`
at **`480ec573`**, from two binaries built in that tree. Every number below comes from
`otool`/`nm` on built artefacts. Nothing is inferred from source, and nothing is copied from
an earlier report — where this file agrees with `OCCT_CLOSURE_TRUTH.md` it is an independent
replication, and where it disagrees it says so.

## 0. Why this document exists

Ten agents are each driving one family toward parity. That is necessary and **not sufficient**,
because the ledger is a *closure*: a toolkit keeps loading while **any** live call site needs it,
directly or through another toolkit. Dropping one family provably moves `OCCT_CLOSURE` by zero.

This map converts ten independent family numbers into one ordered elimination plan by answering,
per toolkit: *who pulls you, what calls you, and what has to land before you leave?*

## 1. Measured baseline

Default build (every drop option at its committed default):

```
OCCT_DIRECT  = 9    TKBRep TKernel TKFillet TKG3d TKMath TKOffset TKPrim TKShHealing TKTopAlgo
OCCT_CLOSURE = 14   ★ the ledger number
OCCT_PHANTOM = 2    TKBO (32 symbols) · TKG2d (24 symbols) — called with no link record
```

Reproduce:

```
npm run forge:kernel                                   # default build
bash forge-kernel/scripts/occt_closure_count.sh        # the authority
```

`scripts/occt_closure_count.sh` is the authority and was reused, not replaced. The per-TU
attribution below is new work layered on top of it.

### 1.1 Two corrections to the brief this work was given

Both were measured, and both change the plan.

**(a) The hidden set is not what the brief states.** The brief lists the hidden set as
*TKBool, TKGeomAlgo, TKGeomBase, TKPrim*. As measured today it is:

```
hidden (in closure, no link record):  TKBO  TKBool  TKG2d  TKGeomAlgo  TKGeomBase
```

**TKPrim is not hidden — it holds a DIRECT link record** (`CMakeLists.txt:418`, appended
unconditionally whenever `FORGE_NATIVE_BREP` is ON, which is the default). **TKG2d is hidden**
and is one of the two phantoms. Anyone planning around the brief's list would be planning
around the wrong two libraries.

**(b) TKFillet is not the cheapest next drop — it is worth exactly zero today.**
`libTKOffset` `DT_NEED`s `libTKFillet` (measured, §2). While TKOffset is linked, removing
TKFillet's link record changes nothing about what loads. Measured over every single-record
removal, **TKOffset is the only one worth a closure point**:

| remove this DIRECT record | closure | actually leaves |
|---|---|---|
| TKBRep · TKernel · TKFillet · TKG3d · TKMath · TKPrim · TKShHealing · TKTopAlgo | 14 → **14** | nothing |
| **TKOffset** | 14 → **13** | TKOffset |

Dropping TKFillet the way CMake actually does it is worse than neutral on the reported number:
`CMakeLists.txt:398` appends `TKBO` and `TKG2d` in that branch, so `OCCT_DIRECT` rises while
`OCCT_CLOSURE` stays 14.

## 2. The dependency graph (measured, `otool -l` on the OCCT dylibs)

Who `DT_NEED`s each toolkit — this is what forces the order:

| toolkit | pulled into the process by |
|---|---|
| **TKOffset** | **nothing — only the .node** |
| TKFillet | TKOffset |
| TKBool | TKFillet TKOffset |
| TKBO | TKBool TKFillet TKOffset |
| TKPrim | TKBO TKBool TKFillet TKOffset |
| TKShHealing | TKBO TKBool TKFillet TKOffset |
| TKTopAlgo | TKBO TKBool TKFillet TKOffset TKPrim TKShHealing |
| TKGeomAlgo | TKBO TKBool TKFillet TKOffset TKPrim TKShHealing TKTopAlgo |
| TKBRep | TKBO TKBool TKFillet TKGeomAlgo TKOffset TKPrim TKShHealing TKTopAlgo |
| TKGeomBase | TKBO TKBool TKBRep TKFillet TKGeomAlgo TKOffset TKPrim TKShHealing |
| TKG3d | TKBO TKBool TKBRep TKFillet TKGeomAlgo TKGeomBase TKOffset TKPrim TKShHealing TKTopAlgo |
| TKG2d | 11 parents |
| TKMath | 12 parents |
| TKernel | all 13 others |

**The graph is a chain, not a tree.** Exactly one toolkit (TKOffset) is parent-free at any
time. There is no parallel path to zero: the closure can only fall from the top.

## 3. The elimination ladder

A toolkit leaves the closure iff **both** hold:

* **(a)** no translation unit references an exclusive symbol of it → its link record can go;
* **(b)** no toolkit still in the closure `DT_NEED`s it → nothing pulls it back.

(b) is pure topology and is what serialises the work. Each wave below becomes available only
once the wave above it has landed.

| wave | toolkit | closure | own work remaining | gated by families |
|---:|---|---:|---|---|
| 1 | **TKOffset** | 14 → 13 | 42 symbols · 7 files | **A C D E F G H I J — all nine** |
| 2 | **TKFillet** | 13 → 12 | 11 symbols · 2 files | **B** (`FORGE_FILLET_DROP_NATIVE`) |
| 3 | TKBool | 12 → 11 | **none — falls for free** | — |
| 4 | TKBO | 11 → 10 | 32 symbols · 14 files | **no family exists** |
| 5 | TKPrim + TKShHealing | 10 → 8 | TKPrim **free**; TKShHealing 12 · 7 files | **no family exists** |
| 6 | TKTopAlgo | 8 → 7 | 99 symbols · 42 files | no family exists |
| 7 | TKGeomAlgo | 7 → 6 | **none — falls for free** | — |
| 8 | TKBRep | 6 → 5 | 83 symbols · 34 files | no family exists |
| 9 | TKGeomBase | 5 → 4 | **none — falls for free** | — |
| 10 | TKG3d | 4 → 3 | 141 symbols · 33 files | no family exists |
| 11 | TKG2d | 3 → 2 | 24 symbols · 3 files | no family exists |
| 12 | TKMath | 2 → 1 | 27 symbols · 42 files | no family exists |
| 13 | TKernel | 1 → 0 | 26 symbols · 46 files | no family exists |

**497 exclusive symbols remain across the ten toolkits that have live call sites.**

### 3.1 The single most important consequence

**Only two of the thirteen waves are covered by a drop option at all.** Waves 1 and 2 are the
entire reach of the current family programme; from wave 4 on there is no flag, no A/B harness,
and no corpus number — TKBO's 32 symbols across 14 files have never been measured by the
coverage harness because no option exists to measure them against.

The ten family numbers in flight therefore buy **waves 1, 2 and 3**: closure **14 → 11**,
with wave 3 (TKBool) falling free.

★ CORRECTED 2026-08-31, BY BUILDING IT. This paragraph and §7.4 both used to say the ceiling
was **12**, which contradicted this document's own wave table (row 3 reads `TKBool | 12 → 11 |
none — falls for free`) and its own ladder in §3. The build settles it — three configurations,
`occt_closure_count.sh` on each, measured from a detached worktree pinned to origin/archdisc:

    default (committed defaults)       DIRECT=9  CLOSURE=14  PHANTOM=2
    nine TKOffset families, FILLET off DIRECT=8  CLOSURE=13  PHANTOM=2  (only TKOffset leaves)
    all twelve drop options ON         DIRECT=9  CLOSURE=11  PHANTOM=0  (TKOffset, TKFillet, TKBool)

THREE toolkits leave, not two. `DIRECT` climbs back 8 → 9 in the all-twelve arm because
CMakeLists.txt:415 appends TKBO+TKG2d in the FILLET branch — which is also why PHANTOM falls
2 → 0. PHANTOM did not RISE, so nothing reaches TKOffset under `-undefined dynamic_lookup`.

The arms were proved to differ rather than assumed: `cmp` reports baseline 9,010,272 B vs
all-twelve 8,917,888 B; the all-twelve configure log prints `★ TKOffset REMOVED FROM
OCCT_LIBS`; and re-running the default configuration reproduced a byte-identical baseline
binary. All twelve options were confirmed to exist in that tree (`option(NAME` = 1 each) AND
re-read back out of `CMakeCache.txt` as `got=ON` — because CMake accepts an unknown `-D`
silently, so a wrong flag name is otherwise invisible.

The ceiling of **11** is structural, not engine-dependent: wave 4 is TKBO, which has no drop
option, no family and no harness. Engine work moves the REACHABILITY of 11 without deleting
capability; it does not move the number.

## 4. Minimal family set per toolkit

Because the graph is a chain, each toolkit's requirement is *cumulative* — it inherits every
requirement above it. "Minimal set" below means the complete set that must **all** hold.

| toolkit | minimal set that must ALL land |
|---|---|
| **TKOffset** | families **A, C, D, E, F, G, H, I, J** |
| **TKFillet** | the above **+ family B** |
| TKBool | the above (no work of its own) |
| TKBO | the above **+ a native boolean/defeaturing engine** (no family exists) |
| TKPrim | the above (no work of its own) |
| TKShHealing | the above **+ native ShapeFix/ShapeUpgrade/ShapeAnalysis** (no family exists) |
| TKTopAlgo | the above + 99 symbols of native topology (no family) |
| TKGeomAlgo | the above (no work of its own) |
| TKBRep | the above + replacing `TopoDS_Shape` as the interchange type |
| TKGeomBase | the above (no work of its own) |
| TKG3d | the above + replacing `Handle(Geom_*)` |
| TKG2d | the above + a native 2-D pcurve type |
| TKMath | the above + `gp_*`/`Bnd_*` replacements |
| TKernel | the above + `Standard_*`/`NCollection`/`Message_*` |

The nine TKOffset families are confirmed **exhaustive and non-redundant** by measurement: the
13 (file, class) call-site pairs in §7 map one-to-one onto A,C,D,E,F,G,H,I,J with no residue,
and every one is `#ifdef`-guarded in `src/` (census: 45 guard directives).

## 5. Toolkits pulled ONLY transitively — these fall for free

**Four toolkits have zero exclusive symbols referenced by any translation unit.** No native
work will ever remove them; they leave exactly when their parents do. Scheduling work against
any of them is wasted effort.

| toolkit | link record | exclusive symbols used | leaves at |
|---|---|---:|---|
| **TKBool** | hidden | **0** | wave 3, with TKFillet |
| **TKPrim** | **DIRECT** | **0** | wave 5, with TKBO |
| **TKGeomAlgo** | hidden | **0** | wave 7, with TKTopAlgo |
| **TKGeomBase** | hidden | **0** | wave 9, with TKBRep |

### 5.1 TKPrim is a dead link record — and it is still worth zero closure

TKPrim is the interesting one: it holds a DIRECT link record but the binary needs **not one**
of its exports.

```
$ bash forge-kernel/scripts/occt_drop_gate.sh TKPrim
  TKPrim exports needed by .node: 0
  ...of those, EXCLUSIVE to TKPrim (block the drop): 0
  VERDICT: DROP-SAFE (local)
```

The 2026-07-21 K-PRIM drop genuinely retired every TKPrim call site; the record at
`CMakeLists.txt:418` was then re-added unconditionally under `FORGE_NATIVE_BREP` and now
names a library nothing calls.

Removing it takes `OCCT_DIRECT` 9 → 8 at zero code cost. **It leaves `OCCT_CLOSURE` at 14**,
because TKBO/TKBool/TKFillet/TKOffset all `DT_NEED` TKPrim. It should be done as an *honesty*
fix — the same class of fix as naming TKBO and TKG2d on the link line to clear the two
phantoms — and must never be scored as a drop.

## 6. The cheapest next toolkit

**TKOffset. It is not merely the cheapest — it is the only toolkit that can leave at all today**,
being the unique parent-free node (§2).

### 6.1 Verified end to end, both arms proved different

| | OCCT_DIRECT | OCCT_CLOSURE | OCCT_PHANTOM | TKOffset symbols | size |
|---|---:|---:|---:|---:|---:|
| default build | 9 | **14** | 2 | **42** | 8,938,752 |
| all nine families ON | 8 | **13** | 2 | **0** | 8,852,000 |

`cmp` reports the binaries differ; the variant's configure log prints
`★ TKOffset REMOVED FROM OCCT_LIBS`. `OCCT_PHANTOM` did **not** rise (2 → 2), which is the
check that matters — a phantom would mean a TU still calls TKOffset and macOS
`-undefined dynamic_lookup` was masking it. It does not.

### 6.2 Wave 2 is confirmed empirically, not just predicted

Running the map against the **variant** binary is a positive control on the whole model — and
it passes. With TKOffset gone, `TKFillet`'s parent list becomes `(NOTHING)` and the ladder
re-roots on it exactly as §3 predicts:

```
$ FORGE_KERNEL=build-tkoff/Release/forge-kernel.node python3 scripts/occt_toolkit_map.py
   OCCT_DIRECT=8 · OCCT_CLOSURE=13
   TKFillet     DIRECT   11 symbols   2 files   (NOTHING)
   wave 1   closure 13 -> 12   TKFillet
   wave 2   closure 12 -> 11   TKBool [free]
```

The tool reads the objects of whichever build tree the binary came from, so the two arms are
independently attributed (TKBRep 83 → 82 symbols, TKG3d 33 → 31 files). This is what makes the
ladder a measurement rather than a model.

### 6.3 What must land — and the one thing blocking it

All nine families, with their measured corpus coverage (600 parts, paired):

| family | option | native% | OCCT% | gap |
|---|---|---:|---:|---|
| C | `FORGE_FILLING_DROP_NATIVE` | 67.8 | 67.8 | **PASS — 0 parts deleted** |
| I | `FORGE_THICKEN_DROP_NATIVE` | 96.2 | 100.0 | close |
| A | `FORGE_OFFSET_DROP_MAKEOFFSET` | 94.5 | 99.0 | 27 parts |
| F | `FORGE_PIPESHELL_DROP_NATIVE` | 51.5 | 100.0 | disagreement resolved; coverage open |
| D | `FORGE_THRUSECTIONS_DROP_NATIVE` | 51.5 | 94.5 | open |
| E | `FORGE_PIPE_DROP_NATIVE` | 41.5 | 100.0 | open |
| G | `FORGE_THICKSOLID_DROP_NATIVE` | 1.2 | 22.2 | open |
| H | `FORGE_OFFSETSHAPE_DROP_NATIVE` | 1.2 | 6.3 | open (OCCT itself crashes on 66/600) |
| **J** | **`FORGE_DRAFT_DROP_NATIVE`** | **0.0** | **88.0** | ★ **no bounded fix exists** |

**The whole ladder is blocked on family J.** DRAFT is measured at 0.0% native against 88.0%
OCCT, and the standing measured result is that *no bounded fix exists* — no part fails exactly
one guard. Because TKOffset requires **all nine** families and TKOffset is the only parent-free
node, **family J alone gates all thirteen waves.**

Turning J on regardless is mechanically sufficient (that is how the 13 above was produced) but
it deletes 88% of draft capability, which is capability deletion, not a drop. This map does not
recommend it.

**So the cheapest next toolkit is TKOffset, and the single highest-value piece of work in the
whole programme is a native draft angle.** It is worth restating what that unlocks: J is not
one family among ten — it is the gate on 14 → 12 and on every wave after.

## 7. Per-toolkit call sites

**Method, and what each column is worth.** Two stages with different evidential status:

1. **Attribution — measured, `nm`.** For all 426 object files in
   `build/CMakeFiles/forge_kernel.dir/`, `nm -u` (undefined symbols) is intersected with
   `nm -gU` (exports) of each of the 14 closure dylibs. A TU pulls toolkit TKX iff it
   references a symbol **only** TKX exports among the 14 — the same exclusivity rule
   `scripts/occt_drop_gate.sh` uses. This is the load-bearing claim.
2. **Location — `grep`.** The owning class is read out of the Itanium mangling
   (`<length><name>`, first component = the nested-name qualifier; later components are
   parameter types and are discarded), then located in the TU by name.

Where stage 2 finds no line — the symbol is emitted from a header or template, or the class is
reached through a typedef — the row says **UNDETERMINED** rather than guessing a line.
Line lists are every occurrence of the class in the file, not only the constructing call.

### TKOffset — 42 exclusive symbols used, 7 files · DIRECT link record

Pulled into the process by: **nothing — only the .node**


| file | OCCT class | syms | line(s) | family gate |
|---|---|---:|---|---|
| `src/Features.cpp` | `BRepOffsetAPI_DraftAngle` | 6 | 79,2092,2111,2208,2225 | J · `FORGE_DRAFT_DROP_NATIVE` |
| `src/Features.cpp` | `BRepOffsetAPI_MakePipeShell` | 6 | 730,744,2743,2762 | F · `FORGE_PIPESHELL_DROP_NATIVE` |
| `src/Features.cpp` | `BRepOffsetAPI_ThruSections` | 5 | 936,986,1007,1021,2769,2808,2823 | D · `FORGE_THRUSECTIONS_DROP_NATIVE` |
| `src/Features.cpp` | `BRepOffset_MakeOffset` | 5 | 1203,1219,1230,1255 | I · `FORGE_THICKEN_DROP_NATIVE` |
| `src/Features.cpp` | `BRepOffsetAPI_MakeOffsetShape` | 3 | 1267,1331,1354,1361 | H · `FORGE_OFFSETSHAPE_DROP_NATIVE` |
| `src/Features.cpp` | `BRepOffsetAPI_MakePipe` | 3 | 85,700,709,802,811,911,920 | E · `FORGE_PIPE_DROP_NATIVE` |
| `src/Features.cpp` | `BRepOffsetAPI_MakeThickSolid` | 3 | 1104,1122,1134,2920,2924,2968 | G · `FORGE_THICKSOLID_DROP_NATIVE` |
| `src/ClassASurfacing.cpp` | `BRepOffsetAPI_MakePipeShell` | 7 | 20,54,730,755 | F · `FORGE_PIPESHELL_DROP_NATIVE` |
| `src/Healing.cpp` | `BRepOffsetAPI_MakeFilling` | 5 | 26,91,478 | C · `FORGE_FILLING_DROP_NATIVE` |
| `src/LoftGuide.cpp` | `BRepOffsetAPI_ThruSections` | 5 | 1,26,29,34,105,218,221,265 | D · `FORGE_THRUSECTIONS_DROP_NATIVE` |
| `src/Primitives.cpp` | `BRepOffsetAPI_ThruSections` | 5 | 202,213 | D · `FORGE_THRUSECTIONS_DROP_NATIVE` |
| `src/Airfoil.cpp` | `BRepOffsetAPI_ThruSections` | 4 | 44,47,52,541,593,702,715 | D · `FORGE_THRUSECTIONS_DROP_NATIVE` |
| `src/Cam.cpp` | `BRepOffsetAPI_MakeOffset` | 4 | 13,30,69,76,148,199,326,332,367 | A · `FORGE_OFFSET_DROP_MAKEOFFSET` |

### TKFillet — 11 exclusive symbols used, 2 files · DIRECT link record

Pulled into the process by: TKOffset


| file | OCCT class | syms | line(s) | family gate |
|---|---|---:|---|---|
| `src/Features.cpp` | `BRepFilletAPI_MakeChamfer` | 5 | 1870,1906,1964,1971,2009,2023,2034,2038,2071 | B · `FORGE_FILLET_DROP_NATIVE` |
| `src/Features.cpp` | `BRepFilletAPI_MakeFillet` | 5 | 306,1690,1733,1779,1822 | B · `FORGE_FILLET_DROP_NATIVE` |
| `src/Features.cpp` | `ChFi3d_Builder` | 1 | 1622,1652 | B · `FORGE_FILLET_DROP_NATIVE` |
| `src/VarFillet.cpp` | `BRepFilletAPI_MakeFillet` | 4 | 3,40,258,303,305,333,375 | B · `FORGE_FILLET_DROP_NATIVE` |
| `src/VarFillet.cpp` | `ChFi3d_Builder` | 1 | **UNDETERMINED** | B · `FORGE_FILLET_DROP_NATIVE` |

### TKBool — 0 exclusive symbols used, 0 files · hidden (no link record)

Pulled into the process by: TKFillet TKOffset


**No translation unit references any exclusive TKBool symbol.** It is in the closure purely because its parents are.


### TKBO — 32 exclusive symbols used, 14 files · hidden (no link record)

Pulled into the process by: TKBool TKFillet TKOffset


| file | OCCT class | syms | line(s) | family gate |
|---|---|---:|---|---|
| `src/DirectEdit.cpp` | `BRepAlgoAPI_Cut` | 2 | 388,438,445 | — none — |
| `src/DirectEdit.cpp` | `BRepAlgoAPI_Defeaturing` | 2 | 349 | — none — |
| `src/DirectEdit.cpp` | `BRepAlgoAPI_Fuse` | 2 | 382,451 | — none — |
| `src/DirectEdit.cpp` | `BOPAlgo_Algo` | 7 | **UNDETERMINED** | — none — |
| `src/DirectEdit.cpp` | `BOPAlgo_RemoveFeatures` | 1 | **UNDETERMINED** | — none — |
| `src/DirectEdit.cpp` | `BRepAlgoAPI_Algo` | 3 | **UNDETERMINED** | — none — |
| `src/DirectEdit.cpp` | `BRepAlgoAPI_BooleanOperation` | 1 | **UNDETERMINED** | — none — |
| `src/BooleanTol.cpp` | `BRepAlgoAPI_Common` | 2 | 229 | — none — |
| `src/BooleanTol.cpp` | `BRepAlgoAPI_Cut` | 2 | 225 | — none — |
| `src/BooleanTol.cpp` | `BRepAlgoAPI_Fuse` | 2 | 221 | — none — |
| `src/BooleanTol.cpp` | `BOPAlgo_Options` | 1 | 205 | — none — |
| `src/BooleanTol.cpp` | `BRepAlgoAPI_BooleanOperation` | 1 | 12 | — none — |
| `src/BooleanTol.cpp` | `BRepAlgoAPI_Algo` | 1 | **UNDETERMINED** | — none — |
| `src/Mold.cpp` | `BRepAlgoAPI_Splitter` | 3 | 280,312,320 | — none — |
| `src/Mold.cpp` | `BRepAlgoAPI_Cut` | 2 | 342,346,390,394 | — none — |
| `src/Mold.cpp` | `BRepAlgoAPI_Algo` | 1 | **UNDETERMINED** | — none — |
| `src/Mold.cpp` | `BRepAlgoAPI_BooleanOperation` | 1 | **UNDETERMINED** | — none — |
| `src/Mold.cpp` | `BRepAlgoAPI_BuilderAlgo` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeLoftPipe.cpp` | `BRepAlgoAPI_Common` | 2 | 863,973,1200 | — none — |
| `src/native/brep/NativeLoftPipe.cpp` | `BRepAlgoAPI_Cut` | 2 | 1226 | — none — |
| `src/native/brep/NativeLoftPipe.cpp` | `BRepAlgoAPI_Fuse` | 2 | 982,1210 | — none — |
| `src/native/brep/NativeLoftPipe.cpp` | `BRepAlgoAPI_Algo` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeLoftPipe.cpp` | `BRepAlgoAPI_BooleanOperation` | 1 | **UNDETERMINED** | — none — |
| `src/DirectModeling.cpp` | `BRepAlgoAPI_Cut` | 2 | 509 | — none — |
| `src/DirectModeling.cpp` | `BRepAlgoAPI_Fuse` | 2 | 66,498,564,620 | — none — |
| `src/DirectModeling.cpp` | `BRepAlgoAPI_Algo` | 1 | **UNDETERMINED** | — none — |
| `src/DirectModeling.cpp` | `BRepAlgoAPI_BooleanOperation` | 1 | **UNDETERMINED** | — none — |
| `src/Drawings.cpp` | `BRepAlgoAPI_Section` | 5 | 62,793,806,1150 | — none — |
| `src/Drawings.cpp` | `BRepAlgoAPI_Algo` | 1 | **UNDETERMINED** | — none — |
| `src/Features.cpp` | `BRepAlgoAPI_Cut` | 2 | 2327,2344,2367 | — none — |
| `src/Features.cpp` | `BRepAlgoAPI_Fuse` | 2 | 2497,2547,2599,2695,2974 | — none — |
| `src/Features.cpp` | `BRepAlgoAPI_Algo` | 1 | **UNDETERMINED** | — none — |
| `src/Features.cpp` | `BRepAlgoAPI_BooleanOperation` | 1 | **UNDETERMINED** | — none — |
| `src/Nurbs.cpp` | `BRepAlgoAPI_Section` | 5 | 20,135,321,683,689 | — none — |
| `src/Nurbs.cpp` | `BRepAlgoAPI_Algo` | 1 | **UNDETERMINED** | — none — |

<details><summary>remaining 6 files (symbol counts only)</summary>


`src/SheetMetalExtended.cpp (6)`, `src/native/brep/NativeThickenShell.cpp (5)`, `src/InterferenceDetection.cpp (4)`, `src/SheetMetal.cpp (4)`, `src/Weldments.cpp (4)`, `src/Booleans.cpp (3)`


</details>


### TKPrim — 0 exclusive symbols used, 0 files · DIRECT link record

Pulled into the process by: TKBO TKBool TKFillet TKOffset


**No translation unit references any exclusive TKPrim symbol.** It is in the closure purely because its parents are.


### TKShHealing — 12 exclusive symbols used, 7 files · DIRECT link record

Pulled into the process by: TKBO TKBool TKFillet TKOffset


| file | OCCT class | syms | line(s) | family gate |
|---|---|---:|---|---|
| `src/DirectEdit.cpp` | `ShapeFix_Shape` | 4 | 74,75,82 | — none — |
| `src/DirectEdit.cpp` | `ShapeUpgrade_UnifySameDomain` | 3 | 98,176,206,223,236,251,259 | — none — |
| `src/DirectEdit.cpp` | `ShapeFix_Root` | 1 | **UNDETERMINED** | — none — |
| `src/Healing.cpp` | `ShapeFix_Shape` | 4 | 41,72,73,103,564,572,593 | — none — |
| `src/Healing.cpp` | `ShapeUpgrade_UnifySameDomain` | 3 | 41,87,89,416 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `ShapeFix_Shape` | 3 | 1683 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `ShapeAnalysis_Surface` | 2 | 1238 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `ShapeAnalysis_Curve` | 1 | 968 | — none — |
| `src/ShapeFix.cpp` | `ShapeFix_Shape` | 4 | 1,3,18,22,33,50,257,295,307 | — none — |
| `src/DirectModeling.cpp` | `ShapeFix_Shape` | 3 | 66,520,525,577,630,733 | — none — |
| `src/native/brep/NativeLoftPipe.cpp` | `ShapeUpgrade_UnifySameDomain` | 3 | 994,1235 | — none — |
| `src/native/brep/NativeThickenShell.cpp` | `ShapeUpgrade_UnifySameDomain` | 3 | 501 | — none — |

### TKTopAlgo — 99 exclusive symbols used, 42 files · DIRECT link record

Pulled into the process by: TKBO TKBool TKFillet TKOffset TKPrim TKShHealing


| file | OCCT class | syms | line(s) | family gate |
|---|---|---:|---|---|
| `src/NativeOcctBridge.cpp` | `BRepBuilderAPI_MakeEdge` | 7 | 197,419,994,1134,1187 | — none — |
| `src/NativeOcctBridge.cpp` | `BRepBuilderAPI_MakeFace` | 7 | 93,157,440,483,528,1040,1051,1230 | — none — |
| `src/NativeOcctBridge.cpp` | `BRepBuilderAPI_MakePolygon` | 6 | 77,89,424 | — none — |
| `src/NativeOcctBridge.cpp` | `BRepBuilderAPI_MakeWire` | 6 | 421,1136,1178 | — none — |
| `src/NativeOcctBridge.cpp` | `BRepBuilderAPI_Sewing` | 5 | 78,85,645,1372 | — none — |
| `src/NativeOcctBridge.cpp` | `BRepBuilderAPI_MakeVertex` | 2 | 177 | — none — |
| `src/NativeOcctBridge.cpp` | `TopoDS_Shape` | 2 | 83,84,98,101,102,111,166,169,282,324,+61 more | — none — |
| `src/NativeOcctBridge.cpp` | `BRepBuilderAPI_Command` | 2 | **UNDETERMINED** | — none — |
| `src/NativeOcctBridge.cpp` | `BRepBuilderAPI_MakeShape` | 7 | **UNDETERMINED** | — none — |
| `src/NativeOcctBridge.cpp` | `BRepLib_Command` | 1 | **UNDETERMINED** | — none — |
| `src/NativeOcctBridge.cpp` | `BRepLib_MakeShape` | 8 | **UNDETERMINED** | — none — |
| `src/native/brep/StepReadOcct.cpp` | `BRepBuilderAPI_MakeFace` | 6 | 1637,1652 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `BRepBuilderAPI_MakeSolid` | 5 | 1734 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `BRepBuilderAPI_Sewing` | 5 | 1728 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `BRepBuilderAPI_MakeEdge` | 4 | 979,995,1007 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `BRepBuilderAPI_MakeWire` | 4 | 1153 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `TopoDS_Shape` | 3 | 1513,1668,1687,1710,1731,1741 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `BRepBuilderAPI_MakeVertex` | 2 | 949 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `BRepBuilderAPI_Command` | 2 | **UNDETERMINED** | — none — |
| `src/native/brep/StepReadOcct.cpp` | `BRepBuilderAPI_MakeShape` | 7 | **UNDETERMINED** | — none — |
| `src/native/brep/StepReadOcct.cpp` | `BRepLib_Command` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/StepReadOcct.cpp` | `BRepLib_MakeShape` | 8 | **UNDETERMINED** | — none — |
| `src/native/brep/StepReadOcct.cpp` | `BRepLib_MakeSolid` | 1 | **UNDETERMINED** | — none — |
| `src/OcctPrimBuilder.cpp` | `BRepBuilderAPI_MakeFace` | 7 | 117,129,144,163,197,226,422,447 | — none — |
| `src/OcctPrimBuilder.cpp` | `BRepBuilderAPI_Sewing` | 5 | 83,291 | — none — |
| `src/OcctPrimBuilder.cpp` | `BRepBuilderAPI_MakePolygon` | 4 | 224 | — none — |
| `src/OcctPrimBuilder.cpp` | `TopoDS_Shape` | 4 | 89,297,498,542 | — none — |
| `src/OcctPrimBuilder.cpp` | `BRepBuilderAPI_MakeEdge` | 3 | 114 | — none — |
| `src/OcctPrimBuilder.cpp` | `BRepBuilderAPI_MakeWire` | 3 | 115 | — none — |
| `src/OcctPrimBuilder.cpp` | `BRepBuilderAPI_Transform` | 2 | 478,562 | — none — |
| `src/OcctPrimBuilder.cpp` | `TopoDS_Solid` | 1 | 64,71,82,101,125,135,140,150,156,173,+10 more | — none — |
| `src/OcctPrimBuilder.cpp` | `BRepBuilderAPI_Command` | 2 | **UNDETERMINED** | — none — |
| `src/OcctPrimBuilder.cpp` | `BRepBuilderAPI_MakeShape` | 2 | **UNDETERMINED** | — none — |
| `src/OcctPrimBuilder.cpp` | `BRepBuilderAPI_ModifyShape` | 1 | **UNDETERMINED** | — none — |
| `src/OcctPrimBuilder.cpp` | `BRepLib_Command` | 1 | **UNDETERMINED** | — none — |
| `src/OcctPrimBuilder.cpp` | `BRepLib_MakeShape` | 8 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeFilletChamfer.cpp` | `BRepBuilderAPI_MakeFace` | 7 | 342,360,696,708,726,1095,1114,1419 | — none — |
| `src/native/brep/NativeFilletChamfer.cpp` | `BRepBuilderAPI_MakeEdge` | 5 | 314,328,333,668,682,687 | — none — |
| `src/native/brep/NativeFilletChamfer.cpp` | `BRepBuilderAPI_MakePolygon` | 5 | 355,706,1417 | — none — |
| `src/native/brep/NativeFilletChamfer.cpp` | `BRepBuilderAPI_MakeWire` | 5 | 300,654 | — none — |
| `src/native/brep/NativeFilletChamfer.cpp` | `BRepBuilderAPI_Sewing` | 5 | 9,370 | — none — |
| `src/native/brep/NativeFilletChamfer.cpp` | `TopoDS_Shape` | 3 | 369,372,376,377,385,398,433,734,748,801,+10 more | — none — |
| `src/native/brep/NativeFilletChamfer.cpp` | `TopoDS_Solid` | 1 | 388 | — none — |
| `src/native/brep/NativeFilletChamfer.cpp` | `BRepBuilderAPI_Command` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeFilletChamfer.cpp` | `BRepBuilderAPI_MakeShape` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeFilletChamfer.cpp` | `BRepLib_Command` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeFilletChamfer.cpp` | `BRepLib_MakeShape` | 8 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeVariableFillet.cpp` | `BRepBuilderAPI_MakeFace` | 6 | 202,377,452 | — none — |
| `src/native/brep/NativeVariableFillet.cpp` | `BRepBuilderAPI_MakePolygon` | 6 | 197 | — none — |
| `src/native/brep/NativeVariableFillet.cpp` | `BRepBuilderAPI_MakeEdge` | 5 | 364,369 | — none — |
| `src/native/brep/NativeVariableFillet.cpp` | `BRepBuilderAPI_MakeWire` | 5 | 353 | — none — |
| `src/native/brep/NativeVariableFillet.cpp` | `BRepBuilderAPI_Sewing` | 5 | 7,210 | — none — |
| `src/native/brep/NativeVariableFillet.cpp` | `TopoDS_Shape` | 3 | 12,209,212,216,217,225,238,257,384,460,+4 more | — none — |
| `src/native/brep/NativeVariableFillet.cpp` | `TopoDS_Solid` | 1 | 228 | — none — |
| `src/native/brep/NativeVariableFillet.cpp` | `BRepBuilderAPI_Command` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeVariableFillet.cpp` | `BRepBuilderAPI_MakeShape` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeVariableFillet.cpp` | `BRepLib_Command` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeVariableFillet.cpp` | `BRepLib_MakeShape` | 8 | **UNDETERMINED** | — none — |
| `src/Features.cpp` | `BRepBuilderAPI_MakeFace` | 6 | 221,787,898,2449,2877 | — none — |
| `src/Features.cpp` | `BRepBuilderAPI_MakePolygon` | 6 | 767,828,863,885 | — none — |
| `src/Features.cpp` | `BRepBuilderAPI_MakeSolid` | 4 | 1372,1377 | — none — |
| `src/Features.cpp` | `BRepBuilderAPI_MakeEdge` | 3 | 783 | — none — |
| `src/Features.cpp` | `BRepBuilderAPI_MakeWire` | 3 | 784 | — none — |
| `src/Features.cpp` | `BRepBuilderAPI_Transform` | 2 | 524,2496,2546,2598,2690 | — none — |
| `src/Features.cpp` | `TopoDS_Shape` | 1 | 159,165,176,201,229,529,695,724,797,906,+34 more | — none — |
| `src/Features.cpp` | `BRepBuilderAPI_Command` | 2 | **UNDETERMINED** | — none — |
| `src/Features.cpp` | `BRepBuilderAPI_MakeShape` | 3 | **UNDETERMINED** | — none — |
| `src/Features.cpp` | `BRepBuilderAPI_ModifyShape` | 1 | **UNDETERMINED** | — none — |
| `src/Features.cpp` | `BRepLib_Command` | 1 | **UNDETERMINED** | — none — |
| `src/Features.cpp` | `BRepLib_MakeShape` | 8 | **UNDETERMINED** | — none — |
| `src/Features.cpp` | `BRepLib_MakeSolid` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `BRepBuilderAPI_MakeFace` | 7 | 615,803,1105,1123,1283,1457 | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `BRepBuilderAPI_MakePolygon` | 6 | 1097,1119,1275 | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `BRepBuilderAPI_Sewing` | 6 | 826,865,1083,1271,1427 | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `BRepBuilderAPI_MakeEdge` | 4 | 579 | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `BRepBuilderAPI_MakeWire` | 4 | 581 | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `TopoDS_Shape` | 3 | 10,71,654,656,686,830,899,992,994,1135,+12 more | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `BRepBuilderAPI_Command` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `BRepBuilderAPI_MakeShape` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `BRepLib_Command` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `BRepLib_MakeShape` | 8 | **UNDETERMINED** | — none — |
| `src/Primitives.cpp` | `BRepBuilderAPI_MakePolygon` | 6 | 132,177 | — none — |
| `src/Primitives.cpp` | `BRepBuilderAPI_MakeFace` | 4 | 141 | — none — |
| `src/Primitives.cpp` | `BRepBuilderAPI_GTransform` | 2 | 219,236 | — none — |
| `src/Primitives.cpp` | `BRepBuilderAPI_MakeVertex` | 2 | 195,204 | — none — |
| `src/Primitives.cpp` | `BRepBuilderAPI_Command` | 2 | **UNDETERMINED** | — none — |
| `src/Primitives.cpp` | `BRepBuilderAPI_MakeShape` | 7 | **UNDETERMINED** | — none — |
| `src/Primitives.cpp` | `BRepBuilderAPI_ModifyShape` | 1 | **UNDETERMINED** | — none — |
| `src/Primitives.cpp` | `BRepLib_Command` | 1 | **UNDETERMINED** | — none — |
| `src/Primitives.cpp` | `BRepLib_MakeShape` | 8 | **UNDETERMINED** | — none — |

<details><summary>remaining 34 files (symbol counts only)</summary>


`src/Nurbs.cpp (32)`, `src/native/brep/NativeLoftPipe.cpp (31)`, `src/Mold.cpp (30)`, `src/native/brep/NativeDraft.cpp (29)`, `src/native/brep/NativeThickenShell.cpp (28)`, `src/Airfoil.cpp (25)`, `src/SheetMetal.cpp (25)`, `src/Sketcher.cpp (23)`, `src/ClassASurfacing.cpp (22)`, `src/Cam.cpp (20)`, `src/DirectModeling.cpp (19)`, `src/Healing.cpp (18)`, `src/Weldments.cpp (17)`, `src/LoftGuide.cpp (13)`, `src/VoxelIoU.cpp (13)`, `src/native/brep/NativeShapeHeal.cpp (11)`, `src/SheetMetalExtended.cpp (10)`, `src/Sewing.cpp (9)`, `src/native/brep/NativeFilling.cpp (9)`, `src/InterferenceDetection.cpp (8)`, `src/Fea.cpp (6)`, `src/FeaTet.cpp (6)`, `src/Transform.cpp (6)`, `src/VarFillet.cpp (4)`, `src/OcctImport.cpp (3)`, `src/OcctNativeMesh.cpp (3)`, `src/BooleanTol.cpp (2)`, `src/DirectEdit.cpp (2)`, `src/MassProps.cpp (2)`, `src/ShapeCheck.cpp (2)`, `src/Booleans.cpp (1)`, `src/CamAdvanced.cpp (1)`, `src/ComponentRegistry.cpp (1)`, `src/Drawings.cpp (1)`


</details>


### TKGeomAlgo — 0 exclusive symbols used, 0 files · hidden (no link record)

Pulled into the process by: TKBO TKBool TKFillet TKOffset TKPrim TKShHealing TKTopAlgo


**No translation unit references any exclusive TKGeomAlgo symbol.** It is in the closure purely because its parents are.


### TKBRep — 83 exclusive symbols used, 34 files · DIRECT link record

Pulled into the process by: TKBO TKBool TKFillet TKGeomAlgo TKOffset TKPrim TKShHealing TKTopAlgo


| file | OCCT class | syms | line(s) | family gate |
|---|---|---:|---|---|
| `src/native/brep/NativeFilletChamfer.cpp` | `BRepAdaptor_Curve` | 7 | 160,211 | — none — |
| `src/native/brep/NativeFilletChamfer.cpp` | `BRepAdaptor_Surface` | 5 | 128 | — none — |
| `src/native/brep/NativeFilletChamfer.cpp` | `BRepTools_WireExplorer` | 5 | 210 | — none — |
| `src/native/brep/NativeFilletChamfer.cpp` | `TopExp_Explorer` | 4 | 382,737,740,790,795,872,877,911,1188,1468 | — none — |
| `src/native/brep/NativeFilletChamfer.cpp` | `TopoDS_Iterator` | 2 | 247 | — none — |
| `src/native/brep/NativeFilletChamfer.cpp` | `TopoDS_Shape` | 2 | 369,372,376,377,385,398,433,734,748,801,+10 more | — none — |
| `src/native/brep/NativeFilletChamfer.cpp` | `BRep_Tool` | 1 | 213,741,796,878,1163,1189 | — none — |
| `src/native/brep/NativeFilletChamfer.cpp` | `TopoDS_Edge` | 1 | 159,305,433,659,926,928,936,939,952,956,+4 more | — none — |
| `src/native/brep/NativeFilletChamfer.cpp` | `TopoDS_Face` | 1 | 127,172,204,227,244,276,280,317,334,339,+74 more | — none — |
| `src/native/brep/NativeFilletChamfer.cpp` | `TopoDS_Builder` | 2 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeFilletChamfer.cpp` | `TopoDS_TShape` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeFilletChamfer.cpp` | `TopoDS_TSolid` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeVariableFillet.cpp` | `BRepAdaptor_Curve` | 6 | 137,160 | — none — |
| `src/native/brep/NativeVariableFillet.cpp` | `BRepAdaptor_Surface` | 5 | 106 | — none — |
| `src/native/brep/NativeVariableFillet.cpp` | `BRepTools_WireExplorer` | 5 | 159 | — none — |
| `src/native/brep/NativeVariableFillet.cpp` | `TopExp_Explorer` | 4 | 222,387,390,524,529,557 | — none — |
| `src/native/brep/NativeVariableFillet.cpp` | `TopoDS_Iterator` | 2 | 170 | — none — |
| `src/native/brep/NativeVariableFillet.cpp` | `TopoDS_Shape` | 2 | 12,209,212,216,217,225,238,257,384,460,+4 more | — none — |
| `src/native/brep/NativeVariableFillet.cpp` | `BRep_Tool` | 1 | 162,391,530 | — none — |
| `src/native/brep/NativeVariableFillet.cpp` | `TopoDS_Face` | 1 | 105,147,153,167,191,194,200,203,205,209,+28 more | — none — |
| `src/native/brep/NativeVariableFillet.cpp` | `TopoDS_Builder` | 2 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeVariableFillet.cpp` | `TopoDS_TShape` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeVariableFillet.cpp` | `TopoDS_TSolid` | 1 | **UNDETERMINED** | — none — |
| `src/OcctImport.cpp` | `BRepAdaptor_Surface` | 7 | 623,849,2008 | — none — |
| `src/OcctImport.cpp` | `BRepAdaptor_Curve` | 6 | 1264,1776,1847 | — none — |
| `src/OcctImport.cpp` | `BRepTools_WireExplorer` | 5 | 1235,1934,1940 | — none — |
| `src/OcctImport.cpp` | `TopExp_Explorer` | 4 | 821,826,866,1316,1975,2023,2043 | — none — |
| `src/OcctImport.cpp` | `BRep_Tool` | 3 | 238,704,723,738,749,761,867,1210,1238,1976,+1 more | — none — |
| `src/OcctImport.cpp` | `TopoDS_Face` | 2 | 328,425,622,825,929,1929,2003 | — none — |
| `src/OcctImport.cpp` | `TopoDS_Shape` | 1 | 815,822 | — none — |
| `src/ClassASurfacing.cpp` | `BRepLProp_CLProps` | 8 | 11,14,381,441 | — none — |
| `src/ClassASurfacing.cpp` | `BRepLProp_SLProps` | 6 | 8,13,48,324,445,446 | — none — |
| `src/ClassASurfacing.cpp` | `BRepAdaptor_Curve` | 4 | 373,434 | — none — |
| `src/ClassASurfacing.cpp` | `TopExp_Explorer` | 4 | 114,125,136,140 | — none — |
| `src/ClassASurfacing.cpp` | `BRepAdaptor_Surface` | 2 | 152,323,443,444 | — none — |
| `src/ClassASurfacing.cpp` | `BRep_Tool` | 1 | 427,428,571 | — none — |
| `src/ClassASurfacing.cpp` | `TopoDS_Shape` | 1 | 106,110,121,132,658,724 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `BRep_Builder` | 9 | 953,984,1003,1173,1239,1554 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `BRep_Tool` | 4 | 998,999,1004,1005,1033,1034,1225,1255,1718 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `TopExp_Explorer` | 4 | 1712,1736 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `TopoDS_Shape` | 1 | 1513,1668,1687,1710,1731,1741 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `TopoDS_Builder` | 2 | **UNDETERMINED** | — none — |
| `src/native/brep/StepReadOcct.cpp` | `TopoDS_TCompound` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/StepReadOcct.cpp` | `TopoDS_TShape` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/StepReadOcct.cpp` | `TopoDS_TShell` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/StepReadOcct.cpp` | `TopoDS_TSolid` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `BRepTools_WireExplorer` | 4 | 987 | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `BRep_Tool` | 4 | 215,226,668,732,936,1019,1044,1116,1225,1335,+3 more | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `TopExp_Explorer` | 4 | 661,709,789,832,842,877,904,1003,1140,1204,+9 more | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `TopoDS_Face` | 2 | 469,488,589,594,606,607,614,616,627,635,+21 more | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `TopoDS_Iterator` | 2 | 697,705,786,874,1209,1360,1368,1440 | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `TopoDS_Shape` | 2 | 10,71,654,656,686,830,899,992,994,1135,+12 more | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `TopoDS_Builder` | 2 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `TopoDS_TShape` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `TopoDS_TShell` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `TopoDS_TSolid` | 1 | **UNDETERMINED** | — none — |
| `src/DirectModeling.cpp` | `BRepAdaptor_Curve` | 5 | 260,299,446 | — none — |
| `src/DirectModeling.cpp` | `BRepAdaptor_Surface` | 5 | 176,742 | — none — |
| `src/DirectModeling.cpp` | `TopExp_Explorer` | 4 | 406,442 | — none — |
| `src/DirectModeling.cpp` | `TopoDS_Face` | 1 | 74,160,175,193,215,226,234,338,354,560,+1 more | — none — |
| `src/DirectModeling.cpp` | `TopoDS_Shape` | 1 | 47,160,199,215,234,336,493,495,508,545,+3 more | — none — |
| `src/DirectModeling.cpp` | `BRep_Tool` | 1 | **UNDETERMINED** | — none — |
| `src/DirectModeling.cpp` | `TopoDS_Builder` | 2 | **UNDETERMINED** | — none — |
| `src/DirectModeling.cpp` | `TopoDS_TShape` | 1 | **UNDETERMINED** | — none — |
| `src/DirectModeling.cpp` | `TopoDS_TShell` | 1 | **UNDETERMINED** | — none — |
| `src/Cam.cpp` | `BRepTools_WireExplorer` | 5 | 145,155,261,271 | — none — |
| `src/Cam.cpp` | `BRepAdaptor_Curve` | 4 | 158,262 | — none — |
| `src/Cam.cpp` | `TopExp_Explorer` | 4 | 114,135,145,147,391 | — none — |
| `src/Cam.cpp` | `BRep_Tool` | 2 | 116,272,406 | — none — |
| `src/Cam.cpp` | `TopoDS_Face` | 1 | 6,113,115,126,131,138,404,462,565,752 | — none — |
| `src/Cam.cpp` | `TopoDS_Builder` | 2 | **UNDETERMINED** | — none — |
| `src/Cam.cpp` | `TopoDS_TCompound` | 1 | **UNDETERMINED** | — none — |
| `src/Cam.cpp` | `TopoDS_TShape` | 1 | **UNDETERMINED** | — none — |

<details><summary>remaining 26 files (symbol counts only)</summary>


`src/native/brep/StepWriteOcct.cpp (19)`, `src/native/brep/NativeThickenShell.cpp (16)`, `src/OcctPrimBuilder.cpp (15)`, `src/native/brep/NativeShapeHeal.cpp (15)`, `src/DirectEdit.cpp (14)`, `src/NativeOcctBridge.cpp (14)`, `src/OcctNativeMesh.cpp (14)`, `src/native/brep/NativeDraft.cpp (14)`, `src/native/brep/NativeLoftPipe.cpp (12)`, `src/native/brep/NativeFilling.cpp (11)`, `src/Drawings.cpp (9)`, `src/LoftGuide.cpp (9)`, `src/Mold.cpp (9)`, `src/CamAdvanced.cpp (8)`, `src/Healing.cpp (7)`, `src/Features.cpp (6)`, `src/SheetMetalExtended.cpp (6)`, `src/FeaTet.cpp (5)`, `src/SheetMetal.cpp (5)`, `src/Weldments.cpp (5)`, `src/Nurbs.cpp (4)`, `src/VarFillet.cpp (4)`, `src/IoExchange.cpp (2)`, `src/Booleans.cpp (1)`, `src/LOD.cpp (1)`, `src/ShapeCheck.cpp (1)`


</details>


### TKGeomBase — 0 exclusive symbols used, 0 files · hidden (no link record)

Pulled into the process by: TKBO TKBRep TKBool TKFillet TKGeomAlgo TKOffset TKPrim TKShHealing TKTopAlgo


**No translation unit references any exclusive TKGeomBase symbol.** It is in the closure purely because its parents are.


### TKG3d — 141 exclusive symbols used, 33 files · DIRECT link record

Pulled into the process by: TKBO TKBRep TKBool TKFillet TKGeomAlgo TKGeomBase TKOffset TKPrim TKShHealing TKTopAlgo


| file | OCCT class | syms | line(s) | family gate |
|---|---|---:|---|---|
| `src/native/geom/NativeNurbsConvert.cpp` | `Geom_BSplineCurve` | 13 | 231,232,247,249,311,316,330,346,388,389,+17 more | — none — |
| `src/native/geom/NativeNurbsConvert.cpp` | `Geom_BezierSurface` | 9 | 434 | — none — |
| `src/native/geom/NativeNurbsConvert.cpp` | `Geom_BSplineSurface` | 6 | 252,272,275,291,430,431,460,525,526,527,+2 more | — none — |
| `src/native/geom/NativeNurbsConvert.cpp` | `Geom_BezierCurve` | 6 | 346,405,913 | — none — |
| `src/native/geom/NativeNurbsConvert.cpp` | `Geom_Circle` | 3 | 401,791,870 | — none — |
| `src/native/geom/NativeNurbsConvert.cpp` | `Geom_ConicalSurface` | 3 | 483,484 | — none — |
| `src/native/geom/NativeNurbsConvert.cpp` | `Geom_Ellipse` | 3 | 403,802,878 | — none — |
| `src/native/geom/NativeNurbsConvert.cpp` | `Geom_Line` | 3 | 311,399,777,865 | — none — |
| `src/native/geom/NativeNurbsConvert.cpp` | `Geom_ToroidalSurface` | 3 | 510,511 | — none — |
| `src/native/geom/NativeNurbsConvert.cpp` | `Geom_TrimmedCurve` | 3 | 390,394,807,886 | — none — |
| `src/native/geom/NativeNurbsConvert.cpp` | `Geom_Curve` | 2 | 388,392,765,766,805,806,858,859,862 | — none — |
| `src/native/geom/NativeNurbsConvert.cpp` | `Geom_CylindricalSurface` | 2 | 473,474 | — none — |
| `src/native/geom/NativeNurbsConvert.cpp` | `Geom_RectangularTrimmedSurface` | 2 | 454,455 | — none — |
| `src/native/geom/NativeNurbsConvert.cpp` | `Geom_SphericalSurface` | 2 | 495,496 | — none — |
| `src/native/geom/NativeNurbsConvert.cpp` | `Geom_Surface` | 2 | 430,453 | — none — |
| `src/native/geom/NativeNurbsConvert.cpp` | `Geom_Plane` | 1 | 463 | — none — |
| `src/native/geom/NativeNurbsConvert.cpp` | `Geom_Geometry` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/StepWriteOcct.cpp` | `Geom_BSplineSurface` | 17 | 260,261,601,602,607,609,653,655 | — none — |
| `src/native/brep/StepWriteOcct.cpp` | `Geom_BSplineCurve` | 11 | 172,179,236,238,379,380,382,389,391,401,+2 more | — none — |
| `src/native/brep/StepWriteOcct.cpp` | `Geom_ConicalSurface` | 3 | 563,564 | — none — |
| `src/native/brep/StepWriteOcct.cpp` | `Geom_RectangularTrimmedSurface` | 3 | 532,533,650,651 | — none — |
| `src/native/brep/StepWriteOcct.cpp` | `Geom_ToroidalSurface` | 3 | 589,590 | — none — |
| `src/native/brep/StepWriteOcct.cpp` | `Geom_TrimmedCurve` | 3 | 344,399,435,500 | — none — |
| `src/native/brep/StepWriteOcct.cpp` | `Geom_Circle` | 2 | 358,467 | — none — |
| `src/native/brep/StepWriteOcct.cpp` | `Geom_Curve` | 2 | 341,423,614,629,834,882,885 | — none — |
| `src/native/brep/StepWriteOcct.cpp` | `Geom_CylindricalSurface` | 2 | 552,553 | — none — |
| `src/native/brep/StepWriteOcct.cpp` | `Geom_Ellipse` | 2 | 368,483 | — none — |
| `src/native/brep/StepWriteOcct.cpp` | `Geom_Line` | 2 | 348,440 | — none — |
| `src/native/brep/StepWriteOcct.cpp` | `Geom_SphericalSurface` | 2 | 578,579 | — none — |
| `src/native/brep/StepWriteOcct.cpp` | `Geom_Surface` | 2 | 522,529 | — none — |
| `src/native/brep/StepWriteOcct.cpp` | `Geom_SurfaceOfRevolution` | 2 | 627,628 | — none — |
| `src/native/brep/StepWriteOcct.cpp` | `Geom_BezierCurve` | 1 | 386 | — none — |
| `src/native/brep/StepWriteOcct.cpp` | `Geom_BezierSurface` | 1 | 604,605 | — none — |
| `src/native/brep/StepWriteOcct.cpp` | `Geom_Plane` | 1 | 542 | — none — |
| `src/native/brep/StepWriteOcct.cpp` | `Geom_SurfaceOfLinearExtrusion` | 1 | 612,613 | — none — |
| `src/native/brep/StepWriteOcct.cpp` | `Geom_Geometry` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/StepWriteOcct.cpp` | `Geom_SweptSurface` | 2 | **UNDETERMINED** | — none — |
| `src/OcctImport.cpp` | `Geom_BSplineSurface` | 15 | 222,242,248,249,366,368,509,511,746,750,+3 more | — none — |
| `src/OcctImport.cpp` | `Geom_BSplineCurve` | 8 | 333,431 | — none — |
| `src/OcctImport.cpp` | `Geom_CylindricalSurface` | 2 | 580 | — none — |
| `src/OcctImport.cpp` | `Geom_Plane` | 2 | 571 | — none — |
| `src/OcctImport.cpp` | `Geom_SphericalSurface` | 2 | 592 | — none — |
| `src/OcctImport.cpp` | `Geom_Surface` | 2 | 568,704,723,738,749,761,1210 | — none — |
| `src/OcctImport.cpp` | `Geom_SurfaceOfRevolution` | 2 | 424,724,725,726 | — none — |
| `src/OcctImport.cpp` | `Geom_ToroidalSurface` | 2 | 604 | — none — |
| `src/OcctImport.cpp` | `Geom_BezierSurface` | 1 | 762,763 | — none — |
| `src/OcctImport.cpp` | `Geom_Curve` | 1 | 331,428,1238 | — none — |
| `src/OcctImport.cpp` | `Geom_OffsetSurface` | 1 | 558,564,739,740 | — none — |
| `src/OcctImport.cpp` | `Geom_SurfaceOfLinearExtrusion` | 1 | 327,705,706,707 | — none — |
| `src/OcctImport.cpp` | `Adaptor3d_Curve` | 1 | **UNDETERMINED** | — none — |
| `src/OcctImport.cpp` | `Adaptor3d_Surface` | 1 | **UNDETERMINED** | — none — |
| `src/OcctImport.cpp` | `GeomAdaptor_Curve` | 1 | **UNDETERMINED** | — none — |
| `src/OcctImport.cpp` | `GeomAdaptor_Surface` | 1 | **UNDETERMINED** | — none — |
| `src/OcctImport.cpp` | `Geom_Geometry` | 1 | **UNDETERMINED** | — none — |
| `src/OcctImport.cpp` | `Geom_SweptSurface` | 2 | **UNDETERMINED** | — none — |
| `src/native/brep/StepReadOcct.cpp` | `Geom_Circle` | 3 | 744,849,1115 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `Geom_Ellipse` | 3 | 752,858,1119 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `Geom_Hyperbola` | 3 | 757,764,1097 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `Geom_Line` | 3 | 737,806,832,839,1042,1055 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `Geom_Parabola` | 3 | 774,1101 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `GProp_GProps` | 2 | 1694,1746 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `Geom_BSplineCurve` | 2 | 605,670,671,674 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `Geom_BSplineSurface` | 2 | 367,467,469,473 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `Geom_Curve` | 2 | 364,531,546,618,686,718,785,815,964,992,+2 more | — none — |
| `src/native/brep/StepReadOcct.cpp` | `Geom_ConicalSurface` | 1 | 503,1187 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `Geom_CylindricalSurface` | 1 | 497 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `Geom_Plane` | 1 | 492 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `Geom_SphericalSurface` | 1 | 508 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `Geom_SurfaceOfLinearExtrusion` | 1 | 538 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `Geom_SurfaceOfRevolution` | 1 | 549 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `Geom_ToroidalSurface` | 1 | 514 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `TopAbs_Orientation` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `Geom_ConicalSurface` | 4 | 175,186,286,297,298,369,522 | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `Geom_ToroidalSurface` | 4 | 177,188,312,324,393,534 | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `Geom_CylindricalSurface` | 3 | 174,185,275,283,363 | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `Geom_Plane` | 3 | 15,173,184,266,272,589,641,779,872,934,+3 more | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `Geom_SphericalSurface` | 3 | 176,187,301,309,387 | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `GProp_GProps` | 2 | 631,851,915,1152,1310,1502 | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `Geom_Circle` | 2 | 230 | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `Geom_RectangularTrimmedSurface` | 2 | 157,161,162 | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `Geom_TrimmedCurve` | 2 | 217 | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `Geom_Curve` | 1 | 214,215,228 | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `Geom_Surface` | 1 | 158,159,171,182,259,261,346,471,472,483,+7 more | — none — |
| `src/OcctPrimBuilder.cpp` | `GProp_GProps` | 3 | 74,104,313,460,486,572 | — none — |
| `src/OcctPrimBuilder.cpp` | `Geom_Circle` | 2 | 379 | — none — |
| `src/OcctPrimBuilder.cpp` | `Geom_Curve` | 2 | 325,360,364,411,436 | — none — |
| `src/OcctPrimBuilder.cpp` | `Geom_Line` | 2 | 342,368 | — none — |
| `src/OcctPrimBuilder.cpp` | `Geom_TrimmedCurve` | 2 | 324,327 | — none — |
| `src/OcctPrimBuilder.cpp` | `Geom_ConicalSurface` | 1 | 188,193 | — none — |
| `src/OcctPrimBuilder.cpp` | `Geom_CylindricalSurface` | 1 | 162,352,386,396 | — none — |
| `src/OcctPrimBuilder.cpp` | `Geom_Plane` | 1 | 343,376 | — none — |
| `src/OcctPrimBuilder.cpp` | `Geom_SphericalSurface` | 1 | 128 | — none — |
| `src/OcctPrimBuilder.cpp` | `Geom_SurfaceOfLinearExtrusion` | 1 | 278,334,340,418 | — none — |
| `src/OcctPrimBuilder.cpp` | `Geom_SurfaceOfRevolution` | 1 | 278,446 | — none — |
| `src/OcctPrimBuilder.cpp` | `Geom_ToroidalSurface` | 1 | 143 | — none — |
| `src/OcctPrimBuilder.cpp` | `Adaptor3d_Surface` | 1 | **UNDETERMINED** | — none — |
| `src/OcctPrimBuilder.cpp` | `GeomAdaptor_Surface` | 1 | **UNDETERMINED** | — none — |
| `src/OcctPrimBuilder.cpp` | `TopAbs_Orientation` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeShapeHeal.cpp` | `Geom_ConicalSurface` | 3 | 96,529 | — none — |
| `src/native/brep/NativeShapeHeal.cpp` | `GProp_GProps` | 2 | 408,416,476 | — none — |
| `src/native/brep/NativeShapeHeal.cpp` | `Geom_Curve` | 2 | 221 | — none — |
| `src/native/brep/NativeShapeHeal.cpp` | `Geom_Line` | 2 | 231 | — none — |
| `src/native/brep/NativeShapeHeal.cpp` | `Geom_RectangularTrimmedSurface` | 2 | 520,521 | — none — |
| `src/native/brep/NativeShapeHeal.cpp` | `Geom_Surface` | 2 | 73,135,140,200,214,517 | — none — |
| `src/native/brep/NativeShapeHeal.cpp` | `Geom_ToroidalSurface` | 2 | 121,531 | — none — |
| `src/native/brep/NativeShapeHeal.cpp` | `Geom_Circle` | 1 | 236 | — none — |
| `src/native/brep/NativeShapeHeal.cpp` | `Geom_CylindricalSurface` | 1 | 84,528 | — none — |
| `src/native/brep/NativeShapeHeal.cpp` | `Geom_Plane` | 1 | 76,527 | — none — |
| `src/native/brep/NativeShapeHeal.cpp` | `Geom_SphericalSurface` | 1 | 110,530 | — none — |
| `src/native/brep/NativeShapeHeal.cpp` | `TopAbs_Orientation` | 1 | 438 | — none — |
| `src/DirectEdit.cpp` | `GProp_GProps` | 3 | 281 | — none — |
| `src/DirectEdit.cpp` | `Geom_Circle` | 2 | 162 | — none — |
| `src/DirectEdit.cpp` | `Geom_CylindricalSurface` | 2 | 101,124,144,145 | — none — |
| `src/DirectEdit.cpp` | `Geom_TrimmedCurve` | 2 | 157,158 | — none — |
| `src/DirectEdit.cpp` | `Geom_Curve` | 1 | 155 | — none — |
| `src/DirectEdit.cpp` | `Geom_Surface` | 1 | 141 | — none — |
| `src/DirectEdit.cpp` | `Geom_SurfaceOfLinearExtrusion` | 1 | 102,151,152 | — none — |
| `src/DirectEdit.cpp` | `Adaptor3d_Surface` | 1 | **UNDETERMINED** | — none — |
| `src/DirectEdit.cpp` | `GeomAdaptor_Surface` | 1 | **UNDETERMINED** | — none — |
| `src/DirectEdit.cpp` | `Geom_SweptSurface` | 2 | **UNDETERMINED** | — none — |

<details><summary>remaining 25 files (symbol counts only)</summary>


`src/Nurbs.cpp (15)`, `src/native/brep/NativeSectionFill.cpp (15)`, `src/ClassASurfacing.cpp (11)`, `src/native/brep/NativeLoftPipe.cpp (11)`, `src/DirectModeling.cpp (10)`, `src/native/brep/NativeFilletChamfer.cpp (10)`, `src/native/brep/NativeThickenShell.cpp (10)`, `src/OcctNativeMesh.cpp (9)`, `src/native/brep/NativeVariableFillet.cpp (9)`, `src/native/brep/NativeDraft.cpp (7)`, `src/NativeOcctBridge.cpp (6)`, `src/Cam.cpp (5)`, `src/CamAdvanced.cpp (5)`, `src/MassProps.cpp (4)`, `src/Mold.cpp (4)`, `src/SheetMetalExtended.cpp (4)`, `src/native/brep/NativeFilling.cpp (4)`, `src/Features.cpp (3)`, `src/Drawings.cpp (2)`, `src/Healing.cpp (2)`, `src/InterferenceDetection.cpp (2)`, `src/LoftGuide.cpp (2)`, `src/Sketcher.cpp (2)`, `src/SheetMetal.cpp (1)`, `src/Weldments.cpp (1)`


</details>


### TKG2d — 24 exclusive symbols used, 3 files · hidden (no link record)

Pulled into the process by: TKBO TKBRep TKBool TKFillet TKG3d TKGeomAlgo TKGeomBase TKOffset TKPrim TKShHealing TKTopAlgo


| file | OCCT class | syms | line(s) | family gate |
|---|---|---:|---|---|
| `src/native/geom/NativeNurbsConvert.cpp` | `Geom2d_BSplineCurve` | 8 | 809,837,909,911 | — none — |
| `src/native/geom/NativeNurbsConvert.cpp` | `Geom2d_BezierCurve` | 3 | 835,836,837,921,923 | — none — |
| `src/native/geom/NativeNurbsConvert.cpp` | `Geom2d_Circle` | 3 | 779,876 | — none — |
| `src/native/geom/NativeNurbsConvert.cpp` | `Geom2d_Ellipse` | 3 | 793,884 | — none — |
| `src/native/geom/NativeNurbsConvert.cpp` | `Geom2d_Line` | 3 | 93,769,868 | — none — |
| `src/native/geom/NativeNurbsConvert.cpp` | `Geom2d_TrimmedCurve` | 3 | 804,889 | — none — |
| `src/native/geom/NativeNurbsConvert.cpp` | `Geom2d_Curve` | 1 | 765,862,863,887,888,909,911,921,923,925,+1 more | — none — |
| `src/NativeOcctBridge.cpp` | `Geom2d_Line` | 1 | 162,257,266 | — none — |
| `src/Nurbs.cpp` | `Geom2d_Line` | 1 | 567,571,575 | — none — |

### TKMath — 27 exclusive symbols used, 42 files · DIRECT link record

Pulled into the process by: TKBO TKBRep TKBool TKFillet TKG2d TKG3d TKGeomAlgo TKGeomBase TKOffset TKPrim TKShHealing TKTopAlgo


| file | OCCT class | syms | line(s) | family gate |
|---|---|---:|---|---|
| `src/Features.cpp` | `TopLoc_Location` | 2 | **UNDETERMINED** | — none — |
| `src/Features.cpp` | `TopLoc_SListOfItemLocation` | 3 | **UNDETERMINED** | — none — |
| `src/native/brep/StepReadOcct.cpp` | `Bnd_Box` | 2 | 1618 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `TopLoc_Location` | 2 | 1237 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `TopLoc_SListOfItemLocation` | 1 | **UNDETERMINED** | — none — |
| `src/OcctNativeMesh.cpp` | `TopLoc_Location` | 3 | 175 | — none — |
| `src/OcctNativeMesh.cpp` | `Poly_Triangulation` | 1 | 723 | — none — |
| `src/OcctNativeMesh.cpp` | `TopLoc_SListOfItemLocation` | 3 | **UNDETERMINED** | — none — |
| `src/DirectEdit.cpp` | `TopLoc_Location` | 2 | **UNDETERMINED** | — none — |
| `src/DirectEdit.cpp` | `TopLoc_SListOfItemLocation` | 3 | **UNDETERMINED** | — none — |
| `src/SheetMetalExtended.cpp` | `Bnd_Box` | 2 | 329,438,559,812 | — none — |
| `src/SheetMetalExtended.cpp` | `TopLoc_Location` | 2 | **UNDETERMINED** | — none — |
| `src/SheetMetalExtended.cpp` | `TopLoc_SListOfItemLocation` | 1 | **UNDETERMINED** | — none — |
| `src/Booleans.cpp` | `Bnd_Box` | 2 | 299 | — none — |
| `src/Booleans.cpp` | `TopLoc_Location` | 1 | **UNDETERMINED** | — none — |
| `src/Booleans.cpp` | `TopLoc_SListOfItemLocation` | 3 | **UNDETERMINED** | — none — |
| `src/Mold.cpp` | `Bnd_Box` | 2 | 242 | — none — |
| `src/Mold.cpp` | `TopLoc_Location` | 1 | **UNDETERMINED** | — none — |
| `src/Mold.cpp` | `TopLoc_SListOfItemLocation` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeFilletChamfer.cpp` | `TopLoc_Location` | 2 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeFilletChamfer.cpp` | `TopLoc_SListOfItemLocation` | 3 | **UNDETERMINED** | — none — |

<details><summary>remaining 34 files (symbol counts only)</summary>


`src/native/brep/NativeLoftPipe.cpp (6)`, `src/native/brep/NativeVariableFillet.cpp (6)`, `src/DirectModeling.cpp (5)`, `src/FeaTet.cpp (5)`, `src/Healing.cpp (5)`, `src/OcctPrimBuilder.cpp (5)`, `src/ShapeCheck.cpp (5)`, `src/VoxelIoU.cpp (5)`, `src/native/brep/NativeDraft.cpp (5)`, `src/native/brep/NativeThickSolid.cpp (5)`, `src/native/brep/NativeThickenShell.cpp (5)`, `src/native/brep/StepWriteOcct.cpp (5)`, `src/NativeOcctBridge.cpp (4)`, `src/OcctImport.cpp (4)`, `src/Weldments.cpp (4)`, `src/Cam.cpp (3)`, `src/CamAdvanced.cpp (3)`, `src/SheetMetal.cpp (3)`, `src/native/brep/NativeShapeHeal.cpp (3)`, `src/BooleanTol.cpp (2)`, `src/ComponentRegistry.cpp (2)`, `src/Fea.cpp (2)`, `src/Airfoil.cpp (1)`, `src/Drawings.cpp (1)`, `src/InterferenceDetection.cpp (1)`, `src/IoExchange.cpp (1)`, `src/Primitives.cpp (1)`, `src/ShapeRegistry.cpp (1)`, `src/Sketcher.cpp (1)`, `src/Transform.cpp (1)`, `src/VarFillet.cpp (1)`, `src/binding.cpp (1)`, `src/native/brep/NativeFilling.cpp (1)`, `src/native/brep/NativeShapeHealBridge.cpp (1)`


</details>


### TKernel — 26 exclusive symbols used, 46 files · DIRECT link record

Pulled into the process by: TKBO TKBRep TKBool TKFillet TKG2d TKG3d TKGeomAlgo TKGeomBase TKMath TKOffset TKPrim TKShHealing TKTopAlgo


| file | OCCT class | syms | line(s) | family gate |
|---|---|---:|---|---|
| `src/Features.cpp` | `NCollection_BaseAllocator` | 1 | **UNDETERMINED** | — none — |
| `src/Features.cpp` | `NCollection_BaseList` | 2 | **UNDETERMINED** | — none — |
| `src/Features.cpp` | `NCollection_BaseMap` | 3 | **UNDETERMINED** | — none — |
| `src/Features.cpp` | `NCollection_BaseSequence` | 2 | **UNDETERMINED** | — none — |
| `src/Features.cpp` | `Standard_Failure` | 9 | **UNDETERMINED** | — none — |
| `src/Features.cpp` | `Standard_Mutex` | 1 | **UNDETERMINED** | — none — |
| `src/Features.cpp` | `Standard_Type` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeThickenShell.cpp` | `NCollection_BaseAllocator` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeThickenShell.cpp` | `NCollection_BaseList` | 2 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeThickenShell.cpp` | `NCollection_BaseMap` | 3 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeThickenShell.cpp` | `Standard_Failure` | 9 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeThickenShell.cpp` | `Standard_Mutex` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeThickenShell.cpp` | `Standard_Type` | 1 | **UNDETERMINED** | — none — |
| `src/DirectEdit.cpp` | `Message_Report` | 1 | **UNDETERMINED** | — none — |
| `src/DirectEdit.cpp` | `NCollection_BaseAllocator` | 1 | **UNDETERMINED** | — none — |
| `src/DirectEdit.cpp` | `NCollection_BaseList` | 2 | **UNDETERMINED** | — none — |
| `src/DirectEdit.cpp` | `NCollection_BaseMap` | 3 | **UNDETERMINED** | — none — |
| `src/DirectEdit.cpp` | `Standard_Failure` | 9 | **UNDETERMINED** | — none — |
| `src/DirectEdit.cpp` | `Standard_Mutex` | 1 | **UNDETERMINED** | — none — |
| `src/DirectEdit.cpp` | `Standard_Type` | 1 | **UNDETERMINED** | — none — |
| `src/OcctNativeMesh.cpp` | `NCollection_BaseAllocator` | 1 | **UNDETERMINED** | — none — |
| `src/OcctNativeMesh.cpp` | `NCollection_BaseList` | 1 | **UNDETERMINED** | — none — |
| `src/OcctNativeMesh.cpp` | `NCollection_BaseMap` | 3 | **UNDETERMINED** | — none — |
| `src/OcctNativeMesh.cpp` | `NCollection_BaseSequence` | 1 | **UNDETERMINED** | — none — |
| `src/OcctNativeMesh.cpp` | `Standard_Failure` | 9 | **UNDETERMINED** | — none — |
| `src/OcctNativeMesh.cpp` | `Standard_Type` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `NCollection_BaseAllocator` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `NCollection_BaseList` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `NCollection_BaseMap` | 3 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `Standard_Failure` | 9 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `Standard_Mutex` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeThickSolid.cpp` | `Standard_Type` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeDraft.cpp` | `NCollection_BaseAllocator` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeDraft.cpp` | `NCollection_BaseList` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeDraft.cpp` | `NCollection_BaseMap` | 3 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeDraft.cpp` | `Standard_Failure` | 9 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeDraft.cpp` | `Standard_Mutex` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/NativeDraft.cpp` | `Standard_Type` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/StepReadOcct.cpp` | `Standard_Failure` | 9 | 471,672,866,878,997,1009,1341,1362,1426,1753 | — none — |
| `src/native/brep/StepReadOcct.cpp` | `NCollection_BaseAllocator` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/StepReadOcct.cpp` | `NCollection_BaseList` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/StepReadOcct.cpp` | `NCollection_BaseMap` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/StepReadOcct.cpp` | `Standard_Mutex` | 1 | **UNDETERMINED** | — none — |
| `src/native/brep/StepReadOcct.cpp` | `Standard_Type` | 1 | **UNDETERMINED** | — none — |
| `src/Healing.cpp` | `NCollection_BaseAllocator` | 1 | **UNDETERMINED** | — none — |
| `src/Healing.cpp` | `NCollection_BaseList` | 1 | **UNDETERMINED** | — none — |
| `src/Healing.cpp` | `NCollection_BaseMap` | 1 | **UNDETERMINED** | — none — |
| `src/Healing.cpp` | `NCollection_BaseSequence` | 1 | **UNDETERMINED** | — none — |
| `src/Healing.cpp` | `Standard_Failure` | 9 | **UNDETERMINED** | — none — |
| `src/Healing.cpp` | `Standard_Mutex` | 1 | **UNDETERMINED** | — none — |
| `src/Healing.cpp` | `Standard_Type` | 1 | **UNDETERMINED** | — none — |

<details><summary>remaining 38 files (symbol counts only)</summary>


`src/native/brep/NativeVariableFillet.cpp (17)`, `src/Airfoil.cpp (16)`, `src/Cam.cpp (16)`, `src/DirectModeling.cpp (16)`, `src/Mold.cpp (16)`, `src/NativeOcctBridge.cpp (16)`, `src/Nurbs.cpp (16)`, `src/OcctImport.cpp (16)`, `src/OcctPrimBuilder.cpp (16)`, `src/native/brep/NativeFilletChamfer.cpp (16)`, `src/ClassASurfacing.cpp (15)`, `src/LoftGuide.cpp (15)`, `src/VarFillet.cpp (15)`, `src/native/brep/NativeLoftPipe.cpp (15)`, `src/native/brep/NativeShapeHeal.cpp (15)`, `src/native/brep/StepWriteOcct.cpp (15)`, `src/SheetMetalExtended.cpp (14)`, `src/Sketcher.cpp (14)`, `src/native/brep/NativeSectionFill.cpp (14)`, `src/ShapeCheck.cpp (13)`, `src/SheetMetal.cpp (13)`, `src/Transform.cpp (13)`, `src/Weldments.cpp (13)`, `src/native/geom/NativeNurbsConvert.cpp (13)`, `src/Drawings.cpp (12)`, `src/native/brep/NativeFilling.cpp (12)`, `src/CamAdvanced.cpp (11)`, `src/FeaTet.cpp (11)`, `src/binding.cpp (11)`, `src/Primitives.cpp (5)`, `src/Booleans.cpp (4)`, `src/InterferenceDetection.cpp (4)`, `src/Sewing.cpp (4)`, `src/ShapeFix.cpp (3)`, `src/VoxelIoU.cpp (3)`, `src/BooleanTol.cpp (1)`, `src/IoExchange.cpp (1)`, `src/native/geom/NativeProjection.cpp (1)`


</details>

## 8. `FORGE_GEOM_DROP_NATIVE` — **it is NOT inert. The brief is wrong on this point.**

The brief states the flag is "declared with `option()` but compile_def=0 and read by ZERO
source files, so setting it does nothing", and asks for a plain answer. The first two facts
are true; **the conclusion drawn from them is false, and it is falsifiable in one configure.**

Measured:

| check | result |
|---|---|
| `grep -c 'option(FORGE_GEOM_DROP_NATIVE' CMakeLists.txt` | **1** (line 1066, default **ON**) |
| `grep -c 'add_compile_definitions(FORGE_GEOM_DROP_NATIVE' CMakeLists.txt` | **0** |
| source files reading `FORGE_GEOM_DROP_NATIVE` | **0** |

So no `#ifdef FORGE_GEOM_DROP_NATIVE` can ever fire — that much is right. But the option
**guards an `if()` block that defines three other macros** (`CMakeLists.txt:1067-1091`):

```cmake
option(FORGE_GEOM_DROP_NATIVE "use R1/R2/R3 native geom routines; OFF=OCCT A/B baseline" ON)
if(FORGE_NATIVE_BREP AND FORGE_GEOM_DROP_NATIVE)
    ...
    add_compile_definitions(FORGE_NATIVE_PROJECTION=1 FORGE_NATIVE_NURBS_CONVERT=1
                            FORGE_NATIVE_LAW=1)
endif()
```

`FORGE_NATIVE_BREP` defaults ON, so the block fires by default. Flipping the option therefore
changes the compile line. **Measured by configuring both ways and diffing `flags.make`:**

```
default (GEOM ON) : FORGE_NATIVE_LAW  FORGE_NATIVE_NURBS_CONVERT  FORGE_NATIVE_PROJECTION
-DFORGE_GEOM_DROP_NATIVE=OFF : (none present)
```

Those three macros are read at **26 real `#if` guard sites across 9 source files** —
`Airfoil.cpp` (3), `ClassASurfacing.cpp` (2), `Features.cpp` (3), `Nurbs.cpp` (1),
`OcctImport.cpp` (4), `OcctNativeMesh.cpp` (2), `VarFillet.cpp` (2),
`native/brep/StepReadOcct.cpp` (2), `native/brep/StepWriteOcct.cpp` (7).
(Counting only directives: `NativeProjection.cpp` and `NativeNurbsConvert.cpp` mention the
macros in comments only, and are excluded.)

**Verdict: the flag is a live A/B switch that acts by proxy.** It is *unreadable by name* from
any source, which is a genuine wart — it makes the flag invisible to exactly the
`grep -rc NAME src/` check the programme uses to catch dead flags, and that is why it was
reported inert. But setting it does something substantial: `OFF` reverts point-projection,
analytic→NURBS conversion and the fillet Law to their OCCT implementations.

**What it was meant to guard:** the R1/R2/R3 native geometry routines — `forge::occtproj`
(point→surface / point→curve-2d Gauss-Newton, `NativeProjection.cpp`), `forge::occtconv`
(analytic→NURBS and points→NURBS least-squares, `NativeNurbsConvert.cpp`), `forge::occtfill`
(`NativeSectionFill.cpp`) and `forge::occtlaw` (`NativeLaw.cpp`). These are the replacements
that let **TKGeomBase** and **TKGeomAlgo** leave the link line in July 2026. `OFF` restores the
OCCT baseline (`GeomConvert`, `GeomAPI_Project*`, `GeomAPI_PointsToBSpline`,
`GeomFill_NSections`, `Law_Linear`/`Law_S`) so the native routines can be A/B'd against it.

**Recommended fix — do not delete it.** The A/B capability is real and is the only way to
re-validate the two toolkit drops it enabled. Make the flag honest instead, by adding it to its
own definitions so the name it is set by is the name the build records:

```cmake
add_compile_definitions(FORGE_GEOM_DROP_NATIVE=1 FORGE_NATIVE_PROJECTION=1
                        FORGE_NATIVE_NURBS_CONVERT=1 FORGE_NATIVE_LAW=1)
```

That is a one-line change and it is deliberately **not** made here: this branch is an analysis
and touching `CMakeLists.txt` would re-hash the op vocabulary and require the 13 UI gates.

Note also that a `GEOM` drop cannot be scored as a closure move in any case — TKGeomBase and
TKGeomAlgo are two of the four zero-work toolkits (§5) and leave only at waves 9 and 7.

## 9. What this map changes about the plan

1. **Family J (DRAFT) is the gate on the entire ladder**, not one family in ten. TKOffset needs
   all nine families; TKOffset is the only parent-free toolkit; so nothing else can move until
   J lands. Its standing measured result is "no bounded fix exists". **That is the single most
   important open problem in the programme**, and it is currently ranked alongside nine others.
2. **Four toolkits need no work ever** (§5). Any effort scheduled against TKBool, TKPrim,
   TKGeomAlgo or TKGeomBase is wasted.
3. **TKFillet must never be scored alone** — worth 0 closure while TKOffset lives, and it
   *raises* `OCCT_DIRECT` by appending TKBO and TKG2d.
4. **The family programme's ceiling is closure 11**, reached at wave 3 — CORRECTED from 12 on
   2026-08-31 by building all three configurations; see §2. Waves 4-13 have no
   flags and no harness; TKBO (wave 4) is the first unowned frontier and has 32 symbols across
   14 files with no native boolean engine behind them.
5. **Two honesty fixes are free**: drop TKPrim's dead link record (`OCCT_DIRECT` 9 → 8), and
   name TKBO and TKG2d on the link line to clear both phantoms. Neither moves the ledger, and
   both should be labelled as accounting, not progress.

## 10. Limits

* Closure is measured from **static** load commands. A `dlopen` would not appear; nothing in
  the kernel does that, but this cannot prove it.
* Attribution is per **translation unit**, so "42 symbols across 7 files" bounds the work but
  does not count distinct call expressions. Line numbers locate the class, not every call.
* Exclusivity is computed against the **14 closure toolkits only**. A symbol also exported by
  an OCCT library outside the closure would still be counted exclusive here; since the closure
  is what loads, this is the right denominator for drop decisions.
* Symbol counts are a **proxy for effort, not effort itself**. TKG3d's 141 symbols are mostly
  one interchange type; family J's 6 are an unsolved algorithm. The *ordering* is exact
  topology; the *cost* column is not.
* Measured on macOS/arm64 against Homebrew OCCT 7.9 with
  `-undefined dynamic_lookup`. The Linux strict-link CI is the ultimate gate, and it is
  stricter: both phantoms would be hard link errors there.

## 11. Reproducing this map

```
# baseline
npm run forge:kernel
bash forge-kernel/scripts/occt_closure_count.sh                  # 9 / 14 / 2

# the wave-1 A/B (all nine TKOffset families)
cd forge-kernel && ../node_modules/.bin/cmake-js configure --out build-tkoff \
  --CDCMAKE_BUILD_TYPE=Release \
  --CDFORGE_OFFSET_DROP_MAKEOFFSET=ON --CDFORGE_FILLING_DROP_NATIVE=ON \
  --CDFORGE_THRUSECTIONS_DROP_NATIVE=ON --CDFORGE_PIPE_DROP_NATIVE=ON \
  --CDFORGE_PIPESHELL_DROP_NATIVE=ON --CDFORGE_THICKSOLID_DROP_NATIVE=ON \
  --CDFORGE_OFFSETSHAPE_DROP_NATIVE=ON --CDFORGE_THICKEN_DROP_NATIVE=ON \
  --CDFORGE_DRAFT_DROP_NATIVE=ON
../node_modules/.bin/cmake-js build --out build-tkoff --parallel 10
bash scripts/occt_closure_count.sh build-tkoff/Release/forge-kernel.node   # 8 / 13 / 2
cmp build/Release/forge-kernel.node build-tkoff/Release/forge-kernel.node  # MUST differ

# the dead link record
bash forge-kernel/scripts/occt_drop_gate.sh TKPrim                # 0 needed, DROP-SAFE

# the GEOM flag is not inert
../node_modules/.bin/cmake-js configure --out /tmp/geomoff --CDFORGE_GEOM_DROP_NATIVE=OFF
grep -o 'FORGE_NATIVE_PROJECTION' build/CMakeFiles/forge_kernel.dir/flags.make   # present
grep -o 'FORGE_NATIVE_PROJECTION' /tmp/geomoff/CMakeFiles/forge_kernel.dir/flags.make  # absent
```

The per-TU attribution scripts used for §7 are committed alongside this report as
`forge-kernel/scripts/occt_toolkit_map.py`.
