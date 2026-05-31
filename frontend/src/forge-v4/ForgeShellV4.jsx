// Forge-65 — the v4 application shell.
//
// Single React tree composing every zone. App.jsx mounts this directly;
// no hash routes, no legacy fallback.

import React, { useEffect, useRef, useState } from 'react';
import './tokens.css';
import { TopBar } from './TopBar.jsx';
import { WorkbenchRail } from './WorkbenchRail.jsx';
import { Toolbar } from './Toolbar.jsx';
import { RightPanel } from './RightPanel.jsx';
import { StatusBar } from './StatusBar.jsx';
import { CommandBar } from './CommandBar.jsx';
import { ArchieDock } from './ArchieDock.jsx';

const STORAGE = 'forge.v4';
const stored = {
  get: (k, d) => {
    if (typeof localStorage === 'undefined') return d;
    try { const r = localStorage.getItem(`${STORAGE}.${k}`); return r ? JSON.parse(r) : d; }
    catch { return d; }
  },
  set: (k, v) => {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(`${STORAGE}.${k}`, JSON.stringify(v)); } catch {}
  },
};

export function ForgeShellV4() {
  const [theme, setTheme]             = useState(() => stored.get('theme', 'dark'));
  const [activeWb, setActiveWb]       = useState(() => stored.get('wb', 'mech'));
  const [activeTool, setActiveTool]   = useState(null);
  const [selection, setSelection]     = useState({ kind: 'none', ids: [] });
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [dockOpen, setDockOpen]       = useState(false);
  const [thread, setThread]           = useState([]);
  const [running, setRunning]         = useState(false);
  const [featureTree, setFeatureTree] = useState([]);
  const cmdRef = useRef(null);

  // Theme into the data attribute that the tokens.css selectors read.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-forge-theme', theme);
    stored.set('theme', theme);
  }, [theme]);
  useEffect(() => { stored.set('wb', activeWb); }, [activeWb]);

  // Cmd+K → focus cmd bar; Cmd+/ toggle dock; Cmd+T cycle theme.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault(); cmdRef.current?.focus();
      } else if (meta && e.key === '/') {
        e.preventDefault(); setDockOpen((v) => !v);
      } else if (meta && e.key.toLowerCase() === 't') {
        e.preventDefault();
        setTheme((t) => t === 'dark' ? 'light' : 'dark');
      } else if (!meta && e.key === 'Escape') {
        setActiveTool(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function pushThread(m) {
    setThread((t) => [...t, { id: `m-${t.length}`, ts: Date.now(), ...m }]);
  }

  // The actual viewport will be replaced by the workbench body in
  // Forge-70. For now we show a calibrated empty-state with the
  // brand mark + a hint, so the v4 shell is observable end-to-end.
  return (
    <div className="forge-app"
         data-testid="forge-app"
         data-archie-open={String(dockOpen)}>
      <TopBar activeWb={activeWb} onMenu={() => {}} />
      <WorkbenchRail activeId={activeWb}
                     onSwitch={(id) => { setActiveWb(id); setActiveTool(null); }} />
      <Toolbar workbenchId={activeWb}
               activeTool={activeTool}
               onInvoke={(id) => {
                 setActiveTool(id);
                 setFeatureTree((t) => [...t, {
                   id: `f-${t.length}`,
                   label: id,
                   icon: 'sketch.point',
                 }]);
                 pushThread({ role: 'archie', text: `Queued ${id} (kernel mount lands in Forge-70).` });
               }} />
      <div className="forge-viewport" data-testid="forge-viewport">
        <ViewportSurface activeWb={activeWb} />
      </div>
      {dockOpen
        ? (<ArchieDock open={dockOpen} thread={thread} running={running}
                       onClose={() => setDockOpen(false)}
                       onTry={(prompt) => {
                         setDockOpen(true);
                         pushThread({ role: 'user', text: prompt });
                         pushThread({ role: 'archie', text: 'Kernel wiring lands in Forge-70 — for now I echo.' });
                       }} />)
        : (<RightPanel collapsed={rightCollapsed}
                       onToggle={() => setRightCollapsed((v) => !v)}
                       featureTree={featureTree}
                       selection={selection} />)
      }
      <StatusBar workbench={activeWb} selection={selection} />
      <CommandBar ref={cmdRef}
                  running={running}
                  dockOpen={dockOpen}
                  onToggleDock={() => setDockOpen((v) => !v)}
                  onSubmit={(text) => {
                    setDockOpen(true);
                    pushThread({ role: 'user', text });
                    pushThread({ role: 'archie', text: `Queued. (Forge-70 wires the live runner.)` });
                  }} />
    </div>
  );
}

// Inline viewport surface — placeholder until Forge-70 mounts the real
// workbench body. Shows the brand at calibrated size + a HUD so it's
// observable without a kernel.
function ViewportSurface({ activeWb }) {
  return (
    <>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 12, color: 'var(--forge-ink-mute)',
      }}>
        <div style={{
          width: 96, height: 96,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '1px solid var(--forge-rail-edge)',
          borderRadius: '50%',
          color: 'var(--forge-accent)',
        }}>
          {/* Big brand mark in the viewport center. */}
          <BigMark />
        </div>
        <div style={{ fontSize: 12, color: 'var(--forge-ink)' }}>
          Forge · {activeWb} workbench
        </div>
        <div style={{ fontSize: 11 }}>
          Press <kbd style={{
            fontFamily: 'var(--forge-mono)', fontSize: 11,
            background: 'var(--forge-surface)', padding: '1px 5px',
            borderRadius: 3, border: '1px solid var(--forge-rail-edge)',
          }}>⌘K</kbd> and tell Archie what you want — or pick a tool above.
        </div>
      </div>
      <ViewportHUD />
    </>
  );
}

function BigMark() {
  return (
    <svg width="48" height="48" viewBox="0 0 32 32" fill="none">
      <g stroke="var(--forge-ink)" strokeWidth="1.5"
         strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 3 L16 9" />
        <path d="M13 6 L19 6" />
        <path d="M14.2 4.2 L17.8 7.8" />
        <path d="M17.8 4.2 L14.2 7.8" />
      </g>
      <g stroke="var(--forge-ink-2)" strokeWidth="1.5"
         strokeLinecap="round" strokeLinejoin="round">
        <path d="M 4 14 L 6 12 L 25 12 L 27 14 L 22 14 L 22 18 L 26 18 L 26 21 L 20 21 L 20 28 L 12 28 L 12 21 L 6 21 L 6 18 L 10 18 L 10 14 Z" />
        <path d="M 10 14 L 22 14" />
      </g>
    </svg>
  );
}

function ViewportHUD() {
  return (
    <>
      <div style={{
        position: 'absolute', top: 10, left: 12,
        font: '10px var(--forge-mono)', color: 'var(--forge-ink-mute)',
        background: 'rgba(0,0,0,0.45)',
        padding: '4px 8px', borderRadius: 4,
        border: '1px solid var(--forge-rail-edge)',
      }}>iso · shaded</div>
      <div style={{
        position: 'absolute', bottom: 10, left: 12,
        display: 'flex', gap: 10,
        font: '10px var(--forge-mono)',
        background: 'rgba(0,0,0,0.45)',
        padding: '4px 8px', borderRadius: 4,
        border: '1px solid var(--forge-rail-edge)',
      }}>
        <span style={{ color: 'var(--forge-ink)' }}>▶ X</span>
        <span style={{ color: 'var(--forge-ink-2)' }}>▲ Y</span>
        <span style={{ color: 'var(--forge-ink-mute)' }}>● Z</span>
      </div>
      <div style={{
        position: 'absolute', bottom: 10, right: 12,
        font: '10px var(--forge-mono)', color: 'var(--forge-ink-mute)',
        background: 'rgba(0,0,0,0.45)',
        padding: '4px 8px', borderRadius: 4,
        border: '1px solid var(--forge-rail-edge)',
      }}>
        <span style={{
          display: 'inline-block', width: 40, height: 2,
          background: 'var(--forge-ink-2)', margin: '0 6px 2px',
          verticalAlign: 'middle',
        }} />10 mm
      </div>
    </>
  );
}
