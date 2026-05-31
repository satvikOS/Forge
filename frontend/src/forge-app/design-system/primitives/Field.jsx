/**
 * Field — labelled form-row wrapper. Mounts label, helper text, error
 * indicator, required marker. Use Field around any Input / NumberInput /
 * Select / Switch in forms.
 */

import React from 'react';
import { useUniqueId } from '../a11y.js';

export function Field({
  label,
  helperText,
  errorText,
  required = false,
  htmlFor,
  children,
  layout = 'stacked', // 'stacked' or 'inline'
}) {
  const id = useUniqueId('forge-field');
  const inputId = htmlFor || id;
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-err`;
  return (
    <div
      className="forge-field"
      style={{
        display: 'flex',
        flexDirection: layout === 'inline' ? 'row' : 'column',
        alignItems: layout === 'inline' ? 'center' : 'stretch',
        gap: layout === 'inline' ? 'var(--space-7)' : 'var(--space-3)',
        marginBottom: 'var(--space-6)',
      }}
    >
      {label && (
        <label
          htmlFor={inputId}
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--weight-medium)',
            color: 'var(--text-secondary)',
            flex: layout === 'inline' ? '0 0 120px' : undefined,
          }}
        >
          {label}
          {required && <span style={{ color: 'var(--danger-bg)', marginLeft: 'var(--space-1)' }} aria-hidden>*</span>}
        </label>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        {children}
        {helperText && !errorText && (
          <div id={helpId} style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            {helperText}
          </div>
        )}
        {errorText && (
          <div id={errorId} role="alert" style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--danger-text)' }}>
            {errorText}
          </div>
        )}
      </div>
    </div>
  );
}
