// Forge-92 — Manufacturing workbench panel.
//
// A modal-but-large dialog the operator opens from the Mfg toolbar. It
// owns five tabs:
//
//   1. STOCK    — pick AABB-from-body OR a Block (X/Y/Z) OR a Cylinder.
//                 Renders as a wireframe overlay inside the sim viewport.
//   2. TOOLS    — bundled tool library; clicking a row selects the tool
//                 for the active op.
//   3. OPS      — list of operations. Each op has a type, target, depth,
//                 stepover, leadIn override. The "Generate" button
//                 invokes cam.profile / pocket / drill / faceMill /
//                 adaptiveClear / multiAxisIndexed against the kernel.
//   4. SIM      — runs cam.simulateStock + plays back the toolpath
//                 inside CamStockSimulator. Timeline scrubber lets the
//                 operator pause and inspect any move.
//   5. CMM      — cam.generateCmm and a probe-point list.
//   6. G-CODE   — pick a dialect, push the active op's toolpath through
//                 cam.gcode.toGcode, show the result in a syntax-aware
//                 read-only viewer + a Save button.
//
// Every cam.* call is guarded — when the kernel hasn't loaded, the panel
// shows "kernel not ready" rather than fabricating output. Manual clicks
// in this panel NEVER write to Archie's thread.

import React, { useEffect, useMemo, useState } from 'react';
import { Icon } from './icons/Icon.jsx';
import { CamStockSimulator } from './CamStockSimulator.jsx';
import {
  camReady, gcodeDialects, autoFaceId,
  makeToolpath, simulate, makeCmm, exportGcode,
  TOOL_LIBRARY, toNativeTool, toCuttingParams,
  aabbFromBody, toolpathSegments,
} from './camDispatch.js';

const TABS = [
  { id: 'stock',  label: 'Stock'   },
  { id: 'tools',  label: 'Tools'   },
  { id: 'ops',    label: 'Ops'     },
  { id: 'sim',    label: 'Simulate' },
  { id: 'cmm',    label: 'CMM'     },
  { id: 'gcode',  label: 'G-code'  },
];

const OP_TYPES = [
  { id: 'profile',        label: 'Profile (contour)' },
  { id: 'pocket',         label: 'Pocket (clear)'    },
  { id: 'face',           label: 'Face mill'         },
  { id: 'drill',          label: 'Drill'             },
  { id: 'adaptive',       label: 'Adaptive clearing' },
  { id: '5axis-indexed',  label: '5-axis indexed'    },
];

// ──────────────────────────────────────────── default op factory
function defaultOpFor(opType) {
  return {
    id: `op-${Math.random().toString(36).slice(2, 7)}`,
    type: opType,
    name: OP_TYPES.find((o) => o.id === opType)?.label || opType,
    toolId: 'em6',
    zTop: 20, zBottom: 0, depth: 1,
    leadIn: 2, stepoverOverride: '', stepdownOverride: '',
    feedXYOverride: '', feedZOverride: '', rpmOverride: '',
    safeZ: 25,
    // op-specific extras
    holes: [[0, 0, 20], [10, 0, 20], [-10, 0, 20]],
    peck: true,
    orientations: [[0,0,0], [0,30,0], [0,60,0], [0,90,0]],
    adaptiveCfg: { stepover: 4, zMax: 20, zMin: 5, helixAngle: 3, minRadius: 6 },
    faceId: null,             // null = autoFaceId
    toolpath: null,           // populated after generate
    error: null,
  };
}

export function ManufacturingWorkbench({
  open, onClose,
  bodies = [],                // shell body registry — for AABB-from-body
  initialBodyId = null,
}) {
  const [tab, setTab] = useState('stock');
  const [stockMode, setStockMode] = useState('body');     // 'body' | 'block' | 'cylinder'
  const [block, setBlock] = useState({ dx: 100, dy: 60, dz: 20, margin: 1.0 });
  const [cyl,   setCyl]   = useState({ r: 25, h: 60, margin: 1.0 });
  const [bodyId, setBodyId] = useState(initialBodyId || bodies[bodies.length - 1]?.id || null);
  const [ops, setOps]       = useState(() => [defaultOpFor('profile')]);
  const [activeOpId, setActiveOpId] = useState(() => null);
  const [playing, setPlaying]       = useState(false);
  const [cursor, setCursor]         = useState(0);
  const [dialect, setDialect]       = useState('Fanuc');
  const [safeZGcode, setSafeZGcode] = useState(25);
  const [gcodeText, setGcodeText]   = useState('');
  const [gcodeNote, setGcodeNote]   = useState('');     // "kernel not ready" if applicable
  const [simReport, setSimReport]   = useState(null);
  const [cmmFeatures, setCmmFeatures] = useState([
    { kind: 'plane',    topo: 0,          label: 'TOP_FACE' },
    { kind: 'cylinder', topo: 0xFFFFFFFF, label: 'BORE'     },
  ]);
  const [cmmProgram, setCmmProgram]   = useState(null);
  const [cmmGauge, setCmmGauge]       = useState({ stepover: 4.0, probeRadius: 1.0 });

  useEffect(() => {
    if (!activeOpId && ops.length) setActiveOpId(ops[0].id);
  }, [ops, activeOpId]);

  // ────────────────────────────── derived
  const ready = camReady();
  const dialects = useMemo(() => gcodeDialects(), [ready]);
  const activeOp = useMemo(() => ops.find((o) => o.id === activeOpId) || ops[0],
                           [ops, activeOpId]);
  const stockAabb = useMemo(() => {
    if (stockMode === 'body') {
      const b = bodies.find((bb) => bb.id === bodyId) ||
                bodies[bodies.length - 1];
      if (b) return aabbFromBody(b, 1.0);
      // No body picked — fall through to block defaults
    }
    if (stockMode === 'cylinder') {
      const m = cyl.margin;
      return Float64Array.from([
        -cyl.r - m, -cyl.r - m, -m,
         cyl.r + m,  cyl.r + m, cyl.h + m,
      ]);
    }
    // block
    const m = block.margin;
    return Float64Array.from([
      -block.dx / 2 - m, -block.dy / 2 - m, -m,
       block.dx / 2 + m,  block.dy / 2 + m, block.dz + m,
    ]);
  }, [stockMode, block, cyl, bodyId, bodies]);

  const stockShape = useMemo(() => {
    // The shape handle handed to cam.* — when we have a native body
    // we use its handle, otherwise pass 0 (cam.* accepts an aabb-only
    // path for stock-only ops like profile-on-stock).
    if (stockMode === 'body') {
      const b = bodies.find((bb) => bb.id === bodyId) ||
                bodies[bodies.length - 1];
      if (b && b.kind === 'native' && typeof b.handle === 'number') return b.handle;
    }
    return 0;
  }, [stockMode, bodyId, bodies]);

  function updateOp(patch) {
    setOps((arr) => arr.map((o) => o.id === activeOpId ? { ...o, ...patch } : o));
  }

  function addOp(type) {
    const next = defaultOpFor(type);
    setOps((arr) => [...arr, next]);
    setActiveOpId(next.id);
  }
  function removeOp(id) {
    setOps((arr) => arr.filter((o) => o.id !== id));
    if (activeOpId === id) setActiveOpId(null);
  }

  // ────────────────────────────── generate toolpath
  function generateActive() {
    if (!activeOp) return;
    const tool = TOOL_LIBRARY.find((t) => t.id === activeOp.toolId) || TOOL_LIBRARY[0];
    const nativeTool = toNativeTool(tool);
    const params = toCuttingParams(tool, {
      feedXY:     activeOp.feedXYOverride ? Number(activeOp.feedXYOverride) : undefined,
      feedZ:      activeOp.feedZOverride  ? Number(activeOp.feedZOverride)  : undefined,
      spindleRPM: activeOp.rpmOverride    ? Number(activeOp.rpmOverride)    : undefined,
      stepover:   activeOp.stepoverOverride ? Number(activeOp.stepoverOverride) : undefined,
      stepdown:   activeOp.stepdownOverride ? Number(activeOp.stepdownOverride) : undefined,
    });
    const target = {
      faceId: activeOp.faceId,
      zTop:   Number(activeOp.zTop),
      zBottom: Number(activeOp.zBottom),
      depth:  Number(activeOp.depth),
      leadIn: Number(activeOp.leadIn),
      holes:  activeOp.holes,
      peck:   activeOp.peck,
      orientations: activeOp.orientations,
      adaptive: activeOp.adaptiveCfg,
      stockAabb,
    };
    const r = makeToolpath(activeOp.type, stockShape, target, nativeTool, params);
    if (r.ok) {
      updateOp({ toolpath: r.toolpath, error: null });
      setCursor(0);
    } else {
      updateOp({ toolpath: null, error: r.error || r.kind });
    }
  }

  // ────────────────────────────── run simulator
  function runSimulate() {
    if (!activeOp || !activeOp.toolpath) {
      setSimReport({ ok: false, error: 'generate a toolpath first' });
      return;
    }
    const tool = TOOL_LIBRARY.find((t) => t.id === activeOp.toolId) || TOOL_LIBRARY[0];
    const r = simulate(stockAabb, activeOp.toolpath, toNativeTool(tool), 50);
    setSimReport(r);
  }

  // ────────────────────────────── CMM
  function runCmm() {
    if (!stockShape) {
      setCmmProgram({ ok: false, error: 'CMM requires a body — pick one in the Stock tab' });
      return;
    }
    const r = makeCmm(stockShape, cmmFeatures, cmmGauge);
    setCmmProgram(r);
  }

  // ────────────────────────────── G-code export
  function runGcode() {
    if (!activeOp || !activeOp.toolpath) {
      setGcodeText('');
      setGcodeNote('Generate a toolpath in the Ops tab first.');
      return;
    }
    const r = exportGcode(activeOp.toolpath, dialect, Number(safeZGcode));
    if (r.ok) {
      setGcodeText(r.text);
      setGcodeNote('');
    } else {
      setGcodeText('');
      setGcodeNote(r.kind === 'no-kernel'
        ? 'kernel not ready · install forge-kernel.node to emit real G-code'
        : `error: ${r.error}`);
    }
  }
  function saveGcode() {
    if (!gcodeText) return;
    const blob = new Blob([gcodeText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ext = dialect === 'Grbl' || dialect === 'LinuxCNC' ? 'ngc' : 'nc';
    a.href = url;
    a.download = `forge-${activeOp?.type || 'op'}-${dialect.toLowerCase()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (!open) return null;
  return (
    <div role="dialog"
         aria-label="Manufacturing Workbench"
         data-testid="forge-cam-panel"
         data-cam-ready={String(ready)}
         onClick={onClose}
         style={{
           position: 'fixed', inset: 0,
           background: 'var(--forge-overlay)',
           display: 'flex', alignItems: 'center', justifyContent: 'center',
           zIndex: 2400,
         }}>
      <div onClick={(e) => e.stopPropagation()}
           style={{
             width: 1180, maxWidth: '96vw',
             height: '88vh',
             background: 'var(--forge-canvas-3)',
             border: '1px solid var(--forge-rail-edge)',
             borderRadius: 'var(--forge-radius-lg)',
             boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
             display: 'grid',
             gridTemplateRows: 'auto auto 1fr auto',
           }}>
        {/* Header */}
        <header style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 16px',
          borderBottom: '1px solid var(--forge-rail-edge)',
          background: 'var(--forge-canvas)',
          borderRadius: 'var(--forge-radius-lg) var(--forge-radius-lg) 0 0',
        }}>
          <Icon name="wb.mfg" size={16} />
          <h2 style={{ margin: 0, fontSize: 13 }}>Manufacturing</h2>
          <KernelChip ready={ready} />
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose} aria-label="Close"
                  data-testid="forge-cam-close"
                  className="forge-tool-dock-btn"
                  style={{ flex: '0 0 auto', padding: '4px 10px' }}>
            Close
          </button>
        </header>

        {/* Tabs */}
        <nav role="tablist" style={{
          display: 'flex',
          borderBottom: '1px solid var(--forge-rail-edge)',
          background: 'var(--forge-canvas)',
          padding: '0 8px',
        }}>
          {TABS.map((t) => (
            <button key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={t.id === tab}
                    data-active={String(t.id === tab)}
                    data-cam-tab={t.id}
                    onClick={() => setTab(t.id)}
                    className="forge-preview-tab">
              {t.label}
            </button>
          ))}
        </nav>

        {/* Body */}
        <div style={{ display: 'grid',
                      gridTemplateColumns: '380px 1fr',
                      minHeight: 0 }}>
          {/* Left column — controls per tab */}
          <aside style={{
            borderRight: '1px solid var(--forge-rail-edge)',
            background: 'var(--forge-surface)',
            overflowY: 'auto',
            padding: 12,
          }}>
            {tab === 'stock'  && (
              <StockTab bodies={bodies}
                        bodyId={bodyId} setBodyId={setBodyId}
                        stockMode={stockMode} setStockMode={setStockMode}
                        block={block} setBlock={setBlock}
                        cyl={cyl} setCyl={setCyl} />
            )}
            {tab === 'tools'  && (
              <ToolsTab activeOp={activeOp}
                        onPick={(toolId) => updateOp({ toolId })} />
            )}
            {tab === 'ops'    && (
              <OpsTab ops={ops}
                      activeOpId={activeOpId}
                      onPick={setActiveOpId}
                      onAdd={addOp}
                      onRemove={removeOp}
                      activeOp={activeOp}
                      updateOp={updateOp}
                      onGenerate={generateActive}
                      ready={ready} />
            )}
            {tab === 'sim'    && (
              <SimTab playing={playing} setPlaying={setPlaying}
                      cursor={cursor} setCursor={setCursor}
                      activeOp={activeOp}
                      simReport={simReport}
                      onSimulate={runSimulate}
                      ready={ready} />
            )}
            {tab === 'cmm'    && (
              <CmmTab features={cmmFeatures} setFeatures={setCmmFeatures}
                      gauge={cmmGauge} setGauge={setCmmGauge}
                      program={cmmProgram}
                      onGenerate={runCmm}
                      ready={ready} />
            )}
            {tab === 'gcode'  && (
              <GcodeTab dialect={dialect} setDialect={setDialect}
                        dialects={dialects}
                        safeZ={safeZGcode} setSafeZ={setSafeZGcode}
                        onExport={runGcode}
                        onSave={saveGcode}
                        hasText={!!gcodeText}
                        note={gcodeNote}
                        ready={ready} />
            )}
          </aside>

          {/* Right column — viewport / data */}
          <section style={{ position: 'relative', overflow: 'hidden' }}>
            {(tab === 'stock' || tab === 'sim' || tab === 'cmm' || tab === 'ops') && (
              <CamStockSimulator visible
                stockAabb={stockAabb}
                toolpath={activeOp?.toolpath}
                tool={TOOL_LIBRARY.find((t) => t.id === activeOp?.toolId) || TOOL_LIBRARY[0]}
                playing={playing && tab === 'sim'}
                cursorIndex={cursor}
                onCursorChange={(i) => setCursor(i)} />
            )}
            {tab === 'sim' && activeOp?.toolpath && (
              <SimOverlay activeOp={activeOp}
                          cursor={cursor}
                          setCursor={setCursor}
                          playing={playing}
                          setPlaying={setPlaying}
                          simReport={simReport} />
            )}
            {tab === 'tools' && (
              <ToolPreviewPanel activeOp={activeOp} />
            )}
            {tab === 'cmm' && cmmProgram?.ok && (
              <CmmOverlay program={cmmProgram.program} stockAabb={stockAabb} />
            )}
            {tab === 'gcode' && (
              <GcodeView text={gcodeText} note={gcodeNote} />
            )}
          </section>
        </div>

        {/* Footer */}
        <footer style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 16px',
          borderTop: '1px solid var(--forge-rail-edge)',
          background: 'var(--forge-canvas)',
          fontSize: 11, color: 'var(--forge-ink-mute)',
          borderRadius: '0 0 var(--forge-radius-lg) var(--forge-radius-lg)',
        }}>
          <span style={{ fontFamily: 'var(--forge-mono)' }}>
            stock {fmtAabb(stockAabb)} · {ops.length} op{ops.length !== 1 ? 's' : ''}
            {activeOp?.toolpath ? ` · ${activeOp.toolpath.moveCount} moves` : ''}
          </span>
          <span style={{ flex: 1 }} />
          <span>{ready ? 'kernel ready' : 'kernel offline — output disabled'}</span>
        </footer>
      </div>
    </div>
  );
}

function KernelChip({ ready }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 'var(--forge-radius-pill)',
      border: '1px solid var(--forge-rail-edge)',
      fontSize: 10, fontFamily: 'var(--forge-mono)',
      color: ready ? 'var(--forge-ok)' : 'var(--forge-warn)',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%',
                     background: 'currentColor' }} />
      {ready ? 'cam ready' : 'cam offline'}
    </span>
  );
}

// ──────────────────────────────────────────── STOCK
function StockTab({ bodies, bodyId, setBodyId,
                    stockMode, setStockMode, block, setBlock, cyl, setCyl }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SectionLabel>Stock source</SectionLabel>
      <ModeRow modes={[
        { id: 'body',     label: 'From body (AABB)' },
        { id: 'block',    label: 'Block (X×Y×Z)' },
        { id: 'cylinder', label: 'Cylinder (Ø×h)' },
      ]} active={stockMode} onPick={setStockMode}
        testid="forge-cam-stock-mode" />

      {stockMode === 'body' && (
        <div>
          <SectionLabel>Body</SectionLabel>
          <select className="forge-tool-input"
                  data-testid="forge-cam-body-select"
                  value={bodyId || ''}
                  onChange={(e) => setBodyId(e.target.value || null)}
                  style={{ width: '100%' }}>
            {bodies.length === 0 && (
              <option value="">— no bodies — using 60×40×20 fallback —</option>
            )}
            {bodies.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name || b.toolId || b.id} ({b.kind})
              </option>
            ))}
          </select>
        </div>
      )}

      {stockMode === 'block' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                       gap: 8 }}>
          <NumField label="X" value={block.dx} unit="mm"
            onChange={(v) => setBlock({ ...block, dx: v })}
            testid="forge-cam-block-dx" />
          <NumField label="Y" value={block.dy} unit="mm"
            onChange={(v) => setBlock({ ...block, dy: v })}
            testid="forge-cam-block-dy" />
          <NumField label="Z" value={block.dz} unit="mm"
            onChange={(v) => setBlock({ ...block, dz: v })}
            testid="forge-cam-block-dz" />
        </div>
      )}

      {stockMode === 'cylinder' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr',
                       gap: 8 }}>
          <NumField label="Ø" value={cyl.r * 2} unit="mm"
            onChange={(v) => setCyl({ ...cyl, r: v / 2 })} />
          <NumField label="height" value={cyl.h} unit="mm"
            onChange={(v) => setCyl({ ...cyl, h: v })} />
        </div>
      )}

      <SectionLabel>Margin (all sides)</SectionLabel>
      <NumField label="margin" unit="mm"
        value={stockMode === 'cylinder' ? cyl.margin : block.margin}
        onChange={(v) => stockMode === 'cylinder'
          ? setCyl({ ...cyl, margin: v })
          : setBlock({ ...block, margin: v })} />
    </div>
  );
}

// ──────────────────────────────────────────── TOOLS
function ToolsTab({ activeOp, onPick }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <SectionLabel>Tool library</SectionLabel>
      {TOOL_LIBRARY.map((t) => {
        const isPicked = activeOp?.toolId === t.id;
        return (
          <button key={t.id}
                  type="button"
                  data-testid={`forge-cam-tool-${t.id}`}
                  data-active={String(isPicked)}
                  onClick={() => onPick(t.id)}
                  className="forge-library-item"
                  style={{
                    background: isPicked ? 'var(--forge-accent-mute)' : 'transparent',
                    border: '1px solid var(--forge-rail-edge)',
                    padding: '8px 10px',
                    display: 'grid',
                    gridTemplateColumns: '120px 1fr auto',
                    gap: 8,
                    fontFamily: 'var(--forge-mono)',
                  }}>
            <span style={{ fontWeight: 600, color: 'var(--forge-ink)' }}>
              {t.name}
            </span>
            <span style={{ color: 'var(--forge-ink-2)' }}>
              {t.type} · {t.flutes}fl
            </span>
            <span style={{ color: 'var(--forge-ink-mute)' }}>
              {t.rpm} rpm · {t.feedXY || t.feedZ} mm/min
            </span>
          </button>
        );
      })}
    </div>
  );
}
function ToolPreviewPanel({ activeOp }) {
  const t = TOOL_LIBRARY.find((tt) => tt.id === activeOp?.toolId) || TOOL_LIBRARY[0];
  return (
    <div style={{
      position: 'absolute', inset: 0,
      padding: 20, overflowY: 'auto',
    }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--forge-ink)' }}>
        {t.name}
      </h3>
      <dl style={{ display: 'grid', gridTemplateColumns: '160px 1fr',
                    gap: '6px 12px', fontFamily: 'var(--forge-mono)',
                    fontSize: 12, color: 'var(--forge-ink-2)' }}>
        <dt>Type</dt><dd>{t.type}</dd>
        <dt>Diameter</dt><dd>{t.diameter} mm</dd>
        <dt>Length</dt><dd>{t.length} mm</dd>
        <dt>Flutes</dt><dd>{t.flutes}</dd>
        <dt>Helix</dt><dd>{t.helix}°</dd>
        <dt>Spindle</dt><dd>{t.rpm} rpm</dd>
        <dt>Feed XY</dt><dd>{t.feedXY} mm/min</dd>
        <dt>Feed Z</dt><dd>{t.feedZ} mm/min</dd>
        <dt>Stepover</dt><dd>{t.stepover} mm</dd>
        <dt>Stepdown</dt><dd>{t.stepdown} mm</dd>
        {t.angle && <><dt>Cone angle</dt><dd>{t.angle}°</dd></>}
        {t.pitch && <><dt>Pitch</dt><dd>{t.pitch} mm</dd></>}
      </dl>
    </div>
  );
}

// ──────────────────────────────────────────── OPS
function OpsTab({ ops, activeOpId, onPick, onAdd, onRemove,
                  activeOp, updateOp, onGenerate, ready }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SectionLabel>Operations</SectionLabel>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {ops.map((o) => (
          <div key={o.id}
               data-testid={`forge-cam-op-row-${o.id}`}
               data-active={String(o.id === activeOpId)}
               style={{
                 display: 'flex', alignItems: 'center', gap: 6,
                 padding: '6px 10px',
                 background: o.id === activeOpId ? 'var(--forge-accent-mute)' : 'var(--forge-canvas)',
                 border: '1px solid var(--forge-rail-edge)',
                 borderRadius: 'var(--forge-radius)',
                 cursor: 'pointer',
               }}
               onClick={() => onPick(o.id)}>
            <span style={{ fontFamily: 'var(--forge-mono)', flex: 1 }}>
              {o.name}
            </span>
            <span style={{ fontSize: 10, color: 'var(--forge-ink-mute)' }}>
              {o.toolpath ? `${o.toolpath.moveCount} mv` : (o.error ? '⚠' : '—')}
            </span>
            <button type="button"
                    onClick={(e) => { e.stopPropagation(); onRemove(o.id); }}
                    aria-label="remove op"
                    style={{ background: 'transparent', border: 'none',
                             color: 'var(--forge-ink-mute)', cursor: 'pointer' }}>
              ×
            </button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {OP_TYPES.map((t) => (
          <button key={t.id}
                  type="button"
                  data-testid={`forge-cam-add-${t.id}`}
                  onClick={() => onAdd(t.id)}
                  className="forge-tool-dock-btn"
                  style={{ flex: '0 1 auto', padding: '4px 8px', fontSize: 10 }}>
            + {t.label}
          </button>
        ))}
      </div>

      {activeOp && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8,
                       paddingTop: 8, borderTop: '1px solid var(--forge-rail-edge)' }}>
          <SectionLabel>{activeOp.name} parameters</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <NumField label="zTop" value={activeOp.zTop} unit="mm"
              onChange={(v) => updateOp({ zTop: v })} testid="forge-cam-zTop" />
            <NumField label="zBottom" value={activeOp.zBottom} unit="mm"
              onChange={(v) => updateOp({ zBottom: v })} testid="forge-cam-zBottom" />
            {activeOp.type === 'profile' && (
              <NumField label="lead-in" value={activeOp.leadIn} unit="mm"
                onChange={(v) => updateOp({ leadIn: v })} testid="forge-cam-leadIn" />
            )}
            {activeOp.type === 'face' && (
              <NumField label="depth" value={activeOp.depth} unit="mm"
                onChange={(v) => updateOp({ depth: v })} testid="forge-cam-depth" />
            )}
            <NumField label="stepover" value={activeOp.stepoverOverride} unit="mm"
              placeholder="(tool default)"
              onChange={(v) => updateOp({ stepoverOverride: v })} />
            <NumField label="stepdown" value={activeOp.stepdownOverride} unit="mm"
              placeholder="(tool default)"
              onChange={(v) => updateOp({ stepdownOverride: v })} />
            <NumField label="feed XY" value={activeOp.feedXYOverride} unit="mm/m"
              placeholder="(tool default)"
              onChange={(v) => updateOp({ feedXYOverride: v })} />
            <NumField label="feed Z" value={activeOp.feedZOverride} unit="mm/m"
              placeholder="(tool default)"
              onChange={(v) => updateOp({ feedZOverride: v })} />
          </div>

          {activeOp.type === 'drill' && (
            <DrillHolesEditor holes={activeOp.holes}
              onChange={(holes) => updateOp({ holes })} />
          )}

          {activeOp.type === 'adaptive' && (
            <AdaptiveEditor cfg={activeOp.adaptiveCfg}
              onChange={(adaptiveCfg) => updateOp({ adaptiveCfg })} />
          )}

          {activeOp.type === '5axis-indexed' && (
            <OrientationsEditor orientations={activeOp.orientations}
              onChange={(orientations) => updateOp({ orientations })} />
          )}

          <button type="button"
                  onClick={onGenerate}
                  data-testid="forge-cam-generate"
                  disabled={!ready}
                  className="forge-tool-dock-btn"
                  data-kind="confirm"
                  style={{ marginTop: 4 }}>
            {ready ? 'Generate toolpath' : 'kernel offline'}
          </button>
          {activeOp.error && (
            <div data-testid="forge-cam-op-error"
                 style={{ color: 'var(--forge-err)',
                          fontFamily: 'var(--forge-mono)', fontSize: 10 }}>
              ⚠ {activeOp.error}
            </div>
          )}
          {activeOp.toolpath && (
            <div data-testid="forge-cam-op-summary"
                 style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                          color: 'var(--forge-ink-2)' }}>
              {activeOp.toolpath.moveCount} moves ·
              cycle {activeOp.toolpath.cycleTimeSec?.toFixed(1)}s ·
              cutting {(activeOp.toolpath.estCuttingMm || 0).toFixed(0)} mm
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DrillHolesEditor({ holes, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <SectionLabel>Holes (x, y, z)</SectionLabel>
      {holes.map((h, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 22px', gap: 4 }}>
          {[0,1,2].map((j) => (
            <input key={j} type="number" className="forge-tool-input"
                   value={h[j]}
                   onChange={(e) => {
                     const next = holes.map((row) => row.slice());
                     next[i][j] = Number(e.target.value);
                     onChange(next);
                   }} />
          ))}
          <button type="button"
                  onClick={() => onChange(holes.filter((_, k) => k !== i))}
                  style={{ background: 'transparent', border: 'none',
                           color: 'var(--forge-ink-mute)', cursor: 'pointer' }}>×</button>
        </div>
      ))}
      <button type="button"
              onClick={() => onChange([...holes, [0, 0, 20]])}
              className="forge-tool-dock-btn"
              style={{ fontSize: 10 }}>+ hole</button>
    </div>
  );
}

function AdaptiveEditor({ cfg, onChange }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
      <NumField label="stepover" unit="mm" value={cfg.stepover}
        onChange={(v) => onChange({ ...cfg, stepover: v })} />
      <NumField label="helix" unit="°" value={cfg.helixAngle}
        onChange={(v) => onChange({ ...cfg, helixAngle: v })} />
      <NumField label="zMax" unit="mm" value={cfg.zMax}
        onChange={(v) => onChange({ ...cfg, zMax: v })} />
      <NumField label="zMin" unit="mm" value={cfg.zMin}
        onChange={(v) => onChange({ ...cfg, zMin: v })} />
      <NumField label="minRadius" unit="mm" value={cfg.minRadius}
        onChange={(v) => onChange({ ...cfg, minRadius: v })} />
    </div>
  );
}

function OrientationsEditor({ orientations, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <SectionLabel>Indexed orientations (A, B, C°)</SectionLabel>
      {orientations.map((o, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 22px', gap: 4 }}>
          {[0,1,2].map((j) => (
            <input key={j} type="number" className="forge-tool-input"
                   value={o[j]}
                   onChange={(e) => {
                     const next = orientations.map((r) => r.slice());
                     next[i][j] = Number(e.target.value);
                     onChange(next);
                   }} />
          ))}
          <button type="button"
                  onClick={() => onChange(orientations.filter((_, k) => k !== i))}
                  style={{ background: 'transparent', border: 'none',
                           color: 'var(--forge-ink-mute)', cursor: 'pointer' }}>×</button>
        </div>
      ))}
      <button type="button"
              onClick={() => onChange([...orientations, [0, 0, 0]])}
              className="forge-tool-dock-btn"
              style={{ fontSize: 10 }}>+ orientation</button>
    </div>
  );
}

// ──────────────────────────────────────────── SIM
function SimTab({ playing, setPlaying, cursor, setCursor,
                  activeOp, simReport, onSimulate, ready }) {
  const totalMoves = activeOp?.toolpath?.moveCount || 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionLabel>Stock simulation</SectionLabel>
      <button type="button"
              onClick={onSimulate}
              data-testid="forge-cam-simulate"
              disabled={!ready || !activeOp?.toolpath}
              className="forge-tool-dock-btn"
              data-kind="confirm">
        {ready ? 'Run voxel simulator' : 'kernel offline'}
      </button>
      {simReport && simReport.ok && (
        <dl data-testid="forge-cam-sim-report"
            style={{ display: 'grid', gridTemplateColumns: '120px 1fr',
                      gap: '4px 12px', fontFamily: 'var(--forge-mono)',
                      fontSize: 11, color: 'var(--forge-ink-2)' }}>
          <dt>Initial vol</dt><dd>{simReport.report.initialVolume.toFixed(0)} mm³</dd>
          <dt>Remaining</dt><dd>{simReport.report.remainingVolume.toFixed(0)} mm³</dd>
          <dt>Removed</dt>
          <dd>{(simReport.report.initialVolume - simReport.report.remainingVolume).toFixed(0)} mm³</dd>
          <dt>Cut depth</dt><dd>{simReport.report.maxCutDepth.toFixed(2)} mm</dd>
          <dt>Collisions</dt><dd>{simReport.report.collisionCount}</dd>
          <dt>Grid</dt><dd>{simReport.report.gridResolution}</dd>
        </dl>
      )}
      {simReport && !simReport.ok && (
        <div style={{ color: 'var(--forge-err)', fontSize: 11,
                       fontFamily: 'var(--forge-mono)' }}>
          ⚠ {simReport.error || simReport.kind}
        </div>
      )}

      <SectionLabel>Playback</SectionLabel>
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button"
                onClick={() => setPlaying((p) => !p)}
                data-testid="forge-cam-play"
                className="forge-tool-dock-btn"
                disabled={!activeOp?.toolpath}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button"
                onClick={() => { setPlaying(false); setCursor(0); }}
                className="forge-tool-dock-btn">
          ⏮
        </button>
      </div>
      <input type="range"
             data-testid="forge-cam-cursor"
             min={0} max={Math.max(0, totalMoves - 1)}
             value={Math.min(cursor, totalMoves - 1)}
             onChange={(e) => setCursor(parseInt(e.target.value, 10))} />
      <div style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                     color: 'var(--forge-ink-mute)' }}>
        {Math.min(cursor + 1, totalMoves)} / {totalMoves} moves
      </div>
    </div>
  );
}
function SimOverlay({ activeOp, cursor, setCursor, playing, setPlaying }) {
  const tp = activeOp?.toolpath;
  if (!tp) return null;
  const segs = toolpathSegments(tp);
  const at = segs?.[Math.min(cursor, segs.length - 1)];
  return (
    <div style={{
      position: 'absolute', left: 12, bottom: 12, right: 12,
      background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
      border: '1px solid var(--forge-rail-edge)',
      borderRadius: 'var(--forge-radius)',
      padding: '8px 12px',
      fontFamily: 'var(--forge-mono)', fontSize: 11,
      color: 'var(--forge-ink-2)',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <button type="button"
              onClick={() => setPlaying((p) => !p)}
              className="forge-tool-dock-btn"
              style={{ flex: '0 0 auto' }}>
        {playing ? '⏸' : '▶'}
      </button>
      <span>move {cursor + 1}/{segs?.length || 0}</span>
      {at && (
        <span>
          x={at.x.toFixed(2)} y={at.y.toFixed(2)} z={at.z.toFixed(2)} ·
          {at.cutting ? ' cutting' : ' rapid'} · feed {at.feed.toFixed(0)} mm/min
        </span>
      )}
    </div>
  );
}

// ──────────────────────────────────────────── CMM
function CmmTab({ features, setFeatures, gauge, setGauge,
                  program, onGenerate, ready }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionLabel>CMM features</SectionLabel>
      {features.map((f, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 22px', gap: 4 }}>
          <select className="forge-tool-input" value={f.kind}
                  onChange={(e) => {
                    const next = features.slice();
                    next[i] = { ...f, kind: e.target.value };
                    setFeatures(next);
                  }}>
            <option value="plane">plane</option>
            <option value="cylinder">cylinder</option>
            <option value="point">point</option>
          </select>
          <input type="number" className="forge-tool-input" value={f.topo}
                 onChange={(e) => {
                   const next = features.slice();
                   next[i] = { ...f, topo: parseInt(e.target.value, 10) };
                   setFeatures(next);
                 }} />
          <input type="text" className="forge-tool-input" value={f.label}
                 onChange={(e) => {
                   const next = features.slice();
                   next[i] = { ...f, label: e.target.value };
                   setFeatures(next);
                 }} />
          <button type="button"
                  onClick={() => setFeatures(features.filter((_, k) => k !== i))}
                  style={{ background: 'transparent', border: 'none',
                           color: 'var(--forge-ink-mute)', cursor: 'pointer' }}>×</button>
        </div>
      ))}
      <button type="button"
              onClick={() => setFeatures([...features, { kind: 'plane', topo: 0, label: `FEAT_${features.length+1}` }])}
              className="forge-tool-dock-btn"
              style={{ fontSize: 10 }}>+ feature</button>
      <SectionLabel>Probe gauge</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <NumField label="stepover" unit="mm" value={gauge.stepover}
          onChange={(v) => setGauge({ ...gauge, stepover: v })} />
        <NumField label="probe Ø" unit="mm" value={gauge.probeRadius * 2}
          onChange={(v) => setGauge({ ...gauge, probeRadius: v / 2 })} />
      </div>
      <button type="button"
              onClick={onGenerate}
              data-testid="forge-cam-cmm-generate"
              disabled={!ready}
              className="forge-tool-dock-btn"
              data-kind="confirm">
        {ready ? 'Generate CMM program' : 'kernel offline'}
      </button>
      {program && program.ok && (
        <div data-testid="forge-cam-cmm-report"
             style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                       color: 'var(--forge-ink-2)' }}>
          {program.program.pointCount} probe points ·
          {Array.from(program.program.pointsPerFeature).join(' + ')} per feature
        </div>
      )}
      {program && !program.ok && (
        <div style={{ color: 'var(--forge-err)', fontSize: 11 }}>
          ⚠ {program.error || program.kind}
        </div>
      )}
    </div>
  );
}
function CmmOverlay({ program, stockAabb }) {
  // Render the probe-point list at right.
  const N = program.pointCount || 0;
  const rows = [];
  for (let i = 0; i < Math.min(N, 64); i++) {
    rows.push({
      x: program.points[i * 6 + 0],
      y: program.points[i * 6 + 1],
      z: program.points[i * 6 + 2],
      nx: program.points[i * 6 + 3],
      ny: program.points[i * 6 + 4],
      nz: program.points[i * 6 + 5],
    });
  }
  return (
    <div style={{
      position: 'absolute', right: 12, top: 12, bottom: 12, width: 280,
      background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
      border: '1px solid var(--forge-rail-edge)',
      borderRadius: 'var(--forge-radius)',
      padding: 10, overflowY: 'auto',
      fontFamily: 'var(--forge-mono)', fontSize: 10,
      color: 'var(--forge-ink-2)',
    }}>
      <div style={{ color: 'var(--forge-ink)', marginBottom: 6 }}>
        {N} probe points {N > 64 ? '· first 64 shown' : ''}
      </div>
      {rows.map((r, i) => (
        <div key={i}>
          P{String(i + 1).padStart(3, '0')} · {r.x.toFixed(1)} {r.y.toFixed(1)} {r.z.toFixed(1)}
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────── G-CODE
function GcodeTab({ dialect, setDialect, dialects, safeZ, setSafeZ,
                    onExport, onSave, hasText, note, ready }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionLabel>Post-processor</SectionLabel>
      <select className="forge-tool-input"
              data-testid="forge-cam-dialect"
              value={dialect}
              onChange={(e) => setDialect(e.target.value)}
              style={{ width: '100%' }}>
        {dialects.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
      <NumField label="safe Z" unit="mm" value={safeZ}
        onChange={(v) => setSafeZ(v)} testid="forge-cam-safez" />
      <button type="button"
              onClick={onExport}
              data-testid="forge-cam-export"
              disabled={!ready}
              className="forge-tool-dock-btn"
              data-kind="confirm">
        {ready ? 'Export G-code' : 'kernel offline'}
      </button>
      <button type="button"
              onClick={onSave}
              data-testid="forge-cam-save"
              disabled={!hasText}
              className="forge-tool-dock-btn">
        Save .nc / .ngc
      </button>
      {note && (
        <div data-testid="forge-cam-gcode-note"
             style={{ fontFamily: 'var(--forge-mono)', fontSize: 10,
                       color: 'var(--forge-warn)' }}>
          {note}
        </div>
      )}
    </div>
  );
}
function GcodeView({ text, note }) {
  // Very small syntax highlighter — recognises G-codes (Gnn), M-codes
  // (Mnn), axis words (X/Y/Z/A/B/C followed by a number), F/S/T words,
  // line numbers (Nnn), and comments. Read-only; user copies via select-all.
  const lines = (text || '').split('\n');
  return (
    <pre data-testid="forge-cam-gcode"
         style={{
           position: 'absolute', inset: 0, margin: 0,
           overflow: 'auto', padding: '16px 20px',
           background: 'var(--forge-canvas)',
           fontFamily: 'var(--forge-mono)',
           fontSize: 12, lineHeight: 1.5,
           color: 'var(--forge-ink-2)',
         }}>
      {!text && (
        <span style={{ color: 'var(--forge-ink-mute)' }}>
          {note || 'No G-code yet. Pick a dialect + click Export G-code.'}
        </span>
      )}
      {text && lines.map((line, i) => (
        <div key={i}>
          <span style={{ color: 'var(--forge-ink-faint)', userSelect: 'none' }}>
            {String(i + 1).padStart(4, ' ')}
          </span>
          {colorizeGcodeLine(line)}
        </div>
      ))}
    </pre>
  );
}
function colorizeGcodeLine(line) {
  if (!line) return '';
  // Comment lines / parenthesised comments.
  if (line.trim().startsWith('(') || line.trim().startsWith(';')) {
    return <span style={{ color: 'var(--forge-ink-mute)', fontStyle: 'italic' }}>{line}</span>;
  }
  const out = [];
  const re = /(N\d+|G\d+(?:\.\d+)?|M\d+|[XYZABCIJK][-+]?\d+(?:\.\d+)?|F\d+(?:\.\d+)?|S\d+|T\d+|\([^)]*\))/g;
  let last = 0;
  let m;
  let k = 0;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) {
      out.push(<span key={`p${k++}`}>{line.slice(last, m.index)}</span>);
    }
    const tok = m[0];
    let color = 'var(--forge-ink)';
    if (tok.startsWith('G')) color = '#9ad1ff';
    else if (tok.startsWith('M')) color = '#ff9a9a';
    else if (tok.startsWith('N')) color = 'var(--forge-ink-faint)';
    else if (tok.startsWith('S')) color = '#c4ff9a';
    else if (tok.startsWith('F')) color = '#ffd57a';
    else if (tok.startsWith('T')) color = '#d1aaff';
    else if (tok.startsWith('(')) color = 'var(--forge-ink-mute)';
    else color = 'var(--forge-ink)';     // axis words
    out.push(<span key={`t${k++}`} style={{ color }}>{tok}</span>);
    last = m.index + tok.length;
  }
  if (last < line.length) out.push(<span key="tail">{line.slice(last)}</span>);
  return out;
}

// ──────────────────────────────────────────── shared field bits
function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em',
      color: 'var(--forge-ink-mute)', marginBottom: 4,
    }}>
      {children}
    </div>
  );
}
function ModeRow({ modes, active, onPick, testid }) {
  return (
    <div data-testid={testid}
         style={{ display: 'flex', gap: 2,
                   border: '1px solid var(--forge-rail-edge)',
                   borderRadius: 'var(--forge-radius)',
                   padding: 2 }}>
      {modes.map((m) => (
        <button key={m.id}
                type="button"
                data-cam-mode={m.id}
                data-active={String(m.id === active)}
                onClick={() => onPick(m.id)}
                className="forge-tool-dock-btn"
                style={{
                  flex: 1, padding: '5px 6px', fontSize: 10,
                  background: m.id === active
                    ? 'var(--forge-accent-mute)' : 'transparent',
                }}>
          {m.label}
        </button>
      ))}
    </div>
  );
}
function NumField({ label, value, unit, onChange, placeholder, testid }) {
  return (
    <div className="forge-tool-field">
      <label className="forge-tool-field-label">{label}</label>
      <div className="forge-tool-field-row">
        <input className="forge-tool-input"
               data-testid={testid}
               type="number" step="any"
               value={value === undefined || value === null ? '' : value}
               placeholder={placeholder}
               onChange={(e) => {
                 const raw = e.target.value;
                 onChange(raw === '' ? '' : Number(raw));
               }} />
        {unit && <span className="forge-tool-field-unit">{unit}</span>}
      </div>
    </div>
  );
}
function fmtAabb(aabb) {
  if (!aabb) return '—';
  const dx = aabb[3] - aabb[0];
  const dy = aabb[4] - aabb[1];
  const dz = aabb[5] - aabb[2];
  return `${dx.toFixed(0)}×${dy.toFixed(0)}×${dz.toFixed(0)} mm`;
}

// ──────────────────────────────────────────── self-mounting host
//
// Mounted once by App.jsx so the panel can self-show via the
// `forge:open-cam-panel` window event or the imperative
// window.__forgeOpenCam() entry point. This avoids touching
// ForgeShellV4.jsx (per Forge-92 constraints).
//
// Bodies the panel sees come from window.__forgeBodies (a snapshot the
// shell publishes whenever the body registry changes) or from a `bodies`
// payload attached to the open event/imperative call. When neither is
// present the panel falls back to the block stock defaults.

const CAM_PANEL_EVENT = 'forge:open-cam-panel';

export function ManufacturingWorkbenchHost() {
  const [open, setOpen] = useState(false);
  const [bodies, setBodies] = useState([]);
  const [initialBodyId, setInitialBodyId] = useState(null);
  const mountedRef = React.useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (typeof window === 'undefined') return;
    window.__forgeOpenCam = (opts = {}) => {
      if (Array.isArray(opts.bodies)) setBodies(opts.bodies);
      else if (Array.isArray(window.__forgeBodies)) setBodies(window.__forgeBodies);
      if (opts.bodyId) setInitialBodyId(opts.bodyId);
      setOpen(true);
    };
    window.__forgeCloseCam = () => setOpen(false);
    const onEvt = (e) => {
      const d = e?.detail || {};
      if (Array.isArray(d.bodies)) setBodies(d.bodies);
      else if (Array.isArray(window.__forgeBodies)) setBodies(window.__forgeBodies);
      if (d.bodyId) setInitialBodyId(d.bodyId);
      setOpen(true);
    };
    window.addEventListener(CAM_PANEL_EVENT, onEvt);
    return () => window.removeEventListener(CAM_PANEL_EVENT, onEvt);
  }, []);
  return (
    <ManufacturingWorkbench open={open}
                            bodies={bodies}
                            initialBodyId={initialBodyId}
                            onClose={() => setOpen(false)} />
  );
}

export default ManufacturingWorkbench;
