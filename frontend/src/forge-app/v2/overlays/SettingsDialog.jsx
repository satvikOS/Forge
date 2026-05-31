/**
 * SettingsDialog — categorised preferences modal.
 *
 * Sidebar of categories on the left, form on the right. Every form
 * field persists per category under `forge.settings.<category>.<key>`.
 * Apply / Cancel sticky at the bottom; success toast on save.
 */

import React, { useState, useEffect } from 'react';
import { Modal } from '../../design-system/primitives/Modal.jsx';
import { Button } from '../../design-system/primitives/Button.jsx';
import { Field } from '../../design-system/primitives/Field.jsx';
import { Input } from '../../design-system/primitives/Input.jsx';
import { NumberInput } from '../../design-system/primitives/NumberInput.jsx';
import { Switch } from '../../design-system/primitives/Switch.jsx';
import { SegmentedControl } from '../../design-system/primitives/Tabs.jsx';
import { Stack, Inline, Divider } from '../../design-system/primitives/Card.jsx';
import { Icon } from '../../design-system/icons/Icon.jsx';
import { useToast } from '../../design-system/primitives/Toast.jsx';

const CATEGORIES = [
  { id: 'general',     label: 'General',          icon: 'settings' },
  { id: 'appearance',  label: 'Appearance',       icon: 'eye' },
  { id: 'units',       label: 'Units',            icon: 'partTab' },
  { id: 'performance', label: 'Performance',      icon: 'fastForward' },
  { id: 'shortcuts',   label: 'Shortcuts',        icon: 'command' },
  { id: 'archie',      label: 'AI / Archie',      icon: 'archie' },
  { id: 'storage',     label: 'Storage',          icon: 'fileSave' },
  { id: 'privacy',     label: 'Privacy',          icon: 'lock' },
  { id: 'about',       label: 'About',            icon: 'info' },
];

function loadCategory(category, defaults) {
  if (typeof localStorage === 'undefined') return defaults;
  try {
    const raw = localStorage.getItem(`forge.settings.${category}`);
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  } catch { return defaults; }
}

function saveCategory(category, value) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(`forge.settings.${category}`, JSON.stringify(value)); } catch { /* quota */ }
}

export function SettingsDialog({ open, onClose, theme, onThemeChange }) {
  const [active, setActive] = useState('general');
  const { push } = useToast();

  return (
    <Modal open={open} onClose={onClose} size="xl" title="Settings"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', minHeight: '60vh' }}>
        {/* SIDEBAR */}
        <aside role="navigation" aria-label="Settings categories" style={{
          borderRight: '1px solid var(--border-subtle)',
          paddingRight: 'var(--space-5)',
        }}>
          {CATEGORIES.map((c) => {
            const selected = c.id === active;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setActive(c.id)}
                aria-current={selected ? 'page' : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                  width: '100%',
                  padding: 'var(--space-4) var(--space-5)',
                  background: selected ? 'var(--surface-selected)' : 'transparent',
                  color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
                  border: 'none', borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--text-sm)', cursor: 'pointer',
                  textAlign: 'left',
                  marginBottom: 'var(--space-1)',
                }}
              >
                <Icon name={c.icon} size={14} />
                {c.label}
              </button>
            );
          })}
        </aside>

        {/* FORM */}
        <main style={{ paddingLeft: 'var(--space-9)', overflowY: 'auto', minWidth: 0 }}>
          {active === 'general'     && <GeneralForm push={push} />}
          {active === 'appearance'  && <AppearanceForm theme={theme} onThemeChange={onThemeChange} push={push} />}
          {active === 'units'       && <UnitsForm push={push} />}
          {active === 'performance' && <PerformanceForm push={push} />}
          {active === 'shortcuts'   && <ShortcutsForm push={push} />}
          {active === 'archie'      && <ArchieForm push={push} />}
          {active === 'storage'     && <StorageForm push={push} />}
          {active === 'privacy'     && <PrivacyForm push={push} />}
          {active === 'about'       && <AboutPanel />}
        </main>
      </div>
    </Modal>
  );
}

function category(name, defaults, render) {
  return function Form({ push }) {
    const [v, setV] = useState(() => loadCategory(name, defaults));
    const set = (patch) => setV((cur) => ({ ...cur, ...patch }));
    const save = () => {
      saveCategory(name, v);
      push?.({ title: 'Settings saved', tone: 'success', duration: 1800 });
    };
    return (
      <Stack gap="var(--space-7)">
        {render(v, set)}
        <Divider />
        <Inline justify="flex-end" gap="var(--space-5)">
          <Button variant="primary" onClick={save}>Save changes</Button>
        </Inline>
      </Stack>
    );
  };
}

const GeneralForm = category('general',
  { language: 'en', autosaveSec: 300, recentCount: 12 },
  (v, set) => <>
    <Field label="Language"><Input value={v.language} onChange={(e) => set({ language: e.target.value })} /></Field>
    <Field label="Autosave interval"><NumberInput value={v.autosaveSec} onChange={(n) => set({ autosaveSec: n })} unit="s" step={30} /></Field>
    <Field label="Recent projects to keep"><NumberInput value={v.recentCount} onChange={(n) => set({ recentCount: n })} step={1} /></Field>
  </>);

function AppearanceForm({ theme, onThemeChange, push }) {
  const [v, setV] = useState(() => loadCategory('appearance', { fontSize: 14, gridVisible: true, accent: 'copper' }));
  const set = (patch) => setV((cur) => ({ ...cur, ...patch }));
  const save = () => {
    saveCategory('appearance', v);
    push?.({ title: 'Appearance saved', tone: 'success', duration: 1800 });
  };
  return (
    <Stack gap="var(--space-7)">
      <Field label="Theme">
        <SegmentedControl
          items={[
            { value: 'dark', label: 'Dark', icon: <Icon name="moon" size={12} /> },
            { value: 'light', label: 'Light', icon: <Icon name="sun" size={12} /> },
            { value: 'contrast', label: 'Contrast', icon: <Icon name="monitor" size={12} /> },
          ]}
          value={theme}
          onChange={onThemeChange}
        />
      </Field>
      <Field label="UI font size"><NumberInput value={v.fontSize} onChange={(n) => set({ fontSize: n })} step={1} unit="px" /></Field>
      <Field label="Show grid in viewport" layout="inline"><Switch checked={v.gridVisible} onChange={(c) => set({ gridVisible: c })} /></Field>
      <Divider />
      <Inline justify="flex-end"><Button variant="primary" onClick={save}>Save changes</Button></Inline>
    </Stack>
  );
}

const UnitsForm = category('units',
  { length: 'mm', angle: 'deg', stress: 'MPa', temperature: 'C' },
  (v, set) => <>
    <Field label="Length"><SegmentedControl
      items={[{value:'mm',label:'mm'},{value:'in',label:'in'},{value:'ft',label:'ft'}]}
      value={v.length} onChange={(u) => set({ length: u })} /></Field>
    <Field label="Angle"><SegmentedControl
      items={[{value:'deg',label:'deg'},{value:'rad',label:'rad'}]}
      value={v.angle} onChange={(u) => set({ angle: u })} /></Field>
    <Field label="Stress"><SegmentedControl
      items={[{value:'MPa',label:'MPa'},{value:'psi',label:'psi'},{value:'kPa',label:'kPa'}]}
      value={v.stress} onChange={(u) => set({ stress: u })} /></Field>
    <Field label="Temperature"><SegmentedControl
      items={[{value:'C',label:'°C'},{value:'F',label:'°F'},{value:'K',label:'K'}]}
      value={v.temperature} onChange={(u) => set({ temperature: u })} /></Field>
  </>);

const PerformanceForm = category('performance',
  { lodBias: 1.0, bvhRebuildMs: 100, workerPool: 13, fpsTarget: 60 },
  (v, set) => <>
    <Field label="LOD bias"   helperText="Higher = lower-res meshes used sooner"><NumberInput value={v.lodBias} step={0.1} onChange={(n) => set({ lodBias: n })} /></Field>
    <Field label="BVH rebuild interval"><NumberInput value={v.bvhRebuildMs} step={50} unit="ms" onChange={(n) => set({ bvhRebuildMs: n })} /></Field>
    <Field label="Worker pool cap"><NumberInput value={v.workerPool} step={1} onChange={(n) => set({ workerPool: n })} /></Field>
    <Field label="FPS target"><NumberInput value={v.fpsTarget} step={5} onChange={(n) => set({ fpsTarget: n })} /></Field>
  </>);

function ShortcutsForm({ push }) {
  return (
    <Stack gap="var(--space-5)">
      <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
        Press a key combination on any row to rebind. Defaults restore via the Reset button.
      </p>
      {[
        ['Save', 'Cmd S'], ['Undo', 'Cmd Z'], ['Redo', 'Cmd Shift Z'],
        ['Command palette', 'Cmd K'], ['Frame all', 'F'], ['Delete', 'Delete'],
        ['Sketch', 'S'], ['Extrude', 'E'], ['Fillet', 'F'], ['Smart dimension', 'D'],
      ].map(([cmd, keys]) => (
        <Inline key={cmd} justify="space-between" align="center" style={{ padding: 'var(--space-3) var(--space-5)', borderBottom: '1px solid var(--border-subtle)' }}>
          <span style={{ fontSize: 'var(--text-sm)' }}>{cmd}</span>
          <kbd style={{
            fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
            padding: '2px var(--space-3)', background: 'var(--surface-app)',
            border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)',
            color: 'var(--text-secondary)',
          }}>{keys}</kbd>
        </Inline>
      ))}
    </Stack>
  );
}

const ArchieForm = category('archie',
  { baseUrl: 'http://localhost:8080', model: 'archie-7b-base', temperature: 0.2, maxTurns: 8, autoDefaultClarify: false, showThink: false },
  (v, set) => <>
    <Field label="Endpoint" helperText="Local mlx_lm.server URL"><Input value={v.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} /></Field>
    <Field label="Model"><Input value={v.model} onChange={(e) => set({ model: e.target.value })} /></Field>
    <Field label="Temperature"><NumberInput value={v.temperature} step={0.05} precision={2} onChange={(n) => set({ temperature: n })} /></Field>
    <Field label="Max turns"><NumberInput value={v.maxTurns} step={1} onChange={(n) => set({ maxTurns: n })} /></Field>
    <Field label="Auto-default Clarify prompts" layout="inline"><Switch checked={v.autoDefaultClarify} onChange={(c) => set({ autoDefaultClarify: c })} /></Field>
    <Field label="Show <think> blocks by default" layout="inline"><Switch checked={v.showThink} onChange={(c) => set({ showThink: c })} /></Field>
  </>);

const StorageForm = category('storage',
  { backend: 'filesystem', rootPath: '~/Forge Projects' },
  (v, set) => <>
    <Field label="Backend">
      <SegmentedControl items={[{value:'filesystem',label:'Filesystem'},{value:'git-lfs',label:'Git LFS'},{value:'s3',label:'S3 (stub)'}]}
        value={v.backend} onChange={(b) => set({ backend: b })} />
    </Field>
    <Field label="Root path"><Input value={v.rootPath} onChange={(e) => set({ rootPath: e.target.value })} /></Field>
  </>);

const PrivacyForm = category('privacy',
  { telemetry: false, errorReports: false, sharePromptsWithArchie: false },
  (v, set) => <>
    <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
      All Forge AI runs locally. Nothing leaves your machine unless you opt in.
    </p>
    <Field label="Anonymous usage telemetry" layout="inline"><Switch checked={v.telemetry} onChange={(c) => set({ telemetry: c })} /></Field>
    <Field label="Send crash reports" layout="inline"><Switch checked={v.errorReports} onChange={(c) => set({ errorReports: c })} /></Field>
    <Field label="Share prompts with Archie team to improve training" layout="inline"><Switch checked={v.sharePromptsWithArchie} onChange={(c) => set({ sharePromptsWithArchie: c })} /></Field>
  </>);

function AboutPanel() {
  const v = typeof window !== 'undefined' && window.forge?.version?.();
  return (
    <Stack gap="var(--space-7)">
      <Inline gap="var(--space-7)" align="center">
        <span style={{
          width: 56, height: 56, borderRadius: 'var(--radius-md)',
          background: 'var(--accent-bg)', color: 'var(--accent-text)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-3xl)',
        }}>F</span>
        <div>
          <div style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)' }}>
            Forge <span style={{ color: 'var(--text-tertiary)' }}>v2</span>
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Native MCAD on OCCT, driven by local Archie</div>
        </div>
      </Inline>
      <table style={{ width: '100%', fontSize: 'var(--text-sm)', borderCollapse: 'collapse' }}>
        <tbody>
          <Row k="Kernel"   v={`forge-kernel.node ${v?.forgeKernel || '—'}`} />
          <Row k="OCCT"     v={v?.occt || '—'} />
          <Row k="N-API"    v={v?.napiCpp || '—'} />
          <Row k="Eigen"    v="3.4 (MPL 2.0)" />
          <Row k="Boost"    v="1.85 (BSL)" />
          <Row k="planegcs" v="vendored from FreeCAD (LGPL 2.1)" />
        </tbody>
      </table>
    </Stack>
  );
}

function Row({ k, v }) {
  return (
    <tr style={{ borderTop: '1px solid var(--border-subtle)' }}>
      <td style={{ padding: 'var(--space-3) var(--space-5)', color: 'var(--text-secondary)' }}>{k}</td>
      <td style={{ padding: 'var(--space-3) var(--space-5)', fontFamily: 'var(--font-mono)' }}>{v}</td>
    </tr>
  );
}
