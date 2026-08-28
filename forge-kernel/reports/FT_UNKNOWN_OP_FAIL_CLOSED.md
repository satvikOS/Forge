# An unknown op silently became a BOX

**Track:** METRIC / MFIX follow-up. **Date:** 2026-08-28.
**Fix:** `forge-kernel/src/ft/FeatureTreeCompiler.cpp`, `forge-kernel/include/forge/ft/FeatureTree.hpp`
**Test:** `forge-kernel/test/ft/s0_acceptance_test.cpp` — group `CLOSED-VOCABULARY (s0.5 / s9.1)`
**Blast radius:** measured. **Zero** published rows affected. No composite moves. Details in §5.

---

## 1. The defect, reproduced

Reproduced against the binary every published composite was taken with —
`archdisc-Models/tools/pinned/forge_verify`, sha256
`45e9ad9a9b882e9494477c8d3cfb49239e4a98076c644014fbbbbac2879da3b5`, with
`tools/pinned/libforge_kernel_core.dylib` — driven through
`scripts/interface_metrics.CensusVerifier`, `{"census":"full"}`:

| IR | reported | volume | faces |
| --- | --- | --- | --- |
| `%1 = BOX(20,20,20,0,0,0)` | ok | 8000 | 6 |
| `%1 = CUBE(20,20,20,0,0,0)` | **ok** | **8000** | 6 |
| `%1 = ZZZNOTANOP(20,20,20,0,0,0)` | **ok** | **8000** | 6 |
| `%1 = FOOBAR(7,8,9)` (after a BOX) | **ok** | **504** = 7·8·9 | 6 |
| `%1 = ZZZNOTANOP(...)` then `%2 = TRANSLATE(%1,…)` | error | — | — |

**The defect is not confined to single-statement programs — that is the part of the
original report that was wrong.** The trigger is *tail position*, not statement count:

```
%1 = BOX(20,20,20,0,0,0)
%2 = CUBE(5,5,5,0,0,0)          <- ok, volume 125
```

Two statements, builds green, and the 20 mm box is **gone**: the tree's result is a
nonsense 5 mm box. Move the same `CUBE` off the last line (append one blank line) and
it becomes `ft parse line 2: unknown op \`CUBE\`` — the diagnosis and the proof in one
step.

## 2. Where it comes from — two independent defaults, both constructive

```cpp
// FeatureTreeCompiler.cpp, opFromName()
auto it = tbl.find(nameUpper);
known = (it != tbl.end());
return known ? it->second : OpCode::Box;      // (A)
```

```cpp
// FeatureTreeCompiler.cpp, parse()'s fail() — the working-tree/in-flight parser
auto fail = [&](const std::string& why) {
    if (lineNo >= totalLines) { truncatedTail = true; return; }   // (B) RETURNS
    throw std::runtime_error(...);
};
...
op.code = opFromName(upper(name), known);
if (!known) { ...; fail("unknown op `" + name + "`"); }           // (C) no break
ft.ops.push_back(std::move(op));                                  // (D) pushed anyway
```

(B) exists for a real reason: a generation cut off at the token ceiling ends
mid-statement, and failing the whole text discards every complete op before it. But
(B) is keyed on the **line number**, so it fires for the last line of *any* text — and
because (C) neither breaks nor continues, control falls straight through to (D) with
`op.code` still holding (A)'s `OpCode::Box`. The statement's own arguments are then read
as `dx, dy, dz`. A single-statement program is just the special case where line 1 *is*
the last line.

The severity depends on the argument list, which is why it looks intermittent:

* ≥ 3 leading numbers → a solid is built and **scored**. Silent.
* 0–2 numbers, or a `%ref` first → `OpError` at build time, but the message names the
  invented op as though it were real: `op %3 (line 3): SUBTRACT: missing/!number arg #0`.
  Loud, but misattributed — an error taxonomy keyed on `unknown op` (e.g.
  `archdisc-Models/scripts/selfdistill_report.py:56`) buckets it as an argument fault.

`Op::code` also **defaulted to `OpCode::Box`**, so this was not one accident but the
same choice made twice.

## 3. The fix — fail closed

SACROSANCT s0.5 requires an unknown executable kind to be *rejected by the parser*, and
s9.1 requires a closed executable vocabulary. A rejection that depends on where the
statement sits in the file is not a closed vocabulary.

1. **`OpCode::Unknown`** added as a sentinel (`FeatureTree.hpp`). `opFromName()` returns
   it on a miss; `Op::code` defaults to it. "Not in the vocabulary" can no longer be
   spelled as a real, buildable op.
2. **The unknown-op rejection no longer goes through `fail()`.** It throws
   `ParseError{ParseFailure::Syntax}` directly, at any line. This is justified, not
   merely convenient: we reach that point having already matched
   `%id = NAME( … )` with **both parentheses present**, so the decoder demonstrably did
   not stop mid-token. The statement is complete; the op name is simply not real.
3. **Truncation tolerance is untouched.** A genuine token-ceiling cutoff fails one of
   the *earlier* checks (`expected OP( ... )`, an unterminated string, a malformed point
   list), still reports `PAUSED_INCOMPLETE`, and still carries its salvage checkpoint.
   That is asserted by a control in the test (6g).
4. **The builder enumerates the sentinel** and throws on it, so `-Wswitch -Werror` turns
   any future op added to `OpCode` without a builder into a compile error, and an `Op`
   arriving by any other route (default-constructed, deserialized) fails loudly instead
   of building a box.

## 4. The test, and proof it can fail

`forge-kernel/test/ft/s0_acceptance_test.cpp`, group **CLOSED-VOCABULARY (s0.5 / s9.1)**,
12 assertions covering the three named cases (BOX parses to a stated reference value —
one `Box` op, args exactly `20,20,20,0,0,0`; `CUBE` errors; `ZZZNOTANOP` errors), the
tail-position variants, position independence, "no parsed tree carries the sentinel",
and the truncation control. Run with `bash forge-kernel/test/ft/build_s0_acceptance.sh`.

`X` in the defect report is a *score*; a score is a property of the built solid and this
suite never calls `compile()` (see the file header). What the parser owes is asserted
instead, exactly. The score-level evidence is §1, measured against the pinned binary.

**Mutation proof** — the fix reverted, the suite re-run, nothing else changed:

| variant | TOTAL | new group |
| --- | --- | --- |
| fixed | `pass=54 fail=5` | 12/12 pass |
| mutant 1+2: `opFromName` → `OpCode::Box`, unknown op back through `fail()` | `pass=50 fail=9` | 4 RED |
| mutant 3: `fail()` returns on the last line (the in-flight parser) | `pass=43 fail=16` | 9 RED, incl. `parse() ACCEPTED it and returned 1 op(s), code=8` |

Mutant 3 is the real thing: `code=8` is `OpCode::Box`. `fail=5` is the pre-existing
Appendix-B baseline (`s0_conformance_baseline.txt`), unchanged by the fix; the ratchet
`forge-kernel/test/ft/s0_ratchet.sh` goes red at 9 and at 16.

## 5. Blast radius — measured, not assumed

**Method.** Every IR text on disk was harvested from `reports/**` and `runs/**` in
`archdisc-Models` (4,081 files, 1,473 IR texts, **999 distinct**). The op name in
**final-`getline()`-line** position was extracted for each. The vocabulary was taken
**from the pinned binary itself**, not from a second copy of the op table: each name was
probed in a *non-final* position, where rejection was never in doubt. Each row whose
final-line op was unknown was then replayed twice — as scored, and with one blank line
appended to push the statement off the last line. `ok as-is && !ok shifted` is the
silent path having fired.

**Result.**

* 28 distinct ops appear in final-line position; 10 are outside the vocabulary
  (`BOG`, `BOGIE`, `BOGOSITY`, `BORE`, `CSGO`, `CUBE`, `CYLINDER`, `EXTRUDE_FACE`,
  `PLANE`, and `RESULT` — the last a probe artefact: `%N = RESULT(%M)` is handled by
  the assignment-form `RESULT` branch and is legal).
* **20 candidate rows.** 19 of them **already build red** — every one dies on an
  *earlier* unknown op (`CUBE` at line 1, `CYLINDER` at line 2, `BOG` at line 2 …), so
  the tail path was never reached. The 20th (`ho93`, the `RESULT` artefact) builds green
  both ways.
* **AFFECTED = 0.**
* Separately, **0** recorded build errors anywhere on disk match
  `op %N (line L): <name>: …` for a `<name>` outside the vocabulary — the loud-but-
  misattributed variant did not occur either.

**Coverage of the published arms.** All 25 scored arms under
`reports/composite_anchor/` and `reports/composite_scores/`: 846 records, **499
built-ok**, and the candidate IR was recovered for **499/499 (100 %)**. Every arm whose
number could have been inflated was examined.

**Therefore no published number changes.** The means below stand exactly as recorded —
`benchcad41_envelope` 0.4310, `ho36_envelope` 0.3202, `ho32_expert3d_v1` 0.3174,
`expert3d_v1_benchcad41` 0.2931, `expert3d_v3_benchcad41` 0.1681,
`expert3d_v4a_benchcad41` 0.0898, `ho_v4a` 0.0210, `neuralcad56_nulledit` 0.5554,
`gt_v2_neuralcad36` 0.1983, and the rest.

This is a **null result on the published record and a live defect in the instrument**.
The 19 rows that escaped did so by accident — they happened to contain a *second*
invented op earlier in the tree. `expert3d-v4a` alone emitted `CUBE`, `CYLINDER`, `BOG`,
`BOGIE`, `BOGOSITY`, `BORE`, `CSGO`, `EXTRUDE_FACE` and `PLANE`; one such tree with a
single invented op, in tail position, with three numeric arguments, scores the box
floor. On a benchmark whose floor **is** a box (text 0.3202, vision 0.4310) that is the
worst possible direction for a silent default.

## 6. Debt this does NOT settle

The fix is on the **committed** lineage (`HEAD` = `a8b02608`). The main checkout's
**working-tree** `FeatureTreeCompiler.cpp` — the +1451-line in-flight change registered
in `implementation/sacrosanct/RECONCILIATION_OWED.md` — still contains the tail-tolerant
`fail()` that *returns*, and is the version the measurements in §1 characterise. When
that debt is settled the reconciled file needs both halves of §3:

* `opFromName()`: `: OpCode::Box` → `: OpCode::Unknown`;
* the `if (!known)` block: `fail(...)` → `throw ParseError(ParseFailure::Syntax, …)`.

The in-flight parser was deliberately **not** edited here: it cannot be committed without
committing 1451 lines of someone else's unreviewed work, and the register is explicit
that the reconciliation must not be resolved by an agent picking a side.

The pinned scoring binary is **not** rebuilt or re-pinned by this commit. A composite is
only comparable within one binary; §5 shows there is nothing to re-score, so the pin
stays where it is and the fix lands in the next honest rebuild.

## 7. Repro commands

```
# the defect, against the pinned binary (archdisc-Models)
python3 - <<'EOF'
import sys; sys.path.insert(0,"scripts")
from interface_metrics import CensusVerifier
V=CensusVerifier(timeout=60)
for ir in ['%1 = BOX(20,20,20,0,0,0)', '%1 = CUBE(20,20,20,0,0,0)',
           '%1 = ZZZNOTANOP(20,20,20,0,0,0)',
           '%1 = BOX(20,20,20,0,0,0)\n%2 = CUBE(5,5,5,0,0,0)']:
    r=V.ask({"id":"t","ir":ir,"census":"full"})
    print(repr(ir), r.get("ok"), r.get("volume"), r.get("error"))
EOF

# the fix + the regression group (archdisc-Mech)
bash forge-kernel/test/ft/build_s0_acceptance.sh     # pass=54 fail=5
bash forge-kernel/test/ft/s0_ratchet.sh              # baseline 5 held
bash forge-kernel/test/native/check_includes.sh      # OK (289 files)
```
