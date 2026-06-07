// PUSH-79 (Slice-47 / Theme switcher panel).
//
// Up through PUSH-78 the only theme control was the View menu's
// `view.theme` action — a two-state toggle that flipped Dark ↔ Light.
// PUSH-79 ships a real 4-theme picker panel (Dark / Light / Sepia /
// High Contrast) wired to the same data-forge-theme attribute +
// localStorage key the shell uses, plus a forge:theme-changed bus
// event so the shell + any plugin / workbench can react.
//
// What lands:
//   • A right-docked panel with 4 radio buttons + a one-line hint
//     each. Clicking a radio writes the choice to
//     document.documentElement.dataset.forgeTheme, persists to
//     localStorage `forge.v4.theme` (same key the shell already uses,
//     in the same JSON-encoded form), and dispatches
//     `forge:theme-changed` so subscribers can react.
//   • Reachable via tools.themes menu action OR the imperative
//     window.__forgeOpenThemeSwitcher(true) hook.
//   • Persists across reloads through forge.v4.theme.
//
// Shell-side coordination:
//   ForgeShellV4 owns a React `theme` state whose effect re-stamps the
//   value on every render. Without coordination, the panel's writes
//   would be overwritten on the next shell render. PUSH-79 wires the
//   shell to subscribe to `forge:theme-changed` so its React state
//   syncs to panel writes — its existing effect then no-ops.
//
// Constraints honoured:
//   * NO new npm packages, NO new C++ libs — pure React + window event
//     bus + localStorage + tokens.css. Sepia + High Contrast add new
//     `:root[data-forge-theme="…"]` selectors in tokens.css.
//   * No MVP / stub — the panel reads the current persisted theme on
//     mount, writes the new theme to BOTH the DOM AND localStorage AND
//     the bus on every click, and re-hydrates from the persisted value
//     when the panel is re-opened.
//   * Surgical edits to Menus.jsx (one entry) + App.jsx (one import +
//     one mount).
//   * Multi-cam e2e: 5 named camera angles per the Forge-171 mandate.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

// ─────────────────────────────────────────────────────────────────────
// Constants

export const THEME_STORAGE_KEY = 'forge.v4.theme';
export const THEME_CHANGE_EVENT = 'forge:theme-changed';

export const FORGE_THEMES = Object.freeze([
  Object.freeze({
    id: 'dark',
    label: 'Dark',
    hint: 'OLED-black canvas, near-white ink, monochrome accent.',
  }),
  Object.freeze({
    id: 'light',
    label: 'Light',
    hint: 'Greyish off-white canvas, deep-graphite ink.',
  }),
  Object.freeze({
    id: 'sepia',
    label: 'Sepia',
    hint: 'Warm cream canvas, brown ink — long-reading comfort.',
  }),
  Object.freeze({
    id: 'high-contrast',
    label: 'High Contrast',
    hint: 'Pure black + pure white + amber accent for accessibility.',
  }),
]);

const VALID_THEME_IDS = new Set(FORGE_THEMES.map((t) => t.id));

// ─────────────────────────────────────────────────────────────────────
// Persistence + DOM helpers — wrapped so the panel, the host, and the
// e2e can all funnel through one code path.

export function readPersistedTheme() {
  if (typeof localStorage === 'undefined') return 'dark';
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return 'dark';
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = raw; }
    if (typeof parsed === 'string' && VALID_THEME_IDS.has(parsed)) {
      return parsed;
    }
    return 'dark';
  } catch {
    return 'dark';
  }
}

export function writePersistedTheme(themeId) {
  if (typeof localStorage === 'undefined') return false;
  if (!VALID_THEME_IDS.has(themeId)) return false;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(themeId));
    return true;
  } catch {
    return false;
  }
}

export function applyThemeToDom(themeId) {
  if (typeof document === 'undefined') return false;
  if (!VALID_THEME_IDS.has(themeId)) return false;
  document.documentElement.dataset.forgeTheme = themeId;
  return true;
}

export function dispatchThemeChange(themeId) {
  if (typeof window === 'undefined') return false;
  if (!VALID_THEME_IDS.has(themeId)) return false;
  try {
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, {
      detail: { theme: themeId, ts: Date.now() },
    }));
    return true;
  } catch {
    return false;
  }
}

export function setForgeTheme(themeId) {
  if (!VALID_THEME_IDS.has(themeId)) return false;
  const domOk = applyThemeToDom(themeId);
  const lsOk  = writePersistedTheme(themeId);
  const busOk = dispatchThemeChange(themeId);
  return domOk && lsOk && busOk;
}

// ─────────────────────────────────────────────────────────────────────
// Styles

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 320,
  zIndex: 1340,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink)', fontSize: 12,
  overflowY: 'auto',
};
const HEADER_ROW = {
  display: 'flex', alignItems: 'center', gap: 8,
  paddingBottom: 6,
  borderBottom: '1px solid var(--forge-rail-edge)',
};
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)', cursor: 'pointer',
  padding: '2px 8px', borderRadius: 3,
  fontSize: 14, lineHeight: 1,
};
const RADIO_ROW = {
  display: 'grid',
  gridTemplateColumns: '20px 1fr',
  alignItems: 'flex-start',
  gap: 8,
  padding: '8px 10px',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 4,
  background: 'var(--forge-surface)',
  cursor: 'pointer',
  marginBottom: 2,
};
const RADIO_ROW_ACTIVE = {
  ...RADIO_ROW,
  borderColor: 'var(--forge-accent-rim)',
  background: 'var(--forge-accent-mute)',
};
const RADIO_LABEL = {
  fontWeight: 600,
  fontSize: 12,
  color: 'var(--forge-ink)',
};
const RADIO_HINT = {
  fontSize: 11,
  color: 'var(--forge-ink-mute)',
  marginTop: 2,
  lineHeight: 1.4,
};

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

export function ThemeSwitcherPanel({ open, onClose }) {
  const [active, setActive] = useState(() => readPersistedTheme());

  useEffect(() => {
    if (!open) return undefined;
    setActive(readPersistedTheme());
    if (typeof window === 'undefined') return undefined;
    const onBus = (e) => {
      const t = e?.detail?.theme;
      if (typeof t === 'string' && VALID_THEME_IDS.has(t)) {
        setActive(t);
      }
    };
    window.addEventListener(THEME_CHANGE_EVENT, onBus);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onBus);
  }, [open]);

  const onPick = useCallback((themeId) => {
    if (!VALID_THEME_IDS.has(themeId)) return;
    setActive(themeId);
    setForgeTheme(themeId);
  }, []);

  const liveThemeId = useMemo(() => (
    VALID_THEME_IDS.has(active) ? active : 'dark'
  ), [active]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div role="dialog"
         aria-label="Theme switcher"
         data-testid="forge-theme-switcher-panel"
         data-active-theme={liveThemeId}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <strong style={{ fontSize: 13, flex: 1 }}>Theme</strong>
        <span data-testid="forge-theme-switcher-active"
              data-theme-id={liveThemeId}
              style={{
                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                fontSize: 10,
                color: 'var(--forge-ink-mute)',
                padding: '1px 6px', borderRadius: 10,
                border: '1px solid var(--forge-rail-edge)',
              }}>
          {liveThemeId}
        </span>
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close theme switcher"
                data-testid="forge-theme-switcher-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.4 }}
           data-testid="forge-theme-switcher-help">
        Choose a UI theme. The choice persists to <code>forge.v4.theme
        </code> and applies immediately to the whole shell.
      </div>

      <fieldset
        data-testid="forge-theme-switcher-list"
        style={{
          border: 'none', padding: 0, margin: 0,
          display: 'flex', flexDirection: 'column',
        }}>
        <legend style={{
          padding: 0, fontSize: 11,
          color: 'var(--forge-ink-mute)', marginBottom: 4,
        }}>
          4 themes
        </legend>
        {FORGE_THEMES.map((t) => {
          const checked = (t.id === liveThemeId);
          return (
            <label key={t.id}
                   data-testid={`forge-theme-switcher-row-${t.id}`}
                   data-theme-id={t.id}
                   data-checked={checked ? 'true' : 'false'}
                   style={checked ? RADIO_ROW_ACTIVE : RADIO_ROW}>
              <input type="radio"
                     name="forge-theme"
                     value={t.id}
                     checked={checked}
                     onChange={() => onPick(t.id)}
                     data-testid={`forge-theme-switcher-radio-${t.id}`}
                     aria-label={`Theme ${t.label}`} />
              <div>
                <div style={RADIO_LABEL}
                     data-testid={`forge-theme-switcher-label-${t.id}`}>
                  {t.label}
                </div>
                <div style={RADIO_HINT}
                     data-testid={`forge-theme-switcher-hint-${t.id}`}>
                  {t.hint}
                </div>
              </div>
            </label>
          );
        })}
      </fieldset>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for tools.themes menu action and imperative
// window.__forgeOpenThemeSwitcher hook. On mount stamps the persisted
// theme so a hard reload lands in the right palette before the shell's
// own effect runs.

export function ThemeSwitcherPanelHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenThemeSwitcher  = (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeCloseThemeSwitcher = () => setOpen(false);
    window.__forgeThemeHelper = Object.freeze({
      readPersistedTheme,
      writePersistedTheme,
      applyThemeToDom,
      dispatchThemeChange,
      setForgeTheme,
      THEMES: FORGE_THEMES,
      STORAGE_KEY: THEME_STORAGE_KEY,
      EVENT_NAME: THEME_CHANGE_EVENT,
    });
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.themes') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);

    try {
      const seed = readPersistedTheme();
      applyThemeToDom(seed);
      if (!window.__forgeThemeSeeded_v1) {
        window.__forgeThemeSeeded_v1 = true;
        dispatchThemeChange(seed);
      }
    } catch { /* fail-soft */ }

    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenThemeSwitcher; } catch {}
      try { delete window.__forgeCloseThemeSwitcher; } catch {}
    };
  }, []);
  return <ThemeSwitcherPanel open={open} onClose={() => setOpen(false)} />;
}

export default ThemeSwitcherPanel;
