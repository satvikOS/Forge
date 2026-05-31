/**
 * Card / Stack / Divider — layout primitives. Card is the standard
 * raised container; Stack is vertical flex with gap; Divider is a
 * theme-aware horizontal or vertical rule.
 */

import React from 'react';

export function Card({ children, padding = 'var(--space-7)', tone = 'panel', style: styleOverride, ...rest }) {
  const bg = tone === 'raised' ? 'var(--surface-raised)'
            : tone === 'overlay' ? 'var(--surface-overlay)'
            : 'var(--surface-panel)';
  return (
    <div
      style={{
        background: bg,
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        padding,
        ...styleOverride,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Stack({ children, gap = 'var(--space-5)', align = 'stretch', justify = 'flex-start', style, ...rest }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: align,
        justifyContent: justify,
        gap,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Inline({ children, gap = 'var(--space-5)', align = 'center', justify = 'flex-start', wrap = false, style, ...rest }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: align,
        justifyContent: justify,
        gap,
        flexWrap: wrap ? 'wrap' : 'nowrap',
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Divider({ orientation = 'horizontal', label, style }) {
  if (orientation === 'vertical') {
    return (
      <span role="separator" aria-orientation="vertical" style={{
        display: 'inline-block', width: 1, background: 'var(--border-subtle)',
        alignSelf: 'stretch', margin: '0 var(--space-3)',
        ...style,
      }} />
    );
  }
  if (label) {
    return (
      <div role="separator" style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-5)',
        color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)',
        margin: 'var(--space-6) 0',
        ...style,
      }}>
        <span style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
        <span>{label}</span>
        <span style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
      </div>
    );
  }
  return (
    <hr role="separator" style={{
      border: 'none',
      borderTop: '1px solid var(--border-subtle)',
      margin: 'var(--space-6) 0',
      ...style,
    }} />
  );
}
