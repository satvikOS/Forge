# Forge MCAD Parity Push — 2026-06-04 onward

User directive: bring all 18 dimensions to genuine, no-stub operational state with multi-cam e2e
proof. Tracks real parity %; no cosmetic counts. Updated after every CI-green batch.

| # | Dimension | Start | Target | Current | Last batch |
|---|---|---|---|---|---|
| 1 | Kernel (OCCT depth utilisation) | 35 % | 80 % | 35 % | — |
| 2 | Solid modeling ops | 8 % | 80 % | 8 % | — |
| 3 | Sketch / 2D constraints | 18 % | 80 % | 18 % | — |
| 4 | Assembly (mates, configs, BOM) | 4 % | 80 % | 4 % | — |
| 5 | Drawings / 2D output | 3 % | 80 % | 3 % | — |
| 6 | Sheet metal | 0 % | 80 % | 0 % | — |
| 7 | Surfacing | 0 % | 80 % | 0 % | — |
| 8 | Mold / casting / tooling | 0 % | 80 % | 0 % | — |
| 9 | Routing (piping / cable) | 0 % | 80 % | 0 % | — |
| 10 | CAM / manufacturing | 0 % | 80 % | 0 % | — |
| 11 | Simulation (FEA/CFD/motion) | 3 % | 80 % | 3 % | — |
| 12 | PMI / GD&T | 0 % | 80 % | 0 % | — |
| 13 | Standard parts libs | 4 % | 80 % | 4 % | — |
| 14 | PDM / PLM | 0 % | 80 % | 0 % | — |
| 15 | Generative / topology | 0 % | 80 % | 0 % | — |
| 16 | Engineering calculators | 200 % | 200 % | 200 % | held |
| 17 | UI/UX (ribbon/search/menus) | 12 % | 80 % | 12 % | — |
| 18 | API / customization | 5 % | 80 % | 5 % | — |
| 19 | Visualization | 8 % | 80 % | 8 % | — |

## Test workflows queued (progressive complexity)

- Ferrari V8 piston (single-part, drawings, FEA stress)
- Mercedes inline-6 crankshaft (multi-feature part, balance, fatigue)
- Boeing 787 wing rib (sheet metal + assembly + GD&T)
- Airbus A320 landing-gear strut (hydraulic routing + simulation)
- Industrial gearbox housing (mold + CAM + PDM)
- Factory conveyor frame (routing + standard parts + drawings)

## Batch log

(Each commit batch records: dimensions touched, CI run URL, multi-cam e2e snapshot dir.)
