# knowing_train — one checkpoint on the knowing_v1 corpus, scored against a box

Four files, in the order they run.

| file | what it is |
|---|---|
| `knowing_v1_lora.yaml` | the training configuration, with a reason beside every field |
| `launch_vlm_expert_lora.py` | `mlx_vlm.lora` + three patches it cannot run without here |
| `train_knowing_v1.sh` | the restartable runner: LAW 8, LAW 7, resume, checkpoint pruning |
| `prove_adapter_loaded.py` | four independent checks that the adapter is on the compute path |
| `compare_arms.py` | paired, per-family comparison with a family-clustered interval |
| `score_knowing_v1.sh` | proof → sweep → re-score the incumbent → compare |
| `PROBE.md` | the 40-iteration sizing probe, and what it caught |

## Run it

```sh
# 1. train (restartable; retries by itself, resumes from the newest checkpoint)
bash tools/knowing_train/train_knowing_v1.sh 8000

# 2. prove + score + compare
bash tools/knowing_train/score_knowing_v1.sh adapters/archie-30b-knowing-v1
```

**Copy these two files somewhere immutable before launching a long run and launch from
the copy.** Bash reads a script incrementally, at command boundaries, so editing the file
a supervisor is executing changes what it does next — invariant 8 in `CLAUDE.md`, and it
happened here mid-run.

## The three things that make this different from a plain `mlx_vlm.lora` invocation

1. **Eager multimodal RoPE.** The fused MRoPE is a `mx.fast.metal_kernel` — a
   `CustomKernel` with no registered vjp — and it sits on the LoRA gradient path.
   Backward dies with `[Primitive::vjp] Not implemented for CustomKernel` without it.

2. **Expert LoRA on the resume path as well as the fresh one.** 89% of this model's bytes
   are `QuantizedSwitchLinear` experts that mlx_vlm cannot see. `lora_eager_rope.py` in
   the model repo patches the fresh path only; a resumed run drops every expert tensor,
   which is the exact shape of the defect that produced composite 0.0210 against a 0.3174
   baseline and was nearly recorded as "expert LoRA does not work".

3. **Freeze before resume.** mlx_vlm freezes the towers only on the fresh branch. Its
   resume branch trains the layer norms and the whole vision tower — measured here as
   657.7 M trainable parameters against the correct 118.8 M, and a saved adapter carrying
   544 tensors that do not belong to it. The launcher freezes first and then *refuses to
   train* above a LoRA-sized parameter ceiling.

## Sharing a 36 GB box

Two 30B jobs do not fit. When they collide the failure is not "slower": both processes
enter uninterruptible wait at 0% CPU and **neither** progresses — measured, 37 s of CPU
in 9 minutes — and one of them eventually dies with
`kIOGPUCommandBufferCallbackErrorOutOfMemory`.

`wait_for_box` therefore waits on three things, and each pattern is there because a
simpler one failed:

* the known trainer/scorer scripts by name — but *a list of script names is not a list of
  jobs*; a sibling agent's `scratchpad/attack/obedience_probe.py` matched nothing;
* any **python** process with the base model path on its command line — the process name
  matters, because `pgrep -f` also matches an observer shell that merely greps for that
  string, and a guard that counts observers waits for ever;
* **free memory percentage and swap *growth***, never absolute swap. `vm.swapusage used`
  is unusable as a readiness signal on macOS: with 4.5 GB of total RSS on the box it
  still read ~14 GB, and successive samples went 13163M → 14945M → 13674M while the
  machine was idle, because the swap file is reclaimed lazily. Rising swap means someone
  is allocating; a high flat level means nothing.

Checkpoints are written every 125 iterations (~6.7 min) rather than every 250, because
the collision rate sets the cadence: an attempt that dies before its first checkpoint
loses everything, and three attempts in a row did exactly that.

## Guardian: the politest signal in the system is the one that kills

Registration is not etiquette. Guardian sheds **only registered jobs**, so an
unregistered 25 GB trainer is simultaneously invisible to the shedder *and* the pressure
that starves every process politely waiting on `forge-gate`. This run registers.

But registering through `forge-job` is, today, a way to be killed. The evidence is one
second wide:

```
guardian.log  17:31:57  shed sig=USR1 -> job='knowing-v1-lora' pid=78851
train log     17:31:57  ATTEMPT_DONE rc=158              # 158 = 128 + SIGUSR1(30)
```

Guardian's stage-1 shed is **cooperative** — its own source says *"SIGUSR1 means
checkpoint now and reduce your footprint"* — but `forge-job` traps only `EXIT INT TERM`
(`grep -n USR1 ~/.local/bin/forge-job` finds nothing), so its zsh wrapper takes SIGUSR1's
default disposition, terminates, and takes the job with it *before its first checkpoint*.
Every job registered through that wrapper inherits this. `guardian.log` shows the same
shape for `kernel-core`, `desktop-gates` and `measure-red`: a stage-1 USR1, then the same
job name reappearing under a different pid.

The two halves of the fix here, neither of which edits the shared wrapper (other agents'
jobs are running under it, and editing a live script is invariant 8):

* **`launch_vlm_expert_lora.py`** installs a `SIGUSR1` handler that does what Guardian
  asks — atomic save of the adapter, `mx.clear_cache()` — and then **continues**. Stage 1
  is a request, not an eviction. `SIGTERM` (stage 3) saves and exits 143.
* **`train_knowing_v1.sh`** calls `forge-gate --need orange --wait 900` for admission,
  exactly as `forge-job` does, then writes the job envelope itself with the **Python**
  pid rather than a shell wrapper's, and removes it on every exit path including a trap.
  The signal now reaches a process that can honour it.

`--need orange`, not green: a job that loads an 18 GB model will never see green on this
box, and waiting for green is waiting for a condition the job itself prevents.

The one-line fix for everybody else lives in `forge-job`, not here: trap `USR1` and
forward it to the child, or at minimum `trap "" USR1` so the cooperative signal stops
being fatal.
