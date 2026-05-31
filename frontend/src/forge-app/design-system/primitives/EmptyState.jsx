/**
 * EmptyState — friendly placeholder for empty panels / lists / viewports.
 * Always has a concrete next-step copy + optional CTA button.
 */

import React from 'react';

export function EmptyState({ icon, title, description, action, size = 'md' }) {
  const padding = size === 'sm' ? 'var(--space-9)' : size === 'lg' ? 'var(--space-14)' : 'var(--space-11)';
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding,
      textAlign: 'center',
      gap: 'var(--space-6)',
      color: 'var(--text-secondary)',
    }}>
      {icon && (
        <div style={{
          width: 48, height: 48,
          background: 'var(--accent-soft)',
          color: 'var(--accent-soft-text)',
          borderRadius: 'var(--radius-full)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</div>
      )}
      {title && (
        <h3 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-primary)' }}>
          {title}
        </h3>
      )}
      {description && (
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', maxWidth: '320px', lineHeight: 'var(--leading-relaxed)' }}>
          {description}
        </p>
      )}
      {action && <div style={{ marginTop: 'var(--space-3)' }}>{action}</div>}
    </div>
  );
}
