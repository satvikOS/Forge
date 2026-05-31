/**
 * PropertyPanel v2 — schema-driven property manager. Renders a feature's
 * editable parameters as a stack of CollapsibleSections with proper
 * Field controls.
 */

import React from 'react';
import { Icon } from '../../design-system/icons/Icon.jsx';
import { Button, IconButton } from '../../design-system/primitives/Button.jsx';
import { CollapsibleSection } from '../../design-system/primitives/CollapsibleSection.jsx';
import { NumberInput } from '../../design-system/primitives/NumberInput.jsx';
import { Switch } from '../../design-system/primitives/Switch.jsx';
import { Input } from '../../design-system/primitives/Input.jsx';
import { Field } from '../../design-system/primitives/Field.jsx';
import { EmptyState } from '../../design-system/primitives/EmptyState.jsx';
import { Stack, Inline, Divider } from '../../design-system/primitives/Card.jsx';

const TYPE_RENDERERS = {
  number: (f, value, set, units) => (
    <NumberInput value={value} onChange={set} step={f.step || 1}
                 unit={f.unit} units={units} precision={f.precision || 3} />
  ),
  boolean: (f, value, set) => <Switch checked={!!value} onChange={set} />,
  string: (f, value, set) => <Input value={value || ''} onChange={(e) => set(e.target.value)} placeholder={f.placeholder} />,
  enum: (f, value, set) => (
    <select value={value || ''} onChange={(e) => set(e.target.value)}
            style={{
              padding: 'var(--space-3) var(--space-5)',
              background: 'var(--surface-app)', color: 'var(--text-primary)',
              border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
              fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)',
              width: '100%',
            }}>
      {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  ),
  vector3: (f, value, set) => {
    const v = Array.isArray(value) ? value : [0, 0, 0];
    return (
      <Inline gap="var(--space-3)">
        {[0,1,2].map((i) => (
          <NumberInput key={i} value={v[i]} onChange={(n) => set([...v.slice(0, i), n, ...v.slice(i+1)])}
                       step={f.step || 1} unit={['x','y','z'][i]} />
        ))}
      </Inline>
    );
  },
};

export function PropertyPanel({ selection, schema, values, errors, units = ['mm','in','ft'], onCommit, onCancel, onPreview }) {
  if (!selection || !schema) {
    return (
      <EmptyState
        icon={<Icon name="settings" />}
        title="Nothing selected"
        description="Click a feature in the tree or an entity in the viewport to inspect its properties."
        size="sm"
      />
    );
  }

  const dirty = !!values && JSON.stringify(values) !== JSON.stringify(selection?.snapshot || {});

  return (
    <section aria-label="Property manager" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* HEADER */}
      <header style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
        padding: 'var(--space-6) var(--space-7)',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--surface-raised)',
      }}>
        <Icon name={schema.icon || 'settings'} size={16} style={{ color: 'var(--accent-bg)' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>{schema.title || schema.kind}</div>
          <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>{selection.name || selection.id}</div>
        </div>
        <IconButton icon={<Icon name="success" />} label="Accept" variant="success" onClick={() => onCommit?.(values)} />
        <IconButton icon={<Icon name="close" />}   label="Cancel" variant="ghost"   onClick={onCancel} />
      </header>

      {/* BODY */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {(schema.sections || [{ title: 'Properties', fields: schema.fields }]).map((sec, i) => (
          <CollapsibleSection key={i} title={sec.title} defaultOpen={sec.defaultOpen !== false}>
            <Stack gap="var(--space-5)">
              {sec.fields.map((f) => {
                const v = values?.[f.key];
                const err = errors?.[f.key];
                const set = (next) => onPreview?.({ ...values, [f.key]: next });
                const render = TYPE_RENDERERS[f.type];
                return (
                  <Field key={f.key} label={f.label || f.key} helperText={f.help} errorText={err} required={f.required}>
                    {render ? render(f, v, set, units) : (
                      <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>
                        Unknown field type "{f.type}"
                      </div>
                    )}
                  </Field>
                );
              })}
            </Stack>
          </CollapsibleSection>
        ))}
      </div>

      {/* FOOTER (sticky apply when modified) */}
      {dirty && (
        <footer style={{
          display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)',
          padding: 'var(--space-5) var(--space-7)',
          borderTop: '1px solid var(--border-subtle)',
          background: 'var(--surface-raised)',
        }}>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={() => onCommit?.(values)}>Apply</Button>
        </footer>
      )}
    </section>
  );
}
