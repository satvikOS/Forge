# The contamination guard refused a training run, and it was right

**2026-08-29.** The first launch of `train_expert3d_v6_rank8.sh` exited before training.
Law 8 scans the corpus AS TRAINING DATA before anything is trained on it, and it found:

    clean       data/forge/expert3d_v1_clean/train.jsonl: 16671 rows
    CONTAMINATED data/forge/expert3d_v1_clean/valid.jsonl: 2/200 rows   by rule {'R8': 2}
      line 13: user prompt is verbatim an eval task prompt of ACTIVE split
               'holdout_enlarged_600' (full match)
      line 64: same

`holdout_enlarged_600` is the 600-row anchor D-011 was measured on. It **did not exist as
an active split when v5cap was trained**, so a corpus that was clean then is contaminated
now. A guard that only ever ran at corpus-build time would have missed this entirely; this
one runs at every training launch, against the splits that are active THAT DAY.

## Does this undermine D-011? Checked, and no

Two facts, both measured rather than assumed:

* **The leak is in `valid.jsonl`, not `train.jsonl`.** Searching all 16,671 TRAINING rows
  for either prompt returns **0 hits**. v5cap's gradients never saw them.
* **Validation never selected a checkpoint.** The recipe saves every 400 steps and keeps
  the FINAL adapter; there is no best-validation selection, so a contaminated val row
  could not have steered which weights were kept.

The v5cap numbers stand. Recorded explicitly because "the guard fired" and "the result is
compromised" are different statements, and collapsing them would have been the easy error
in both directions -- ignoring the alarm, or retracting a sound result on a bad reading.

## The fix

`data/forge/expert3d_v1_clean2`: `train.jsonl` copied BYTE-IDENTICAL (sha256 `80f5df13...`,
verified equal to the source, because it was already clean) and `valid.jsonl` with the two
rows dropped -- 198 rows, re-scanned, 0 contaminated. The v6 run uses clean2 and its header
records why, so the corpus change cannot later be mistaken for an uncontrolled variable in
the v5cap-vs-v6 comparison.

## The general lesson

**A held-out split that is created AFTER a corpus can retro-contaminate it.** Cleanliness
is not a property a corpus has once; it is a property of a (corpus, active-splits) pair at
a moment in time. Scanning at launch rather than at build time is what caught this, and it
is why the scan must never be moved earlier for speed.
