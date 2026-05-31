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
import { VerbRail, verbsFor } from './VerbRail.jsx';
import { ViewportSurface } from './ViewportSurface.jsx';
import { TimelineStrip } from './TimelineStrip.jsx';
import { ArchieSidebar } from './ArchieSidebar.jsx';
import { CommandBar } from './CommandBar.jsx';
import { useArchieDriver } from './useArchieDriver.js';

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
  const cmdRef = useRef(null);
  const archie = useArchieDriver();
  // Driver owns parametric state. Shell is a view onto it.
  const steps = archie.steps;
  const thread = archie.thread;
  const activeStepId = archie.activeStepId;

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

  // Verb-rail click prefills the command bar with the verb's natural-
  // language stem so the user can finish the sentence ("fillet __mm").
  // This is the unification of "what GUI buttons mean" with the NL
  // surface — every verb is just an NL prefix.
  const VERB_PREFIXES = {
    'create.sketch':   'sketch ',
    'create.box':      'create a box ',
    'create.cyl':      'create a cylinder ',
    'import':          'import ',
    'measure':         'measure ',
    'modify.push':     'push the selected face by ',
    'modify.fillet':   'fillet at ',
    'modify.chamfer':  'chamfer at ',
    'modify.shell':    'shell at ',
    'modify.delete':   'delete the selected face ',
    'modify.move':     'move by ',
    'modify.rotate':   'rotate by ',
    'modify.scale':    'scale by ',
    'pattern':         'pattern ',
    'mirror':          'mirror across ',
    'constrain':       'constrain ',
    'dimension':       'dimension ',
    'bool.cut':        'cut with ',
    'bool.fuse':       'fuse with ',
    'bool.section':    'section ',
  };

  return (
    <div className="forge-v3-app" data-testid="forge-v3-app">
      <header className="forge-v3-titlebar" role="banner">
        <span className="forge-v3-titlebar-brand">
          <span className="forge-v3-titlebar-brand-mark">⎈</span>Forge
        </span>
        <span className="forge-v3-titlebar-spacer" />
        <span className="forge-v3-titlebar-doc-name">{docName}</span>
        <span className="forge-v3-titlebar-spacer" />
        <span
          style={{ fontSize: 11, opacity: 0.6 }}
          data-testid="forge-v3-status"
        >
          0.3.0 · {archie.status}
        </span>
      </header>

      <VerbRail
        selection={selection}
        activeVerb={activeVerb}
        onVerb={(v) => {
          setActiveVerb((prev) => prev === v ? null : v);
          if (cmdRef.current) {
            cmdRef.current.focus();
            cmdRef.current.value = VERB_PREFIXES[v] || (v.split('.').pop() + ' ');
            // Surface the prefilled value to the CommandBar's controlled state.
            cmdRef.current.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }}
      />

      <ViewportSurface
        selection={selection}
        onSelect={setSelection}
        steps={steps}
      />

      <TimelineStrip
        steps={steps}
        activeStepId={activeStepId || (steps.length ? steps[steps.length - 1].id : null)}
        onPick={(id) => archie.setActiveStepId(id)}
        onRollback={(id) => archie.rollbackTo(id)}
      />

      <ArchieSidebar
        collapsed={archieCollapsed}
        onToggle={() => setArchieCollapsed((v) => !v)}
        thread={thread}
        running={archie.status === 'running'}
        onCancel={archie.cancel}
      />

      <CommandBar
        ref={cmdRef}
        onSubmit={(text) => archie.send(text)}
        running={archie.status === 'running'}
      />
    </div>
  );
}

export default ForgeShellV3;
