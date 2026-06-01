// Forge-103 — Project Bundle export panel.
//
// One-button modal that lets the user pick which sections to include
// (CAD / Drawings / BOM / CAM / FEA / Configs), name the project, and
// fire `exportProjectBundle()`. A toast reports the resulting path and
// byte count.
//
// Self-mounted host pattern (matches DirectEditPanel / HealPanel /
// ManufacturingWorkbenchHost): App.jsx renders <ProjectBundlePanelHost />
// once, the host registers `window.__forgeOpenProjectBundle()`, and
// ForgeShellV4 stays untouched.
//
// Manual button clicks NEVER write to Archie's thread — the panel
// calls exportProjectBundle directly. Archie can drive the same path
// via the Tool Registry (separate concern).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { showToast } from './Toast.jsx';
import { exportProjectBundle } from './projectBundleExport.js';

const PANEL_EVENT = 'forge:open-project-bundle';

// ────────────────────────────── style chunks (v4 tokens)

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'var(--forge-overlay)',
  zIndex: 1400,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const panelStyle = {
  width: 520,
  maxWidth: '92vw',
  maxHeight: '88vh',
  background: 'var(--forge-canvas-3)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 'var(--forge-radius-lg)',
  boxShadow: '0 24px 64px rgba(0,0,0,0.65)',
  display: 'flex',
  flexDirection: 'column',
  color: 'var(--forge-ink)',
  fontFamily: 'var(--forge-font)',
  fontSize: 12,
  overflow: 'hidden',
};

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--forge-space-2)',
  padding: '10px 14px',
  borderBottom: '1px solid var(--forge-rail-edge)',
  background: 'var(--forge-canvas)',
  fontWeight: 600,
  fontSize: 12,
};

const bodyStyle = {
  flex: 1,
  overflowY: 'auto',
  padding: 'var(--forge-space-4)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--forge-space-3)',
};

const footerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--forge-space-2)',
  padding: '10px 14px',
  borderTop: '1px solid var(--forge-rail-edge)',
  background: 'var(--forge-canvas)',
};

const sectionLabel = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--forge-ink-mute)',
  fontWeight: 500,
};

const inputStyle = {
  background: 'var(--forge-canvas)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 'var(--forge-radius)',
  color: 'var(--forge-ink)',
  fontFamily: 'inherit',
  fontSize: 13,
  padding: '6px 10px',
  width: '100%',
  outline: 'none',
};

const btnBase = {
  background: 'var(--forge-surface)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 'var(--forge-radius)',
  color: 'var(--forge-ink)',
  fontFamily: 'inherit',
  fontSize: 12,
  padding: '6px 14px',
  cursor: 'pointer',
};

const ctaStyle = {
  ...btnBase,
  background: 'var(--forge-accent-mute)',
  borderColor: 'var(--forge-accent-rim)',
  color: 'var(--forge-ink)',
  fontWeight: 600,
};

const SECTIONS = [
  { key: 'cad',      label: 'CAD files',          desc: 'STEP, STL, BREP per body' },
  { key: 'drawings', label: 'Drawings',           desc: 'Projected SVG sheets' },
  { key: 'bom',      label: 'Bill of materials',  desc: 'CSV with mass, volume, cost' },
  { key: 'cam',      label: 'G-code',             desc: 'Posted .nc files for each op' },
  { key: 'sim',      label: 'Simulation results', desc: 'Stress, modal, dynamic JSON' },
  { key: 'configs',  label: 'Configurations',     desc: 'Design table + variants' },
];

// ────────────────────────────── component

export function ProjectBundlePanel({ open, onClose, payload }) {
  const initialName = payload?.projectName || 'Untitled Project';
  const [name, setName] = useState(initialName);
  const [sections, setSections] = useState({
    cad: true, drawings: true, bom: true, cam: true, sim: true, configs: true,
  });
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  // Reset state when re-opened with new payload.
  useEffect(() => {
    if (open) {
      setName(payload?.projectName || 'Untitled Project');
      setBusy(false);
      setLastResult(null);
    }
  }, [open, payload?.projectName]);

  const counts = useMemo(() => ({
    bodies:   Array.isArray(payload?.bodies)         ? payload.bodies.length : 0,
    drawings: Array.isArray(payload?.drawings)       ? payload.drawings.length : 0,
    bom:      Array.isArray(payload?.bom)            ? payload.bom.length : 0,
    cam:      Array.isArray(payload?.camOps)         ? payload.camOps.length : 0,
    sim:      Array.isArray(payload?.simulations)    ? payload.simulations.length : 0,
    configs:  payload?.configurations?.configs
      ? Object.keys(payload.configurations.configs).length : 0,
  }), [payload]);

  const toggle = useCallback((k) => {
    setSections((prev) => ({ ...prev, [k]: !prev[k] }));
  }, []);

  const onExport = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setLastResult(null);
    try {
      const r = await exportProjectBundle({
        projectName: name,
        bodies:         payload?.bodies || [],
        featureTree:    payload?.featureTree || [],
        configurations: payload?.configurations || null,
        drawings:       payload?.drawings || [],
        simulations:    payload?.simulations || [],
        camOps:         payload?.camOps || [],
        bom:            payload?.bom || [],
        sections,
      });
      setLastResult(r);
      if (r.ok) {
        const kb = Math.max(1, Math.round(r.bytes / 1024));
        showToast({
          kind: 'ok',
          text: `Bundle exported · ${kb} KB`,
          hint: r.path,
        });
      } else if (r.error === 'cancelled') {
        showToast({ kind: 'info', text: 'Export cancelled', ttl: 1500 });
      } else {
        showToast({ kind: 'err', text: `Export failed · ${r.error}` });
      }
    } catch (err) {
      setLastResult({ ok: false, error: err.message });
      showToast({ kind: 'err', text: `Export crashed · ${err.message}` });
    } finally {
      setBusy(false);
    }
  }, [busy, name, payload, sections]);

  if (!open) return null;

  return (
    <div style={overlayStyle}
         role="dialog"
         aria-modal="true"
         aria-label="Export Project Bundle"
         data-testid="forge-bundle-overlay"
         onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}>
      <div style={panelStyle}
           data-testid="forge-bundle-panel"
           onClick={(e) => e.stopPropagation()}>
        <header style={headerStyle}>
          <span>Export Project Bundle</span>
          <span style={{ flex: 1 }} />
          <button type="button"
                  onClick={() => !busy && onClose?.()}
                  aria-label="Close"
                  data-testid="forge-bundle-close"
                  style={{
                    background: 'transparent', border: 'none',
                    color: 'var(--forge-ink-mute)', cursor: 'pointer',
                    fontSize: 14, padding: 2,
                  }}>×</button>
        </header>

        <div style={bodyStyle}>
          <div>
            <div style={sectionLabel}>Project name</div>
            <input style={{ ...inputStyle, marginTop: 4 }}
                   value={name}
                   onChange={(e) => setName(e.target.value)}
                   spellCheck={false}
                   data-testid="forge-bundle-name" />
          </div>

          <div>
            <div style={sectionLabel}>Include</div>
            <div style={{ display: 'flex', flexDirection: 'column',
                          gap: 'var(--forge-space-1)', marginTop: 6 }}>
              {SECTIONS.map((s) => {
                const c = counts[s.key];
                return (
                  <label key={s.key}
                         style={{
                           display: 'flex',
                           alignItems: 'center',
                           gap: 'var(--forge-space-2)',
                           padding: '6px 8px',
                           borderRadius: 'var(--forge-radius)',
                           border: '1px solid var(--forge-rail-edge)',
                           background: sections[s.key]
                             ? 'var(--forge-accent-mute)'
                             : 'var(--forge-surface)',
                           cursor: 'pointer',
                         }}
                         data-section={s.key}
                         data-active={sections[s.key] ? 'true' : 'false'}>
                    <input type="checkbox"
                           checked={!!sections[s.key]}
                           onChange={() => toggle(s.key)}
                           data-testid={`forge-bundle-toggle-${s.key}`}
                           style={{ accentColor: 'var(--forge-accent)' }} />
                    <div style={{ display: 'flex', flexDirection: 'column',
                                  flex: 1, minWidth: 0 }}>
                      <span style={{ color: 'var(--forge-ink)',
                                     fontSize: 12, fontWeight: 500 }}>
                        {s.label}
                      </span>
                      <span style={{ color: 'var(--forge-ink-mute)',
                                     fontSize: 11 }}>
                        {s.desc}
                      </span>
                    </div>
                    <span style={{
                      color: 'var(--forge-ink-mute)',
                      fontFamily: 'var(--forge-mono)',
                      fontSize: 11,
                    }}>
                      {c}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {lastResult && (
            <div style={{
              padding: 'var(--forge-space-2) var(--forge-space-3)',
              borderRadius: 'var(--forge-radius)',
              border: '1px solid var(--forge-rail-edge)',
              background: 'var(--forge-surface)',
              fontFamily: 'var(--forge-mono)',
              fontSize: 11,
              color: lastResult.ok ? 'var(--forge-ok)' : 'var(--forge-err)',
            }}
                 data-testid="forge-bundle-result">
              {lastResult.ok
                ? `OK · ${lastResult.bytes} bytes → ${lastResult.path}`
                : `ERR · ${lastResult.error}`}
            </div>
          )}
        </div>

        <footer style={footerStyle}>
          <span style={{ flex: 1, color: 'var(--forge-ink-mute)', fontSize: 11 }}>
            {counts.bodies} bodies · {counts.drawings} drawings · {counts.cam} ops
          </span>
          <button type="button"
                  style={btnBase}
                  onClick={() => !busy && onClose?.()}
                  data-testid="forge-bundle-cancel">
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
                  data-testid="forge-bundle-export">
            {busy ? 'Exporting…' : 'Export Bundle'}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ────────────────────────────── self-mounting host

export function ProjectBundlePanelHost() {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState({});
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (typeof window === 'undefined') return;

    const collectPayload = (opts = {}) => ({
      projectName:    opts.projectName    ?? window.__forgeProjectName ?? 'Untitled Project',
      bodies:         opts.bodies         ?? window.__forgeBodies ?? [],
      featureTree:    opts.featureTree    ?? window.__forgeFeatureTree ?? [],
      configurations: opts.configurations ?? window.__forgeConfigurations ?? null,
      drawings:       opts.drawings       ?? window.__forgeDrawings ?? [],
      simulations:    opts.simulations    ?? window.__forgeSimulations ?? [],
      camOps:         opts.camOps         ?? window.__forgeCamOps ?? [],
      bom:            opts.bom            ?? window.__forgeBom ?? [],
    });

    window.__forgeOpenProjectBundle = (opts = {}) => {
      setPayload(collectPayload(opts));
      setOpen(true);
    };
    window.__forgeCloseProjectBundle = () => setOpen(false);

    const onEvt = (e) => {
      setPayload(collectPayload(e?.detail || {}));
      setOpen(true);
    };
    window.addEventListener(PANEL_EVENT, onEvt);
    return () => {
      window.removeEventListener(PANEL_EVENT, onEvt);
      try { delete window.__forgeOpenProjectBundle; } catch {}
      try { delete window.__forgeCloseProjectBundle; } catch {}
    };
  }, []);

  return <ProjectBundlePanel open={open}
                             payload={payload}
                             onClose={() => setOpen(false)} />;
}

export default ProjectBundlePanel;
