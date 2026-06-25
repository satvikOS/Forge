# CADGenBench official-gen submission candidate — `submission_mm49.zip`

**Status: READY TO UPLOAD (user action).** This is the first end-to-end multimodal
submission for the official CADGenBench generation track — the artifact that yields
our **first real leaderboard number** (closing the proxy-vs-official gap we've had
no ground truth on).

## What it is
- `submission_mm49.zip` (≈106 MB): `meta.json` + 21 sample folders, each
  `<id>/output.step` (real ISO-10303-21 B-rep). Packed by
  `cadgenbench_submission_packer.mjs`; structure validated; **21/21 valid**.
- meta: submitter `ArchDisc / Forge`, name `Forge multimodal drawing-to-CAD v1`,
  `agree_to_publish: false`.

## How it was produced (both stages autonomous, Archie-driven)
1. **Stage 1 — drawing→spec.** Qwen2.5-VL-7B read all 49 gen-fixture engineering
   drawings → dimensioned specs (`archdisc-Models/scripts/cadgen_vlm_extract.py`,
   `data/forge/cadgen_mm/specs49.jsonl`; repetition tails dedup'd, raw preserved).
2. **Stage 2 — spec→STEP.** `forge-kernel/test/cadgen_mm_pipeline.mjs`: each spec →
   cadgen-v7 (HERMES_FORGE_SYSTEM) → Forge tool-calls → kernel build → `buildexport`
   (validity + STEP). **Try-both-keep-valid**: tries A-raw / imperative / stepwise
   prompt variants and keeps the first that builds a VALID solid.

## Result on the 49 official gen fixtures
- **21 / 49 valid solids** (ids 101,103,104,105,107,108,109,110,113,114,115,116,
  120,123,124,131,135,140,142,147,149). Try-both lifted the baseline 19→21.
- The 28 misses are the genuinely hard cases — complex CAST housings and SHEET-METAL
  flat-patterns (124-type, 103/107/108/113/115-type) where the VLM gets the bounding
  box + legible callouts but cannot reconstruct every bend/section coordinate, and the
  few-feature backend can't assemble 6-10 features into a watertight solid. Several
  produced 0 parseable build calls.

## How to submit (user)
1. Go to the HF Space `HuggingAI4Engineering/CADGenBench` → **Submit** tab.
2. Upload `submission_mm49.zip`. (To appear on the public board, repack with
   `--agree`, which sets `agree_to_publish: true`.)
3. Server-side scoring returns the 4 dims (validity / shape / interface / topology)
   — our **first real official datapoint**.

## Honest expectation (do not over-claim)
This is a **plumbing milestone, not the 0.85 endpoint.** With 21/49 valid, the
validity dim is ~0.43 and shape/interface/topology on even the valid builds are
unverified locally (GT is private; one STEP is over-built). Expect a **modest**
first number. The levers toward a high score are FIDELITY, not plumbing:
- exact-placement VLM extraction (multi-view fusion; the dense-drawing hedge),
- a backend that assembles complex multi-feature parts (corpus + training),
- geometry-reward optimization (GRPO with a build-cleanliness + Betti reward).

Local artifacts (not committed — large): `submission_mm49.zip`,
`multimodal_full2/<id>.step`. Committed: pipeline code + `mm_pipeline_results.json`.
