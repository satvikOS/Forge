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
import { ChevronDown, ChevronRight, Check, X, Maximize2, Crop,
         Scissors, Box, Eye, Square, MousePointer, Layers, Hexagon,
         Circle, Trash2, Info, Minus, MoveVertical, GitBranch,
         RotateCw, Slash } from 'lucide-react';
import { onParamRequest, resolveOpen } from '../foundation/ToolParamDialog.js';
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
  // Tier-2a (sketch primitives)
  'Sketch Chamfer',
  'Convert Entities',
]);

export function PropertyManagerDock() {
  const [state, setState] = useState({ open: false, schema: null, toolName: null, values: {} });
  const [sectionsOpen, setSectionsOpen] = useState({ inputs: true, options: true });

  useEffect(() => {
    const unsub = onParamRequest(({ toolName, schema }) => {
      // Only intercept tools we've migrated. Floating dialog handles the rest.
      const docked = DOCKED_TOOLS.has(toolName);
      if (!docked) return;
      const initial = {};
      for (const f of schema.fields) initial[f.name] = f.default;
      setState({ open: true, schema, toolName, values: initial });
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

  const commit = useCallback(() => {
    setState((prev) => {
      if (!prev.open) return prev;
      // Resolve the underlying ToolParamDialog promise with the dock values.
      resolveOpen(prev.values);
      confirmationBus.clear();
      return { open: false, schema: null, toolName: null, values: {} };
    });
  }, []);

  const cancel = useCallback(() => {
    setState((prev) => {
      if (!prev.open) return prev;
      resolveOpen(null);
      confirmationBus.clear();
      return { open: false, schema: null, toolName: null, values: {} };
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
      let value = raw;
      if (field?.type === 'number') {
        const n = parseFloat(raw);
        value = Number.isFinite(n) ? n : field.default;
      }
      return { ...s, values: { ...s.values, [name]: value } };
    });
  };

  return (
    <aside className="sw-property-dock" data-archdisc-pm-dock={state.toolName}>
      <div className="sw-pm-dock-header">
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
        {state.schema.fields.map((f) => (
          <div key={f.name} className="sw-pm-dock-row">
            <label className="sw-pm-dock-label" title={f.hint || ''}>{f.label}</label>
            <div className="sw-pm-dock-input-wrap">
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
              ) : (
                <input
                  className="sw-pm-dock-input"
                  type="number"
                  step={f.step ?? 'any'}
                  min={f.min}
                  max={f.max}
                  value={state.values[f.name]}
                  onChange={(e) => setField(f.name, e.target.value)}
                  data-field={f.name}
                />
              )}
              {f.unit && <span className="sw-pm-dock-unit">{f.unit}</span>}
            </div>
          </div>
        ))}
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
