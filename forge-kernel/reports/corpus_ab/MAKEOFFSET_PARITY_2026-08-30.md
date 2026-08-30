# MAKEOFFSET (TKOffset family A) — the 27-part deletion bucket, attributed and closed

Measured 2026-08-30 from a tree pinned to
`origin/claude/sacrosanct-execution-20260828` @ `5adc26a003ada4fb970267de367ac5da5b07d702`,
OCCT 7.x from `/opt/homebrew/opt/opencascade`, corpus
`archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps`
(600 parts, stride 1 — the whole set).

## 1. Headline

| measurement | before | after |
|---|---|---|
| `test/run_corpus_ab_coverage.sh` MAKEOFFSET, native % | **94.5%** (567/600) | **100.0%** (600/600) |
| … OCCT baseline % | 99.0% (594/600) | 99.0% (594/600) |
| … deletion bucket (`OCCT_ONLY`) | **27** | **0** |
| … capability add (`NATIVE_ONLY`) | 0 | **6** |
| … verdict | FAIL, −4.5% [−6.2, −2.8], p=1.5e-8 | **PASS**, +1.0% [0.2, 1.8], p=0.031 |
| the SHIPPED `forge::cam::inwardOffset`, drop build | 571/600 = 95.2% | **598/600 = 99.7%** |
| … its deletion bucket vs the OCCT baseline (594/600) | 23 | **2** |
| FILLING (untouched CONTROL) | 407 both / 0 OCCT-only / 193 neither | **byte-identical** |

## 2. The defer-reason channel (behaviour-neutral, and proved so)

All 33 of MAKEOFFSET's native declines came back as a bare null shape with an
empty `note`, so the deletion bucket was unattributable. `test/corpus_ab_coverage.cpp`
gains the same device `NativeLoftPipe.cpp` already uses for PIPE/PIPESHELL: a
file-local `MO_DEFER(label)` that records a label and then does exactly what the
bare `return TopoDS_Shape()` did, read only by `runArm`'s existing `reasonFn`
hook and only on a DEFER.

PROOF IT IS INERT — the pre-fix instrumented run vs the committed baseline run,
compared row by row with each arm's `note` stripped:

```
rows base=1200 instr=1200
rows differing after stripping `note`: 0
rows where the channel ADDED a native note: 33
NEGATIVE CONTROL - rows differing WITHOUT stripping `note`: 33   (>0, so the comparison is not blind)
```

and the family totals reproduced the committed `reports/corpus_ab/summary.md`
exactly: native `OK:567 DEFER:33`, OCCT `OK:594`, deletion bucket 27, and the
33-part defer set IDENTICAL to the committed one, part for part.

## 3. Attribution — 33 of 33 to ONE cause

```
total native DEFER: 33
  all_loops_collapsed_dropped1              33      <- 27 OCCT_ONLY + 6 NEITHER
```

Every one carries the same census: `walk=sampled | pts=192 | ccw=1`, i.e. an
outer wire of 8 curved edges sampled at 24 points each, wound CCW, offset inward
by `d = 0.05*sqrt(area)` — between 3.3% and 5.0% of the ring's own `sqrt(area)`.
A ring of extent ~218 does not collapse under an inward offset of 7. There is no
second cause and no ranking to do: the bucket is one failure, 27 times.

## 4. Root cause — `cleanRawLoop`, not the offset

Splitting `offsetLoop` into its two private stages on `ho1084`:

```
n=192  d=7.109  raw=384  rawArea=16929.7   clean=0  droppedAll=1
```

`rawOffset` produced a ring of **exactly the right area** (16929.7; the same ring
decimated to 32 points and cleaned successfully gives 16921.4). The whole of the
loss is in the arrangement cleanup. Inside it:

```
n0=384  R=1346  nodes=864  H=1346  kept=342   nodes with indeg != outdeg: 60
NODE 166 (71.7378407, 41.612972)  ringDeg=2  in=2 out=0
NODE 167 (71.7378411, 41.612972)  ringDeg=2  in=0 out=2
```

Two nodes **4e-7 apart** on a 218-unit ring, against a weld tolerance of
`ext*1e-9 = 2.2e-7`: one geometric crossing became two nodes. The kept boundary
is then unbalanced at 60 nodes, every chain walk dead-ends ("no unused out-edge
at node 194 after 51 steps"), `result` is empty, and a correct offset is reported
as a total collapse. Checks that ruled the alternatives out:

* the arrangement is COMPLETE — 0 `PROPER_CROSS` survive the split, and the
  `ENDPOINT_TOUCH` count is exactly the ring-adjacency count (384 of 384), so
  there are no missed crossings and no T-junctions;
* the flank-sample distance is not the cause — sweeping it over 1e-9 … 1e-3
  leaves the unbalanced count at 60, unchanged;
* releasing the edges a failed chain consumed does not help — every start
  dead-ends, so there is no cycle to find.

482 crossings on a 384-segment raw ring is what makes the near-coincident nodes:
the ring is sampled off near-straight splines, so it carries micro-facets whose
offset lines meet at near-zero angle.

## 5. The fix — a sub-tolerance retry, on the collapse path ONLY

`PolygonOffset2D::offsetLoop` keeps its first attempt exactly as it was. If — and
only if — that collapses, the loop is retried once on the ring with its
below-`arcTolerance` vertices removed (perpendicular-distance simplification, so
every removed vertex is within `arcTolerance` of the chord of the vertices kept
around it). `arcTolerance` is the SAME budget the call already spends
tessellating its own round joins; no new constant is introduced.
`OffsetResult::relaxedCollinear` reports when the retry was what answered.

Because it is unreachable from the succeeding path, **no input that produced
loops before can produce anything different now** — and that is measured, not
argued (§6).

## 6. Evidence

* `test/native/geom/polygonoffset2d_test.cpp` (the printed-seed gate, incl. (d)
  "inward offset past the inradius collapses honestly"): **17/17 PASS**.
* 33 dumped defer rings: 33/33 recover, **33/33 via the retry**; 18 rings that
  already succeeded: 18/18 still succeed, **0/18 touch the retry**.
* Recovered geometry is right, not merely non-null — against OCCT's own result on
  the same 27 parts: perimeter within **6.5e-5** relative (max), bbox within
  **1.3e-6** of the diagonal, centroid within **4.5e-6**. Tighter than the worst
  of the 567 pairs that already agreed.
* Full 600-part re-run, pre-fix vs post-fix, row by row: **exactly 33 rows
  changed, all 33 the pre-fix native-DEFER rows; 0 rows changed outside them; 0
  OCCT arms changed; 0 non-MAKEOFFSET rows changed.** FILLING, the untouched
  control, is byte-identical (407 both / 0 OCCT-only / 193 neither).
* The 6 parts OCCT itself cannot do (it times out at 20 s: ho1040 ho185 ho408
  ho45 ho707 ho995) are now built natively and are `BRepCheck_Analyzer`-valid.

## 7. Does `FORGE_OFFSET_DROP_MAKEOFFSET` now pass its flip gate? Not yet.

The corpus A/B is not that option's gate. `CMakeLists.txt:521-528` names its own
evidence, and on this tree:

1. *"re-run the 382-part sweep with the option ON and show native defers <= the
   OCCT baseline rate"* — `data/forge/complex_all.jsonl` **is not in the tree**.
   Substituting the 600-part corpus and driving the SHIPPED
   `forge::cam::inwardOffset` (two binaries of `camoffset_ab.cpp`; positive
   control: `nm -u` shows 4 `BRepOffsetAPI_MakeOffset` symbols in the stock arm
   and **0** in the drop arm, and `cmp` reports the binaries differ):

   | arm | ok | defer | deletion bucket |
   |---|---:|---:|---:|
   | stock — OCCT `BRepOffsetAPI_MakeOffset` (the baseline) | 594 | 6 | — |
   | drop — native, PRE-fix | 571 | 29 | **23** |
   | drop — native, POST-fix | **598** | 2 | **2** |

   The rate clause is met (99.7% >= 99.0%). The deletion bucket is **not zero**:
   `ho13` and `ho133` still defer where OCCT builds, so under Law 9 those two
   toolpaths would silently revert to the unoffset wire. Their cause is the same
   degeneracy at the denser sampling the shipped path uses
   (`kSampleDeflection/16`): 278-point ring, simplified to 131 at
   `tol=7.8e-3`, still collapses. A coarser retry tolerance is NOT the cure and
   must not be adopted — it is non-monotone (x10 recovers both, x20 loses both
   again), i.e. luck, not a threshold.
2. *"`test/cam_native_offset_ab.mjs` ALL PASS"* — **that file is not in the tree.**
3. *"the five cam smokes byte-identical"* — they `require`
   `forge-kernel/build/Release/forge-kernel.node`, which is **not built here**
   (and `ninja`, the conforming generator, is not installed).
4. *"the four mandated gates green"* — not run here.

Independently of all four: per the same CMake block, flipping this option leaves
`OCCT_DIRECT` at 8 and `OCCT_CLOSURE` at **14** (TKOffset stays linked for the
other 8 families), so it is blocking-set reduction 42 -> 38 symbols, not a drop.

## 8. Reproduce

```
test/build_corpus_ab_coverage.sh
FAMILIES=MAKEOFFSET,FILLING test/run_corpus_ab_coverage.sh all <outdir>
clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
    forge-kernel/src/native/geom/PolygonOffset2D.cpp \
    forge-kernel/src/native/Predicates.cpp \
    forge-kernel/src/native/geom/Geom.cpp \
    forge-kernel/test/native/geom/polygonoffset2d_test.cpp -o /tmp/k4 && /tmp/k4
```

`FORGE_MO_DUMP=1` on `corpus_ab_coverage` prints the ring family A hands the
offset engine (stderr, `MOLOOP`/`MOPT` lines) so any part's input can be replayed
standalone. It is off unless that variable is set.
