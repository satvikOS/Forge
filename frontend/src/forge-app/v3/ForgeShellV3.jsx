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
import { useViewState } from './useViewState.js';
import { ContextMenu, viewportContextItems } from './Tooltip.jsx';
import { DocTabs } from './DocTabs.jsx';
import { SettingsOverlay } from './SettingsOverlay.jsx';
import { ArchieThreadStore } from '../archie-portal/ArchieThreadStore.js';

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
  const [measurement, setMeasurement] = useState({ mode: 'distance', points: [], unit: 'mm' });
  const [section, setSection] = useState({ enabled: false, plane: { normal: [1,0,0], constant: 0 } });
  const [ctxMenu, setCtxMenu] = useState({ open: false, x: 0, y: 0 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [docTabs, setDocTabs] = useState([]);
  const cmdRef = useRef(null);
  const archie = useArchieDriver();
  // Multi-doc — refresh the tab list whenever the active thread shifts.
  useEffect(() => {
    const store = new ArchieThreadStore();
    const idx = store.index();
    setDocTabs(idx.map((e) => ({ id: e.id, title: e.title || 'Untitled', dirty: false })));
  }, [archie.activeThreadId]);
  // Views + display states tied to the active thread for persistence.
  const viewState = useViewState({
    threadId: archie.activeThreadId,
    backend: (typeof localStorage !== 'undefined') ? {
      get: (k) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch { return null; } },
      set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
      del: (k) => { try { localStorage.removeItem(k); } catch {} },
    } : null,
  });

  // Reset measurement points when leaving the measure verb.
  useEffect(() => {
    if (activeVerb !== 'measure') {
      setMeasurement((m) => ({ ...m, points: [] }));
    }
    if (activeVerb === 'bool.section') {
      setSection((s) => ({ ...s, enabled: true }));
    }
  }, [activeVerb]);
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

  // Global keyboard map:
  //   Cmd+K       focus the command bar
  //   Cmd+/       collapse / expand Archie
  //   Cmd+T       cycle theme dark → light → contrast
  //   Cmd+D       cycle display state (shaded → wireframe → … → shaded)
  //   1–7         jump to named view iso/front/back/top/bottom/right/left
  //   Esc         clear active verb
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const VIEW_KEYS = { '1':'iso','2':'front','3':'back','4':'top','5':'bottom','6':'right','7':'left' };
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault(); cmdRef.current?.focus();
      } else if (meta && e.key === '/') {
        e.preventDefault(); setArchieCollapsed((v) => !v);
      } else if (meta && e.key.toLowerCase() === 't') {
        e.preventDefault();
        setTheme((t) => t === 'dark' ? 'light' : t === 'light' ? 'contrast' : 'dark');
      } else if (meta && e.key.toLowerCase() === 'd') {
        e.preventDefault(); viewState.cycleDisplay();
      } else if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) archie.redo(); else archie.undo();
      } else if (meta && e.key === ',') {
        e.preventDefault(); setSettingsOpen(true);
      } else if (meta && e.key.toLowerCase() === 'n') {
        e.preventDefault(); archie.newThread();
      } else if (!meta && e.key === 'Escape') {
        setActiveVerb(null);
      } else if (!meta && VIEW_KEYS[e.key] && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault(); viewState.applyView(VIEW_KEYS[e.key]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewState, archie]);

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

  // Right-click anywhere in the viewport surface opens a contextual menu.
  // Other surfaces (verb rail / timeline / sidebar) get their own menus
  // in follow-ups; viewport is the highest-value first stop.
  function openCtxMenu(e) {
    e.preventDefault();
    setCtxMenu({ open: true, x: e.clientX, y: e.clientY });
  }

  return (
    <div className="forge-v3-app" data-testid="forge-v3-app"
         onContextMenu={(e) => {
           // Only open if the target is the viewport surface or one of
           // its children (selected via the test-id chain).
           const inViewport = e.target.closest?.('[data-testid^="forge-v3-viewport"]');
           if (inViewport) openCtxMenu(e);
         }}>
      <ContextMenu open={ctxMenu.open} x={ctxMenu.x} y={ctxMenu.y}
                   items={viewportContextItems(selection)}
                   onPick={(it) => {
                     if (it.id === 'delete' || it.id === 'hide'
                       || it.id === 'isolate' || it.id === 'edit') {
                       /* selection-bound op — route to verb selector */
                       setActiveVerb(it.id === 'edit' ? 'modify.push' : null);
                     } else if (it.id.startsWith('create.') ||
                                it.id === 'fillet' || it.id === 'chamfer') {
                       setActiveVerb(it.id);
                       cmdRef.current?.focus();
                     } else if (it.id === 'import') {
                       archie.send('import…');
                     }
                   }}
                   onClose={() => setCtxMenu({ open: false, x: 0, y: 0 })} />
      <header className="forge-v3-titlebar" role="banner">
        <span className="forge-v3-titlebar-brand">
          <span className="forge-v3-titlebar-brand-mark">⎈</span>Forge
        </span>
        <DocTabs tabs={docTabs}
                 activeId={archie.activeThreadId}
                 onSwitch={() => { /* Forge-62b: switch driver thread */ }}
                 onClose={() => { /* Forge-62b: archive thread */ }}
                 onNew={() => archie.newThread()} />
        <span className="forge-v3-titlebar-spacer" />
        <span
          style={{ fontSize: 11, opacity: 0.6 }}
          data-testid="forge-v3-status"
        >
          {viewState.displayState} · {viewState.activeView} · 0.3.0 · {archie.status}
        </span>
      </header>
      <SettingsOverlay open={settingsOpen}
                       onClose={() => setSettingsOpen(false)}
                       onThemeChange={(t) => setTheme(t)} />

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
        activeVerb={activeVerb}
        measurement={measurement}
        section={section}
        onMeasurementPick={(pt) => setMeasurement((m) => {
          const limit = m.mode === 'distance' ? 2 : (m.mode === 'angle' ? 3 : 32);
          const next = m.points.length >= limit ? [pt] : [...m.points, pt];
          return { ...m, points: next };
        })}
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
