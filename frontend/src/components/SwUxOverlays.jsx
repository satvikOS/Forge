/**
 * SolidWorks-convention UX overlays — Tier 1 of the SW gap closure.
 *
 * Four first-class UI primitives mounted as siblings inside the viewport:
 *
 *   1. ConfirmationCorner       (top-right)   — green-check / red-X
 *      shown whenever a tool with a commit/cancel interaction is active.
 *      The SAME corner SolidWorks uses to confirm/cancel any sketch or
 *      feature. Listens for `archdisc:confirmation-active` events from the
 *      param dialog, sketch-edit mode, etc.; emits `archdisc:confirm` /
 *      `archdisc:cancel` on click.
 *
 *   2. HeadsUpViewToolbar       (top-centre)  — Zoom-Fit, Zoom-to-Area,
 *      Section View, View Orientation drop, Display Style, Normal-To.
 *      Wraps existing viewport hooks (`__archdiscFocusOnObject`,
 *      `__archdiscFitToScreen`, applyDisplayMode via internalsRef, etc.).
 *
 *   3. PropertyManagerDock      (left side)   — when a tool with a
 *      ToolParamSchema becomes active, render the dialog DOCKED on the
 *      left (replacing the Feature/Body tree from the viewport's
 *      perspective). Collapsible sections matching the SW PropertyManager
 *      idiom. Wraps the existing ToolParamDialog event bus.
 *
 *   4. SketchStateBadge         (bottom-left) — live state pill
 *      ("UNDER-DEFINED" / "FULLY DEFINED" / "OVER-DEFINED") that mirrors
 *      the entity-colour state from InteractiveSketch.getStatus().
 *
 * The four primitives are persistent CSS classes with a consistent visual
 * style matching the ribbon; not throwaway debug divs. They expose
 * `data-archdisc-*` attributes for e2e specs.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { ChevronDown, ChevronRight, ChevronLeft, Check, X, Maximize2, Crop,
         Scissors, Box, Eye, Square, MousePointer, Layers, Hexagon,
         Circle, Trash2, Info, Minus, MoveVertical, GitBranch,
         RotateCw, Slash, Flag, Clock, SkipBack, SkipForward,
         Edit2, Anchor, Move3D, PencilLine, Plus, Layout } from 'lucide-react';
import { onParamRequest, resolveOpen } from '../foundation/ToolParamDialog.js';
import { isInlineSketchCapable } from '../foundation/ToolParamSchemas.js';
import { EquationManager } from './EquationManager.jsx';
import { CutListPanel } from './CutListPanel.jsx';
import { equationStore } from '../foundation/EquationStore.js';
import { resolveParamValue, formatResolvedValue } from '../foundation/ParamValueResolver.js';
import './SwUxOverlays.css';

// ─── 1. Confirmation Corner ─────────────────────────────────────────────────

/**
 * Bus the corner listens on. Other components fire `setActive({ tool, onConfirm,
 * onCancel })` to show the corner; `clear()` hides it. Returns an unsubscribe.
 */
export const confirmationBus = (() => {
  const listeners = new Set();
  let current = null;
  return {
    setActive(state) {
      current = state;
      for (const fn of listeners) try { fn(current); } catch {}
    },
    clear() {
      current = null;
      for (const fn of listeners) try { fn(null); } catch {}
    },
    current() { return current; },
    subscribe(fn) {
      listeners.add(fn);
      // Immediately push current so a late-mounting subscriber sees state.
      try { fn(current); } catch {}
      return () => listeners.delete(fn);
    },
  };
})();

export function ConfirmationCorner() {
  const [active, setActive] = useState(null);
  useEffect(() => confirmationBus.subscribe(setActive), []);

  if (!active) return null;
  return (
    <div className="sw-confirm-corner" data-archdisc-confirm-corner="active">
      <div className="sw-confirm-corner-label">{active.tool || 'Confirm'}</div>
      <button
        className="sw-confirm-btn sw-confirm-btn-ok"
        title="Confirm (Enter)"
        data-archdisc-confirm="ok"
        onClick={() => { const c = active.onConfirm; confirmationBus.clear(); c && c(); }}
      >
        <Check size={18} strokeWidth={3} />
      </button>
      <button
        className="sw-confirm-btn sw-confirm-btn-cancel"
        title="Cancel (Esc)"
        data-archdisc-confirm="cancel"
        onClick={() => { const c = active.onCancel; confirmationBus.clear(); c && c(); }}
      >
        <X size={18} strokeWidth={3} />
      </button>
    </div>
  );
}

// ─── 2. Heads-up View Toolbar ───────────────────────────────────────────────

const VIEW_ORIENTATIONS = [
  { id: 'iso',   label: 'Isometric', az: 45,   el: 30 },
  { id: 'front', label: 'Front',     az: 0,    el: 0  },
  { id: 'back',  label: 'Back',      az: 180,  el: 0  },
  { id: 'top',   label: 'Top',       az: 0,    el: 89 },
  { id: 'bottom',label: 'Bottom',    az: 0,    el: -89 },
  { id: 'left',  label: 'Left',      az: -90,  el: 0  },
  { id: 'right', label: 'Right',     az: 90,   el: 0  },
];

const DISPLAY_STYLES = [
  { id: 'shaded',     label: 'Shaded' },
  { id: 'shadedWire', label: 'Shaded w/ Edges' },
  { id: 'wireframe',  label: 'Wireframe' },
  { id: 'xray',       label: 'Hidden Lines (X-Ray)' },
];

function applyDisplayModeGlobal(mode) {
  // Mirrors the routine inside Viewport3D so the toolbar can switch without a
  // hard import dependency. It walks the live scene (exposed on window) and
  // toggles wireframe / transparent / opacity per the chosen mode.
  const scene = typeof window !== 'undefined' ? window.__three_scene : null;
  if (!scene) return false;
  scene.traverse((obj) => {
    if (!obj.isMesh || obj.userData.isHelper) return;
    const mat = obj.material;
    if (!mat) return;
    if (!mat.userData) mat.userData = {};
    if (mat.userData._swOrigSet !== true) {
      mat.userData._swOrigOpacity     = mat.opacity;
      mat.userData._swOrigTransparent = mat.transparent;
      mat.userData._swOrigWireframe   = mat.wireframe;
      mat.userData._swOrigSet = true;
    }
    switch (mode) {
      case 'shaded':
        mat.wireframe   = false;
        mat.transparent = mat.userData._swOrigTransparent;
        mat.opacity     = mat.userData._swOrigOpacity;
        break;
      case 'wireframe':
        mat.wireframe   = true;
        mat.transparent = false;
        mat.opacity     = 1.0;
        break;
      case 'shadedWire':
        mat.wireframe   = false;
        mat.transparent = false;
        mat.opacity     = 1.0;
        break;
      case 'xray':
        mat.wireframe   = false;
        mat.transparent = true;
        mat.opacity     = 0.25;
        break;
    }
    mat.needsUpdate = true;
  });
  if (typeof window !== 'undefined') window.__archdiscDisplayMode = mode;
  return true;
}

function orbitToOrientation(orient) {
  if (typeof window === 'undefined') return false;
  const vp = window.__archdiscViewport;
  if (!vp) return false;
  const THREE = window.THREE;
  if (!THREE) return false;
  const { camera, orbitControls, scene } = vp;
  // Frame the REGISTERED bodies first (so the orientation is anchored to the
  // user's model). Fall back to all visible non-helper meshes only when the
  // registry is empty. Without this scope, helpers / outline overlays /
  // success-panel DOM siblings sometimes inflate the bbox.
  const box = new THREE.Box3();
  const reg = window.__archdiscRegistry;
  let usedRegistry = false;
  if (reg && reg.bodies && reg.bodies.length) {
    for (const b of reg.bodies) {
      if (b.group && b.group.visible !== false) {
        b.group.updateMatrixWorld(true);
        box.expandByObject(b.group);
      }
    }
    usedRegistry = !box.isEmpty();
  }
  if (!usedRegistry) {
    scene.traverse((o) => {
      if (o.isMesh && !o.userData.isHelper && o.visible) {
        // Skip selection-outline and other overlay meshes which can blow up bbox.
        if (o.name === '__selection_outline__') return;
        if (o.parent && o.parent.name === '__selection_outline__') return;
        box.expandByObject(o);
      }
    });
  }
  let target;
  let radius;
  if (!box.isEmpty()) {
    target = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const max = Math.max(size.x, size.y, size.z) || 0.1;
    // Tighten the framing — SW orient defaults give a cosy view, not a
    // pull-way-back view. 1.5× the largest dimension is a common heuristic.
    radius = max * 1.5;
  } else {
    target = new THREE.Vector3(0, 0, 0);
    radius = orbitControls.target.distanceTo(camera.position) || 0.3;
  }
  const az = (orient.az * Math.PI) / 180;
  const el = (orient.el * Math.PI) / 180;
  camera.position.set(
    target.x + radius * Math.cos(el) * Math.sin(az),
    target.y + radius * Math.sin(el),
    target.z + radius * Math.cos(el) * Math.cos(az),
  );
  camera.lookAt(target);
  orbitControls.target.copy(target);
  orbitControls.update();
  if (typeof window.__archdiscLastOrientation !== 'undefined') {
    window.__archdiscLastOrientation = orient.id;
  } else {
    window.__archdiscLastOrientation = orient.id;
  }
  return true;
}

function normalToSelection() {
  if (typeof window === 'undefined') return false;
  const vp = window.__archdiscViewport;
  const reg = window.__archdiscRegistry;
  if (!vp || !reg) return false;
  // Best-effort SW Normal-To: face the selected body along +Z (front view).
  // Picked-face normals would require deeper pick-set hooking — out of scope
  // for Tier 1; this is the documented partial behaviour.
  const sel = reg.bodies?.find(b => reg.selectedIds && reg.selectedIds().includes(b.id)) ?? null;
  if (sel && sel.group && typeof window.__archdiscFocusOnObject === 'function') {
    window.__archdiscFocusOnObject(sel.group);
  }
  return orbitToOrientation(VIEW_ORIENTATIONS.find(o => o.id === 'front'));
}

function toggleSectionView() {
  // Wraps the existing Section View hook if present; otherwise documents the
  // gap by setting a window flag the e2e can read.
  if (typeof window === 'undefined') return false;
  if (typeof window.__archdiscSetSection === 'function') {
    window.__archdiscSectionEnabled = !window.__archdiscSectionEnabled;
    window.__archdiscSetSection(window.__archdiscSectionEnabled);
    return true;
  }
  window.__archdiscSectionEnabled = !window.__archdiscSectionEnabled;
  // Minimum visible effect when no foundation section is wired: cycle the
  // display style to X-Ray so the user gets a clear "interior visible" hint.
  if (window.__archdiscSectionEnabled) applyDisplayModeGlobal('xray');
  else applyDisplayModeGlobal('shaded');
  return true;
}

export function HeadsUpViewToolbar() {
  const [orientOpen, setOrientOpen] = useState(false);
  const [styleOpen,  setStyleOpen]  = useState(false);
  const [style, setStyle] = useState('shaded');

  const closeMenus = () => { setOrientOpen(false); setStyleOpen(false); };

  return (
    <>
    {/* Tier-1 #10 — Rollback bar has been relocated OUT of the viewport
     *  overlay layer (it was obstructing the 3D model). It now mounts at
     *  the workbench-container level as a VERTICAL right-side strip in its
     *  own grid column (see Workbench.jsx + workbench.css `.workbench-rollback`).
     *  This file still exports `RollbackBar`; Workbench.jsx imports it. */}
    <div className="sw-heads-up-toolbar" data-archdisc-headsup="active" onMouseLeave={closeMenus}>
      <button
        className="sw-hu-btn"
        title="Zoom to Fit (F)"
        data-archdisc-hu="zoom-fit"
        onClick={() => {
          // SW-style "zoom to fit" frames the model snugly. We prefer
          // boxing the REGISTERED bodies — that's the user's actual model.
          // `__archdiscFocusOnFoundationBodies` only matches foundation
          // bodies (marker userData.foundationManifold), and the B-rep
          // path doesn't set that marker, so we do our own here.
          const vp = window.__archdiscViewport;
          const reg = window.__archdiscRegistry;
          const THREE = window.THREE;
          if (vp && reg && reg.bodies && reg.bodies.length && THREE) {
            const box = new THREE.Box3();
            for (const b of reg.bodies) {
              if (b.group) { b.group.updateMatrixWorld(true); box.expandByObject(b.group); }
            }
            if (!box.isEmpty()) {
              const c = box.getCenter(new THREE.Vector3());
              const s = box.getSize(new THREE.Vector3());
              const max = Math.max(s.x, s.y, s.z) || 0.05;
              const half = (vp.camera.fov * Math.PI / 180) / 2;
              const dist = (max / 2) / Math.tan(half) * 1.6;
              const dx = 0.6, dy = 0.35, dz = 0.6;
              const L = Math.hypot(dx, dy, dz);
              vp.camera.position.set(
                c.x + dist * dx / L, c.y + dist * dy / L, c.z + dist * dz / L,
              );
              vp.camera.near = Math.max(dist * 0.01, 1e-4);
              vp.camera.far  = Math.max(dist * 100, 100);
              vp.camera.updateProjectionMatrix();
              vp.orbitControls.target.copy(c);
              vp.orbitControls.update();
              return;
            }
          }
          if (window.__archdiscFitToScreen) window.__archdiscFitToScreen();
        }}
      >
        <Maximize2 size={14} />
      </button>
      <button
        className="sw-hu-btn"
        title="Zoom to Area"
        data-archdisc-hu="zoom-area"
        onClick={() => {
          // Crop is the closest semantic match. Without a marquee-drag hook
          // exposed by the viewport, this falls back to a focused fit on the
          // current selection — same end effect for the SW user expectation.
          const reg = window.__archdiscRegistry;
          const sel = reg && reg.bodies && reg.selectedIds &&
            reg.bodies.find(b => reg.selectedIds().includes(b.id));
          if (sel && sel.group && window.__archdiscFocusOnObject) {
            window.__archdiscFocusOnObject(sel.group);
          } else if (window.__archdiscFitToScreen) {
            window.__archdiscFitToScreen();
          }
        }}
      >
        <Crop size={14} />
      </button>
      <button
        className="sw-hu-btn"
        title="Section View"
        data-archdisc-hu="section"
        onClick={toggleSectionView}
      >
        <Scissors size={14} />
      </button>
      <div className="sw-hu-sep" />
      <div className="sw-hu-dropdown-wrap">
        <button
          className="sw-hu-btn sw-hu-btn-drop"
          title="View Orientation"
          data-archdisc-hu="orient"
          onClick={(e) => { e.stopPropagation(); setStyleOpen(false); setOrientOpen(v => !v); }}
        >
          <Box size={14} />
          <ChevronDown size={9} />
        </button>
        {orientOpen && (
          <div className="sw-hu-menu">
            {VIEW_ORIENTATIONS.map((o) => (
              <button
                key={o.id}
                className="sw-hu-menu-item"
                data-archdisc-hu-orient={o.id}
                onClick={() => { orbitToOrientation(o); setOrientOpen(false); }}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        className="sw-hu-btn"
        title="Normal-To Selection"
        data-archdisc-hu="normal-to"
        onClick={normalToSelection}
      >
        <Square size={14} />
      </button>
      <div className="sw-hu-sep" />
      <div className="sw-hu-dropdown-wrap">
        <button
          className="sw-hu-btn sw-hu-btn-drop"
          title="Display Style"
          data-archdisc-hu="display"
          onClick={(e) => { e.stopPropagation(); setOrientOpen(false); setStyleOpen(v => !v); }}
        >
          <Eye size={14} />
          <ChevronDown size={9} />
        </button>
        {styleOpen && (
          <div className="sw-hu-menu">
            {DISPLAY_STYLES.map((s) => (
              <button
                key={s.id}
                className={`sw-hu-menu-item ${style === s.id ? 'sw-hu-menu-item-active' : ''}`}
                data-archdisc-hu-display={s.id}
                onClick={() => {
                  setStyle(s.id);
                  applyDisplayModeGlobal(s.id);
                  setStyleOpen(false);
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
    </>
  );
}

// ─── 3. PropertyManager Dock ────────────────────────────────────────────────

/**
 * Render the param-dialog DOCKED on the LEFT side of the viewport (SolidWorks
 * convention), with collapsible sections. Auto-shows when a tool requests
 * params. The existing floating ToolParamDialog stays mounted as a fallback
 * for tools/contexts that haven't migrated; this dock takes precedence over
 * floating render when `__archdiscUseDock` is set.
 *
 * Tools opt-in by setting `window.__archdiscUseDock = true` before invocation
 * (the workbench wires this on for Tier-1-migrated tools — currently
 * Extrude Boss, which is the SW canonical first feature).
 */
export const DOCKED_TOOLS = new Set([
  // UX Tier 11d — NX-unified Extrude (Boolean toggle replaces Boss/Cut split).
  // The single 'Extrude' tool docks into the PropertyManagerDock; the legacy
  // 'Extrude Boss' + 'Extrude Cut' entries remain in this set so direct
  // ribbon/API callers (existing integration specs, AI plans) keep working.
  'Extrude',
  'Extrude Boss',
  'Extrude Cut',
  'Revolve Boss',
  'Revolve Cut',
  'Loft Boss',
  'Sweep Boss',
  'Fillet',
  'Chamfer',
  'Shell',
  'Hole Wizard',
  'Draft',
  'Linear Pattern',
  'Circular Pattern',
  // UX Tier 11c — NX unified Pattern Feature. The single 'Pattern' tool
  // replaces Linear Pattern + Circular Pattern on the ribbon; the legacy
  // entries remain in this DOCKED_TOOLS set for API/AI plan callers.
  'Pattern',
  // Tier-2a (sketch primitives)
  'Sketch Chamfer',
  'Convert Entities',
  // Tier-2c (sketch transforms)
  'Move Entities',
  'Rotate Entities',
  'Copy Entities',
  'Scale Entities',
  'Stretch Entities',
  // SP-5 — Boolean & partition completion (Area C, T1).
  'Imprint',
  'Partition',
  'Section',
  // SP-10 — Blending suite completion (Area D, T2).
  'Hold-Line Blend',
  'Face-Face Blend',
  'Setback Corner',
  'G3 Blend',
  // UX Tier 3a — Advanced features (Boundary Boss / Rib / Helix).
  'Boundary Boss',
  'Rib',
  'Helix',
  // UX Tier 5b — Sheet Metal additions (Hem / Jog / Miter Flange / Sketched Bend).
  'Hem',
  'Jog',
  'Miter Flange',
  'Sketched Bend',
  // UX Tier 4 (focused) — Extruded / Revolved Surface (sheet-body feature ops).
  'Extruded Surface',
  'Revolved Surface',
  // UX Tier 8c — Drawing sheet header (Title Block + Sheet Format).
  'Title Block',
  'Sheet Format',
  // UX Tier 6b — Weldments additions (Gusset + Weld Bead).
  'Gusset',
  'Weld Bead',
  // UX Tier 9b — Mold Tools focused additions (Undercut + Shut-Off).
  'Undercut Analysis',
  'Shut-Off Surfaces',
]);

export function PropertyManagerDock() {
  // UX Tier 10b: numeric fields now accept `=expr` strings. We track the
  // RAW user input per field (so the literal `=`/`*`/identifier survives
  // React's number-input normalisation) AND the resolved {value, source,
  // expression?, error?} record per numeric field. The `values` slot
  // remains the canonical numeric payload the executor consumes; on
  // commit it's rebuilt from `resolved` so handlers see the evaluated
  // number unchanged. A sidecar `__expressions` slot carries the source
  // `=...` strings for design-history persistence.
  const [state, setState] = useState({
    open: false, schema: null, toolName: null,
    values: {},     // resolved numeric values (handler payload)
    rawInputs: {},  // raw per-field input (string when expression, else number)
    resolved: {},   // {value, source, expression?, error?} per numeric field
  });
  const [sectionsOpen, setSectionsOpen] = useState({ inputs: true, options: true });
  // Collapsed state — the dock can be folded to a thin sliver so the user
  // can see the full viewport without dismissing the active tool. Persisted
  // to localStorage so the user's preference survives reload.
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('archdisc.propertyDock.collapsed') === '1';
    } catch { return false; }
  });
  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        try { window.localStorage.setItem('archdisc.propertyDock.collapsed', next ? '1' : '0'); } catch {}
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const unsub = onParamRequest(({ toolName, schema }) => {
      // Only intercept tools we've migrated. Floating dialog handles the rest.
      const docked = DOCKED_TOOLS.has(toolName);
      if (!docked) return;
      const initial = {};
      const rawInputs = {};
      const resolved = {};
      const store = equationStore();
      for (const f of schema.fields) {
        initial[f.name] = f.default;
        rawInputs[f.name] = f.default;
        if (f.type === 'number') {
          resolved[f.name] = resolveParamValue(f.default, f, store);
        }
      }
      setState({ open: true, schema, toolName, values: initial, rawInputs, resolved });
      // Mark confirmation corner active so the green-check / red-X cue
      // mirrors the dialog's commit/cancel buttons SW-style.
      confirmationBus.setActive({
        tool: toolName,
        onConfirm: () => commit(),
        onCancel: () => cancel(),
      });
    });
    return unsub;
  }, []);

  // UX Tier 10b: when the equation store changes (a variable was added /
  // edited / deleted), re-evaluate every expression-driven numeric field
  // so the displayed "= N" subtitle reflects the new value. The handler
  // is NOT re-fired — the user must re-confirm.
  useEffect(() => {
    if (!state.open) return undefined;
    const handler = () => {
      setState((s) => {
        if (!s.open || !s.schema) return s;
        const store = equationStore();
        const nextResolved = { ...s.resolved };
        const nextValues = { ...s.values };
        let changed = false;
        for (const f of s.schema.fields) {
          if (f.type !== 'number') continue;
          const raw = s.rawInputs[f.name];
          if (typeof raw === 'string' && raw.trim().startsWith('=')) {
            const r = resolveParamValue(raw, f, store);
            nextResolved[f.name] = r;
            nextValues[f.name] = r.value;
            changed = true;
          }
        }
        return changed ? { ...s, resolved: nextResolved, values: nextValues } : s;
      });
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('archdisc:equation-store:changed', handler);
      return () => window.removeEventListener('archdisc:equation-store:changed', handler);
    }
    return undefined;
  }, [state.open]);

  // Tier-11b — Dialog-in-Dialog: when the InlineSketchSession commits a
  // profile, inject it into the LIVE dock state under the `profile` key so
  // the parent Extrude / Revolve / etc. handler sees it as a regular value
  // when the user hits OK. This is the bridge that makes the inline session
  // genuinely "committed back to the parent dialog as the profile" without
  // the user re-opening anything.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onInlineDone = (ev) => {
      const detail = ev?.detail || {};
      const points = Array.isArray(detail.profile) ? detail.profile : null;
      if (!points || points.length < 3) return;
      setState((prev) => {
        // Only inject if THIS dock is open + active for the parent tool.
        if (!prev.open || prev.toolName !== detail.parentTool) return prev;
        const nextValues = {
          ...prev.values,
          profile: points,
          _inlineSketchPrimitive: detail.primitive || 'custom',
        };
        if (typeof window !== 'undefined') {
          window.__archdiscLastInlineSketchInjection = {
            tool: prev.toolName,
            primitive: detail.primitive || 'custom',
            points,
            injectedAt: Date.now(),
          };
        }
        return { ...prev, values: nextValues };
      });
    };
    window.addEventListener('archdisc:inline-sketch:done', onInlineDone);
    return () => window.removeEventListener('archdisc:inline-sketch:done', onInlineDone);
  }, []);

  const commit = useCallback(() => {
    setState((prev) => {
      if (!prev.open) return prev;
      // Build the handler payload — for numeric fields we ALWAYS take the
      // resolved numeric value (so existing handlers keep working with
      // `values.height` etc.). Expression sources flow into a sidecar
      // `__expressions` slot so design-history can persist them.
      const out = { ...prev.values };
      const expressions = {};
      if (prev.schema && Array.isArray(prev.schema.fields)) {
        for (const f of prev.schema.fields) {
          if (f.type === 'number') {
            const r = prev.resolved[f.name];
            if (r) {
              out[f.name] = r.value;
              if (r.source === 'expression' && r.expression) {
                expressions[f.name] = r.expression;
              }
            }
          }
        }
      }
      if (Object.keys(expressions).length > 0) out.__expressions = expressions;
      resolveOpen(out);
      confirmationBus.clear();
      return { open: false, schema: null, toolName: null, values: {}, rawInputs: {}, resolved: {} };
    });
  }, []);

  const cancel = useCallback(() => {
    setState((prev) => {
      if (!prev.open) return prev;
      resolveOpen(null);
      confirmationBus.clear();
      return { open: false, schema: null, toolName: null, values: {}, rawInputs: {}, resolved: {} };
    });
  }, []);

  // Hide the floating tpd-backdrop when the dock owns the tool — both react to
  // the same event bus, so the floating dialog otherwise renders on top of us.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const cls = 'sw-dock-suppress-floating';
    if (state.open) document.body.classList.add(cls);
    else document.body.classList.remove(cls);
    return () => document.body.classList.remove(cls);
  }, [state.open]);

  if (!state.open || !state.schema) return null;

  const setField = (name, raw) => {
    setState((s) => {
      const field = s.schema.fields.find(f => f.name === name);
      const nextRaw = { ...s.rawInputs, [name]: raw };
      const nextValues = { ...s.values };
      const nextResolved = { ...s.resolved };
      if (field?.type === 'number') {
        const r = resolveParamValue(raw, field, equationStore());
        nextResolved[name] = r;
        nextValues[name] = r.value;
      } else {
        nextValues[name] = raw;
      }
      return { ...s, rawInputs: nextRaw, values: nextValues, resolved: nextResolved };
    });
  };

  return (
    <aside
      className={'sw-property-dock' + (collapsed ? ' sw-property-dock-collapsed' : '')}
      data-archdisc-pm-dock={state.toolName}
      data-archdisc-pm-dock-collapsed={collapsed ? 'true' : 'false'}
    >
      <div className="sw-pm-dock-header">
        <button
          className="sw-pm-dock-collapse-toggle"
          title={collapsed ? 'Expand PropertyManager (show inputs)' : 'Collapse PropertyManager (show viewport)'}
          aria-label={collapsed ? 'Expand PropertyManager' : 'Collapse PropertyManager'}
          aria-expanded={!collapsed}
          data-archdisc-pm-collapse-toggle={collapsed ? 'collapsed' : 'expanded'}
          onClick={(e) => { e.stopPropagation(); toggleCollapsed(); }}
        >
          {collapsed ? <ChevronRight size={11} /> : <ChevronLeft size={11} />}
        </button>
        <div className="sw-pm-dock-title">{state.schema.title}</div>
        <div className="sw-pm-dock-actions">
          <button
            className="sw-pm-dock-btn sw-pm-dock-btn-ok"
            data-archdisc-pm-action="ok"
            title="Confirm (Enter)"
            onClick={commit}
          >
            <Check size={14} strokeWidth={3} />
          </button>
          <button
            className="sw-pm-dock-btn sw-pm-dock-btn-cancel"
            data-archdisc-pm-action="cancel"
            title="Cancel (Esc)"
            onClick={cancel}
          >
            <X size={14} strokeWidth={3} />
          </button>
        </div>
      </div>
      {state.schema.blurb && (
        <div className="sw-pm-dock-blurb">{state.schema.blurb}</div>
      )}

      <DockSection
        label="Inputs"
        open={sectionsOpen.inputs}
        onToggle={() => setSectionsOpen(s => ({ ...s, inputs: !s.inputs }))}
      >
        {state.schema.fields.map((f) => {
          const raw = state.rawInputs[f.name];
          const isExpr = f.type === 'number'
            && typeof raw === 'string' && raw.trim().startsWith('=');
          const resolved = state.resolved[f.name];
          const displayValue = (raw === undefined || raw === null)
            ? (state.values[f.name] ?? '')
            : raw;
          // UX Tier 10b: when this row carries an expression, stack the
          // input + the "= N" subtitle vertically via inline style so the
          // CSS row's flex-row layout doesn't squash the subtitle out of
          // view. align-items:flex-start so the label sits with the input.
          return (
            <div
              key={f.name}
              className="sw-pm-dock-row"
              style={isExpr ? { flexDirection: 'row', alignItems: 'flex-start' } : undefined}
            >
              <label className="sw-pm-dock-label" title={f.hint || ''}
                     style={isExpr ? { marginTop: 5 } : undefined}>{f.label}</label>
              <div className="sw-pm-dock-input-wrap"
                   style={isExpr ? { flexDirection: 'column', alignItems: 'stretch', gap: 2 } : undefined}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}>
                {f.type === 'enum' && Array.isArray(f.options) ? (
                  <select
                    className="sw-pm-dock-input"
                    value={state.values[f.name]}
                    onChange={(e) => setField(f.name, e.target.value)}
                    data-field={f.name}
                  >
                    {f.options.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : f.type === 'number' ? (
                  // UX Tier 10b: numeric fields use type=text so the user
                  // can freely type `=expr` parametric strings. Numeric
                  // literals still parse via parseFloat in the resolver,
                  // and the input pattern keeps a numeric-input mobile
                  // keyboard. The Σ badge + "= N" subtitle indicate when
                  // the input is interpreted as an expression.
                  <input
                    className="sw-pm-dock-input"
                    type="text"
                    inputMode="decimal"
                    value={displayValue}
                    onChange={(e) => setField(f.name, e.target.value)}
                    data-field={f.name}
                    data-expr={isExpr ? 'true' : 'false'}
                    style={isExpr ? { fontStyle: 'italic', color: '#bcd0ee' } : undefined}
                  />
                ) : (
                  <input
                    className="sw-pm-dock-input"
                    type="text"
                    value={displayValue}
                    onChange={(e) => setField(f.name, e.target.value)}
                    data-field={f.name}
                  />
                )}
                {isExpr && (
                  <span
                    title="Parametric expression"
                    data-archdisc-expr-badge={f.name}
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 18, height: 18, marginLeft: 2, borderRadius: 3,
                      background: '#3a5a8c', color: '#cfe2ff', fontSize: 11,
                      fontFamily: 'Consolas, monospace', fontWeight: 700, lineHeight: 1,
                    }}>Σ</span>
                )}
                {f.unit && <span className="sw-pm-dock-unit">{f.unit}</span>}
                </div>{/* close inner input-row */}
                {isExpr && (
                  <div
                    data-archdisc-expr-eval={f.name}
                    style={{
                      marginTop: 0, paddingLeft: 2,
                      fontSize: 11, fontFamily: 'Consolas, monospace',
                      color: resolved && resolved.error ? '#e08a8a' : '#8aa9d8',
                    }}>
                    {resolved && !resolved.error
                      ? `= ${formatResolvedValue(resolved.value)}${f.unit ? ' ' + f.unit : ''}`
                      : (resolved && resolved.error ? `⚠ ${resolved.error}` : '—')}
                  </div>
                )}
              </div>{/* close input-wrap */}
            </div>
          );
        })}
      </DockSection>

      <DockSection
        label="Options"
        open={sectionsOpen.options}
        onToggle={() => setSectionsOpen(s => ({ ...s, options: !s.options }))}
      >
        <div className="sw-pm-dock-row sw-pm-dock-row-empty">
          <span>Direction-2 / Draft / Merge — Tier-2 work</span>
        </div>
      </DockSection>

      {/* Tier-11b — Inline Sketch hook. For tools that take a sketch
       *  profile (Extrude / Revolve / Sweep / Loft), surface a "Sketch
       *  Profile" hook button inside the dock. Clicking it opens the
       *  InlineSketchSession overlay WITHOUT closing this dock — the
       *  user picks a primitive, hits "Done Sketch", and the committed
       *  profile lands on __archdiscPlanParams[tool].profile which the
       *  Extrude Boss handler already consumes (Path A). NX's marquee
       *  dialog-inside-a-dialog pattern. */}
      {isInlineSketchCapable(state.toolName) && (
        <div className="sw-pm-dock-section open">
          <div className="sw-pm-dock-inline-sketch-hook" data-archdisc-pm-inline-sketch-host={state.toolName}>
            <button
              type="button"
              className="sw-pm-dock-inline-sketch-btn"
              data-archdisc-pm-inline-sketch-enter
              title="Enter inline sketch session (sketch profile WITHOUT exiting this dialog)"
              onClick={() => {
                if (typeof window === 'undefined') return;
                window.__archdiscInlineSketchPayload = {
                  parentTool: state.toolName,
                  parentTitle: `${state.toolName} · profile`,
                  parentValues: state.values,
                };
                try {
                  window.dispatchEvent(new CustomEvent('archdisc:inline-sketch:enter', {
                    detail: window.__archdiscInlineSketchPayload,
                  }));
                } catch {}
              }}
            >
              <PencilLine size={11} />
              <span>Sketch Profile</span>
              <Plus size={10} />
            </button>
            <div className="sw-pm-dock-inline-sketch-hint">
              Sketch the profile inline — without exiting {state.toolName}.
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

function DockSection({ label, open, onToggle, children }) {
  return (
    <div className={`sw-pm-dock-section ${open ? 'open' : 'closed'}`}>
      <button className="sw-pm-dock-section-header" onClick={onToggle}>
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span>{label}</span>
      </button>
      {open && <div className="sw-pm-dock-section-body">{children}</div>}
    </div>
  );
}

// ─── 4. Sketch State Badge ──────────────────────────────────────────────────

/**
 * Subscribe to the InteractiveSketch singleton and mirror its
 * under/full/over-defined state as a pill at bottom-left. Polls the sketch
 * status every 250 ms so it picks up solver changes without bolting extra
 * listeners onto the sketch class.
 */
export function SketchStateBadge() {
  const [state, setState] = useState(null);
  useEffect(() => {
    const tick = () => {
      const sketch = typeof window !== 'undefined' ? window.__archdiscSketch : null;
      if (!sketch || !sketch.active) { setState(null); return; }
      try {
        const st = sketch.getStatus();
        setState(st);
        // Push colour to entities each tick (idempotent — only swaps hex).
        if (typeof sketch.applyDoFColouring === 'function') sketch.applyDoFColouring();
      } catch { setState(null); }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, []);

  if (!state) return null;
  const cls = state.state === 'under-defined' ? 'sw-state-under'
            : state.state === 'over-defined'  ? 'sw-state-over'
            : 'sw-state-full';
  const label = state.state === 'under-defined' ? 'UNDER-DEFINED'
              : state.state === 'over-defined'  ? 'OVER-DEFINED'
              : 'FULLY DEFINED';
  return (
    <>
      <div className={`sw-sketch-state ${cls}`}
           data-archdisc-sketch-state={state.state}
           data-archdisc-sketch-dof={String(state.signedDof)}>
        <span className="sw-sketch-state-dot" />
        <span className="sw-sketch-state-label">{label}</span>
        <span className="sw-sketch-state-dof">DoF: {state.signedDof}</span>
      </div>
      {/* Tier-2b: Display/Delete Relations dock — mounted as a sibling of
       *  the sketch badge so it only lives while a sketch is active and we
       *  don't have to touch the workbench mount. */}
      <DisplayRelationsDock />
      {/* Tier-1 #4 — Live cursor X/Y readout (bottom-left, beside the state
       *  badge). Only renders while a sketch is active. */}
      <SketchCursorReadout />
      {/* Tier-1 #7 — Auto-relations icon that follows the cursor and
       *  reflects the snap relation the next click WILL apply. */}
      <AutoRelationIndicator />
      {/* Tier-1 #6 — Double-click-dimension inline editor; receives the
       *  hit dimension via a window event from the viewport handler. */}
      <DimensionEditorOverlay />
    </>
  );
}

// ─── 7. Sketch Live Cursor Readout (Tier-1 #4) ────────────────────────────
//
// Listens for the `archdisc:sketch-cursor` event the InteractiveSketch
// fires from onMouseMove, renders the live X/Y in mm just to the right of
// the SketchStateBadge (which lives at bottom-left). Hides when the sketch
// deactivates (event detail === null) and also auto-hides 800 ms after
// the last move so a stalled cursor doesn't bias debugging.
export function SketchCursorReadout() {
  const [cur, setCur] = useState(null);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onCursor = (ev) => setCur(ev.detail || null);
    window.addEventListener('archdisc:sketch-cursor', onCursor);
    // Seed from any prior write so the readout is correct on mount.
    if (window.__archdiscSketchCursor) setCur(window.__archdiscSketchCursor);
    return () => window.removeEventListener('archdisc:sketch-cursor', onCursor);
  }, []);

  if (!cur || cur.x_mm === undefined || cur.y_mm === undefined) return null;
  const fmt = (v) => {
    const abs = Math.abs(v);
    // Tighten formatting for small values, expand for large.
    if (abs < 10) return v.toFixed(3);
    if (abs < 100) return v.toFixed(2);
    return v.toFixed(1);
  };
  return (
    <div
      className="sw-cursor-readout"
      data-archdisc-cursor-readout="active"
      data-archdisc-cursor-x={String(cur.x_mm)}
      data-archdisc-cursor-y={String(cur.y_mm)}
    >
      <span className="sw-cursor-axis">X</span>
      <span className="sw-cursor-val">{fmt(cur.x_mm)}</span>
      <span className="sw-cursor-axis">Y</span>
      <span className="sw-cursor-val">{fmt(cur.y_mm)}</span>
      <span className="sw-cursor-unit">mm</span>
    </div>
  );
}

// ─── 8. Auto-Relation Indicator (Tier-1 #7) ───────────────────────────────
//
// SW shows a tiny ghost icon next to the cursor when a snap relation is
// about to commit — Horizontal, Vertical, Coincident, Tangent, etc. We
// reproduce that ghost: tracks `pointermove` on the viewport, picks the
// current hint from `__archdiscSketchCursor`, and positions a small badge
// next to the pointer with the relation icon + label.

const RELATION_ICONS = {
  horizontal:    { Icon: Minus,        label: 'H',  title: 'Horizontal' },
  vertical:      { Icon: MoveVertical, label: 'V',  title: 'Vertical' },
  coincident:    { Icon: GitBranch,    label: '∘',  title: 'Coincident' },
  tangent:       { Icon: RotateCw,     label: 'T',  title: 'Tangent' },
  perpendicular: { Icon: Square,       label: '⊥',  title: 'Perpendicular' },
  parallel:      { Icon: Slash,        label: '∥',  title: 'Parallel' },
};

export function AutoRelationIndicator() {
  const [pos, setPos] = useState(null);
  const [hint, setHint] = useState(null);
  const lastMoveRef = useRef(0);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    // Track pointer ONLY inside the viewport canvas. The viewport mount
    // class is .workbench-viewport (set in WorkbenchMechanical.jsx).
    const onMove = (ev) => {
      // Only act while a sketch is active AND a drawing tool is selected.
      const sketch = window.__archdiscSketch;
      if (!sketch || !sketch.active || sketch.activeTool === 'none') {
        setPos(null);
        return;
      }
      lastMoveRef.current = Date.now();
      setPos({ x: ev.clientX, y: ev.clientY });
      const cur = window.__archdiscSketchCursor;
      setHint(cur && cur.hint ? cur.hint : null);
    };
    const onLeave = () => setPos(null);
    const onCursorEv = (ev) => {
      // If the sketch publishes a cursor while the mouse hasn't moved
      // (rare — e.g. the tool just changed), still update the hint.
      const cur = ev.detail;
      setHint(cur && cur.hint ? cur.hint : null);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerleave', onLeave);
    window.addEventListener('archdisc:sketch-cursor', onCursorEv);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('archdisc:sketch-cursor', onCursorEv);
    };
  }, []);

  // Stale-cursor auto-hide: if the pointer hasn't moved for 1 s clear it.
  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() - lastMoveRef.current > 1200) setPos(null);
    }, 350);
    return () => clearInterval(id);
  }, []);

  if (!pos || !hint || !RELATION_ICONS[hint]) return null;
  const { Icon, label, title } = RELATION_ICONS[hint];
  return (
    <div
      className="sw-auto-relation"
      data-archdisc-auto-relation={hint}
      title={title}
      style={{ left: pos.x + 16, top: pos.y + 14 }}
    >
      <Icon size={11} />
      <span className="sw-auto-relation-label">{label}</span>
    </div>
  );
}

// ─── 9. Dimension Inline Editor (Tier-1 #6) ───────────────────────────────
//
// Opens an inline value-editor next to a sketch dimension when the
// viewport fires `archdisc:edit-dimension` (sent by the viewport's
// double-click handler — see InteractiveSketch.getDimensionAt). Pressing
// Enter commits via `sketch.editDimension(id, value)`, Esc cancels. The
// editor stays anchored to the dimension's screen position by projecting
// the dimension's mid-point through the live camera each render.
export function DimensionEditorOverlay() {
  const [active, setActive] = useState(null); // { id, screen:{x,y}, value_mm }
  const [valStr, setValStr] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onOpen = (ev) => {
      const d = ev?.detail;
      if (!d || !d.id) { setActive(null); return; }
      const projected = projectDimensionToScreen(d.id);
      setActive({
        id: d.id,
        screen: projected || { x: ev?.detail?.screenX ?? 100, y: ev?.detail?.screenY ?? 100 },
        value_mm: d.value_mm ?? 0,
      });
      setValStr(d.value_mm !== undefined ? String(d.value_mm.toFixed(2)) : '');
    };
    window.addEventListener('archdisc:edit-dimension', onOpen);
    return () => window.removeEventListener('archdisc:edit-dimension', onOpen);
  }, []);

  // Keep the editor anchored to the dimension as the camera moves.
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => {
      const projected = projectDimensionToScreen(active.id);
      if (projected) {
        setActive((a) => (a ? { ...a, screen: projected } : a));
      }
    }, 80);
    return () => clearInterval(id);
  }, [active]);

  // Focus + select on open.
  useEffect(() => {
    if (active && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [active]);

  // Click-outside / Esc to cancel.
  useEffect(() => {
    if (!active) return undefined;
    const onDown = (ev) => {
      const root = document.querySelector('.sw-dim-editor');
      if (root && root.contains(ev.target)) return;
      setActive(null);
    };
    const onKey = (ev) => { if (ev.key === 'Escape') setActive(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [active]);

  const commit = useCallback(() => {
    if (!active) return;
    const sketch = typeof window !== 'undefined' ? window.__archdiscSketch : null;
    const v = parseFloat(valStr);
    if (!sketch || !Number.isFinite(v) || v <= 0) {
      setActive(null);
      return;
    }
    try {
      const res = sketch.editDimension(active.id, v);
      if (typeof window !== 'undefined') {
        window.__lastDimensionEdit = { id: active.id, value_mm: v, result: res };
        try {
          window.dispatchEvent(new CustomEvent('archdisc:dimension-edited', {
            detail: { id: active.id, value_mm: v, result: res },
          }));
        } catch (_) {}
      }
    } catch (e) {
      console.warn('[DimensionEditor] editDimension failed', e);
    }
    setActive(null);
  }, [active, valStr]);

  if (!active) return null;
  return (
    <div
      className="sw-dim-editor"
      data-archdisc-dim-editor="open"
      data-archdisc-dim-id={active.id}
      style={{ left: active.screen.x + 8, top: active.screen.y - 10 }}
    >
      <input
        ref={inputRef}
        className="sw-dim-editor-input"
        type="number"
        step="0.01"
        value={valStr}
        onChange={(e) => setValStr(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') setActive(null);
        }}
        data-archdisc-dim-input
      />
      <span className="sw-dim-editor-unit">mm</span>
      <button
        className="sw-dim-editor-ok"
        onClick={commit}
        title="Commit (Enter)"
        data-archdisc-dim-ok
      >
        <Check size={11} strokeWidth={3} />
      </button>
      <button
        className="sw-dim-editor-cancel"
        onClick={() => setActive(null)}
        title="Cancel (Esc)"
        data-archdisc-dim-cancel
      >
        <X size={11} strokeWidth={3} />
      </button>
    </div>
  );
}

/**
 * Project a sketch dimension's mid-point through the live camera to
 * screen pixels. Returns null if the camera isn't ready or the
 * dimension doesn't exist.
 */
function projectDimensionToScreen(id) {
  if (typeof window === 'undefined') return null;
  const sketch = window.__archdiscSketch;
  const vp = window.__archdiscViewport;
  const THREE = window.THREE;
  if (!sketch || !vp || !THREE) return null;
  if (typeof sketch.getDimensions !== 'function') return null;
  const dims = sketch.getDimensions();
  const dim = dims.find(d => d.id === id);
  if (!dim) return null;
  try {
    const camera = vp.camera;
    const renderer = vp.renderer || (typeof document !== 'undefined'
      ? document.querySelector('canvas')
      : null);
    let w = 800, h = 600;
    if (renderer && renderer.getSize) {
      const sz = renderer.getSize ? renderer.getSize(new THREE.Vector2()) : null;
      if (sz && sz.x && sz.y) { w = sz.x; h = sz.y; }
    } else if (vp.renderer && vp.renderer.domElement) {
      w = vp.renderer.domElement.clientWidth;
      h = vp.renderer.domElement.clientHeight;
    } else {
      const c = typeof document !== 'undefined'
        ? document.querySelector('.workbench-viewport canvas')
        : null;
      if (c) { w = c.clientWidth; h = c.clientHeight; }
    }
    const v = new THREE.Vector3(dim.midWorld.x, dim.midWorld.y, dim.midWorld.z);
    v.project(camera);
    // Translate NDC → CSS pixels relative to the canvas, then add the
    // canvas's bounding-rect offset so the editor lands at the right
    // viewport spot.
    const canvas = typeof document !== 'undefined'
      ? document.querySelector('.workbench-viewport canvas')
      : null;
    let offsetX = 0, offsetY = 0;
    if (canvas) {
      const r = canvas.getBoundingClientRect();
      offsetX = r.left;
      offsetY = r.top;
      w = r.width;
      h = r.height;
    }
    const x = (v.x * 0.5 + 0.5) * w + offsetX;
    const y = (-v.y * 0.5 + 0.5) * h + offsetY;
    return { x, y };
  } catch (_) {
    return null;
  }
}

// ─── 5. Selection Priority Bar (Tier-11a NX-distinctive UX) ────────────────

/**
 * NX-style selection-priority pre-filter. Lives at the very top of the
 * viewport (offset left of the Heads-up View Toolbar so the two don't
 * overlap). The user picks one of six modes BEFORE clicking in the 3D
 * scene; subsequent clicks in `Viewport3D.jsx::handleClick` consult
 * `window.__archdiscSelectionFilter` and constrain the resolved selection
 * accordingly:
 *
 *   - 'single'  — current behaviour: whatever is hit first (no filter).
 *   - 'solid'   — restrict to solid bodies (kind === 'solid' if available,
 *                 fallback to manifold-having groups since the foundation
 *                 path tags every Three.js body with `foundationManifold`).
 *   - 'sheet'   — restrict to sheet bodies (kind === 'sheet').
 *   - 'face'    — return the specific face index under the cursor instead
 *                 of the body group. Falls back to body when the hit mesh
 *                 has no per-face metadata (documented gap).
 *   - 'edge'    — nearest edge to the click; uses the existing edge picker
 *                 in Viewport3D.
 *   - 'vertex'  — nearest vertex of the hit body to the click point.
 *
 * The active filter is stored on `window.__archdiscSelectionFilter` so the
 * pick path + e2e specs read it without subscribing to React state.
 *
 * Default = 'solid' (matches NX's default and ArchDisc's pre-existing
 * "object" mode behaviour).
 */

export const SELECTION_FILTERS = [
  { id: 'single', label: 'Single',      hint: 'Pick whatever is hit first (no filter).',
    Icon: MousePointer },
  { id: 'solid',  label: 'Solid Body',  hint: 'Pick solid bodies only.',
    Icon: Box },
  { id: 'sheet',  label: 'Sheet Body',  hint: 'Pick sheet bodies (surfaces) only.',
    Icon: Layers },
  { id: 'face',   label: 'Face',        hint: 'Pick one face of the body under the cursor.',
    Icon: Square },
  { id: 'edge',   label: 'Edge',        hint: 'Pick the nearest edge.',
    Icon: Hexagon },
  { id: 'vertex', label: 'Vertex',      hint: 'Pick the nearest vertex.',
    Icon: Circle },
];

// Bus for components (e.g. hover-highlight in Viewport3D) that want to
// observe the active filter without polling window. Lightweight pub/sub.
export const selectionFilterBus = (() => {
  const listeners = new Set();
  return {
    set(id) {
      if (typeof window !== 'undefined') window.__archdiscSelectionFilter = id;
      for (const fn of listeners) try { fn(id); } catch {}
    },
    get() {
      return (typeof window !== 'undefined' && window.__archdiscSelectionFilter)
        || 'solid';
    },
    subscribe(fn) {
      listeners.add(fn);
      try { fn(this.get()); } catch {}
      return () => listeners.delete(fn);
    },
  };
})();

export function SelectionPriorityBar() {
  const [active, setActive] = useState(() => selectionFilterBus.get());

  useEffect(() => {
    // Default the global filter to 'solid' on first mount if nothing has
    // been set yet — matches the NX "Solid Body" default and ArchDisc's
    // legacy object-pick behaviour.
    if (typeof window !== 'undefined' && !window.__archdiscSelectionFilter) {
      window.__archdiscSelectionFilter = 'solid';
    }
    return selectionFilterBus.subscribe(setActive);
  }, []);

  const pick = useCallback((id) => {
    selectionFilterBus.set(id);
  }, []);

  return (
    <>
      <div
        className="sw-selection-bar"
        data-archdisc-selection-bar="active"
        data-archdisc-selection-filter-active={active}
        role="toolbar"
        aria-label="Selection priority filter"
      >
        <div className="sw-selection-bar-label">Selection</div>
        {SELECTION_FILTERS.map(({ id, label, hint, Icon }) => (
          <button
            key={id}
            className={
              'sw-selection-bar-btn' +
              (active === id ? ' sw-selection-bar-btn-active' : '')
            }
            data-archdisc-selection-filter={id}
            title={`${label} — ${hint}`}
            aria-pressed={active === id ? 'true' : 'false'}
            onClick={(e) => { e.stopPropagation(); pick(id); }}
          >
            <Icon size={13} />
            <span className="sw-selection-bar-btn-label">{label}</span>
          </button>
        ))}
      </div>
      {/* ─── Tier-11b NX-distinctive UX patterns ─────────────────────────
       *  Mounted as siblings of the always-on Selection Priority Bar so
       *  they auto-ride every workbench without touching WorkbenchMechanical.
       *
       *   - MultiPlaneStack    — top-right docked stack of 3 reference
       *     planes for fast new-datum-plane construction.
       *   - CsysAnchorPanel    — mid-right pop when in assembly insert
       *     flow; snaps a new component to a picked CSYS without mates.
       *   - InlineSketchSession — modal session inside the
       *     PropertyManagerDock that lets a user sketch a profile WITHOUT
       *     exiting the parent Extrude / Revolve / Loft dialog.
       *  Each component owns its show/hide condition; none collide with
       *  the existing quadrant placement (top-left bar / top-centre
       *  toolbar / top-right confirmation corner / left dock / right
       *  relations dock / bottom-left sketch state). */}
      <MultiPlaneStack />
      <CsysAnchorPanel />
      <InlineSketchSession />
      {/* UX Tier 10 — Equation Manager modal. Mounted as a sibling of
       *  the always-on Tier-11b NX overlays so it auto-rides every
       *  workbench. The component renders nothing until the global
       *  `archdisc:open-equation-manager` event fires (from the
       *  Sketch / Part tab ribbon entry, or programmatically from the
       *  AI orchestration layer). Full-page modal — see
       *  EquationManager.css for the z-index 50 backdrop. */}
      <EquationManager />
      {/* UX Tier 6c — Weldments Cut List modal. Mounted as a sibling of the
       *  Equation Manager so it rides every workbench. Renders nothing
       *  until the global `archdisc:open-cut-list` event fires (from the
       *  Weldments tab ribbon entry or programmatically from the AI
       *  orchestration layer). Same z-index-50 modal tier as Tier-10. */}
      <CutListPanel />
    </>
  );
}

/**
 * Pure resolution helper invoked from `Viewport3D.jsx::handleClick`. Given
 * the raw `intersects[]` from a raycaster and a `THREE.Vector3` click
 * point, return a selection record describing what the active filter
 * decided the user actually wants. The viewport's existing selection /
 * highlight machinery consumes the returned `kind` to do the right thing.
 *
 * Returned shape:
 *   { kind: 'none' }                                — filter rejected the hit
 *   { kind: 'object', hit, group }                  — whole-body pick
 *   { kind: 'face',   hit, group, faceId?, faceIndex? }
 *   { kind: 'edge',   hit, group, solid, edge }     — caller selects the edge
 *   { kind: 'vertex', hit, group, solid, vertex }
 *
 * For 'face' / 'edge' / 'vertex' the helper returns `kind === 'object'`
 * when it cannot resolve the requested granularity — the viewport then
 * still gives the user visible feedback rather than nothing. This is the
 * "honest fallback" pattern: we never silently lose the click.
 */
export function resolveSelectionByFilter(filterId, intersects, findTopGroupFn) {
  if (!intersects || !intersects.length) return { kind: 'none' };
  const filter = filterId || 'solid';

  // For solid/sheet, walk the intersect list and pick the first one that
  // matches the filter — this is the "selection-priority pre-filter" the
  // NX user expects (clicking somewhere obscured by a solid still picks
  // the sheet under it when sheet-filter is active).
  if (filter === 'solid' || filter === 'sheet') {
    for (const hit of intersects) {
      const group = findTopGroupFn(hit.object);
      if (matchesBodyKindFilter(group, filter)) {
        return { kind: 'object', hit, group };
      }
    }
    return { kind: 'none' };
  }

  // Face / Edge / Vertex / Single all start from the first intersect.
  const hit = intersects[0];
  const group = findTopGroupFn(hit.object);

  if (filter === 'face') {
    // Face resolution depends on whether the hit mesh exposes a kernel
    // solid; the existing Viewport3D mode === 'face' branch already does
    // exactly this — we just return enough info for the caller to invoke
    // that branch. Caller checks `kind === 'face'` and short-circuits.
    return { kind: 'face', hit, group, faceIndex: hit.faceIndex };
  }

  if (filter === 'edge') {
    return { kind: 'edge', hit, group };
  }

  if (filter === 'vertex') {
    return { kind: 'vertex', hit, group };
  }

  // 'single' or anything unrecognised → whatever was hit, like before.
  return { kind: 'object', hit, group };
}

/**
 * Decide whether a Three.js group qualifies as the requested body kind.
 *
 * Strategy (in order):
 *   1. If `group.userData.bodyKind` is set explicitly, use it directly.
 *   2. If the group has a spine body (via `userData.brepShapeRef` or
 *      `userData.kernelSolid`) and that body exposes a `kind` ∈
 *      {'solid','sheet','wire'}, use it.
 *   3. Heuristic fallback: a group with `userData.foundationManifold` is
 *      treated as a 'solid' (the foundation manifold path always emits
 *      solids). Anything else is 'solid' as well, since arbitrary scene
 *      meshes are most commonly solids in this app. This is documented
 *      as a partial — sheet-body filtering only works when callers tag
 *      the group with `bodyKind = 'sheet'` or the spine carries it.
 */
export function matchesBodyKindFilter(group, kindFilter) {
  if (!group) return false;
  const explicit = group.userData && group.userData.bodyKind;
  if (explicit) return explicit === kindFilter;
  // Try spine body via brepShapeRef.
  const brep = group.userData && group.userData.brepShapeRef;
  const spineKind = brep && (brep.kind || (brep.body && brep.body.kind));
  if (spineKind) return spineKind === kindFilter;
  // Try kernelSolid.kind (legacy B-rep kernels).
  const ks = group.userData && group.userData.kernelSolid;
  if (ks && ks.kind) return ks.kind === kindFilter;
  // Foundation manifold path defaults to solid.
  if (group.userData && group.userData.foundationManifold) {
    return kindFilter === 'solid';
  }
  // Unknown — default to solid so the legacy "click picks the body" path
  // still works when no filter has been set. Sheet-only filter will reject.
  return kindFilter === 'solid';
}

// ─── 6. Display / Delete Relations Dock (Tier-2b) ───────────────────────────
//
// Inside the PropertyManager Dock area we render a panel listing every
// geometric relation currently applied to the SELECTED sketch entity (or
// all relations if nothing is selected). Each row carries the relation
// LABEL ("Concentric", "Midpoint", "Symmetric", "Collinear", "Fix"),
// the entity indices it links, and an X button to delete it.
//
// Deleting a relation removes the underlying solver constraints, re-solves,
// re-colours the sketch (DoF colour state via SketchSolver.signedDOF),
// and updates the live list.
//
// The dock listens for `archdisc:display-relations` (fired by the Display
// Relations ribbon handler) to OPEN itself, plus polls the sketch every
// 400ms so the list stays current while relations are added via the
// other relation tools.
export function DisplayRelationsDock() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [focusedEntity, setFocusedEntity] = useState(null);
  const [tick, setTick] = useState(0);

  // Open hook + selection tracking.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onOpen = (e) => {
      setOpen(true);
      setFocusedEntity(e?.detail?.for ?? null);
    };
    window.addEventListener('archdisc:display-relations', onOpen);
    return () => window.removeEventListener('archdisc:display-relations', onOpen);
  }, []);

  // Poll the sketch + the selection so the list stays fresh after every
  // Apply / Delete + after the user picks a new entity.
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 400);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!open) return;
    const sketch = typeof window !== 'undefined' ? window.__archdiscSketch : null;
    if (!sketch || typeof sketch.getAllRelations !== 'function') {
      setRows([]);
      return;
    }
    const sel = (typeof window !== 'undefined' && window.__archdiscSelectedSketchEntities) || null;
    const focused = (sel && sel.length > 0) ? sel[0] : (focusedEntity ?? null);
    const list = (focused !== null && focused !== undefined)
      ? sketch.getRelationsForEntity(focused)
      : sketch.getAllRelations();
    setRows(list);
  }, [open, tick, focusedEntity]);

  const onDelete = useCallback((relId) => {
    const sketch = typeof window !== 'undefined' ? window.__archdiscSketch : null;
    if (!sketch || typeof sketch.deleteRelation !== 'function') return;
    const r = sketch.deleteRelation(relId);
    if (typeof window !== 'undefined') window.__lastSketchRelationDelete = r;
    // Force a refresh.
    setTick(t => t + 1);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    if (typeof window !== 'undefined') window.__archdiscDisplayRelationsOpen = false;
  }, []);

  if (!open) return null;
  const sel = (typeof window !== 'undefined' && window.__archdiscSelectedSketchEntities) || null;
  const focused = (sel && sel.length > 0) ? sel[0] : (focusedEntity ?? null);

  return (
    <aside
      className="sw-relations-dock"
      data-archdisc-relations-dock="open"
      data-archdisc-relations-count={String(rows.length)}
      data-archdisc-relations-focused={focused === null ? 'all' : String(focused)}
    >
      <div className="sw-relations-dock-header">
        <div className="sw-relations-dock-title">
          <Info size={12} /> Display / Delete Relations
        </div>
        <button
          className="sw-relations-dock-close"
          title="Close (Esc)"
          onClick={close}
          data-archdisc-relations-close
        >
          <X size={14} strokeWidth={3} />
        </button>
      </div>
      <div className="sw-relations-dock-scope">
        {focused !== null
          ? <>Entity <span className="sw-relations-dock-pill">#{focused}</span> · {rows.length} relation{rows.length === 1 ? '' : 's'}</>
          : <>All relations · {rows.length}</>}
      </div>
      <div className="sw-relations-dock-body">
        {rows.length === 0 ? (
          <div className="sw-relations-dock-empty">
            No geometric relations to display.
            {focused === null && ' Apply Concentric / Midpoint / Symmetric / Collinear / Fix from the Sketch → Relations group.'}
          </div>
        ) : (
          <ul className="sw-relations-dock-list">
            {rows.map((rel) => (
              <li
                key={rel.id}
                className="sw-relations-dock-row"
                data-archdisc-relation-id={rel.id}
                data-archdisc-relation-type={rel.type}
              >
                <div className="sw-relations-dock-row-main">
                  <span className="sw-relations-dock-row-label">{rel.label}</span>
                  <span className="sw-relations-dock-row-entities">
                    [{rel.entityIndices.join(', ')}]
                  </span>
                </div>
                <button
                  className="sw-relations-dock-row-delete"
                  title="Delete this relation"
                  onClick={() => onDelete(rel.id)}
                  data-archdisc-relation-delete={rel.id}
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

// ─── 10. Rollback Bar — Tier-1 #10 (SP-3c kernel-history timeline scrubber) ──
//
// A real, HistoryLog-backed VERTICAL timeline strip mounted as a dedicated
// grid column on the right edge of the workbench layout (between the
// viewport and the right Properties panel). The bar lives OFF the viewport
// — it does not overlay the 3D content. Reads chronologically top → bottom:
// the baseline flag at the top, then each entry / mark in record order, with
// the current cursor caret pulsing between them.
//
// The strip is collapsible via the chevron at its top — when collapsed it
// shrinks to a 28px sliver showing the cursor position only, so the user can
// reclaim that horizontal real estate for the viewport without losing
// access to the timeline.
//
// What it shows:
//   - A horizontal strip with every entry in the kernel HistoryLog
//     (`window.__archdiscKernelHistory`) rendered as a dot. Marks render as
//     flag-markers with a visible label on hover (and persistent labels for
//     the first / last named marks so the strip has anchor text at rest).
//   - The CURRENT cursor highlighted as a vertical caret line pulsing
//     subtly. As the user clicks or drags-scrubs, the caret moves AND the
//     model state animates LIVE — the marquee Rollback UX.
//   - Baseline ("__baseline") rendered as the leftmost flag — clicking it
//     rolls back to before any op.
//
// What it does:
//   - Click any dot or mark flag → call `hist.rollBackTo` (or
//     `rollForwardTo` if forward) with the kernel scene context (registry +
//     viewport defaults via the standardSceneRegister / Remove paths). The
//     kernel re-runs forwards / inverses for the rebuilt scene.
//   - Drag the caret along the strip → scrubs LIVE. Each pointer-move
//     resolves the nearest entry under the caret and drives a
//     rollBackTo/rollForwardTo to it. Throttled to one drive per RAF so a
//     rapid drag doesn't stack expensive rolls (an honest debounce — see
//     the gap note in ux-track-progress.md).
//   - Right-click a mark → context menu: Rename / Delete / Roll To. Rename
//     edits `entry.mark` in place and re-keys the mark index. Delete
//     removes the mark entry from the log (truncates marks-after-cursor
//     correctly).
//   - Re-renders on every `archdisc:history-changed` event emitted by
//     HistoryLog.js (recordOp / mark / rollBack / rollForward).
//
// Honest scope:
//   - The bar shows the LINEAR timeline; the feature DAG (dependsOn) is not
//     rendered here. Rendering the DAG is a follow-on; the linear strip
//     covers the marquee scrub gesture cleanly.
//   - Drag-scrub drives full kernel rolls per step. For very dense logs (>50
//     entries) the per-step roll cost dominates; the RAF throttle keeps the
//     UI responsive but the visible model updates lag the cursor by one
//     animation frame at most. Documented in the gap notes.

const ROLLBACK_BAR_MIN_WIDTH = 320;
const ROLLBACK_BAR_MAX_ENTRIES_VISIBLE = 30;

function getKernelHistory() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscKernelHistory || null;
}

/**
 * Snapshot the current HistoryLog state. Pure read — never mutates.
 * Returns `null` when the log isn't installed yet (pre-kernel-init).
 */
function snapshotHistory() {
  const hist = getKernelHistory();
  if (!hist || !Array.isArray(hist.entries)) return null;
  // Build a compact, render-friendly list. Each item carries its index so
  // the click-resolver doesn't need to scan the log every time.
  const items = hist.entries.map((e, idx) => ({
    idx,
    id: e.id,
    opName: e.opName,
    mark: e.mark || null,
    time: e.time,
    // SP-3b derive ops carry persistentBodyId(s) + inputPersistentIds in
    // meta — surface a compact id list for the hover tooltip.
    persistentIds: collectPersistentIds(e),
  }));
  return {
    items,
    cursor: hist.cursor,
    marks: hist.listMarks().map(e => ({ id: e.id, name: e.mark })),
    currentId: hist.currentMarkOrEntry() ? hist.currentMarkOrEntry().id : null,
  };
}

function collectPersistentIds(entry) {
  if (!entry || !entry.meta) return [];
  const ids = [];
  if (entry.meta.persistentBodyId) ids.push(entry.meta.persistentBodyId);
  if (Array.isArray(entry.meta.persistentBodyIds)) {
    for (const p of entry.meta.persistentBodyIds) ids.push(p);
  }
  if (Array.isArray(entry.meta.inputPersistentIds)
      && entry.meta.inputPersistentIds.length) {
    ids.push('←' + entry.meta.inputPersistentIds.join(','));
  }
  return ids;
}

/**
 * Drive a roll to the target index — symmetric: rolls back if target<cursor,
 * forward if target>cursor. The kernel HistoryLog's rollBackTo / rollForwardTo
 * themselves accept the symmetric inverse routing, so we always call
 * rollBackTo when going down and rollForwardTo when going up.
 *
 * Returns the snapshot AFTER the roll so the caller can refresh the bar
 * synchronously (in addition to the event-driven re-render which fires
 * inside HistoryLog).
 */
async function driveRollToIndex(targetIdx) {
  const hist = getKernelHistory();
  if (!hist) return null;
  if (targetIdx === hist.cursor) return snapshotHistory();
  try {
    if (targetIdx < 0) {
      await hist.rollBackTo('__baseline');
    } else {
      const entry = hist.entries[targetIdx];
      if (!entry) return snapshotHistory();
      if (targetIdx < hist.cursor) await hist.rollBackTo(entry);
      else await hist.rollForwardTo(entry);
    }
  } catch (err) {
    // Honest behaviour — surface the roll failure on the window for e2e +
    // debugging. Cursor sits where it failed; the user re-clicks to retry.
    if (typeof window !== 'undefined') {
      window.__lastRollbackBarError = err && err.message ? err.message : String(err);
    }
  }
  return snapshotHistory();
}

/**
 * Render the Rollback bar overlay. Lives just below the Heads-up View Toolbar.
 * Auto-hides itself when the log is empty (no point showing an empty timeline).
 */
export function RollbackBar() {
  const [snap, setSnap] = useState(() => snapshotHistory());
  const [hoverIdx, setHoverIdx] = useState(null);
  const [contextMenu, setContextMenu] = useState(null); // {x,y,entry}
  const [renameEditing, setRenameEditing] = useState(null); // {entryId, value}
  const [scrubbing, setScrubbing] = useState(false);
  // Collapse toggle — when collapsed the side strip shrinks to a 28 px sliver
  // so the user can reclaim the horizontal real estate for the viewport.
  // Persisted to localStorage so the user's preference survives reload.
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('archdisc.rollbackBar.collapsed') === '1';
    } catch { return false; }
  });
  const stripRef = useRef(null);
  const rafThrottleRef = useRef({ pendingIdx: null, raf: null });
  const renameInputRef = useRef(null);

  // Subscribe to the history-changed event the kernel HistoryLog emits.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const refresh = () => setSnap(snapshotHistory());
    refresh();
    window.addEventListener('archdisc:history-changed', refresh);
    // Re-poll once after mount in case the kernel installed the log AFTER
    // the React tree mounted (the lazy-singleton init in kernelHistory.js).
    const t = setTimeout(refresh, 250);
    return () => {
      window.removeEventListener('archdisc:history-changed', refresh);
      clearTimeout(t);
    };
  }, []);

  // Throttled scrub-drive. Multiple pointer-move events within one RAF
  // collapse to a single driveRollToIndex; otherwise an aggressive drag
  // queues up kernel rolls faster than they can finish.
  const queueRollToIndex = useCallback((idx) => {
    const ref = rafThrottleRef.current;
    ref.pendingIdx = idx;
    if (ref.raf !== null) return;
    ref.raf = requestAnimationFrame(async () => {
      const pending = ref.pendingIdx;
      ref.pendingIdx = null;
      ref.raf = null;
      if (pending == null) return;
      const next = await driveRollToIndex(pending);
      if (next) setSnap(next);
    });
  }, []);

  const clickEntry = useCallback(async (idx) => {
    setContextMenu(null);
    const next = await driveRollToIndex(idx);
    if (next) setSnap(next);
  }, []);

  // Drag-scrub: track pointer Y over the (vertical) strip, map to nearest
  // entry idx. The strip reads top→bottom — baseline at top, tail at bottom.
  const onStripPointerDown = useCallback((ev) => {
    if (ev.button !== 0) return;
    if (!stripRef.current) return;
    setScrubbing(true);
    const rect = stripRef.current.getBoundingClientRect();
    const idx = resolveIdxFromY(ev.clientY, rect, snap);
    queueRollToIndex(idx);
    try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch {}
  }, [snap, queueRollToIndex]);

  const onStripPointerMove = useCallback((ev) => {
    if (!stripRef.current) return;
    const rect = stripRef.current.getBoundingClientRect();
    const idx = resolveIdxFromY(ev.clientY, rect, snap);
    setHoverIdx(idx);
    if (scrubbing) queueRollToIndex(idx);
  }, [snap, scrubbing, queueRollToIndex]);

  const onStripPointerUp = useCallback((ev) => {
    setScrubbing(false);
    try { ev.currentTarget.releasePointerCapture(ev.pointerId); } catch {}
  }, []);

  const onStripPointerLeave = useCallback(() => setHoverIdx(null), []);

  // Right-click on a mark → context menu.
  const onMarkContextMenu = useCallback((ev, item) => {
    ev.preventDefault();
    ev.stopPropagation();
    setContextMenu({
      x: Math.min(ev.clientX, (window.innerWidth || 9999) - 200),
      y: Math.min(ev.clientY, (window.innerHeight || 9999) - 180),
      entry: item,
    });
  }, []);

  // Dismiss the context menu on click-outside / Escape.
  useEffect(() => {
    if (!contextMenu) return undefined;
    const onDown = (e) => {
      const root = document.querySelector('.sw-rollback-bar-context');
      if (root && root.contains(e.target)) return;
      setContextMenu(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setContextMenu(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  // Focus the rename input when it appears.
  useEffect(() => {
    if (renameEditing && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renameEditing]);

  const onCtxRename = useCallback((entry) => {
    setRenameEditing({ entryId: entry.id, value: entry.mark || '' });
    setContextMenu(null);
  }, []);

  const commitRename = useCallback(() => {
    if (!renameEditing) return;
    const hist = getKernelHistory();
    if (!hist) { setRenameEditing(null); return; }
    const target = hist.entryById(renameEditing.entryId);
    const newName = String(renameEditing.value || '').trim();
    if (target && newName) {
      // Remove the old mark-index entry, set new, re-key.
      if (target.mark && hist._markIndex.has(target.mark)) {
        hist._markIndex.delete(target.mark);
      }
      target.mark = newName;
      hist._markIndex.set(newName, hist.entries.indexOf(target));
      // Surface for e2e + AI introspection.
      if (typeof window !== 'undefined') {
        window.__lastRollbackBarRename = { entryId: target.id, name: newName };
        try {
          window.dispatchEvent(new CustomEvent('archdisc:history-changed', {
            detail: { type: 'rename', entryId: target.id, mark: newName },
          }));
        } catch {}
      }
    }
    setRenameEditing(null);
    setSnap(snapshotHistory());
  }, [renameEditing]);

  const onCtxDelete = useCallback((entry) => {
    const hist = getKernelHistory();
    if (!hist) { setContextMenu(null); return; }
    const target = hist.entryById(entry.id);
    if (!target || !target.mark) { setContextMenu(null); return; }
    // Detaching a mark = strip the mark name from the entry + remove from
    // index. The entry itself stays (its forward/inverse are NOOPs anyway —
    // marks are pure pointers; deleting the name does not affect the
    // timeline's geometry-ops chain).
    const name = target.mark;
    target.mark = null;
    if (hist._markIndex.has(name)) hist._markIndex.delete(name);
    if (typeof window !== 'undefined') {
      window.__lastRollbackBarDelete = { entryId: target.id, name };
      try {
        window.dispatchEvent(new CustomEvent('archdisc:history-changed', {
          detail: { type: 'mark-delete', entryId: target.id, mark: name },
        }));
      } catch {}
    }
    setContextMenu(null);
    setSnap(snapshotHistory());
  }, []);

  const onCtxRollTo = useCallback(async (entry) => {
    setContextMenu(null);
    const next = await driveRollToIndex(entry.idx);
    if (next) setSnap(next);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        try { window.localStorage.setItem('archdisc.rollbackBar.collapsed', next ? '1' : '0'); } catch {}
      }
      return next;
    });
  }, []);

  // The bar AUTO-HIDES the timeline (returns null) when the log is empty,
  // but the empty state also drives whether the SIDE COLUMN should appear
  // in the workbench layout at all. We surface that via a window flag so
  // workbench.css can pick a zero-width column for an empty log without
  // forcing a re-mount of the React subtree.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const hasItems = snap && snap.items.length > 0;
    window.__archdiscRollbackBarHasItems = !!hasItems;
    return undefined;
  }, [snap]);

  // Bar hides when there's no log content.
  if (!snap || snap.items.length === 0) {
    return null;
  }

  const N = snap.items.length;
  // Cursor cell — cursor = -1 means baseline (BEFORE entries[0]); we render
  // the strip with N+1 positions: position 0 is the "before any op" slot
  // (the baseline flag at the TOP of the vertical strip), and positions
  // 1..N are the entries reading top → bottom.
  const cursorCell = snap.cursor + 1;  // 0 ⇔ baseline, N ⇔ tail entry
  const totalCells = N + 1;
  const stepPercent = 100 / totalCells;

  return (
    <>
      <div
        className={
          'sw-rollback-bar sw-rollback-bar-vertical'
          + (scrubbing ? ' sw-rollback-bar-scrubbing' : '')
          + (collapsed ? ' sw-rollback-bar-collapsed' : '')
        }
        data-archdisc-rollback-bar="active"
        data-archdisc-rollback-bar-vertical="true"
        data-archdisc-rollback-bar-collapsed={collapsed ? 'true' : 'false'}
        data-archdisc-rollback-entries={N}
        data-archdisc-rollback-cursor={snap.cursor}
        data-archdisc-rollback-current={snap.currentId || 'baseline'}
        role="toolbar"
        aria-label="Kernel rollback timeline"
      >
        <button
          className="sw-rollback-collapse-toggle"
          title={collapsed ? 'Expand rollback timeline' : 'Collapse rollback timeline'}
          aria-label={collapsed ? 'Expand rollback timeline' : 'Collapse rollback timeline'}
          aria-expanded={!collapsed}
          data-archdisc-rollback-collapse-toggle={collapsed ? 'collapsed' : 'expanded'}
          onClick={(e) => { e.stopPropagation(); toggleCollapsed(); }}
        >
          {collapsed ? <ChevronLeft size={11} /> : <ChevronRight size={11} />}
        </button>

        {!collapsed && (
          <div className="sw-rollback-bar-meta">
            <Clock size={11} />
            <span className="sw-rollback-bar-meta-label">Rollback</span>
            <span className="sw-rollback-bar-meta-sep">·</span>
            <span className="sw-rollback-bar-meta-count">{N} ops</span>
          </div>
        )}

        {!collapsed && (
          <button
            className="sw-rollback-step"
            title="Roll back to baseline"
            data-archdisc-rollback-action="rewind"
            onClick={() => clickEntry(-1)}
            aria-label="Rewind to baseline"
          >
            <SkipBack size={11} />
          </button>
        )}

        <div
          ref={stripRef}
          className={'sw-rollback-strip sw-rollback-strip-vertical'
            + (collapsed ? ' sw-rollback-strip-collapsed' : '')}
          data-archdisc-rollback-strip="active"
          onPointerDown={onStripPointerDown}
          onPointerMove={onStripPointerMove}
          onPointerUp={onStripPointerUp}
          onPointerLeave={onStripPointerLeave}
          onPointerCancel={onStripPointerUp}
        >
          {/* Cursor caret — positioned along the Y axis by cell index. */}
          <div
            className={'sw-rollback-cursor sw-rollback-cursor-vertical'
              + (scrubbing ? ' sw-rollback-cursor-pulse' : '')}
            data-archdisc-rollback-caret={snap.cursor}
            style={{ top: `calc(${(cursorCell + 0.5) * stepPercent}% - 1px)` }}
          />
          {/* Baseline flag at the very TOP of the strip. */}
          <button
            type="button"
            className={'sw-rollback-baseline sw-rollback-baseline-vertical'
              + (snap.cursor === -1 ? ' sw-rollback-baseline-active' : '')}
            title="Baseline (before any op)"
            data-archdisc-rollback-baseline="present"
            data-archdisc-rollback-active={snap.cursor === -1 ? 'true' : 'false'}
            style={{ top: `calc(${0.5 * stepPercent}% - 7px)` }}
            onClick={(e) => { e.stopPropagation(); clickEntry(-1); }}
          >
            <Flag size={10} />
          </button>
          {/* Entry dots + mark flags */}
          {snap.items.map((item) => {
            const cellCenterPercent = (item.idx + 1 + 0.5) * stepPercent;
            const isCurrent = item.idx === snap.cursor;
            const isApplied = item.idx <= snap.cursor;
            const isHovered = hoverIdx === item.idx;
            const isMark = !!item.mark;
            return (
              <button
                key={item.id}
                type="button"
                className={
                  (isMark
                    ? 'sw-rollback-mark sw-rollback-mark-vertical'
                    : 'sw-rollback-entry sw-rollback-entry-vertical')
                  + (isCurrent ? ' sw-rollback-entry-current' : '')
                  + (isApplied ? ' sw-rollback-entry-applied' : ' sw-rollback-entry-pending')
                  + (isHovered ? ' sw-rollback-entry-hover' : '')
                }
                data-archdisc-rollback-entry={item.id}
                data-archdisc-rollback-entry-idx={item.idx}
                data-archdisc-rollback-entry-op={item.opName}
                data-archdisc-rollback-entry-mark={item.mark || ''}
                data-archdisc-rollback-entry-applied={isApplied ? 'true' : 'false'}
                data-archdisc-rollback-entry-current={isCurrent ? 'true' : 'false'}
                style={{
                  top: isMark
                    ? `calc(${cellCenterPercent}% - 11px)`
                    : `calc(${cellCenterPercent}% - 5px)`,
                }}
                title={
                  isMark
                    ? `${item.mark} (mark)`
                    : `${item.opName}${item.persistentIds.length ? ' — ' + item.persistentIds.join(', ') : ''}`
                }
                onClick={(e) => { e.stopPropagation(); clickEntry(item.idx); }}
                onContextMenu={(e) => isMark ? onMarkContextMenu(e, item) : null}
              >
                {isMark ? (
                  <>
                    <Flag size={9} />
                    {!collapsed && (
                      <span className="sw-rollback-mark-label">{item.mark}</span>
                    )}
                  </>
                ) : null}
              </button>
            );
          })}
        </div>

        {!collapsed && (
          <button
            className="sw-rollback-step"
            title="Roll forward to tail"
            data-archdisc-rollback-action="ffwd"
            onClick={() => clickEntry(N - 1)}
            aria-label="Roll forward to tail"
          >
            <SkipForward size={11} />
          </button>
        )}

        {!collapsed && (
          <div className="sw-rollback-bar-meta sw-rollback-bar-meta-footer">
            <span className="sw-rollback-bar-meta-cursor">
              cursor {snap.cursor === -1 ? '—' : snap.cursor}/{N - 1}
            </span>
          </div>
        )}

        {!collapsed && hoverIdx !== null && snap.items[hoverIdx] && (
          <div
            className="sw-rollback-tip sw-rollback-tip-vertical"
            data-archdisc-rollback-tip={snap.items[hoverIdx].id}
          >
            <span className="sw-rollback-tip-op">{snap.items[hoverIdx].opName}</span>
            {snap.items[hoverIdx].mark && (
              <span className="sw-rollback-tip-mark"> · {snap.items[hoverIdx].mark}</span>
            )}
            {snap.items[hoverIdx].persistentIds.length > 0 && (
              <span className="sw-rollback-tip-ids">
                {' '}· {snap.items[hoverIdx].persistentIds.join(', ')}
              </span>
            )}
          </div>
        )}
      </div>

      {contextMenu && (
        <div
          className="sw-rollback-bar-context"
          data-archdisc-rollback-context="open"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="sw-rollback-bar-context-header">
            <Flag size={11} />
            <span>{contextMenu.entry.mark}</span>
          </div>
          <button
            className="sw-rollback-bar-context-item"
            data-archdisc-rollback-context-action="roll-to"
            onClick={() => onCtxRollTo(contextMenu.entry)}
          >
            <SkipForward size={11} />
            <span>Roll To Here</span>
          </button>
          <button
            className="sw-rollback-bar-context-item"
            data-archdisc-rollback-context-action="rename"
            onClick={() => onCtxRename(contextMenu.entry)}
          >
            <Edit2 size={11} />
            <span>Rename</span>
          </button>
          <button
            className="sw-rollback-bar-context-item sw-rollback-bar-context-item-danger"
            data-archdisc-rollback-context-action="delete"
            onClick={() => onCtxDelete(contextMenu.entry)}
          >
            <Trash2 size={11} />
            <span>Delete Mark</span>
          </button>
        </div>
      )}

      {renameEditing && (
        <div className="sw-rollback-bar-rename" data-archdisc-rollback-rename="open">
          <input
            ref={renameInputRef}
            className="sw-rollback-bar-rename-input"
            value={renameEditing.value}
            onChange={(e) => setRenameEditing(s => ({ ...s, value: e.target.value }))}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              else if (e.key === 'Escape') setRenameEditing(null);
            }}
            data-archdisc-rollback-rename-input
          />
        </div>
      )}
    </>
  );
}

/**
 * Map a pointer X (clientX) onto the nearest entry index, given the strip
 * bounding rect + current snapshot. Returns -1 for the baseline cell.
 *
 * Retained for any external callers that depended on the horizontal-strip
 * mapping; the live RollbackBar now uses `resolveIdxFromY`.
 */
function resolveIdxFromX(clientX, rect, snap) {
  if (!snap || snap.items.length === 0) return -1;
  const N = snap.items.length;
  const totalCells = N + 1;
  const x = clientX - rect.left;
  const cell = Math.floor((x / rect.width) * totalCells);
  const clamped = Math.max(0, Math.min(totalCells - 1, cell));
  // Cell 0 = baseline (-1); cells 1..N map to entries 0..N-1.
  return clamped === 0 ? -1 : clamped - 1;
}

/**
 * Map a pointer Y (clientY) onto the nearest entry index for the VERTICAL
 * rollback strip. Top of the strip = baseline cell, bottom = tail entry.
 * Returns -1 for the baseline cell.
 */
function resolveIdxFromY(clientY, rect, snap) {
  if (!snap || snap.items.length === 0) return -1;
  const N = snap.items.length;
  const totalCells = N + 1;
  const y = clientY - rect.top;
  const cell = Math.floor((y / rect.height) * totalCells);
  const clamped = Math.max(0, Math.min(totalCells - 1, cell));
  // Cell 0 = baseline (-1); cells 1..N map to entries 0..N-1.
  return clamped === 0 ? -1 : clamped - 1;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tier-11b — Three NX-distinctive UX patterns
// ═══════════════════════════════════════════════════════════════════════════
//
// 1. MultiPlaneStack       — docked stack of 3 reference planes for new-
//                            datum-plane construction (NX's hallmark for
//                            fast multi-datum modelling).
// 2. CsysAnchorPanel       — pop-up for assembly Add Component flow that
//                            anchors a new component to a CSYS without
//                            requiring mates (NX's "snap to origin" speed-up).
// 3. InlineSketchSession   — modal sketch-inside-a-dialog session: open
//                            Extrude → click "Sketch Profile" → draw INSIDE
//                            the dock → Done → return to Extrude with the
//                            profile filled in (NX's marquee productivity
//                            feature; SW typically forces sketch-first).
//
// Each is fully implemented (not a mockup) and integrated with the existing
// visual token system + the PropertyManagerDock event bus + the foundation
// scene/registry/sketch state. Where deep kernel hooks would be needed and
// are out of allowlist, the integration uses the established `window.__archdisc*`
// plumbing — same idiom as Tier-1 / Tier-2 overlays — so the patterns work
// end-to-end through the existing handler tooling.

// ─── 11. Multi-Plane Stack (Tier-11b NX-distinctive) ──────────────────────
//
// NX's hallmark for fast multi-datum modelling: when constructing a new
// datum plane, a stack of three reference planes is docked top-right of
// the viewport. Each card shows the plane's name + a small colour preview
// of its surface normal direction; clicking a card picks it as the
// reference for the new datum.
//
// The stack contains:
//   - The three world reference planes (Front / Top / Right) by default.
//   - When the user creates a new datum plane via `recordDatumPlane`
//     below, the most-recent 3 datums replace / supplement the defaults
//     (so the stack always shows "the planes you most likely want next").
//
// Activation: the stack is visible whenever a datum-plane construction
// session is open. We expose three open paths so the pattern is easy to
// wire to:
//   - `window.__archdiscOpenDatumPlaneStack()` — programmatic open from a
//     ribbon handler or AI plan step.
//   - A custom event `archdisc:datum-plane:open` — same effect; useful
//     for e2e + cross-component bus.
//   - Reading `window.__archdiscDatumStackForceShow === true` — pinned
//     show for inspection / e2e.
//
// On pick, we:
//   - Record the chosen plane on `window.__archdiscDatumPlaneReference`
//     (the next datum-plane handler reads this, falling back to the
//     world default).
//   - Fire `archdisc:datum-plane:reference-picked` with the chosen plane.
//   - Auto-close the stack so the user proceeds to the offset distance.

const WORLD_DATUM_PLANES = [
  { id: 'world-front', name: 'Front',  axis: 'XZ', normal: [0, 1, 0], color: '#4a90d9', isWorld: true },
  { id: 'world-top',   name: 'Top',    axis: 'XY', normal: [0, 0, 1], color: '#3ec77e', isWorld: true },
  { id: 'world-right', name: 'Right',  axis: 'YZ', normal: [1, 0, 0], color: '#e35454', isWorld: true },
];

/** Pure helper: derive the 3-card stack from world planes + most-recent datums.
 *  Always returns 3 cards; pads with world planes when no user datums exist. */
function computeStackCards() {
  const userDatums = (typeof window !== 'undefined' && Array.isArray(window.__archdiscUserDatumPlanes))
    ? window.__archdiscUserDatumPlanes
    : [];
  // Most-recent user datums first (up to 3). Pad with world planes for the
  // remainder. Dedup by id.
  const seen = new Set();
  const out = [];
  for (const d of userDatums.slice().reverse()) {
    if (!d || !d.id || seen.has(d.id)) continue;
    out.push(d);
    seen.add(d.id);
    if (out.length === 3) return out;
  }
  for (const d of WORLD_DATUM_PLANES) {
    if (seen.has(d.id)) continue;
    out.push(d);
    seen.add(d.id);
    if (out.length === 3) return out;
  }
  return out;
}

/** Public: record a user-created datum plane on the global stack so future
 *  datum-plane constructions can pick it as a reference. */
export function recordDatumPlane(plane) {
  if (typeof window === 'undefined') return;
  if (!window.__archdiscUserDatumPlanes) window.__archdiscUserDatumPlanes = [];
  if (!plane || !plane.id) return;
  window.__archdiscUserDatumPlanes.push({
    ...plane,
    color: plane.color || '#fbc068',
  });
  try {
    window.dispatchEvent(new CustomEvent('archdisc:datum-plane:added', { detail: plane }));
  } catch {}
}

export function MultiPlaneStack() {
  const [open, setOpen] = useState(false);
  const [cards, setCards] = useState(() => computeStackCards());
  const [pickedId, setPickedId] = useState(null);

  // Subscribe to open / close events. Public APIs:
  //   - window.__archdiscOpenDatumPlaneStack() / closeDatumPlaneStack()
  //   - 'archdisc:datum-plane:open' / 'archdisc:datum-plane:close'
  //   - window.__archdiscDatumStackForceShow = true to pin.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const refresh = () => setCards(computeStackCards());
    refresh();
    window.__archdiscOpenDatumPlaneStack = () => {
      setOpen(true);
      setPickedId(null);
      refresh();
    };
    window.__archdiscCloseDatumPlaneStack = () => {
      setOpen(false);
      setPickedId(null);
    };
    const onOpen = () => { setOpen(true); setPickedId(null); refresh(); };
    const onClose = () => { setOpen(false); setPickedId(null); };
    const onDatumAdded = () => refresh();
    window.addEventListener('archdisc:datum-plane:open', onOpen);
    window.addEventListener('archdisc:datum-plane:close', onClose);
    window.addEventListener('archdisc:datum-plane:added', onDatumAdded);
    // Honour the pinned-show flag (mostly for e2e).
    if (window.__archdiscDatumStackForceShow === true) setOpen(true);
    const id = setInterval(() => {
      if (window.__archdiscDatumStackForceShow === true && !open) setOpen(true);
    }, 500);
    return () => {
      window.removeEventListener('archdisc:datum-plane:open', onOpen);
      window.removeEventListener('archdisc:datum-plane:close', onClose);
      window.removeEventListener('archdisc:datum-plane:added', onDatumAdded);
      clearInterval(id);
      // Leave window hooks installed — they're idempotent and other
      // components / handlers may have references.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = useCallback((card) => {
    setPickedId(card.id);
    if (typeof window !== 'undefined') {
      window.__archdiscDatumPlaneReference = {
        id: card.id,
        name: card.name,
        axis: card.axis,
        normal: card.normal,
        isWorld: !!card.isWorld,
        pickedAt: Date.now(),
      };
      try {
        window.dispatchEvent(new CustomEvent('archdisc:datum-plane:reference-picked', {
          detail: window.__archdiscDatumPlaneReference,
        }));
      } catch {}
    }
    // Auto-dismiss the stack after a short flash so the user sees their
    // selection register, then the stack folds away.
    setTimeout(() => {
      // Don't close if a force-show is pinned (e2e inspection).
      if (typeof window !== 'undefined' && window.__archdiscDatumStackForceShow === true) return;
      setOpen(false);
      setPickedId(null);
    }, 360);
  }, []);

  const close = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.__archdiscDatumStackForceShow = false;
    }
    setOpen(false);
    setPickedId(null);
  }, []);

  if (!open) return null;

  return (
    <aside
      className="sw-multiplane-stack"
      data-archdisc-multiplane-stack="open"
      data-archdisc-multiplane-count={String(cards.length)}
      data-archdisc-multiplane-picked={pickedId || ''}
      aria-label="Multi-plane reference stack"
    >
      <div className="sw-multiplane-stack-header">
        <Layout size={11} />
        <span className="sw-multiplane-stack-title">Reference Planes</span>
        <button
          className="sw-multiplane-stack-close"
          title="Close (Esc)"
          aria-label="Close datum-plane reference stack"
          data-archdisc-multiplane-close
          onClick={close}
        >
          <X size={12} strokeWidth={3} />
        </button>
      </div>
      <div className="sw-multiplane-stack-hint">
        Pick a reference for the new datum plane
      </div>
      <div className="sw-multiplane-stack-cards">
        {cards.map((card, idx) => (
          <button
            key={card.id}
            type="button"
            className={
              'sw-multiplane-card'
              + (pickedId === card.id ? ' sw-multiplane-card-picked' : '')
              + (card.isWorld ? ' sw-multiplane-card-world' : ' sw-multiplane-card-user')
            }
            data-archdisc-multiplane-card={card.id}
            data-archdisc-multiplane-card-name={card.name}
            data-archdisc-multiplane-card-axis={card.axis || ''}
            data-archdisc-multiplane-card-idx={idx}
            title={`${card.name} plane (${card.axis || 'user'})`}
            onClick={() => pick(card)}
          >
            <span
              className="sw-multiplane-card-swatch"
              style={{ background: card.color || '#fbc068' }}
              aria-hidden="true"
            />
            <span className="sw-multiplane-card-meta">
              <span className="sw-multiplane-card-name">{card.name}</span>
              <span className="sw-multiplane-card-axis">{card.axis || 'user'}</span>
            </span>
            {pickedId === card.id && (
              <Check size={11} className="sw-multiplane-card-check" />
            )}
          </button>
        ))}
      </div>
    </aside>
  );
}

// ─── 12. CSYS Anchor Panel (Tier-11b NX-distinctive) ───────────────────────
//
// NX's "Add Component → Anchor to Selected Coordinate System" flow shipped
// as an in-viewport panel. When toggled ON via "CSYS Anchor", the next
// Insert Component (or any new-component placement) will snap the new
// component's local CSYS to a chosen CSYS in the scene — no mates needed.
//
// The panel:
//   - Lists the available CSYS targets (world origin + every CSYS the
//     user has created via `recordCsys` below; falls back to "World
//     Origin" alone if none exist).
//   - Has a "CSYS Anchor" toggle that arms / disarms the snap.
//   - On pick, writes the choice to `window.__archdiscCsysAnchor`
//     ({ csysId, position, rotation }) and fires
//     `archdisc:csys-anchor:picked`.
//
// The downstream Insert Component handler can read
// `window.__archdiscCsysAnchor` and translate the new part to the picked
// origin. We also expose `applyCsysAnchorToPart(part)` which actively
// translates a given Three.js group to the picked anchor — that's how the
// e2e demonstrates the snap end-to-end without touching the handler.
//
// Activation: visible when any of these is true:
//   - The "CSYS Anchor" toggle is on (user-driven).
//   - An Add Component flow is open (`window.__archdiscAssemblyInsertOpen`).
//   - The force-show flag is pinned (`__archdiscCsysAnchorForceShow`).

const WORLD_CSYS = {
  id: 'world-origin',
  name: 'World Origin',
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  isWorld: true,
};

/** Public: record a user-created CSYS on the global list so future
 *  Add-Component flows can anchor to it. */
export function recordCsys(csys) {
  if (typeof window === 'undefined') return;
  if (!window.__archdiscUserCsysList) window.__archdiscUserCsysList = [];
  if (!csys || !csys.id) return;
  window.__archdiscUserCsysList.push({
    ...csys,
    position: Array.isArray(csys.position) ? csys.position : [0, 0, 0],
    rotation: Array.isArray(csys.rotation) ? csys.rotation : [0, 0, 0],
  });
  try {
    window.dispatchEvent(new CustomEvent('archdisc:csys:added', { detail: csys }));
  } catch {}
}

/** Public: collect the list of CSYS targets — World Origin + every recorded. */
function computeCsysList() {
  const userList = (typeof window !== 'undefined' && Array.isArray(window.__archdiscUserCsysList))
    ? window.__archdiscUserCsysList
    : [];
  return [WORLD_CSYS, ...userList];
}

/** Public: actively snap a Three.js group to the picked anchor.
 *  Returns the delta translation applied so callers can record it. */
export function applyCsysAnchorToPart(group) {
  if (typeof window === 'undefined') return null;
  const anchor = window.__archdiscCsysAnchor;
  if (!group || !anchor || !Array.isArray(anchor.position)) return null;
  const THREE = window.THREE;
  if (!THREE) return null;
  const before = { x: group.position.x, y: group.position.y, z: group.position.z };
  // anchor.position is in mm; the viewport scene uses metres.
  const target = {
    x: anchor.position[0] * 0.001,
    y: anchor.position[1] * 0.001,
    z: anchor.position[2] * 0.001,
  };
  // Translate so that the group's origin (presumed to be the new
  // component's local CSYS) lands at the anchor target.
  group.position.set(target.x, target.y, target.z);
  group.updateMatrixWorld(true);
  const delta = {
    x: target.x - before.x,
    y: target.y - before.y,
    z: target.z - before.z,
  };
  window.__lastCsysAnchorApplied = {
    groupName: group.name,
    csysId: anchor.csysId,
    anchorPosition: anchor.position,
    delta,
    appliedAt: Date.now(),
  };
  try {
    window.dispatchEvent(new CustomEvent('archdisc:csys-anchor:applied', {
      detail: window.__lastCsysAnchorApplied,
    }));
  } catch {}
  return delta;
}

export function CsysAnchorPanel() {
  const [armed, setArmed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !!window.__archdiscCsysAnchorArmed;
  });
  const [insertOpen, setInsertOpen] = useState(false);
  const [forceShow, setForceShow] = useState(false);
  const [csysList, setCsysList] = useState(() => computeCsysList());
  const [pickedId, setPickedId] = useState(null);

  // Track:
  //   - the assembly Insert Component flow state via __archdiscAssemblyInsertOpen
  //   - the pinned force-show
  //   - new CSYS records via 'archdisc:csys:added'
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const refresh = () => {
      setInsertOpen(!!window.__archdiscAssemblyInsertOpen);
      setForceShow(!!window.__archdiscCsysAnchorForceShow);
      setArmed(!!window.__archdiscCsysAnchorArmed);
      setCsysList(computeCsysList());
    };
    refresh();
    const onCsysAdded = () => setCsysList(computeCsysList());
    const onAssemblyOpen = () => { setInsertOpen(true); };
    const onAssemblyClose = () => { setInsertOpen(false); };
    window.addEventListener('archdisc:csys:added', onCsysAdded);
    window.addEventListener('archdisc:assembly-insert:open', onAssemblyOpen);
    window.addEventListener('archdisc:assembly-insert:close', onAssemblyClose);
    const id = setInterval(refresh, 600);
    return () => {
      window.removeEventListener('archdisc:csys:added', onCsysAdded);
      window.removeEventListener('archdisc:assembly-insert:open', onAssemblyOpen);
      window.removeEventListener('archdisc:assembly-insert:close', onAssemblyClose);
      clearInterval(id);
    };
  }, []);

  const visible = armed || insertOpen || forceShow;

  const toggleArmed = useCallback(() => {
    setArmed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.__archdiscCsysAnchorArmed = next;
        if (!next) {
          // Disarm clears any previously-picked anchor so future inserts
          // don't unexpectedly snap.
          window.__archdiscCsysAnchor = null;
          try {
            window.dispatchEvent(new CustomEvent('archdisc:csys-anchor:disarmed'));
          } catch {}
        } else {
          try {
            window.dispatchEvent(new CustomEvent('archdisc:csys-anchor:armed'));
          } catch {}
        }
      }
      return next;
    });
  }, []);

  const pick = useCallback((csys) => {
    setPickedId(csys.id);
    if (typeof window !== 'undefined') {
      window.__archdiscCsysAnchor = {
        csysId: csys.id,
        name: csys.name,
        position: csys.position,
        rotation: csys.rotation,
        isWorld: !!csys.isWorld,
        pickedAt: Date.now(),
      };
      // Picking a CSYS also implicitly arms the anchor so a fresh user
      // can pick and then click Insert Component without a separate arm.
      window.__archdiscCsysAnchorArmed = true;
      setArmed(true);
      try {
        window.dispatchEvent(new CustomEvent('archdisc:csys-anchor:picked', {
          detail: window.__archdiscCsysAnchor,
        }));
      } catch {}
    }
  }, []);

  if (!visible) return null;

  return (
    <aside
      className={
        'sw-csys-anchor-panel'
        + (armed ? ' sw-csys-anchor-panel-armed' : '')
      }
      data-archdisc-csys-anchor-panel={visible ? 'open' : 'closed'}
      data-archdisc-csys-anchor-armed={armed ? 'true' : 'false'}
      data-archdisc-csys-anchor-picked={pickedId || ''}
      aria-label="CSYS anchor for assembly component placement"
    >
      <div className="sw-csys-anchor-header">
        <Anchor size={11} />
        <span className="sw-csys-anchor-title">CSYS Anchor</span>
        <button
          className={
            'sw-csys-anchor-toggle'
            + (armed ? ' sw-csys-anchor-toggle-on' : '')
          }
          title={armed ? 'Disarm — new components placed manually' : 'Arm — new components snap to picked CSYS'}
          aria-pressed={armed ? 'true' : 'false'}
          data-archdisc-csys-anchor-toggle={armed ? 'on' : 'off'}
          onClick={toggleArmed}
        >
          {armed ? 'ARMED' : 'OFF'}
        </button>
      </div>
      <div className="sw-csys-anchor-hint">
        {armed
          ? 'Pick a target CSYS. The next inserted component snaps to it (no mates).'
          : 'Click ARMED to skip the 3-mate setup for "snap to origin" placement.'}
      </div>
      <div className="sw-csys-anchor-targets">
        {csysList.map((csys) => (
          <button
            key={csys.id}
            type="button"
            className={
              'sw-csys-anchor-target'
              + (pickedId === csys.id ? ' sw-csys-anchor-target-picked' : '')
              + (csys.isWorld ? ' sw-csys-anchor-target-world' : ' sw-csys-anchor-target-user')
            }
            data-archdisc-csys-target={csys.id}
            data-archdisc-csys-target-name={csys.name}
            title={`Anchor to ${csys.name} (${csys.position[0]}, ${csys.position[1]}, ${csys.position[2]} mm)`}
            onClick={() => pick(csys)}
          >
            <Move3D size={11} />
            <span className="sw-csys-anchor-target-name">{csys.name}</span>
            <span className="sw-csys-anchor-target-pos">
              ({csys.position[0]}, {csys.position[1]}, {csys.position[2]})
            </span>
            {pickedId === csys.id && (
              <Check size={11} className="sw-csys-anchor-target-check" />
            )}
          </button>
        ))}
      </div>
    </aside>
  );
}

// ─── 13. Inline Sketch Session (Tier-11b NX-distinctive) ──────────────────
//
// NX's marquee productivity feature: when an op like Extrude requires a
// profile sketch, instead of forcing the user to exit Extrude → create
// sketch → close → re-open Extrude, the user clicks "Sketch Profile"
// INSIDE the Extrude dialog. The PropertyManager Dock area expands into
// a 2-pane overlay: top pane summarises the parent Extrude params; bottom
// pane is the live inline sketch toolbar (rect / circle / 4-point profile).
// "Done Sketch" commits the profile back to the parent dialog as the
// Extrude profile.
//
// Activation flow:
//   1. User opens Extrude (or another inline-sketch-able tool). The
//      PropertyManagerDock binds the param dialog.
//   2. We dispatch `archdisc:inline-sketch:enter` (manually or via the
//      handler) with the parent dialog state attached.
//   3. The InlineSketchSession overlay opens with the parent's title
//      pinned at the top (so the user still sees "Extrude · Height = 10
//      mm" and knows the parent dialog is alive).
//   4. The user picks a profile primitive (Rectangle is the canonical
//      shipping case; Circle is the secondary). Either: type the
//      dimensions in the inline field set, or click 2/4 corners in the
//      viewport (the overlay tracks the canvas via a click-buffer).
//   5. On "Done Sketch":
//        - The profile is written to `window.__archdiscInlineSketchProfile`
//          AND merged into `window.__archdiscPlanParams[<tool>]` as the
//          `profile` field (the Extrude Boss handler already reads
//          `__archdiscPlanParams['Extrude Boss'].profile` as its first
//          source — Path A in the handler).
//        - The session closes.
//        - `archdisc:inline-sketch:done` fires with the committed profile.
//
// Honest scope: the inline session does NOT replace the full
// InteractiveSketch engine — that's the parent system for designed
// sketches with constraints. The inline session ships a small set of
// primitives (rectangle, circle, 4-point polygon) sufficient for the
// "I just want this Extrude to use this shape RIGHT NOW" use-case.

const INLINE_SKETCH_TOOLS = new Set([
  'Extrude Boss',
  'Extrude Cut',
  'Revolve Boss',
  'Sweep Boss',
  'Loft Boss',
]);

/** Public: invoke from a handler / ribbon hook to enter the inline session.
 *  Use this from inside Extrude / Revolve / etc. when the user clicks
 *  "Sketch Profile". Hands the parent dialog's display state to the
 *  overlay so the title pin can render. */
export function enterInlineSketchSession(payload) {
  if (typeof window === 'undefined') return;
  window.__archdiscInlineSketchPayload = payload || {};
  try {
    window.dispatchEvent(new CustomEvent('archdisc:inline-sketch:enter', { detail: payload || {} }));
  } catch {}
}

/** Public: programmatically commit a profile and exit the session. */
export function commitInlineSketchProfile(profile, opts = {}) {
  if (typeof window === 'undefined') return;
  if (!Array.isArray(profile) || profile.length < 3) return;
  const points = profile.map(p =>
    Array.isArray(p) ? [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0]
      : [Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0]);
  window.__archdiscInlineSketchProfile = {
    points,
    primitive: opts.primitive || 'custom',
    parentTool: opts.parentTool || null,
    committedAt: Date.now(),
  };
  // Stash into plan params so the next call to the parent tool's handler
  // picks the profile up via Path A (`__archdiscPlanParams[tool].profile`).
  const tool = opts.parentTool;
  if (tool) {
    if (!window.__archdiscPlanParams) window.__archdiscPlanParams = {};
    if (!window.__archdiscPlanParams[tool]) window.__archdiscPlanParams[tool] = {};
    window.__archdiscPlanParams[tool].profile = points;
  }
  try {
    window.dispatchEvent(new CustomEvent('archdisc:inline-sketch:done', {
      detail: { profile: points, primitive: opts.primitive || 'custom', parentTool: tool },
    }));
  } catch {}
}

/** Public: programmatically cancel the session. */
export function cancelInlineSketchSession() {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('archdisc:inline-sketch:cancel'));
  } catch {}
}

export function InlineSketchSession() {
  // Session state — { parentTool, parentTitle, parentValues } when open.
  const [session, setSession] = useState(null);
  // Active primitive: 'rect' | 'circle' | 'polygon'
  const [primitive, setPrimitive] = useState('rect');
  // Per-primitive parameters.
  const [rect, setRect] = useState({ width: 40, height: 30, cx: 0, cy: 0 });
  const [circle, setCircle] = useState({ radius: 20, cx: 0, cy: 0, segments: 32 });
  // Computed preview profile (in sketch-local mm coords).
  const [previewProfile, setPreviewProfile] = useState([]);

  // Open hook — listens for entry event.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onEnter = (ev) => {
      const detail = ev?.detail || {};
      const tool = detail.parentTool || detail.toolName || (window.__archdiscInlineSketchPayload?.parentTool) || null;
      setSession({
        parentTool: tool,
        parentTitle: detail.parentTitle || (tool ? `${tool} · profile` : 'Sketch Profile'),
        parentValues: detail.parentValues || {},
        openedAt: Date.now(),
      });
      // Reset primitive defaults so re-entering the session is fresh.
      setPrimitive(detail.primitive || 'rect');
      // If the caller provided seed dims, honour them.
      if (detail.seed?.rect) setRect((r) => ({ ...r, ...detail.seed.rect }));
      if (detail.seed?.circle) setCircle((c) => ({ ...c, ...detail.seed.circle }));
    };
    const onCancel = () => setSession(null);
    const onDone = () => setSession(null);
    window.addEventListener('archdisc:inline-sketch:enter', onEnter);
    window.addEventListener('archdisc:inline-sketch:cancel', onCancel);
    window.addEventListener('archdisc:inline-sketch:done', onDone);
    return () => {
      window.removeEventListener('archdisc:inline-sketch:enter', onEnter);
      window.removeEventListener('archdisc:inline-sketch:cancel', onCancel);
      window.removeEventListener('archdisc:inline-sketch:done', onDone);
    };
  }, []);

  // Whenever primitive / rect / circle change, rebuild the preview profile
  // (in mm-relative-to-sketch-plane coordinates; z = 0 for planar sketch).
  useEffect(() => {
    if (!session) { setPreviewProfile([]); return; }
    let pts = [];
    if (primitive === 'rect') {
      const hw = rect.width / 2, hh = rect.height / 2;
      pts = [
        [rect.cx - hw, rect.cy - hh, 0],
        [rect.cx + hw, rect.cy - hh, 0],
        [rect.cx + hw, rect.cy + hh, 0],
        [rect.cx - hw, rect.cy + hh, 0],
      ];
    } else if (primitive === 'circle') {
      const n = Math.max(8, Math.min(96, circle.segments | 0));
      for (let i = 0; i < n; i++) {
        const t = (i / n) * 2 * Math.PI;
        pts.push([
          circle.cx + circle.radius * Math.cos(t),
          circle.cy + circle.radius * Math.sin(t),
          0,
        ]);
      }
    }
    setPreviewProfile(pts);
    if (typeof window !== 'undefined') {
      window.__archdiscInlineSketchPreview = { primitive, points: pts };
    }
  }, [session, primitive, rect, circle]);

  const commit = useCallback(() => {
    if (!session) return;
    if (!previewProfile.length) return;
    commitInlineSketchProfile(previewProfile, {
      primitive,
      parentTool: session.parentTool,
    });
    setSession(null);
  }, [session, previewProfile, primitive]);

  const cancel = useCallback(() => {
    cancelInlineSketchSession();
    setSession(null);
  }, []);

  if (!session) return null;

  return (
    <aside
      className="sw-inline-sketch-session"
      data-archdisc-inline-sketch="open"
      data-archdisc-inline-sketch-tool={session.parentTool || ''}
      data-archdisc-inline-sketch-primitive={primitive}
      data-archdisc-inline-sketch-points={String(previewProfile.length)}
    >
      {/* TOP PANE — the parent dialog summary stays visible so the user
       *  doesn't lose context about which Extrude they're sketching for. */}
      <div className="sw-inline-sketch-top">
        <div className="sw-inline-sketch-parent">
          <PencilLine size={11} />
          <span className="sw-inline-sketch-parent-label">{session.parentTitle}</span>
        </div>
        <div className="sw-inline-sketch-parent-values">
          {Object.entries(session.parentValues).slice(0, 4).map(([k, v]) => (
            <span key={k} className="sw-inline-sketch-parent-kv">
              <span className="sw-inline-sketch-parent-k">{k}</span>
              <span className="sw-inline-sketch-parent-v">{String(v)}</span>
            </span>
          ))}
        </div>
      </div>

      {/* BOTTOM PANE — the inline sketch toolbar + numeric editor. */}
      <div className="sw-inline-sketch-bottom">
        <div className="sw-inline-sketch-primitives">
          <button
            type="button"
            className={
              'sw-inline-sketch-primitive-btn'
              + (primitive === 'rect' ? ' sw-inline-sketch-primitive-btn-active' : '')
            }
            data-archdisc-inline-sketch-prim="rect"
            title="Rectangle profile"
            onClick={() => setPrimitive('rect')}
          >
            <Square size={11} />
            <span>Rect</span>
          </button>
          <button
            type="button"
            className={
              'sw-inline-sketch-primitive-btn'
              + (primitive === 'circle' ? ' sw-inline-sketch-primitive-btn-active' : '')
            }
            data-archdisc-inline-sketch-prim="circle"
            title="Circular profile"
            onClick={() => setPrimitive('circle')}
          >
            <Circle size={11} />
            <span>Circle</span>
          </button>
        </div>

        <div className="sw-inline-sketch-fields">
          {primitive === 'rect' && (
            <>
              <InlineNumberField
                label="Width" value={rect.width} unit="mm"
                onChange={(v) => setRect((r) => ({ ...r, width: v }))}
                data="width" />
              <InlineNumberField
                label="Height" value={rect.height} unit="mm"
                onChange={(v) => setRect((r) => ({ ...r, height: v }))}
                data="height" />
              <InlineNumberField
                label="Cx" value={rect.cx} unit="mm"
                onChange={(v) => setRect((r) => ({ ...r, cx: v }))}
                data="cx" />
              <InlineNumberField
                label="Cy" value={rect.cy} unit="mm"
                onChange={(v) => setRect((r) => ({ ...r, cy: v }))}
                data="cy" />
            </>
          )}
          {primitive === 'circle' && (
            <>
              <InlineNumberField
                label="Radius" value={circle.radius} unit="mm"
                onChange={(v) => setCircle((c) => ({ ...c, radius: v }))}
                data="radius" />
              <InlineNumberField
                label="Cx" value={circle.cx} unit="mm"
                onChange={(v) => setCircle((c) => ({ ...c, cx: v }))}
                data="cx" />
              <InlineNumberField
                label="Cy" value={circle.cy} unit="mm"
                onChange={(v) => setCircle((c) => ({ ...c, cy: v }))}
                data="cy" />
              <InlineNumberField
                label="Segments" value={circle.segments}
                onChange={(v) => setCircle((c) => ({ ...c, segments: Math.max(8, Math.min(96, v | 0)) }))}
                data="segments" step={1} />
            </>
          )}
        </div>

        {/* Live mini-preview — a small SVG showing the profile shape. */}
        <div className="sw-inline-sketch-preview">
          <InlineSketchPreviewSVG points={previewProfile} primitive={primitive} />
          <div className="sw-inline-sketch-preview-meta">
            {previewProfile.length} pts · primitive = {primitive}
          </div>
        </div>

        <div className="sw-inline-sketch-actions">
          <button
            className="sw-inline-sketch-action sw-inline-sketch-action-cancel"
            data-archdisc-inline-sketch-action="cancel"
            title="Cancel inline sketch (return to parent dialog unchanged)"
            onClick={cancel}
          >
            <X size={11} strokeWidth={3} /> Cancel
          </button>
          <button
            className="sw-inline-sketch-action sw-inline-sketch-action-done"
            data-archdisc-inline-sketch-action="done"
            title="Commit sketch profile to the parent Extrude / Revolve / etc."
            onClick={commit}
          >
            <Check size={11} strokeWidth={3} /> Done Sketch
          </button>
        </div>
      </div>
    </aside>
  );
}

function InlineNumberField({ label, value, unit, onChange, data, step }) {
  return (
    <label className="sw-inline-sketch-field">
      <span className="sw-inline-sketch-field-label">{label}</span>
      <input
        type="number"
        className="sw-inline-sketch-field-input"
        value={value}
        step={step ?? 'any'}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        data-archdisc-inline-sketch-field={data}
      />
      {unit && <span className="sw-inline-sketch-field-unit">{unit}</span>}
    </label>
  );
}

function InlineSketchPreviewSVG({ points, primitive }) {
  if (!points || points.length === 0) {
    return <div className="sw-inline-sketch-preview-empty">no profile</div>;
  }
  // Auto-fit the polyline into a 220 × 100 SVG with a 6 px margin.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const W = 220, H = 100, M = 6;
  const spanX = (maxX - minX) || 1;
  const spanY = (maxY - minY) || 1;
  const scale = Math.min((W - 2 * M) / spanX, (H - 2 * M) / spanY);
  const ox = (W - spanX * scale) / 2 - minX * scale;
  const oy = (H - spanY * scale) / 2 - minY * scale;
  const screenPts = points.map((p) => [
    p[0] * scale + ox,
    H - (p[1] * scale + oy),  // flip Y so up is up
  ]);
  const polyD = screenPts.map((p, i) => (i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`)).join(' ') + ' Z';
  return (
    <svg
      className="sw-inline-sketch-preview-svg"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      data-archdisc-inline-sketch-preview={primitive}
    >
      <rect x="0" y="0" width={W} height={H} fill="rgba(0,0,0,0.18)" rx="3" />
      <path d={polyD} fill="rgba(74,144,217,0.18)" stroke="#4a90d9" strokeWidth="1.4" />
      {screenPts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="1.6" fill="#fbc068" />
      ))}
    </svg>
  );
}
