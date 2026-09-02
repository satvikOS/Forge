# The sketch family closed the whole "direct ops alone" gap and none of the gate gap — and it is NOW user-invocable

Measured 2026-09-01 over **9,846 non-empty OnShape FeatureScript trees / 154,637 features**
(`data/external/abc_ofs/abc_0000_ofs_v00.7z`, 9,852 files, 6 empty, 0 parse errors).
Tool: `implementation/sacrosanct/tools/abc_yield_census.py`. Paired: the same trees are
scored under four op vocabularies that differ only in which ops exist.

> **UPDATED 2026-09-01, after the finding was acted on.** This document was written when
> the answer was "0.00%, and the fix is one merge away". That merge is PR #184: eight
> `forge::ui` commands now emit the seven sketch ops, `user_invocable_ops` moved 46 → 53,
> `forbidden_ops` 9 → 2, and **arm 3 — the vocabulary a user can now reach — measures
> 40.78% (4,015 of 9,846), exactly what arm 2 predicted.** Every number below is unchanged
> and re-measured; what changed is which arm describes today. Where the original text says
> "arm 1 (HEAD, emittable)" or "one merge away", the corrections are marked inline.

## The premise that had to be corrected first

PR #163 merged at `30a841cd` and it **did** add the sketch family to
`archie_op_vocabulary.json` — but into **`forbidden_ops`**, not `ops`:

| | pre-#163 `a9b4beed` | post-#163 `30a841cd` | post-#184 |
|---|---|---|---|
| `ops` (user-invocable) | 46 | **46 — unchanged** | **53** |
| `forbidden_ops` | `ARC, SLOT` | `ARC, CON, SARC, SCIRC, SKETCH, SLINE, SLOT, SOLVE, SPT` | `ARC, SLOT` |

Each new entry carries `compiled_into_a_default_build: true` with
`reason: "no command in the forge::ui registry emits it, so no user can produce it"`, and
`emission_policy.allowed_ops` still lists exactly the 46 without them, under the rule
*"Emit ONLY an op listed in `ops`… including every op in `forbidden_ops`."*

**The kernel gained the sketch family. The emittable vocabulary did not** — until #184,
which is what this premise was written to provoke. #176, which takes CON from 9 to 19
keywords, is still OPEN and titled "do NOT merge", so #184's two CON commands offer only the
**nine** keywords `forge::Sketcher` dispatches at this SHA.

## Paired before/after

Arm 0 is `b003bb3a`, the 40-op vocabulary the original census was taken against.
Arm 2 adds the 9 `forbidden_ops` — what the kernel can compile, not what a user can reach.
Arm 3 is #184's 53: arm 1 plus the seven sketch ops, USER-INVOCABLE, with `ARC` and `SLOT`
still forbidden.

| | instances DIRECT | PARTIAL | NONE | models clearing both gates | **DIRECT OPS ALONE** |
|---|---|---|---|---|---|
| prior census (reported) | 55.08% | 39.55% | 5.37% | 55.20% | **0.00%** |
| **arm 0** 40 ops | 85,175 **55.08%** | 61,090 39.51% | 8,372 5.41% | 5,452 **55.37%** | 0 **0.00%** |
| **arm 1** 46 ops (emittable BEFORE #184) | 86,293 **55.80%** | 61,090 39.51% | 7,254 4.69% | 5,629 **57.17%** | 0 **0.00%** |
| **arm 2** 55 ops (kernel, +sketch) | 133,019 **86.02%** | 14,364 9.29% | 7,254 4.69% | 5,629 **57.17%** | 4,015 **40.78%** |
| **arm 3** 53 ops (emittable AFTER #184) | 133,019 **86.02%** | 14,364 9.29% | 7,254 4.69% | 5,629 **57.17%** | 4,015 **40.78%** |

Arm 0 reproduces the prior census's DIRECT share to four decimals (55.0806%) and its
geometry gate exactly (882 models = 8.96%), which is what licenses the pairing.

### The headline WAS 0.00%. It is now 40.78%, and the mechanism is the one named here

When this was written, the answer against the vocabulary Archie could actually emit was
**0 of 9,846 models with direct ops alone**. The reason was single and exact: **`newSketch`
is present in 100.00% of all 5,629 models that clear both gates.** Every translatable tree
opens with a sketch; a sketch was reachable only as a canned profile or a POLY
tessellation, so no tree was lossless.

**That is now fixed, and arm 3 measures it rather than inheriting it.** 93.63% of the
49,903 sketches (46,726) are pure line/circle/arc and are exactly reproducible by
`SLINE` / `SCIRC` / `SARC`, taking DIRECT from 55.80% to 86.02% of instances and direct-only
models from 0 to **4,015** (71.3% of everything that clears). Arm 3 is not an alias for
arm 2: arm 2 is the kernel's 55 ops and arm 3 the 53 a user can reach, and they agree
because neither `ARC` nor `SLOT` reaches a `newSketch` — a prediction the census measures.

It closes **the entire** direct-ops-alone gap and **zero** of the gate gap: clearance is
5,629 in arms 1, 2 and 3 alike, because exposing the sketch family reclassifies PARTIAL to
DIRECT and never NONE to anything.

**One caveat #184 carries forward.** DIRECT is scored at OP level, so 40.78% is an UPPER
bound: `part.sketch_new` emits the plane as the literal `XY`, because the kernel's `skNew`
accepts `YZ`/`XZ` and then reports "NOT APPLIED — solved on XY". A tree whose sketch is on
another plane counts DIRECT here and is not emittable — the same class of looseness as
`REVOLVE`'s 8-argument form pinning the axis origin to `0,0,0`.

## What still blocks (4,217 non-clearing models, first blocker in tree order)

Identical on arms 1 and 3 — the sketch family unblocks nothing, so this table did not move.

| first blocker | models | % | class |
|---|---|---|---|
| `importForeign` | 2,163 | 51.29% | **unrecoverable in principle** |
| `<spline/ellipse/conic in sketch>` | 689 | 16.34% | geometry gap |
| `draft` | 369 | 8.75% | not yet implemented |
| `mateConnector` | 363 | 8.61% | **unrecoverable in principle** |
| `helix` | 271 | 6.43% | not yet implemented |
| `importDerived` | 87 | 2.06% | **unrecoverable in principle** |
| `assignVariable` | 85 | 2.02% | **unrecoverable in principle** |
| `cPoint` | 81 | 1.92% | not yet implemented |
| `copyPart` | 41 | 0.97% | **unrecoverable in principle** |
| `replaceFace` | 27 | 0.64% | not yet implemented |
| 21 further types | ≤8 each | 0.83% | not yet implemented |

| class | models | % of non-clearing |
|---|---|---|
| unrecoverable in principle (no history to parse, or assembly-layer) | **2,740** | **64.98%** |
| not yet implemented | 788 | 18.69% |
| geometry gap (curve entities) | 689 | 16.34% |

**Two thirds of the remaining failure cannot be recovered by any op at all.**

## Measured recovery, never inferred

Each figure re-runs the model-level gate with that one feature type made mappable, because a
blocked model is usually blocked more than once.

| candidate | instances | models containing | **measured** | naive (models containing) | inflation |
|---|---|---|---|---|---|
| `importForeign` | 2,258 | 2,170 | **+1,912** | 2,170 | 1.13× |
| `mateConnector` | 2,196 | 708 | **+327** | 708 | 2.17× |
| `draft` | 898 | 481 | **+295** | 481 | 1.63× |
| `helix` | 445 | 328 | **+200** | 328 | 1.64× |
| `cPoint` | 338 | 138 | **+56** | 138 | 2.46× |
| `assignVariable` | 365 | 102 | **+42** | 102 | 2.43× |
| `importDerived` | 174 | 115 | **+41** | 115 | 2.80× |
| `replaceFace` | 170 | 82 | **+18** | 82 | 4.56× |
| `copyPart` | 207 | 75 | **+10** | 75 | 7.50× |
| `modifyFillet` | 96 | 53 | **+4** | 53 | 13.25× |
| curve entities (spline/ellipse/conic) | — | 882 | **+548** | 882 | 1.61× |
| 31 further types (tail) | ≤17 | ≤12 | **+22 total** | 64 | 2.91× |

Combinations, measured rather than summed:

| | measured |
|---|---|
| `draft`+`splitPart`+`helix` | **+505** (sum of singles 495) |
| every not-yet-implemented op (34 types) | **+634** |
| curve entities only | **+548** |
| every not-yet-implemented op **and** curve entities | **+1,328** |

This re-confirms the earlier lesson at a new scale, and shows the error runs in **both**
directions — which is the reason to measure rather than arithmetic:

* the **naive** read (models containing the op) predicts **1,142** for the 34
  not-yet-implemented types; the first-blocker histogram predicts **788**. Both overstate.
* the **sum of measured singles** is **594** — this *understates*, because some models are
  blocked by two different not-yet-implemented ops and unlock only when both ship.
* measured **jointly**: **+634**. Neither the sum nor any instance count reaches it.

Op-vocabulary work still has a low ceiling here, and the largest single recoverable item is
not an op at all — it is the **548** models gated by curve entities.

## End to end

**5,629 of 9,846 models (57.17%) are fully translatable today** under the vocabulary Archie
may emit — unchanged by #184, because the sketch family unblocks nothing. What #184 changed
is that **4,015 of them (40.78% of the corpus) are now LOSSLESS** rather than requiring a
lossy sketch step. Before it, that figure was zero.

The ceiling, if every not-yet-implemented op and curve entities all shipped, is **6,957
(70.66%)**. The residual **2,889 models (29.34%) are unrecoverable in principle**: they
carry no feature history to parse, or exist only at the assembly layer.

**LICENCE:** this corpus's provenance is flagged UNVERIFIED in `MODEL_DATA.md`. Nothing
measured here clears that flag. These are capability counts, not a training licence, and no
model here may be used as training data on the strength of this document.

## Reproduce

```
python3 implementation/sacrosanct/tools/abc_yield_census.py \
  --archive data/external/abc_ofs/abc_0000_ofs_v00.7z --extract-to <scratch> \
  --json implementation/sacrosanct/findings/abc_yield_remeasure.json
```
