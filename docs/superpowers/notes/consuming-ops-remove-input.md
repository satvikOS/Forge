# Consuming B-rep ops remove their input body

Date: 2026-05-21
Branch: archdisc

## The decision

When a B-rep operation transforms a body — e.g. Fillet takes `body-001` and
produces `body-002` — the original input body must be **removed** from the
scene and the Body Browser. Previously it stayed, coincident with the result:
the sharp original sat in front of the rounded result, so the viewport showed
the wrong geometry and a click landed on the stale original (this also
interacted badly with the recently-fixed gizmo pick-set pollution, commit
`994470ba`).

The Design History panel still records the operation, so the construction
history is **not** lost — only the live scene/Body-Browser entry is removed.

## The mechanism — `consumedInputs`

`addBrepShapeToScene(scene, viewport, brepShape, color, consumedInputs = [])`
in `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js`.

After the new result is registered in the `BodyRegistry` (with its own
`brepShapeRef`), every `BrepShape` in `consumedInputs` is looked up by
identity (`reg.bodies.find(b => b.brepShapeRef === input)`) and removed via
`reg.remove(entry.id)` — which detaches the group from the scene, drops the
registry entry, and clears it from selection. The result is never matched
because the consumed inputs are different `BrepShape` objects.

`consumedInputs` defaults to `[]`, so non-consuming callers are unaffected.

Each consuming handler captures its `_pickBodies(...)` result and forwards it:
- arity 1: `await addBrepShapeToScene(scene, viewport, result, color, [body])`
- arity 2: `await addBrepShapeToScene(scene, viewport, result, color, [a, b])`
- arity ∞: `await addBrepShapeToScene(scene, viewport, result, color, members)`

## Which ops consume vs not

CONSUMING (pass `consumedInputs` — they produce a replacement B-rep solid via
`addBrepShapeToScene`):
- Features: Fillet, Chamfer, Shell, Draft, Variable Radius Fillet
- Blending: Full Round Fillet, Corner Mitre, Offset Shape
- Booleans (consume BOTH inputs): Combine, Subtract, Intersect,
  Combine (Non-Manifold), Combine (Coincident)
- Lattice Fuse (`_pickBodies(Infinity)` — consumes ALL members)
- NURBS: Refine NURBS, Elevate NURBS (h-/p-refinement replaces the body)
- Direct edit: Replace Face, Simplify Geometry

NOT consuming (no `consumedInputs`):
- Surface-Surface Intersection — picks 2 bodies but builds a separate group of
  intersection *curves* (annotation); the two input surfaces stay. It never
  calls `addBrepShapeToScene`.
- NURBS Curvature — analytical only, no geometry produced.
- Subdivide Surface, Catmull-Clark Subdivide, Retopo Surface — these pick a
  body but build a raw THREE mesh group directly; they do NOT go through
  `addBrepShapeToScene` and do NOT register their output in the BodyRegistry,
  so the `consumedInputs` mechanism does not apply to them. (Their input body
  is left as-is in the registry.)
- Arity-0 generators (Box, Cylinder, Sphere, Cone, Torus, Extrude/Revolve Boss,
  Loft/Sweep Boss, Thicken, NURBS Patch, Trimmed NURBS Patch, Sweep Tortuous,
  Loft Tangent, Stitch Faces, Convergent Solid, Face Fillet) — pick nothing.

## Verification

- `e2e/brep-pick-diagnostic-electron.spec.js` — green (real click selects a body).
- `e2e/brep-g-catmullclark-electron.spec.js` — green. Builds Box (`body-001`),
  Fillets it (consumes `body-001`, produces `body-002`), real-click-selects the
  filleted body, Catmull-Clark subdivides. The Body Browser stills confirm
  `Box 1` disappears after the Fillet while Design History keeps Box + Fillet.
- 28/28 brep operation specs (boolean / features / localops / surfacing /
  varfillet / simplify / blend / b-advanced / final) pass with no spec edits —
  none had encoded the old keep-the-input behaviour.
