// Forge-203 — CPU path tracer preview workbench.
//
// Renders the active mesh (or a built-in floor+box fixture) with the
// kernel's Lambertian + sun + AO renderer and shows the result on a
// canvas. Sample count / AO strength / resolution are exposed.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 640, zIndex: 1310,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 12,
  overflowY: 'auto',
};
const buttonStyle = {
  background: 'var(--forge-accent)', border: 'none',
  color: '#0a0e14', padding: '6px 10px', cursor: 'pointer',
  fontWeight: 600, fontFamily: 'var(--forge-mono)', fontSize: 11,
};
const fieldStyle = {
  width: 90, background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.pathtrace)
      || (typeof window !== 'undefined' && window.electron && window.electron.pathtrace);
}

function fixtureScene() {
  // A floor (Z=0, 30×30) + a box (10×10×10 centred at origin, lifted to z=5)
  const positions = [];
  const normals = [];
  const indices = [];
  const materialIds = [];
  const materials = [
    { albedo: [0.65, 0.65, 0.65], emission: [0, 0, 0] },  // floor (grey)
    { albedo: [0.85, 0.30, 0.20], emission: [0, 0, 0] },  // box (red-orange)
  ];

  function pushTri(p0, p1, p2, n, matId) {
    const base = positions.length / 3;
    positions.push(...p0, ...p1, ...p2);
    normals.push(...n, ...n, ...n);
    indices.push(base, base + 1, base + 2);
    materialIds.push(matId);
  }

  // Floor — 2 tris
  pushTri([-15, -15, 0], [15, -15, 0], [15, 15, 0], [0, 0, 1], 0);
  pushTri([-15, -15, 0], [15,  15, 0], [-15, 15, 0], [0, 0, 1], 0);
  // Box at origin, 10×10×10
  const X0 = -5, X1 = 5, Y0 = -5, Y1 = 5, Z0 = 0, Z1 = 10;
  // +Z
  pushTri([X0, Y0, Z1], [X1, Y0, Z1], [X1, Y1, Z1], [0, 0, 1], 1);
  pushTri([X0, Y0, Z1], [X1, Y1, Z1], [X0, Y1, Z1], [0, 0, 1], 1);
  // -Z (skip — sits on floor)
  // +X
  pushTri([X1, Y0, Z0], [X1, Y1, Z0], [X1, Y1, Z1], [1, 0, 0], 1);
  pushTri([X1, Y0, Z0], [X1, Y1, Z1], [X1, Y0, Z1], [1, 0, 0], 1);
  // -X
  pushTri([X0, Y0, Z0], [X0, Y0, Z1], [X0, Y1, Z1], [-1, 0, 0], 1);
  pushTri([X0, Y0, Z0], [X0, Y1, Z1], [X0, Y1, Z0], [-1, 0, 0], 1);
  // +Y
  pushTri([X0, Y1, Z0], [X0, Y1, Z1], [X1, Y1, Z1], [0, 1, 0], 1);
  pushTri([X0, Y1, Z0], [X1, Y1, Z1], [X1, Y1, Z0], [0, 1, 0], 1);
  // -Y
  pushTri([X0, Y0, Z0], [X1, Y0, Z0], [X1, Y0, Z1], [0, -1, 0], 1);
  pushTri([X0, Y0, Z0], [X1, Y0, Z1], [X0, Y0, Z1], [0, -1, 0], 1);

  return {
    positions:   new Float32Array(positions),
    normals:     new Float32Array(normals),
    indices:     new Uint32Array(indices),
    materialIds: new Uint32Array(materialIds),
    materials,
  };
}

export function pathtraceRender(input) {
  const pt = api();
  if (!pt) throw new Error('forge.pathtrace not available');
  return pt.render(input);
}

function drawToCanvas(canvas, rgb, w, h) {
  if (!canvas) return;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; ++i) {
    // simple ACES-ish curve + gamma 2.2
    const r = Math.pow(Math.min(1, rgb[i*3+0]), 1.0/2.2);
    const g = Math.pow(Math.min(1, rgb[i*3+1]), 1.0/2.2);
    const b = Math.pow(Math.min(1, rgb[i*3+2]), 1.0/2.2);
    img.data[i*4+0] = Math.round(r * 255);
    img.data[i*4+1] = Math.round(g * 255);
    img.data[i*4+2] = Math.round(b * 255);
    img.data[i*4+3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function PathTracePanel({ open, onClose }) {
  const [width, setWidth]         = React.useState(160);
  const [height, setHeight]       = React.useState(120);
  const [aoSamples, setAoSamples] = React.useState(6);
  const [aoStrength, setAoStr]    = React.useState(0.55);
  const [sunAz, setSunAz]         = React.useState(45);
  const [sunEl, setSunEl]         = React.useState(50);
  const [result, setResult]       = React.useState(null);
  const [err, setErr]             = React.useState('');
  const canvasRef = React.useRef(null);

  React.useEffect(() => {
    if (result && canvasRef.current) {
      drawToCanvas(canvasRef.current, result.rgb, result.width, result.height);
    }
  }, [result]);

  if (!open) return null;

  const onRender = () => {
    setErr(''); setResult(null);
    try {
      const mesh = (typeof window !== 'undefined' && window.__forgeActiveSceneForRender)
        ? window.__forgeActiveSceneForRender()
        : fixtureScene();
      const azRad = (sunAz * Math.PI) / 180;
      const elRad = (sunEl * Math.PI) / 180;
      const sunDir = [
        Math.cos(elRad) * Math.cos(azRad),
        Math.cos(elRad) * Math.sin(azRad),
        Math.sin(elRad),
      ];
      const r = pathtraceRender({
        mesh,
        camera: { position: [30, 25, 22], lookAt: [0, 0, 4],
                  up: [0, 0, 1], fovYDegrees: 35 },
        sun: { direction: sunDir, colour: [1.0, 0.95, 0.85] },
        ambient:    [0.08, 0.08, 0.10],
        background: [0.04, 0.05, 0.08],
        width, height,
        aoSamples, aoStrength, aoMaxDistance: 50,
        randomSeed: 314159,
      });
      setResult(r);
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };

  return (
    <div style={panelStyle} data-testid="forge-pathtrace-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Photorealistic preview</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Lambertian shading + sun + screen-space-free ambient occlusion via
        hemisphere visibility rays. CPU only — keep resolution modest.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="Width">
          <input type="number" step="16" value={width}
                 data-testid="forge-pathtrace-width"
                 onChange={(e) => setWidth(Math.min(512, Number(e.target.value) | 0))}
                 style={fieldStyle} />
        </Field>
        <Field label="Height">
          <input type="number" step="16" value={height}
                 data-testid="forge-pathtrace-height"
                 onChange={(e) => setHeight(Math.min(512, Number(e.target.value) | 0))}
                 style={fieldStyle} />
        </Field>
        <Field label="AO samples">
          <input type="number" step="1" value={aoSamples}
                 data-testid="forge-pathtrace-ao-samples"
                 onChange={(e) => setAoSamples(Math.max(0, Number(e.target.value) | 0))}
                 style={fieldStyle} />
        </Field>
        <Field label="AO strength">
          <input type="number" step="0.05" min="0" max="1" value={aoStrength}
                 data-testid="forge-pathtrace-ao-strength"
                 onChange={(e) => setAoStr(Number(e.target.value))}
                 style={fieldStyle} />
        </Field>
        <Field label="Sun azimuth°">
          <input type="number" step="5" value={sunAz}
                 data-testid="forge-pathtrace-sun-az"
                 onChange={(e) => setSunAz(Number(e.target.value))}
                 style={fieldStyle} />
        </Field>
        <Field label="Sun elev°">
          <input type="number" step="5" value={sunEl}
                 data-testid="forge-pathtrace-sun-el"
                 onChange={(e) => setSunEl(Number(e.target.value))}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-pathtrace-render" style={buttonStyle} onClick={onRender}>
        Render
      </button>

      {err && (
        <div data-testid="forge-pathtrace-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}

      <canvas ref={canvasRef}
              data-testid="forge-pathtrace-canvas"
              style={{ background: '#000', maxWidth: '100%',
                       border: '1px solid var(--forge-rail-edge)' }} />

      {result && (
        <div data-testid="forge-pathtrace-stats"
             style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                      color: 'var(--forge-ink-mute)' }}>
          {result.width}×{result.height} px · {result.rayCount.toLocaleString()} rays · {result.elapsedSec.toFixed(3)} s
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ color: 'var(--forge-ink-mute)' }}>{label}</span>
      {children}
    </label>
  );
}

export function PathTracePreviewWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenPathTraceWorkbench  = () => setOpen(true);
    window.__forgeClosePathTraceWorkbench = () => setOpen(false);
    window.__forgePathTraceRender         = pathtraceRender;
    window.__forgePathTraceFixtureScene   = fixtureScene;
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.pathtrace' || id === 'workbench.pathtrace') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'pathtrace') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <PathTracePanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default PathTracePanel;
