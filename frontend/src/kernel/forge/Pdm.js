/**
 * PDM / PLM — minimal part lifecycle + ECO (Engineering Change Order).
 *
 * Scope of this slice:
 *   - PartVersion: an immutable snapshot of a part (BREP blob ref + meta).
 *   - PartHistory: a linked list of PartVersions per partId.
 *   - LifecycleState: WIP / InReview / Released / Obsolete (single linear flow).
 *   - ECO: a change request with an approval workflow + affected-parts set.
 *   - PartStore: store-agnostic interface; an in-memory impl ships here.
 *     A filesystem-backed impl writing to `.forge/parts/<id>/v<n>.json`
 *     can subclass without rewriting any caller — see PartStore in the
 *     filesystem store slice (queued).
 *
 * No native dependency. Tested with plain-node assert.
 */

let monotonic = 0;
function ts() { return Date.now() + (++monotonic / 1e6); }

export const LifecycleState = Object.freeze({
  WIP:        'WIP',
  InReview:   'InReview',
  Released:   'Released',
  Obsolete:   'Obsolete',
});

const LIFECYCLE_FORWARD = {
  WIP:      ['InReview'],
  InReview: ['WIP', 'Released'],
  Released: ['Obsolete'],
  Obsolete: [],
};

export class PartVersion {
  constructor({ partId, versionNumber, parentVersion = null,
                blobHash, message = '', author = 'unknown',
                state = LifecycleState.WIP,
                meta = {} }) {
    if (!partId) throw new Error('[forge.pdm] PartVersion requires partId');
    if (typeof versionNumber !== 'number') throw new Error('[forge.pdm] versionNumber required');
    if (!blobHash) throw new Error('[forge.pdm] blobHash required (content-addressed BREP)');
    this.partId = partId;
    this.versionNumber = versionNumber;
    this.parentVersion = parentVersion;
    this.blobHash = blobHash;
    this.message = message;
    this.author = author;
    this.state = state;
    this.meta = { ...meta };
    this.timestamp = ts();
    Object.freeze(this.meta);
    Object.freeze(this);
  }
}

export class PartHistory {
  constructor(partId) {
    if (!partId) throw new Error('[forge.pdm] PartHistory requires partId');
    this.partId = partId;
    this.versions = []; // PartVersion[], ordered oldest → newest by versionNumber
  }
  head() { return this.versions[this.versions.length - 1] || null; }
  byVersion(n) { return this.versions.find((v) => v.versionNumber === n) || null; }
  count() { return this.versions.length; }

  commit({ blobHash, message, author, meta }) {
    const parent = this.head();
    const v = new PartVersion({
      partId: this.partId,
      versionNumber: (parent ? parent.versionNumber : 0) + 1,
      parentVersion: parent ? parent.versionNumber : null,
      blobHash, message, author, meta,
    });
    this.versions.push(v);
    return v;
  }

  /** State transitions: enforced by LIFECYCLE_FORWARD adjacency. */
  promote(versionNumber, toState, { author = 'unknown' } = {}) {
    const v = this.byVersion(versionNumber);
    if (!v) throw new Error(`[forge.pdm] no v${versionNumber} for part ${this.partId}`);
    if (!LIFECYCLE_FORWARD[v.state].includes(toState)) {
      throw new Error(
        `[forge.pdm] illegal transition ${v.state} → ${toState} ` +
        `(allowed: ${LIFECYCLE_FORWARD[v.state].join(', ') || 'none'})`,
      );
    }
    // PartVersion is frozen; promote by replacing the slot with a new
    // PartVersion that carries forward the same identity but a new state.
    const idx = this.versions.indexOf(v);
    const promoted = new PartVersion({
      partId: v.partId, versionNumber: v.versionNumber, parentVersion: v.parentVersion,
      blobHash: v.blobHash, message: v.message, author: v.author,
      state: toState, meta: { ...v.meta, promotedBy: author, promotedAt: ts() },
    });
    this.versions[idx] = promoted;
    return promoted;
  }

  serialize() {
    return {
      partId: this.partId,
      versions: this.versions.map((v) => ({
        partId: v.partId, versionNumber: v.versionNumber, parentVersion: v.parentVersion,
        blobHash: v.blobHash, message: v.message, author: v.author,
        state: v.state, meta: v.meta, timestamp: v.timestamp,
      })),
    };
  }
  static deserialize(json) {
    const h = new PartHistory(json.partId);
    for (const v of json.versions || []) {
      const pv = new PartVersion({
        partId: v.partId, versionNumber: v.versionNumber, parentVersion: v.parentVersion,
        blobHash: v.blobHash, message: v.message, author: v.author,
        state: v.state, meta: v.meta,
      });
      h.versions.push(pv);
    }
    return h;
  }
}

// =====================================================================
//                          Engineering Change Order
// =====================================================================

export const EcoState = Object.freeze({
  Draft:        'Draft',
  InReview:     'InReview',
  Approved:     'Approved',
  Implemented:  'Implemented',
  Closed:       'Closed',
  Rejected:     'Rejected',
});

const ECO_FORWARD = {
  Draft:       ['InReview', 'Closed'],
  InReview:    ['Approved', 'Rejected', 'Draft'],
  Approved:    ['Implemented', 'Closed'],
  Implemented: ['Closed'],
  Closed:      [],
  Rejected:    ['Draft', 'Closed'],
};

let ecoCounter = 0;
export class ECO {
  constructor({ title, description = '', requestedBy = 'unknown',
                affectedParts = [], approvers = [] }) {
    if (!title) throw new Error('[forge.pdm] ECO requires a title');
    this.id = `ECO-${++ecoCounter}`;
    this.title = title;
    this.description = description;
    this.requestedBy = requestedBy;
    this.affectedParts = [...affectedParts];   // partIds
    this.approvers = [...approvers];           // user ids whose approval is needed
    this.approvals = new Map();                // user → boolean (true=approve, false=reject)
    this.state = EcoState.Draft;
    this.timeline = [{ state: this.state, at: ts(), by: requestedBy }];
  }
  addAffectedPart(partId) {
    if (!this.affectedParts.includes(partId)) this.affectedParts.push(partId);
  }
  approve(user) { this.approvals.set(user, true); }
  reject(user)  { this.approvals.set(user, false); }
  /** All listed approvers have either approve()'d or reject()'d. */
  isFullyResponded() {
    return this.approvers.every((u) => this.approvals.has(u));
  }
  allApproved() {
    return this.approvers.length > 0 &&
           this.approvers.every((u) => this.approvals.get(u) === true);
  }
  transition(to, by = 'unknown') {
    if (!ECO_FORWARD[this.state].includes(to)) {
      throw new Error(
        `[forge.pdm] illegal ECO transition ${this.state} → ${to} ` +
        `(allowed: ${ECO_FORWARD[this.state].join(', ') || 'none'})`,
      );
    }
    if (to === EcoState.Approved && !this.allApproved()) {
      throw new Error('[forge.pdm] cannot move ECO to Approved without unanimous approve()');
    }
    this.state = to;
    this.timeline.push({ state: to, at: ts(), by });
  }
  serialize() {
    return {
      id: this.id, title: this.title, description: this.description,
      requestedBy: this.requestedBy, affectedParts: [...this.affectedParts],
      approvers: [...this.approvers],
      approvals: Object.fromEntries(this.approvals),
      state: this.state, timeline: [...this.timeline],
    };
  }
}

// =====================================================================
//                              PartStore
// =====================================================================

/** In-memory PartStore. Replace with a filesystem impl by subclassing. */
export class PartStore {
  constructor() {
    this.histories = new Map(); // partId → PartHistory
    this.ecos = new Map();      // ecoId → ECO
  }
  history(partId) {
    if (!this.histories.has(partId)) this.histories.set(partId, new PartHistory(partId));
    return this.histories.get(partId);
  }
  commitPart(partId, fields) { return this.history(partId).commit(fields); }
  promotePart(partId, version, toState, opts) {
    return this.history(partId).promote(version, toState, opts);
  }
  fileEco(fields) {
    const e = new ECO(fields);
    this.ecos.set(e.id, e);
    return e;
  }
  getEco(id) { return this.ecos.get(id) || null; }
  listEcos() { return [...this.ecos.values()]; }
}
