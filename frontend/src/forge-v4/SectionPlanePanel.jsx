// PUSH-65 (Slice-33) — Section Plane control PANEL for the live viewport.
//
// Up through PUSH-64 the only UI for the live cutting plane was the
// floating `SectionControl` chip mounted near the workbench rail (Forge-118).
// It worked, but it's a tiny single-row HUD pinned to a particular spot
// in the chrome and is not reachable from the Tools menu — the user has
// no proper *panel* to drive section cuts from. PUSH-65 lights that up.
//
// What this panel adds vs. the legacy HUD:
//   • Right-docked, full-height panel (same dock as MassProps/EntityProps),
//     so it survives ribbon/zoom and never overlaps the geometry.
//   • Reachable through the standard `tools.sectionPlane` menu action +
//     command palette (palette auto-picks new MENU_SPEC entries).
//   • Reads the active body's kernel bounding box via `window.forge.bounds`
//     (or `forge.boundingBox` if older builds expose that alias) and uses
//     that range as the slider min/max for the chosen axis — the offset
//     scrub is *body-aware*, not a hard-coded ±100 mm window.
//   • Publishes the plane to BOTH legacy globals (`window.__forgeSection`
//     for the SectionControl HUD subscribers) AND the new explicit
//     `window.__forgeSectionPlane` channel the spec calls out — so any
//     subsequent panel that needs the current plane state can read it
//     without listening for the bus event.
//   • Fires `forge:section-update` on every state change — the same
//     CustomEvent that ForgeShellV4 already subscribes to in order to
//     pipe sectionPlane through to Viewport.jsx (Forge-118 wiring).
//
// Constraints honoured (PUSH-65 brief):
//   * NO new npm packages, NO new C++ libs — uses React + the existing
//     kernel surface only.
//   * No MVP, no stub — the slider range is computed from real bounds,
//     the panel uses real menu / palette plumbing, the state contract
//     matches the existing forge:section-update consumer in ForgeShellV4.
//   * Surgical edits to Menus.jsx + App.jsx (one new entry + one mount).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

// ────────────── helpers ──────────────

// The body whose bbox feeds the slider range. We prefer the user's
// current selection (so the panel "follows" what they're looking at);
// otherwise we fall through to the last native body in the scene.
function activeNativeBody() {
  if (typeof window === 'undefined') return null;
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  const native = bodies.filter(
    (b) => b && b.kind === 'native' && typeof b.handle === 'number');
  if (native.length === 0) return null;
  const sel = window.__forgeSelection || null;
  if (sel && typeof sel.bodyHandle === 'number') {
    const m = native.find((b) => b.handle === sel.bodyHandle);
    if (m) return m;
  }
  return native[native.length - 1];
}

// Kernel-bound bbox read. Returns { min:[x,y,z], max:[x,y,z] } or null.
// Falls back to body.spec geometry (matches assemblyHierarchy.js's
// localBoundsForBody) when the kernel surface is offline, so the panel
// still shows a sensible slider range on a freshly-seeded scene before
// the kernel has been queried.
export function bodyBounds(body) {
  if (!body || typeof body.handle !== 'number') return null;
  if (typeof window !== 'undefined') {
    const fn = window.forge?.bounds || window.forge?.boundingBox;
    if (typeof fn === 'function') {
      try {
        const b = fn(body.handle);
        if (b && Array.isArray(b.min) && Array.isArray(b.max)
            && b.min.length >= 3 && b.max.length >= 3) {
          return {
            min: [Number(b.min[0]), Number(b.min[1]), Number(b.min[2])],
            max: [Number(b.max[0]), Number(b.max[1]), Number(b.max[2])],
          };
        }
      } catch { /* fall through */ }
    }
  }
  // Synthesise from params if the kernel didn't answer. `solid.box` is
  // the canonical native body used by e2e seeds; width/height/distance
  // ⇒ dx/dy/dz centred on origin in X/Y, rising from z=0 (matches the
  // kernel's makeBox convention).
  const p = body.params || {};
  const w = Number(p.width  ?? p.dx ?? 0);
  const h = Number(p.height ?? p.dy ?? 0);
  const d = Number(p.distance ?? p.depth ?? p.dz ?? 0);
  if (w > 0 && h > 0 && d > 0) {
    return { min: [-w / 2, -h / 2, 0], max: [w / 2, h / 2, d] };
  }
  return null;
}

// Pull the [min,max] for the chosen axis out of a bounds box. Inflates
// by 10 % per side so the user can still scrub the cutting plane fully
// past the body on either end (otherwise the section never "exits").
// Falls back to a symmetric ±100 mm window — the same range the legacy
// SectionControl HUD uses — when no body is in the scene yet.
export function axisRange(bounds, axis) {
  const idx = axis === 'X' ? 0 : axis === 'Y' ? 1 : 2;
  if (!bounds) return { min: -100, max: 100 };
  const lo = bounds.min[idx];
  const hi = bounds.max[idx];
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
    return { min: -100, max: 100 };
  }
  const span = hi - lo;
  const pad  = span * 0.1;
  return { min: lo - pad, max: hi + pad };
}

// Clamp the offset into the current axis range so the slider value never
// drifts outside the slider's own min/max (HTML inputs let you set a
// number out of [min,max], but the UI will then show the thumb pegged
// to the edge — confusing for users).
function clamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

// Single source of truth for the legacy + new globals. The existing
// SectionControl HUD writes `window.__forgeSection`, the spec for PUSH-65
// calls out `window.__forgeSectionPlane` — we write both so neither bus
// drops the truth.
function publish(plane) {
  if (typeof window === 'undefined') return;
  window.__forgeSection = plane;
  window.__forgeSectionPlane = plane;
  window.dispatchEvent(new CustomEvent('forge:section-update', { detail: plane }));
}

// ────────────── styles ──────────────

// Right-docked column. Same shelf as MassProps / Interference / Materials
// (z-index 1330 keeps it above the viewport overlays but below dialogs).
const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 320,
  zIndex: 1330,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 12,
  overflowY: 'auto',
};
const rowStyle = {
  display: 'grid', gridTemplateColumns: '110px 1fr',
  columnGap: 8, rowGap: 4,
  fontFamily: 'var(--forge-mono)', fontSize: 11,
};
const axisBtnStyle = (active) => ({
  flex: 1,
  background: active ? 'var(--forge-accent-mute)' : 'var(--forge-surface)',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)',
  padding: '6px 0',
  cursor: 'pointer',
  fontFamily: 'var(--forge-mono)',
  fontSize: 12,
  fontWeight: active ? 700 : 400,
  borderRadius: 4,
});
const closeBtn = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3,
};

// ────────────── panel ──────────────

export function SectionPlanePanel({ open, onClose }) {
  // On (re-)open: prefer the existing live state if any host (legacy HUD
  // or a prior open of this panel) already published one. The spec calls
  // this out explicitly: "On open, read current sectionPlane via
  // window.__forgeSectionPlane if exposed, else default {enabled:false,
  // axis:'Z', offset:0}".
  const initialPlane = () => {
    if (typeof window !== 'undefined') {
      const live = window.__forgeSectionPlane || window.__forgeSection;
      if (live && typeof live === 'object') {
        return {
          enabled: !!live.enabled,
          axis:    (['X', 'Y', 'Z'].includes(live.axis) ? live.axis : 'Z'),
          offset:  Number.isFinite(Number(live.offset)) ? Number(live.offset) : 0,
        };
      }
    }
    return { enabled: false, axis: 'Z', offset: 0 };
  };

  const [plane, setPlane] = useState(initialPlane);
  const [body,  setBody]  = useState(() => activeNativeBody());

  // When the panel re-opens, snap the in-panel state back to whatever the
  // viewport currently believes (matches MassProps's "fresh on open" feel)
  // and re-resolve the active body so the slider range is for the body the
  // user is actually looking at.
  useEffect(() => {
    if (!open) return undefined;
    setPlane(initialPlane());
    setBody(activeNativeBody());
    const onPick = () => setBody(activeNativeBody());
    const onBodies = () => setBody(activeNativeBody());
    window.addEventListener('forge:selection-changed', onPick);
    window.addEventListener('forge:bodies-changed', onBodies);
    return () => {
      window.removeEventListener('forge:selection-changed', onPick);
      window.removeEventListener('forge:bodies-changed', onBodies);
    };
  }, [open]);

  // Every panel-driven plane mutation fans out to the legacy + new globals
  // AND the forge:section-update bus that the viewport already subscribes
  // to. This is the only place that publishes, so the contract stays
  // single-writer.
  useEffect(() => { publish(plane); }, [plane.enabled, plane.axis, plane.offset]);

  const bounds = useMemo(() => bodyBounds(body), [body, plane.axis]);
  const range  = useMemo(() => axisRange(bounds, plane.axis),
                         [bounds, plane.axis]);

  // When the axis flips, clamp the current offset into the new axis range
  // so the slider thumb isn't pegged. We do this through setPlane so the
  // publish effect re-fires with the corrected value.
  const onAxis = useCallback((axis) => {
    setPlane((p) => {
      const r = axisRange(bodyBounds(activeNativeBody()), axis);
      return { ...p, axis, offset: clamp(p.offset, r.min, r.max) };
    });
  }, []);

  const onEnabled = useCallback((e) => {
    const enabled = !!e?.target?.checked;
    setPlane((p) => ({ ...p, enabled }));
  }, []);

  const onOffset = useCallback((e) => {
    const offset = Number(e?.target?.value);
    if (!Number.isFinite(offset)) return;
    setPlane((p) => ({ ...p, offset }));
  }, []);

  // Snap the offset to the bbox midpoint of the active axis — handy when
  // the user wants the section to cut "right through the middle" without
  // hunting on the slider.
  const onCenter = useCallback(() => {
    const r = axisRange(bodyBounds(activeNativeBody()), plane.axis);
    setPlane((p) => ({ ...p, offset: (r.min + r.max) / 2 }));
  }, [plane.axis]);

  if (!open) return null;

  // Step size scales with axis span: 1 % of the slider width keeps the
  // scrub feel consistent across a 1 mm pin and a 1000 mm I-beam, with a
  // floor of 0.1 mm so the user never lands on un-renderable jitter.
  const sliderSpan = Math.max(range.max - range.min, 1);
  const sliderStep = Math.max(sliderSpan / 200, 0.1);

  return (
    <div style={panelStyle} data-testid="forge-section-plane-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between',
                       alignItems: 'center', gap: 8 }}>
        <strong>Section Plane</strong>
        <button onClick={onClose}
                data-testid="forge-section-plane-close"
                style={closeBtn}>×</button>
      </header>

      <div data-testid="forge-section-plane-body"
           style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.4 }}>
        Active body:{' '}
        <strong>
          {body ? (body.name || body.id || `handle ${body.handle}`)
                : 'None — slider uses ±100 mm fallback'}
        </strong>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox"
               checked={!!plane.enabled}
               onChange={onEnabled}
               data-testid="forge-section-plane-enabled" />
        <span>Section <strong>{plane.enabled ? 'ON' : 'OFF'}</strong></span>
      </label>

      <fieldset data-testid="forge-section-plane-axis"
                style={{ border: '1px solid var(--forge-rail-edge)',
                         padding: 'var(--forge-space-2)',
                         borderRadius: 4 }}>
        <legend style={{ padding: '0 4px', color: 'var(--forge-ink-mute)' }}>
          Cutting axis
        </legend>
        <div role="radiogroup"
             style={{ display: 'flex', gap: 4 }}>
          {['X', 'Y', 'Z'].map((axis) => (
            <label key={axis}
                   style={{ flex: 1, display: 'flex', alignItems: 'center',
                            gap: 4, cursor: 'pointer' }}>
              <input type="radio"
                     name="forge-section-plane-axis-radio"
                     value={axis}
                     checked={plane.axis === axis}
                     onChange={() => onAxis(axis)}
                     data-testid={`forge-section-plane-axis-${axis}`}
                     data-section-axis={axis}
                     style={{ marginRight: 4 }} />
              <button type="button"
                      style={axisBtnStyle(plane.axis === axis)}
                      onClick={() => onAxis(axis)}
                      data-section-axis-btn={axis}
                      tabIndex={-1}>
                {axis}
              </button>
            </label>
          ))}
        </div>
      </fieldset>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ color: 'var(--forge-ink-mute)' }}>
          Offset along <strong>{plane.axis}</strong> (mm)
        </span>
        <input type="range"
               min={range.min}
               max={range.max}
               step={sliderStep}
               value={clamp(plane.offset, range.min, range.max)}
               onChange={onOffset}
               data-testid="forge-section-plane-offset"
               data-offset-mm={plane.offset}
               data-range-min={range.min}
               data-range-max={range.max} />
        <div style={{ display: 'flex', justifyContent: 'space-between',
                      fontFamily: 'var(--forge-mono)', fontSize: 10,
                      color: 'var(--forge-ink-mute)' }}>
          <span>{range.min.toFixed(2)} mm</span>
          <button type="button"
                  onClick={onCenter}
                  data-testid="forge-section-plane-center"
                  style={{ background: 'transparent',
                           border: '1px solid var(--forge-rail-edge)',
                           color: 'var(--forge-ink-mute)',
                           cursor: 'pointer', fontSize: 10,
                           padding: '1px 6px', borderRadius: 3 }}>
            Center
          </button>
          <span>{range.max.toFixed(2)} mm</span>
        </div>
      </label>

      <section data-testid="forge-section-plane-readout" style={rowStyle}>
        <div style={{ color: 'var(--forge-ink-mute)' }}>State</div>
        <div data-row="state" data-testid="forge-section-plane-state">
          {plane.enabled ? 'enabled' : 'disabled'}
        </div>
        <div style={{ color: 'var(--forge-ink-mute)' }}>Axis</div>
        <div data-row="axis" data-testid="forge-section-plane-axis-readout">
          {plane.axis}
        </div>
        <div style={{ color: 'var(--forge-ink-mute)' }}>Offset</div>
        <div data-row="offset"
             data-testid="forge-section-plane-offset-readout"
             data-offset-mm={plane.offset}>
          {Number(plane.offset).toFixed(3)} mm
        </div>
        <div style={{ color: 'var(--forge-ink-mute)' }}>Range</div>
        <div data-row="range"
             data-testid="forge-section-plane-range-readout">
          [{range.min.toFixed(2)}, {range.max.toFixed(2)}] mm
        </div>
      </section>
    </div>
  );
}

// ────────────── host ──────────────

export function SectionPlanePanelHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    // Imperative entry points for plugins / Archie. The legacy
    // __forgeOpenSection from the HUD remains — we add a distinct pair
    // so the two surfaces never trample each other.
    window.__forgeOpenSectionPanel  = () => setOpen(true);
    window.__forgeCloseSectionPanel = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.sectionPlane') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <SectionPlanePanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default SectionPlanePanel;
