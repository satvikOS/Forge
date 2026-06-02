// Forge-198 — streaming glTF (.glb) publish panel.
//
// Tessellates one body at a time and writes its geometry to a tempfile
// before assembling the final .glb. Compared to the one-shot writer
// (Forge-178), peak memory stays bounded at one body's mesh — which
// shows up in the panel's "Peak memory" metric.
//
// The workbench enumerates the currently-loaded bodies (via
// `window.__forgeListBodies?.()` if available) and exports them with
// the kernel's streaming writer. A spec is collected for each row so
// the user can override material per body.
//
// `window.__forgeExportGlbStream(bodies, filepath, options)` is the
// scriptable surface used by the e2e + Archie tool layer.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 520, zIndex: 1310,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 12,
  overflowY: 'auto',
};

const buttonStyle = {
  background: 'var(--forge-accent)', border: 'none',
  color: '#0a0e14', padding: '8px 12px', cursor: 'pointer',
  fontWeight: 600, fontFamily: 'var(--forge-mono)',
};

const fieldStyle = {
  width: '100%',
  background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '4px 6px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function defaultBodies() {
  const list = (typeof window !== 'undefined' && window.__forgeListBodies)
    ? window.__forgeListBodies() : [];
  return list.map((b, i) => ({
    handle: b.handle,
    name: b.name ?? `body_${i}`,
    color: '#c8ccd2',
    metallic: 0.4,
    roughness: 0.55,
  }));
}

function hexToRgba(hex) {
  if (typeof hex !== 'string') return [0.78, 0.80, 0.84, 1.0];
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return [0.78, 0.80, 0.84, 1.0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255, 1.0];
}

function formatBytes(b) {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} kB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

export async function exportGlbStream(bodies, filepath, options) {
  const gltf = (typeof window !== 'undefined' && window.forge && window.forge.gltf)
    || (typeof window !== 'undefined' && window.electron && window.electron.gltf);
  if (!gltf || typeof gltf.exportGlbStream !== 'function') {
    throw new Error('forge.gltf.exportGlbStream not available');
  }
  const payload = bodies.map((b, i) => ({
    handle: b.handle,
    name: b.name ?? `body_${i}`,
    baseColor: Array.isArray(b.baseColor) ? b.baseColor : hexToRgba(b.color),
    metallic: typeof b.metallic === 'number' ? b.metallic : 0.4,
    roughness: typeof b.roughness === 'number' ? b.roughness : 0.55,
  }));
  return gltf.exportGlbStream(payload, filepath, options || {});
}

function GltfPublishPanel({ open, onClose }) {
  const [rows, setRows] = React.useState(defaultBodies());
  const [filepath, setFilepath] = React.useState('/tmp/forge-publish.glb');
  const [deflection, setDeflection] = React.useState(0.1);
  const [summary, setSummary] = React.useState(null);
  const [err, setErr] = React.useState('');

  React.useEffect(() => {
    if (open) setRows(defaultBodies());
  }, [open]);

  if (!open) return null;

  const onExport = async () => {
    setErr(''); setSummary(null);
    try {
      const s = await exportGlbStream(rows, filepath, { deflection });
      setSummary(s);
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };

  return (
    <div style={panelStyle} data-testid="forge-gltf-publish-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between',
                       alignItems: 'center' }}>
        <strong>Publish · streaming glTF</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Tessellates one body at a time, writing each chunk to a temp BIN
        before composing the final .glb. Peak memory stays bounded — see
        the summary after export.
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ color: 'var(--forge-ink-mute)' }}>Output path</span>
        <input
          data-testid="forge-gltf-filepath"
          value={filepath}
          onChange={(e) => setFilepath(e.target.value)}
          style={fieldStyle}
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ color: 'var(--forge-ink-mute)' }}>Deflection (mm)</span>
        <input
          type="number" step="0.05" min="0.01"
          data-testid="forge-gltf-deflection"
          value={deflection}
          onChange={(e) => setDeflection(Number(e.target.value) || 0.1)}
          style={fieldStyle}
        />
      </label>

      <div data-testid="forge-gltf-body-count" style={{ color: 'var(--forge-ink-mute)' }}>
        {rows.length === 0
          ? 'No bodies in the scene — load or build a model, then re-open this panel.'
          : `${rows.length} ${rows.length === 1 ? 'body' : 'bodies'} ready to publish`}
      </div>

      <button
        style={buttonStyle}
        data-testid="forge-gltf-export"
        onClick={onExport}
        disabled={rows.length === 0}
      >
        Export streaming .glb
      </button>

      {err && (
        <div data-testid="forge-gltf-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}

      {summary && (
        <section data-testid="forge-gltf-summary"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>Bodies written&nbsp;&nbsp;{summary.bodiesWritten}</div>
          <div>Vertices&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{summary.verticesTotal.toLocaleString()}</div>
          <div>Triangles&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{summary.trianglesTotal.toLocaleString()}</div>
          <div>File size&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{formatBytes(summary.fileSizeBytes)}</div>
          <div>Peak memory&nbsp;&nbsp;&nbsp;{formatBytes(summary.peakBytesInMemory)}</div>
          <div style={{ color: 'var(--forge-ink-mute)', marginTop: 4 }}>
            written to {summary.filepath}
          </div>
        </section>
      )}
    </div>
  );
}

export function GltfPublishWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenGltfPublishWorkbench  = () => setOpen(true);
    window.__forgeCloseGltfPublishWorkbench = () => setOpen(false);
    window.__forgeExportGlbStream           = exportGlbStream;
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.gltf-publish' || id === 'workbench.gltf-publish') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => {
      if (window.__forgeActiveWb === 'gltf-publish') setOpen(true);
    };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <GltfPublishPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default GltfPublishPanel;
