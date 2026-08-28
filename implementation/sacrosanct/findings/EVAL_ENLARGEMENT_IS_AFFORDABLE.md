# Enlarging the eval is affordable, and the clean pool is already on disk

**Measured 2026-08-28.** The power analysis (`HOLDOUT_IS_UNDERPOWERED_24X.md`) put the
required sample at **~600 scored rows** against the 25 available. This is what it would take.

## There are 1,655 clean rows, and 36 are in use

The scorer needs a gold reference solid per task. `scripts/bench/prep_composite_anchor.py`
already builds one: it matches a holdout prompt **byte for byte** against a gold tree and
compiles that tree through the pinned kernel, which is how the current 36 references exist
(29 from `ft_decomp_gt.jsonl`, 7 from `ft_ir_gen_gt.jsonl`).

Both gold corpora are on disk. Their overlap with what v5cap actually trained on
(`data/forge/expert3d_v1_clean/train.jsonl`, 13,946 distinct prompts), matched on the
whitespace-normalised user message:

| gold source | rows | already in training | **clean** |
| --- | --- | --- | --- |
| `ft_decomp_gt.jsonl` | 1368 | 56 (4.1%) | **1312** |
| `ft_ir_gen_gt.jsonl` | 6781 | 6432 (94.9%) | **343** |
| | | | **1655 total** |

**~1,619 clean rows are available beyond the 36 already used** -- roughly 2.7x what an
80%-powered comparison needs. The eval does not need new data authored; it needs references
compiled for data that already exists.

## The check the contamination guard does NOT make

`scripts/contamination_guard.py` reports both gold sources as **0 contaminated**, and
`prep_composite_anchor.py` cites that. That is true and it is a different question.

The guard enforces s17.3: it blocks the 81 CADGenBench parts, `real_draw` and the edit tids
2xx -- **public eval leaking into training**. It does not ask whether a row is in *our own*
expert3d training corpus. Those 6,488 overlapping rows (56 + 6432) are clean by the guard's
definition and would still be **contaminated as eval for this model**, because the model was
trained on those exact prompts.

**Both checks are required before a row becomes an eval row**, and only one of them is
automated today. The 94.9% overlap in `ft_ir_gen_gt` is the reason this matters: taking that
corpus at face value would produce an eval that is almost entirely training data.

Verified in the other direction too: **0 of the 36 current holdout prompts appear in
training**, so the existing firewall is working.

## What it costs

1. Select N clean rows (excluding the 6,488 training-overlapping ones and the 36 in use).
2. Run `prep_composite_anchor.py` to compile each gold tree into a reference STEP and emit
   the task row (`gt_step`, `ref_volume_built`, `ref_genus_built`, ...). Mechanical -- the
   same path that produced the current 36.
3. Register the new split in `contamination_guard.py`'s `HOLDOUT_REGISTRY` as **ACTIVE**, so
   it can never be trained on. Adding a split is a registry row by design.
4. Re-scan the training corpus against the enlarged registry, and clean it if anything hits
   (there is precedent: `train.jsonl.contaminated.bak`).

Scoring 600 rows costs roughly **6 h/arm** now that `FORGE_STOP_ON_LOOP` defaults ON, against
~11 h before. That is the difference between an experiment that runs overnight and one nobody
schedules.

**Recommendation:** enlarge to ~600 from the `ft_decomp_gt` clean pool alone (1312 available,
so no need to touch the 94.9%-contaminated second corpus at all), and add the
training-overlap check to the guard so the second question stops depending on someone
remembering to ask it.
