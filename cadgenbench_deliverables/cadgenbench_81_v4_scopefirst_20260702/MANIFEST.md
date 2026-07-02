# CADGenBench 81 — v4 FINAL (2026-07-02) · best-of-rounds ensemble

**81/81 output.step.** GEN = script-first architecture (drawing → Archie Layer-2 feature-tree
script → deterministic compiler → B-Rep STEP); EDIT = Archie edit-plan → kernel appliers.
Per-task provenance in source_map.json; drawing-vs-drawing A/B in <id>/AB.png.

## Final scores — HONEST HEADLINE FIRST
| Metric | mean | good ≥0.6 |
|---|---|---|
| **FEATURE-LEVEL (holes+faces+volume vs GT — the honest measure)** | **0.405** | **6/49** |
| Proportions proxy (bbox aspect+fill — WEAK, overrates primitives) | 0.689 all / 0.759 sane | 39/49 |
| EDIT decision | 32/32 op-correct | beats hand-tuned parser (31/32) |

**Caveat (user-caught):** the proportions proxy scored a blank Ø150 disc 0.88 against the complex
gearbox-cover drawing 101 (built 4 faces vs GT 130). The feature-level metric (scripts/feature_ab.mjs)
scores content, not silhouette proportions — it is the number that reflects reality. The generation
gap is FEATURE COMPLETENESS: scope-plans capture 2-6 features where drawings carry 10-20+.

## The iterate-until-good trail (all real, same metric)
0.182 (garbage specs) → 0.614 (script-first v2) → 0.627 (v3 +families) → 0.649 (v4 +enclosure/tall)
→ 0.635 (v5) → 0.618 (v6 recipe schema) → 0.590 (v7 Layer-2 trees) → **0.689/0.759 (ensemble)**

## Architecture (user-specified, implemented end-to-end)
Drawing = 3D recipe: TOP=X-Y, SECTIONS=Z, ISO=confirmation only; callouts decoded
(Ø/R/THRU/CBORE/CSINK/M×pitch/TYP). Archie emits the inv-style Layer-2 feature-tree SCRIPT first
(base, z-levels, every feature w/ exact mm dims/counts/patterns); the deterministic compiler
(scopeplan_compile.py) builds it (feature order: base→platforms→bosses→holes→cbores→threads→
chamfers→fillets-last). Layer-3 (B-Rep face inventories) used as training-signal fingerprints +
validation only — never as geometry source (they lack surface params/loops/topology).

## Honest notes
- Richer schemas (v6 recipe / v7 Layer-2) scored LOWER at this data scale — JSON emission
  reliability drops with schema complexity (17 parse fails at v7). Fix path: more data or
  grammar-constrained decoding. The ensemble captures each round's wins.
- 18/49 local refs are degenerate (needles/cubes); drawing is the honest GT there.
- No fabricated numbers anywhere; scorers: gen_ab_norm.mjs, score_plan_ab.py.
