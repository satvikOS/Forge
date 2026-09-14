# The 40-iteration probe, and the three things it caught

`lora_eager_rope.py` in the model repo says it outright: *"PROBE FOR 50 ITERATIONS
BEFORE ANY REAL RUN: those are analytic figures and exclude activation growth, and an
OOM costs five hours."* This is that probe for `knowing_v1`, and what it actually
returned.

```sh
bash tools/knowing_train/train_knowing_v1.sh 40 -probe     # -> adapters/archie-30b-knowing-v1-probe
```

## 1. It fits, with more headroom than the reference run

| | expert3d-v6r8 (the reference recipe) | knowing_v1 probe |
|---|---|---|
| peak memory | 30.164 GB | **24.653 GB** |
| tokens per iteration | 1125 | 911 |
| it/sec | 0.256 | **0.310** |

Same base model, same 3072 / batch 1 / grad-accum 4 / grad-checkpoint shape, same
expert LoRA (12 trailing layers, rank 8). The corpus is what differs: `knowing_v1`
rows are shorter, so both the peak and the per-iteration cost come down. 24.65 GB on a
36 GB box is the number the run was sized against.

**Read `It/sec` from the wall clock, not from the line.** mlx_vlm computes it as
`steps_per_report / train_time`, so a report that fires on the final iteration with
fewer than `steps_per_report` steps behind it is inflated by exactly that ratio. The
probe printed `It/sec 0.388` for 40 iterations against a 50-step report interval;
40/50 × 0.388 = 0.310, which is what the elapsed time says.

## 2. The resume path was silently training the wrong thing

The probe was run a second time with `iters 5` to exercise the resume branch, and that
is the only reason this was found before a seven-hour run:

```
fresh   #trainable params: 118.849536 M || all params: 6609.573104 M || trainable%: 1.798%
resumed #trainable params: 657.691888 M || all params: 6609.573104 M || trainable%: 9.951%
```

`setup_model_for_training` freezes the towers only on its fresh branch; the resume
branch calls `apply_lora_layers` and returns with nothing frozen. The resumed adapter
came back carrying **544 extra non-LoRA tensors** — the layer norms and the entire
vision tower, trained by accident — and `expert_lora_patch.verify` reported them:

```
OK|config and weights agree on 276 LoRA keys; 544 non-LoRA tensor(s) NOT checked …
```

A run like that is not a worse run; it is a different experiment wearing this one's
config. The launcher now freezes before applying and refuses to start above a
LoRA-sized parameter ceiling. After the fix the resumed run reports `118.849536 M`,
identical to the fresh one, and the adapter comes back with 276 keys and nothing else.

## 3. The first version of that fix did nothing at all

It patched `mlx_vlm.lora.apply_lora_layers`. This launcher hands argv to
`runpy.run_module("mlx_vlm.lora", run_name="__main__")`, which **re-executes** that
module; its `from .trainer.utils import apply_lora_layers` then rebinds the name and
discards the patch. Python even warns about it —

```
RuntimeWarning: 'mlx_vlm.lora' found in sys.modules after import of package 'mlx_vlm',
but prior to execution of 'mlx_vlm.lora'; this may result in unpredictable behaviour
```

— and the only visible symptom was the 657 M line above. Patch `trainer.utils`, which
is where the name is imported *from* at execution time.

## What the probe could not catch

Everything about sharing the machine. The probe ran alone in 209 seconds. The real run
died three times before its first checkpoint: twice from memory contention with a
sibling agent's 18 GB model load, once from Guardian's stage-1 `SIGUSR1` checkpoint
request, whose default disposition is *terminate* and which `forge-job` does not trap.
Those are in `README.md` because they are properties of the box, not of the recipe.
