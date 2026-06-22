// Task #21 (Enterprise CAD UI/UX) — selection-filter pure logic + the
// imperative window-API store.
//
// The recon found SelectionFilterStrip.jsx already publishes the string
// `window.__forgeSelectionFilter` (read by push-76 + the strip's own
// boot path) and the `forge:filter-changed` bus. We MUST NOT clobber
// that string contract (407 e2e specs + the strip depend on it being a
// kind string). So this module adds a SEPARATE imperative namespace
// `window.__forgeSelectionFilterApi` with .set / .get / .cycle that
// mutates plain module state + round-trips through the SAME bus the
// strip listens on — no React setter is ever called (no-setState rule).
//
// It also owns the pure kind→noun map the status-bar mirror uses, so the
// footer can render "Picking: Faces" without re-deriving the vocabulary.

export const FILTER_KINDS = ['body', 'face', 'edge', 'vertex'];

const NOUN = {
  body: ['Body', 'Bodies'],
  face: ['Face', 'Faces'],
  edge: ['Edge', 'Edges'],
  vertex: ['Vertex', 'Vertices'],
};

export function isFilterKind(k) {
  return typeof k === 'string' && FILTER_KINDS.includes(k);
}

// kind → footer noun. count chooses singular/plural; default plural
// (the filter names a *class* of pickable entity, e.g. "Faces").
export function filterNoun(kind, count = 0) {
  const pair = NOUN[kind];
  if (!pair) return kind || '';
  return count === 1 ? pair[0] : pair[1];
}

// Next kind in the canonical cycle (Body→Face→Edge→Vertex→Body). An
// unknown current kind defaults to the first kind ('body').
export function nextFilterKind(kind) {
  const i = FILTER_KINDS.indexOf(kind);
  if (i < 0) return FILTER_KINDS[0];
  return FILTER_KINDS[(i + 1) % FILTER_KINDS.length];
}

// Map a filter kind → the edit.filter* menu id the shell handler runs.
export function filterMenuId(kind) {
  switch (kind) {
    case 'body': return 'edit.filterBody';
    case 'face': return 'edit.filterFace';
    case 'edge': return 'edit.filterEdge';
    case 'vertex': return 'edit.filterVert';
    default: return null;
  }
}

// Plain module state — the imperative half. React surfaces read the
// string `window.__forgeSelectionFilter` (owned by the strip) OR
// subscribe to forge:filter-changed; this just drives the bus.
let _kind = 'body';

export function getFilter() {
  // Prefer the canonical published string when present (the strip is the
  // source of truth once mounted); fall back to our local mirror.
  if (typeof window !== 'undefined' && isFilterKind(window.__forgeSelectionFilter)) {
    _kind = window.__forgeSelectionFilter;
  }
  return _kind;
}

// Imperative setter — NO setState. Mutates module state, publishes the
// canonical string, and fires BOTH buses the strip + shell react to:
//   forge:menu-action (id=edit.filter*) → ForgeShellV4.onMenuAction
//   forge:filter-changed (kind)         → strip highlight + consumers
export function setFilter(kind, source = 'filter-api') {
  if (!isFilterKind(kind)) return getFilter();
  _kind = kind;
  if (typeof window === 'undefined') return _kind;
  window.__forgeSelectionFilter = kind;   // preserve the string contract
  const menuId = filterMenuId(kind);
  try {
    if (menuId) {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: menuId, source } }));
    }
    window.dispatchEvent(new CustomEvent('forge:filter-changed',
      { detail: { kind, source } }));
  } catch { /* ignore */ }
  return _kind;
}

export function cycleFilter(source = 'filter-api-cycle') {
  return setFilter(nextFilterKind(getFilter()), source);
}

// Install the imperative namespace. Returns an uninstall fn (host
// unmount calls it) per the CommandPaletteHost lifecycle pattern.
export function installSelectionFilterApi() {
  if (typeof window === 'undefined') return () => {};
  window.__forgeSelectionFilterApi = {
    set: (k) => setFilter(k, 'api-set'),
    get: () => getFilter(),
    cycle: () => cycleFilter('api-cycle'),
    kinds: () => FILTER_KINDS.slice(),
    noun: (k, n) => filterNoun(k, n),
  };
  return () => { try { delete window.__forgeSelectionFilterApi; } catch { /* ignore */ } };
}
