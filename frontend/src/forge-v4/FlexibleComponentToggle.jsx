// Forge-129 — flexible-component flag.
//
// Per-component toggle that the AssemblyTreePanel renders next to each
// instance row, and that the AssemblyPanel surfaces as a section under
// the DOF summary. A flexible component is one whose feature tree
// stays unlocked when the parent assembly is mated — the body still
// participates in the assembly graph, but its internal sketch dimensions
// remain driveable from equations / Archie / the dimension manipulator.
//
// The state lives in localStorage under `forge.v4.flexibleInstances` so
// it survives reloads. The implementation publishes the flag set on
// `window.__forgeFlexible` so kernelDispatch / the regen pass can read
// it without an import cycle.

import React, { useCallback, useEffect, useState } from 'react';

const LS_KEY = 'forge.v4.flexibleInstances';

// ─────────────────────────────────────────────────────────────────────
// Pure store.

let _set = loadSet();

function loadSet() {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map((n) => +n) : []);
  } catch {
    return new Set();
  }
}

function saveSet(s) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(Array.from(s))); }
  catch {}
}

function publish() {
  if (typeof window === 'undefined') return;
  window.__forgeFlexible = new Set(_set);
  try {
    window.dispatchEvent(new CustomEvent('forge:flexible-changed',
      { detail: { instances: Array.from(_set) } }));
  } catch {}
}
publish();

export function isFlexible(inst) {
  return _set.has(+inst);
}

export function setFlexible(inst, on) {
  const n = +inst;
  if (!Number.isFinite(n)) return;
  if (on) _set.add(n);
  else _set.delete(n);
  saveSet(_set);
  publish();
}

export function listFlexible() {
  return Array.from(_set);
}

export function clearFlexible() {
  _set = new Set();
  saveSet(_set);
  publish();
}

// Hook for components that want to re-render on toggle changes.
export function useFlexible(inst) {
  const [flag, setFlag] = useState(() => isFlexible(inst));
  useEffect(() => {
    const onChange = () => setFlag(isFlexible(inst));
    if (typeof window === 'undefined') return undefined;
    window.addEventListener('forge:flexible-changed', onChange);
    return () => window.removeEventListener('forge:flexible-changed', onChange);
  }, [inst]);
  return [flag, useCallback((v) => setFlexible(inst, v), [inst])];
}

// ─────────────────────────────────────────────────────────────────────
// React component. Two variants:
//
//  - <FlexibleComponentToggle inst={n} /> — single-row checkbox+label,
//    intended for the AssemblyTreePanel.
//  - <FlexibleComponentSection bodies={…} /> — list of toggles for every
//    instance, intended for the AssemblyPanel's DOF section.

export function FlexibleComponentToggle({ inst, name, compact = false }) {
  const [flag, setFlag] = useFlexible(inst);
  return (
    <label
      data-testid="forge-flex-toggle"
      data-inst={inst}
      data-flexible={String(flag)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: compact ? 9 : 10,
        color: flag ? 'var(--forge-accent)' : 'var(--forge-ink-mute)',
        cursor: 'pointer',
        padding: '1px 4px',
        borderRadius: 2,
        border: `1px solid ${flag ? 'var(--forge-accent-rim)' : 'transparent'}`,
      }}
      title={flag
        ? 'Flexible — internal sketch dims stay driveable when mated'
        : 'Rigid — feature tree locks on first assembly mate'}
      onClick={(e) => e.stopPropagation()}>
      <input type="checkbox"
             checked={flag}
             onChange={(e) => setFlag(e.target.checked)}
             aria-label={`Flexible component ${name || inst}`}
             data-testid={`forge-flex-toggle-input-${inst}`} />
      flex
    </label>
  );
}

export function FlexibleComponentSection({ bodies = [] }) {
  // Re-render when any flag changes anywhere.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onChange = () => setTick((t) => t + 1);
    window.addEventListener('forge:flexible-changed', onChange);
    return () => window.removeEventListener('forge:flexible-changed', onChange);
  }, []);

  if (!bodies?.length) return null;

  return (
    <section
      data-testid="forge-flex-section"
      data-flexible-count={listFlexible().length}
      style={{
        display: 'flex', flexDirection: 'column', gap: 4,
        padding: 'var(--forge-space-3)',
        background: 'var(--forge-surface)',
        border: '1px solid var(--forge-rail-edge)',
        borderRadius: 'var(--forge-radius)',
      }}>
      <h4 style={{
        margin: '0 0 4px',
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'var(--forge-ink-mute)',
      }}>
        Flexible components ({listFlexible().length} / {bodies.length})
      </h4>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0,
                   display: 'flex', flexDirection: 'column', gap: 2 }}>
        {bodies.map((b, i) => {
          const inst = b.inst != null ? b.inst : i;
          return (
            <li key={inst}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontFamily: 'var(--forge-mono)', fontSize: 11,
                  color: 'var(--forge-ink)',
                }}>
              <span style={{ flex: 1, overflow: 'hidden',
                             textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {b.name || `inst#${inst}`}
              </span>
              <FlexibleComponentToggle inst={inst} name={b.name} />
            </li>
          );
        })}
      </ul>
      <p style={{ margin: '4px 0 0', fontSize: 10,
                  color: 'var(--forge-ink-mute)', fontStyle: 'italic' }}>
        Flexible components do not lock their feature tree on assembly
        mate; internal sketch dims can still be driven.
      </p>
    </section>
  );
}

export default FlexibleComponentToggle;
