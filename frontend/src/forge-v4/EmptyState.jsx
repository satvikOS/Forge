// Forge v4 — shared EMPTY-STATE primitive.
//
// One calm, consistent empty-state language for every surface that can be
// blank: the feature tree, the bodies list, the Properties panel, and the
// blank-document viewport welcome. Monochrome, centred, quiet — an inset
// glyph, a short title, an even shorter hint, and (optionally) one or two
// ghost actions. Built entirely on the design-system `.fds-empty*` classes +
// `--fds-*` tokens (see theme/forge-base.css §12), so it themes automatically
// and never invents ad-hoc colours / sizes.
//
// Usage:
//   import { EmptyState } from 'forge-v4/EmptyState.jsx';
//   <EmptyState icon="sketch.rect" title="No features yet"
//               hint="Start a sketch or run an operation." inline />
//
// `variant`:  'inline'   — compact, for narrow dock sections (default-ish)
//             'viewport' — large, centred blank-document welcome
// `actions`:  optional [{ label, onClick, icon, primary }] ghost buttons.

import React from 'react';
import { Icon } from './icons/Icon.jsx';

export function EmptyState({
  icon,
  title,
  hint,
  actions,
  inline = false,
  variant,          // 'inline' | 'viewport' | undefined
  testId,
  className = '',
  ...rest
}) {
  const kind = variant || (inline ? 'inline' : null);
  const cls = [
    'fds-empty',
    kind === 'inline' ? 'fds-empty--inline' : '',
    kind === 'viewport' ? 'fds-empty--viewport' : '',
    className,
  ].filter(Boolean).join(' ');

  const iconSize = kind === 'viewport' ? 24 : kind === 'inline' ? 14 : 18;

  return (
    <div className={cls} data-testid={testId} {...rest}>
      {icon && (
        <span className="fds-empty-icon" aria-hidden="true">
          <Icon name={icon} size={iconSize} />
        </span>
      )}
      {title && <div className="fds-empty-title">{title}</div>}
      {hint && <div className="fds-empty-hint">{hint}</div>}
      {Array.isArray(actions) && actions.length > 0 && (
        <div className="fds-empty-actions">
          {actions.map((a, i) => (
            <button
              key={a.id || a.label || i}
              type="button"
              className={`fds-btn fds-btn--sm${a.primary ? ' fds-btn--primary' : ' fds-btn--ghost'}`}
              onClick={a.onClick}
              data-testid={a.testId}
            >
              {a.icon && <Icon name={a.icon} size={14} />}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default EmptyState;
