/**
 * CutListPanel — UX Tier 6c Weldments Cut List.
 *
 * Headline Weldments-fabrication deliverable: a BOM table aggregating every
 * weldment-tagged structural member in the scene by `(profile, size, length)`
 * triple. The welder reads the table, orders + cuts that many pieces of each
 * stock bar.
 *
 * Mount: sibling of EquationManager inside SwUxOverlays' overlay tree.
 * Renders nothing until the global event `archdisc:open-cut-list` fires
 * (from the ribbon entry or the AI orchestration layer).
 *
 * Style: matches the Equation-Manager visual idiom (full-page modal,
 * sw-panel-* token set, sticky table header) — see CutListPanel.css.
 *
 * Table columns: Item No / Profile / Size / Length (mm) / Qty / Total (mm).
 *
 * Footer actions:
 *   - Copy CSV  → comma-separated, RFC-4180 quoting; clipboard.
 *   - Copy TSV  → tab-separated (Excel paste); clipboard.
 *
 * Internally delegates to `K.brep.cutList({ rounding })`, which scans
 * `__archdiscBodies.bodies[]` for `metadata.weldment.{profile,size,length}`
 * triples and groups them. Reinforcement bodies (gusset / weldBead) are
 * filtered out at the kernel layer.
 */

import { useEffect, useState, useCallback } from 'react';
import { X, ClipboardCopy, Hammer } from 'lucide-react';
import { ArchDiscKernel } from '../kernel/brep/ArchDiscKernel.js';
import './CutListPanel.css';

const DEFAULT_ROUNDING = 1;

export function CutListPanel() {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState({ groups: [], totalLines: 0, totalLengthMm: 0 });
  const [feedback, setFeedback] = useState(null); // {type:'ok'|'err', message}

  const refresh = useCallback(() => {
    try {
      const r = ArchDiscKernel.brep.cutList({ rounding: DEFAULT_ROUNDING });
      setReport(r);
      if (typeof window !== 'undefined') {
        window.__lastCutList = r;
      }
    } catch (err) {
      setReport({ groups: [], totalLines: 0, totalLengthMm: 0 });
      setFeedback({ type: 'err', message: 'Cut List: ' + (err.message || err) });
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onOpen = () => { setOpen(true); setFeedback(null); refresh(); };
    const onClose = () => { setOpen(false); setFeedback(null); };
    window.addEventListener('archdisc:open-cut-list', onOpen);
    window.addEventListener('archdisc:close-cut-list', onClose);
    return () => {
      window.removeEventListener('archdisc:open-cut-list', onOpen);
      window.removeEventListener('archdisc:close-cut-list', onClose);
    };
  }, [refresh]);

  // Esc closes.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const copyCsv = useCallback(async () => {
    const text = serialiseRows(report, ',');
    await writeToClipboard(text, setFeedback, 'CSV');
  }, [report]);

  const copyTsv = useCallback(async () => {
    const text = serialiseRows(report, '\t');
    await writeToClipboard(text, setFeedback, 'TSV');
  }, [report]);

  if (!open) return null;

  return (
    <div
      className="archdisc-cutlist-backdrop"
      data-archdisc-cutlist-backdrop="open"
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div
        className="archdisc-cutlist-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Weldments Cut List"
        data-archdisc-cutlist-modal="open"
        data-archdisc-cutlist-row-count={String(report.groups.length)}
        data-archdisc-cutlist-total-length-mm={String(report.totalLengthMm)}
      >
        <header className="archdisc-cutlist-header">
          <div className="archdisc-cutlist-title">
            <Hammer size={14} />
            <span>Cut List</span>
            <span className="archdisc-cutlist-subtitle">
              Weldments BOM · grouped by profile / size / length
            </span>
          </div>
          <button
            type="button"
            className="archdisc-cutlist-close"
            title="Close (Esc)"
            aria-label="Close Cut List"
            data-archdisc-cutlist-close
            onClick={() => setOpen(false)}
          >
            <X size={14} strokeWidth={3} />
          </button>
        </header>

        <div className="archdisc-cutlist-hint">
          {report.totalLines === 0
            ? <>No weldment members in the scene. Run <code>Structural Member</code> on the Weldments tab to populate the cut list.</>
            : <>{report.totalLines} line item{report.totalLines === 1 ? '' : 's'} · {report.groups.reduce((s, g) => s + g.quantity, 0)} member{report.groups.reduce((s, g) => s + g.quantity, 0) === 1 ? '' : 's'} · total {report.totalLengthMm.toLocaleString()} mm of stock.</>}
        </div>

        <div className="archdisc-cutlist-table-wrap">
          <table className="archdisc-cutlist-table" data-archdisc-cutlist-table="rendered">
            <thead>
              <tr>
                <th className="col-item">Item No</th>
                <th className="col-profile">Profile</th>
                <th className="col-size">Size</th>
                <th className="col-length">Length (mm)</th>
                <th className="col-qty">Qty</th>
                <th className="col-total">Total (mm)</th>
              </tr>
            </thead>
            <tbody>
              {report.groups.length === 0 ? (
                <tr className="archdisc-cutlist-empty-row">
                  <td colSpan={6} className="archdisc-cutlist-empty">
                    No structural members tagged as weldments yet.
                  </td>
                </tr>
              ) : report.groups.map((g) => (
                <tr
                  key={g.itemNo}
                  data-archdisc-cutlist-row={g.itemNo}
                  data-archdisc-cutlist-profile={g.profile}
                  data-archdisc-cutlist-size={g.size}
                  data-archdisc-cutlist-length={String(g.lengthMm)}
                  data-archdisc-cutlist-qty={String(g.quantity)}
                >
                  <td className="col-item">{g.itemNo}</td>
                  <td className="col-profile">
                    <span className="archdisc-cutlist-profile-pill">{g.profile}</span>
                  </td>
                  <td className="col-size">
                    <code>{g.size}</code>
                  </td>
                  <td className="col-length">{g.lengthMm.toLocaleString()}</td>
                  <td className="col-qty">
                    <span className="archdisc-cutlist-qty-badge">{g.quantity}</span>
                  </td>
                  <td className="col-total">{g.totalLengthMm.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {feedback && (
          <div
            className={`archdisc-cutlist-feedback archdisc-cutlist-feedback-${feedback.type}`}
            data-archdisc-cutlist-feedback={feedback.type}
          >
            {feedback.message}
          </div>
        )}

        <footer className="archdisc-cutlist-footer">
          <div className="archdisc-cutlist-footer-meta">
            {report.totalLines} item{report.totalLines === 1 ? '' : 's'} · total {report.totalLengthMm.toLocaleString()} mm
          </div>
          <div className="archdisc-cutlist-footer-actions">
            <button
              type="button"
              className="archdisc-cutlist-action"
              title="Copy as CSV (comma-separated) to clipboard"
              data-archdisc-cutlist-copy="csv"
              onClick={copyCsv}
              disabled={report.groups.length === 0}
            >
              <ClipboardCopy size={11} />
              <span>Copy CSV</span>
            </button>
            <button
              type="button"
              className="archdisc-cutlist-action"
              title="Copy as TSV (tab-separated, Excel-friendly) to clipboard"
              data-archdisc-cutlist-copy="tsv"
              onClick={copyTsv}
              disabled={report.groups.length === 0}
            >
              <ClipboardCopy size={11} />
              <span>Copy TSV</span>
            </button>
            <button
              type="button"
              className="archdisc-cutlist-done"
              title="Done (Esc)"
              data-archdisc-cutlist-done
              onClick={() => setOpen(false)}
            >
              Done
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/**
 * Serialise the report's rows into a CSV/TSV string. RFC-4180-style quoting
 * is applied per-field for the comma case so commas / quotes / newlines in
 * `size` survive the trip through Excel.
 */
function serialiseRows(report, delim) {
  const header = ['Item No', 'Profile', 'Size', 'Length (mm)', 'Qty', 'Total (mm)'];
  const lines = [header.map(h => quoteField(h, delim)).join(delim)];
  for (const g of report.groups) {
    lines.push([
      g.itemNo,
      g.profile,
      g.size,
      g.lengthMm,
      g.quantity,
      g.totalLengthMm,
    ].map(c => quoteField(c, delim)).join(delim));
  }
  return lines.join('\n');
}

function quoteField(v, delim) {
  const s = String(v);
  if (delim === ',') {
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }
  // TSV: tabs / newlines inside a field would corrupt the layout; strip them.
  return s.replace(/[\t\n\r]/g, ' ');
}

async function writeToClipboard(text, setFeedback, label) {
  if (typeof navigator === 'undefined' || !navigator.clipboard
      || typeof navigator.clipboard.writeText !== 'function') {
    setFeedback({ type: 'err', message: `${label}: clipboard unavailable in this context.` });
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setFeedback({ type: 'ok', message: `${label} copied to clipboard (${text.split('\n').length} rows).` });
    if (typeof window !== 'undefined') {
      window.__lastCutListCopy = { format: label.toLowerCase(), bytes: text.length, at: Date.now() };
    }
  } catch (err) {
    setFeedback({ type: 'err', message: `${label} copy failed: ${err.message || err}` });
  }
}

export default CutListPanel;
