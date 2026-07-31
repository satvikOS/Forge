# OCCT drop ORDER — the dependency lattice, exactly

**Date:** 2026-07-31 · **ANALYSIS ONLY.** No file under `src/`, `include/`, or `CMakeLists.txt`
was created, modified or deleted. This report is the only artefact. Every number was measured
on this machine against `build/Release/forge-kernel.node` and
`build/Release/libforge_kernel_core.dylib` (both mtime 2026-07-30 23:47) and the **67** real
OCCT toolkit dylibs in `/opt/homebrew/opt/opencascade/lib` (OCCT 7.9.3), using `otool -l`,
`nm -u`, `nm -gU`, `c++filt`. Health was GREEN throughout (`/tmp/archie_health/status.json`,
`state=GREEN`); one worker at a time, never more than two concurrent subprocesses, no build run.

> **Concurrency note.** A *separate* session was editing `CMakeLists.txt` during this analysis
> (the TKShHealing P1 work — `build-shheal/`, `build-shheal-off/`, `test/healing_smoke.js`).
> It added 51 comment-only lines at ~line 209, shifting some line numbers mid-session. **This
> report did not make that edit** and touched no kernel file. All `CMakeLists.txt:N` citations
> below were re-verified against the file after that edit landed — md5
> `964424fca8722cfe83c4b71702f8c284`. If they drift again, the quoted text is the anchor, not
> the number. Nothing in that edit changes any measurement here: it is comments only, the
> binary was not rebuilt, and closure stayed 14.

Baseline re-confirmed before and after, unchanged:

```
bash scripts/occt_closure_count.sh   OCCT_DIRECT = 8   OCCT_CLOSURE = 14   OCCT_PHANTOM = 2
node test/ft/ft_unified_edit.mjs  -> 20 passed
node test/directedit.mjs          -> 9/9 DirectEdit tests passed
node test/ft/ft_smoke.mjs         -> ===== ALL PASS =====
```

---

## 0. Headline

**The zero-symbol claim for all four pure-transitive libraries is CONFIRMED, and more strongly
than `OCCT_CLOSURE_TRUTH.md` stated it.** It holds not only for *exclusive* symbols but for the
*raw* intersection, against **both** binaries, swept against **all 67** installed toolkits. There
is no correction to report on that point.

The real finding is structural, and it is stronger than a ranking:

> **Every one of the 14 libraries has EXACTLY ONE minimal cut set, and those 14 cut sets form a
> totally-ordered nested chain. The drop order is not a choice to be optimised — the lattice
> admits precisely one cost-optimal sequence, and any deviation from it is provably worth zero
> closure.**

Exhaustive enumeration of all **1024** drop sets over the 10 droppable toolkits produces a Pareto
front whose every member is a strict superset of the previous one. There is no alternative route,
no trade-off, no set that collapses several leaves "instead of" another. The lattice is a ladder,
and it has exactly one foot of stairs.

Two consequences the current roadmap does not carry:

1. **The four pure-transitives are never scheduled and never budgeted.** They cost zero marginal
   work. TKBool falls out at step 2, TKPrim at step 3, TKGeomAlgo at step 5, TKGeomBase at step 6
   — each as a free rider on a cut made for an entirely different reason. They are 4 of the 14
   closure points (29% of the whole north star) and their line item in any plan is **£0**.
   The premise that they are "potentially the cheapest closure reduction available" is *true as
   an accounting fact and unactionable as a work item*: there is nothing to build for them.
2. **A second cheapest-first trap is latent at step 5**, structurally identical to the TKFillet
   one already caught. TKBRep (81 symbols) is cheaper than TKTopAlgo (97) and a naive
   symbol-ranked plan takes it first — for **zero** closure, because TKTopAlgo `DT_NEED`s TKBRep
   and drags it straight back in (§4.3). The trap that produced five phantom drops in the
   historical ledger is still armed.

And one honest effort correction that changes the schedule more than the topology does (§6):

3. **`OCCT_CLOSURE_TRUTH.md:208-210` says the TKOffset gap is "wiring at 17 OCCT-typed call sites,
   not new algorithms". Measured, that is not the case.** Of TKOffset's 9 API families, **seven
   have no OCCT-typed native peer at all** — their engines (`Loft.cpp`, `Sweep.cpp`, `Draft.cpp`,
   `OffsetShape.cpp`, `Section.cpp`, `SurfaceFill.cpp`, `LoftSweep.cpp`) contain **zero**
   references to `TopoDS` and cannot accept an OCCT shape. The one family that does have a
   boundary-native peer (`NativeThickSolid.cpp`) **is not in `CMakeLists.txt`** and has never been
   compiled. This is wiring only if a bridge exists; it does not.

---

## 1. Verification of the zero-symbol claim (task item 1)

### 1.1 Method — deliberately broader than the original

`OCCT_CLOSURE_TRUTH.md:85-89` measured *exclusive* symbols: needed ∩ exported, minus every other
closure library's exports. That subtraction can only ever *lower* a count, so a lib could show
exclusive = 0 while still being genuinely called, if another toolkit happened to re-export the
same symbol. To close that hole I measured the **raw** intersection instead, and widened the
scope on three axes:

| axis | `OCCT_CLOSURE_TRUTH.md` | this report |
|---|---|---|
| binary | `.node` | `.node` **∪** `libforge_kernel_core.dylib` (union of undefined sets) |
| candidate owners | the 14 closure libs | **all 67** installed OCCT toolkits |
| metric | exclusive (post-subtraction) | **raw** intersection, *and* exclusive |

### 1.2 Result — confirmed, with no subtraction needed

790 undefined symbols across the two binaries; **507** resolve to an OCCT toolkit. Owner
histogram over all 67 toolkits:

| toolkit | symbols owned | | toolkit | symbols owned |
|---|---:|---|---|---:|
| TKG3d | 138 | | TKMath | 26 |
| TKTopAlgo | 97 | | TKernel | 25 |
| TKBRep | 81 | | TKShHealing | 20 |
| TKOffset | 42 | | TKFillet | 11 |
| TKG2d | 36 | | **TKBool** | **0** |
| TKBO | 31 | | **TKPrim** | **0** |
| | | | **TKGeomAlgo** | **0** |
| | | | **TKGeomBase** | **0** |

Total 507. Three corroborating checks, all clean:

- **Symbols exported by more than one toolkit: 0.** So raw ≡ exclusive for all 14; the original
  subtraction was a no-op and could not have masked anything.
- **OCCT-named undefined symbols with no owning toolkit: 0.** Nothing is referenced that no
  installed toolkit provides.
- **Symbols owned only by a toolkit outside the 14-closure: 0.** No 15th library is latently
  required; the closure is complete, and a Linux strict-link build needs no toolkit beyond these.

**TKBool, TKPrim, TKGeomAlgo and TKGeomBase are called zero times, by either binary, under the
broadest available definition of "called". Claim verified, not corrected.**

### 1.3 The one contradiction found, and its resolution

`BRepPrimAPI_*` is a **TKPrim** API, and it appears in **19 source files** across `src/` and
`include/` — `Primitives.cpp`, `Features.cpp`, `DirectModeling.cpp`, `SheetMetal.cpp`, `Mold.cpp`,
`NativeOcctBridge.cpp` and more. On its face that refutes TKPrim = 0.

It does not. Classifying every one of those references: **all 44 are on comment lines — 44/44,
in all 19 files.** They are provenance notes recording what was replaced, not calls. Confirmed at
the binary level:

```
nm -u  build/Release/forge-kernel.node | c++filt | grep -c BRepPrimAPI   -> 0
nm     build/Release/forge-kernel.node | c++filt | grep    BRepPrimAPI   -> (no output, any symbol type)
nm     build/Release/libforge_kernel_core.dylib  | c++filt | grep BRepPrimAPI -> (no output)
```

The K-PRIM drop (`CMakeLists.txt:309-315`) genuinely re-implemented the capability —
`src/OcctPrimBuilder.cpp` builds the canonical primitive solids from analytic `Geom_` surfaces via
`BRepBuilderAPI` — rather than deleting it. That is Law 9 satisfied. It is worth stating plainly
that **the four phantom drops were real engineering that was merely mis-scored**: the capability
was rebuilt natively in every case; only the *ledger arithmetic* was wrong. The work was not
wasted, and §5 below shows it is banked — it is why steps 5 and 6 are cheaper than they look.

---

## 2. The dependency lattice (task item 2)

### 2.1 Model, and why the phantoms sit on the root line

Closure is computed by BFS from the root's link line over the OCCT `DT_NEED` graph. The root's
line must be taken as **direct ∪ phantom = 10 toolkits**, not the 8 `otool` records:

```
TKBO  TKBRep  TKFillet  TKG2d  TKG3d  TKMath  TKOffset  TKShHealing  TKTopAlgo  TKernel
```

TKBO and TKG2d are on it because the binary calls 31 and 36 of their symbols. Modelling them as
absent would let the arithmetic "remove" a library the process still calls — the exact error the
closure metric exists to prevent. `CMakeLists.txt:206` is independent confirmation: in the
TKFillet-drop branch the build must `list(APPEND OCCT_LIBS TKBO TKG2d)` or it fails to link with
*"symbol(s) not found"*. The 10-lib model is the physical one.

The four pure-transitives are therefore **not droppable objects at all** — there is no link record
to remove and no call site to route. They are outputs of the lattice, never inputs.

### 2.2 Reverse edges — who `DT_NEED`s whom

| library | pulled into the process by |
|---|---|
| TKernel | `<root>` + all 13 others |
| TKMath | `<root>` + 12 others |
| TKG2d | TKBO TKBRep TKBool TKFillet TKG3d TKGeomAlgo TKGeomBase TKOffset TKPrim TKShHealing TKTopAlgo |
| TKG3d | `<root>` TKBO TKBRep TKBool TKFillet TKGeomAlgo TKGeomBase TKOffset TKPrim TKShHealing TKTopAlgo |
| TKGeomBase | TKBO TKBRep TKBool TKFillet TKGeomAlgo TKOffset TKPrim TKShHealing TKTopAlgo |
| TKBRep | `<root>` TKBO TKBool TKFillet TKGeomAlgo TKOffset TKPrim TKShHealing TKTopAlgo |
| TKGeomAlgo | TKBO TKBool TKFillet TKOffset TKPrim TKShHealing TKTopAlgo |
| TKTopAlgo | `<root>` TKBO TKBool TKFillet TKOffset TKPrim TKShHealing |
| TKShHealing | `<root>` TKBO TKBool TKFillet TKOffset |
| TKPrim | TKBO TKBool TKFillet TKOffset |
| TKBO | TKBool TKFillet TKOffset |
| TKBool | TKFillet TKOffset |
| TKFillet | `<root>` TKOffset |
| **TKOffset** | **`<root>` only** ← the only library with a single parent |

### 2.3 Minimal cut sets — one each, no alternatives

For each library, every subset of the 10 was tested and non-minimal ones discarded. The result is
the sharpest fact in this report:

| library | own syms | # distinct minimal cuts | the unique minimal cut | cum. syms |
|---|---:|---:|---|---:|
| TKOffset | 42 | **1** | {TKOffset} | 42 |
| **TKBool** | **0** | **1** | {TKFillet, TKOffset} | 53 |
| TKFillet | 11 | **1** | {TKFillet, TKOffset} | 53 |
| **TKPrim** | **0** | **1** | {TKBO, TKFillet, TKOffset} | 84 |
| TKBO | 31 | **1** | {TKBO, TKFillet, TKOffset} | 84 |
| TKShHealing | 20 | **1** | {TKBO, TKFillet, TKOffset, TKShHealing} | 104 |
| **TKGeomAlgo** | **0** | **1** | {TKBO, TKFillet, TKOffset, TKShHealing, TKTopAlgo} | 201 |
| TKTopAlgo | 97 | **1** | {TKBO, TKFillet, TKOffset, TKShHealing, TKTopAlgo} | 201 |
| **TKGeomBase** | **0** | **1** | {TKBO, TKBRep, TKFillet, TKOffset, TKShHealing, TKTopAlgo} | 282 |
| TKBRep | 81 | **1** | {TKBO, TKBRep, TKFillet, TKOffset, TKShHealing, TKTopAlgo} | 282 |
| TKG3d | 138 | **1** | + TKG3d | 420 |
| TKG2d | 36 | **1** | + TKG2d | 456 |
| TKMath | 26 | **1** | + TKMath | 482 |
| TKernel | 25 | **1** | + all 10 | 507 |

Every cut in this column is a subset of the one below it. **This is a chain, not a lattice with
branches** — which is why "choose the drop order correctly rather than by guesswork" has a unique
answer rather than a preferred one.

### 2.4 Exhaustive drop-set enumeration — 1024 sets

Reachable closure values are **14, 13, 11, 9, 8, 6, 4, 3, 2, 1, 0**. Closure 12, 10, 7 and 5 are
**unreachable by any subset whatsoever** — the graph steps over them, because cuts that release a
paying library release a free rider in the same move.

**Every single drop, ranked by Δclosure:**

| route native | syms | resulting closure | **Δclosure** |
|---|---:|---:|---:|
| **TKOffset** | 42 | **13** | **−1** |
| TKFillet | 11 | 14 | 0 |
| TKShHealing | 20 | 14 | 0 |
| TKernel | 25 | 14 | 0 |
| TKMath | 26 | 14 | 0 |
| TKBO | 31 | 14 | 0 |
| TKG2d | 36 | 14 | 0 |
| TKBRep | 81 | 14 | 0 |
| TKTopAlgo | 97 | 14 | 0 |
| TKG3d | 138 | 14 | 0 |

**Nine of ten single drops are worth zero.** *(Task item 2, "which single drop reduces the
closure most": **TKOffset**, and it is the only one that reduces it at all.)*

**Best pairs:**

| pair | syms | closure | Δ | free riders |
|---|---:|---:|---:|---|
| **TKFillet + TKOffset** | **53** | **11** | **−3** | **TKBool** |
| TKOffset + TKShHealing | 62 | 13 | −1 | — |
| TKOffset + TKernel | 67 | 13 | −1 | — |
| TKMath + TKOffset | 68 | 13 | −1 | — |
| TKBO + TKOffset | 73 | 13 | −1 | — |
| TKFillet + TKShHealing | 31 | 14 | 0 | — |

*(Task item 2, "which PAIR": **{TKFillet, TKOffset}** — −3 for 53 symbols, and it is
simultaneously the cheapest pair in symbols among all pairs that move the number at all. It is
the best value in the entire build at **17.7 symbols per closure point**.)*

**Best triple, and the answer to "is there a set whose removal collapses several leaves at once":**

| triple | syms | closure | Δ | free riders |
|---|---:|---:|---:|---|
| **TKBO + TKFillet + TKOffset** | **84** | **9** | **−5** | **TKBool, TKPrim** |
| TKFillet + TKOffset + TKShHealing | 73 | 11 | −3 | TKBool |

**Yes — {TKBO, TKFillet, TKOffset} is that set.** 84 symbols removes **five** of the fourteen: the
three routed, plus TKBool and TKPrim for free. It is 36% of the north star for 17% of the symbol
budget, and it is the single most leveraged commitment available anywhere in the programme.

### 2.5 The closure ladder — cheapest set reaching each level

| target closure | cheapest cut set | cum. syms | libraries gone |
|---:|---|---:|---|
| 14 | (none) | 0 | — |
| **13** | {TKOffset} | **42** | TKOffset |
| **11** | {TKFillet, TKOffset} | **53** | + TKFillet, **TKBool** |
| **9** | {TKBO, TKFillet, TKOffset} | **84** | + TKBO, **TKPrim** |
| 8 | + TKShHealing | 104 | + TKShHealing |
| 6 | + TKTopAlgo | 201 | + TKTopAlgo, **TKGeomAlgo** |
| 4 | + TKBRep | 282 | + TKBRep, **TKGeomBase** |
| 3 | + TKG3d | 420 | + TKG3d |
| 2 | + TKG2d | 456 | + TKG2d |
| 1 | + TKMath | 482 | + TKMath |
| **0** | + TKernel | **507** | + TKernel |

This reproduces §4.2 of `OCCT_CLOSURE_TRUTH.md` exactly, by independent enumeration rather than
by hand. That report's ladder is correct.

---

## 3. The ordered drop plan (task item 3)

Effort per closure point, along the unique optimal chain:

| # | route native | syms | closure | free riders | **syms / closure point** |
|---:|---|---:|---|---|---:|
| 1 | TKOffset | 42 | 14 → 13 | — | 42.0 |
| 2 | **TKFillet** | **11** | 13 → 11 | **TKBool** | **5.5** ★ best in build |
| 3 | TKBO | 31 | 11 → 9 | **TKPrim** | 15.5 |
| 4 | TKShHealing | 20 | 9 → 8 | — | 20.0 |
| 5 | TKTopAlgo | 97 | 8 → 6 | **TKGeomAlgo** | 48.5 |
| 6 | TKBRep | 81 | 6 → 4 | **TKGeomBase** | 40.5 |
| 7 | TKG3d | 138 | 4 → 3 | — | 138.0 |
| 8 | TKG2d | 36 | 3 → 2 | — | 36.0 |
| 9 | TKMath | 26 | 2 → 1 | — | 26.0 |
| 10 | TKernel | 25 | 1 → 0 | — | 25.0 |

Steps 1–3 are **84 symbols (17% of 507) for 5 closure points (36%)**. Steps 7–10 are
**225 symbols (44%) for 4 points (29%)**. The programme is strongly front-loaded — but only if
the order is followed, because 9 of the 10 first moves are worth nothing.

### Step-by-step, with the native capability each requires and whether it exists today

**Step 1 — TKOffset · 42 syms · 41 live call sites · closure 14 → 13**

Nine API families (`nm` + `c++filt`, symbol counts summing to 42), with live (non-comment)
call-site lines and the native peer, if any:

| family | syms | live sites | files | native peer | at the OCCT boundary? |
|---|---:|---:|---|---|---|
| `BRepOffsetAPI_ThruSections` (loft) | 6 | 10 | Airfoil, Features, LoftGuide, Primitives, binding | `Loft.cpp` `LoftSweep.cpp` | ✗ `TopoDS` = 0 |
| `BRepOffsetAPI_MakePipeShell` (guided sweep) | 7 | 5 | ClassASurfacing, Features | **none anywhere** | — |
| `BRepOffsetAPI_DraftAngle` | 6 | 2 | Features | `Draft.cpp` `DraftAnalytic.cpp` | ✗ `TopoDS` = 0 |
| `BRepOffsetAPI_MakeFilling` | 5 | 3 | DirectModeling, Healing | `SurfaceFill.cpp` `GregoryFill.cpp` | ✗ `TopoDS` = 0 |
| `BRepOffset_MakeOffset` | 5 | 2 | Features | `OffsetShape.cpp` | ✗ `TopoDS` = 0 |
| `BRepOffsetAPI_MakeOffset` (2-D wire) | 4 | 4 | Cam, Features, OffsetShape | `OffsetShape.cpp` | ✗ `TopoDS` = 0 |
| `BRepOffsetAPI_MakePipe` (sweep) | 3 | 9 | ClassASurfacing, Features | `Sweep.cpp` `HelicalSweep.cpp` | ✗ `TopoDS` = 0 |
| `BRepOffsetAPI_MakeThickSolid` | 3 | 4 | Features, Shell | `NativeThickSolid.cpp` | ✓ `TopoDS` = 28 — **NOT COMPILED** |
| `BRepOffsetAPI_MakeOffsetShape` | 3 | 2 | Features, OffsetShape | `NativeThickSolid.cpp` | ✓ — **NOT COMPILED** |

Symbol counts sum to exactly 42 and live sites to exactly 41 (both verified by longest-match
bucketing of the demangled `nm -u` set, zero unassigned).

Exists today: **almost none of what is needed at the boundary.** `grep -c TopoDS
src/native/brep/NativeThickSolid.cpp` = 28 and it is the *only* TKOffset-family engine that speaks
OCCT — and `grep -n NativeThickSolid CMakeLists.txt` returns **nothing**, so it has never been
built (matching `reports/TKOFFSET_DECOMPOSITION.md` §4.4). One family, `MakePipeShell`, has no
native engine at all. This is step 1 and it is the hardest-per-point step of the first four.

**Step 2 — TKFillet · 11 syms · closure 13 → 11 (+ TKBool free)**

Needs: general multi-adjacent-edge and curved-face const-radius fillet + chamfer on an arbitrary
`TopoDS_Shape`. Exists today: **substantially.** `NativeFilletChamfer.cpp` (810 L, `TopoDS` = 109)
and `NativeVariableFillet.cpp` (`TopoDS` = 81) are compiled (`CMakeLists.txt:812-813`) and
correctly at the OCCT boundary. Gated OFF at `CMakeLists.txt:182-184` for one precise reason,
documented at `CMakeLists.txt:174-181` and visible in the code: the engine defers on
`"adjacent face A is not planar"` / `"edge is not a straight line"`
(`src/native/brep/NativeFilletChamfer.cpp:356-358`), which the drop gate's *fillet ALL box edges*
case trips the moment a shared face carries a prior blend arc. Corner ball-blend + arced-face
retrim is the whole remaining gap. **Best value in the build; must be banked with step 1 and
never scored alone.**

**Step 3 — TKBO · 31 syms · 66 live call sites · closure 11 → 9 (+ TKPrim free)**

Needs: native `Fuse`/`Cut`/`Common`/`Section`/`Splitter`/`Defeaturing` on OCCT-typed shapes.
Exists today: **the algorithm, yes; the boundary, no.** `src/native/brep/Boolean.cpp` is 1918
lines and `grep -c TopoDS` returns **0** — it is a complete native boolean engine that cannot
accept a `TopoDS_Shape`. The 66 live call sites span `Booleans.cpp`, `BooleanTol.cpp`,
`DirectEdit.cpp`, `DirectModeling.cpp`, `Features.cpp`, `Mold.cpp`, `SheetMetal.cpp`,
`Drawings.cpp`, `Nurbs.cpp`, `Weldments.cpp`, `InterferenceDetection.cpp`. Bridging them through
`NativeOcctBridge.cpp` hits the known lossy path: `importOcctSolid` defers on NURBS/torus/
non-analytic input, and the fallback tessellates (`src/NativeOcctBridge.cpp:322-347`,
*"tessellate the native solid and build a watertight OCCT faceted solid from the welded triangle
soup"*) — the faceted-export regression already recorded in the K6/K7 history. **TKBO is gated on
the lossless boundary, i.e. on K7, not on boolean mathematics.**

**Step 4 — TKShHealing · 20 syms · closure 9 → 8**

Needs: native `ShapeFix_Shape`, `ShapeAnalysis_Surface/_Curve`, `ShapeUpgrade_UnifySameDomain` on
OCCT shapes. Exists today: **partially, and honestly scored.** `FORGE_SHHEAL_DROP_NATIVE` is
default ON (`CMakeLists.txt:250-252`) and already routes 8 of the 20 (`ShapeFix_Solid`,
`ShapeAnalysis_Shell`, `ShapeAnalysis_FreeBounds`) onto `NativeShapeHeal.cpp` (`TopoDS` = 25) and
`NativeShapeHealBridge.cpp` (`TopoDS` = 9). The remaining 12 are all blocked on the STEP reader
(`ShapeFix_Shape` ×6 at `StepReadOcct.cpp:1581`, `ShapeAnalysis_Surface` ×2,
`ShapeAnalysis_Curve` ×1, `ShapeUpgrade_UnifySameDomain` ×3). `CMakeLists.txt:243-249` already
states this partial drop is worth zero closure and must not be scored as a drop — that note is
correct and this analysis confirms it.

**Steps 5–10 — TKTopAlgo, TKBRep, TKG3d, TKG2d, TKMath, TKernel · 423 syms · closure 8 → 0**

Needs: replacing `TopoDS_Shape` and `Handle(Geom_*)`/`Handle(Geom2d_*)` as the kernel interchange
types — the K7 opaque-handle C-API. Exists today: **not started.** The three "already dropped"
toolkits TKG2d, TKGeomBase and TKGeomAlgo are, per §2.3, among the *last* able to leave, at 456 /
282 / 201 cumulative symbols. Note the banked credit here: steps 5 and 6 release TKGeomAlgo and
TKGeomBase **for free** precisely because the R1/R2/R3 native geometry work
(`CMakeLists.txt:283-307`) already removed our own references to them. That work was mis-scored,
not wasted.

---

## 4. What this changes, and the trap that is still armed

### 4.1 Agreement with `OCCT_CLOSURE_TRUTH.md`

Independently re-derived and confirmed: closure = 14; direct = 8; phantom = {TKBO 31, TKG2d 36};
the four zero-symbol libraries; every minimal cut set in §3 of that report; the entire §4.2
ladder; and the §4.3 ordering. Two additions: the cut sets are **unique** (that report did not
establish uniqueness, which is what removes ordering risk entirely), and the effort premise for
step 1 is wrong in the direction of *harder* (§6).

### 4.2 The free riders, priced

| free rider | arrives at step | marginal cost | scheduled work |
|---|---|---:|---|
| TKBool | 2 (with TKFillet) | **0** | **none — do not plan any** |
| TKPrim | 3 (with TKBO) | **0** | **none** |
| TKGeomAlgo | 5 (with TKTopAlgo) | **0** | **none** |
| TKGeomBase | 6 (with TKBRep) | **0** | **none** |

Four of fourteen closure points — 29% of the north star — for zero marginal symbols. They are the
cheapest closure reduction in the build, exactly as the premise supposed. They are also
**unactionable**: no task can be opened against them. The correct treatment is a line in the
ledger that credits steps 2, 3, 5 and 6 with *two* points each instead of one, so the leveraged
steps are not under-valued by a plan that counts only the library being routed.

### 4.3 The cheapest-first trap is still armed — at step 5

Naive symbol-count ranking (which is what `reports/KERNEL_DROP_MASTER_PLAN.md` uses) versus the
correct next move, evaluated at every state on the chain:

| state | closure | naive cheapest pick | its Δ | correct pick | its Δ |
|---:|---:|---|---:|---|---:|
| 0 | 14 | TKFillet (11) | **0** ✗ | **TKOffset** (42) | −1 |
| 1 | 13 | TKFillet (11) | −2 ✓ | TKFillet | −2 |
| 2 | 11 | TKShHealing (20) | **0** ✗ | **TKBO** (31) | −2 |
| 3 | 9 | TKShHealing (20) | −1 ✓ | TKShHealing | −1 |
| 4 | 8 | TKernel (25) | **0** ✗ | **TKTopAlgo** (97) | −2 |
| 5 | 6 | TKernel (25) | **0** ✗ | **TKBRep** (81) | −2 |
| 6 | 4 | TKernel (25) | **0** ✗ | **TKG3d** (138) | −1 |
| 7 | 3 | TKernel (25) | **0** ✗ | **TKG2d** (36) | −1 |
| 8 | 2 | TKernel (25) | **0** ✗ | **TKMath** (26) | −1 |
| 9 | 1 | TKernel (25) | −1 ✓ | TKernel | −1 |

**The naive ranking is wrong at 7 of 10 states.** The step-5 case is the one to flag now, because
it looks locally sound and is not: TKBRep (81) is cheaper than TKTopAlgo (97), so a symbol-ranked
plan takes TKBRep first — and gets **zero**, because `TKTopAlgo -> TKBRep` re-imports it
immediately (§2.2). That is the identical mechanism that produced the five phantom drops in the
historical ledger. It has not been disarmed; it has only moved downstream.

**The rule that disarms it permanently:** a drop is proposed only if it is the *next* element of
the §3 chain. Cheapness is never a reason to reorder, because the chain is unique.

---

## 5. Reachability inside the 7-day window (task item 4)

Window: 2026-07-31 → ~2026-08-06.

### Reachable: at most ONE of the fourteen — TKOffset — and it is at risk

TKOffset is the only library whose removal is not gated on another library leaving first
(§2.2: its sole parent is `<root>`). So it is the only one of the 14 that *can* leave in any
window, at any effort. Nothing else is even a candidate: every other library's minimal cut
contains TKOffset.

Honest assessment of TKOffset itself: **unlikely, and I would not plan on it.** It is 42 symbols
across **nine unrelated API families** with 41 live call sites in 11 files, and per §3 the native
side is weaker than the roadmap records — seven of nine families have no OCCT-typed peer, the one
family that does (`NativeThickSolid.cpp`) is not in the build, and one family
(`BRepOffsetAPI_MakePipeShell`, guided pipe-shell sweep, 7 symbols, 5 sites) has **no native
engine anywhere in the tree**. Partial completion is worth exactly zero: closure moves at 42/42
or not at all.

### Not reachable: the other thirteen

| library | blocked on | why not in 7 days |
|---|---|---|
| TKBool, TKFillet | {TKFillet, TKOffset} = 53 syms | needs all of TKOffset **plus** the general multi-adjacent-edge/curved fillet that has been attempted and reverted before |
| TKBO, TKPrim | {TKBO, TKFillet, TKOffset} = 84 | + the lossless native↔OCCT boundary; today the bridge tessellates (`NativeOcctBridge.cpp:322-347`) |
| TKShHealing | 104 | + the STEP-reader heal (12 symbols at `StepReadOcct.cpp:1581`, needs pcurve synthesis + seam reconcile) |
| TKTopAlgo, TKGeomAlgo | 201 | + a native topology builder/sewer/classifier usable without `TopoDS_Shape` |
| TKBRep, TKGeomBase | 282 | + `TopoDS_Shape` replaced as the interchange type (K7) |
| TKG3d, TKG2d, TKMath, TKernel | 420–507 | + `Handle(Geom_*)` and `Handle(Geom2d_*)` replaced; K7 complete |

### What the window should therefore be spent on

Since the only closure-moving target is improbable, the highest-value use of the window is the
step that is **cheapest per point and nearly done** — TKFillet's corner ball-blend and arced-face
retrim (§3 step 2, 5.5 syms/point, engine already compiled and already at the OCCT boundary) —
**banked, not shipped as a drop.** Completing it converts step 2 from a blocker into a same-day
follow-on the moment TKOffset lands, and it is the one piece of the first three steps that does
not depend on a bridge that does not yet exist.

**Recommended ledger line for CI, unchanged this window:**

```yaml
- run: bash forge-kernel/scripts/occt_closure_count.sh --assert-closure 14
```

Lower the constant to 13 only when all 42 TKOffset symbols are gone; to 11 only with TKFillet
banked alongside. It cannot be satisfied by moving a dependency behind another library.

---

## 6. Corrections to the record

1. **`OCCT_CLOSURE_TRUTH.md:208-210`** — *"the gap is wiring at 17 OCCT-typed call sites, not new
   algorithms"* for TKOffset. Measured: 41 live call-site lines, and seven of nine families have
   native engines with **zero** `TopoDS` references, i.e. no OCCT-typed entry point to wire to.
   `NativeThickSolid.cpp` — the only boundary-native TKOffset peer — is absent from
   `CMakeLists.txt`. Step 1 is materially harder than the note implies. Everything topological in
   that report stands; only this effort premise does not.
2. **`reports/KERNEL_DROP_MASTER_PLAN.md`** — ranks by exclusive-symbol count ascending. Per §4.3
   that ranking is wrong at 7 of 10 decision points, including a live trap at step 5 (TKBRep
   before TKTopAlgo). It should be replaced by the §3 chain, which is unique and therefore not a
   ranking at all.
3. **No correction to the zero-symbol claim.** All four verified zero under the broadest test
   available. The 19 files referencing `BRepPrimAPI_*` are 44/44 comments; the capability was
   genuinely re-implemented in `src/OcctPrimBuilder.cpp`, satisfying Law 9.

---

## 7. Caveats

- Closure is measured from static load commands; a `dlopen`ed library would not appear. Nothing in
  the kernel does that, but this cannot prove it.
- The lattice, the 1024-set enumeration, the cut sets and the ladder are **exact** over the
  measured graph. They assume a cut library is *fully* routed native — a single remaining call
  site keeps the library and its whole subtree, and the step is worth zero.
- Symbol counts are an effort **proxy**, and §3/§6 show the proxy is unreliable in both
  directions: TKFillet's 11 symbols understate a hard blend problem, and TKOffset's 42 span nine
  unrelated algorithms. The **ordering** is driven by closure topology and is exact; the **cost**
  column is not.
- Measured against one build configuration (`FORGE_FILLET_DROP_NATIVE=OFF`,
  `FORGE_SHHEAL_DROP_NATIVE=ON`, `FORGE_GEOM_DROP_NATIVE=ON`, `FORGE_NATIVE_BREP=ON`). Under
  `FORGE_FILLET_DROP_NATIVE=ON` the direct count rises to 9 (`CMakeLists.txt:206`); the closure
  stays 14.
