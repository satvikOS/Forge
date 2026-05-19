import React, { useState } from 'react';
import './BrepLabPanel.css';

/**
 * B-rep Lab — minimal panel that drives the OCCT-backed ArchDisc Kernel.
 * A0 scope: a single "Box" button. A1+ add a button per operation.
 */
export default function BrepLabPanel() {
  const [status, setStatus] = useState('OCCT B-rep kernel ready');
  const [busy, setBusy] = useState(false);

  const makeBox = async () => {
    if (busy || typeof window === 'undefined' || !window.__archdiscKernel) return;
    setBusy(true);
    setStatus('Building box…');
    try {
      const metrics = await window.__archdiscKernel.renderBox(10, 10, 10);
      setStatus(`Box: vol ${metrics.volume.toFixed(0)} mm³, ${metrics.faceCount} faces`);
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="brep-lab-panel" data-testid="brep-lab-panel">
      <div className="brep-lab-title">B-rep Lab (OCCT)</div>
      <button
        type="button"
        className="brep-lab-btn"
        data-testid="brep-lab-box"
        disabled={busy}
        onClick={makeBox}
      >
        Box 10×10×10
      </button>
      <div className="brep-lab-status" data-testid="brep-lab-status">{status}</div>
    </div>
  );
}
