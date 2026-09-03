<!--
PROVENANCE — this file is a byte-preserved copy, not a new document.
It was written and committed in the Archie repo (`archdisc-Models`, which has no
remote) BEFORE the corpus was assembled and before any training step ran, on the
branch `worktree-wf_9097dbbd-57f-1`:

  first commit of this file : 5afcd66e17a0c2ba7397580961c99c0158ed62c7 2026-09-02T00:53:07-04:00 PREREG abcreal-v11: register the denominator-collapse test BEFORE the run
  last amendment            : ba00b8a400ce41d1dff3dd941d9cf1961de933b0 2026-09-02T01:26:21-04:00 PREREG amendment: v10's assertions are FALSE under the kernel that scores them

It is copied into the Forge record here so the pre-registration outlives the
worktree it was written in and can be read beside the DECISION it binds.
Copying it now does NOT backdate it; the timestamps above are the claim.
-->

# PREREG — arm `archie-30b-abcreal-v11`: real ABC feature trees, added to the self-consistent corpus

**Written before the corpus was assembled and before any training step ran.** D-045 has force
only because its prediction was registered in advance and allowed to fail. This document is
worth the same only if it is allowed to fail in the same way.

---

## 1. Where this starts

The previous arm, `archie-30b-selfconsist-v10`, is a **measured regression**. Paired on 238 ids:

| | v6r8 (baseline) | v10 |
|---|---|---|
| self-inconsistency = `verify_failed / rows_emitting_VERIFY` | **59.8%** | **92.8%** |
| VERIFY-emission rate = `rows_emitting_VERIFY / rows` | **55.0%** | **58.4%** |
| exact McNemar | — | **p = 6.68e-08**, 35 worse / 3 better |
| CBORE parts | 0 | **0 / 600** |

The **shape** of that failure is what this round is designed around. Training on 10,190
synthesised assertions made the model **build more** (+9.3 pts compiled) and **assert more**
(+3.4 pts VERIFY-bearing) while making its assertions **much less true**. It learned the
**form** of VERIFY without the **content**.

The working hypothesis this round tests: the assertions in v10 were true by construction but
attached to **synthetic** trees. Attaching true assertions to **real** construction sequences —
mined from real ABC/Onshape FeatureScript trees — is the change most likely to reconnect form
to content.

---

## 2. Four things I measured before writing this, which constrain the design

These are measurements, not assumptions. Each is reproducible from the paths given.

**(M1) The ABC corpus contains zero VERIFY ops.** Measured over
`data/forge/abc_real_seq_v1/train.jsonl` (131 rows): `rows with VERIFY = 0`.

**(M2) The ABC corpus uses six ops that are not in the model's op vocabulary, and only four
that are.** Ops used: `SKETCH, SPT, SLINE, SARC, SCIRC, SOLVE, EXTRUDE, CUT, FUSE, TRANSLATE`.
Of the 28 UI-invocable ops in `tools/archie_vocab/archie_op_vocabulary.json`
(sha `7508d957…`), exactly **4** appear: `CUT, EXTRUDE, FUSE, TRANSLATE`.

**(M3) A pure-ABC corpus is refused by the existing launch gate on three grounds that scaling
cannot cure.** Running the thresholds in `tools/selfconsist/check_kernel_legal.py`:

| gate check | pure ABC | cured by more chunks? |
|---|---|---|
| rows ≥ 200 | FAIL (131) | **yes** |
| `"VERIFY" in used` | **FAIL** | **no** — ABC trees never assert |
| UI-op overlap ≥ 20 | **FAIL (4)** | **no** — ABC is sketch/extrude/boolean only |
| assertions in sample > 0 | **FAIL (0)** | **no** |

ABC trees are sketch-extrude-boolean. They will never contain a `CBORE`, `HOLE`, `FILLET`,
`SHELL` or `PATTERN` however many chunks I download. Checks 2–4 are structural.

**(M4) The two SKETCH-capable kernels differ; the pinned eval kernels cannot parse SKETCH at
all.** `tools/pinned/forge_verify` and `tools/baseline_pin_45e9ad9a/forge_verify` both answer
``ft parse line 1: unknown op `SKETCH` `` on 25/25 real ABC targets. Only the Mech builds
`build-abcofs` and `build-sarc` compile them (25/25 each); the two binaries have different
sha256, so they are genuinely different arms.

---

## 3. The decision on the VERIFY question, and why

The trap this round must not fall into was registered before any result existed: **train on
rows that never assert, and the model may simply learn to stop asserting** — which collapses
the denominator and manufactures a beautiful self-consistency number that means nothing.

Three options were open. I am choosing **(a) + (b) together**, and rejecting (c).

- **(c) train on ABC alone, without VERIFY — REJECTED.** It is refused outright by the launch
  gate (M3), and it is the option that maximally invites denominator collapse. It would also
  make the primary endpoint unmeasurable, which is worse than a negative result.
- **(b) append a measured VERIFY to each ABC row — ADOPTED.** The kernel census already
  computed for the user side carries `faceCount` and `bbox`, which is exactly the form a v10
  assertion takes: `VERIFY(%n, "faces=…", "bbox.x=…", "bbox.y=…", "bbox.z=…")`. The values are
  read out of the kernel's own measurement of the built solid, so they are **true by
  construction** — and, unlike v10, they are attached to a **real** tree. Every such row is
  **rebuilt with the assertion in it**, and a row whose assertion does not pass cannot enter
  the corpus. This is the v10 discipline applied to real geometry.
- **(a) keep the VERIFY-bearing measure-then-assert rows — ADOPTED, and required.** (b) alone
  still fails gate check 3: ABC cannot supply the op breadth. The v10 rows carry `CBORE`,
  `HOLE`, `FILLET` and the rest, and they are true by construction already.

**The corpus is therefore:** `selfconsist_v10_split` rows **byte-identical** (1935 train / 103
valid) **plus** the ABC real rows, each carrying a measured, re-verified VERIFY.

**One-variable claim.** Against v10 the only thing that changes is the **addition** of the ABC
rows. The v10 rows are unchanged; every hyperparameter is unchanged (lora-rank 16, alpha 32,
lr 1e-5, iters 2400, max-seq 3072, batch 1, grad-accum 4). Iters are held at 2400 even though
the corpus grows, so that "more data" and "more optimisation" do not move together.

---

## 4. Predictions

Primary endpoint is a **PAIR**, reported always, and **neither half alone**:

- **(a) self-inconsistency** = `verify_failed / rows_emitting_VERIFY`
- **(b) VERIFY-emission rate** = `rows_emitting_VERIFY / all rows`

Paired on the same 238 ids as D-045.

**P1 (primary, directional).** (a) falls below v10's 92.8%. I expect it to land **between
v6r8's 59.8% and v10's 92.8%** — i.e. the regression is partly undone but the baseline is not
beaten. I am explicitly **not** predicting (a) < 59.8%.

**P2 (primary, the guard).** (b) does **not** collapse. Concretely: (b) ≥ 45%.

**P3 (what I expect NOT to move).** The composite score. With sd 0.2977 at n=600 the smallest
detectable delta is 0.034; anything smaller is unanswerable here and will be reported as
unanswerable, not as a null.

**P4 (registered so a null is not misread).** **CBORE stays at or near 0.** The ABC corpus
contains no CBORE and cannot teach one (M2). A CBORE null is **not** evidence against this
round; it is the expected result, and any claim that this corpus would fix CBORE would be
unfounded.

---

## 5. THE DENOMINATOR-COLLAPSE TEST (the pre-registered kill switch)

Baseline emission rates on the same 238 ids: **58.4% (v10)** and **55.0% (v6r8)**.

> **A drop in (a) accompanied by a drop in (b) is DENOMINATOR COLLAPSE, not progress.**

**Declared collapsed if:** (b) falls **below 45%** — i.e. ≥ 10 points under the lower baseline
of 55.0% — **and** that paired drop is significant by exact McNemar at p < 0.05.

If that fires, I will write, in these words, that the arm **stopped being measurable rather
than improved**, and P1 will be reported as **void** regardless of how good (a) looks. A run
that goes from 85.5% to 20% by emitting almost no VERIFY has not improved.

---

## 6. THE INSTRUMENT TRAP (registered in advance, from M4)

This one is specific to this round and did not apply to D-045.

The eval pins its measurement to `tools/baseline_pin_45e9ad9a/forge_verify` and
`tools/pinned/forge_verify`. **Neither can parse the SKETCH family** (M4). If the trained model
emits those ops on the holdout, then:

- the **denominator** (b) is safe: `rows_emitting_VERIFY` is read from the model's **text** by
  regex in `measure_failure_v2.py`, not from the kernel, so it is instrument-independent;
- the **numerator** is **not** safe: `verify_failed` is read off the kernel's error string. A
  SKETCH-bearing row becomes a *parse error*, **not** `verify_failed` — which **silently
  lowers** self-inconsistency and manufactures a flattering (a).

**Therefore, pre-registered:** I will measure with **both** the pinned baseline binary (for
comparability with every prior arm) **and** `build-sarc` (for capability), and report both. I
will additionally report **the number of holdout rows emitting any SKETCH-family op**.

> **An improvement in (a) that appears under the pinned binary but NOT under `build-sarc` is an
> INSTRUMENT ARTEFACT, and I will say so in those words.** If SKETCH-family emission on the
> holdout is > 0, the pinned number is **not interpretable alone**.

---

## 7. What would make this round a failure I report as a failure

- (b) collapses below 45% → collapse, P1 void, reported as such.
- (a) does not fall below 92.8% → the real-tree hypothesis is wrong; report the negative.
- Nothing moves at all → say so plainly. **A second honest negative is worth more than a
  flattering number.**
- The corpus cannot be assembled large enough to clear the 200-row floor and the 20-UI-op
  floor → report that training did not run, and why. **Preparation is not a result.**

---

## 8. Provenance and standing constraints

- Kernel for corpus construction: `build-sarc` (the SARC fix; paired on 576 trees it gained 48
  built and lost 0, because 44.4% of arc-bearing trees were silently broken before it).
- The **triviality gate is NOT relaxed.** Of the 349 rows it rejects, 183 are lines-only
  prisms, 165 are cylinders, and exactly 1 is arc-bearing; 180 have exactly 6 faces. Relaxing
  it buys boxes and teaches short trees — the failure this programme exists to escape.
- Every row passes `scripts/canonicalize_dataset.py` and `scripts/validate_corpus.py`; the
  **user side is the kernel-measured face census, never a caption**.
- The contamination guard runs on **every chunk**, and hits are reported verbatim.
- ABC provenance remains **UNVERIFIED** per `MODEL_DATA.md`. This is a capability
  demonstration, **not** a claim of a training licence.

---

## 9. Appendix, added before training: the instrument trap is sharper than section 6 says

Measured while the corpus was still building, so this still precedes the run.

`check_kernel_legal.py` decides whether a binary knows an op by sending `%1 = OP(1,2,3)`
and asking whether the reply contains the literal string ``unknown op `OP` ``. Run against
a **fabricated** op name:

| binary | `%1 = ZZZNOTANOP(1,2,3)` | `%1 = QQQFAKE(1,2,3)` |
|---|---|---|
| `tools/pinned/forge_verify` | **ok=True, volume=6** | **ok=True, volume=6** |
| `tools/baseline_pin_45e9ad9a/forge_verify` | **ok=True, volume=6** | **ok=True, volume=6** |
| `build-sarc` | ok=False, ``unknown op `ZZZN…` `` | ok=False, ``unknown op `QQQF…` `` |

Volume 6 with 6 faces and 12 edges is a 1×2×3 **box**. Both pinned binaries **silently
build a box for any unrecognised op with three numeric arguments** and never say
"unknown op".

Two consequences, both of which bind this round:

1. **The op-probe in `check_kernel_legal.py` is vacuous under either pinned binary.** It
   cannot emit an unknown-op verdict, so its line "OK: every op used is known to
   forge_verify" is a statement that cannot fail. This file already warns, about a
   different check, that *a gate that cannot fail is not a gate*. The same is true here.
   Only the gate's second check — that a sample actually compiles — is doing work. **The
   launch gate for this round is therefore run with `build-sarc`, which rejects correctly.**

2. **Section 6's trap is worse than "SKETCH rows become parse errors".** Under the pinned
   binary a SKETCH-family op written with three numeric args does not error — it returns a
   **box**, with a `volume`, so `measure_failure_v2` records `built=True` for a solid the
   model never described, and evaluates its VERIFY against the wrong geometry. That can move
   **both** halves of the endpoint in flattering directions at once.

   → This does not change the pre-registered collapse test. It **raises** the standing of the
   `build-sarc` measurement: where the two instruments disagree, **`build-sarc` is the
   authority on capability and the pinned number is reported only for continuity with prior
   arms.** Any improvement visible only under a pinned binary is an **instrument artefact**
   and will be named as one.

---

## 10. AMENDMENT, before training: `--train-on-completions` INVERTS on more than half of v10

Measured before any training step ran. This is the most important thing found this round and
it changes the corpus design, so it is recorded here rather than in the results.

### What the trainer actually does

`mlx_vlm/trainer/sft_trainer.py` **truncates, it does not skip**:

```python
L = min(len(arr), padded_len);  input_ids_batch[i, :L] = arr[:L]
```

and the completions mask is built from the **first** occurrence of token `77091` (`assistant`):

```python
positions = np.where(row == assistant_id)[0]
assistant_response_index = positions[0] if positions.size else -1
assistant_mask = range_matrix <= assistant_response_index   # masked = NOT trained
weight_mask = mx.where(assistant_mask, 0, weight_mask)
```

If the assistant marker is **outside the truncation window**, `positions` is empty, the index is
**−1**, `range <= -1` is **all False**, and `weight_mask` stays **all ones**. The row is then
trained on **everything inside the window — which is pure prompt text**.

### Measured on the corpora, through the real chat template and the real tokenizer

| | v10 split (what D-045 trained on) | ABC |
|---|---|---|
| rows | 1935 | 131 |
| marker lands correctly at the assistant turn | 100% | 100% |
| marker lands early (in prompt text) | 0 | 0 |
| **marker BEYOND 3072 → mask degrades to all-ones** | **1020 (52.7%)** | 11 (8.4%) |
| whole row fits, **assertion survives** | **690 (35.7%)** | 92 (70.2%) |
| assistant truncated, assertion lost | 230 (11.9%) | 28 (21.4%) |

There is **no** early-cut bug: the marker is correct wherever it is visible. The defect is
purely the interaction of truncation with the `-1` fallback.

### What this means for D-045

On **52.7%** of its rows, v10 did not train on completions at all — it trained the model to
**predict the system prompt and the face-census JSON**. Only **35.7%** of rows delivered an
intact assertion into the gradient, and those were systematically the **short, simple** trees.

That is a mechanical account of D-045's exact shape: the model **asserted more** (it saw VERIFY
forms, from the short rows that fit) and its assertions were **much less true** (it never saw an
assertion attached to a long construction, and half its gradient went on prompt text). "It
learned the FORM of VERIFY without the CONTENT" is what this training signal would produce.

**This does not retract D-045.** Its paired measurement stands. What it does is supply a cause
that is not "synthetic assertions are useless", and it means D-045 never actually tested the
hypothesis it was framed as testing.

### The design response, and the cost to the one-variable claim

Raising `--max-seq-length` is **not** available: v10 peaked at **29.337 GB** on a 36 GB box
shared with other agents, and an OOM costs hours of someone else's work too.

So the corpus is filtered instead: **only rows whose ENTIRE sequence fits in 3072 tokens enter**,
on both sides of the mix. Every surviving row masks correctly and carries its assertion.

**I am explicitly withdrawing the "v10 rows byte-identical" claim from section 3.** This arm is
therefore **not** a pure one-variable test against v10, and I will not report it as one. The
change is two-part and both parts are disclosed:

1. real ABC rows are **added**;
2. rows that provably teach the wrong thing are **removed** from both sides.

A pure one-variable test was available and I am declining it, because it would run the
comparison through a channel measured to be inverted on 52.7% of the rows. Testing a corpus
hypothesis through that channel would answer a question nobody asked.

**Everything else stands unchanged**: the endpoint is still the PAIR, the collapse test in
section 5 is unchanged, and the instrument rules in sections 6 and 9 are unchanged.

---

## 11. AMENDMENT, before training: v10's assertions are FALSE under the kernel that SCORES them

Measured before training. Same 120 randomly-sampled v10 targets, one subprocess per row,
through three binaries.

| binary | compiled | rows with a **failing** assertion | disagreeing key |
|---|---|---|---|
| `tools/pinned` — the corpus's **generating** kernel | 120/120 | **0** | — |
| `tools/baseline_pin_45e9ad9a` — **the kernel D-045 SCORED with** | 108/120 | **12 (10.0%)** | `faces` ×24 |
| `build-sarc` | 118/120 | 2 (1.7%) | `faces` ×4 |

Every disagreement is on **`faces`**, and it is **systematic and one-directional** — the
scoring kernel counts **more** faces than the training kernel:

```
faces: asserted  23, baseline_pin got  35
faces: asserted  17, baseline_pin got  23
faces: asserted 127, build-sarc   got 141
faces: asserted  42, build-sarc   got  43
```

### Why this matters more than anything else measured this round

v10's VERIFY values are true **by construction** — but only under the binary that generated
them. The eval exports `FORGE_VERIFY=.../baseline_pin_45e9ad9a` and scores with it, and the
baseline artefact is literally named `v6r8_part1_BASELINEPIN.json`.

So a model that had learned the training distribution **perfectly** would still be scored
**self-inconsistent** on its `faces` assertions, because the number it was taught to assert is
not the number the scorer computes. **`verify_failed / rows_emitting_VERIFY` is therefore not a
pure measure of the model's self-consistency; it contains a train/score instrument
disagreement.**

Together with section 10 this gives a second, independent, measured contributor to D-045's
shape. The corpus taught `faces=N` calibrated to kernel A; the endpoint asked kernel B.

**This still does not retract D-045's paired measurement** — v10 really did get worse than v6r8
against a fixed instrument, and both arms were scored by the same binary. What it removes is the
inference that the corpus was the cause: a systematic `faces` offset that the corpus *installed*
and the scorer *penalised* is at least as good an explanation as "synthetic assertions do not
teach truth".

### The bind this creates, stated plainly

- ABC rows need a SKETCH-capable kernel — only `build-sarc` and `build-abcofs` qualify.
- The eval scores with `baseline_pin`, which **cannot parse SKETCH at all**.
- `build-sarc` and `baseline_pin` **disagree on `faces`**.

There is therefore **no single binary under which this corpus is both readable and true**. I am
not going to pretend otherwise. `check_kernel_legal.py` fails the v10 corpus under `build-sarc`
(2/120) and under `baseline_pin` (12/120); it passes only under `pinned`, which cannot read the
ABC half.

### The design response

The corpus is made **self-consistent under exactly one named kernel, `build-sarc`**, which is
the only one that can read all of it:

- ABC rows are true under it by construction (the assert stage probes and re-verifies with it);
- v10 rows are **filtered** to those whose assertions still hold under it (measured cost ≈1.7%).

**Registered consequence, so it cannot be claimed as a win later:** the arm is trained to be
truthful under `build-sarc` and will be scored partly under `baseline_pin`. The residual `faces`
disagreement is a **known, quantified confound of ~10% of assertion-bearing rows**, and any
change in (a) smaller than that is **not** attributable to the corpus. I will report the
`build-sarc` measurement as the capability number and the `baseline_pin` measurement as the
continuity number, and I will state this confound beside both.
