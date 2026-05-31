/**
 * Tabs — horizontal or vertical, keyboard-roving.
 * SegmentedControl — pill-style mutually-exclusive picker.
 */

import React, { useState } from 'react';
import { useRoving, useUniqueId } from '../a11y.js';

export function Tabs({
  items, // [{id, label, icon?, badge?, disabled?}]
  value,
  defaultValue,
  onChange,
  orientation = 'horizontal',
  variant = 'underline', // 'underline' | 'pill'
  children,
}) {
  const [internal, setInternal] = useState(defaultValue ?? items?.[0]?.id);
  const active = value ?? internal;
  const setActive = (id) => {
    if (value === undefined) setInternal(id);
    onChange?.(id);
  };
  const { ref, onKeyDown } = useRoving(orientation);
  const isUnderline = variant === 'underline';

  return (
    <div className={`forge-tabs forge-tabs-${orientation} forge-tabs-${variant}`}
         style={{
           display: 'flex',
           flexDirection: orientation === 'vertical' ? 'column' : 'row',
           gap: isUnderline ? 0 : 'var(--space-3)',
           padding: isUnderline ? 0 : 'var(--space-2)',
           background: variant === 'pill' ? 'var(--surface-active)' : undefined,
           borderRadius: variant === 'pill' ? 'var(--radius-md)' : 0,
           borderBottom: isUnderline && orientation === 'horizontal' ? '1px solid var(--border-subtle)' : undefined,
         }}>
      <div
        ref={ref}
        role="tablist"
        aria-orientation={orientation}
        onKeyDown={onKeyDown}
        style={{
          display: 'flex',
          flexDirection: orientation === 'vertical' ? 'column' : 'row',
          gap: isUnderline ? 'var(--space-1)' : 'var(--space-1)',
          flex: 1,
        }}
      >
        {items.map((it) => {
          const selected = it.id === active;
          const base = {
            display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)',
            padding: isUnderline ? 'var(--space-5) var(--space-7)' : 'var(--space-3) var(--space-7)',
            background: 'transparent',
            color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--weight-medium)',
            border: 'none',
            borderRadius: variant === 'pill' ? 'var(--radius-sm)' : 0,
            cursor: it.disabled ? 'not-allowed' : 'pointer',
            opacity: it.disabled ? 0.45 : 1,
            position: 'relative',
            transition: 'color var(--motion-fast) var(--ease-out), background var(--motion-fast) var(--ease-out)',
          };
          const pillSelected = variant === 'pill' && selected
            ? { background: 'var(--surface-raised)', color: 'var(--text-primary)' }
            : {};
          return (
            <button
              key={it.id}
              role="tab"
              type="button"
              id={`tab-${it.id}`}
              aria-selected={selected}
              aria-controls={`tabpanel-${it.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={it.disabled}
              onClick={() => !it.disabled && setActive(it.id)}
              style={{ ...base, ...pillSelected }}
            >
              {it.icon}
              <span>{it.label}</span>
              {it.badge !== undefined && it.badge !== null && (
                <span style={{
                  fontSize: 'var(--text-2xs)', background: 'var(--accent-soft)',
                  color: 'var(--accent-soft-text)', padding: '0 var(--space-3)',
                  borderRadius: 'var(--radius-full)', fontFamily: 'var(--font-mono)',
                }}>{it.badge}</span>
              )}
              {isUnderline && selected && (
                <span style={{
                  position: 'absolute', bottom: -1, left: 'var(--space-5)', right: 'var(--space-5)',
                  height: 2, background: 'var(--accent-bg)', borderRadius: '2px 2px 0 0',
                }} />
              )}
            </button>
          );
        })}
      </div>
      {children && (
        <div role="tabpanel" id={`tabpanel-${active}`} aria-labelledby={`tab-${active}`}>
          {typeof children === 'function' ? children(active) : children}
        </div>
      )}
    </div>
  );
}

export function SegmentedControl({ items, value, onChange, size = 'md', fullWidth = false }) {
  return (
    <div role="radiogroup" style={{
      display: 'inline-flex',
      padding: 2,
      background: 'var(--surface-active)',
      borderRadius: 'var(--radius-md)',
      width: fullWidth ? '100%' : undefined,
    }}>
      {items.map((it) => {
        const selected = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange?.(it.value)}
            style={{
              flex: fullWidth ? 1 : undefined,
              padding: size === 'sm' ? 'var(--space-2) var(--space-6)' : 'var(--space-3) var(--space-7)',
              fontSize: size === 'sm' ? 'var(--text-xs)' : 'var(--text-sm)',
              fontWeight: 'var(--weight-medium)',
              background: selected ? 'var(--surface-raised)' : 'transparent',
              color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              boxShadow: selected ? 'var(--shadow-sm)' : undefined,
              transition: 'background var(--motion-fast), color var(--motion-fast)',
            }}
          >
            {it.icon}{it.label && <span style={{ marginLeft: it.icon ? 'var(--space-3)' : 0 }}>{it.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
