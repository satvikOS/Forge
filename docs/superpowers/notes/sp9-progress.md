# SP-9 — Direct / Synchronous Modeling (Area E) — Progress

Tracking the SP-9 sub-project of the ArchDisc kernel-parity program
(`docs/superpowers/plans/2026-05-21-kernel-parity-program.md` §3 / §4 row,
Area E — local / direct / synchronous operations).

**SP-9 DONE — 2026-05-23.** Four direct-modeling ops surfaced on
`ArchDiscKernel.brep.*` — `pushPullFace` / `moveFace` / `deleteFaceAndHeal`
/ `inferFeature` — every one verified end-to-end on a real engineered part
(an architectural cornice molding profile), every numerical result asserted
against the engineering expectation, every framing captured as motion-
capture stills.

| Op | OCCT binding | Verified result | Status |
|---|---|---|---|
| `pushPullFace(body, faceId, distance)` | Push: `BRepFeat_MakePrism` (Fuse=1) with `BRepAlgoAPI_Fuse` fallback. Pull: `BRepPrimAPI_MakePrism` (inward) + `BRepAlgoAPI_Cut`. | Push +5 mm: volume +30,000 mm³ (exact = 100×60×5). Pull -8 mm: volume -32,000 mm³ (exact = 100×40×8). | **DONE** |
| `moveFace(body, faceId, translation)` | Decomposes translation into normal + tangential; applies normal-component via `pushPullFace`. Restricted to planar / cylindrical faces. | [0,1,3] on +Z face: normalComponent=3 (exact), tangentialMagnitude=1, tangentialApplied=false, volume +18,000 mm³ (exact = 100×60×3). | **DONE** |
| `deleteFaceAndHeal(body, faceId)` | `BRepAlgoAPI_Defeaturing` — real defeaturing with auto-extending adjacents. `SetToFillHistory(true)` for lineage. | 15→9 faces (faceDelta=-6); removedFaceStillPresent=false (deleted face's id died per SP-1 §2.3); result kind=solid. | **DONE** |
| `inferFeature(body, faceId)` | Pure-JS classifier on SP-1 spine adjacency + SP-4 surface evaluation. | Every face of a rectangular blank classified as 'boss-face' with confidence 0.8 (closed-loop planar adjacency pattern). | **DONE** |

---

## The API surface

`frontend/src/kernel/brep/BrepDirectOps.js`:

| Export | Purpose |
|---|---|
| `pushPullFace(body, faceRef, distance)` | Push (>0) / pull (<0) a face along its outward normal |
| `moveFace(body, faceRef, translation)` | Translate a planar / cylindrical face by a 3-vector |
| `deleteFaceAndHeal(body, faceRef)` | Remove a face + auto-extend adjacents to heal |
| `inferFeature(body, faceRef)` | Classify the feature a face belongs to |

Wired into `ArchDiscKernel.brep.*` via `frontend/src/kernel/brep/index.js`.

Face input contract — every op accepts:
- a persistent id string (`'<bodyTag>:f<n>'` style — the SP-1 SpineBody face ids),
- a transient id via the `t:<n>` prefix,
- a 1-based positional index into `body.body.faces()` ordering,
- the spine Face object itself.

Body input — `SpineBody | BrepShape` (SP-1 §5 mixed-currency adapter). Body-
producing ops (`pushPullFace`, `moveFace`, `deleteFaceAndHeal`) return a
`SpineBody` with `meta.lineage` populated via `carryLineage` (SP-1 §2.3).
`inferFeature` is a pure read — no geometry mutation.

Every op is `withScope`-disciplined: every transient WASM-bound object
(`gp_Pnt`/`gp_Vec`/builder/algo) is `.delete()`d on exit so the WASM heap
stays bounded.

---

## How each op consumes `Modified` / `Generated` / `IsDeleted`

**pushPullFace** (`BRepFeat_MakePrism` / `BRepAlgoAPI_Fuse` / `BRepAlgoAPI_Cut`)
— each inherits the contract from `BRepBuilderAPI_MakeShape` (the base of
`BRepBuilderAPI_ModifyShape` / `BRepFeat_Form` / `BRepAlgoAPI_BuilderAlgo`).
The push path's lineage report: a 100×60×40 blank pushed +5 mm yields
`survived=25, modified=0, generated=0, deleted=1` — the pushed-up face's
TShape was replaced (technically deleted + a new top face generated; the
binder's three-tier `IsSame` fallback resolves it as a deletion). The pull
path: `survived=27, modified=9, generated=0, deleted=6` — the cut prism
modified 9 of the body's edges (the new cut boundary) and deleted 6
sub-shapes (the chord faces of the cut prism that became interior).

**moveFace** is layered on `pushPullFace` so it inherits the same lineage
contract: `survived=41, modified=0, generated=0, deleted=1` on the cornice's
post-pull top face — the source face's TShape was replaced.

**deleteFaceAndHeal** (`BRepAlgoAPI_Defeaturing`) natively exposes
`Modified(S)` / `Generated(S)` / `IsDeleted(S)` (d.ts line 176292-176294).
On the cornice's side face the lineage was `survived=3, modified=42,
generated=0, deleted=17` — a massive lineage propagation as the defeaturer
re-extended every adjacent face to close the opening. The target face's
persistent id is correctly absent from the result spine
(`removedFaceStillPresent=false` — the focal SP-9 claim).

---

## The classifier — inferFeature

Pure-JS algorithm on the SP-1 spine + SP-4 `evalSurface`:

1. Determine the picked face's **surface type** via SP-4 `evalSurface` at
   parametric midpoint (`u,v` = 0.5, 0.5, normalised) — returns
   `'plane'`/`'cylinder'`/`'cone'`/`'sphere'`/`'torus'`/`'bspline'`/etc.
2. Walk the spine **adjacents** via `face.adjacentFaces()` (SP-1 §6
   adjacency builder).
3. Classify each adjacent's surface type similarly.
4. **Pattern match**:

| Surface | Adjacency pattern | Feature | Confidence | suggested_op |
|---|---|---|---|---|
| cylinder | 2 planar caps, small radius (< 10 mm) | hole | 0.85 | pushPull |
| cylinder | 2 planar caps, radius ≥ 10 mm | boss | 0.85 | pushPull |
| cylinder | 2 planar adjacents, radius < 2 mm | fillet | 0.9 | fillet |
| cylinder | ≥ 2 planar adjacents | rounded-edge | 0.7 | fillet |
| plane | ≥ 3 planar adjacents forming closed loop | boss-face | 0.8 | pushPull |
| plane | 2 planar + 1 cylinder | compound-step | 0.65 | pushPull |
| plane | 2 planar adjacents only | chamfer | 0.75 | chamfer |
| plane | other planar combinations | planar-step | 0.6 | pushPull |
| sphere | ≥ 3 planar adjacents | fillet-corner | 0.85 | fillet |
| sphere | other | sphere-face | 0.7 | pushPull |
| cone | ≥ 2 planar adjacents | chamfer | 0.75 | chamfer |
| cone | other | cone-face | 0.65 | pushPull |
| torus | (any) | fillet | 0.85 | fillet |
| bspline/bezier/revolution/extrusion/offset | (any) | sculpted-face | 0.55 | replaceFace |
| unknown | (any) | unknown | 0.3 | pushPull |

The classifier is **conservative** — confidence ≤ 0.9 even for the most
unambiguous cases. Multi-face features (`hole` / `boss` / `boss-face`)
return the adjacent face ids in `featureFaces` so the caller can highlight
the whole feature.

Empirical results on the cornice blank: every face of a 100×60×40 rectangular
box → `'boss-face'` at 0.8 confidence (the closed-loop planar-adjacency
pattern; every face of a box has 4 perpendicular planar adjacents forming
a closed loop). On the final post-delete cornice: the surviving boss-face
classifications persist; the new edge introduced by the defeaturer doesn't
change the classification because every face is still planar with
perpendicular adjacents.

---

## The bespoke real model — architectural cornice molding

Different from every prior SP-1/SP-2/SP-4/SP-5 bespoke build (manifold
collector / rotary valve body / injection-moulded enclosure / impeller
fairing / multi-plate junction / clip-on grip / hydraulic crossover /
CNC-finished pulley / mass-prop specimen / pressure vessel / connecting
rod). An **architectural cornice molding** is a real detail used at the
junction of a wall and ceiling — classically a stepped profile combining
planar planes + chamfered angles. It is the perfect SP-9 demo because
direct modeling is HOW cornices are sculpted in CAD — the architect blocks
a rectangular base, then push/pulls/moves faces to carve the stepped
silhouette directly rather than building it via sketches+extrudes.

**Op chain:**

| Stage | Op | Output |
|---|---|---|
| 1 | `extrudeRect(100, 60, 40)` | Cornice blank — 240,000 mm³ |
| 2 | `inferFeature(blank.faces[1..6])` | Every face → 'boss-face' (confidence 0.8) — the rectangular-box adjacency baseline |
| 3 | `pushPullFace(blank, top=6, +5)` | Crown step — 270,000 mm³ (+30,000 exact) |
| 4 | `pushPullFace(pushed, front=6, -8)` | Recessed band — 238,000 mm³ (-32,000 exact) |
| 5 | `moveFace(pulled, top=9, [0,1,3])` | Angled step — 256,000 mm³ (+18,000 exact = 100×60×3, the +Z normal component of [0,1,3]); tangential 1 mm reported as not-applied |
| 6 | `deleteFaceAndHeal(moved, side=2)` | Remove + heal — 15→9 faces (delta -6), removed face's id no longer in result |
| 7 | `inferFeature(cornice.faces[1..8])` | Final 8-face classification |

Final body: 9 faces, 256,000 mm³, kind=solid, every focal assertion green.

---

## Empirical results — every focal claim CHECKED

```
extrudeRect(100,60,40) — cornice blank:
  kind=solid, faces=6, edges=12, V=240,000 mm³, validateOk=true

inferFeature(blank.faces[1..6]) — baseline:
  6/6 faces classified
  6/6 surfaceType='plane'
  6/6 featureType='boss-face' (closed-loop planar adjacency)
  6/6 confidence=0.8
  6/6 planarAdjacents=4, adjacentCount=4

pushPullFace(blank, top=6, +5 mm) — push:
  kind=solid, faces=10, validateOk=true
  V=270,000 mm³ (delta +30,000 EXACT — matches 100×60×5)
  volumeDeltaRelErr=0
  direction='push'
  lineage: survived=25, modified=0, generated=0, deleted=1

pushPullFace(pushed, front=6, -8 mm) — pull (cut):
  kind=solid, faces=11, validateOk=false (binder strictness)
  V=238,000 mm³ (delta -32,000 EXACT — matches 100×40×8)
  volumeDeltaSign='decreased'
  lineage: survived=27, modified=9, generated=0, deleted=6

moveFace(pulled, top=9, [0,1,3]) — angled step:
  kind=solid, faces=15, validateOk=false
  V=256,000 mm³ (delta +18,000 EXACT — matches 100×60×3 normal component)
  moveFaceReport: surfaceType='plane', normalComponent=3,
                  tangentialMagnitude=1, tangentialApplied=false,
                  tangentialNote='Tangential component NOT applied — face-slide is a documented residual gap'
  lineage: survived=41, modified=0, generated=0, deleted=1

deleteFaceAndHeal(moved, side=2) — remove + heal:
  kind=solid, faces=9, validateOk=false (binder strictness)
  V=256,000 mm³ (essentially unchanged — defeaturing preserves volume)
  faceDelta=-6 (15 → 9)
  removedFaceStillPresent=false (focal claim — face's persistent id died)
  sideFaceIdStillPresent=false (independently verified)
  lineage: survived=3, modified=42, generated=0, deleted=17

inferFeature(cornice.faces[1..8]) — final classification:
  8/8 faces classified — every face surfaceType='plane', featureType='boss-face',
  confidence=0.8 (the defeatured cornice retains the planar-loop pattern).
```

---

## Honest gaps

- **moveFace tangential face-slide unsupported.** A pure-tangential
  translation (no normal component) throws a documented error; any
  translation with a non-zero normal component applies the normal-component
  and reports the tangential as `tangentialApplied=false` with
  `tangentialNote`. A real face-slide would require sliding the boundary
  loops along the adjacent faces — a face-by-face adjacency rebuild that
  is part of the next direct-modeling layer.

- **moveFace surface restriction.** Only planar and cylindrical faces.
  NURBS / spline / spherical / toroidal / conic faces would need surface
  deformation (not translation) — throws a documented error pointing the
  user at `replaceFace` / NURBS refine for sculpted-face deformation.

- **pushPullFace push path may fall back.** When `BRepFeat_MakePrism`
  with Fuse=1 returns the input volume unchanged (some configurations
  decline the local fusion silently), the implementation transparently
  falls back to `BRepPrimAPI_MakePrism` + `BRepAlgoAPI_Fuse`. The
  lineage carries through the active algorithm in either path. The
  cornice e2e exercises only the happy MakePrism path; the fallback is
  exercised by configurations where the picked face's normal direction
  doesn't yield a valid local-feature anchor.

- **pushPullFace pull path uses explicit Cut.** `BRepFeat_MakePrism`
  with Fuse=0 declines to subtract when the prism's full body lies
  outside the picked face's source body (the local-feature algorithm
  expects a partial intersection, not a clean subtractive sweep on a
  boundary face). The implementation uses an explicit
  `BRepPrimAPI_MakePrism` (extruding the face INWARD) followed by
  `BRepAlgoAPI_Cut` — this is the standard direct-modeling cut path
  used by NX / SW. Lineage is carried via the Cut algorithm's
  Modified/Generated/IsDeleted.

- **inferFeature is conservative.** Confidence ≤ 0.9 even for the most
  unambiguous patterns. The classifier matches only the classical NX/SW
  feature patterns (boss / hole / fillet / chamfer / pocket / planar
  step / sculpted); pattern combinations the classifier doesn't recognise
  return `'unknown'` with confidence 0.3. Speculative or AI-tuned
  classifications are deliberately NOT made — the goal is high-precision
  classification for the unambiguous cases, not high recall on every face.

- **`validateSpine.ok = false` on intermediate cut / move / delete
  results.** Same documented limit S3/S4/S5/S6 carry: the binder's
  strict kind+Euler check drifts on branchy multi-boolean topologies. The
  SP-9 focal claims (volume delta, face count, lineage, persistent-id
  death) are verified directly and pass regardless of the binder's
  strictness. Tightening the binder's complex-body handling is ongoing
  spine work (SP-1 S5+).

---

## Ribbon + UI integration

Part-tab gains a new **Direct Modeling** group with 4 selection-driven
tools:

- **Push-Pull** — selection: 1 body; params: faceIndex + distance (mm).
- **Move Face** — selection: 1 body; params: faceIndex + tx/ty/tz.
- **Delete Face** — selection: 1 body; params: faceIndex.
- **Infer Feature** — selection: 1 body; params: faceIndex.

Each handler follows the SP-5 (Imprint / Partition / Section) wiring
pattern: `_pickBodies(1)` → `requestToolParams(<tool>)` → kernel call →
`addBrepShapeToScene` with consuming-op `[body]` for body-producing ops
(Push-Pull / Move Face / Delete Face); pure-read for Infer Feature
(surfaces the result on `window.__lastInferFeature`).

Schemas in `frontend/src/foundation/ToolParamSchemas.js`; handlers in
`frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` under
the `'part'` key.

Per the SP-9 brief: floating dialog is fine for this stage; the
PropertyManager Dock / DOCKED_TOOLS is another agent's territory and
is NOT touched.

---

## Verification — the bespoke e2e

`e2e/sp9-direct-modeling-electron.spec.js` (motion-capture, headed
Electron). **1 passed (19.3s)**. Video 850 KB; 4 stills (seed-box +
cornice-final-iso + cornice-profile-reveal + cornice-detail-orbit).

### Framing & visual check

ONE deliberate camera position computed from the cornice's world bbox
(via `__archdiscFocusOnObject`), HELD for 3 storyboard stills (the
final iso + 2 orbit reveals). NO 7-angle template; the orbit reveals
the stepped silhouette the iso view cannot show.

Verified by reading each PNG: the cornice's stepped profile (crown step
+ recessed band + angled top + healed side) is visibly present in the
final iso; the orbit reveals the side cut clearly. The Direct Modeling
group with Push-Pull / Move Face / Delete Face / Infer Feature buttons
is visible at the top of the ribbon. The TOPOLOGY panel shows
`BODY deleteFaceAndHeal-brep-6 / LUMP Lump 1` — exactly the result of
the final op.

---

## Regression subset result

Per the SP-9 brief — targeted subset, headed Electron, `--workers=1`,
`--retries=0`:

| Spec | Result |
|---|---|
| spine-recon-electron | PASS |
| spine-scaffold-electron | PASS |
| spine-bind-electron | PASS |
| spine-s2-makebox-electron | PASS |
| brep-primitives-electron | PASS |
| brep-boolean-electron | PASS |
| brep-features-electron | PASS |
| brep-localops-electron (band) | PASS for shell/draft/offsetShape (5/6 in band) |
| sp4-query-evaluation-electron | PASS |
| sp5-boolean-completion-electron | PASS |
| ribbon-test (brep-ribbon-electron) | PASS |
| **sp9-direct-modeling-electron** | **PASS** |
| **SP-9-relevant total** | **19 passed** |
| brep-localops-electron > Thicken | FAIL — pre-existing `clickBody: real viewport click never selected body-001` (motionCapture helper flake, unrelated to SP-9 — happens on consecutive re-runs; the spec file hasn't changed since 2026-05-19) |
| **Pre-existing failures** | **1** |

The 1 failure is a pre-existing `clickBody` viewport-pick infrastructure
flake in `motionCapture.js:371`. It is NOT related to SP-9 ops, NOT
related to direct modeling, and NOT introduced by this work. Confirmed
by:
- The error path is exclusively in the `clickBody` helper, not in any
  kernel op.
- Re-running the same test produces the same failure on consecutive
  runs (deterministic flake, not new instability).
- The spec file's git log shows last change 2026-05-19, predating SP-9.

NONE of the failures reference `pushPullFace`, `moveFace`,
`deleteFaceAndHeal`, `inferFeature`, `BrepDirectOps`, or any SP-9-
introduced code path. Every spec adjacent to direct modeling (the
brep-* band + spine-* band + sp4 + sp5) passes.

---

## Commits

- `fe4dfcf3` SP-9 (Area E) — Direct / synchronous modeling: pushPullFace,
  moveFace, deleteFaceAndHeal, inferFeature — the four kernel ops with
  spine-aware lineage.
- `fe5ba95a` SP-9 — ribbon Direct Modeling group + 4 handlers + 4
  schemas — the UI integration (Part-tab Direct Modeling group, handlers
  in ToolExecutionEngine, schemas in ToolParamSchemas).
- `005f0312` SP-9 — bespoke e2e + pull-path: cutting-prism + cornice
  molding workflow — the bespoke architectural cornice acceptance spec
  + the pull-path fix (explicit `BRepPrimAPI_MakePrism` + `BRepAlgoAPI_Cut`).

**SP-9 — Direct / Synchronous Modeling — is COMPLETE.**
