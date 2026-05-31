import { useEffect, useState } from 'react';

/**
 * DFM Check Panel — surfaces foundation.checkManifoldDFM results
 * as a traffic-light list. Pops when window.__lastDFMResult
 * populates, showing per-issue severity + recommendation, plus
 * the underlying geometric metrics that drove each finding.
 *
 * Exports CSV (issue list for review) and JSON (full payload
 * including metrics — easy hook-up to PLM gate checks).
 */
export default function DFMCheckPanel() {
  const [report, setReport] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const tick = () => {
      const next = typeof window !== 'undefined' ? window.__lastDFMResult : null;
      if (next && next !== report) {
        setReport(next);
        setVisible(true);
      }
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [report]);

  if (!visible || !report) return null;

  const handleDownload = (format) => {
    const stamp = new Date().toISOString().slice(0, 10);
    let body, name, type;
    if (format === 'json') {
      body = JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2);
      name = `archdisc-dfm-${stamp}.json`;
      type = 'application/json';
    } else {
      const rows = [
        ['Severity', 'Code', 'Title', 'Detail', 'Recommendation'],
        ...report.issues.map(i => [
          i.severity.toUpperCase(), i.code, csvCell(i.title),
          csvCell(i.detail), csvCell(i.recommendation),
        ]),
      ];
      body = rows.map(r => r.join(',')).join('\n');
      name = `archdisc-dfm-${stamp}.csv`;
      type = 'text/csv';
    }
    const blob = new Blob([body], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const m = report.metrics;
  const overall = report.summary.overall;
  return (
    <div className="dfm-backdrop" onClick={() => setVisible(false)}>
      <div className="dfm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dfm-header">
          <span className={`dfm-light dfm-light-${overall}`}>{labelFor(overall)}</span>
          <span className="dfm-title">Design For Manufacturing — {summaryLine(report.summary)}</span>
          <button className="dfm-btn" onClick={() => handleDownload('csv')}  data-action="dfm-csv">CSV</button>
          <button className="dfm-btn" onClick={() => handleDownload('json')} data-action="dfm-json">JSON</button>
          <button className="dfm-close" onClick={() => setVisible(false)} data-action="dfm-close">×</button>
        </div>
        <div className="dfm-body">
          <div className="dfm-metrics">
            <Metric label="Aspect ratio"   value={m.aspectRatio.toFixed(2)} />
            <Metric label="Char. thickness" value={`${m.characteristicThickness_mm.toFixed(2)} mm`} />
            <Metric label="Smallest dim"   value={`${m.smallestDim_mm.toFixed(2)} mm`} />
            <Metric label="Genus"          value={m.genus} />
            <Metric label="Volume"         value={`${(m.volume_mm3 / 1000).toFixed(2)} cm³`} />
            <Metric label="Mass (Al)"      value={`${(m.mass_kg * 1000).toFixed(0)} g`} />
          </div>

          <ul className="dfm-issues" data-dfm-issues>
            {report.issues.length === 0 && (
              <li className="dfm-issue dfm-issue-pass">
                <span className={`dfm-light dfm-light-pass`}>OK</span>
                <div className="dfm-issue-body">
                  <div className="dfm-issue-title">No DFM issues found</div>
                  <div className="dfm-issue-detail">The part passes all geometric DFM heuristics.</div>
                </div>
              </li>
            )}
            {report.issues.map((i, idx) => (
              <li key={idx} className={`dfm-issue dfm-issue-${i.severity}`} data-dfm-severity={i.severity}>
                <span className={`dfm-light dfm-light-${i.severity}`}>{labelFor(i.severity)}</span>
                <div className="dfm-issue-body">
                  <div className="dfm-issue-title">{i.title}</div>
                  <div className="dfm-issue-detail">{i.detail}</div>
                  <div className="dfm-issue-fix">Fix → {i.recommendation}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="dfm-metric">
      <span className="dfm-metric-value">{value}</span>
      <span className="dfm-metric-label">{label}</span>
    </div>
  );
}

function labelFor(severity) {
  if (severity === 'error') return 'FAIL';
  if (severity === 'warn')  return 'WARN';
  if (severity === 'info')  return 'INFO';
  return 'PASS';
}

function summaryLine(s) {
  return `${s.errors} errors, ${s.warnings} warnings, ${s.infos} infos`;
}

function csvCell(s) {
  // Escape commas + quotes for CSV.
  const v = String(s ?? '');
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
