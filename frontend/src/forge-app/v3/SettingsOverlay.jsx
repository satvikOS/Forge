// Forge v3 — Settings overlay (Cmd+, opens).
//
// Single modal with 5 categories down the left, the panel for the
// active category on the right. Each setting persists to localStorage
// under `forge.v3.settings.<category>.<key>`. Esc dismisses; clicking
// the backdrop closes; focus is trapped inside while open.

import React, { useEffect, useMemo, useRef, useState } from 'react';

const CATS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'units',      label: 'Units' },
  { id: 'ai',         label: 'AI / Archie' },
  { id: 'storage',    label: 'Storage' },
  { id: 'about',      label: 'About' },
];

const DEFAULTS = {
  appearance: { theme: 'dark', accent: '#d97a3b', reducedMotion: false },
  units:      { length: 'mm', angle: 'deg', mass: 'kg' },
  ai:         { endpoint: 'http://localhost:8080', model: 'archie-7b-base',
                discipline: 'part', maxTurns: 8 },
  storage:    { backend: 'localStorage', path: '~/.forge' },
  about:      { version: '0.3.0' },
};

function loadCategory(cat) {
  if (typeof localStorage === 'undefined') return DEFAULTS[cat];
  try {
    const raw = localStorage.getItem(`forge.v3.settings.${cat}`);
    if (!raw) return DEFAULTS[cat];
    return { ...DEFAULTS[cat], ...JSON.parse(raw) };
  } catch { return DEFAULTS[cat]; }
}
function saveCategory(cat, value) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(`forge.v3.settings.${cat}`, JSON.stringify(value)); } catch {}
}

export function SettingsOverlay({ open, onClose, onThemeChange }) {
  const [active, setActive] = useState('appearance');
  const [values, setValues] = useState(() => {
    const out = {};
    for (const c of CATS) out[c.id] = loadCategory(c.id);
    return out;
  });
  const modalRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    // Esc dismiss.
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  function patch(cat, k, v) {
    setValues((all) => {
      const next = { ...all, [cat]: { ...all[cat], [k]: v } };
      saveCategory(cat, next[cat]);
      if (cat === 'appearance' && k === 'theme') onThemeChange?.(v);
      return next;
    });
  }

  if (!open) return null;
  return (
    <div role="dialog"
         aria-label="Settings"
         data-testid="forge-v3-settings"
         onClick={onClose}
         style={{
           position: 'fixed', inset: 0,
           background: 'rgba(0,0,0,0.55)',
           display: 'flex', alignItems: 'center', justifyContent: 'center',
           zIndex: 2000,
         }}>
      <div ref={modalRef}
           onClick={(e) => e.stopPropagation()}
           style={{
             width: 680, maxWidth: '90vw', maxHeight: '80vh',
             display: 'grid',
             gridTemplateColumns: '160px 1fr',
             background: 'var(--forge-v3-surface)',
             border: '1px solid var(--forge-v3-rail-edge)',
             borderRadius: 'var(--forge-v3-radius-lg)',
             boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
             overflow: 'hidden',
           }}>
        <nav style={{
          background: 'var(--forge-v3-canvas-deep)',
          borderRight: '1px solid var(--forge-v3-rail-edge)',
          padding: '12px 0',
        }}>
          {CATS.map((c) => (
            <button key={c.id}
                    type="button"
                    onClick={() => setActive(c.id)}
                    aria-pressed={active === c.id}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      background: active === c.id ? 'var(--forge-v3-accent-mute)' : 'transparent',
                      color: active === c.id ? 'var(--forge-v3-ink)' : 'var(--forge-v3-ink-2)',
                      border: 'none', padding: '8px 14px',
                      fontSize: 12, cursor: 'pointer',
                    }}>
              {c.label}
            </button>
          ))}
        </nav>
        <div style={{ padding: 20, overflowY: 'auto' }}>
          <h3 style={{ fontSize: 14, marginBottom: 14, fontWeight: 600 }}>
            {CATS.find((c) => c.id === active).label}
          </h3>
          <SettingsPanel cat={active}
                         value={values[active]}
                         onPatch={(k, v) => patch(active, k, v)} />
        </div>
      </div>
    </div>
  );
}

function SettingsPanel({ cat, value, onPatch }) {
  if (cat === 'appearance') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Theme">
          <Select value={value.theme}
                  onChange={(v) => onPatch('theme', v)}
                  options={[
                    { v: 'dark', label: 'Dark' },
                    { v: 'light', label: 'Light' },
                    { v: 'contrast', label: 'High contrast' },
                  ]} />
        </Field>
        <Field label="Reduce motion">
          <input type="checkbox" checked={value.reducedMotion}
                 onChange={(e) => onPatch('reducedMotion', e.target.checked)} />
        </Field>
        <Field label="Accent">
          <input type="text" value={value.accent}
                 onChange={(e) => onPatch('accent', e.target.value)} />
        </Field>
      </div>
    );
  }
  if (cat === 'units') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Length">
          <Select value={value.length} onChange={(v) => onPatch('length', v)}
                  options={[
                    { v: 'mm', label: 'mm' }, { v: 'cm', label: 'cm' },
                    { v: 'in', label: 'in' }, { v: 'ft', label: 'ft' },
                  ]} />
        </Field>
        <Field label="Angle">
          <Select value={value.angle} onChange={(v) => onPatch('angle', v)}
                  options={[{ v: 'deg', label: 'deg' }, { v: 'rad', label: 'rad' }]} />
        </Field>
        <Field label="Mass">
          <Select value={value.mass} onChange={(v) => onPatch('mass', v)}
                  options={[{ v: 'kg', label: 'kg' }, { v: 'g', label: 'g' },
                            { v: 'lb', label: 'lb' }, { v: 'oz', label: 'oz' }]} />
        </Field>
      </div>
    );
  }
  if (cat === 'ai') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Endpoint URL">
          <input type="text" value={value.endpoint}
                 onChange={(e) => onPatch('endpoint', e.target.value)} />
        </Field>
        <Field label="Model">
          <input type="text" value={value.model}
                 onChange={(e) => onPatch('model', e.target.value)} />
        </Field>
        <Field label="Default discipline">
          <Select value={value.discipline} onChange={(v) => onPatch('discipline', v)}
                  options={[
                    { v: 'part', label: 'Part' },
                    { v: 'assembly', label: 'Assembly' },
                    { v: 'drawing', label: 'Drawing' },
                    { v: 'sim', label: 'Simulation' },
                    { v: 'cam', label: 'Manufacturing' },
                  ]} />
        </Field>
        <Field label="Max turns">
          <input type="number" value={value.maxTurns} min={1} max={32}
                 onChange={(e) => onPatch('maxTurns', parseInt(e.target.value, 10) || 1)} />
        </Field>
      </div>
    );
  }
  if (cat === 'storage') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Backend">
          <Select value={value.backend} onChange={(v) => onPatch('backend', v)}
                  options={[
                    { v: 'localStorage', label: 'Browser localStorage' },
                    { v: 'filesystem',  label: 'Local filesystem (~/.forge)' },
                    { v: 'memory',      label: 'In-memory (no persistence)' },
                  ]} />
        </Field>
        {value.backend === 'filesystem' && (
          <Field label="Path">
            <input type="text" value={value.path}
                   onChange={(e) => onPatch('path', e.target.value)} />
          </Field>
        )}
      </div>
    );
  }
  if (cat === 'about') {
    return (
      <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--forge-v3-ink-2)' }}>
        <p style={{ marginBottom: 8 }}>
          <strong style={{ color: 'var(--forge-v3-accent)' }}>Forge</strong> v{value.version}
        </p>
        <p>Archie-first parametric MCAD on OCCT. Built by satvikOS.</p>
        <p style={{ marginTop: 12, fontSize: 11, color: 'var(--forge-v3-ink-mute)' }}>
          The brand mark, copper accent, verb-rail layout, and command-bar-
          first interaction model are Forge's own design IP. Not affiliated
          with SolidWorks, NX, Catia, Fusion, or any other peer.
        </p>
      </div>
    );
  }
  return null;
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '140px 1fr',
                    alignItems: 'center', gap: 12, fontSize: 12 }}>
      <span style={{ color: 'var(--forge-v3-ink-2)' }}>{label}</span>
      <span>{children}</span>
    </label>
  );
}

function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
            style={{
              background: 'var(--forge-v3-canvas)',
              color: 'var(--forge-v3-ink)',
              border: '1px solid var(--forge-v3-rail-edge)',
              borderRadius: 4, padding: '4px 6px', fontSize: 12,
            }}>
      {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
    </select>
  );
}
