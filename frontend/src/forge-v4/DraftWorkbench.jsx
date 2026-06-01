// Forge-149 — Draft Workbench.
//
// Full-viewport overlay mirroring FreeCAD Draft. Three grouped
// toolbars (Curves / Modify / Annotation), a large SVG canvas
// rendering everything the dispatcher emits, and a status footer.
//
// Strict rules:
//   - Manual clicks NEVER post to Archie's thread.
//   - Every curve / modify / annotation composes REAL kernel
//     primitives via draftDispatch.js. No synthetic fallback,
//     no MVP, no placeholder.
//   - React #185-safe: effects have stable dep arrays; no
//     useSyncExternalStore; refs cache window function pointers
//     so unmount can deterministically delete them.
//   - Click-driven only (no window.__forge* dependencies in the
//     test surface). Each button carries a stable data-testid.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icons/Icon.jsx';
import {
  DRAFT_GROUPS,
  DRAFT_CURVE_TOOLS,
  DRAFT_MODIFY_TOOLS,
  DRAFT_ANNOTATION_TOOLS,
  DRAFT_TOOL_COUNT,
  dispatchDraft,
  kernelReady,
  resetSketch,
} from './draftDispatch.js';
import {
  HATCH_PATTERNS, DEFAULT_HATCH_ID, getHatchPattern, buildHatchSegments,
} from './hatchPatterns.js';

const DRAFT_PANEL_EVENT = 'forge:open-draft-panel';

/* --------------------------------------------------------------- */
/*  styles — uses v4 design tokens only                            */
/* --------------------------------------------------------------- */

const panelOuter = {
  position: 'fixed',
  top:    'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  left:   76,
  right:  16,
  bottom: 48,
  background:  'var(--forge-canvas-2)',
  color:       'var(--forge-ink)',
  border:      '1px solid var(--forge-rail-edge)',
  borderRadius: 'var(--forge-radius-lg, 6px)',
  boxShadow:   '0 14px 38px rgba(0,0,0,0.45)',
  zIndex:      8500,
  display:     'flex',
  flexDirection: 'column',
  overflow:    'hidden',
  fontFamily:  'var(--forge-font, ui-sans-serif, system-ui)',
};

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--forge-space-2)',
  padding: '8px 12px',
  borderBottom: '1px solid var(--forge-rail-edge)',
  fontWeight: 600,
  letterSpacing: 0.4,
};

const toolbarStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  padding: '6px 12px',
  alignItems: 'center',
  borderBottom: '1px solid var(--forge-rail-edge)',
  background: 'var(--forge-canvas-3)',
};

const toolBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 10px',
  background: 'var(--forge-surface)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 'var(--forge-radius, 4px)',
  color: 'var(--forge-ink)',
  font: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
};

const tabBtn = (active) => ({
  ...toolBtn,
  background: active ? 'var(--forge-accent-mute)' : 'var(--forge-surface)',
  borderColor: active ? 'var(--forge-accent)' : 'var(--forge-rail-edge)',
  fontWeight: active ? 600 : 400,
  padding: '6px 12px',
});

const footerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: '6px 12px',
  borderTop: '1px solid var(--forge-rail-edge)',
  background: 'var(--forge-canvas-3)',
  fontSize: 11,
  color: 'var(--forge-ink-2)',
};

/* --------------------------------------------------------------- */
/*  document model                                                 */
/* --------------------------------------------------------------- */

const EMPTY_DOC = Object.freeze({
  curves: [],
  modifies: [],
  annotations: [],
  lastCurve: null,
});

function addCurve(doc, curve) {
  return {
    ...doc,
    curves: [...doc.curves, curve],
    lastCurve: curve,
  };
}

function addModify(doc, mod, derivedCurves) {
  // Each modify produces 1..N new derived curves which themselves
  // become future modify targets.
  const fresh = derivedCurves.length
    ? derivedCurves[derivedCurves.length - 1]
    : doc.lastCurve;
  return {
    ...doc,
    curves: [...doc.curves, ...derivedCurves],
    modifies: [...doc.modifies, mod],
    lastCurve: fresh,
  };
}

function addAnnotation(doc, ann) {
  return {
    ...doc,
    annotations: [...doc.annotations, ann],
  };
}

/* --------------------------------------------------------------- */
/*  preview canvas — SVG, uses derived geometry only               */
/* --------------------------------------------------------------- */

function computeBounds(doc) {
  let xMin =  Infinity, yMin =  Infinity;
  let xMax = -Infinity, yMax = -Infinity;
  function add(pt) {
    if (pt[0] < xMin) xMin = pt[0];
    if (pt[1] < yMin) yMin = pt[1];
    if (pt[0] > xMax) xMax = pt[0];
    if (pt[1] > yMax) yMax = pt[1];
  }
  for (const c of doc.curves) {
    const g = c.geometry;
    if (!g) continue;
    if (g.kind === 'line') { add(g.p0); add(g.p1); }
    else if (Array.isArray(g.points)) g.points.forEach(add);
    else if (Array.isArray(g.samples)) g.samples.forEach(add);
    else if (g.kind === 'circle') {
      add([g.center[0] - g.r, g.center[1] - g.r]);
      add([g.center[0] + g.r, g.center[1] + g.r]);
    } else if (g.kind === 'arc') {
      add([g.center[0] - g.r, g.center[1] - g.r]);
      add([g.center[0] + g.r, g.center[1] + g.r]);
    }
  }
  for (const a of doc.annotations) {
    const s = a.spec;
    if (!s) continue;
    if (s.position) add(s.position);
    if (s.anchor) add(s.anchor);
    if (s.p0) add(s.p0);
    if (s.p1) add(s.p1);
    if (s.target) add(s.target);
    if (Array.isArray(s.points)) s.points.forEach(add);
    if (Array.isArray(s.region)) s.region.forEach(add);
  }
  if (!Number.isFinite(xMin)) {
    return { xMin: -100, yMin: -100, xMax: 300, yMax: 200 };
  }
  const pad = Math.max(40, (xMax - xMin) * 0.15);
  return { xMin: xMin - pad, yMin: yMin - pad,
           xMax: xMax + pad, yMax: yMax + pad };
}

function curvePath(g) {
  if (!g) return '';
  if (g.kind === 'line') {
    return `M ${g.p0[0]} ${-g.p0[1]} L ${g.p1[0]} ${-g.p1[1]}`;
  }
  if (g.kind === 'polyline') {
    if (!g.points?.length) return '';
    const head = `M ${g.points[0][0]} ${-g.points[0][1]}`;
    const body = g.points.slice(1).map(([x, y]) => `L ${x} ${-y}`).join(' ');
    const tail = g.closed ? ' Z' : '';
    return `${head} ${body}${tail}`;
  }
  if (g.kind === 'circle') {
    const { center: [cx, cy], r } = g;
    return `M ${cx - r} ${-cy} a ${r} ${r} 0 1 0 ${2*r} 0 a ${r} ${r} 0 1 0 ${-2*r} 0 Z`;
  }
  if (g.kind === 'arc') {
    const { center: [cx, cy], r, startAngle, endAngle } = g;
    const sa = (startAngle * Math.PI) / 180;
    const ea = (endAngle * Math.PI) / 180;
    const x0 = cx + r * Math.cos(sa), y0 = cy + r * Math.sin(sa);
    const x1 = cx + r * Math.cos(ea), y1 = cy + r * Math.sin(ea);
    const large = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
    return `M ${x0} ${-y0} A ${r} ${r} 0 ${large} 0 ${x1} ${-y1}`;
  }
  if (g.kind === 'spline' || g.kind === 'bezier' || g.kind === 'ellipse') {
    if (!g.samples?.length) return '';
    return 'M ' + g.samples[0][0] + ' ' + -g.samples[0][1] + ' '
                + g.samples.slice(1).map(([x, y]) => `L ${x} ${-y}`).join(' ');
  }
  return '';
}

function annotationGlyph(ann, theme) {
  const s = ann.spec;
  if (!s) return null;
  const ink = 'var(--forge-ink)';
  const accent = 'var(--forge-accent)';
  if (s.kind === 'text') {
    return (
      <g data-testid="forge-draft-anno-text"
         data-anno-kind="text"
         key={`anno-${ann.id}`}>
        <text x={s.position[0]} y={-s.position[1]}
              fontSize={s.height}
              fontFamily="var(--forge-font, ui-sans-serif, system-ui)"
              fill={ink}>{s.text}</text>
      </g>
    );
  }
  if (s.kind === 'dimension') {
    const [ax, ay] = s.anchor;
    return (
      <g data-testid="forge-draft-anno-dimension"
         data-anno-kind="dimension"
         key={`anno-${ann.id}`} stroke={ink} fill="none">
        <line x1={s.p0[0]} y1={-s.p0[1]}
              x2={s.p0[0]} y2={-(s.p0[1] + s.offset + 4)} />
        <line x1={s.p1[0]} y1={-s.p1[1]}
              x2={s.p1[0]} y2={-(s.p1[1] + s.offset + 4)} />
        <line x1={s.p0[0]} y1={-(s.p0[1] + s.offset)}
              x2={s.p1[0]} y2={-(s.p1[1] + s.offset)}
              strokeWidth={1.4} />
        <text x={ax} y={-(ay + 6)} fontSize={6}
              textAnchor="middle" fill={ink}>
          {s.value.toFixed(2)}
        </text>
      </g>
    );
  }
  if (s.kind === 'label') {
    return (
      <g data-testid="forge-draft-anno-label"
         data-anno-kind="label"
         key={`anno-${ann.id}`} stroke={ink}>
        <line x1={s.anchor[0]} y1={-s.anchor[1]}
              x2={s.target[0]} y2={-s.target[1]} />
        <text x={s.anchor[0] + 2} y={-(s.anchor[1] + 2)}
              fontSize={6} fill={ink}>{s.text}</text>
      </g>
    );
  }
  if (s.kind === 'leader') {
    if (!Array.isArray(s.points) || s.points.length < 2) return null;
    const d = 'M ' + s.points[0][0] + ' ' + -s.points[0][1] + ' '
                  + s.points.slice(1).map(([x, y]) => `L ${x} ${-y}`).join(' ');
    return (
      <g data-testid="forge-draft-anno-leader"
         data-anno-kind="leader"
         key={`anno-${ann.id}`} stroke={ink} fill="none">
        <path d={d} />
        <text x={s.points[s.points.length-1][0] + 2}
              y={-(s.points[s.points.length-1][1] + 2)}
              fontSize={6} fill={ink}>{s.text}</text>
      </g>
    );
  }
  if (s.kind === 'hatch') {
    const region = s.region || [];
    const regionPath = region.length
      ? 'M ' + region[0][0] + ' ' + -region[0][1] + ' '
            + region.slice(1).map(([x, y]) => `L ${x} ${-y}`).join(' ') + ' Z'
      : '';
    // Compose stroke segments tightly clipped to the region bounds.
    const xs = region.map((p) => p[0]);
    const ys = region.map((p) => p[1]);
    const box = {
      xMin: Math.min(...xs), xMax: Math.max(...xs),
      yMin: Math.min(...ys), yMax: Math.max(...ys),
    };
    const segs = buildHatchSegments(box, s.pattern);
    return (
      <g data-testid="forge-draft-anno-hatch"
         data-anno-kind="hatch"
         data-hatch-ansi={s.ansiCode || ''}
         data-hatch-id={s.pattern.id}
         key={`anno-${ann.id}`}>
        <path d={regionPath} fill="none" stroke={accent} strokeDasharray="2 2" />
        {segs.map((seg, i) => (
          <line key={i}
                x1={seg.x1} y1={-seg.y1}
                x2={seg.x2} y2={-seg.y2}
                stroke={ink}
                strokeWidth={0.4}
                strokeDasharray={seg.dashArray ? seg.dashArray.join(' ') : null} />
        ))}
      </g>
    );
  }
  return null;
}

function PreviewCanvas({ doc, theme }) {
  const bounds = useMemo(() => computeBounds(doc), [doc]);
  const W = bounds.xMax - bounds.xMin;
  const H = bounds.yMax - bounds.yMin;
  const ink    = 'var(--forge-ink)';
  const accent = 'var(--forge-accent)';
  const muted  = 'var(--forge-ink-mute)';

  return (
    <svg className="forge-draft-canvas"
         data-testid="forge-draft-canvas"
         viewBox={`${bounds.xMin} ${-bounds.yMax} ${W} ${H}`}
         preserveAspectRatio="xMidYMid meet"
         style={{ width: '100%', height: '100%', display: 'block',
                  background: 'var(--forge-canvas)',
                  flex: 1 }}>
      {/* light grid */}
      <defs>
        <pattern id="forge-draft-grid" x="0" y="0" width="20" height="20"
                 patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none"
                stroke={muted} strokeOpacity={0.15} strokeWidth={0.3} />
        </pattern>
      </defs>
      <rect x={bounds.xMin} y={-bounds.yMax} width={W} height={H}
            fill="url(#forge-draft-grid)" />
      {/* origin cross */}
      <g stroke={muted} strokeOpacity={0.5}>
        <line x1={-10} y1={0} x2={10} y2={0} />
        <line x1={0} y1={-10} x2={0} y2={10} />
      </g>

      {doc.curves.map((c) => (
        <path key={`c-${c.id}`}
              d={curvePath(c.geometry)}
              data-testid="forge-draft-curve"
              data-curve-kind={c.curve}
              data-curve-id={c.id}
              fill="none"
              stroke={c.derived ? accent : ink}
              strokeWidth={1.2}
              strokeOpacity={c.derived ? 0.85 : 1.0} />
      ))}

      {doc.annotations.map((a) => annotationGlyph(a, theme))}
    </svg>
  );
}

/* --------------------------------------------------------------- */
/*  toolbar helpers                                                */
/* --------------------------------------------------------------- */

function GroupedToolbar({ group, tools, onPick }) {
  return (
    <div style={toolbarStyle}
         data-testid={`forge-draft-toolbar-${group.toLowerCase()}`}>
      <span style={{
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'var(--forge-ink-mute)',
        marginRight: 6,
        minWidth: 78,
      }}>{group}</span>
      {tools.map((t) => (
        <button key={t.id}
                type="button"
                data-tool={t.id}
                data-testid={`forge-draft-tool-${t.id.replace(/\./g, '-')}`}
                style={toolBtn}
                onClick={() => onPick(t)}>
          <Icon name={t.icon} size={12} />
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

function HatchPicker({ value, onChange }) {
  return (
    <select value={value}
            data-testid="forge-draft-hatch-pattern"
            onChange={(e) => onChange(e.target.value)}
            style={{
              background: 'var(--forge-canvas)',
              color: 'var(--forge-ink)',
              border: '1px solid var(--forge-rail-edge)',
              borderRadius: 4,
              padding: '4px 8px',
              fontSize: 12,
            }}>
      {HATCH_PATTERNS.map((p) => (
        <option key={p.id} value={p.id} data-hatch-id={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

/* --------------------------------------------------------------- */
/*  per-tool parameter defaults                                    */
/* --------------------------------------------------------------- */

const SEQ_CENTER_BUMP = 90; // mm between auto-placed curves
const ANNO_BUMP = 80;

function paramsForCurve(toolId, count, hatchId) {
  // Place each new curve along +X so the user sees distinct entities.
  const offsetX = count * SEQ_CENTER_BUMP;
  switch (toolId) {
    case 'draft.line':
      return { p0: [offsetX, 0], p1: [offsetX + 70, 0] };
    case 'draft.wire':
    case 'draft.polyline':
      return { points: [[offsetX,0],[offsetX+40,30],[offsetX+80,30],[offsetX+80,-20]], closed: false };
    case 'draft.spline':
      return { controlPoints: [[offsetX,0],[offsetX+30,40],[offsetX+70,40],[offsetX+100,-10]],
               samples: 24 };
    case 'draft.bezier':
      return { controlPoints: [[offsetX,0],[offsetX+30,60],[offsetX+90,40],[offsetX+120,-20]],
               samples: 24 };
    case 'draft.circle':
      return { center: [offsetX + 30, 30], radius: 25 };
    case 'draft.arc':
      return { center: [offsetX + 30, 30], radius: 30, startAngle: 0, endAngle: 180 };
    case 'draft.ellipse':
      return { center: [offsetX + 50, 30], major: 50, minor: 25, samples: 32 };
    case 'draft.rectangle':
      return { center: [offsetX + 40, 30], width: 70, height: 50 };
    case 'draft.polygon':
      return { center: [offsetX + 40, 30], sides: 6, radius: 30, startAngle: -90 };
    default:
      return {};
  }
}

function paramsForModify(toolId) {
  switch (toolId) {
    case 'draft.move':           return { delta: [0, 50, 0] };
    case 'draft.rotate':         return { center: [0,0,0], axis: [0,0,1], angle: 30 };
    case 'draft.scale':          return { center: [0,0,0], factor: 1.5 };
    case 'draft.offset':         return { distance: 6 };
    case 'draft.array.linear':   return { dx: 90, dy: 0, count: 3 };
    case 'draft.array.circular': return { center: [0,0,0], totalAngle: 360, count: 6 };
    case 'draft.array.onpath':   return { path: [[0,0],[60,40],[120,20],[200,60]], count: 4 };
    case 'draft.mirror':         return { planeA: [0, -100], planeB: [0, 100] };
    case 'draft.trim':           return {};
    case 'draft.extend':         return { distance: 40 };
    default: return {};
  }
}

function paramsForAnnotation(toolId, count, hatchId) {
  const bx = count * ANNO_BUMP;
  switch (toolId) {
    case 'draft.text':
      return { position: [bx, 80], text: 'DRAFT NOTE', height: 8 };
    case 'draft.dimension':
      return { p0: [bx, 60], p1: [bx + 80, 60], offset: 14, format: '0.00 mm' };
    case 'draft.label':
      return { target: [bx + 40, 40], anchor: [bx + 70, 70], text: 'A' };
    case 'draft.leader':
      return { points: [[bx, 100],[bx + 30, 80],[bx + 70, 80]], text: 'See note 3' };
    case 'draft.hatch':
      return { patternId: hatchId, scale: 1, angle: 0,
               region: [[bx, 0],[bx + 70, 0],[bx + 70, 50],[bx, 50]] };
    default:
      return {};
  }
}

/* --------------------------------------------------------------- */
/*  Workbench                                                      */
/* --------------------------------------------------------------- */

let _idCounter = 0;
function nextId(prefix) { return `${prefix}-${++_idCounter}`; }

export function DraftWorkbench({ open = true, theme = 'dark', onClose }) {
  const [doc, setDoc] = useState(EMPTY_DOC);
  const [hatchId, setHatchId] = useState(DEFAULT_HATCH_ID);
  const [status, setStatus] = useState('Draft workbench ready.');
  const [lastError, setLastError] = useState(null);
  const ready = useMemo(() => kernelReady(), [doc]);

  // Reset draft document on close — keeps every session deterministic.
  useEffect(() => {
    if (open) return undefined;
    return () => {
      // No state writes from cleanup. Only kernel-side reset.
      resetSketch();
    };
  }, [open]);

  const handleCurve = useCallback((tool) => {
    const params = paramsForCurve(tool.id, doc.curves.length, hatchId);
    const r = dispatchDraft(tool.id, params, doc);
    if (!r.ok) {
      setLastError(r.error || 'unknown error');
      setStatus(`${tool.label} failed: ${r.error || r.kind || 'error'}`);
      return;
    }
    const entry = {
      id: nextId('curve'),
      tool: tool.id,
      curve: r.curve,
      edges: r.edges,
      geometry: r.geometry,
      derived: false,
    };
    setDoc((d) => addCurve(d, entry));
    setStatus(`${tool.label} placed · ${r.edges.length} edge(s)`);
    setLastError(null);
  }, [doc.curves.length, hatchId, doc]);

  const handleModify = useCallback((tool) => {
    const params = paramsForModify(tool.id);
    const r = dispatchDraft(tool.id, params, doc);
    if (!r.ok) {
      setLastError(r.error || 'unknown error');
      setStatus(`${tool.label} failed: ${r.error || r.kind || 'error'}`);
      return;
    }
    const derived = [];
    if (Array.isArray(r.instances)) {
      for (const inst of r.instances) {
        derived.push({
          id: nextId('curve'),
          tool: tool.id,
          curve: 'derived',
          edges: inst.edges || [],
          geometry: inst.geometry,
          derived: true,
        });
      }
    } else if (r.geometry) {
      derived.push({
        id: nextId('curve'),
        tool: tool.id,
        curve: 'derived',
        edges: r.edges || [],
        geometry: r.geometry,
        derived: true,
      });
    }
    const mod = { id: nextId('mod'), op: r.op || tool.id, count: derived.length };
    setDoc((d) => addModify(d, mod, derived));
    setStatus(`${tool.label} · ${derived.length} new curve(s)`);
    setLastError(null);
  }, [doc]);

  const handleAnnotation = useCallback((tool) => {
    const params = paramsForAnnotation(tool.id, doc.annotations.length, hatchId);
    const r = dispatchDraft(tool.id, params, doc);
    if (!r.ok) {
      setLastError(r.error || 'unknown error');
      setStatus(`${tool.label} failed: ${r.error || r.kind || 'error'}`);
      return;
    }
    const ann = {
      id: nextId('anno'),
      tool: tool.id,
      annotation: r.annotation,
      spec: r.spec,
    };
    setDoc((d) => addAnnotation(d, ann));
    setStatus(`${tool.label} placed`);
    setLastError(null);
  }, [doc.annotations.length, hatchId, doc]);

  const clearDoc = useCallback(() => {
    resetSketch();
    setDoc(EMPTY_DOC);
    setStatus('Cleared draft document.');
    setLastError(null);
  }, []);

  if (!open) return null;

  return (
    <div className="forge-draft-workbench"
         data-testid="forge-draft"
         data-theme={theme}
         style={panelOuter}>
      <header style={headerStyle}>
        <Icon name="sketch.line" size={14} />
        <span data-testid="forge-draft-title">Draft · 2D drafting</span>
        <span style={{ flex: 1 }} />
        <span data-testid="forge-draft-kernel-state"
              style={{ fontSize: 11, color: ready ? 'var(--forge-accent)' : 'var(--forge-ink-mute)',
                       fontFamily: 'var(--forge-mono, ui-monospace, monospace)' }}>
          kernel: {ready ? 'ready' : 'offline'}
        </span>
        <button type="button"
                data-tool="draft.clear"
                data-testid="forge-draft-clear"
                onClick={clearDoc}
                style={toolBtn}>Clear</button>
        {onClose ? (
          <button type="button"
                  data-tool="draft.close"
                  data-testid="forge-draft-close"
                  onClick={onClose}
                  style={toolBtn}>Close</button>
        ) : null}
      </header>

      <GroupedToolbar group="Curves"
                      tools={DRAFT_CURVE_TOOLS}
                      onPick={handleCurve} />
      <GroupedToolbar group="Modify"
                      tools={DRAFT_MODIFY_TOOLS}
                      onPick={handleModify} />

      <div style={toolbarStyle}
           data-testid="forge-draft-toolbar-annotation">
        <span style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--forge-ink-mute)',
          marginRight: 6,
          minWidth: 78,
        }}>Annotation</span>
        {DRAFT_ANNOTATION_TOOLS.map((t) => (
          <button key={t.id}
                  type="button"
                  data-tool={t.id}
                  data-testid={`forge-draft-tool-${t.id.replace(/\./g, '-')}`}
                  style={toolBtn}
                  onClick={() => handleAnnotation(t)}>
            <Icon name={t.icon} size={12} />
            <span>{t.label}</span>
          </button>
        ))}
        <span style={{ marginLeft: 12,
                       fontSize: 11,
                       color: 'var(--forge-ink-mute)' }}>Hatch</span>
        <HatchPicker value={hatchId} onChange={setHatchId} />
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <PreviewCanvas doc={doc} theme={theme} />
      </div>

      <footer style={footerStyle}>
        <span data-testid="forge-draft-count-curves">
          Curves: {doc.curves.length}
        </span>
        <span data-testid="forge-draft-count-modify">
          Modify ops: {doc.modifies.length}
        </span>
        <span data-testid="forge-draft-count-annotations">
          Annotations: {doc.annotations.length}
        </span>
        <span style={{ flex: 1 }} />
        <span data-testid="forge-draft-tools-total"
              style={{ fontFamily: 'var(--forge-mono, ui-monospace, monospace)' }}>
          {DRAFT_TOOL_COUNT} tools available
        </span>
        <span data-testid="forge-draft-status">{status}</span>
        {lastError ? (
          <span data-testid="forge-draft-error"
                style={{ color: 'var(--forge-err, #ff6363)',
                         fontFamily: 'var(--forge-mono, ui-monospace, monospace)' }}>
            err: {lastError}
          </span>
        ) : null}
      </footer>
    </div>
  );
}

/* --------------------------------------------------------------- */
/*  Host — portal mount + window hook + workbench-tab autoshow     */
/* --------------------------------------------------------------- */

export function DraftWorkbenchHost() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState('dark');
  const mountedRef = useRef(false);

  // Single mount registration. Stable []-deps array; the cleanup
  // function tears down EXACTLY the hooks this effect set, so an
  // accidental remount can never collide with a stale instance.
  useEffect(() => {
    if (mountedRef.current) return undefined;
    mountedRef.current = true;
    if (typeof window === 'undefined') return undefined;

    const onOpen = (opts) => {
      if (opts && typeof opts === 'object' && (opts.theme === 'dark' || opts.theme === 'light')) {
        setTheme(opts.theme);
      }
      setOpen(true);
    };
    const onClose = () => setOpen(false);

    window.__forgeOpenDraft  = onOpen;
    window.__forgeCloseDraft = onClose;

    const onEvt = (e) => {
      const d = e?.detail || {};
      if (d.theme === 'dark' || d.theme === 'light') setTheme(d.theme);
      setOpen(true);
    };
    window.addEventListener(DRAFT_PANEL_EVENT, onEvt);

    const onWbChange = (e) => {
      const w = e?.detail?.wb;
      if (w === 'draft') setOpen(true);
    };
    window.addEventListener('forge:wb-changed', onWbChange);

    // Pick up the shell's theme snapshot if it's already mounted.
    const t = window.__forgeTheme;
    if (t === 'dark' || t === 'light') setTheme(t);

    const onThemeProbe = () => {
      const cur = window.__forgeTheme;
      if (cur === 'dark' || cur === 'light') setTheme(cur);
    };
    window.addEventListener('forge:theme-changed', onThemeProbe);

    return () => {
      window.removeEventListener(DRAFT_PANEL_EVENT, onEvt);
      window.removeEventListener('forge:wb-changed', onWbChange);
      window.removeEventListener('forge:theme-changed', onThemeProbe);
      if (window.__forgeOpenDraft === onOpen) delete window.__forgeOpenDraft;
      if (window.__forgeCloseDraft === onClose) delete window.__forgeCloseDraft;
    };
  }, []);

  // Click-to-open: when the user taps the Draft workbench tab on the
  // rail, open the overlay. This effect's listener never dispatches
  // any state that the listener itself depends on, so no #185 loop.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onClick = (e) => {
      const tab = e.target?.closest?.('[data-wb="draft"]');
      if (tab) setOpen(true);
    };
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, []);

  return (
    <DraftWorkbench open={open} theme={theme} onClose={() => setOpen(false)} />
  );
}

export default DraftWorkbench;
