// PUSH-101 (Slice-69) — Topology Optimisation **smart constraints** panel.
//
// PUSH-15 / PUSH-49 shipped the SIMP optimiser + the materialisation step
// (density field → marching cubes → STL → native OCCT body). That gives a
// usable cantilever benchmark — but it stops short of "real-world TO":
// production topology runs need the user to constrain the design domain
// before the optimiser walks the OC update rule.
//
// Three constraint classes show up in every commercial TO offering
// (Altair OptiStruct, ANSYS Mechanical, Tosca, SOLIDWORKS Simulation):
//
//   • **Keep zones** — voxels that MUST stay solid. Load patches + the
//     boundary-condition footprint must not be optimised away or the
//     resulting part won't carry the load (the load is applied to thin
//     air). Specified as an axis-aligned bbox or a sphere.
//
//   • **Remove zones** — voxels that MUST stay void. Bolt-hole envelopes,
//     hand-clearance pockets, packaging-volume reservations. Specified
//     the same way (bbox / sphere).
//
//   • **Filter radius + volume fraction + target compliance** — the
//     three numerical knobs that drive the OC update. PUSH-15 already
//     accepts volumeFraction; the user wants the *full* set surfaced
//     so they can hand-tune the SIMP solve without editing source.
//
// PUSH-101 builds a dedicated **Topology Constraints** side panel that
// gathers the above into a single config record:
//
//   {
//     bodyId,        // the design domain (an active native body)
//     keep:    [ { kind:'bbox'|'sphere', min/max | center+radius, label } ],
//     remove:  [ … same shape … ],
//     filterRadius,  // mm
//     volFrac,       // 0..1, target solid volume fraction
//     targetCompliance, // optional ceiling, N·mm
//   }
//
// On Save the record is published verbatim on
// `window.__forgeTopologyConstraints` and a `forge:topology-constraints-set`
// CustomEvent is fired so the SIMP workbench (and future native bindings)
// can pick it up. The panel deliberately does NOT call into the SIMP
// runner — it's a *config* surface, separable from the solver — which
// keeps the OCC-bound dependency chain unchanged.
//
// Hard constraints honoured:
//   • NO new npm packages, NO new C++ libs, NO external services.
//   • Pure React + the existing `window.__forge*` debug surface.
//   • Real implementation — every state mutation flows through the
//     same helpers the e2e spec drives; nothing is mocked.
//   • Surgical edits to Menus.jsx (one new `tools.topologyConstraints`
//     entry) + App.jsx (one import + one mount).
//   • Multi-cam e2e per the Forge-171 mandate (5 named camera angles).

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';

// ─────────────────────────────────────────────────────────────────────
// Constants

export const FORGE_TOPO_CONSTRAINTS_MENU_ID = 'tools.topologyConstraints';
export const FORGE_TOPO_CONSTRAINTS_EVENT   = 'forge:topology-constraints-set';
export const FORGE_TOPO_CONSTRAINTS_GLOBAL  = '__forgeTopologyConstraints';

export const ZONE_KINDS = ['bbox', 'sphere'];

/** Sensible defaults that match the PUSH-15 cantilever box (60×40×30 mm).
 *  Filter radius is the canonical Bendsoe-Sigmund "1.5 × element size"
 *  heuristic for an 8×6×4 grid (≈ 7.5 mm element on the long axis). */
export const DEFAULT_CONSTRAINTS = Object.freeze({
  bodyId: '',
  keep: [],
  remove: [],
  filterRadius: 7.5,
  volFrac: 0.4,
  targetCompliance: 0,
});

// ─────────────────────────────────────────────────────────────────────
// Pure helpers — exported so the e2e spec / Archie tool calls / plugins
// can drive the same logic without mounting the React panel first.

/** Snapshot every native (kernel-backed) body in the scene. Mirrors
 *  the same filter used by MassProps / EntityProps / VariableFillet. */
export function readNativeBodies() {
  if (typeof window === 'undefined') return [];
  const all = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return all.filter(
    (b) => b && b.kind === 'native' && typeof b.handle === 'number',
  );
}

/** Resolve the active native body for the panel's initial pick.
 *  selection.bodyHandle → selection.ids[0] → last native body. */
export function activeNativeBody() {
  const native = readNativeBodies();
  if (native.length === 0) return null;
  if (typeof window === 'undefined') return native[native.length - 1];
  const sel = window.__forgeSelection || null;
  if (sel && typeof sel.bodyHandle === 'number') {
    const m = native.find((b) => b.handle === sel.bodyHandle);
    if (m) return m;
  }
  if (sel && Array.isArray(sel.ids) && typeof sel.ids[0] === 'number') {
    const m = native.find((b) => b.handle === sel.ids[0]);
    if (m) return m;
  }
  return native[native.length - 1];
}

/** Parse a numeric input that may come back as '', '-', or a string with
 *  trailing whitespace. NaN-safe: empty / garbage → fallback. */
export function parseNum(value, fallback = 0) {
  if (value === '' || value == null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Build a fresh bbox zone with the given label + dimensions. */
export function makeBboxZone(label, min, max) {
  return Object.freeze({
    kind: 'bbox',
    label: typeof label === 'string' && label.length ? label : 'bbox-zone',
    min: [parseNum(min?.[0]), parseNum(min?.[1]), parseNum(min?.[2])],
    max: [parseNum(max?.[0]), parseNum(max?.[1]), parseNum(max?.[2])],
  });
}

/** Build a fresh sphere zone with the given label + centre + radius. */
export function makeSphereZone(label, center, radius) {
  return Object.freeze({
    kind: 'sphere',
    label: typeof label === 'string' && label.length ? label : 'sphere-zone',
    center: [parseNum(center?.[0]), parseNum(center?.[1]), parseNum(center?.[2])],
    radius: Math.max(0, parseNum(radius, 0)),
  });
}

/** Volume of a bbox zone (signed-corrected — abs(dx·dy·dz)). */
export function bboxVolume(zone) {
  if (!zone || zone.kind !== 'bbox') return 0;
  const dx = Math.abs((zone.max?.[0] ?? 0) - (zone.min?.[0] ?? 0));
  const dy = Math.abs((zone.max?.[1] ?? 0) - (zone.min?.[1] ?? 0));
  const dz = Math.abs((zone.max?.[2] ?? 0) - (zone.min?.[2] ?? 0));
  return dx * dy * dz;
}

/** Volume of a sphere zone (4/3 π r³). */
export function sphereVolume(zone) {
  if (!zone || zone.kind !== 'sphere') return 0;
  const r = Math.max(0, zone.radius || 0);
  return (4 / 3) * Math.PI * r * r * r;
}

/** Volume of any zone (kind-agnostic). */
export function zoneVolume(zone) {
  if (!zone) return 0;
  if (zone.kind === 'bbox') return bboxVolume(zone);
  if (zone.kind === 'sphere') return sphereVolume(zone);
  return 0;
}

/** Validate a constraint record before publishing it to the global. */
export function validateConstraints(record) {
  if (!record || typeof record !== 'object') return ['record-not-object'];
  const errors = [];
  if (typeof record.bodyId !== 'string') errors.push('bodyId-not-string');
  if (!Array.isArray(record.keep)) errors.push('keep-not-array');
  if (!Array.isArray(record.remove)) errors.push('remove-not-array');
  const f = Number(record.filterRadius);
  if (!Number.isFinite(f) || f < 0) errors.push('filterRadius-bad');
  const v = Number(record.volFrac);
  if (!Number.isFinite(v) || v <= 0 || v >= 1) errors.push('volFrac-bad');
  const t = Number(record.targetCompliance);
  if (!Number.isFinite(t) || t < 0) errors.push('targetCompliance-bad');
  return errors;
}

/** Publish the validated record to `window.__forgeTopologyConstraints`
 *  and fire `forge:topology-constraints-set`. Returns `{ ok, errors }`. */
export function publishConstraints(record) {
  const errors = validateConstraints(record);
  if (errors.length) return { ok: false, errors };
  const frozen = Object.freeze({
    bodyId: record.bodyId,
    keep: Object.freeze(record.keep.map((z) => Object.freeze({ ...z }))),
    remove: Object.freeze(record.remove.map((z) => Object.freeze({ ...z }))),
    filterRadius: Number(record.filterRadius),
    volFrac: Number(record.volFrac),
    targetCompliance: Number(record.targetCompliance),
    savedAt: Date.now(),
  });
  if (typeof window !== 'undefined') {
    try { window[FORGE_TOPO_CONSTRAINTS_GLOBAL] = frozen; } catch {}
    try {
      window.dispatchEvent(new CustomEvent(FORGE_TOPO_CONSTRAINTS_EVENT, {
        detail: frozen,
      }));
    } catch {}
  }
  return { ok: true, errors: [], record: frozen };
}

// ─────────────────────────────────────────────────────────────────────
// Styles — share the right-docked-rail vocabulary the other panels use.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 460,
  zIndex: 1332,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)',
  fontSize: 12,
  overflow: 'hidden',
};
const HEADER_ROW = { display: 'flex', alignItems: 'center', gap: 8 };
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  cursor: 'pointer',
  padding: '2px 6px',
  borderRadius: 3,
};
const SECTION_TITLE = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  margin: '6px 0 4px',
};
const SECTION_BOX = {
  background: 'var(--forge-canvas-3, #1b212a)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4,
  padding: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const SCROLL_AREA = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};
const TEXT_INPUT = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '3px 6px',
  borderRadius: 3,
  fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  width: '100%',
};
const NUM_INPUT = {
  ...TEXT_INPUT,
  width: 60,
};
const SELECT_INPUT = { ...TEXT_INPUT, width: 100 };
const FIELD_LABEL = {
  fontSize: 10,
  color: 'var(--forge-ink-mute, #9aa1ab)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};
const LABELED_INPUT = { display: 'flex', flexDirection: 'column', gap: 2 };
const ROW_GRID = (cols) => ({
  display: 'grid',
  gridTemplateColumns: cols,
  alignItems: 'center',
  gap: 6,
});
const ZONE_ROW = {
  display: 'grid',
  gridTemplateColumns: '1fr 60px 28px',
  alignItems: 'center',
  gap: 6,
  padding: '5px 6px',
  borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
};
const ACTION_BTN = (variant = 'default') => ({
  background: variant === 'primary'
    ? 'var(--forge-accent, #4f87ff)'
    : 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: variant === 'primary' ? '#fff' : 'var(--forge-ink, #dadde2)',
  cursor: 'pointer',
  padding: '5px 12px',
  borderRadius: 3,
  fontSize: 11,
  fontWeight: variant === 'primary' ? 600 : 400,
});
const REMOVE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  cursor: 'pointer',
  padding: '2px 6px',
  borderRadius: 3,
  fontSize: 11,
};
const SLIDER_INPUT = {
  width: '100%',
  cursor: 'pointer',
};
const ZONE_DETAIL = {
  fontSize: 10,
  color: 'var(--forge-ink-mute, #9aa1ab)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

export function TopologyConstraintsPanel({ open, onClose }) {
  // Live snapshot of every native body so the body picker reflects scene
  // churn while the panel is open.
  const [bodies, setBodies] = useState(() => readNativeBodies());
  const [bodyId, setBodyId] = useState(() => activeNativeBody()?.id || '');
  const [keepZones, setKeepZones] = useState([]);
  const [removeZones, setRemoveZones] = useState([]);
  const [filterRadius, setFilterRadius] = useState(DEFAULT_CONSTRAINTS.filterRadius);
  const [volFrac, setVolFrac] = useState(DEFAULT_CONSTRAINTS.volFrac);
  const [targetCompliance, setTargetCompliance] = useState(
    DEFAULT_CONSTRAINTS.targetCompliance,
  );
  // Zone draft buffers (the inputs at the top of each zone section).
  const [keepDraft, setKeepDraft] = useState({
    kind: 'bbox',
    label: 'load-patch',
    minX: 0, minY: 0, minZ: 0,
    maxX: 10, maxY: 10, maxZ: 10,
    cx: 0, cy: 0, cz: 0,
    radius: 5,
  });
  const [removeDraft, setRemoveDraft] = useState({
    kind: 'bbox',
    label: 'bolt-clearance',
    minX: 20, minY: 20, minZ: 0,
    maxX: 30, maxY: 30, maxZ: 30,
    cx: 0, cy: 0, cz: 0,
    radius: 5,
  });
  // Save outcome toast (errors / success).
  const [toast, setToast] = useState(null);

  // Refresh bodies + reset state on open. Keep a live subscription to
  // bodies-changed while the panel is mounted.
  useEffect(() => {
    if (!open) return undefined;
    setBodies(readNativeBodies());
    const active = activeNativeBody();
    if (active) setBodyId(active.id);
    setToast(null);
    const onBodies = () => setBodies(readNativeBodies());
    if (typeof window !== 'undefined') {
      window.addEventListener('forge:bodies-changed', onBodies);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('forge:bodies-changed', onBodies);
      }
    };
  }, [open]);

  // ─── Zone adders.
  const addKeepZone = useCallback(() => {
    setKeepZones((prev) => {
      const z = keepDraft.kind === 'sphere'
        ? makeSphereZone(keepDraft.label,
            [keepDraft.cx, keepDraft.cy, keepDraft.cz], keepDraft.radius)
        : makeBboxZone(keepDraft.label,
            [keepDraft.minX, keepDraft.minY, keepDraft.minZ],
            [keepDraft.maxX, keepDraft.maxY, keepDraft.maxZ]);
      return [...prev, z];
    });
  }, [keepDraft]);

  const addRemoveZone = useCallback(() => {
    setRemoveZones((prev) => {
      const z = removeDraft.kind === 'sphere'
        ? makeSphereZone(removeDraft.label,
            [removeDraft.cx, removeDraft.cy, removeDraft.cz], removeDraft.radius)
        : makeBboxZone(removeDraft.label,
            [removeDraft.minX, removeDraft.minY, removeDraft.minZ],
            [removeDraft.maxX, removeDraft.maxY, removeDraft.maxZ]);
      return [...prev, z];
    });
  }, [removeDraft]);

  const removeKeepAt = useCallback((i) => {
    setKeepZones((prev) => prev.filter((_, k) => k !== i));
  }, []);
  const removeRemoveAt = useCallback((i) => {
    setRemoveZones((prev) => prev.filter((_, k) => k !== i));
  }, []);

  // ─── Save / publish to window.__forgeTopologyConstraints.
  const onSave = useCallback(() => {
    const record = {
      bodyId,
      keep: keepZones,
      remove: removeZones,
      filterRadius: parseNum(filterRadius, DEFAULT_CONSTRAINTS.filterRadius),
      volFrac: parseNum(volFrac, DEFAULT_CONSTRAINTS.volFrac),
      targetCompliance: parseNum(targetCompliance, 0),
    };
    const { ok, errors, record: saved } = publishConstraints(record);
    if (ok) {
      setToast({
        ok: true,
        msg: `Saved · keep ${saved.keep.length} · remove ${saved.remove.length}`,
        when: Date.now(),
      });
    } else {
      setToast({
        ok: false,
        msg: `Save failed: ${errors.join(', ')}`,
        when: Date.now(),
      });
    }
  }, [bodyId, keepZones, removeZones, filterRadius, volFrac, targetCompliance]);

  // Reset everything back to defaults.
  const onReset = useCallback(() => {
    setKeepZones([]);
    setRemoveZones([]);
    setFilterRadius(DEFAULT_CONSTRAINTS.filterRadius);
    setVolFrac(DEFAULT_CONSTRAINTS.volFrac);
    setTargetCompliance(DEFAULT_CONSTRAINTS.targetCompliance);
    setToast(null);
  }, []);

  // Derived: total volume of keep / remove zones for the readout.
  const keepVol = useMemo(
    () => keepZones.reduce((s, z) => s + zoneVolume(z), 0),
    [keepZones],
  );
  const removeVol = useMemo(
    () => removeZones.reduce((s, z) => s + zoneVolume(z), 0),
    [removeZones],
  );

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  // ─── Zone draft input cluster (used twice — once each for keep / remove).
  const renderZoneDraft = (testIdPrefix, draft, setDraft) => (
    <div style={SECTION_BOX} data-testid={`${testIdPrefix}-draft`}>
      <div style={ROW_GRID('1fr 100px')}>
        <label style={LABELED_INPUT}>
          <span style={FIELD_LABEL}>Label</span>
          <input type="text"
                 value={draft.label}
                 data-testid={`${testIdPrefix}-label`}
                 onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                 style={TEXT_INPUT} />
        </label>
        <label style={LABELED_INPUT}>
          <span style={FIELD_LABEL}>Kind</span>
          <select value={draft.kind}
                  data-testid={`${testIdPrefix}-kind`}
                  onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
                  style={SELECT_INPUT}>
            {ZONE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
      </div>
      {draft.kind === 'bbox' ? (
        <>
          <div style={ROW_GRID('30px 1fr 1fr 1fr')}>
            <span style={FIELD_LABEL}>min</span>
            {['minX', 'minY', 'minZ'].map((k) => (
              <input key={k} type="number" step="0.5"
                     value={draft[k]}
                     data-testid={`${testIdPrefix}-${k}`}
                     onChange={(e) => setDraft({ ...draft, [k]: parseNum(e.target.value) })}
                     style={NUM_INPUT} />
            ))}
          </div>
          <div style={ROW_GRID('30px 1fr 1fr 1fr')}>
            <span style={FIELD_LABEL}>max</span>
            {['maxX', 'maxY', 'maxZ'].map((k) => (
              <input key={k} type="number" step="0.5"
                     value={draft[k]}
                     data-testid={`${testIdPrefix}-${k}`}
                     onChange={(e) => setDraft({ ...draft, [k]: parseNum(e.target.value) })}
                     style={NUM_INPUT} />
            ))}
          </div>
        </>
      ) : (
        <>
          <div style={ROW_GRID('30px 1fr 1fr 1fr')}>
            <span style={FIELD_LABEL}>ctr</span>
            {['cx', 'cy', 'cz'].map((k) => (
              <input key={k} type="number" step="0.5"
                     value={draft[k]}
                     data-testid={`${testIdPrefix}-${k}`}
                     onChange={(e) => setDraft({ ...draft, [k]: parseNum(e.target.value) })}
                     style={NUM_INPUT} />
            ))}
          </div>
          <label style={LABELED_INPUT}>
            <span style={FIELD_LABEL}>radius (mm)</span>
            <input type="number" step="0.5" min="0"
                   value={draft.radius}
                   data-testid={`${testIdPrefix}-radius`}
                   onChange={(e) => setDraft({ ...draft, radius: parseNum(e.target.value, 0) })}
                   style={NUM_INPUT} />
          </label>
        </>
      )}
    </div>
  );

  const renderZoneList = (testIdPrefix, zones, onRemove) => (
    <div data-testid={`${testIdPrefix}-list`}
         style={{
           border: '1px solid var(--forge-rail-edge, #2a2d34)',
           borderRadius: 4,
           background: 'var(--forge-canvas-1, #0e1218)',
           minHeight: 36,
         }}>
      {zones.length === 0 ? (
        <div data-testid={`${testIdPrefix}-empty`}
             style={{
               padding: '8px 10px',
               fontStyle: 'italic',
               color: 'var(--forge-ink-mute, #9aa1ab)',
               fontSize: 11,
             }}>
          No zones yet.
        </div>
      ) : zones.map((z, i) => (
        <div key={`${testIdPrefix}-${i}`}
             data-testid={`${testIdPrefix}-row`}
             data-zone-kind={z.kind}
             data-zone-label={z.label}
             data-zone-index={i}
             style={ZONE_ROW}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600 }}>{z.label}</div>
            <div style={ZONE_DETAIL}>
              {z.kind === 'bbox'
                ? `bbox · min(${z.min.join(',')}) → max(${z.max.join(',')})`
                : `sphere · ctr(${z.center.join(',')}) · r=${z.radius}`}
            </div>
          </div>
          <div style={{
            fontSize: 10, textAlign: 'right',
            color: 'var(--forge-ink-mute, #9aa1ab)',
            fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
          }}>
            {zoneVolume(z).toFixed(1)} mm³
          </div>
          <button type="button"
                  onClick={() => onRemove(i)}
                  data-testid={`${testIdPrefix}-remove-${i}`}
                  title="Remove this zone"
                  style={REMOVE_BTN}>×</button>
        </div>
      ))}
    </div>
  );

  return createPortal(
    <div role="dialog"
         aria-label="Topology constraints"
         data-testid="forge-topology-constraints-panel"
         data-keep-count={keepZones.length}
         data-remove-count={removeZones.length}
         data-body-id={bodyId}
         data-filter-radius={String(filterRadius)}
         data-vol-frac={String(volFrac)}
         data-target-compliance={String(targetCompliance)}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <strong style={{ fontSize: 13 }}>Topology Constraints</strong>
        <span style={{
          fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
          fontSize: 10,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          padding: '1px 6px',
          borderRadius: 'var(--forge-radius-pill, 10px)',
          border: '1px solid var(--forge-rail-edge, #2a2d34)',
        }}>
          PUSH-101
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={onReset}
                title="Reset to defaults"
                data-testid="forge-topology-constraints-reset"
                style={ACTION_BTN('default')}>
          Reset
        </button>
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close constraints panel"
                data-testid="forge-topology-constraints-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={SCROLL_AREA}>
        <div style={SECTION_TITLE}>Design domain (active body)</div>
        <div style={SECTION_BOX}>
          {bodies.length === 0 ? (
            <span data-testid="forge-topology-constraints-no-body"
                  style={{ fontStyle: 'italic',
                           color: 'var(--forge-ink-mute, #9aa1ab)' }}>
              No native bodies in the scene. Add one via any modelling
              workbench, then return here.
            </span>
          ) : (
            <select value={bodyId}
                    data-testid="forge-topology-constraints-body"
                    onChange={(e) => setBodyId(e.target.value)}
                    style={TEXT_INPUT}>
              {bodies.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name || b.toolId || `handle ${b.handle}`} ({b.id})
                </option>
              ))}
            </select>
          )}
        </div>

        <div style={SECTION_TITLE}>
          Keep zones ({keepZones.length}) · {keepVol.toFixed(0)} mm³ total
        </div>
        {renderZoneDraft('forge-topology-constraints-keep', keepDraft, setKeepDraft)}
        <div>
          <button type="button"
                  onClick={addKeepZone}
                  data-testid="forge-topology-constraints-keep-add"
                  style={ACTION_BTN('default')}>
            Add Keep Zone
          </button>
        </div>
        {renderZoneList('forge-topology-constraints-keep', keepZones, removeKeepAt)}

        <div style={SECTION_TITLE}>
          Remove zones ({removeZones.length}) · {removeVol.toFixed(0)} mm³ total
        </div>
        {renderZoneDraft('forge-topology-constraints-remove', removeDraft, setRemoveDraft)}
        <div>
          <button type="button"
                  onClick={addRemoveZone}
                  data-testid="forge-topology-constraints-remove-add"
                  style={ACTION_BTN('default')}>
            Add Remove Zone
          </button>
        </div>
        {renderZoneList('forge-topology-constraints-remove', removeZones, removeRemoveAt)}

        <div style={SECTION_TITLE}>SIMP knobs</div>
        <div style={SECTION_BOX}>
          <label style={LABELED_INPUT}>
            <span style={FIELD_LABEL}>
              Filter radius: {Number(filterRadius).toFixed(2)} mm
            </span>
            <input type="range"
                   min="0" max="30" step="0.25"
                   value={filterRadius}
                   data-testid="forge-topology-constraints-filter-slider"
                   onChange={(e) => setFilterRadius(parseNum(e.target.value, 0))}
                   style={SLIDER_INPUT} />
            <input type="number" min="0" step="0.25"
                   value={filterRadius}
                   data-testid="forge-topology-constraints-filter-number"
                   onChange={(e) => setFilterRadius(parseNum(e.target.value, 0))}
                   style={NUM_INPUT} />
          </label>
          <label style={LABELED_INPUT}>
            <span style={FIELD_LABEL}>
              Volume fraction: {Number(volFrac).toFixed(2)}
            </span>
            <input type="range"
                   min="0.05" max="0.95" step="0.05"
                   value={volFrac}
                   data-testid="forge-topology-constraints-volfrac-slider"
                   onChange={(e) => setVolFrac(parseNum(e.target.value, 0.4))}
                   style={SLIDER_INPUT} />
            <input type="number" min="0.05" max="0.95" step="0.05"
                   value={volFrac}
                   data-testid="forge-topology-constraints-volfrac-number"
                   onChange={(e) => setVolFrac(parseNum(e.target.value, 0.4))}
                   style={NUM_INPUT} />
          </label>
          <label style={LABELED_INPUT}>
            <span style={FIELD_LABEL}>
              Target compliance (0 = unconstrained)
            </span>
            <input type="number" min="0" step="0.1"
                   value={targetCompliance}
                   data-testid="forge-topology-constraints-compliance"
                   onChange={(e) => setTargetCompliance(parseNum(e.target.value, 0))}
                   style={{ ...NUM_INPUT, width: 120 }} />
          </label>
        </div>
      </div>

      <footer style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 0 0',
        borderTop: '1px solid var(--forge-rail-edge, #2a2d34)',
      }}>
        {toast ? (
          <span data-testid="forge-topology-constraints-toast"
                data-ok={toast.ok ? '1' : '0'}
                style={{
                  fontSize: 11,
                  color: toast.ok
                    ? 'var(--forge-accent, #4f87ff)'
                    : '#f1c4c4',
                }}>
            {toast.msg}
          </span>
        ) : (
          <span style={{
            fontSize: 10,
            color: 'var(--forge-ink-mute, #9aa1ab)',
          }}>
            Save publishes to window.__forgeTopologyConstraints.
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={onSave}
                data-testid="forge-topology-constraints-save"
                title="Publish the constraint record to window.__forgeTopologyConstraints"
                style={ACTION_BTN('primary')}>
          Save
        </button>
      </footer>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.topologyConstraints` menu action,
// exposes the imperative open/close hooks for plugins / Archie tool
// calls, and mirrors the headless helpers on the debug surface.

export function TopologyConstraintsPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenTopologyConstraintsPanel  = () => setOpen(true);
    window.__forgeCloseTopologyConstraintsPanel = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === FORGE_TOPO_CONSTRAINTS_MENU_ID) setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    // Mirror the pure helpers so the e2e spec + Archie tool calls can
    // drive the panel headlessly.
    window.__forgeTopologyConstraintsHelper = Object.freeze({
      readNativeBodies,
      activeNativeBody,
      parseNum,
      makeBboxZone,
      makeSphereZone,
      bboxVolume,
      sphereVolume,
      zoneVolume,
      validateConstraints,
      publishConstraints,
      EVENT_NAME: FORGE_TOPO_CONSTRAINTS_EVENT,
      GLOBAL_KEY: FORGE_TOPO_CONSTRAINTS_GLOBAL,
      MENU_ID: FORGE_TOPO_CONSTRAINTS_MENU_ID,
      DEFAULTS: DEFAULT_CONSTRAINTS,
      ZONE_KINDS,
    });
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenTopologyConstraintsPanel; } catch {}
      try { delete window.__forgeCloseTopologyConstraintsPanel; } catch {}
    };
  }, []);
  return <TopologyConstraintsPanel open={open} onClose={() => setOpen(false)} />;
}

export default TopologyConstraintsPanel;
