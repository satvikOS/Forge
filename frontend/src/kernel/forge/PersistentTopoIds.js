/**
 * Forge-46 / §1 — Persistent Topological IDs across every op.
 *
 * The native OCCT kernel hands back face / edge indices from
 * `TopExp::MapShapes`, but those indices are only stable inside ONE
 * BREP — every boolean (cut/fuse/section), every feature (extrude,
 * fillet, shell), every direct edit (pushPullFace, deleteFace) emits a
 * NEW BREP with renumbered indices. So a user reference like "this is
 * my datum-A face" goes stale after the next op.
 *
 * This module implements a JS-side companion to the OCCT index: every
 * time a new body is born, we hand each face / edge a *persistent ID*
 * (`pid`) that lives for the body's entire history. Every op declares
 * a "lineage map" — a list of `{ kind, oldPid|nullForBirth, newOcctIds }`
 * entries — and the registry walks the map to update its internal
 * `pid ↔ occtIndex` tables.
 *
 * Survivors (a face that comes through a cut unchanged) keep their pid.
 * Splits (a fillet turning one face into three) give every survivor the
 * same pid + an "instance" tag. Births (a brand-new face from an
 * extrude rim) get a fresh pid. The pid is the only thing user-facing
 * code (drawings, MBD, the picker, the parametric history tree) should
 * ever store — kernel indices are renderer-tier internals.
 *
 * Lineage entry shapes (the kernel side emits these per op):
 *
 *   { kind: 'survivor', oldPid, newOcctIndex }
 *     A face/edge that came through with the same identity. Most common
 *     case after a small fillet or a cut that didn't touch the face.
 *
 *   { kind: 'split',    oldPid, newOcctIndices: [i1, i2, …] }
 *     One face became N (e.g. a hole splits a face into a torus +
 *     remainder). All survivors share the pid; differ by `subId`.
 *
 *   { kind: 'merge',    oldPids: [p1, p2, …], newOcctIndex }
 *     N faces merged into one. The FIRST input's pid wins (deterministic);
 *     the rest land in `mergedFrom` provenance.
 *
 *   { kind: 'birth',    newOcctIndex, originOp }
 *     A brand-new face (the rim from an extrude, the sweep cap, the
 *     fillet cylindrical band). A fresh pid is allocated.
 *
 *   { kind: 'death',    oldPid }
 *     A face deleted by deleteFace / consumed by a boolean. The pid
 *     is retired (not reused).
 */

let _seq = 1;
function freshPid(prefix = 'pid') { return `${prefix}-${(_seq++).toString(36)}`; }

export class ForgeTopoIdRegistry {
  constructor() {
    /** pid → { kind: 'face'|'edge'|'vertex', occtIndex, subId?, mergedFrom?, originOp?, dead? } */
    this._byPid = new Map();
    /** kind → Map<occtIndex, pid> */
    this._byOcct = { face: new Map(), edge: new Map(), vertex: new Map() };
    /** Linear history of every lineage event — kept for debug + retrain trace. */
    this._history = [];
  }

  // ----------------------- INITIAL BIRTH ----------------------------
  /**
   * Register a freshly-born body. `kindCounts = { face: 6, edge: 12, vertex: 8 }`
   * mints a pid for every face/edge/vertex 1..N. Returns the assigned pids
   * grouped by kind.
   */
  bornBody({ face = 0, edge = 0, vertex = 0 } = {}) {
    const out = { face: [], edge: [], vertex: [] };
    for (const kind of ['face', 'edge', 'vertex']) {
      for (let i = 1; i <= ({ face, edge, vertex }[kind]); i++) {
        const pid = freshPid(kind[0]);   // 'f-…' / 'e-…' / 'v-…'
        this._byPid.set(pid, { kind, occtIndex: i });
        this._byOcct[kind].set(i, pid);
        out[kind].push(pid);
      }
    }
    this._history.push({ event: 'bornBody', kindCounts: { face, edge, vertex } });
    return out;
  }

  // ----------------------- QUERIES ----------------------------------
  pidOf(kind, occtIndex) {
    return this._byOcct[kind]?.get(occtIndex) || null;
  }
  occtOf(pid) {
    const r = this._byPid.get(pid);
    return r && !r.dead ? r.occtIndex : null;
  }
  recordOf(pid) {
    return this._byPid.get(pid) || null;
  }
  livePids(kind) {
    return [...this._byPid.entries()]
      .filter(([_, r]) => r.kind === kind && !r.dead)
      .map(([pid]) => pid);
  }

  // ----------------------- OP APPLICATION ---------------------------
  /**
   * Apply a list of lineage entries from one op. Old occtIndex tables
   * are reset first because the new BREP renumbers everything.
   */
  applyOp(opName, entries) {
    // Snapshot the pids that survive — anything not mentioned dies.
    const survivingPids = new Set();

    // We deliberately rebuild the by-occt tables from scratch so any
    // unmentioned old indices don't bleed into the next op.
    const newByOcct = { face: new Map(), edge: new Map(), vertex: new Map() };

    for (const e of entries) {
      if (e.kind === 'birth') {
        const pid = freshPid((e.entityKind || 'face')[0]);
        const r = {
          kind: e.entityKind || 'face',
          occtIndex: e.newOcctIndex,
          originOp: opName,
        };
        this._byPid.set(pid, r);
        newByOcct[r.kind].set(r.occtIndex, pid);
        survivingPids.add(pid);
        continue;
      }
      if (e.kind === 'survivor') {
        const r = this._byPid.get(e.oldPid);
        if (!r || r.dead) {
          throw new Error(`[forge.topo-ids] survivor of unknown pid ${e.oldPid}`);
        }
        r.occtIndex = e.newOcctIndex;
        newByOcct[r.kind].set(e.newOcctIndex, e.oldPid);
        survivingPids.add(e.oldPid);
        continue;
      }
      if (e.kind === 'split') {
        const r = this._byPid.get(e.oldPid);
        if (!r || r.dead) {
          throw new Error(`[forge.topo-ids] split of unknown pid ${e.oldPid}`);
        }
        // First survivor inherits the original record (lowest occt index
        // wins by convention so picker IDs stay deterministic).
        const sorted = [...e.newOcctIndices].sort((a, b) => a - b);
        r.occtIndex = sorted[0];
        newByOcct[r.kind].set(sorted[0], e.oldPid);
        survivingPids.add(e.oldPid);
        // Subsequent survivors get a NEW pid that records its
        // splitFrom = oldPid for provenance.
        for (let i = 1; i < sorted.length; i++) {
          const newPid = freshPid(r.kind[0]);
          this._byPid.set(newPid, {
            kind: r.kind,
            occtIndex: sorted[i],
            splitFrom: e.oldPid,
            originOp: opName,
          });
          newByOcct[r.kind].set(sorted[i], newPid);
          survivingPids.add(newPid);
        }
        continue;
      }
      if (e.kind === 'merge') {
        if (!Array.isArray(e.oldPids) || e.oldPids.length === 0) {
          throw new Error('[forge.topo-ids] merge requires oldPids[]');
        }
        const winner = e.oldPids[0];
        const r = this._byPid.get(winner);
        if (!r || r.dead) {
          throw new Error(`[forge.topo-ids] merge winner unknown pid ${winner}`);
        }
        r.occtIndex = e.newOcctIndex;
        r.mergedFrom = e.oldPids.slice(1);
        newByOcct[r.kind].set(e.newOcctIndex, winner);
        survivingPids.add(winner);
        // Losers are retired.
        for (let i = 1; i < e.oldPids.length; i++) {
          const lr = this._byPid.get(e.oldPids[i]);
          if (lr) lr.dead = true;
        }
        continue;
      }
      if (e.kind === 'death') {
        const r = this._byPid.get(e.oldPid);
        if (r) r.dead = true;
        continue;
      }
      throw new Error(`[forge.topo-ids] unknown entry kind ${e.kind}`);
    }

    // Any pid that wasn't mentioned by ANY entry survives ONLY if its
    // record was preserved via a survivor. Anyone missing from
    // survivingPids that wasn't already dead is implicitly retired.
    // This matches the "all references must be resolved" rule.
    for (const [pid, r] of this._byPid.entries()) {
      if (!r.dead && !survivingPids.has(pid)) {
        r.dead = true;
      }
    }

    this._byOcct = newByOcct;
    this._history.push({ event: opName, entries: entries.length });
  }
}

/**
 * Convenience helper: walk a sequence of ops and produce the final
 * registry state. Used by the kernel-side test harness and the
 * parametric-history replay tool.
 */
export function buildRegistryFromHistory(births, ops) {
  const reg = new ForgeTopoIdRegistry();
  reg.bornBody(births);
  for (const op of ops) reg.applyOp(op.name, op.entries);
  return reg;
}
