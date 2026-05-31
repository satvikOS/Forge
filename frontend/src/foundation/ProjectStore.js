/**
 * ArchDisc Foundation — multi-project store.
 *
 * Promotes the single-session localStorage slot (`archdisc.session`)
 * into a keyed library of named projects:
 *
 *   localStorage['archdisc.projects'] →
 *     [{ id, name, createdAt, savedAt, snapshot }, ...]
 *   localStorage['archdisc.activeProjectId'] →  "<id>"
 *
 * `snapshot` is the same JSON payload the AIChatPanel already
 * persists (messages, phase, plan, cert/DFM/cost reports, etc).
 * Callers don't need to know its shape — ProjectStore treats it
 * as an opaque blob.
 *
 * On legacy upgrade: if `archdisc.session` exists but
 * `archdisc.projects` doesn't, we migrate the old slot into a
 * single "Default project" entry so users don't lose work.
 */

const PROJECTS_KEY = 'archdisc.projects';
const ACTIVE_KEY   = 'archdisc.activeProjectId';
const LEGACY_KEY   = 'archdisc.session';

function safeLs() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; }
  catch { return null; }
}

function newId() {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Read all projects, migrating the legacy single-session slot. */
export function listProjects() {
  const ls = safeLs(); if (!ls) return [];
  try {
    const raw = ls.getItem(PROJECTS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch { /* fall through to migration */ }

  // Migrate legacy single-session slot if present.
  const legacy = ls.getItem(LEGACY_KEY);
  if (legacy) {
    try {
      const snapshot = JSON.parse(legacy);
      const migrated = [{
        id: newId(),
        name: 'Default project',
        createdAt: snapshot.savedAt ?? new Date().toISOString(),
        savedAt:   snapshot.savedAt ?? new Date().toISOString(),
        snapshot,
      }];
      ls.setItem(PROJECTS_KEY, JSON.stringify(migrated));
      ls.setItem(ACTIVE_KEY, migrated[0].id);
      ls.removeItem(LEGACY_KEY);
      return migrated;
    } catch { /* legacy unreadable, ignore */ }
  }
  return [];
}

export function getActiveProjectId() {
  const ls = safeLs(); if (!ls) return null;
  return ls.getItem(ACTIVE_KEY);
}

export function setActiveProjectId(id) {
  const ls = safeLs(); if (!ls) return;
  if (id) ls.setItem(ACTIVE_KEY, id);
  else    ls.removeItem(ACTIVE_KEY);
}

export function getActiveProject() {
  const id = getActiveProjectId();
  if (!id) return null;
  return listProjects().find(p => p.id === id) ?? null;
}

/** Replace the whole array. */
function writeAll(projects) {
  const ls = safeLs(); if (!ls) return;
  ls.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

/**
 * Create a fresh project. Returns the new entry.
 * If `name` collides, appends a counter.
 */
export function createProject(name = 'Untitled project') {
  const projects = listProjects();
  let finalName = name, n = 1;
  while (projects.some(p => p.name === finalName)) {
    n++;
    finalName = `${name} (${n})`;
  }
  const now = new Date().toISOString();
  const project = {
    id: newId(), name: finalName,
    createdAt: now, savedAt: now,
    snapshot: null,
  };
  projects.push(project);
  writeAll(projects);
  setActiveProjectId(project.id);
  return project;
}

/** Save (overwrite) the active project's snapshot. */
export function saveSnapshot(snapshot) {
  const id = getActiveProjectId();
  if (!id) return null;
  const projects = listProjects();
  const idx = projects.findIndex(p => p.id === id);
  if (idx < 0) return null;
  projects[idx] = { ...projects[idx], savedAt: new Date().toISOString(), snapshot };
  writeAll(projects);
  return projects[idx];
}

export function renameProject(id, name) {
  if (!name.trim()) return null;
  const projects = listProjects();
  const idx = projects.findIndex(p => p.id === id);
  if (idx < 0) return null;
  projects[idx] = { ...projects[idx], name: name.trim() };
  writeAll(projects);
  return projects[idx];
}

export function deleteProject(id) {
  const projects = listProjects().filter(p => p.id !== id);
  writeAll(projects);
  if (getActiveProjectId() === id) {
    setActiveProjectId(projects[0]?.id ?? null);
  }
  return projects;
}

/**
 * Serialise a project (by id) to a portable JSON blob suitable
 * for saving to disk. Schema-tagged so future readers can verify.
 */
export function serializeProject(id) {
  const proj = listProjects().find(p => p.id === id);
  if (!proj) return null;
  return {
    schema: 'archdisc-project-1.0',
    exportedAt: new Date().toISOString(),
    project: {
      name: proj.name,
      createdAt: proj.createdAt,
      savedAt: proj.savedAt,
      snapshot: proj.snapshot,
    },
  };
}

/**
 * Take a parsed JSON blob produced by serializeProject and import
 * it as a new project. If the name collides, the counter suffix
 * pattern from createProject is applied. Becomes the active project.
 * Returns the new entry, or null if the blob is malformed.
 */
export function importProject(blob) {
  if (!blob || typeof blob !== 'object') return null;
  if (blob.schema !== 'archdisc-project-1.0') return null;
  const src = blob.project;
  if (!src || typeof src.name !== 'string') return null;
  const projects = listProjects();
  let finalName = src.name, n = 1;
  while (projects.some(p => p.name === finalName)) {
    n++;
    finalName = `${src.name} (${n})`;
  }
  const now = new Date().toISOString();
  const project = {
    id: newId(),
    name: finalName,
    createdAt: src.createdAt ?? now,
    savedAt: now,
    snapshot: src.snapshot ?? null,
  };
  projects.push(project);
  writeAll(projects);
  setActiveProjectId(project.id);
  return project;
}
