// PUSH-76 (Slice-44) — Selection Filter chip strip (Body / Face / Edge / Vertex).
//
// Up through PUSH-75 the only way to switch the *active selection filter*
// — i.e. the kind of subshape that picks land on — was to walk through
// the Edit menu (Edit → Filter · Bodies / Faces / Edges / Vertices) or
// fire the matching `edit.filter*` action via the command palette /
// Archie. The state was buried at the bottom of one of the Edit
// sub-menus, and there was no always-visible readout of "what kind of
// thing am I currently picking?" — a glaring miss compared to every
// other MCAD (SolidWorks ribbon "Selection Filter", Inventor Select
// menu, Fusion 360 selection drop-down, Plasticity left toolbar).
//
// PUSH-76 lights up an always-on top-left chip strip showing the four
// modes — Body / Face / Edge / Vertex — with the currently-active mode
// highlighted. Click any chip to switch the active filter.
//
// Wiring contract:
//
//   * The strip dispatches the existing `forge:menu-action` events the
//     menu surfaces already fire (edit.filterBody / filterFace /
//     filterEdge / filterVert). That hits ForgeShellV4's onMenuAction
//     handler (lines 706-721), which calls setSelection({ kind, ids: [] })
//     and showToast. The shell's useEffect at lines 174-178 then mirrors
//     `selection` into `window.__forgeSelection`, which is the canonical
//     read surface every other panel watches.
//
//   * The strip also dispatches a NEW canonical event,
//     `forge:filter-changed`, with detail { kind, source }. This is the
//     event other panels can subscribe to without having to grep menu
//     ids. Both events fire in the same tick (the menu-action drives the
//     React state update; the filter-changed announces the intent).
//
//   * On boot the strip publishes `window.__forgeSelectionFilter` so any
//     surface that needs the canonical "what filter is active?" can read
//     synchronously.
//
//   * The strip listens to:
//       - `forge:filter-changed`  (canonical, our own publish round-trip)
//       - `forge:selection-changed` (the same bus EntityProps / Measure /
//         Mass / Layers panels listen for — drives the highlight when an
//         external pick changes the selection kind, e.g. the viewport
//         picker setting kind='face' after a face click)
//       - `forge:menu-action` (catches Archie / command-palette firings
//         of `edit.filter*` so the highlight follows immediately, even
//         before React re-renders + the useEffect mirror to
//         window.__forgeSelection lands)
//
//   * Initial value: read `window.__forgeSelection?.kind` synchronously;
//     fall back to 'body' (the shell's setSelection({ kind: 'none' })
//     would render no chip highlighted, but 'body' is the canonical
//     "default" MCAD picker mode — and the first time a real selection
//     happens the bus subscriber will catch up).
//
// Hard constraints honoured:
//   * NO new npm packages, NO new C++ libs — React + the existing
//     forge:menu-action bus only.
//   * No MVP, no stub, no placeholder — every click round-trips through
//     the real shell handler, the highlight follows real state, and the
//     global signal is published from one place.
//   * Always-visible, auto-mounted (NOT a Host pattern) — the component
//     renders its own portal directly into <body> on mount and lives
//     for the whole session.
//   * Does NOT modify Menus.jsx, Viewport.jsx, or ForgeShellV4.jsx —
//     piggybacks on the bus + the window-level mirror that ForgeShellV4
//     already publishes.

import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// ────────────── constants ──────────────

// The four canonical filter kinds. Order matches the menu ordering in
// Menus.jsx (Face / Edge / Vert / Body) but we lead with Body in the
// strip because it's the most common default mode and reads first
// left-to-right in the user's eye-scan path.
const FILTER_KINDS = [
  { kind: 'body',   label: 'Body',   short: 'B',
    menuId: 'edit.filterBody',
    description: 'Pick whole solid bodies' },
  { kind: 'face',   label: 'Face',   short: 'F',
    menuId: 'edit.filterFace',
    description: 'Pick individual faces of bodies' },
  { kind: 'edge',   label: 'Edge',   short: 'E',
    menuId: 'edit.filterEdge',
    description: 'Pick individual edges of bodies' },
  { kind: 'vertex', label: 'Vertex', short: 'V',
    menuId: 'edit.filterVert',
    description: 'Pick individual vertices of bodies' },
];

// 12×12 glyphs. Matches the icon vocabulary of HeadsUpToolbar /
// DisplayStateQuickBar / SketchConstraintsToolbar so the four HUDs read
// as a coordinated set.
const FILTER_GLYPH = {
  // Body — a filled solid cube (perspective).
  body: (
    <>
      <path d="M2 4l4 -2 4 2v4l-4 2 -4 -2z" fill="currentColor" stroke="none" opacity="0.45" />
      <path d="M2 4l4 -2 4 2v4l-4 2 -4 -2z" />
      <path d="M2 4l4 2 4 -2M6 6v4" />
    </>
  ),
  // Face — one highlighted face quad on a wire cube.
  face: (
    <>
      <path d="M2 4l4 -2 4 2v4l-4 2 -4 -2z" />
      <path d="M2 4l4 2 4 -2M6 6v4" />
      <path d="M2 4l4 2 4 -2 -4 -2z" fill="currentColor" stroke="none" />
    </>
  ),
  // Edge — a single thick highlighted edge on a wire cube.
  edge: (
    <>
      <path d="M2 4l4 -2 4 2v4l-4 2 -4 -2z" opacity="0.55" />
      <path d="M2 4l4 2 4 -2M6 6v4" opacity="0.55" />
      <path d="M2 4l4 -2" strokeWidth="2.2" />
    </>
  ),
  // Vertex — a wire cube with one filled corner dot.
  vertex: (
    <>
      <path d="M2 4l4 -2 4 2v4l-4 2 -4 -2z" opacity="0.55" />
      <path d="M2 4l4 2 4 -2M6 6v4" opacity="0.55" />
      <circle cx="2" cy="4" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
};

const VALID_KINDS = new Set(FILTER_KINDS.map((k) => k.kind));

// ────────────── global signal ──────────────

// Publish to BOTH the synchronous global (`__forgeSelectionFilter`) and
// the async bus (`forge:filter-changed`) so consumers can pick whichever
// matches their wiring. Idempotent: setting the same kind twice still
// fires (so a click is observable even if the state hasn't moved — e.g.
// clicking the already-active Body chip still confirms the action).
function publishFilter(kind, source) {
  if (typeof window === 'undefined') return;
  window.__forgeSelectionFilter = kind;
  try {
    window.dispatchEvent(new CustomEvent('forge:filter-changed', {
      detail: { kind, source: source || 'strip' },
    }));
  } catch { /* dispatchEvent ctor can throw in old shells; ignore */ }
}

// Map `edit.filter*` menu ids → filter kind. Used by the menu-action
// subscriber to mirror Archie / command-palette firings into the chip
// highlight even before the React state mirror lands.
function menuIdToKind(id) {
  if (typeof id !== 'string') return null;
  switch (id) {
    case 'edit.filterBody': return 'body';
    case 'edit.filterFace': return 'face';
    case 'edit.filterEdge': return 'edge';
    case 'edit.filterVert': return 'vertex';
    default: return null;
  }
}

// Read the live filter kind off `window.__forgeSelection.kind`. The
// shell publishes a kind of 'none' when there's no selection — that
// doesn't tell us what the user *wants* to pick, so we fall back to the
// canonical default 'body' for the initial render. Returns one of the
// VALID_KINDS strings, never null.
function readInitialKind() {
  if (typeof window === 'undefined') return 'body';
  if (typeof window.__forgeSelectionFilter === 'string'
      && VALID_KINDS.has(window.__forgeSelectionFilter)) {
    return window.__forgeSelectionFilter;
  }
  const sel = window.__forgeSelection;
  const k = (sel && typeof sel.kind === 'string') ? sel.kind : null;
  if (k && VALID_KINDS.has(k)) return k;
  return 'body';
}

// ────────────── styles ──────────────

// Top-left, just below the menubar/ribbon. Sits to the left of
// SketchConstraintsToolbar (which only appears when a sketch session is
// active) and below HeadsUpToolbar (top-center). We hug the very top
// because (a) the user mandate says "always-visible filter chip strip
// in the top-left corner of the viewport" and (b) the selection filter
// is a viewport-mode indicator — it belongs at the highest tier of the
// viewport overlay stack.
const stripStyle = {
  position: 'fixed',
  left: 12,
  top: 'calc(var(--forge-ribbon-h, 96px) + 12px)',
  zIndex: 1320,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 8px',
  background: 'var(--forge-canvas-2, rgba(20, 24, 28, 0.92))',
  border: '1px solid var(--forge-rail-edge, rgba(255,255,255,0.12))',
  borderRadius: 6,
  color: 'var(--forge-ink, #d8e0ea)',
  fontFamily: 'var(--forge-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontSize: 10,
  letterSpacing: '0.04em',
  userSelect: 'none',
  pointerEvents: 'auto',
  boxShadow: '0 8px 18px rgba(0,0,0,0.45)',
  whiteSpace: 'nowrap',
};

const headerChipStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 6px',
  // Monochrome (Task #21 rule fix): grey accent-mute, never chromatic.
  background: 'var(--forge-accent-mute, rgba(255,255,255,0.08))',
  border: '1px solid var(--forge-rail-edge, rgba(255,255,255,0.12))',
  borderRadius: 3,
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--forge-ink, #d8e0ea)',
  textTransform: 'uppercase',
  alignSelf: 'center',
};

const buttonGroupStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  paddingLeft: 6,
  borderLeft: '1px solid var(--forge-rail-edge, rgba(255,255,255,0.18))',
};

const chipButtonStyle = (active) => ({
  display: 'inline-flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  width: 42,
  minHeight: 38,
  padding: '4px 2px',
  // Monochrome (Task #21 rule fix): active = filled grey accent with
  // tone-inverted ink (canvas-on-accent), inactive = transparent + muted
  // ink. NO chromatic blue anywhere — outline/tone only.
  background: active
    ? 'var(--forge-accent, #ebecef)'
    : 'transparent',
  border: '1px solid ' + (active
    ? 'var(--forge-accent, #ebecef)'
    : 'var(--forge-rail-edge, rgba(255,255,255,0.18))'),
  color: active
    ? 'var(--forge-canvas, #000000)'
    : 'var(--forge-ink-mute, #9aa3ad)',
  cursor: 'pointer',
  borderRadius: 3,
  outline: 'none',
  fontFamily: 'inherit',
  fontSize: 10,
  letterSpacing: '0.04em',
  gap: 2,
});

const chipLabelStyle = {
  fontSize: 9,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

// ────────────── component ──────────────

export function SelectionFilterStrip() {
  const [filter, setFilter] = useState(() => readInitialKind());

  // Publish the initial filter signal once on mount so any surface that
  // reads `window.__forgeSelectionFilter` on boot sees a sane value.
  useEffect(() => {
    publishFilter(filter, 'strip-mount');
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to all three buses simultaneously so the highlight stays
  // tight to reality regardless of which surface triggered the change.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    // (a) The canonical filter-changed bus we publish on. Round-trips
    //     from our own click (publishFilter → onFilter → setFilter), and
    //     also catches external publishes (e.g. the command palette or
    //     Archie deciding to swap filters).
    const onFilter = (e) => {
      const k = e?.detail?.kind;
      if (typeof k !== 'string' || !VALID_KINDS.has(k)) return;
      setFilter((prev) => (prev === k ? prev : k));
    };

    // (b) The shell's canonical selection bus. When the viewport picker
    //     or the entity-props / measure / layers panels publish a new
    //     selection with kind ∈ {body,face,edge,vertex}, mirror that
    //     kind into the highlight so the strip tracks the live picker
    //     mode without polling.
    const onSelection = (e) => {
      const k = e?.detail?.kind;
      if (typeof k !== 'string' || !VALID_KINDS.has(k)) return;
      setFilter((prev) => {
        if (prev === k) return prev;
        // Cross-publish on the filter bus so consumers that ONLY listen
        // to forge:filter-changed (not the broad selection bus) see the
        // implicit filter change too. Source='selection-mirror' so the
        // origin is debuggable in the activity log.
        publishFilter(k, 'selection-mirror');
        return k;
      });
    };

    // (c) The menu-action bus. The shell's onMenuAction handler reacts
    //     to edit.filter* by calling setSelection, but that's async via
    //     React state + useEffect mirror. Catching the same bus event
    //     here directly is the tight-coupling path so the chip highlight
    //     flips in the same tick as the click that fired it (whether
    //     the click came from us, the menu, Archie, or the palette).
    const onMenu = (e) => {
      const k = menuIdToKind(e?.detail?.id);
      if (!k) return;
      setFilter((prev) => {
        if (prev === k) {
          publishFilter(k, e?.detail?.source || 'menu-action');
          return prev;
        }
        publishFilter(k, e?.detail?.source || 'menu-action');
        return k;
      });
    };

    window.addEventListener('forge:filter-changed', onFilter);
    window.addEventListener('forge:selection-changed', onSelection);
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:filter-changed', onFilter);
      window.removeEventListener('forge:selection-changed', onSelection);
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);

  // Click handler: dispatch the existing edit.filter* menu action via
  // the bus so the shell's onMenuAction runs (which calls setSelection
  // and triggers the toast + the __forgeSelection mirror). The onMenu
  // listener above will see the same bus event and update our local
  // highlight; we also defensively setFilter immediately so we don't
  // depend on the listener round-trip ordering (same-value setState is
  // a no-op, so there's no double-render).
  const dispatch = useCallback((kind) => {
    const def = FILTER_KINDS.find((k) => k.kind === kind);
    if (!def) return;
    if (typeof window === 'undefined') return;
    try {
      window.dispatchEvent(new CustomEvent('forge:menu-action', {
        detail: { id: def.menuId, source: 'selection-filter-strip' },
      }));
    } catch { /* ignore */ }
    setFilter((prev) => {
      publishFilter(kind, 'strip-click');
      return kind;
    });
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div style={stripStyle}
         data-testid="forge-selection-filter-strip"
         data-active-filter={filter}
         role="toolbar"
         aria-label="Selection filter strip">

      {/* Header chip — primary readout of the active kind. */}
      <span style={headerChipStyle}
            data-testid="forge-selection-filter-header"
            data-kind={filter}
            aria-live="polite"
            title="Active selection filter">
        Filter
      </span>

      {/* Chip buttons — one per filter kind. */}
      <span style={buttonGroupStyle}
            data-testid="forge-selection-filter-buttons">
        {FILTER_KINDS.map((def) => {
          const active = def.kind === filter;
          return (
            <button key={def.kind}
                    type="button"
                    style={chipButtonStyle(active)}
                    data-testid={`forge-selection-filter-${def.kind}`}
                    data-kind={def.kind}
                    data-active={String(active)}
                    aria-label={`Filter selection to ${def.label}`}
                    aria-pressed={String(active)}
                    title={`${def.label} · ${def.description}`}
                    onClick={() => dispatch(def.kind)}>
              <svg width="14" height="14" viewBox="0 0 12 12"
                   fill="none"
                   stroke="currentColor"
                   strokeWidth="1.2"
                   strokeLinecap="round"
                   strokeLinejoin="round"
                   aria-hidden="true">
                {FILTER_GLYPH[def.kind]}
              </svg>
              <span style={chipLabelStyle}>{def.label}</span>
            </button>
          );
        })}
      </span>
    </div>,
    document.body,
  );
}

export default SelectionFilterStrip;
