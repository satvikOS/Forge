# CADGenBench 81 — v10 PCI · positioned construction, best-of assembly (2026-07-02)

**81/81** (8 gen from v10 positioned pipeline where it beat v9 + 41 v9 + 32 edit; source_map.json).

## v9 vs v10 — the brutal numbers (same strict metric: callout-satisfaction vs the drawing)
| | v9 | v10 solo | **best-of (this folder)** |
|---|---|---|---|
| gen mean | 0.238 (n=31) | 0.127 (n=20) | **0.243 (n=34)** |
| brutal audit | 0.48/10 (6-judge fleet) | — | pending next fleet run |

## What v10 proved / broke (honest)
- PROVED: the model ADOPTS positioned composition (positions_mm per feature), reads
  sheet-metal as a class, top task 105 = 0.583 (+0.13 over v9's best there).
- BROKE: compose-v3's richer JSON parses less often (20/49 vs 31/49) — coverage is THE
  bottleneck → grammar-constrained decoding is the #1 lever.
- MY BUG (fixed): normalize_plan stringified positions_mm lists, collapsing builds
  (101: 4 faces). Repaired + list-preservation patched.
- STILL FAILING: sheet-metal GEOMETRY (103 = bare plate; bends read but not emitted),
  invented positions when the transcript lacks position dims (sanity-gate installed),
  linear dim-chains untranscribed.

## Ranked levers (next iteration)
1. Grammar-constrained JSON decoding for compose (coverage 20→45+)
2. Sheet-metal corpus depth (multi-bend families, beads, louvers) + flat-pattern logic
3. Position-bearing transcription (dimension chains → explicit hole coordinates)
4. Contour attach-rate (2/20 → most tasks) via robust view detection
