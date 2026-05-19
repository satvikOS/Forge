import React, { useState } from 'react';
import './BrepLabPanel.css';

/**
 * B-rep Lab — drives the OCCT-backed ArchDisc Kernel. One button per op.
 */
export default function BrepLabPanel() {
  const [status, setStatus] = useState('OCCT B-rep kernel ready');
  const [busy, setBusy] = useState(false);

  const run = (label, fn) => async () => {
    if (busy || typeof window === 'undefined' || !window.__archdiscKernel) return;
    setBusy(true);
    setStatus(`${label}…`);
    try {
      const m = await fn(window.__archdiscKernel);
      setStatus(`${label}: vol ${m.volume.toFixed(0)} mm³, ${m.faceCount} faces`);
    } catch (err) {
      setStatus(`${label} error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const ops = [
    ['box', 'Box', (k) => k.renderBox(10, 10, 10)],
    ['cylinder', 'Cylinder', (k) => k.renderCylinder(5, 12)],
    ['sphere', 'Sphere', (k) => k.renderSphere(6)],
    ['cone', 'Cone', (k) => k.renderCone(6, 2, 12)],
    ['torus', 'Torus', (k) => k.renderTorus(10, 3)],
    ['fuse', 'Fuse', (k) => k.renderFuse()],
    ['cut', 'Cut', (k) => k.renderCut()],
    ['common', 'Common', (k) => k.renderCommon()],
    ['extrude', 'Extrude', (k) => k.renderExtrude(12, 8, 5)],
    ['revolve', 'Revolve', (k) => k.renderRevolve(4, 3, 10, 360)],
    ['fillet', 'Fillet', (k) => k.renderFillet(10, 1.5)],
    ['chamfer', 'Chamfer', (k) => k.renderChamfer(10, 1.5)],
  ];

  return (
    <div className="brep-lab-panel" data-testid="brep-lab-panel">
      <div className="brep-lab-title">B-rep Lab (OCCT)</div>
      {ops.map(([id, label, fn]) => (
        <button
          key={id}
          type="button"
          className="brep-lab-btn"
          data-testid={`brep-lab-${id}`}
          disabled={busy}
          onClick={run(label, fn)}
        >
          {label}
        </button>
      ))}
      <div className="brep-lab-status" data-testid="brep-lab-status">{status}</div>
    </div>
  );
}
