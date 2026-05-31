/**
 * Property manager — the docked panel that lets the user edit the
 * currently-selected feature's parameters. This module owns the data
 * model + change notification; rendering is the panel component's job.
 *
 * A Schema describes the shape of editable values for one entity kind
 * (e.g. "Extrude" → depth, sketchId, direction, drafting…). The panel
 * iterates over a schema's `fields` and renders the right control
 * (number / boolean / vector3 / enum). Each field exposes:
 *   - `read(entity)` and `write(entity, value)` so the schema can sit
 *     above any feature representation without depending on it.
 *   - `validate(value)` so the panel surfaces errors before commit.
 */

export class PropertyField {
  constructor({ key, label, type, read, write, validate, options = null,
                min = null, max = null, step = null, unit = '' }) {
    if (!key) throw new Error('[forge.prop] PropertyField requires key');
    if (!type) throw new Error('[forge.prop] PropertyField requires type');
    this.key = key;
    this.label = label || key;
    this.type = type;    // 'number' | 'boolean' | 'vector3' | 'enum' | 'string' | 'shape-ref'
    this.read = read || ((e) => e[key]);
    this.write = write || ((e, v) => { e[key] = v; });
    this.validate = validate || (() => null);
    this.options = options;
    this.min = min; this.max = max; this.step = step; this.unit = unit;
  }
}

export class PropertySchema {
  constructor({ kind, title, fields = [] }) {
    if (!kind) throw new Error('[forge.prop] PropertySchema requires kind');
    this.kind = kind;
    this.title = title || kind;
    this.fields = fields.map((f) => f instanceof PropertyField ? f : new PropertyField(f));
  }
  field(key) { return this.fields.find((f) => f.key === key); }
}

export class PropertyManager {
  constructor() {
    this._schemas = new Map();      // kind → PropertySchema
    this._selection = null;         // { entity, kind } | null
    this._listeners = new Set();
  }
  register(schema) {
    if (!(schema instanceof PropertySchema)) schema = new PropertySchema(schema);
    this._schemas.set(schema.kind, schema);
    return schema;
  }
  schemaFor(kind) { return this._schemas.get(kind) || null; }

  setSelection(entity, kind) {
    this._selection = entity ? { entity, kind } : null;
    this._notify();
  }
  clearSelection() { this.setSelection(null, null); }
  currentSelection() { return this._selection; }

  /** Returns { schema, values, errors } for the active selection. */
  currentForm() {
    if (!this._selection) return null;
    const schema = this._schemas.get(this._selection.kind);
    if (!schema) return null;
    const values = {}; const errors = {};
    for (const f of schema.fields) {
      values[f.key] = f.read(this._selection.entity);
      const e = f.validate(values[f.key]);
      if (e) errors[f.key] = e;
    }
    return { schema, values, errors };
  }

  /** Apply user edits; emits change. */
  commit(updates) {
    if (!this._selection) return;
    const schema = this._schemas.get(this._selection.kind);
    if (!schema) return;
    for (const [k, v] of Object.entries(updates)) {
      const f = schema.field(k);
      if (!f) continue;
      const err = f.validate(v);
      if (err) throw new Error(`[forge.prop] ${k}: ${err}`);
      f.write(this._selection.entity, v);
    }
    this._notify();
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }
  _notify() {
    for (const fn of this._listeners) {
      try { fn(this.currentForm()); } catch (e) { console.error('[forge.prop]', e); }
    }
  }
}
