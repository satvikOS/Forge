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

import { useEffect, useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, Check, X, Maximize2, Crop,
         Scissors, Box, Eye, Square } from 'lucide-react';
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
    <div className={`sw-sketch-state ${cls}`}
         data-archdisc-sketch-state={state.state}
         data-archdisc-sketch-dof={String(state.signedDof)}>
      <span className="sw-sketch-state-dot" />
      <span className="sw-sketch-state-label">{label}</span>
      <span className="sw-sketch-state-dof">DoF: {state.signedDof}</span>
    </div>
  );
}
