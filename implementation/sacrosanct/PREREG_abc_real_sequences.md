# PRE-REGISTRATION — training Archie on REAL human construction sequences (ABC/Onshape `ofs`)

Written BEFORE the training run and before the corpus size was known, for the same reason
D-045 exists: a prediction registered afterwards is not a prediction. D-045 refuted its own
pre-registration, and that is the only reason we know synthesised assertion supervision is
counter-productive rather than merely disappointing.

## What this round changes, and what it holds fixed

ONE VARIABLE: the corpus. Rows are translations of REAL Onshape FeatureScript trees
(`abc_ofs`), proved against an independent OCCT build of the same tree before they may be
offered. Every hyperparameter is inherited unchanged from `chain_selfconsist_train.sh`.

## THE STRUCTURAL FACT THAT DRIVES EVERY PREDICTION BELOW

**The ABC corpus contains ZERO assertions.** `scripts/abc_ofs_to_ir.py` never emits a
VERIFY op — grep returns nothing. Every row is a pure construction sequence:

    SKETCH -> SPT/SLINE/SCIRC/SARC -> SOLVE -> EXTRUDE -> CUT -> RESULT

The primary endpoint — self-inconsistency = `verify_failed_rows / rows_emitting_VERIFY` —
is measured over assertions THE MODEL EMITS. A corpus with no assertions in it cannot
teach the model to make truer ones. This is not a defect of the corpus; it is what a real
construction sequence *is*. But it means the primary endpoint is being asked to move by a
mechanism this corpus does not contain.

## PREDICTIONS

### P1 — PRIMARY: self-inconsistency will NOT improve materially. *(the falsifiable one)*
Paired against v6r8 on shared ids, I predict the rate lands within ±8 points of the 59.8%
baseline, and that exact McNemar does NOT reach p < 0.05 in the improving direction.
Registered as a NEGATIVE prediction on the endpoint the round is scored on, because the
supervision for it is absent by construction. **If it improves significantly, P1 is
refuted and real construction sequences transfer to assertion truth — a real result.**

### P2 — THE ARTIFACT I EXPECT, AND THE ONE THAT COULD FAKE A WIN
`rows_emitting_VERIFY` will FALL. Every training row ends `RESULT(%n)` with no VERIFY, so
the model is being shown that a finished answer contains no assertion.

**This is the trap.** The rate is a ratio. A model that abstains from asserting scores a
flattering self-inconsistency because the denominator collapsed, not because the
numerator improved. Compare `box600` in ARM_SUMMARY.json: 100% built, and
`self_inconsistency_rate = null` on 0 VERIFY rows — a perfect score for a box that
asserts nothing.

**Therefore: the rate alone is NOT the result.** Numerator AND denominator will be
reported for every arm, and if `rows_emitting_VERIFY` falls by more than 15% the rate is
declared NOT COMPARABLE and reported as such rather than as an improvement.

### P3 — SECONDARY: what I expect to actually move
Compile/build rate and sketch-family usage. These have direct supervision — 100% of rows
are kernel-proved buildable trees, and #184 made SKETCH/SPT/SLINE/SCIRC/SARC/SOLVE
user-invocable. I expect built% to rise and sketch-family ops to appear where they were
previously near-absent.

### P4 — what I expect NOT to move
CBORE stays at 0. It is 0/600 in every arm measured so far, and there is no CBORE in the
ABC corpus either — nothing in this round addresses it.

## THE STOP CONDITION, REGISTERED IN ADVANCE

`chain_selfconsist_train.sh` refuses below `MIN_ROWS=1800`; D-045 trained on ~2,000. The
previous ABC run yielded **125** canonical rows. If the rebuilt corpus lands materially
below the floor, the registered decision is to **REPORT THE SIZE AND NOT TRAIN** — a
2,400-iteration run over a few hundred rows is ~30 epochs of memorisation, and its result
would be uninterpretable either way. Reporting a corpus honestly is worth more than a
training curve nobody can read.

## What would make this round a success even if P1 holds

That the corpus EXISTS, is contamination-clean, and is proved row-by-row against an
independent kernel. The untried lever was never "assert harder" — it was real human
construction sequences, and the first job is to establish they can be had at all, and at
what size. The size is the finding.
