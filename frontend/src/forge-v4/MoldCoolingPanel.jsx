// PUSH-96 (Slice-64) — Mold Cooling Channels panel.
//
// Mold tooling needs *cooling channels* — drilled cylindrical bores
// through the mold block parallel to the parting line — for heat
// extraction during the injection cycle. The OCCT-backed kernel surface
// already lands the geometry via forge.mold.insertCoolingChannels
// (binding.cpp lines 5332-5367, Mold.cpp insertCoolingChannels lines
// 324-365): for every channel it builds a BRepPrimAPI_MakeCylinder
// frame along the start→end axis at half the diameter and runs
// BRepAlgoAPI_Cut to subtract from the running block, returning the
// drilled solid. PUSH-08's MoldWorkbench has a *single* canned demo
// button hitting the surface — PUSH-96 ships the real production panel:
//
//   * pick the mold block body (or seed a fresh 100×60×40 block),
//   * define N channels in a live table — Start (x,y,z), End (x,y,z),
//     Diameter (mm), with Add / Remove row controls,
//   * Apply runs forge.mold.insertCoolingChannels(blockH, channels[])
//     in one kernel call (the kernel iterates the cut internally) and
//     commits the drilled solid via window.__forgeAppendBody so the
//     v4 shell rebuilds the feature tree + meshes.
//   * Status chips surface volume-before / volume-after / drilled-out
//     volume (Δ ≈ Σ π·r²·L) so the e2e can assert kernel geometry.
//   * Channel-path visualisation: every channel emits a synthetic
//     kind:'group' body of point-pairs (start, end) so SceneMeshes
//     renders the centerlines next to the drilled block.
//
// Wiring contract:
//   * Mount:        <MoldCoolingPanelHost /> in App.jsx.
//   * Menu:         tools.moldCooling (in Menus.jsx).
//   * Imperative:   window.__forgeOpenMoldCoolingPanel(bool).
//   * Bus event:    forge:mold-cooling-applied.
//   * Reads:        window.__forgeBodies, window.__forgeSelection,
//                   window.forge.mold.insertCoolingChannels,
//                   window.forge.massProps, window.forge.makeBox.
//
// Hard constraints honoured:
//   * NO new npm / C++ / external deps — React + the existing
//     window.forge surface + window.__forge* bus from ForgeShellV4.
//   * No MVP, no stub — Apply hits the real OCCT cut, not a
//     synthetic placeholder. If the kernel surface is missing the
//     status chip reports it honestly.
//   * Does NOT modify Viewport.jsx, ForgeShellV4.jsx, MoldWorkbench
//     (PUSH-08), or any other panel. Coexists alongside MoldWorkbench
//     as a sibling host.
//   * Multi-cam e2e: 5 named camera angles per Forge-171 mandate.
//   * Coordinates with the 9-agent parallel parity push by only
//     touching: MoldCoolingPanel.jsx (NEW), Menus.jsx (one new
//     tools.moldCooling entry), App.jsx (one new <Host /> mount),
//     and e2e/push-96-mold-cooling.spec.js (NEW).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

// ─────────────────────────────────────────────────────────────────────
// Defaults — a sane seed mold block + a sane first channel so the
// table is never empty on first open.

const DEFAULT_BLOCK = { dx: 100, dy: 60, dz: 40 };
// A first channel running along +Y at half-depth, 6 mm diameter — the
// industrial sweet spot for an MUD mold base copper bore.
const DEFAULT_CHANNEL = () => ({
  id: `ch-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  start: [10, 0, 20],
  end:   [10, 60, 20],
  diameter: 6,
});

// Two channels in a parallel pattern — Apply seed pair so users see
// the cross-block layout on first open.
function seedChannels() {
  return [
    { id: 'ch-seed-1', start: [25, 0, 20], end: [25, 60, 20], diameter: 6 },
    { id: 'ch-seed-2', start: [75, 0, 20], end: [75, 60, 20], diameter: 6 },
  ];
}

// ─────────────────────────────────────────────────────────────────────
// Pure helpers — derive length, volume, and the channel-path body. Pure
// math, no kernel call, so the e2e helper can replay them without an
// Electron window.

export function channelLength(ch) {
  const dx = ch.end[0] - ch.start[0];
  const dy = ch.end[1] - ch.start[1];
  const dz = ch.end[2] - ch.start[2];
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return Number.isFinite(L) ? L : 0;
}

export function channelVolume(ch) {
  const r = ch.diameter / 2;
  const L = channelLength(ch);
  return Math.PI * r * r * L;
}

export function totalChannelVolume(channels) {
  let v = 0;
  for (const ch of channels) v += channelVolume(ch);
  return v;
}

function isValidChannel(ch) {
  if (!ch) return false;
  if (!Array.isArray(ch.start) || ch.start.length !== 3) return false;
  if (!Array.isArray(ch.end)   || ch.end.length   !== 3) return false;
  for (const c of [...ch.start, ...ch.end]) {
    if (typeof c !== 'number' || !Number.isFinite(c)) return false;
  }
  if (typeof ch.diameter !== 'number' || !(ch.diameter > 0)) return false;
  if (!(channelLength(ch) > 1e-6)) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────
// Read live mold-block candidates from window.__forgeBodies. A
// candidate is any native body whose name suggests "mold block" OR the
// most-recent native body if no name matches (so a fresh box seeded
// by the panel itself is picked automatically).

function readNativeBodies() {
  if (typeof window === 'undefined') return [];
  const arr = window.__forgeBodies;
  if (!Array.isArray(arr)) return [];
  return arr.filter((b) => b && b.kind === 'native' && typeof b.handle === 'number');
}

// ─────────────────────────────────────────────────────────────────────
// Styles — same rail aesthetic as the BOM Balloons / GD&T / Layers
// docked panels.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 480,
  zIndex: 1337,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  overflowY: 'auto',
  boxShadow: '-8px 0 18px rgba(0,0,0,0.30)',
};
const HEADER_ROW = {
  display: 'flex', alignItems: 'center', gap: 8,
  borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
  paddingBottom: 6,
};
const TITLE = {
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 12, fontWeight: 600, letterSpacing: '0.04em',
  textTransform: 'uppercase', color: 'var(--forge-ink, #dadde2)',
  flex: 1,
};
const SUBTITLE = {
  fontSize: 10,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  letterSpacing: '0.03em',
};
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3, fontSize: 11, lineHeight: 1,
};
const SECTION_TITLE = {
  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  margin: '6px 0 4px',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};
const STATUS_CHIPS_ROW = {
  display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 6, paddingBottom: 4,
};
const STATUS_CHIP = (tone) => ({
  display: 'flex', flexDirection: 'column', gap: 2,
  padding: '4px 6px',
  border: '1px solid ' + (tone === 'ok'   ? '#3e7a4a'
                       : tone === 'warn' ? '#7a6c3e'
                       : tone === 'err'  ? '#7a3e3e'
                       : 'var(--forge-rail-edge, #2a2d34)'),
  background: tone === 'ok'   ? 'rgba(62,122,74,0.10)'
            : tone === 'warn' ? 'rgba(122,108,62,0.10)'
            : tone === 'err'  ? 'rgba(122,62,62,0.10)'
            : 'var(--forge-canvas, #0d1117)',
  borderRadius: 3,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
});
const CHIP_LABEL = {
  fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
};
const CHIP_VALUE = {
  fontSize: 12, fontWeight: 600,
  color: 'var(--forge-ink, #dadde2)',
};
const TABLE_HEAD = {
  display: 'grid',
  gridTemplateColumns: '24px 1fr 1fr 56px 28px',
  gap: 4, alignItems: 'center',
  padding: '4px 4px',
  fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.04em',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};
const TABLE_ROW = {
  display: 'grid',
  gridTemplateColumns: '24px 1fr 1fr 56px 28px',
  gap: 4, alignItems: 'center',
  padding: '4px 4px',
  fontSize: 10,
  borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};
const TRIPLE = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 2,
};
const FIELD = {
  width: '100%', boxSizing: 'border-box', minWidth: 0,
  background: 'var(--forge-canvas, #0d1117)',
  color: 'var(--forge-ink, #dadde2)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 2, padding: '3px 4px',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10,
};
const ROW_INDEX = {
  fontSize: 10, fontWeight: 600,
  color: 'var(--forge-ink-mute, #9aa1ab)',
  textAlign: 'center',
};
const ICON_BTN = (enabled) => ({
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: enabled ? 'var(--forge-ink, #dadde2)' : 'var(--forge-ink-mute, #6e757d)',
  cursor: enabled ? 'pointer' : 'not-allowed',
  padding: '2px 4px', borderRadius: 2,
  fontSize: 11, lineHeight: 1,
});
const BTN_ROW = {
  display: 'flex', gap: 6, paddingTop: 4,
};
const BTN = (variant) => ({
  background: variant === 'primary' ? 'var(--forge-accent, #2c8af2)'
            : variant === 'danger'  ? 'var(--forge-danger, #c1473a)'
            : 'var(--forge-surface, #1f242c)',
  color: variant === 'primary' || variant === 'danger'
            ? '#fff'
            : 'var(--forge-ink, #dadde2)',
  border: 'none', borderRadius: 3,
  padding: '5px 10px',
  cursor: 'pointer',
  fontWeight: 600,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
});
const BLOCK_PICK_ROW = {
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  gap: 6, alignItems: 'center',
};
const SELECT = {
  ...FIELD, fontSize: 11, padding: '4px 6px',
};
const ERROR_BOX = {
  marginTop: 4,
  padding: '6px 8px',
  background: 'rgba(122,62,62,0.12)',
  border: '1px solid #6d3434',
  borderRadius: 3,
  color: '#f1c4c4',
  fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};
const LOG_ROW = {
  display: 'grid',
  gridTemplateColumns: '70px 1fr 70px',
  gap: 6, alignItems: 'center',
  padding: '4px 6px',
  fontSize: 10,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
};

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

export function MoldCoolingPanel({ open, onClose }) {
  const [bodies, setBodies]       = useState(() => readNativeBodies());
  const [blockId, setBlockId]     = useState(null);
  const [channels, setChannels]   = useState(() => seedChannels());
  const [status, setStatus] = useState({
    lastResult: 'idle',
    lastVolumeBefore: null,
    lastVolumeAfter: null,
    lastDelta: null,
    lastDrilledHandle: null,
    lastChannelCount: 0,
    lastError: null,
    log: [],
  });

  // Live subscribe to body bus so the picker reflects new seeds.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const refresh = () => setBodies(readNativeBodies());
    window.addEventListener('forge:bodies-changed', refresh);
    // The shell doesn't always publish a dedicated event for body
    // mutations — re-read on a low-frequency interval as a safety net
    // for first-open after a fresh seed (cleared on close).
    const id = setInterval(refresh, 500);
    return () => {
      window.removeEventListener('forge:bodies-changed', refresh);
      clearInterval(id);
    };
  }, []);

  // Re-read on every open so a fresh body is auto-selectable.
  useEffect(() => {
    if (!open) return;
    const next = readNativeBodies();
    setBodies(next);
    // Auto-select the most-recent native body if nothing picked yet.
    if (blockId === null && next.length > 0) {
      setBlockId(next[next.length - 1].id);
    }
  }, [open, blockId]);

  // Helpers --------------------------------------------------------

  const selectedBlock = useMemo(
    () => bodies.find((b) => b.id === blockId) || null,
    [bodies, blockId]
  );

  const validChannels = useMemo(
    () => channels.filter(isValidChannel),
    [channels]
  );

  const totalCut = useMemo(
    () => totalChannelVolume(validChannels),
    [validChannels]
  );

  // Seed a default mold block when the scene has no native body to
  // start from. Hitting the kernel directly here keeps the flow honest
  // (the resulting body is committed through __forgeAppendBody so the
  // viewport renders it immediately).
  const onSeedBlock = useCallback(() => {
    if (typeof window === 'undefined') return;
    const f = window.forge;
    if (!f || typeof f.makeBox !== 'function' || typeof window.__forgeAppendBody !== 'function') {
      setStatus((p) => ({ ...p, lastResult: 'no-forge', lastError: 'forge.makeBox or __forgeAppendBody unavailable' }));
      return;
    }
    try {
      const h = f.makeBox(DEFAULT_BLOCK.dx, DEFAULT_BLOCK.dy, DEFAULT_BLOCK.dz);
      const id = `mold-block-${Date.now()}`;
      window.__forgeAppendBody({
        id, kind: 'native', handle: h,
        toolId: 'solid.box', name: 'Mold Block',
        params: { width: DEFAULT_BLOCK.dx, height: DEFAULT_BLOCK.dy, distance: DEFAULT_BLOCK.dz },
      });
      // The bus subscriber will rehydrate bodies; pin the new id so
      // selection follows.
      setBlockId(id);
      setStatus((p) => ({ ...p, lastResult: 'block-seeded', lastError: null }));
    } catch (ex) {
      setStatus((p) => ({ ...p, lastResult: 'seed-error', lastError: String(ex?.message || ex) }));
    }
  }, []);

  const onAddChannel = useCallback(() => {
    setChannels((cs) => [...cs, DEFAULT_CHANNEL()]);
  }, []);

  const onRemoveChannel = useCallback((id) => {
    setChannels((cs) => cs.filter((c) => c.id !== id));
  }, []);

  const onUpdateChannel = useCallback((id, patch) => {
    setChannels((cs) => cs.map((c) => c.id === id ? { ...c, ...patch } : c));
  }, []);

  const onResetChannels = useCallback(() => {
    setChannels(seedChannels());
  }, []);

  // Hot path: apply forge.mold.insertCoolingChannels on the selected
  // block + valid channels, commit the drilled solid via
  // __forgeAppendBody, and surface the volume-before/after delta so the
  // e2e (and humans) can verify the kernel actually subtracted material.
  const onApply = useCallback(() => {
    if (typeof window === 'undefined') return null;
    const f = window.forge;
    if (!f) {
      const r = { result: 'no-forge', error: 'window.forge missing' };
      setStatus((p) => ({ ...p, lastResult: r.result, lastError: r.error }));
      return r;
    }
    if (!f.mold || typeof f.mold.insertCoolingChannels !== 'function') {
      const r = { result: 'no-surface', error: 'forge.mold.insertCoolingChannels unavailable' };
      setStatus((p) => ({ ...p, lastResult: r.result, lastError: r.error }));
      return r;
    }
    if (!selectedBlock) {
      const r = { result: 'no-block', error: 'pick a mold block first' };
      setStatus((p) => ({ ...p, lastResult: r.result, lastError: r.error }));
      return r;
    }
    const liveChannels = channels.filter(isValidChannel);
    if (liveChannels.length === 0) {
      const r = { result: 'no-channels', error: 'add at least one valid channel' };
      setStatus((p) => ({ ...p, lastResult: r.result, lastError: r.error }));
      return r;
    }
    const blockH = selectedBlock.handle;
    let volumeBefore = null;
    try {
      if (typeof f.massProps === 'function') {
        const m = f.massProps(blockH);
        if (m && typeof m.volume === 'number') volumeBefore = Math.abs(m.volume);
      }
    } catch { /* swallow — surface as 'unknown' below */ }

    let drilledH;
    try {
      drilledH = f.mold.insertCoolingChannels(
        blockH,
        liveChannels.map((ch) => ({
          start: ch.start.slice(),
          end:   ch.end.slice(),
          diameter: ch.diameter,
        })),
      );
    } catch (ex) {
      const r = { result: 'kernel-error', error: String(ex?.message || ex) };
      setStatus((p) => ({
        ...p,
        lastResult: r.result,
        lastError: r.error,
        log: [{ ts: Date.now(), result: r.result, count: liveChannels.length, volumeBefore, volumeAfter: null, delta: null }, ...p.log].slice(0, 10),
      }));
      try {
        window.dispatchEvent(new CustomEvent('forge:mold-cooling-applied', {
          detail: { result: r.result, error: r.error, channels: liveChannels.length, blockId: selectedBlock.id },
        }));
      } catch { /* ignore */ }
      return r;
    }
    if (typeof drilledH !== 'number' || !Number.isFinite(drilledH)) {
      const r = { result: 'no-handle', error: `expected kernel handle, got ${typeof drilledH}` };
      setStatus((p) => ({ ...p, lastResult: r.result, lastError: r.error }));
      return r;
    }

    let volumeAfter = null;
    try {
      if (typeof f.massProps === 'function') {
        const m = f.massProps(drilledH);
        if (m && typeof m.volume === 'number') volumeAfter = Math.abs(m.volume);
      }
    } catch { /* surface as 'unknown' */ }

    const delta = (volumeBefore != null && volumeAfter != null)
      ? (volumeBefore - volumeAfter) : null;

    // Commit the drilled solid as a fresh native body so SceneMeshes
    // rebuilds it. The original block stays in the scene; that mirrors
    // every other mold workbench in the industry where the parametric
    // block is preserved for downstream edits.
    const id = `mold-drilled-${Date.now()}`;
    try {
      window.__forgeAppendBody({
        id, kind: 'native', handle: drilledH,
        toolId: 'mold.coolingChannels',
        name: `${selectedBlock.name || 'Mold Block'} (cooled)`,
        params: {
          channels: liveChannels.map((ch) => ({
            start: ch.start.slice(), end: ch.end.slice(), diameter: ch.diameter,
          })),
          sourceBlockId: selectedBlock.id,
        },
      });
    } catch (ex) {
      const r = { result: 'append-error', error: String(ex?.message || ex), handle: drilledH };
      setStatus((p) => ({ ...p, lastResult: r.result, lastError: r.error }));
      return r;
    }

    // Visualise channel paths: emit a synthetic group body of
    // start/end pairs so SceneMeshes renders thin centerlines along
    // each drilled channel. The scene's InstancedGroup picker treats
    // any 'group' body with `lines` as a polyline collection.
    try {
      const linesId = `mold-channels-${Date.now()}`;
      window.__forgeAppendBody({
        id: linesId, kind: 'group',
        toolId: 'mold.coolingChannels.viz',
        name: 'Cooling Channel Paths',
        lines: liveChannels.map((ch) => ({
          start: ch.start.slice(), end: ch.end.slice(),
        })),
        params: { kind: 'channels', count: liveChannels.length },
      });
    } catch { /* visualization is non-critical */ }

    try {
      window.dispatchEvent(new CustomEvent('forge:mold-cooling-applied', {
        detail: {
          result: 'kernel-ok',
          blockId: selectedBlock.id,
          drilledHandle: drilledH,
          channels: liveChannels.length,
          volumeBefore, volumeAfter, delta,
        },
      }));
    } catch { /* ignore */ }

    setStatus((p) => ({
      lastResult: 'kernel-ok',
      lastVolumeBefore: volumeBefore,
      lastVolumeAfter: volumeAfter,
      lastDelta: delta,
      lastDrilledHandle: drilledH,
      lastChannelCount: liveChannels.length,
      lastError: null,
      log: [{
        ts: Date.now(), result: 'kernel-ok', count: liveChannels.length,
        volumeBefore, volumeAfter, delta,
      }, ...p.log].slice(0, 10),
    }));

    return {
      result: 'kernel-ok',
      drilledHandle: drilledH,
      volumeBefore, volumeAfter, delta,
      channelCount: liveChannels.length,
    };
  }, [selectedBlock, channels]);

  // Imperative hook for plugins, Archie tool calls, e2e — same shape
  // as every other panel's __forge*Helper / Apply mirror.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeApplyMoldCooling = onApply;
    window.__forgeMoldCoolingState = () => ({
      blockId,
      channels: channels.map((c) => ({ ...c, start: c.start.slice(), end: c.end.slice() })),
      validChannelCount: validChannels.length,
      totalCutEstimate: totalCut,
    });
    return () => {
      try { delete window.__forgeApplyMoldCooling; } catch { /* ignore */ }
      try { delete window.__forgeMoldCoolingState; } catch { /* ignore */ }
    };
  }, [onApply, blockId, channels, validChannels.length, totalCut]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const tone = status.lastResult === 'kernel-ok' ? 'ok'
             : status.lastResult === 'idle'      ? 'idle'
             : status.lastResult === 'block-seeded' ? 'ok'
             : 'err';

  return createPortal(
    <div style={PANEL_STYLE}
         data-testid="forge-mold-cooling-panel"
         data-block-id={selectedBlock ? selectedBlock.id : ''}
         data-block-handle={selectedBlock ? String(selectedBlock.handle) : ''}
         data-channel-count={String(channels.length)}
         data-valid-channel-count={String(validChannels.length)}
         data-last-result={status.lastResult}
         data-last-volume-before={status.lastVolumeBefore == null ? '' : String(status.lastVolumeBefore)}
         data-last-volume-after={status.lastVolumeAfter == null ? '' : String(status.lastVolumeAfter)}
         data-last-delta={status.lastDelta == null ? '' : String(status.lastDelta)}
         data-last-drilled-handle={status.lastDrilledHandle == null ? '' : String(status.lastDrilledHandle)}
         data-estimated-cut={String(totalCut)}
         role="dialog"
         aria-label="Mold cooling channels panel">

      <div style={HEADER_ROW}>
        <span style={TITLE}>Mold Cooling Channels</span>
        <span style={SUBTITLE}>PUSH-96</span>
        <button type="button"
                onClick={onClose}
                style={CLOSE_BTN}
                data-testid="forge-mold-cooling-close"
                aria-label="Close mold cooling panel"
                title="Close">×</button>
      </div>

      <div style={STATUS_CHIPS_ROW}
           data-testid="forge-mold-cooling-chips">
        <div style={STATUS_CHIP(selectedBlock ? 'ok' : 'warn')}
             data-testid="forge-mold-cooling-block-chip">
          <span style={CHIP_LABEL}>Block</span>
          <span style={CHIP_VALUE}>{selectedBlock ? `#${selectedBlock.handle}` : '—'}</span>
        </div>
        <div style={STATUS_CHIP('idle')}
             data-testid="forge-mold-cooling-count-chip">
          <span style={CHIP_LABEL}>Channels</span>
          <span style={CHIP_VALUE}
                data-testid="forge-mold-cooling-count">
            {validChannels.length}/{channels.length}
          </span>
        </div>
        <div style={STATUS_CHIP('idle')}
             data-testid="forge-mold-cooling-cut-chip">
          <span style={CHIP_LABEL}>Cut Σ</span>
          <span style={CHIP_VALUE}
                data-testid="forge-mold-cooling-estimated-cut">
            {totalCut.toFixed(0)}
          </span>
        </div>
        <div style={STATUS_CHIP(tone)}
             data-testid="forge-mold-cooling-status-chip">
          <span style={CHIP_LABEL}>Status</span>
          <span style={CHIP_VALUE}
                data-testid="forge-mold-cooling-last-result">
            {status.lastResult}
          </span>
        </div>
      </div>

      <div style={SECTION_TITLE}>Mold block</div>
      <div style={BLOCK_PICK_ROW}>
        <select style={SELECT}
                data-testid="forge-mold-cooling-block-pick"
                value={blockId || ''}
                onChange={(e) => setBlockId(e.target.value || null)}>
          <option value="">— pick a native body —</option>
          {bodies.map((b) => (
            <option key={b.id} value={b.id}>
              {(b.name || b.id)} · #{b.handle}
            </option>
          ))}
        </select>
        <button type="button"
                style={BTN('secondary')}
                data-testid="forge-mold-cooling-seed-block"
                onClick={onSeedBlock}
                title={`Seed a ${DEFAULT_BLOCK.dx}×${DEFAULT_BLOCK.dy}×${DEFAULT_BLOCK.dz} mold block`}>
          Seed Block
        </button>
      </div>

      <div style={SECTION_TITLE}>Channels ({channels.length})</div>
      <div style={TABLE_HEAD}>
        <span>#</span>
        <span>Start (x,y,z)</span>
        <span>End (x,y,z)</span>
        <span>Ø mm</span>
        <span></span>
      </div>
      <div data-testid="forge-mold-cooling-channels-list">
        {channels.length === 0 ? (
          <div style={{ ...CHIP_LABEL, padding: 8 }}
               data-testid="forge-mold-cooling-empty">
            No channels — click Add to begin.
          </div>
        ) : channels.map((ch, idx) => {
          const valid = isValidChannel(ch);
          return (
            <div key={ch.id}
                 style={TABLE_ROW}
                 data-testid="forge-mold-cooling-row"
                 data-channel-index={String(idx)}
                 data-channel-id={ch.id}
                 data-channel-valid={String(valid)}
                 data-channel-length={String(channelLength(ch))}
                 data-channel-volume={String(channelVolume(ch))}>
              <span style={ROW_INDEX}>{idx + 1}</span>
              <div style={TRIPLE}>
                {[0, 1, 2].map((i) => (
                  <input key={`s-${i}`} type="number"
                         style={FIELD}
                         data-testid={`forge-mold-cooling-row-${idx}-start-${i}`}
                         data-field={`start-${i}`}
                         value={ch.start[i]}
                         onChange={(e) => {
                           const v = parseFloat(e.target.value);
                           const next = ch.start.slice();
                           next[i] = Number.isFinite(v) ? v : 0;
                           onUpdateChannel(ch.id, { start: next });
                         }} />
                ))}
              </div>
              <div style={TRIPLE}>
                {[0, 1, 2].map((i) => (
                  <input key={`e-${i}`} type="number"
                         style={FIELD}
                         data-testid={`forge-mold-cooling-row-${idx}-end-${i}`}
                         data-field={`end-${i}`}
                         value={ch.end[i]}
                         onChange={(e) => {
                           const v = parseFloat(e.target.value);
                           const next = ch.end.slice();
                           next[i] = Number.isFinite(v) ? v : 0;
                           onUpdateChannel(ch.id, { end: next });
                         }} />
                ))}
              </div>
              <input type="number"
                     style={FIELD}
                     data-testid={`forge-mold-cooling-row-${idx}-diameter`}
                     data-field="diameter"
                     value={ch.diameter}
                     onChange={(e) => {
                       const v = parseFloat(e.target.value);
                       onUpdateChannel(ch.id, { diameter: Number.isFinite(v) && v > 0 ? v : 0 });
                     }} />
              <button type="button"
                      style={ICON_BTN(true)}
                      data-testid={`forge-mold-cooling-row-${idx}-remove`}
                      aria-label={`Remove channel ${idx + 1}`}
                      title="Remove channel"
                      onClick={() => onRemoveChannel(ch.id)}>×</button>
            </div>
          );
        })}
      </div>

      <div style={BTN_ROW}>
        <button type="button"
                style={BTN('secondary')}
                data-testid="forge-mold-cooling-add"
                onClick={onAddChannel}>
          + Add Channel
        </button>
        <button type="button"
                style={BTN('secondary')}
                data-testid="forge-mold-cooling-reset"
                onClick={onResetChannels}>
          Reset
        </button>
        <span style={{ flex: 1 }} />
        <button type="button"
                style={BTN('primary')}
                data-testid="forge-mold-cooling-apply"
                disabled={!selectedBlock || validChannels.length === 0}
                aria-disabled={String(!selectedBlock || validChannels.length === 0)}
                onClick={onApply}>
          Apply ({validChannels.length})
        </button>
      </div>

      {status.lastError && (
        <div style={ERROR_BOX}
             data-testid="forge-mold-cooling-error">
          {status.lastError}
        </div>
      )}

      <div style={SECTION_TITLE}>Last result</div>
      <div data-testid="forge-mold-cooling-result"
           style={{ fontFamily: 'var(--forge-mono, ui-monospace, monospace)', fontSize: 11 }}>
        <div>Volume before: <span data-testid="forge-mold-cooling-vbefore">
          {status.lastVolumeBefore == null ? '—' : status.lastVolumeBefore.toFixed(2)}
        </span></div>
        <div>Volume after:  <span data-testid="forge-mold-cooling-vafter">
          {status.lastVolumeAfter == null ? '—' : status.lastVolumeAfter.toFixed(2)}
        </span></div>
        <div>Δ (drilled):   <span data-testid="forge-mold-cooling-vdelta">
          {status.lastDelta == null ? '—' : status.lastDelta.toFixed(2)}
        </span></div>
        <div>Drilled handle: <span data-testid="forge-mold-cooling-handle">
          {status.lastDrilledHandle == null ? '—' : `#${status.lastDrilledHandle}`}
        </span></div>
      </div>

      <div style={SECTION_TITLE}>Log (last {status.log.length})</div>
      <div data-testid="forge-mold-cooling-log">
        {status.log.length === 0
          ? (<div style={{ ...CHIP_LABEL, padding: '6px' }}>No applications yet.</div>)
          : status.log.map((row, i) => (
              <div key={`${row.ts}-${i}`}
                   style={LOG_ROW}
                   data-testid="forge-mold-cooling-log-row"
                   data-result={row.result}>
                <span style={{ fontWeight: 600 }}>{row.result}</span>
                <span style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>
                  {row.count} ch{row.delta != null ? ` · Δ ${row.delta.toFixed(1)}` : ''}
                </span>
                <span style={{ textAlign: 'right', color: 'var(--forge-ink-mute, #9aa1ab)' }}>
                  {row.volumeAfter != null ? row.volumeAfter.toFixed(0) : '—'}
                </span>
              </div>
            ))
        }
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — owns the open/close state, subscribes to the menu action
// + imperative open/close hooks. Exposes the apply helper at
// window.__forgeApplyMoldCooling so Archie tool calls + e2e can reach
// the same hot path without a manual click.

export function MoldCoolingPanelHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenMoldCoolingPanel = (v) =>
      setOpen(v === undefined ? true : !!v);
    window.__forgeCloseMoldCoolingPanel = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.moldCooling') setOpen((prev) => !prev);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenMoldCoolingPanel; } catch { /* ignore */ }
      try { delete window.__forgeCloseMoldCoolingPanel; } catch { /* ignore */ }
    };
  }, []);

  return (
    <MoldCoolingPanel open={open} onClose={() => setOpen(false)} />
  );
}

export default MoldCoolingPanel;
