// PUSH-97 (Slice-65 / Batched Cable / Pipe Routing panel).
//
// PUSH-45 added single-route pipe routing via forge::piperoute + an
// internal `pipeFromPolyline` sweep, all driven by the
// PipeRouteWorkbench's "two ports + an obstacle list" UI. Real cable
// harnesses + pipe racks need DOZENS of (start, end) pairs sharing a
// SINGLE obstacle map (the live scene's bodies), where each subsequent
// route also has to avoid every route committed before it. PUSH-97
// ships the Batched Routing panel that wraps the existing kernel
// surface with a true batch flow:
//
//   • The user adds N route rows. Each row carries `(start[xyz],
//     end[xyz])`. A pipe radius input is shared across the whole batch
//     (cable harnesses are uniform; pipe racks pick one nominal
//     diameter at a time). Add / Remove buttons mutate the row list.
//
//   • Obstacles are the live scene's native bodies — computed once at
//     Apply time from `window.__forgeBodies` (every native body's AABB
//     inferred from `params` / `spec`). The kernel router never sees a
//     stale obstacle map.
//
//   • Apply iterates rows IN ORDER. For each row:
//       1. Build the obstacle list = scene bbox list ∪ AABBs of every
//          route already committed by THIS batch (later routes avoid
//          earlier routes — that's the brief's headline requirement).
//       2. Call `window.forge.piperoute.route(inputs)` for the
//          centerline.
//       3. Sweep the centerline into a real OCCT pipe solid via
//          `window.forge.part.pipeFromPolyline(poly, radius)`.
//       4. Commit the body via `window.__forgeAppendBody` with a stable
//          id, native kind, the kernel handle, and a `params.radius` so
//          downstream features (BOM, MassProps, STL Export) round-trip.
//          Track the swept polyline's AABB so subsequent routes can
//          treat the new pipe as an obstacle.
//
//   • Each row's `status` updates after each route: `pending` →
//     `routed` / `failed`. Failed rows do NOT block the batch — the
//     panel keeps going so a single dead end doesn't tank a 12-route
//     harness. The footer summarises `<routed>/<total>` and surfaces
//     the bus event `forge:batch-routing-applied` with the same shape.
//
// Hard constraints (PUSH-97 brief):
//   * NO new npm packages, NO new C++ libs — pure React on top of the
//     existing window.forge surface.
//   * Real impl, no MVP, no stub. The pipe solid is the actual
//     pipeFromPolyline sweep — same kernel call PUSH-45 wires.
//   * Per-row status + a window debug mirror (window.__forgeBatchRouter)
//     so e2e specs / Archie tool calls / plugins can drive the same
//     logic without mounting the React panel first.
//   * Surgical edits to Menus.jsx (one new entry) + App.jsx (one
//     import + one mount).
//   * Multi-cam e2e: 5 named camera angles per the Forge-171 mandate.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';

// ─────────────────────────────────────────────────────────────────────
// Constants

export const FORGE_BATCH_ROUTING_EVENT = 'forge:batch-routing-applied';

// A* tuning that matches PipeRouteWorkbench's defaults. The Class-1
// harness pre-set covers a 200 mm cube of cable tray without busting
// the iteration budget.
const DEFAULT_GRID_SPACING = 1.0;
const DEFAULT_ELBOW_PENALTY = 0.5;
const DEFAULT_BB_MARGIN     = 6.0;
const DEFAULT_MAX_ITERATIONS = 200000;
const DEFAULT_RADIUS_MM = 0.75;

// ─────────────────────────────────────────────────────────────────────
// Pure helpers — exported so e2e specs / Archie / plugins can drive the
// same logic without mounting the React panel first.

/** Build a fresh `route row` with a stable id + safe defaults. The
 *  default start/end are 20 mm apart along +X so the first route has a
 *  visible centerline even before the user edits the fields. */
let _rowSerial = 0;
export function makeDefaultRow(idx = 0) {
  _rowSerial += 1;
  const off = idx * 4;
  return {
    id: `route-${Date.now()}-${_rowSerial}`,
    start: [0,  0 + off, 0],
    end:   [20, 8 + off, 0],
    status: 'pending',
    error: null,
    routedLength: 0,
    elbows: 0,
    bodyId: null,
    handle: null,
    obstacleAabb: null,
  };
}

/** Infer an AABB from a body record. Mirrors SubdivisionSurfacePanel's
 *  `buildCageFromActiveBody` heuristic — every native primitive carries
 *  enough geometry in `params` / `spec` to recover its extent. We DON'T
 *  honour translations — most pipe-rack scenes treat every body as a
 *  local-frame obstacle. If a body has an explicit `aabb`/`bbox` field
 *  we use that directly. Returns null if we cannot infer anything. */
export function bodyToObstacleAabb(body) {
  if (!body || typeof body !== 'object') return null;
  // Explicit AABB hint — preferred when present.
  if (body.aabb && Array.isArray(body.aabb.min) && Array.isArray(body.aabb.max)
      && body.aabb.min.length === 3 && body.aabb.max.length === 3) {
    return { min: body.aabb.min.slice(), max: body.aabb.max.slice() };
  }
  if (body.bbox && typeof body.bbox === 'object'
      && Array.isArray(body.bbox.min) && Array.isArray(body.bbox.max)
      && body.bbox.min.length === 3 && body.bbox.max.length === 3) {
    return { min: body.bbox.min.slice(), max: body.bbox.max.slice() };
  }
  // Synthetic primitive — use the spec dimensions.
  let halfX = null, halfY = null, halfZ = null;
  if (body.spec && typeof body.spec === 'object') {
    const s = body.spec;
    if (typeof s.dx === 'number' && typeof s.dy === 'number'
        && typeof s.dz === 'number') {
      halfX = s.dx / 2; halfY = s.dy / 2; halfZ = s.dz / 2;
    } else if (typeof s.r === 'number' && typeof s.h === 'number') {
      halfX = s.r; halfY = s.r; halfZ = s.h / 2;
    } else if (typeof s.r === 'number') {
      halfX = s.r; halfY = s.r; halfZ = s.r;
    }
  }
  if (halfX == null && body.params && typeof body.params === 'object') {
    const p = body.params;
    if (typeof p.width === 'number')    halfX = p.width    / 2;
    if (typeof p.height === 'number')   halfY = p.height   / 2;
    if (typeof p.distance === 'number') halfZ = p.distance / 2;
    if (typeof p.radius === 'number' && halfX == null) halfX = p.radius;
    if (typeof p.radius === 'number' && halfY == null) halfY = p.radius;
  }
  if (halfX == null && halfY == null && halfZ == null) return null;
  if (halfX == null) halfX = 1;
  if (halfY == null) halfY = 1;
  if (halfZ == null) halfZ = 1;
  // Honour a translation hint if the body carries one. This isn't a
  // perfect transform — it's a routing obstacle, not a render mesh —
  // but it does mean a translated cube doesn't pretend to live at the
  // origin.
  let cx = 0, cy = 0, cz = 0;
  if (body.params && typeof body.params === 'object') {
    if (typeof body.params.tx === 'number') cx = body.params.tx;
    if (typeof body.params.ty === 'number') cy = body.params.ty;
    if (typeof body.params.tz === 'number') cz = body.params.tz;
  }
  return {
    min: [cx - halfX, cy - halfY, cz - halfZ],
    max: [cx + halfX, cy + halfY, cz + halfZ],
  };
}

/** Compute the obstacle list from the live scene at Apply time. We
 *  walk `window.__forgeBodies` and collect every native body's
 *  inferred AABB. Synthetic bodies (subdivision mesh / voxel groups)
 *  are skipped because their AABB is fuzzier and they're usually
 *  visualisation-only. */
export function readSceneObstacles() {
  if (typeof window === 'undefined') return [];
  const all = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  const out = [];
  for (const b of all) {
    if (!b) continue;
    if (b.kind && b.kind !== 'native') continue;
    const aabb = bodyToObstacleAabb(b);
    if (aabb) out.push(aabb);
  }
  return out;
}

/** Compute the AABB of a routed polyline (x0 y0 z0 x1 y1 z1 ...). We
 *  pad it by `radius + grid` so subsequent routes treat the pipe as a
 *  solid tube, not a 1-D line. */
export function polylineToObstacleAabb(poly, radius, pad = 0) {
  if (!poly || poly.length < 3) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i + 2 < poly.length; i += 3) {
    const x = poly[i], y = poly[i + 1], z = poly[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) return null;
  const r = (typeof radius === 'number' && radius > 0) ? radius : 0;
  const p = r + (typeof pad === 'number' ? pad : 0);
  return {
    min: [minX - p, minY - p, minZ - p],
    max: [maxX + p, maxY + p, maxZ + p],
  };
}

/** Run the whole batch. Returns `{ routed, failed, total }` plus a copy
 *  of every committed body record. This is the headless entry point
 *  the panel's Apply button calls and that Archie / plugins can call
 *  directly via `window.__forgeBatchRouter.runBatch(rows, radius)`. */
export function runBatch(rows, radius, opts = {}) {
  if (typeof window === 'undefined') {
    return { routed: 0, failed: 0, total: 0, results: [] };
  }
  const router = window.forge && window.forge.piperoute;
  const part   = window.forge && window.forge.part;
  if (!router || typeof router.route !== 'function') {
    throw new Error('forge.piperoute.route not available');
  }
  if (!part || typeof part.pipeFromPolyline !== 'function') {
    throw new Error('forge.part.pipeFromPolyline not available');
  }

  const gridSpacing  = typeof opts.gridSpacing  === 'number' ? opts.gridSpacing  : DEFAULT_GRID_SPACING;
  const elbowPenalty = typeof opts.elbowPenalty === 'number' ? opts.elbowPenalty : DEFAULT_ELBOW_PENALTY;
  const bbMargin     = typeof opts.bbMargin     === 'number' ? opts.bbMargin     : DEFAULT_BB_MARGIN;
  const maxIters     = typeof opts.maxIterations === 'number' ? opts.maxIterations : DEFAULT_MAX_ITERATIONS;
  const r            = (typeof radius === 'number' && radius > 0) ? radius : DEFAULT_RADIUS_MM;

  // Shared scene obstacles — sampled ONCE per batch. Per the brief
  // every route shares the same map.
  const sceneObstacles = readSceneObstacles();
  // Routes committed during THIS batch — appended to the obstacle map
  // before the next row runs.
  const batchObstacles = [];
  const results = [];

  let routed = 0;
  let failed = 0;
  for (const row of rows) {
    const merged = sceneObstacles.concat(batchObstacles);
    const inputs = {
      start: { position: row.start.slice(), direction: [1, 0, 0] },
      end:   { position: row.end.slice(),   direction: [1, 0, 0] },
      obstacles: merged,
      gridSpacing,
      elbowPenalty,
      bbMargin,
      maxIterations: maxIters,
    };
    let r0 = null;
    let err = null;
    try { r0 = router.route(inputs); } catch (e) { err = e?.message || String(e); }
    if (!r0 || !r0.found || !r0.polyline || r0.polyline.length < 6) {
      failed += 1;
      results.push({
        rowId: row.id,
        ok: false,
        error: err || 'no route found',
        routedLength: r0 ? r0.totalLength : 0,
        elbows: r0 ? r0.elbowCount : 0,
        bodyId: null,
        handle: null,
        obstacleAabb: null,
      });
      continue;
    }
    const poly = Array.from(r0.polyline);
    let handle = null;
    try { handle = part.pipeFromPolyline(poly, r); }
    catch (e) { err = `pipe build failed: ${e?.message || e}`; }
    if (typeof handle !== 'number' || handle <= 0) {
      failed += 1;
      results.push({
        rowId: row.id,
        ok: false,
        error: err || 'pipe build returned no handle',
        routedLength: r0.totalLength,
        elbows: r0.elbowCount,
        bodyId: null,
        handle: null,
        obstacleAabb: null,
      });
      continue;
    }
    const bodyId = `batch-pipe-${Date.now()}-${row.id}-${routed + failed}`;
    const obstacleAabb = polylineToObstacleAabb(poly, r, gridSpacing);
    const bodyRecord = {
      id: bodyId,
      kind: 'native',
      handle,
      toolId: 'routing.batchPipe',
      name: row.label || `Routed pipe ${routed + failed + 1}`,
      params: { radius: r, length: r0.totalLength, elbows: r0.elbowCount },
      aabb: obstacleAabb,
    };
    if (typeof window.__forgeAppendBody === 'function') {
      window.__forgeAppendBody(bodyRecord);
    }
    // Synchronous mirror to window.__forgeBodies so downstream code that
    // polls the global (rather than waiting for the next React render
    // cycle) sees the new body immediately. ForgeShellV4's useEffect
    // re-publishes the same value on the next render so the mirror
    // stays consistent. The BatchRename panel uses the same pattern.
    try {
      if (Array.isArray(window.__forgeBodies)) {
        const cur = window.__forgeBodies;
        const idx = cur.findIndex((b) => b && b.id === bodyId);
        if (idx < 0) window.__forgeBodies = cur.concat([bodyRecord]);
      } else {
        window.__forgeBodies = [bodyRecord];
      }
      // Fire the canonical bodies-changed bus event so sibling panels
      // (Layers / BodyColors / BatchRouting itself) re-read the live
      // scene without waiting for a parent re-render.
      window.dispatchEvent(new CustomEvent('forge:bodies-changed', {
        detail: { bodies: window.__forgeBodies },
      }));
    } catch {}
    if (obstacleAabb) batchObstacles.push(obstacleAabb);
    routed += 1;
    results.push({
      rowId: row.id,
      ok: true,
      error: null,
      routedLength: r0.totalLength,
      elbows: r0.elbowCount,
      bodyId,
      handle,
      obstacleAabb,
    });
  }
  const total = rows.length;
  try {
    window.dispatchEvent(new CustomEvent(FORGE_BATCH_ROUTING_EVENT, {
      detail: { routed, failed, total },
    }));
  } catch {}
  return { routed, failed, total, results };
}

// ─────────────────────────────────────────────────────────────────────
// Styles — right-docked rail matching BatchRenamePanel / BomBalloons /
// SubdivisionSurfacePanel widths so it slots into the existing layout.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 540,
  zIndex: 1332,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  overflow: 'hidden',
};
const HEADER_ROW = {
  display: 'flex', alignItems: 'center', gap: 8,
};
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3,
};
const SECTION_TITLE = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  margin: '4px 0 2px',
};
const SECTION_BOX = {
  background: 'var(--forge-canvas-3, #1b212a)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4,
  padding: 8,
  display: 'flex', flexDirection: 'column', gap: 6,
};
const RADIUS_ROW = {
  display: 'flex', alignItems: 'center', gap: 8,
};
const NUMBER_INPUT = {
  width: 80,
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '3px 6px', borderRadius: 3,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
};
const SMALL_INPUT = {
  width: 56,
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '2px 4px', borderRadius: 3,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
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
  color: 'var(--forge-bad, #ff6363)',
  cursor: 'pointer',
  padding: '2px 6px',
  borderRadius: 3,
  fontSize: 11,
};
const TABLE_BOX = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4,
  background: 'var(--forge-canvas-1, #0e1218)',
};
const TABLE_HEAD_ROW = {
  display: 'grid',
  gridTemplateColumns: '28px 1fr 1fr 60px 28px',
  alignItems: 'center',
  gap: 6,
  padding: '6px 8px',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
  background: 'var(--forge-canvas-2, #161b22)',
  position: 'sticky', top: 0, zIndex: 1,
};
const ROUTE_ROW = (status) => ({
  display: 'grid',
  gridTemplateColumns: '28px 1fr 1fr 60px 28px',
  alignItems: 'center',
  gap: 6,
  padding: '5px 8px',
  borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
  background: status === 'routed'
    ? 'rgba(79, 255, 135, 0.06)'
    : status === 'failed'
      ? 'rgba(255, 99, 99, 0.07)'
      : 'transparent',
});
const ROW_INDEX = {
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10,
  color: 'var(--forge-ink-mute, #9aa1ab)',
  textAlign: 'right',
};
const TRIPLE_INPUT = {
  display: 'flex', gap: 2,
};
const STATUS_TAG = (status) => ({
  display: 'inline-block',
  padding: '1px 6px',
  borderRadius: 'var(--forge-radius-pill, 10px)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: status === 'routed'
    ? '#4ade80'
    : status === 'failed'
      ? 'var(--forge-bad, #ff6363)'
      : 'var(--forge-ink-mute, #9aa1ab)',
});

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

export function BatchRoutingPanel({ open, onClose }) {
  // Seed with TWO rows — the brief's minimum batch size + the e2e
  // contract. Subsequent Add/Remove buttons mutate this list.
  const [rows, setRows] = useState(() => [
    makeDefaultRow(0),
    makeDefaultRow(1),
  ]);
  const [radius, setRadius] = useState(DEFAULT_RADIUS_MM);
  const [summary, setSummary] = useState(null);
  const [obstacleCount, setObstacleCount] = useState(0);

  // Refresh obstacle count whenever the panel is shown OR the live
  // scene's body list changes — gives the user a live "obstacles in
  // scene" chip so they know what the router is dodging.
  useEffect(() => {
    if (!open) return undefined;
    setObstacleCount(readSceneObstacles().length);
    const refresh = () => setObstacleCount(readSceneObstacles().length);
    window.addEventListener('forge:bodies-changed', refresh);
    return () => window.removeEventListener('forge:bodies-changed', refresh);
  }, [open]);

  // Reset rows / summary on every fresh open so the user starts from
  // a known state (matches BatchRenamePanel's UX).
  const openMark = useRef(false);
  useEffect(() => {
    if (open && !openMark.current) {
      openMark.current = true;
      setRows([makeDefaultRow(0), makeDefaultRow(1)]);
      setSummary(null);
    }
    if (!open) openMark.current = false;
  }, [open]);

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, makeDefaultRow(prev.length)]);
    setSummary(null);
  }, []);

  const removeRow = useCallback((id) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setSummary(null);
  }, []);

  const setStartCoord = useCallback((id, axis, val) => {
    setRows((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      const next = r.start.slice();
      next[axis] = Number(val) || 0;
      return { ...r, start: next, status: 'pending', error: null };
    }));
  }, []);
  const setEndCoord = useCallback((id, axis, val) => {
    setRows((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      const next = r.end.slice();
      next[axis] = Number(val) || 0;
      return { ...r, end: next, status: 'pending', error: null };
    }));
  }, []);

  const apply = useCallback(() => {
    let outcome = null;
    try {
      outcome = runBatch(rows, radius);
    } catch (e) {
      setSummary({ error: String(e?.message || e), routed: 0, failed: 0, total: rows.length });
      return;
    }
    // Update per-row status from the results list.
    setRows((prev) => prev.map((r) => {
      const res = outcome.results.find((x) => x.rowId === r.id);
      if (!res) return r;
      return {
        ...r,
        status: res.ok ? 'routed' : 'failed',
        error: res.error || null,
        routedLength: res.routedLength,
        elbows: res.elbows,
        bodyId: res.bodyId,
        handle: res.handle,
        obstacleAabb: res.obstacleAabb,
      };
    }));
    setSummary({
      routed: outcome.routed,
      failed: outcome.failed,
      total: outcome.total,
      error: null,
    });
    // Refresh obstacle count — every committed pipe added an aabb.
    setObstacleCount(readSceneObstacles().length);
  }, [rows, radius]);

  const allValid = useMemo(() => rows.length > 0
    && rows.every((r) => Array.isArray(r.start) && r.start.length === 3
      && Array.isArray(r.end) && r.end.length === 3
      && r.start.some((c, i) => c !== r.end[i])),
  [rows]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div role="dialog"
         aria-label="Batched cable / pipe routing"
         data-testid="forge-batch-routing-panel"
         data-row-count={rows.length}
         data-routed-count={summary ? summary.routed : 0}
         data-failed-count={summary ? summary.failed : 0}
         data-obstacle-count={obstacleCount}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="solid.sweep" size={14} />
        <strong style={{ fontSize: 13 }}>Batch Routing</strong>
        <span data-testid="forge-batch-routing-count"
              style={{
                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                fontSize: 10,
                color: 'var(--forge-ink-mute, #9aa1ab)',
                padding: '1px 6px',
                borderRadius: 'var(--forge-radius-pill, 10px)',
                border: '1px solid var(--forge-rail-edge, #2a2d34)',
              }}>
          {rows.length} routes · {obstacleCount} obstacles
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close batch routing panel"
                data-testid="forge-batch-routing-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={{ color: 'var(--forge-ink-mute, #9aa1ab)', lineHeight: 1.5 }}>
        Define multiple (start, end) pairs. The router uses every native body
        in the scene as a shared obstacle and treats each freshly-routed pipe
        as an obstacle for the next row.
      </div>

      <div style={SECTION_TITLE}>Shared parameters</div>
      <div style={SECTION_BOX}>
        <div style={RADIUS_ROW}>
          <label htmlFor="forge-batch-routing-radius-input"
                 style={{
                   fontSize: 10,
                   color: 'var(--forge-ink-mute, #9aa1ab)',
                   fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                 }}>Pipe radius (mm)</label>
          <input id="forge-batch-routing-radius-input"
                 type="number"
                 step="0.05"
                 min="0.05"
                 value={radius}
                 onChange={(e) => {
                   const v = Number(e.target.value);
                   if (Number.isFinite(v) && v > 0) setRadius(v);
                 }}
                 data-testid="forge-batch-routing-radius"
                 style={NUMBER_INPUT} />
        </div>
      </div>

      <div style={SECTION_TITLE}>Routes ({rows.length})</div>
      <div data-testid="forge-batch-routing-table" style={TABLE_BOX}>
        <div style={TABLE_HEAD_ROW}>
          <span style={{ textAlign: 'right' }}>#</span>
          <span>Start (X Y Z)</span>
          <span>End (X Y Z)</span>
          <span>Status</span>
          <span />
        </div>
        {rows.map((r, i) => (
          <div key={r.id}
               data-testid="forge-batch-routing-row"
               data-row-id={r.id}
               data-status={r.status}
               style={ROUTE_ROW(r.status)}>
            <span style={ROW_INDEX}>{i + 1}</span>
            <div style={TRIPLE_INPUT}>
              {[0, 1, 2].map((axis) => (
                <input key={`s-${axis}`}
                       type="number"
                       step="1"
                       value={r.start[axis]}
                       data-testid={`forge-batch-routing-start-${r.id}-${'xyz'[axis]}`}
                       onChange={(e) => setStartCoord(r.id, axis, e.target.value)}
                       style={SMALL_INPUT} />
              ))}
            </div>
            <div style={TRIPLE_INPUT}>
              {[0, 1, 2].map((axis) => (
                <input key={`e-${axis}`}
                       type="number"
                       step="1"
                       value={r.end[axis]}
                       data-testid={`forge-batch-routing-end-${r.id}-${'xyz'[axis]}`}
                       onChange={(e) => setEndCoord(r.id, axis, e.target.value)}
                       style={SMALL_INPUT} />
              ))}
            </div>
            <span data-testid={`forge-batch-routing-status-${r.id}`}
                  title={r.error || r.status}
                  style={STATUS_TAG(r.status)}>{r.status}</span>
            <button type="button"
                    title="Remove this route from the batch"
                    data-testid={`forge-batch-routing-remove-${r.id}`}
                    onClick={() => removeRow(r.id)}
                    disabled={rows.length <= 1}
                    style={{
                      ...REMOVE_BTN,
                      opacity: rows.length <= 1 ? 0.35 : 1,
                      cursor: rows.length <= 1 ? 'not-allowed' : 'pointer',
                    }}>×</button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button"
                onClick={addRow}
                title="Append a new (start, end) row"
                data-testid="forge-batch-routing-add"
                style={ACTION_BTN('default')}>+ Add route</button>
      </div>

      <footer style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 0 0',
        borderTop: '1px solid var(--forge-rail-edge, #2a2d34)',
      }}>
        {summary ? (
          summary.error ? (
            <span data-testid="forge-batch-routing-error"
                  style={{ fontSize: 11, color: 'var(--forge-bad, #ff6363)' }}>
              {summary.error}
            </span>
          ) : (
            <span data-testid="forge-batch-routing-summary"
                  style={{
                    fontSize: 11,
                    color: 'var(--forge-accent, #4f87ff)',
                  }}>
              Routed {summary.routed}/{summary.total} ·
              {' '}Failed {summary.failed}
            </span>
          )
        ) : (
          <span style={{
            fontSize: 10,
            color: 'var(--forge-ink-mute, #9aa1ab)',
          }}>
            Add routes then press Apply. Failed routes do not stop the batch.
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={apply}
                disabled={!allValid}
                title="Run every route sequentially and commit each as a native pipe body"
                data-testid="forge-batch-routing-apply"
                style={{
                  ...ACTION_BTN('primary'),
                  opacity: allValid ? 1 : 0.5,
                  cursor: allValid ? 'pointer' : 'not-allowed',
                }}>
          Apply
        </button>
      </footer>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.batchRouting` menu action, exposes the
// imperative open/close hooks for plugins / Archie tool calls, and
// surfaces the headless helpers on the window debug mirror.

export function BatchRoutingPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenBatchRoutingPanel  = () => setOpen(true);
    window.__forgeCloseBatchRoutingPanel = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.batchRouting') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    // Expose a debug surface so e2e / Archie tool calls / plugins can
    // drive the batcher without mounting the React panel first.
    window.__forgeBatchRouter = Object.freeze({
      makeDefaultRow,
      bodyToObstacleAabb,
      readSceneObstacles,
      polylineToObstacleAabb,
      runBatch,
      EVENT_NAME: FORGE_BATCH_ROUTING_EVENT,
    });
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenBatchRoutingPanel; } catch {}
      try { delete window.__forgeCloseBatchRoutingPanel; } catch {}
    };
  }, []);
  return <BatchRoutingPanel open={open} onClose={() => setOpen(false)} />;
}

export default BatchRoutingPanel;
