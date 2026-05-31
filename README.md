# ArchDisc Forge

Native parametric mechanical CAD built on a high-performance C++ kernel.
The geometric core links directly to OCCT 7.9 and FreeCAD's authoring
layers; **no WASM** — the kernel runs as a native `forge-kernel.node`
addon loaded by the Electron desktop app.

## What Forge is

- Solid + surface modeling with the OCCT BREP kernel.
- Parametric sketcher with a 2D constraint solver (planegcs upstream).
- Assembly system designed for **100,000+ component instances** with
  reference-counted BREP de-duplication and a BVH spatial index built
  in C++.
- Feature tree authoring, drawings, GD&T, configurations, FEA, CAM,
  PDM — see `BRAND.md` for the staged rollout plan and `ARCHITECTURE.md`
  for the layered design.

## Status

Pre-1.0, slice-numbered. Latest slice prefix is `Forge-N`. Earlier work
shipped under the `SP-N` prefix when the product was named ArchDisc Mech.

## Build

Native toolchain:

```sh
brew install cmake opencascade
```

App:

```sh
npm install
npm run forge:kernel        # build forge-kernel.node
npm run electron:dev        # launch the Electron app
```

## Branches

- `archdisc` — active development. Every push is a discrete slice.

## Repos

- This repo (Forge) — desktop app + native kernel.
- `archdisc-Studio` — separate sibling repo for the 3D-content product.
- `archdisc-Models` — the Archie local-fleet LLM provider both apps use.
