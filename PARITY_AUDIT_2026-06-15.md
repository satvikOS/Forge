# Forge parity audit — 2026-06-15

Grounded audit (5 read-only agents scoring from the actual `ForgeToolBridge.js` + OCCT
kernel + this session's commits) of Forge vs industry MCAD peers. Scores are **honest,
not aspirational** — the goal is a true picture, not a sales number.

## Scores by dimension

| Dimension | Peer | Parity |
|---|---|---|
| Solid + parametric modeling | SolidWorks / Fusion 360 | ~70% (agent errored; estimate from feature set) |
| Freeform / NURBS surfacing + Class‑A | CATIA / NX / Alias | **58%** |
| Assembly + mates + standard parts | SolidWorks / Inventor | **35%** |
| Drawings + GD&T + simulation + CAM | SolidWorks / ANSYS / Fusion CAM | **28%** |
| AI‑driven design (plan→drive→gate→staged) + direct edit + degradation | text‑to‑CAD baseline (no true peer) | **72%** (leading) |

**Honest verdict:** Forge is **not at literal 1:1 parity** with a full SolidWorks/CATIA
suite. It is strong in solid modeling (~70%), competitive in surfacing (58%), and
**ahead on the AI‑driven axis** (72%+ — no incumbent does plan→drive→native‑kernel‑build
→validity‑gate→AutoCorrector→staged refinement). It is weak where incumbents are deep:
detailing/GD&T, simulation breadth, CAM beyond 2.5D, and assembly/fastener libraries.
A fair blended figure vs a full suite is ~50–55%, on a unique AI axis competitors lack.

## What this session moved (the parity increment)
- **Parametric/freeform verbs** bridged + emitted (revolve/pipe/loft-class NURBS/fillet/
  variable-fillet/chamfer/shell/draft/patterns/push-pull-face) — solid-modeling + surfacing.
- **Standard-part tier** → 20 parametric asset ops incl hex nut/bolt, socket screw,
  ball bearing, hex standoff, T‑slot extrusion (true hex geometry) — assembly/standard-parts.
- **Selection-aware editing + parametric adjust** (forgeEdit) — direct-edit/feature-tree.
- **Live coherence/validity gate + AutoCorrector + staged refinement** — the AI axis.
- **D retrain promoted** → Archie emits all of the above; investor demo 4/4 live, gate-valid.
- **Degradation/weathering generation** — a capability no MCAD peer has at all.

## Top remaining gaps (the roadmap to higher parity)
- **Assembly (35%):** more mate kinds (symmetric/screw/slot/gear), smart/auto mates,
  fastener catalogue with threads + material grades, sub-assembly internal mates, bolt-hole kit-out.
- **Drawings/GD&T/sim/CAM (28%):** GD&T as live constraints (not annotations) + tolerance
  stack (worst-case/RSS), ANSI Y14.5 view rules + title blocks + bi-directional model-items
  sync, thermal/nonlinear FEA, 5-axis/adaptive CAM + collision.
- **Surfacing (58%):** G3 match/fairing, cross-section/rail surfacing, T-splines/subdiv,
  in-viewport continuity-defect highlight, reverse-engineered NURBS fit integration.
- **AI axis (72%):** structured (not string) defect feedback to the AutoCorrector, auto
  sketch-repair loop, mid-build degradation, per-turn undo/redo, create-new-in-context edits.

## Method
Workflow `forge-parity-audit` (run wf_dfb4847a-397): one Explore agent per dimension,
each reading the cited code and scoring 0–100 with present/missing/evidence. The
solid-modeling agent hit a transient socket error; its ~70% is estimated from the feature
set (primitives + constrained sketch + extrude/revolve/sweep/loft + fillet/chamfer/draft/
shell + patterns + direct-edit + booleans + feature-tree) and should be re-audited.
