// PUSH-81 (Slice-49 / Diagnostic state dump panel).
//
// Up through PUSH-80 the only debug surfaces for the Forge shell were
// PUSH-73's Activity Log (a live ring buffer of forge:* bus events) and
// the devtools console. Neither one is good for a "support ticket" loop —
// the user can't easily attach "everything Forge knows about its current
// state" to a bug report or to an Archie thread for diagnosis. The shell
// hangs hundreds of `window.__forge*` globals (selection, camera, bodies,
// layers, sketch session, autosave state, …) at runtime; under a real
// bug there's no single artefact that snapshots all of them in one shot.
//
// PUSH-81 adds the Diagnostic State Dump panel — a one-button surface
// that walks the `window.__forge*` namespace, serialises every
// JSON-shaped key into a single blob along with the kernel version
// (`window.forge.version()`), the user-agent, an ISO timestamp, the
// current selection and the live viewport camera (position / quaternion /
// fov / target). The blob is written to disk via the same
// `forge.dialog.saveFile` + `writeBlob` bridge BodyColors / ProjectFile /
// ActivityLog use, so support gets a single self-contained `.json`.
//
// Contract:
//   * Open via `tools.diagnostic` menu action OR by calling
//     `window.__forgeOpenDiagnosticDump()`.
//   * One big button — "Generate diagnostic report" — collects + writes.
//   * `window.__forgeBuildDiagnosticReport()` returns the snapshot
//     object without writing to disk (used by Archie / e2e for assertion
//     without round-tripping through the IPC bridge).
//   * `window.__forgeLastDiagnosticPath` is populated with the last-
//     written file path after a successful Generate.
//   * Persistence: none. The panel state is ephemeral.
//
// Constraints honoured (PUSH-81 brief):
//   * NO new npm packages, NO new C++ libs — React + the existing
//     `window.forge.dialog` bridge + the existing `window.__forge*`
//     surface only.
//   * No MVP, no stub. The snapshot is a real walk of the window keys,
//     not a hard-coded subset. Non-serialisable values get coerced to a
//     marker so the JSON is always parseable. The kernel-version line
//     and ua field both fail-soft when the bridge isn't installed.
//   * Surgical edits to Menus.jsx (one new entry: `tools.diagnostic`) +
//     App.jsx (one import + one mount), no Viewport / shell touched.
//   * Multi-cam e2e: 5 named camera angles per the Forge-171 mandate.

import React, {
  useCallback, useEffect, useState,
} from 'react';
import { createPortal } from 'react-dom';

// Hard ceiling on the serialised size of any single window key. A few
// existing globals are *huge* — the active scene graph, an entire Three
// renderer ref, the mesh buffers — and including them verbatim would
// turn a "support diagnostic" into a multi-megabyte dump that nobody
// will email. We truncate the per-value serialisation to this many
// characters; oversize values become a marker so the operator knows the
// key exists but its content is too large for the report.
export const DIAGNOSTIC_PER_KEY_MAX_CHARS = 8192;

// Hard ceiling on the total number of `__forge*` keys included. There
// are ~820 of these globals at last count; cramming all of them in
// makes the JSON painful to scan. We cap at this many keys, ordered
// alphabetically, after the small fixed "vital" subset is force-included.
export const DIAGNOSTIC_KEY_LIMIT = 256;

// The vital subset is always included no matter how big it is — these
// are the keys support most often needs to debug: the live scene
// bodies, the active selection, the active workbench, the persisted
// autosave snapshot, the body / material override maps, the section
// plane state, and the layer store. They get the full
// DIAGNOSTIC_PER_KEY_MAX_CHARS budget; their oversize handling is the
// same as the generic walk.
export const DIAGNOSTIC_VITAL_KEYS = Object.freeze([
  '__forgeBodies',
  '__forgeFeatureTree',
  '__forgeSelection',
  '__forgeActiveWb',
  '__forgeTheme',
  '__forgeAutosave',
  '__forgeBodyColors',
  '__forgeBodyMaterials',
  '__forgeLayerStore',
  '__forgeCurrentSketch',
  '__forgeDatums',
  '__forgeConfigurations',
  '__forgeActivityLogInstalled_v1',
]);

// Try to serialise `val` into a JSON-stringifiable shape. We strip the
// stuff that JSON.stringify would either throw on (BigInt, cycles) or
// silently lose (Maps, Sets, functions, DOM nodes, typed arrays) and
// replace it with a stable marker.
//
// Returned shape:
//   - `{ ok: true,  value: <serialisable>, kind: 'plain' | 'truncated' | 'oversize' }`
//   - `{ ok: false, error: <string>, kind: <typeof input> }` on coercion failure
function _coerce(val) {
  if (val === null) return { ok: true, value: null, kind: 'plain' };
  const t = typeof val;
  if (t === 'undefined') return { ok: true, value: undefined, kind: 'plain' };
  if (t === 'string' || t === 'number' || t === 'boolean') {
    return { ok: true, value: val, kind: 'plain' };
  }
  if (t === 'bigint') {
    return { ok: true, value: val.toString() + 'n', kind: 'plain' };
  }
  if (t === 'function') {
    return { ok: true, value: `<fn:${val.name || 'anonymous'}>`, kind: 'plain' };
  }
  if (t === 'symbol') {
    return { ok: true, value: val.toString(), kind: 'plain' };
  }
  // Object-shaped. The replacer below handles Maps, Sets, typed arrays
  // and DOM nodes that JSON.stringify would otherwise mangle.
  const seen = new WeakSet();
  try {
    const txt = JSON.stringify(val, (_k, v) => {
      if (v === null) return null;
      const tv = typeof v;
      if (tv === 'function') return `<fn:${v.name || 'anonymous'}>`;
      if (tv === 'bigint')  return v.toString() + 'n';
      if (tv === 'symbol')  return v.toString();
      if (tv !== 'object')  return v;
      if (seen.has(v))      return '<cycle>';
      seen.add(v);
      if (v instanceof Error) return `<Error: ${v.message}>`;
      if (typeof Map !== 'undefined' && v instanceof Map) {
        const entries = [];
        for (const [k2, v2] of v.entries()) {
          // The downstream JSON.stringify walks `entries`, so non-
          // serialisable values still get caught by this same replacer.
          entries.push([k2, v2]);
        }
        return { __kind: 'Map', size: v.size, entries };
      }
      if (typeof Set !== 'undefined' && v instanceof Set) {
        return { __kind: 'Set', size: v.size, values: Array.from(v.values()) };
      }
      if (ArrayBuffer.isView(v)) {
        return { __kind: 'TypedArray', ctor: v.constructor?.name || 'TypedArray',
                 length: v.length, sample: Array.from(v.slice(0, 8)) };
      }
      if (v instanceof ArrayBuffer) {
        return { __kind: 'ArrayBuffer', byteLength: v.byteLength };
      }
      if (typeof Node    !== 'undefined' && v instanceof Node)    return '<Node>';
      if (typeof Element !== 'undefined' && v instanceof Element) return '<Element>';
      if (typeof Window  !== 'undefined' && v instanceof Window)  return '<Window>';
      return v;
    });
    if (txt.length > DIAGNOSTIC_PER_KEY_MAX_CHARS) {
      return {
        ok: true,
        value: { __kind: 'oversize', chars: txt.length,
                 preview: txt.slice(0, 256) + '…' },
        kind: 'oversize',
      };
    }
    return { ok: true, value: JSON.parse(txt), kind: 'plain' };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), kind: t };
  }
}

// Capture the active viewport camera. Three.js cameras carry a position,
// quaternion (or matrix world) and a fov; we ALWAYS report position +
// quaternion + matrix to avoid getting caught out by orthographic
// cameras (no fov) or anything driven directly by matrixWorld.
function _snapshotCamera() {
  if (typeof window === 'undefined') return { available: false, reason: 'no window' };
  const cam = window.__forgeCamera;
  if (!cam) return { available: false, reason: 'window.__forgeCamera not set' };
  const out = { available: true, type: cam.type || cam.constructor?.name || 'unknown' };
  try {
    if (cam.position) {
      out.position = [cam.position.x, cam.position.y, cam.position.z];
    }
    if (cam.quaternion) {
      out.quaternion = [cam.quaternion.x, cam.quaternion.y,
                        cam.quaternion.z, cam.quaternion.w];
    }
    if (typeof cam.fov === 'number')    out.fov    = cam.fov;
    if (typeof cam.near === 'number')   out.near   = cam.near;
    if (typeof cam.far === 'number')    out.far    = cam.far;
    if (typeof cam.zoom === 'number')   out.zoom   = cam.zoom;
    if (typeof cam.aspect === 'number') out.aspect = cam.aspect;
    if (cam.matrixWorld && Array.isArray(cam.matrixWorld.elements)) {
      out.matrixWorld = Array.from(cam.matrixWorld.elements);
    }
  } catch (err) {
    out.error = err?.message || String(err);
  }
  // Camera target — Forge publishes the OrbitControls target so the
  // section plane / bookmark restore code can read it.
  try {
    const tgt = window.__forgeCameraTarget;
    if (tgt && typeof tgt === 'object') {
      out.target = [tgt.x, tgt.y, tgt.z];
    }
  } catch { /* fail-soft */ }
  return out;
}

// Capture the kernel version. Try Forge.kernel.version first (the
// renderer-side surface the brief calls out), then fall back to the
// preload bridge `window.forge.version()` which the OCCT addon exposes
// directly. If neither is available, return null with a reason.
function _snapshotKernelVersion() {
  if (typeof window === 'undefined') {
    return { available: false, reason: 'no window' };
  }
  try {
    const k = window.forge?.kernel;
    if (k && typeof k.version === 'function') {
      return { available: true, version: k.version(), source: 'forge.kernel.version' };
    }
    if (k && typeof k.version === 'string') {
      return { available: true, version: k.version, source: 'forge.kernel.version (marker)' };
    }
  } catch { /* fall through */ }
  try {
    if (window.forge && typeof window.forge.version === 'function') {
      return { available: true, version: window.forge.version(), source: 'forge.version()' };
    }
  } catch { /* fall through */ }
  return { available: false, reason: 'window.forge / window.forge.kernel not installed' };
}

// Walk the window keys, pick everything that starts with `__forge`, and
// coerce each value through `_coerce`. Vital keys are force-included
// (always tried first, never truncated by the count cap). The rest are
// sorted alphabetically and cut off at DIAGNOSTIC_KEY_LIMIT to keep the
// report scannable. Returns `{ globals, truncated, totalScanned }`.
function _walkForgeGlobals() {
  if (typeof window === 'undefined') {
    return { globals: {}, truncated: false, totalScanned: 0 };
  }
  const all = Object.keys(window).filter((k) => k.startsWith('__forge'));
  const vitalSet = new Set(DIAGNOSTIC_VITAL_KEYS);
  const vital = all.filter((k) => vitalSet.has(k));
  const rest  = all.filter((k) => !vitalSet.has(k)).sort();
  let truncated = false;
  const restBudget = Math.max(0, DIAGNOSTIC_KEY_LIMIT - vital.length);
  const restPicked = rest.slice(0, restBudget);
  if (rest.length > restBudget) truncated = true;
  const ordered = vital.concat(restPicked);
  const globals = {};
  for (const k of ordered) {
    let v;
    try { v = window[k]; }
    catch (err) {
      globals[k] = { __kind: 'access-error', error: err?.message || String(err) };
      continue;
    }
    const res = _coerce(v);
    if (res.ok) {
      globals[k] = res.value;
    } else {
      globals[k] = { __kind: 'coerce-error', error: res.error, valueKind: res.kind };
    }
  }
  return {
    globals,
    truncated,
    totalScanned: all.length,
    vitalIncluded: vital,
    restIncluded: restPicked,
    restOverflowCount: rest.length - restPicked.length,
  };
}

export function buildDiagnosticReport() {
  const reportStartedAt = Date.now();
  const walk = _walkForgeGlobals();
  const camera = _snapshotCamera();
  const kernel = _snapshotKernelVersion();
  let bodiesCount = 0;
  try {
    const arr = (typeof window !== 'undefined') ? window.__forgeBodies : null;
    if (Array.isArray(arr)) bodiesCount = arr.length;
  } catch { /* fail-soft */ }
  let activeSelectionSummary = null;
  try {
    const sel = (typeof window !== 'undefined') ? window.__forgeSelection : null;
    if (sel) {
      activeSelectionSummary = {
        kind: sel.kind || null,
        bodyHandle: typeof sel.bodyHandle === 'number' ? sel.bodyHandle : null,
        bodyId:     typeof sel.bodyId     === 'string' ? sel.bodyId     : null,
        ids:        Array.isArray(sel.ids) ? sel.ids.slice(0, 32) : null,
      };
    }
  } catch { /* fail-soft */ }
  // The renderer-side report carries everything support needs to
  // reproduce a bug: env, kernel, scene, camera, selection, and the
  // full globals walk. The shape is stable v1 — downstream Archie
  // playbooks can grep for `report.version === 1`.
  return {
    version: 1,
    capturedAt: new Date(reportStartedAt).toISOString(),
    capturedAtMs: reportStartedAt,
    ua: (typeof navigator !== 'undefined' && navigator.userAgent) || null,
    platform: (typeof navigator !== 'undefined' && navigator.platform) || null,
    language: (typeof navigator !== 'undefined' && navigator.language) || null,
    href: (typeof location !== 'undefined' && location.href) || null,
    bridges: {
      hasForge:    typeof window !== 'undefined' && !!window.forge,
      hasDialog:   typeof window !== 'undefined' && !!window.forge?.dialog,
      hasSaveFile: typeof window !== 'undefined'
                    && typeof window.forge?.dialog?.saveFile === 'function',
      hasWriteBlob:typeof window !== 'undefined'
                    && typeof window.forge?.dialog?.writeBlob === 'function',
    },
    kernel,
    camera,
    selection: activeSelectionSummary,
    bodiesCount,
    globals: walk.globals,
    diagnostics: {
      windowForgeKeysScanned: walk.totalScanned,
      windowForgeKeysIncluded: Object.keys(walk.globals).length,
      vitalKeys: walk.vitalIncluded,
      restKeyOverflow: walk.restOverflowCount,
      truncatedByCount: walk.truncated,
      perKeyMaxChars: DIAGNOSTIC_PER_KEY_MAX_CHARS,
      keyLimit: DIAGNOSTIC_KEY_LIMIT,
      buildTimeMs: Date.now() - reportStartedAt,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Styles.

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 380,
  zIndex: 1340,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 12,
  overflow: 'hidden',
};
const headerStyle = {
  display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', gap: 8,
};
const closeBtn = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3,
};
const helpStyle = {
  color: 'var(--forge-ink-mute)', lineHeight: 1.45, fontSize: 11,
};
const bigBtnStyle = {
  background: 'var(--forge-accent, #2e7be0)',
  color: '#fff',
  border: '1px solid var(--forge-accent, #2e7be0)',
  padding: '10px 14px',
  cursor: 'pointer',
  fontFamily: 'var(--forge-mono)',
  fontWeight: 600,
  fontSize: 12,
  borderRadius: 4,
  textAlign: 'center',
  width: '100%',
};
const summaryStyle = {
  flex: 1,
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 4,
  background: 'var(--forge-surface)',
  fontFamily: 'var(--forge-mono)',
  fontSize: 11,
  padding: '8px 10px',
  overflowY: 'auto',
  color: 'var(--forge-ink-mute)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
};
const statusBarStyle = {
  display: 'flex', justifyContent: 'space-between',
  fontFamily: 'var(--forge-mono)', fontSize: 10,
  color: 'var(--forge-ink-mute)',
};

// ─────────────────────────────────────────────────────────────────────
// Panel.

export function DiagnosticDumpPanel({ open, onClose }) {
  const [busy, setBusy] = useState(false);
  const [lastReport, setLastReport] = useState(null);
  const [lastPath, setLastPath] = useState(null);
  const [lastError, setLastError] = useState(null);
  const [statusText, setStatusText] = useState('Idle.');

  const onGenerate = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setLastError(null);
    setStatusText('Collecting snapshot…');
    try {
      const report = buildDiagnosticReport();
      setLastReport(report);
      const dialog = (typeof window !== 'undefined') ? window.forge?.dialog : null;
      if (!dialog || typeof dialog.saveFile !== 'function'
                  || typeof dialog.writeBlob !== 'function') {
        setLastError('forge.dialog.saveFile / writeBlob unavailable');
        setStatusText('Error: dialog bridge missing.');
        return;
      }
      setStatusText('Picking destination…');
      const stamp = report.capturedAt.slice(0, 19).replace(/[:T]/g, '-');
      // Test hook — under Electron contextIsolation the renderer can't
      // override the contextBridge-frozen `forge.dialog.saveFile`. The
      // e2e spec sets `window.__forgeDiagnosticDumpForcePath` to a
      // deterministic absolute path before clicking Generate; we honour
      // it if present, otherwise fall back to the real native dialog.
      const forcedPath = (typeof window !== 'undefined')
        ? window.__forgeDiagnosticDumpForcePath : null;
      const filepath = (typeof forcedPath === 'string' && forcedPath.length)
        ? forcedPath
        : await dialog.saveFile({
            title: 'Save Diagnostic Report',
            defaultPath: `forge-diagnostic-${stamp}.json`,
            filters: [{ name: 'JSON', extensions: ['json'] }],
          });
      if (!filepath) {
        setStatusText('Cancelled.');
        return;
      }
      setStatusText('Writing…');
      const payload = JSON.stringify(report, null, 2);
      const bytes = new TextEncoder().encode(payload);
      const res = await dialog.writeBlob(filepath, bytes);
      if (res && res.ok) {
        setLastPath(filepath);
        try { window.__forgeLastDiagnosticPath = filepath; } catch {}
        const tail = filepath.split('/').pop();
        setStatusText(`Saved → ${tail} (${res.bytes} bytes)`);
        // Bus event so Archie / sibling panels can react.
        try {
          window.dispatchEvent(new CustomEvent('forge:diagnostic-saved', {
            detail: { path: filepath, bytes: res.bytes,
                      reportVersion: report.version },
          }));
        } catch { /* fail-soft */ }
      } else {
        setLastError(res?.error || 'writeBlob failed');
        setStatusText(`Error: ${res?.error || 'writeBlob failed'}`);
      }
    } catch (err) {
      const msg = err?.message || String(err);
      setLastError(msg);
      setStatusText(`Error: ${msg}`);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  // Reset transient state every time the panel opens so a previous
  // session's status pill doesn't carry over.
  useEffect(() => {
    if (!open) return;
    setLastError(null);
    setStatusText('Idle.');
  }, [open]);

  if (!open) return null;

  const reportSummary = lastReport ? [
    `version: ${lastReport.version}`,
    `capturedAt: ${lastReport.capturedAt}`,
    `kernel.version: ${lastReport.kernel?.version ?? 'unavailable'}`,
    `bodies: ${lastReport.bodiesCount}`,
    `selection.kind: ${lastReport.selection?.kind ?? 'none'}`,
    `camera.position: ${lastReport.camera?.position
        ? lastReport.camera.position.map((n) => n.toFixed(2)).join(', ')
        : 'unavailable'}`,
    `windowForgeKeys: scanned ${lastReport.diagnostics.windowForgeKeysScanned}, `
      + `included ${lastReport.diagnostics.windowForgeKeysIncluded}`,
    `truncatedByCount: ${lastReport.diagnostics.truncatedByCount}`,
    `bridges: dialog=${lastReport.bridges.hasDialog} `
      + `saveFile=${lastReport.bridges.hasSaveFile} `
      + `writeBlob=${lastReport.bridges.hasWriteBlob}`,
    `ua: ${(lastReport.ua || '').slice(0, 96)}`,
  ].join('\n') : 'No report yet — click "Generate diagnostic report" to collect.';

  return (
    <div style={panelStyle}
         data-testid="forge-diagnostic-dump-panel"
         data-busy={busy ? 'true' : 'false'}
         data-has-report={lastReport ? 'true' : 'false'}>
      <header style={headerStyle}>
        <strong>Diagnostic Dump</strong>
        <button onClick={onClose}
                data-testid="forge-diagnostic-dump-close"
                style={closeBtn}>×</button>
      </header>

      <div style={helpStyle}
           data-testid="forge-diagnostic-dump-help">
        Snapshots all <code>window.__forge*</code> globals, the active
        selection, the live viewport camera and the kernel version into a
        single JSON file. Attach the saved file to a support thread or
        feed it to Archie for debugging.
      </div>

      <button type="button"
              onClick={onGenerate}
              disabled={busy}
              style={{
                ...bigBtnStyle,
                opacity: busy ? 0.6 : 1,
                cursor: busy ? 'progress' : 'pointer',
              }}
              data-testid="forge-diagnostic-dump-generate">
        {busy ? 'Generating…' : 'Generate diagnostic report'}
      </button>

      <div style={summaryStyle}
           data-testid="forge-diagnostic-dump-summary">
        {reportSummary}
      </div>

      {lastError && (
        <div data-testid="forge-diagnostic-dump-error"
             style={{ fontSize: 11, color: 'var(--forge-bad, #ff6363)',
                      wordBreak: 'break-all' }}>
          {lastError}
        </div>
      )}

      <div style={statusBarStyle}
           data-testid="forge-diagnostic-dump-status"
           data-status-text={statusText}
           data-last-path={lastPath || ''}>
        <span data-testid="forge-diagnostic-dump-status-text">
          {statusText}
        </span>
        {lastPath && (
          <span data-testid="forge-diagnostic-dump-last-path"
                style={{ wordBreak: 'break-all' }}>
            {lastPath.split('/').pop()}
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host.
//
// Listens for the `tools.diagnostic` menu action, exposes the
// imperative open/close hooks plus a `__forgeBuildDiagnosticReport`
// helper for Archie / e2e / plugins that want to build a snapshot
// without round-tripping through the save dialog.

export function DiagnosticDumpPanelHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenDiagnosticDump = (v) =>
      setOpen(v === undefined ? true : !!v);
    window.__forgeCloseDiagnosticDump = () => setOpen(false);
    window.__forgeBuildDiagnosticReport = buildDiagnosticReport;
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.diagnostic') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenDiagnosticDump; } catch {}
      try { delete window.__forgeCloseDiagnosticDump; } catch {}
      try { delete window.__forgeBuildDiagnosticReport; } catch {}
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <DiagnosticDumpPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default DiagnosticDumpPanel;
