// PUSH-163 (Slice 119) — BREP binary cache (streamed load for 100k-part
// assemblies).
//
// What the panel does:
//
//   * Snapshots `window.__forgeBodies` at open time. Lists every body in
//     a checklist; default = all bodies checked.
//   * "Cache to disk" — runs the pure-fn `cacheBodies(checked)` pipeline
//     from brepCacheMath.js. The pipeline:
//       1. Calls `forge.io.exportBrep(handle, /tmp/<id>.brep)` per body.
//       2. Reads the bytes back via `fetch('file://…')`.
//       3. Builds a JSZip archive (`brep/<id>.brep` + `manifest.json`).
//       4. Pops `forge.dialog.saveFile` with default `.forgeCache.zip`.
//       5. Ships the archive bytes to disk via `forge.dialog.writeBlob`.
//     Per-body byte counts + a grand total render in the panel.
//   * "Load from cache" — pops `forge.dialog.openFile` for a
//     `.forgeCache.zip`, runs `loadFromCache(filepath)`, appends every
//     restored body to the scene via `window.__forgeAppendBody`.
//     Volumes round-trip — the e2e asserts each body's restored volume
//     matches the cached value within 0.1 %.
//
// Reachable via:
//   * `tools.brepCache` menu action,
//   * `window.__forgeOpenBrepCache(true|false)`,
//   * `window.__forgeBrepCacheHelper.{cacheBodies, loadFromCache}` for
//     headless callers (Archie / plugins / the e2e).
//
// Hard constraints:
//   * NO new npm / C++ / external deps.
//   * Real impl, no MVP / stub / placeholder.
//   * Surgical edits to Menus.jsx (one new entry) + App.jsx (one
//     import + one mount).

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import {
  cacheBodies,
  loadFromCache,
  FORGE_BREP_CACHE_KIND,
  FORGE_BREP_CACHE_VERSION,
  saveSceneToActiveCache,
  loadActiveCacheIntoScene,
  listActiveCacheEntries,
  listCachedActiveIds,
  clearActiveCache,
  saveBodyToActiveCache,
  loadBodyFromActiveCache,
  FORGE_BREP_CACHE_ACTIVE_VERSION,
} from './brepCacheMath.js';

const PANEL_W = 640;

// ─────────────────────────────────────────────────────────────────────
// Snapshot.

export function readBodiesSnapshot() {
  if (typeof window === 'undefined') return [];
  const all = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return all.filter(Boolean).map((b) => ({
    id:      b.id,
    name:    b.name || String(b.id),
    kind:    b.kind || 'unknown',
    handle:  (typeof b.handle === 'number') ? b.handle : null,
    toolId:  b.toolId  ?? null,
    params:  b.params  ?? null,
    spec:    b.spec    ?? null,
    material: b.material ?? null,
  }));
}

// ─────────────────────────────────────────────────────────────────────
// Styles.

function panelStyle() {
  return {
    position: 'fixed',
    top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
    right: 0,
    width: PANEL_W,
    maxWidth: '96vw',
    height: 'calc(100vh - var(--forge-topbar-h, 40px) - var(--forge-qat-h, 32px) - var(--forge-cmdbar-h, 24px))',
    background: 'var(--forge-canvas-2, #161b22)',
    borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
    boxShadow: '-12px 0 32px rgba(0,0,0,0.45)',
    display: 'flex', flexDirection: 'column',
    fontSize: 12,
    color: 'var(--forge-ink, #dadde2)',
    zIndex: 1295,
  };
}

const HEADER_CELL = {
  padding: '6px 8px',
  textAlign: 'left',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontSize: 10,
  color: 'var(--forge-ink-mute, #9aa1ab)',
};

const CELL = {
  padding: '4px 8px',
  fontFamily: 'var(--forge-mono, ui-monospace, SF Mono, Menlo, monospace)',
  fontSize: 11,
  textAlign: 'left',
};
const CELL_RIGHT = { ...CELL, textAlign: 'right' };

function btnStyle(variant) {
  if (variant === 'primary') {
    return {
      background: 'var(--forge-accent-mute, #1f3a72)',
      border: '1px solid var(--forge-accent-rim, #3a7afe)',
      borderRadius: 3,
      color: 'var(--forge-ink, #dadde2)',
      font: 'inherit', fontSize: 11,
      padding: '4px 10px',
      cursor: 'pointer',
    };
  }
  return {
    background: 'var(--forge-canvas, #0e1117)',
    border: '1px solid var(--forge-rail-edge, #2a2d34)',
    borderRadius: 3,
    color: 'var(--forge-ink, #dadde2)',
    font: 'inherit', fontSize: 11,
    padding: '4px 10px',
    cursor: 'pointer',
  };
}

function formatBytes(b) {
  if (typeof b !== 'number' || !Number.isFinite(b)) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(2)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

// ─────────────────────────────────────────────────────────────────────
// Panel.

export function BrepCachePanel({ open, onClose, bodies = [] }) {
  const [liveBodies, setLiveBodies] = useState(() => bodies);
  const [checked, setChecked] = useState(() => new Set());
  const [status, setStatus] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLiveBodies(bodies);
    // Default check every native body — synthetic / unknown can't be
    // BREP-cached so they stay unchecked.
    const next = new Set();
    for (const b of bodies) {
      if (b.kind === 'native' && typeof b.handle === 'number') next.add(b.id);
    }
    setChecked(next);
  }, [bodies]);

  const onRefresh = useCallback(() => {
    setLiveBodies(readBodiesSnapshot());
    setStatus(null);
  }, []);

  const onToggle = useCallback((id) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const onToggleAll = useCallback(() => {
    const everyNative = liveBodies.filter(
      (b) => b.kind === 'native' && typeof b.handle === 'number',
    );
    if (checked.size >= everyNative.length) {
      setChecked(new Set());
    } else {
      setChecked(new Set(everyNative.map((b) => b.id)));
    }
  }, [liveBodies, checked]);

  const checkedBodies = useMemo(
    () => liveBodies.filter((b) => checked.has(b.id)),
    [liveBodies, checked],
  );

  const checkedCount = checkedBodies.length;

  // ── Cache to disk ──────────────────────────────────────────────────
  const onCacheToDisk = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setStatus('packing…');
    try {
      const dialog = (typeof window !== 'undefined') ? window.forge?.dialog : null;
      if (!dialog || typeof dialog.saveFile !== 'function'
                  || typeof dialog.writeBlob !== 'function') {
        setStatus('error: forge.dialog.saveFile / writeBlob unavailable');
        setBusy(false);
        return;
      }
      const packed = await cacheBodies(checkedBodies, { label: 'BREP Cache' });
      setLastResult({ kind: 'save', ...packed });

      // Publish for headless callers + the e2e spec, *before* the
      // OS dialog pops — gives the test a way to introspect without
      // having to wait for the save round-trip.
      try { window.__forgeLastBrepCacheManifest = packed.manifest; } catch {}
      try { window.__forgeLastBrepCacheArchiveBytes = packed.archiveBytes; } catch {}
      try { window.__forgeLastBrepCacheTotalBytes = packed.totalBytes; } catch {}

      const stamp = new Date().toISOString().slice(0, 10);
      const filepath = await dialog.saveFile({
        title: 'Save BREP Cache',
        defaultPath: `forge-cache-${stamp}.forgeCache.zip`,
        filters: [{ name: 'Forge BREP Cache', extensions: ['zip'] }],
      });
      if (!filepath) {
        setStatus('cancelled');
        setBusy(false);
        return;
      }
      const r = await dialog.writeBlob(filepath, packed.archive);
      if (r && r.ok) {
        try { window.__forgeLastBrepCachePath = filepath; } catch {}
        setStatus(
          `saved → ${filepath.split('/').pop()} `
          + `(${formatBytes(r.bytes ?? packed.archiveBytes)}, `
          + `${packed.manifest.totals.ok} bodies)`,
        );
      } else {
        setStatus(`error: ${r?.error || 'writeBlob failed'}`);
      }
    } catch (err) {
      setStatus(`error: ${err.message || String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, checkedBodies]);

  // ── Load from cache ────────────────────────────────────────────────
  const onLoadFromCache = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setStatus('loading…');
    try {
      const dialog = (typeof window !== 'undefined') ? window.forge?.dialog : null;
      if (!dialog || typeof dialog.openFile !== 'function') {
        setStatus('error: forge.dialog.openFile unavailable');
        setBusy(false);
        return;
      }
      const filepath = await dialog.openFile({
        title: 'Load BREP Cache',
        filters: [{ name: 'Forge BREP Cache', extensions: ['zip'] }],
        properties: ['openFile'],
      });
      const fp = Array.isArray(filepath) ? filepath[0] : filepath;
      if (!fp) {
        setStatus('cancelled');
        setBusy(false);
        return;
      }
      const r = await loadFromCache(fp);
      setLastResult({ kind: 'load', ...r, filepath: fp });

      try { window.__forgeLastBrepCacheLoad = r; } catch {}
      try { window.__forgeLastBrepCacheLoadPath = fp; } catch {}

      if (!r.ok) {
        setStatus(`error: ${r.error || 'load failed'}`);
        setBusy(false);
        return;
      }
      // Refresh the bodies list so the freshly-restored bodies appear
      // in the checklist.
      setLiveBodies(readBodiesSnapshot());
      const errs = (r.errors || []).length;
      setStatus(
        errs
          ? `loaded · ${r.restored.length} bodies · ${errs} errors`
          : `loaded · ${r.restored.length} bodies`,
      );
    } catch (err) {
      setStatus(`error: ${err.message || String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  // Auto-clear the status pill after a few seconds. Errors stick around
  // 5 seconds; everything else 3 seconds.
  useEffect(() => {
    if (!status) return undefined;
    const isErr = status.startsWith('error');
    const t = setTimeout(() => setStatus(null), isErr ? 5000 : 3200);
    return () => clearTimeout(t);
  }, [status]);

  // Publish helper + result snapshots for headless callers.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeBrepCacheBodies = liveBodies;
    window.__forgeBrepCacheChecked = Array.from(checked);
  }, [liveBodies, checked]);

  if (!open) return null;

  return createPortal(
    <aside
      role="region"
      aria-label="BREP binary cache"
      data-testid="forge-brepcache-panel"
      data-checked-count={checkedCount}
      style={panelStyle()}>

      <Header
        bodyCount={liveBodies.length}
        checkedCount={checkedCount}
        onToggleAll={onToggleAll}
        onRefresh={onRefresh}
        onCache={onCacheToDisk}
        onLoad={onLoadFromCache}
        onClose={onClose}
        busy={busy}
        status={status}
      />

      <div style={{
        flex: 1, overflowY: 'auto',
        background: 'var(--forge-canvas, #0e1117)',
      }}>
        {liveBodies.length === 0 ? (
          <div data-testid="forge-brepcache-empty" style={{
            padding: 20, fontStyle: 'italic',
            color: 'var(--forge-ink-mute, #9aa1ab)', fontSize: 11,
          }}>
            No bodies in the scene. Seed at least one OCCT body, then
            click Refresh. (Synthetic bodies can't be BREP-cached — the
            kernel needs a real TopoDS_Shape.)
          </div>
        ) : (
          <table style={{
            width: '100%', borderCollapse: 'collapse',
          }}>
            <thead>
              <tr style={{
                position: 'sticky', top: 0,
                background: 'var(--forge-canvas-2, #161b22)',
                borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
              }}>
                <th style={{ ...HEADER_CELL, width: 28 }}>•</th>
                <th style={HEADER_CELL}>Body</th>
                <th style={HEADER_CELL}>Kind</th>
                <th style={{ ...HEADER_CELL, textAlign: 'right' }}>Handle</th>
                <th style={{ ...HEADER_CELL, textAlign: 'right' }}>Cached bytes</th>
              </tr>
            </thead>
            <tbody>
              {liveBodies.map((b) => {
                const isCheckable = b.kind === 'native' && typeof b.handle === 'number';
                const cached = (lastResult && lastResult.kind === 'save')
                  ? (lastResult.entries || []).find((e) => e.id === b.id)
                  : null;
                return (
                  <Row key={b.id}
                       body={b}
                       checked={checked.has(b.id)}
                       checkable={isCheckable}
                       onToggle={() => onToggle(b.id)}
                       cached={cached} />
                );
              })}
            </tbody>
            {lastResult && (
              <tfoot>
                <tr data-testid="forge-brepcache-totals"
                    style={{
                      borderTop: '2px solid var(--forge-accent-rim, #3a7afe)',
                      background: 'var(--forge-canvas-2, #161b22)',
                      color: 'var(--forge-ink, #dadde2)',
                      fontWeight: 700,
                    }}>
                  <td style={CELL}>—</td>
                  <td style={CELL}
                      data-testid="forge-brepcache-summary-label">
                    {lastResult.kind === 'save'
                      ? `Cached · ${lastResult.manifest?.totals?.ok ?? 0} bodies`
                      : `Loaded · ${lastResult.restored?.length ?? 0} bodies`}
                  </td>
                  <td style={CELL}>—</td>
                  <td style={CELL_RIGHT}>—</td>
                  <td style={CELL_RIGHT}
                      data-testid="forge-brepcache-summary-bytes">
                    {lastResult.kind === 'save'
                      ? formatBytes(lastResult.totalBytes)
                      : formatBytes(
                          (lastResult.restored || []).reduce(
                            (acc, r) => acc + (r.bytes || 0), 0,
                          ),
                        )}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        )}
        {lastResult && lastResult.kind === 'load' && (
          <RestoreReport result={lastResult} />
        )}
      </div>
    </aside>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────

function Header({
  bodyCount, checkedCount, onToggleAll, onRefresh,
  onCache, onLoad, onClose, busy, status,
}) {
  return (
    <header style={{
      display: 'flex', flexDirection: 'column',
      borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
      background: 'var(--forge-canvas, #0e1117)',
      flexShrink: 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 12px',
      }}>
        <Icon name="io.brep" size={14} />
        <span style={{ fontSize: 12, fontWeight: 600 }}>
          BREP Binary Cache
        </span>
        <span data-testid="forge-brepcache-row-count"
              style={{
                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                fontSize: 10,
                color: 'var(--forge-ink-mute, #9aa1ab)',
                padding: '1px 6px', borderRadius: 'var(--forge-radius-pill, 10px)',
                border: '1px solid var(--forge-rail-edge, #2a2d34)',
              }}>
          {checkedCount} / {bodyCount} selected
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={onToggleAll}
                disabled={busy}
                data-testid="forge-brepcache-toggle-all"
                style={btnStyle()}>
          Toggle all
        </button>
        <button type="button"
                onClick={onRefresh}
                disabled={busy}
                data-testid="forge-brepcache-refresh"
                style={btnStyle()}>
          Refresh
        </button>
        <button type="button"
                onClick={onClose}
                aria-label="Close BREP cache panel"
                data-testid="forge-brepcache-close"
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--forge-ink-mute, #9aa1ab)', cursor: 'pointer',
                  display: 'inline-flex', padding: 2,
                }}>
          ×
        </button>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 12px 10px',
      }}>
        <button type="button"
                onClick={onCache}
                disabled={busy || checkedCount === 0}
                data-testid="forge-brepcache-save"
                style={btnStyle('primary')}>
          Cache to disk
        </button>
        <button type="button"
                onClick={onLoad}
                disabled={busy}
                data-testid="forge-brepcache-load"
                style={btnStyle()}>
          Load from cache
        </button>
        <span style={{ flex: 1 }} />
        <span data-testid="forge-brepcache-kind-version"
              style={{
                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                fontSize: 10,
                color: 'var(--forge-ink-mute, #9aa1ab)',
              }}>
          {FORGE_BREP_CACHE_KIND} · v{FORGE_BREP_CACHE_VERSION}
        </span>
      </div>

      {status && (
        <div style={{
          padding: '0 12px 8px',
          fontSize: 10,
          fontFamily: 'var(--forge-mono, monospace)',
          color: status.startsWith('error')
            ? 'var(--forge-err, #ff6363)'
            : 'var(--forge-ok, #4caf50)',
        }} data-testid="forge-brepcache-status">
          {status}
        </div>
      )}
    </header>
  );
}

function Row({ body, checked, checkable, onToggle, cached }) {
  return (
    <tr data-testid="forge-brepcache-row"
        data-body-id={body.id}
        data-kind={body.kind}
        data-checked={checked ? '1' : '0'}
        data-handle={body.handle ?? ''}
        data-cached-bytes={cached?.bytes ?? ''}
        style={{
          borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
        }}>
      <td style={{ ...CELL, textAlign: 'center' }}>
        <input type="checkbox"
               checked={checked && checkable}
               disabled={!checkable}
               onChange={onToggle}
               data-testid="forge-brepcache-row-check" />
      </td>
      <td style={CELL} data-testid="forge-brepcache-row-name">{body.name}</td>
      <td style={CELL} data-testid="forge-brepcache-row-kind">{body.kind}</td>
      <td style={CELL_RIGHT} data-testid="forge-brepcache-row-handle">
        {body.handle ?? '—'}
      </td>
      <td style={CELL_RIGHT} data-testid="forge-brepcache-row-cached-bytes">
        {cached && cached.status === 'ok' ? formatBytes(cached.bytes) : '—'}
      </td>
    </tr>
  );
}

function RestoreReport({ result }) {
  return (
    <div data-testid="forge-brepcache-restore-report"
         style={{
           padding: '8px 12px',
           borderTop: '1px solid var(--forge-rail-edge, #2a2d34)',
           background: 'var(--forge-canvas-2, #161b22)',
           fontFamily: 'var(--forge-mono, monospace)',
           fontSize: 11,
         }}>
      <div style={{ marginBottom: 4, fontWeight: 600 }}>Restore report</div>
      {(result.restored || []).map((r) => (
        <div key={r.id}
             data-testid="forge-brepcache-restore-row"
             data-id={r.id}
             data-volume-match={r.volumeMatch ? '1' : '0'}
             style={{
               display: 'flex', gap: 8,
               color: r.volumeMatch
                 ? 'var(--forge-ok, #4caf50)'
                 : 'var(--forge-err, #ff6363)',
             }}>
          <span>{r.id}</span>
          <span style={{ flex: 1 }} />
          <span data-testid="forge-brepcache-restore-volume">
            V {Number(r.restoredVolume ?? 0).toFixed(3)} mm³
            {' '}/ cached {Number(r.cachedVolume ?? 0).toFixed(3)} mm³
            {' '}{r.volumeMatch ? '✓' : '✗'}
          </span>
        </div>
      ))}
      {(result.errors || []).map((e, i) => (
        <div key={`err-${i}`}
             style={{ color: 'var(--forge-err, #ff6363)' }}
             data-testid="forge-brepcache-restore-err">
          {e.id} · {e.kind} · {e.error || JSON.stringify(e)}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host. Exposes:
//   window.__forgeOpenBrepCache(true|false)
//   window.__forgeBrepCacheHelper.cacheBodies / .loadFromCache
//   listens for `tools.brepCache` menu action.

export function BrepCachePanelHost() {
  const [open, setOpen] = useState(false);
  const [bodies, setBodies] = useState(() => readBodiesSnapshot());
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    window.__forgeOpenBrepCache = (v) => {
      setBodies(readBodiesSnapshot());
      setOpen(v === undefined ? true : !!v);
    };
    window.__forgeCloseBrepCache = () => setOpen(false);
    window.__forgeRefreshBrepCache = () => setBodies(readBodiesSnapshot());

    window.__forgeBrepCacheHelper = Object.freeze({
      cacheBodies,
      loadFromCache,
      readBodiesSnapshot,
      FORGE_BREP_CACHE_KIND,
      FORGE_BREP_CACHE_VERSION,
    });

    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.brepCache') {
        setBodies(readBodiesSnapshot());
        setOpen(true);
      }
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      try { delete window.__forgeOpenBrepCache; } catch {}
      try { delete window.__forgeCloseBrepCache; } catch {}
      try { delete window.__forgeRefreshBrepCache; } catch {}
      try { delete window.__forgeBrepCacheHelper; } catch {}
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return (
    <BrepCachePanel
      open={open}
      onClose={() => setOpen(false)}
      bodies={bodies} />
  );
}

// ─────────────────────────────────────────────────────────────────────
// PUSH-215 (Slice-154) — Active load panel.
//
// PUSH-163 (above) ships the offline `.forgeCache.zip` save / load.
// PUSH-215 wires the live restore path: a single panel that lists every
// body already in the active cache (id, name, size_bytes, age) and four
// actions:
//
//   * Load all          — `loadActiveCacheIntoScene()` →
//                          forge.io.importBrep per entry → __forgeAppendBody.
//   * Save current scene — `saveSceneToActiveCache(window.__forgeBodies)`
//                          → forge.io.exportBrep per native body.
//   * Clear             — `clearActiveCache()`.
//   * Reload            — re-pull `listActiveCacheEntries()`.
//
// Self-mounting host exposes `window.__forgeOpenBrepCacheActive(true|false)`
// and listens for `tools.brepCacheActive`. The Active panel coexists with
// the PUSH-163 BrepCachePanel — different test-ids, different storage.

function activePanelStyle() {
  return {
    position: 'fixed',
    top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
    right: 0,
    width: PANEL_W,
    maxWidth: '96vw',
    height: 'calc(100vh - var(--forge-topbar-h, 40px) - var(--forge-qat-h, 32px) - var(--forge-cmdbar-h, 24px))',
    background: 'var(--forge-canvas-2, #161b22)',
    borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
    boxShadow: '-12px 0 32px rgba(0,0,0,0.45)',
    display: 'flex', flexDirection: 'column',
    fontSize: 12,
    color: 'var(--forge-ink, #dadde2)',
    zIndex: 1296,
  };
}

function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${ms} ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function BrepCacheActivePanel({ open, onClose }) {
  const [rows, setRows]       = useState(() => listActiveCacheEntries());
  const [status, setStatus]   = useState(null);
  const [busy, setBusy]       = useState(false);
  const [lastResult, setLast] = useState(null);

  const refresh = useCallback(() => {
    const next = listActiveCacheEntries();
    setRows(next);
    if (typeof window !== 'undefined') {
      try { window.__forgeBrepCacheActiveRows = next; } catch {}
    }
    return next;
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  // Tick the "age" column every 1.5 s while open.
  useEffect(() => {
    if (!open) return undefined;
    const t = setInterval(() => refresh(), 1500);
    return () => clearInterval(t);
  }, [open, refresh]);

  // Auto-clear status pill — errors stick longer.
  useEffect(() => {
    if (!status) return undefined;
    const isErr = status.startsWith('error');
    const t = setTimeout(() => setStatus(null), isErr ? 6000 : 3200);
    return () => clearTimeout(t);
  }, [status]);

  const onSaveScene = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setStatus('saving current scene…');
    try {
      const bodies = (typeof window !== 'undefined' && Array.isArray(window.__forgeBodies))
        ? window.__forgeBodies.slice() : [];
      if (bodies.length === 0) {
        setStatus('error: no bodies in window.__forgeBodies to save');
        setBusy(false);
        return;
      }
      const r = await saveSceneToActiveCache(bodies);
      setLast({ kind: 'save', ...r });
      try { window.__forgeBrepCacheActiveLastSave = r; } catch {}
      const next = refresh();
      if (r.errors && r.errors.length > 0) {
        setStatus(`saved · ${r.saved.length} bodies · ${r.errors.length} errors`);
      } else {
        setStatus(`saved · ${r.saved.length} bodies → ${next.length} cached entries`);
      }
    } catch (err) {
      setStatus(`error: ${err.message || String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, refresh]);

  const onLoadAll = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setStatus('loading cached bodies…');
    try {
      const before = (typeof window !== 'undefined' && Array.isArray(window.__forgeBodies))
        ? window.__forgeBodies.length : 0;
      const r = await loadActiveCacheIntoScene();
      setLast({ kind: 'load', ...r, before });
      try { window.__forgeBrepCacheActiveLastLoad = r; } catch {}
      if (r.errors && r.errors.length > 0) {
        setStatus(`loaded · ${r.restored.length} bodies · ${r.errors.length} errors`);
      } else {
        setStatus(`loaded · ${r.restored.length} bodies → __forgeBodies`);
      }
      refresh();
    } catch (err) {
      setStatus(`error: ${err.message || String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, refresh]);

  const onClear = useCallback(() => {
    if (busy) return;
    const n = clearActiveCache();
    setLast({ kind: 'clear', cleared: n });
    try { window.__forgeBrepCacheActiveLastClear = n; } catch {}
    refresh();
    setStatus(`cleared · ${n} entries`);
  }, [busy, refresh]);

  const totalBytes = useMemo(
    () => rows.reduce((acc, r) => acc + (r.size_bytes || 0), 0),
    [rows],
  );

  if (!open) return null;

  return createPortal(
    <aside
      role="region"
      aria-label="BREP active-load cache"
      data-testid="forge-brepcache-active-panel"
      data-row-count={rows.length}
      style={activePanelStyle()}>

      <header style={{
        display: 'flex', flexDirection: 'column',
        borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
        background: 'var(--forge-canvas, #0e1117)',
        flexShrink: 0,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 12px',
        }}>
          <Icon name="io.brep" size={14} />
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            BREP Cache · Active Load
          </span>
          <span data-testid="forge-brepcache-active-count"
                style={{
                  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                  fontSize: 10,
                  color: 'var(--forge-ink-mute, #9aa1ab)',
                  padding: '1px 6px',
                  borderRadius: 'var(--forge-radius-pill, 10px)',
                  border: '1px solid var(--forge-rail-edge, #2a2d34)',
                }}>
            {rows.length} cached · {formatBytes(totalBytes)}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button"
                  onClick={() => refresh()}
                  disabled={busy}
                  data-testid="forge-brepcache-active-reload"
                  style={btnStyle()}>
            Reload
          </button>
          <button type="button"
                  onClick={onClose}
                  aria-label="Close active BREP cache panel"
                  data-testid="forge-brepcache-active-close"
                  style={{
                    background: 'transparent', border: 'none',
                    color: 'var(--forge-ink-mute, #9aa1ab)', cursor: 'pointer',
                    display: 'inline-flex', padding: 2,
                  }}>
            ×
          </button>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0 12px 10px',
        }}>
          <button type="button"
                  onClick={onLoadAll}
                  disabled={busy || rows.length === 0}
                  data-testid="forge-brepcache-active-load-all"
                  style={btnStyle('primary')}>
            Load all
          </button>
          <button type="button"
                  onClick={onSaveScene}
                  disabled={busy}
                  data-testid="forge-brepcache-active-save-scene"
                  style={btnStyle()}>
            Save current scene to cache
          </button>
          <button type="button"
                  onClick={onClear}
                  disabled={busy || rows.length === 0}
                  data-testid="forge-brepcache-active-clear"
                  style={btnStyle()}>
            Clear
          </button>
          <span style={{ flex: 1 }} />
          <span data-testid="forge-brepcache-active-version"
                style={{
                  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                  fontSize: 10,
                  color: 'var(--forge-ink-mute, #9aa1ab)',
                }}>
            active · v{FORGE_BREP_CACHE_ACTIVE_VERSION}
          </span>
        </div>

        {status && (
          <div style={{
            padding: '0 12px 8px',
            fontSize: 10,
            fontFamily: 'var(--forge-mono, monospace)',
            color: status.startsWith('error')
              ? 'var(--forge-err, #ff6363)'
              : 'var(--forge-ok, #4caf50)',
          }} data-testid="forge-brepcache-active-status">
            {status}
          </div>
        )}
      </header>

      <div style={{
        flex: 1, overflowY: 'auto',
        background: 'var(--forge-canvas, #0e1117)',
      }}>
        {rows.length === 0 ? (
          <div data-testid="forge-brepcache-active-empty"
               style={{
                 padding: 20, fontStyle: 'italic',
                 color: 'var(--forge-ink-mute, #9aa1ab)', fontSize: 11,
               }}>
            Active cache is empty. Click "Save current scene to cache"
            after seeding native bodies — the next session will be able
            to "Load all" them straight back without re-tessellating.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{
                position: 'sticky', top: 0,
                background: 'var(--forge-canvas-2, #161b22)',
                borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
              }}>
                <th style={HEADER_CELL}>Id</th>
                <th style={HEADER_CELL}>Name</th>
                <th style={{ ...HEADER_CELL, textAlign: 'right' }}>size_bytes</th>
                <th style={{ ...HEADER_CELL, textAlign: 'right' }}>Age</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}
                    data-testid="forge-brepcache-active-row"
                    data-id={row.id}
                    data-name={row.name}
                    data-size-bytes={row.size_bytes}
                    style={{
                      borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
                    }}>
                  <td style={CELL}
                      data-testid="forge-brepcache-active-row-id">{row.id}</td>
                  <td style={CELL}
                      data-testid="forge-brepcache-active-row-name">{row.name}</td>
                  <td style={CELL_RIGHT}
                      data-testid="forge-brepcache-active-row-bytes">
                    {formatBytes(row.size_bytes)}
                  </td>
                  <td style={CELL_RIGHT}
                      data-testid="forge-brepcache-active-row-age">
                    {formatAge(row.age_ms)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr data-testid="forge-brepcache-active-totals"
                  style={{
                    borderTop: '2px solid var(--forge-accent-rim, #3a7afe)',
                    background: 'var(--forge-canvas-2, #161b22)',
                    color: 'var(--forge-ink, #dadde2)',
                    fontWeight: 700,
                  }}>
                <td style={CELL}>—</td>
                <td style={CELL}
                    data-testid="forge-brepcache-active-summary-label">
                  Total · {rows.length} entries
                </td>
                <td style={CELL_RIGHT}
                    data-testid="forge-brepcache-active-summary-bytes">
                  {formatBytes(totalBytes)}
                </td>
                <td style={CELL_RIGHT}>—</td>
              </tr>
            </tfoot>
          </table>
        )}

        {lastResult && lastResult.kind === 'load' && (
          <div data-testid="forge-brepcache-active-load-report"
               style={{
                 padding: '8px 12px',
                 borderTop: '1px solid var(--forge-rail-edge, #2a2d34)',
                 background: 'var(--forge-canvas-2, #161b22)',
                 fontFamily: 'var(--forge-mono, monospace)',
                 fontSize: 11,
               }}>
            <div style={{ marginBottom: 4, fontWeight: 600 }}>
              Restore report · {lastResult.restored?.length ?? 0} bodies
            </div>
            {(lastResult.restored || []).map((r) => (
              <div key={r.id}
                   data-testid="forge-brepcache-active-restore-row"
                   data-id={r.id}
                   data-new-handle={r.newHandle ?? ''}
                   style={{ display: 'flex', gap: 8 }}>
                <span>{r.id}</span>
                <span style={{ flex: 1 }} />
                <span data-testid="forge-brepcache-active-restore-handle">
                  handle = {r.newHandle ?? '—'}
                </span>
              </div>
            ))}
            {(lastResult.errors || []).map((e, i) => (
              <div key={`load-err-${i}`}
                   data-testid="forge-brepcache-active-restore-err"
                   style={{ color: 'var(--forge-err, #ff6363)' }}>
                {e.id} · {e.error}
              </div>
            ))}
          </div>
        )}

        {lastResult && lastResult.kind === 'save'
            && lastResult.errors && lastResult.errors.length > 0 && (
          <div data-testid="forge-brepcache-active-save-report"
               style={{
                 padding: '8px 12px',
                 borderTop: '1px solid var(--forge-rail-edge, #2a2d34)',
                 background: 'var(--forge-canvas-2, #161b22)',
                 fontFamily: 'var(--forge-mono, monospace)',
                 fontSize: 11,
               }}>
            <div style={{ marginBottom: 4, fontWeight: 600 }}>
              Save errors · {lastResult.errors.length}
            </div>
            {(lastResult.errors || []).map((e, i) => (
              <div key={`save-err-${i}`}
                   data-testid="forge-brepcache-active-save-err"
                   style={{ color: 'var(--forge-err, #ff6363)' }}>
                {e.id ?? '(no id)'} · {e.error}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>,
    document.body,
  );
}

export function BrepCacheActivePanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    window.__forgeOpenBrepCacheActive  = (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeCloseBrepCacheActive = () => setOpen(false);
    window.__forgeBrepCacheActiveHelper = Object.freeze({
      saveSceneToActiveCache,
      loadActiveCacheIntoScene,
      listActiveCacheEntries,
      listCachedActiveIds,
      clearActiveCache,
      saveBodyToActiveCache,
      loadBodyFromActiveCache,
      FORGE_BREP_CACHE_ACTIVE_VERSION,
    });

    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.brepCacheActive') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      try { delete window.__forgeOpenBrepCacheActive; } catch {}
      try { delete window.__forgeCloseBrepCacheActive; } catch {}
      try { delete window.__forgeBrepCacheActiveHelper; } catch {}
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return (
    <BrepCacheActivePanel
      open={open}
      onClose={() => setOpen(false)} />
  );
}

export default BrepCachePanel;
