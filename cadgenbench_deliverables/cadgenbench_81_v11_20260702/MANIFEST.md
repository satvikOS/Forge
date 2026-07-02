# CADGenBench 81 — v11 · constrained decoding + real parts + 19 bug fixes (2026-07-02)

**81/81 · output gate 81/81 valid solids · best-of gen callout-satisfaction 0.397 (n=44)**

## The trail (same strict metric: built geometry vs the drawing's own callouts)
v9 0.238 → v10 0.153 (solo) → **v11 solo 0.320 · 49/49 coverage · best-of 0.397**
Perfect 1.0: tasks 125, 137, 146 · flagship 101: 0.056→0.70

## What made v11 (all strict-gated before training/running)
- TRUE grammar-constrained JSON decoding (logits-processor pushdown automaton) — 49/49
  parse+build, compose-fail class eliminated (v10: 20/49)
- 19 proven compiler bugs fixed (count-key collisions, thread-pitch-as-PCD, dedupe drops)
- Real-parts corpus: 756 pairs from Zero-To-CAD-1m (Apache-2.0) via kernel inventory
- Deep sheet-metal families (bend channels, louver trays, tab brackets, obround slots)
- Strict gates: corpus 40/40 fidelity · traindata arrow-uniform · sampler parse · output valid

## Honest remaining gaps (v12 levers)
1. MULTI-LEVEL Z (z_levels adoption 1/8 — 101 still flat despite right outline+holes)
2. CV contour artifacts (view-box notch on 101)
3. 2 v11 degenerates excluded by the gate (132 fc=3, 148 negative-volume inverted shell)
4. Visual 1:1 remains far from the drawings on complex parts — metric ≠ appearance
