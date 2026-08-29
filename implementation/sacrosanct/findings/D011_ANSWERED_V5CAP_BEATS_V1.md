# D-011 answered: v5cap beats v1 by +0.0742, and v1 really is beaten by a box

**Measured 2026-08-29, paired on the 341 rows all three arms scored. v1 interim
(3 of 5 shards, round-robin so stratified); box and v5cap complete.**

## The three-arm picture

    box     composite 0.2373    shape 0.4248
    v5cap   composite 0.2766    shape 0.2551
    v1      composite 0.2024    shape 0.1866

    v5cap - box  +0.0393   95% CI [+0.0170, +0.0617]   EXCLUDES 0
    v1    - box  -0.0349   95% CI [-0.0546, -0.0144]   EXCLUDES 0
    v5cap - v1   +0.0742   95% CI [+0.0460, +0.1026]   EXCLUDES 0

**Both directions are now significant.** v5cap beats the bounding-box floor; v1 is
beaten by it. The programme's standing claim that "expert3d-v1 is beaten by a box"
is CONFIRMED -- but properly this time, paired, with an interval, rather than from
the n=25 comparison that could not resolve anything.

## v5cap beats v1 on EVERY component

    component     v1       v5cap    v5cap - v1
    shape       0.1866    0.2551      +0.0685
    interface   0.1754    0.2335      +0.0580
    topology    0.2879    0.4058      +0.1179
    composite   0.2024    0.2766      +0.0742

    row-wise: v5cap better on 169, v1 better on 110, ties 62

This is a different shape of result from v5cap-vs-box. Against the box, v5cap wins
on interface and LOSES badly on shape. Against v1 it wins on all three, with the
largest single gain in topology.

## Why D-011 was worth its seven hours

D-011 committed a second full emission run to put v1 on the same 600 rows, on the
argument that without it the adapter-versus-adapter question would stay exactly where
the underpowered run left it. The comparison it bought:

    n=25   v5cap - v1 = +0.0020   CI about +-0.12    unanswerable
    n=341  v5cap - v1 = +0.0742   CI [+0.046, +0.103]  decisive

The old point estimate was not merely imprecise: it was about **37x too small**, and
its interval was wide enough to contain everything from a large regression to a large
improvement. Anyone reading "+0.0020" would reasonably have concluded the adapters
were equivalent. They are not.

## Standing qualifications

* v1 is at 3 of 5 shards; box and v5cap are complete. The interval already excludes
  zero by a wide margin, but the final figure comes when shards 3 and 4 land.
* All three arms are scored against IDENTICAL references (tasks.jsonl sha1
  8443c1062fa16be1), guaranteed by `--reuse-tasks` rather than assumed.
* Refusal rates differ by arm -- box 2/600 (0.33%), v5cap 20/600 (3.33%), v1 7/461
  (1.5%) -- and the scorer REFUSES rather than scoring 0, which flatters the arms
  that can trigger it. The sensitivity variant charging candidate-side refusals as
  0.0 must accompany the final numbers.
