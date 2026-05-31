/**
 * ForgeProject — the persistence envelope for a Forge document.
 *
 * Aggregates every JS-side authoring layer (FeatureTree,
 * ConfigurationSet, ReferenceFrame, PartStore, specialty routes /
 * schematics / molds / MBD annotations) into a single JSON blob the
 * file menu can write to disk and read back. The native BREPs aren't
 * persisted directly here — they're content-addressed by `blobHash`
 * inside PartStore versions; the file is rehydrated by re-running the
 * FeatureTree against the kernel.
 *
 * `version` lets us bump the file format without breaking older saves —
 * `migrate()` walks a chain of upgraders from the file's version to
 * the current one.
 */

import { FeatureTree } from './FeatureTree.js';
import { ConfigurationSet } from './Configurations.js';
import { ReferenceFrame } from './ReferenceGeometry.js';
import { PartStore, PartHistory } from './Pdm.js';

export const CURRENT_VERSION = 1;

export class ForgeProject {
  constructor({ name = 'Untitled', units = 'mm', author = 'unknown' } = {}) {
    this.version = CURRENT_VERSION;
    this.name = name;
    this.units = units;
    this.author = author;
    this.createdAt = Date.now();
    this.updatedAt = this.createdAt;

    this.featureTree = new FeatureTree();
    this.configurations = new ConfigurationSet();
    this.referenceFrame = new ReferenceFrame();
    this.partStore = new PartStore();

    // Specialty bags — kept as plain serialisable arrays; the specialty
    // modules' constructors hydrate them on load.
    this.routes = [];
    this.schematics = [];
    this.molds = [];
    this.annotations = [];      // MBD AnnotationSet's list()
    this.drawings = [];         // drawing-view metadata; the polylines are
                                // recomputed from the native kernel on demand
  }

  touch() { this.updatedAt = Date.now(); }

  /**
   * Build the JSON payload. Returns a plain object — callers pick the
   * serialisation (JSON.stringify, a binary container, IndexedDB row,
   * Git LFS blob…).
   */
  toJSON() {
    return {
      version: this.version,
      meta: { name: this.name, units: this.units, author: this.author,
              createdAt: this.createdAt, updatedAt: this.updatedAt },
      featureTree:    this.featureTree.serialize(),
      configurations: this.configurations.serialize(),
      referenceFrame: this.referenceFrame.serialize(),
      partStore: {
        histories: [...this.partStore.histories.values()].map((h) => h.serialize()),
        ecos: [...this.partStore.ecos.values()].map((e) => e.serialize()),
      },
      specialty: {
        routes: this.routes,
        schematics: this.schematics,
        molds: this.molds,
        annotations: this.annotations,
        drawings: this.drawings,
      },
    };
  }

  /**
   * Reconstruct from a JSON payload. Handles version migration if
   * needed. Throws on shape errors so the caller can show a friendly
   * "this file isn't a Forge project" message.
   */
  static fromJSON(json) {
    if (!json || typeof json !== 'object') {
      throw new Error('[forge.project] payload is not an object');
    }
    if (typeof json.version !== 'number') {
      throw new Error('[forge.project] missing version field');
    }
    const migrated = migrate(json, json.version, CURRENT_VERSION);
    const p = new ForgeProject({
      name: migrated.meta?.name, units: migrated.meta?.units,
      author: migrated.meta?.author,
    });
    p.version = CURRENT_VERSION;
    p.createdAt = migrated.meta?.createdAt ?? Date.now();
    p.updatedAt = migrated.meta?.updatedAt ?? Date.now();

    p.featureTree    = FeatureTree.deserialize(migrated.featureTree || {});
    p.configurations = ConfigurationSet.deserialize(migrated.configurations || {});
    p.referenceFrame = ReferenceFrame.deserialize(migrated.referenceFrame || { entities: [] });

    p.partStore = new PartStore();
    for (const h of migrated.partStore?.histories || []) {
      const hist = PartHistory.deserialize(h);
      p.partStore.histories.set(hist.partId, hist);
    }
    // ECOs are intentionally not constructable from the serialised form
    // in this slice — they pin author + timeline, which we'll restore
    // verbatim in Forge-19b. For now they round-trip as inert dicts so
    // we don't drop user data.
    for (const e of migrated.partStore?.ecos || []) {
      p.partStore.ecos.set(e.id, { ...e, _rehydrated: true });
    }

    const sp = migrated.specialty || {};
    p.routes      = sp.routes      || [];
    p.schematics  = sp.schematics  || [];
    p.molds       = sp.molds       || [];
    p.annotations = sp.annotations || [];
    p.drawings    = sp.drawings    || [];

    return p;
  }
}

// ===================================================================
//                       version migration chain
// ===================================================================

const MIGRATIONS = {
  // 0 → 1 example. Each entry rewrites the payload by one version.
  // 0: (j) => ({ ...j, version: 1, units: j.units || 'mm' }),
};

function migrate(json, from, to) {
  let v = from;
  let j = json;
  while (v < to) {
    const fn = MIGRATIONS[v];
    if (!fn) {
      throw new Error(`[forge.project] no migration from version ${v} → ${v + 1}`);
    }
    j = fn(j);
    v++;
  }
  if (v > to) {
    throw new Error(`[forge.project] payload is newer (v${v}) than this build (v${to})`);
  }
  return j;
}
