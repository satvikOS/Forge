# SP-1 — Standards Libraries — Design (Session 1)

> **Spec.** Written 2026-05-27. First sub-project of the ~1500-item kernel roadmap closure (categories A–VV). Tracks against the standing bar in `feedback_mech_gap_closure_rules` and the atomic-CAD direction in `2026-05-17-autonomous-atomic-cad-sculptor-design.md`.

## 1. Purpose

Close ~30 line items in the user's roadmap (top-20 leverage hits #4 and #5 + parts of #19/#20, plus C3 hole-clearance) by delivering a **unified, atomic-CAD-compliant Standards Library** behind ONE ribbon entry. Anchor everything to a real 200+-component machinery built **from scratch** in a headed Electron Playwright e2e — the **SpaceX Falcon 9 Block 5 Octaweb thrust structure** (~1170 instances, ~30 unique variants).

## 2. Decisions already made

- **Atomic-CAD contract.** Every catalog placement runs real `kernel/atomic/AtomicOps` (`startSketch → sketchCircle/sketchPolygon → finishSketch → extrude / extrudeCut / revolve`) and records features on a `Part`. Replayable, editable history. No sealed `Manifold` returns. No STEP/glTF/fixture import.
- **Ribbon UX = Approach B.** ONE `Standards Library` button in the mechanical-cad workbench ribbon. Opens a modal browser with category tree → size + length + grade picker → place / pattern. Separate `Pattern Standards` tool drives circular/linear/sketch-driven instancing of a previously-placed standard part.
- **New modules under `kernel/atomic/standards/`** — disjoint from the legacy `kernel/standards/FastenerLibrary.js` (template-style, not atomic-CAD-compliant). Legacy modules stay as quick-mesh fallbacks.
- **Machinery = Falcon 9 Block 5 Octaweb.** Real-world parity per published architecture (Lars Blackmore IAC talks, NASA presentations, SpaceX patents). 9-engine star, Al-Li 2195 thrust dome, 8 cross-bracing struts, ~1170 fastener+bearing instances across ASME B18.2.1/B18.3, ISO 4014/4017/4762/4032/7089/7090, AISC W/L/HSS, SKF 60xx/322xx.
- **Build-from-scratch.** The e2e creates each unique variant via real ribbon clicks (one canonical of each type, atomically sculpted), then instances the rest via real `circularPattern`/`linearPattern` ribbon ops. Total feature-tree size ~250 features for ~1170 instances.

## 3. Scope

### 3.1 In scope (12 catalogs)

| # | Catalog | Standard | Sizes |
|---|---|---|---|
| 1 | Socket Head Cap Screw | ISO 4762 / DIN 912 | M3 – M30 |
| 2 | Hex Bolt, partial-thread | ISO 4014 / DIN 931 | M3 – M30 |
| 3 | Hex Bolt, full-thread | ISO 4017 / DIN 933 | M3 – M30 |
| 4 | Hex Nut | ISO 4032 / DIN 934 | M3 – M30 |
| 5 | Plain Washer | ISO 7089 / DIN 125 | M3 – M30 |
| 6 | Spring Lock Washer | ISO 7090 / DIN 127 | M3 – M30 |
| 7 | SHCS, UNC/UNF | ASME B18.3 | #4 – 1" |
| 8 | Hex Cap Screw, UNC/UNF | ASME B18.2.1 | 1/4" – 2" |
| 9 | W-shape rolled beam | AISC ASD 14th ed. | W4×13 → W40×593 |
| 10 | Angles (equal + unequal) | AISC | L3×3 → L8×8 |
| 11 | HSS rectangular | AISC | HSS3×3 → HSS20×20 |
| 12 | Bearings (deep-groove + tapered roller) | SKF 60xx + 322xx | full series |

Plus C3 sub-item: **ISO 273 clearance-hole bore generator** (close / medium / coarse) auto-sized for any catalog screw.

### 3.2 Out of scope (deferred SP-1 sessions 2+)

DIN 1025 IPE/HEA/HEB; ISO 657 angles; ASME B18.21.1/B18.22.1 imperial washers; spherical / cylindrical / angular-contact / thrust / needle bearings; O-rings; gaskets; retaining rings; springs; belts/pulleys/sprockets/chains; linear motion; extrusions; pneumatics/hydraulics.

## 4. Architecture

### 4.1 Module layout — `frontend/src/kernel/atomic/standards/`

| Module | Responsibility |
|---|---|
| `data/iso.js` | Pure-data tables: ISO 4762/4014/4017/4032/7089/7090 per-size dimensions (head dia, head height, hex flat, washer OD/ID/thickness, thread pitch, minor dia), grade properties. |
| `data/asme.js` | ASME B18.2.1 / B18.3 imperial tables. UNC/UNF pitch tables. |
| `data/aisc.js` | AISC W-shape, L-shape, HSS section properties (d, bf, tw, tf, A, Ix, Iy, Sx, Sy, etc.). |
| `data/skf.js` | SKF deep-groove + tapered roller bearing catalog (bore, OD, width, dynamic load rating C, static C₀, ball/roller count, contact angle). |
| `builders/Fastener.js` | `placeSHCS(part, opts)`, `placeHexBolt(part, opts)`, `placeNut(part, opts)`, `placeWasher(part, opts)`, `placeLockWasher(part, opts)` — each runs the real atomic sequence on `part`. |
| `builders/StructuralSection.js` | `placeWShape(part, opts)`, `placeAngle(part, opts)`, `placeHSS(part, opts)` — sketch the section profile + extrude along length. |
| `builders/Bearing.js` | `placeDeepGrooveBearing(part, opts)`, `placeTaperedRollerBearing(part, opts)` — revolve race profiles + sphere/cone roller instances. |
| `builders/ClearanceHole.js` | `cutClearanceHole(part, opts)` — ISO 273 close/medium/coarse bore on existing face. |
| `index.js` | Re-exports + `STANDARDS_CATALOG` index for the dialog browser. |

### 4.2 UI layout — `frontend/src/components/StandardsLibraryDialog.jsx`

Browser-style modal:
- Left pane: collapsible category tree (Fasteners → SHCS / Hex Bolt / Nut / Washer / Lock Washer; Steel Sections → W-Shape / Angle / HSS; Bearings → Deep-Groove / Tapered).
- Right pane: size table for selected category, with selector chips for grade + length.
- Bottom: "Place at origin" / "Place at cursor" / "Cancel" buttons.

### 4.3 Ribbon wiring

Add new ribbon group `Standards` in the existing `part` tab of `RibbonToolbar.jsx`. Two buttons:
- `Standards Library` — opens the dialog, places one part.
- `Pattern Standards` — applies linear/circular pattern to the most-recently-placed standard part.

ToolExecutionEngine maps `Standards Library` → opens dialog → on "Place" creates a new `Part`, runs the builder on it, registers the body in `BodyRegistry`, adds to viewport. Maps `Pattern Standards` → invokes `circularPattern` / `linearPattern` atomic ops on the seed part.

## 5. Atomic-CAD compliance + data flow

```
Ribbon click "Standards Library"
   │
   ▼
StandardsLibraryDialog (category + size + length + grade)
   │   click "Place at origin"
   ▼
ToolExecutionEngine.executeTool('Standards Library', opts)
   │
   ▼
const part = createPart(`${std} ${size}×${len}`)
builder(part, opts):
   await startSketch(part, 'XY')
   sketchCircle(part, 0, 0, shankR)
   finishSketch(part)
   await extrude(part, length)
   await startSketch(part, 'top')
   sketchPolygon(part, 0, 0, headAcrossFlatsR, 6)   // hexagon
   finishSketch(part)
   await extrude(part, headHeight)
   // Records 7+ features on `part`
   ▼
BodyRegistry.register(part)  →  viewport.scene.add(mesh)  →  FeatureTreePanel shows history
```

The user can open the placed bolt's history in `FeatureTreePanel` and see `1. startSketch → 2. sketchCircle → 3. finishSketch → 4. extrude → 5. startSketch(top) → 6. sketchPolygon → 7. finishSketch → 8. extrude` — replayable, editable, no fixture import.

`Pattern Standards` records ONE additional feature (`circularPattern(seed=part_id, count=32, axis=[0,0,1])`) on a parent assembly Part — 32 visible bodies for one feature.

## 6. Octaweb machinery composition

Star-of-9 layout, central engine + 8 outer at radius 1.2 m. Build order (which becomes the e2e script):

1. **Thrust dome.** New Part → sketchCircle(Ø3700 mm) → extrude(6) → fillet edges. 1 body.
2. **Central engine mount cone.** New Part → sketchCircle on top face → revolve (cone profile). 1 body.
3. **8 outer engine mount cones.** Single seed → `circularPattern(count=8, axis=Z)`. 8 bodies, 1 pattern feature.
4. **8 cross-bracing struts.** AISC W6×12 equivalent — sketch W-section profile, extrude 1.5 m, place at 22.5° rotated copy. `circularPattern(count=8)`. 8 bodies, 1 pattern feature.
5. **Engine mount bolt circle (per engine).** Seed: ISO 4014 M16×65 grade 12.9 via builders. `circularPattern(count=32, axis=Z, radius=320 mm)` for the 32-bolt mount. Repeated 9 times via outer `circularPattern(count=9, axis=Z)`. 288 bolts, 2 pattern features.
6. **Engine mount washers + lock washers + nuts.** Same pattern, stacked Z-offsets. 288 × 3 = 864 small bodies via 6 pattern features.
7. **Plumbing flange SHCS.** ASME B18.3 1/2"-13 UNC × 1.5", 16 per flange × 9. Two-level `circularPattern`. 144 bodies, 2 pattern features.
8. **Strut attachment SHCS.** ISO 4762 M12×40 grade 10.9, 8 per strut × 8. 64 bodies, 2 pattern features.
9. **Gimbal bearings.** SKF 32310 tapered roller × 2 per engine × 9 = 18. `circularPattern(count=9)`. 18 bodies, 1 pattern feature.
10. **Accessory pulley bearings.** SKF 6310 deep-groove × 9. 1 pattern feature.
11. **Strut-to-dome plates.** L3×3 angles, 16 placed via 8-fold circular pattern.
12. **Lateral stiffeners.** L4×4, 24 placed via 12-fold circular pattern.

Final count: **~1170 instances, ~30 unique part variants, ~600 distinct rigid bodies, ~250 features in the assembly Part tree.**

## 7. E2e contract — `e2e/sp1-falcon9-octaweb-electron.spec.js`

- Launches the **packaged Electron app** via `_electron.launch({ args: ['electron/main.js'] })` per the existing `*-electron.spec.js` convention.
- Headed, slowMo configured so the user can watch.
- Empty viewport → builds the entire octaweb via real ribbon clicks (`dispatchEvent('click')` where scroll containers intercept) and dialog field fills.
- Records **slow-mo MJPEG video** + key-frame stills at each major step per `feedback_e2e_in_motion`.
- **One perfectly-viewable final framing** per `feedback_perfectly_viewable_framing` — whole octaweb fits, no crop, no zoom-fiddle variations.
- Asserts at each step: BodyRegistry count grows by expected amount; FeatureTreePanel feature count grows; no console errors; no `pageerror`s.
- Final assertion: ≥1000 visible instances; ≥30 unique part-variant names in BOM CSV; assembly volume / centre-of-mass within published Falcon 9 octaweb tolerances; renders a final JPEG snapshot via `captureSnapshot` into `e2e/screenshots/sp1-falcon9-octaweb-final.jpg`.
- No `Math.random` anywhere in the spec or the builders. All positions derived from the published octaweb geometry.

## 8. Error handling

- Builder throws on unknown size, mismatched grade, length < min-shank — caught in ToolExecutionEngine, surfaced as a toast.
- Dialog blocks "Place" until size + length valid.
- AtomicOps throws (already-open sketch, missing pendingProfile) bubble up and abort the placement; partial features are NOT recorded on the part.
- e2e fails loudly if any tool returns no body, if BodyRegistry doesn't grow, or if any pattern feature produces wrong count.

## 9. Risks

| Risk | Mitigation |
|---|---|
| AtomicOps doesn't yet have `sketchPolygon`, `extrudeCut`, `revolve`, `circularPattern`, `linearPattern` as exported names matching builder needs | Verify imports in `WorkbenchMechanical.jsx` already include `cut, revolve, circularPattern, linearPattern` — they do. `sketchPolygon` may need adding (atomic op gap). |
| Manifold heap exhaustion on ~1170 bodies | Existing fix from GE9X experience (.delete() on intermediates) applies; pattern ops already use InstancedMesh at scale. |
| Build time for the e2e | Aim ≤ 8 minutes total (matches GE9X-orchestration spec budget). |
| Atomic builder records too many features → tree bloat | Bundle multi-step builder construction under a single composite feature `placeStandard(std, size, length, position)` that internally explodes to atomic steps but presents as one feature in the panel. |

## 10. Definition of done

- All 12 catalogs in `kernel/atomic/standards/data/` + index.
- All 5+3+2+1 = 11 builders in `kernel/atomic/standards/builders/` recording features into Parts.
- Standards Library dialog + Pattern Standards tool in the ribbon, wired through ToolExecutionEngine.
- One green headed Electron spec `sp1-falcon9-octaweb-electron.spec.js` that builds the full octaweb from empty viewport, asserts ~1170 instances + ~30 unique variants + final-framing JPEG.
- All existing e2e specs still pass (no regression).
- Spec self-review clean; user reviews + approves spec.
- Memory entries created/updated as needed.
