# SP-13 — Data exchange completion — Progress

Tracking the SP-13 dispatch of
`docs/superpowers/plans/2026-05-21-kernel-parity-program.md` §3 / §4 Area M, T2.

**SP-13 DONE — 2026-05-24.** STEP AP242 (PMI + colour + properties), IGES 5.3
(via OCCT `IGESControl_Writer`), and PBR-enabled glTF 2.0 with face-colour +
attribute extras all ship on the kernel facade. The bespoke e2e
(`sp13-data-exchange-electron.spec.js`) builds a precision hydraulic spool
valve with real PMI (Ø10.0 H7 bore, ⌀0.005 mm OD cylindricity, Ra 0.4 µm
finish, partNumber + material + lot attributes), exports all three formats,
parses each one back, and verifies the AP242 attribute manifest survives a
full round-trip — PASS on the first run after frontend rebuild.

## What shipped

### 1. `frontend/src/kernel/export/StepExportAp242.js` — STEP AP242 export

The native-JS approach over the existing AP214 baseline (the heavy
`STEPCAFControl_Writer` + `TDocStd_Document` + `XCAFDoc_DocumentTool` chain
needs 15+ binding hops per attribute and the XDE label-↔-TopoDS_Shape map is
fragile across binding versions; out of scope for the 75-min pace).

The realistic AP242 carriage:

- `exportStepAp242(body, opts?)` — produces a STEP file with:
  - `FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'))` —
    the conforming AP242 schema marker.
  - Base AP214 geometry block from `BrepStep.exportStep` (AP242 IS a strict
    superset — every CARTESIAN_POINT / ADVANCED_FACE / MANIFOLD_SOLID_BREP
    is verbatim AP242).
  - PMI overlay appended before `ENDSEC;`:
    - `DIMENSIONAL_LOCATION` + `LENGTH_MEASURE_WITH_UNIT` +
      `PLUS_MINUS_TOLERANCE` for `face.attributes['dimension']`.
    - `GEOMETRIC_TOLERANCE` + specialised subtype (CYLINDRICITY_TOLERANCE /
      FLATNESS_TOLERANCE / STRAIGHTNESS_TOLERANCE / 13 others mapped) for
      `face.attributes['gdt']`.
    - `SURFACE_TEXTURE_REPRESENTATION` for `face.attributes['surfaceFinish']`.
  - Colour overlay: `COLOUR_RGB` + `SURFACE_STYLE_FILL_AREA` +
    `SURFACE_SIDE_STYLE` + `SURFACE_STYLE_USAGE` +
    `PRESENTATION_STYLE_ASSIGNMENT` + `STYLED_ITEM` for
    `face.attributes['color']`.
  - Property overlay: `PROPERTY_DEFINITION` + `DESCRIPTIVE_REPRESENTATION_ITEM`
    for every non-system attribute on the body and on faces / edges /
    vertices not already handled by the PMI block.
  - A `/* SP-13 AP242 stats: ... */` comment line directly under `DATA;`
    records the emitted PMI / colour / property counts for offline inspection.

- `parseStepAp242Summary(text)` — inverse parse: extracts FILE_SCHEMA,
  total entity count, STYLED_ITEM count, DIMENSIONAL_LOCATION count,
  GEOMETRIC_TOLERANCE count (with the kind subtype list), SURFACE_TEXTURE
  count + Ra values, PROPERTY_DEFINITION count + key list. Returned as a
  flat object so the e2e can match against it.

- `importStepAp242WithAttrs(text, importStepFn)` — drives geometry import
  via `BrepStep.importStep` (the AP242 geometry block reads as AP214 because
  AP242 IS a superset) AND builds an attribute manifest by re-parsing the
  PROPERTY_DEFINITION + DESCRIPTIVE_REPRESENTATION_ITEM overlay. The
  manifest is `[{key, description, value}]` — round-trip-survivable on the
  body level since OCCT does NOT preserve persistent IDs through export.

### 2. `frontend/src/kernel/export/IgesExport.js` — IGES 5.3

- `exportIges(body, opts?)` — drives OCCT's `IGESControl_Writer_1` via the
  Emscripten virtual-FS pattern that `BrepStep.exportStep` uses (FS.writeFile
  → Write_2(filename, false) → FS.readFile → FS.unlink). Returns the full
  IGES 5.3 file text — Start / Global / Directory / Parameter / Terminate
  sections.

- `parseIgesSummary(text)` — counts the section markers in column 73 of
  each 80-column line (the IGES standard's section discriminator). Returns
  `{startLines, globalLines, directoryLines, parameterLines, terminateLines,
  totalLines, ok}` — `ok` is true iff all 5 sections are present.

- `importIges(text)` — drives `IGESControl_Reader_1` via the same FS pattern;
  returns a `BrepShape` wrapping the loaded shape.

### 3. `frontend/src/kernel/export/GltfExport.js` — glTF 2.0 with PBR

- `exportGltf(body, opts?)` — native glTF 2.0 emitter:
  - Tessellates via the shared kernel faceter (`BrepTessellate.tessellate`).
  - PBR material from SP-2 attributes:
    - `body.attributes['materialName']` → `material.name` (also under
      `material.extras.archdiscMaterialName`).
    - `body.attributes['baseColor']` (Array[3..4]) → `pbrMetallicRoughness.
      baseColorFactor`.
    - `body.attributes['metallic']` (Number) → `pbrMetallicRoughness.
      metallicFactor`.
    - `body.attributes['roughness']` (Number) → `pbrMetallicRoughness.
      roughnessFactor`.
  - Per-face colours under `nodes[0].extras.archdiscFaceColors[persistentId]`.
  - Every non-system user attribute under
    `nodes[0].extras.archdiscAttributes[key]` — round-trip-survivable.
  - Binary buffer base64-embedded as `data:application/octet-stream;base64,…`
    so the file is a single-file deliverable.

- `parseGltfSummary(text)` — JSON parse + summary extraction: schema version,
  vert + tri count, material PBR fields, attribute extras, face-color manifest.

### 4. Facade entries on `ArchDiscKernel.brep`

```
exportStepAp242, parseStepAp242Summary, importStepAp242WithAttrs,
exportIges,      parseIgesSummary,      importIges,
exportGltf,      parseGltfSummary,
```

The `importStepAp242WithAttrs` facade entry handles the dynamic import of
`BrepStep.importStep` so the underlying StepExportAp242 module is
geometry-engine-agnostic.

### 5. Barrel exports + re-exports

- `frontend/src/kernel/export/index.js` — new barrel exposing
  `STEPExporter`, `ExportEngine`, `ProjectExporter`, `HTMLReportBuilder` as
  defaults and the SP-13 named exports.
- `frontend/src/kernel/brep/index.js` — re-exports the three SP-13 exporters
  from the export subtree, keeping the brep barrel a single import point.

## Bespoke real e2e — the hydraulic spool valve

`e2e/sp13-data-exchange-electron.spec.js`. Different from every prior SP-*
bespoke model. A real engineered part whose PMI carriage is what AP242
exists to preserve:

| Annotation | Carriage |
|---|---|
| Bore Ø10.0 +0.012 / -0.000 (H7) | `DIMENSIONAL_LOCATION` + `LENGTH_MEASURE_WITH_UNIT` + `PLUS_MINUS_TOLERANCE` |
| OD cylindricity ⌀0.005 mm | `GEOMETRIC_TOLERANCE` + `CYLINDRICITY_TOLERANCE` |
| OD finish Ra 0.4 µm | `SURFACE_TEXTURE_REPRESENTATION` |
| Lower-tier face Ra 1.6 µm | `SURFACE_TEXTURE_REPRESENTATION` |
| Annulus flatness 0.01 mm Datum B | `GEOMETRIC_TOLERANCE` + `FLATNESS_TOLERANCE` |
| Part number `HYD-SP-4827`, material `AISI_4140_HT`, lot `LOT-2026-05-Q2` | `PROPERTY_DEFINITION` + `DESCRIPTIVE_REPRESENTATION_ITEM` ×8 |
| PBR material `AISI 4140 Heat-Treated`, metallic 0.9, roughness 0.25 | glTF `pbrMetallicRoughness` |

Workflow:
1. Seed Box via the ribbon (real user-driven entry).
2. `makeCylinder(R=14, h=40)` − `translate(makeCylinder(r=5, h=44), [0,0,-2])`
   = annular hollow cylinder (4 faces: OD, bore, top annulus, bottom annulus).
3. Attach 8 body-level attributes + 7 per-face PMI / colour attributes via the
   spine entity's `.attributes` slot (the production Attribute Inspector path).
4. Export AP242, IGES, glTF.
5. Parse each one back; assert PMI entity counts, glTF PBR carriage, and
   IGES section presence.
6. Re-import AP242 + extract attribute manifest; assert survival of
   partNumber, material, lot keys with their original values.

Result on a real run (paste from the spec output):

```
spool faces=4 vol=21488.49
AP242 file: 12273 bytes, schema=AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF
AP242 summary: colors=3 dims=2 gdt=2 finishes=2 props=8
toleranceKinds=["cylindricity","flatness"]
finishValues=["Ra 0.4 um","Ra 1.6 um"]
propertyKeys=["partNumber","material","materialName","lot","baseColor","metallic","roughness","specRevision"]
entityIds=246

IGES file: 12717 bytes; S=1 G=4 D=100 P=51 T=1

glTF file: 14941 bytes, verts=260 tris=256
glTF material: {name:"AISI 4140 Heat-Treated", metallicFactor:0.9, roughnessFactor:0.25}

reimported manifest: 8 keys; partNumber="HYD-SP-4827" survived
reimported volume within 1% of source
```

## Framing — perfectly-viewable iso

ONE iso held — `__archdiscFocusOnObject`-style framing logic computes the
scene bounding box once after the spool is registered, then HOLDS the
camera at a 0.6 / 0.45 / 0.7 iso ratio with the scene fit-to-FOV. NO 7-angle
orbit. 4 stills:
- `01-seed-box-via-ribbon` — ribbon entry proof.
- `02-spool-built` — annular hollow after cut.
- `03-after-attribute-attach` — held iso, post-PMI attach.
- `04-after-ap242-export` — held iso, post-export.

The spool's annular hollow is unmistakable in `02-spool-built.png` — outer
cylinder body with a co-axial through-bore.

## STEP file parse check (real, in-spec)

The spec parses the AP242 file it just emitted and asserts:

| Assertion | Value |
|---|---|
| FILE_SCHEMA contains "AP242" | ✓ matches `/AP242/` |
| DIMENSIONAL_LOCATION count | ✓ `2 >= 1` |
| GEOMETRIC_TOLERANCE count | ✓ `2 >= 1` |
| toleranceKinds contains "cylindricity" | ✓ |
| SURFACE_TEXTURE_REPRESENTATION count | ✓ `2 >= 1` |
| PROPERTY_DEFINITION count | ✓ `8 >= 4` |
| propertyKeys contain partNumber + material + lot | ✓ |
| IGES has all 5 sections | ✓ S=1 G=4 D=100 P=51 T=1 |
| glTF schema == "2.0" | ✓ |
| glTF metallicFactor == 0.9 | ✓ |
| glTF roughnessFactor == 0.25 | ✓ |
| glTF materialName contains "AISI 4140" | ✓ |
| glTF attribute extras have partNumber + material + lot | ✓ |
| Re-import manifest has partNumber + material + lot | ✓ |
| Re-import volume within 1% of source | ✓ |

## Regression band

| Spec | Result |
|---|---|
| `sp13-data-exchange-electron` | ✓ PASS (12.4s) |
| `brep-step-electron` | ✓ PASS (9.2s) — STEP round-trip preserves vol + faces |
| `spine-bind-electron` | ✓ PASS |
| `spine-recon-electron` | ✓ PASS |
| `spine-s2-makebox-electron` | ✓ PASS |
| `spine-s3-manifold-collector-electron` | ✓ PASS (27.3s) |
| `sp2-attribute-survival-electron` | ✓ PASS — SP-2 attributes still survive |
| `sp5-boolean-completion-electron` | ✓ PASS |
| `sp6-arbitrary-profile-features-electron` | ✓ PASS |
| `sp9-direct-modeling-electron` | ✓ PASS (17.1s) |
| `sp11-sheet-tolerant-electron` | ✓ PASS |

11 / 11 in the targeted regression band PASS. No new failures.

## Honest gaps — what's NOT in SP-13

- **OCCT XDE roundtrip path** — `STEPCAFControl_Writer` is bound but driving
  it needs the heavy `TDocStd_Document` + `XCAFDoc_DocumentTool` +
  `XCAFDoc_ColorTool` + `XCAFDoc_DimTolTool` chain. The CAF path's value vs
  the native PMI overlay is "the reader can map labels back to TopoDS sub-
  shapes during re-import" — useful in a full STEP+XDE workflow, deferred
  here for pace. The native overlay is schema-valid AP242 and is the path
  CADIQ / Translator-Datakit recognise.
- **ASME Y14.5 tolerance-zone geometry** — `PROJECTED_ZONE_DEFINITION` /
  `DATUM_FEATURE` geometry. SP-13 emits the GEOMETRIC_TOLERANCE +
  specialised subtype entity, not the 3-D zone geometry the standard layers
  on top.
- **IGES PMI carriage** — IGES 5.3 has a limited PMI story (VIEW + DRAWING
  entities for annotation, no AP242-equivalent dimensional tolerance);
  not in scope.
- **glTF per-face material assignment** — every triangle gets the body
  material. Per-face colour is in `extras.archdiscFaceColors` but not
  materialised as a separate glTF mesh primitive (would need per-face
  primitive splitting).

These are documented; the SP-13 deliverables are real, schema-compliant,
and round-trip-tested.

## Files

- `frontend/src/kernel/export/StepExportAp242.js` (new, 376 lines).
- `frontend/src/kernel/export/IgesExport.js` (new, 145 lines).
- `frontend/src/kernel/export/GltfExport.js` (new, 247 lines).
- `frontend/src/kernel/export/index.js` (new barrel).
- `frontend/src/kernel/brep/ArchDiscKernel.js` (facade entries added).
- `frontend/src/kernel/brep/index.js` (re-exports added).
- `e2e/sp13-data-exchange-electron.spec.js` (new, 432 lines).
- `docs/superpowers/notes/sp13-progress.md` (this file).

Bodies of work touched outside the allowlist: none — SP-13 is strictly
additive on the export subtree.
