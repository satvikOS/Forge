# CADGenBench — Archie cadgen-v4 per-case results (2026-06-24)

Model: archie-14b cadgen-v4 (Forge-verb SFT on the 4.155 foundational base), iter-300.
Scorer: ForgeCADScore (cadscore_harness.mjs, replay self-test = 1.000). Gate = every dimension ≥0.85, validity ≥0.97.

**Aggregate: generation 0.710 · editing 0.528 · overall ~0.68 · GATE FAIL** (SOTA reference 0.45).

| case | category | shape | iface | topo | valid | CADscore | built |
|------|----------|------:|------:|-----:|------:|---------:|:-----:|
| bool-cut-sphere | ? | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | ✗ |
| edit-enlarge-bore | edit | 0.000 | 1.000 | 1.000 | 0.000 | 0.000 | · |
| edit-add-counterbore | edit | 0.000 | 0.000 | 0.111 | 0.000 | 0.000 | · |
| edit-add-bolt-circle | edit | 0.000 | 1.000 | 1.000 | 0.000 | 0.000 | · |
| edit-shell-block | edit | 0.000 | 0.000 | 1.000 | 0.000 | 0.000 | · |
| hole-plate-center | hole | 0.198 | 0.000 | 0.111 | 1.000 | 0.101 | ✓ |
| multi-bored-plate-bolts | ? | 0.205 | 0.200 | 0.008 | 1.000 | 0.164 | ✓ |
| shell-box | shell | 0.058 | 0.000 | 1.000 | 1.000 | 0.223 | ✓ |
| fillet-block | fillet | 0.157 | 0.000 | 1.000 | 1.000 | 0.263 | ✓ |
| bool-cut-slot | ? | 0.716 | 0.000 | 0.198 | 1.000 | 0.326 | ✓ |
| pattern-grid | pattern-linear | 0.213 | 1.000 | 0.006 | 1.000 | 0.486 | ✓ |
| bool-fuse-boss | ? | 0.732 | 0.000 | 1.000 | 1.000 | 0.493 | ✓ |
| sketch-extrude-tee | sketch-extrude | 0.121 | 1.000 | 1.000 | 1.000 | 0.648 | ✓ |
| shell-cup | shell | 0.861 | 1.000 | 0.111 | 1.000 | 0.767 | ✓ |
| prim-cone | primitive | 0.479 | 1.000 | 1.000 | 1.000 | 0.792 | ✓ |
| sketch-extrude-L | sketch-extrude | 0.493 | 1.000 | 1.000 | 1.000 | 0.797 | ✓ |
| hole-disc-bore | hole | 0.982 | 1.000 | 0.111 | 1.000 | 0.815 | ✓ |
| multi-lbracket | multi-feature | 0.668 | 1.000 | 1.000 | 1.000 | 0.867 | ✓ |
| prim-cube | primitive | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | ✓ |
| prim-cylinder | primitive | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | ✓ |
| chamfer-cyl | chamfer | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | ✓ |
| pattern-bolt-circle | pattern-circular | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | ✓ |
| pattern-bolt-circle-4 | pattern-circular | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | ✓ |
| revolve-bushing | revolve | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | ✓ |
| multi-flange | multi-feature | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | ✓ |
| multi-stepped-shaft | multi-feature | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | ✓ |
| asm-tube | small-assembly | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | ✓ |
| asm-washer | small-assembly | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | ✓ |
| asm-hexnut | small-assembly | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | ✓ |

## Prompts (what the model was asked to build)

- **bool-cut-sphere** (CAD=0.00): (prompt not parsed)
- **edit-enlarge-bore** (CAD=0.00): Here is an 80 mm diameter, 12 mm thick hub with a 20 mm bore. Enlarge the bore to 34 mm diameter.
- **edit-add-counterbore** (CAD=0.00): Here is a 100 mm diameter, 20 mm thick disc with a 25 mm bore. Add a 40 mm diameter counterbore, 7 mm deep, on the top face.
- **edit-add-bolt-circle** (CAD=0.00): Here is a plain 120 mm diameter, 16 mm thick disc. Add six 8 mm bolt holes on a 96 mm bolt circle.
- **edit-shell-block** (CAD=0.00): Here is a solid 100 × 80 × 40 mm block. Hollow it to a 3 mm wall with the top open.
- **hole-plate-center** (CAD=0.10): An 80 × 80 × 15 mm plate with a single 20 mm diameter through-hole in the centre.
- **multi-bored-plate-bolts** (CAD=0.16): (prompt not parsed)
- **shell-box** (CAD=0.22): Hollow out an 80 × 80 × 60 mm box to a 3 mm wall thickness, leaving the top face open.
- **fillet-block** (CAD=0.26): Take a 70 × 50 × 30 mm block and round every edge with a 6 mm fillet.
- **bool-cut-slot** (CAD=0.33): (prompt not parsed)
- **pattern-grid** (CAD=0.49): A 120 × 80 × 10 mm plate with a 3 × 2 grid of 6 mm holes spaced 40 mm apart in X and 40 mm in Y.
- **bool-fuse-boss** (CAD=0.49): (prompt not parsed)
- **sketch-extrude-tee** (CAD=0.65): Extrude a symmetric T-section profile, 80 mm wide flange and 60 mm tall web, by 25 mm.
- **shell-cup** (CAD=0.77): A 100 mm diameter, 50 mm tall cup with a 3 mm wall and a solid base, open at the top.
- **prim-cone** (CAD=0.79): Build a truncated cone, 50 mm diameter at the base, 20 mm diameter at the top, 40 mm tall.
- **sketch-extrude-L** (CAD=0.80): Sketch an L-shaped profile (60 mm × 60 mm overall, 20 mm leg width) and extrude it 30 mm thick.
- **hole-disc-bore** (CAD=0.82): A 100 mm diameter, 20 mm thick disc with a 25 mm diameter bore through its centre.
- **multi-lbracket** (CAD=0.87): An L-bracket 80 mm long, 60 mm wide, 8 mm thick with a 5 mm wall, and a 10 mm mounting hole in each leg.
- **prim-cube** (CAD=1.00): Model a solid steel cube, 60 mm on every side.
- **prim-cylinder** (CAD=1.00): Make a plain cylinder, 40 mm diameter and 25 mm tall, standing on the XY plane.
- **chamfer-cyl** (CAD=1.00): A 45 mm diameter, 30 mm tall cylinder with a 3 mm chamfer broken on all its edges.
- **pattern-bolt-circle** (CAD=1.00): A 120 mm diameter, 16 mm thick flange disc with six 8 mm holes equally spaced on a 96 mm bolt circle.
- **pattern-bolt-circle-4** (CAD=1.00): A 90 mm diameter, 12 mm thick cap with four 6 mm bolt holes on a 70 mm bolt circle.
- **revolve-bushing** (CAD=1.00): Revolve a rectangular section about the Z axis to make a bushing: 50 mm outer diameter, 30 mm bore, 40 mm long.
- **multi-flange** (CAD=1.00): A 120 mm diameter, 14 mm thick flange with a 40 mm centre bore and four 11 mm bolt holes on a 90 mm bolt circle.
- **multi-stepped-shaft** (CAD=1.00): A stepped shaft: a 40 mm diameter × 50 mm long lower section and a 25 mm diameter × 40 mm long upper section, coaxial.
- **asm-tube** (CAD=1.00): A length of round tube: 50 mm outer diameter, 3 mm wall thickness, 80 mm long.
- **asm-washer** (CAD=1.00): A flat washer: 40 mm outer diameter, 21 mm inner diameter, 4 mm thick.
- **asm-hexnut** (CAD=1.00): An M16 hex nut: 24 mm across flats, 13 mm thick, 16 mm tapped-size bore.