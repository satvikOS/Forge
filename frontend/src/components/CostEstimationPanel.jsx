import { useEffect, useState } from 'react';

/**
 * Cost Estimation Panel — surfaces foundation.Cost Estimation
 * output as a procurement-ready breakdown card.
 *
 * Same pop-on-completion pattern as DrawingPreview / Manufacture:
 * polls window.__lastCostEstimate, renders a sectioned modal with
 * mass + cost breakdown (bar chart by component), total + sell
 * price at margin. Two downloads: JSON (machine-readable, suits
 * ERP / PLM) and CSV (suits a procurement spreadsheet).
 */
export default function CostEstimationPanel() {
  const [estimate, setEstimate] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const tick = () => {
      const next = typeof window !== 'undefined' ? window.__lastCostEstimate : null;
      if (next && next !== estimate) {
        setEstimate(next);
        setVisible(true);
      }
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [estimate]);

  if (!visible || !estimate) return null;

  const breakdown = [
    { label: 'Material', value: estimate.materialCost,                                      color: '#5da5ff' },
    { label: 'CNC',      value: estimate.cncCost,                                            color: '#ffb55d' },
    { label: 'Setup',    value: estimate.setupCost,                                          color: '#a55dff' },
    { label: 'Finish',   value: estimate.finishCost,                                         color: '#5dff8a' },
  ];
  const maxCost = Math.max(...breakdown.map(b => b.value), 1e-9);

  const handleDownload = (format) => {
    const stamp = new Date().toISOString().slice(0, 10);
    let body, name, type;
    if (format === 'json') {
      body = JSON.stringify({ generatedAt: new Date().toISOString(), ...estimate }, null, 2);
      name = `archdisc-cost-${stamp}.json`;
      type = 'application/json';
    } else {
      const rows = [
        ['Component', 'Cost (USD)'],
        ['Material', estimate.materialCost.toFixed(2)],
        ['CNC',      estimate.cncCost.toFixed(2)],
        ['Setup',    estimate.setupCost.toFixed(2)],
        ['Finish',   estimate.finishCost.toFixed(2)],
        ['Total',    estimate.totalCost.toFixed(2)],
        [`Sell @${estimate.marginPct.toFixed(0)}% margin`, estimate.sellPrice.toFixed(2)],
        [],
        ['Mass (kg)', estimate.massKg.toFixed(4)],
        ['Volume (mm^3)', estimate.volumeMm3.toFixed(0)],
        ['Surface area (mm^2)', estimate.surfaceAreaMm2.toFixed(0)],
        ['CNC time (hr)', estimate.cncTimeHr.toFixed(3)],
      ];
      body = rows.map(r => r.join(',')).join('\n');
      name = `archdisc-cost-${stamp}.csv`;
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

  return (
    <div className="cep-backdrop" onClick={() => setVisible(false)}>
      <div className="cep-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="cep-header">
          <span className="cep-title">Cost Estimation — Al 6061-T6, CNC @ $90/hr</span>
          <button className="cep-btn" onClick={() => handleDownload('csv')}  data-action="cep-csv">CSV</button>
          <button className="cep-btn" onClick={() => handleDownload('json')} data-action="cep-json">JSON</button>
          <button className="cep-close" onClick={() => setVisible(false)} data-action="cep-close">×</button>
        </div>
        <div className="cep-body">
          <div className="cep-card cep-card-totals">
            <Stat label="Mass"        value={`${(estimate.massKg * 1000).toFixed(1)} g`} accent />
            <Stat label="Volume"      value={formatVol(estimate.volumeMm3)} />
            <Stat label="CNC time"    value={`${(estimate.cncTimeHr * 60).toFixed(1)} min`} />
            <Stat label="Total cost"  value={`$${estimate.totalCost.toFixed(2)}`} accent />
            <Stat label="Sell price"  value={`$${estimate.sellPrice.toFixed(2)}`}
                  sub={`@${estimate.marginPct.toFixed(0)}% margin`} />
          </div>
          <div className="cep-card">
            <div className="cep-card-title">Cost breakdown</div>
            <ul className="cep-bars" data-cep-bars>
              {breakdown.map((b) => (
                <li key={b.label} className="cep-bar-row">
                  <span className="cep-bar-label">{b.label}</span>
                  <div className="cep-bar-track">
                    <div className="cep-bar-fill"
                         style={{ width: `${(b.value / maxCost) * 100}%`, background: b.color }} />
                  </div>
                  <span className="cep-bar-value">${b.value.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent }) {
  return (
    <div className="cep-stat">
      <span className={`cep-stat-value ${accent ? 'cep-stat-accent' : ''}`}>{value}</span>
      <span className="cep-stat-label">{label}</span>
      {sub && <span className="cep-stat-sub">{sub}</span>}
    </div>
  );
}

function formatVol(mm3) {
  // 1 cm³ = 1000 mm³ — switch to cm³ once the value reaches a couple
  // of cm³, where the larger unit is more readable.
  if (Math.abs(mm3) >= 1000) return `${(mm3 / 1000).toFixed(2)} cm³`;
  return `${mm3.toFixed(0)} mm³`;
}
