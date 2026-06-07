// PUSH-148 (Slice-108) — Multi-thickness shell panel.
//
// Real OCCT call: forge.part.shellMultiThickness(handle, faceIdsToRemove,
// baseThickness, perFaceOverrides) at electron/preload.js:1378.
// Smoke test at forge-kernel/test/part_features_smoke.js:445-475 walks
// face ids 0..5 of a 10×10×10 box and verifies real material removal.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

export const FORGE_MULTI_SHELL_EVENT = 'forge:multi-shell-built';

function readNativeBodies() {
  if (typeof window === 'undefined') return [];
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return bodies.filter((b) => b && b.kind === 'native' && typeof b.handle === 'number');
}
function defaultBody() {
  const nb = readNativeBodies();
  return nb.length ? nb[nb.length - 1] : null;
}

export function runMultiShellPipeline({ handle, baseThickness, facesToRemove, overrides } = {}) {
  const w = typeof window !== 'undefined' ? window : null;
  if (!w?.forge?.part?.shellMultiThickness) return { ok: false, error: 'no-kernel' };
  const t = Number(baseThickness);
  if (!Number.isFinite(t) || t <= 0) return { ok: false, error: 'bad-thickness' };
  const removeArr = Array.isArray(facesToRemove)
    ? facesToRemove.map((x) => Number(x)).filter((x) => Number.isFinite(x))
    : [];
  const ovArr = Array.isArray(overrides) ? overrides : [];
  try {
    const out = w.forge.part.shellMultiThickness(handle, removeArr, t, ovArr);
    if (typeof out !== 'number' || out <= 0) return { ok: false, error: 'kernel-no-handle' };
    return { ok: true, handle: out };
  } catch (ex) {
    return { ok: false, error: String(ex?.message || ex) };
  }
}

if (typeof window !== 'undefined' && !window.__forgeMultiShellHelper) {
  window.__forgeMultiShellHelper = Object.freeze({
    runMultiShellPipeline, readNativeBodies,
  });
}

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0, bottom: 'var(--forge-statusbar-h, 24px)',
  width: 460, zIndex: 1330,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 8,
  color: 'var(--forge-ink)', fontSize: 12, overflowY: 'auto',
};

export function MultiShellPanel({ open, onClose }) {
  const [body, setBody] = useState(() => defaultBody());
  const [baseThickness, setBaseThickness] = useState(2);
  const [rows, setRows] = useState([{ faceId: 0, thickness: 2, remove: true }]);
  const [status, setStatus] = useState('');
  const [log, setLog] = useState([]);

  useEffect(() => {
    if (!open) return;
    setBody(defaultBody());
    const onBodies = () => setBody((b) => b ?? defaultBody());
    window.addEventListener('forge:bodies-changed', onBodies);
    return () => window.removeEventListener('forge:bodies-changed', onBodies);
  }, [open]);

  const addRow = () => setRows((r) => [...r, { faceId: r.length, thickness: baseThickness, remove: false }]);
  const removeRow = (i) => setRows((r) => r.filter((_, j) => j !== i));
  const updateRow = (i, patch) => setRows((r) => r.map((x, j) => j === i ? { ...x, ...patch } : x));

  const apply = useCallback(() => {
    if (!body) { setStatus('no-body'); return; }
    const facesToRemove = rows.filter((r) => r.remove).map((r) => Number(r.faceId));
    const overrides = rows
      .filter((r) => !r.remove && Number(r.thickness) !== baseThickness)
      .map((r) => ({ faceId: Number(r.faceId), thickness: Number(r.thickness) }));
    const r = runMultiShellPipeline({
      handle: body.handle, baseThickness, facesToRemove, overrides,
    });
    if (r.ok) {
      try {
        const before = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
        const next = before.map((b) => b.handle === body.handle
          ? { ...b, handle: r.handle, name: `${b.name || 'Body'} shell` }
          : b);
        if (typeof window.__forgeSetBodies === 'function') window.__forgeSetBodies(next);
        else window.__forgeBodies = next;
        window.dispatchEvent(new CustomEvent('forge:bodies-changed', { detail: { kind: 'multi-shell' } }));
      } catch {}
      setStatus(`✓ shell → handle=${r.handle}`);
      setLog((l) => [{ ts: Date.now(), ok: true, handle: r.handle, baseThickness, facesToRemove, overrides }, ...l].slice(0, 10));
      try {
        window.dispatchEvent(new CustomEvent(FORGE_MULTI_SHELL_EVENT, {
          detail: { ok: true, handle: r.handle, baseThickness, facesToRemove, overrides },
        }));
      } catch {}
    } else {
      setStatus(`✗ ${r.error}`);
      setLog((l) => [{ ts: Date.now(), ok: false, error: r.error }, ...l].slice(0, 10));
    }
  }, [body, baseThickness, rows]);

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-multi-shell-panel"
         data-body-handle={body?.handle ?? ''}>
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Multi-thickness Shell</strong>
        <button onClick={onClose} data-testid="forge-multi-shell-close"
                style={{ background: 'transparent', border: '1px solid var(--forge-rail-edge)',
                         color: 'var(--forge-ink)', cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>

      <div style={{ color: 'var(--forge-ink-mute)' }}>
        Body: <strong data-testid="forge-multi-shell-body">
          {body ? (body.name || `handle ${body.handle}`) : 'None'}
        </strong>
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <label>Base thickness mm</label>
        <input type="number" min="0.1" step="0.5" value={baseThickness}
               data-testid="forge-multi-shell-base"
               style={{ width: 80 }}
               onChange={(e) => setBaseThickness(Number(e.target.value) || baseThickness)} />
      </div>

      <section data-testid="forge-multi-shell-rows" style={{ fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--forge-rail-edge)' }}>
              <th style={{ textAlign: 'left', padding: 3 }}>Face id</th>
              <th style={{ textAlign: 'left', padding: 3 }}>Thickness</th>
              <th style={{ textAlign: 'left', padding: 3 }}>Remove?</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} data-row="face">
                <td style={{ padding: 2 }}>
                  <input type="number" min="0" value={r.faceId} style={{ width: 50 }}
                         data-testid={`forge-multi-shell-face-${i}`}
                         onChange={(e) => updateRow(i, { faceId: parseInt(e.target.value, 10) || 0 })} />
                </td>
                <td style={{ padding: 2 }}>
                  <input type="number" min="0.1" step="0.5" value={r.thickness} style={{ width: 60 }}
                         data-testid={`forge-multi-shell-thick-${i}`}
                         onChange={(e) => updateRow(i, { thickness: Number(e.target.value) || 0 })} />
                </td>
                <td style={{ padding: 2 }}>
                  <input type="checkbox" checked={r.remove}
                         data-testid={`forge-multi-shell-remove-${i}`}
                         onChange={(e) => updateRow(i, { remove: e.target.checked })} />
                </td>
                <td style={{ padding: 2 }}>
                  <button onClick={() => removeRow(i)}
                          data-testid={`forge-multi-shell-rm-${i}`}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={addRow} data-testid="forge-multi-shell-add">+ Face</button>
      </section>

      <button onClick={apply}
              data-testid="forge-multi-shell-apply"
              style={{ background: 'var(--forge-accent, #2c4d2a)', color: '#dfeedd', border: 'none',
                       padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>
        Apply shell
      </button>

      {status && (
        <div data-testid="forge-multi-shell-status"
             style={{ color: 'var(--forge-ink-mute)', fontFamily: 'var(--forge-mono)' }}>
          {status}
        </div>
      )}
    </div>
  );
}

export function MultiShellPanelHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenMultiShell = (b) => setOpen(b === undefined ? true : !!b);
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.multiShell') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => window.removeEventListener('forge:menu-action', onMenu);
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <MultiShellPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default MultiShellPanel;
