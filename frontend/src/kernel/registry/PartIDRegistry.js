/**
 * ArchDisc — Part ID Registry
 *
 * Global registry that assigns and tracks unique IDs for every component
 * in every assembly. Used by:
 *   - Side panel for component listing
 *   - Click-to-focus feature for navigation
 *   - Project export (per-component file naming)
 *   - Interaction recorder (referencing components)
 *   - Real-world test runner (selecting components for tests)
 *
 * ID format: PROJECT-CATEGORY-SUBSYSTEM-NNNN
 *   e.g. GE9X-FAN-BLD-0001  (GE9X engine, fan, blade, 0001)
 *        ARCH-WIN-FRM-0042  (architecture, window, frame, 42)
 *
 * Single source of truth — every PartInstance auto-registers on creation
 * via Assembly.addPart() integration (ID becomes part.partID).
 */

const _byID = new Map();              // partID → entry
const _byCategory = new Map();         // category → Set<partID>
const _bySubsystem = new Map();        // subsystem → Set<partID>
const _byMaterial = new Map();         // material → Set<partID>
const _counters = new Map();           // category-subsystem → next seq
const _listeners = new Set();

let _projectCode = 'PROJ';

function _key(category, subsystem) {
  return `${category}-${subsystem}`;
}

function _addToIndex(map, key, partID) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(partID);
}

function _removeFromIndex(map, key, partID) {
  const s = map.get(key);
  if (s) {
    s.delete(partID);
    if (s.size === 0) map.delete(key);
  }
}

export default class PartIDRegistry {

  /**
   * Set the active project code (e.g. 'GE9X', 'TRT1000').
   * All subsequent IDs use this prefix.
   */
  static setProject(code) {
    _projectCode = String(code).toUpperCase().substring(0, 8);
  }

  static getProject() {
    return _projectCode;
  }

  /**
   * Register a part. Generates a unique ID and stores metadata.
   * @param {object} info
   * @param {string} info.category    e.g. 'FAN', 'TURB', 'COMB'
   * @param {string} info.subsystem   e.g. 'BLD', 'DSK', 'CSG'
   * @param {string} info.name        human-readable name
   * @param {string} [info.material]
   * @param {string} [info.parentID]  parent component for hierarchy
   * @param {object} [info.metadata]  additional fields
   * @param {object} [info.partInstance] back-reference to PartInstance
   * @returns {string} the new partID
   */
  static register(info) {
    const cat = String(info.category || 'GEN').toUpperCase().substring(0, 4);
    const sub = String(info.subsystem || 'PRT').toUpperCase().substring(0, 3);
    const k = _key(cat, sub);

    const next = (_counters.get(k) || 0) + 1;
    _counters.set(k, next);

    const seq = next.toString().padStart(4, '0');
    const partID = `${_projectCode}-${cat}-${sub}-${seq}`;

    const entry = {
      partID,
      category: cat,
      subsystem: sub,
      sequence: next,
      name: info.name || partID,
      material: info.material || 'Unknown',
      parentID: info.parentID || null,
      children: [],
      metadata: { ...(info.metadata || {}) },
      partInstance: info.partInstance || null,
      registeredAt: Date.now(),
      tests: [],          // real-world test results attached here
      analyses: [],       // FEA / CFD / modal results
      revisions: [],      // version history
    };

    _byID.set(partID, entry);
    _addToIndex(_byCategory, cat, partID);
    _addToIndex(_bySubsystem, sub, partID);
    _addToIndex(_byMaterial, entry.material, partID);

    if (entry.parentID && _byID.has(entry.parentID)) {
      _byID.get(entry.parentID).children.push(partID);
    }

    if (info.partInstance) {
      info.partInstance.partID = partID;
    }

    _notify('registered', entry);
    return partID;
  }

  /** Look up a part entry by ID. */
  static get(partID) {
    return _byID.get(partID) || null;
  }

  /** Does a part with this ID exist? */
  static has(partID) {
    return _byID.has(partID);
  }

  /** Total registered parts. */
  static size() {
    return _byID.size;
  }

  /** All part IDs (iterable). */
  static allIDs() {
    return Array.from(_byID.keys());
  }

  /** All entries as an array. */
  static all() {
    return Array.from(_byID.values());
  }

  /** Parts in a category. */
  static byCategory(cat) {
    const set = _byCategory.get(String(cat).toUpperCase());
    return set ? Array.from(set).map(id => _byID.get(id)) : [];
  }

  /** Parts in a subsystem. */
  static bySubsystem(sub) {
    const set = _bySubsystem.get(String(sub).toUpperCase());
    return set ? Array.from(set).map(id => _byID.get(id)) : [];
  }

  /** Parts of a material. */
  static byMaterial(mat) {
    const set = _byMaterial.get(mat);
    return set ? Array.from(set).map(id => _byID.get(id)) : [];
  }

  /** Search by name substring (case-insensitive). */
  static search(query, limit = 100) {
    const q = String(query || '').toLowerCase();
    if (!q) return [];
    const out = [];
    for (const entry of _byID.values()) {
      if (entry.name.toLowerCase().includes(q) || entry.partID.toLowerCase().includes(q)) {
        out.push(entry);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  /** All children of a part (recursive). */
  static descendants(partID) {
    const root = _byID.get(partID);
    if (!root) return [];
    const out = [];
    const stack = [...root.children];
    while (stack.length) {
      const id = stack.pop();
      const entry = _byID.get(id);
      if (entry) {
        out.push(entry);
        stack.push(...entry.children);
      }
    }
    return out;
  }

  /** Tree representation rooted at parts with no parent. */
  static tree() {
    const roots = [];
    for (const entry of _byID.values()) {
      if (!entry.parentID) roots.push(entry);
    }
    function build(entry) {
      return {
        id: entry.partID,
        name: entry.name,
        category: entry.category,
        subsystem: entry.subsystem,
        material: entry.material,
        children: entry.children
          .map(cid => _byID.get(cid))
          .filter(Boolean)
          .map(build),
      };
    }
    return roots.map(build);
  }

  /** Attach a test result to a part. */
  static attachTest(partID, testResult) {
    const entry = _byID.get(partID);
    if (!entry) return false;
    entry.tests.push({ ...testResult, recordedAt: Date.now() });
    _notify('testAttached', { partID, testResult });
    return true;
  }

  /** Attach an analysis result to a part. */
  static attachAnalysis(partID, analysisResult) {
    const entry = _byID.get(partID);
    if (!entry) return false;
    entry.analyses.push({ ...analysisResult, recordedAt: Date.now() });
    _notify('analysisAttached', { partID, analysisResult });
    return true;
  }

  /** Record a revision. */
  static recordRevision(partID, message, author = 'system') {
    const entry = _byID.get(partID);
    if (!entry) return false;
    entry.revisions.push({
      revision: entry.revisions.length + 1,
      message,
      author,
      at: Date.now(),
    });
    return true;
  }

  /** Statistics for the registry. */
  static stats() {
    const byCat = {};
    for (const [cat, set] of _byCategory) byCat[cat] = set.size;
    const bySub = {};
    for (const [sub, set] of _bySubsystem) bySub[sub] = set.size;
    const byMat = {};
    for (const [mat, set] of _byMaterial) byMat[mat] = set.size;
    return {
      total: _byID.size,
      project: _projectCode,
      byCategory: byCat,
      bySubsystem: bySub,
      byMaterial: byMat,
      totalTests: Array.from(_byID.values()).reduce((s, e) => s + e.tests.length, 0),
      totalAnalyses: Array.from(_byID.values()).reduce((s, e) => s + e.analyses.length, 0),
    };
  }

  /** Subscribe to registry events. Returns an unsubscribe fn. */
  static onChange(cb) {
    _listeners.add(cb);
    return () => _listeners.delete(cb);
  }

  /** Reset the registry — useful for tests. */
  static reset() {
    _byID.clear();
    _byCategory.clear();
    _bySubsystem.clear();
    _byMaterial.clear();
    _counters.clear();
    _projectCode = 'PROJ';
    _notify('reset', null);
  }

  /** Remove a part from the registry. */
  static unregister(partID) {
    const entry = _byID.get(partID);
    if (!entry) return false;
    _byID.delete(partID);
    _removeFromIndex(_byCategory, entry.category, partID);
    _removeFromIndex(_bySubsystem, entry.subsystem, partID);
    _removeFromIndex(_byMaterial, entry.material, partID);
    if (entry.parentID && _byID.has(entry.parentID)) {
      const parent = _byID.get(entry.parentID);
      parent.children = parent.children.filter(c => c !== partID);
    }
    _notify('unregistered', entry);
    return true;
  }

  /** Serialize entire registry to JSON. */
  static toJSON() {
    const entries = [];
    for (const e of _byID.values()) {
      entries.push({
        partID: e.partID,
        category: e.category,
        subsystem: e.subsystem,
        sequence: e.sequence,
        name: e.name,
        material: e.material,
        parentID: e.parentID,
        children: [...e.children],
        metadata: e.metadata,
        registeredAt: e.registeredAt,
        tests: e.tests,
        analyses: e.analyses,
        revisions: e.revisions,
      });
    }
    return {
      project: _projectCode,
      counters: Array.from(_counters.entries()),
      entries,
    };
  }
}

function _notify(event, data) {
  for (const cb of _listeners) {
    try { cb(event, data); } catch (e) { /* ignore listener errors */ }
  }
}
