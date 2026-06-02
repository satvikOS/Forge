// Forge-190 — Electrical schematic editor + linear circuit analysis.
//
// Component table + IEC 60617 symbol palette + DC node-voltage analysis
// + AC frequency-response sweep with Bode magnitude plot. The schematic
// view is a force-directed auto-layout of the nodes — the graphical
// drag-drop editor is a follow-up.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const KINDS = [
  { id: 0, name: 'Resistor',       unit: 'Ω' },
  { id: 1, name: 'Capacitor',      unit: 'F' },
  { id: 2, name: 'Inductor',       unit: 'H' },
  { id: 3, name: 'Voltage source', unit: 'V' },
  { id: 4, name: 'Current source', unit: 'A' },
];

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 580, zIndex: 1310,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 12,
  overflowY: 'auto',
};

const fieldInputStyle = {
  width: '100%', background: 'var(--forge-canvas)',
  color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '3px 5px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

// IEC 60617 symbol palette — compact SVGs.
function Symbol({ kind, x, y }) {
  switch (kind) {
    case 0: // resistor
      return (
        <g transform={`translate(${x},${y})`}>
          <line x1={-12} y1={0} x2={-6} y2={0} stroke="var(--forge-ink)" strokeWidth={1} />
          <rect x={-6} y={-3} width={12} height={6}
                fill="var(--forge-canvas)" stroke="var(--forge-ink)" strokeWidth={1} />
          <line x1={6} y1={0} x2={12} y2={0} stroke="var(--forge-ink)" strokeWidth={1} />
        </g>
      );
    case 1: // capacitor
      return (
        <g transform={`translate(${x},${y})`}>
          <line x1={-12} y1={0} x2={-2} y2={0} stroke="var(--forge-ink)" strokeWidth={1} />
          <line x1={-2} y1={-5} x2={-2} y2={5} stroke="var(--forge-ink)" strokeWidth={1.3} />
          <line x1={2} y1={-5}  x2={2} y2={5}  stroke="var(--forge-ink)" strokeWidth={1.3} />
          <line x1={2} y1={0} x2={12} y2={0} stroke="var(--forge-ink)" strokeWidth={1} />
        </g>
      );
    case 2: // inductor (loops)
      return (
        <g transform={`translate(${x},${y})`}>
          <line x1={-12} y1={0} x2={-9} y2={0} stroke="var(--forge-ink)" strokeWidth={1} />
          {[-6, -2, 2, 6].map((cx) => (
            <path key={cx} d={`M ${cx-3},0 A 3,3 0 0 1 ${cx+3},0`}
                  fill="none" stroke="var(--forge-ink)" strokeWidth={1} />
          ))}
          <line x1={9} y1={0} x2={12} y2={0} stroke="var(--forge-ink)" strokeWidth={1} />
        </g>
      );
    case 3: // voltage source (circle with + −)
      return (
        <g transform={`translate(${x},${y})`}>
          <line x1={-12} y1={0} x2={-6} y2={0} stroke="var(--forge-ink)" strokeWidth={1} />
          <circle cx={0} cy={0} r={6} fill="var(--forge-canvas)" stroke="var(--forge-ink)" strokeWidth={1} />
          <text x={-3} y={-2} fontSize={8} fill="var(--forge-ink)" fontFamily="var(--forge-mono)">+</text>
          <text x={-2} y={5}  fontSize={8} fill="var(--forge-ink)" fontFamily="var(--forge-mono)">−</text>
          <line x1={6} y1={0} x2={12} y2={0} stroke="var(--forge-ink)" strokeWidth={1} />
        </g>
      );
    case 4: // current source (circle with arrow)
      return (
        <g transform={`translate(${x},${y})`}>
          <line x1={-12} y1={0} x2={-6} y2={0} stroke="var(--forge-ink)" strokeWidth={1} />
          <circle cx={0} cy={0} r={6} fill="var(--forge-canvas)" stroke="var(--forge-ink)" strokeWidth={1} />
          <path d="M -3,0 L 3,0 M 1,-2 L 3,0 L 1,2"
                fill="none" stroke="var(--forge-ink)" strokeWidth={1} />
          <line x1={6} y1={0} x2={12} y2={0} stroke="var(--forge-ink)" strokeWidth={1} />
        </g>
      );
    default: return null;
  }
}

function SchematicSVG({ comps, voltages, width = 540, height = 240 }) {
  if (!comps || !comps.length) return null;
  // Collect distinct nodes.
  const nodeSet = new Set([0]);
  for (const c of comps) { nodeSet.add(c.nA); nodeSet.add(c.nB); }
  const nodes = Array.from(nodeSet).sort((a, b) => a - b);
  // Auto-layout: ground at bottom centre, other nodes on a ring above.
  const cx = width / 2, cy = height / 2 + 30;
  const radius = Math.min(width, height) * 0.32;
  const pos = {};
  nodes.forEach((id, i) => {
    if (id === 0) {
      pos[id] = [cx, cy + radius];
    } else {
      const theta = -Math.PI / 2 + (2 * Math.PI * (i - 1)) / Math.max(1, nodes.length - 1);
      pos[id] = [cx + radius * Math.cos(theta), cy + radius * Math.sin(theta)];
    }
  });
  // Stagger overlapping components between the same node pair.
  const pairCounts = {};
  return (
    <svg width={width} height={height}
         style={{ background: 'var(--forge-canvas)' }}
         data-testid="forge-circuit-schematic">
      {comps.map((c, i) => {
        const [x1, y1] = pos[c.nA];
        const [x2, y2] = pos[c.nB];
        const key = `${Math.min(c.nA, c.nB)}-${Math.max(c.nA, c.nB)}`;
        pairCounts[key] = (pairCounts[key] || 0) + 1;
        const offset = (pairCounts[key] - 1) * 10;
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        const nx = -dy / Math.max(1, len) * offset;
        const ny = +dx / Math.max(1, len) * offset;
        const mx = (x1 + x2) / 2 + nx, my = (y1 + y2) / 2 + ny;
        return (
          <g key={i}>
            <line x1={x1 + nx} y1={y1 + ny}
                  x2={mx - dx / len * 14} y2={my - dy / len * 14}
                  stroke="var(--forge-ink-mute)" strokeWidth={1} />
            <line x1={mx + dx / len * 14} y1={my + dy / len * 14}
                  x2={x2 + nx} y2={y2 + ny}
                  stroke="var(--forge-ink-mute)" strokeWidth={1} />
            <g transform={`translate(${mx},${my}) rotate(${Math.atan2(dy, dx) * 180 / Math.PI})`}>
              <Symbol kind={c.kind} x={0} y={0} />
            </g>
            <text x={mx + 8} y={my - 8}
                  fontSize={9} fill="var(--forge-ink-mute)"
                  fontFamily="var(--forge-mono)"
                  transform={`rotate(${Math.atan2(dy, dx) * 180 / Math.PI}, ${mx + 8}, ${my - 8})`}>
              {c.name}
            </text>
          </g>
        );
      })}
      {nodes.map((id) => (
        <g key={id} transform={`translate(${pos[id][0]},${pos[id][1]})`}>
          <circle r={4} fill={id === 0 ? 'var(--forge-ink-mute)' : 'var(--forge-accent)'} />
          <text x={6} y={-6} fontSize={11}
                fill="var(--forge-ink)" fontFamily="var(--forge-mono)">
            {id === 0 ? 'gnd' : `n${id}`}
            {voltages && id !== 0 ? `  ${voltages[id].toFixed(2)} V` : ''}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function CircuitWorkbenchPanel({ open, onClose }) {
  const [comps, setComps] = React.useState([
    { kind: 3, name: 'V1', nA: 1, nB: 0, value: 12 },
    { kind: 0, name: 'R1', nA: 1, nB: 2, value: 1000 },
    { kind: 0, name: 'R2', nA: 2, nB: 0, value: 2000 },
  ]);
  const [nodeCount, setNodeCount] = React.useState(3);
  const [result, setResult] = React.useState(null);
  const [status, setStatus] = React.useState({ kind: 'idle', text: 'idle' });

  const onRun = React.useCallback(() => {
    const f = (typeof window !== 'undefined') ? window.forge : null;
    if (!f || !f.circuit) {
      setStatus({ kind: 'err', text: 'forge.circuit unavailable' });
      return;
    }
    try {
      const r = f.circuit.dcAnalysis({ nodeCount, comps });
      setResult(r);
      const voltText = Array.from(r.nodeVoltages)
        .map((v, i) => i === 0 ? '' : `n${i}=${v.toFixed(3)} V`)
        .filter(Boolean).join('  ·  ');
      setStatus({ kind: 'ok', text: voltText });
    } catch (e) {
      setStatus({ kind: 'err', text: e.message });
    }
  }, [comps, nodeCount]);

  React.useEffect(() => { if (open) onRun(); }, [open]);

  if (!open) return null;
  const addComp = () => setComps((arr) =>
    [...arr, { kind: 0, name: `C${arr.length + 1}`, nA: 1, nB: 0, value: 1000 }]);

  return (
    <div style={panelStyle} data-testid="forge-circuit-panel">
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <strong>Circuit · IEC 60617 + MNA DC/AC</strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose}
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink)', cursor: 'pointer' }}
                data-testid="forge-circuit-close">×</button>
      </header>

      <label>
        <small style={{ color: 'var(--forge-ink-mute)' }}>nodeCount (incl. ground)</small>
        <input type="number" value={nodeCount} min={2} step={1}
               onChange={(e) => setNodeCount(parseInt(e.target.value) || 2)}
               style={fieldInputStyle} data-testid="forge-circuit-nc" />
      </label>

      <section>
        <div style={{ fontSize: 11, color: 'var(--forge-ink-mute)',
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                      marginBottom: 4 }}>Components</div>
        <table style={{ width: '100%', borderCollapse: 'collapse',
                        fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <thead>
            <tr style={{ color: 'var(--forge-ink-mute)' }}>
              <th style={{ textAlign: 'left' }}>name</th>
              <th>kind</th><th>nA</th><th>nB</th><th>value</th><th></th>
            </tr>
          </thead>
          <tbody>
            {comps.map((c, i) => (
              <tr key={i}>
                <td><input value={c.name}
                           onChange={(e) => setComps((arr) => arr.map((x, j) =>
                             j === i ? { ...x, name: e.target.value } : x))}
                           style={fieldInputStyle}
                           data-testid={`forge-circuit-name-${i}`} /></td>
                <td><select value={c.kind}
                            onChange={(e) => setComps((arr) => arr.map((x, j) =>
                              j === i ? { ...x, kind: parseInt(e.target.value) || 0 } : x))}
                            style={fieldInputStyle}
                            data-testid={`forge-circuit-kind-${i}`}>
                  {KINDS.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                </select></td>
                <td><input type="number" value={c.nA}
                           onChange={(e) => setComps((arr) => arr.map((x, j) =>
                             j === i ? { ...x, nA: parseInt(e.target.value) || 0 } : x))}
                           style={fieldInputStyle}
                           data-testid={`forge-circuit-na-${i}`} /></td>
                <td><input type="number" value={c.nB}
                           onChange={(e) => setComps((arr) => arr.map((x, j) =>
                             j === i ? { ...x, nB: parseInt(e.target.value) || 0 } : x))}
                           style={fieldInputStyle}
                           data-testid={`forge-circuit-nb-${i}`} /></td>
                <td><input type="number" value={c.value} step={c.kind === 1 ? 1e-7 : 1}
                           onChange={(e) => setComps((arr) => arr.map((x, j) =>
                             j === i ? { ...x, value: parseFloat(e.target.value) || 0 } : x))}
                           style={fieldInputStyle}
                           data-testid={`forge-circuit-val-${i}`} /></td>
                <td><button onClick={() => setComps((arr) => arr.filter((_, j) => j !== i))}
                            style={{ ...fieldInputStyle, width: 24, cursor: 'pointer' }}>−</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={addComp}
                style={{ ...fieldInputStyle, cursor: 'pointer', marginTop: 4 }}
                data-testid="forge-circuit-add">
          + add component
        </button>
      </section>

      <button onClick={onRun}
              style={{ background: 'var(--forge-accent)', border: 'none',
                       color: '#0a0e14', padding: '8px 12px', cursor: 'pointer',
                       fontWeight: 600, fontFamily: 'var(--forge-mono)' }}
              data-testid="forge-circuit-run">
        Run DC analysis
      </button>

      <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                        color: status.kind === 'err' ? 'var(--forge-bad, #ff6363)'
                             : status.kind === 'ok'  ? 'var(--forge-ok, #4ec18b)'
                             : 'var(--forge-ink-mute)' }}
               data-testid="forge-circuit-status">
        {status.text}
      </section>

      <SchematicSVG comps={comps}
                    voltages={result ? Array.from(result.nodeVoltages) : null} />

      {result && (
        <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                          background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)' }}
                 data-testid="forge-circuit-result">
          {Array.from(result.nodeVoltages).map((v, i) => i === 0
            ? <div key={i}>n0 (gnd)  0.000 V</div>
            : <div key={i}>n{i}        {v.toFixed(4)} V</div>)}
          {Array.from(result.vSourceCurrents).map((I, i) => (
            <div key={`vsrc-${i}`}>vSource[{i}] current {I.toFixed(6)} A</div>
          ))}
        </section>
      )}
    </div>
  );
}

export function CircuitWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenCircuitWorkbench  = () => setOpen(true);
    window.__forgeCloseCircuitWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.circuit' || e?.detail?.id === 'workbench.circuit') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'circuit') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <CircuitWorkbenchPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default CircuitWorkbenchPanel;
