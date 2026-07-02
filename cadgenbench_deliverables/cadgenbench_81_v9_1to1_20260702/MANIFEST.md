# CADGenBench 81 — v9 · the 1:1 architecture (2026-07-02)

**81/81 output.step.** First deliverable from the full three-layer 1:1 pipeline:
tile-TRANSCRIBE (Layer-1: overlapping crops at full budget, ~85-90% callout recall) →
COMPOSE grounded ONLY in the transcript (Layer-2, compose-v2 adapter on de-templated
continuous-dim corpus) → deterministic compile (extended coverage: cavities/tapers/
flanges/posts/cbores) → VERIFY-REFINE (built B-Rep diffed vs callouts, feedback pass).

## Honest verification (both vs the drawing — the only real local GT)
- **Callout-satisfaction** (strictest: every count consumed): mean **0.238** (n=31),
  top 113=0.75 · 138=0.70 · 111=0.57 · 101=0.47. See callout_satisfaction.json.
- **Visual 1:1**: per-task AB.png. 101 now = Ø200×97 housing, Ø188 ring, Ø40 bore,
  6-hole circle — every dim from the drawing (was a Ø150 template disc in v2-v4).
- Sources: 31 gen from the 1:1 pipeline, 18 gen v4-fallback (compose JSON fails —
  known fix: grammar-constrained decoding), 32 edit Archie-decides (source_map.txt).

## Quarantines & caveats (unchanged truths)
- Local gen output.step "refs" = stale prior-run builds, NOT GT (real GT private).
- Proportions-proxy metrics retired; template numbers eliminated (de-templated corpus).
- Remaining gaps: lobed/tangent-arc outlines (compiler), Z-height view-assignment,
  compose JSON reliability (18/49), linear dim-chains in transcription.
