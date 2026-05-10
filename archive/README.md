# Archive — Pre-Foundation Visualizations

Everything in this folder predates the kernel-foundation rebuild starting
2026-05-10.

## What's here

- `projects/` — V6 Hybrid, GE9X, Trent 1000, BS/MS/PhD/Pro example tier
  builders (StairClimber, BatteryThermal, MRBrake, TurbopumpSeal).
- `engine-output/` — generated screenshot/manifest packages from those
  builders.
- `e2e/` — Playwright tests that drove the demos.

## What it actually is

These are **3D schematic visualizations** built from four primitive
shapes (`box`, `cylinder`, `torus`, `cylinderShell`).

They are NOT:

- CAD models — no NURBS surfaces, no constraint solver, no parametric
  history, no real assembly mates
- 3D-printable as functional parts — no threaded holes, no surface
  finish, no actual fillets, parts overlap each other in space
- Engineering data — "FEA results", "GD&T tolerance frames", "mate
  validation" outputs in this folder are templated strings, not solver
  outputs
- Manufacturable — no draft analysis, no mold-line continuity, no
  validated draft directions, no machinable feature recognition

## Why it's archived

The kernel did not have:

- A 2D sketcher with a constraint solver
- Real extrude / revolve / sweep / loft from sketch profiles
- Robust booleans (failed on ~30 sequential subtractions on one
  envelope, so the V6 block was rebuilt as 53 disconnected primitives)
- Fillet / chamfer / shell that produce manifold output
- An assembly mate solver (mate "validation" was string matching on
  parametric IDs)
- An FEM / CFD solver (`FEAVisualizer` is a colorizer)

The plan going forward is to build that foundation first. See
`docs/kernel-audit.md` for the function-by-function gap analysis and
`docs/kernel-foundation-plan.md` for the milestone plan.
