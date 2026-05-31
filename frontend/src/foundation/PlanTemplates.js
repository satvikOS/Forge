/**
 * ArchDisc Foundation — plan template library.
 *
 * A template is a saved {domain, prompt, plan} triple a user can
 * apply as a one-click starter instead of re-running the whole
 * Clarifier → Planner loop. Two sources:
 *
 *   - BUILTIN_TEMPLATES: ship with ArchDisc, derived from the
 *     canonical fallback plans. Always present.
 *   - User templates: saved to localStorage under
 *     `archdisc.planTemplates`, created via saveTemplate().
 *
 * listTemplates() merges both, builtins first. Builtin ids are
 * prefixed `builtin-` so the UI can forbid deleting them.
 */

import { JET_ENGINE_PLAN } from '../ai/PlanExecutor.js';

const STORE_KEY = 'archdisc.planTemplates';

export const BUILTIN_TEMPLATES = [
  {
    id: 'builtin-turbofan',
    name: 'Turbofan engine (A350-class)',
    domain: 'engine',
    prompt: 'Design a turbofan engine for an Airbus A350-class airliner.',
    plan: JET_ENGINE_PLAN,
    builtin: true,
  },
  {
    id: 'builtin-bracket',
    name: 'Structural bracket',
    domain: 'structure',
    prompt: 'Design a load-bearing structural bracket.',
    plan: [
      { tool: 'Extrude Boss',      comment: 'Bracket starter geometry' },
      { tool: 'Linear Static FEA', comment: 'Stress + safety factor under load' },
      { tool: 'Fatigue Analysis',  comment: 'Cyclic life check' },
      { tool: 'Stress Concentration', comment: 'Notch / fillet K_t check' },
      { tool: 'Mass Properties',   comment: 'Inertia + mass for the assembly' },
      { tool: 'Export STEP',       comment: 'Vendor hand-off' },
    ],
    builtin: true,
  },
  {
    id: 'builtin-gearbox',
    name: 'Planetary gearbox',
    domain: 'gearbox',
    prompt: 'Design a planetary gearbox reduction stage.',
    plan: [
      { tool: 'Gear Mesh',     comment: 'AGMA Lewis bending + Hertz contact' },
      { tool: 'Shaft Sizing',  comment: 'DE-Goodman shaft diameter' },
      { tool: 'Bearing Life',  comment: 'Lundberg-Palmgren L10' },
      { tool: 'Revolve Boss',  comment: 'Shaft body geometry for inertia/export' },
      { tool: 'Mass Properties', comment: 'Inertia tensor' },
      { tool: 'Rotordynamics', comment: 'Critical-speed check' },
      { tool: 'Export STEP',   comment: 'Vendor hand-off' },
    ],
    builtin: true,
  },
  {
    id: 'builtin-pressure-vessel',
    name: 'ASME pressure vessel',
    domain: 'pressure_vessel',
    prompt: 'Design an ASME BPVC pressure vessel.',
    plan: [
      { tool: 'Pressure Vessel', comment: 'Thin/thick wall + ASME min thickness' },
      { tool: 'Linear Static FEA', comment: 'Stress under design pressure' },
      { tool: 'Fatigue Analysis', comment: 'Pressure-cycle fatigue' },
      { tool: 'Revolve Boss',    comment: 'Vessel body geometry for inertia/export' },
      { tool: 'Mass Properties', comment: 'Mass + inertia' },
      { tool: 'Export STEP',     comment: 'Vendor hand-off' },
    ],
    builtin: true,
  },
];

function safeLs() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; }
  catch { return null; }
}

function readUser() {
  const ls = safeLs(); if (!ls) return [];
  try {
    const raw = ls.getItem(STORE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function writeUser(arr) {
  const ls = safeLs(); if (!ls) return;
  ls.setItem(STORE_KEY, JSON.stringify(arr));
}

/** All templates — builtins first, then user templates. */
export function listTemplates() {
  return [...BUILTIN_TEMPLATES, ...readUser()];
}

export function findTemplate(id) {
  return listTemplates().find(t => t.id === id) ?? null;
}

/**
 * Save a new user template. `name` collisions get a counter suffix.
 * Returns the new entry.
 */
export function saveTemplate({ name, domain, prompt, plan }) {
  const user = readUser();
  const all = listTemplates();
  let finalName = name || 'Untitled template', n = 1;
  while (all.some(t => t.name === finalName)) {
    n++;
    finalName = `${name} (${n})`;
  }
  const tpl = {
    id: `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: finalName,
    domain: domain ?? 'generic',
    prompt: prompt ?? '',
    plan: plan ?? [],
    builtin: false,
    savedAt: new Date().toISOString(),
  };
  user.push(tpl);
  writeUser(user);
  return tpl;
}

/** Delete a user template by id. Builtins can't be deleted. */
export function deleteTemplate(id) {
  if (id.startsWith('builtin-')) return readUser();
  const user = readUser().filter(t => t.id !== id);
  writeUser(user);
  return user;
}
