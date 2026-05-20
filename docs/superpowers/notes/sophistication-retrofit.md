# Sophistication Retrofit — Pattern Reference

> Verified by reading: `ToolParamDialog.jsx`, `ToolParamDialog.js`, `ToolParamSchemas.js`,
> `BodyRegistry.js`, `WorkbenchMechanical.jsx`, `ToolExecutionEngine.js` (all handlers).

---

## (i) `requestToolParams(toolName)` — verified pattern

`requestToolParams` is exported from `frontend/src/foundation/ToolParamDialog.js`.
It returns a `Promise<{values, cancelled}>`.

**Bypass behaviour (important for e2e):**
- If `window.__archdiscPlanParams[toolName]` exists → resolves immediately with those values merged over defaults.
- If `window.__archdiscBypassDialog === true` OR if `navigator.webdriver` is true (Playwright) and `window.__archdiscBypassDialog` is not explicitly `false` → resolves immediately with schema defaults.
- If `window.__archdiscBypassDialog === false` explicitly → opens the real dialog even under Playwright (use this to test the dialog UI itself).
- If no schema for `toolName` exists → resolves immediately with `{ values: {}, cancelled: false }`.

**Canonical usage — pasted from the `Extrude Boss` handler (line 801):**
```js
'Extrude Boss': async (scene, viewport) => {
  const { values, cancelled } = await requestToolParams('Extrude Boss');
  if (cancelled) return { status: 'warn', message: 'Extrude Boss cancelled' };
  try {
    const width  = values.width  ?? 80;
    const depth  = values.depth  ?? 50;
    const height = values.height ?? 25;
    const shape = await ArchDiscKernel.brep.extrudeRect(width, depth, height);
    await addBrepShapeToScene(scene, viewport, shape, 0x9aa3ad);
    const metrics = await ArchDiscKernel.brep.measure(shape);
    return {
      status: 'success',
      message: `Extrude Boss: ${width}×${depth} rectangle × ${height} mm. V = ${metrics.volume.toFixed(0)} mm³ via OCCT exact B-rep kernel`,
    };
  } catch (err) {
    return { status: 'error', message: `Extrude Boss failed: ${err.message}` };
  }
},
```

Key observations:
- `requestToolParams` is called BEFORE any kernel op (dialog resolves first).
- `values.*` always use nullish-coalescing `?? default` as a safety net.
- `addBrepShapeToScene` handles scene insertion, body registration in BodyRegistry, `window.__lastBrepShape`, and auto-framing.
- The handler is `async` and returns `{ status, message }`.

---

## (ii) BodyRegistry API — verified + added surface

### Pre-existing API (in `frontend/src/foundation/BodyRegistry.js` before the retrofit)

| Method / Property | Signature | Notes |
|---|---|---|
| `register({ group, manifold, sourceTool, name })` | `→ bodyId:string` | Adds a body; sets `group.userData.bodyId` |
| `remove(id)` | `→ bool` | Removes body + THREE group from scene |
| `setVisible(id, visible)` | `→ bool` | Show/hide |
| `rename(id, newName)` | `→ bool` | Rename |
| `isolate(id)` | `→ void` | Hide all except `id` |
| `showAll()` | `→ void` | Show all |
| `clear()` | `→ void` | Remove all bodies |
| `list()` | `→ BodyEntry[]` | Returns a copy of the bodies array |
| `select(id)` | `→ bool` | Single-select (old API — id only, no additive flag) |
| `selectedBody()` | `→ BodyEntry\|null` | Returns the single selected body entry |
| `onChange(cb)` | `→ unsubscribe fn` | Fires with a snapshot array on any change |
| `selectedId` | `string\|null` | Property — the currently selected id |
| `bodies` | `BodyEntry[]` | Raw array (prefer `list()`) |
| Window hook | `window.__archdiscBodies = REGISTRY` | Set at module load |

`BodyEntry` shape:
```js
{ id, name, sourceTool, group, manifold, volume_mm3, createdAt, visible }
```

### Added API (Task 2b — multi-select extension)

| Method | Signature | Notes |
|---|---|---|
| `select(id, additive=false)` | `→ bool` | Extended: second param clears others if false |
| `selectMany(ids)` | `→ void` | Replace selection set with `ids` |
| `deselect(id)` | `→ void` | Remove one id from selection |
| `clearSelection()` | `→ void` | Empty the selection set |
| `selectedIds()` | `→ string[]` | All currently selected ids |
| `selectedBodies()` | `→ BodyEntry[]` | Full entry objects for each selected id |
| `selectedBrepShapes()` | `→ BrepShape[]` | Extracts `group.userData.brepShape` reference — **note:** `addBrepShapeToScene` sets `group.userData.brepShape = true` (a boolean flag), not the BrepShape object itself. The actual BrepShape is stored in `window.__lastBrepShape`. For multi-select, `selectedBrepShapes()` returns the BrepShape stored at the time of selection (stashed by `selectMany` / `select`) on each body entry. |
| Window hook | `window.__archdiscRegistry = REGISTRY` | Exposed by `WorkbenchMechanical.jsx` useEffect |

**Important note on `brepShape` userData:** The current `addBrepShapeToScene` sets `group.userData.brepShape = true` (a boolean) — not the actual object. The live BrepShape is only on `window.__lastBrepShape`. Task 2b stores a `brepShapeRef` property on the BodyEntry at registration time (via an augmented `registerBody` call that accepts `brepShape` in addition to `manifold`). `selectedBrepShapes()` reads `entry.brepShapeRef` (falling back to `entry.group.userData.brepShapeRef`).

**Backwards-compatibility:** The old single-select API is preserved:
- `select(id)` with no second argument behaves identically to before (clears others, selects one, notifies).
- `selectedBody()` returns the first selected body (or `null`).
- `onChange` fires on both body-list changes and selection changes.
- `window.__archdiscBodies` still points to the same registry instance.

---

## (iii) Unified retrofit pattern for every OCCT handler

### Arity-0 (Primitives — no selection needed; dialog defines the shape entirely)

```js
'Box': async (scene, viewport) => {
  try {
    const { values, cancelled } = await requestToolParams('Box');
    if (cancelled) return { status: 'warn', message: 'Box: cancelled' };
    const shape = await ArchDiscKernel.brep.makeBox(values.dx, values.dy, values.dz);
    await addBrepShapeToScene(scene, viewport, shape, 0x4a90d9);
    const m = await ArchDiscKernel.brep.measure(shape);
    return { status: 'success', message: `Box: ${values.dx}×${values.dy}×${values.dz} mm. V = ${m.volume.toFixed(0)} mm³ via OCCT` };
  } catch (err) {
    return { status: 'error', message: 'Box: ' + err.message };
  }
},
```

No `_pickBodies` call. Dialog defines all geometry. If cancelled, return `status:'warn'`.

### Arity-1 (Features — one selected body, plus dialog params)

```js
'<Tool>': async (scene, viewport) => {
  try {
    // 1. Read selection — throws a guiding error if insufficient.
    const bodies = _pickBodies(1);
    // 2. Open the param dialog (if the schema exists in ToolParamSchemas).
    const { values, cancelled } = await requestToolParams('<Tool>');
    if (cancelled) return { status: 'warn', message: '<Tool>: cancelled' };
    // 3. Run op — no hardcoded inputs.
    const result = await ArchDiscKernel.brep.<op>(bodies[0], values.<param1>, ...);
    // 4. Render + report.
    await addBrepShapeToScene(scene, viewport, result);
    const m = await ArchDiscKernel.brep.measure(result);
    return { status: 'success', message: `<Tool>: V = ${m.volume.toFixed(0)} mm³ via OCCT` };
  } catch (err) {
    return { status: err.message.startsWith('select') ? 'warn' : 'error', message: '<Tool>: ' + err.message };
  }
},
```

`_pickBodies(1)` falls back to `window.__lastBrepShape` for arity-1 ops when no selection exists (so single-body workflows still work without explicit selection). For arity >= 2 there is no fallback.

### Arity-2 (Booleans — two selected bodies)

```js
'Combine': async (scene, viewport) => {
  try {
    const bodies = _pickBodies(2);
    const result = await ArchDiscKernel.brep.fuse(bodies[0], bodies[1]);
    await addBrepShapeToScene(scene, viewport, result, 0x4caf50);
    const m = await ArchDiscKernel.brep.measure(result);
    return { status: 'success', message: `Combine: V = ${m.volume.toFixed(0)} mm³ via OCCT` };
  } catch (err) {
    return { status: err.message.startsWith('select') ? 'warn' : 'error', message: 'Combine: ' + err.message };
  }
},
```

No dialog for pure-boolean ops (no params beyond the operands). Operand BrepShapes are owned by the registry; do NOT dispose them inside the handler — the user may reuse them.

### Arity-Infinity (Lattice Fuse — all selected bodies, ≥2)

```js
'Lattice Fuse': async (scene, viewport) => {
  try {
    const bodies = _pickBodies(Infinity);  // throws if < 2 selected
    const result = await ArchDiscKernel.brep.fuseLattice(bodies);
    await addBrepShapeToScene(scene, viewport, result);
    const m = await ArchDiscKernel.brep.measure(result);
    return { status: 'success', message: `Lattice Fuse: ${bodies.length} members. V = ${m.volume.toFixed(0)} mm³` };
  } catch (err) {
    return { status: err.message.startsWith('select') ? 'warn' : 'error', message: 'Lattice Fuse: ' + err.message };
  }
},
```

### Error convention

- `_pickBodies` throws `Error('select a body first')`, `Error('select two bodies first')`, or `Error('select at least 2 bodies first')` — these become `status:'warn'` (user guidance, not a bug).
- Kernel errors become `status:'error'`.
- The `catch` branch distinguishes by checking `err.message.startsWith('select')`.

---

## (iv) Per-tool selection-arity + dialog-schema map

### Primitives (arity 0)

| Tool | Kernel op | Arity | Dialog fields |
|---|---|---|---|
| `Box` | `brep.makeBox(dx, dy, dz)` | 0 | `dx`, `dy`, `dz` (mm) |
| `Cylinder` | `brep.makeCylinder(radius, height)` | 0 | `radius`, `height` (mm) |
| `Sphere` | `brep.makeSphere(radius)` | 0 | `radius` (mm) |
| `Cone` | `brep.makeCone(radius1, radius2, height)` | 0 | `radius1`, `radius2`, `height` (mm) |
| `Torus` | `brep.makeTorus(majorRadius, minorRadius)` | 0 | `majorRadius`, `minorRadius` (mm) |

### Features (arity 1)

| Tool | Kernel op | Arity | Dialog fields |
|---|---|---|---|
| `Fillet` | `brep.filletAll(body, radius)` | 1 | `radius` (mm) |
| `Chamfer` | `brep.chamferAll(body, distance)` | 1 | `distance` (mm) |
| `Variable Radius Fillet` | `brep.variableFillet(body, r1, r2)` | 1 | `r1`, `r2` (mm) |
| `Shell` | `brep.shell(body, thickness)` | 1 | `thickness` (mm) |
| `Draft` | `brep.draft(body, angleDeg)` | 1 | `angleDeg` (deg) |
| `Offset Shape` | `brep.offsetShape(body, distance)` | 1 | `distance` (mm) |
| `Face Fillet` | `brep.blendG2(holeBoxSize)` | 0* | `holeBoxSize` (mm) |
| `Full Round Fillet` | `brep.cliffEdgeBlend(body, radius)` | 1 | `radius` (mm) |
| `Corner Mitre` | `brep.mitreCorner(body, radius)` | 1 | `radius` (mm) |
| `Simplify Geometry` | `brep.simplify(body)` | 1 | _(no params)_ |
| `Subdivide Surface` | `brep.subdivideShape(body, {levels, dihedralDeg, deflection})` | 1 | `levels`, `dihedralDeg`, `deflection` |

*`Face Fillet` currently builds its own internal wire; future enhancement would accept a face selection.

### Boolean (arity 2)

| Tool | Kernel op | Arity | Dialog fields |
|---|---|---|---|
| `Combine` | `brep.fuse(a, b)` | 2 | _(none)_ |
| `Subtract` | `brep.cut(base, tool)` | 2 | _(none)_ |
| `Intersect` | `brep.common(a, b)` | 2 | _(none)_ |
| `Combine (Non-Manifold)` | `brep.fuseNonManifold(a, b)` | 2 | _(none)_ |
| `Combine (Coincident)` | `brep.fuseCoincident(a, b, tolerance)` | 2 | `tolerance` (mm) |

### Boolean N-ary

| Tool | Kernel op | Arity | Dialog fields |
|---|---|---|---|
| `Lattice Fuse` | `brep.fuseLattice(bodies[])` | Infinity (≥2) | _(none)_ |

### Topology (arity 1)

| Tool | Kernel op | Arity | Dialog fields |
|---|---|---|---|
| `Replace Face` | `brep.replaceFace(body, faceIndex)` | 1 | `faceIndex` (int ≥1) |

### Surfacing arity-0 (internal profile — future wire-selection upgrade noted)

| Tool | Kernel op | Arity | Dialog fields | Future |
|---|---|---|---|---|
| `Thicken` | `brep.thicken(w, h, thickness)` | 0 | `width`, `height`, `thickness` (mm) | Promote to face-selection |
| `Extrude Boss` | `brep.extrudeRect(w, d, h)` | 0 | `width`, `depth`, `height` (mm) | Promote to sketch-selection |
| `Revolve Boss` | `brep.revolveRect(innerR, width, height, 360)` | 0 | `revolveSegs` (existing); _inner params hardcoded_ | Promote to sketch-selection |
| `Sweep Boss` | `brep.sweep(radius, length)` | 0 | `radius`, `length` (mm) | Promote to wire-selection |
| `Loft Boss` | `brep.loft(bottomSize, topSize, height)` | 0 | `bottomSize`, `topSize`, `height` (mm) | Promote to multi-section |

---

## Sophistication+Artifact Retrofit — Honest Outcome

**Date:** 2026-05-20  
**Dispatch:** Final three op specs (brep-foundation, brep-check, brep-ribbon)

### Specs retrofitted (this dispatch)

| Spec | Tests | Artifact recipe | Commit |
|---|---|---|---|
| `brep-foundation-electron.spec.js` | 1 | Test cube (Box 40³) — foundational primitive, proves OCCT pipeline | `7320e27d` |
| `brep-check-electron.spec.js` | 6 (2 ribbon + 4 kernel-direct) | Rounded plate (Box+Fillet r=2) for Check Geometry; Bracket-vs-shaft (Box+Cylinder at origin) for Interference | `1fabc123` |
| `brep-ribbon-electron.spec.js` | 5 | Test cube (Box), Shaft stub (Cylinder), Bearing ball (Sphere), Rounded plate (Fillet→26 faces, vol drop confirmed), Mounting block with boss (Combine) | `3af1dcdd` |

**Total specs in this dispatch:** 3  
**Total tests in this dispatch:** 12 (1 + 6 + 5)

### Kernel-direct exemptions

| Test | File | Reason |
|---|---|---|
| Leak guard (makeBox×20) | `brep-foundation` | No ribbon workflow probes WASM heap across 20 temporary shapes + dispose loop |
| Self-intersection POSITIVE (overlapping compound) | `brep-check` | No ribbon workflow creates a self-intersecting compound via translate+makeCompound |
| Clash POSITIVE (overlapping solids) | `brep-check` | No ribbon workflow positions two solids at a known overlap offset |
| Clash NEGATIVE (disjoint pair) | `brep-check` | No ribbon workflow positions two solids at a specified clearance gap |
| Leak guard (checkSelfIntersection×25) | `brep-check` | WASM lifecycle test — no user workflow repeats a check 25× in a loop |

All exempt tests carry the canonical JSDoc: `// Heap leak guard — bypasses user workflow on purpose to probe WASM heap behaviour. Exempt from the user-workflow rule.` or `// EXEMPT: there is no ribbon workflow that builds a self-intersecting compound / a disjoint-positioned pair...`.

### Full suite result

**51 passed / 51 total — 0 failures — 0 flakes** (run time: 6.5 min, 7 workers, Chromium)

Specs included:
`brep-occt-load`, `brep-a1-recon`, `brep-a2-recon`, `brep-a3-recon`, `brep-a4-recon`, `brep-a5-recon`,
`brep-b-recon`, `subdivide-recon`, `brep-foundation`, `brep-ribbon`, `brep-primitives`,
`brep-boolean`, `brep-features`, `brep-step`, `brep-localops`, `brep-surfacing`, `brep-varfillet`,
`brep-check`, `brep-simplify`, `brep-blend`, `brep-b-advanced`, `subdivide-surface`,
`thought-bubble-dismiss`.

### Handler/schema fixes in this dispatch

None required. All three specs passed on first run after the artifact-recipe retrofit.

### Notable verified geometry values

- Box 40³: vol=64000.00 mm³, 6 faces, 12 edges (exact)
- Cylinder r=20 h=40: vol=50265 mm³, 3 faces, 3 edges
- Sphere r=25: vol=65450 mm³, 1 face, 3 edges
- Fillet r=2 on Box 40³: vol=63599 mm³ (drop confirmed), **26 faces** (6 flat + 12 cylindrical + 8 spherical corners)
- Interference (Box 40³ + Cylinder r=20 h=40 at origin): clash=true, interferenceVolume=2356 mm³
- Check Geometry (rounded plate): selfIntersects=false, valid=true
