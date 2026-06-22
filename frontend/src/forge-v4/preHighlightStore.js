// Task #21 (Enterprise CAD UI/UX) — sub-entity PRE-HIGHLIGHT store.
//
// NX / CATIA call this "preselect": as the cursor moves over geometry,
// the entity under the pointer (face / edge / vertex / body) pre-
// highlights BEFORE the click commits the selection. Up through the
// recon Forge only had a body-level hover signal (window.__forgeHovered
// read by HoverTooltip) — no sub-entity pre-highlight, and no QuickPick
// disambiguation when several entities stack under the cursor.
//
// This module is the canonical, DOM-free, node-testable store for the
// pre-highlight state. It is the imperative half of the window-API
// no-setState contract (MEMORY feedback-studio-window-api-no-setstate):
// the window API mutates THIS module + dispatches a CustomEvent;
// React surfaces (SelectionHighlight / QuickPickHost) subscribe via
// addEventListener and READ the store — never a React setter.
//
// Shape of a pre-highlight descriptor (all fields optional except kind):
//   { kind: 'body'|'face'|'edge'|'vertex',
//     handle: number,          // owning body handle
//     subType: 'face'|'edge'|'vertex'|null,  // alias of kind for sub picks
//     subIdx: number|null,     // sub-entity index within the body
//     name: string|null,       // owning body name (display)
//     candidates: [...] }      // optional QuickPick stack under the cursor

const VALID_KINDS = new Set(['body', 'face', 'edge', 'vertex']);

// Module-level imperative state. ONE authority; React reads this.
let _hover = null;          // current pre-highlight descriptor (or null)
let _candidates = [];       // QuickPick stack (≥2 ⇒ disambiguation UI)

const EVENT = 'forge:prehighlight';

function _dispatch() {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(EVENT, {
      detail: { hover: _hover, candidates: _candidates.slice() },
    }));
  } catch { /* CustomEvent ctor can throw in stub shells; ignore */ }
}

// Normalize an arbitrary caller descriptor into the canonical shape, or
// null when the input is not a usable pre-highlight. A bad/empty input
// is a CONSERVATIVE no-op (returns null) — never throws.
export function normalizeHover(desc) {
  if (!desc || typeof desc !== 'object') return null;
  const kind = typeof desc.kind === 'string' ? desc.kind.toLowerCase() : null;
  if (!kind || !VALID_KINDS.has(kind)) return null;
  const handle = Number.isFinite(desc.handle) ? desc.handle : null;
  // sub picks (face/edge/vertex) carry an index INTO the owning body.
  const isSub = kind !== 'body';
  let subIdx = null;
  if (isSub) {
    const raw = desc.subIdx ?? desc.idx ?? desc.faceIdx ?? desc.edgeIdx ?? desc.vertexIdx;
    subIdx = Number.isFinite(raw) ? raw : null;
  }
  return {
    kind,
    handle,
    subType: isSub ? kind : null,
    subIdx,
    name: (typeof desc.name === 'string' && desc.name) ? desc.name : null,
  };
}

// Set the current pre-highlight. Returns the normalized descriptor (or
// null when cleared / invalid). Dispatches on every accepted change.
export function setHover(desc) {
  const next = normalizeHover(desc);
  _hover = next;
  _dispatch();
  return next;
}

// Replace the QuickPick candidate stack (entities under the cursor). A
// stack of ≥2 means the disambiguation chooser should show. Each entry
// is normalized like a hover descriptor; non-normalizable entries drop.
export function setCandidates(list) {
  const arr = Array.isArray(list) ? list : [];
  _candidates = arr.map(normalizeHover).filter(Boolean);
  _dispatch();
  return _candidates.slice();
}

export function clearHover() {
  _hover = null;
  _candidates = [];
  _dispatch();
}

export function getHover() { return _hover; }
export function getCandidates() { return _candidates.slice(); }

// A QuickPick chooser is warranted only when ≥2 distinct entities sit
// under the cursor.
export function hasQuickPick() { return _candidates.length >= 2; }

// One-line readout for HUD / status surfaces. Empty string when nothing
// is pre-highlighted.
export function hoverLabel(h = _hover) {
  if (!h) return '';
  if (h.kind === 'body') {
    return h.name ? `Body · ${h.name}` : 'Body';
  }
  const noun = h.kind.charAt(0).toUpperCase() + h.kind.slice(1);
  const idx = Number.isFinite(h.subIdx) ? ` ${h.subIdx}` : '';
  const owner = h.name ? ` · ${h.name}` : '';
  return `${noun}${idx}${owner}`;
}

export const PREHIGHLIGHT_EVENT = EVENT;
