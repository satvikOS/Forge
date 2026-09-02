# ARC was reported as "present, wrong form". It was ABSENT, and the instrument that said otherwise is a binary no commit produces

**2026-08-31.** Measured on `archie/arc-form`, branched from
`origin/claude/sacrosanct-execution-20260828` and merged with `origin/archdisc`.

---

## 1. The claim under test

PR #150's census recorded the last 1.8 points of GT vocabulary insufficiency as two
missing ops, `ARC` (48 programs) and `HELIX` (1), citing
`grep -c ARC forge-kernel/src/ft/FeatureTreeCompiler.cpp` = 0.

A later census correction (branch `analysis/arc-helix-exist`, commit `ca1d2101`)
**refuted** that by probing a verifier:

```
%1 = ARC(1,2,3)      -> "ARC expects [x y; x y mx my; ...]"   (KNOWN, wrong form)
%1 = HELIX(1,2,3)    -> "RESULT %1 is not a defined SOLID"    (KNOWN, wire not solid)
```

and concluded the 48 programs "fail because the model emits the WRONG FORM for an
op it already has." That correction was itself an application of a good rule —
*ask the instrument, not the source* — and it reached the wrong answer.

## 2. What is actually true

**The form diff is EMPTY.** Every one of the 86 `ARC` statements in the 48 GT
programs (`archdisc-Models/data/forge/benchcad_ir_reharvest.jsonl`, 1317 rows)
already satisfies the grammar the reference parser accepts:

| checked | result |
| --- | --- |
| `[ ... ]` point ring present, nothing outside it | 86 / 86 |
| every row is 2 or 4 numbers | 1635 / 1635 (281 line rows, 1354 arc rows) |
| ≥ 2 vertices when a segment is an arc, ≥ 3 when none is | 86 / 86 |
| row 0 is 2 numbers (the closing segment is straight) | 86 / 86 |
| **form violations** | **0** |

**They fail on ABSENCE.** `opFromName` had 40 entries on every pushed branch and
neither `ARC` nor `HELIX` was among them. Measured, both arms compiled and run:

| arm | GT programs that parse |
| --- | --- |
| before (`a9423fcb`) | **1268 / 1317** — first failure `unknown op \`ARC\`` |
| after (ARC landed) | **1316 / 1317** — the one residual is `unknown op \`HELIX\`` |

The before number, 1268, is exactly the census's own "full 40-op kernel table →
1268 (96.3 %)", reproduced here by a different method (real `parse()` over whole
programs rather than an op-name set difference). The census was right.

## 3. Why the instrument said otherwise

`archdisc-Models/tools/pinned/libforge_kernel_core.dylib` was built **2026-08-07**
with `-DFORGE_FT_ARCHELIX=ON`. `strings` on it still returns
`ARC expects [x y; x y mx my; ...]`. The source that produced that string is **not
in this repository's history at all**:

```
git log --all -S"ARC expects"      -- forge-kernel/src/ft/FeatureTreeCompiler.cpp   -> nothing
git log --all -S"FORGE_FT_ARCHELIX" -- forge-kernel/src/ft/FeatureTreeCompiler.cpp  -> nothing
git log --all -- forge-kernel/src/ArcHelix.cpp                                      -> nothing
```

It exists **only as uncommitted working-tree state in the shared checkout**
(`/Users/…/archdisc-Mech`, `FeatureTreeCompiler.cpp` mtime 2026-08-28, +1424 / −295
lines against its own stale HEAD), together with `src/ArcHelix.cpp`,
`include/forge/ArcHelix.hpp` and the `FORGE_FT_ARCHELIX` / `FORGE_FT_DIR_SELECTORS`
CMake options — none of which any commit contains.

This is already tracked debt, not a discovery: `RECONCILIATION_OWED.md` records
"+1451 lines (pre-session)" in that one file, and
`.github/workflows/kernel-tests.yml` defers the s0 link refactor because
"`FeatureTreeCompiler.cpp` carries large uncommitted work in the main checkout".
What was new is that a **measurement** was taken against that private tree and
published as a property of the shipping kernel.

## 4. The rule this refines

*Ask the instrument, not the source* is right, and it is not sufficient.

> **An instrument has a provenance, and an instrument built from an unpushed tree
> measures a system that does not exist.** Before an instrument's answer becomes a
> claim about the product, the instrument must be traceable to a commit.

The mechanism for that already exists and was not consulted:
`tools/pinned/BASELINE_PROVENANCE.txt` and `check_pin_provenance.sh` sit in the
same directory as the binary that produced the wrong answer.

Corollary for this repo specifically: **a `grep` miss over the working tree of a
shared checkout is not a statement about any branch**, and a `grep` hit there is
not one either. Both must be re-run against a tree pinned to origin — which is the
existing law *measure only from a tree pinned to origin*, extended from numbers to
the existence of code.

## 5. What was done about it

`ARC` landed unconditionally (this branch). It adds **zero** OCCT toolkits —
`profArc()` reaches nothing but `forge::addPoint` / `addLine` / `addArc`, which
`profRRect` already calls — and it takes GT parse coverage 1268 → 1316 of 1317.

`HELIX` did **not** land, and the reason is a price, not a doubt:

* it needs `Geom2d_Line` (TKG2d) and `BRepOffsetAPI_MakePipeShell`, so the
  `.node` link line gains TKBO + TKG2d — `OCCT_DIRECT` 9 → 11, which the CI
  ledger ratchet (`--assert-direct 9`) refuses. `OCCT_CLOSURE` does not move:
  both toolkits are already the two named PHANTOMS, already loaded transitively
  through TKFillet. That is a ledger decision, with the ledger owner.
* it buys **one** GT program, `bolt_000012_s20260505`, and that program needs two
  further uncommitted capabilities to build even with `HELIX` present:
  `SWEEP(%profile, %pathWire, PLACE, …)` (the current `opSweep` refuses a `%ref`
  first argument) and the `MAX_Y` directional edge selector (`MAX_Y` appears zero
  times in this tree and once in the shared checkout, under
  `FORGE_FT_DIR_SELECTORS`).

So "land HELIX" is really "land HELIX + the SWEEP `%ref` form + the directional
selectors + move the OCCT ledger", for 1 of 1317 programs. Named here so the next
reader prices it before starting it, and so the unpushed implementation is not
rediscovered a third time.
