# RESULT — the real-construction-sequence corpus, rebuilt on the SARC-fixed kernel

Companion to `PREREG_abc_real_sequences.md`, which was written and committed BEFORE any
of the numbers below existed.

## THE HEADLINE, AND IT IS A STOP

**The corpus is 131 rows.** The training chain's own floor is `MIN_ROWS=1800`, and D-045
trained on 1,935. `chain_selfconsist_train.sh` applied to this corpus emits
`CHAIN_ABORT corpus too small: 131 < 1800`.

**So nothing was trained, and the pre-registered stop condition is the reason.** The
alternative was 2,400 iterations over 131 rows — about 73 epochs of memorisation — whose
holdout number would be uninterpretable in either direction. A corpus reported honestly
is worth more than a loss curve nobody can read.

Nothing has trained since 02:38 on 2026-09-01, and this round does not change that. What
it changes is that the reason is now a measured number rather than an open question.

## THE FUNNEL, RECONCILED AT EVERY STEP

    9,852   model directories in chunk-0000
    9,704   readable                                    (148 had no .yml)
      576   TRANSLATED to Forge IR                       (5.9% of read)
      487   PASSED the full 11-observable vector         (84.5% of translated)
      131   CANONICAL ROWS through canonicalize_dataset  (26.9% of passed)

    R1 reconciliation, asserted by the door and re-checked by hand:
        in 487  =  accepted 131  +  rejected 356
        rejected: trivial:faces<8          349
                  duplicate:signature_seen   7

**The dominant loss is not the kernel and not the translator — it is the door's own
triviality gate.** 349 of 487 proved solids have fewer than 8 faces. These are real human
sketch-and-extrude trees that build plain prisms. That gate is uniform across every
source and was NOT relaxed for this one: special-casing the triviality rule for the
source you happen to be adding is exactly what the mandatory door exists to prevent.

## CONTAMINATION — VERBATIM

    [census-scan] holdout files: 9; distinct held-out parts: 645
    [census-scan] /Users/account_clawteam1/archdisc-Models/data/forge/abc_real_seq_v1/train.jsonl: 131 rows -> clean (0 hits)
    [census-scan] PASS: no training row rebuilds a held-out part.

Holdouts are enumerated from disk at run time, not from a remembered list, because a
holdout created after a corpus is what retro-contaminates it.

## THE KERNEL A/B — 48 GAINED, 0 LOST, AND NOTHING ELSE MOVED

Paired per model over all 576 emitted trees, the SAME IR through both binaries. One
variable: PR #183.

    old kernel -> new kernel        n = 576
      built -> built    522          of these, observables that disagree:  NONE
      NOT   -> built     48          all 48 contain >= 1 SARC
      built -> NOT        0
      NOT   -> NOT        6

48 of the 108 arc-bearing trees (44.4%) were being silently broken. The 522 that already
built are BIT-IDENTICAL across the two binaries on all seven observables — the fix is
surgical, not a perturbation that happens to net positive.

### The four that looked like regressions, and were not

A first pass using `ok && volume>0` as "built" showed 4 lost. Inspected by name, three of
them (00002718, 00002724, 00003649) return the **identical volume and the identical error
text** from both binaries; only `ok` flipped from `true` to `false`. The kernel had
ALREADY diagnosed those solids as invalid and was reporting success anyway — that is
#183's second fix, and counting it as a regression would have been counting an honest
failure as a loss. The fourth (00001210, 4 SARCs) is `valid:false` under both. Scored on
the kernel's own `valid`, the transition is 48 / 0.

### Positive control, because a null A/B is easy to manufacture

`scripts/sarc_cross_binary_control.py`, half-disc r=10 h=5, expected volume 785.3982:

    CASE A  endpoints non-equidistant by 1e-6 (trips the defect)
      OLD  ok=TRUE  volume=0            "not closed"
      NEW  ok=true  volume=785.398242   exact
    CASE B  endpoints exactly equidistant (does not trip it)
      OLD  785.398163   NEW  785.398163   identical

`forge_gate_sarc_ring_gate`: 32/32 on the merged tree.

## WHAT THE CORPUS IS

Schema `{"image": null, "messages": [system, user, assistant]}`, 0 failures under
`validate_corpus.check_row`. The **user side is the kernel-measured face census**
(`TARGET GEOMETRY INVENTORY (full face census, kernel-measured)`, via
`gt_framing.user_decomp`), never the dataset's caption. The assistant side is the IR the
differential gate proved rebuilds that solid.

Ten distinct ops, every one user-invocable:

    SKETCH  SPT  SLINE  SARC  SCIRC  SOLVE      <- the family #184 unlocked
    EXTRUDE  CUT  TRANSLATE  RESULT

Six of the ten were FORBIDDEN before #184. That is the concrete sense in which this
corpus could not have been written before.

## THE CEILING — WHY 576, AND WHAT WOULD RAISE IT

The translator supports `newSketch` and `extrude` only. Model-level recovery census
(stride 10, 984 models; recovery = models that would clear EVERY gate if that one feature
were supported, since a model blocked three ways is not unlocked by fixing one):

    clear every gate today                    65
    blocked ONLY by unsupported features     255
      importForeign  137   <- imports geometry that is NOT IN THE YAML. Must stay refused.
      fillet          17       chamfer   8      shell  4
      revolve         15       thicken   4      mateConnector 4

**`importForeign` is over half the remaining headroom and is not recoverable at all** —
the geometry it names is not in the corpus. Of what is left, fillet / chamfer / shell /
revolve all name their edges, faces and axes by Onshape *deterministic id*, which needs a
document evaluator this pipeline does not have. That is the honest ceiling: roughly
183/984 (~18.6%) if every non-import feature were implemented, against 6.6% today, and
the gap is a document evaluator rather than more translator cases.

This round took the one honest step available without one: `mateConnector` and `cPlane`
build nothing and are now stepped over rather than refused (+6.2%, 65 -> 69). That
decision is the ONE the differential gate cannot check — both arms consume the same plan
— so it was measured over 1,970 models instead: 447 mateConnector and 1,061 cPlane
instances, zero with entities, zero referenced by another feature, and the 3 cPlanes that
carry subFeatures stay refused.

## SCORING THE PRE-REGISTRATION

P1/P2/P3/P4 are all predictions about a training run that the stop condition prevented,
so **none of them was tested.** They stand as written for whoever clears the size problem.

The stop condition itself was pre-registered and it fired. That is the only part of the
pre-registration this round resolved.

## WHAT WOULD ACTUALLY MOVE THIS

### First, a recommendation this document made and then MEASURED AND WITHDREW

The obvious move is to relax the triviality gate, since it is the largest single loss
(349 of 487). I wrote that recommendation before measuring what the gate rejects. It is
wrong, and here is the measurement that killed it:

    the 349 solids rejected by faces<8, by what their sketch contains
        lines only   183      (prisms / boxes)
        SCIRC        165      (cylinders and discs)
        SARC           1

    corpus size vs threshold          rows      arc-bearing (of 41)
        faces >= 8  (today)            138              40
        faces >= 6                     329              41
        faces >= 4                     421              41

**The gate keeps 40 of the 41 arc-bearing solids and throws away boxes and cylinders.**
Relaxing it to 6 buys 191 extra rows of which 180 are six-face prisms. This repo already
knows what training on boxes does — a box beats expert3d-v1 on both benchmarks — so
those rows are not neutral filler, they are the known trap. The triviality gate is doing
its job and should be left alone.

### In yield order, what is actually left

1. **More ABC chunks.** This is chunk-0000 alone: 9,852 models of ABC's ~1M. The
   pipeline is stride-1 and reproducible end to end, so the same funnel over ten chunks
   is ~1,310 rows with no new logic and no policy change. This is the only lever that
   reaches the 1,800 floor without either new capability or a rule change.
2. **A document evaluator**, which is what fillet / chamfer / shell / revolve actually
   need — not more translator cases. Worth ~44 models per 984 on top of what exists.
3. **Not `importForeign`**, ever: 137 of the 255 feature-blocked models name geometry
   that is not in the corpus at all.

### And a structural warning for whoever does clear the size problem

Re-read P2 in the pre-registration first. This corpus contains **zero VERIFY ops**, so
it cannot teach assertion truth directly, and every row ends `RESULT(%n)` with no
assertion — which may teach the model to stop asserting and collapse the denominator the
primary endpoint divides by. Report numerator and denominator, never the rate alone.

## LICENCE

ABC `ofs` provenance remains **UNVERIFIED** (CC BY-NC 4.0 upstream, MODEL_DATA.md §3).
Everything above is a capability measurement. None of it is a training licence.

## ARTEFACTS

    corpus      /Users/account_clawteam1/archdisc-Models/data/forge/abc_real_seq_v1/train.jsonl      (131 rows)
    rejections  /Users/account_clawteam1/archdisc-Models/data/forge/abc_real_seq_v1/rejected.jsonl   (356, each with a reason)
    verified    /Users/account_clawteam1/archdisc-Models/data/forge/abc_real_seq_v1/verified_pairs/  (487 step+ir+census)
    gate run    scratchpad/v_new_full/{results,emitted,summary}.json
