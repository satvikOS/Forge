import { useEffect, useMemo, useRef, useState } from 'react';
import { TABS as RIBBON_TABS } from './RibbonToolbar';
import './QuickAccessToolbar.css';

/**
 * Quick Access Toolbar (QAT) — a thin strip of pinned commands above
 * the ribbon. Mirrors SolidWorks' QAT and NX's role-customizable
 * toolbar: every action a user runs constantly (Save / Undo / Redo /
 * Box / Cylinder / Extrude / Bundle …) is one click away regardless
 * of which ribbon tab they're currently on.
 *
 * Persistence
 *   The pin list lives in localStorage under `archdisc:qat:v1` so the
 *   user's pinned set survives reloads. First-run users get a
 *   reasonable default set (the engineering workflow's hot keys).
 *
 * Dispatch
 *   Ribbon-tool pins dispatch `archdisc:run-tool {detail: {tab, tool}}`
 *   — the same event WF-03's Command Palette uses, and the same code
 *   path a real ribbon click takes. App-level pins (Undo/Redo/Save)
 *   call through to the handlers passed in as props.
 */

const STORAGE_KEY = 'archdisc:qat:v1';

// Default pin set — covers the engineer's hot path:
//   Save · Undo · Redo · Box · Cylinder · Extrude · Bundle
const DEFAULT_PINS = [
  { kind: 'app',    id: 'save',                                              label: 'Save',                glyph: '💾' },
  { kind: 'app',    id: 'undo',                                              label: 'Undo',                glyph: '↶' },
  { kind: 'app',    id: 'redo',                                              label: 'Redo',                glyph: '↷' },
  { kind: 'tool',   tab: 'part',     tool: 'Box',                            label: 'Box',                 glyph: '□' },
  { kind: 'tool',   tab: 'part',     tool: 'Cylinder',                       label: 'Cylinder',            glyph: '○' },
  { kind: 'tool',   tab: 'part',     tool: 'Extrude Boss',                   label: 'Extrude',             glyph: '⇧' },
  { kind: 'tool',   tab: 'drawing',  tool: 'Export Project Bundle',          label: 'Export Bundle',       glyph: '🗜' },
];

function loadPins() {
  if (typeof window === 'undefined' || !window.localStorage) return [...DEFAULT_PINS];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_PINS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [...DEFAULT_PINS];
    // Validate each entry has the minimum shape.
    return parsed.filter(p =>
      p && (p.kind === 'app' ? typeof p.id === 'string' : (typeof p.tab === 'string' && typeof p.tool === 'string')));
  } catch {
    return [...DEFAULT_PINS];
  }
}

function savePins(pins) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pins)); }
  catch { /* quota / privacy mode → silent */ }
}

function dispatchTool(tab, tool) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('archdisc:run-tool', { detail: { tab, tool } }));
}

export default function QuickAccessToolbar({ onSave, onUndo, onRedo, canUndo, canRedo }) {
  const [pins, setPins] = useState(() => loadPins());
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef(null);

  useEffect(() => { savePins(pins); }, [pins]);

  // Click-outside closes the pin picker.
  useEffect(() => {
    if (!pickerOpen) return undefined;
    const onDown = (e) => {
      if (!pickerRef.current) return;
      if (!pickerRef.current.contains(e.target)) setPickerOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [pickerOpen]);

  const allRibbonTools = useMemo(() => {
    const out = [];
    for (const [tabKey, tabDef] of Object.entries(RIBBON_TABS || {})) {
      const tabLabel = tabDef?.label || tabKey;
      for (const group of (tabDef?.groups || [])) {
        for (const tool of (group?.tools || [])) {
          if (!tool?.name) continue;
          out.push({
            tab: tabKey,
            tool: tool.name,
            label: tool.name,
            glyph: typeof tool.icon === 'string' ? tool.icon : '',
            category: `${tabLabel} › ${group.label || ''}`,
          });
        }
      }
    }
    return out;
  }, []);

  const fireApp = (id) => {
    if (id === 'save' && onSave) onSave();
    else if (id === 'undo' && onUndo) onUndo();
    else if (id === 'redo' && onRedo) onRedo();
  };

  const handlePinClick = (p) => {
    if (p.kind === 'app') fireApp(p.id);
    else dispatchTool(p.tab, p.tool);
  };

  const isAppDisabled = (p) =>
    p.kind === 'app' && (
      (p.id === 'undo' && canUndo === false) ||
      (p.id === 'redo' && canRedo === false)
    );

  const handleContextMenu = (e, idx) => {
    e.preventDefault();
    setPins(prev => prev.filter((_, i) => i !== idx));
  };

  const addPin = (rec) => {
    setPins(prev => {
      if (prev.some(p => p.kind === 'tool' && p.tab === rec.tab && p.tool === rec.tool)) return prev;
      return [...prev, {
        kind: 'tool',
        tab: rec.tab,
        tool: rec.tool,
        label: rec.label,
        glyph: rec.glyph || '',
      }];
    });
    setPickerOpen(false);
  };

  const resetToDefaults = () => setPins([...DEFAULT_PINS]);

  return (
    <div className="qat" data-archdisc-qat="active">
      <div className="qat-pins" role="toolbar" aria-label="Quick Access Toolbar">
        {pins.map((p, idx) => (
          <button
            key={`${p.kind}-${p.kind === 'app' ? p.id : `${p.tab}-${p.tool}`}-${idx}`}
            className={`qat-pin${isAppDisabled(p) ? ' qat-pin-disabled' : ''}`}
            title={p.kind === 'app' ? p.label : `${p.label} (right-click to unpin)`}
            onClick={() => !isAppDisabled(p) && handlePinClick(p)}
            onContextMenu={(e) => handleContextMenu(e, idx)}
            disabled={isAppDisabled(p)}
            data-qat-pin={p.kind === 'app' ? p.id : p.tool}
          >
            <span className="qat-glyph" aria-hidden>{p.glyph}</span>
            <span className="qat-label">{p.label}</span>
          </button>
        ))}
      </div>
      <div className="qat-spacer" />
      <div className="qat-actions" ref={pickerRef}>
        <button
          className="qat-add"
          title="Pin a new tool…"
          onClick={() => setPickerOpen(v => !v)}
          data-qat-add="true"
        >+</button>
        {pickerOpen && (
          <div className="qat-picker">
            <div className="qat-picker-head">
              <span>Pin a ribbon tool</span>
              <button className="qat-reset" onClick={resetToDefaults} title="Restore default pins">
                Reset
              </button>
            </div>
            <div className="qat-picker-list">
              {allRibbonTools.map(r => {
                const pinned = pins.some(p => p.kind === 'tool' && p.tab === r.tab && p.tool === r.tool);
                return (
                  <button
                    key={`${r.tab}-${r.tool}`}
                    className={`qat-picker-item${pinned ? ' qat-pinned' : ''}`}
                    onClick={() => !pinned && addPin(r)}
                    disabled={pinned}
                    title={r.category}
                  >
                    <span className="qat-picker-glyph">{r.glyph || '·'}</span>
                    <span className="qat-picker-label">{r.label}</span>
                    <span className="qat-picker-cat">{r.category}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
