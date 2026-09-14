# tools/knowing_train — train ONE checkpoint on `knowing_v1` and score it honestly

Four files, in the order they run:

| file | what it is |
|---|---|
| `knowing_v1_lora.yaml` | the configuration, declarative, with the reason beside every value |
| `launch_vlm_expert_lora.py` | the trainer launcher: `mlx_vlm.lora` plus four patches, each paid for by a measured failure |
| `train_knowing_v1.sh` | the restartable runner: LAW 8, LAW 7, Guardian registration, resume, checkpoint pruning |
| `prove_adapter_loaded.py` | four checks that the adapter is on the compute path, before anything is scored |
| `score_knowing_v1.sh` | proof → all 41 holdout rows → re-score the incumbent under the same pin → compare |
| `compare_arms.py` | paired, per-family, with an interval clustered on families |

Everything runs against `/Users/account_clawteam1/archdisc-Models` (the model repo);
these scripts live here because this is the repo the work is committed to.

---

## The four patches in the launcher, and what each one cost before it existed

**1. Eager multimodal RoPE.** mlx_vlm 0.6.2's fused MRoPE is a `mx.fast.metal_kernel`
— a `CustomKernel` with no registered vjp — and it sits on the LoRA gradient path.
Without forcing `rope_utils._HAS_METAL = False` the backward pass dies with
`ValueError: [Primitive::vjp] Not implemented for CustomKernel`. Inherited from
`scripts/lora_eager_rope.py`, unchanged.

**2. Expert LoRA on the RESUME path, not only the fresh one.** 89% of this model's
bytes are `QuantizedSwitchLinear` experts. `lora_eager_rope.py` patches the fresh path
(`_apply_language_lora_layers`). The resume path is `_apply_lora_layers → _to_lora`,
which *raises* on a switch layer, so a resumed run either dies or drops every expert
tensor — the v4a defect, composite 0.0210 against a 0.3174 baseline, nearly recorded as
"expert LoRA does not work".

**3. Freeze before a resumed apply.** `setup_model_for_training` freezes the towers only
on the fresh branch. Its resume branch freezes *nothing*. Measured here: a resumed run
printed `#trainable params: 657.691888 M || trainable% 9.951%` against the fresh run's
`118.849536 M || 1.798%`, and the adapter came back carrying 544 extra non-LoRA tensors
— the layer norms and the entire vision tower, trained by accident. The launcher now
freezes first and then **refuses to start** if the trainable count is not LoRA-sized.

*A second lesson from the same bug:* the first version of that patch was applied to
`mlx_vlm.lora.apply_lora_layers` and silently did nothing, because this launcher hands
argv to `runpy.run_module("mlx_vlm.lora", run_name="__main__")`, which re-executes the
module and rebinds every name it imported. Patch `trainer.utils`, not `lora`.

**4. Guardian's politest signal is the one that kills.**

```
guardian.log  17:31:57  shed sig=USR1 -> job='knowing-v1-lora' pid=78851
train log     17:31:57  ATTEMPT_DONE rc=158            # 158 = 128 + SIGUSR1(30)
```

Guardian's stage-1 shed is cooperative — its own source says *"SIGUSR1 means checkpoint
now and reduce your footprint"* — but `forge-job` traps only `EXIT INT TERM`
(`grep -n USR1 ~/.local/bin/forge-job` finds nothing), so its zsh wrapper takes the
default disposition and dies, taking the job with it before its first checkpoint. Every
job registered through that wrapper has this property.

The launcher therefore handles `SIGUSR1` by doing what it asks — atomic save, then
`mx.clear_cache()`, then **continue** — and `SIGTERM` by saving and exiting 143. The
runner registers the *Python* pid rather than a shell wrapper's, so the signal reaches
the process that can honour it. The shared wrapper is not edited: other agents' jobs are
running under it, and editing a live script is a hard invariant here.

---

## Two guards in the runner that are wrong in the obvious form

**LAW 7 cannot be a list of script names.** A sibling agent ran its own inference against
the same base model from a scratchpad script this guard had never heard of. Two 18 GB
models on a 36 GB box put *both* processes into uninterruptible wait at 0% CPU — not
"slower", stopped — and one trainer died of
`kIOGPUCommandBufferCallbackErrorOutOfMemory`. The guard now also matches **the base
model path**, which is the thing every such job has in common.

**Readiness cannot be absolute `vm.swapusage used`.** That was the first version and it
is unreachable on this machine: total RSS across every process was 4.5 GB while swap
still reported ~14 GB used, because macOS counts pages *written* to the swap file and
reclaims them lazily. Successive samples read 13163M, 14945M, 13674M, 13866M — rising
while the box was idle. Waiting for 4500M there is waiting for ever. The guard now uses
free-memory percentage plus swap **growth** over a 20 s window, because growth tracks
current demand and level does not.

---

## What the scoring path refuses to do

* Score anything before the adapter-loaded proof passes.
* Report a prefix. The holdout is sorted hardest-first — a prefix reads 0.2423 where the
  full set reads 0.3617 — so only all-41 runs are reported.
* Quote a floor without its n. A re-pin moved floor coverage 34 → 19 of 41 while the
  value moved only 0.4310 → 0.4281; a floor without its n has already produced one wrong
  conclusion here.
* Compare arms measured by different kernels. The incumbent's published 0.2394 was
  measured by verifier `45e9ad9a`, which fabricates geometry for unknown ops. Its
  persisted IR is re-scored under the current pin instead.
* Report a difference without an interval clustered on **families**. Three `ball_knob`s
  are one draw of a difficulty, not three.
