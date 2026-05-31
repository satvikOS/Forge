// Forge-IP v3 — Archie-first command bar shell.
//
// Replaces v1 ForgeApp + v2 ribbon clone. Layout:
//
//   ┌────────────────────────────────────────────────┐
//   │ title bar — brand + doc + theme                │
//   ├──┬─────────────────────────────────────┬───────┤
//   │  │                                     │       │
//   │ V│                                     │   A   │
//   │ E│            VIEWPORT                 │   R   │
//   │ R│         (unified, no mode)          │   C   │
//   │ B│                                     │   H   │
//   │ S│                                     │   I   │
//   │  │                                     │   E   │
//   │  ├─────────────────────────────────────┤       │
//   │  │ ▶ ─●──○──○──○──○──○──○─◀ timeline   │       │
//   ├──┴─────────────────────────────────────┴───────┤
//   │ ⌘ "fillet the front edges 5 mm"             ↵  │
//   └────────────────────────────────────────────────┘
//
// The bottom command bar is ALWAYS visible — focus it from anywhere
// with Cmd/Ctrl+K. Selection-contextual verbs sit on the left rail;
// Archie thread on the right. No ribbon, no docked panel salad.
//
// Sub-components live in v3/:
//   VerbRail, ViewportSurface, TimelineStrip, ArchieSidebar, CommandBar.

import React, { useEffect, useRef, useState } from 'react';
import './tokens.css';
import { VerbRail } from './VerbRail.jsx';
import { ViewportSurface } from './ViewportSurface.jsx';
import { TimelineStrip } from './TimelineStrip.jsx';
import { ArchieSidebar } from './ArchieSidebar.jsx';
import { CommandBar } from './CommandBar.jsx';

const STORAGE = 'forge.v3';

function readStored(key, fallback) {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(`${STORAGE}.${key}`);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}
function writeStored(key, val) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(`${STORAGE}.${key}`, JSON.stringify(val)); } catch {}
}

export function ForgeShellV3() {
  const [theme, setTheme] = useState(() => readStored('theme', 'dark'));
  const [archieCollapsed, setArchieCollapsed] = useState(() => readStored('archieCollapsed', false));
  const [activeVerb, setActiveVerb] = useState(null);
  const [selection, setSelection] = useState({ kind: 'none', ids: [] });
  const [docName] = useState('untitled.forge');
  const [steps, setSteps] = useState([]);
  const [activeStepId, setActiveStepId] = useState(null);
  const [thread, setThread] = useState([]);
  const cmdRef = useRef(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-forge-theme', theme);
    writeStored('theme', theme);
  }, [theme]);

  useEffect(() => { writeStored('archieCollapsed', archieCollapsed); }, [archieCollapsed]);

  // Cmd/Ctrl+K focuses the command bar from anywhere. Esc clears it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        cmdRef.current?.focus();
      } else if (meta && e.key === '/') {
        e.preventDefault();
        setArchieCollapsed((v) => !v);
      } else if (meta && e.key.toLowerCase() === 't') {
        e.preventDefault();
        setTheme((t) => t === 'dark' ? 'light' : t === 'light' ? 'contrast' : 'dark');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function pushStep(step) {
    const next = [...steps, { id: `step-${steps.length + 1}`, ts: Date.now(), ...step }];
    setSteps(next);
    setActiveStepId(next[next.length - 1].id);
  }

  function pushThread(msg) {
    setThread((t) => [...t, { id: `msg-${t.length + 1}`, ts: Date.now(), ...msg }]);
  }

  return (
    <div className="forge-v3-app" data-testid="forge-v3-app">
      <header className="forge-v3-titlebar" role="banner">
        <span className="forge-v3-titlebar-brand">
          <span className="forge-v3-titlebar-brand-mark">⎈</span>Forge
        </span>
        <span className="forge-v3-titlebar-spacer" />
        <span className="forge-v3-titlebar-doc-name">{docName}</span>
        <span className="forge-v3-titlebar-spacer" />
        <span style={{ fontSize: 11, opacity: 0.6 }}>0.3.0</span>
      </header>

      <VerbRail
        selection={selection}
        activeVerb={activeVerb}
        onVerb={(v) => setActiveVerb((prev) => prev === v ? null : v)}
      />

      <ViewportSurface
        selection={selection}
        onSelect={setSelection}
      />

      <TimelineStrip
        steps={steps}
        activeStepId={activeStepId}
        onPick={setActiveStepId}
      />

      <ArchieSidebar
        collapsed={archieCollapsed}
        onToggle={() => setArchieCollapsed((v) => !v)}
        thread={thread}
      />

      <CommandBar
        ref={cmdRef}
        onSubmit={(text) => {
          pushThread({ role: 'user', text });
          pushStep({ label: text.length > 28 ? text.slice(0, 28) + '…' : text,
                     meta: 'archie' });
          // Echo Archie placeholder until Forge-49 wires the real runner.
          pushThread({ role: 'archie',
                       text: `Queued. (Archie runner wires up in Forge-49 — for now I just echo.)` });
        }}
      />
    </div>
  );
}

export default ForgeShellV3;
