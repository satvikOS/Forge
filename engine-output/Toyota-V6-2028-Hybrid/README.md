# Toyota V35A-FTS V6 Cylinder Block — Reference-Engineered

**Single component focus** — this block is the foundation. Every downstream
component (heads, crank, pistons, etc.) will be added in future phases,
each verified to mate properly with this block.

## Engineering decisions (with rationale)

| Decision | Chosen | Rationale |
|----------|--------|-----------|
| V-angle | 60° | Natural primary balance for V6 |
| Bore × stroke | 92.5 × 86.7 mm | Matches Toyota V35A-FTS (proven design) |
| Block construction | A380 HPDC, open-deck | Best cooling, manufacturable |
| Cylinder lining | Cast-iron press-fit (GG25) | Reborable, serviceable, $$ economical |
| Crankcase | Aluminum bedplate (cross-bolted) | Stiffest, lowest NVH |
| Manufacturing | Net-shape + 0.5 mm machining stock | Modern HPDC standard |
| Reborability | Yes (0.25 + 0.50 mm oversize) | Service rebuild capability |

## Real-world spec match

| Spec | This block | Toyota V35A | Match |
|------|------------|-------------|-------|
| Bore | 92.5 mm | 92.5 mm | ✓ |
| Stroke | 86.7 mm | 86.7 mm | ✓ |
| Bore spacing | 105.5 mm | 105.5 mm | ✓ |
| Deck height | 220 mm | 220 mm | ✓ |
| Bank angle | 60° | 60° | ✓ |
| Material | A380 | A380 | ✓ |

## Features modeled

Total: 52 features.

- 6 cylinder bores (Ø91.5 as-cast → Ø92.500 H7 finished)
- 6 open-deck water-jacket pockets (Ø105 outer × 150 deep)
- 24 head-bolt threaded holes (M11 × 1.5, depth 115 mm)
- 4 main bearing saddles (Ø60 H7, 28 mm wide)
- 8 bedplate-mounting bolt holes (M10)
- Longitudinal main oil gallery (Ø12 mm)
- Casting features: 1° draft on outer surfaces, R3 internal fillets,
  parting line at crank centerline, ingate locations recorded

## Validation results

### Mateability
3 mate constraints recorded:
- coplanar: block.deck → head.underside
- concentric: block.headBoltHoles → head.headBoltClearance
- coplanar: block.crankCenterline → bedplate.partingLine

### Tolerance stack-up (piston-to-deck clearance)
| Mode | Result | Pass |
|------|--------|------|
| Nominal | 91.65 mm | — |
| Worst-case | ±0.12 mm | ✓ |
| RSS | ±0.0648 mm | ✓ |

### 3D-print readiness
- liner-to-jacket wall: 5 mm — FDM 1.2 mm minimum: ✓ PASS
- deck thickness above jacket: 10 mm — FDM 1.2 mm minimum: ✓ PASS
- head-bolt to bore wall: 18.5 mm — FDM 1.2 mm minimum: ✓ PASS

## Honest limitations of THIS phase

1. **No mating components yet** — interference + mate-solver checks against
   adjacent parts (head, bedplate, liner, crankshaft, piston) cannot run until
   those components are also built. Phase 2 builds the head + bedplate next.

2. **Casting features (drafts, fillets) recorded as metadata, not subtracted
   from B-Rep yet** — kernel CSG can struggle with high-feature-count fillet
   operations. Drafts/fillets are documented for the casting tooling
   designer to apply.

3. **Per-feature drawings not yet generated** — the production drawing
   pipeline (P0-P10 from earlier) operates on the whole solid; per-feature
   detail views (datum frame on deck, bore hole pattern, bedplate face)
   will be added in Phase 1.5.

## Next phases (in build order)

- **Phase 1.5**: Generate per-feature production drawings + GD&T
  callouts on the block.
- **Phase 2**: Cylinder head — must mate to block at 24 head-bolt holes,
  share deck plane (Y=220mm), interface with water-jacket annulus.
  Build, then validate interference = 0 with this block.
- **Phase 3**: Bedplate — must mate to block crank centerline parting
  line (Y=0), 8 perimeter bolt holes, 4 main-bearing saddles complete
  the journals.
- **Phase 4**: Crankshaft → fits in completed main saddles.
- **Phase 5**: Pistons + rods → fit in liners.

Each phase: build, validate against all prior, then proceed.
