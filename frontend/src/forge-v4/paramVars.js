// Parametric variables + cascade (parity #56) — pure, DOM-free,
// node-testable; behaviorally-identical copy of Studio (header differs).
//
// The MUST-reference bar (V-358 tape measure): model an EXACT part, then
// "blow it up 10× bigger" and have every dimension cascade — and, per the
// competitor-tech reliability lesson, let the user tweak a dimension via a
// slider WITHOUT re-invoking the model. Both need the same primitive: a
// feature tree whose numeric params can reference NAMED variables, plus a
// resolver that turns (tree + vars) → concrete geometry params.
//
// A variable reference is a small object in a numeric field:
//   { $: 'width' }                 → vars.width
//   { $: 'width', mul: 0.5 }       → vars.width * 0.5
//   { $: 'width', mul: 2, add: 1 } → vars.width * 2 + 1
// This linear form (mul/add) covers the cascading-scale and
// proportional-dimension cases without an expression evaluator (no eval,
// no injection surface — the context-window/no-eval discipline).
//
// Built adversarially: missing var → keep the ref + flag (never silently
// 0), non-finite values flagged, deep params walked, arrays handled,
// input never mutated.

const isRef = (v) => v && typeof v === 'object' && typeof v.$ === 'string';

function _resolveValue(v, vars, missing) {
  if (isRef(v)) {
    const base = vars ? vars[v.$] : undefined;
    if (!Number.isFinite(base)) { missing.push(v.$); return v; } // unresolved → keep ref
    const mul = Number.isFinite(v.mul) ? v.mul : 1;
    const add = Number.isFinite(v.add) ? v.add : 0;
    return base * mul + add;
  }
  if (Array.isArray(v)) return v.map((x) => _resolveValue(x, vars, missing));
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = _resolveValue(v[k], vars, missing);
    return out;
  }
  return v;
}

// Resolve one params object against vars. Returns { params, missing }.
export function resolveParams(params, vars) {
  const missing = [];
  const resolved = _resolveValue(params == null ? {} : params, vars || {}, missing);
  return { params: resolved, missing: Array.from(new Set(missing)) };
}

// Resolve a whole parametric model: { vars:{name:value}, features:[{...,params}] }.
// Returns { features:[...resolved], missing:[...], ok }.
export function resolveModel(model) {
  const vars = (model && model.vars) || {};
  const feats = (model && Array.isArray(model.features)) ? model.features : [];
  const allMissing = [];
  const features = feats.map((f) => {
    if (!f || typeof f !== 'object') return f;
    const { params, missing } = resolveParams(f.params, vars);
    allMissing.push(...missing);
    return { ...f, params };
  });
  const missing = Array.from(new Set(allMissing));
  return { features, missing, ok: missing.length === 0 };
}

// Set one variable → NEW model (input untouched). This is the local
// slider edit: re-resolve geometry with zero model inference.
export function setVar(model, name, value) {
  const vars = { ...((model && model.vars) || {}) };
  if (typeof name === 'string' && Number.isFinite(value)) vars[name] = value;
  return { ...(model || {}), vars };
}

// The "10× bigger" cascade: multiply every variable by `factor` (uniform
// parametric scale). Non-finite factor → unchanged.
export function scaleModel(model, factor) {
  if (!Number.isFinite(factor) || factor === 0) return { ...(model || {}), vars: { ...((model && model.vars) || {}) } };
  const src = (model && model.vars) || {};
  const vars = {};
  for (const k of Object.keys(src)) vars[k] = Number.isFinite(src[k]) ? src[k] * factor : src[k];
  return { ...(model || {}), vars };
}

// Auto-parametrize: scan features' numeric params, surface the distinct
// values as named vars and rewrite those fields as refs — so an ad-hoc
// model becomes slider-driven (the competitor "automatic parametrization"
// + the reliability premise). `name(path,value)` lets the caller label.
export function autoParametrize(features, nameFn) {
  const vars = {};
  const seen = new Map(); // value → varName (dedupe identical dims)
  let counter = 0;
  const label = typeof nameFn === 'function' ? nameFn
    : (_p, v) => `d${(Math.round(v * 1000) / 1000).toString().replace(/[^0-9]/g, '_')}`;
  const walk = (v, path) => {
    if (typeof v === 'number' && Number.isFinite(v) && v !== 0) {
      if (seen.has(v)) return { $: seen.get(v) };
      let nm = label(path, v) || `var${counter}`;
      while (vars[nm] !== undefined && vars[nm] !== v) nm = `${nm}_${counter}`;
      counter++;
      vars[nm] = v; seen.set(v, nm);
      return { $: nm };
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`));
    if (v && typeof v === 'object' && !isRef(v)) {
      const o = {}; for (const k of Object.keys(v)) o[k] = walk(v[k], `${path}.${k}`); return o;
    }
    return v;
  };
  const out = (features || []).map((f) => (f && typeof f === 'object')
    ? { ...f, params: walk(f.params || {}, f.toolId || f.id || '') } : f);
  return { vars, features: out };
}
