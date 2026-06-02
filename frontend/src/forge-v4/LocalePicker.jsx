// Forge-188 — Locale picker control + a small localized labels row.
//
// Tiny floating control in the top-right that lets the user switch
// language. Adjacent to it sits a labels strip showing a sample of
// localized buttons (Save / Cancel / Run) so the e2e can verify the
// translation actually applies without scraping every menu.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';
import {
  t, getLocale, setLocale, listLocales, onLocaleChange,
} from './i18n.js';

const pickerStyle = {
  position: 'fixed',
  top: 6,
  right: 8,
  zIndex: 1450,
  display: 'flex', alignItems: 'center', gap: 4,
  fontSize: 11, fontFamily: 'var(--forge-mono)',
  background: 'var(--forge-canvas-2)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 3,
  padding: '2px 4px',
  color: 'var(--forge-ink)',
};

const selectStyle = {
  background: 'var(--forge-canvas)',
  color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  fontFamily: 'var(--forge-mono)',
  fontSize: 11,
  padding: '1px 4px',
};

const stripStyle = {
  position: 'fixed',
  bottom: 38,
  left: 8,
  zIndex: 1450,
  display: 'flex', gap: 4,
  fontSize: 11, fontFamily: 'var(--forge-mono)',
  background: 'var(--forge-canvas-2)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 3,
  padding: '4px 6px',
  color: 'var(--forge-ink-mute)',
  pointerEvents: 'none',
};

export function LocalePickerHost() {
  const [, rerender] = React.useState(0);
  React.useEffect(() => {
    return onLocaleChange(() => rerender((n) => n + 1));
  }, []);
  if (typeof document === 'undefined') return null;
  const locales = listLocales();
  return createPortal(
    <>
      <div style={pickerStyle} data-testid="forge-locale-picker">
        <span>🌐</span>
        <select value={getLocale()}
                onChange={(e) => setLocale(e.target.value)}
                style={selectStyle}
                data-testid="forge-locale-select">
          {locales.map((l) => (
            <option key={l.id} value={l.id}>{l.id}</option>
          ))}
        </select>
      </div>
      <div style={stripStyle} data-testid="forge-locale-strip">
        <span data-testid="forge-locale-save">{t('btn.save')}</span>
        <span>·</span>
        <span data-testid="forge-locale-cancel">{t('btn.cancel')}</span>
        <span>·</span>
        <span data-testid="forge-locale-run">{t('btn.run')}</span>
        <span>·</span>
        <span data-testid="forge-locale-tools">{t('menu.tools')}</span>
        <span>·</span>
        <span data-testid="forge-locale-help">{t('menu.help')}</span>
      </div>
    </>,
    document.body,
  );
}

export default LocalePickerHost;
