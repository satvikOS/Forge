# LE10's ~35% plateau: nodal-averaging depth is REFUTED, and the boundary has not converged

`T-026` asks for a root cause established by measurement before any code change — the
standard `T-015` was held to. **This does not establish one.** It eliminates the
leading candidate and quantifies the next. Recorded now so the elimination is not
repeated.

## The plateau

After the boundary-densification fix, LE10's error stops moving:

    targetEdge  0.30   0.24   0.20   0.15   0.115  0.09
    err %       49.43  35.14  35.99  35.46  35.91  34.20
    tets         2641   3996   6742  13020  25125  45098

Improved from the committed +60.5%, then flat across a 17x increase in element count.
`h_local` tracks properly now (0.22153 -> 0.08312), so the frozen-boundary explanation
is spent.

## Hypothesis 1 — nodal averaging depth. REFUTED.

The recovered quantity is `nodeSyy` at D = (2, 0, **top**): a nodal average over the
tets incident to a TOP-SURFACE node. Bending stress varies linearly through a plate,
so averaging over tets that reach downward biases the value toward mid-depth. For a
linear profile, `sigma_avg ≈ sigma_top · (1 − 2·d̄/t)` with `t = 0.6 m`.

Back-solving that from the measured errors gives an implied averaging depth that is
suspiciously **frozen**:

    targetEdge  0.30    0.24    0.20    0.15    0.115   0.09
    implied d̄   0.1483  0.1054  0.1080  0.1064  0.1077  0.1026

Measuring the patch directly says otherwise:

| targetEdge | tets | incident tets at D | patch depth max | **measured d̄** |
| --- | --- | --- | --- | --- |
| 0.30 | 2641 | 7 | 0.3000 | **0.0750** |
| 0.24 | 3996 | 4 | 0.1500 | 0.0469 |
| 0.20 | 6742 | 4 | 0.1500 | 0.0431 |
| 0.15 | 13020 | 4 | 0.1500 | 0.0375 |
| 0.115 | 25125 | 3 | 0.0750 | 0.0250 |
| 0.09 | 45098 | 4 | 0.0750 | **0.0234** |

The measured depth **shrinks 3.2x** while `targetEdge` falls 3.3x — it tracks the mesh
almost exactly. The implied depth is frozen at ~0.106. They disagree by **4.4x** at the
finest level, and if averaging were the cause the error would be `2·0.0234/0.6` ≈ 8%,
not 35%.

Also eliminated in passing: the probe lands on exactly `(2.000, 0.000, 0.600)` at every
level, so it is not drifting off D.

## Hypothesis 2 — the boundary has not converged to the geometry. SUPPORTED, not proven.

| targetEdge | tets | boundary faces | total boundary area | top-face area | vs exact |
| --- | --- | --- | --- | --- | --- |
| 0.30 | 2641 | 756 | 16.3305 | 4.7729 | −12.40 % |
| 0.24 | 3996 | 1136 | 17.0911 | 5.0671 | −7.00 % |
| 0.20 | 6742 | 1526 | 17.3538 | 5.0758 | −6.84 % |
| 0.15 | 13020 | 2814 | 17.5969 | 5.2463 | −3.71 % |
| 0.115 | 25125 | 4712 | 18.1157 | 5.2523 | −3.60 % |
| 0.09 | 45098 | 7218 | 18.0470 | 5.2722 | −3.24 % |

The **top face is flat**. Its exact area is the quarter elliptic annulus,
`π(3.25·2.75 − 2.0·1.0)/4 = 5.4487 m²`. A flat face's area is decided entirely by how
well its boundary polygon is resolved, and it is still **3.24 % short** at 45,098 tets,
having stalled around −3.5 % after the 0.15 level. Total boundary area grows 16.33 →
18.05 m² without settling.

That matches what the earlier investigation recorded of this mesher: the Bowyer-Watson
fill has **no boundary recovery** and the domain is carved by centroid classification,
so interior lattice points get exposed on the surface as steps. Pre-fix it measured
off-geometry boundary vertices growing 25 → 106 with a worst off-distance of 0.050 m.

Corroborating, and already on record: on a **structured exactly-conforming** mesh with
`meshShape` bypassed — same element, same assembly, same solver, same recovery — LE10
converges monotonically to **+10.69 %**. Same everything except the mesh.

## Why this is not yet a root cause

"The boundary has not converged" and "the stress plateaus at 35 %" are both measured,
and the structured-mesh comparison makes a causal link plausible. None of that
demonstrates it. What would:

1. Evaluate the recovered stress against the exact LE10 field at the ACTUAL node
   positions, separating "wrong geometry" from "wrong stress on right geometry".
2. Measure the deviation of boundary faces near D from the true surface, rather than
   inferring roughness from a global area.
3. A conforming-boundary variant of `meshShape` — the real test, but that is a code
   change and this task requires the cause first.

## Also measured, not yet explained

The recovery patch at D contains **3–7 incident tets at every level**, including at
45,098 tets. D sits where the inner elliptical surface meets the top face, so a small
patch is expected — but a stress concentration recovered from three constant-strain
tets is thin evidence regardless of what the boundary does.
