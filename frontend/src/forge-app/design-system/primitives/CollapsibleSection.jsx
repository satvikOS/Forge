/**
 * CollapsibleSection — the property-manager building block. Header is a
 * full-width button (keyboard-accessible); body slides in/out respecting
 * `prefers-reduced-motion`.
 */

import React, { useState } from 'react';
import { Icon } from '../icons/Icon.jsx';
import { useUniqueId } from '../a11y.js';

export function CollapsibleSection({
  title,
  icon,
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  badge,
  children,
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const id = useUniqueId('forge-section');
  const bodyId = `${id}-body`;

  const toggle = () => {
    const next = !open;
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };

  return (
    <section
      className="forge-collapsible"
      style={{
        borderTop: '1px solid var(--border-subtle)',
        padding: 'var(--space-5) 0',
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={toggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          width: '100%',
          background: 'transparent',
          border: 'none',
          color: 'var(--text-primary)',
          fontSize: 'var(--text-sm)',
          fontWeight: 'var(--weight-semibold)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          padding: 'var(--space-3) var(--space-6)',
          cursor: 'pointer',
        }}
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
        {icon && <span style={{ color: 'var(--accent-bg)' }}>{icon}</span>}
        <span style={{ flex: 1, textAlign: 'left' }}>{title}</span>
        {badge && (
          <span style={{
            background: 'var(--accent-soft)', color: 'var(--accent-soft-text)',
            padding: '2px var(--space-3)', borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-medium)',
            letterSpacing: 0,
          }}>{badge}</span>
        )}
      </button>
      {open && (
        <div
          id={bodyId}
          style={{
            padding: 'var(--space-5) var(--space-7) var(--space-3)',
          }}
        >
          {children}
        </div>
      )}
    </section>
  );
}
