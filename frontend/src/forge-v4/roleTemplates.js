// Forge-137 — Role templates.
//
// Six curated user roles. Each role bundles:
//   - the workbench it lands the user in by default,
//   - a list of toolbar groups (subset of Toolbar.jsx SPEC) that appear
//     at the top of the toolbar in the order given,
//   - a list of recommended right-side panels the shell should pop on
//     entry,
//   - a hint string the RoleSwitcher renders under the role name.
//
// Toolbar.jsx's SPEC stays the source of truth for tool definitions;
// the role just re-orders + filters which groups stay visible.
//
// Role ids are stable so they can survive localStorage round-trips.

export const ROLE_TEMPLATES = Object.freeze([
  Object.freeze({
    id: 'designer',
    label: 'Designer',
    hint:  'Solid + sketch + assembly. Default for new users.',
    defaultWorkbench: 'mech',
    toolbarGroups: [
      // workbench → group labels in the order to show; '*' = all groups.
      { workbench: 'mech', groups: ['Sketch', 'Solid', 'Pattern', 'Boolean'] },
    ],
    panels: ['featureTree', 'configurations'],
    accent: '#6cd0e8',
  }),
  Object.freeze({
    id: 'drafter',
    label: 'Drafter',
    hint:  '2D drawings, dimensions, title-block work.',
    defaultWorkbench: 'drawing',
    toolbarGroups: [
      { workbench: 'drawing', groups: ['Views', 'Dimension', 'Annotate'] },
    ],
    panels: ['drawingsInspector', 'revisionTable'],
    accent: '#f0c674',
  }),
  Object.freeze({
    id: 'fea',
    label: 'FEA Analyst',
    hint:  'Studies, convergence, scenario sweeps.',
    defaultWorkbench: 'sim',
    toolbarGroups: [
      { workbench: 'sim',  groups: ['Study'] },
      { workbench: 'mech', groups: ['Measure'] },
    ],
    panels: ['convergenceChart', 'scenarioRunner'],
    accent: '#c894dc',
  }),
  Object.freeze({
    id: 'cam',
    label: 'CAM Programmer',
    hint:  'Toolpaths, posts, stock simulation.',
    defaultWorkbench: 'mfg',
    toolbarGroups: [
      { workbench: 'mfg', groups: ['Toolpaths'] },
    ],
    panels: ['stockSimulator', 'cutListPanel'],
    accent: '#8fd181',
  }),
  Object.freeze({
    id: 'bim',
    label: 'BIM Modeler',
    hint:  'IFC4 export, structural members, building schedules.',
    defaultWorkbench: 'weld',
    toolbarGroups: [
      { workbench: 'weld', groups: ['Weldments'] },
      { workbench: 'mech', groups: ['Sketch', 'Solid'] },
    ],
    panels: ['ifcExport', 'bomPanel'],
    accent: '#f08a8a',
  }),
  Object.freeze({
    id: 'educator',
    label: 'Educator',
    hint:  'Minimal toolbar, big buttons, every workbench visible.',
    defaultWorkbench: 'mech',
    toolbarGroups: [
      { workbench: 'mech', groups: ['Sketch', 'Solid'] },
      { workbench: 'drawing', groups: ['Views', 'Dimension'] },
    ],
    panels: ['helpDrawer', 'featureTree'],
    accent: '#85b3f0',
  }),
]);

export const ROLE_COUNT = ROLE_TEMPLATES.length;
export const DEFAULT_ROLE_ID = 'designer';
export const ROLE_STORAGE_KEY = 'forge.v4.role';
export const CUSTOM_ROLE_STORAGE_KEY = 'forge.v4.customRoles';

/** Lookup a role by id, falling back to the designer template. */
export function getRole(id) {
  return ROLE_TEMPLATES.find((r) => r.id === id) || ROLE_TEMPLATES[0];
}

/** Load + merge custom roles from localStorage. Pure read. */
export function getCustomRoles() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CUSTOM_ROLE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function getAllRoles() {
  return [...ROLE_TEMPLATES, ...getCustomRoles()];
}

/** Persist a custom role. Returns the saved record. */
export function saveCustomRole(role) {
  if (!role || !role.id || !role.label) {
    throw new Error('Custom role requires id + label');
  }
  if (typeof localStorage === 'undefined') return role;
  const arr = getCustomRoles().filter((r) => r.id !== role.id);
  arr.push(role);
  localStorage.setItem(CUSTOM_ROLE_STORAGE_KEY, JSON.stringify(arr));
  return role;
}

/** Read the persisted active-role id (or default). */
export function getActiveRoleId() {
  if (typeof localStorage === 'undefined') return DEFAULT_ROLE_ID;
  try {
    const raw = localStorage.getItem(ROLE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : DEFAULT_ROLE_ID;
  } catch { return DEFAULT_ROLE_ID; }
}

/** Persist the active-role id and broadcast a custom event. */
export function setActiveRoleId(id) {
  if (typeof localStorage !== 'undefined') {
    try { localStorage.setItem(ROLE_STORAGE_KEY, JSON.stringify(id)); } catch {}
  }
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('forge:role-changed', { detail: { id } }));
    } catch {}
  }
}

/**
 * Apply a role to a toolbar SPEC (the export from Toolbar.jsx) and
 * return a new SPEC keyed identically but with groups filtered + reordered
 * to match the role's toolbarGroups list. Workbench keys absent from
 * the role pass through untouched so the user can still switch.
 */
export function applyRoleToSpec(role, spec) {
  if (!role || !spec) return spec;
  const next = { ...spec };
  for (const wbCfg of role.toolbarGroups) {
    const src = spec[wbCfg.workbench];
    if (!Array.isArray(src)) continue;
    if (wbCfg.groups[0] === '*') {
      next[wbCfg.workbench] = src.slice();
      continue;
    }
    const reorder = wbCfg.groups
      .map((lbl) => src.find((g) => g.label === lbl))
      .filter(Boolean);
    if (reorder.length) next[wbCfg.workbench] = reorder;
  }
  return next;
}
