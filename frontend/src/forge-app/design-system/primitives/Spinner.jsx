/**
 * Spinner — circular loading indicator. ProgressBar — determinate +
 * indeterminate horizontal bar.
 */

import React from 'react';

const SPIN_KEYFRAMES = `
@keyframes forge-spin { to { transform: rotate(360deg); } }
@keyframes forge-indeterminate {
  0%   { transform: translateX(-40%); }
  100% { transform: translateX(140%); }
}
`;

let injected = false;
function injectKeyframes() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = SPIN_KEYFRAMES;
  document.head.appendChild(style);
}

export function Spinner({ size = 16, color = 'currentColor', label = 'Loading' }) {
  injectKeyframes();
  return (
    <svg
      role="status"
      aria-label={label}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      style={{ animation: 'forge-spin 0.9s linear infinite', flexShrink: 0 }}
    >
      <circle cx="8" cy="8" r="6" stroke={color} strokeOpacity="0.2" strokeWidth="2" fill="none" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke={color} strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function ProgressBar({ value = null, max = 100, label, size = 'md', tone = 'accent' }) {
  injectKeyframes();
  const determinate = value !== null && value !== undefined;
  const pct = determinate ? Math.max(0, Math.min(100, (value / max) * 100)) : null;
  const height = size === 'sm' ? 4 : size === 'lg' ? 8 : 6;
  const fill = tone === 'success' ? 'var(--success-bg)'
              : tone === 'warning' ? 'var(--warning-bg)'
              : tone === 'danger'  ? 'var(--danger-bg)'
              : 'var(--accent-bg)';
  return (
    <div className="forge-progress" role="progressbar"
         aria-valuemin={0} aria-valuemax={max}
         aria-valuenow={determinate ? value : undefined}
         aria-label={label}
         style={{ width: '100%' }}>
      {label && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          <span>{label}</span>
          {determinate && <span style={{ fontFamily: 'var(--font-mono)' }}>{Math.round(pct)}%</span>}
        </div>
      )}
      <div style={{
        position: 'relative',
        height: `${height}px`,
        background: 'var(--surface-active)',
        borderRadius: 'var(--radius-full)',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: determinate ? `${pct}%` : '40%',
          background: fill,
          borderRadius: 'var(--radius-full)',
          transition: determinate ? 'width var(--motion-base) var(--ease-out)' : undefined,
          animation: determinate ? undefined : 'forge-indeterminate 1.4s var(--ease-in-out) infinite',
        }} />
      </div>
    </div>
  );
}
