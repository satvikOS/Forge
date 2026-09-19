# FOREIGN_STEP_TAIL — what makes `readForeignStep()` decline

**T-149. Derived file — regenerate, never hand-edit.**

```
bash forge-kernel/test/run_foreign_step_tail_census.sh --report \
     --roots "/Users/account_clawteam1/.archdisc-wt/t149-steptail /Users/account_clawteam1/archdisc-Mech /Users/account_clawteam1/archdisc-Models" --jobs 4
```

Harness build: `/Users/account_clawteam1/.archdisc-wt/t149-steptail/forge-kernel/.build-foreign-step-tail/foreign_step_tail_census` (git_head `133d704af459`, dirty src/include 0).

## 0. What was measured, and with what

`forge::native::brep::readForeignStep(text, -1.0)` — the shipped foreign reader, unmodified — was called on every lexable STEP file under the corpus roots. The acceptance test is the product's, copied verbatim from `forge-kernel/src/IoExchange.cpp::importStep`:

```cpp
if (fr.ok && fr.solid && fr.owner && fr.unsupported.empty() && fr.closed) /* native */;
else /* OCCT fall-through: foreignStepToOcct */;
```

`sewTol = -1.0` is the automatic default the product uses. **A different sew tolerance raises the closed rate without reconstructing a single entity and is therefore never the headline number here.**

## 1. The corpus

| quantity | count |
|---|---|
| files found | 72573 |
| …failed Part-21 lexing (residual, not censused) | 0 |
| …lexable, censused | 72573 |
| census rows emitted | 72573 |
| distinct file content (sha256) | 64272 |
| **distinct parts** (face-surface multiset + face count) | 7602 |
| bytes | 12.06 GB |

Residual: **0** files failed Part-21 lexing.

Originating system (`FILE_NAME` field 6) over the lexable files:

| originating_system | files |
|---|---|
| (empty) | 6771 |
| Autodesk Translation Framework v14.17.0.0 | 99 |
| Autodesk Translation Framework v14.21.0.0 | 99 |
| Autodesk Translation Framework v14.24.0.0 | 378 |
| Open CASCADE 7.8 | 124 |
| Open CASCADE 7.9 | 19661 |
| build123d | 26955 |
| forge | 18486 |

Preprocessor version (`FILE_NAME` field 5) — the field the writer identity actually lives in for OCCT and build123d exports:

| preprocessor_version | files |
|---|---|
| (empty) | 6771 |
| Open CASCADE STEP processor 7.8 | 124 |
| Open CASCADE STEP processor 7.9 | 46616 |
| ST-DEVELOPER v20.1 | 576 |
| forge::native::brep::StepAnalytic | 1 |
| forge::native::brep::StepWriteOcct | 18485 |

### The file count is not the part count

The 10 largest part groups and how many files each absorbs:

| part_key | files in group | example |
|---|---|---|
| 7b451cbe3011 | 10974 | `step/00049136.ref.step` |
| 35716013c16a | 4291 | `step/00000063.forge.step` |
| d1d1ea4b2899 | 3777 | `114/output.step` |
| 3168afacf76b | 1882 | `step/00000007.forge.step` |
| 81207c168313 | 1620 | `124/output.step` |
| 625511b0cd0b | 1576 | `step/00000123.forge.step` |
| 395d4aab81c1 | 1279 | `step/00000007.ref.step` |
| 21067e3ba1aa | 1274 | `step00000/1586.step` |
| 11c0af0b42b5 | 875 | `step/00000842.forge.step` |
| 2cbd0ce1b6b0 | 660 | `123/output.step` |

## 2. Where the corpus lands

| bucket | files | % files | distinct parts | % parts |
|---|---|---|---|---|
| CRASH | 22 | 0.0% | 22 | 0.3% |
| DECLINED_BOTH | 12834 | 17.7% | 2333 | 30.7% |
| DECLINED_OPEN | 2011 | 2.8% | 956 | 12.6% |
| DECLINED_UNSUPPORTED | 445 | 0.6% | 196 | 2.6% |
| MIXED_DECLINE | — | — | 31 | 0.4% |
| NATIVE_ACCEPTED | 56857 | 78.3% | 4035 | 53.1% |
| READ_FAILED | 404 | 0.6% | 29 | 0.4% |

`MIXED_DECLINE` is a **part-level row only** — a part group whose member files declined for more than one reason. No single file is ever in it, hence the dash.

`NATIVE_ACCEPTED` is the only bucket that does **not** reach `foreignStepToOcct`. Today that is **56857 of 72573 files (78.3%)** and **4035 of 7602 distinct parts (53.1%)**. Everything else falls through to OCCT.

A part is counted accepted only when **every** file in its group is accepted — the smaller of the two honest numbers.

## 3. The tail, three ways

The same `unsupported` map, ranked by three different denominators. **They disagree, and the disagreement is the point.**

### 3a. By occurrence (how many faces)

| # | entity | occurrences |
|---|---|---|
| 1 | SURFACE_OF_LINEAR_EXTRUSION | 81259 |
| 2 | EDGE_CURVE(uninvertible) | 39718 |
| 3 | EDGE_LOOP(unreadable) | 7936 |
| 4 | QUADRIC_PARAM | 3365 |
| 5 | SURFACE_OF_REVOLUTION | 1188 |
| 6 | OFFSET_SURFACE | 350 |
| 7 | DEGENERATE_LOOP | 14 |

### 3b. By files blocked

| # | entity | files blocked |
|---|---|---|
| 1 | SURFACE_OF_LINEAR_EXTRUSION | 9748 |
| 2 | EDGE_CURVE(uninvertible) | 1652 |
| 3 | EDGE_LOOP(unreadable) | 1124 |
| 4 | QUADRIC_PARAM | 1016 |
| 5 | SURFACE_OF_REVOLUTION | 133 |
| 6 | OFFSET_SURFACE | 44 |
| 7 | DEGENERATE_LOOP | 6 |

### 3c. By DISTINCT PARTS blocked ★ the ranking that orders the work

| # | entity | distinct parts blocked |
|---|---|---|
| 1 | EDGE_CURVE(uninvertible) | 874 |
| 2 | QUADRIC_PARAM | 791 |
| 3 | SURFACE_OF_LINEAR_EXTRUSION | 645 |
| 4 | EDGE_LOOP(unreadable) | 550 |
| 5 | SURFACE_OF_REVOLUTION | 67 |
| 6 | OFFSET_SURFACE | 44 |
| 7 | DEGENERATE_LOOP | 5 |

**Why 3c and not 3a.** Occurrence counts faces, so one pathological part with thousands of spline faces outranks a surface that appears once in every part on the disk. Files count generator runs, so whichever corpus was regenerated most often wins. Distinct parts counts *shapes a customer could hand us*, which is what a reconstruction job is actually bought with.

### 3d. What those keys actually name

A ranked list of strings is not a work queue until you know which entries are a **missing surface type**, which are a **type that is already implemented and failing**, and which are **not a surface at all**. Each row is read off the recording site in `src/native/brep/StepRead.cpp`.

| entity | kind of work | files | parts | why it is recorded |
|---|---|---|---|---|
| EDGE_CURVE(uninvertible) | not a STEP entity | 1652 | 874 | a trim curve that could not be inverted onto the surface's (u,v) — StepRead.cpp:1651 and :1718. A PCURVE problem, not a surface problem. |
| QUADRIC_PARAM | not a STEP entity | 1016 | 791 | a quadric whose own parameters are degenerate — StepRead.cpp:2173 (H < 1e-12) and :2190. The surface type is supported; its numbers are not. |
| SURFACE_OF_LINEAR_EXTRUSION | handler present, FAILING | 9748 | 645 | StepRead.cpp:1383 parses it and :1933 records it when the tensor-NURBS extrusion patch does not come out `valid()`. The type is implemented; this counts the cases the implementation drops. |
| EDGE_LOOP(unreadable) | not a STEP entity | 1124 | 550 | the face's EDGE_LOOP could not be read — StepRead.cpp:1816. |
| SURFACE_OF_REVOLUTION | handler present, FAILING | 133 | 67 | StepRead.cpp:1324 — torus fast path plus a general NURBS-of-revolution path. Recorded at :1787 only when the generatrix cannot be built. |
| OFFSET_SURFACE | MISSING TYPE | 44 | 44 | no branch in the dispatcher at all; falls through to `surfType = ins.type` and is recorded verbatim at :1787. The one key in this table that is a genuinely unimplemented surface. |
| DEGENERATE_LOOP | not a STEP entity | 6 | 5 | a loop that collapsed to zero extent — StepRead.cpp:1951. |

Residual: **0** unclassified keys.

| kind of work | entity keys | file hits (sum, double-counts) | part hits (sum) |
|---|---|---|---|
| not a STEP entity | 4 | 3798 | 2220 |
| handler present, FAILING | 2 | 9881 | 712 |
| MISSING TYPE | 1 | 44 | 44 |


## 4. Counterfactual — reconstruct ONE entity, what moves?

### First, why the obvious strict number is a trap

`importStep` needs `unsupported.empty()` **and** `closed`. It is tempting to count only files that are ALREADY `closed` — but a face the reader drops leaves a hole in the shell, so a file with a non-empty `unsupported` map is open *because of the very gap being counted*. Measured here: **445** of the 13279 files with a non-empty unsupported map are nevertheless closed. A strict count is therefore ~0 by construction, not because the work is worthless.

So three numbers are given for every counterfactual below:

* **floor** — files whose whole unsupported set is inside the reconstructed set *and that already sew closed*. A hard lower bound; degenerate for the reason above.
* **ceiling** — the same files with the closure requirement dropped, i.e. assuming the reconstructed faces also sew watertight.
* **expected** — the ceiling discounted by the sew's own failure rate, measured independently on the **58868** files where the reader built *every* face: **2011** of them (3.42%) still failed to close. Expected = ceiling x 0.9658.

The expected column is the one to plan with. The floor is reported because the house rule is to show the smaller honest number, not to hide it.

Top entity by distinct parts: **`EDGE_CURVE(uninvertible)`** (blocks 874 parts / 1652 files).

If `EDGE_CURVE(uninvertible)` and **nothing else** were reconstructed, the files that would move from the OCCT fall-through to native are those whose *entire* unsupported set is `{EDGE_CURVE(uninvertible)}` **and** which already sew closed:

| measure | files | distinct parts |
|---|---|---|
| floor — already `closed` (degenerate, see above) | 359 | 178 |
| ceiling — assuming the reconstructed faces sew | 1438 | 664 |
| ★ expected — ceiling x 0.9658 | 1389 | 641 |

Read the **expected** row. The floor is a hard lower bound that the conjunction in `importStep` makes degenerate; the ceiling assumes every reconstructed face also sews; the expected row discounts the ceiling by the sew failure rate measured on bodies that needed no reconstruction at all. None of the three is a promise — they bracket the same job from both sides.

## 5. Cumulative curve, top 7, ABSOLUTE COUNTS

Reconstructing the top-k entities *together*, ranked by distinct parts. A file is counted when its **whole** unsupported set falls inside the top-k — a file blocked by one entity inside the set and one outside does not move. Floor / ceiling / expected are as defined in section 4. Percentages are given in the closing sentence; the table is absolute counts only.

| k | entity added | floor files | floor parts | ceiling files | ceiling parts | ★ expected files | ★ expected parts |
|---|---|---|---|---|---|---|---|
| 1 | EDGE_CURVE(uninvertible) | 359 | 178 | 1438 | 664 | 1389 | 641 |
| 2 | QUADRIC_PARAM | 360 | 179 | 2297 | 1273 | 2219 | 1230 |
| 3 | SURFACE_OF_LINEAR_EXTRUSION | 360 | 179 | 11980 | 1885 | 11571 | 1821 |
| 4 | EDGE_LOOP(unreadable) | 430 | 186 | 13096 | 2424 | 12649 | 2341 |
| 5 | SURFACE_OF_REVOLUTION | 442 | 194 | 13229 | 2490 | 12777 | 2405 |
| 6 | OFFSET_SURFACE | 442 | 194 | 13273 | 2534 | 12820 | 2447 |
| 7 | DEGENERATE_LOOP | 445 | 196 | 13279 | 2538 | 12825 | 2451 |

Reconstructing all 7 together: floor **445 files / 196 parts**, ceiling **13279 / 2538**, expected **12825 / 2451**. On the expected figure native acceptance goes from **56857 to 69682 files** (78.3% -> 96.0%) and **4035 to 6486 distinct parts** (53.1% -> 85.3%) out of 72573 / 7602.

## 6. What still would NOT move

After the top-7 (the floor measure), **15271 files** still decline. They split as:

| residual reason | files |
|---|---|
| blocked by an entity AND not closed | 12834 |
| no unsupported entity — the SEW did not close | 2011 |
| read returned ok=false | 404 |
| the read aborted, hung or threw (see 6d) | 22 |

**The sew is a separate lever from the entity tail.** A file in the *not closed* rows gains nothing from any amount of surface reconstruction.

### `READ_FAILED` reasons (the reader declined the whole file)

| reason | files |
|---|---|
| `readForeignStep: no supported faces were built (all unsupported)` | 398 |
| `readForeignStep: no shell (CLOSED_SHELL/OPEN_SHELL) found` | 6 |

## 6d. The containment bucket — files the reader could not survive

Each file is read in a **forked child**, so an abort or an infinite loop becomes a named bucket instead of a dead census. **22** of 72573 files ended that way:

| reason | files |
|---|---|
| child died on signal 6 | 22 |

Named (first 10):

* `/Users/account_clawteam1/archdisc-Models/data/external/mmcad_b_raw/extracted/step00000/1258.step`
* `/Users/account_clawteam1/archdisc-Models/data/external/mmcad_b_raw/extracted/step00000/142.step`
* `/Users/account_clawteam1/archdisc-Models/data/external/mmcad_b_raw/extracted/step00000/1436.step`
* `/Users/account_clawteam1/archdisc-Models/data/external/mmcad_b_raw/extracted/step00000/1493.step`
* `/Users/account_clawteam1/archdisc-Models/data/external/mmcad_b_raw/extracted/step00000/1494.step`
* `/Users/account_clawteam1/archdisc-Models/data/external/mmcad_b_raw/extracted/step00000/1578.step`
* `/Users/account_clawteam1/archdisc-Models/data/external/mmcad_b_raw/extracted/step00000/1747.step`
* `/Users/account_clawteam1/archdisc-Models/data/external/mmcad_b_raw/extracted/step00000/1899.step`
* `/Users/account_clawteam1/archdisc-Models/data/external/mmcad_b_raw/extracted/step00000/1975.step`
* `/Users/account_clawteam1/archdisc-Models/data/external/mmcad_b_raw/extracted/step00000/1962.step`
* …and 12 more; the full list is every row in `census.jsonl` whose `bucket` is CRASH / TIMEOUT / THREW.

**⚠ THIS HARNESS IS STRICTER THAN THE SHIPPED ADDON, and that matters.** It compiles the same sources with `-std=c++20 -O2 -DFORGE_NATIVE_BREP` and **no** `-DNDEBUG`, so `assert()` is live. Every one of the aborts above is SIGABRT from a single assertion — `std::fabs(w) > 0.0 && "degenerate rational weight (w == 0)"`, `Nurbs.cpp:33`, in `project`. The shipped addon is a CMake **Release** build, which adds `-DNDEBUG`; there that assertion is compiled out and those files do not abort — they divide by a zero weight instead. Neither outcome is a native import, so the census counts them as declined either way, but the *mechanism* differs between this measurement and production and the count of 22 is a lower bound on how many files reach that code path.

## 6b. SIDE COLUMN — a wider sew tolerance (`--sew-tol 0.1`). NOT the headline.

Re-read of the **2011** files this census put in `DECLINED_OPEN` — the bucket whose *only* blocker is that the sewn body is not watertight — with the sew tolerance widened from the product default `-1.0` to `0.1`. **Widening the tolerance reconstructs nothing.** It is reported here so the size of the temptation is on the record, not so anyone quotes it.

| measure | count |
|---|---|
| files re-read at the wider tolerance | 2011 |
| …that become NATIVE_ACCEPTED | 563 |
| …that were NOT accepted at the default tolerance (the flip) | 563 |
| distinct parts covered by those accepted files | 435 |

Those 563 files are still counted as DECLINED in every number above.

## 6c. The briefing, re-verified

Every claim T-149 handed me was re-measured against this tree. Three held, two did not, and one number does not exist.

| briefing claim | verdict | what was measured |
|---|---|---|
| `TKDESTEP` and `TKXSBase` are dropped from the shipped addon | **HOLDS** | `occt_closure_count.sh` lists neither in OCCT_DIRECT (8) nor OCCT_CLOSURE (14) |
| `forgeNativeStepEnabled()` is production default ON, NativeRoute.cpp:77 | **HOLDS** | the function opens at line 77; `return envSet ? envOn : true;` |
| `STEPControl_Reader` survives only in the `#else` the addon never compiles | **HOLDS** | `#ifndef FORGE_NATIVE_BREP` guards the include at IoExchange.cpp:19-20; the `#else` body is the only use |
| corpus is 7,661 files — 4,692 Open CASCADE 7.9 / 2,940 build123d / 28 forge | **HOLDS exactly — and is not a corpus** | reproduced to the file: 7,661 / 4,692 / 2,940 / 28 / 1. But those 7,661 files are **214 distinct blobs** and **157 distinct parts**; 7447 of them are byte-copies living in in-repo `.claude/worktrees` |
| `SURFACE_OF_REVOLUTION` is an example of an unsupported surface | **FALSE for this tree** | `StepRead.cpp:1324` has a torus fast path **and** a general NURBS-of-revolution path. The stale claim is still in the comment at `IoExchange.cpp:106`. `OFFSET_SURFACE` is the type with no dispatcher branch at all — the census selftest uses it |
| the "97 adapter-only OCCT symbols" floor | **NO SUCH NUMBER** | no file in the tree contains `adapter-only`, `97 adapter` or `adapter floor`. 97 is TKTopAlgo's exclusive-symbol count in the 2026-08-28 census (`reports/OCCT_CLOSURE_TRUTH.md:112,196`), superseded on 2026-09-04 by **110**. The dylib-wide total at HEAD is **539**, ceiling 550 |

The STEP reader's own OCCT share **is** measured, per translation unit, in `reports/TOOLKIT_ELIMINATION_MAP.md`: `src/native/brep/StepReadOcct.cpp` accounts for **128** symbol attributions (TKTopAlgo 48, TKG3d 31, TKBRep 24, TKernel 14, TKShHealing 6, TKMath 5). That is an upper bound — a symbol shared with another file is counted in both — and it is the number this census's work queue is ultimately spending against.

## 7. Acceptance

* **A1** `--selftest` normal exit **0**, `--selftest --invert` exit **1**. The inverted run must be non-zero or the assertion is inert.
* **A2** census rows **72573** == manifest total **72573** − Part-21 lex failures **0** = **72573**. Asserted inside `run_foreign_step_tail_census.sh`, not eyeballed.
* **A3** the shipped addon's OCCT symbol count is unchanged. Measured on `archdisc-Mech/forge-kernel/build-node/Release/forge-kernel.node`: `occt_closure_count.sh <addon> --assert-symbols 550` exits **0**, and the control `--assert-symbols 549` exits **1** — so the assertion is not inert. That binary was built 2026-09-10 and predates HEAD (T-144's ratchet records OCCT_SYMBOLS 539 against a ceiling of 550, and the addon built from archdisc's current tip acf2eb30 — T-146, the commit that took 539 to 532 — measures 532), which is exactly why an assertion has to name its binary rather than quote a number. The decisive evidence that **this task** changed nothing is structural: `git diff --stat 015dd83c..HEAD -- forge-kernel/src forge-kernel/include` is EMPTY — this branch adds five files and edits none — and `run_foreign_step_tail_census.sh` aborts before it measures anything if `git status --porcelain -- src include` is non-empty. Compare against the BASE commit, not `origin/archdisc`: that ref moved to acf2eb30 (T-146, #271) while this census ran, so a diff against it shows T-146's `NativeLoftPipe.cpp` and says nothing about this branch. T-146 touches no file on the STEP read path (no StepRead / Nurbs / Sew / Topology / TrimmedFace / StepPart21), so every number here stands at acf2eb30 as well — but it is measured at 015dd83c, which is what the build stamp at the top of this report records.
* **A4** section 5 is the top-7 cumulative curve in absolute counts.

### Conditions this run was admitted under

Guardian was **ORANGE** (`kern vm_pressure=WARNING`) for the whole session, so `forge-gate --need green` and `--need yellow` both denied. The job was re-measured rather than re-asserted — peak RSS **26 MB** at `--jobs 2`, a forked reader per file holding one STEP text (mean 113 KB, p99 1.3 MB) — re-registered at `--peak-gb 2 --jobs 4 --priority 3 --restartable`, and admitted at `--need orange`. It stayed registered throughout so Guardian could shed it.
