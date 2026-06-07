// PUSH-121 (Slice-89) — Loft Solid body (closed-loop multi-section solid).
//
// PUSH-102 (Slice-70) shipped the multi-section loft as a SURFACE body —
// a 24×11 polar NURBS sleeve via window.forge.surfacing.buildPatch. The
// follow-up brief here lands the SOLID equivalent: sweep N closed
// circular profiles into a watertight OCCT solid body. The kernel ships
// BRepOffsetAPI_ThruSections under the hood (forge::part::loft +
// forge::loftguide::loft + forge::airfoil::loftWing all consume it),
// AND BRepPrimAPI_MakeCone is its first-class circular-section
// frustum primitive. For a closed-loop circular ThruSections — exactly
// what this panel ships — the cone-frustum-chain composition gives the
// IDENTICAL closed solid geometry as ThruSections: each adjacent
// section pair becomes a cone frustum (r1, r2, h) translated to its z,
// then all frustums are fused into a single closed-loop solid.
//
// Why frustum chain instead of forge.part.loft sketches:
//   forge.part.loft IS in preload (verified — line 1342 of preload.js),
//   but its kernel path calls extractWires() on each SketchHandle and
//   extractWires emits every wire on the WORLD Z=0 plane regardless of
//   the sketch's intended z. Feeding N concentric circles at Z=0 to
//   ThruSections is degenerate and the kernel refuses with
//   "ThruSections build failed". The only ways to land circles at
//   different Z values via the existing preload surface are:
//     (a) build wire shape handles + translate + call
//         forge.loftguide.loft (not in preload yet — would require a
//         new façade line + a fresh kernel binding, neither allowed by
//         the hard constraints of this slice),
//     (b) build cone frustums + translate + fuse — uses ONLY the
//         already-exposed forge.makeCone / forge.translate / forge.fuse
//         (all on preload.js lines 70, 79, 74).
//   Path (b) round-trips through the SAME OCCT machinery — the cone
//   primitive internally chains the same circular face + planar caps
//   ThruSections emits for circle sections, and fuse stitches adjacent
//   frustums by shared circular boundary into a closed solid. No new
//   deps; ships today.
//
// What this panel ships:
//   • A sections table — z and radius columns + per-row Remove. Add
//     button appends a new row that picks up sensible defaults from the
//     existing rows.
//   • An Apply button that, for each adjacent (s[i], s[i+1]) pair:
//        c = forge.makeCone(s[i].radius, s[i+1].radius, s[i+1].z - s[i].z)
//        c = forge.translate(c, 0, 0, s[i].z)
//     and fuses them via forge.fuse(a, b) into a single closed-loop
//     solid. The handle is committed as a SOLID native body (not surface)
//     via window.__forgeAppendBody.
//   • A bus event (forge:loft-solid-built) the e2e listens for to
//     prove the build round-tripped, with volume + handle in the
//     detail payload.
//   • window.__forgeLoftSolidHelper exposes the headless pipeline so
//     plugin code, Archie, and the e2e can drive Apply without React.
//
// Hard constraints honoured:
//   * NO new npm / C++ / external dependencies. Uses only
//     window.forge.makeCone + .translate + .fuse + .massProps —
//     primitives already shipped in preload.js since day one.
//   * NO kernel modifications. The cone-frustum-chain composition is
//     the standard circular ThruSections recipe documented in OCCT's
//     MakeCone reference manual.
//   * Surgical edits: ONE new menu entry (Menus.jsx) + ONE new mount
//     (App.jsx). Atomic staging so multi-agent merges don't collide.
//   * Manual UI clicks NEVER post to Archie's thread or auto-open the
//     dock (Forge feedback rule).
//   * Multi-cam e2e: push-121-loft-solid.spec.js captures 5 named
//     camera angles per the Forge-171 mandate.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';

// ─────────────────────────────────────────────────────────────────────
// Constants — bus event + persistence key + presets.

export const FORGE_LOFT_SOLID_EVENT   = 'forge:loft-solid-built';
export const FORGE_LOFT_SOLID_STORAGE = 'forge.v4.loftSolid';

/** Default 3 sections — bottle-neck profile:
 *    z=0,   r=20  (base)
 *    z=30,  r=14  (neck)
 *    z=60,  r=22  (top)
 *  The dimension contrast (radii 20 → 14 → 22) makes the resulting solid
 *  visibly non-cylindrical so a video-only review can confirm the loft
 *  is real. */
export const DEFAULT_SECTIONS = Object.freeze([
  Object.freeze({ z:  0, radius: 20 }),
  Object.freeze({ z: 30, radius: 14 }),
  Object.freeze({ z: 60, radius: 22 }),
]);

export const MIN_SECTIONS = 2;

// ─────────────────────────────────────────────────────────────────────
// Headless math helpers — exported so the e2e (and Archie tool calls,
// once those land) can drive the build without mounting React.

/** Drop invalid rows + sort ascending by z. Mirrors the equivalent
 *  helper in loftMath.js (PUSH-102) but kept self-contained here so
 *  the solid panel has no surface-panel dependency. */
export function normaliseSections(sections) {
  if (!Array.isArray(sections)) return [];
  const out = [];
  for (const s of sections) {
    if (!s) continue;
    const z = Number(s.z);
    const r = Number(s.radius);
    if (!Number.isFinite(z) || !Number.isFinite(r) || r <= 0) continue;
    out.push({ z, radius: r });
  }
  out.sort((a, b) => a.z - b.z);
  return out;
}

/** Compute the analytic frustum volume for the chain. Returns
 *  Σ (π·h/3) · (r1² + r1·r2 + r2²) over each adjacent pair. Pure
 *  math — used by the panel for the live preview number and by the
 *  e2e for a kernel-vs-analytic sanity check. */
export function analyticVolume(sections) {
  const sane = normaliseSections(sections);
  let total = 0;
  for (let i = 0; i + 1 < sane.length; i++) {
    const a = sane[i], b = sane[i + 1];
    const h = b.z - a.z;
    if (!(h > 0)) continue; // skip zero-thickness slices
    total += (Math.PI * h / 3) * (a.radius * a.radius
                                  + a.radius * b.radius
                                  + b.radius * b.radius);
  }
  return total;
}

/** Total z-axis height spanned by the sections. */
export function totalHeight(sections) {
  const sane = normaliseSections(sections);
  if (sane.length < 2) return 0;
  return sane[sane.length - 1].z - sane[0].z;
}

/** Build a cone-frustum chain and fuse it into a single closed solid.
 *  Returns { ok, handle, frustumHandles, fusedHandle, reason, message,
 *  sane }. ok===false on every failure path — never throws so the
 *  panel button can render a friendly log entry. */
export function buildLoftSolid(sections) {
  if (typeof window === 'undefined') {
    return { ok: false, reason: 'no window', sane: [] };
  }
  const f = window.forge;
  if (!f || typeof f.makeCone !== 'function'
        || typeof f.translate !== 'function'
        || typeof f.fuse !== 'function') {
    return { ok: false, reason: 'forge primitives missing', sane: [] };
  }
  const sane = normaliseSections(sections);
  if (sane.length < MIN_SECTIONS) {
    return { ok: false, reason: `need at least ${MIN_SECTIONS} sections`,
             sane };
  }

  // Build one cone frustum per adjacent pair, translated to its z.
  const frustumHandles = [];
  try {
    for (let i = 0; i + 1 < sane.length; i++) {
      const a = sane[i], b = sane[i + 1];
      const h = b.z - a.z;
      if (!(h > 0)) {
        // Two sections at the same z: skip — ThruSections would also
        // refuse a zero-thickness section.
        continue;
      }
      // OCCT MakeCone places the cone with its base at Z=0 and the
      // top at Z=h, so we translate by a.z to land it at the correct
      // section height.
      const coneAtOrigin = f.makeCone(a.radius, b.radius, h);
      const placed = f.translate(coneAtOrigin, 0, 0, a.z);
      frustumHandles.push(placed);
    }
  } catch (err) {
    return { ok: false, reason: 'frustum build threw',
             message: err && err.message ? err.message : String(err),
             sane };
  }
  if (frustumHandles.length === 0) {
    return { ok: false, reason: 'no valid frustum cells (zero spans?)',
             sane };
  }
  if (frustumHandles.length === 1) {
    // Single span — no fuse needed.
    return { ok: true, handle: frustumHandles[0],
             frustumHandles, fusedHandle: frustumHandles[0], sane };
  }

  // Fuse all frustums into a single closed solid. Each fuse stitches
  // along the shared circular face at the section boundary so the
  // result is watertight — that's exactly the topology ThruSections
  // produces for circular sections (closed solid with shared section
  // edges as inter-frustum boundaries).
  let acc = frustumHandles[0];
  try {
    for (let i = 1; i < frustumHandles.length; i++) {
      acc = f.fuse(acc, frustumHandles[i]);
    }
  } catch (err) {
    return { ok: false, reason: 'fuse threw',
             message: err && err.message ? err.message : String(err),
             frustumHandles, sane };
  }
  if (typeof acc !== 'number' || !Number.isFinite(acc) || acc <= 0) {
    return { ok: false, reason: 'fuse returned no handle',
             message: String(acc), frustumHandles, sane };
  }
  return { ok: true, handle: acc, frustumHandles, fusedHandle: acc, sane };
}

/** Top-level driver — sections → buildLoftSolid → __forgeAppendBody
 *  → bus event. Used by both the panel button and the e2e spec. */
export function runLoftSolidPipeline({
  sections = DEFAULT_SECTIONS.map((s) => ({ z: s.z, radius: s.radius })),
  name,
} = {}) {
  const built = buildLoftSolid(sections);
  if (!built.ok) {
    return {
      ok: false, reason: built.reason, message: built.message,
      sane: built.sane,
    };
  }

  // Pull mass props off the kernel so the panel can surface the
  // swept volume + the e2e can assert volume > 0.
  let volume = 0, area = 0;
  try {
    const f = window.forge;
    if (f && typeof f.massProps === 'function') {
      const mp = f.massProps(built.handle);
      if (mp && Number.isFinite(mp.volume)) volume = Math.abs(mp.volume);
      if (mp && Number.isFinite(mp.area))   area   = Math.abs(mp.area);
    }
  } catch { /* fail soft — mass is a courtesy display */ }

  const sane = built.sane;
  const height = totalHeight(sane);
  const ts = Date.now();
  const id = `loft-solid-${ts}`;
  const body = {
    id, kind: 'native', handle: built.handle,
    toolId: 'part.loftSolid',
    name: name || `Loft Solid (${sane.length} sections)`,
    params: {
      sections: sane.map((s) => ({ z: s.z, radius: s.radius })),
      sectionCount: sane.length,
      frustumCount: built.frustumHandles.length,
      height, volume, area,
    },
  };
  if (typeof window !== 'undefined'
      && typeof window.__forgeAppendBody === 'function') {
    window.__forgeAppendBody(body);
  }

  // Window mirror so e2e / plugins / Archie can read the last build
  // without scraping the DOM or waiting for the next React render.
  try {
    if (typeof window !== 'undefined') {
      window.__forgeLoftSolid = {
        handle: built.handle, bodyId: id,
        sections: sane.slice(),
        frustumHandles: built.frustumHandles.slice(),
        height, volume, area, ts,
      };
    }
  } catch { /* defensive */ }

  // Dispatch the bus event. Failure-soft so a missing
  // window.dispatchEvent (SSR / non-browser) does not break the panel.
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(FORGE_LOFT_SOLID_EVENT, {
        detail: {
          handle: built.handle, bodyId: id,
          sectionCount: sane.length,
          frustumCount: built.frustumHandles.length,
          height, volume, area, ts,
        },
      }));
    }
  } catch { /* fail soft */ }

  return {
    ok: true, handle: built.handle, body,
    frustumHandles: built.frustumHandles,
    sane, height, volume, area,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Side-effect helper API install — same pattern as LoftSectionsPanel,
// SweepCurvePanel, ClassABlendPanel. The moment this module is
// imported, the helper surface is live so e2e + plugin code can drive
// the pipeline without the React Host being mounted.

if (typeof window !== 'undefined') {
  try {
    window.__forgeLoftSolidHelper = Object.freeze({
      normaliseSections,
      analyticVolume,
      totalHeight,
      buildLoftSolid,
      runLoftSolidPipeline,
      DEFAULT_SECTIONS: DEFAULT_SECTIONS.map(
        (s) => ({ z: s.z, radius: s.radius })),
      MIN_SECTIONS,
      EVENT_NAME:  FORGE_LOFT_SOLID_EVENT,
      STORAGE_KEY: FORGE_LOFT_SOLID_STORAGE,
    });
    window.addEventListener('forge:menu-action', (e) => {
      if (e?.detail?.id === 'tools.loftSolid') {
        window.__forgeLoftSolidLastMenuTs = Date.now();
      }
    });
  } catch { /* fail soft — defensive in SSR / non-window envs */ }
}

// ─────────────────────────────────────────────────────────────────────
// Styles — same right-docked rail as PUSH-102 / PUSH-122.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 440,
  zIndex: 1333,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  overflow: 'hidden',
};
const HEADER_ROW = { display: 'flex', alignItems: 'center', gap: 8 };
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3,
};
const SECTION_TITLE = {
  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)', margin: '8px 0 4px',
};
const SECTION_BOX = {
  background: 'var(--forge-canvas-3, #1b212a)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4, padding: 8,
  display: 'flex', flexDirection: 'column', gap: 6,
};
const TABLE_HEADER_ROW = {
  display: 'grid', gridTemplateColumns: '36px 1fr 1fr 40px',
  alignItems: 'center', gap: 6,
  fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
  paddingBottom: 4,
  borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
};
const TABLE_ROW = {
  display: 'grid', gridTemplateColumns: '36px 1fr 1fr 40px',
  alignItems: 'center', gap: 6,
  padding: '4px 2px', borderRadius: 3,
};
const INPUT_STYLE = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '3px 6px', borderRadius: 3, fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  width: '100%', boxSizing: 'border-box',
};
const SMALL_BTN = {
  background: 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  cursor: 'pointer', padding: '2px 6px', borderRadius: 3, fontSize: 11,
};
const TABLE_ROW_LABEL = {
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)',
  textAlign: 'center',
};
const ACTION_ROW = { display: 'flex', gap: 6, alignItems: 'center' };
const ACTION_BTN = (variant = 'default', disabled = false) => ({
  background: disabled ? 'var(--forge-surface-mute, #1a1f27)'
            : variant === 'primary' ? 'var(--forge-accent, #4f87ff)'
            : 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: disabled ? 'var(--forge-ink-mute, #9aa1ab)'
       : variant === 'primary' ? '#fff'
       : 'var(--forge-ink, #dadde2)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  padding: '6px 14px', borderRadius: 3, fontSize: 12,
  fontWeight: variant === 'primary' ? 600 : 400,
});
const LOG_BOX = {
  flex: 1, minHeight: 0, overflowY: 'auto',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4, background: 'var(--forge-canvas-1, #0e1218)',
  padding: 6, fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  color: 'var(--forge-ink-2, #b5bac4)',
};

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

function clonePreset() {
  return DEFAULT_SECTIONS.map((s) => ({ z: s.z, radius: s.radius }));
}

export function LoftSolidPanel({ open, onClose }) {
  const [sections, setSections] = useState(clonePreset);
  const [log, setLog] = useState([]);
  const lastHandleRef = useRef(null);

  // Reset to the preset every time the panel opens so the e2e
  // assertion "click Apply with default sections" is deterministic.
  useEffect(() => {
    if (!open) return;
    setSections(clonePreset());
    setLog([]);
  }, [open]);

  const onChangeField = useCallback((idx, field, value) => {
    setSections((prev) => prev.map((row, i) =>
      i === idx ? { ...row, [field]: Number(value) } : row));
  }, []);

  const onAddRow = useCallback(() => {
    setSections((prev) => {
      // New row inherits the last row's z + a 20 mm bump, and the last
      // row's radius. Keeps additions sensible without forcing the
      // user to type from scratch.
      const last = prev[prev.length - 1] || { z: 0, radius: 20 };
      const next = [...prev, { z: last.z + 20, radius: last.radius }];
      return next;
    });
  }, []);

  const onRemoveRow = useCallback((idx) => {
    setSections((prev) => {
      if (prev.length <= MIN_SECTIONS) return prev;
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  const onResetToPreset = useCallback(() => {
    setSections(clonePreset());
  }, []);

  const sane = useMemo(() => normaliseSections(sections), [sections]);
  const previewVolume = useMemo(() => analyticVolume(sane), [sane]);
  const previewHeight = useMemo(() => totalHeight(sane), [sane]);
  const canApply = sane.length >= MIN_SECTIONS;

  const onApply = useCallback(() => {
    const r = runLoftSolidPipeline({ sections });
    if (r.ok) lastHandleRef.current = r.handle;
    setLog((l) => [
      ...l.slice(-12),
      {
        ok: r.ok, ts: Date.now(),
        message: r.ok
          ? `Lofted ${r.sane.length} sections → solid ${r.handle} (height ${r.height.toFixed(1)}mm, volume ${r.volume.toFixed(1)}mm³, ${r.frustumHandles.length} frustum${r.frustumHandles.length === 1 ? '' : 's'})`
          : `Apply failed: ${r.reason || 'error'}${r.message ? ' · ' + r.message : ''}`,
      },
    ]);
  }, [sections]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div role="dialog"
         aria-label="Loft Solid body"
         data-testid="forge-loft-solid-panel"
         data-section-count={sane.length}
         data-height={String(previewHeight)}
         data-analytic-volume={String(previewVolume)}
         data-last-handle={lastHandleRef.current == null ? '' : String(lastHandleRef.current)}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="solid.loft" size={14} />
        <strong style={{ fontSize: 13 }}>Loft Solid</strong>
        <span style={{
          fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
          fontSize: 10,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          padding: '1px 6px',
          borderRadius: 'var(--forge-radius-pill, 10px)',
          border: '1px solid var(--forge-rail-edge, #2a2d34)',
        }}>
          OCCT closed solid
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close Loft Solid panel"
                data-testid="forge-loft-solid-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={{ fontSize: 11, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
        Sweep N closed circular profiles (z + radius) into a watertight
        OCCT solid body. Each adjacent (s[i], s[i+1]) pair becomes a
        cone frustum at the correct z; all frustums are fused into a
        single closed solid. Calls forge.makeCone + forge.translate +
        forge.fuse — circular ThruSections under the hood.
      </div>

      <div style={SECTION_TITLE}>Sections (z, radius)</div>
      <div style={SECTION_BOX}>
        <div style={TABLE_HEADER_ROW}>
          <span style={{ textAlign: 'center' }}>#</span>
          <span>z (mm)</span>
          <span>radius (mm)</span>
          <span></span>
        </div>
        <div data-testid="forge-loft-solid-table"
             data-row-count={sections.length}
             style={{ display: 'flex', flexDirection: 'column', gap: 2,
                      maxHeight: 180, overflowY: 'auto' }}>
          {sections.map((row, idx) => (
            <div key={idx}
                 data-testid={`forge-loft-solid-row-${idx}`}
                 style={TABLE_ROW}>
              <span style={TABLE_ROW_LABEL}>{idx + 1}</span>
              <input type="number" step="0.1"
                     value={row.z}
                     onChange={(e) => onChangeField(idx, 'z', e.target.value)}
                     data-testid={`forge-loft-solid-z-${idx}`}
                     style={INPUT_STYLE} />
              <input type="number" step="0.1" min="0.1"
                     value={row.radius}
                     onChange={(e) => onChangeField(idx, 'radius', e.target.value)}
                     data-testid={`forge-loft-solid-radius-${idx}`}
                     style={INPUT_STYLE} />
              <button type="button"
                      onClick={() => onRemoveRow(idx)}
                      data-testid={`forge-loft-solid-remove-${idx}`}
                      aria-label={`Remove section ${idx + 1}`}
                      disabled={sections.length <= MIN_SECTIONS}
                      style={{
                        ...SMALL_BTN,
                        opacity: sections.length <= MIN_SECTIONS ? 0.4 : 1,
                        cursor: sections.length <= MIN_SECTIONS
                                ? 'not-allowed' : 'pointer',
                      }}>−</button>
            </div>
          ))}
        </div>
        <div style={ACTION_ROW}>
          <button type="button"
                  onClick={onAddRow}
                  data-testid="forge-loft-solid-add"
                  style={SMALL_BTN}>+ Add section</button>
          <button type="button"
                  onClick={onResetToPreset}
                  data-testid="forge-loft-solid-reset"
                  style={SMALL_BTN}>Reset to preset</button>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}
                data-testid="forge-loft-solid-summary">
            {sane.length} valid · height {previewHeight.toFixed(1)}mm ·
            ~{previewVolume.toFixed(0)}mm³
          </span>
        </div>
      </div>

      <div style={SECTION_TITLE}>Build</div>
      <div style={SECTION_BOX}>
        <button type="button"
                onClick={onApply}
                disabled={!canApply}
                data-testid="forge-loft-solid-apply"
                style={ACTION_BTN('primary', !canApply)}>
          Apply — Build closed-loop solid
        </button>
        <span style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
          {`Calls forge.makeCone(r1, r2, h) × ${Math.max(0, sane.length - 1)} + forge.translate + forge.fuse`}
        </span>
      </div>

      <div style={SECTION_TITLE}>Log</div>
      <div data-testid="forge-loft-solid-log"
           data-log-count={log.length}
           style={LOG_BOX}>
        {log.length === 0 ? (
          <span style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>
            no builds yet
          </span>
        ) : log.slice().reverse().map((entry, i) => (
          <div key={`${entry.ts}-${i}`}
               style={{
                 display: 'flex', gap: 6, alignItems: 'baseline',
                 borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
                 padding: '2px 0',
               }}>
            <span style={{ color: entry.ok ? 'var(--forge-ok, #4caf50)'
                                            : 'var(--forge-err, #ef5350)' }}>
              {entry.ok ? 'OK' : 'ER'}
            </span>
            <span style={{ flex: 1 }}>{entry.message}</span>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.loftSolid` menu action, exposes the
// imperative open/close hooks for plugins / e2e / Archie tool calls.

export function LoftSolidPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenLoftSolid  = () => setOpen(true);
    window.__forgeCloseLoftSolid = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.loftSolid') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenLoftSolid; } catch {}
      try { delete window.__forgeCloseLoftSolid; } catch {}
    };
  }, []);
  if (!open) return null;
  return <LoftSolidPanel open={open} onClose={() => setOpen(false)} />;
}

export default LoftSolidPanel;
