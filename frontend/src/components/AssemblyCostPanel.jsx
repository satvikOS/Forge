import { useEffect, useState } from 'react';

/**
 * Assembly Cost Panel — multi-body rollup of the Cost Estimation
 * formula. Iterates the BodyRegistry, lists every body as a line
 * item, sums to a grand total + sell price at margin.
 *
 * Pops when window.__lastAssemblyCost populates (Manufacture ribbon
 * → Assembly Cost). CSV / JSON exports formatted for procurement
 * (one row per part) and ERP/PLM ingestion respectively.
 */
export default function AssemblyCostPanel() {
  const [result, setResult] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const tick = () => {
      const next = typeof window !== 'undefined' ? window.__lastAssemblyCost : null;
      if (next && next !== result) {
        setResult(next);
        setVisible(true);
      }
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [result]);

  if (!visible || !result) return null;

  const handleDownload = (format) => {
    const stamp = new Date().toISOString().slice(0, 10);
    let body, name, type;
    if (format === 'json') {
      body = JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2);
      name = `archdisc-assembly-cost-${stamp}.json`;
      type = 'application/json';
    } else {
      const rows = [
        ['Part', 'Source', 'Mass (g)', 'Material ($)', 'CNC ($)', 'Setup ($)', 'Finish ($)', 'Subtotal ($)'],
        ...result.lineItems.map(l => [
          l.name, l.sourceTool ?? '',
          (l.mass_kg * 1000).toFixed(2),
          l.materialCost.toFixed(2),
          l.cncCost.toFixed(2),
          l.setupCost.toFixed(2),
          l.finishCost.toFixed(2),
          l.subtotal.toFixed(2),
        ]),
        [],
        ['TOTAL', '', (result.totals.mass_kg * 1000).toFixed(2),
         result.totals.materialCost.toFixed(2),
         result.totals.cncCost.toFixed(2),
         result.totals.setupCost.toFixed(2),
         result.totals.finishCost.toFixed(2),
         result.totals.totalCost.toFixed(2)],
        [`Sell @${result.totals.marginPct.toFixed(0)}% margin`, '', '', '', '', '', '',
         result.totals.sellPrice.toFixed(2)],
      ];
      body = rows.map(r => r.join(',')).join('\n');
      name = `archdisc-assembly-cost-${stamp}.csv`;
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

  const t = result.totals;
  return (
    <div className="acp-backdrop" onClick={() => setVisible(false)}>
      <div className="acp-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="acp-header">
          <span className="acp-title">Assembly Cost — {t.partCount} parts, Al 6061-T6</span>
          <button className="acp-btn" onClick={() => handleDownload('csv')}  data-action="acp-csv">CSV</button>
          <button className="acp-btn" onClick={() => handleDownload('json')} data-action="acp-json">JSON</button>
          <button className="acp-close" onClick={() => setVisible(false)} data-action="acp-close">×</button>
        </div>
        <div className="acp-body">
          <div className="acp-totals">
            <Stat label="Parts"      value={t.partCount} />
            <Stat label="Total mass" value={`${(t.mass_kg * 1000).toFixed(0)} g`} />
            <Stat label="Material"   value={`$${t.materialCost.toFixed(2)}`} />
            <Stat label="CNC"        value={`$${t.cncCost.toFixed(2)}`} />
            <Stat label="Setup + Finish" value={`$${(t.setupCost + t.finishCost).toFixed(2)}`} />
            <Stat label="Total"      value={`$${t.totalCost.toFixed(2)}`} accent />
            <Stat label="Sell price" value={`$${t.sellPrice.toFixed(2)}`} sub={`@${t.marginPct.toFixed(0)}% margin`} />
          </div>

          <table className="acp-table" data-acp-table>
            <thead>
              <tr>
                <th>Part</th>
                <th>Source</th>
                <th className="num">Mass</th>
                <th className="num">Material</th>
                <th className="num">CNC</th>
                <th className="num">Setup</th>
                <th className="num">Finish</th>
                <th className="num">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {result.lineItems.map((l) => (
                <tr key={l.bodyId}>
                  <td>{l.name}</td>
                  <td className="acp-source">{l.sourceTool ?? '—'}</td>
                  <td className="num">{(l.mass_kg * 1000).toFixed(1)} g</td>
                  <td className="num">${l.materialCost.toFixed(2)}</td>
                  <td className="num">${l.cncCost.toFixed(2)}</td>
                  <td className="num">${l.setupCost.toFixed(2)}</td>
                  <td className="num">${l.finishCost.toFixed(2)}</td>
                  <td className="num acp-subtotal">${l.subtotal.toFixed(2)}</td>
                </tr>
              ))}
              <tr className="acp-total-row">
                <td colSpan="2">TOTAL</td>
                <td className="num">{(t.mass_kg * 1000).toFixed(1)} g</td>
                <td className="num">${t.materialCost.toFixed(2)}</td>
                <td className="num">${t.cncCost.toFixed(2)}</td>
                <td className="num">${t.setupCost.toFixed(2)}</td>
                <td className="num">${t.finishCost.toFixed(2)}</td>
                <td className="num acp-grand">${t.totalCost.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent }) {
  return (
    <div className="acp-stat">
      <span className={`acp-stat-value ${accent ? 'acp-stat-accent' : ''}`}>{value}</span>
      <span className="acp-stat-label">{label}</span>
      {sub && <span className="acp-stat-sub">{sub}</span>}
    </div>
  );
}
