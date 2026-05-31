# Forge — Brand & Roadmap

## Why the rename

ArchDisc Mech is now **ArchDisc Forge**. The reason is the kernel
rebuild: Forge is a from-source native C++ kernel built on OCCT 7.9.3
plus selective FreeCAD authoring layers (sketcher, assembly, drawings,
FEM, CAM). That is a different product from a WASM-bound viewer-grade
modeler, so we want a different name.

- "Mech" implied a Solid-Edge-class workbench bundle.
- "Forge" names the *kernel* and the editor on top of it as one product.

Repo directory (`archdisc-Mech`) and GitHub remote
(`satvikOS/archdisc-Mech`) keep their existing slugs for now to avoid
breaking CI; the user-facing brand and app artifact names are all
"Forge".

## Hard rules

- **No WASM in the geometric kernel.** OCCT is linked from system
  libraries via a native node addon (`forge-kernel.node`). The old
  `opencascade.js` Emscripten module is removed.
- **100,000-component assemblies are a first-class target.** The
  component registry is C++ with reference-counted BREPs and a BVH
  spatial index; the frontend never holds 100k geometries in V8.
- **Upstream-friendly.** Patches against OCCT and FreeCAD subsystems
  live under `forge-kernel/upstream/` as series files so we can
  contribute them back without rewriting history.

## Slice cadence

Each commit on `archdisc` is one slice. The numbering picks up where SP
left off; `Forge-N` is the prefix from this point.

## Layer map

```
forge-kernel/          C++ native addon (NEW)
  src/                   Forge kernel API surface
  upstream/              Patches against OCCT/FreeCAD
  3rdParty/planegcs/     Vendored 2D constraint solver

frontend/src/kernel/    JS facade — calls forge-kernel.node
  brep/                  thin wrappers; no oc.* / no WASM imports
  topology/              Spine entities (Body→Lump→Shell→…)
  features/              parametric feature engines
  sketch/                2D sketch authoring
  assembly/              mate constraints + DOF solver

frontend/src/workbenches/
  part/                  (renamed from mechanical-cad/)
  sketch/                (new — exposes the planegcs UI)
  assembly/              (new — exposes the mate solver UI)
  drawing/               (existing, expanded with dimensions/GD&T)
  simulate/              FEA front-end
  manufacture/           CAM front-end
```

## Tracking gaps

The 10 product-layer gaps and the UX gap list (originally a one-shot
note from 2026-05-30) drive `Forge-6` through `Forge-16`. See the
checked-in TaskList for live status.
