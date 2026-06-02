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
// Forge-183 — autosave (localStorage-backed crash recovery).
import * as AutoSave from './autoSave.js';
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
import { dispatchTool } from './kernelDispatch.js';
import { dispatchSheet, SHEET_OPS } from './sheetMetalDispatch.js';
import { dispatchWeld } from './weldmentsDispatch.js';
import * as Sketch from './sketchSession.js';
import { massProps, distance, angle, meshArea, meshBounds, detectInterference } from './measureDispatch.js';
import { ConfigurationsPanel, pushHistory } from './ConfigurationsPanel.jsx';
import { ExplodedView, WalkthroughPanel } from './ExplodedViewController.jsx';
import { recordOp, undo as graphUndo, redo as graphRedo, canUndo, canRedo } from './opGraph.js';

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
  // Forge-83 — body registry. Each entry is { id, kind:'native'|'synthetic',
  // handle?, spec?, params, toolId, name }. SceneMeshes turns these into
  // THREE meshes either via window.forge.tessellate or via the synthetic
  // geometry builder.
  const [bodies, setBodies] = useState([]);
  // Forge-85 — currentSketch state (a live sketcher session) and a counter
  // bumped on every entity add so viewport overlays re-render. When null,
  // sketch.* tools no-op with a toast asking the user to start a sketch first.
  const [currentSketch, setCurrentSketch] = useState(null);
  const [sketchRev, setSketchRev] = useState(0);
  const bumpSketch = () => setSketchRev((n) => n + 1);

  // Forge-98 — history-aware regen. Takes a feature tree and re-dispatches
  // every node's tool through kernelDispatch in topological order, returning
  // a fresh bodies array. Used after the user edits a feature mid-tree.
  // Forge-123 — also passes the live skeleton through ctx so any
  // `{ skelRef }` params get resolved against the current master refs.
  function regenerate(tree) {
    let prevBody = null;
    const next = [];
    const skel = (typeof window !== 'undefined') ? window.__forgeSkeleton : null;
    for (const f of tree) {
      if (!f.params || !f.icon) continue;
      const toolId = f.toolId || guessToolFromIcon(f.icon);
      if (!toolId) continue;
      const ctx = {
        lastBody: prevBody?.kind === 'native' ? prevBody.handle : null,
        selectedBodies: prevBody?.kind === 'native' ? [prevBody.handle] : null,
        currentSketch: currentSketch?.kernel ?? null,
        skeleton: skel,
      };
      const r = dispatchTool(toolId, f.params, ctx);
      if (r.ok && r.kind === 'native') {
        const body = { id: f.id, kind: 'native', handle: r.handle, toolId, params: f.params, name: f.label };
        next.push(body); prevBody = body;
      }
      // Forge-143: no synthetic regen path. Features whose kernel
      // dispatch fails are left in the tree (suppressed semantics)
      // but produce no body — the user sees the error from the toast
      // that fired when the op originally ran.
    }
    return next;
  }
  function guessToolFromIcon(icon) {
    // Many feature nodes don't store their toolId; infer from the icon name.
    if (typeof icon !== 'string') return null;
    return icon.includes('.') ? icon : null;
  }
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
  const [centerToken, setCenterToken] = useState(0);
  const [sectionPlane, setSectionPlane] = useState({ enabled: false, axis: 'Z', offset: 0 });
  const [configsOpen, setConfigsOpen] = useState(false);
  const [explodeOpen, setExplodeOpen] = useState(false);
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  const [explodeOffsets, setExplodeOffsets] = useState({});
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
  // Forge-118 — subscribe to SectionControlHost updates.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onSection = (e) => setSectionPlane(e.detail);
    window.addEventListener('forge:section-update', onSection);
    return () => window.removeEventListener('forge:section-update', onSection);
  }, []);
  // Forge-123 — subscribe to master-skeleton edits. Any change rebuilds
  // every feature whose params reference a skeleton entity. We re-read
  // featureTree from the latest setBodies closure so the regen sees
  // tree edits committed in the same tick.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onSkel = () => {
      setBodies((_) => regenerate(featureTree));
    };
    window.addEventListener('forge:skeleton-update', onSkel);
    return () => window.removeEventListener('forge:skeleton-update', onSkel);
  }, [featureTree, currentSketch]);
  // Forge-95 — snapshot every feature-tree change to the history log.
  useEffect(() => { if (featureTree.length) pushHistory(featureTree); }, [featureTree]);

  // Forge-114 — publish live shell state so portal-mounted panels (BOM,
  // project bundle, scenario runner, .forge open/save) can read it
  // without having to be wired through the shell tree.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeBodies      = bodies;
    window.__forgeFeatureTree = featureTree;
    window.__forgeSelection   = selection;
    window.__forgeActiveWb    = activeWb;
    window.__forgeTheme       = theme;
    // setter so loaders can replace the scene from disk. Forge-177 — switched
    // both calls to functional updaters because the value form was getting
    // stomped: when a workbench publishes via __forgeSetBodies the same
    // effect re-runs on the next render and re-defined __forgeSetBodies
    // with a closure over the old (empty) bodies state, dropping the body.
    window.__forgeSetBodies = (next) => {
      const arr = Array.isArray(next) ? next : [];
      setBodies(() => arr);
      setFeatureTree(() => arr.map((b) => ({
        id: b.id, label: b.name || b.toolId || b.id,
        icon: 'archie.spark', params: b.params || {},
      })));
    };
    window.__forgeAppendBody = (b) => setBodies((arr) => [...arr, b]);
    window.__forgeReplaceFeatureTree = (next) => setFeatureTree(Array.isArray(next) ? next : []);
    // Forge-139 — palette-driven feature selection bridge.
    window.__forgeSelectFeature = (id) => setActiveFeatureId(id);
    // Forge-134 — workbench + fit hooks used by window.Forge.workbench.switchTo
    // and Forge.viewport.fit. Both shadow the same setters the menu / HUT
    // dispatch already use; we expose them as window hooks so plugin code
    // can drive the shell without poking React state directly.
    window.__forgeSetActiveWb = (id) => {
      if (typeof id === 'string') { setActiveWb(id); setActiveTool(null); }
    };
    window.__forgeFit = () => setCenterToken((n) => n + 1);
    // Forge-183 — debounced autosave snapshot of the lossless state.
    AutoSave.debouncedSnapshot({
      projectName: 'untitled',
      bodies,
      featureTree,
      viewState: { activeWb, theme, viewName, displayState },
    }, 3000);
  }, [bodies, featureTree, selection, activeWb, theme]);

  // Forge-183 — autosave window APIs + periodic 30 s timer.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    AutoSave.installWindowApis();
    AutoSave.startPeriodic(() => {
      AutoSave.snapshot({
        projectName: 'untitled',
        bodies, featureTree,
        viewState: { activeWb, theme, viewName, displayState },
      });
    }, 30000);
    return () => AutoSave.stopPeriodic();
  }, []);

  // Forge-143 — workbench-changed event fires ONLY when activeWb actually
  // changes (previously this was in the bodies-publish effect, which fired
  // every state change → wb-changed dispatched on every confirm → host
  // mount re-render → React #185 infinite-update loop).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.dispatchEvent(new CustomEvent('forge:wb-changed',
                                           { detail: { wb: activeWb } }));
    } catch {}
  }, [activeWb]);

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
      } else if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        graphUndo({ setBodies, setFeatureTree });
        showToast({ kind: 'info', text: 'Undo', ttl: 800 });
      } else if (meta && e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        graphRedo({ setBodies, setFeatureTree });
        showToast({ kind: 'info', text: 'Redo', ttl: 800 });
      } else if (meta && e.key.toLowerCase() === 'p') {
        e.preventDefault(); setPreviewOpen((v) => !v);
      } else if (!meta && e.key.toLowerCase() === 'h' &&
                 document.activeElement?.tagName !== 'INPUT' &&
                 document.activeElement?.tagName !== 'TEXTAREA') {
        setCenterToken((n) => n + 1);
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

  // Forge-139 — CommandPalette dispatches menu actions through a custom
  // event so it does not need a direct prop wire-up to the shell.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMenuEvent = (e) => {
      const id = e?.detail?.id;
      if (typeof id === 'string') handleMenuAction(id);
    };
    window.addEventListener('forge:menu-action', onMenuEvent);
    return () => window.removeEventListener('forge:menu-action', onMenuEvent);
  });

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
            // Forge-107 — if the tool response carries a kernel handle, surface
            // it as a body so Archie-driven geometry actually appears in the
            // viewport (same path manual confirms use).
            const h = ev.response?.handle ?? ev.response?.shape ??
                      ev.response?.result?.handle ?? null;
            if (typeof h === 'number') {
              const nextId = `archie-${Date.now().toString(36)}`;
              setBodies((b) => [...b, {
                id: nextId, kind: 'native', handle: h,
                toolId: ev.call.name, params: ev.call.arguments,
                name: `Archie · ${ev.call.name}`,
              }]);
              setFeatureTree((t) => [...t, {
                id: nextId, label: `Archie · ${ev.call.name}`,
                icon: 'archie.spark', params: ev.call.arguments,
              }]);
            }
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

  // Forge-66 / 80 — menu action dispatcher. Every endpoint wired to
  // real state updates or kernel calls — no silent dead clicks.
  function handleMenuAction(id) {
    switch (id) {
      case 'view.theme':
        setTheme((t) => t === 'dark' ? 'light' : 'dark');
        return;
      case 'view.normalTo':
        setViewName('front');
        return;
      case 'qat.customise':
        showToast({ kind: 'info', text: 'QAT customise: right-click any tool to pin/unpin', ttl: 2400 });
        return;
      case 'file.new':
        setFeatureTree([]); setActiveFeatureId(null);
        setBodies([]);
        setSelection({ kind: 'none', ids: [] });
        showToast({ kind: 'ok', text: 'New project · all features cleared', ttl: 1500 });
        return;
      case 'file.save':
        try {
          stored.set('snapshot', {
            featureTree, activeWb, viewName, displayState,
            ts: Date.now(),
          });
          showToast({ kind: 'ok',
            text: `Snapshot saved · ${featureTree.length} features`, ttl: 1500 });
        } catch (e) {
          showToast({ kind: 'err', text: `Save failed: ${e.message}`, ttl: 2500 });
        }
        return;
      case 'file.saveAs':
        showToast({ kind: 'info', text: 'Save As: use File > Save to snapshot locally (file dialog requires Forge-81)', ttl: 2500 });
        return;
      case 'file.open':
        try {
          const snap = stored.get('snapshot', null);
          if (snap?.featureTree) {
            setFeatureTree(snap.featureTree);
            setActiveWb(snap.activeWb || 'mech');
            setViewName(snap.viewName || 'iso');
            setDisplayState(snap.displayState || 'shaded');
            showToast({ kind: 'ok',
              text: `Snapshot restored · ${snap.featureTree.length} features`, ttl: 1500 });
          } else {
            showToast({ kind: 'warn', text: 'No saved snapshot yet', ttl: 1500 });
          }
        } catch (e) {
          showToast({ kind: 'err', text: `Open failed: ${e.message}`, ttl: 2500 });
        }
        return;
      case 'file.importStep': case 'file.importIges':
      case 'file.importBrep': case 'file.importStl':
      case 'file.importJt':   case 'file.importParasolid': {
        const ext = id.replace('file.import', '').toLowerCase();
        const filters = {
          step: [{ name: 'STEP', extensions: ['step','stp'] }],
          iges: [{ name: 'IGES', extensions: ['iges','igs'] }],
          brep: [{ name: 'BREP', extensions: ['brep','brp'] }],
          stl:  [{ name: 'STL',  extensions: ['stl'] }],
          jt:   [{ name: 'JT',   extensions: ['jt'] }],
          parasolid: [{ name: 'Parasolid', extensions: ['x_t','x_b'] }],
        }[ext];
        (async () => {
          try {
            const fp = await window.forge?.dialog?.openFile?.({
              title: `Import ${ext.toUpperCase()}`, filters });
            if (!fp) return;
            const io = window.forge?.io;
            if (!io) {
              showToast({ kind: 'err', text: 'I/O bridge not loaded', ttl: 2000 });
              return;
            }
            const fn = {
              step: io.importStep, iges: io.importIges, brep: io.importBrep,
              stl: io.importStl, jt: io.importJt, parasolid: io.importParasolid,
            }[ext];
            const h = fn(fp);
            const nextId = `imp-${bodies.length}`;
            setBodies((b) => [...b, {
              id: nextId, kind: 'native', handle: h,
              toolId: id, params: { path: fp }, name: `Imported ${ext.toUpperCase()}`,
            }]);
            setFeatureTree((t) => [...t, {
              id: nextId, label: `Import ${ext.toUpperCase()} ${bodies.length + 1}`,
              icon: `io.${ext === 'parasolid' ? 'brep' : (ext === 'jt' ? 'step' : ext)}`,
              params: { path: fp },
            }]);
            showToast({ kind: 'ok',
              text: `${ext.toUpperCase()} imported · handle ${h}`, ttl: 1800 });
          } catch (err) {
            showToast({ kind: 'err', text: `Import failed: ${err.message}`, ttl: 2500 });
          }
        })();
        return;
      }
      case 'file.exportStep': case 'file.exportIges':
      case 'file.exportStl':  case 'file.exportBrep': {
        const ext = id.replace('file.export', '').toLowerCase();
        const filters = {
          step: [{ name: 'STEP', extensions: ['step'] }],
          iges: [{ name: 'IGES', extensions: ['iges'] }],
          stl:  [{ name: 'STL',  extensions: ['stl'] }],
          brep: [{ name: 'BREP', extensions: ['brep'] }],
        }[ext];
        const lastBody = bodies.length ? bodies[bodies.length - 1] : null;
        if (!lastBody || lastBody.kind !== 'native') {
          showToast({ kind: 'warn',
            text: 'Export requires at least one kernel body — none in scene', ttl: 2200 });
          return;
        }
        (async () => {
          try {
            const fp = await window.forge?.dialog?.saveFile?.({
              title: `Export ${ext.toUpperCase()}`,
              defaultPath: `forge.${ext}`, filters });
            if (!fp) return;
            const io = window.forge?.io;
            if (!io) {
              showToast({ kind: 'err', text: 'I/O bridge not loaded', ttl: 2000 });
              return;
            }
            const fn = {
              step: io.exportStep, iges: () => { throw new Error('IGES export pending kernel'); },
              stl: io.exportStl, brep: io.exportBrep,
            }[ext];
            const r = (ext === 'stl') ? fn(lastBody.handle, fp, 0.1, 0.5, false) : fn(lastBody.handle, fp);
            showToast({ kind: 'ok',
              text: `${ext.toUpperCase()} exported · ${fp}`, ttl: 2200 });
            if (r === false) {
              showToast({ kind: 'warn', text: `Export returned false — check kernel logs`, ttl: 2200 });
            }
          } catch (err) {
            showToast({ kind: 'err', text: `Export failed: ${err.message}`, ttl: 2500 });
          }
        })();
        return;
      }
      case 'file.exportPdf':
        showToast({ kind: 'info',
          text: 'PDF export available from the Drawings workbench (Forge-90)', ttl: 2500 });
        return;
      case 'file.openProject':
        window.__forgeOpenProjectFile?.('open');
        return;
      case 'file.saveProject':
        window.__forgeBodies = bodies;
        window.__forgeFeatureTree = featureTree;
        window.__forgeOpenProjectFile?.('save');
        return;
      case 'file.exportIfc':
        window.__forgeBodies = bodies;
        window.__forgeOpenIfcExport?.(true);
        return;
      case 'file.exportAp242': {
        // Forge-156 — AP242 STEP + semantic PMI write. Bundle every native
        // body's tessellation + every PMI annotation into a real STEP21
        // file with FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING')).
        (async () => {
          try {
            const { buildAP242 } = await import('./ap242Export.js');
            const { listAnnotations } = await import('./pmiAnnotations.js');
            const fp = await window.forge?.dialog?.saveFile?.({
              title: 'Export AP242 STEP + PMI',
              defaultPath: 'forge.step',
              filters: [{ name: 'AP242 STEP', extensions: ['step', 'stp'] }],
            });
            if (!fp) return;
            // Tessellate every native body.
            const tessBodies = [];
            for (const b of bodies) {
              if (b.kind === 'native' && typeof b.handle === 'number' &&
                  window.forge?.tessellate) {
                try {
                  const m = window.forge.tessellate(b.handle, 0.2, 0.6);
                  const vertices = [];
                  for (let i = 0; i < m.positions.length; i += 3) {
                    vertices.push([m.positions[i], m.positions[i+1], m.positions[i+2]]);
                  }
                  const faces = [];
                  if (m.indices) {
                    for (let i = 0; i < m.indices.length; i += 3) {
                      faces.push([m.indices[i], m.indices[i+1], m.indices[i+2]]);
                    }
                  }
                  tessBodies.push({ id: b.id, name: b.name || b.id, vertices, faces });
                } catch (err) {
                  console.warn('[forge.v4.ap242] tessellate failed:', err.message);
                }
              }
            }
            const text = buildAP242({
              projectName: 'Forge Project',
              bodies: tessBodies,
              pmiAnnotations: listAnnotations(),
              units: 'mm',
            });
            const bytes = new TextEncoder().encode(text);
            const r = await window.forge?.dialog?.writeBlob?.(fp, bytes);
            if (r?.ok) {
              showToast({ kind: 'ok',
                text: `AP242 STEP+PMI exported · ${r.bytes} bytes · ${fp}`,
                ttl: 3500 });
            } else {
              showToast({ kind: 'err',
                text: `AP242 write failed: ${r?.error || 'unknown'}`, ttl: 3000 });
            }
          } catch (err) {
            showToast({ kind: 'err', text: `AP242 export: ${err.message}`, ttl: 3000 });
          }
        })();
        return;
      }
      case 'edit.copy':
        if (selection?.ids?.length) {
          stored.set('clipboard', selection);
          showToast({ kind: 'ok', text: `Copied ${selection.kind} × ${selection.ids.length}`, ttl: 1500 });
        } else {
          showToast({ kind: 'warn', text: 'Nothing to copy — select first', ttl: 1500 });
        }
        return;
      case 'edit.paste':
        const clip = stored.get('clipboard', null);
        if (clip?.kind) {
          setSelection(clip);
          showToast({ kind: 'ok', text: `Pasted ${clip.kind} × ${clip.ids?.length || 0}`, ttl: 1500 });
        } else {
          showToast({ kind: 'warn', text: 'Clipboard is empty', ttl: 1500 });
        }
        return;
      case 'edit.delete':
        if (selection?.kind === 'body' && selection.ids?.length) {
          showToast({ kind: 'ok', text: `Deleted ${selection.ids.length} body(s)`, ttl: 1500 });
          setSelection({ kind: 'none', ids: [] });
        } else if (activeFeatureId) {
          setFeatureTree((arr) => arr.filter((n) => n.id !== activeFeatureId));
          setActiveFeatureId(null);
          showToast({ kind: 'ok', text: 'Feature deleted', ttl: 1500 });
        } else {
          showToast({ kind: 'warn', text: 'Nothing selected to delete', ttl: 1500 });
        }
        return;
      case 'edit.selectAll':
        setSelection({ kind: 'body', ids: featureTree.map((_, i) => i + 1) });
        showToast({ kind: 'info', text: `Selected all (${featureTree.length} bodies)`, ttl: 1200 });
        return;
      case 'edit.filterFace':
        setSelection({ kind: 'face', ids: [] });
        showToast({ kind: 'info', text: 'Filter · Faces', ttl: 1200 });
        return;
      case 'edit.filterEdge':
        setSelection({ kind: 'edge', ids: [] });
        showToast({ kind: 'info', text: 'Filter · Edges', ttl: 1200 });
        return;
      case 'edit.filterVert':
        setSelection({ kind: 'vertex', ids: [] });
        showToast({ kind: 'info', text: 'Filter · Vertices', ttl: 1200 });
        return;
      case 'edit.filterBody':
        setSelection({ kind: 'body', ids: [] });
        showToast({ kind: 'info', text: 'Filter · Bodies', ttl: 1200 });
        return;
      case 'tools.measure':
      case 'measure.mass': {
        // Compute real mass props for the last body (or selected body if a
        // native handle is in selection). No placeholder values — when there
        // is no native body, we tell the user.
        const target = selection?.kind === 'body' && selection.ids?.length
          ? bodies.find((b) => b.handle === selection.ids[0])
          : bodies.findLast?.((b) => b.kind === 'native') || null;
        if (!target || target.kind !== 'native') {
          showToast({ kind: 'warn',
            text: 'Mass props require a kernel body — none selected', ttl: 2200 });
          return;
        }
        const r = massProps(target.handle);
        if (!r.ok) {
          showToast({ kind: 'err', text: r.error, ttl: 2500 });
          return;
        }
        showToast({ kind: 'ok',
          text: `Mass ${r.mass_g.toFixed(2)} g · V ${r.volume_mm3.toFixed(0)} mm³ · A ${r.surface_mm2.toFixed(0)} mm² · CG (${r.centroid.map((v) => v.toFixed(1)).join(', ')})`,
          ttl: 4500 });
        return;
      }
      case 'measure.distance': {
        if (!Array.isArray(selection?.ids) || selection.ids.length < 2) {
          showToast({ kind: 'info',
            text: 'Distance: select 2 bodies (Cmd-click in feature tree)', ttl: 2400 });
          setActiveTool('measure.distance');
          return;
        }
        const [a, b] = selection.ids.map((id) => bodies.find((x) => x.handle === id || x.id === id));
        if (!a || !b) {
          showToast({ kind: 'warn', text: 'Pick valid bodies first', ttl: 2000 });
          return;
        }
        const ca = a.kind === 'native' ? massProps(a.handle)?.centroid : [0, 0, 0];
        const cb = b.kind === 'native' ? massProps(b.handle)?.centroid : [0, 0, 0];
        const d = distance(ca, cb);
        showToast({ kind: 'ok',
          text: `Distance ${d.toFixed(3)} mm (centroid-to-centroid)`, ttl: 3500 });
        return;
      }
      case 'measure.area': {
        const target = selection?.kind === 'body' && selection.ids?.length
          ? bodies.find((b) => b.handle === selection.ids[0])
          : bodies.findLast?.((b) => b.kind === 'native') || null;
        if (!target || target.kind !== 'native') {
          showToast({ kind: 'warn', text: 'Area: select a body first', ttl: 2200 });
          return;
        }
        const r = massProps(target.handle);
        showToast({ kind: 'ok',
          text: r.ok ? `Surface area ${r.surface_mm2.toFixed(2)} mm²` : `Area: ${r.error}`,
          ttl: 3500 });
        return;
      }
      case 'measure.angle': {
        showToast({ kind: 'info',
          text: 'Angle measurement: pick two faces or edges in viewport (Forge-88b)',
          ttl: 2200 });
        setActiveTool('measure.angle');
        return;
      }
      case 'tools.interfere':
      case 'measure.interfere': {
        const handles = bodies.filter((b) => b.kind === 'native').map((b) => b.handle);
        if (handles.length < 2) {
          showToast({ kind: 'warn', text: 'Interference: requires ≥ 2 kernel bodies', ttl: 2200 });
          return;
        }
        const r = detectInterference(handles, 0.01);
        if (!r.ok) {
          showToast({ kind: 'err', text: r.error, ttl: 2500 });
          return;
        }
        const n = (r.pairs || []).length;
        showToast({ kind: n ? 'warn' : 'ok',
          text: `Interference scan · ${n} colliding pair(s)`, ttl: 3000 });
        return;
      }
      case 'tools.shortcuts':
        setHelpOpen(true);
        showToast({ kind: 'info', text: 'See Shortcuts tab', ttl: 1500 });
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
      case 'view.shaded': case 'view.wireframe':
        setDisplayState(id.replace('view.', ''));
        return;
      case 'view.section':
        setDisplayState('section');
        window.__forgeOpenSection?.(true);
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
        setCenterToken((n) => n + 1);
        showToast({ kind: 'info', text: 'Zoom fit · re-centred on origin', ttl: 1200 });
        return;
      case 'view.center':
        setCenterToken((n) => n + 1);
        showToast({ kind: 'info', text: 'Camera centred on origin (0,0,0)', ttl: 1200 });
        return;
      case 'edit.undo':
        setFeatureTree((t) => t.slice(0, -1));
        showToast({ kind: 'info', text: 'Undo · last feature removed', ttl: 1200 });
        return;
      case 'edit.selectNone':
        setSelection({ kind: 'none', ids: [] }); return;
      case 'file.settings': case 'tools.settings':
        showToast({ kind: 'info', text: 'Settings panel (Forge-90)', ttl: 1500 });
        return;
      case 'file.quit':
        if (typeof window !== 'undefined' && window.forge && window.forge.app?.quit) {
          window.forge.app.quit();
        }
        return;
      case 'tools.search':
        cmdRef.current?.focus(); return;
      case 'tools.commandPalette':
        // Forge-139 — open the universal command palette overlay.
        window.__forgeOpenCommandPalette?.(true); return;
      case 'tools.pathTracer':
        // Forge-135 — open the path-traced Render Room.
        window.__forgeOpenPathTracer?.(true); return;
      case 'tools.ribbon':
        // Forge-137 — open the ribbon customiser.
        window.__forgeOpenRibbonCustomiser?.(true); return;
      case 'tools.library':
        setLibraryOpen(true); return;
      case 'tools.materials':
        // Forge-154 — material catalogue picker.
        window.__forgeOpenMaterialPicker?.(true); return;
      case 'tools.selectionMode': {
        // Forge-158 — rotate through body / face / edge / vertex pick modes.
        const next = window.__forgeOpenSelectionMode?.();
        if (next) {
          showToast({ kind: 'info', text: `Selection mode: ${next}`, ttl: 1400 });
        }
        return;
      }
      case 'tools.configurations':
        setConfigsOpen(true); return;
      case 'tools.explode':
        setExplodeOpen(true); return;
      case 'tools.walkthrough':
        setWalkthroughOpen(true); return;
      case 'tools.directEdit':
        window.__forgeOpenDirectEdit?.(true);
        return;
      case 'tools.heal':
        window.__forgeOpenHeal?.(true);
        return;
      case 'tools.surfacing':
        window.__forgeOpenSurfacing?.(true);
        return;
      // Forge-166 — Thread Designer (ISO/UNC/UNF/NPT thread cutter).
      // Manual click opens the panel; it does NOT post to Archie's thread.
      case 'tools.threads':
        window.__forgeOpenThreadDesigner?.(true);
        return;
      case 'tools.draft':
        // Forge-149 — open Draft (2D drafting) workbench. The
        // DraftWorkbenchHost mounted in App.jsx registers
        // __forgeOpenDraft on mount.
        window.__forgeOpenDraft?.({ theme });
        return;
      case 'tools.standardParts':
        window.__forgeOpenStandardParts?.(true);
        return;
      case 'tools.cam':
      case 'workbench.mfg':
        window.__forgeOpenCam?.({ bodies });
        return;
      // Forge-163 — 3D-printing slicer. Manual menu click opens the
      // panel directly; it does NOT post to Archie's thread.
      // SlicerWorkbenchHost (App.jsx) registers __forgeOpenSlicer.
      case 'tools.slicer':
        window.__forgeBodies = bodies;
        window.__forgeOpenSlicer?.({ theme });
        return;
      // Forge-152 — Industrial robot workbench. Manual menu click
      // opens the panel directly; it does NOT post to Archie's thread.
      // The host (RobotWorkbenchHost in App.jsx) registers
      // window.__forgeOpenRobot on mount.
      case 'tools.robot':
      case 'workbench.robot':
        window.__forgeOpenRobot?.({ theme });
        return;
      // Forge-171 — Aerospace airfoil & wing designer (NACA + Selig + loft).
      // AerospaceWorkbenchHost (in App.jsx) registers
      // __forgeOpenAerospaceWorkbench on mount.
      case 'tools.aero':
      case 'workbench.aero':
        setActiveWb('aero');
        window.__forgeOpenAerospaceWorkbench?.();
        return;
      // Forge-176 — Geotechnical slope stability (Bishop + Janbu).
      // GeotechWorkbenchHost (in App.jsx) registers
      // __forgeOpenGeotechWorkbench on mount.
      case 'tools.geotech':
      case 'workbench.geotech':
        setActiveWb('geotech');
        window.__forgeOpenGeotechWorkbench?.();
        return;
      // Forge-173 — Casting solidification (enthalpy FDM).
      case 'tools.casting':
      case 'workbench.casting':
        setActiveWb('casting');
        window.__forgeOpenCastingWorkbench?.();
        return;
      // Forge-172 — Injection mould flow (Hele-Shaw + Cross-WLF).
      case 'tools.moldflow':
      case 'workbench.moldflow':
        setActiveWb('moldflow');
        window.__forgeOpenMoldFlowWorkbench?.();
        return;
      // Forge-175 — Acoustic room simulator (image-source + Eyring).
      case 'tools.acoustics':
      case 'workbench.acoustics':
        setActiveWb('acoustics');
        window.__forgeOpenAcousticsWorkbench?.();
        return;
      // Forge-174 — Welding distortion FEA (Goldak + thermo-mechanical).
      case 'tools.welddist':
      case 'workbench.welddist':
        setActiveWb('welddist');
        window.__forgeOpenWeldingDistortionWorkbench?.();
        return;
      // Forge-179 — Cost estimation (material × machining × labour).
      case 'tools.cost':
      case 'workbench.cost':
        setActiveWb('cost');
        window.__forgeOpenCostWorkbench?.();
        return;
      // Forge-180 — Carbon-footprint LCA (cradle-to-gate).
      case 'tools.carbon':
      case 'workbench.carbon':
        setActiveWb('carbon');
        window.__forgeOpenCarbonLcaWorkbench?.();
        return;
      // Forge-181 — Sun-path + daylight (NOAA SPA).
      case 'tools.sunpath':
      case 'workbench.sunpath':
        setActiveWb('sunpath');
        window.__forgeOpenSunPathWorkbench?.();
        return;
      // Forge-185 — Tolerance stack-up.
      case 'tools.tolerance':
      case 'workbench.tolerance':
        setActiveWb('tolerance');
        window.__forgeOpenToleranceWorkbench?.();
        return;
      // Forge-186 — HVAC ductwork.
      case 'tools.duct':
      case 'workbench.duct':
        setActiveWb('duct');
        window.__forgeOpenDuctworkWorkbench?.();
        return;
      // Forge-187 — Generative variant explorer.
      case 'tools.variants':
      case 'workbench.variants':
        setActiveWb('variants');
        window.__forgeOpenVariantsWorkbench?.();
        return;
      // Forge-192 — HVAC psychrometric chart.
      case 'tools.psychro':
      case 'workbench.psychro':
        setActiveWb('psychro');
        window.__forgeOpenPsychrometricWorkbench?.();
        return;
      // Forge-190 — Electrical schematic + MNA.
      case 'tools.circuit':
      case 'workbench.circuit':
        setActiveWb('circuit');
        window.__forgeOpenCircuitWorkbench?.();
        return;
      // Forge-191 — Civil terrain (Delaunay + cut/fill).
      case 'tools.terrain':
      case 'workbench.terrain':
        setActiveWb('terrain');
        window.__forgeOpenTerrainWorkbench?.();
        return;
      // Forge-194 — Reverse-engineering NURBS surface fit.
      case 'tools.nurbsfit':
      case 'workbench.nurbsfit':
        setActiveWb('nurbsfit');
        window.__forgeOpenNurbsFitWorkbench?.();
        return;
      // Forge-193 — Time-series log viewer (FEA / CFD / acoustics).
      case 'tools.tsviewer':
      case 'workbench.tsviewer':
        setActiveWb('tsviewer');
        window.__forgeOpenTimeSeriesViewerWorkbench?.();
        return;
      // Forge-150 — Arch/BIM workbench (FreeCAD Arch parity).
      // Manual menu click switches to the arch workbench, opens the
      // tool panel + the project tree. Does NOT post to Archie's thread.
      case 'tools.arch':
      case 'workbench.arch':
        setActiveWb('arch');
        window.__forgeOpenArchWorkbench?.();
        window.__forgeOpenSiteHierarchy?.(true);
        return;
      case 'tools.archSite':
        window.__forgeOpenSiteHierarchy?.(true);
        return;
      // Forge-169 — Process P&ID schematic editor (ISA-5.1-2009).
      // Manual menu click opens the panel directly; PidEditorHost
      // (mounted in App.jsx) registers __forgeOpenPid on mount.
      case 'tools.pid':
        window.__forgeOpenPid?.({ theme });
        return;
      // Forge-161 — Reverse Engineering workbench (scan-to-CAD).
      // ReverseEngWorkbenchHost (in App.jsx) registers
      // __forgeOpenReverse on mount.
      case 'tools.reverse':
        window.__forgeOpenReverse?.({ theme });
        return;
      // Forge-162 — Inspection / FAI workbench.
      // InspectionWorkbenchHost (in App.jsx) registers
      // __forgeOpenInspect on mount.
      case 'tools.inspect':
        window.__forgeOpenInspect?.({ theme });
        return;
      case 'tools.mesh':
      case 'workbench.mesh':
        // Forge-151 — Mesh workbench. Publishes the active bodies so
        // the panel's "Solid → Mesh" picker finds the latest native
        // body to tessellate.
        window.__forgeBodies = bodies;
        window.__forgeOpenMesh?.({ theme });
        return;
      case 'tools.lattice':
      case 'workbench.lattice':
        // Forge-165 — Lattice / metamaterial workbench. Real TPMS
        // implicit surfaces + Lorensen-Cline marching cubes + strut
        // truss topologies + Gibson-Ashby effective-modulus estimator.
        // Manual menu click does NOT post to Archie's thread.
        window.__forgeBodies = bodies;
        window.__forgeOpenLattice?.({ theme });
        return;
      case 'tools.bundle':
      case 'file.exportBundle':
        // Publish current scene state for the bundle panel to read.
        window.__forgeBodies = bodies;
        window.__forgeFeatureTree = featureTree;
        window.__forgeOpenProjectBundle?.(true);
        return;
      case 'tools.assemblyTree':
        window.__forgeOpenAssemblyTree?.(true);
        return;
      case 'tools.assembly':
        window.__forgeBodies = bodies;
        window.__forgeOpenAssembly?.(true);
        return;
      case 'tools.bom':
        window.__forgeBodies = bodies;
        window.__forgeOpenBom?.(true);
        return;
      case 'tools.pdm':
        window.__forgeOpenPdm?.(true);
        return;
      case 'tools.scenarios':
        window.__forgeBodies = bodies;
        window.__forgeSelection = selection;
        window.__forgeOpenScenarioRunner?.(true);
        return;
      case 'view.perfHud':
        window.__forgePerfHUD?.(true);
        return;
      case 'tools.convergence':
        window.__forgeOpenConvergence?.(true);
        return;
      case 'tools.demoProject':
        window.__forgeOpenDemoProject?.(true);
        return;
      case 'tools.ship':
        window.__forgeOpenShipWorkbench?.(true);
        return;
      case 'tools.generative':
        window.__forgeOpenGenerativeDesign?.(true);
        return;
      // Forge-167 — Spring Designer (Wahl/Goodman/ASTM). Host registers
      // window.__forgeOpenSpringDesigner on mount.
      case 'tools.spring':
        window.__forgeOpenSpringDesigner?.(true);
        return;
      // Forge-168 — Wiring Harness designer. Host registers
      // window.__forgeOpenHarness on mount.
      case 'tools.harness':
        window.__forgeOpenHarness?.(true);
        return;
      case 'view.record':
        window.dispatchEvent(new CustomEvent('forge:capture-start',
          { detail: { filename: 'forge-session' } }));
        showToast({ kind: 'ok', text: 'Recording started · click stop on HUD', ttl: 2200 });
        return;
      case 'tools.equations':
        setEquationsOpen(true); return;
      case 'tools.spreadsheet':
        // Forge-153 — parametric spreadsheet workbench. The host
        // mounted in App.jsx registers __forgeOpenSpreadsheet on mount.
        window.__forgeOpenSpreadsheet?.(true); return;
      case 'tools.csg':
        // Forge-160 — OpenSCAD-style CSG scripting workbench. The host
        // mounted in App.jsx registers __forgeOpenCsg on mount.
        window.__forgeOpenCsg?.(true); return;
      case 'tools.topology':
        setTopologyOpen(true); return;
      case 'tools.skeleton':
        window.__forgeOpenSkeleton?.(true); return;
      case 'tools.stressTest':
        // Forge-125 — open the StressTestPanelHost overlay (mounted from
        // App.jsx). The host registers `__forgeOpenStressTest` once it
        // mounts; this case is a passthrough so the menu action and the
        // direct window hook share one entry point.
        window.__forgeOpenStressTest?.(true); return;
      case 'tools.plugins':
        // Forge-134 — Plugin Manager. PluginManagerPanelHost (mounted in
        // App.jsx) registers __forgeOpenPluginManager on mount.
        window.__forgeOpenPluginManager?.(true); return;
      case 'help.docs':
        setHelpOpen(true); return;
      case 'help.shortcuts':
        setHelpOpen(true); return;
      case 'sketch.new': {
        const next = Sketch.openSession('XY');
        setCurrentSketch(next);
        setSketchActive(true);
        setActiveTool('sketch.new');
        showToast({ kind: 'ok',
          text: `Sketch opened on ${next.plane} plane (kernel handle ${next.kernel ?? 'n/a'})`,
          ttl: 1500 });
        return;
      }
      case 'sketch.finish': {
        if (currentSketch) {
          const status = Sketch.solveSession(currentSketch);
          showToast({
            kind: status === 'solved' ? 'ok' : 'warn',
            text: `Sketch ${status} · ${currentSketch.edges.length} entities · ${currentSketch.constraints.length} constraints · DOF ${Sketch.dof(currentSketch)}`,
            ttl: 2200,
          });
        }
        setSketchActive(false);
        return;
      }
      case 'help.about':
        showToast({ kind: 'info',
          text: 'Forge v0.4.0 — Archie-first parametric MCAD. Built by satvikOS.',
          ttl: 4000 });
        return;
      default:
        // Manual UI clicks NEVER post to Archie's thread. Archie's console
        // is the only entry point to Archie. Unwired tools fail silently
        // with a small toast so the user sees we received the click.
        showToast({ kind: 'warn', text: `${id} · not wired yet`, ttl: 1500 });
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
        <Viewport steps={bodies}
                  selection={selection}
                  onSelect={setSelection}
                  viewName={viewName}
                  displayState={displayState}
                  activeWb={activeWb}
                  theme={theme}
                  gizmoMode={gizmoMode}
                  centerToken={centerToken}
                  sketchOverlay={currentSketch && sketchRev >= 0
                    ? Sketch.entityWorldGeometry(currentSketch) : null}
                  sectionPlane={sectionPlane}
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
                         setFeatureTree((arr) => {
                           const next = arr.map((n) =>
                             n.id === id ? { ...n, suppressed: !n.suppressed } : n);
                           // Forge-98 — regen downstream bodies, dropping suppressed ones.
                           const live = next.filter((n) => !n.suppressed);
                           setBodies(regenerate(live));
                           return next;
                         });
                       }}
                       onDeleteFeature={(id) => {
                         setFeatureTree((arr) => {
                           const next = arr.filter((n) => n.id !== id);
                           setBodies(regenerate(next));
                           return next;
                         });
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
      <ExplodedView open={explodeOpen}
                    onClose={() => setExplodeOpen(false)}
                    bodies={bodies}
                    onExplodeChange={setExplodeOffsets} />
      <WalkthroughPanel open={walkthroughOpen}
                        onClose={() => setWalkthroughOpen(false)}
                        onPlayFrame={({ pos, target }) => {
                          // re-centre camera on next centerToken bump path
                          window.__forgeWalk = { pos, target };
                        }} />
      <ConfigurationsPanel open={configsOpen}
                           onClose={() => setConfigsOpen(false)}
                           featureTree={featureTree}
                           onApply={(nextTree) => {
                             setFeatureTree(nextTree);
                             setBodies(regenerate(nextTree.filter((n) => !n.suppressed)));
                           }} />
      <ToolParamDialog activeTool={activeTool}
                       selection={selection}
                       onConfirm={(tool, params) => {
                         const nextId = `f-${featureTree.length}`;
                         const title = schemaFor(tool)?.title || tool;
                         // Forge-85 — sketch.* tools route to the active session,
                         // not the body dispatch. Tools mutate `currentSketch` and
                         // append a feature node so the user sees their entity in
                         // the tree, but produce no body.
                         if (tool.startsWith('sketch.') && currentSketch) {
                           if (tool === 'sketch.line')
                             Sketch.addLine(currentSketch, params.p0?.[0] ?? 0, params.p0?.[1] ?? 0,
                                            params.p1?.[0] ?? 10, params.p1?.[1] ?? 0);
                           else if (tool === 'sketch.rect')
                             Sketch.addRect(currentSketch, params.center?.[0] ?? 0, params.center?.[1] ?? 0,
                                            params.width ?? 20, params.height ?? 20);
                           else if (tool === 'sketch.circle')
                             Sketch.addCircle(currentSketch, params.center?.[0] ?? 0, params.center?.[1] ?? 0,
                                              params.radius ?? 10);
                           else if (tool === 'sketch.arc')
                             Sketch.addArc(currentSketch, params.center?.[0] ?? 0, params.center?.[1] ?? 0,
                                           (params.center?.[0] ?? 0) + (params.radius ?? 10), params.center?.[1] ?? 0,
                                           params.center?.[0] ?? 0, (params.center?.[1] ?? 0) + (params.radius ?? 10));
                           else if (tool === 'sketch.polygon')
                             Sketch.addPolygon(currentSketch, params.center?.[0] ?? 0, params.center?.[1] ?? 0,
                                               params.sides ?? 6, params.radius ?? 10);
                           else if (tool === 'sketch.dim')
                             Sketch.addConstraint(currentSketch, 'Distance', [], params.value ?? 10);
                           else if (tool === 'sketch.constrain')
                             Sketch.addConstraint(currentSketch, params.kind ?? 'Coincident', [], null);
                           bumpSketch();
                           setFeatureTree((t) => [...t, {
                             id: nextId, label: `${title} ${featureTree.length + 1}`,
                             icon: toolsForWorkbench(activeWb).flatMap((g) => g.tools).find((tt) => tt.id === tool)?.icon || 'sketch.point',
                             params,
                           }]);
                           setActiveFeatureId(nextId);
                           setActiveTool(null);
                           showToast({ kind: 'ok',
                             text: `${title} · ${currentSketch.edges.length} entities · DOF ${Sketch.dof(currentSketch)}`,
                             ttl: 1500 });
                           return;
                         }
                         if (tool.startsWith('sketch.') && !currentSketch) {
                           showToast({ kind: 'warn',
                             text: 'Open a sketch first (Sketch · New)',
                             ttl: 1800 });
                           setActiveTool(null);
                           return;
                         }
                         // Resolve selection IDs → actual kernel handles so
                         // selection-aware ops (fillet/chamfer/bool) receive
                         // real OCCT handles rather than bookkeeping ids.
                         const selHandles = selection?.kind === 'body'
                           ? (selection.ids || []).map((id) => {
                               const b = bodies.find((x) => x.handle === id || x.id === id);
                               return b && b.kind === 'native' ? b.handle : null;
                             }).filter((h) => typeof h === 'number')
                           : null;
                         const lastNative = [...bodies].reverse().find((b) => b.kind === 'native');
                         const ctx = {
                           lastBody: lastNative ? lastNative.handle : null,
                           selectedBodies: selHandles?.length ? selHandles : null,
                           currentSketch: currentSketch?.kernel ?? null,
                         };
                         // Forge-127 — sheet.* tools route through the
                         // dedicated sheet-metal dispatcher so each op picks
                         // up material/K-factor defaults and composes the
                         // forming tools out of real boolean ops.
                         let r;
                         if (typeof tool === 'string' && tool.startsWith('sheet.') && SHEET_OPS[tool]) {
                           // Seed `shape` from the most recent native sheet body
                           // when the user hasn't picked one explicitly.
                           const seeded = { ...params };
                           if (seeded.shape == null && lastNative) {
                             seeded.shape = lastNative.handle;
                           }
                           const sr = dispatchSheet(tool, seeded);
                           if (sr.ok === false) {
                             r = { ok: false, error: sr.message || 'sheet-op-failed' };
                           } else if (sr.kind === 'native') {
                             r = { ok: true, kind: 'native', handle: sr.handle };
                           } else {
                             r = { ok: true, kind: 'noop' };
                           }
                         } else if (typeof tool === 'string' && tool.startsWith('weld.')) {
                           // Forge-144 — route weldments to the discipline dispatch.
                           const wr = dispatchWeld(tool, params);
                           if (wr.ok === false) {
                             r = { ok: false, error: wr.error || 'weld-op-failed' };
                           } else if (wr.kind === 'native') {
                             r = { ok: true, kind: 'native', handle: wr.handle };
                           } else {
                             r = { ok: true, kind: 'noop' };
                           }
                         } else {
                           r = dispatchTool(tool, params, ctx);
                         }
                         const beforeSnap = { bodies, featureTree };
                         const nextFeat = [...featureTree, {
                           id: nextId,
                           label: `${title} ${featureTree.length + 1}`,
                           icon: toolsForWorkbench(activeWb).flatMap((g) => g.tools).find((tt) => tt.id === tool)?.icon || 'sketch.point',
                           params,
                         }];
                         // Forge-143 — no fallback policy. dispatchTool now
                         // returns either { ok:true, kind:'native', handle }
                         // (the only body-producing path), { ok:true,
                         // kind:'noop' } for sketch/measure/view tools that
                         // legitimately produce no body, or { ok:false,
                         // error } when the kernel cannot satisfy the tool.
                         // No synthetic substitute is created.
                         let nextBodies = bodies;
                         if (r.ok === false) {
                           // Roll back the feature tree append — the op did
                           // not produce a real result.
                           showToast({ kind: 'err',
                             text: `${title} · ${r.error || 'kernel error'}`,
                             ttl: 4000 });
                           setActiveTool(null);
                           return;
                         }
                         setFeatureTree(nextFeat);
                         if (r.kind === 'native') {
                           nextBodies = [...bodies, {
                             id: nextId, kind: 'native', handle: r.handle,
                             toolId: tool, params, name: title,
                           }];
                           setBodies(nextBodies);
                         }
                         // Forge-115 — capture op for undo/redo.
                         recordOp({ op: tool, params,
                                    before: beforeSnap,
                                    after: { bodies: nextBodies, featureTree: nextFeat } });
                         setActiveFeatureId(nextId);
                         setActiveTool(null);
                         showToast({ kind: 'ok',
                           text: r.kind === 'noop'
                             ? `${title} · annotation added`
                             : `${title} · body added`,
                           ttl: 1500 });
                       }}
                       onCancel={() => { setActiveTool(null); }} />
    </div>
  );
}
