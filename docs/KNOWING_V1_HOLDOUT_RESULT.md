# archie-30b-knowing-v1 on BenchCAD-holdout-41

*Draft — the results tables are filled by `tools/knowing_train/score_knowing_v1.sh` and
are not written here until that run completes. Everything below the line is measured and
was recorded BEFORE any score existed.*

## What was trained, and what question it answers

One checkpoint, on the `knowing_v1` corpus, to test one claim: that a corpus whose
prompts do not name the answer's operations produces a model that does better than one
whose prompts do. The incumbent `astra-v1` was trained on a corpus where **100.0% of
38,000 rows name the ops in the prompt**, and it scores **below a bounding box**.

| | astra-v1 (incumbent) | knowing-v1 (this run) |
|---|---|---|
| corpus | vocab_legal_v3 + 11 others, 300 MB, text only | knowing_v1, 10,997 rows, 63% image-bearing |
| user-turn op leak | 100.000% | 0.000% |
| images in training | **0** | 6,986 of 10,997 |
| trainer | `mlx_lm.lora` (text-only) | `mlx_vlm.lora` (vision) |
| resumed from | archie-30b-vocab-v5 | **nothing — the base model** |
| expert (MoE) LoRA | 48 switch keys, rank 8 | 36 switch keys, rank 8, trailing 12 layers |

**Resuming from nothing is the most consequential line in the config.** Every adapter on
disk descends from `vocab-v5`, and the flagship mix that produced astra-v1 contains
`scaled5`, which overlaps **979 holdout parts by image key** — 488 of 623 rows of
`gt_familysplit/heldout`. Inheriting those weights would inherit a fit to parts this run
is scored against, and nothing done to the new corpus could undo it. Training from the
base costs capability and buys a number that means something.

## Two predictions recorded before the score

Both are measured properties of the corpus and the instrument, not guesses.

**1. The checkpoint is evaluated in a framing it never saw.** Similarity between the
corpus's `vision_tree` turns and the benchmark's: **system 0.081, user 0.144**. The
corpus user turn is 168 constant characters; the benchmark's is 1,211 and carries the
measured envelope. The corpus system turn enumerates all 53 legal ops; the benchmark's
does not. The one thing that *does* match is the image: both are 268x268 2x2 composites
of four shaded 3-D renders, which closes the modality mismatch this programme had on
record (eval shaded, training ortho line drawings).

**2. Scale normalisation is free on shape and expensive on interface.**
`composite_score.py`'s default alignment, `centred-longest`, is *scale-invariant by
construction* — its own header says a part uniformly scaled by 1.10 scores shape 1.000 —
so emitting at longest-axis 100 mm when the reference is 64.22 mm costs nothing on the
0.4-weight shape term. But `score_interface` compares feature positions and radii in
**absolute** coordinates (only the tolerance scales with the reference diagonal), so the
same emission puts every bore off its true radius. That is a structural cap on the
0.4-weight interface term for any scale-normalised model. The component breakdown is
therefore reported, not just the composite.

## What the corpus had to have removed first

The corpus arrived with 11,943 rows and a clean bill of health from its own scan. The
model repo's own LAW 8 instrument disagrees:

```
** CONTAMINATED data/forge/knowing_v1/train.jsonl: 469/11466 rows   by rule: {'R6': 469}
** CONTAMINATED data/forge/knowing_v1/valid.jsonl:  28/477  rows   by rule: {'R6': 28}
```

Every one of the 497 references a part of `bench_tasks_benchcad_hf` — an **active** 980-row
eval split with measured `gt` on disk and a baseline already scored against it. The
corpus's own scan walked the data tree and reported zero because it did not cover that
split. *Scoped checks leave holes between them.* Stripped with `--strip`, which keeps a
`.contaminated.bak`; the backups live in `data/forge/knowing_v1_provenance/`. Nothing was
deleted. Re-scan on the same instrument: **0 contaminated rows**, 10,997 train / 449 valid.

Against the 41 rows actually scored here, an independent scan finds **no overlap on any
key**: image basename, part stem, exact user prompt, and the (sorted bbox extents, genus)
signature, exact and rounded. 873 train rows match a holdout part's *volume* to within
0.5%; every one differs in envelope, the closest by 6.5%, in a different family and with a
different genus. A volume coincidence is not a part.

## How the number will be read

* **All 41 rows are run.** The holdout is sorted hardest-first — a prefix reads 0.2423
  where the full set reads 0.3617 — so a partial run is not a sample.
* **The floor is reported with its n.** Under the current pin the bbox-envelope floor is
  **0.4281 over 19 scored rows**; under the pin astra-v1 was published on it was 0.4310
  over 34. The instrument refuses 22 of 41 *references* on the current pin — 12 verifier
  timeouts at 300 s, 10 faceted-solid bridge failures — and those refusals hit every arm
  identically.
* **The incumbent is re-scored under the same pin.** astra-v1's published 0.2394 was
  measured by verifier `45e9ad9a`, which fabricates a valid unit box for any op name it
  does not recognise. Its persisted IR is on disk, so it is re-scored from the same
  emissions under this binary. A comparison across two kernels is not a comparison.
* **The interval is bootstrapped over FAMILIES, not rows.** Three `ball_knob`s are one
  draw of a difficulty. The paired set is at most 19 rows across 10 families.
* **Generation is greedy.** The honest n is distinct prompts; there are no repeat trials
  and no trial count is used to narrow an interval.

---

## Results

*(pending)*
