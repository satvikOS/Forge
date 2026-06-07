// PUSH-106 (Slice-75) — Detail View Circles panel.
//
// In real engineering drawings a "detail view" is two things drawn side
// by side:
//   1. A small dashed CIRCLE on the parent (front / top / right …)
//      view that marks a region of interest, labelled with a tag letter
//      (A, B, C, …) and a leader pointing at the detail callout.
//   2. A separate ZOOMED view of just that circular region, projected
//      at a higher scale (typically 2:1 or 4:1) so fine features —
//      thread roots, fillets, undercuts — read clearly.
//
// PUSH-62 lit up section views via the existing
// `forge.drawings.projectSection` surface. PUSH-106 lights up the
// matching `forge.drawings.projectDetail` surface (already wired
// through preload.js and drawingsDispatch.js) and turns it into a
// user-facing panel:
//
//   • Define N detail regions per parent view: {cx, cy, radius, scale,
//     label}. Each row is editable; +/- adds and removes regions.
//   • Click "Generate" and the panel runs every region through
//     `projectDetail` (when the kernel surface is available), captures
//     the returned edge / bbox payload, and stores it on
//     window.__forgeDetailViews so the e2e + plugins can introspect.
//   • An inline SVG preview shows the parent view (a unit rectangle)
//     overlaid with one dashed circle + leader + tag label per region.
//   • A second SVG block renders the projected detail outline of every
//     region at its individual scale so the user can verify the cut
//     before exporting.
//
// Hard constraints (PUSH-106 brief):
//   * NO new npm / C++ / external dependencies.
//   * Real implementation, no MVP, no stub. Every region goes through
//     `projectDetail` when a body handle + kernel surface exist; falls
//     back to a self-contained SVG snippet when the panel is opened
//     against an empty scene so the preview is never blank.
//   * Surgical edits to Menus.jsx (one new entry — `tools.detailViews`)
//     and App.jsx (one import + one mount).
//   * Manual clicks NEVER post to Archie's thread.
//   * Multi-cam e2e mandate honoured by push-106-detail-views.spec.js.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';

// ─────────────────────────────────────────────────────────────────────
// Constants — bus event + persistence key.

export const FORGE_DETAIL_VIEWS_EVENT   = 'forge:detail-views-generated';
export const FORGE_DETAIL_VIEWS_STORAGE = 'forge.v4.detailViews';

// Letters A..Z auto-assigned to new regions; the user can override.
const TAG_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// Default parent view extents (a 100 × 60 rectangle centred on origin,
// matching the unit-rectangle parent the brief calls for; widened
// generously so detail callouts at the bbox edges have room to breathe).
export const PARENT_VIEW = Object.freeze({
  width: 100,
  height: 60,
  minX: -50, maxX: 50,
  minY: -30, maxY: 30,
});

// Default detail region seeded the first time the panel opens. One
// region at the top edge of the unit rectangle, scale 2:1.
export function defaultRegions() {
  return [
    { cx: -20, cy:  20, radius: 8, scale: 2, label: 'A',
      parentView: 'front', direction: 'front' },
    { cx:  15, cy: -10, radius: 6, scale: 4, label: 'B',
      parentView: 'front', direction: 'front' },
  ];
}

// ─────────────────────────────────────────────────────────────────────
// Headless math — exported so the e2e (and plugins / Archie tool calls,
// once those land) can drive the pipeline without mounting React.

/** Pick the next free single-letter tag from A..Z, skipping any letters
 *  already used by other regions. */
export function nextDetailLetter(used) {
  const taken = new Set((used || []).map((s) => String(s || '').toUpperCase()));
  for (const ch of TAG_LETTERS) {
    if (!taken.has(ch)) return ch;
  }
  return TAG_LETTERS[0];
}

/** Sanitise a region row pulled out of the table — drop NaNs, clamp the
 *  radius and scale to sensible engineering values, and uppercase the
 *  tag letter. */
export function normaliseRegion(row, idx = 0, others = []) {
  const cx     = Number.isFinite(Number(row?.cx))     ? Number(row.cx)     : 0;
  const cy     = Number.isFinite(Number(row?.cy))     ? Number(row.cy)     : 0;
  const radius = Number.isFinite(Number(row?.radius)) ? Math.max(0.1, Number(row.radius)) : 5;
  const scale  = Number.isFinite(Number(row?.scale))  ? Math.max(0.5, Number(row.scale))  : 2;
  let label    = String(row?.label || '').trim().toUpperCase();
  if (!label) {
    label = nextDetailLetter(others.filter((_, j) => j !== idx)
                                   .map((r) => r?.label));
  }
  const parentView = String(row?.parentView || 'front');
  const direction  = String(row?.direction  || parentView);
  return { cx, cy, radius, scale, label, parentView, direction };
}

/** Apply normalisation across the whole table, including duplicate-label
 *  resolution (later rows that collide with earlier rows pick the next
 *  free letter). */
export function normaliseRegions(rows) {
  const out = [];
  const used = [];
  for (let i = 0; i < (rows?.length || 0); i += 1) {
    const r = normaliseRegion(rows[i], i, out);
    // If two rows share a letter, force the second to the next free letter.
    if (used.includes(r.label)) {
      r.label = nextDetailLetter([...used]);
    }
    used.push(r.label);
    out.push(r);
  }
  return out;
}

/** Build an SVG snippet that shows the parent rectangle (a unit
 *  reference rectangle in PARENT_VIEW units) plus one dashed circle per
 *  region with a leader pointing to a tag bubble. Pure string output —
 *  no DOM. */
export function svgParentSnippet(regions) {
  const W = PARENT_VIEW.width;
  const H = PARENT_VIEW.height;
  const minX = PARENT_VIEW.minX;
  const minY = PARENT_VIEW.minY;
  // viewBox padded so leader callouts have somewhere to land.
  const pad = 18;
  const vb = `${minX - pad} ${minY - pad} ${W + 2 * pad} ${H + 2 * pad}`;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" data-detail-svg="parent">`,
    // Parent view rectangle (the "unit" reference parent the brief
    // calls for, drawn at PARENT_VIEW.width × .height units).
    `<rect x="${minX}" y="${minY}" width="${W}" height="${H}" fill="#fafafa" stroke="#111418" stroke-width="0.6"/>`,
  ];
  for (const r of regions) {
    // Detail circle — dashed black per ASME Y14.3.
    parts.push(`<circle cx="${r.cx}" cy="${r.cy}" r="${r.radius}" fill="none" stroke="#111418" stroke-width="0.5" stroke-dasharray="2 1.5"/>`);
    // Leader line: from the circle's edge outward, terminating in a
    // small tag bubble. We push the tag towards the closest sheet
    // edge so callouts don't overlap the parent body geometry.
    const angle = Math.atan2(r.cy, r.cx); // outward direction.
    const sx = r.cx + Math.cos(angle) * r.radius;
    const sy = r.cy + Math.sin(angle) * r.radius;
    const ex = r.cx + Math.cos(angle) * (r.radius + 10);
    const ey = r.cy + Math.sin(angle) * (r.radius + 10);
    parts.push(`<line x1="${sx.toFixed(3)}" y1="${sy.toFixed(3)}" x2="${ex.toFixed(3)}" y2="${ey.toFixed(3)}" stroke="#111418" stroke-width="0.5"/>`);
    // Tag bubble.
    parts.push(`<circle cx="${ex.toFixed(3)}" cy="${ey.toFixed(3)}" r="3.5" fill="#fff" stroke="#111418" stroke-width="0.5"/>`);
    parts.push(`<text x="${ex.toFixed(3)}" y="${(ey + 1.4).toFixed(3)}" font-family="Arial, sans-serif" font-size="4" text-anchor="middle" fill="#111418">${r.label}</text>`);
  }
  parts.push('</svg>');
  return parts.join('');
}

/** Build a small per-detail SVG snippet at the requested scale, given
 *  the projected edges returned by `forge.drawings.projectDetail`. When
 *  the kernel returned no edges (empty scene / addon missing), draws
 *  the input circle alone so the preview is still readable. */
export function svgDetailSnippet(region, projected) {
  // The detail callout's frame is a square viewport big enough to
  // contain the focus circle at scale 1; the kernel pre-scales when
  // possible, so we render at unit scale.
  const r2 = region.radius * region.scale;
  const minX = -r2 - 4;
  const minY = -r2 - 4;
  const wh   = 2 * r2 + 8;
  const vb = `${minX} ${minY} ${wh} ${wh}`;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" data-detail-svg="detail-${region.label}">`,
    `<circle cx="0" cy="0" r="${r2.toFixed(3)}" fill="#fafafa" stroke="#111418" stroke-width="0.4"/>`,
  ];
  const edges = Array.isArray(projected?.edges) ? projected.edges : [];
  for (const e of edges) {
    const pts = Array.isArray(e?.points) ? e.points : [];
    if (pts.length < 2) continue;
    // Recentre on the focus circle's centre, then scale into the local
    // viewport frame. Hidden edges → dashed grey; visible → solid black.
    const d = pts.map((p, i) => {
      if (!p || p.length < 2) return '';
      const x = (p[0] - region.cx) * region.scale;
      const y = (p[1] - region.cy) * region.scale;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(3)} ${y.toFixed(3)}`;
    }).filter(Boolean).join(' ');
    if (!d) continue;
    const hidden = e.visible === false;
    parts.push(`<path d="${d}" fill="none" stroke="${hidden ? '#9aa0a6' : '#111418'}" stroke-width="${hidden ? '0.3' : '0.5'}" ${hidden ? 'stroke-dasharray="1.5 1"' : ''}/>`);
  }
  // Tag bubble in the upper-left corner.
  const tx = minX + 4;
  const ty = minY + 6;
  parts.push(`<circle cx="${tx.toFixed(3)}" cy="${ty.toFixed(3)}" r="3" fill="#fff" stroke="#111418" stroke-width="0.4"/>`);
  parts.push(`<text x="${tx.toFixed(3)}" y="${(ty + 1.1).toFixed(3)}" font-family="Arial, sans-serif" font-size="3.4" text-anchor="middle" fill="#111418">${region.label}</text>`);
  // Scale label bottom-right.
  parts.push(`<text x="${(minX + wh - 1).toFixed(3)}" y="${(minY + wh - 1.5).toFixed(3)}" font-family="Arial, sans-serif" font-size="3" text-anchor="end" fill="#111418">${region.scale}:1</text>`);
  parts.push('</svg>');
  return parts.join('');
}

// ─────────────────────────────────────────────────────────────────────
// Kernel bridge — `forge.drawings.projectDetail` returns the same
// packed Float32 ProjectedView shape that projectSection emits
// ({visible, visibleStarts, visibleCount, hidden, hiddenStarts,
//  hiddenCount, outline, outlineStarts, outlineCount, scale, bbox …}).
// We unpack those buckets into the {points, visible} edge-list form
// the SVG preview + downstream emitters speak. drawingsDispatch.js's
// projectDetailSafe gates on Array.isArray(out.edges) which the packed
// form fails — so we own the bridging here instead of leaning on the
// safe-wrapper.

function unpackPolylines(verts, starts, count) {
  const out = [];
  if (!verts || !starts) return out;
  const n = Number(count || 0);
  for (let i = 0; i < n; i += 1) {
    const a = Number(starts[i]);
    const b = Number(starts[i + 1]);
    const pts = [];
    for (let j = a; j < b; j += 1) {
      pts.push([verts[2 * j], verts[2 * j + 1]]);
    }
    if (pts.length >= 2) out.push(pts);
  }
  return out;
}

/** Convert a packed ProjectedView (the shape forge.drawings.projectDetail
 *  returns) into the {edges:[{points, visible}]} shape svgDetailSnippet
 *  consumes. Visible + outline → visible solid; hidden → dashed. */
export function packedDetailToEdgeList(packed) {
  if (!packed || typeof packed !== 'object') return null;
  // Some kernel builds return a plain {edges:[...]} object directly
  // (older surface or test stubs); keep that path working.
  if (Array.isArray(packed.edges)) return { edges: packed.edges, scale: packed.scale };
  const edges = [];
  const visBuckets = [
    unpackPolylines(packed.visible, packed.visibleStarts, packed.visibleCount),
    unpackPolylines(packed.outline, packed.outlineStarts, packed.outlineCount),
  ];
  for (const b of visBuckets) for (const pl of b) edges.push({ points: pl, visible: true });
  for (const pl of unpackPolylines(packed.hidden, packed.hiddenStarts, packed.hiddenCount)) {
    edges.push({ points: pl, visible: false });
  }
  return {
    edges,
    scale: typeof packed.scale === 'number' ? packed.scale : undefined,
    visibleCount: Number(packed.visibleCount || 0),
    hiddenCount:  Number(packed.hiddenCount  || 0),
    outlineCount: Number(packed.outlineCount || 0),
  };
}

/** Call `window.forge.drawings.projectDetail` with the right
 *  argument shape ({x, y, r}, not {cx, cy, r}) and unpack the packed
 *  result into the edge-list form svgDetailSnippet wants. */
export function projectDetailReal(handle, direction, region) {
  if (typeof window === 'undefined') {
    return { edges: [], source: 'no-window' };
  }
  const drawings = window.forge?.drawings;
  if (!drawings || typeof drawings.projectDetail !== 'function') {
    return { edges: [], source: 'error',
             error: 'forge.drawings.projectDetail unavailable' };
  }
  if (typeof handle !== 'number') {
    return { edges: [], source: 'no-handle', scale: region.scale };
  }
  const focus = { x: region.cx, y: region.cy, r: region.radius };
  try {
    const packed = drawings.projectDetail(handle, direction || 'front',
                                          focus, region.scale ?? 2);
    const parsed = packedDetailToEdgeList(packed);
    if (parsed && Array.isArray(parsed.edges)) {
      return { ...parsed, source: 'kernel',
               scale: parsed.scale ?? region.scale };
    }
    return { edges: [], source: 'error',
             error: 'projectDetail returned no recognisable polylines' };
  } catch (err) {
    return { edges: [], source: 'error',
             error: `projectDetail threw: ${err.message || err}` };
  }
}

/** Pull the currently selected body handle if any (mirrors the pattern
 *  used by DrawingsHLRWorkbench): prefer window.__forgeSelection's
 *  bodyHandle, else the most recently added native body. */
export function pickBodyHandle() {
  if (typeof window === 'undefined') return null;
  const bodies = Array.isArray(window.__forgeBodies)
    ? window.__forgeBodies.filter((b) => b && b.kind === 'native'
                                           && typeof b.handle === 'number')
    : [];
  const sel = window.__forgeSelection;
  if (sel && typeof sel.bodyHandle === 'number') {
    const found = bodies.find((b) => b.handle === sel.bodyHandle);
    if (found) return { handle: found.handle, name: found.name };
  }
  if (bodies.length) {
    const last = bodies[bodies.length - 1];
    return { handle: last.handle, name: last.name };
  }
  return null;
}

/** Run every region through `forge.drawings.projectDetail`. Returns one
 *  entry per region: { region, projection, ok, error, scale }.
 *  Stores the result on window.__forgeDetailViews so the e2e + plugins
 *  can introspect without mounting React. */
export function runDetailViewsPipeline({ regions, bodyHandle, direction } = {}) {
  const sane = normaliseRegions(regions || []);
  const handle = (typeof bodyHandle === 'number') ? bodyHandle : null;
  const dir = direction || 'front';
  const entries = sane.map((r) => {
    const projection = projectDetailReal(handle, r.direction || dir, r);
    return {
      region: r,
      projection,
      ok: projection?.source === 'kernel',
      error: projection?.error || null,
      scale: r.scale,
    };
  });
  const summary = {
    bodyHandle: handle,
    direction: dir,
    count: entries.length,
    entries,
    ts: Date.now(),
  };
  if (typeof window !== 'undefined') {
    try {
      window.__forgeDetailViews = summary;
      window.dispatchEvent(new CustomEvent(FORGE_DETAIL_VIEWS_EVENT, {
        detail: {
          count: entries.length,
          bodyHandle: handle,
          direction: dir,
          ts: summary.ts,
        },
      }));
    } catch { /* fail soft — CustomEvent + assigning to window is universal in Electron */ }
  }
  return summary;
}

// ─────────────────────────────────────────────────────────────────────
// Side-effect helper API install — same pattern as LoftSectionsPanel /
// BomBalloonsPanel. The moment this module is imported, the helper
// surface is live so e2e + plugin code can drive the pipeline without
// the React Host being mounted.

if (typeof window !== 'undefined') {
  try {
    window.__forgeDetailViewsHelper = Object.freeze({
      defaultRegions,
      nextDetailLetter,
      normaliseRegion,
      normaliseRegions,
      svgParentSnippet,
      svgDetailSnippet,
      pickBodyHandle,
      packedDetailToEdgeList,
      projectDetailReal,
      runDetailViewsPipeline,
      PARENT_VIEW,
      EVENT_NAME: FORGE_DETAIL_VIEWS_EVENT,
      STORAGE_KEY: FORGE_DETAIL_VIEWS_STORAGE,
    });
  } catch { /* fail soft — defensive in SSR / non-window envs */ }
}

// ─────────────────────────────────────────────────────────────────────
// Styles — right-docked rail to match BomBalloonsPanel +
// LoftSectionsPanel + every other PUSH-N panel.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 520,
  zIndex: 1334,
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
  display: 'grid',
  gridTemplateColumns: '24px 60px 60px 50px 50px 48px 40px',
  alignItems: 'center', gap: 6,
  fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
  paddingBottom: 4,
  borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
};
const TABLE_ROW_STYLE = {
  display: 'grid',
  gridTemplateColumns: '24px 60px 60px 50px 50px 48px 40px',
  alignItems: 'center', gap: 6,
  padding: '4px 2px',
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
const TABLE_INDEX = {
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
const PREVIEW_BOX = {
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4, background: '#fafafa',
  padding: 4, overflow: 'auto', minHeight: 120,
};
const DETAIL_GRID = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
  gap: 4,
};
const DETAIL_TILE = {
  background: '#fafafa',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3, padding: 2, minHeight: 80,
};

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

export function DetailViewsPanel({ open, onClose }) {
  const [regions, setRegions] = useState(() => defaultRegions());
  const [direction, setDirection] = useState('front');
  const [body, setBody] = useState(() => pickBodyHandle());
  const [summary, setSummary] = useState(null);
  const [generatedAt, setGeneratedAt] = useState(null);
  const generationCountRef = useRef(0);

  // Refresh body pick + reset table on open. Re-resolve the body each
  // time the underlying scene churns so the panel always projects
  // against the current target body.
  useEffect(() => {
    if (!open) return undefined;
    setRegions(defaultRegions());
    setBody(pickBodyHandle());
    setSummary(null);
    setGeneratedAt(null);
    generationCountRef.current = 0;
    const onBodies = () => setBody(pickBodyHandle());
    if (typeof window !== 'undefined') {
      window.addEventListener('forge:bodies-changed', onBodies);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('forge:bodies-changed', onBodies);
      }
    };
  }, [open]);

  const onChangeField = useCallback((idx, field, value) => {
    setRegions((prev) => prev.map((row, i) => {
      if (i !== idx) return row;
      if (field === 'label') {
        return { ...row, label: String(value || '').toUpperCase().slice(0, 4) };
      }
      const num = Number(value);
      return { ...row, [field]: Number.isFinite(num) ? num : row[field] };
    }));
  }, []);

  const onAddRow = useCallback(() => {
    setRegions((prev) => {
      const used = prev.map((r) => r.label);
      const last = prev[prev.length - 1] || { cx: 0, cy: 0, radius: 5, scale: 2,
                                              parentView: 'front', direction: 'front' };
      return [...prev, {
        cx: last.cx + 10, cy: last.cy + 5,
        radius: last.radius, scale: last.scale,
        label: nextDetailLetter(used),
        parentView: last.parentView, direction: last.direction,
      }];
    });
  }, []);

  const onRemoveRow = useCallback((idx) => {
    setRegions((prev) => prev.length <= 1
      ? prev
      : prev.filter((_, i) => i !== idx));
  }, []);

  const onReset = useCallback(() => {
    setRegions(defaultRegions());
  }, []);

  const sane = useMemo(() => normaliseRegions(regions), [regions]);

  const onGenerate = useCallback(() => {
    const live = pickBodyHandle();
    setBody(live);
    const s = runDetailViewsPipeline({
      regions: sane,
      bodyHandle: live?.handle ?? null,
      direction,
    });
    setSummary(s);
    setGeneratedAt(Date.now());
    generationCountRef.current += 1;
  }, [sane, direction]);

  const parentSvg = useMemo(() => svgParentSnippet(sane), [sane]);
  const perDetail = useMemo(() => {
    if (!summary) return [];
    return summary.entries.map((entry) => ({
      label: entry.region.label,
      svg: svgDetailSnippet(entry.region, entry.projection),
      ok: entry.ok,
      edgeCount: Array.isArray(entry.projection?.edges)
        ? entry.projection.edges.length : 0,
    }));
  }, [summary]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div role="dialog"
         aria-label="Detail Views"
         data-testid="forge-detail-views-panel"
         data-region-count={sane.length}
         data-direction={direction}
         data-body-handle={body?.handle ?? ''}
         data-generation-count={generationCountRef.current}
         data-last-count={summary?.count ?? 0}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="measure.distance" size={14} />
        <strong style={{ fontSize: 13 }}>Detail Views</strong>
        <span data-testid="forge-detail-views-count"
              style={{
                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                fontSize: 10,
                color: 'var(--forge-ink-mute, #9aa1ab)',
                padding: '1px 6px',
                borderRadius: 'var(--forge-radius-pill, 10px)',
                border: '1px solid var(--forge-rail-edge, #2a2d34)',
              }}>
          {sane.length} region{sane.length === 1 ? '' : 's'}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close Detail Views panel"
                data-testid="forge-detail-views-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={{ fontSize: 11, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
        Mark N circular detail regions on a parent view. Each region
        projects through <code>forge.drawings.projectDetail</code> at its
        own scale (typically 2-4×). Results land on <code>window.__forgeDetailViews</code>.
      </div>

      <div style={SECTION_TITLE}>Parent view</div>
      <div style={SECTION_BOX}>
        <div style={ACTION_ROW}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
              Direction
            </span>
            <select value={direction}
                    onChange={(e) => setDirection(e.target.value)}
                    data-testid="forge-detail-views-direction"
                    style={{ ...INPUT_STYLE, width: 90 }}>
              <option value="front">front</option>
              <option value="top">top</option>
              <option value="right">right</option>
              <option value="iso">iso</option>
            </select>
          </label>
          <span style={{ flex: 1 }} />
          <span data-testid="forge-detail-views-body"
                style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
            {body
              ? `target body: ${body.name || `handle ${body.handle}`}`
              : 'no body selected — projection skipped, parent preview still rendered.'}
          </span>
        </div>
      </div>

      <div style={SECTION_TITLE}>Regions ({sane.length})</div>
      <div style={SECTION_BOX}>
        <div style={TABLE_HEADER_ROW}>
          <span>#</span>
          <span>cx</span>
          <span>cy</span>
          <span>r</span>
          <span>scale</span>
          <span>label</span>
          <span></span>
        </div>
        <div data-testid="forge-detail-views-table"
             data-row-count={regions.length}
             style={{ display: 'flex', flexDirection: 'column', gap: 2,
                      maxHeight: 180, overflowY: 'auto' }}>
          {regions.map((row, idx) => (
            <div key={idx}
                 data-testid={`forge-detail-views-row-${idx}`}
                 style={TABLE_ROW_STYLE}>
              <span style={TABLE_INDEX}>{idx + 1}</span>
              <input type="number" step="0.5"
                     value={row.cx}
                     onChange={(e) => onChangeField(idx, 'cx', e.target.value)}
                     data-testid={`forge-detail-views-cx-${idx}`}
                     style={INPUT_STYLE} />
              <input type="number" step="0.5"
                     value={row.cy}
                     onChange={(e) => onChangeField(idx, 'cy', e.target.value)}
                     data-testid={`forge-detail-views-cy-${idx}`}
                     style={INPUT_STYLE} />
              <input type="number" step="0.5" min="0.1"
                     value={row.radius}
                     onChange={(e) => onChangeField(idx, 'radius', e.target.value)}
                     data-testid={`forge-detail-views-r-${idx}`}
                     style={INPUT_STYLE} />
              <input type="number" step="0.5" min="0.5"
                     value={row.scale}
                     onChange={(e) => onChangeField(idx, 'scale', e.target.value)}
                     data-testid={`forge-detail-views-scale-${idx}`}
                     style={INPUT_STYLE} />
              <input type="text"
                     maxLength={4}
                     value={row.label}
                     onChange={(e) => onChangeField(idx, 'label', e.target.value)}
                     data-testid={`forge-detail-views-label-${idx}`}
                     style={INPUT_STYLE} />
              <button type="button"
                      onClick={() => onRemoveRow(idx)}
                      data-testid={`forge-detail-views-remove-${idx}`}
                      aria-label={`Remove detail region ${idx + 1}`}
                      disabled={regions.length <= 1}
                      style={{
                        ...SMALL_BTN,
                        opacity: regions.length <= 1 ? 0.4 : 1,
                        cursor: regions.length <= 1 ? 'not-allowed' : 'pointer',
                      }}>−</button>
            </div>
          ))}
        </div>
        <div style={ACTION_ROW}>
          <button type="button"
                  onClick={onAddRow}
                  data-testid="forge-detail-views-add"
                  style={SMALL_BTN}>+ Add region</button>
          <button type="button"
                  onClick={onReset}
                  data-testid="forge-detail-views-reset"
                  style={SMALL_BTN}>Reset</button>
          <span style={{ flex: 1 }} />
          <button type="button"
                  onClick={onGenerate}
                  data-testid="forge-detail-views-generate"
                  disabled={sane.length < 1}
                  style={ACTION_BTN('primary', sane.length < 1)}>
            Generate
          </button>
        </div>
      </div>

      <div style={SECTION_TITLE}>Parent preview (callouts)</div>
      <div data-testid="forge-detail-views-parent-preview"
           data-svg-length={parentSvg.length}
           style={PREVIEW_BOX}>
        <div data-testid="forge-detail-views-parent-host"
             style={{ width: '100%', height: 180 }}
             dangerouslySetInnerHTML={{ __html: parentSvg }} />
      </div>

      <div style={SECTION_TITLE}>
        Zoomed details ({perDetail.length})
      </div>
      <div data-testid="forge-detail-views-detail-preview"
           data-detail-count={perDetail.length}
           style={{ ...PREVIEW_BOX, padding: 8 }}>
        {perDetail.length === 0 ? (
          <span style={{ fontStyle: 'italic',
                         color: 'var(--forge-ink-mute, #9aa1ab)',
                         fontSize: 11 }}>
            Click Generate to project each detail region.
          </span>
        ) : (
          <div style={DETAIL_GRID}>
            {perDetail.map((d, i) => (
              <div key={`${d.label}-${i}`}
                   data-testid={`forge-detail-views-detail-${d.label}`}
                   data-edge-count={d.edgeCount}
                   data-ok={String(d.ok)}
                   style={DETAIL_TILE}>
                <div style={{ fontSize: 9, color: '#333', padding: '0 2px 2px' }}>
                  DETAIL {d.label} · {d.edgeCount} edge{d.edgeCount === 1 ? '' : 's'}
                  {d.ok ? '' : ' (no kernel)'}
                </div>
                <div style={{ width: '100%', height: 90 }}
                     dangerouslySetInnerHTML={{ __html: d.svg }} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 0 0',
                    borderTop: '1px solid var(--forge-rail-edge, #2a2d34)' }}>
        <span data-testid="forge-detail-views-status"
              style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
          {generatedAt
            ? `Generated ${summary?.count ?? 0} detail${(summary?.count ?? 0) === 1 ? '' : 's'} at ${new Date(generatedAt).toLocaleTimeString()}.`
            : 'Set regions, then Generate.'}
        </span>
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.detailViews` menu action, exposes the
// imperative open/close hooks for plugins / e2e / Archie tool calls.

export function DetailViewsPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenDetailViews  = () => setOpen(true);
    window.__forgeCloseDetailViews = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.detailViews') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenDetailViews; } catch {}
      try { delete window.__forgeCloseDetailViews; } catch {}
    };
  }, []);
  if (!open) return null;
  return <DetailViewsPanel open={open} onClose={() => setOpen(false)} />;
}

export default DetailViewsPanel;
