// Forge-90 — Drawings workbench.
//
// Full-viewport overlay that replaces the 3D canvas while the Drawing
// workbench is active. Renders a configurable view grid (default 2×2),
// each cell hosting one projected view of a body. The toolbar above
// the grid lets the user add new views (section / detail / broken /
// dimension / balloon / title-block); the right inspector edits the
// active view's properties (scale, hidden-lines, hatch).
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

const SHEET_W = 297;     // mm, A4 landscape
const SHEET_H = 210;
const TITLE_BLOCK_H = 28;

const VIEW_KIND = Object.freeze({
  shape:   'shape',
  section: 'section',
  detail:  'detail',
  broken:  'broken',
});

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
  // (or empty cells if no body in the project).
  const body = bodies?.[0] || null;
  const handle = body && typeof body.handle === 'number' ? body.handle : null;
  const mk = (direction) => ({
    id:        newViewId(),
    kind:      VIEW_KIND.shape,
    bodyId:    body?.id || null,
    handle,
    direction,
    ...VIEW_DEFAULTS,
  });
  return [mk('front'), mk('top'), mk('right'), mk('iso')];
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
  const [tool, setTool] = useState(null);      // 'dimension' | 'balloon' | 'gdt' | 'finish' | 'weld'
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
            proj = projectSectionSafe(v.handle, v.direction, v.sectionPlane, v.hatchSpec);
            break;
          case VIEW_KIND.detail:
            proj = projectDetailSafe(v.handle, v.direction, v.focusCircle, v.scale);
            break;
          case VIEW_KIND.broken:
            proj = projectBrokenSafe(v.handle, v.direction, v.breakRegion);
            break;
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
  const addView = useCallback((direction = 'iso', kind = VIEW_KIND.shape) => {
    const body = bodies[0] || null;
    setViews((arr) => {
      const v = {
        id: newViewId(),
        kind,
        bodyId: body?.id || null,
        handle: typeof body?.handle === 'number' ? body.handle : null,
        direction,
        ...VIEW_DEFAULTS,
        ...(kind === VIEW_KIND.section ? {
          sectionPlane: { origin: [0, 0, 0], normal: [0, 0, 1] },
        } : {}),
        ...(kind === VIEW_KIND.detail ? {
          focusCircle: { cx: 0, cy: 0, r: 16 },
        } : {}),
        ...(kind === VIEW_KIND.broken ? {
          breakRegion: { axis: 'x', from: -8, to: 8 },
        } : {}),
      };
      const next = [...arr, v];
      setActiveViewId(v.id);
      return next;
    });
  }, [bodies]);

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
            ink={sheetInk}
            dimensions={dimensions}
            annotations={annotations}
            balloons={tool === 'balloon' || activeView?.showBalloons
              ? bomRows
              : []}
            balloonPositionsByView={balloonPositionsByView}
            onSheetClick={(viewId, pt) => {
              if (tool === 'dimension') dim.recordClick(pt, viewId);
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
          />

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
                 gap: 2, minWidth: 120, zIndex: 10,
               }}
               onMouseLeave={() => setAddOpen(false)}>
            {DIRECTION_PRESETS.filter((d) => d !== 'section').map((d) => (
              <button key={d}
                      type="button"
                      role="menuitem"
                      data-add-direction={d}
                      onClick={() => { onAddView(d); setAddOpen(false); }}
                      style={{
                        textAlign: 'left',
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--forge-ink-2)',
                        padding: '4px 8px',
                        fontSize: 11,
                        cursor: 'pointer',
                        borderRadius: 3,
                      }}>
                {d.toUpperCase()}
              </button>
            ))}
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

// ─────────────────────────────────────────────────────── View grid

function ViewGrid({
  views, projections, cols, sheetW, sheetH,
  activeViewId, onActivate, onDropBody, ink,
  dimensions, balloons, balloonPositionsByView, annotations,
  onSheetClick, onSheetMove, dimPreview,
}) {
  const margin = 8;
  const innerW = sheetW - margin * 2;
  const innerH = sheetH - margin * 2;
  const rows = Math.max(1, Math.ceil(views.length / cols));
  const cellW = innerW / cols;
  const cellH = innerH / rows;
  return (
    <g data-testid="forge-drawings-view-grid">
      {views.map((v, i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        const x = margin + c * cellW;
        const y = margin + r * cellH;
        return (
          <DrawingViewCell
            key={v.id}
            view={v}
            projection={projections.get(v.id)}
            x={x} y={y} w={cellW} h={cellH}
            ink={ink}
            active={v.id === activeViewId}
            onActivate={() => onActivate(v.id)}
            onDropBody={(bodyId) => onDropBody(v.id, bodyId)}
            dimensions={dimensions}
            balloons={balloons}
            balloonPositions={balloonPositionsByView.get(v.id)}
            annotations={annotations}
            onSheetClick={(pt) => onSheetClick?.(v.id, pt)}
            onSheetMove={(pt) => onSheetMove?.(v.id, pt)}
            dimPreview={dimPreview ? dimPreview(v.id) : null}
          />
        );
      })}
    </g>
  );
}

function DrawingViewCell({
  view, projection, x, y, w, h, ink, active, onActivate, onDropBody,
  dimensions, balloons, balloonPositions, annotations,
  onSheetClick, onSheetMove, dimPreview,
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

  // hit-test the sheet coords back to view coords for tools
  const sheetToView = useCallback((sx, sy) => {
    return [(sx - ox) / s, (sy - oy) / s];
  }, [ox, oy, s]);

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
       data-view-active={String(active)}>
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

      {/* label corner */}
      <text x={x + 3} y={y + 5}
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

      {/* projected edges */}
      <g data-edges={proj.edges.length}>
        {proj.edges.map((e, i) => {
          if (!e.visible && view.hiddenLines === false) return null;
          const pts = (e.points || []).map(toSheet)
                                       .map(([px, py]) => `${px},${py}`)
                                       .join(' ');
          return (
            <polyline key={i}
                      points={pts}
                      fill="none"
                      stroke={ink}
                      strokeWidth={e.visible ? 0.5 : 0.3}
                      strokeDasharray={e.visible ? '0' : '1.5 1'} />
          );
        })}
        {/* hatches on section views */}
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

      {/* dimensions belonging to this view */}
      <g transform={`translate(${ox} ${oy}) scale(${s})`}>
        <DimensionLayer dimensions={dimensions} viewId={view.id} />
        {dimPreview}
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
      {view.kind === 'section' && (
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
