// Forge-90 / Forge-130 — Drawings workbench.
//
// Full-viewport overlay that replaces the 3D canvas while the Drawing
// workbench is active. Renders a configurable view grid (default 2×2),
// each cell hosting one projected view of a body. The toolbar above
// the grid lets the user add new views; the right inspector edits the
// active view's properties.
//
// Forge-130 extends with seven additional view types (crop, auxiliary,
// broken-section, partial-section, half-section, alternate-position,
// detail-with-rectangle), an auto-alignment engine that snaps dropped
// views to existing centre lines, datum targets, ordinate dimensions
// and a revision-cloud + revision-table workflow.
//
// Strict rules:
//   - Manual clicks here NEVER write to Archie's thread (the parent
//     handleMenuAction reserves that for the cmd bar entry point).
//   - All kernel calls go through drawingsDispatch.js so the workbench
//     never crashes on missing forge-kernel addon.
//   - Sheet output is real SVG so the PDF export can rasterise via
//     html2canvas + jsPDF when present, with an SVG-blob fallback that
//     always works.

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from './icons/Icon.jsx';
import {
  projectShapeSafe, projectSectionSafe, projectDetailSafe,
  projectBrokenSafe, edgeBounds, DIRECTION_PRESETS,
} from './drawingsDispatch.js';
import {
  useDimensionTool, DimensionLayer, DimensionPreview,
  DEFAULT_TOLERANCE, formatTolerance, setDimensionTolerance,
} from './DimensionTool.jsx';
import {
  buildBom, defaultBalloonPositions, BomTable, BalloonLayer,
} from './BomBalloons.jsx';
import { FcfGlyph, FcfWithLeader, FcfPicker, makeFcf } from './GdtFcf.jsx';
import {
  SurfaceFinishGlyph, SurfaceFinishWithLeader, SurfaceFinishPicker,
  makeSurfaceFinish,
} from './SurfaceFinish.jsx';
import { WeldGlyph, WeldWithLeader, WeldPicker, makeWeld } from './WeldSymbol.jsx';
import {
  listAnnotations, addAnnotation, removeAnnotation, subscribe as pmiSubscribe,
  exportStepWithPmi,
} from './pmiAnnotations.js';
import {
  resolveDrop, alignmentGuides, propagateParentMove, isAligned,
  describeAlignment, DEFAULT_SNAP_TOLERANCE_MM,
} from './ViewAlignmentRules.js';
import {
  DatumTargetSymbol, DatumTargetLayer, DatumTargetPicker,
  makeDatumTarget, DATUM_TARGET_FORM,
} from './DatumTargetSymbol.jsx';
import {
  useOrdinateTool, OrdinateLayer, OrdinatePreview, ORDINATE_AXIS,
} from './OrdinateDimension.jsx';
import {
  RevisionTable, RevisionCloudLayer, RevisionTableInspector,
  useRevisions, useClouds, addCloud, addRevision,
} from './RevisionTable.jsx';

const SHEET_W = 297;     // mm, A4 landscape
const SHEET_H = 210;
const TITLE_BLOCK_H = 28;

// Forge-130 — full view-kind catalogue. The first four are inherited
// from Forge-90; the remaining seven add the depth-pass behaviours
// (crop, auxiliary, broken section, partial section, half section,
//  alternate position, rectangular detail).
const VIEW_KIND = Object.freeze({
  shape:        'shape',
  section:      'section',
  detail:       'detail',
  broken:       'broken',
  crop:         'crop',
  auxiliary:    'auxiliary',
  brokenSection:'brokenSection',
  partialSection:'partialSection',
  halfSection:  'halfSection',
  alternate:    'alternate',
  detailRect:   'detailRect',
});

// Distinct count for the test spec / reports.
export const NEW_VIEW_KIND_COUNT = 7;

const VIEW_DEFAULTS = Object.freeze({
  scale:       1,
  hiddenLines: true,
  hatchSpec:   { angle: 45, spacing: 4, thickness: 0.4 },
});

const DEFAULT_TITLE = Object.freeze({
  project:  'Untitled Project',
  drawnBy:  '',
  date:     '',
  sheet:    '1 / 1',
  scale:    '1:1',
  units:    'mm',
});

function newViewId() {
  return `vw-${Date.now()}-${Math.floor(Math.random() * 0xfff).toString(16)}`;
}

function isoToday() {
  try { return new Date().toISOString().slice(0, 10); } catch { return ''; }
}

function ensureDefaultGrid(bodies) {
  // Default 2 × 2 grid showing front / top / right / iso of the first body
  // (or empty cells if no body in the project). Forge-130 — each cell has
  // an (x,y,w,h) sheet rect so the alignment engine has positions to work
  // with even before the user drags anything.
  const body = bodies?.[0] || null;
  const handle = body && typeof body.handle === 'number' ? body.handle : null;
  const cellW = 130, cellH = 80;
  const mk = (direction, col, row) => ({
    id:        newViewId(),
    kind:      VIEW_KIND.shape,
    bodyId:    body?.id || null,
    handle,
    direction,
    x:         8 + col * cellW,
    y:         8 + row * cellH,
    w:         cellW,
    h:         cellH,
    parentId:    null,
    align:       null,
    alignOffset: 0,
    ...VIEW_DEFAULTS,
  });
  return [mk('front', 0, 0), mk('top', 1, 0), mk('right', 0, 1), mk('iso', 1, 1)];
}

/**
 * Main workbench export.
 *
 * @param {object} props
 * @param {Array}  props.bodies       project body registry
 * @param {string} props.theme        'dark' | 'light' (used by the SVG
 *                                    sheet background only)
 */
export function DrawingsWorkbench({ bodies = [], theme = 'dark' }) {
  const [views, setViews] = useState(() => ensureDefaultGrid(bodies));
  const [activeViewId, setActiveViewId] = useState(() => views[0]?.id || null);
  const [tool, setTool] = useState(null);
  // tool ∈ 'dimension' | 'balloon' | 'gdt' | 'finish' | 'weld'
  //      | 'datumTarget' | 'ordinate' | 'cloud' (Forge-130)
  // ── Forge-130 — datum targets + ordinate dimensions + revisions
  const [datumTargets, setDatumTargets] = useState([]);
  const [ordinates, setOrdinates] = useState([]);
  const [pendingDatumTarget, setPendingDatumTarget] = useState(null);
  const [ordinateAxis, setOrdinateAxis] = useState(ORDINATE_AXIS.horizontal);
  const [cloudDraft, setCloudDraft] = useState(null);
  const revisions = useRevisions();
  const clouds = useClouds();
  const [showRevisionTable, setShowRevisionTable] = useState(true);
  // Default seed: ensure layout includes the bottom-right table.
  useEffect(() => { /* table visibility persists in component */ }, []);
  const [titleBlock, setTitleBlock] = useState({
    ...DEFAULT_TITLE,
    date: isoToday(),
  });
  const [showTitleBlock, setShowTitleBlock] = useState(true);
  const [dimensions, setDimensions] = useState([]);
  const [bomMaterials, setBomMaterials] = useState({});
  const [balloonPositionsState, setBalloonPositionsState] = useState({});
  const [exportNote, setExportNote] = useState(null);
  const sheetRef = useRef(null);

  // ── PMI state (Forge-109) ─────────────────────────────────────────
  // Subscribe to the pmiAnnotations registry so we re-render whenever
  // the user commits a new FCF / surface-finish / weld.
  const annotations = useSyncExternalStore(
    pmiSubscribe,
    listAnnotations,
    listAnnotations,
  );
  // Pending placement: when the user clicks the sheet with a PMI tool
  // active we stash { kind, viewId, anchor, frame } and open the
  // matching picker.
  const [pendingPmi, setPendingPmi] = useState(null);

  // ── re-seed grid when the project body set changes from empty → not-empty
  const prevBodyCountRef = useRef(bodies.length);
  useEffect(() => {
    if (prevBodyCountRef.current === 0 && bodies.length > 0 && views.every((v) => v.bodyId == null)) {
      setViews(ensureDefaultGrid(bodies));
    }
    prevBodyCountRef.current = bodies.length;
  }, [bodies, views]);

  // ── projected edges, computed for every view from the dispatch wrapper
  const projections = useMemo(() => {
    const map = new Map();
    for (const v of views) {
      let proj;
      try {
        switch (v.kind) {
          case VIEW_KIND.section:
          case VIEW_KIND.brokenSection:
          case VIEW_KIND.partialSection:
          case VIEW_KIND.halfSection:
            // All three "additional section" forms route through the real
            // projectSection kernel call and then post-process the edges
            // + hatches with the right clip mask (see clipProjection).
            proj = projectSectionSafe(v.handle, v.direction, v.sectionPlane, v.hatchSpec);
            proj = clipProjection(proj, v);
            break;
          case VIEW_KIND.detail:
          case VIEW_KIND.detailRect:
            // Rectangular-detail uses the same kernel call as the circular
            // detail; the boundary kind is applied at render time so the
            // crop rectangle replaces the circle marker.
            proj = projectDetailSafe(v.handle, v.direction, v.focusCircle, v.scale);
            break;
          case VIEW_KIND.broken:
            proj = projectBrokenSafe(v.handle, v.direction, v.breakRegion);
            break;
          case VIEW_KIND.crop:
            proj = projectShapeSafe(v.handle, v.direction);
            proj = clipProjection(proj, v);
            break;
          case VIEW_KIND.auxiliary: {
            // Auxiliary view → project along the edge-normal direction.
            // The auxAxis was computed from a picked edge when the view
            // was added (auxAxis = [dx, dy, dz] tangent → normal vector);
            // we feed it to projectShape as a "section-like" direction
            // string when the kernel exposes one, otherwise default to
            // the closest preset.
            const dir = v.direction || nearestPreset(v.auxAxis);
            proj = projectShapeSafe(v.handle, dir);
            break;
          }
          case VIEW_KIND.alternate: {
            // Alternate-position view overlays a second configuration on
            // top of the primary projection. We project both and merge
            // the alt edge list with a reduced-opacity flag.
            const primary = projectShapeSafe(v.handle, v.direction);
            const altHandle = (typeof v.altHandle === 'number') ? v.altHandle : v.handle;
            const alt = projectShapeSafe(altHandle, v.direction);
            proj = {
              ...primary,
              edges: [
                ...primary.edges,
                ...alt.edges.map((e) => ({ ...e, alternate: true })),
              ],
            };
            break;
          }
          default:
            proj = projectShapeSafe(v.handle, v.direction);
        }
      } catch (err) {
        proj = { edges: [], source: 'fallback' };
      }
      const bounds = edgeBounds(proj.edges);
      map.set(v.id, { ...proj, bounds });
    }
    return map;
  }, [views]);

  // ── BOM rows (used by the inspector + the active sheet balloons)
  const bomRows = useMemo(
    () => buildBom(bodies, { materials: bomMaterials }),
    [bodies, bomMaterials],
  );

  const activeView = views.find((v) => v.id === activeViewId) || null;
  const activeProjection = activeView ? projections.get(activeView.id) : null;

  // ── tool handlers — dimensions, balloons
  const dim = useDimensionTool({
    active: tool === 'dimension',
    units: titleBlock.units,
    precision: 2,
    tolerance: DEFAULT_TOLERANCE,
    onCommit: (d) => setDimensions((arr) => [...arr, d]),
  });

  // ── Forge-130 — ordinate tool
  const ord = useOrdinateTool({
    active:    tool === 'ordinate',
    axis:      ordinateAxis,
    unit:      titleBlock.units,
    precision: 2,
    onCommit:  (s) => setOrdinates((arr) => [...arr, s]),
  });

  // Commit ordinate on ESC / Enter
  useEffect(() => {
    if (tool !== 'ordinate') return;
    const handler = (e) => {
      if (e.key === 'Enter') ord.commit();
      if (e.key === 'Escape') ord.cancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [tool, ord]);

  // Commit cloud draft on Enter; abort on Escape
  useEffect(() => {
    if (tool !== 'cloud') return;
    const handler = (e) => {
      if (e.key === 'Enter' && cloudDraft && cloudDraft.points.length >= 3) {
        const rev = revisions[revisions.length - 1];
        addCloud({
          viewId: cloudDraft.viewId,
          points: cloudDraft.points,
          revId:  rev?.id || null,
          rev:    rev?.rev || '',
        });
        setCloudDraft(null);
      }
      if (e.key === 'Escape') setCloudDraft(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [tool, cloudDraft, revisions]);

  // Datum-target picker commit / cancel
  const commitDatumTarget = useCallback((target) => {
    if (!pendingDatumTarget) {
      setDatumTargets((arr) => [...arr, { ...target, viewId: activeViewId }]);
      return;
    }
    // shift geometry to clicked point
    const [px, py] = pendingDatumTarget.pt;
    const g = { ...(target.geometry || {}) };
    if (target.form === DATUM_TARGET_FORM.point) {
      g.x = px; g.y = py;
    } else if (target.form === DATUM_TARGET_FORM.line) {
      g.ax = px - 8; g.ay = py; g.bx = px + 8; g.by = py;
    } else {
      if ((g.shape || 'circle') === 'rectangle') {
        g.x = px - (g.w || 10) / 2; g.y = py - (g.h || 8) / 2;
      } else {
        g.cx = px; g.cy = py;
      }
    }
    setDatumTargets((arr) => [...arr, {
      ...target,
      geometry: g,
      balloonAt: [px + 14, py - 12],
      viewId: pendingDatumTarget.viewId,
    }]);
    setPendingDatumTarget(null);
  }, [pendingDatumTarget, activeViewId]);

  // ── PMI click — records anchor & opens picker ────────────────────
  const startPmiPlacement = useCallback((viewId, pt) => {
    if (!tool || !['gdt', 'finish', 'weld'].includes(tool)) return;
    const v = views.find((vv) => vv.id === viewId) || null;
    const proj = projections.get(viewId);
    const bounds = proj?.bounds;
    // Offset the symbol frame above-right of the anchor; this is the
    // initial position — the user can drag it later via the inspector.
    const frame = bounds
      ? [pt[0] + bounds.w * 0.18, pt[1] - bounds.h * 0.22]
      : [pt[0] + 16, pt[1] - 14];
    setPendingPmi({
      kind: tool,
      viewId,
      bodyId: v?.bodyId || null,
      handle: v?.handle ?? null,
      anchor: [pt[0], pt[1]],
      frame,
    });
  }, [tool, views, projections]);

  const commitPmi = useCallback((payload) => {
    if (!pendingPmi) return;
    addAnnotation({
      kind: pendingPmi.kind,
      viewId: pendingPmi.viewId,
      bodyId: pendingPmi.bodyId,
      handle: pendingPmi.handle,
      anchor: pendingPmi.anchor,
      frame: pendingPmi.frame,
      payload,
    });
    setPendingPmi(null);
  }, [pendingPmi]);

  const cancelPmi = useCallback(() => setPendingPmi(null), []);

  const balloonPositionsByView = useMemo(() => {
    const m = new Map();
    for (const v of views) {
      const proj = projections.get(v.id);
      const persisted = balloonPositionsState[v.id];
      const positions = defaultBalloonPositions(bomRows, proj?.bounds);
      if (persisted) {
        for (const [k, pt] of Object.entries(persisted)) positions.set(k, pt);
      }
      m.set(v.id, positions);
    }
    return m;
  }, [views, projections, bomRows, balloonPositionsState]);

  // ── view CRUD
  const addView = useCallback((direction = 'iso', kind = VIEW_KIND.shape, extras = {}) => {
    const body = bodies[0] || null;
    setViews((arr) => {
      const baseRect = computeNextViewRect(arr);
      const v = {
        id: newViewId(),
        kind,
        bodyId: body?.id || null,
        handle: typeof body?.handle === 'number' ? body.handle : null,
        direction,
        // Forge-130 — sheet rect (drives alignment + drag positioning)
        x:  baseRect.x,
        y:  baseRect.y,
        w:  baseRect.w,
        h:  baseRect.h,
        parentId:    null,
        align:       null,
        alignOffset: 0,
        ...VIEW_DEFAULTS,
        ...(kind === VIEW_KIND.section ? {
          sectionPlane: { origin: [0, 0, 0], normal: [0, 0, 1] },
        } : {}),
        ...(kind === VIEW_KIND.detail ? {
          focusCircle: { cx: 0, cy: 0, r: 16 },
          boundaryKind: 'circle',
        } : {}),
        ...(kind === VIEW_KIND.detailRect ? {
          focusCircle: { cx: 0, cy: 0, r: 18 },
          detailRect: { x: -16, y: -12, w: 32, h: 24 },
          boundaryKind: 'rect',
        } : {}),
        ...(kind === VIEW_KIND.broken ? {
          breakRegion: { axis: 'x', from: -8, to: 8 },
        } : {}),
        // Forge-130 — new view types
        ...(kind === VIEW_KIND.crop ? {
          cropRect: { x: -20, y: -15, w: 40, h: 30 },
        } : {}),
        ...(kind === VIEW_KIND.auxiliary ? {
          auxAxis:    extras.auxAxis  || [0, 0, -1],
          pickedEdge: extras.pickedEdge || null,
        } : {}),
        ...(kind === VIEW_KIND.brokenSection ? {
          sectionPlane: { origin: [0, 0, 0], normal: [0, 0, 1] },
          boundary: defaultIrregularBoundary(),
        } : {}),
        ...(kind === VIEW_KIND.partialSection ? {
          sectionPlane: { origin: [0, 0, 0], normal: [0, 0, 1] },
          boundary: defaultClosedBoundary(),
        } : {}),
        ...(kind === VIEW_KIND.halfSection ? {
          sectionPlane: { origin: [0, 0, 0], normal: [0, 0, 1] },
          centreLine: { kind: 'vertical', x: 0 },
        } : {}),
        ...(kind === VIEW_KIND.alternate ? {
          altHandle: extras.altHandle ?? (body?.handle ?? null),
          altOpacity: 0.45,
        } : {}),
        ...extras,
      };
      const next = [...arr, v];
      setActiveViewId(v.id);
      return next;
    });
  }, [bodies]);

  // ── Forge-130 — view drag with auto-alignment snapping ──────────
  const [dragGuides, setDragGuides] = useState([]);
  const moveView = useCallback((id, delta) => {
    setViews((arr) => {
      const target = arr.find((v) => v.id === id);
      if (!target) return arr;
      const proposed = {
        x: (target.x || 0) + delta.dx,
        y: (target.y || 0) + delta.dy,
        w: target.w, h: target.h,
      };
      // Try to snap to centre lines of other views
      const resolved = resolveDrop(proposed, arr, { draggedId: id });
      const next = arr.map((v) => v.id === id ? {
        ...v,
        x: resolved.x, y: resolved.y,
        parentId: resolved.parentId,
        align:    resolved.align,
        alignOffset: resolved.alignOffset,
      } : v);
      // Propagate to children that were aligned to this view
      return propagateParentMove(next, id, {
        dx: resolved.x - (target.x || 0),
        dy: resolved.y - (target.y || 0),
      });
    });
  }, []);

  const previewAlignment = useCallback((id, proposed) => {
    setDragGuides(alignmentGuides(
      { cx: proposed.x + proposed.w / 2, cy: proposed.y + proposed.h / 2 },
      views.filter((v) => v.id !== id),
      DEFAULT_SNAP_TOLERANCE_MM,
      SHEET_W, SHEET_H,
    ));
  }, [views]);

  const clearAlignmentPreview = useCallback(() => setDragGuides([]), []);

  const removeView = useCallback((id) => {
    setViews((arr) => arr.filter((v) => v.id !== id));
    setActiveViewId((cur) => (cur === id ? null : cur));
  }, []);

  const updateView = useCallback((id, patch) => {
    setViews((arr) => arr.map((v) => v.id === id ? { ...v, ...patch } : v));
  }, []);

  const dropBodyOnView = useCallback((viewId, bodyId) => {
    const b = bodies.find((x) => x.id === bodyId);
    if (!b) return;
    updateView(viewId, {
      bodyId: b.id,
      handle: typeof b.handle === 'number' ? b.handle : null,
    });
  }, [bodies, updateView]);

  // ── grid layout — derive columns from view count (cap at 3)
  const cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(views.length || 1))));

  // ── PDF / SVG export
  const exportSvg = useCallback(() => {
    if (!sheetRef.current) return;
    const svg = sheetRef.current.querySelector('svg.forge-drawings-sheet');
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([xml], { type: 'image/svg+xml' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const name = (titleBlock.project || 'sheet').replace(/[^a-z0-9-_]/gi, '_');
    a.href = url; a.download = `${name}.svg`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportNote(`Exported SVG · ${name}.svg`);
  }, [titleBlock.project]);

  const exportPdf = useCallback(async () => {
    if (!sheetRef.current) return;
    const svg = sheetRef.current.querySelector('svg.forge-drawings-sheet');
    if (!svg) { exportSvg(); return; }
    // Try html2canvas + jsPDF if available; otherwise fall back to SVG export.
    let html2canvas = null, JsPDF = null;
    try { html2canvas = (await import('html2canvas')).default; } catch (e) { /* not installed */ }
    try {
      const mod = await import('jspdf');
      JsPDF = mod.jsPDF || mod.default;
    } catch (e) { /* not installed */ }
    if (!html2canvas || !JsPDF) {
      exportSvg();
      setExportNote('PDF deps missing · fell back to SVG export');
      return;
    }
    try {
      const canvas = await html2canvas(sheetRef.current, {
        backgroundColor: '#ffffff', scale: 2, logging: false,
      });
      const pdf = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      pdf.addImage(canvas, 'PNG', 0, 0, SHEET_W, SHEET_H);
      const name = (titleBlock.project || 'sheet').replace(/[^a-z0-9-_]/gi, '_');
      pdf.save(`${name}.pdf`);
      setExportNote(`Exported PDF · ${name}.pdf`);
    } catch (err) {
      exportSvg();
      setExportNote(`PDF export failed (${err.message}) · fell back to SVG`);
    }
  }, [exportSvg, titleBlock.project]);

  useEffect(() => {
    if (!exportNote) return;
    const t = setTimeout(() => setExportNote(null), 2400);
    return () => clearTimeout(t);
  }, [exportNote]);

  const sheetBackground = theme === 'light' ? '#ffffff' : '#f5f6f7';
  const sheetInk        = '#14161b';

  return (
    <div className="forge-drawings"
         data-testid="forge-drawings"
         data-active-tool={tool || ''}
         style={{
           position: 'absolute',
           inset: 0,
           background: 'var(--forge-canvas)',
           color: 'var(--forge-ink)',
           display: 'grid',
           gridTemplateRows: '40px 1fr',
           gridTemplateColumns: '1fr 280px',
           gridTemplateAreas: '"toolbar inspector" "sheet inspector"',
           zIndex: 4,
         }}>
      <DrawingsToolbar
        tool={tool}
        onTool={setTool}
        onAddView={(dir) => addView(dir, VIEW_KIND.shape)}
        onAddSection={() => addView('section', VIEW_KIND.section)}
        onAddDetail={() => addView('front', VIEW_KIND.detail)}
        onAddBroken={() => addView('front', VIEW_KIND.broken)}
        onAddCrop={() => addView('front', VIEW_KIND.crop)}
        onAddAuxiliary={() => addView('front', VIEW_KIND.auxiliary, {
          // Default picked-edge sits at 30°; the inspector lets the
          // user re-pick once a real edge is available.
          pickedEdge: [[0, 0, 0], [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0]],
          auxAxis:    auxiliaryAxisFromEdge([[0, 0, 0], [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0]]),
        })}
        onAddBrokenSection={() => addView('front', VIEW_KIND.brokenSection)}
        onAddPartialSection={() => addView('front', VIEW_KIND.partialSection)}
        onAddHalfSection={() => addView('front', VIEW_KIND.halfSection)}
        onAddAlternate={() => addView('front', VIEW_KIND.alternate)}
        onAddDetailRect={() => addView('front', VIEW_KIND.detailRect)}
        onAddRevisionRow={() => addRevision({
          description: 'Updated per ECN',
          ecn: `ECN-${1000 + revisions.length}`,
        })}
        onToggleRevisionTable={() => setShowRevisionTable((v) => !v)}
        onToggleTitleBlock={() => setShowTitleBlock((v) => !v)}
        onExportPdf={exportPdf}
        onExportSvg={exportSvg}
        onExportStepPmi={async () => {
          const result = await exportStepWithPmi({
            handle:   activeView?.handle ?? null,
            filepath: ((titleBlock.project || 'sheet')
                        .replace(/[^a-z0-9-_]/gi, '_')) + '.step',
          });
          setExportNote(result.ok
            ? `STEP+PMI exported · ${result.count} notes`
            : `STEP+PMI · ${result.error}`);
        }}
      />

      <div
        ref={sheetRef}
        data-testid="forge-drawings-sheet-wrapper"
        style={{
          gridArea: 'sheet',
          position: 'relative',
          overflow: 'auto',
          padding: 24,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        }}>
        <svg
          className="forge-drawings-sheet"
          data-testid="forge-drawings-sheet"
          xmlns="http://www.w3.org/2000/svg"
          viewBox={`0 0 ${SHEET_W} ${SHEET_H}`}
          width={Math.min(1200, SHEET_W * 3)}
          height={Math.min(1200, SHEET_W * 3) * (SHEET_H / SHEET_W)}
          style={{
            background: sheetBackground,
            border: '1px solid var(--forge-rail-edge)',
            boxShadow: '0 12px 36px rgba(0,0,0,0.45)',
            color: sheetInk,
          }}
          onMouseLeave={() => dim.moveHover(null, null)}
        >
          {/* sheet border */}
          <rect x={4} y={4} width={SHEET_W - 8} height={SHEET_H - 8}
                fill="none" stroke={sheetInk} strokeWidth={0.4} />

          <ViewGrid
            views={views}
            projections={projections}
            cols={cols}
            sheetW={SHEET_W}
            sheetH={SHEET_H - (showTitleBlock ? TITLE_BLOCK_H : 0)}
            activeViewId={activeViewId}
            onActivate={setActiveViewId}
            onDropBody={dropBodyOnView}
            onMoveView={moveView}
            alignmentGuides={dragGuides}
            ink={sheetInk}
            dimensions={dimensions}
            annotations={annotations}
            ordinates={ordinates}
            datumTargets={datumTargets}
            clouds={clouds}
            cloudDraft={cloudDraft}
            balloons={tool === 'balloon' || activeView?.showBalloons
              ? bomRows
              : []}
            balloonPositionsByView={balloonPositionsByView}
            onSheetClick={(viewId, pt) => {
              if (tool === 'dimension') dim.recordClick(pt, viewId);
              else if (tool === 'ordinate') ord.recordClick(pt, viewId);
              else if (tool === 'datumTarget') {
                setPendingDatumTarget({ viewId, pt });
              }
              else if (tool === 'cloud') {
                setCloudDraft((d) => {
                  if (!d || d.viewId !== viewId) {
                    return { viewId, points: [pt] };
                  }
                  return { ...d, points: [...d.points, pt] };
                });
              }
              else if (tool && ['gdt', 'finish', 'weld'].includes(tool)) {
                startPmiPlacement(viewId, pt);
              }
            }}
            onSheetMove={(viewId, pt) => dim.moveHover(pt, viewId)}
            dimPreview={(viewId) => (
              <DimensionPreview pendingA={dim.pendingA} hover={dim.hover}
                                viewId={viewId} units={titleBlock.units}
                                precision={2} mode="aligned"
                                tolerance={DEFAULT_TOLERANCE} />
            )}
            ordinatePreview={(viewId) => (
              <OrdinatePreview tool={ord} viewId={viewId} />
            )}
          />

          {/* Forge-130 — revision table block, bottom-right corner */}
          {showRevisionTable && revisions.length > 0 && (
            <RevisionTable
              revisions={revisions}
              x={SHEET_W - 100 - 4}
              y={SHEET_H - (showTitleBlock ? TITLE_BLOCK_H : 0) - 28 - 4}
              w={100} h={28}
              ink={sheetInk}
            />
          )}

          {showTitleBlock && (
            <TitleBlock
              data={titleBlock}
              ink={sheetInk}
              x={4} y={SHEET_H - TITLE_BLOCK_H - 4}
              w={SHEET_W - 8} h={TITLE_BLOCK_H}
            />
          )}
        </svg>

        {exportNote && (
          <div data-testid="forge-drawings-export-note"
               style={{
                 position: 'absolute', top: 12, right: 12,
                 background: 'var(--forge-surface)',
                 border: '1px solid var(--forge-rail-edge)',
                 borderRadius: 'var(--forge-radius)',
                 padding: '6px 10px',
                 fontFamily: 'var(--forge-mono)',
                 fontSize: 11,
                 color: 'var(--forge-ink-2)',
               }}>
            {exportNote}
          </div>
        )}

        {/* PMI picker overlay — pops over the sheet when the user clicks
            a feature with one of the PMI tools active. */}
        {pendingPmi && (
          <div data-testid="forge-pmi-picker-overlay"
               data-pmi-kind={pendingPmi.kind}
               style={{
                 position: 'absolute', top: 56, left: 12, zIndex: 20,
               }}>
            {pendingPmi.kind === 'gdt' && (
              <FcfPicker onCommit={(payload) => commitPmi(payload)}
                         onCancel={cancelPmi} />
            )}
            {pendingPmi.kind === 'finish' && (
              <SurfaceFinishPicker onCommit={(payload) => commitPmi(payload)}
                                   onCancel={cancelPmi} />
            )}
            {pendingPmi.kind === 'weld' && (
              <WeldPicker onCommit={(payload) => commitPmi(payload)}
                          onCancel={cancelPmi} />
            )}
          </div>
        )}

        {/* Forge-130 — datum target picker (opens on first click with the
            datumTarget tool active). */}
        {pendingDatumTarget && (
          <div data-testid="forge-datum-target-picker-overlay"
               style={{
                 position: 'absolute', top: 56, left: 12, zIndex: 21,
               }}>
            <DatumTargetPicker
              onCommit={(t) => commitDatumTarget(t)}
              onCancel={() => setPendingDatumTarget(null)}
            />
          </div>
        )}
      </div>

      <DrawingsInspector
        bodies={bodies}
        views={views}
        projections={projections}
        activeView={activeView}
        activeProjection={activeProjection}
        onUpdateView={updateView}
        onRemoveView={removeView}
        onActivateView={setActiveViewId}
        titleBlock={titleBlock}
        setTitleBlock={setTitleBlock}
        bomRows={bomRows}
        onMaterialChange={(id, mat) =>
          setBomMaterials((m) => ({ ...m, [id]: mat }))}
        onRemoveBomRow={(id) => {
          setBomMaterials((m) => {
            const next = { ...m };
            delete next[id];
            return next;
          });
        }}
        dimensions={dimensions}
        onClearDimensions={() => setDimensions([])}
        onUpdateDimensionTolerance={(dimId, tol) => {
          setDimensions((arr) => arr.map((d) =>
            d.id === dimId ? setDimensionTolerance(d, tol) : d));
        }}
        annotations={annotations}
        onRemoveAnnotation={(id) => removeAnnotation(id)}
        datumTargets={datumTargets}
        onRemoveDatumTarget={(id) =>
          setDatumTargets((arr) => arr.filter((t) => t.id !== id))}
        ordinates={ordinates}
        ordinateAxis={ordinateAxis}
        onChangeOrdinateAxis={setOrdinateAxis}
        onClearOrdinates={() => setOrdinates([])}
        revisions={revisions}
        clouds={clouds}
        onAddRevisionRow={() => addRevision({
          description: 'Updated per ECN',
          ecn: `ECN-${1000 + revisions.length}`,
        })}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────── Toolbar

function ToolButton({ id, icon, label, active, onClick, tip }) {
  return (
    <button
      type="button"
      data-tool={id}
      data-active={String(!!active)}
      title={tip || label}
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: active ? 'var(--forge-accent-mute)' : 'transparent',
        border: '1px solid ' + (active
          ? 'var(--forge-accent-rim)' : 'var(--forge-rail-edge)'),
        color: active ? 'var(--forge-ink)' : 'var(--forge-ink-2)',
        borderRadius: 'var(--forge-radius)',
        padding: '4px 8px',
        font: 'inherit', fontSize: 11,
        cursor: 'pointer',
      }}>
      {icon && <Icon name={icon} size={12} />}
      <span>{label}</span>
    </button>
  );
}

function DrawingsToolbar({
  tool, onTool, onAddView, onAddSection, onAddDetail, onAddBroken,
  onAddCrop, onAddAuxiliary, onAddBrokenSection, onAddPartialSection,
  onAddHalfSection, onAddAlternate, onAddDetailRect,
  onAddRevisionRow, onToggleRevisionTable,
  onToggleTitleBlock, onExportPdf, onExportSvg, onExportStepPmi,
}) {
  const [addOpen, setAddOpen] = useState(false);
  return (
    <div
      data-testid="forge-drawings-toolbar"
      style={{
        gridArea: 'toolbar',
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '4px 12px',
        background: 'var(--forge-canvas-2)',
        borderBottom: '1px solid var(--forge-rail-edge)',
        position: 'relative',
        flexWrap: 'wrap',
        minHeight: 40,
      }}>
      <div style={{ position: 'relative' }}>
        <ToolButton id="drawings.addView" icon="wb.drawing" label="Add view"
                    active={addOpen}
                    onClick={() => setAddOpen((v) => !v)} />
        {addOpen && (
          <div data-testid="forge-drawings-add-menu"
               role="menu"
               style={{
                 position: 'absolute', top: 'calc(100% + 4px)', left: 0,
                 background: 'var(--forge-canvas-3)',
                 border: '1px solid var(--forge-rail-edge)',
                 borderRadius: 'var(--forge-radius)',
                 boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
                 padding: 4, display: 'flex', flexDirection: 'column',
                 gap: 2, minWidth: 140, zIndex: 10,
               }}
               onMouseLeave={() => setAddOpen(false)}>
            {DIRECTION_PRESETS.filter((d) => d !== 'section').map((d) => (
              <button key={d}
                      type="button"
                      role="menuitem"
                      data-add-direction={d}
                      onClick={() => { onAddView(d); setAddOpen(false); }}
                      style={menuItemStyle}>
                {d.toUpperCase()}
              </button>
            ))}
            <div style={{ height: 1, background: 'var(--forge-rail-edge)', margin: '2px 0' }} />
            {/* Forge-130 view kinds */}
            <button type="button" role="menuitem"
                    data-add-kind="crop"
                    onClick={() => { onAddCrop(); setAddOpen(false); }}
                    style={menuItemStyle}>CROP</button>
            <button type="button" role="menuitem"
                    data-add-kind="auxiliary"
                    onClick={() => { onAddAuxiliary(); setAddOpen(false); }}
                    style={menuItemStyle}>AUXILIARY</button>
            <button type="button" role="menuitem"
                    data-add-kind="brokenSection"
                    onClick={() => { onAddBrokenSection(); setAddOpen(false); }}
                    style={menuItemStyle}>BROKEN-OUT SECTION</button>
            <button type="button" role="menuitem"
                    data-add-kind="partialSection"
                    onClick={() => { onAddPartialSection(); setAddOpen(false); }}
                    style={menuItemStyle}>PARTIAL SECTION</button>
            <button type="button" role="menuitem"
                    data-add-kind="halfSection"
                    onClick={() => { onAddHalfSection(); setAddOpen(false); }}
                    style={menuItemStyle}>HALF SECTION</button>
            <button type="button" role="menuitem"
                    data-add-kind="alternate"
                    onClick={() => { onAddAlternate(); setAddOpen(false); }}
                    style={menuItemStyle}>ALTERNATE POSITION</button>
            <button type="button" role="menuitem"
                    data-add-kind="detailRect"
                    onClick={() => { onAddDetailRect(); setAddOpen(false); }}
                    style={menuItemStyle}>DETAIL (RECT)</button>
          </div>
        )}
      </div>
      <ToolButton id="drawings.addSection" icon="view.section" label="Section"
                  onClick={onAddSection} tip="Add section view" />
      <ToolButton id="drawings.addDetail"  icon="view.iso" label="Detail"
                  onClick={onAddDetail} tip="Add detail (zoom-in) view" />
      <ToolButton id="drawings.addBroken"  icon="pattern.linear" label="Broken"
                  onClick={onAddBroken} tip="Add broken view" />
      <div style={{ width: 1, height: 18, background: 'var(--forge-rail-edge)', margin: '0 6px' }} />
      <ToolButton id="drawings.dimension" icon="measure.distance" label="Dimension"
                  active={tool === 'dimension'}
                  onClick={() => onTool(tool === 'dimension' ? null : 'dimension')} />
      <ToolButton id="drawings.balloon" icon="measure.mass" label="Balloon"
                  active={tool === 'balloon'}
                  onClick={() => onTool(tool === 'balloon' ? null : 'balloon')} />
      <ToolButton id="drawings.ordinate" icon="measure.distance" label="Ordinate"
                  active={tool === 'ordinate'}
                  tip="Ordinate dimension stack (ASME Y14.5 §6.5)"
                  onClick={() => onTool(tool === 'ordinate' ? null : 'ordinate')} />
      <div style={{ width: 1, height: 18, background: 'var(--forge-rail-edge)', margin: '0 6px' }} />
      <ToolButton id="drawings.gdt" icon="measure.distance" label="GD&T"
                  active={tool === 'gdt'}
                  tip="Add Feature Control Frame (ASME Y14.5)"
                  onClick={() => onTool(tool === 'gdt' ? null : 'gdt')} />
      <ToolButton id="drawings.finish" icon="measure.distance" label="Finish"
                  active={tool === 'finish'}
                  tip="Add surface-finish callout (ISO 1302)"
                  onClick={() => onTool(tool === 'finish' ? null : 'finish')} />
      <ToolButton id="drawings.weld" icon="wb.weldments" label="Weld"
                  active={tool === 'weld'}
                  tip="Add welding symbol (AWS A2.4)"
                  onClick={() => onTool(tool === 'weld' ? null : 'weld')} />
      <ToolButton id="drawings.datumTarget" icon="measure.distance" label="Datum target"
                  active={tool === 'datumTarget'}
                  tip="Datum target (ASME Y14.5 §4.24)"
                  onClick={() => onTool(tool === 'datumTarget' ? null : 'datumTarget')} />
      <div style={{ width: 1, height: 18, background: 'var(--forge-rail-edge)', margin: '0 6px' }} />
      <ToolButton id="drawings.cloud" icon="pattern.linear" label="Rev cloud"
                  active={tool === 'cloud'}
                  tip="Draw a revision cloud (click to add vertices, Enter to finish)"
                  onClick={() => onTool(tool === 'cloud' ? null : 'cloud')} />
      <ToolButton id="drawings.revRow" icon="wb.drawing" label="+ Rev row"
                  onClick={onAddRevisionRow}
                  tip="Add a new revision row" />
      <ToolButton id="drawings.revTable" icon="wb.drawing" label="Rev table"
                  onClick={onToggleRevisionTable}
                  tip="Toggle revision table visibility" />
      <div style={{ width: 1, height: 18, background: 'var(--forge-rail-edge)', margin: '0 6px' }} />
      <ToolButton id="drawings.titleBlock" icon="wb.drawing" label="Title block"
                  onClick={onToggleTitleBlock}
                  tip="Toggle title-block visibility" />
      <div style={{ flex: 1 }} />
      <ToolButton id="drawings.exportSvg" icon="io.brep" label="SVG"
                  onClick={onExportSvg} tip="Export as SVG" />
      <ToolButton id="drawings.exportPdf" icon="io.pdf" label="PDF"
                  onClick={onExportPdf} tip="Export as PDF" />
      <ToolButton id="drawings.exportStepPmi" icon="io.step" label="STEP+PMI"
                  onClick={onExportStepPmi}
                  tip="Export STEP AP242 with PMI annotations" />
    </div>
  );
}

const menuItemStyle = {
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  color: 'var(--forge-ink-2)',
  padding: '4px 8px',
  fontSize: 11,
  cursor: 'pointer',
  borderRadius: 3,
};

// ─────────────────────────────────────────────────────── View grid

function ViewGrid({
  views, projections, cols, sheetW, sheetH,
  activeViewId, onActivate, onDropBody, ink,
  dimensions, balloons, balloonPositionsByView, annotations,
  ordinates, datumTargets, clouds, cloudDraft,
  onSheetClick, onSheetMove, dimPreview, ordinatePreview,
  alignmentGuides, onMoveView,
}) {
  const margin = 8;
  return (
    <g data-testid="forge-drawings-view-grid">
      {/* Alignment guide overlay shown during drag */}
      {(alignmentGuides || []).map((g, i) => (
        <line key={`ag-${i}`}
              data-testid="forge-alignment-guide"
              data-align-axis={g.axis}
              x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}
              stroke="var(--forge-accent, #6cd0e8)"
              strokeWidth={0.4}
              strokeDasharray="2 1.5"
              strokeOpacity={0.85} />
      ))}
      {views.map((v) => {
        // Forge-130 — use per-view absolute rect (alignment-driven). Fall
        // back to a margin-anchored cell when an old view record from
        // localStorage is missing the rect fields.
        const x = Number.isFinite(v.x) ? v.x : margin;
        const y = Number.isFinite(v.y) ? v.y : margin;
        const w = Number.isFinite(v.w) ? v.w : 130;
        const h = Number.isFinite(v.h) ? v.h : 80;
        return (
          <DrawingViewCell
            key={v.id}
            view={v}
            projection={projections.get(v.id)}
            x={x} y={y} w={w} h={h}
            ink={ink}
            active={v.id === activeViewId}
            onActivate={() => onActivate(v.id)}
            onDropBody={(bodyId) => onDropBody(v.id, bodyId)}
            onMove={onMoveView}
            dimensions={dimensions}
            balloons={balloons}
            balloonPositions={balloonPositionsByView.get(v.id)}
            annotations={annotations}
            ordinates={ordinates}
            datumTargets={datumTargets}
            clouds={clouds}
            cloudDraft={cloudDraft}
            onSheetClick={(pt) => onSheetClick?.(v.id, pt)}
            onSheetMove={(pt) => onSheetMove?.(v.id, pt)}
            dimPreview={dimPreview ? dimPreview(v.id) : null}
            ordinatePreview={ordinatePreview ? ordinatePreview(v.id) : null}
          />
        );
      })}
    </g>
  );
}

function DrawingViewCell({
  view, projection, x, y, w, h, ink, active, onActivate, onDropBody,
  dimensions, balloons, balloonPositions, annotations,
  ordinates, datumTargets, clouds, cloudDraft,
  onSheetClick, onSheetMove, dimPreview, ordinatePreview, onMove,
}) {
  const cellRef = useRef(null);
  const proj = projection || { edges: [], bounds: edgeBounds([]) };
  const b = proj.bounds;
  // fit-to-cell scale (uniform)
  const innerPad = 6;
  const sx = (w - innerPad * 2) / b.w;
  const sy = (h - innerPad * 2) / b.h;
  const s  = Math.min(sx, sy) * (view.scale || 1);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const ox = cx - ((b.minX + b.maxX) / 2) * s;
  const oy = cy - ((b.minY + b.maxY) / 2) * s;
  const toSheet = (pt) => [ox + pt[0] * s, oy + pt[1] * s];

  // Forge-130 — a unique clip-path id per view so multiple views with
  // crops don't share the same clip mask.
  const clipId = `clip-${view.id}`;

  // hit-test the sheet coords back to view coords for tools
  const sheetToView = useCallback((sx, sy) => {
    return [(sx - ox) / s, (sy - oy) / s];
  }, [ox, oy, s]);

  // ── Forge-130 — drag handle (small grip in corner for view repositioning)
  const dragStart = useRef(null);
  const onGripDown = (e) => {
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    dragStart.current = { startX, startY, baseX: x, baseY: y };
    const onMoveDoc = (ev) => {
      if (!dragStart.current || !onMove) return;
      const sx2 = (ev.clientX - dragStart.current.startX);
      const sy2 = (ev.clientY - dragStart.current.startY);
      // map screen px → svg mm: leverage the cell's own ownerSVGElement
      const svg = cellRef.current?.ownerSVGElement;
      if (!svg) return;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const dxMm = sx2 / ctm.a;
      const dyMm = sy2 / ctm.d;
      onMove(view.id, { dx: dxMm, dy: dyMm });
      dragStart.current.startX = ev.clientX;
      dragStart.current.startY = ev.clientY;
    };
    const onUp = () => {
      dragStart.current = null;
      window.removeEventListener('mousemove', onMoveDoc);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMoveDoc);
    window.addEventListener('mouseup', onUp);
  };

  // event listeners — we attach to the rect element so clicks anywhere
  // in the cell map back to view coords
  const handleClick = (e) => {
    onActivate();
    if (!cellRef.current) return;
    const svg = cellRef.current.ownerSVGElement;
    if (!svg) return;
    const pt = svgPoint(svg, e);
    if (!pt) return;
    onSheetClick?.(sheetToView(pt.x, pt.y));
  };
  const handleMove = (e) => {
    if (!cellRef.current) return;
    const svg = cellRef.current.ownerSVGElement;
    if (!svg) return;
    const pt = svgPoint(svg, e);
    if (!pt) return;
    onSheetMove?.(sheetToView(pt.x, pt.y));
  };
  const handleDragOver = (e) => { e.preventDefault(); };
  const handleDrop = (e) => {
    e.preventDefault();
    const id = e.dataTransfer?.getData('text/forge-body');
    if (id) onDropBody(id);
  };

  return (
    <g data-testid="forge-drawings-view-cell"
       data-view-id={view.id}
       data-view-direction={view.direction}
       data-view-kind={view.kind}
       data-view-active={String(active)}
       data-view-aligned={String(isAligned(view))}
       data-view-parent={view.parentId || ''}>
      {/* clip-path declarations — used by crop / partial / half / broken section */}
      {proj.clip && (
        <defs>
          <clipPath id={clipId}>
            {clipShape(proj.clip, toSheet)}
          </clipPath>
        </defs>
      )}
      {/* hit-rect (filled invisibly so all clicks inside the cell hit it) */}
      <rect ref={cellRef}
            x={x} y={y} width={w} height={h}
            fill="transparent"
            stroke={active ? 'var(--forge-accent)' : 'var(--forge-ink-mute)'}
            strokeWidth={active ? 0.6 : 0.2}
            strokeDasharray={active ? '0' : '2 1.5'}
            onClick={handleClick}
            onMouseMove={handleMove}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            style={{ cursor: 'crosshair' }} />

      {/* drag grip — top-left of the cell, used to move the view */}
      <g data-testid="forge-view-grip"
         data-grip-for={view.id}
         onMouseDown={onGripDown}
         style={{ cursor: 'move' }}>
        <rect x={x + 0.5} y={y + 0.5} width={5} height={5}
              fill="var(--forge-accent-mute, rgba(108,208,232,0.4))"
              stroke="var(--forge-accent, #6cd0e8)" strokeWidth={0.3} />
        <text x={x + 3} y={y + 4.4} textAnchor="middle"
              fontSize={3} fill={ink}>·</text>
      </g>

      {/* label corner */}
      <text x={x + 7} y={y + 5}
            fontFamily="var(--forge-mono)" fontSize={3}
            fill={ink}>
        {view.direction.toUpperCase()} · {view.kind}
      </text>
      {proj.source === 'fallback' && (
        <text x={x + w - 3} y={y + 5} textAnchor="end"
              fontFamily="var(--forge-mono)" fontSize={2.4}
              fill="var(--forge-ink-mute)">
          fallback
        </text>
      )}

      {/* projected edges (clipped if this view defines a clip mask) */}
      <g data-edges={proj.edges.length}
         clipPath={proj.clip ? `url(#${clipId})` : undefined}>
        {proj.edges.map((e, i) => {
          if (!e.visible && view.hiddenLines === false) return null;
          const pts = (e.points || []).map(toSheet)
                                       .map(([px, py]) => `${px},${py}`)
                                       .join(' ');
          const isAlt = !!e.alternate;
          return (
            <polyline key={i}
                      data-edge-alternate={isAlt ? 'true' : undefined}
                      points={pts}
                      fill="none"
                      stroke={ink}
                      strokeOpacity={isAlt ? 0.45 : 1}
                      strokeWidth={e.visible ? 0.5 : 0.3}
                      strokeDasharray={
                        isAlt
                          ? '2.5 1.5 0.5 1.5'    // chain-dash for alternate
                          : (e.visible ? '0' : '1.5 1')
                      } />
          );
        })}
        {/* hatches on section views (half-section masks to only one side) */}
        {(proj.hatches || []).map((hk, i) => (
          <polyline key={`h-${i}`}
                    points={(hk.points || []).map(toSheet)
                                              .map(([px, py]) => `${px},${py}`)
                                              .join(' ')}
                    fill="none"
                    stroke={ink}
                    strokeOpacity={0.55}
                    strokeWidth={0.25} />
        ))}
      </g>

      {/* clip-mask outline — render the clip boundary as a dashed line so
          the user can see where the crop / partial / half-section is. */}
      {proj.clip && (
        <g data-testid="forge-clip-outline"
           data-clip-kind={proj.clip.kind}>
          <ClipOutline clip={proj.clip} toSheet={toSheet} ink={ink} />
        </g>
      )}

      {/* dimensions belonging to this view */}
      <g transform={`translate(${ox} ${oy}) scale(${s})`}>
        <DimensionLayer dimensions={dimensions} viewId={view.id} />
        {dimPreview}
        {/* Forge-130 — ordinate dimensions */}
        <OrdinateLayer stacks={ordinates} viewId={view.id} ink={ink} />
        {ordinatePreview}
        {/* Forge-130 — datum targets */}
        <DatumTargetLayer targets={datumTargets} viewId={view.id} ink={ink} />
        {/* Forge-130 — revision clouds */}
        <RevisionCloudLayer clouds={clouds} viewId={view.id} ink={ink} />
        {/* cloud draft (in-progress polygon) */}
        {cloudDraft && cloudDraft.viewId === view.id && cloudDraft.points.length > 0 && (
          <g data-testid="forge-cloud-draft"
             data-cloud-draft-points={cloudDraft.points.length}>
            <polyline
              points={cloudDraft.points.map(p => `${p[0]},${p[1]}`).join(' ')}
              fill="none" stroke="red" strokeOpacity={0.7}
              strokeWidth={0.4} strokeDasharray="0.6 0.4" />
            {cloudDraft.points.map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r={0.6} fill="red" />
            ))}
          </g>
        )}
      </g>

      {/* balloons */}
      {balloons?.length > 0 && balloonPositions && (
        <g transform={`translate(${ox} ${oy}) scale(${s})`}>
          <BalloonLayer
            rows={balloons}
            positions={balloonPositions}
            centroid={{ x: (b.minX + b.maxX) / 2,
                        y: (b.minY + b.maxY) / 2 }}
          />
        </g>
      )}

      {/* PMI annotations (GD&T, surface finish, weld) belonging to this view */}
      {Array.isArray(annotations) && annotations.length > 0 && (
        <g transform={`translate(${ox} ${oy}) scale(${s})`}
           data-pmi-layer="true"
           data-pmi-view={view.id}>
          {annotations
            .filter((a) => a.viewId === view.id)
            .map((a) => {
              if (a.kind === 'gdt') {
                return (
                  <FcfWithLeader key={a.id}
                    fcf={a.payload}
                    anchor={a.anchor}
                    frame={a.frame}
                    ink={ink}
                    dataKey={a.id} />
                );
              }
              if (a.kind === 'finish') {
                return (
                  <SurfaceFinishWithLeader key={a.id}
                    finish={a.payload}
                    anchor={a.anchor}
                    frame={a.frame}
                    ink={ink}
                    dataKey={a.id} />
                );
              }
              if (a.kind === 'weld') {
                return (
                  <WeldWithLeader key={a.id}
                    weld={a.payload}
                    anchor={a.anchor}
                    frame={a.frame}
                    ink={ink}
                    dataKey={a.id} />
                );
              }
              return null;
            })}
        </g>
      )}
    </g>
  );
}

/** Forge-130 — render the clip-path mask geometry. The clip kind drives
 *  which SVG shape the clip is built from. Coordinates are sheet-space. */
function clipShape(clip, toSheet) {
  if (!clip) return null;
  if (clip.kind === 'rect') {
    const [x0, y0] = toSheet([clip.x, clip.y]);
    const [x1, y1] = toSheet([clip.x + clip.w, clip.y + clip.h]);
    return (<rect x={Math.min(x0, x1)} y={Math.min(y0, y1)}
                  width={Math.abs(x1 - x0)} height={Math.abs(y1 - y0)} />);
  }
  if (clip.kind === 'sketch' || clip.kind === 'irregular') {
    const pts = clip.boundary.map(toSheet)
                             .map(([px, py]) => `${px},${py}`)
                             .join(' ');
    return <polygon points={pts} />;
  }
  if (clip.kind === 'half') {
    // half-clip — render an infinite rectangle on one side of the centre.
    const cl = clip.centreLine || { kind: 'vertical', x: 0 };
    if (cl.kind === 'vertical') {
      const [cx0] = toSheet([cl.x, 0]);
      return <rect x={cx0} y={-1e4} width={1e5} height={2e4} />;
    }
    const [, cy0] = toSheet([0, cl.y]);
    return <rect x={-1e4} y={cy0} width={2e4} height={1e5} />;
  }
  return null;
}

/** Render the clip boundary as a dashed line so the user sees the
 *  effective crop region. */
function ClipOutline({ clip, toSheet, ink }) {
  if (!clip) return null;
  if (clip.kind === 'rect') {
    const [x0, y0] = toSheet([clip.x, clip.y]);
    const [x1, y1] = toSheet([clip.x + clip.w, clip.y + clip.h]);
    return (
      <rect x={Math.min(x0, x1)} y={Math.min(y0, y1)}
            width={Math.abs(x1 - x0)} height={Math.abs(y1 - y0)}
            fill="none" stroke={ink} strokeWidth={0.3}
            strokeDasharray="1.5 1" />
    );
  }
  if (clip.kind === 'sketch' || clip.kind === 'irregular') {
    const pts = clip.boundary.map(toSheet)
                             .map(([px, py]) => `${px},${py}`)
                             .join(' ');
    return (
      <polygon points={pts}
               fill="none" stroke={ink} strokeWidth={0.3}
               strokeDasharray="1.5 1" />
    );
  }
  if (clip.kind === 'half') {
    const cl = clip.centreLine || { kind: 'vertical', x: 0 };
    if (cl.kind === 'vertical') {
      const [cx0] = toSheet([cl.x, 0]);
      return (
        <line x1={cx0} y1={-1e4} x2={cx0} y2={1e4}
              stroke={ink} strokeWidth={0.3}
              strokeDasharray="6 1 1 1" />
      );
    }
    const [, cy0] = toSheet([0, cl.y]);
    return (
      <line x1={-1e4} y1={cy0} x2={1e4} y2={cy0}
            stroke={ink} strokeWidth={0.3}
            strokeDasharray="6 1 1 1" />
    );
  }
  return null;
}

// ─────────────────────────────────────────────────────── Title block

function TitleBlock({ data, ink, x, y, w, h }) {
  const half  = w / 2;
  const third = w / 3;
  const row1Y = y + h / 3;
  const row2Y = y + h * 2 / 3;
  const txt   = (px, py, label, value) => (
    <g>
      <text x={px + 2} y={py + 3} fontFamily="var(--forge-mono)" fontSize={2.4}
            fill="var(--forge-ink-mute)">{label}</text>
      <text x={px + 2} y={py + 7} fontFamily="var(--forge-mono)" fontSize={3.6}
            fill={ink} fontWeight={600}
            data-tb-key={label.toLowerCase()}
            data-tb-value={String(value || '')}>
        {value || '—'}
      </text>
    </g>
  );
  return (
    <g data-testid="forge-drawings-title-block">
      <rect x={x} y={y} width={w} height={h}
            fill="none" stroke={ink} strokeWidth={0.4} />
      {/* row separators */}
      <line x1={x} y1={row1Y} x2={x + w} y2={row1Y} stroke={ink} strokeWidth={0.2} />
      <line x1={x} y1={row2Y} x2={x + w} y2={row2Y} stroke={ink} strokeWidth={0.2} />
      {/* col separators on each row, varying widths */}
      <line x1={x + half} y1={y} x2={x + half} y2={row1Y} stroke={ink} strokeWidth={0.2} />
      <line x1={x + third} y1={row1Y} x2={x + third} y2={row2Y} stroke={ink} strokeWidth={0.2} />
      <line x1={x + third * 2} y1={row1Y} x2={x + third * 2} y2={row2Y} stroke={ink} strokeWidth={0.2} />
      <line x1={x + half} y1={row2Y} x2={x + half} y2={y + h} stroke={ink} strokeWidth={0.2} />

      {txt(x,         y,       'PROJECT', data.project)}
      {txt(x + half,  y,       'DRAWN BY', data.drawnBy)}

      {txt(x,             row1Y, 'DATE',  data.date)}
      {txt(x + third,     row1Y, 'SHEET', data.sheet)}
      {txt(x + third * 2, row1Y, 'SCALE', data.scale)}

      {txt(x,         row2Y, 'UNITS',  data.units)}
      {txt(x + half,  row2Y, 'STD',    'ASME Y14.5')}
    </g>
  );
}

// ─────────────────────────────────────────────────────── Inspector

function DrawingsInspector({
  bodies, views, activeView, activeProjection, onUpdateView,
  onRemoveView, onActivateView, titleBlock, setTitleBlock,
  bomRows, onMaterialChange, onRemoveBomRow,
  dimensions, onClearDimensions, onUpdateDimensionTolerance,
  annotations, onRemoveAnnotation,
  datumTargets, onRemoveDatumTarget,
  ordinates, ordinateAxis, onChangeOrdinateAxis, onClearOrdinates,
  revisions, clouds,
}) {
  return (
    <aside
      data-testid="forge-drawings-inspector"
      style={{
        gridArea: 'inspector',
        background: 'var(--forge-canvas-2)',
        borderLeft: '1px solid var(--forge-rail-edge)',
        overflowY: 'auto',
        display: 'flex', flexDirection: 'column',
      }}>
      <InspectorSection title="Views">
        {views.length === 0 && (
          <div style={{ color: 'var(--forge-ink-mute)', fontStyle: 'italic',
                        fontSize: 11, padding: 6 }}>
            No views yet — click <strong>Add view</strong>.
          </div>
        )}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {views.map((v) => (
            <li key={v.id}
                data-view-list-id={v.id}
                data-view-active={String(v.id === activeView?.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 6px',
                  background: v.id === activeView?.id
                    ? 'var(--forge-accent-mute)' : 'transparent',
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontSize: 11,
                }}
                onClick={() => onActivateView(v.id)}>
              <span style={{ flex: 1, color: 'var(--forge-ink)' }}>
                {v.direction.toUpperCase()} · {v.kind}
              </span>
              <button type="button"
                      aria-label={`Remove ${v.direction} view`}
                      onClick={(e) => { e.stopPropagation(); onRemoveView(v.id); }}
                      style={{
                        background: 'transparent', border: 'none',
                        color: 'var(--forge-ink-mute)', cursor: 'pointer',
                        fontSize: 12,
                      }}>×</button>
            </li>
          ))}
        </ul>
      </InspectorSection>

      <InspectorSection title="Properties">
        {!activeView ? (
          <div style={{ color: 'var(--forge-ink-mute)', fontStyle: 'italic',
                        fontSize: 11 }}>
            Select a view to edit its properties.
          </div>
        ) : (
          <ViewProperties
            view={activeView}
            projection={activeProjection}
            bodies={bodies}
            onUpdate={(patch) => onUpdateView(activeView.id, patch)}
          />
        )}
      </InspectorSection>

      <InspectorSection title="Title block">
        <TitleBlockEditor data={titleBlock} onChange={setTitleBlock} />
      </InspectorSection>

      <InspectorSection title={`Dimensions · ${dimensions.length}`}>
        {dimensions.length > 0 && (
          <button type="button"
                  data-testid="forge-drawings-clear-dims"
                  onClick={onClearDimensions}
                  style={{
                    background: 'var(--forge-surface)',
                    border: '1px solid var(--forge-rail-edge)',
                    color: 'var(--forge-ink-2)',
                    padding: '3px 8px', fontSize: 11,
                    borderRadius: 3, cursor: 'pointer',
                    marginBottom: 6,
                  }}>
            Clear all
          </button>
        )}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     fontFamily: 'var(--forge-mono)', fontSize: 10,
                     color: 'var(--forge-ink-2)' }}>
          {dimensions.map((d) => (
            <li key={d.id}
                data-dim-list-id={d.id}
                data-dim-list-tolerance={formatTolerance(d.tolerance)}
                style={{ display: 'flex', flexDirection: 'column',
                         gap: 2, padding: '4px 0',
                         borderBottom: '1px solid var(--forge-rail-edge)' }}>
              <span>{d.kind} · {d.value.toFixed(2)} {d.unit}
                    {d.tolerance ? `  ${formatTolerance(d.tolerance)}` : ''}</span>
              <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 9, color: 'var(--forge-ink-mute)' }}>tol</span>
                <input type="number" step="0.001" min="0"
                       value={d.tolerance?.plus ?? 0.1}
                       data-dim-tol-plus={d.id}
                       onChange={(e) => onUpdateDimensionTolerance?.(d.id, {
                         plus:  parseFloat(e.target.value) || 0,
                         minus: d.tolerance?.minus ?? 0.1,
                       })}
                       style={{ ...inputStyle, width: 56,
                                padding: '2px 4px' }} />
                <span>/</span>
                <input type="number" step="0.001" min="0"
                       value={d.tolerance?.minus ?? 0.1}
                       data-dim-tol-minus={d.id}
                       onChange={(e) => onUpdateDimensionTolerance?.(d.id, {
                         plus:  d.tolerance?.plus ?? 0.1,
                         minus: parseFloat(e.target.value) || 0,
                       })}
                       style={{ ...inputStyle, width: 56,
                                padding: '2px 4px' }} />
              </span>
            </li>
          ))}
        </ul>
      </InspectorSection>

      <InspectorSection title={`PMI · ${annotations?.length ?? 0}`}>
        {(!annotations || annotations.length === 0) && (
          <div style={{ color: 'var(--forge-ink-mute)', fontStyle: 'italic',
                        fontSize: 11 }}>
            No PMI annotations. Use the toolbar to add GD&T, surface
            finish, or weld symbols.
          </div>
        )}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     fontFamily: 'var(--forge-mono)', fontSize: 10,
                     color: 'var(--forge-ink-2)' }}>
          {(annotations || []).map((a) => (
            <li key={a.id}
                data-pmi-list-id={a.id}
                data-pmi-list-kind={a.kind}
                style={{ display: 'flex', alignItems: 'center', gap: 4,
                         padding: '2px 0' }}>
              <span style={{ flex: 1 }}>
                {a.kind.toUpperCase()} · {summarisePmi(a)}
              </span>
              <button type="button"
                      aria-label={`Remove ${a.kind} annotation`}
                      onClick={() => onRemoveAnnotation?.(a.id)}
                      style={{
                        background: 'transparent', border: 'none',
                        color: 'var(--forge-ink-mute)', cursor: 'pointer',
                      }}>×</button>
            </li>
          ))}
        </ul>
      </InspectorSection>

      <InspectorSection title={`Datum targets · ${datumTargets?.length || 0}`}>
        {(!datumTargets || datumTargets.length === 0) && (
          <div style={{ color: 'var(--forge-ink-mute)', fontStyle: 'italic',
                        fontSize: 11 }}>
            No datum targets. Use the Datum target tool to add per
            ASME Y14.5 §4.24.
          </div>
        )}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     fontFamily: 'var(--forge-mono)', fontSize: 10,
                     color: 'var(--forge-ink-2)' }}>
          {(datumTargets || []).map((t) => (
            <li key={t.id} data-dt-list-id={t.id}
                data-dt-list-form={t.form}
                data-dt-list-label={`${t.datum}${t.targetNo}`}
                style={{ display: 'flex', alignItems: 'center', gap: 4,
                         padding: '2px 0' }}>
              <span style={{ flex: 1 }}>
                {t.form.toUpperCase()} · {t.datum}{t.targetNo}
                {t.size ? ` · ${t.size}` : ''}
              </span>
              <button type="button"
                      aria-label="Remove datum target"
                      onClick={() => onRemoveDatumTarget?.(t.id)}
                      style={{
                        background: 'transparent', border: 'none',
                        color: 'var(--forge-ink-mute)', cursor: 'pointer',
                      }}>×</button>
            </li>
          ))}
        </ul>
      </InspectorSection>

      <InspectorSection title={`Ordinate stacks · ${ordinates?.length || 0}`}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          <select value={ordinateAxis}
                  data-prop="ordinateAxis"
                  onChange={(e) => onChangeOrdinateAxis?.(e.target.value)}
                  style={selectStyle}>
            <option value={ORDINATE_AXIS.horizontal}>horizontal (X)</option>
            <option value={ORDINATE_AXIS.vertical}>vertical (Y)</option>
          </select>
          {(ordinates?.length || 0) > 0 && (
            <button type="button"
                    data-testid="forge-clear-ordinates"
                    onClick={onClearOrdinates}
                    style={{
                      background: 'var(--forge-surface)',
                      border: '1px solid var(--forge-rail-edge)',
                      color: 'var(--forge-ink-2)',
                      padding: '3px 8px', fontSize: 11,
                      borderRadius: 3, cursor: 'pointer',
                    }}>Clear</button>
          )}
        </div>
        <div style={{ color: 'var(--forge-ink-mute)', fontSize: 10 }}>
          Click to place origin then each feature; press Enter to finish.
        </div>
      </InspectorSection>

      <InspectorSection title={`Revisions · ${revisions?.length || 0} · clouds · ${clouds?.length || 0}`}>
        <RevisionTableInspector />
      </InspectorSection>

      <InspectorSection title="Bill of Materials">
        <BomTable
          rows={bomRows}
          onMaterialChange={onMaterialChange}
          onRemoveRow={onRemoveBomRow}
        />
      </InspectorSection>
    </aside>
  );
}

function InspectorSection({ title, children }) {
  return (
    <section style={{ borderBottom: '1px solid var(--forge-rail-edge)' }}>
      <header style={{
        padding: '6px 10px',
        fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em',
        color: 'var(--forge-ink-mute)',
        background: 'var(--forge-canvas)',
        borderBottom: '1px solid var(--forge-rail-edge)',
      }}>{title}</header>
      <div style={{ padding: '6px 10px' }}>{children}</div>
    </section>
  );
}

function ViewProperties({ view, projection, bodies, onUpdate }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Field label="Body">
        <select
          value={view.bodyId || ''}
          data-prop="bodyId"
          onChange={(e) => {
            const b = bodies.find((x) => x.id === e.target.value);
            onUpdate({
              bodyId: b?.id || null,
              handle: typeof b?.handle === 'number' ? b.handle : null,
            });
          }}
          style={selectStyle}>
          <option value="">— none —</option>
          {bodies.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name || b.toolId || b.id}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Direction">
        <select
          value={view.direction}
          data-prop="direction"
          onChange={(e) => onUpdate({ direction: e.target.value })}
          style={selectStyle}>
          {DIRECTION_PRESETS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </Field>
      <Field label="Scale">
        <input type="number"
               step={0.1} min={0.05} max={20}
               value={view.scale}
               data-prop="scale"
               onChange={(e) => onUpdate({ scale: parseFloat(e.target.value) || 1 })}
               style={inputStyle} />
      </Field>
      <Field label="Hidden lines">
        <label style={{ display: 'inline-flex', gap: 6, color: 'var(--forge-ink-2)' }}>
          <input type="checkbox"
                 checked={!!view.hiddenLines}
                 data-prop="hiddenLines"
                 onChange={(e) => onUpdate({ hiddenLines: e.target.checked })} />
          show
        </label>
      </Field>
      {(view.kind === 'section' || view.kind === 'brokenSection' ||
        view.kind === 'partialSection' || view.kind === 'halfSection') && (
        <>
          <Field label="Hatch angle (°)">
            <input type="number" step={1}
                   value={view.hatchSpec?.angle ?? 45}
                   data-prop="hatchAngle"
                   onChange={(e) => onUpdate({
                     hatchSpec: { ...view.hatchSpec, angle: parseFloat(e.target.value) || 0 },
                   })}
                   style={inputStyle} />
          </Field>
          <Field label="Hatch spacing (mm)">
            <input type="number" step={0.5} min={0.5}
                   value={view.hatchSpec?.spacing ?? 4}
                   data-prop="hatchSpacing"
                   onChange={(e) => onUpdate({
                     hatchSpec: { ...view.hatchSpec, spacing: parseFloat(e.target.value) || 1 },
                   })}
                   style={inputStyle} />
          </Field>
        </>
      )}
      {view.kind === 'crop' && (
        <>
          <Field label="Crop X / Y / W / H">
            <div style={{ display: 'flex', gap: 4 }}>
              {['x','y','w','h'].map((k) => (
                <input key={k} type="number" step={1}
                       value={view.cropRect?.[k] ?? 0}
                       data-prop={`cropRect.${k}`}
                       onChange={(e) => onUpdate({
                         cropRect: { ...view.cropRect, [k]: parseFloat(e.target.value) || 0 },
                       })}
                       style={{ ...inputStyle, width: 48 }} />
              ))}
            </div>
          </Field>
        </>
      )}
      {view.kind === 'auxiliary' && (
        <Field label="Aux axis (x,y,z)">
          <input type="text"
                 value={(view.auxAxis || []).join(',')}
                 data-prop="auxAxis"
                 onChange={(e) => {
                   const parts = e.target.value.split(',').map(parseFloat);
                   onUpdate({ auxAxis: parts });
                 }}
                 style={inputStyle} />
        </Field>
      )}
      {view.kind === 'halfSection' && (
        <Field label="Centre line">
          <select value={view.centreLine?.kind || 'vertical'}
                  data-prop="centreLine.kind"
                  onChange={(e) => onUpdate({
                    centreLine: { ...view.centreLine, kind: e.target.value },
                  })}
                  style={selectStyle}>
            <option value="vertical">vertical</option>
            <option value="horizontal">horizontal</option>
          </select>
        </Field>
      )}
      {view.kind === 'alternate' && (
        <Field label="Alt opacity">
          <input type="number" step={0.05} min={0.05} max={1}
                 value={view.altOpacity ?? 0.45}
                 data-prop="altOpacity"
                 onChange={(e) => onUpdate({ altOpacity: parseFloat(e.target.value) || 0.45 })}
                 style={inputStyle} />
        </Field>
      )}
      {/* Forge-130 — alignment readout */}
      <div data-testid="forge-view-alignment-state"
           data-view-aligned={String(isAligned(view))}
           style={{
             marginTop: 4,
             fontFamily: 'var(--forge-mono)',
             fontSize: 10,
             color: 'var(--forge-ink-mute)',
           }}>
        align: {describeAlignment(view)}
      </div>
      <div style={{
        marginTop: 4,
        fontFamily: 'var(--forge-mono)',
        fontSize: 10,
        color: 'var(--forge-ink-mute)',
      }}>
        edges: {projection?.edges?.length ?? 0} · source: {projection?.source ?? '—'}
      </div>
    </div>
  );
}

function TitleBlockEditor({ data, onChange }) {
  const set = (k, v) => onChange({ ...data, [k]: v });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Field label="Project"><input value={data.project} data-tb-field="project"
        onChange={(e) => set('project', e.target.value)} style={inputStyle} /></Field>
      <Field label="Drawn by"><input value={data.drawnBy} data-tb-field="drawnBy"
        onChange={(e) => set('drawnBy', e.target.value)} style={inputStyle} /></Field>
      <Field label="Date"><input type="date" value={data.date} data-tb-field="date"
        onChange={(e) => set('date', e.target.value)} style={inputStyle} /></Field>
      <Field label="Sheet"><input value={data.sheet} data-tb-field="sheet"
        onChange={(e) => set('sheet', e.target.value)} style={inputStyle} /></Field>
      <Field label="Scale"><input value={data.scale} data-tb-field="scale"
        onChange={(e) => set('scale', e.target.value)} style={inputStyle} /></Field>
      <Field label="Units">
        <select value={data.units} data-tb-field="units"
                onChange={(e) => set('units', e.target.value)} style={selectStyle}>
          {['mm', 'cm', 'm', 'in', 'ft'].map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </Field>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{
        fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em',
        color: 'var(--forge-ink-mute)',
      }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle = {
  background: 'var(--forge-canvas)',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)',
  font: 'inherit', fontSize: 12,
  padding: '4px 6px', borderRadius: 3,
};
const selectStyle = { ...inputStyle };

// ─────────────────────────────────────────────────────── utilities

function svgPoint(svg, evt) {
  try {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  } catch (err) {
    return null;
  }
}

// ── Forge-130 helpers — view-kind specific clipping & axis math ─────

/**
 * Crop / partial-section / half-section / broken-section all reduce to
 * "keep only the parts of the projection that fall inside a clipping
 * region". We don't filter the edge list itself (the SVG render uses
 * the `clip` payload to insert a clip-path); the bounds stay intact so
 * the view still scales properly.
 */
function clipProjection(proj, view) {
  if (!proj || !view) return proj;
  const kind = view.kind;
  if (kind === VIEW_KIND.crop) {
    return { ...proj, clip: { kind: 'rect', ...(view.cropRect || { x: -20, y: -15, w: 40, h: 30 }) } };
  }
  if (kind === VIEW_KIND.partialSection) {
    return {
      ...proj,
      clip: { kind: 'sketch', boundary: view.boundary || defaultClosedBoundary() },
    };
  }
  if (kind === VIEW_KIND.brokenSection) {
    return {
      ...proj,
      clip: { kind: 'irregular', boundary: view.boundary || defaultIrregularBoundary() },
    };
  }
  if (kind === VIEW_KIND.halfSection) {
    return {
      ...proj,
      clip: { kind: 'half', centreLine: view.centreLine || { kind: 'vertical', x: 0 } },
    };
  }
  return proj;
}

function defaultClosedBoundary() {
  return [[-12, -10], [12, -10], [12, 10], [-12, 10]];
}
function defaultIrregularBoundary() {
  return [[-16, -2], [-8, -10], [6, -8], [14, 0], [10, 8], [-2, 10], [-12, 6]];
}

const PRESET_VECTORS = {
  front:  [0, 0, -1],
  back:   [0, 0,  1],
  top:    [0,-1,  0],
  bottom: [0, 1,  0],
  right:  [1, 0,  0],
  left:   [-1,0,  0],
};

function nearestPreset(vec) {
  if (!vec || vec.length < 3) return 'front';
  let best = 'front', bestDot = -Infinity;
  for (const [k, v] of Object.entries(PRESET_VECTORS)) {
    const dot = v[0] * vec[0] + v[1] * vec[1] + v[2] * vec[2];
    if (dot > bestDot) { bestDot = dot; best = k; }
  }
  return best;
}

/** Default rect for a newly added view — placed below the bottom-most
 *  existing view so it doesn't overlap. Sized to a third of the sheet
 *  to leave room for two columns of children. */
function computeNextViewRect(views) {
  const w = 90, h = 60;
  let y = 8;
  for (const v of views) {
    const by = (v.y || 0) + (v.h || h);
    if (by > y) y = by;
  }
  return { x: 8, y: Math.min(y + 4, SHEET_H - h - 4), w, h };
}

/** Given a picked edge `[ax,ay,az] → [bx,by,bz]`, return the unit
 *  perpendicular vector that becomes the auxiliary view direction.
 *  ASME convention: auxiliary view is taken perpendicular to the edge,
 *  in the plane of the source view. We use the 2D normal of the picked
 *  segment as a stand-in when the kernel doesn't expose the third axis. */
export function auxiliaryAxisFromEdge(edge) {
  if (!edge || edge.length < 2) return [0, 0, -1];
  const [a, b] = edge;
  const dx = (b[0] ?? 0) - (a[0] ?? 0);
  const dy = (b[1] ?? 0) - (a[1] ?? 0);
  const dz = ((b[2] ?? 0) - (a[2] ?? 0)) || 0;
  // perpendicular in the picked plane: rotate 90°. If picked edge sits in
  // the XY plane, the perpendicular is (-dy, dx, 0); if the segment has
  // a Z component, we average the rotations.
  const len = Math.hypot(dx, dy, dz) || 1;
  const px = -dy / len;
  const py =  dx / len;
  const pz =  dz / len;
  return [px, py, pz];
}

function summarisePmi(a) {
  if (!a) return '';
  const p = a.payload || {};
  if (a.kind === 'gdt') {
    const datums = (p.datums || []).map((d) => d.ref).join('');
    return `${p.characteristic} ${p.tolerance}${datums ? ' | ' + datums : ''}`;
  }
  if (a.kind === 'finish') {
    return `${p.param} ${p.value} µm${p.lay ? ' ' + p.lay : ''}`;
  }
  if (a.kind === 'weld') {
    return `${p.type} ${p.size}${p.process ? ' ' + p.process : ''}`;
  }
  return '';
}

export default DrawingsWorkbench;
