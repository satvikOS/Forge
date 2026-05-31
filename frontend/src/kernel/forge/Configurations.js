/**
 * Configurations — named variants of a single part / assembly.
 *
 * A Configuration stores: (a) an override map keyed by feature/param
 * IDs and (b) a list of feature IDs to suppress. Applying a config to
 * a FeatureTree clone produces the variant geometry without disturbing
 * the master tree. A DesignTable expands a CSV (or array of objects)
 * into N Configurations, one per row — the family-parts pattern.
 *
 * No native dependency, no React. The actual feature-tree integration
 * goes in `frontend/src/kernel/forge/FeatureTree.js` (Forge-9 slice)
 * which adds a `cloneFor(config)` method.
 */

let nextId = 1;
function uid(prefix) { return `${prefix}-${nextId++}`; }

export class Configuration {
  constructor({ name, overrides = {}, suppressed = [], description = '' } = {}) {
    if (!name) throw new Error('[forge.config] Configuration requires a name');
    this.id = uid('cfg');
    this.name = name;
    this.description = description;
    // Plain object: { [paramKey]: value }. paramKey convention is
    // `${featureId}.${paramName}` (e.g. "boss-1.depth"). Hierarchical
    // keys keep collisions away even for big trees.
    this.overrides = { ...overrides };
    this.suppressed = new Set(suppressed);
  }
  set(paramKey, value) { this.overrides[paramKey] = value; }
  unset(paramKey) { delete this.overrides[paramKey]; }
  get(paramKey, fallback) {
    return Object.prototype.hasOwnProperty.call(this.overrides, paramKey)
      ? this.overrides[paramKey] : fallback;
  }
  suppress(featureId) { this.suppressed.add(featureId); }
  unsuppress(featureId) { this.suppressed.delete(featureId); }
  isSuppressed(featureId) { return this.suppressed.has(featureId); }
  serialize() {
    return {
      id: this.id, name: this.name, description: this.description,
      overrides: { ...this.overrides },
      suppressed: [...this.suppressed],
    };
  }
}

export class ConfigurationSet {
  constructor() {
    this.configs = new Map(); // id → Configuration
    this.activeId = null;
    this._installDefault();
  }
  _installDefault() {
    const def = new Configuration({ name: 'Default', description: 'Master configuration' });
    this.configs.set(def.id, def);
    this.activeId = def.id;
  }
  add(cfg) {
    if (!(cfg instanceof Configuration)) {
      throw new Error('[forge.config] add() expects a Configuration instance');
    }
    this.configs.set(cfg.id, cfg);
    return cfg;
  }
  remove(id) {
    if (id === this.activeId) {
      // Removing the active config: fall back to first remaining.
      const next = [...this.configs.keys()].find((k) => k !== id);
      this.activeId = next || null;
    }
    return this.configs.delete(id);
  }
  setActive(id) {
    if (!this.configs.has(id)) throw new Error(`[forge.config] unknown config id ${id}`);
    this.activeId = id;
  }
  active() { return this.activeId ? this.configs.get(this.activeId) : null; }
  byName(name) {
    for (const c of this.configs.values()) if (c.name === name) return c;
    return null;
  }
  list() { return [...this.configs.values()]; }

  /**
   * Returns a deep param map that fully describes the model under this
   * config: defaults from the masterTree, then overrides applied. The
   * feature engine reads from this map instead of the raw masterTree
   * when rebuilding.
   *
   * `masterParams` is a plain object: { [paramKey]: defaultValue }.
   */
  resolveParams(masterParams, configId = this.activeId) {
    const cfg = configId ? this.configs.get(configId) : null;
    if (!cfg) return { ...masterParams };
    return { ...masterParams, ...cfg.overrides };
  }
  /** Returns the union of suppressed feature ids under this config. */
  resolveSuppressed(configId = this.activeId) {
    const cfg = configId ? this.configs.get(configId) : null;
    if (!cfg) return new Set();
    return new Set(cfg.suppressed);
  }

  serialize() {
    return {
      activeId: this.activeId,
      configs: this.list().map((c) => c.serialize()),
    };
  }
  static deserialize(json) {
    const s = new ConfigurationSet();
    s.configs.clear();
    for (const c of json.configs || []) {
      const cfg = new Configuration({
        name: c.name, description: c.description,
        overrides: c.overrides || {}, suppressed: c.suppressed || [],
      });
      cfg.id = c.id;
      s.configs.set(cfg.id, cfg);
    }
    s.activeId = json.activeId && s.configs.has(json.activeId) ? json.activeId
                : (s.configs.size ? [...s.configs.keys()][0] : null);
    return s;
  }
}

/**
 * Design table — rows × columns of override values, expanded into a
 * ConfigurationSet. Accepts either:
 *   - parsed rows: [{ Name: 'M3', diameter: 3, length: 10 }, ...]
 *   - raw CSV string with a header row (first column = config name).
 *
 * `paramMap` is an optional object mapping column header → param key
 * in the feature tree, e.g. { diameter: 'boss-1.r', length: 'boss-1.h' }.
 * Without it we keep the column header as the param key.
 */
export class DesignTable {
  static fromRows(rows, paramMap = null) {
    const set = new ConfigurationSet();
    set.configs.clear();
    for (const row of rows) {
      const name = row.Name || row.name || row.Configuration;
      if (!name) throw new Error('[forge.dtable] every row needs a Name column');
      const overrides = {};
      for (const [k, v] of Object.entries(row)) {
        if (k === 'Name' || k === 'name' || k === 'Configuration') continue;
        const key = paramMap && paramMap[k] ? paramMap[k] : k;
        overrides[key] = v;
      }
      const cfg = new Configuration({ name, overrides });
      set.configs.set(cfg.id, cfg);
    }
    if (set.configs.size === 0) {
      throw new Error('[forge.dtable] cannot create empty design table');
    }
    set.activeId = [...set.configs.keys()][0];
    return set;
  }
  static fromCsv(csv, paramMap = null) {
    const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) throw new Error('[forge.dtable] CSV needs a header + ≥1 row');
    const headers = lines[0].split(',').map((h) => h.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(',').map((c) => c.trim());
      const row = {};
      headers.forEach((h, j) => {
        const cell = cells[j];
        const asNum = Number(cell);
        row[h] = (cell === '' || Number.isNaN(asNum)) ? cell : asNum;
      });
      rows.push(row);
    }
    return DesignTable.fromRows(rows, paramMap);
  }
}
