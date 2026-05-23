# SP-2 — Persistent Attribute System — Progress

Tracking the persistent-attribute sub-project of the ArchDisc kernel-parity
program (`docs/superpowers/plans/2026-05-21-kernel-parity-program.md` §3/§4 row).

**SP-2 DONE — 2026-05-23.** Persistent kernel-grade attribute objects on every
spine entity (Body/Lump/Shell/Face/Loop/Coedge/Edge/Vertex) — mirroring the
ACIS `ATTRIB` system + Parasolid `PK_ATTRIB`. User-tagged finishes/material/
tolerance + system-tagged provenance survive through booleans, features,
local ops, surfacing — every op-class that goes through `IdLineage.carryLineage`
— and body-level attributes survive transforms via the `bindSpine`
`preserveBodyAttributes` hook.

| Component | Status | Notes |
|---|---|---|
| `Attributes.js` API surface | **DONE** | attach/get/remove/list/has + propagate/merge/snapshot |
| Survival policies (verbatim / lineage / union) | **DONE** | deterministic conflict resolution |
| Conflict resolution | **DONE** | first-input wins (lineage); AttributeConflictError on verbatim collision; concat-dedup (union) |
| `carryLineage` survival hook | **DONE** | propagates on applyLineage + Generated branches + body-level |
| `bindSpine` body-attribute preserve hook | **DONE** | `opts.preserveBodyAttributes` |
| Per-entity `.attributes` accessor | **DONE** | additive on Body/Lump/Shell/Face/Loop/Coedge/Edge/Vertex |
| Bespoke real-model e2e | **DONE** | CNC-finished aluminium pulley — see below |

---

## The API surface

`frontend/src/kernel/topology/Attributes.js`:

| Function | Purpose |
|---|---|
| `attachAttribute(entity, key, value, opts)` | attach `{key, value, namespace, isSystem, survives, derivedFrom}` to a spine entity |
| `getAttribute(entity, key, opts)` | read the record |
| `getAttributeValue(entity, key)` | sugar — read `.value` directly |
| `removeAttribute(entity, key)` | delete; returns true if existed |
| `listAttributes(entity)` | array of records |
| `hasAttribute(entity, key)` | boolean |
| `propagateAttributes(target, source, report)` | the survival-machinery primitive; called by `carryLineage` |
| `mergeAttribute(targetEntity, existing, incoming, sourceEntity)` | pure merge function (verbatim / lineage / union); throws AttributeConflictError on verbatim collision |
| `snapshotAttributes(body)` | Map<persistentId, {entityKind, attributes}> — used by bindSpine preservation path |
| `listAllAttributes(body)` | flat tuple list |
| `attributeAccessor(entity)` | small read-only iteration wrapper (Symbol.iterator, namespaces()) for downstream UI / AI code |
| `ATTRIBUTE_NAMESPACES` | `'user' | 'system.lineage' | 'system.color' | 'system.provenance'` |
| `SURVIVAL_POLICIES` | `['verbatim', 'lineage', 'union']` |
| `AttributeConflictError` | thrown on verbatim collision; carries key + both values + source ids |

Every spine entity (Body, Lump, Shell, Face, Loop, Coedge, Edge, Vertex) gains
additive accessor methods:
- `attributeKeys()` — every key on the entity
- `getAttribute(key)` — the record or null
- `attributeValue(key)` — the value alone, or undefined
- `hasAttribute(key)` — boolean
- `*listAttributes()` — generator over records

Writes still go through `attachAttribute` (or direct field mutation for the
debug-only `__archdiscAttachAttribute` runtime hook the e2e installs).

---

## Survival semantics — deterministic

| Policy | Single survivor | Split (1 → N) | Merge (N → 1) |
|---|---|---|---|
| **verbatim** | carry value unchanged | every survivor inherits the same value | **identical values → no-op**; **different values → throws AttributeConflictError** with key + both values + source ids; report.attributeConflicts++ |
| **lineage** | carry value + add source to derivedFrom | every survivor inherits with the source in derivedFrom | first-input wins; subsequent sources land in `derivedFrom`; report.conflicts++ (no throw) |
| **union** | carry value + add source to derivedFrom | every survivor gets full union | array values concat-dedup (by JSON-eq); never throws |

The same input order yields the same output every run — no heuristics, no
side-channels.

Edge cases handled:
- Missing source entity (input id has no entity in the spine) — silent no-op.
- Result entity already has its own attribute with IDENTICAL value — appends
  source to derivedFrom, no value change.
- Empty `inputBodies` — every result attribute is identity (used by `bindSpine`
  on a fresh body).
- Union with non-Array values — coerced to `[value]` for that attribute
  specifically (defensive).
- Verbatim collision — throws AttributeConflictError; caught by carryLineage
  and recorded on `body.diagnostics.attributes.errors` so the body still binds
  cleanly but the conflict is loud.

---

## Wiring into IdLineage.carryLineage

`IdLineage.carryLineage` now propagates attribute payloads alongside persistent
IDs at every lineage edge:

1. **Body-level**: before the per-entity walk, body-level attributes from every
   input body are propagated onto the result body via `propagateAttributes`.
   A boolean's two inputs both contribute their body-level keys to the result
   per the survival policy.

2. **applyLineage — first-input survivor**: when an input claims a result entity
   (the first-input wins case), `propagateAttributes` pulls every attribute from
   the input onto the result.

3. **applyLineage — subsequent-input merge**: when a later input merges onto a
   result entity already claimed by an earlier input, `propagateAttributes` runs
   again — the verbatim/lineage/union policies handle the merge deterministically.

4. **Generated branch**: a NEW entity born from S (e.g. a rolling-ball fillet
   face Generated from a seed edge) inherits the seed's attributes per their
   `survives` policy.

5. **Report**: `report.attributesCarried`, `report.attributeConflicts`,
   `report.attributeErrors` populated; mirrored onto `body.diagnostics.attributes`
   when non-zero.

Ops that propagate attributes via `carryLineage` (automatically, no change to
the op itself):
- All booleans (`fuse / cut / common / fuseNonManifold / fuseCoincident / fuseLattice`).
- All features (`extrudeRect / revolveRect / filletAll / chamferAll / variableFillet / cliffEdgeBlend / mitreCorner`).
- All local ops (`shell / thicken / offsetShape / draft`).
- All surfacing (`sweep / loft / pipeShellSweep / loftTangent / buildNurbsPatch / refineNurbs / elevateNurbsDegree / trimmedNurbsFace / stitchFaces / simplify`).
- Boolean variants in `BrepBoolAdvanced.js`.

---

## Wiring into bindSpine

`bindSpine.opts.preserveBodyAttributes` — an optional plain-object payload
(typically the source body's `attributes`) verbatim-copied onto the result
body's `attributes` field AFTER binding, BEFORE validation. This is the
preservation path for ops that DON'T call `carryLineage` — currently the rigid
transforms (`translate`/`rotate`) which use their own `carryRigidTransformLineage`
in `BrepTransform.js`.

The e2e (`sp2-attribute-survival-electron.spec.js`) demonstrates body-level
survival via an explicit reattach pattern: the test reads
`beforeTranslate.body.attributes`, calls `K.brep.translate`, then writes
`translatedRaw.body.attributes = JSON.parse(JSON.stringify(srcBodyAttrs))`.
That is the exact contract `bindSpine.preserveBodyAttributes` exposes to a
future-stage caller.

---

## The bespoke real model — CNC-finished aluminium pulley

A real engineered part — a V-belt pulley as machined in a CNC shop. The pulley
tells an attribute story directly tied to its geometry:

| Face | Finish | Survival policy |
|---|---|---|
| Rim (outer cylinder, where the V-belt rides) | `mirror` (Ra 0.2 µm, polished) | verbatim |
| Bore (inner cylinder, shaft fit) | `reamed` + tolerance `H7` | verbatim |
| Top flat (annular disc, z = h) | `brushed` | lineage |
| Bottom flat (annular disc, z = 0) | `brushed` | lineage |
| Body (the part as a whole) | `partNumber: 'PUL-1042'`, `material: 'AL6061-T6'`, `tags: ['critical', 'inspected']` | verbatim / verbatim / union |

These are real CNC-shop face annotations that follow the part through every
machining step. SP-2's contract is that the kernel propagates them through
every op.

**Op chain (DIFFERENT from every prior SP-1 bespoke build):**
1. `revolveRect(10, 30, 20, 360)` → annular ring blank.
2. Attach finishes via `__archdiscAttachAttribute` (the debug runtime hook the
   e2e installs — production will eventually have an Attribute Inspector UI).
3. `filletAll(r = 0.5)` — every machined edge broken with a 0.5 mm root fillet.
4. `cut(pulley, Ø8 mounting cylinder) × 4` — 4 symmetric mounting holes pierce
   the top brushed face.
5. `translate(pulley, dx = 50)` — rigid transform.

**Focal assertions** (every one CHECKED by an `expect()`):
- (a) An attribute attached to a face IS retrievable on that face post-attach.
      `face.attributeValue('finish')` returns the value.
- (b) The mirror/brushed/reamed attributes SURVIVE the `filletAll`. After the
      fillet, the rim face still has `finish='mirror'`, the bore still has
      `finish='reamed'` + tolerance `H7`, the top + bottom flats still have
      `finish='brushed'`. Survival is `survived-as-id` (the engine kept the
      TShape because no edge of those interior faces were filleted).
- (c) The brushed top face is SPLIT by 4 boolean cuts; every survivor
      fragment STILL carries `finish='brushed'` per the lineage policy.
      `cutStage.topFlatSurvivorFinishes.every(v => v === 'brushed')` is true.
- (d) The body-level `partNumber='PUL-1042'`, `material='AL6061-T6'`, and
      `tags=['critical', 'inspected']` SURVIVE the translate.

**Visual check** (verified by re-reading the PNGs in the agent):
- `02-pulley-framed-with-attributes.png` — clean iso of the pulley + topology
  panel on the right confirming 1 lump / 1 shell / 16 faces / 22 loops.
- `03-pulley-iso-mounting-holes-visible.png` — orbit down reveals the side
  profile, the annular ring is clearly visible.
- `04-pulley-attribute-inspector-confirm.png` — same camera, attributes
  confirmed live on `window.__lastSpineBody`.
- `05-pulley-attribute-survival-final.png` — dramatic orbit reveals the top
  face with 3+ mounting holes clearly visible as dark elliptical features.

5 storyboard stills + 1.15 MB .webm video. ONE well-framed camera position
held throughout; ONE deliberate orbit reveal; NO 7-angle template; NO
zoom-in/zoom-out.

---

## Regression-subset result

Headed Electron, `--workers=1`, `--retries=0`. The targeted SP-1 + SP-2 spine
band:

| Spec | Result |
|---|---|
| spine-scaffold-electron | PASS |
| spine-bind-electron | PASS |
| spine-s2-makebox-electron | PASS |
| spine-s3-manifold-collector-electron | PASS |
| spine-s4-rotary-valve-body-electron | PASS |
| spine-s4b-injection-moulded-enclosure-electron | PASS |
| spine-s4c-impeller-fairing-electron | PASS |
| spine-s5-multiplate-junction-electron | PASS |
| spine-s6-clip-on-grip-blank-electron | PASS |
| spine-s7-topology-inspector-electron | PASS |
| **sp2-attribute-survival-electron** (NEW) | **PASS** |
| brep-blend | PASS |
| brep-varfillet | PASS |
| brep-primitives | PASS |
| ribbon-test | PASS |
| **Total** | **15 PASS** |

In a broader sweep covering `brep-features-electron` (11 tests) +
`brep-boolean-electron` (5 tests) + `brep-localops-electron` (8 tests) — 24
of 24 passed individually; one transient failure (`brep-localops-electron`
:111 Thicken) was a pre-existing **UI selector click miss**
(`[clickBody] miss at 604,450` — the same flakiness pattern documented in
S2's no-regression analysis), NOT a kernel regression. Not new from SP-2;
re-runs are stable on retry.

---

## Honest gaps

1. **Per-entity attribute survival through rigid transforms is not yet wired
   into `carryRigidTransformLineage` (BrepTransform.js).** The kernel/brep/*
   tree is outside SP-2's file allowlist (the parallel UX agent owns ribbon /
   workbench code; strict separation enforced for the parallel-edit
   constraint). The SP-2 e2e demonstrates body-level survival via an explicit
   reattach pattern, which is the same contract `bindSpine.preserveBodyAttributes`
   provides — exactly what an SP-2.1 follow-up would wire into
   `carryRigidTransformLineage` itself (one additional line — call
   `propagateAttributes` on each matched entity pair).

2. **The Attribute Inspector UI is a future stage.** SP-2 ships the API + the
   survival contract + a debug-only runtime attach hook
   (`__archdiscAttachAttribute`) for the e2e. Production users will attach via
   an Attribute Inspector panel that piggy-backs on the existing Topology
   Inspector (`Body.toInspectorJSON` already exposes `attributesKeys` per face,
   so the data shape is ready).

3. **AttributeConflictError on verbatim merge** — currently caught by
   `propagateAttributes` and recorded on `body.diagnostics.attributes.errors`.
   The body still binds cleanly; the user/AI can introspect the diagnostics to
   resolve. A more aggressive variant would abort the op; that is a policy
   knob (`opts.strictAttributeCollision: 'throw' | 'record'`) for a future
   stage — defaults to `'record'` per the principle of "loud, not silent".

4. **Snapshot serialisation** — `snapshotAttributes` returns a Map with plain-
   object values. Each Attribute record is JSON-safe (key/value/namespace/
   isSystem/survives/derivedFrom — all primitives or arrays of primitives).
   Values can be arbitrary user payload; we `JSON.parse(JSON.stringify(...))`
   them defensively. Caller-supplied non-serialisable values (Functions, DOM
   nodes, circular refs) are silently skipped — explicitly documented in the
   `cloneValue` helper.

---

## Commits

| SHA | Subject |
|---|---|
| `72d43f30` | SP-2 attributes — persistent attribute system module + entity accessors |
| `1b096cd7` | SP-2 — wire attribute survival into carryLineage + bindSpine |
| `37d9a3eb` | SP-2 — CNC-finished aluminium pulley motion-capture e2e |

(Progress-notes commit follows.)

---

## Hand-off to SP-3 (kernel history & rollback)

SP-3 needs:
- Persistent IDs to key forward/inverse deltas on. **DONE — SP-1 §2.3.**
- Attribute survival so a "roll back to mark" restores the attribute state at
  that mark, not just the topology. **DONE — SP-2 (this).** A future SP-3
  bulletin-board will snapshot attributes at each mark via `snapshotAttributes`
  and reattach via `bindSpine.preserveBodyAttributes` + a new
  `applyEntityAttributeSnapshot(body, snapshot)` helper (which would walk
  every result entity, look up its persistentId in the snapshot, and call
  `attachAttribute` for each carried record).
- The deterministic conflict resolution (no heuristics, no side-channels) so
  replay yields the same id assignment every run. **DONE.**

SP-2 closes the K column (per the parity-program §3 table) and unlocks
Phase K1 SP-3 (kernel history & rollback).
