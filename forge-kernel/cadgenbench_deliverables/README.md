# CADGenBench deliverables — where to see what Archie produces

CADGenBench is a geometry-generation benchmark: given a natural-language CAD prompt
(with dimensions), the model must emit a program that **builds the correct solid**.
A submission is the **generated geometry per prompt** (STEP), scored on 4 dimensions
(validity, shape, interface, topology). Gate = every dimension ≥0.85 (validity ≥0.97).

## What's here / where to look

| Artifact | Path | What it is |
|---|---|---|
| **Per-case results report** | `cadgenbench_deliverables/RESULTS_cadgen-v4.md` | every case: prompt + our model's shape/iface/topo/validity scores + CADscore + built? |
| Per-case raw scores | `~/archdisc-Models/logs/cadgen_v2_eval/cadgenv4.jsonl` | the eval's machine output (one JSON per case) |
| The benchmark cases | `forge-kernel/test/cadgenbench_set.mjs` | the 25 gen + 4 edit prompts + the deterministic reference programs |
| The geometry scorer | `forge-kernel/test/cadscore_harness.mjs` | ForgeCADScore (replay self-test = 1.000 — the scorer is trustworthy; the gap is the model) |
| The eval runner | `forge-kernel/test/cadgenbench_eval.mjs` + `scripts/cadgen_eval_v2.sh` | drives the model through the live ForgeRunner system prompt, builds + scores |
| Official submission packer | `forge-kernel/test/cadgenbench_submission_packer.mjs` | turns Forge-exported STEP → the exact `submission.zip` the CADGenBench leaderboard expects |

## Current number (cadgen-v4, measured)
**generation 0.710 · editing 0.528 · overall ~0.68 · GATE FAIL.** SOTA reference 0.45
(unverified). Diagnosed gap: the corpus had no edit family (→ all edits 0) and thin
shape data (shell-box dimL1≈1.0). Fix is training now (cadgen_v5).

## Coming at the next train checkpoint (~iter-300, GPU free)
A **visual gallery** generated here: for each case, the model's **actual built part**
(`<case>.step` + `<case>.png` render) next to the reference target, plus the official
`submission.zip`. This needs the GPU (to generate the model's outputs), so it lands at
the cadgen_v5 iter-300 pause rather than mid-training.
