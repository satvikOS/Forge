// Forge-65 — the v4 application shell.
//
// Single React tree composing every zone. App.jsx mounts this directly;
// no hash routes, no legacy fallback.

import React, { useEffect, useRef, useState } from 'react';
import './tokens.css';
import { TopBar } from './TopBar.jsx';
import { WorkbenchRail } from './WorkbenchRail.jsx';
import { Toolbar, toolsForWorkbench } from './Toolbar.jsx';
import { RightPanel } from './RightPanel.jsx';
import { StatusBar } from './StatusBar.jsx';
import { CommandBar } from './CommandBar.jsx';
import { ArchieDock } from './ArchieDock.jsx';
import { Viewport } from './Viewport.jsx';
import { QuickAccessBar } from './QuickAccessBar.jsx';
import { NavSphere } from './NavSphere.jsx';
import { HeadsUpToolbar } from './HeadsUpToolbar.jsx';
import { ToastHost, showToast } from './Toast.jsx';
import { ToolParamDialog } from './ToolParamDialog.jsx';
import { schemaFor } from './toolSchemas.js';
import { RollbackBar } from './RollbackBar.jsx';
import { ProjectLibrary } from './ProjectLibrary.jsx';
import { SketchStateBadge } from './SketchStateBadge.jsx';
import { BodyContextMenu } from './BodyContextMenu.jsx';
import { HelpDrawer } from './HelpDrawer.jsx';
import { EquationManager } from './EquationManager.jsx';
import { TopologyInspector } from './TopologyInspector.jsx';
import { PreviewPanels } from './PreviewPanels.jsx';
import { UpdateBanner } from './UpdateBanner.jsx';

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
  const [activeFeatureId, setActiveFeatureId] = useState(null);
  const [viewName, setViewName] = useState('iso');
  const [displayState, setDisplayState] = useState('shaded');
  const [gizmoMode, setGizmoMode] = useState(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [sketchActive, setSketchActive] = useState(false);
  const [bodyCtxMenu, setBodyCtxMenu] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [equationsOpen, setEquationsOpen] = useState(false);
  const [topologyOpen, setTopologyOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTab, setPreviewTab] = useState(() => stored.get('previewTab', 'drawing'));
  useEffect(() => { stored.set('previewTab', previewTab); }, [previewTab]);
  const cmdRef = useRef(null);
  const archieAbortRef = useRef(null);

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
      } else if (meta && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setDisplayState((s) => {
          const states = ['shaded', 'wireframe', 'section'];
          const idx = states.indexOf(s);
          return states[(idx + 1) % states.length];
        });
      } else if (meta && e.key.toLowerCase() === 'e') {
        e.preventDefault(); setEquationsOpen((v) => !v);
      } else if (meta && e.key.toLowerCase() === 'i') {
        e.preventDefault(); setTopologyOpen((v) => !v);
      } else if (e.key === 'F1') {
        e.preventDefault(); setHelpOpen((v) => !v);
      } else if (!meta && e.key.toLowerCase() === 't' &&
                 document.activeElement?.tagName !== 'INPUT') {
        setGizmoMode((m) => m === 'translate' ? null : 'translate');
      } else if (!meta && e.key.toLowerCase() === 'r' &&
                 document.activeElement?.tagName !== 'INPUT') {
        setGizmoMode((m) => m === 'rotate' ? null : 'rotate');
      } else if (!meta && e.key.toLowerCase() === 'y' &&
                 document.activeElement?.tagName !== 'INPUT') {
        setGizmoMode((m) => m === 'scale' ? null : 'scale');
      } else if (meta && e.key.toLowerCase() === 'p') {
        e.preventDefault(); setPreviewOpen((v) => !v);
      } else if (!meta && e.key === 'Escape') {
        setActiveTool(null);
        setBodyCtxMenu(null);
      } else if (!meta && ['1','2','3','4','5','6','7'].includes(e.key) &&
                 document.activeElement?.tagName !== 'INPUT' &&
                 document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        setViewName(['iso','front','back','top','bottom','right','left'][parseInt(e.key)-1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function pushThread(m) {
    setThread((t) => [...t, { id: `m-${t.length}`, ts: Date.now(), ...m }]);
  }

  // Forge-69 — Archie runner integration.
  //   When the user submits in the cmd bar, we open the dock + push a
  //   "user" message; then dispatch to the local Archie fleet via
  //   ForgeRunner if it's available + the native kernel is present.
  //   Tool calls stream into the thread; the run can be cancelled via
  //   the dock header. Falls back to a friendly offline echo otherwise.
  async function runArchie(prompt) {
    if (!prompt) return;
    setDockOpen(true);
    pushThread({ role: 'user', text: prompt });
    const hasKernel = typeof window !== 'undefined' && window.forge &&
                      typeof window.forge.isReady === 'function' &&
                      window.forge.isReady();
    if (!hasKernel) {
      pushThread({ role: 'archie', text:
        'I would build that, but the native forge-kernel.node addon isn\'t loaded ' +
        'in this dev shell. When it ships in the installer (Forge-60+), this same ' +
        'input runs against Archie at localhost:8080.' });
      return;
    }
    setRunning(true);
    let runForgePrompt;
    try {
      ({ runForgePrompt } = await import('../ai/ForgeRunner.js'));
    } catch (err) {
      pushThread({ role: 'archie', text: `Runner load failed: ${err.message}` });
      setRunning(false); return;
    }
    const ac = new AbortController();
    archieAbortRef.current = ac;
    try {
      const trace = await runForgePrompt({
        prompt,
        discipline: activeWb === 'mech' ? 'part' : activeWb,
        signal: ac.signal,
        forge: window.forge,
        onTrace: (ev) => {
          if (ev.kind === 'tool') {
            pushThread({
              role: 'tool',
              text: `${ev.call.name}(${JSON.stringify(ev.call.arguments)}) → ${
                ev.response?.ok === false ? '✗ ' + (ev.response.error || 'err')
                                          : '✓'}`,
            });
          }
        },
      });
      if (trace.final?.status === 'done' && trace.final.text) {
        pushThread({ role: 'archie', text: trace.final.text });
      } else if (trace.final?.status === 'clarify') {
        pushThread({ role: 'archie', text: `Need: ${trace.final.clarify.question || '…'}` });
      } else if (trace.final?.status === 'cancelled') {
        pushThread({ role: 'archie', text: '(cancelled)' });
      } else if (trace.final?.status === 'maxTurns') {
        pushThread({ role: 'archie', text: '(max turns — try a smaller step)' });
      }
    } catch (err) {
      pushThread({ role: 'archie', text:
        err.name === 'AbortError' ? '(cancelled)' : `Error: ${err.message}` });
    } finally {
      setRunning(false);
      archieAbortRef.current = null;
    }
  }
  function cancelArchie() {
    archieAbortRef.current?.abort();
    archieAbortRef.current = null;
    setRunning(false);
  }

  // Forge-66 — menu action dispatcher. Each id matches the spec in
  // Menus.jsx. Unknown actions route into the thread as Archie prompts.
  function handleMenuAction(id) {
    switch (id) {
      case 'view.theme':
        setTheme((t) => t === 'dark' ? 'light' : 'dark');
        showToast({ kind: 'info', text: 'Theme toggled', ttl: 1200 });
        return;
      case 'view.normalTo':
        setViewName('front');
        showToast({ kind: 'info', text: 'Normal-to → front', ttl: 1200 });
        return;
      case 'qat.customise':
        showToast({ kind: 'info', text: 'QAT customise lands Forge-72', ttl: 2000 });
        return;
      case 'file.save':
        showToast({ kind: 'ok', text: 'Saved (placeholder — wired Forge-72)', ttl: 1500 });
        return;
      case 'view.toggleRight':
        setRightCollapsed((v) => !v); return;
      case 'view.toggleDock':
        setDockOpen((v) => !v); return;
      case 'view.preview':
        setPreviewOpen((v) => !v); return;
      case 'view.iso': case 'view.front': case 'view.top': case 'view.right':
        setViewName(id.replace('view.', ''));
        return;
      case 'view.shaded': case 'view.wireframe': case 'view.section':
        setDisplayState(id.replace('view.', ''));
        return;
      case 'gizmo.translate':
        setGizmoMode((m) => m === 'translate' ? null : 'translate');
        showToast({ kind: 'info', text: 'Gizmo · Translate', ttl: 1200 });
        return;
      case 'gizmo.rotate':
        setGizmoMode((m) => m === 'rotate' ? null : 'rotate');
        showToast({ kind: 'info', text: 'Gizmo · Rotate', ttl: 1200 });
        return;
      case 'gizmo.scale':
        setGizmoMode((m) => m === 'scale' ? null : 'scale');
        showToast({ kind: 'info', text: 'Gizmo · Scale', ttl: 1200 });
        return;
      case 'view.zoomFit':
        pushThread({ role: 'archie', text: 'Zoom-fit dispatched (OrbitControls reset to default).' });
        return;
      case 'edit.undo':
        setFeatureTree((t) => t.slice(0, -1));
        pushThread({ role: 'archie', text: 'Undo.' });
        return;
      case 'edit.selectNone':
        setSelection({ kind: 'none', ids: [] }); return;
      case 'file.settings': case 'tools.settings':
        pushThread({ role: 'archie', text: 'Settings overlay opens in Forge-69.' });
        return;
      case 'file.quit':
        if (typeof window !== 'undefined' && window.forge && window.forge.app?.quit) {
          window.forge.app.quit();
        }
        return;
      case 'tools.search':
        cmdRef.current?.focus(); return;
      case 'tools.library':
        setLibraryOpen(true); return;
      case 'tools.equations':
        setEquationsOpen(true); return;
      case 'tools.topology':
        setTopologyOpen(true); return;
      case 'help.docs':
        setHelpOpen(true); return;
      case 'help.shortcuts':
        setHelpOpen(true); return;
      case 'sketch.new':
        setSketchActive(true);
        setActiveTool('sketch.new');
        return;
      case 'sketch.finish':
        setSketchActive(false);
        showToast({ kind: 'ok', text: 'Sketch finished', ttl: 1500 });
        return;
      case 'help.about':
        pushThread({ role: 'archie', text: 'Forge v0.4.0 — Archie-first parametric MCAD on OCCT. Built by satvikOS. Original visual IP — no infringement on CATIA / NX / SolidWorks / Creo / AutoCAD.' });
        setDockOpen(true);
        return;
      default:
        pushThread({ role: 'archie', text: `${id} (wired in a follow-up).` });
        setDockOpen(true);
    }
  }

  // The actual viewport will be replaced by the workbench body in
  // Forge-70. For now we show a calibrated empty-state with the
  // brand mark + a hint, so the v4 shell is observable end-to-end.
  return (
    <div className="forge-app"
         data-testid="forge-app"
         data-archie-open={String(dockOpen)}>
      <TopBar activeWb={activeWb} onMenuAction={(id) => handleMenuAction(id)} />
      <QuickAccessBar onInvoke={(id) => handleMenuAction(id)} />
      <WorkbenchRail activeId={activeWb}
                     onSwitch={(id) => { setActiveWb(id); setActiveTool(null); }} />
      <Toolbar workbenchId={activeWb}
               activeTool={activeTool}
               onInvoke={(id) => {
                 // If the tool has a schema, open the param dock; otherwise
                 // just toggle activeTool (the legacy click-feedback path).
                 if (schemaFor(id)) {
                   setActiveTool(id);
                 } else {
                   setActiveTool(id);
                   showToast({ kind: 'info', text: `${id} (no params)`, ttl: 1500 });
                 }
               }} />
      <div className="forge-viewport" data-testid="forge-viewport"
           onContextMenu={(e) => {
             e.preventDefault();
             setBodyCtxMenu({ x: e.clientX, y: e.clientY });
           }}>
        <Viewport steps={[]}
                  selection={selection}
                  onSelect={setSelection}
                  viewName={viewName}
                  displayState={displayState}
                  activeWb={activeWb}
                  gizmoMode={gizmoMode}
                  onGizmoChange={(obj) => {
                    if (obj) showToast({ kind: 'info',
                      text: `${gizmoMode}: x=${obj.position.x.toFixed(1)} y=${obj.position.y.toFixed(1)} z=${obj.position.z.toFixed(1)}`,
                      ttl: 800 });
                  }} />
        <HeadsUpToolbar activeDisplay={displayState}
                        activeGizmo={gizmoMode}
                        onAction={(id) => handleMenuAction(id)} />
        {/* Forge-79b: NavSphere removed per user request — redundant
            with named-view shortcuts (1-7) + drei GizmoHelper. */}
        <SketchStateBadge visible={sketchActive}
                          state="under" nConstraints={0} nDof={4} />
        <RollbackBar features={featureTree}
                     activeIndex={featureTree.findIndex((f) => f.id === activeFeatureId)}
                     onRollback={(i) => {
                       setActiveFeatureId(featureTree[i]?.id);
                       showToast({ kind: 'info', text: `Rolled to step ${i + 1}`, ttl: 1500 });
                     }}
                     onSuppress={(i) => {
                       setFeatureTree((arr) => arr.map((n, j) =>
                         j === i ? { ...n, suppressed: !n.suppressed } : n));
                     }}
                     onDelete={(i) => {
                       setFeatureTree((arr) => arr.filter((_, j) => j !== i));
                     }} />
      </div>
      <BodyContextMenu open={!!bodyCtxMenu}
                       x={bodyCtxMenu?.x || 0}
                       y={bodyCtxMenu?.y || 0}
                       selection={selection}
                       onPick={(it) => {
                         if (schemaFor(it.id)) setActiveTool(it.id);
                         else handleMenuAction(it.id);
                       }}
                       onClose={() => setBodyCtxMenu(null)} />
      <PreviewPanels open={previewOpen}
                     onClose={() => setPreviewOpen(false)}
                     activeTab={previewTab}
                     onSwitchTab={setPreviewTab}
                     features={featureTree} />
      <ProjectLibrary open={libraryOpen}
                      onClose={() => setLibraryOpen(false)}
                      onInsert={(it) => {
                        const nextId = `f-${featureTree.length}`;
                        setFeatureTree((t) => [...t, {
                          id: nextId, label: it.label, icon: it.icon, params: it.spec,
                        }]);
                        setActiveFeatureId(nextId);
                      }} />
      {dockOpen
        ? (<ArchieDock open={dockOpen} thread={thread} running={running}
                       onClose={() => setDockOpen(false)}
                       onCancel={cancelArchie}
                       onTry={(prompt) => runArchie(prompt)} />)
        : (<RightPanel collapsed={rightCollapsed}
                       onToggle={() => setRightCollapsed((v) => !v)}
                       featureTree={featureTree}
                       activeFeatureId={activeFeatureId}
                       selection={selection}
                       onPickFeature={setActiveFeatureId}
                       onReorderFeature={(fromId, toId) => {
                         setFeatureTree((arr) => {
                           const fromIdx = arr.findIndex((n) => n.id === fromId);
                           const toIdx   = arr.findIndex((n) => n.id === toId);
                           if (fromIdx < 0 || toIdx < 0) return arr;
                           const next = arr.slice();
                           const [moved] = next.splice(fromIdx, 1);
                           next.splice(toIdx, 0, moved);
                           return next;
                         });
                       }}
                       onToggleSuppress={(id) => {
                         setFeatureTree((arr) => arr.map((n) =>
                           n.id === id ? { ...n, suppressed: !n.suppressed } : n));
                       }}
                       onDeleteFeature={(id) => {
                         setFeatureTree((arr) => arr.filter((n) => n.id !== id));
                         if (activeFeatureId === id) setActiveFeatureId(null);
                       }}
                       onRenameFeature={(id, label) => {
                         setFeatureTree((arr) => arr.map((n) =>
                           n.id === id ? { ...n, label } : n));
                       }} />)
      }
      <StatusBar workbench={activeWb} selection={selection} />
      <CommandBar ref={cmdRef}
                  running={running}
                  dockOpen={dockOpen}
                  onToggleDock={() => setDockOpen((v) => !v)}
                  onSubmit={(text) => runArchie(text)} />
      <ToastHost />
      <UpdateBanner />
      <HelpDrawer open={helpOpen}
                  onClose={() => setHelpOpen(false)}
                  activeTool={activeTool}
                  activeWb={activeWb} />
      <EquationManager open={equationsOpen}
                       onClose={() => setEquationsOpen(false)} />
      <TopologyInspector open={topologyOpen}
                         onClose={() => setTopologyOpen(false)}
                         selection={selection}
                         onSelect={setSelection} />
      <ToolParamDialog activeTool={activeTool}
                       selection={selection}
                       onConfirm={(tool, params) => {
                         const nextId = `f-${featureTree.length}`;
                         setFeatureTree((t) => [...t, {
                           id: nextId,
                           label: (schemaFor(tool)?.title || tool) + ' ' + (featureTree.length + 1),
                           icon: toolsForWorkbench(activeWb).flatMap((g) => g.tools).find((tt) => tt.id === tool)?.icon || 'sketch.point',
                           params,
                         }]);
                         setActiveFeatureId(nextId);
                         setActiveTool(null);
                         showToast({ kind: 'ok',
                           text: `${schemaFor(tool)?.title || tool} applied`, ttl: 1500 });
                       }}
                       onCancel={() => { setActiveTool(null); }} />
    </div>
  );
}
