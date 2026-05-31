/**
 * Showcase — every Forge design-system primitive on one page, with a theme
 * switcher. The visual regression baseline. Mount at `#forge/design-showcase`.
 */

import React, { useEffect, useState } from 'react';
import './tokens.css';
import { Icon, ICON_NAMES } from './icons/Icon.jsx';
import { Button, IconButton } from './primitives/Button.jsx';
import { Input } from './primitives/Input.jsx';
import { NumberInput } from './primitives/NumberInput.jsx';
import { Switch, Checkbox } from './primitives/Switch.jsx';
import { Field } from './primitives/Field.jsx';
import { CollapsibleSection } from './primitives/CollapsibleSection.jsx';
import { EmptyState } from './primitives/EmptyState.jsx';
import { KeyHint } from './primitives/KeyHint.jsx';
import { Spinner, ProgressBar } from './primitives/Spinner.jsx';
import { Modal, Tooltip } from './primitives/Modal.jsx';
import { ToastProvider, ToastHost, useToast } from './primitives/Toast.jsx';
import { Tabs, SegmentedControl } from './primitives/Tabs.jsx';
import { Card, Stack, Inline, Divider } from './primitives/Card.jsx';
import { Tree } from './primitives/Tree.jsx';

function ToastDemo() {
  const { push } = useToast();
  return (
    <Inline gap="var(--space-5)" wrap>
      <Button variant="ghost" onClick={() => push({ title: 'Saved', description: 'Bracket-v3.forge', tone: 'success' })}>Success</Button>
      <Button variant="ghost" onClick={() => push({ title: 'Heads up', description: 'Mesh too coarse', tone: 'warning' })}>Warning</Button>
      <Button variant="ghost" onClick={() => push({ title: 'Failed', description: 'OCCT: BRepBuilderAPI_DisconnectedWire', tone: 'danger' })}>Danger</Button>
      <Button variant="ghost" onClick={() => push({ title: 'Heads up', description: 'Archie is running locally', tone: 'info' })}>Info</Button>
    </Inline>
  );
}

const TREE_NODES = [
  { id: 'material', label: 'Steel (1018)', icon: <Icon name="settings" size={12} /> },
  { id: 'planes',   label: 'Default Planes', children: [
    { id: 'p1', label: 'Front Plane (XY)' },
    { id: 'p2', label: 'Top Plane (XZ)' },
    { id: 'p3', label: 'Right Plane (YZ)' },
  ]},
  { id: 'origin', label: 'Origin' },
  { id: 'box1',   label: 'Boss-Extrude1', icon: <Icon name="extrude" size={12} />, badge: 'Ø50×20' },
  { id: 'fillet', label: 'Fillet1', icon: <Icon name="fillet" size={12} />, status: 'warning' },
  { id: 'hole',   label: 'Hole-Wizard1', icon: <Icon name="hole" size={12} />, suppressed: true },
];

export function Showcase() {
  const [theme, setTheme] = useState('dark');
  const [openModal, setOpenModal] = useState(false);
  const [number, setNumber] = useState(25);
  const [boolSwitch, setBoolSwitch] = useState(true);
  const [boolCheck, setBoolCheck] = useState(false);
  const [seg, setSeg] = useState('mm');
  const [tab, setTab] = useState('sketch');
  const [selectedTree, setSelectedTree] = useState(['box1']);

  useEffect(() => {
    document.documentElement.dataset.forgeTheme = theme;
  }, [theme]);

  return (
    <ToastProvider>
      <div className="forge-root" style={{
        minHeight: '100vh', background: 'var(--surface-app)', color: 'var(--text-primary)',
        padding: 'var(--space-11)',
      }}>
        <header style={{ marginBottom: 'var(--space-12)' }}>
          <h1 style={{ margin: 0, fontSize: 'var(--text-3xl)', fontWeight: 'var(--weight-bold)' }}>
            <span style={{ color: 'var(--accent-bg)' }}>Forge</span> design system
          </h1>
          <p style={{ color: 'var(--text-secondary)', maxWidth: 600, marginTop: 'var(--space-5)' }}>
            Forge's own visual identity. Warm copper accent, deep graphite workspace, three themes (dark · light · contrast).
            Every primitive is keyboard + screen-reader correct.
          </p>
          <div style={{ marginTop: 'var(--space-7)' }}>
            <SegmentedControl
              items={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'contrast', label: 'Contrast' }]}
              value={theme}
              onChange={setTheme}
            />
          </div>
        </header>

        <Stack gap="var(--space-11)">
          {/* COLOUR */}
          <section>
            <h2>Colour</h2>
            <Inline gap="var(--space-5)" wrap>
              {['surface-app','surface-panel','surface-raised','surface-overlay','surface-hover','surface-active','surface-selected'].map((k) => (
                <Card key={k} tone="panel" padding="var(--space-3)" style={{ width: 110 }}>
                  <div style={{ width: '100%', height: 32, background: `var(--${k})`, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }} />
                  <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)', marginTop: 'var(--space-2)', fontFamily: 'var(--font-mono)' }}>{k}</div>
                </Card>
              ))}
            </Inline>
            <Inline gap="var(--space-5)" wrap style={{ marginTop: 'var(--space-7)' }}>
              {[
                ['accent-bg','accent-text'],
                ['success-bg','accent-text'],
                ['warning-bg','accent-text'],
                ['danger-bg','accent-text'],
                ['info-bg','accent-text'],
              ].map(([bg]) => (
                <div key={bg} style={{ width: 110, height: 56, background: `var(--${bg})`, color: 'var(--accent-text)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }}>{bg}</div>
              ))}
            </Inline>
          </section>

          {/* TYPOGRAPHY */}
          <section>
            <h2>Typography</h2>
            <Stack gap="var(--space-3)">
              <div style={{ fontSize: 'var(--text-3xl)', fontWeight: 'var(--weight-bold)' }}>Display 32 / bold</div>
              <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-semibold)' }}>Heading 24 / semibold</div>
              <div style={{ fontSize: 'var(--text-xl)' }}>Subhead 20 / regular</div>
              <div style={{ fontSize: 'var(--text-lg)' }}>Body 16 / regular</div>
              <div style={{ fontSize: 'var(--text-base)' }}>Body 14 — interface default</div>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Caption 12 / secondary</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>Mono — 12.345 mm × 6.789 mm</div>
            </Stack>
          </section>

          {/* BUTTONS */}
          <section>
            <h2>Buttons</h2>
            <Inline gap="var(--space-5)" wrap>
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
              <Button variant="success">Success</Button>
              <Button variant="primary" loading>Saving</Button>
              <Button variant="primary" leftIcon={<Icon name="fileSave" size={12} />}>With icon</Button>
              <Button variant="primary" disabled>Disabled</Button>
            </Inline>
            <Divider />
            <Inline gap="var(--space-5)">
              {['eye','frame','isolate','suppress','settings','help','archie'].map((n) =>
                <Tooltip key={n} content={n}><IconButton icon={<Icon name={n} />} label={n} /></Tooltip>)}
            </Inline>
          </section>

          {/* FORM CONTROLS */}
          <section>
            <h2>Form controls</h2>
            <Stack gap="var(--space-7)" style={{ maxWidth: 480 }}>
              <Field label="Project name" required helperText="Use a short, descriptive name.">
                <Input defaultValue="Bracket-v3" placeholder="Untitled" />
              </Field>
              <Field label="Extrude depth" layout="inline">
                <NumberInput value={number} onChange={setNumber} step={1} unit="mm" />
              </Field>
              <Field label="Units" layout="inline">
                <SegmentedControl items={[{value:'mm', label:'mm'},{value:'in',label:'in'},{value:'ft',label:'ft'}]} value={seg} onChange={setSeg} />
              </Field>
              <Field label="Show hidden lines" layout="inline">
                <Switch checked={boolSwitch} onChange={setBoolSwitch} />
              </Field>
              <Field label="Auto-save" layout="inline">
                <Checkbox checked={boolCheck} onChange={setBoolCheck} label="Save every 5 minutes" />
              </Field>
            </Stack>
          </section>

          {/* PROGRESS */}
          <section>
            <h2>Progress + spinners</h2>
            <Stack gap="var(--space-5)" style={{ maxWidth: 480 }}>
              <ProgressBar value={68} label="Tessellating" />
              <ProgressBar tone="success" value={100} label="Saved" />
              <ProgressBar tone="warning" label="Solving FEA…" />
              <Inline><Spinner /><span style={{ color: 'var(--text-secondary)' }}>Loading kernel…</span></Inline>
            </Stack>
          </section>

          {/* TABS */}
          <section>
            <h2>Tabs</h2>
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { id: 'sketch', label: 'Sketch', icon: <Icon name="sketchTab" size={12} /> },
                { id: 'part',   label: 'Part',   icon: <Icon name="partTab" size={12} /> },
                { id: 'asm',    label: 'Assembly', icon: <Icon name="assemblyTab" size={12} />, badge: 12 },
                { id: 'dwg',    label: 'Drawing', icon: <Icon name="drawingTab" size={12} /> },
              ]}
            />
            <div style={{ padding: 'var(--space-7)', color: 'var(--text-secondary)' }}>Tab content for <strong>{tab}</strong></div>
          </section>

          {/* COLLAPSIBLE / FEATURE TREE */}
          <section>
            <h2>Feature tree (Tree primitive)</h2>
            <Card padding="var(--space-3)" style={{ maxWidth: 360 }}>
              <Tree
                nodes={TREE_NODES}
                selected={selectedTree}
                onSelect={setSelectedTree}
              />
            </Card>
          </section>

          <section>
            <h2>Property panel sections</h2>
            <Card tone="panel" padding="0" style={{ maxWidth: 360 }}>
              <CollapsibleSection title="Direction 1" icon={<Icon name="extrude" size={12} />} badge="Blind">
                <Field label="Depth"><NumberInput value={25} onChange={() => {}} unit="mm" /></Field>
                <Field label="Reversed"><Switch checked={false} onChange={() => {}} /></Field>
              </CollapsibleSection>
              <CollapsibleSection title="Selected Items" defaultOpen={false}>
                <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>Pick a sketch profile in the viewport.</div>
              </CollapsibleSection>
              <CollapsibleSection title="Thin Feature" defaultOpen={false}>
                <Field label="Thickness"><NumberInput value={2} onChange={() => {}} unit="mm" /></Field>
              </CollapsibleSection>
            </Card>
          </section>

          {/* EMPTY STATE */}
          <section>
            <h2>Empty state</h2>
            <Card tone="panel"><EmptyState
              icon={<Icon name="archie" size={24} />}
              title="Nothing selected"
              description="Pick a feature in the tree or click an entity in the viewport to inspect its properties."
              action={<Button variant="secondary" leftIcon={<Icon name="help" size={12} />}>Take the tour</Button>}
            /></Card>
          </section>

          {/* MODAL + TOAST */}
          <section>
            <h2>Modals + toasts</h2>
            <Inline gap="var(--space-5)">
              <Button onClick={() => setOpenModal(true)}>Open modal</Button>
              <ToastDemo />
              <KeyHint keys={['Cmd', 'K']} />
            </Inline>
            <Modal
              open={openModal}
              onClose={() => setOpenModal(false)}
              title="New project"
              description="Pick a template to start from."
              footer={<>
                <Button variant="secondary" onClick={() => setOpenModal(false)}>Cancel</Button>
                <Button variant="primary" onClick={() => setOpenModal(false)}>Create</Button>
              </>}
            >
              <Stack gap="var(--space-7)">
                <Field label="Project name" required><Input defaultValue="Untitled" /></Field>
                <Field label="Units"><SegmentedControl items={[{value:'mm', label:'mm'},{value:'in',label:'in'}]} value="mm" onChange={() => {}} /></Field>
              </Stack>
            </Modal>
          </section>

          {/* ICON GALLERY */}
          <section>
            <h2>Icons ({ICON_NAMES.length})</h2>
            <Card tone="panel" padding="var(--space-6)">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(86px, 1fr))', gap: 'var(--space-5)' }}>
                {ICON_NAMES.map((n) => (
                  <div key={n} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-secondary)',
                  }}>
                    <Icon name={n} size={20} />
                    <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>{n}</span>
                  </div>
                ))}
              </div>
            </Card>
          </section>
        </Stack>
        <ToastHost />
      </div>
    </ToastProvider>
  );
}
