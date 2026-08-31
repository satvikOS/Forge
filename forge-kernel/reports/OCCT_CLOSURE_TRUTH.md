# OCCT closure truth — the ledger number is 14, not 8

> **QUALIFICATION added by the integrator, same day, after independent verification.**
> The drop is REAL and PROVEN, and it is CONDITIONAL. All five enabling options —
> `FORGE_OFFSET_DROP_MAKEOFFSET`, `FORGE_THICKSOLID_DROP_NATIVE`, `FORGE_OFFSETSHAPE_DROP_NATIVE`,
> `FORGE_THICKEN_DROP_NATIVE`, `FORGE_DRAFT_DROP_NATIVE` — **default OFF**, and the diff itself says
> the result holds "with every option in this file ON".
>
> So the honest pair of numbers is:
>   * **default build: OCCT_CLOSURE = 14**, TKOffset still linked — this is what ships today;
>   * **all drop options ON: OCCT_CLOSURE = 13**, TKOffset's 42 symbols at 0 and its link record gone.
>
> Defaulting them OFF is the RIGHT conservatism: flipping them changes which engine computes real
> geometry, and that is earned by the A/B corpus, not by a flag. But "the ledger number is now 13"
> must not be quoted without the condition, because for every user building this repo today it is
> still 14. The achievement is that the drop is now POSSIBLE and MEASURED, not that it has shipped.
>
> Verification trail: the artifact in the authoring worktree still linked TKOffset, which looked at
> first like a contradiction. It was built at 04:48:06 and the drop commit is 04:49:53 — stale by
> 107 seconds, not counter-evidence. Recorded because the next person to check will hit the same
> apparent contradiction.

> **UPDATE 2026-08-28 — the ledger number is now 13.** TKOffset has been dropped:
> its 42 symbols are at 0 and its link record is gone. §7 at the end of this file
> carries the measurement and the re-ranked path to zero. Everything above §7 is
> the 2026-07-31 record and is left as written.

**Date:** 2026-07-31 · **Analysis only.** No build was run, no source under `src/`,
`include/`, or `CMakeLists.txt` was modified. Two new files were created, both explicitly
requested: `scripts/occt_closure_count.sh` and this report. Every number below was measured
on this machine from `build/Release/forge-kernel.node` (mtime 2026-07-30 23:47) with
`otool`, `nm`, `c++filt`. Health was GREEN throughout; one sequential pass, no fleets.

---

## 0. Headline

```
$ bash scripts/occt_closure_count.sh
  OCCT_DIRECT  = 8    (LC_LOAD_DYLIB records — gameable, NOT the ledger number)
  OCCT_CLOSURE = 14   ★ libraries that actually LOAD at run time — THE LEDGER NUMBER
  OCCT_PHANTOM = 2    (closure libs whose symbols the binary CALLS with no link record)
```

`otool -L | grep -c opencascade` counts what the **linker wrote into the header**, not what
**dyld maps into the process**. The two diverge for two independent reasons, and both are
active here:

1. **Transitive survival.** A toolkit removed from `OCCT_LIBS` keeps loading if any
   still-linked toolkit `DT_NEED`s it. Five toolkits are in exactly this state.
2. **Masked usage.** The `.node` is linked `-undefined dynamic_lookup`, so the kernel can
   **call** a toolkit's symbols with *no link record at all*. Two toolkits are in this state,
   accounting for 67 live symbols.

Both effects make the direct count fall while the process is byte-for-byte unchanged.
`OCCT_CLOSURE` is immune to both: it cannot fall unless a library genuinely stops loading.

The same 8/14 split holds for `libforge_kernel_core.dylib`, so `build/forge_verify`
(which links only the core dylib) loads the identical 14. There is no artefact in the
build that sees fewer.

---

## 1. The measurement

### 1.1 Direct records — 8

```
$ otool -L build/Release/forge-kernel.node | grep opencascade
libTKernel  libTKMath  libTKG3d  libTKBRep  libTKTopAlgo  libTKShHealing  libTKOffset  libTKFillet
```

Matches `CMakeLists.txt:162-165` plus the conditional `list(APPEND OCCT_LIBS TKFillet)` at
`CMakeLists.txt:189` (appended because `FORGE_FILLET_DROP_NATIVE` defaults OFF).

### 1.2 Full load closure — 14

Transitive BFS over `LC_LOAD_DYLIB` / `LC_LOAD_WEAK_DYLIB` / `LC_REEXPORT_DYLIB` /
`LC_LOAD_UPWARD_DYLIB`, resolving `@rpath` and `@loader_path`:

```
TKBO  TKBRep  TKBool  TKFillet  TKG2d  TKG3d  TKGeomAlgo
TKGeomBase  TKMath  TKOffset  TKPrim  TKShHealing  TKTopAlgo  TKernel
```

**14.** This confirms the figure asserted in `reports/SACROSANCT_STATUS_2026-07-30.md`
and independently re-derives §1b of `reports/OCCT_ZERO_NEXT_STEP_2026-07-30.md:168-210`,
which had already identified the same 6 hidden toolkits. That section was correct and was
not carried into the roadmap's headline number.

### 1.3 The 6 hidden libraries, with parents and masked call volume

| hidden lib | pulled into the process by | symbols the `.node` calls directly | status |
|---|---|---:|---|
| **TKBO** | TKFillet, TKOffset *(direct)*; TKBool | **31** | phantom-direct — load-bearing |
| **TKG2d** | TKBRep, TKG3d, TKTopAlgo, TKShHealing, TKOffset, TKFillet *(direct)*; +5 hidden | **36** | phantom-direct — load-bearing |
| **TKBool** | TKFillet, TKOffset *(direct)* | 0 | pure transitive |
| **TKPrim** | TKFillet, TKOffset *(direct)*; TKBO, TKBool | 0 | pure transitive |
| **TKGeomAlgo** | TKOffset, TKShHealing, TKTopAlgo, TKFillet *(direct)*; TKBO, TKBool, TKPrim | 0 | pure transitive |
| **TKGeomBase** | TKBRep, TKOffset, TKShHealing, TKTopAlgo, TKFillet *(direct)*; TKBO, TKBool, TKPrim, TKGeomAlgo | 0 | pure transitive |

The masked symbols are real kernel work, not incidental references:

- **TKBO (31):** `BRepAlgoAPI_Fuse` / `Cut` / `Common` / `Section` / `Splitter` /
  `Defeaturing`, `BRepAlgoAPI_BooleanOperation::Build`, `BOPAlgo_Algo`, `BOPAlgo_Options::SetFuzzyValue`.
  These are the boolean engine and the defeaturing primitive.
- **TKG2d (36):** `Geom2d_BSplineCurve` (11), `Geom2d_BezierCurve` (8), `Geom2d_Line`,
  `Geom2d_Circle`, `Geom2d_Ellipse`, `Geom2d_Conic`, `Geom2d_TrimmedCurve` — the pcurve layer.

Per-toolkit exclusivity, measured (`nm -u` on the `.node` ∩ `nm -gU` on each lib, minus the
union of all other closure libs' exports): no needed symbol is exported by two toolkits, so
"needed" and "exclusive" coincide for all 14. Counts: TKG3d 138, TKTopAlgo 97, TKBRep 81,
TKOffset 42, **TKG2d 36**, **TKBO 31**, TKMath 26, TKernel 25, TKShHealing 20, TKFillet 11;
TKGeomBase / TKGeomAlgo / TKPrim / TKBool = **0**.

---

## 2. Audit of the historical ledger

Twelve toolkits are recorded as dropped in `CMakeLists.txt`. Seven actually left the process.
**Five are still loading today.**

| ledger entry | claim | in closure now? | verdict |
|---|---|---|---|
| TKDEIGES / TKDESTL / TKDEVRML `CMakeLists.txt:299` | 22 → 19 | no | **real** ×3 |
| TKBool `CMakeLists.txt:303` | 17 → 16 | **yes** | **phantom** |
| TKMesh `CMakeLists.txt:313` | 16 → 15 | no | **real** |
| TKG2d `CMakeLists.txt:328` | 15 → 14, "FIRST real toolkit drop" | **yes** | **phantom** |
| TKHLR `CMakeLists.txt:289` | 14 → 13 | no | **real** |
| TKDESTEP + TKXSBase `CMakeLists.txt:276` | 13 → 11 | no | **real** ×2 |
| TKPrim `CMakeLists.txt:258` | 11 → 10 | **yes** | **phantom** |
| TKGeomBase `CMakeLists.txt:208` | 10 → 9 | **yes** | **phantom** |
| TKGeomAlgo `CMakeLists.txt:240` | 9 → 8 | **yes** | **phantom** |

The five phantom drops moved the direct count by 5 and the closure by **0**.

This was not concealed — the CMakeLists says so in two places. `CMakeLists.txt:16` on TKG2d:
*"it still loads transitively (TKBRep DT_NEEDs it) but the .node no longer names it → otool
14"*. `CMakeLists.txt:209` on TKGeomBase: *"still loads transitively — TKBRep/TKG3d/TKGeomAlgo
DT_NEED it"*. The information was recorded at the call site and discarded by the headline
metric. That is the whole failure: **the ledger quoted a number that the notes beside it
already contradicted.**

Note also that the four toolkits with **zero** exclusive symbols — TKGeomBase, TKGeomAlgo,
TKPrim, TKBool — are precisely four of the five phantom drops. A toolkit the kernel calls no
symbol from was never going to leave the process by being removed from the link line; nothing
was holding it there *except* other toolkits.

---

## 3. Per hidden library: who pulls it, and what removes it

Removing a library from the closure requires cutting **every** inbound edge. Since the hidden
libs are pulled only by other OCCT toolkits, each one is gated on a *set* of direct drops.
Minimal cut sets, computed exhaustively over all subsets:

| hidden lib | minimal cut (all must be routed native) | native capability that does it | cum. symbols |
|---|---|---|---:|
| **TKBool** | {TKFillet, TKOffset} | none of its own — it is pure overhead. Needs only the fillet/chamfer engine and the offset/thicken/draft/loft/sweep engine to stop being linked. | 53 |
| **TKPrim** | {TKBO, TKFillet, TKOffset} | + a native boolean engine (fuse/cut/common/section/splitter) and native defeaturing on OCCT-typed shapes. | 84 |
| **TKBO** | {TKBO, TKFillet, TKOffset} | same as TKPrim — TKBO must *additionally* be routed native itself, because the kernel calls it directly (31 masked symbols). | 84 |
| **TKGeomAlgo** | {TKBO, TKFillet, TKOffset, TKShHealing, TKTopAlgo} | + native `ShapeFix`/`ShapeAnalysis` and a native topology builder / sewer / classifier / validator usable without `TopoDS_Shape`. | 201 |
| **TKGeomBase** | {TKBO, TKBRep, TKFillet, TKOffset, TKShHealing, TKTopAlgo} | + replacing `TopoDS_Shape` as the kernel interchange type (the K7 opaque-handle C-API). | 282 |
| **TKG2d** | {TKBO, TKBRep, TKFillet, TKG2d, TKG3d, TKOffset, TKShHealing, TKTopAlgo} | + replacing `Handle(Geom_*)` as the surface/curve interchange type, **and** a native 2-D pcurve type to replace `Handle(Geom2d_Curve)`. | 456 |

The two phantom-direct libraries need work on both fronts: their own call sites routed native
**and** their parents dropped. Routing only the call sites (making them "not directly used")
changes nothing — they still load. Dropping only the parents changes nothing — the kernel
still calls them, and on Linux strict-link that is a hard link error, not a silent success.

---

## 4. Re-ranking by closure — this differs sharply from the current plan

**It differs sharply. Stating that plainly, as asked.**

The current recommendation is `reports/OCCT_ZERO_NEXT_STEP_2026-07-30.md:267`:
*"## 3. The single highest-value next drop: **TKFillet** (otool 8 → 7)"*.
`reports/KERNEL_DROP_MASTER_PLAN.md` ranks the same way — by exclusive-symbol count ascending,
cheapest leaf first: TKGeomBase 4, TKFillet 11, TKShHealing 20, TKGeomAlgo 24.

Under closure accounting that ranking inverts at the top.

### 4.1 What each single drop is actually worth

| route native | exclusive syms | Δ direct | **Δ closure** | why |
|---|---:|---:|---:|---|
| TKFillet | 11 | **+1** (8→9) | **0** | still loaded — `TKOffset` DT_NEEDs it. And per `CMakeLists.txt:192-206`, dropping it forces `TKBO` + `TKG2d` onto the link line, so the *direct* count rises. |
| TKShHealing | 20 | −1 | **0** | still loaded via TKBO / TKBool / TKFillet / TKOffset. |
| TKernel | 25 | −1 | **0** | still loaded via all 13 others. |
| TKMath | 26 | −1 | **0** | still loaded via all 13 others. |
| TKBO | 31 | 0 | **0** | not on the link line at all; still loaded via TKFillet / TKOffset. |
| TKG2d | 36 | 0 | **0** | already "dropped"; still loaded via 11 parents. |
| **TKOffset** | **42** | **−1** | **−1** | ★ **the only library in the build whose sole parent is the `.node` itself.** |
| TKBRep | 81 | −1 | **0** | still loaded via 8 parents. |
| TKTopAlgo | 97 | −1 | **0** | still loaded via 7 parents. |
| TKG3d | 138 | −1 | **0** | still loaded via 10 parents. |

**Nine of the ten cheapest drops are worth zero.** `TKOffset` is the only single move that
reduces the closure, and the old ranking placed it fifth.

The `TKFillet` row is the sharpest reversal: it is the current #1 recommendation, and it is
worth **0 closure and +1 direct**. It is the only candidate that makes the *reported* number
worse while making the *real* number no better. Note the repo currently contradicts itself
here — `OCCT_ZERO_NEXT_STEP_2026-07-30.md:267` says the drop is "otool 8 → 7" while
`CMakeLists.txt:192` says "does not take the count 8 -> 7. It takes it 8 -> 9". CMakeLists is
right on the direct count; both are wrong on the closure, which is unchanged at 14.

This does not mean the TKFillet work is wasted — it is a **prerequisite** for every cut below.
It means it must not be *scheduled or scored as a drop on its own*.

### 4.2 The closure ladder — cheapest cut reaching each level

There is no path that takes 14 → 13 → 12 → 11 one library at a time. The graph moves in steps:

| target closure | cut set (all routed native together) | cum. symbols |
|---:|---|---:|
| 14 | {TKFillet} — **no movement** | 11 |
| **13** | **{TKOffset}** | **42** |
| **11** | **{TKFillet, TKOffset}** → also frees TKBool | **53** |
| **9** | **{TKBO, TKFillet, TKOffset}** → also frees TKBool, TKPrim | **84** |
| 8 | {TKBO, TKFillet, TKOffset, TKShHealing} | 104 |
| 6 | + TKTopAlgo → also frees TKGeomAlgo | 201 |
| 4 | + TKBRep → also frees TKGeomBase | 282 |
| 3 | + TKG3d | 420 |
| 2 | + TKG2d | 456 |
| 1 | + TKMath | 482 |
| **0** | + TKernel | **507** |

### 4.3 Recommended order

1. **TKOffset (42 symbols) — new #1.** The only unilateral closure win, 14 → 13. Its engines
   already exist per `OCCT_ZERO_NEXT_STEP_2026-07-30.md:249-266` (`OffsetShape.cpp`,
   `NativeThickSolid.cpp`, `Draft.cpp`, `Loft.cpp`, `Sweep.cpp`, `NativeSectionFill.cpp`) —
   the gap is wiring at 17 OCCT-typed call sites, not new algorithms.
2. **TKFillet (11) immediately after — banked with TKOffset, never scored alone.** The pair
   costs 53 symbols and takes the closure 14 → **11**, because TKBool's only two parents are
   exactly these two. This is the best symbols-per-closure-point move in the build (17.7
   syms/point vs TKOffset-alone's 42).
3. **TKBO (31) third**, completing {TKBO, TKFillet, TKOffset} → closure **9**, and retiring
   TKPrim. 84 symbols for 5 closure points. This is where the native boolean engine has to
   land; it is currently invisible to the roadmap because TKBO has no link record.
4. **TKShHealing (20) fourth** → closure 8.
5. Everything past that is the K7 opaque-handle rewrite, as `OCCT_ZERO_NEXT_STEP_2026-07-30.md:216-248`
   already argues. The closure data supports that argument: TKG2d, TKGeomBase and TKGeomAlgo —
   all three recorded as *completed leaf drops* — are in fact among the **last** libraries that
   can leave, requiring 456, 282 and 201 symbols of foundation work respectively.

### 4.4 One correction to the north star

`sacrosanct.md:104` states the goal as `otool -L | grep opencascade == 0`. As measured, that
target is reachable while the process still maps 6+ OCCT dylibs and calls 67 of their symbols.
The honest north star is **`OCCT_CLOSURE == 0`**, which `scripts/occt_closure_count.sh
--assert-closure 0` checks directly. `OCCT_PHANTOM == 0` should be enforced alongside it —
on Linux strict-link a phantom is a build failure, so any drop that creates one is only
"passing" because of macOS `-undefined dynamic_lookup`.

---

## 5. The tool

`scripts/occt_closure_count.sh` — created by this analysis. Reports all three numbers so a
drop can never again be scored by hiding one library behind another.

```
bash scripts/occt_closure_count.sh [BINARY] [--json] [--quiet]
     [--assert-closure N] [--assert-direct N] [--assert-no-phantom]
```

- Defaults to `build/Release/forge-kernel.node` (or `$FORGE_KERNEL`).
- macOS: `otool -l` BFS with `@rpath`/`@loader_path` resolution. Linux: `objdump -p`/`readelf -d`.
  Written for bash 3.2 (the macOS system shell — no associative arrays).
- Exit 0 ok / 1 assertion exceeded / 2 binary or toolchain missing.
- Verified this session: reproduces 8 / 14 / 2 independently of the Python cross-check;
  identical result for `libforge_kernel_core.dylib`; `--assert-closure 14` → rc 0,
  `--assert-closure 13` → rc 1, `--assert-no-phantom` → rc 1, missing binary → rc 2;
  `--json` validates under `python3 -m json.tool`.

**Ledger rule going forward:** the roadmap quotes `OCCT_CLOSURE`. A drop counts only if that
number falls. `OCCT_DIRECT` stays visible so the divergence remains auditable, but it is not
the score.

Suggested CI line for `.github/workflows/kernel-tests.yml`, to ratchet:

```yaml
- run: bash forge-kernel/scripts/occt_closure_count.sh --assert-closure 14
```

Lower the constant only when a cut in §4.2 lands. It can never be satisfied by moving a
dependency behind another library.

---

## 6. Caveats

- Closure is measured from static load commands. A library brought in only by a runtime
  `dlopen` would not appear; nothing in the kernel does that, but the script cannot prove it.
- Cut sets in §3 and the ladder in §4.2 are exact over the measured graph, and assume a cut
  library is *fully* routed native (all its exclusive symbols gone). A partial routing that
  leaves one call site keeps the library and therefore its whole subtree.
- Symbol counts are per-toolkit exclusive counts, a proxy for effort, not effort itself.
  TKOffset's 42 symbols span 17 call sites of general OCCT shapes; TKFillet's 11 are blocked
  on multi-adjacent-edge and corner blends (`NativeFilletChamfer.cpp:295,310,357`). The
  ordering in §4.3 is driven by closure topology, which is exact; the cost column is not.

---

## 7. UPDATE 2026-08-28 — OCCT_CLOSURE 14 → 13 (TKOffset dropped)

**The first time this programme has removed an OCCT toolkit from the load closure.**
Measured on real linked binaries built in this worktree, with
`scripts/occt_closure_count.sh` and `tools/occt_symbol_census.sh` (both of which had
to be repaired first — see §7.4).

### 7.1 Before / after

| | OCCT_DIRECT | OCCT_CLOSURE | OCCT_PHANTOM | TKOffset symbols |
|---|---|---|---|---|
| default build (every drop OFF)          | 9 | **14** | 2 | 42 |
| families A,C,D,E,F,G,H ON (prior work)  | 9 | **14** | 2 | 11 |
| + families **I** and **J** (this track) | 8 | **13** | 2 | **0** |

`closure (13): TKBO TKBool TKBRep TKernel TKFillet TKG2d TKG3d TKGeomAlgo TKGeomBase
TKMath TKPrim TKShHealing TKTopAlgo` — TKOffset is absent.

OCCT_PHANTOM did **not** rise (2 before, 2 after), which is the check that matters: a
phantom would mean a translation unit still calls TKOffset and macOS
`-undefined dynamic_lookup` is masking it. It does not.

### 7.2 Why this drop was unilateral

**Nothing DT_NEEDs TKOffset.** Measured over every toolkit in the closure: TKOffset sits
at the very top of the dependency DAG, so removing the `.node`'s link record removes it
from the process. The 13 that remain form a **total order**:

```
TKFillet > TKBool > TKBO > {TKPrim, TKShHealing} > TKTopAlgo > TKGeomAlgo
        > TKBRep > TKGeomBase > TKG3d > TKG2d > TKMath > TKernel
```

### 7.3 The ranked path to zero, re-derived from the measured graph

Because the remainder is a chain, **the closure can only fall from the top**. Ranked by
closure value, not by symbol count:

| # | toolkit | exclusive symbols | closure effect | state |
|---|---|---|---|---|
| 1 | **TKFillet** | 11 | **13 → 11** (takes TKBool, 0 symbols, with it) | `FORGE_FILLET_DROP_NATIVE` exists, default OFF: needs a general multi-edge / curved native fillet |
| 2 | TKBO | 32 | 11 → 10 | currently a PHANTOM — 32 symbols called with no link record |
| 3 | TKShHealing | 12 | — (must go with TKPrim before TKTopAlgo matters) | 12 remaining symbols all blocked on the STEP reader |
| 4 | TKPrim | 11 | — | |
| 5 | TKTopAlgo | 100 | → 1 each once above are clear | |
| 6 | TKBRep | 82 | | |
| 7 | TKG3d | 141 | | |
| 8 | TKG2d | 24 | currently a PHANTOM — 24 symbols called with no link record | |
| 9 | TKMath | 26 | | |
| 10 | TKernel | 26 | | |
| — | TKBool / TKGeomAlgo / TKGeomBase | 0 each | leave when their parents do | no work needed |

**465 exclusive symbols remain in total.** The single highest-value next action is
TKFillet: it is the unique maximal element of the chain and worth **two** closure
points, more than any other single drop available.

**An honesty debt this drop exposes:** TKBO (32 symbols) and TKG2d (24) are called by the
binary with **no link record at all**. Naming them in `OCCT_LIBS` would move OCCT_DIRECT
8 → 10 and OCCT_PHANTOM 2 → 0 while leaving OCCT_CLOSURE at 13. That is a strictly
honest change and should be made before anyone quotes the DIRECT number again.

### 7.4 Both measurement scripts were broken, and were fixed first

Neither number above could be trusted until two defects were repaired.

- **`scripts/occt_closure_count.sh` under-reported the ledger number silently.**
  `resolve()` returned the raw install name when it could not find a library on disk;
  the BFS then skipped it, the load graph stopped at the root, and OCCT_CLOSURE
  **collapsed onto OCCT_DIRECT with exit 0**. Reproduced by pointing this repo's own
  binary at a non-existent OCCT prefix: the old script printed `OCCT_CLOSURE = 9`
  instead of 14 and exited 0. An unresolved dependency is now a hard error (exit 2),
  with one narrow exemption for dyld-shared-cache system paths, which have no file on
  disk by design since macOS 11. `@rpath` is now also resolved against the owning
  image's own `LC_RPATH` entries, per dyld's documented algorithm.
- **`tools/occt_symbol_census.sh` proved nothing on any OCCT that is not 7.9.**
  It hardcoded `lib<TK>.7.9.dylib` and, on a miss, printed `MISSING` and continued —
  so on 7.8, 8.x, a source build or a Linux `.so` it reported no per-toolkit lines at
  all and exited 0. Toolkits are now located by glob across the platform's naming
  conventions, a toolkit that cannot be found is a hard error, the OCCT version
  actually measured is printed, and the output directory is wiped first (a reused
  directory was measured lending a *previous* run's numbers to a toolkit that was
  missing in the current one).

Both fixes are proved red-then-green against mutated inputs; the reproductions above
are those runs.
