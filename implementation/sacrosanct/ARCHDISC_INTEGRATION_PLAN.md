# ArchDisc ecosystem integration — the plan for after the fan-out lands

**Owner's directive (2026-08-31):** *"once all lands start implementing it into the ArchDisc
Ecosystem. Model should be aware of all ops, how to generate systematic ultra long Feature trees
and the Kernel executing it. both headless and via Forge C++ app."*

This document exists to stop the integration being done in the wrong order. Three of the four
steps below are blocked on something, and doing them early wastes the work.

---

## The dependency order, and why it is not negotiable

```
  app widens the op surface  ──►  corpus regenerated against the NEW surface  ──►  train
          │                                                                          │
          └──────────────►  both execution paths agree  ◄─────────────────────────────┘
```

**1. The op surface must widen FIRST.** Today 22 of 40 kernel ops are unreachable, and the
training corpus was built to contain "exactly the 18 legal ops and zero illegal ones". ★If the
corpus is regenerated before the app exposes the wider set, it teaches a vocabulary that is about
to change, and every hour of GPU time is spent on a target that moves. The tracks that widen it
are `app/kernel-primitives` (solid primitives) and `app/remaining-commands` (DEFEATURE, HEAL,
FOLD, PUSHFACE, RESIZEBORE, TAG, WIRE, INPUT, SWEEP, VERIFY), plus `ir/surface-value-kind` and the
sketcher for the value kinds.

**2. "Aware of all ops" means the corpus and the system prompt, not a prompt tweak.** The model
already emits `POLY` (892), `VERIFY` (533), `ROTATE` (231) and `CYL` (225) — ops it was never
trained on and which the kernel already accepts. It reaches for them because they are the natural
way to say what it means. When they become legal, the corpus must teach their *signatures*, not
merely their names: `CYL(r, h [, cx, cy, cz, axx, axy, axz])` has an argument order, and a wrong
order produces wrong geometry silently.

**3. Regenerating the corpus REQUIRES a fresh contamination scan.** A holdout created after a
corpus makes that corpus dirty. Scan at training *launch*, not at corpus build, and separate
"guard fired" from "past result compromised" — and specifically whether a validation split
selected a checkpoint.

---

## What "systematic ultra-long feature trees" actually requires

★**Length is not the problem. Structure is.** Measured over the 600-row held-out emission set:

| observation | number |
|---|---|
| emissions that produce a solid | 485 (80.8%) |
| trees of 40–70 statements | routine; one fixture is 71 statements / 13,696 chars |
| **empty feature tree** | **43 (7.2%)** |
| **degenerate emission** (repetition, few distinct shapes) | **15 (2.5%)** |
| **`VERIFY` assertion the output does not satisfy** | **248 (41.3%)** |

The model already writes long trees. What it does not reliably do is write *coherent* ones — and
the dominant failure is the model stating a property (`holes=36`) that its own construction does
not have (`got 30`). ★That is a self-consistency failure, and it is the single largest lever on
the score. A longer tree that is not self-consistent is worth less than a shorter one that is.

**The standard is set by the ground-truth fixtures, not by our current corpus:**

| fixture | shape |
|---|---|
| `task_101` | 14 authoring ops → **329 faces, 753 edges**, volume 422,448 mm³, full per-face census |
| `archie_edit_214` | input **430 faces**: cylinder 167, torus 125, bspline 67, sphere 25, cone 4, plane 42 |

Note the ratio: **14 ops produce 329 faces.** Systematic does not mean one statement per face — it
means each op is a *feature* (a hub, a bore pattern, a cast fillet, a counterbore ring) that
expands into many faces. Training toward statement count would teach the wrong thing.

**So the corpus must supply, per row:** the full op vocabulary with correct signatures; trees whose
ops are features rather than primitives; `VERIFY` assertions that the construction actually
satisfies; and — for the edit half — the select→modify→rebuild→verify shape that
`archie_edit_214` demonstrates ("shrink the diameter of the largest bore by 5 mm" against a
430-face part).

---

## "Both headless and via the Forge C++ app" — the invariant nobody has stated

Two execution paths are about to exist for the same feature tree:

* **headless**: `forge_verify` consumes the IR and reports `ok`, `valid`, volume, face census.
* **in-app**: the CoPilot proposes ops → `OpConstraintBridge` validates → `PartDocument::
  appendFeature` → the kernel builds → the viewport renders.

★**They must agree, and nothing currently checks that they do.** This is the same defect class as
the vocabulary/header desync that has broken five times: two artifacts derived from one source,
with no gate tying them together. A tree that builds headless and fails in the app — or worse,
builds *differently* — would be found by a user, not by CI.

**Therefore the integration's acceptance gate is a differential test**, not a demo:

> For a sample of the held-out corpus, run each tree through BOTH paths and require the resulting
> solids to be observably identical on a VECTOR of observables — volume AND bbox AND face count
> AND edge count AND genus AND shell count AND centre of mass. ★Volume alone cannot validate
> geometry: `BRepGProp` integrates the divergence theorem, so a self-intersecting shell reports
> the correct signed volume. Any disagreement is a defect in one path and must be reported with
> the tree that exposed it.

The app path must also honour the constraint that governs all of this: **a tree the kernel can
execute must not be refused by the app.** If `OpConstraintBridge` rejects something
`forge_verify` accepts, that is a bug in the bridge, not a safety feature — the two must not
disagree about what is legal.

---

## Sequenced work list

| # | step | blocked on | done when |
|---|---|---|---|
| 1 | Land the op-surface widening | app fan-out PRs | `user_invocable_ops` reflects the new surface and both generated artifacts agree |
| 2 | Rebuild the corpus against the widened vocabulary, with signatures | (1) | corpus contains every legal op with correct arg order; a linter proves it |
| 3 | Add self-consistency supervision: `VERIFY` assertions that hold | (2) | assertions in the corpus are checked against the built solid at corpus-build time |
| 4 | Contamination scan at launch | (2) | scan result recorded, train/valid separated, checkpoint-selection impact stated |
| 5 | Train | (2,3,4) | power calculation done BEFORE the run; expected effect > minimum detectable |
| 6 | Differential headless-vs-app gate | app CoPilot path | the observable vector matches across both paths on a corpus sample |
| 7 | Wire it into ArchDisc | 1–6 | a user can converse in the app, get a tree, execute it, and headless reproduces it exactly |

★**Step 5 must not start before step 1 lands.** The most expensive mistake available here is
training against a vocabulary that is in the middle of changing.

---

## What is explicitly NOT in this plan

* **Retrieval.** Decided separately: operator-approved tool calling once the CoPilot ships, and
  nothing measured says retrieval is a bottleneck.
* **A decode-time op mask.** It addresses 1.0% of failures. Widening the vocabulary makes most of
  what it would have masked *legal*.
* **Chasing statement count.** See the 14-ops-to-329-faces ratio above.
