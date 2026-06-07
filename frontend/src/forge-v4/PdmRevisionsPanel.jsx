// PUSH-100 (Slice-68 / PDM Revisions dialog).
//
// PUSH-51 (Slice-20) shipped the real JSON-backed PDM vault — content-
// addressed revisions written via IPC, with check-in / check-out / history
// / rollback / ECN attach surfaces all running through electron/pdmVault.js.
// PUSH-14's earlier `PdmPanel` exposes the full item / revisions / ECNs
// / BOMs / where-used five-tab cosmetic UI.
//
// What was missing — and what this slice ships — is a *focused* semver
// revisions dialog for the active document. The Forge user wants to:
//
//   1. See the current document version as `MAJOR.MINOR.PATCH` (1.0.0
//      on first mount).
//   2. Click `+Major`, `+Minor`, or `+Patch` to bump it the standard way
//      (SemVer 2.0: a major bump resets minor + patch to 0, a minor bump
//      resets patch to 0, a patch bump only increments patch).
//   3. Attach an Engineering Change Notice — an ECN id (e.g. "ECN-1001")
//      and a free-text description ("Fix tolerance band") — that lands on
//      every bump.
//   4. See a timestamped revision history table (from → to · ECN · note).
//   5. Have it all persist to `localStorage` under `forge.v4.pdmRevisions`
//      so a refresh / app relaunch keeps the version + the log.
//
// The dialog publishes its full state on `window.__forgePdmRevisions` so
// the e2e + plugins + Archie tool calls can drive bumps without React
// mounted. It is reachable through:
//
//   * the `tools.pdmRevisions` menu action (wired in Menus.jsx),
//   * `window.__forgeOpenPdmRevisions(true|false)` for plugins,
//   * `window.__forgePdmRevisionsBump('major'|'minor'|'patch', {ecn, desc})`
//     for headless callers.
//
// Hard constraints (PUSH-100 brief):
//   * NO new npm packages, NO new C++ libs, NO external services.
//   * Real impl, no MVP / no stub: every bump rewrites localStorage,
//     mirrors onto window.__forgePdmRevisions, dispatches a bus event,
//     and shows in the history table on the next render.
//   * Surgical edits to Menus.jsx (one new entry) + App.jsx (one
//     import + one mount).

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';

// ─────────────────────────────────────────────────────────────────────
// Constants

export const STORAGE_KEY = 'forge.v4.pdmRevisions';
export const FORGE_PDM_REVISIONS_EVENT = 'forge:pdm-revisions-bumped';
export const INITIAL_VERSION = '1.0.0';
export const BUMP_KINDS = ['major', 'minor', 'patch'];

// ─────────────────────────────────────────────────────────────────────
// Pure helpers — parsing / bumping / persistence. Live outside the React
// component so headless callers + the e2e can exercise them directly.

export function parseVersion(s) {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3], 10),
  };
}

export function formatVersion(v) {
  if (!v || typeof v !== 'object') return INITIAL_VERSION;
  const M = Number.isFinite(v.major) ? Math.max(0, v.major | 0) : 0;
  const m = Number.isFinite(v.minor) ? Math.max(0, v.minor | 0) : 0;
  const p = Number.isFinite(v.patch) ? Math.max(0, v.patch | 0) : 0;
  return `${M}.${m}.${p}`;
}

// SemVer 2.0 bump rules: bumping a higher segment resets every lower
// segment to 0.
export function bumpVersion(current, kind) {
  const parsed = parseVersion(current) || { major: 1, minor: 0, patch: 0 };
  if (kind === 'major') {
    return formatVersion({ major: parsed.major + 1, minor: 0, patch: 0 });
  }
  if (kind === 'minor') {
    return formatVersion({ major: parsed.major, minor: parsed.minor + 1, patch: 0 });
  }
  if (kind === 'patch') {
    return formatVersion({ major: parsed.major, minor: parsed.minor, patch: parsed.patch + 1 });
  }
  // Unknown kind: no-op (keeps the persisted version stable).
  return formatVersion(parsed);
}

export function loadState() {
  if (typeof localStorage === 'undefined') {
    return { current: INITIAL_VERSION, history: [] };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { current: INITIAL_VERSION, history: [] };
    const parsed = JSON.parse(raw);
    const current = parseVersion(parsed?.current) ? parsed.current : INITIAL_VERSION;
    const history = Array.isArray(parsed?.history)
      ? parsed.history.filter((h) => h && typeof h === 'object' && typeof h.to === 'string')
      : [];
    return { current, history };
  } catch {
    return { current: INITIAL_VERSION, history: [] };
  }
}

export function saveState(state) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

// Apply a bump to a state object — returns the new state object. Pure;
// the caller is responsible for persistence + window mirroring.
export function applyBump(state, kind, ecn, desc) {
  const safe = state && typeof state === 'object'
    ? state
    : { current: INITIAL_VERSION, history: [] };
  const from = parseVersion(safe.current) ? safe.current : INITIAL_VERSION;
  const to = bumpVersion(from, kind);
  if (to === from) return safe; // unknown kind → no-op
  const entry = {
    from,
    to,
    kind,
    ecn: typeof ecn === 'string' ? ecn.trim() : '',
    desc: typeof desc === 'string' ? desc.trim() : '',
    ts: Date.now(),
  };
  return {
    current: to,
    history: [...(Array.isArray(safe.history) ? safe.history : []), entry],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Styles — same right-docked rail vocabulary as BomBalloonsPanel +
// DiagnosticDumpPanel so all of slice 49 / 50 / 61 / 68 read the same.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 460,
  zIndex: 1336,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  overflow: 'hidden',
};
const HEADER_ROW = {
  display: 'flex', alignItems: 'center', gap: 8,
};
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3,
};
const SECTION_TITLE = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  margin: '4px 0 4px',
};
const SECTION_BOX = {
  background: 'var(--forge-canvas-3, #1b212a)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4,
  padding: 10,
  display: 'flex', flexDirection: 'column', gap: 8,
};
const ROW = {
  display: 'flex', alignItems: 'center', gap: 8,
};
const FIELD_LABEL = {
  fontSize: 10,
  color: 'var(--forge-ink-mute, #9aa1ab)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  minWidth: 56,
};
const TEXT_INPUT = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '4px 6px',
  borderRadius: 3,
  fontSize: 12,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  flex: 1,
  minWidth: 0,
};
const ACTION_BTN = (variant = 'default', disabled = false) => ({
  background: variant === 'primary'
    ? 'var(--forge-accent, #4f87ff)'
    : 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: variant === 'primary' ? '#fff' : 'var(--forge-ink, #dadde2)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  padding: '6px 12px',
  borderRadius: 3,
  fontSize: 11,
  fontWeight: 600,
  opacity: disabled ? 0.5 : 1,
});
const VERSION_CHIP = {
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 4,
  padding: '4px 10px',
  borderRadius: 'var(--forge-radius-pill, 10px)',
  background: 'var(--forge-accent-mute, rgba(79,135,255,0.18))',
  border: '1px solid var(--forge-accent, #4f87ff)',
  color: 'var(--forge-ink, #dadde2)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 18,
  fontWeight: 700,
};
const TABLE_BOX = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4,
  background: 'var(--forge-canvas-1, #0e1218)',
};
const TABLE_HEAD_ROW = {
  display: 'grid',
  gridTemplateColumns: '70px 70px 90px 1fr 100px',
  alignItems: 'center',
  gap: 6,
  padding: '6px 8px',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
  background: 'var(--forge-canvas-2, #161b22)',
  position: 'sticky', top: 0, zIndex: 1,
};
const TABLE_BODY_ROW = (kind) => ({
  display: 'grid',
  gridTemplateColumns: '70px 70px 90px 1fr 100px',
  alignItems: 'center',
  gap: 6,
  padding: '5px 8px',
  borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
  background: kind === 'major'
    ? 'rgba(226,106,106,0.06)'
    : kind === 'minor'
      ? 'rgba(79,135,255,0.05)'
      : 'transparent',
});
const KIND_PILL = (kind) => {
  const COLOR = {
    major: { bg: 'rgba(226,106,106,0.16)', fg: '#e26a6a' },
    minor: { bg: 'rgba(79,135,255,0.16)',  fg: '#4f87ff' },
    patch: { bg: 'rgba(92,200,143,0.16)',  fg: '#5cc88f' },
  }[kind] || { bg: 'var(--forge-surface)', fg: 'var(--forge-ink-2)' };
  return {
    display: 'inline-block',
    padding: '1px 6px',
    borderRadius: 'var(--forge-radius-pill, 10px)',
    background: COLOR.bg,
    color: COLOR.fg,
    fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
    fontSize: 9,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };
};

// Format a millisecond timestamp as YYYY-MM-DD HH:mm:ss for the table.
function tsToText(ts) {
  if (!Number.isFinite(ts)) return '—';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
       + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

export function PdmRevisionsPanel({ open, onClose }) {
  const [state, setState] = useState(() => loadState());
  const [ecn, setEcn] = useState('');
  const [desc, setDesc] = useState('');
  const [lastBumpAt, setLastBumpAt] = useState(null);

  // Refresh from localStorage on open. Other tabs / windows / direct
  // window.__forgePdmRevisionsBump calls may have mutated the persisted
  // state between this panel's mounts.
  useEffect(() => {
    if (!open) return undefined;
    setState(loadState());
    setEcn('');
    setDesc('');
    return undefined;
  }, [open]);

  // Mirror state onto window every time it changes — including the
  // initial mount — so headless callers + the e2e always read the
  // latest snapshot.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.__forgePdmRevisions = {
        current: state.current,
        history: state.history.slice(),
      };
    } catch {}
  }, [state]);

  const handleBump = useCallback((kind) => {
    if (!BUMP_KINDS.includes(kind)) return;
    setState((prev) => {
      const next = applyBump(prev, kind, ecn, desc);
      saveState(next);
      if (typeof window !== 'undefined') {
        try {
          window.__forgePdmRevisions = {
            current: next.current,
            history: next.history.slice(),
          };
          window.dispatchEvent(new CustomEvent(FORGE_PDM_REVISIONS_EVENT, {
            detail: {
              kind,
              from: prev.current,
              to: next.current,
              ecn: typeof ecn === 'string' ? ecn.trim() : '',
              desc: typeof desc === 'string' ? desc.trim() : '',
              count: next.history.length,
            },
          }));
        } catch {}
      }
      return next;
    });
    setEcn('');
    setDesc('');
    setLastBumpAt(Date.now());
  }, [ecn, desc]);

  const reverseHistory = useMemo(
    () => state.history.slice().reverse(),
    [state.history],
  );

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div role="dialog"
         aria-label="PDM Revisions"
         data-testid="forge-pdm-revisions-panel"
         data-current={state.current}
         data-history-count={state.history.length}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="misc.settings" size={14} />
        <strong style={{ fontSize: 13 }}>PDM Revisions</strong>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close PDM Revisions panel"
                data-testid="forge-pdm-revisions-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={SECTION_TITLE}>Current version</div>
      <div style={SECTION_BOX}>
        <div style={ROW}>
          <span data-testid="forge-pdm-revisions-current"
                style={VERSION_CHIP}>
            v{state.current}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{
            fontSize: 10,
            color: 'var(--forge-ink-mute, #9aa1ab)',
            fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
          }}>
            SemVer 2.0
          </span>
        </div>
        <div style={ROW}>
          <button type="button"
                  onClick={() => handleBump('major')}
                  title="Increment major version (resets minor + patch to 0)"
                  data-testid="forge-pdm-revisions-bump-major"
                  style={ACTION_BTN('default', false)}>
            + Major
          </button>
          <button type="button"
                  onClick={() => handleBump('minor')}
                  title="Increment minor version (resets patch to 0)"
                  data-testid="forge-pdm-revisions-bump-minor"
                  style={ACTION_BTN('primary', false)}>
            + Minor
          </button>
          <button type="button"
                  onClick={() => handleBump('patch')}
                  title="Increment patch version"
                  data-testid="forge-pdm-revisions-bump-patch"
                  style={ACTION_BTN('default', false)}>
            + Patch
          </button>
        </div>
      </div>

      <div style={SECTION_TITLE}>Engineering Change Notice (attached on bump)</div>
      <div style={SECTION_BOX}>
        <label style={ROW}>
          <span style={FIELD_LABEL}>ECN ID</span>
          <input type="text"
                 value={ecn}
                 onChange={(e) => setEcn(e.target.value)}
                 placeholder="ECN-1001"
                 data-testid="forge-pdm-revisions-ecn"
                 style={TEXT_INPUT} />
        </label>
        <label style={ROW}>
          <span style={FIELD_LABEL}>Description</span>
          <input type="text"
                 value={desc}
                 onChange={(e) => setDesc(e.target.value)}
                 placeholder="Why this revision?"
                 data-testid="forge-pdm-revisions-desc"
                 style={TEXT_INPUT} />
        </label>
        <div style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
          {ecn.trim() || desc.trim()
            ? 'Will be attached to the next bump.'
            : 'Optional — leave blank to bump without an ECN reference.'}
        </div>
      </div>

      <div style={SECTION_TITLE}>
        Revision history ({state.history.length})
      </div>
      {state.history.length === 0 ? (
        <div data-testid="forge-pdm-revisions-empty"
             style={{
               padding: '12px 8px',
               fontStyle: 'italic',
               color: 'var(--forge-ink-mute, #9aa1ab)',
               fontSize: 11,
             }}>
          No revisions logged. Click +Major / +Minor / +Patch above to start the log.
        </div>
      ) : (
        <div data-testid="forge-pdm-revisions-table" style={TABLE_BOX}>
          <div style={TABLE_HEAD_ROW}>
            <span>From</span>
            <span>To</span>
            <span>Kind</span>
            <span>ECN · Note</span>
            <span style={{ textAlign: 'right' }}>Time</span>
          </div>
          {reverseHistory.map((h, i) => (
            <div key={`${h.ts}-${i}`}
                 data-testid="forge-pdm-revisions-row"
                 data-from={h.from}
                 data-to={h.to}
                 data-kind={h.kind}
                 data-ecn={h.ecn || ''}
                 data-desc={h.desc || ''}
                 data-ts={h.ts}
                 style={TABLE_BODY_ROW(h.kind)}>
              <span style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>{h.from}</span>
              <span style={{ fontWeight: 700 }}>{h.to}</span>
              <span><span style={KIND_PILL(h.kind)}>{h.kind}</span></span>
              <span title={`${h.ecn || '—'} · ${h.desc || '—'}`}
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                <span style={{ color: 'var(--forge-accent, #4f87ff)' }}>
                  {h.ecn || '—'}
                </span>
                {h.desc ? <span style={{
                  color: 'var(--forge-ink-mute, #9aa1ab)',
                  marginLeft: 6,
                }}>· {h.desc}</span> : null}
              </span>
              <span style={{
                textAlign: 'right',
                color: 'var(--forge-ink-mute, #9aa1ab)',
                fontSize: 10,
              }}>{tsToText(h.ts)}</span>
            </div>
          ))}
        </div>
      )}

      <footer style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 0 0',
        borderTop: '1px solid var(--forge-rail-edge, #2a2d34)',
      }}>
        <span data-testid="forge-pdm-revisions-status"
              style={{
                fontSize: 10,
                color: 'var(--forge-ink-mute, #9aa1ab)',
              }}>
          {lastBumpAt
            ? `Last bump at ${new Date(lastBumpAt).toLocaleTimeString()} — persisted to ${STORAGE_KEY}.`
            : `Persists to localStorage[${STORAGE_KEY}]. SemVer 2.0 rules apply.`}
        </span>
      </footer>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.pdmRevisions` menu action, exposes the
// imperative open/close hooks for plugins / Archie tool calls, and
// installs the headless helper API mirror so the e2e + plugins can drive
// bumps without React mounted.

export function PdmRevisionsPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    // Imperative open / close.
    window.__forgeOpenPdmRevisions  = (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeClosePdmRevisions = () => setOpen(false);

    // Headless bump — for the e2e / plugins / Archie tool calls.
    // Mirrors window.__forgePdmRevisions + dispatches the bus event,
    // exactly like the React click path. Returns the new state object.
    window.__forgePdmRevisionsBump = (kind, opts) => {
      const prev = loadState();
      const ecn  = opts && typeof opts.ecn  === 'string' ? opts.ecn  : '';
      const desc = opts && typeof opts.desc === 'string' ? opts.desc : '';
      const next = applyBump(prev, kind, ecn, desc);
      if (next === prev) return prev;
      saveState(next);
      try {
        window.__forgePdmRevisions = {
          current: next.current,
          history: next.history.slice(),
        };
        window.dispatchEvent(new CustomEvent(FORGE_PDM_REVISIONS_EVENT, {
          detail: {
            kind,
            from: prev.current,
            to: next.current,
            ecn, desc,
            count: next.history.length,
          },
        }));
      } catch {}
      return next;
    };

    // Headless reset — for tests that want a known baseline.
    window.__forgePdmRevisionsReset = () => {
      const fresh = { current: INITIAL_VERSION, history: [] };
      saveState(fresh);
      try {
        window.__forgePdmRevisions = {
          current: fresh.current,
          history: fresh.history.slice(),
        };
      } catch {}
      return fresh;
    };

    // Publish the initial snapshot so the e2e can read it before the
    // panel is ever opened.
    try {
      const initial = loadState();
      window.__forgePdmRevisions = {
        current: initial.current,
        history: initial.history.slice(),
      };
    } catch {}

    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.pdmRevisions') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenPdmRevisions; } catch {}
      try { delete window.__forgeClosePdmRevisions; } catch {}
      try { delete window.__forgePdmRevisionsBump; } catch {}
      try { delete window.__forgePdmRevisionsReset; } catch {}
    };
  }, []);
  return <PdmRevisionsPanel open={open} onClose={() => setOpen(false)} />;
}

export default PdmRevisionsPanel;
