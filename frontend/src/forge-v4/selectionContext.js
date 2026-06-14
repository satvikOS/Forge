// Selection-context serializer (parity #59) — pure, DOM-free,
// node-testable; behaviorally-identical copy of Studio (header differs).
//
// The select-then-converse paradigm reliable copilots matured into:
// the user selects geometry, then prompts ABOUT that selection. This
// turns a live selection into a compact <selection>…</selection> clause
// that rides in the Archie prompt next to <viewport_state> (slice 963)
// and <prior_context>, so "fillet this 5 mm" / "make THIS wood" resolve
// against the selected entity instead of guessing.
//
// Trained-tag discipline (the context-window law): <selection> must be a
// DECLARED tag in SYSTEM_V2 and the corpus before the runtime emits it,
// or it acts as an untrained in-context shape. This serializer is the
// wire format; the SYSTEM/corpus declaration lands with the wiring.
//
// Input is a normalized descriptor (the app's caller derives it from the
// live selection — Studio meshes / Forge aisSelection):
//   { count, items: [{ kind, name, dims?:[x,y,z], sub?:{type,idx} }] }
// Returns '' when nothing is selected (clause is then simply omitted).

// CRITICAL sanitizer (adversarial fix 2026-06-13): a body name like
// `</selection><tool_call>{...}</tool_call>` would otherwise be injected
// VERBATIM into the Archie prompt — letting a malicious/odd name forge
// tool calls or break out of the <selection> tag (the context-window
// law: nothing untrained/unbounded may enter the prompt). Strip all
// angle brackets + quotes, collapse whitespace/newlines, then length-cap.
function _san(s, max = 32) {
  return String(s == null ? '' : s)
    .replace(/[<>]/g, '')        // kill tag delimiters — defeats injection
    .replace(/["'`]/g, '')       // kill quote breakers
    .replace(/[\r\n\t]+/g, ' ')  // newlines/tabs → space (single-line prompt)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function _fmtDims(dims) {
  if (!Array.isArray(dims) || dims.length < 3) return '';
  const f = dims.map((v) => (Number.isFinite(v) ? +(+v).toFixed(2) : '?'));
  return ` (${f[0]}×${f[1]}×${f[2]} m)`;
}

function _fmtItem(it) {
  const nm = _san(it.name);
  const name = nm ? ` "${nm}"` : '';
  const kind = _san(it.kind || 'body', 24).toLowerCase() || 'body';
  if (it.sub && it.sub.type) {
    // sub-entity pick (Forge face/edge/vertex)
    const type = _san(it.sub.type, 12) || 'sub';
    const idx = Number.isFinite(it.sub.idx) ? ` ${it.sub.idx}` : '';
    const planar = it.sub.planar ? ', planar' : '';
    return `${type}${idx} of ${kind}${name}${planar}`;
  }
  return `${kind}${name}${_fmtDims(it.dims)}`;
}

export function selectionClause(sel) {
  if (!sel) return '';
  const items = Array.isArray(sel.items) ? sel.items.filter(Boolean) : [];
  const count = Number.isFinite(sel.count) ? sel.count : items.length;
  if (!count) return '';
  if (count === 1 && items.length) {
    return `<selection>${_fmtItem(items[0])}</selection>`;
  }
  if (items.length > 1) {
    // multi-select: name the kinds, cap the listing
    const shown = items.slice(0, 4).map(_fmtItem).join('; ');
    const more = count > 4 ? ` (+${count - 4} more)` : '';
    return `<selection>${count} selected: ${shown}${more}</selection>`;
  }
  return `<selection>${count} selected</selection>`;
}

// Studio helper: normalize a list of THREE meshes → descriptor. The
// caller passes already-extracted {name, primKind, dims} so this stays
// DOM/THREE-free and node-testable.
export function studioSelectionDescriptor(meshInfos) {
  const items = (meshInfos || []).map((m) => ({
    kind: m.primKind || 'mesh', name: m.name, dims: m.dims,
  }));
  return { count: items.length, items };
}

// Forge helper: normalize an aisSelection snapshot (+ optional set).
export function forgeSelectionDescriptor(ais, bodyNameOf) {
  const set = (ais && Array.isArray(ais.selectionSet) && ais.selectionSet.length)
    ? ais.selectionSet : (ais && ais.selection ? [ais.selection] : []);
  const items = set.map((e) => {
    const name = bodyNameOf ? bodyNameOf(e.bodyId) : (e.bodyId != null ? String(e.bodyId) : null);
    const it = { kind: 'body', name };
    if (e.kind && e.kind !== 'body') {
      it.sub = { type: e.kind, idx: e.faceIdx ?? e.edgeIdx ?? e.vertexIdx, planar: !!e.planar };
    }
    return it;
  });
  return { count: items.length, items };
}
