// Forge-121 — IFC4 Export panel.
//
// Modal triggered by `window.__forgeOpenIfcExport()` (and the
// `forge:open-ifc-export` event). Lets the user:
//   • Pick a project name (defaults to window.__forgeProjectName)
//   • Pick the IFC length unit (mm / cm / m / in / ft)
//   • Assign each body a storey (free text — defaults to "Storey 1")
//   • Assign each body an IFC element type via IfcTypePicker
//   • Hit "Export IFC" → opens the save dialog and writes the file
//
// Self-mounted host pattern (matches ProjectBundlePanelHost /
// HealPanelHost / DirectEditPanelHost): App.jsx renders
// <IfcExportPanelHost /> once, the host registers
// `window.__forgeOpenIfcExport()`, and ForgeShellV4 stays untouched.
//
// Manual button clicks NEVER write to Archie's thread.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { showToast } from './Toast.jsx';
import { exportIFC } from './ifcExport.js';
import {
  IfcTypePicker, loadIfcTypeMap, saveIfcTypeForBody,
  IFC_TYPE_DEFAULT,
} from './IfcTypePicker.jsx';

const PANEL_EVENT = 'forge:open-ifc-export';

const UNIT_OPTIONS = [
  { value: 'mm', label: 'Millimetres (mm)' },
  { value: 'cm', label: 'Centimetres (cm)' },
  { value: 'm',  label: 'Metres (m)' },
  { value: 'in', label: 'Inches (in)' },
  { value: 'ft', label: 'Feet (ft)' },
];

// ────────────────────────────── style chunks (v4 tokens with hard fallbacks)

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'var(--forge-overlay, rgba(8,10,14,0.78))',
  zIndex: 1400,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const panelStyle = {
  width: 720,
  maxWidth: '94vw',
  maxHeight: '90vh',
  background: 'var(--forge-canvas-3, #14161b)',
  border: '1px solid var(--forge-rail-edge, #2a2f3a)',
  borderRadius: 'var(--forge-radius-lg, 8px)',
  boxShadow: '0 24px 64px rgba(0,0,0,0.65)',
  display: 'flex',
  flexDirection: 'column',
  color: 'var(--forge-ink, #e4e7ed)',
  fontFamily: 'var(--forge-font, system-ui, sans-serif)',
  fontSize: 12,
  overflow: 'hidden',
};

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--forge-space-2, 8px)',
  padding: '10px 14px',
  borderBottom: '1px solid var(--forge-rail-edge, #2a2f3a)',
  background: 'var(--forge-canvas, #1a1d24)',
  fontWeight: 600,
  fontSize: 12,
};

const bodyStyle = {
  flex: 1,
  overflowY: 'auto',
  padding: 'var(--forge-space-4, 16px)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--forge-space-3, 12px)',
};

const footerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--forge-space-2, 8px)',
  padding: '10px 14px',
  borderTop: '1px solid var(--forge-rail-edge, #2a2f3a)',
  background: 'var(--forge-canvas, #1a1d24)',
};

const sectionLabel = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--forge-ink-mute, #8b94a3)',
  fontWeight: 500,
};

const inputStyle = {
  background: 'var(--forge-canvas, #1a1d24)',
  border: '1px solid var(--forge-rail-edge, #2a2f3a)',
  borderRadius: 'var(--forge-radius, 4px)',
  color: 'var(--forge-ink, #e4e7ed)',
  fontFamily: 'inherit',
  fontSize: 13,
  padding: '6px 10px',
  width: '100%',
  outline: 'none',
};

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 11,
};

const thStyle = {
  textAlign: 'left',
  padding: '6px 8px',
  borderBottom: '1px solid var(--forge-rail-edge, #2a2f3a)',
  background: 'var(--forge-canvas, #1a1d24)',
  color: 'var(--forge-ink-mute, #8b94a3)',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontWeight: 600,
};

const tdStyle = {
  padding: '6px 8px',
  borderBottom: '1px solid var(--forge-rail-edge, #2a2f3a)',
  verticalAlign: 'middle',
};

const btnBase = {
  background: 'var(--forge-surface, #20242d)',
  border: '1px solid var(--forge-rail-edge, #2a2f3a)',
  borderRadius: 'var(--forge-radius, 4px)',
  color: 'var(--forge-ink, #e4e7ed)',
  fontFamily: 'inherit',
  fontSize: 12,
  padding: '6px 14px',
  cursor: 'pointer',
};

const ctaStyle = {
  ...btnBase,
  background: 'var(--forge-accent-mute, #243044)',
  borderColor: 'var(--forge-accent-rim, #3a5170)',
  color: 'var(--forge-ink, #e4e7ed)',
  fontWeight: 600,
};

// ────────────────────────────── component

export function IfcExportPanel({ open, onClose, payload }) {
  const initialName = payload?.projectName || 'Untitled Project';
  const bodies = useMemo(
    () => Array.isArray(payload?.bodies) ? payload.bodies : [],
    [payload?.bodies],
  );
  const initialTree = payload?.assemblyTree || [];

  const [name, setName] = useState(initialName);
  const [units, setUnits] = useState('mm');
  const [storeyByBody, setStoreyByBody] = useState({});
  const [ifcTypeByBody, setIfcTypeByBody] = useState({});
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  // Hydrate per-body state when the panel opens or the body list changes.
  useEffect(() => {
    if (!open) return;
    setName(payload?.projectName || 'Untitled Project');
    setBusy(false);
    setLastResult(null);
    // Storey defaults from payload or "Storey 1".
    const sMap = {};
    const tMap = loadIfcTypeMap();
    for (const b of bodies) {
      if (!b?.id) continue;
      sMap[b.id] = payload?.storeyByBody?.[b.id] || 'Storey 1';
      if (!tMap[b.id]) tMap[b.id] = b.ifcType || IFC_TYPE_DEFAULT;
    }
    setStoreyByBody(sMap);
    setIfcTypeByBody(tMap);
  }, [open, payload?.projectName, payload?.storeyByBody, bodies]);

  const setStoreyFor = useCallback((id, value) => {
    setStoreyByBody((prev) => ({ ...prev, [id]: value }));
  }, []);

  const setIfcTypeFor = useCallback((id, value) => {
    setIfcTypeByBody((prev) => ({ ...prev, [id]: value }));
    saveIfcTypeForBody(id, value);
  }, []);

  const onExport = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setLastResult(null);
    try {
      const r = await exportIFC({
        bodies,
        assemblyTree: initialTree,
        projectName: name,
        units,
        storeyByBody,
        ifcTypeByBody,
      });
      setLastResult(r);
      if (r.ok) {
        const kb = Math.max(1, Math.round((r.bytes || 0) / 1024));
        showToast({
          kind: 'ok',
          text: `IFC exported · ${kb} KB`,
          hint: r.path,
        });
      } else if (r.error === 'cancelled') {
        showToast({ kind: 'info', text: 'Export cancelled', ttl: 1500 });
      } else {
        showToast({ kind: 'err', text: `Export failed · ${r.error}` });
      }
    } catch (err) {
      setLastResult({ ok: false, error: err && err.message ? err.message : String(err) });
      showToast({ kind: 'err', text: `Export crashed · ${err && err.message}` });
    } finally {
      setBusy(false);
    }
  }, [busy, bodies, initialTree, name, units, storeyByBody, ifcTypeByBody]);

  if (!open) return null;

  return (
    <div style={overlayStyle}
         role="dialog"
         aria-modal="true"
         aria-label="Export IFC"
         data-testid="forge-ifc-overlay"
         onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}>
      <div style={panelStyle}
           data-testid="forge-ifc-panel"
           onClick={(e) => e.stopPropagation()}>
        <header style={headerStyle}>
          <span>Export IFC4 (ISO 16739)</span>
          <span style={{ flex: 1 }} />
          <button type="button"
                  onClick={() => !busy && onClose?.()}
                  aria-label="Close"
                  data-testid="forge-ifc-close"
                  style={{
                    background: 'transparent', border: 'none',
                    color: 'var(--forge-ink-mute, #8b94a3)', cursor: 'pointer',
                    fontSize: 14, padding: 2,
                  }}>×</button>
        </header>

        <div style={bodyStyle}>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={sectionLabel}>Project name</div>
              <input style={{ ...inputStyle, marginTop: 4 }}
                     value={name}
                     onChange={(e) => setName(e.target.value)}
                     spellCheck={false}
                     data-testid="forge-ifc-name" />
            </div>
            <div style={{ width: 220 }}>
              <div style={sectionLabel}>Length unit</div>
              <select style={{ ...inputStyle, marginTop: 4, cursor: 'pointer' }}
                      value={units}
                      onChange={(e) => setUnits(e.target.value)}
                      data-testid="forge-ifc-units">
                {UNIT_OPTIONS.map((u) => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div style={sectionLabel}>
              Storey + IFC type assignment ({bodies.length} {bodies.length === 1 ? 'body' : 'bodies'})
            </div>
            <div style={{
              marginTop: 6,
              border: '1px solid var(--forge-rail-edge, #2a2f3a)',
              borderRadius: 'var(--forge-radius, 4px)',
              overflow: 'hidden',
              maxHeight: 320,
              overflowY: 'auto',
            }}>
              <table style={tableStyle} data-testid="forge-ifc-table">
                <thead>
                  <tr>
                    <th style={thStyle}>Body</th>
                    <th style={thStyle}>Storey</th>
                    <th style={thStyle}>IFC type</th>
                  </tr>
                </thead>
                <tbody>
                  {bodies.length === 0 ? (
                    <tr>
                      <td colSpan={3}
                          style={{
                            ...tdStyle,
                            color: 'var(--forge-ink-mute, #8b94a3)',
                            textAlign: 'center',
                            padding: '14px 8px',
                          }}>
                        No bodies in the current scene. The IFC will still
                        contain a valid project / site / building / storey
                        spatial structure.
                      </td>
                    </tr>
                  ) : bodies.map((b) => (
                    <tr key={b.id} data-testid={`forge-ifc-row-${b.id}`}>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 500 }}>{b.name || b.id}</div>
                        <div style={{
                          fontSize: 10,
                          color: 'var(--forge-ink-mute, #8b94a3)',
                          fontFamily: 'var(--forge-mono, monospace)',
                        }}>
                          {b.id}
                        </div>
                      </td>
                      <td style={tdStyle}>
                        <input
                          type="text"
                          value={storeyByBody[b.id] || 'Storey 1'}
                          onChange={(e) => setStoreyFor(b.id, e.target.value)}
                          spellCheck={false}
                          data-testid={`forge-ifc-storey-${b.id}`}
                          style={{
                            ...inputStyle,
                            padding: '4px 6px',
                            width: 120,
                          }}
                        />
                      </td>
                      <td style={tdStyle}>
                        <IfcTypePicker
                          bodyId={b.id}
                          value={ifcTypeByBody[b.id] || IFC_TYPE_DEFAULT}
                          onChange={(v) => setIfcTypeFor(b.id, v)}
                          compact
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {lastResult && (
            <div style={{
              padding: '8px 10px',
              borderRadius: 'var(--forge-radius, 4px)',
              border: '1px solid var(--forge-rail-edge, #2a2f3a)',
              background: 'var(--forge-surface, #20242d)',
              fontFamily: 'var(--forge-mono, monospace)',
              fontSize: 11,
              color: lastResult.ok ? 'var(--forge-ok, #6fcf97)' : 'var(--forge-err, #eb5757)',
              wordBreak: 'break-all',
            }}
                 data-testid="forge-ifc-result">
              {lastResult.ok
                ? `OK · ${lastResult.bytes} bytes → ${lastResult.path}`
                : `ERR · ${lastResult.error}`}
            </div>
          )}
        </div>

        <footer style={footerStyle}>
          <span style={{ flex: 1, color: 'var(--forge-ink-mute, #8b94a3)', fontSize: 11 }}>
            ISO 10303-21 / IFC4 · {units} · {bodies.length} {bodies.length === 1 ? 'body' : 'bodies'}
          </span>
          <button type="button"
                  style={btnBase}
                  onClick={() => !busy && onClose?.()}
                  data-testid="forge-ifc-cancel">
            Cancel
          </button>
          <button type="button"
                  style={{
                    ...ctaStyle,
                    opacity: busy ? 0.6 : 1,
                    cursor: busy ? 'wait' : 'pointer',
                  }}
                  disabled={busy}
                  onClick={onExport}
                  data-testid="forge-ifc-export">
            {busy ? 'Exporting…' : 'Export IFC'}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ────────────────────────────── self-mounting host

export function IfcExportPanelHost() {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState({});
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (typeof window === 'undefined') return;

    const collectPayload = (opts = {}) => ({
      projectName:  opts.projectName  ?? window.__forgeProjectName ?? 'Untitled Project',
      bodies:       opts.bodies       ?? window.__forgeBodies ?? [],
      assemblyTree: opts.assemblyTree ?? window.__forgeAssemblyTree ?? [],
      storeyByBody: opts.storeyByBody ?? {},
    });

    window.__forgeOpenIfcExport = (opts = {}) => {
      if (opts === false) { setOpen(false); return; }
      const conf = (opts === true || opts == null) ? {} : opts;
      setPayload(collectPayload(conf));
      setOpen(true);
    };
    window.__forgeCloseIfcExport = () => setOpen(false);

    const onEvt = (e) => {
      setPayload(collectPayload(e?.detail || {}));
      setOpen(true);
    };
    window.addEventListener(PANEL_EVENT, onEvt);
    return () => {
      window.removeEventListener(PANEL_EVENT, onEvt);
      try { delete window.__forgeOpenIfcExport; } catch {}
      try { delete window.__forgeCloseIfcExport; } catch {}
    };
  }, []);

  return <IfcExportPanel open={open}
                         payload={payload}
                         onClose={() => setOpen(false)} />;
}

export default IfcExportPanel;
