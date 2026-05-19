# OCCT API Reconnaissance — Phase A0

**Date:** 2026-05-18  
**Package:** `opencascade.js@2.0.0-beta.b5ff984`  
**Source:** `e2e/brep-occt-load-electron.spec.js` run against the real Electron app  
**Raw output:** `docs/superpowers/notes/occt-api-A0-recon.json`

## Summary

The OCCT WASM module loaded successfully inside the ArchDisc Electron app. The
Embind binding surface exposes **24,878 named properties** on the `oc` object.
All key B-rep classes are present.

---

## Key Binding Names

### Box Constructor — `BRepPrimAPI_MakeBox`

All six overloads are present, mangled with numeric suffixes:

| Binding name            | C++ overload (inferred)                               |
|-------------------------|-------------------------------------------------------|
| `BRepPrimAPI_MakeBox`   | base class / default                                  |
| `BRepPrimAPI_MakeBox_1` | `(dx, dy, dz)` — box by three dimensions              |
| `BRepPrimAPI_MakeBox_2` | `(P, dx, dy, dz)` — box from point + dimensions       |
| `BRepPrimAPI_MakeBox_3` | `(P1, P2)` — box from two corner points               |
| `BRepPrimAPI_MakeBox_4` | `(Axes, dx, dy, dz)` — box with custom axis placement |
| `BRepPrimAPI_MakeBox_5` | additional overload                                   |

**Use `BRepPrimAPI_MakeBox_1` for the canonical `(dx, dy, dz)` call.**

---

### Incremental Mesher — `BRepMesh_IncrementalMesh`

Four overloads:

| Binding name                    | C++ overload (inferred)                              |
|---------------------------------|------------------------------------------------------|
| `BRepMesh_IncrementalMesh`      | base class / default                                 |
| `BRepMesh_IncrementalMesh_1`    | `(shape, linDeflection)` — basic mesh                |
| `BRepMesh_IncrementalMesh_2`    | `(shape, linDeflection, isRelative)`                 |
| `BRepMesh_IncrementalMesh_3`    | `(shape, linDeflection, isRelative, angDeflection)`  |

**Use `BRepMesh_IncrementalMesh_2` or `_3` for angle-controlled triangulations.**

---

### `BRep_Tool`

Present as `BRep_Tool` (single static-method class, no overload suffixes needed).  
Key static methods available at runtime (call as `oc.BRep_Tool.prototype.*` or
via instance): `Surface`, `Curve`, `Triangulation`, `Pnt`, etc.

---

### Mass Properties — `GProp_GProps` / `BRepGProp`

**`GProp_GProps`** (base properties container):

| Binding name    | Notes                                    |
|-----------------|------------------------------------------|
| `GProp_GProps`  | default constructor                      |
| `GProp_GProps_1`| `(g)` — from a point of symmetry        |
| `GProp_GProps_2`| additional constructor                   |

**`BRepGProp`** (static dispatcher — use to fill a `GProp_GProps`):

| Binding name     | Purpose                                              |
|------------------|------------------------------------------------------|
| `BRepGProp`      | static class                                         |
| `BRepGProp_Vinert` / `_1`–`_13` | volumetric inertia (13 overloads) |
| `BRepGProp_Sinert` / `_1`–`_5`  | surface inertia (5 overloads)     |
| `BRepGProp_Cinert` / `_1`–`_2`  | curve/edge inertia (2 overloads)  |

**Typical volume/mass usage:**
```js
const props = new oc.GProp_GProps_1(new oc.gp_Pnt_1(0, 0, 0));
oc.BRepGProp.VolumeProperties(shape, props);
const volume = props.Mass();
```

---

### Shape Explorer — `TopExp_Explorer`

Three overloads:

| Binding name        | C++ overload (inferred)                                 |
|---------------------|---------------------------------------------------------|
| `TopExp_Explorer`   | default constructor                                     |
| `TopExp_Explorer_1` | `(shape, toFind)` — explore all sub-shapes of a type   |
| `TopExp_Explorer_2` | `(shape, toFind, toAvoid)` — with avoidance filter      |

**Typical usage:**
```js
const exp = new oc.TopExp_Explorer_2(solid, oc.TopAbs_ShapeEnum.TopAbs_FACE,
                                      oc.TopAbs_ShapeEnum.TopAbs_SHELL);
for (; exp.More(); exp.Next()) {
  const face = oc.TopoDS.Face_1(exp.Current());
}
```

---

### `TopoDS`

Present as `TopoDS` (static cast helper).  
Key methods: `TopoDS.Face_1`, `TopoDS.Edge_1`, `TopoDS.Wire_1`,
`TopoDS.Vertex_1`, `TopoDS.Shell_1`, `TopoDS.Solid_1`, `TopoDS.Compound_1`.

---

## Notes for Tasks 5-7

- All overloaded constructors carry the `_N` suffix; the undecorated name (e.g.
  `BRepPrimAPI_MakeBox`) is the base class — do not call it directly.
- Total binding surface: 24,878 names — the full OpenCASCADE kernel is present.
- `oc.TopAbs_ShapeEnum.TopAbs_FACE` etc. provide the shape-type enums.
- No `GProp_GProps` needed for volume when using `BRepGProp.VolumeProperties`
  directly; pass a pre-constructed `GProp_GProps_1` as the output parameter.
- The WASM is ~50 MB; `getOCCT()` caches the module singleton — subsequent
  calls return immediately from cache.
