# CADGenBench 81 — v3 (2026-07-02) · iterate-until-good loop

**81/81 output.step.** GEN = script-first (drawing → Archie scope-plan → deterministic compiler);
EDIT = Archie edit-plan → kernel appliers. Per-task AB.png = drawing-vs-drawing A/B.

## Round history (verified, honest)
| Round | adapter | mean_norm (all) | sane-refs | sanity gate |
|---|---|---|---|---|
| v2 | scopeplan-v2 | 0.614 | — | 105 pass, 139 half, 118 fail |
| v3 | scopeplan-v3 (+shaft/housing/ring families) | 0.627 | 0.662 (21/29) | — |
| v4 | scopeplan-v4 (+enclosure/tall families) | **0.649** | **0.689 (22/27, 81%)** | 105 pass, **139 PASS (height fixed: 328×150×96, Ø104)**, 118 still fails |

EDIT: decision 32/32 (beats regex 31/32); applied 22/32 targeted.
Known limits: 118-class dense multi-view enclosures misread; 18/49 local refs degenerate
(needles/cubes — drawing is the honest GT there; see data/forge/ref_quality.json).
Source mix: 42 v4-round + 4 v3-round + 3 v2-round + 32 edit (/tmp/src_map.txt).
