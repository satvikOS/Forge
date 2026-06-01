// Forge-130 — revision clouds + revision table.
//
// A drawing revision is the change record set placed on a print to log
// engineering edits. Forge-130 exposes two complementary surfaces:
//
//   • RevisionCloudLayer — renders a free-form scalloped polyline (the
//     "cloud" callout) around a region of any drawing view, anchored to
//     the view's id + the cloud's centroid so it follows the view when
//     it moves.
//
//   • RevisionTable — bottom-right corner block listing every revision
//     (rev letter, description, ECN reference, date, drawn-by initials).
//     Rows can be appended via the inspector or via the workbench
//     toolbar's "+ Revision" button.
//
// Both stores live in module-state with a useSyncExternalStore subscribe
// hook so the inspector + the sheet stay in sync without prop drilling.

import React, { useCallback, useSyncExternalStore } from 'react';

const LS_REV_KEY    = 'forge.v4.revisions';
const LS_CLOUD_KEY  = 'forge.v4.revisionClouds';
const subs = new Set();

function notify() {
  for (const s of subs) { try { s(); } catch (err) { /* keep going */ } }
}

function loadLS(key) {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function saveLS(key, v) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
}

let _revs   = loadLS(LS_REV_KEY);
let _clouds = loadLS(LS_CLOUD_KEY);

// ── revision rows --------------------------------------------------

export function listRevisions() { return _revs.slice(); }

export function nextRevLetter() {
  // A, B, C, … skipping I, O, Q, S, X, Z (per ASME Y14.35 conventions).
  const skip = new Set(['I', 'O', 'Q', 'S', 'X', 'Z']);
  const used = new Set(_revs.map((r) => r.rev));
  for (let code = 65; code <= 90; code++) {
    const c = String.fromCharCode(code);
    if (!skip.has(c) && !used.has(c)) return c;
  }
  return `A${_revs.length}`;
}

export function addRevision({ rev, description = '', ecn = '', date, drawnBy = '' }) {
  const entry = {
    id:         `rev-${Date.now()}-${Math.floor(Math.random() * 0xfff).toString(16)}`,
    rev:        String(rev || nextRevLetter()),
    description,
    ecn,
    date:       date || new Date().toISOString().slice(0, 10),
    drawnBy,
    createdAt:  Date.now(),
  };
  _revs = [..._revs, entry];
  saveLS(LS_REV_KEY, _revs);
  notify();
  return entry;
}

export function updateRevision(id, patch) {
  _revs = _revs.map((r) => r.id === id ? { ...r, ...patch } : r);
  saveLS(LS_REV_KEY, _revs);
  notify();
}

export function removeRevision(id) {
  _revs = _revs.filter((r) => r.id !== id);
  saveLS(LS_REV_KEY, _revs);
  notify();
}

// ── revision clouds ------------------------------------------------

export function listClouds() { return _clouds.slice(); }
export function listCloudsForView(viewId) {
  return _clouds.filter((c) => c.viewId === viewId);
}

/**
 * Add a new revision cloud. `points` is an array of [x,y] in view-space
 * (NOT sheet-space) so the cloud follows when the view moves on the sheet.
 */
export function addCloud({ viewId, points, revId = null, rev = '' }) {
  if (!viewId || !Array.isArray(points) || points.length < 3) return null;
  const entry = {
    id:        `rc-${Date.now()}-${Math.floor(Math.random() * 0xfff).toString(16)}`,
    viewId,
    points:    points.map((p) => [p[0], p[1]]),
    revId,
    rev:       String(rev || ''),
    createdAt: Date.now(),
  };
  _clouds = [..._clouds, entry];
  saveLS(LS_CLOUD_KEY, _clouds);
  notify();
  return entry;
}

export function removeCloud(id) {
  _clouds = _clouds.filter((c) => c.id !== id);
  saveLS(LS_CLOUD_KEY, _clouds);
  notify();
}

// ── subscribe hook -------------------------------------------------

export function subscribe(cb) {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function useRevisions() {
  return useSyncExternalStore(subscribe, listRevisions, listRevisions);
}
export function useClouds() {
  return useSyncExternalStore(subscribe, listClouds, listClouds);
}

// ── cloud renderer -------------------------------------------------

/**
 * Convert a polyline of points into a scalloped path. Each segment is
 * replaced by a series of outward-curving arcs, simulating the hand-drawn
 * "cloud" symbol used to highlight revised regions.
 *
 * @param {Array<[number,number]>} points
 * @param {number} radius     scallop radius (mm)
 */
export function scallopPath(points, radius = 3) {
  if (!points || points.length < 2) return '';
  // close the polygon
  const pts = points[0].join(',') === points[points.length - 1].join(',')
    ? points.slice(0, -1) : points;
  const segs = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const n = Math.max(1, Math.round(len / (radius * 1.6)));
    const stepX = dx / n, stepY = dy / n;
    for (let k = 0; k < n; k++) {
      const sx = a[0] + stepX * k;
      const sy = a[1] + stepY * k;
      const ex = a[0] + stepX * (k + 1);
      const ey = a[1] + stepY * (k + 1);
      // outward bulge — the perpendicular for a CCW polygon swept
      // outward is (-dy, dx) but we don't know winding, so just bulge
      // away from the segment midpoint along its normal.
      segs.push({ sx, sy, ex, ey });
    }
  }
  let path = `M ${segs[0].sx} ${segs[0].sy}`;
  for (const s of segs) {
    // sweep-flag = 1 → outward arc
    path += ` A ${radius} ${radius} 0 0 1 ${s.ex} ${s.ey}`;
  }
  path += ' Z';
  return path;
}

export function RevisionCloudLayer({ clouds, viewId, ink = 'currentColor',
                                     onRemove }) {
  const my = clouds.filter((c) => c.viewId === viewId);
  if (!my.length) return null;
  return (
    <g data-testid="forge-revision-cloud-layer"
       data-rc-view={viewId}
       data-rc-count={my.length}>
      {my.map((c) => (
        <g key={c.id}
           data-rc-id={c.id}
           data-rc-rev={c.rev || ''}>
          <path d={scallopPath(c.points)}
                fill="none"
                stroke="red"
                strokeOpacity={0.85}
                strokeWidth={0.5} />
          {c.rev && (
            <RevTriangleBalloon
              x={c.points[0][0]} y={c.points[0][1] - 5}
              rev={c.rev}
              ink={ink}
            />
          )}
        </g>
      ))}
    </g>
  );
}

function RevTriangleBalloon({ x, y, rev, ink }) {
  const s = 4.2;
  return (
    <g data-rc-balloon="true" data-rc-balloon-rev={rev}>
      <polygon
        points={`${x},${y - s} ${x - s},${y + s} ${x + s},${y + s}`}
        fill="white" stroke={ink} strokeWidth={0.4} />
      <text x={x} y={y + s / 2.2} textAnchor="middle"
            fontFamily="var(--forge-mono)" fontSize={3} fontWeight={700}
            fill={ink}>{rev}</text>
    </g>
  );
}

// ── table block ----------------------------------------------------

/**
 * Compact revision table rendered as SVG. Anchored at sheet bottom-right
 * (above the title block) by the workbench layout.
 */
export function RevisionTable({ revisions, x, y, w, h, ink = 'currentColor' }) {
  const rowH    = Math.max(4, h / Math.max(revisions.length + 1, 4));
  const cols    = [
    { key: 'rev',         label: 'REV',  width: 0.10 },
    { key: 'description', label: 'DESCRIPTION', width: 0.45 },
    { key: 'ecn',         label: 'ECN',  width: 0.18 },
    { key: 'date',        label: 'DATE', width: 0.17 },
    { key: 'drawnBy',     label: 'BY',   width: 0.10 },
  ];
  const colXs = cols.reduce((acc, c) => {
    const last = acc[acc.length - 1] || { x: x, w: 0 };
    acc.push({ ...c, x: last.x + last.w, w: c.width * w });
    return acc;
  }, []);
  return (
    <g data-testid="forge-revision-table"
       data-rev-table-rows={revisions.length}>
      <rect x={x} y={y} width={w} height={h}
            fill="white" stroke={ink} strokeWidth={0.4} />
      {/* header row */}
      <rect x={x} y={y} width={w} height={rowH}
            fill="rgba(0,0,0,0.04)" stroke={ink} strokeWidth={0.3} />
      {colXs.map((c) => (
        <g key={c.key} data-rev-col={c.key}>
          <line x1={c.x} y1={y} x2={c.x} y2={y + h}
                stroke={ink} strokeWidth={0.2} />
          <text x={c.x + 1.5} y={y + rowH - 1.4}
                fontFamily="var(--forge-mono)" fontSize={2.4} fontWeight={700}
                fill={ink}>{c.label}</text>
        </g>
      ))}
      {/* data rows */}
      {revisions.map((r, i) => {
        const ry = y + rowH * (i + 1);
        return (
          <g key={r.id} data-rev-row={r.id} data-rev-letter={r.rev}>
            <line x1={x} y1={ry} x2={x + w} y2={ry}
                  stroke={ink} strokeWidth={0.2} />
            {colXs.map((c) => (
              <text key={c.key}
                    x={c.x + 1.5} y={ry + rowH - 1.4}
                    fontFamily="var(--forge-mono)" fontSize={2.4} fill={ink}
                    data-rev-cell={`${r.id}-${c.key}`}
                    data-rev-cell-value={String(r[c.key] || '')}>
                {clip(r[c.key], c.w)}
              </text>
            ))}
          </g>
        );
      })}
    </g>
  );
}

function clip(text, widthMm) {
  if (text == null) return '';
  const s = String(text);
  const max = Math.max(4, Math.floor(widthMm / 1.3));
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// ── inspector helpers ----------------------------------------------

export function RevisionTableInspector({ onClose, onCreateCloud }) {
  const revs = useRevisions();
  const clouds = useClouds();
  const create = useCallback(() => {
    addRevision({
      description: 'Updated per ECN',
      ecn: `ECN-${1000 + revs.length}`,
      drawnBy: '',
    });
  }, [revs.length]);

  return (
    <div data-testid="forge-revision-inspector"
         style={{
           display: 'flex', flexDirection: 'column', gap: 6,
           fontSize: 11,
         }}>
      <div style={{ display: 'flex', gap: 4 }}>
        <button type="button"
                data-testid="forge-rev-add"
                onClick={create}
                style={{
                  background: 'var(--forge-surface)',
                  border: '1px solid var(--forge-rail-edge)',
                  color: 'var(--forge-ink)',
                  borderRadius: 3, padding: '3px 8px',
                  cursor: 'pointer',
                }}>+ Revision row</button>
        {onCreateCloud && (
          <button type="button"
                  data-testid="forge-rev-cloud-add"
                  onClick={onCreateCloud}
                  style={{
                    background: 'var(--forge-surface)',
                    border: '1px solid var(--forge-rail-edge)',
                    color: 'var(--forge-ink)',
                    borderRadius: 3, padding: '3px 8px',
                    cursor: 'pointer',
                  }}>+ Cloud</button>
        )}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                   fontFamily: 'var(--forge-mono)', fontSize: 10,
                   color: 'var(--forge-ink-2)' }}>
        {revs.map((r) => (
          <li key={r.id} data-rev-list-id={r.id} data-rev-list-letter={r.rev}
              style={{ display: 'flex', alignItems: 'center', gap: 4,
                       padding: '2px 0',
                       borderBottom: '1px solid var(--forge-rail-edge)' }}>
            <span style={{ width: 14, fontWeight: 700 }}>{r.rev}</span>
            <input value={r.description}
                   onChange={(e) => updateRevision(r.id, { description: e.target.value })}
                   data-rev-desc={r.id}
                   style={{ flex: 1, background: 'var(--forge-canvas)',
                            border: '1px solid var(--forge-rail-edge)',
                            color: 'var(--forge-ink)',
                            padding: '2px 4px', fontSize: 10 }} />
            <input value={r.ecn}
                   onChange={(e) => updateRevision(r.id, { ecn: e.target.value })}
                   data-rev-ecn={r.id}
                   style={{ width: 60, background: 'var(--forge-canvas)',
                            border: '1px solid var(--forge-rail-edge)',
                            color: 'var(--forge-ink)',
                            padding: '2px 4px', fontSize: 10 }} />
            <button type="button"
                    aria-label="Remove revision row"
                    onClick={() => removeRevision(r.id)}
                    style={{
                      background: 'transparent', border: 'none',
                      color: 'var(--forge-ink-mute)', cursor: 'pointer',
                    }}>×</button>
          </li>
        ))}
      </ul>
      <div style={{ fontSize: 10, color: 'var(--forge-ink-mute)' }}>
        Clouds: <span data-testid="forge-rev-cloud-count">{clouds.length}</span>
      </div>
    </div>
  );
}

export default RevisionTable;
