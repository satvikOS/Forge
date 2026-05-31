/**
 * ArchDisc Project Snapshot — comprehensive session-state save/load.
 *
 * Existing surface (frontend/src/systems/FileExport.js + AIChatPanel)
 * captures scene-manager objects + AI chat conversations respectively.
 * This module unifies them PLUS the parametric layer (DesignHistory
 * + EquationStore) that landed across UX Tier 10 / 10b / 10c / 10c-edit.
 *
 * Snapshot shape (.archdisc.json v2):
 *   {
 *     version: 2,
 *     savedAt: ISO timestamp,
 *     appVersion: 'archdisc-Mech …',
 *     designHistory: [...entries with values + expressions],
 *     equations: {name -> {expression, value, type, comment}},
 *     bodies: [{id, name, kind, originalToolName, persistentId?}],
 *     notes: 'free-text title / comment from user'
 *   }
 *
 * Save = collect + download. Load (re-execute) is documented as the
 * follow-on; this commit ships Save end-to-end which is the most
 * commonly-asked-for capability (snapshot for backup / share / hand-off).
 */

const SNAPSHOT_VERSION = 2;

/**
 * Build the in-memory snapshot object. Always callable without errors;
 * each section degrades gracefully when its store isn't initialised.
 */
export function buildProjectSnapshot(opts = {}) {
  const notes = opts.notes ?? '';
  const snapshot = {
    version: SNAPSHOT_VERSION,
    savedAt: new Date().toISOString(),
    appVersion: 'archdisc-Mech',
    notes,
    designHistory: [],
    equations: {},
    bodies: [],
  };

  // DesignHistory entries (UX Tier 10c persists values + expressions).
  try {
    if (typeof window !== 'undefined' && window.__archdiscHistory) {
      const entries = window.__archdiscHistory.toJSON?.() ?? [];
      snapshot.designHistory = entries.map((e) => ({ ...e }));
    }
  } catch (err) {
    console.warn('[ProjectSnapshot] DesignHistory capture failed', err);
  }

  // EquationStore variables (UX Tier 10 — name → {expression, value, type}).
  try {
    if (typeof window !== 'undefined' && window.__archdiscEquationStore) {
      const list = window.__archdiscEquationStore.list?.() ?? [];
      for (const row of list) {
        snapshot.equations[row.name] = {
          expression: row.expression ?? '',
          value: row.value ?? null,
          type: row.type ?? 'number',
          comment: row.comment ?? '',
        };
      }
    }
  } catch (err) {
    console.warn('[ProjectSnapshot] EquationStore capture failed', err);
  }

  // BodyRegistry summary (full geometry isn't serialised here — replay
  // through DesignHistory rebuilds it). Just enough metadata for the
  // user to see what bodies are in the scene.
  try {
    if (typeof window !== 'undefined' && window.__archdiscBodies) {
      const reg = window.__archdiscBodies;
      const list = typeof reg.list === 'function' ? reg.list() : (Array.isArray(reg.bodies) ? reg.bodies : []);
      snapshot.bodies = list.map((b) => ({
        id: b.id ?? null,
        name: b.name ?? '(unnamed)',
        kind: b.kind ?? b.metadata?.kind ?? null,
        originalToolName: b.userData?.toolName ?? b.toolName ?? null,
        persistentId: b.brepShapeRef?.body?.persistentId ?? null,
      }));
    }
  } catch (err) {
    console.warn('[ProjectSnapshot] BodyRegistry capture failed', err);
  }

  return snapshot;
}

/**
 * Trigger a download of the current snapshot as an .archdisc.json file.
 * Filename is derived from the user-provided slug or a date-time stamp.
 */
export function downloadProjectSnapshot(opts = {}) {
  const snapshot = buildProjectSnapshot(opts);
  const slug = (opts.slug || `archdisc-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`).replace(/[^a-z0-9-]/gi, '-');
  const json = JSON.stringify(snapshot, null, 2);
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { ok: false, reason: 'no-dom', snapshot };
  }
  try {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.archdisc.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return {
      ok: true,
      filename: a.download,
      bytes: json.length,
      entries: snapshot.designHistory.length,
      variables: Object.keys(snapshot.equations).length,
      bodies: snapshot.bodies.length,
    };
  } catch (err) {
    console.warn('[ProjectSnapshot] download failed', err);
    return { ok: false, reason: 'download-failed', error: err?.message, snapshot };
  }
}

/**
 * Parse + restore the parametric layer (EquationStore + DesignHistory)
 * from a snapshot. Geometry replay is NOT done here — that requires
 * driving every original tool through its handler. This function
 * restores the design-intent layer so the user sees their history +
 * variables again; running the timeline forward to rebuild bodies is
 * a follow-on (the History/Rollback panel can scrub).
 */
export function restoreProjectSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return { ok: false, reason: 'invalid-snapshot' };
  }
  let designEntries = 0, equationCount = 0;
  try {
    if (Array.isArray(snapshot.equations) || (snapshot.equations && typeof snapshot.equations === 'object')) {
      const store = typeof window !== 'undefined' ? window.__archdiscEquationStore : null;
      if (store && typeof store.clear === 'function' && typeof store.set === 'function') {
        store.clear();
        const entries = Array.isArray(snapshot.equations)
          ? snapshot.equations.map((e, i) => [e.name ?? `var${i}`, e])
          : Object.entries(snapshot.equations);
        for (const [name, row] of entries) {
          try {
            store.set(name, row?.expression ?? String(row?.value ?? ''), { comment: row?.comment ?? '' });
            equationCount += 1;
          } catch (err) {
            console.warn('[ProjectSnapshot] equation restore skipped', name, err);
          }
        }
      }
    }
  } catch (err) {
    console.warn('[ProjectSnapshot] equation restore failed', err);
  }
  try {
    if (Array.isArray(snapshot.designHistory) && typeof window !== 'undefined' && window.__archdiscHistory) {
      // Replace in place — the existing DesignHistory class doesn't
      // expose a setEntries API. We clear + push raw entries onto
      // .entries (the rest of the class is read-only beyond that),
      // then nudge listeners.
      const h = window.__archdiscHistory;
      if (typeof h.clear === 'function') h.clear();
      if (Array.isArray(h.entries)) {
        for (const e of snapshot.designHistory) {
          h.entries.push({ ...e });
          designEntries += 1;
        }
        if (typeof h._notify === 'function') h._notify();
      }
    }
  } catch (err) {
    console.warn('[ProjectSnapshot] design-history restore failed', err);
  }
  return { ok: true, designEntries, equationCount, version: snapshot.version ?? null };
}

export default { buildProjectSnapshot, downloadProjectSnapshot, restoreProjectSnapshot };
