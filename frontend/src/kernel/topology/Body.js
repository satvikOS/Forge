/**
 * ArchDisc Topology Spine — Body
 *
 * SP-1 Stage S0 / S5. The root of the unified spine and a NEW entity —
 * ACIS BODY, Parasolid PART. The independent model object.
 *
 * A Body:
 *   - has a `kind` ∈ {'solid','sheet','wire'} — the single body-kind
 *     discriminator (SP-1 §2.2). S5 promotes it to FIRST-CLASS: every op that
 *     produces a body declares its result kind via `declaredKind`; `assertKind`
 *     reconciles the declared kind against the topology-derived kind and
 *     records any disagreement as an explicit diagnostic (S5 §2.2 — "every op
 *     EXPLICITLY DECLARES its result kind").
 *   - has gate methods `assertSolid()`/`assertSheet()`/`assertWire()` that
 *     enforce op-applicability invariants (shell→solid, thicken→sheet,
 *     extrudeWire→wire) — S5's body-kind-drives-op-applicability contract.
 *   - owns its `IdAllocator` — the per-body persistent-ID namespace (SP-1 §2.3).
 *   - owns a list of `Lump`s (the pre-spine `TopoSolid` had no lump concept).
 *     A wire body with disjoint wire components has ONE LUMP PER CONNECTED
 *     COMPONENT (S5: disjoint-region wire-body support).
 *   - holds `geomEngineShape` — the live B-rep engine `TopoDS_Shape` the spine
 *     was bound to (the geometry-engine-behind-the-spine contract, SP-1 §2.4).
 *     The shape stays inside the heap-managed wrapper, so the `withScope` /
 *     `.delete()` discipline is unchanged. null for a fully spine-native body.
 *   - carries body-level `attributes` (the SP-2 hook).
 *
 * `Body` replaces `TopoSolid` (→ Body + Lump). The pre-spine `Topo*` classes
 * are kept untouched in S0 so the analytic-face side-car still works.
 */

import IdAllocator from './IdAllocator.js';

let _transientCounter = 0;

/** The three allowed body kinds. */
export const BODY_KINDS = Object.freeze(['solid', 'sheet', 'wire']);

export default class Body {
  /**
   * @param {object} [opts]
   * @param {'solid'|'sheet'|'wire'} [opts.kind]   if omitted, derived from
   *        topology by `assertKind()` once lumps are attached.
   * @param {'solid'|'sheet'|'wire'} [opts.declaredKind]  S5: the kind the
   *        ORIGINATING OP claims for its result. Reconciled against the
   *        topology-derived kind by `assertKind()`; mismatch is a real
   *        diagnostic (an op's declared kind must agree with what the
   *        topology actually says).
   * @param {IdAllocator} [opts.idAllocator]  reuse an allocator (e.g. when
   *        rebuilding a body and resuming its id namespace).
   * @param {string} [opts.bodyTag]   explicit body tag for a fresh allocator.
   * @param {object} [opts.geomEngineShape]  the B-rep engine shape, or null.
   */
  constructor(opts = {}) {
    this.type = 'body';
    this.transientId = ++_transientCounter;
    this.idAllocator = opts.idAllocator || new IdAllocator({ bodyTag: opts.bodyTag });
    this.persistentId = this.idAllocator.bodyTag;
    this.lumps = [];
    // kind is provisional until assertKind() runs after lumps are attached.
    this.kind = opts.kind || null;
    // S5 — the op-declared kind (the originating op's claim about its result).
    // null = no op claim; assertKind takes the derived value.
    this.declaredKind = opts.declaredKind || null;
    this.geomEngineShape = opts.geomEngineShape || null;
    this.attributes = {};         // SP-2 hook — body-level attributes
    this.diagnostics = {};        // bindSpine / validateSpine notes
    this.userData = {};
    this.name = opts.name || '';
  }

  /** Allocate the next persistent id for an entity of `kind` in this body. */
  allocId(kind) { return this.idAllocator.allocId(kind); }

  /** Add a lump, taking ownership (sets `lump.body`). */
  addLump(lump) {
    if (!lump) return;
    lump.body = this;
    this.lumps.push(lump);
    // Cascade the body back-reference down the spine so every entity
    // can reach its owning Body (faces/edges/vertices need it for attributes).
    for (const shell of lump.shells) {
      for (const face of shell.faces) {
        face.body = this;
        for (const e of face.edges()) e.body = this;
        for (const v of face.vertices()) v.body = this;
      }
      for (const e of shell.wireEdges) {
        e.body = this;
        if (e.startVertex) e.startVertex.body = this;
        if (e.endVertex) e.endVertex.body = this;
      }
    }
  }

  // ── Aggregate accessors ────────────────────────────────────────────────────
  //
  // Every accessor returns DISTINCT entities. A non-manifold body legitimately
  // shares one face between two shells (an internal face between two regions);
  // that face is ONE entity and must appear once. Dedup is by object identity.

  /** Every distinct shell across all lumps. */
  shells() {
    const seen = new Set();
    for (const l of this.lumps) { for (const s of l.shells) seen.add(s); }
    return [...seen];
  }

  /** Every distinct face across all lumps. */
  faces() {
    const seen = new Set();
    for (const s of this.shells()) { for (const f of s.faces) seen.add(f); }
    return [...seen];
  }

  /** Every distinct loop across all faces. */
  loops() {
    const seen = new Set();
    for (const f of this.faces()) { for (const lp of f.allLoops()) seen.add(lp); }
    return [...seen];
  }

  /** Every distinct coedge across all faces. */
  coedges() {
    const seen = new Set();
    for (const f of this.faces()) { for (const ce of f.coedges()) seen.add(ce); }
    return [...seen];
  }

  /** Distinct edges across all lumps (face edges + wire edges). */
  edges() {
    const es = new Set();
    for (const l of this.lumps) { for (const e of l.edges()) es.add(e); }
    for (const s of this.shells()) { for (const e of s.wireEdges) es.add(e); }
    return [...es];
  }

  /** Distinct vertices across all lumps. */
  vertices() {
    const vs = new Set();
    for (const l of this.lumps) { for (const v of l.vertices()) vs.add(v); }
    for (const e of this.edges()) {
      if (e.startVertex) vs.add(e.startVertex);
      if (e.endVertex) vs.add(e.endVertex);
    }
    return [...vs];
  }

  /** Edges of the body used by >2 coedges — the non-manifold edges. */
  nonManifoldEdges() {
    return this.edges().filter(e => e.coedges.size > 2);
  }

  /** Find an entity by its persistent id, across the whole spine. */
  findByPersistentId(pid) {
    if (!pid) return null;
    for (const l of this.lumps) { if (l.persistentId === pid) return l; }
    for (const s of this.shells()) { if (s.persistentId === pid) return s; }
    for (const f of this.faces()) { if (f.persistentId === pid) return f; }
    for (const lp of this.loops()) { if (lp.persistentId === pid) return lp; }
    for (const ce of this.coedges()) { if (ce.persistentId === pid) return ce; }
    for (const e of this.edges()) { if (e.persistentId === pid) return e; }
    for (const v of this.vertices()) { if (v.persistentId === pid) return v; }
    return null;
  }

  // ── Body kind ──────────────────────────────────────────────────────────────

  /**
   * Derive the body kind from topology (S5 — first-class):
   *   - `wire`  = NO faces, only wire edges (a connected-set of edges + verts).
   *               A multi-lump wire body has one lump per disjoint wire
   *               component (S5: disjoint-region wire-body support).
   *   - `solid` = faces present AND every shell of every lump is closed
   *               (volume-bounding) — every non-degenerate edge has ≥2 coedges.
   *   - `sheet` = faces present but at least one shell is open (lamina /
   *               open-sheet body — `thicken` consumes this kind).
   * @returns {'solid'|'sheet'|'wire'}
   */
  deriveKind() {
    const faces = this.faces();
    if (faces.length === 0) return 'wire';
    const allClosed = this.lumps.length > 0 &&
      this.lumps.every(l => l.shells.length > 0 && l.shells.every(s => s.isClosed()));
    return allClosed ? 'solid' : 'sheet';
  }

  /**
   * Reconcile the body's kind with its topology, S5-aware.
   *
   * S5 first-class semantics:
   *   - If `declaredKind` was set by the originating op (every primitive /
   *     feature / boolean / local / surfacing op now declares its result
   *     kind), that is the AUTHORITATIVE kind — and it MUST agree with the
   *     topology-derived kind. A disagreement is recorded as a real
   *     diagnostic (`kindMismatch` carries the conflict).
   *   - If no kind was declared (legacy / non-S5-aware op), the derived kind
   *     wins (the SP-1 §2.2 contract: kind is topology-derived).
   *   - `this.kind` ends up as the actually-applicable kind for downstream
   *     validation + op-applicability gates.
   *
   * The honest behaviour: this is RECONCILIATION, not silent override —
   * `kindMismatch` is exposed so `validateSpine` can fail it.
   */
  assertKind() {
    const derived = this.deriveKind();
    // The op's explicit claim (S5) wins over the constructor's loose `kind` —
    // declaredKind is the FIRST-CLASS signal; `kind` may be provisional.
    const claimed = this.declaredKind || this.kind || null;
    if (claimed && claimed !== derived) {
      this.diagnostics.kindMismatch = {
        declared: this.declaredKind || null,
        provisional: this.kind || null,
        derived,
        message: `declared/provisional kind '${claimed}' disagrees with ` +
          `topology-derived '${derived}' — the derived kind is authoritative.`,
      };
    } else {
      // Clear any stale diagnostic from an earlier provisional state.
      delete this.diagnostics.kindMismatch;
    }
    this.kind = derived;
    return this.kind;
  }

  // ── S5 op-applicability gates ──────────────────────────────────────────────
  //
  // Body kind DRIVES op-applicability. Every op that has a kind precondition
  // (shell→solid, thicken→sheet, extrudeWire→wire) calls the corresponding
  // gate on its input. The gate either passes silently (precondition met) or
  // throws with a precise diagnostic — never silent.
  //
  // The error names start with `BodyKindAssertionError` so callers can
  // distinguish a kind-precondition violation from a generic error.

  /**
   * Assert this body is a solid (volume-bounding). Pre-condition for ops that
   * shell / cut / fillet / chamfer / extrude-cut a closed body.
   * @throws {Error} if `this.kind !== 'solid'`.
   */
  assertSolid(opName) {
    if (this.kind !== 'solid') {
      const lbl = opName ? `${opName}: ` : '';
      throw new Error(
        `BodyKindAssertionError: ${lbl}expected a 'solid' body, got '${this.kind}' ` +
        `(body '${this.persistentId}' — ${this.lumps.length} lump(s), ` +
        `${this.faces().length} face(s)).`);
    }
    return this;
  }

  /**
   * Assert this body is a sheet (faces but at least one open shell — a
   * 2-manifold-with-boundary). Pre-condition for `thicken` (sheet→solid).
   * @throws {Error} if `this.kind !== 'sheet'`.
   */
  assertSheet(opName) {
    if (this.kind !== 'sheet') {
      const lbl = opName ? `${opName}: ` : '';
      throw new Error(
        `BodyKindAssertionError: ${lbl}expected a 'sheet' body, got '${this.kind}' ` +
        `(body '${this.persistentId}' — ${this.faces().length} face(s)).`);
    }
    return this;
  }

  /**
   * Assert this body is a wire (no faces, only wire edges). Pre-condition for
   * `extrudeWire`, `sweep`-via-wire-profile, sketch consumption.
   * @throws {Error} if `this.kind !== 'wire'`.
   */
  assertWire(opName) {
    if (this.kind !== 'wire') {
      const lbl = opName ? `${opName}: ` : '';
      throw new Error(
        `BodyKindAssertionError: ${lbl}expected a 'wire' body, got '${this.kind}' ` +
        `(body '${this.persistentId}' — ${this.faces().length} face(s)).`);
    }
    return this;
  }

  /**
   * Assert this body is one of an explicit set of allowed kinds.
   * Convenience for ops that accept multiple kinds (e.g. `transform` accepts
   * any kind; `boolean` accepts solid|sheet but not wire).
   * @param {Array<'solid'|'sheet'|'wire'>} allowed
   */
  assertKindIn(allowed, opName) {
    if (!Array.isArray(allowed) || !allowed.includes(this.kind)) {
      const lbl = opName ? `${opName}: ` : '';
      throw new Error(
        `BodyKindAssertionError: ${lbl}expected kind in ` +
        `${JSON.stringify(allowed)}, got '${this.kind}'.`);
    }
    return this;
  }

  // ── Euler-Poincaré ─────────────────────────────────────────────────────────

  /**
   * Real (non-degenerate) edges of the body. A degenerate edge — a zero-length
   * seam/apex edge, e.g. a sphere pole — is a parametric artefact, not a real
   * 1-cell of the topological complex, and is EXCLUDED from the Euler count
   * (see `eulerCharacteristic`). Its endpoint vertices are kept (the real seam
   * edge still uses them).
   */
  realEdges() {
    return this.edges().filter(e => !e.isDegenerate());
  }

  /**
   * χ = V − E + F over the whole body, with E counting only REAL
   * (non-degenerate) edges.
   *
   * Why exclude degenerate edges: the B-rep engine represents a sphere as ONE
   * face with a seam edge and 2 degenerate pole edges. The pole edges are
   * zero-length parametric artefacts — counting them breaks the Euler relation
   * (naive 2−3+1 = 0 for a sphere, which should be χ=2). Excluding them gives
   * the sphere V=2, E=1 (the seam), F=1 → χ = 2−1+1 = 2 — the correct genus-0
   * value. A torus (2 seam edges, 1 vertex, 1 face, 0 degenerate) gives
   * χ = 1−2+1 = 0 — the correct genus-1 value. This is the standard treatment
   * of the degenerate (singular) edge in a B-rep cell complex.
   */
  eulerCharacteristic() {
    return this.vertices().length - this.realEdges().length + this.faces().length;
  }

  /**
   * Number of ring (inner / hole) loops across all faces of the body — the
   * `R` term of the full Euler-Poincaré formula. A face with one outer loop
   * and `k` inner loops contributes `k` rings.
   */
  ringLoopCount() {
    let r = 0;
    for (const f of this.faces()) r += f.innerLoops.length;
    return r;
  }

  /**
   * Check the Euler-Poincaré relation for the body.
   *
   * The FULL Euler-Poincaré formula for a B-rep solid (the form a real kernel
   * maintains — the simple `V−E+F=2` is only the genus-0, ring-free,
   * single-shell special case):
   *
   *     V − E + F − R = 2·(S − G)
   *
   * where  V = vertices, E = real (non-degenerate) edges, F = faces,
   *        R = ring (inner / hole) loops,
   *        S = closed shells (peripheral + void — each a connected component),
   *        G = total genus (number of through-handles).
   *
   * Worked examples this method gets right:
   *   - box:               8−12+6−0 = 2 = 2(1−0)  → genus 0  ✓
   *   - through-drilled box: V−E+F=2, R=2 → 0 = 2(1−1) → genus 1  ✓
   *     (a through hole is a handle — the box becomes toroidal.)
   *   - sphere (1 face, seam edge, degenerate poles excluded): 2−1+1−0 = 2
   *     → genus 0  ✓
   *   - torus (1 face, 2 seam edges, 1 vertex): 1−2+1−0 = 0 → genus 1  ✓
   *
   * The genus is not independently known from counts, so this method computes
   * the genus IMPLIED by the relation and flags `ok` when that implied genus
   * is a non-negative integer — a self-consistent Euler-Poincaré state. SP-1
   * MAINTAINS the invariant by construction (bindSpine) and CHECKS it here.
   * For sheet / wire bodies there is no closed-solid relation to violate, so
   * the method reports the value and `ok=true`.
   *
   * @returns {{kind:string,V:number,E:number,F:number,R:number,
   *   edgesTotal:number,degenerateEdges:number,shells:number,voidShells:number,
   *   lhs:number,actual:number,genusImplied:number|null,
   *   expected:number|null,ok:boolean,note:string}}
   */
  checkEulerPoincare() {
    const V = this.vertices().length;
    // E counts only real (non-degenerate) edges — see eulerCharacteristic().
    const E = this.realEdges().length;
    const Etotal = this.edges().length;
    const F = this.faces().length;
    const R = this.ringLoopCount();
    // `actual` keeps the legacy V−E+F (χ of the cell complex);
    // `lhs` is the full Euler-Poincaré left-hand side V−E+F−R.
    const actual = V - E + F;
    const lhs = actual - R;
    const allShells = this.shells();
    // S = every CLOSED shell (peripheral and void alike) — each is a connected
    // boundary component contributing to the relation.
    const closedShells = allShells.filter(s => s.isClosed());
    const peripheral = allShells.filter(s => s.role === 'peripheral').length || this.lumps.length;
    const voids = allShells.filter(s => s.role === 'void').length;
    const S = closedShells.length || (peripheral + voids) || this.lumps.length;
    const kind = this.kind || this.deriveKind();
    const nmEdges = this.nonManifoldEdges().length;

    // Non-manifold body — the standard manifold Euler-Poincaré relation
    // V−E+F−R = 2(S−G) does NOT apply: it assumes every edge bounds exactly 2
    // faces. A non-manifold body (an edge shared by ≥3 faces) genuinely does
    // not satisfy it. Per SP-1 §2.5/§2.6 non-manifold is first-class; the
    // honest verdict is that the relation is INAPPLICABLE, not VIOLATED — the
    // body's structural validity is established by validateSpine's other
    // invariants (closed loops, coedge partners, radial cycles). Report the
    // value and `ok=true` (no manifold relation to violate).
    if (nmEdges > 0) {
      return {
        kind, V, E, F, R, edgesTotal: Etotal, degenerateEdges: Etotal - E,
        shells: peripheral, voidShells: voids, lhs, actual,
        nonManifoldEdges: nmEdges,
        genusImplied: null, expected: null, ok: true,
        note: `non-manifold body (${nmEdges} edge${nmEdges === 1 ? '' : 's'} ` +
          `shared by >2 faces) — V−E+F−R = ${lhs}; the manifold Euler-Poincaré ` +
          `relation 2(S−G) is inapplicable to non-manifold topology, not violated.`,
      };
    }

    if (kind === 'solid') {
      // V − E + F − R = 2(S − G)  →  G = S − (V−E+F−R)/2
      const half = lhs / 2;
      const integralHalf = Math.abs(half - Math.round(half)) < 1e-9;
      const genusImplied = integralHalf ? S - Math.round(half) : null;
      const ok = integralHalf && genusImplied !== null && genusImplied >= 0;
      return {
        kind, V, E, F, R, edgesTotal: Etotal, degenerateEdges: Etotal - E,
        shells: peripheral, voidShells: voids, lhs, actual,
        genusImplied,
        expected: 2 * (S - (genusImplied || 0)),
        ok,
        note: ok
          ? `V−E+F−R = ${V}−${E}+${F}−${R} = ${lhs} = 2(S−G) with S=${S} ` +
            `G=${genusImplied} — Euler-Poincaré consistent.`
          : `V−E+F−R = ${lhs} is not an even, genus-consistent value for ` +
            `${S} closed shell(s) — Euler-Poincaré violation.`,
      };
    }
    // Sheet / wire — no closed-solid relation to violate; report the value.
    return {
      kind, V, E, F, R, edgesTotal: Etotal, degenerateEdges: Etotal - E,
      shells: peripheral, voidShells: voids, lhs, actual,
      genusImplied: null, expected: null, ok: true,
      note: `${kind} body — V−E+F−R = ${lhs} (open topology, no closed-solid ` +
        `Euler relation to satisfy).`,
    };
  }

  toString() {
    return `Body#${this.persistentId}` +
      `("${this.name}" kind=${this.kind || '?'}, ${this.lumps.length} lump(s), ` +
      `V${this.vertices().length} E${this.edges().length} F${this.faces().length})`;
  }

  // ── SP-2 attribute accessors ────────────────────────────────────────────
  // Body-level attributes (e.g. partNumber, material grade, name) — survive
  // booleans via the attribute's `survives` policy (carryLineage propagates
  // body-level attributes between input and result bodies), and survive
  // transforms verbatim via bindSpine's `preserveBodyAttributes`.
  attributeKeys() { return Object.keys(this.attributes || {}); }
  getAttribute(key) { return (this.attributes && this.attributes[key]) || null; }
  attributeValue(key) {
    const r = this.getAttribute(key); return r ? r.value : undefined;
  }
  hasAttribute(key) { return !!(this.attributes && this.attributes[key]); }
  *listAttributes() {
    if (this.attributes) for (const r of Object.values(this.attributes)) yield r;
  }

  // ── S7 Topology Inspector — pure read-side JSON projection ────────────────
  //
  // The Inspector UI never holds a live spine reference (the spine graph has
  // legitimate cycles — Lump↔Shell, Shell↔Face, Loop↔Coedge, Edge↔Coedge —
  // that React state and serialisers do not survive). `toInspectorJSON` walks
  // the live spine ONCE and produces an acyclic, fully-keyed snapshot keyed
  // on persistent ids (transient ids as fallback): each node has a `kind`
  // tag, a `label`, plus `children` arrays in the canonical
  // `Body → Lump → Shell → Face → Loop → Coedge → Edge → Vertex` order.
  // This is the *read-helper* the S7 plan §6 calls for ("Body.toInspectorJSON()").
  //
  // The projection is intentionally MINIMAL — it includes only what the
  // inspector tree shows; the per-entity read-out fetches deeper detail by
  // looking up the live entity through `findByPersistentId`/`findEntityById`
  // when a node is selected. That keeps the snapshot cheap on large bodies.
  toInspectorJSON() {
    const validation = (this.diagnostics && this.diagnostics.validation) || null;
    const euler = this.checkEulerPoincare();
    const faces = this.faces();
    const edges = this.edges();
    const verts = this.vertices();
    const nm = this.nonManifoldEdges();
    const root = {
      kind: 'body',
      persistentId: this.persistentId,
      transientId: this.transientId,
      bodyKind: this.kind || null,
      declaredKind: this.declaredKind || null,
      kindMismatch: (this.diagnostics && this.diagnostics.kindMismatch) || null,
      name: this.name || '',
      counts: {
        lumps: this.lumps.length,
        shells: this.shells().length,
        faces: faces.length,
        loops: this.loops().length,
        coedges: this.coedges().length,
        edges: edges.length,
        vertices: verts.length,
        nonManifoldEdges: nm.length,
        analyticFaces: faces.filter(f => f.isAnalytic).length,
      },
      euler: {
        V: euler.V, E: euler.E, F: euler.F, R: euler.R || 0,
        actual: euler.actual,
        genusImplied: euler.genusImplied,
        ok: euler.ok,
        note: euler.note || '',
      },
      validation: validation ? {
        ok: !!validation.ok,
        errors: Array.isArray(validation.errors) ? validation.errors.slice(0, 32) : [],
        warnings: Array.isArray(validation.warnings) ? validation.warnings.slice(0, 32) : [],
      } : null,
      children: [],
    };
    let lumpIdx = 0;
    for (const lump of this.lumps) {
      const lumpNode = {
        kind: 'lump',
        persistentId: lump.persistentId || `lump:${lumpIdx}`,
        transientId: lump.transientId,
        label: `Lump ${lumpIdx + 1}`,
        children: [],
      };
      lumpIdx += 1;
      let shellIdx = 0;
      for (const shell of lump.shells || []) {
        const shellNode = {
          kind: 'shell',
          persistentId: shell.persistentId || `shell:${shellIdx}`,
          transientId: shell.transientId,
          role: shell.role || null,
          isClosed: typeof shell.isClosed === 'function' ? shell.isClosed() : null,
          label: `Shell ${shellIdx + 1}${shell.role ? ` (${shell.role})` : ''}`,
          children: [],
        };
        shellIdx += 1;
        let faceIdx = 0;
        for (const face of shell.faces || []) {
          const faceCoedges = face.coedges();
          const faceEdges = face.edges();
          const faceVerts = face.vertices();
          const surfType = face.surface ? (face.surface.type || (face.surface.analytic ? 'analytic' : 'surface')) : 'none';
          const faceNode = {
            kind: 'face',
            persistentId: face.persistentId || `face:${faceIdx}`,
            transientId: face.transientId,
            label: `Face #${face.transientId} (${surfType})`,
            surfaceType: surfType,
            isAnalytic: !!face.isAnalytic,
            reversed: !!face.reversed,
            derivedFrom: Array.isArray(face.derivedFrom) ? face.derivedFrom.slice() : [],
            attributesKeys: face.attributes ? Object.keys(face.attributes) : [],
            metaKeys: face.userData ? Object.keys(face.userData) : [],
            counts: {
              edges: faceEdges.length,
              vertices: faceVerts.length,
              coedges: faceCoedges.length,
              loops: face.allLoops().length,
              innerLoops: face.innerLoops.length,
            },
            // Per-loop nesting — outer first, then inner (holes).
            children: [],
          };
          faceIdx += 1;
          // Outer loop
          let loopIdx = 0;
          const emitLoop = (loop, isOuter) => {
            const loopNode = {
              kind: 'loop',
              persistentId: loop.persistentId || `loop:${loopIdx}`,
              transientId: loop.transientId,
              isOuter: !!isOuter,
              label: `Loop ${loopIdx + 1}${isOuter ? ' (outer)' : ' (inner)'} — ${loop.coedges.length} coedge${loop.coedges.length === 1 ? '' : 's'}`,
              children: [],
            };
            loopIdx += 1;
            let ceIdx = 0;
            for (const ce of loop.coedges || []) {
              const ceNode = {
                kind: 'coedge',
                persistentId: ce.persistentId || `coedge:${ceIdx}`,
                transientId: ce.transientId,
                reversed: !!ce.reversed,
                radialAngle: Number.isFinite(ce.radialAngle) ? ce.radialAngle : null,
                hasPartner: !!ce.partner,
                hasPcurve: !!ce.pcurve,
                label: `Coedge #${ce.transientId}${ce.reversed ? ' (rev)' : ''}`,
                children: [],
              };
              if (ce.edge) {
                const e = ce.edge;
                ceNode.children.push({
                  kind: 'edge',
                  persistentId: e.persistentId || `edge:${ceIdx}`,
                  transientId: e.transientId,
                  label: `Edge #${e.transientId}`,
                  coedgeCount: e.coedges.size,
                  isManifold: typeof e.isManifold === 'function' ? e.isManifold() : null,
                  isNonManifold: e.coedges.size > 2,
                  degenerate: !!e.degenerate,
                  derivedFrom: Array.isArray(e.derivedFrom) ? e.derivedFrom.slice() : [],
                  curveType: e.curve ? (e.curve.type || 'curve') : 'none',
                  length: typeof e.length === 'function' ? e.length() : null,
                  children: [
                    e.startVertex ? {
                      kind: 'vertex',
                      persistentId: e.startVertex.persistentId || `vertex:s`,
                      transientId: e.startVertex.transientId,
                      label: `Vertex #${e.startVertex.transientId} (start)`,
                      point: e.startVertex.point ? { ...e.startVertex.point } : null,
                      valence: e.startVertex.valence ? e.startVertex.valence() : null,
                      derivedFrom: Array.isArray(e.startVertex.derivedFrom) ? e.startVertex.derivedFrom.slice() : [],
                      children: [],
                    } : null,
                    e.endVertex && e.endVertex !== e.startVertex ? {
                      kind: 'vertex',
                      persistentId: e.endVertex.persistentId || `vertex:e`,
                      transientId: e.endVertex.transientId,
                      label: `Vertex #${e.endVertex.transientId} (end)`,
                      point: e.endVertex.point ? { ...e.endVertex.point } : null,
                      valence: e.endVertex.valence ? e.endVertex.valence() : null,
                      derivedFrom: Array.isArray(e.endVertex.derivedFrom) ? e.endVertex.derivedFrom.slice() : [],
                      children: [],
                    } : null,
                  ].filter(Boolean),
                });
              }
              ceIdx += 1;
              loopNode.children.push(ceNode);
            }
            faceNode.children.push(loopNode);
          };
          if (face.outerLoop) emitLoop(face.outerLoop, true);
          for (const il of face.innerLoops) emitLoop(il, false);
          shellNode.children.push(faceNode);
        }
        lumpNode.children.push(shellNode);
      }
      root.children.push(lumpNode);
    }
    return root;
  }

  /**
   * Look up any spine entity by its persistent ID (or transient ID prefixed by
   * 't:'). Pure read — does not mutate the spine. Used by the Inspector when a
   * tree node is clicked: the JSON snapshot carries identifiers, the live
   * entity is fetched on demand for the per-entity readout.
   * @param {string|number} id  persistent id, or transient id (number).
   * @returns {object|null}
   */
  findEntityById(id) {
    if (id == null) return null;
    if (typeof id === 'string' && id.startsWith('t:')) {
      const t = Number(id.slice(2));
      for (const l of this.lumps) if (l.transientId === t) return l;
      for (const s of this.shells()) if (s.transientId === t) return s;
      for (const f of this.faces()) if (f.transientId === t) return f;
      for (const lp of this.loops()) if (lp.transientId === t) return lp;
      for (const ce of this.coedges()) if (ce.transientId === t) return ce;
      for (const e of this.edges()) if (e.transientId === t) return e;
      for (const v of this.vertices()) if (v.transientId === t) return v;
      return null;
    }
    return this.findByPersistentId(id);
  }
}
