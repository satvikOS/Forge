// Forge-65 — bottom status bar (26 px). Professional, CATIA / SolidWorks / NX
// grade: a three-zone strip — LEFT context (mode + selection), CENTER
// measurement / coordinate readout (tabular numerals), RIGHT units · snap ·
// grid + a slim activity indicator.
//
// Refined-neutral / monochrome only: graphite ink on the canvas, hairline
// dividers, a single restrained status dot. All spacing / sizing / type comes
// from the --fds-* design-system tokens (forge-tokens.css) — no ad-hoc values.
//
// Visual + layout upgrade ONLY. The public prop signature is unchanged and
// fully back-compatible, so the shell's `<StatusBar workbench selection />`
// call site stays untouched. The `data-testid="forge-statusbar"` contract is
// preserved verbatim. The center measurement readout and the right-side
// activity indicator are driven from EXISTING read-only sources
// (window.__forgeBodies + computeBodyStats, and the progressBus event channel)
// — pure subscriptions, no behavior / logic changes.

import React, { useEffect, useState } from 'react';
import { computeBodyStats } from './HoverTooltip.jsx';
import { listJobs } from './progressBus.js';
import {
  getActiveDatum, getSnapTarget, datumLabel, snapLabel,
  DATUM_CONTEXT_EVENT,
} from './datumContextStore.js';
import { filterNoun, isFilterKind } from './selectionFilterApi.js';
import './StatusBar.css';

// Human workbench label for the mode segment (falls back to the raw id).
const WB_LABEL = {
  mech: 'Part', draft: 'Draft', drawing: 'Drawing', sheet: 'Sheet Metal',
  weld: 'Weldment', mold: 'Mold', sim: 'Simulation', mfg: 'Manufacture',
  arch: 'Architecture', mesh: 'Mesh', robot: 'Robotics',
};

// Selection-kind → readable noun (singular / plural by count).
const SEL_NOUN = {
  body: ['body', 'bodies'], face: ['face', 'faces'], edge: ['edge', 'edges'],
  vertex: ['vertex', 'vertices'], feature: ['feature', 'features'],
};

function selectionLabel(selection) {
  if (!selection || selection.kind === 'none') return null;
  const n = selection.ids?.length ?? 0;
  const noun = SEL_NOUN[selection.kind] || [selection.kind, selection.kind];
  if (n === 0) return `${noun[0]} filter`;
  return `${n} ${n === 1 ? noun[0] : noun[1]}`;
}

// Resolve the selected body (if exactly one body is picked) from the live
// registry, so the center segment can show a real measured readout.
function resolveSelectedBody(selection) {
  if (!selection || selection.kind !== 'body') return null;
  const handle = selection.bodyHandle ?? selection.ids?.[0];
  if (handle == null) return null;
  const reg = (typeof window !== 'undefined' && window.__forgeBodies) || [];
  return reg.find((b) => b.handle === handle || b.id === handle) || null;
}

// Compact engineering formatting for the measurement readout. Tabular figures
// keep columns aligned and never reflow.
function fmtNum(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.01 || a >= 1e6)) return v.toExponential(2);
  return v.toLocaleString(undefined, {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}

// A small labelled value cell with mono / tabular figures.
function Readout({ label, value, unit, testid }) {
  return (
    <span className="forge-statusbar-readout" data-testid={testid}>
      <span className="forge-statusbar-key">{label}</span>
      <span className="forge-statusbar-val fds-num">{value}</span>
      {unit ? <span className="forge-statusbar-unit">{unit}</span> : null}
    </span>
  );
}

export function StatusBar({ units = 'mm', snap = true, ortho = false,
                            fps = 60, selection, savedAt = null,
                            workbench = 'mech' }) {
  // ----- live activity indicator (read-only progressBus subscription) -----
  const [activity, setActivity] = useState(() => {
    try { return listJobs().filter((j) => j.status === 'running'); }
    catch { return []; }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const refresh = () => {
      try { setActivity(listJobs().filter((j) => j.status === 'running')); }
      catch { setActivity([]); }
    };
    window.addEventListener('forge:progress', refresh);
    refresh();
    return () => window.removeEventListener('forge:progress', refresh);
  }, []);

  // ----- active-datum / CSYS + snap-target context (Task #21) -----
  // Read-only subscription to datumContextStore. The store is mutated by
  // the imperative window API (DatumContextHost) — never a setter here.
  const [datum, setDatum] = useState(() => {
    try { return getActiveDatum(); } catch { return null; }
  });
  const [snapTarget, setSnapTargetState] = useState(() => {
    try { return getSnapTarget(); } catch { return null; }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onCtx = (e) => {
      setDatum(e?.detail?.datum ?? null);
      setSnapTargetState(e?.detail?.snap ?? null);
    };
    window.addEventListener(DATUM_CONTEXT_EVENT, onCtx);
    return () => window.removeEventListener(DATUM_CONTEXT_EVENT, onCtx);
  }, []);

  // ----- active selection-filter kind mirror (Task #21) -----
  const [filterKind, setFilterKind] = useState(() =>
    (typeof window !== 'undefined' && isFilterKind(window.__forgeSelectionFilter))
      ? window.__forgeSelectionFilter : null);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onFilter = (e) => {
      const k = e?.detail?.kind;
      if (isFilterKind(k)) setFilterKind(k);
    };
    window.addEventListener('forge:filter-changed', onFilter);
    return () => window.removeEventListener('forge:filter-changed', onFilter);
  }, []);

  const job = activity[0] || null;
  const jobPct = job ? Math.max(0, Math.min(100, job.pct || 0)) : 0;
  const busy = !!job;

  // ----- derived context -----
  const wbLabel = WB_LABEL[workbench] || workbench;
  const selLabel = selectionLabel(selection);
  const hasSel = !!selLabel;

  // ----- center measurement readout -----
  const body = resolveSelectedBody(selection);
  let stats = null;
  if (body) { try { stats = computeBodyStats(body); } catch { stats = null; } }

  return (
    <div className="forge-statusbar"
         role="status"
         aria-label="Application status"
         data-testid="forge-statusbar">

      {/* ---- LEFT · context / selection + mode ---- */}
      <div className="forge-statusbar-zone forge-statusbar-zone--left">
        <span className="forge-statusbar-mode" data-testid="forge-statusbar-mode">
          <span className={`fds-dot ${busy ? 'fds-dot--warn' : 'fds-dot--idle'}`}
                aria-hidden="true" />
          <span className="forge-statusbar-mode-label">{wbLabel}</span>
        </span>
        <span className="forge-statusbar-div" aria-hidden="true" />
        <span className="forge-statusbar-sel" data-testid="forge-statusbar-selection">
          {hasSel ? (
            <>
              <span className="forge-statusbar-key">Sel</span>
              <span className="forge-statusbar-val fds-num">{selLabel}</span>
            </>
          ) : (
            <span className="forge-statusbar-muted">No selection</span>
          )}
        </span>

        {/* Active selection-filter kind (Task #21) — what class of
            entity picks land on. Mirrors window.__forgeSelectionFilter
            via the forge:filter-changed bus. */}
        {filterKind ? (
          <>
            <span className="forge-statusbar-div" aria-hidden="true" />
            <span className="forge-statusbar-toggle"
                  data-on="true"
                  data-kind={filterKind}
                  data-testid="forge-statusbar-filter">
              <span className="forge-statusbar-key">Filter</span>
              <span className="forge-statusbar-state fds-num">
                {filterNoun(filterKind, 0)}
              </span>
            </span>
          </>
        ) : null}

        {/* Active datum / CSYS (Task #21) — NX WCS / Creo coordinate
            system footer readout. Only shown when a datum is active. */}
        {datum ? (
          <>
            <span className="forge-statusbar-div" aria-hidden="true" />
            <span className="forge-statusbar-toggle"
                  data-on="true"
                  data-datum={datum.name}
                  data-datum-type={datum.type}
                  data-testid="forge-statusbar-datum"
                  title={`Active datum · ${datumLabel(datum)}`}>
              <span className="forge-statusbar-key">Datum</span>
              <span className="forge-statusbar-state fds-num">{datumLabel(datum)}</span>
            </span>
          </>
        ) : null}

        {/* Live snap-target (Task #21) — Creo snap-reference readout.
            Shows the snap type (+ coords when supplied). */}
        {snapTarget ? (
          <>
            <span className="forge-statusbar-div" aria-hidden="true" />
            <span className="forge-statusbar-toggle"
                  data-on="true"
                  data-snap-type={snapTarget.type}
                  data-testid="forge-statusbar-snaptarget"
                  title={`Snap · ${snapLabel(snapTarget)}`}>
              <span className="forge-statusbar-key">Snap→</span>
              <span className="forge-statusbar-state fds-num">{snapLabel(snapTarget)}</span>
            </span>
          </>
        ) : null}
      </div>

      {/* ---- CENTER · measurement / coordinate readout ---- */}
      <div className="forge-statusbar-zone forge-statusbar-zone--center"
           data-testid="forge-statusbar-measure">
        {stats ? (
          <>
            <Readout label="Vol" value={fmtNum(stats.volume_mm3, 0)} unit={`${units}³`}
                     testid="forge-statusbar-vol" />
            <span className="forge-statusbar-div" aria-hidden="true" />
            <Readout label="Area" value={fmtNum(stats.surface_mm2, 0)} unit={`${units}²`}
                     testid="forge-statusbar-area" />
            <span className="forge-statusbar-div" aria-hidden="true" />
            <Readout label="Mass" value={fmtNum(stats.mass_g, 1)} unit="g"
                     testid="forge-statusbar-mass" />
            <span className="forge-statusbar-div" aria-hidden="true" />
            <span className="forge-statusbar-readout" data-testid="forge-statusbar-centroid">
              <span className="forge-statusbar-key">XYZ</span>
              <span className="forge-statusbar-val fds-num">
                {(stats.centroid || [0, 0, 0]).map((c) => fmtNum(c, 1)).join('  ')}
              </span>
            </span>
          </>
        ) : (
          <span className="forge-statusbar-muted forge-statusbar-ready">
            Ready
          </span>
        )}
      </div>

      {/* ---- RIGHT · units · snap · grid + activity ---- */}
      <div className="forge-statusbar-zone forge-statusbar-zone--right">
        <Readout label="Units" value={units} testid="forge-statusbar-units" />
        <span className="forge-statusbar-div" aria-hidden="true" />
        <span className="forge-statusbar-toggle"
              data-on={snap ? 'true' : 'false'}
              data-testid="forge-statusbar-snap">
          <span className="forge-statusbar-key">Snap</span>
          <span className="forge-statusbar-state fds-num">{snap ? 'On' : 'Off'}</span>
        </span>
        <span className="forge-statusbar-toggle"
              data-on={ortho ? 'true' : 'false'}
              data-testid="forge-statusbar-grid">
          <span className="forge-statusbar-key">Grid</span>
          <span className="forge-statusbar-state fds-num">{ortho ? 'Ortho' : 'Iso'}</span>
        </span>
        <span className="forge-statusbar-div" aria-hidden="true" />
        <Readout label="FPS" value={fps} testid="forge-statusbar-fps" />
        <span className="forge-statusbar-div" aria-hidden="true" />
        <span className="forge-statusbar-activity"
              data-busy={busy ? 'true' : 'false'}
              data-testid="forge-statusbar-activity"
              title={job ? `${job.label} · ${Math.round(jobPct)}%` : 'Idle'}>
          <span className="forge-statusbar-activity-label">
            {busy ? (job.label || 'Working') : (savedAt ? 'Saved' : 'Idle')}
          </span>
          <span className="forge-statusbar-activity-track" aria-hidden="true">
            <span className="forge-statusbar-activity-fill"
                  style={busy ? { width: `${jobPct}%` } : undefined} />
          </span>
          {busy ? (
            <span className="forge-statusbar-activity-pct fds-num">
              {Math.round(jobPct)}%
            </span>
          ) : (
            <span className="forge-statusbar-activity-pct fds-num"
                  data-testid="forge-statusbar-saved">
              {savedAt ? new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
