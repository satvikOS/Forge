/**
 * ArchDisc Topology Spine — Persistent Attribute System
 *
 * SP-2. The kernel-grade attribute system that mirrors ACIS `ATTRIB` (line 312
 * of `docs/ARCHDISC_VISION_AND_ROADMAP.md`) and Parasolid PK_ATTRIB:
 *
 *   "Attributes are persistent objects attached to a topological ENTITY.
 *    The kernel propagates them through every boolean, feature, blend, local
 *    op and transform. User-defined attributes (face colour, material, finish)
 *    co-exist with system attributes (originalEdgeId, op-set provenance)."
 *
 * Without an attribute system, the spine's persistent IDs (SP-1 §2.3) are just
 * numbers — they survive booleans, but a user-meaningful FACT about a face
 * (this face is mirror-polished; this edge is welded; this bore tolerance is
 * H7) cannot follow the geometry through a fillet or boolean. SP-2 closes that:
 * the kernel guarantees that an attribute attached to a face BEFORE a boolean
 * is reachable on the survivor face(s) AFTER the boolean, by piggy-backing on
 * `IdLineage.carryLineage`.
 *
 * ── The data shape ──────────────────────────────────────────────────────────
 *
 * Each spine entity carries `entity.attributes` — a plain object keyed by
 * `attribute.key`. Each value is an Attribute record:
 *
 *   {
 *     key:        'finish' | 'material' | 'originalEdgeId' | …,
 *     value:      any                — the user's payload (string/number/JSON),
 *     namespace:  'user' | 'system.lineage' | 'system.color' | …,
 *     isSystem:   boolean             — true ⇔ namespace starts with 'system.',
 *     survives:   'verbatim'          — carried unchanged on every op (transforms,
 *                                       single-survivor lineage). Conflict on a
 *                                       merge → throws (deterministic error).
 *                 | 'lineage'         — carried via IdLineage's derivedFrom:
 *                                       every survivor of a split inherits it;
 *                                       on a merge, the FIRST input's value
 *                                       wins (deterministic, first-input rule)
 *                                       and the other inputs land in
 *                                       `derivedFrom` for provenance.
 *                 | 'union'           — set-union semantics for *array* values.
 *                                       On a merge both inputs' arrays
 *                                       concatenate (deduplicated by JSON eq).
 *                                       On a split, every survivor gets the
 *                                       full union.
 *     derivedFrom: string[]           — persistent IDs of source entities this
 *                                       attribute was carried from (provenance).
 *   }
 *
 * ── Survival semantics ──────────────────────────────────────────────────────
 *
 *   verbatim — for user-tagged FINISH/MATERIAL/COLOUR per face. If the engine
 *              splits a face into N survivors, every survivor inherits the
 *              attribute *verbatim* (the finish of the original face becomes the
 *              finish of each fragment — same value, no merging). If a merge
 *              collides two different values on one survivor, that's an error:
 *              two different finishes cannot reduce to one. Throws
 *              `AttributeConflictError`.
 *
 *   lineage  — for system provenance (originalEdgeId, opSet history). Carried
 *              via `derivedFrom`: when one input is split into N survivors,
 *              every survivor's `derivedFrom` records the input id. When two
 *              inputs merge to one survivor, the FIRST input's value wins
 *              (deterministic, first-input rule) and the other inputs are
 *              recorded in `derivedFrom`.
 *
 *   union    — for additive sets (tag lists, e.g. `tags: ['critical', 'inspected']`).
 *              The value must be an Array. On a merge, the arrays concatenate
 *              (deduplicated by JSON-equality). On a split, each survivor gets
 *              the full union. Empty arrays are allowed; the result is empty.
 *
 * ── Conflict resolution — deterministic ─────────────────────────────────────
 *
 * Same input order → same output every run:
 *   - verbatim collision on a merge → throws `AttributeConflictError` with the
 *     attribute key, both values and both source entity IDs. The error is
 *     CAUGHT by carryLineage and recorded on `body.diagnostics.attributes` —
 *     the body is still bound, but the attribute conflict is loud.
 *   - lineage merge → first input wins; subsequent inputs land in derivedFrom.
 *     report.conflicts++. No throw.
 *   - union merge → arrays concatenate deduplicated; never throws.
 *
 * ── Edge cases handled ──────────────────────────────────────────────────────
 *
 *   - missing source entity (an input id has no entity in the spine) — silent
 *     no-op, NOT an error (some ops legitimately drop entities).
 *   - the result entity already has its own attribute under the same key with
 *     IDENTICAL value — no-op (already there).
 *   - the result entity already has its own attribute under the same key but
 *     a DIFFERENT value AND the incoming policy is `verbatim` — conflict
 *     (throws).
 *   - empty `inputBodies` — every result attribute is identity (nothing to
 *     carry); used by `bindSpine` on a fresh body.
 *   - union with non-Array values — coerced to `[value]` for that attribute
 *     specifically (defensive, documented).
 *
 * ── Why the data lives on the entity, not a side-map ────────────────────────
 *
 * The spine entity is the truth — every op already manipulates `face.attributes`
 * through `attachAttribute`, `getAttribute`, etc. The serialisation (toInspectorJSON
 * already exposes `attributesKeys`) survives because each Attribute record is a
 * plain JSON object. The alternative — a side-map keyed by entity — would be a
 * second source of truth that drifts on dispose/re-bind. The on-entity store
 * is the same pattern ACIS uses (ATTRIB chains on each ENTITY).
 */

export const ATTRIBUTE_NAMESPACES = Object.freeze({
  USER:                  'user',
  SYSTEM_LINEAGE:        'system.lineage',
  SYSTEM_COLOR:          'system.color',
  SYSTEM_PROVENANCE:     'system.provenance',
});

export const SURVIVAL_POLICIES = Object.freeze(['verbatim', 'lineage', 'union']);

/**
 * Custom error type thrown when a `verbatim` attribute would collide on a
 * merge with a different value. Caught by carryLineage so it never crashes
 * a body bind; recorded on `body.diagnostics.attributes`.
 */
export class AttributeConflictError extends Error {
  constructor(key, existingValue, incomingValue, opts = {}) {
    super(
      `AttributeConflictError: key '${key}' has incompatible 'verbatim' ` +
      `values on a merge — existing=${JSON.stringify(existingValue)} ` +
      `incoming=${JSON.stringify(incomingValue)}.`);
    this.name = 'AttributeConflictError';
    this.key = key;
    this.existingValue = existingValue;
    this.incomingValue = incomingValue;
    this.sourceId = opts.sourceId || null;
    this.targetEntity = opts.targetEntity || null;
  }
}

/**
 * Attach an attribute to a spine entity.
 *
 * @param {object} entity   Body / Lump / Shell / Face / Loop / Coedge / Edge /
 *                          Vertex — anything with an `attributes` slot.
 * @param {string} key      e.g. 'finish' / 'material' / 'originalEdgeId'.
 * @param {*} value         arbitrary serialisable value.
 * @param {object} [opts]
 * @param {string}  [opts.namespace='user']  ATTRIBUTE_NAMESPACES.USER by default.
 * @param {'verbatim'|'lineage'|'union'} [opts.survives='verbatim']
 *                         the survival policy through ops.
 * @param {string[]} [opts.derivedFrom=[]]  initial provenance (rare — usually
 *                         populated by the survival machinery, not by the user).
 * @returns {object} the attribute record now stored on `entity.attributes[key]`.
 * @throws if `entity` has no `attributes` slot, key is empty, or policy is
 *         not one of the three.
 */
export function attachAttribute(entity, key, value, opts = {}) {
  if (!entity) throw new Error('attachAttribute: entity is required');
  if (!entity.attributes || typeof entity.attributes !== 'object') {
    throw new Error('attachAttribute: entity has no .attributes slot ' +
      '(must be a spine entity — Body/Lump/Shell/Face/Loop/Coedge/Edge/Vertex)');
  }
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('attachAttribute: key must be a non-empty string');
  }
  const namespace = opts.namespace || ATTRIBUTE_NAMESPACES.USER;
  const survives = opts.survives || 'verbatim';
  if (!SURVIVAL_POLICIES.includes(survives)) {
    throw new Error(
      `attachAttribute: invalid survives='${survives}', must be one of ` +
      JSON.stringify(SURVIVAL_POLICIES));
  }
  const record = {
    key,
    value,
    namespace,
    isSystem: namespace.startsWith('system.'),
    survives,
    derivedFrom: Array.isArray(opts.derivedFrom) ? opts.derivedFrom.slice() : [],
  };
  entity.attributes[key] = record;
  return record;
}

/**
 * Read an attribute from a spine entity.
 * @param {object} entity
 * @param {string} key
 * @param {object} [opts]
 * @param {string} [opts.namespace]  if provided, only return the record if
 *        its namespace matches (so 'user' and 'system.lineage' with the same
 *        key can coexist if the caller wants — currently keys are unique
 *        across namespaces, so this is mostly defensive).
 * @returns {object|null}  the attribute record, or null if absent.
 */
export function getAttribute(entity, key, opts = {}) {
  if (!entity || !entity.attributes) return null;
  const rec = entity.attributes[key] || null;
  if (!rec) return null;
  if (opts.namespace && rec.namespace !== opts.namespace) return null;
  return rec;
}

/**
 * Read the value alone (sugar over getAttribute).
 * @param {object} entity
 * @param {string} key
 * @returns {*}  the value, or undefined if the attribute is absent.
 */
export function getAttributeValue(entity, key) {
  const rec = getAttribute(entity, key);
  return rec ? rec.value : undefined;
}

/**
 * Delete an attribute. Returns true if it existed, false otherwise.
 */
export function removeAttribute(entity, key) {
  if (!entity || !entity.attributes) return false;
  if (!(key in entity.attributes)) return false;
  delete entity.attributes[key];
  return true;
}

/**
 * Iterate the attributes on an entity. Returns an array of records (copies are
 * NOT made — mutating the records affects the entity's storage).
 * @returns {object[]}
 */
export function listAttributes(entity) {
  if (!entity || !entity.attributes) return [];
  return Object.values(entity.attributes);
}

/**
 * Check whether an entity carries any attribute under `key`.
 */
export function hasAttribute(entity, key) {
  return !!(entity && entity.attributes && entity.attributes[key]);
}

// ──────────────────────────────────────────────────────────────────────────────
// Survival machinery — invoked by IdLineage.carryLineage when a result entity
// inherits a persistent ID from a source entity.
//
// The lineage layer says "this result entity descends from these source
// entities" via two channels: (a) the explicit `applyLineage` call for the
// first-input survivor, and (b) the `derivedFrom` array on the result entity
// that records every additional input contributing to the same result.
//
// `propagateAttributes` handles BOTH channels:
//   - the primary survivor branch (one source claims the result): pulls every
//     attribute from `source.attributes` onto `result.attributes`, applying
//     each policy's merge rule.
//   - the additional-source branch (subsequent sources merge in): same — pulls
//     every attribute from the new source, applying each policy. verbatim
//     collisions throw; lineage merges add to derivedFrom (and conflicts++);
//     union merges concatenate arrays.
//
// The `report` argument is the same lineage report carryLineage builds; we
// piggy-back attribute conflict/copy counts so the e2e can assert them.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Propagate every attribute from `source` onto `target`, applying each
 * record's survival policy. Mutates `target.attributes` in place.
 *
 * @param {object} target       result spine entity (the survivor).
 * @param {object} source       input spine entity (the predecessor).
 * @param {object} [report]     optional lineage report — receives `attributesCarried`
 *                              count and `attributeConflicts` entries.
 * @returns {{copied:number,conflicts:number,errors:object[]}}
 */
export function propagateAttributes(target, source, report = null) {
  const result = { copied: 0, conflicts: 0, errors: [] };
  if (!target || !source) return result;
  if (!target.attributes || !source.attributes) return result;
  for (const srcRec of Object.values(source.attributes)) {
    try {
      const before = target.attributes[srcRec.key];
      const after = mergeAttribute(target, before, srcRec, source);
      if (after) {
        target.attributes[srcRec.key] = after;
        if (!before || !shallowEqualValue(before.value, after.value)) {
          result.copied += 1;
        }
      }
    } catch (e) {
      if (e instanceof AttributeConflictError) {
        result.conflicts += 1;
        result.errors.push({
          key: srcRec.key,
          existing: e.existingValue,
          incoming: e.incomingValue,
          sourceId: source.persistentId || null,
          targetId: target.persistentId || null,
          message: e.message,
        });
      } else {
        throw e;
      }
    }
  }
  if (report) {
    report.attributesCarried = (report.attributesCarried || 0) + result.copied;
    report.attributeConflicts = (report.attributeConflicts || 0) + result.conflicts;
    if (result.errors.length > 0) {
      report.attributeErrors = (report.attributeErrors || []).concat(result.errors);
    }
  }
  return result;
}

/**
 * Compute the merged attribute record (existing vs incoming-from-source).
 * Pure function — does not mutate. Returns the record to store, or null to
 * leave the target unchanged. Throws AttributeConflictError for verbatim
 * collisions with non-equal values.
 */
export function mergeAttribute(targetEntity, existing, incoming, sourceEntity) {
  if (!incoming) return null;
  const sourceId = sourceEntity ? (sourceEntity.persistentId || null) : null;

  // First time on this entity — just copy with the source recorded in derivedFrom.
  if (!existing) {
    const derived = incoming.derivedFrom ? incoming.derivedFrom.slice() : [];
    if (sourceId && !derived.includes(sourceId)) derived.push(sourceId);
    return {
      key: incoming.key,
      value: cloneValue(incoming.value),
      namespace: incoming.namespace,
      isSystem: !!incoming.isSystem,
      survives: incoming.survives,
      derivedFrom: derived,
    };
  }

  // Same key already present — policy-driven merge.
  switch (existing.survives) {
    case 'verbatim': {
      if (shallowEqualValue(existing.value, incoming.value)) {
        // identical — append source provenance, no value change.
        const out = { ...existing, derivedFrom: existing.derivedFrom.slice() };
        if (sourceId && !out.derivedFrom.includes(sourceId)) {
          out.derivedFrom.push(sourceId);
        }
        return out;
      }
      // verbatim collision — deterministic error.
      throw new AttributeConflictError(existing.key, existing.value, incoming.value, {
        sourceId, targetEntity,
      });
    }
    case 'lineage': {
      // First-input wins: existing value stays. Append source to derivedFrom
      // for provenance.
      const out = { ...existing, derivedFrom: existing.derivedFrom.slice() };
      if (sourceId && !out.derivedFrom.includes(sourceId)) {
        out.derivedFrom.push(sourceId);
      }
      return out;
    }
    case 'union': {
      const existingArr = toArray(existing.value);
      const incomingArr = toArray(incoming.value);
      const merged = unionByJson(existingArr, incomingArr);
      const out = {
        ...existing,
        value: merged,
        derivedFrom: existing.derivedFrom.slice(),
      };
      if (sourceId && !out.derivedFrom.includes(sourceId)) {
        out.derivedFrom.push(sourceId);
      }
      return out;
    }
    default: {
      // Unknown policy — preserve existing, warn via the report later.
      return existing;
    }
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function cloneValue(v) {
  if (v === null || v === undefined) return v;
  if (typeof v !== 'object') return v;
  try { return JSON.parse(JSON.stringify(v)); } catch { return v; }
}

function shallowEqualValue(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

function toArray(v) {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null) return [];
  return [v];
}

function unionByJson(a, b) {
  const seen = new Set();
  const out = [];
  for (const x of [...a, ...b]) {
    let key;
    try { key = JSON.stringify(x); }
    catch { key = String(x); }
    if (!seen.has(key)) { seen.add(key); out.push(cloneValue(x)); }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────────
// Snapshot — capture every attribute on every entity of a body into a plain
// object keyed by persistent ID. Used by `bindSpine` preservation (SP-2 §3) so
// when an op rebinds a result OCCT shape into a new spine Body, the attribute
// payload on the source spine entities can be REATTACHED onto the result spine
// entities via the carryLineage Modified/Generated mapping.
//
// The snapshot is acyclic (records are plain JSON), so it survives any
// serialiser, and is keyed by persistent ID so the carryLineage faceMap /
// edgeMap / vertexMap can look up the source payload after the rebind.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build an attribute snapshot from a body. The snapshot maps persistent ID →
 * { entityKind, attributes }. Body-level attributes are stored under the body's
 * persistent ID.
 *
 * @param {object} body  a spine Body.
 * @returns {Map<string, {entityKind:string, attributes:object}>}
 */
export function snapshotAttributes(body) {
  const out = new Map();
  if (!body) return out;
  if (body.persistentId && body.attributes && Object.keys(body.attributes).length > 0) {
    out.set(body.persistentId, { entityKind: 'body', attributes: clone(body.attributes) });
  }
  for (const lump of body.lumps || []) {
    if (lump.persistentId && lump.attributes && Object.keys(lump.attributes).length > 0) {
      out.set(lump.persistentId, { entityKind: 'lump', attributes: clone(lump.attributes) });
    }
  }
  for (const shell of body.shells()) {
    if (shell.persistentId && shell.attributes && Object.keys(shell.attributes).length > 0) {
      out.set(shell.persistentId, { entityKind: 'shell', attributes: clone(shell.attributes) });
    }
  }
  for (const face of body.faces()) {
    if (face.persistentId && face.attributes && Object.keys(face.attributes).length > 0) {
      out.set(face.persistentId, { entityKind: 'face', attributes: clone(face.attributes) });
    }
  }
  for (const loop of body.loops()) {
    if (loop.persistentId && loop.attributes && Object.keys(loop.attributes).length > 0) {
      out.set(loop.persistentId, { entityKind: 'loop', attributes: clone(loop.attributes) });
    }
  }
  for (const coedge of body.coedges()) {
    if (coedge.persistentId && coedge.attributes && Object.keys(coedge.attributes).length > 0) {
      out.set(coedge.persistentId, { entityKind: 'coedge', attributes: clone(coedge.attributes) });
    }
  }
  for (const edge of body.edges()) {
    if (edge.persistentId && edge.attributes && Object.keys(edge.attributes).length > 0) {
      out.set(edge.persistentId, { entityKind: 'edge', attributes: clone(edge.attributes) });
    }
  }
  for (const v of body.vertices()) {
    if (v.persistentId && v.attributes && Object.keys(v.attributes).length > 0) {
      out.set(v.persistentId, { entityKind: 'vertex', attributes: clone(v.attributes) });
    }
  }
  return out;
}

function clone(o) {
  try { return JSON.parse(JSON.stringify(o)); } catch { return { ...o }; }
}

/**
 * Build a flat list of (persistentId, attributeRecord) tuples from a body, for
 * inspection / debugging and for the IdLineage attribute-survival path.
 * @returns {Array<{entityId:string, entityKind:string, attribute:object}>}
 */
export function listAllAttributes(body) {
  const flat = [];
  const snap = snapshotAttributes(body);
  for (const [id, payload] of snap) {
    for (const attr of Object.values(payload.attributes)) {
      flat.push({ entityId: id, entityKind: payload.entityKind, attribute: attr });
    }
  }
  return flat;
}

/**
 * Build an accessor object that exposes a read-only iteration API on an
 * entity's attributes. This is the `.attributes` accessor used by callers
 * that prefer a small API surface over poking the raw `attributes` object.
 * Writes still go through `attachAttribute`/`removeAttribute` so the survival
 * policy is honoured.
 *
 * Currently a thin wrapper — the entities' `.attributes` field IS the storage,
 * and this accessor is purely a documented read surface. We export it so
 * downstream code (Inspector UI, AI agent introspection) has a stable shape
 * to consume.
 */
export function attributeAccessor(entity) {
  return {
    keys() { return entity && entity.attributes ? Object.keys(entity.attributes) : []; },
    list() { return listAttributes(entity); },
    get(key) { return getAttribute(entity, key); },
    value(key) { return getAttributeValue(entity, key); },
    has(key) { return hasAttribute(entity, key); },
    namespaces() {
      const ns = new Set();
      for (const rec of listAttributes(entity)) ns.add(rec.namespace);
      return [...ns];
    },
    [Symbol.iterator]() { return listAttributes(entity)[Symbol.iterator](); },
  };
}
