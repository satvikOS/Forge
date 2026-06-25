# CADGenBench — Multimodal drawing→CAD pipeline (milestone 2026-06-25)

The **official** CADGenBench generation track is multimodal: 49 fixtures give an
engineering-drawing PNG (no text dimensions) and the instruction *"reproduce the
geometry from the drawing."* A text-only submission is not viable — the geometry
lives entirely in the drawing. This milestone proves the full pipeline runs
**end-to-end, autonomously**, and emits valid STEP B-reps.

## Architecture (two stages, sequenced to fit 36 GB)

```
input.png ─▶ [Stage 1: Qwen2.5-VL-7B] ─▶ dimensioned text spec
                                                │
            [Stage 2: cadgen-v7 (14B text→CAD)] ◀┘
                  │  HERMES_FORGE_SYSTEM + spec
                  ▼
            Forge <plan>/<tool_call> sequence
                  │  dispatchSequence → forge-kernel.node
                  ▼
            kernel build ─▶ check-validity ─▶ io.exportStep ─▶ <id>.step
```

- **Stage 1** (`scripts/cadgen_mm_pipeline` VLM phase, in archdisc-Models): Qwen2.5-VL
  reads each drawing into a dimensioned multi-feature spec (~60 s/drawing). It
  genuinely extracts overall dims + features (e.g. *"120×80×10 mm plate, Ø200 top
  flange, Ø188 bottom flange, bosses Ø60/Ø82/…"*); it sometimes hedges exact
  placement ("at various positions") — the fidelity lever.
- **Stage 2** (`forge-kernel/test/cadgen_mm_pipeline.mjs`): the spec drives the
  cadgen-v7 backend → Forge tool-calls → kernel build → STEP.

## CORRECTED HARNESS (this is why an earlier attempt reported "0 valid")

The first pipeline build reported 0 tool-calls / 0 valid solids. That was a
**harness bug, not a model limitation**:

1. It passed a per-request `adapters: <name>` field to a serve started **with**
   `--adapter-path` (adapter already baked) → the serve returns **HTTP 404** →
   empty content.
2. The `HERMES_FORGE_SYSTEM` system prompt is **mandatory** — without it the model
   emits generic JS pseudo-code (`forge.createBox(...)`), not `<plan>/<tool_call>`.

Correct invocation:
```
mlx_lm.server --model models/archie-14b-v2-4bit \
  --adapter-path adapters/archie/archie-14b-cadgen-v7-20260625 --port 8080
# POST { system: HERMES_FORGE_SYSTEM, user: spec }   — NO `adapters` field
```
An **imperative wrapper** ("Build this part in Forge. Emit ONLY tool-calls: …")
rescues the hardest multi-feature specs (e.g. fixture 110: A-raw 0 calls → 14).

## Result (5-spec proof)

| fixture | variant | calls | valid | STEP | betti (b0/b1/b2) |
|---------|---------|-------|-------|------|------------------|
| 101     | B-imper | 15    | ✓     | ✓    | 2 / 0 / 2        |
| 110     | A-raw   | 7     | ✗     | ✗    | — (hardest spec) |
| 120     | A-raw   | 24    | ✓     | ✓    | 1 / 0 / 1        |
| 135     | B-imper | 6     | ✓     | ✓    | 1 / 0 / 1        |
| 140     | A-raw   | 8     | ✓     | ✓    | 1 / 0 / 1        |

**4 / 5 valid solids · 4 / 5 STEP exported.** Files: `101.step`, `120.step`,
`135.step`, `140.step` (real ISO-10303-21 B-reps).

## Honest caveats (build-validity ≠ benchmark score)

- Ground truth is **PRIVATE** (server-side). Locally we can only verify
  build-validity + STEP round-trip — **NOT** the 4-dim score (shape/interface/
  topology-Betti vs GT). The real number comes from submitting to the HF Space.
- **Validity ≠ fidelity.** `135.step` is 39 MB — valid but almost certainly
  over-built (excess faces), so it would likely score low on shape. The pipeline
  proves *plumbing*, not yet *geometric accuracy* on these complex real parts.
- The real gen parts are genuinely complex (6+ features). Exact-placement VLM
  extraction + multi-feature build fidelity are the levers toward a high score.

## Path to a leaderboard number (remaining work)

1. Run Stage 1 over all 49 gen drawings → `specs.jsonl`.
2. Run `cadgen_mm_pipeline.mjs` over all 49 → `<id>.step`.
3. Pack `submission.zip` (cadgenbench_submission_packer) → submit to the HF Space
   `HuggingAI4Engineering/CADGenBench` (server-side scoring; user action).
4. Fidelity iteration: tighten VLM placement extraction; constrain the backend
   against over-build; consider GRPO with a build-cleanliness + Betti reward.
