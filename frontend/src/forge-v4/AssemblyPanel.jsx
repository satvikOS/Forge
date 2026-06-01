// Forge-89 — Assembly workbench panel.
//
// Right-anchored 380 px drawer (matches `.forge-help` geometry). Five
// sections, top-to-bottom:
//
//   1. Mate list           — every existing constraint with active toggle
//                            + remove button. Kind icon on the left.
//   2. Add-mate stepper    — pick A → pick B → kind → optional value.
//                            "Apply" calls window.forge.assembly.addMate.
//   3. Instance DOF badges — 6 × nInstances − constraints_consumed.
//   4. Interference detect — button opens a modal with severity bars.
//   5. Motion study        — pick mate · axis · totalAngle · steps ·
//                            preview slider that drives a per-frame
//                            window.forge.updateTransform call.
//
// All manipulation goes through `assemblyDispatch.js` so the kernel is
// guarded. Manual clicks never write to the Archie thread.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import {
  MATE_KINDS, MATE_CATEGORIES, NATIVE_MATE_KINDS, JS_MATE_KINDS,
  paramSchemaFor, isJsMateKind, mateKindEnum,
  addMate as dispAddMate,
  removeMate as dispRemoveMate,
  setMateActive as dispSetMateActive,
  setFixed as dispSetFixed,
  solveAndCollect, detectInterference, runMotion,
  isKernelReady,
} from './assemblyDispatch.js';
import { FlexibleComponentToggle, FlexibleComponentSection } from './FlexibleComponentToggle.jsx';

const SECTION_HEAD = {
  margin: '0 0 6px',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--forge-ink-mute)',
};

const SECTION = {
  display: 'flex', flexDirection: 'column',
  gap: 6,
  padding: 'var(--forge-space-3)',
  background: 'var(--forge-surface)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 'var(--forge-radius)',
};

const BTN = {
  background: 'var(--forge-surface)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 3,
  color: 'var(--forge-ink)',
  font: 'inherit', fontSize: 11,
  padding: '5px 10px',
  cursor: 'pointer',
};

const BTN_CONFIRM = {
  ...BTN,
  background: 'var(--forge-accent-mute)',
  borderColor: 'var(--forge-accent-rim)',
};

const INPUT = {
  flex: 1,
  background: 'var(--forge-canvas)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 3,
  color: 'var(--forge-ink)',
  font: 'inherit', fontSize: 12,
  padding: '4px 6px',
  outline: 'none',
};

const MATE_ICON = {
  Coincident:    'sketch.point',
  Distance:      'measure.distance',
  Angle:         'measure.angle',
  Parallel:      'sketch.line',
  Perpendicular: 'sketch.constrain',
  Tangent:       'sketch.arc',
  Concentric:    'sketch.circle',
  Fixed:         'sketch.point',
  // Mechanical
  Gear:          'wb.mech',
  Cam:           'wb.mech',
  Belt:          'wb.mech',
  Chain:         'wb.mech',
  RackPinion:    'wb.mech',
  LinearCoupler: 'measure.distance',
  Screw:         'wb.mech',
  // Limits + advanced
  LimitAngular:  'measure.angle',
  LimitLinear:   'measure.distance',
  Width:         'measure.distance',
  Profile:       'sketch.arc',
  Slot:          'sketch.line',
};

function panelStyle() {
  return {
    position: 'fixed',
    top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
    right: 0,
    width: 380,
    maxWidth: '96vw',
    height: 'calc(100vh - var(--forge-topbar-h) - var(--forge-qat-h) - var(--forge-cmdbar-h))',
    background: 'var(--forge-canvas-2)',
    borderLeft: '1px solid var(--forge-edge, var(--forge-rail-edge))',
    boxShadow: '-12px 0 32px rgba(0,0,0,0.45)',
    display: 'flex',
    flexDirection: 'column',
    fontSize: 13,
    color: 'var(--forge-ink)',
    zIndex: 1290,
  };
}

export function AssemblyPanel({
  open,
  onClose,
  bodies = [],
  selection,
  onSelect,
  onSolveResult,
}) {
  const [mates, setMates] = useState([]);
  const [interferenceModal, setInterferenceModal] = useState(null);
  const [kernelReady, setKernelReady] = useState(false);
  const [solveStatus, setSolveStatus] = useState(null);

  // Detect kernel availability whenever the panel re-opens.
  useEffect(() => {
    if (!open) return;
    setKernelReady(isKernelReady());
  }, [open]);

  // ─── DOF computation ─────────────────────────────────────────────
  const dofByInst = useMemo(() => {
    const map = new Map();
    for (const b of bodies) {
      if (b?.inst != null) map.set(b.inst, 6);
    }
    for (const m of mates) {
      if (m.active === false) continue;
      const consume = 1;
      if (m.a?.inst != null && map.has(m.a.inst)) {
        map.set(m.a.inst, Math.max(0, map.get(m.a.inst) - consume));
      }
      if (m.b?.inst != null && map.has(m.b.inst)) {
        map.set(m.b.inst, Math.max(0, map.get(m.b.inst) - consume));
      }
    }
    return map;
  }, [bodies, mates]);

  const totalDof = useMemo(() => {
    let total = 6 * bodies.length;
    for (const m of mates) if (m.active !== false) total -= 1;
    return Math.max(0, total);
  }, [bodies, mates]);

  // ─── Actions ─────────────────────────────────────────────────────
  function handleAddMate(spec) {
    const r = dispAddMate(spec);
    if (r.ok) {
      setMates((prev) => [...prev, {
        id: r.mateId,
        kind: spec.kind,
        a: spec.a,
        b: spec.b,
        value: spec.value ?? 0,
        params: spec.params || {},
        jsSide: !!r.jsSide,
        active: true,
      }]);
      const sr = solveAndCollect([...mates, { id: r.mateId, ...spec, active: true }]);
      setSolveStatus(sr.ok ? sr.status : null);
      if (sr.ok && onSolveResult) onSolveResult(sr);
    } else {
      // Even in kernel-not-ready mode we still want the UI to reflect
      // the user's intent so the test asserts the mate-list row. For
      // JS-side mates the dispatch always succeeds, so this only fires
      // for native kinds when the kernel is offline.
      setMates((prev) => [...prev, {
        id: `pending-${prev.length}`,
        kind: spec.kind,
        a: spec.a,
        b: spec.b,
        value: spec.value ?? 0,
        params: spec.params || {},
        active: true,
        pending: true,
        error: r.error,
      }]);
    }
  }

  function handleRemoveMate(id) {
    const r = dispRemoveMate(id);
    setMates((prev) => prev.filter((m) => m.id !== id));
    if (r.ok) {
      const sr = solveAndCollect(mates.filter((m) => m.id !== id));
      setSolveStatus(sr.ok ? sr.status : null);
      if (sr.ok && onSolveResult) onSolveResult(sr);
    }
  }

  function handleToggleMate(id, on) {
    dispSetMateActive(id, on);
    setMates((prev) => prev.map((m) => m.id === id ? { ...m, active: on } : m));
  }

  function handleSolve() {
    const sr = solveAndCollect(mates);
    if (sr.ok) {
      setSolveStatus(sr.status);
      if (onSolveResult) onSolveResult(sr);
    } else {
      setSolveStatus(null);
    }
  }

  function handleDetectInterference() {
    const ids = bodies.map((b) => b.inst).filter((i) => i != null);
    const r = detectInterference(ids, 0.01);
    if (r.ok) {
      setInterferenceModal({ pairs: r.pairs });
    } else {
      setInterferenceModal({ pairs: [], error: r.error });
    }
  }

  if (!open) return null;

  return (
    <aside
      role="region"
      aria-label="Assembly"
      data-testid="forge-assembly-panel"
      style={panelStyle()}>

      <Header onClose={onClose} kernelReady={kernelReady} />

      <div style={{
        flex: 1, overflowY: 'auto',
        padding: 'var(--forge-space-3)',
        display: 'flex', flexDirection: 'column',
        gap: 'var(--forge-space-3)',
      }}>
        <DofSummary
          bodies={bodies}
          totalDof={totalDof}
          dofByInst={dofByInst}
          mates={mates}
          onSelect={onSelect}
          onToggleFix={(inst, on) => { dispSetFixed(inst, on); }}
        />

        <FlexibleComponentSection bodies={bodies} />

        <MateList
          mates={mates}
          onRemove={handleRemoveMate}
          onToggle={handleToggleMate}
        />

        <AddMateStepper
          bodies={bodies}
          selection={selection}
          onSelect={onSelect}
          onApply={handleAddMate}
        />

        <SolveBar
          mateCount={mates.length}
          totalDof={totalDof}
          status={solveStatus}
          onSolve={handleSolve}
        />

        <InterferenceSection
          onRun={handleDetectInterference}
          modal={interferenceModal}
          onCloseModal={() => setInterferenceModal(null)}
        />

        <MotionStudy mates={mates} bodies={bodies} />
      </div>
    </aside>
  );
}

// ────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────

function Header({ onClose, kernelReady }) {
  return (
    <header style={{
      display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)',
      padding: 'var(--forge-space-3) var(--forge-space-4)',
      borderBottom: '1px solid var(--forge-rail-edge)',
      background: 'var(--forge-canvas)',
      fontSize: 12, fontWeight: 600,
      flexShrink: 0,
    }}>
      <Icon name="wb.mech" size={14} />
      <span>Assembly</span>
      <span style={{
        fontFamily: 'var(--forge-mono)', fontSize: 10,
        color: kernelReady ? 'var(--forge-ok)' : 'var(--forge-warn)',
        padding: '1px 6px', borderRadius: 'var(--forge-radius-pill)',
        border: '1px solid var(--forge-rail-edge)',
      }} title={kernelReady ? 'Native OCCT assembly bridge online'
                            : 'window.forge.assembly not detected'}>
        {kernelReady ? 'kernel ok' : 'no kernel'}
      </span>
      <span style={{ flex: 1 }} />
      <button type="button"
              onClick={onClose}
              aria-label="Close assembly panel"
              style={{
                background: 'transparent', border: 'none',
                color: 'var(--forge-ink-mute)', cursor: 'pointer',
                display: 'inline-flex', padding: 2,
              }}>
        <Icon name="select.clear" size={12} />
      </button>
    </header>
  );
}

function DofSummary({ bodies, totalDof, dofByInst, mates, onSelect, onToggleFix }) {
  return (
    <section style={SECTION} data-testid="forge-assembly-dof">
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <h4 style={SECTION_HEAD}>Degrees of freedom</h4>
        <span style={{ flex: 1 }} />
        <span style={{
          fontFamily: 'var(--forge-mono)', fontSize: 11,
          color: totalDof === 0 ? 'var(--forge-ok)' : 'var(--forge-ink)',
        }}>
          total {totalDof}
        </span>
      </div>
      {bodies.length === 0 ? (
        <div style={{ color: 'var(--forge-ink-mute)', fontStyle: 'italic' }}>
          No instances. Add bodies via the Part workbench, then return.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0,
                     display: 'flex', flexDirection: 'column', gap: 3 }}>
          {bodies.map((b, i) => {
            const inst = b.inst != null ? b.inst : i;
            const dof = dofByInst.has(inst) ? dofByInst.get(inst) : 6;
            const fixed = !!b.fixed;
            return (
              <li key={inst}
                  data-inst={inst}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '3px 6px',
                    borderRadius: 3,
                    background: 'var(--forge-canvas)',
                    cursor: onSelect ? 'pointer' : 'default',
                  }}
                  onClick={() => onSelect?.({ kind: 'body', ids: [inst] })}>
                <Icon name="select.body" size={12} />
                <span style={{ flex: 1, fontFamily: 'var(--forge-mono)',
                               fontSize: 11, color: 'var(--forge-ink)' }}>
                  {b.name || `inst#${inst}`}
                </span>
                <span style={{
                  fontFamily: 'var(--forge-mono)', fontSize: 10,
                  color: dof === 0 ? 'var(--forge-ok)'
                       : dof < 0 ? 'var(--forge-err)' : 'var(--forge-ink-2)',
                  background: 'var(--forge-surface-2)',
                  padding: '1px 5px', borderRadius: 2,
                  minWidth: 38, textAlign: 'center',
                }} title={`${dof} degrees of freedom`}>
                  dof {dof}
                </span>
                <label style={{
                  fontSize: 10, color: 'var(--forge-ink-mute)',
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  cursor: 'pointer',
                }} onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox"
                         checked={fixed}
                         onChange={(e) => onToggleFix(inst, e.target.checked)}
                         aria-label={`Fix instance ${inst}`} />
                  fix
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function MateList({ mates, onRemove, onToggle }) {
  return (
    <section style={SECTION} data-testid="forge-assembly-mate-list">
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <h4 style={SECTION_HEAD}>Mates ({mates.length})</h4>
      </div>
      {mates.length === 0 ? (
        <div style={{ color: 'var(--forge-ink-mute)', fontStyle: 'italic' }}>
          No mates yet. Use Add mate below.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0,
                     display: 'flex', flexDirection: 'column', gap: 3 }}>
          {mates.map((m) => (
            <li key={m.id}
                data-mate-id={m.id}
                data-mate-kind={m.kind}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 6px',
                  background: 'var(--forge-canvas)',
                  border: m.pending
                    ? '1px solid var(--forge-warn)'
                    : '1px solid transparent',
                  borderRadius: 3,
                  opacity: m.active === false ? 0.55 : 1,
                }}
                title={m.pending ? `pending — ${m.error || 'kernel offline'}` : ''}>
              <Icon name={MATE_ICON[m.kind] || 'sketch.constrain'} size={12} />
              <span style={{
                flex: 1, fontFamily: 'var(--forge-mono)',
                fontSize: 11, color: 'var(--forge-ink)',
                overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                <strong style={{ fontWeight: 500 }}>{m.kind}</strong>{' '}
                <span style={{ color: 'var(--forge-ink-mute)' }}>
                  #{m.a?.inst ?? '?'}↔#{m.b?.inst ?? '?'}
                </span>
              </span>
              {typeof m.value === 'number' && m.value !== 0 && (
                <span style={{ fontFamily: 'var(--forge-mono)', fontSize: 10,
                               color: 'var(--forge-ink-2)' }}>
                  {m.value.toFixed(2)}
                </span>
              )}
              <input type="checkbox"
                     checked={m.active !== false}
                     onChange={(e) => onToggle(m.id, e.target.checked)}
                     aria-label={`Mate ${m.id} active`}
                     data-mate-active={m.id} />
              <button type="button"
                      onClick={() => onRemove(m.id)}
                      aria-label={`Remove mate ${m.id}`}
                      data-mate-remove={m.id}
                      style={{
                        background: 'transparent', border: 'none',
                        color: 'var(--forge-ink-mute)', cursor: 'pointer',
                        padding: 2,
                      }}>
                <Icon name="select.clear" size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AddMateStepper({ bodies, selection, onSelect, onApply }) {
  const [a, setA] = useState(null);
  const [b, setB] = useState(null);
  const [kind, setKind] = useState('Coincident');
  const [value, setValue] = useState('');
  const [params, setParams] = useState({});
  const [pickMode, setPickMode] = useState(null); // 'a' | 'b' | null

  // When a single body is selected in the viewport and we're in pick
  // mode, auto-fill the slot.
  useEffect(() => {
    if (!pickMode || !selection || selection.kind !== 'body') return;
    if (!selection.ids?.length) return;
    const inst = selection.ids[0];
    const token = 0;
    if (pickMode === 'a') setA({ inst, token });
    else if (pickMode === 'b') setB({ inst, token });
    setPickMode(null);
  }, [selection, pickMode]);

  // Reset the params bag whenever the kind changes — populate with the
  // schema defaults so the user immediately sees sensible numbers.
  useEffect(() => {
    const schema = paramSchemaFor(kind);
    const next = {};
    for (const p of schema) if (p.default !== undefined) next[p.key] = p.default;
    setParams(next);
  }, [kind]);

  const schema = paramSchemaFor(kind);
  const missingRequired = schema.some((p) => {
    if (!p.required) return false;
    const v = params[p.key];
    if (p.unit === 'vec3') return !Array.isArray(v) || v.length !== 3;
    return v === undefined || v === '' || Number.isNaN(+v);
  });
  const canApply = a && b && a.inst !== b.inst && !missingRequired;

  function applyMate() {
    if (!canApply) return;
    // Coerce string-typed numeric params to numbers; pass vec3 arrays
    // through.
    const finalParams = {};
    for (const p of schema) {
      if (p.unit === 'vec3') {
        finalParams[p.key] = Array.isArray(params[p.key])
          ? params[p.key].map((v) => +v || 0)
          : (p.default || [0, 0, 0]);
      } else {
        finalParams[p.key] = params[p.key] === undefined
          ? (p.default ?? 0) : +params[p.key];
      }
    }
    onApply({
      kind, a, b,
      value: parseFloat(value) || 0,
      params: finalParams,
    });
    setA(null); setB(null); setValue('');
  }

  return (
    <section style={SECTION} data-testid="forge-assembly-add-mate">
      <h4 style={SECTION_HEAD}>Add mate</h4>

      {/* Picker for A */}
      <Slot label="A"
            slot={a}
            picking={pickMode === 'a'}
            bodies={bodies}
            onSelectFromViewport={() => setPickMode('a')}
            onChooseBody={(inst) => setA({ inst, token: 0 })}
            testid="forge-assembly-pick-a" />

      {/* Picker for B */}
      <Slot label="B"
            slot={b}
            picking={pickMode === 'b'}
            bodies={bodies}
            onSelectFromViewport={() => setPickMode('b')}
            onChooseBody={(inst) => setB({ inst, token: 0 })}
            testid="forge-assembly-pick-b" />

      {/* Categorised kind picker */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <label style={{ fontSize: 10, color: 'var(--forge-ink-mute)',
                        textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Kind ({MATE_KINDS.length} total)
        </label>
        <select value={kind}
                onChange={(e) => setKind(e.target.value)}
                data-testid="forge-assembly-kind"
                style={{ ...INPUT }}>
          {MATE_CATEGORIES.map((cat) => (
            <optgroup key={cat.id} label={cat.label}>
              {cat.kinds.map((k) => (
                <option key={k} value={k}>
                  {k}{isJsMateKind(k) ? ' (js)' : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Per-kind params form */}
      <ParamsForm
        kind={kind}
        schema={schema}
        params={params}
        setParams={setParams} />

      {/* Optional generic "value" — kept visible for the eight native
          kinds. Mechanical / advanced / limit kinds prefer their per-
          kind params form (above) instead. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <label style={{ fontSize: 10, color: 'var(--forge-ink-mute)',
                        textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Value (mm / deg, optional)
        </label>
        <input type="number"
               value={value}
               step="0.1"
               placeholder={kind === 'Angle' ? 'angle in degrees' : 'offset in mm'}
               onChange={(e) => setValue(e.target.value)}
               data-testid="forge-assembly-value"
               style={INPUT} />
      </div>

      <button type="button"
              onClick={applyMate}
              disabled={!canApply}
              data-testid="forge-assembly-apply"
              style={{
                ...BTN_CONFIRM,
                opacity: canApply ? 1 : 0.4,
                cursor: canApply ? 'pointer' : 'not-allowed',
              }}>
        Apply mate
      </button>
    </section>
  );
}

function ParamsForm({ kind, schema, params, setParams }) {
  if (!schema || !schema.length) {
    return (
      <div style={{ fontSize: 10, color: 'var(--forge-ink-mute)',
                    fontStyle: 'italic' }}
            data-testid="forge-assembly-params-empty">
        No extra parameters for {kind}.
      </div>
    );
  }
  return (
    <div data-testid="forge-assembly-params"
         data-mate-kind={kind}
         style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {schema.map((p) => {
        if (p.unit === 'vec3') {
          const arr = Array.isArray(params[p.key])
            ? params[p.key]
            : (p.default || [0, 0, 0]);
          return (
            <div key={p.key}
                 style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <label style={{ fontSize: 10, color: 'var(--forge-ink-mute)',
                              textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {p.label}{p.required ? ' *' : ''}
              </label>
              <div style={{ display: 'flex', gap: 3 }}>
                {['x', 'y', 'z'].map((ax, i) => (
                  <input key={ax}
                         type="number"
                         step="0.1"
                         value={arr[i] ?? 0}
                         aria-label={`${p.label} ${ax}`}
                         data-testid={`forge-assembly-param-${p.key}-${ax}`}
                         onChange={(e) => {
                           const next = [...arr];
                           next[i] = +e.target.value || 0;
                           setParams({ ...params, [p.key]: next });
                         }}
                         style={{ ...INPUT, textAlign: 'center' }} />
                ))}
              </div>
            </div>
          );
        }
        return (
          <div key={p.key}
               style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ fontSize: 10, color: 'var(--forge-ink-mute)',
                            textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {p.label}{p.required ? ' *' : ''}{' '}
              <span style={{ color: 'var(--forge-ink-mute)',
                             fontFamily: 'var(--forge-mono)',
                             fontSize: 9 }}>
                {p.unit}
              </span>
            </label>
            <input type="number"
                   step={p.unit === 'count' ? '1' : '0.1'}
                   value={params[p.key] ?? ''}
                   onChange={(e) => setParams({ ...params,
                                                [p.key]: e.target.value })}
                   data-testid={`forge-assembly-param-${p.key}`}
                   style={INPUT} />
          </div>
        );
      })}
    </div>
  );
}

function Slot({ label, slot, picking, bodies, onSelectFromViewport, onChooseBody, testid }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <label style={{ fontSize: 10, color: 'var(--forge-ink-mute)',
                      textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label} {picking ? '· picking…' : ''}
      </label>
      <div style={{ display: 'flex', gap: 4 }}>
        <select value={slot?.inst ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') return;
                  onChooseBody(parseInt(v, 10));
                }}
                data-testid={testid}
                style={INPUT}>
          <option value="">— choose body —</option>
          {bodies.map((b, i) => {
            const inst = b.inst != null ? b.inst : i;
            return (
              <option key={inst} value={inst}>
                {b.name || `inst#${inst}`}
              </option>
            );
          })}
        </select>
        <button type="button"
                onClick={onSelectFromViewport}
                aria-label={`Pick ${label} from viewport`}
                style={{
                  ...BTN,
                  background: picking ? 'var(--forge-accent-mute)' : BTN.background,
                  borderColor: picking ? 'var(--forge-accent)' : BTN.border,
                }}>
          <Icon name="select.body" size={11} />
        </button>
      </div>
    </div>
  );
}

function SolveBar({ mateCount, totalDof, status, onSolve }) {
  return (
    <section style={SECTION}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10, color: 'var(--forge-ink-mute)',
                       textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Solver
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: 'var(--forge-mono)', fontSize: 10,
                       color: 'var(--forge-ink-2)' }}>
          {mateCount} mates · dof {totalDof}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button type="button"
                onClick={onSolve}
                data-testid="forge-assembly-solve"
                style={BTN_CONFIRM}>
          Solve
        </button>
        {status != null && (
          <span style={{
            fontFamily: 'var(--forge-mono)', fontSize: 10,
            color: 'var(--forge-ink-2)',
            padding: '4px 8px',
            background: 'var(--forge-canvas)',
            borderRadius: 3,
          }}>
            status: {String(status)}
          </span>
        )}
      </div>
    </section>
  );
}

function InterferenceSection({ onRun, modal, onCloseModal }) {
  return (
    <section style={SECTION}>
      <h4 style={SECTION_HEAD}>Interference</h4>
      <button type="button"
              onClick={onRun}
              data-testid="forge-assembly-interference-btn"
              style={BTN}>
        Detect interference
      </button>
      {modal && (
        <div data-testid="forge-assembly-interference-modal"
             style={{
               position: 'fixed', inset: 0,
               background: 'var(--forge-overlay)',
               display: 'flex', alignItems: 'center', justifyContent: 'center',
               zIndex: 1320,
             }}
             onClick={onCloseModal}>
          <div onClick={(e) => e.stopPropagation()}
               style={{
                 width: 420,
                 maxHeight: '70vh',
                 background: 'var(--forge-canvas-3)',
                 border: '1px solid var(--forge-rail-edge)',
                 borderRadius: 'var(--forge-radius-lg)',
                 boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
                 display: 'flex', flexDirection: 'column',
               }}>
            <header style={{
              padding: '8px 12px',
              borderBottom: '1px solid var(--forge-rail-edge)',
              display: 'flex', alignItems: 'center',
              fontSize: 12, fontWeight: 600,
            }}>
              <span>Interference report</span>
              <span style={{ flex: 1 }} />
              <button type="button"
                      onClick={onCloseModal}
                      aria-label="Close report"
                      style={{
                        background: 'transparent', border: 'none',
                        color: 'var(--forge-ink-mute)', cursor: 'pointer',
                      }}>
                <Icon name="select.clear" size={12} />
              </button>
            </header>
            <div style={{
              padding: 12,
              overflowY: 'auto',
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              {modal.error && (
                <div style={{ color: 'var(--forge-warn)', fontSize: 11 }}>
                  {modal.error}
                </div>
              )}
              {(!modal.pairs || modal.pairs.length === 0) ? (
                <div style={{ color: 'var(--forge-ink-mute)', fontStyle: 'italic' }}>
                  No interferences detected.
                </div>
              ) : (
                modal.pairs.map((p, i) => {
                  const sev = Math.min(1, Math.max(0, p.severity ?? p.volume ?? 0));
                  return (
                    <div key={i} style={{
                      padding: '6px 8px',
                      background: 'var(--forge-surface)',
                      borderRadius: 3,
                      border: '1px solid var(--forge-rail-edge)',
                    }}>
                      <div style={{ display: 'flex',
                                    fontFamily: 'var(--forge-mono)',
                                    fontSize: 11 }}>
                        <span>#{p.a ?? p[0]} ↔ #{p.b ?? p[1]}</span>
                        <span style={{ flex: 1 }} />
                        <span style={{ color: 'var(--forge-ink-mute)' }}>
                          {(sev * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div style={{
                        marginTop: 4, height: 4,
                        background: 'var(--forge-canvas)',
                        borderRadius: 2, overflow: 'hidden',
                      }}>
                        <div style={{
                          width: `${sev * 100}%`,
                          height: '100%',
                          background: sev > 0.5 ? 'var(--forge-err)'
                                    : sev > 0.2 ? 'var(--forge-warn)'
                                    : 'var(--forge-accent)',
                        }} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function MotionStudy({ mates, bodies }) {
  const [mateId, setMateId] = useState('');
  const [axis, setAxis] = useState([0, 0, 1]);
  const [totalDeg, setTotalDeg] = useState(360);
  const [steps, setSteps] = useState(24);
  const [frames, setFrames] = useState(null);
  const [frameIdx, setFrameIdx] = useState(0);

  useEffect(() => {
    if (!frames || !frames.length) return;
    // Drive the kernel transform for the current frame's instance.
    const frame = frames[frameIdx];
    if (!frame || !window.forge?.updateTransform) return;
    try {
      if (Array.isArray(frame.instances)) {
        for (const it of frame.instances) {
          if (it.inst != null && it.transform) {
            window.forge.updateTransform(it.inst, it.transform);
          }
        }
      }
    } catch { /* swallow — kernel may be offline */ }
  }, [frames, frameIdx]);

  function handleRun() {
    if (!mateId) return;
    const rad = (parseFloat(totalDeg) || 0) * Math.PI / 180;
    const r = runMotion(mateId, axis, rad, parseInt(steps, 10) || 24);
    if (r.ok) {
      setFrames(r.frames);
      setFrameIdx(0);
    } else {
      setFrames([]);
    }
  }

  function setAxisAt(i, v) {
    const next = [...axis];
    next[i] = parseFloat(v) || 0;
    setAxis(next);
  }

  return (
    <section style={SECTION} data-testid="forge-assembly-motion-study">
      <h4 style={SECTION_HEAD}>Motion study</h4>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <label style={{ fontSize: 10, color: 'var(--forge-ink-mute)' }}>
          Driver mate
        </label>
        <select value={mateId}
                onChange={(e) => setMateId(e.target.value)}
                data-testid="forge-assembly-motion-mate"
                style={INPUT}>
          <option value="">— choose mate —</option>
          {mates.map((m) => (
            <option key={m.id} value={m.id}>
              {m.kind} #{m.a?.inst}↔#{m.b?.inst}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <label style={{ fontSize: 10, color: 'var(--forge-ink-mute)' }}>
          Axis
        </label>
        <div style={{ display: 'flex', gap: 3 }}>
          {['x','y','z'].map((ax, i) => (
            <input key={ax}
                   type="number"
                   step="0.1"
                   value={axis[i]}
                   onChange={(e) => setAxisAt(i, e.target.value)}
                   aria-label={`Axis ${ax}`}
                   data-testid={`forge-assembly-motion-axis-${ax}`}
                   style={{ ...INPUT, textAlign: 'center' }} />
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={{ fontSize: 10, color: 'var(--forge-ink-mute)' }}>
            Total angle (deg)
          </label>
          <input type="number"
                 step="1"
                 value={totalDeg}
                 onChange={(e) => setTotalDeg(e.target.value)}
                 data-testid="forge-assembly-motion-angle"
                 style={INPUT} />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={{ fontSize: 10, color: 'var(--forge-ink-mute)' }}>
            Steps
          </label>
          <input type="number"
                 step="1"
                 min="2"
                 max="360"
                 value={steps}
                 onChange={(e) => setSteps(e.target.value)}
                 data-testid="forge-assembly-motion-steps"
                 style={INPUT} />
        </div>
      </div>

      <button type="button"
              onClick={handleRun}
              disabled={!mateId}
              data-testid="forge-assembly-motion-run"
              style={{ ...BTN_CONFIRM, opacity: mateId ? 1 : 0.4,
                       cursor: mateId ? 'pointer' : 'not-allowed' }}>
        Run motion study
      </button>

      {frames && frames.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 10, color: 'var(--forge-ink-mute)' }}>
            Frame {frameIdx + 1} / {frames.length}
          </label>
          <input type="range"
                 min={0}
                 max={Math.max(0, frames.length - 1)}
                 value={frameIdx}
                 onChange={(e) => setFrameIdx(parseInt(e.target.value, 10))}
                 data-testid="forge-assembly-motion-slider"
                 style={{ width: '100%' }} />
        </div>
      )}
      {frames && frames.length === 0 && (
        <div style={{ color: 'var(--forge-ink-mute)', fontSize: 11,
                      fontStyle: 'italic' }}>
          Kernel returned no frames — verify the mate is solvable.
        </div>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// Forge-129 — Auto-mounting host. App.jsx mounts <AssemblyPanelHost />
// once. The shell wires the Tools > Assembly menu action by calling
// window.__forgeOpenAssembly(true). Manual UI clicks never write to the
// Archie thread.

export function AssemblyPanelHost() {
  const [open, setOpen] = useState(false);
  const [bodies, setBodies] = useState(() =>
    (typeof window !== 'undefined' && Array.isArray(window.__forgeBodies))
      ? window.__forgeBodies
      : [
          // Fallback synthetic instances so the panel is useful even
          // before any feature has been extruded.
          { inst: 1, name: 'Bracket', handle: 1 },
          { inst: 2, name: 'Plate',   handle: 2 },
          { inst: 3, name: 'Pin',     handle: 3 },
        ]);
  const [selection, setSelection] = useState(null);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenAssembly = (v) => {
      if (Array.isArray(window.__forgeBodies) && window.__forgeBodies.length) {
        setBodies(window.__forgeBodies);
      }
      setOpen(v === undefined ? true : !!v);
    };
    window.__forgeCloseAssembly = () => setOpen(false);
    return () => {
      try { delete window.__forgeOpenAssembly; } catch {}
      try { delete window.__forgeCloseAssembly; } catch {}
    };
  }, []);

  if (typeof document === 'undefined') return null;
  if (!open) return null;

  // Portal — sit above the shell zones so the panel works even when
  // ForgeShellV4 hasn't been told about it.
  return createPortal(
    <AssemblyPanel
      open={open}
      onClose={() => setOpen(false)}
      bodies={bodies}
      selection={selection}
      onSelect={setSelection}
      onSolveResult={(r) => { window.__lastSolve = r; }} />,
    document.body,
  );
}

export default AssemblyPanel;
