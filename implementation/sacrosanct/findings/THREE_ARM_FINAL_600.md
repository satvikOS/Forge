# FINAL: three arms, 600 rows each, paired -- v5cap beats the box, v1 is beaten by it

**Completed 2026-08-29. All three arms ran to 600/600 presented rows against
IDENTICAL references (`tasks.jsonl` sha1 `8443c1062fa16be1`, shared via
`--reuse-tasks`), scored through the pinned verifier
(`45e9ad9a...`), `--align centred-longest --grid 64`.**

This supersedes every interim number in `D011_ANSWERED_V5CAP_BEATS_V1.md` and
`V5CAP_BEATS_THE_BOX_AND_WHY.md`, which were reported at n=341 and n=579.

## Scored and refused

    arm      scored    refused
    box      598/600     2  (0.33%)   ho617, ho625
    v5cap    580/600    20  (3.33%)   ho14 ho225 ho232 ho254 ho424 ho616 ho625
                                      ho680 ho694 ho805 ho810 ho826 ho863 ho974
                                      ho998 ho1041 ho1139 ho1187 ho1211 ho1215
    v1       590/600    10  (1.67%)   ho211 ho301 ho331 ho408 ho448 ho522 ho574
                                      ho617 ho1237 ho1342

Refusal rates MOVED throughout the run and every early quote was wrong -- v1 was
quoted at 0.7%, then ~1.7%, and FINISHED at 1.67%. The v5cap:v1 gap is 2x, not the
5x an early partial suggested. `ho625` is refused for box AND v5cap; `ho617` for box
AND v1; so reference-side refusals are not arm-symmetric and cannot be assumed to
cancel.

## The result, paired on the 570 rows EVERY arm scored

               shape  interface  topology  composite
    box       0.4239     0.0000    0.3357     0.2367
    v5cap     0.2568     0.2376    0.4103     0.2798
    v1        0.1898     0.1781    0.2965     0.2065

    v5cap - box   +0.0431   95% CI [+0.0260, +0.0602]   EXCLUDES 0
    v1    - box   -0.0302   95% CI [-0.0454, -0.0149]   EXCLUDES 0
    v5cap - v1    +0.0734   95% CI [+0.0519, +0.0946]   EXCLUDES 0

20k paired bootstrap. **All three intervals exclude zero.**

## Sensitivity: candidate-side refusals charged as 0.0

A refused candidate row leaves the paired set, and an arm that refuses more could
in principle be flattered by it. Charging every candidate-side refusal a score of
0.0 and re-pairing on all 600:

    v5cap - box   +0.0336   95% CI [+0.0172, +0.0505]   n=600   EXCLUDES 0
    v1    - box   -0.0349   95% CI [-0.0495, -0.0202]   n=600   EXCLUDES 0
    v5cap - v1    +0.0685   95% CI [+0.0481, +0.0892]   n=600   EXCLUDES 0

Every conclusion survives the harshest treatment of refusals. v5cap's advantage
shrinks (it refuses the most, so it is charged the most) but does not vanish.

## Compile rate, all 600 emitted rows, paired McNemar

    v1    64/600 = 10.7%
    v5cap 147/600 = 24.5%
    discordant: v5cap-only 124, v1-only 41    chi2 = 40.8
    difference +13.8 pp, 95% CI [+9.6, +18.0] pp

## What it actually says, and what it does not

**v5cap beats the bounding-box floor.** That is the first arm in this programme
that does. **v1 is beaten by the box**, confirming the standing claim -- but
properly this time: paired, on 600 rows, with an interval. The n=25 comparison this
replaces read the v5cap-v1 difference as +0.0020 with a CI of about +-0.12, roughly
37x too wide to resolve a real +0.073.

**Against the box, v5cap wins ENTIRELY on interface (0.2376 vs 0.0000) and topology,
and LOSES badly on shape (0.2568 vs 0.4239).** A box scores zero on interface
because it has no features to mate; it scores 0.4239 on shape because most parts in
this corpus are, to a voxel grid, mostly a block. So v5cap places functional
features that the floor cannot, and still does not get the overall solid right.

**The next work points at SHAPE, not at interface.** Interface is where the model
already beats the floor; shape is where it is beaten by an object with no
information in it at all.
