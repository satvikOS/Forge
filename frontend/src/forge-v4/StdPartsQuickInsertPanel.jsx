// PUSH-99 (Slice-67 / Standard Parts Quick Insert).
//
// PUSH-52 wired the full parametric Standard Parts catalogue
// (StdPartsLibraryWorkbench): a searchable browser over the ISO/ANSI
// fastener / bearing / gear families exposed by the native `stdparts`
// kernel namespace (Forge-204). The search + select + Insert flow is
// the right surface for browsing 20-plus parametric SKUs, but a real
// MCAD session — building a fastened assembly — needs a tighter
// affordance: a *quick* picker for the five or six fasteners every
// mechanical drawing reaches for first.
//
// This slice ships exactly that picker. A short right-docked panel with
// 8 preset insert buttons — the most common ISO parts in production
// mech engineering:
//   * M6 × 20 hex bolt           (ISO 4014)
//   * M8 × 25 hex bolt           (ISO 4014)
//   * M6 hex nut                 (ISO 4032)
//   * M8 hex nut                 (ISO 4032)
//   * ISO 7089 washer for M6     (12.5 mm OD × 1.6 mm thick)
//   * ISO 7089 washer for M8     (16.0 mm OD × 1.6 mm thick)
//   * 6800-2RS deep-groove brg.  (10 × 19 × 5 mm)
//   * spur gear m=2 z=20 w=10    (Shigley 13-1 starter)
//
// Each button commits the part as a real scene body at the world origin
// via `commitStdPartBody` — the same native B-rep round-trip the full
// catalogue panel uses (STL via `forge.io.writeTmpStl` →
// `forge.io.importStl`, synthetic-mesh fallback if OCCT rejects). The
// committed body's `name` field always carries the M-code or family
// code so the e2e spec — and future Archie tool calls — can grep for
// the inserted SKU on `window.__forgeBodies`.
//
// Reachable through:
//   * the `tools.stdPartsQuick` menu action (wired in Menus.jsx),
//   * `window.__forgeOpenStdPartsQuickInsertPanel(true|false)` for
//     plugins,
//   * `window.__forgeStdPartsQuickInsertHelper` for headless callers
//     (e2e spec, plugins, Archie tool calls).
//
// Hard constraints (PUSH-99 brief):
//   * NO new npm packages, NO new C++ libs, NO external services.
//   * Real impl, no MVP, no stub: every button generates a real native
//     stdparts mesh + commits a real scene body.
//   * Multi-cam e2e (5 named camera angles) mandatory.
//   * Surgical edits to Menus.jsx (one new entry) + App.jsx (one
//     import + one mount) + this new file + one new e2e spec.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// ─────────────────────────────────────────────────────────────────────
// Constants

export const FORGE_STDPARTS_QUICK_EVENT = 'forge:std-parts-quick-insert';

// The eight quick-insert SKUs. Every entry carries the family + the
// kernel-spec inputs + a NAME that the e2e spec can grep on
// __forgeBodies[].name — the M-code (M6 / M8) is always present for
// fastener families, the family code is always present for bearings +
// gears (e.g. "6800-2RS", "M2-Z20").
export const QUICK_INSERT_CATALOGUE = Object.freeze([
  {
    id:     'bolt-m6-20',
    family: 'bolt',
    name:   'ISO 4014 — M6 × 20 hex bolt',
    mCode:  6,
    length: 20,
  },
  {
    id:     'bolt-m8-25',
    family: 'bolt',
    name:   'ISO 4014 — M8 × 25 hex bolt',
    mCode:  8,
    length: 25,
  },
  {
    id:     'nut-m6',
    family: 'nut',
    name:   'ISO 4032 — M6 hex nut',
    mCode:  6,
  },
  {
    id:     'nut-m8',
    family: 'nut',
    name:   'ISO 4032 — M8 hex nut',
    mCode:  8,
  },
  {
    id:             'washer-m6',
    family:         'washer',
    name:           'ISO 7089 — M6 washer',
    innerDiameter:  6.4,
    outerDiameter:  12.5,
    thickness:      1.6,
  },
  {
    id:             'washer-m8',
    family:         'washer',
    name:           'ISO 7089 — M8 washer',
    innerDiameter:  8.4,
    outerDiameter:  16.0,
    thickness:      1.6,
  },
  {
    id:             'bearing-6800-2rs',
    family:         'bearing',
    name:           '6800-2RS deep-groove bearing (10 × 19 × 5)',
    innerDiameter:  10,
    outerDiameter:  19,
    width:          5,
  },
  {
    id:        'gear-m2-z20',
    family:    'gear',
    name:      'Spur gear M2 Z20 W10',
    module:    2.0,
    teeth:     20,
    faceWidth: 10,
  },
]);

// ─────────────────────────────────────────────────────────────────────
// Native kernel handle

function stdpartsApi() {
  if (typeof window === 'undefined') return null;
  return (window.forge && window.forge.stdparts)
      || (window.electron && window.electron.stdparts)
      || null;
}

// Generate the triangle-mesh ({positions, indices}) for a quick-insert
// catalogue entry via the native stdparts kernel. Exported so plugins +
// the e2e spec can drive the generator without React mounted.
export function generateQuickPart(entry) {
  const sp = stdpartsApi();
  if (!sp) throw new Error('forge.stdparts kernel namespace not available');
  switch (entry.family) {
    case 'bolt': {
      const spec = sp.specForMetricBolt(entry.mCode, entry.length);
      return sp.makeBolt(spec, 24);
    }
    case 'nut': {
      const spec = sp.specForMetricNut(entry.mCode);
      return sp.makeNut(spec, 24);
    }
    case 'washer':
      return sp.makeWasher({
        innerDiameter: entry.innerDiameter,
        outerDiameter: entry.outerDiameter,
        thickness:     entry.thickness,
      }, 24);
    case 'bearing':
      return sp.makeBearing({
        innerDiameter: entry.innerDiameter,
        outerDiameter: entry.outerDiameter,
        width:         entry.width,
      }, 24);
    case 'gear':
      return sp.makeSpurGear({
        module:        entry.module,
        teeth:         entry.teeth,
        faceWidth:     entry.faceWidth,
        // Shigley §13 standard pressure angle: 20° = 0.349 rad.
        pressureAngle: 0.349,
      }, 12);
    default:
      throw new Error(`unknown stdparts family: ${entry.family}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Native B-rep round-trip via STL — mirrors the bigger catalogue panel
// (StdPartsLibraryWorkbench.commitStdPartBody) so quick-insert bodies
// reach OCCT through exactly the same path. Synthetic-mesh fallback if
// the STL writer or importStl is unavailable.

function meshToBinaryStl(mesh) {
  const positions = mesh.positions;
  const tris      = mesh.indices;
  const numTri    = tris.length / 3;
  const buf       = new ArrayBuffer(84 + numTri * 50);
  const view      = new DataView(buf);
  view.setUint32(80, numTri, true);
  let off = 84;
  for (let t = 0; t < numTri; t++) {
    const i0 = tris[t * 3], i1 = tris[t * 3 + 1], i2 = tris[t * 3 + 2];
    const p0 = [positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]];
    const p1 = [positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]];
    const p2 = [positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]];
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    let   nx = uy * vz - uz * vy,
          ny = uz * vx - ux * vz,
          nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    view.setFloat32(off, nx, true); view.setFloat32(off + 4, ny, true); view.setFloat32(off + 8, nz, true); off += 12;
    for (const v of [p0, p1, p2]) {
      view.setFloat32(off,     v[0], true);
      view.setFloat32(off + 4, v[1], true);
      view.setFloat32(off + 8, v[2], true);
      off += 12;
    }
    view.setUint16(off, 0, true);
    off += 2;
  }
  return new Uint8Array(buf);
}

async function commitQuickInsertBody(entry, mesh) {
  if (typeof window === 'undefined' || typeof window.__forgeAppendBody !== 'function') {
    return null;
  }
  const f  = window.forge;
  const id = `stdpart-quick-${entry.id}-${Date.now().toString(36)}`;
  let handle      = null;
  let importNote  = null;
  if (f && f.io && typeof f.io.writeTmpStl === 'function' && typeof f.io.importStl === 'function') {
    try {
      const stl = meshToBinaryStl(mesh);
      const fp  = await f.io.writeTmpStl(`${id}.stl`, stl);
      const h   = f.io.importStl(fp);
      if (typeof h === 'number' && h > 0) handle = h;
      else importNote = `importStl returned ${h}`;
    } catch (err) {
      importNote = (err && err.message) ? err.message : String(err);
      handle = null;
    }
  }
  const body = {
    id,
    kind:       handle === null ? 'synthetic' : 'native',
    handle:     handle === null ? undefined : handle,
    name:       entry.name,
    toolId:     'tools.stdPartsQuick',
    sourceId:   entry.id,
    family:     entry.family,
    mesh:       handle === null ? { positions: mesh.positions, indices: mesh.indices } : undefined,
    importNote: importNote || undefined,
    ts:         Date.now(),
  };
  window.__forgeAppendBody(body);
  try {
    window.dispatchEvent(new CustomEvent(FORGE_STDPARTS_QUICK_EVENT, {
      detail: { entryId: entry.id, family: entry.family, name: entry.name,
                bodyId: body.id, kind: body.kind, handle: body.handle ?? null },
    }));
  } catch { /* harmless */ }
  return body;
}

// ─────────────────────────────────────────────────────────────────────
// Styles — right-docked rail vocabulary; same tokens BomBalloonsPanel +
// BatchRenamePanel + DiagnosticDumpPanel use so the slice 49/50/61/67
// panels all read as a family.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 360,
  zIndex: 1340,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)',
  fontSize: 12,
  overflowY: 'auto',
};
const HEADER_ROW = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  cursor: 'pointer',
  padding: '2px 6px',
  borderRadius: 3,
};
const SUBTLE = {
  color: 'var(--forge-ink-mute, #8b949e)',
  lineHeight: 1.5,
  fontSize: 11,
};
const SECTION_HEAD = {
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  fontSize: 10,
  color: 'var(--forge-ink-mute, #8b949e)',
  marginTop: 6,
  marginBottom: 2,
};
const INSERT_BTN = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  background: 'var(--forge-canvas, #0d1117)',
  color: 'var(--forge-ink, #dadde2)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: '6px 10px',
  cursor: 'pointer',
  fontFamily: 'var(--forge-mono, ui-monospace, "SF Mono", monospace)',
  fontSize: 11,
  textAlign: 'left',
  borderRadius: 3,
};
const FAMILY_TAG = {
  display: 'inline-block',
  background: 'var(--forge-accent, #4ec9b0)',
  color: '#0a0e14',
  padding: '1px 6px',
  fontSize: 9,
  letterSpacing: '0.05em',
  borderRadius: 2,
  fontWeight: 700,
  textTransform: 'uppercase',
};
const STATUS_ROW = {
  marginTop: 8,
  padding: '6px 8px',
  background: 'var(--forge-canvas, #0d1117)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3,
  fontFamily: 'var(--forge-mono, ui-monospace, "SF Mono", monospace)',
  fontSize: 10,
};
const ERROR_STYLE = {
  ...STATUS_ROW,
  borderColor: 'var(--forge-bad, #ff6363)',
  color: 'var(--forge-bad, #ff6363)',
};

// ─────────────────────────────────────────────────────────────────────
// React UI

export function StdPartsQuickInsertPanel({ open, onClose }) {
  const [lastInserted, setLastInserted] = useState(null);
  const [error, setError]               = useState('');
  const [busyId, setBusyId]             = useState('');

  const handleInsert = useCallback(async (entry) => {
    if (busyId) return;
    setError('');
    setBusyId(entry.id);
    try {
      const mesh = generateQuickPart(entry);
      if (!mesh || !mesh.positions || !mesh.indices) {
        throw new Error('kernel returned an empty mesh');
      }
      if (typeof window !== 'undefined') {
        window.__forgeLastStdPartQuick = { entry, mesh };
      }
      const body = await commitQuickInsertBody(entry, mesh);
      if (body) {
        setLastInserted({
          entryId: entry.id,
          name:    entry.name,
          kind:    body.kind,
          handle:  body.handle ?? null,
          tris:    mesh.indices.length / 3,
          verts:   mesh.positions.length / 3,
          ts:      body.ts,
        });
      }
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusyId('');
    }
  }, [busyId]);

  if (!open) return null;

  const bolts    = QUICK_INSERT_CATALOGUE.filter((e) => e.family === 'bolt');
  const nuts     = QUICK_INSERT_CATALOGUE.filter((e) => e.family === 'nut');
  const washers  = QUICK_INSERT_CATALOGUE.filter((e) => e.family === 'washer');
  const bearings = QUICK_INSERT_CATALOGUE.filter((e) => e.family === 'bearing');
  const gears    = QUICK_INSERT_CATALOGUE.filter((e) => e.family === 'gear');

  const renderGroup = (label, list) => (
    <React.Fragment key={label}>
      <div style={SECTION_HEAD}>{label}</div>
      {list.map((entry) => (
        <button
          key={entry.id}
          type="button"
          style={INSERT_BTN}
          disabled={!!busyId}
          data-testid={`forge-stdparts-quick-insert-${entry.id}`}
          onClick={() => handleInsert(entry)}
        >
          <span>{entry.name}</span>
          <span style={FAMILY_TAG}>{entry.family}</span>
        </button>
      ))}
    </React.Fragment>
  );

  return (
    <div
      style={PANEL_STYLE}
      data-testid="forge-stdparts-quick-panel"
      data-last-entry={lastInserted ? lastInserted.entryId : ''}
      data-last-kind={lastInserted ? lastInserted.kind : ''}
    >
      <header style={HEADER_ROW}>
        <strong>Standard Parts · Quick Insert</strong>
        <button
          type="button"
          onClick={onClose}
          style={CLOSE_BTN}
          data-testid="forge-stdparts-quick-close"
          aria-label="Close quick insert panel"
        >
          ×
        </button>
      </header>
      <div style={SUBTLE}>
        Common ISO fasteners + bearing + spur gear. One click commits the part
        as a real scene body at the world origin (native B-rep via OCCT STL
        round-trip, synthetic-mesh fallback). Use the full catalogue panel for
        the parametric search.
      </div>

      {renderGroup('Hex bolts (ISO 4014)',    bolts)}
      {renderGroup('Hex nuts (ISO 4032)',     nuts)}
      {renderGroup('Plain washers (ISO 7089)', washers)}
      {renderGroup('Deep-groove bearings',    bearings)}
      {renderGroup('Spur gears',              gears)}

      {error && (
        <div style={ERROR_STYLE} data-testid="forge-stdparts-quick-error">
          {error}
        </div>
      )}

      {lastInserted && (
        <div style={STATUS_ROW} data-testid="forge-stdparts-quick-status">
          Inserted <strong>{lastInserted.name}</strong>
          {' · '}
          <span data-testid="forge-stdparts-quick-status-kind">{lastInserted.kind}</span>
          {lastInserted.handle != null && (
            <> · handle <span data-testid="forge-stdparts-quick-status-handle">{lastInserted.handle}</span></>
          )}
          {' · '}
          {lastInserted.verts} verts / {lastInserted.tris} tris
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — owns the open/close state, listens for the `tools.stdPartsQuick`
// menu action, mounts the panel via a portal, and publishes the
// imperative open/close + headless helper surfaces on window so the
// e2e spec, plugins, and Archie tool calls can drive the panel without
// React mounted.

export function StdPartsQuickInsertPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenStdPartsQuickInsertPanel  = () => setOpen(true);
    window.__forgeCloseStdPartsQuickInsertPanel = () => setOpen(false);
    window.__forgeStdPartsQuickInsertHelper = Object.freeze({
      EVENT_NAME:    FORGE_STDPARTS_QUICK_EVENT,
      CATALOGUE:     QUICK_INSERT_CATALOGUE,
      generatePart:  generateQuickPart,
      commitPart:    commitQuickInsertBody,
    });
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.stdPartsQuick') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenStdPartsQuickInsertPanel;  } catch {}
      try { delete window.__forgeCloseStdPartsQuickInsertPanel; } catch {}
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <StdPartsQuickInsertPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default StdPartsQuickInsertPanel;
