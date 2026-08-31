# A stale copy of the vocabulary is not illegal — it is silently incomplete

Measured 2026-08-30 against `origin/claude/sacrosanct-execution-20260828` @ `5adc26a0`.

## The claim under test

The op vocabulary is CI-gated three ways in this repo, so a change to it cannot land
quietly *here*. But the training side of the program consumes a **copy**: the corpus
generator in `archdisc-Models/tools/archie_vocab/` holds a byte copy of
`implementation/sacrosanct/archie_op_vocabulary.json` and verifies its sha256 on load.
The question is what happens to a corpus generated against a copy that has since been
superseded.

## What was measured

The copy in the Models repo was blob `85f99cae…` from commit `6a7f3aa3`
(sha256 `4e996924…3392`). The pinned file is blob `33557ad6…`
(sha256 `077cb620…164f`). They differ:

| | `6a7f3aa3` | `5adc26a0` |
| --- | --- | --- |
| `emission_policy.allowed_ops` | 17 | **18** — `RING` added |
| `value_kind_closure.gaps` | one: WIRE has no producer in the allowed set | **empty** |
| `LOFT` | consumes WIRE; unreachable, and `emitted_forms` said `%profile...` | reachable; `emitted_forms` say `%wire...` |
| `derived_defects` | 7, including `command_feeds_the_wrong_value_kind` for `part.loft` | 3 |
| `forbidden_ops` | 23 | 22 |
| `registry_commands` / `commands_emitting_ir` | 34 / 19 | 30 / 20 |

`RING` produces WIRE. Adding it to `allowed_ops` is what empties the closure gap and
turns `LOFT` from a statement no user can build into one they can.

**The corpus generated against the old copy was still 100% legal — and covered 16 of
the 18 ops.** Both 40,000-row corpora, scored with the same validator against the
pinned vocabulary:

| corpus | rows | statements | legal | ops covered | zero coverage |
| --- | --- | --- | --- | --- | --- |
| `vocab_legal_v1` (stale copy) | 40,000 | 343,995 | 40,000 (100.00%) | 16/18 | `LOFT`, `RING` |
| `vocab_legal_v2` (pinned copy) | 40,000 | 344,169 | 40,000 (100.00%) | 18/18 | — |

That is the shape of the defect, and it is the reason it is worth writing down: the
stale corpus does not fail a legality check. It passes one. Nothing in a validator run
says the word "RING". The only observable is coverage, and only if something counts it.

## What the re-audit of the existing corpora moved

`audit_corpora.py` over `data/forge` (846 files, 182 holding IR, 1,160,894 rows), the
same run as the wave-3 audit but against the pinned vocabulary. The headline does not
move; the sub-terms do, and they move exactly where `RING` is:

| | stale vocabulary | pinned vocabulary |
| --- | --- | --- |
| IR rows (denominator) | 393,151 | 393,151 |
| statements in those rows | 4,277,775 | 4,277,775 |
| rows emitting a forbidden op | 393,151 (100.00%) | 393,151 (100.00%) |
| …a forbidden op other than `RESULT` | 378,805 (96.35%) | **377,879 (96.12%)** |
| rows with an arg count outside `emitted_forms` | 47,894 (12.18%) | **48,500 (12.34%)** |
| rows fully vocabulary-legal | 0 (0.00%) | 0 (0.00%) |
| rows legal if `RESULT` alone were stripped | 13,485 (3.43%) | **13,805 (3.51%)** |

926 rows stopped being "forbidden for a reason other than RESULT" because their only
such op was `RING` (10,930 `RING` statements across 2,850 rows). Those statements are
now checked against `RING`'s `emitted_forms` instead of dismissed by name, and 606 more
rows fail on argument count as a result. Legality stays at 0.00% either way.

## Why every one of those corpora is illegal

Not sloppiness — the system prompt they were built with. It instructs Archie to
"finish with `RESULT(%id)`" and "Finish with `VERIFY(...)`". `forge::ui` can emit
neither: every UI emission goes through `PartDocument::appendFeature -> validateIr`,
and `validateIr` answers `unknown_op` for any name absent from `irOpTable()`, where
both are absent. 100.00% of IR rows carry a forbidden op because 100.00% of them were
told to.

## The rule this earns

A hash check on a copied spec tells you the copy is intact. It does not tell you the
copy is current, and it does not tell you what the copy leaves out. When a generator
is driven by a spec, **count the coverage of the spec's own enumeration and refuse to
write a corpus that leaves any member at zero** — `gen_corpus.py` now exits non-zero
rather than write a corpus missing an allowed op. A legality gate alone would have
shipped this one twice.

## Second-order: the mutation control found a defect in itself

The mutation control bends one token in real generated rows and requires every mutant
to be rejected. First run: 2,000 mutants, **8 survivors**. All eight were
`drop_one_argument` on a `LOFT` with three or more sections — `LOFT` is variadic with a
minimum of 2, so dropping a section leaves a legal two-section loft. The mutation was
benign and the validator was right.

The fix was to the control, not the validator, and deliberately not by asking the
validator: `mutate_control.py` now reads the legal argument counts straight out of the
vocabulary JSON rather than through `vocab.py`, because asking the module under test
whether a mutant is illegal would make the control circular — able to produce only
mutants the validator already rejects. After the fix: 2,000/2,000 rejected.
