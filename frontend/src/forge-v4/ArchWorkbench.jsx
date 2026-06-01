// Forge-150 — Arch/BIM workbench panel.
//
// Right-anchored 380 px drawer that activates whenever the user is on
// the `arch` workbench. Lists every Arch tool grouped FreeCAD-style:
//
//   Structural  | Wall, Slab, Column, Beam
//   Openings    | Window, Door
//   Circulation | Stair, Railing, Ramp
//   Envelope    | Roof
//
// Each row is a button; clicking opens an inline parameter dialog the
// user confirms to dispatch the recipe through archComponents.js. The
// dialog mirrors the DirectEditPanel / SheetMetalWorkbench "OpDialog"
// pattern so the look & feel stays consistent across the panel family.
//
// Manual clicks NEVER write to Archie's thread — they hit the kernel
// dispatcher directly. Archie continues to drive the same dispatcher
// via the Archie tool registry.
//
// Bodies appended via this panel carry:
//   • body.kind = 'native'        — real OCCT handle from window.forge.*
//   • body.ifcType = 'IFCWALL'|…  — picked up by Forge-121 IFC exporter
//   • body.ifcStorey              — defaults to 'Storey 1' (overridable
//                                   from SiteHierarchy)
//   • body.toolId                 — 'arch.wall' etc.
//   • body.params                 — the dialog values, so re-export
//                                   after reload still works.
//
// CRITICAL — React #185 avoidance:
//   • useSyncExternalStore snapshots are versioned (the body list is
//     read off window.__forgeBodies + a version counter we bump
//     locally in response to forge:body-added events).
//   • useEffect deps stay stable — we never close over `bodies` in the
//     mount effect; window setters use the latest snapshot via refs.
//   • We do NOT dispatch wb-changed from inside the body-publish
//     effect (the shell already does this).

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { Icon } from './icons/Icon.jsx';
import { showToast } from './Toast.jsx';
import {
  ARCH_TOOLS, ARCH_TOOLS_BY_ID, ARCH_GROUPS,
  dispatchArchTool,
} from './archComponents.js';

/* =====================================================================
 * Styles — token-driven (matches SheetMetalWorkbench).
 * ===================================================================== */

const panelStyle = {
  position: 'fixed',
  right: 0,
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  bottom: 0,
  width: 380,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  zIndex: 1280,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)',
  font: 'inherit',
  fontSize: 12,
  overflow: 'hidden',
};

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--forge-space-2)',
  paddingBottom: 'var(--forge-space-2)',
  borderBottom: '1px solid var(--forge-rail-edge)',
  fontWeight: 600,
};

const groupStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const groupHeaderStyle = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--forge-ink-mute)',
  paddingTop: 6,
  paddingBottom: 2,
};

const opBtnStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '7px 9px',
  background: 'var(--forge-surface, var(--forge-canvas-3))',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 'var(--forge-radius)',
  color: 'var(--forge-ink)',
  cursor: 'pointer',
  textAlign: 'left',
  font: 'inherit',
  fontSize: 12,
  transition: 'background 90ms, border-color 90ms',
};

const logStyle = {
  marginTop: 'var(--forge-space-2)',
  borderTop: '1px solid var(--forge-rail-edge)',
  paddingTop: 'var(--forge-space-2)',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  maxHeight: 140,
  overflowY: 'auto',
  fontFamily: 'var(--forge-mono)',
  fontSize: 11,
  color: 'var(--forge-ink-2)',
};

/* =====================================================================
 * Field renderer — same shape as SheetMetalWorkbench.
 * ===================================================================== */

function Field({ field, value, onChange }) {
  const inputStyle = {
    width: '100%',
    background: 'var(--forge-canvas)',
    border: '1px solid var(--forge-rail-edge)',
    borderRadius: 'var(--forge-radius)',
    color: 'var(--forge-ink)',
    font: 'inherit',
    fontSize: 12,
    padding: '5px 7px',
    boxSizing: 'border-box',
  };
  if (field.type === 'number' || field.type === 'int') {
    return (
      <input type="number" data-test-field={field.id}
             value={value ?? ''} step={field.step ?? (field.type === 'int' ? 1 : 'any')}
             min={field.min} max={field.max}
             onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
             style={inputStyle} />
    );
  }
  if (field.type === 'enum') {
    return (
      <select data-test-field={field.id} value={value ?? field.default ?? ''}
              onChange={(e) => onChange(e.target.value)}
              style={inputStyle}>
        {(field.options || []).map((opt) => (
          <option key={String(opt.value ?? opt)} value={opt.value ?? opt}>
            {opt.label ?? opt}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === 'bool') {
    return (
      <input type="checkbox" data-test-field={field.id}
             checked={Boolean(value)}
             onChange={(e) => onChange(e.target.checked)}
             style={{ accentColor: 'var(--forge-accent)' }} />
    );
  }
  if (field.type === 'vec3') {
    const arr = Array.isArray(value) ? value : [0, 0, 0];
    return (
      <div style={{ display: 'flex', gap: 4 }}>
        {['x', 'y', 'z'].map((axis, i) => (
          <input key={axis} type="number" data-test-field={`${field.id}.${axis}`}
                 value={arr[i] ?? 0}
                 onChange={(e) => {
                   const n = arr.slice();
                   n[i] = Number(e.target.value) || 0;
                   onChange(n);
                 }}
                 style={{ ...inputStyle, padding: '5px 6px' }} />
        ))}
      </div>
    );
  }
  return (
    <input type="text" data-test-field={field.id}
           value={value ?? ''}
           onChange={(e) => onChange(e.target.value)}
           style={inputStyle} />
  );
}

/* =====================================================================
 * OpDialog — per-tool parameter form.
 * ===================================================================== */

function OpDialog({ tool, onCancel, onConfirm }) {
  // Stable defaults — initialized once per dialog open. We don't put
  // `tool` itself in any deps array that mutates state mid-render.
  const [values, setValues] = useState(() => {
    const v = {};
    for (const f of tool.fields) v[f.id] = f.default;
    return v;
  });
  const submit = useCallback(() => {
    onConfirm(tool.id, values);
  }, [tool.id, values, onConfirm]);

  return (
    <div role="dialog" data-testid="forge-arch-dialog"
         aria-label={`${tool.label} dialog`}
         style={{
           position: 'absolute',
           inset: 'var(--forge-space-2)',
           background: 'var(--forge-canvas-3)',
           border: '1px solid var(--forge-rail-edge)',
           borderRadius: 'var(--forge-radius-lg)',
           boxShadow: '0 12px 36px rgba(0,0,0,0.55)',
           display: 'flex',
           flexDirection: 'column',
           padding: 'var(--forge-space-3)',
           gap: 'var(--forge-space-2)',
           overflowY: 'auto',
           zIndex: 1,
         }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ flex: 1 }}>{tool.label}</strong>
        <span style={{ fontFamily: 'var(--forge-mono)', fontSize: 10,
                       color: 'var(--forge-ink-mute)' }}>
          {tool.ifcType}
        </span>
        <button type="button" onClick={onCancel}
                data-testid="forge-arch-dialog-close"
                aria-label="Close dialog"
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink-mute)', cursor: 'pointer',
                         display: 'inline-flex', padding: 2 }}>
          <Icon name="select.clear" size={12} />
        </button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--forge-ink-mute)' }}>
        {tool.id}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tool.fields.map((f) => (
          <label key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase',
                           letterSpacing: '0.06em',
                           color: 'var(--forge-ink-mute)' }}>
              {f.label}{f.unit ? ` (${f.unit})` : ''}
            </span>
            <Field field={f} value={values[f.id]}
                   onChange={(v) => setValues((s) => ({ ...s, [f.id]: v }))} />
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <button type="button"
                onClick={onCancel}
                data-testid="forge-arch-dialog-cancel"
                style={{ flex: 1, background: 'var(--forge-surface, var(--forge-canvas-3))',
                         border: '1px solid var(--forge-rail-edge)',
                         borderRadius: 'var(--forge-radius)',
                         color: 'var(--forge-ink)',
                         font: 'inherit', fontSize: 12,
                         padding: '6px 10px', cursor: 'pointer' }}>
          Cancel
        </button>
        <button type="button"
                onClick={submit}
                data-testid="forge-arch-dialog-confirm"
                style={{ flex: 1,
                         background: 'var(--forge-accent-mute)',
                         border: '1px solid var(--forge-accent)',
                         borderRadius: 'var(--forge-radius)',
                         color: 'var(--forge-ink)',
                         font: 'inherit', fontSize: 12, fontWeight: 600,
                         padding: '6px 10px', cursor: 'pointer' }}>
          Place
        </button>
      </div>
    </div>
  );
}

/* =====================================================================
 * Persistence helpers — Arch bodies (ifcType + storey assignment)
 * survive a reload via localStorage so the IFC exporter still picks
 * them up.
 *
 * Storage shape (key = "forge.v4.arch.bodies"):
 *   [{ id, toolId, ifcType, ifcStorey, params, handle?, kind }]
 *
 * On mount we hydrate window.__forgeBodies with this list IF the body
 * registry is empty (avoids clobbering an in-flight scene). The shell's
 * own snapshot mechanism (file.save) overrides this when present.
 * ===================================================================== */

const STORAGE_KEY = 'forge.v4.arch.bodies';

function loadArchBodies() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveArchBodies(bodies) {
  if (typeof localStorage === 'undefined') return;
  try {
    // We persist only Arch-tagged bodies (the ones we created) and only
    // the params + ifc data — handles are runtime and re-derived on reload.
    const archOnly = (bodies || [])
      .filter((b) => b && typeof b.toolId === 'string' && b.toolId.startsWith('arch.'))
      .map((b) => ({
        id: b.id, toolId: b.toolId,
        ifcType: b.ifcType, ifcStorey: b.ifcStorey || 'Storey 1',
        params: b.params || {}, kind: 'native',
        name: b.name,
        ifcBuilding: b.ifcBuilding || 'Building 1',
        ifcSite: b.ifcSite || 'Default Site',
      }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(archOnly));
  } catch { /* quota or serialization error — non-fatal */ }
}

/* =====================================================================
 * Panel.
 * ===================================================================== */

export function ArchWorkbench({ open, onClose, onResult }) {
  const [activeTool, setActiveTool] = useState(null);
  const [log, setLog] = useState([]);

  // Stable ready signal — only re-evaluated on mount + tool open.
  // We avoid useSyncExternalStore for this because the parent host
  // controls `open` and we just need a one-shot probe.
  const kernelReady = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const f = window.forge;
    return !!(f && typeof f.makeBox === 'function'
                && typeof f.fuse    === 'function'
                && typeof f.cut     === 'function'
                && typeof f.translate === 'function');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (activeTool) setActiveTool(null);
        else onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, activeTool, onClose]);

  const handleConfirm = useCallback((toolId, params) => {
    const tool = ARCH_TOOLS_BY_ID[toolId];
    // Find a "host" wall — the most-recently-placed Arch wall — so
    // windows and doors automatically cut their opening into it.
    const allBodies = (typeof window !== 'undefined' && Array.isArray(window.__forgeBodies))
      ? window.__forgeBodies : [];
    let hostBody = null;
    if (tool && (tool.ifcType === 'IFCWINDOW' || tool.ifcType === 'IFCDOOR')) {
      for (let i = allBodies.length - 1; i >= 0; i--) {
        const b = allBodies[i];
        if (b && b.toolId === 'arch.wall' && typeof b.handle === 'number') {
          hostBody = b;
          break;
        }
      }
    }
    const r = dispatchArchTool(toolId, params, {
      hostBodyHandle: hostBody ? hostBody.handle : null,
    });
    const entry = {
      ts: Date.now(),
      id: toolId,
      label: tool ? tool.label : toolId,
      ok: r.ok,
      handle: r.handle ?? null,
      ifcType: r.ifcType || null,
      message: r.error,
    };
    setLog((l) => [...l, entry]);

    if (!r.ok) {
      showToast({ kind: 'err',
                  text: r.error || `${toolId} failed`,
                  ttl: 2500 });
      onResult?.(entry, r);
      return;
    }

    // Append the freshly-placed body to the shell registry. We use
    // __forgeAppendBody — the shell's stable setter that wraps setBodies.
    const bodyId = `arch-${toolId.replace('arch.', '')}-${Date.now().toString(36)}`;
    const body = {
      id: bodyId,
      kind: 'native',
      handle: r.handle,
      toolId,
      name: `${tool.label} ${allBodies.length + 1}`,
      params,
      ifcType: r.ifcType,
      ifcStorey: 'Storey 1',
      ifcBuilding: 'Building 1',
      ifcSite: 'Default Site',
    };

    if (typeof window !== 'undefined') {
      // If the window/door cut returned a modified host handle, replace
      // the host body's handle (its frame stays, but its solid now has
      // the opening). We do this through __forgeSetBodies so the shell
      // re-tessellates correctly.
      if (r.cutHostHandle != null && hostBody) {
        const next = allBodies.map((b) => b.id === hostBody.id
          ? { ...b, handle: r.cutHostHandle }
          : b);
        next.push(body);
        window.__forgeSetBodies?.(next);
      } else {
        window.__forgeAppendBody?.(body);
      }
      // Persist to localStorage so re-export-after-reload works.
      // We pull the merged list from window now that the setter ran.
      // (setBodies is async — we approximate by appending in memory.)
      const nextSnapshot = r.cutHostHandle != null && hostBody
        ? allBodies.map((b) => b.id === hostBody.id
            ? { ...b, handle: r.cutHostHandle } : b).concat([body])
        : allBodies.concat([body]);
      saveArchBodies(nextSnapshot);
    }

    showToast({ kind: 'ok',
                text: `${tool.label} placed · ${r.ifcType} · handle ${r.handle}`,
                ttl: 1800 });
    onResult?.(entry, r);
    setActiveTool(null);
  }, [onResult]);

  if (!open) return null;

  // Group tools by their declared group.
  const groupedTools = useMemo(() => {
    const map = {};
    for (const g of ARCH_GROUPS) map[g.id] = [];
    for (const t of ARCH_TOOLS) {
      const gid = t.group || 'Structural';
      (map[gid] = map[gid] || []).push(t);
    }
    return map;
  }, []);

  return (
    <aside role="region"
           aria-label="Arch / BIM"
           data-testid="forge-arch-panel"
           style={panelStyle}>
      <header style={headerStyle}>
        <Icon name="wb.mech" size={14} />
        <span style={{ flex: 1 }}>Arch / BIM</span>
        <span style={{ fontFamily: 'var(--forge-mono)', fontSize: 10,
                       color: kernelReady ? 'var(--forge-ok)' : 'var(--forge-ink-mute)' }}>
          {kernelReady ? 'kernel ready' : 'kernel idle'}
        </span>
        <button type="button" onClick={onClose} aria-label="Close panel"
                data-testid="forge-arch-close"
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink-mute)', cursor: 'pointer',
                         display: 'inline-flex', padding: 2 }}>
          <Icon name="select.clear" size={12} />
        </button>
      </header>

      <div style={{ fontSize: 11, color: 'var(--forge-ink-mute)' }}>
        FreeCAD-style Arch workbench. Wall · Window · Door · Slab · Column
        · Beam · Stair · Railing · Roof · Ramp. Each tool produces a real
        native OCCT body tagged with an IFC4 entity class — picked up
        automatically by the IFC exporter. Window/door dialogs cut the
        opening into the most recent wall.
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex',
                    flexDirection: 'column', gap: 'var(--forge-space-2)',
                    paddingRight: 4 }}>
        {ARCH_GROUPS.map((group) => {
          const tools = groupedTools[group.id] || [];
          if (!tools.length) return null;
          return (
            <section key={group.id} style={groupStyle}
                     data-testid={`forge-arch-group-${group.id.toLowerCase()}`}>
              <div style={groupHeaderStyle}>{group.label}</div>
              {tools.map((t) => (
                <button key={t.id} type="button"
                        data-testid={`forge-arch-op-${t.id.replace('arch.', '')}`}
                        data-arch-op={t.id}
                        data-ifc-type={t.ifcType}
                        onClick={() => setActiveTool(t)}
                        style={opBtnStyle}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--forge-accent-mute)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--forge-surface, var(--forge-canvas-3))'; }}>
                  <Icon name={t.icon || 'wb.mech'} size={14} />
                  <span style={{ flex: 1 }}>{t.label}</span>
                  <span style={{ fontFamily: 'var(--forge-mono)', fontSize: 10,
                                 color: 'var(--forge-ink-mute)' }}>
                    {t.ifcType.replace('IFC', '')}
                  </span>
                </button>
              ))}
            </section>
          );
        })}
      </div>

      {log.length > 0 && (
        <div style={logStyle} data-testid="forge-arch-log">
          {log.slice(-8).reverse().map((entry, i) => (
            <div key={`${entry.ts}-${i}`}
                 style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <span style={{ color: entry.ok ? 'var(--forge-ok)' : 'var(--forge-err)' }}>
                {entry.ok ? 'OK' : 'ER'}
              </span>
              <span style={{ flex: 1 }}>{entry.id}</span>
              <span style={{ color: 'var(--forge-ink-mute)' }}>
                {entry.handle != null ? `h=${entry.handle}` : (entry.message || '')}
              </span>
            </div>
          ))}
        </div>
      )}

      {activeTool && (
        <OpDialog tool={activeTool}
                  onCancel={() => setActiveTool(null)}
                  onConfirm={handleConfirm} />
      )}
    </aside>
  );
}

/* =====================================================================
 * Host — mounted by App.jsx as a sibling of ForgeShellV4.
 *
 * Subscribes to:
 *   • window.__forgeOpenArchWorkbench() — imperative open hook
 *   • 'forge:open-arch-panel'          — custom event
 *   • 'forge:wb-changed'               — auto-open when activeWb = 'arch'
 *
 * Hydrates Arch-tagged bodies from localStorage on mount. We only hydrate
 * the IFC metadata (ifcType / ifcStorey) — the kernel handle gets
 * re-derived by replaying the recipe through dispatchArchTool, so the
 * exporter can still pick up these bodies after a reload.
 *
 * React #185 avoidance: hydration runs ONCE on mount (deps = []) and
 * uses functional setters via window.__forgeSetBodies. No body listener
 * in the mount effect dispatches body-added.
 * ===================================================================== */

const ARCH_PANEL_EVENT = 'forge:open-arch-panel';

export function ArchWorkbenchHost() {
  const [open, setOpen] = useState(false);
  // Hydration only — DO NOT include in dep arrays that fire often.
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeOpenArchWorkbench  = () => setOpen(true);
    window.__forgeCloseArchWorkbench = () => setOpen(false);

    const onEvt  = () => setOpen(true);
    window.addEventListener(ARCH_PANEL_EVENT, onEvt);

    const sync = () => {
      const wb = window.__forgeActiveWb;
      if (wb === 'arch') setOpen(true);
    };
    sync();
    window.addEventListener('forge:wb-changed', sync);

    // Hydrate Arch bodies from localStorage exactly once. We re-run the
    // recipe through the kernel to get real OCCT handles back; if the
    // kernel isn't ready, we still append the metadata so the IFC
    // exporter can pick them up via its synthetic mesh fallback.
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      try {
        const persisted = loadArchBodies();
        if (persisted.length) {
          // Defer hydration until the shell's body setter is published
          // (shell mounts before this host in App.jsx, but the effect
          // ordering can vary across React strict-mode passes).
          const tryHydrate = () => {
            if (typeof window.__forgeSetBodies !== 'function') return false;
            const existing = Array.isArray(window.__forgeBodies)
              ? window.__forgeBodies : [];
            // Don't clobber if shell already has bodies (e.g. the user
            // opened a .forge snapshot before this host mounted).
            if (existing.length > 0) return true;
            const next = [];
            for (const p of persisted) {
              // Re-derive a real native handle when possible.
              const r = dispatchArchTool(p.toolId, p.params, {});
              next.push({
                id: p.id,
                kind: 'native',
                handle: r.ok ? r.handle : null,
                toolId: p.toolId,
                name: p.name || p.id,
                params: p.params,
                ifcType: p.ifcType,
                ifcStorey: p.ifcStorey || 'Storey 1',
                ifcBuilding: p.ifcBuilding || 'Building 1',
                ifcSite: p.ifcSite || 'Default Site',
              });
            }
            window.__forgeSetBodies(next);
            return true;
          };
          if (!tryHydrate()) {
            // Retry once after a microtask — gives the shell effect
            // time to publish its setters.
            Promise.resolve().then(tryHydrate);
          }
        }
      } catch (err) {
        // Hydration is non-fatal; the user can still place new bodies.
        console.warn('[forge.arch] hydration failed:', err.message);
      }
    }

    return () => {
      window.removeEventListener(ARCH_PANEL_EVENT, onEvt);
      window.removeEventListener('forge:wb-changed', sync);
    };
  }, []); // Stable deps — runs once on mount.

  // Re-save whenever the body list changes after the panel is open.
  // We listen for the body-added event instead of subscribing to a
  // reactive snapshot (avoiding the React #185 trap of changing
  // useSyncExternalStore identity).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const persist = () => {
      const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
      saveArchBodies(bodies);
    };
    window.addEventListener('forge:body-added', persist);
    return () => window.removeEventListener('forge:body-added', persist);
  }, []);

  return <ArchWorkbench open={open} onClose={() => setOpen(false)} />;
}

export default ArchWorkbench;
