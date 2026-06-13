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
// Forge-162 — viewport perception (static import: see runArchie for the
// per-turn caption capture). The legacy dynamic import here lost its
// failures in a silent catch; static import surfaces any bundler issue
// at load time the way slice 951q does for Studio.
import { captureForgeViewportCaption as _captureForgeViewportCaption } from '../ai/VisionPerception.js';
// Forge-163 — long-session memory client (Phase A.4 — Forge half).
import { recallPriorTurns as _recallPriorTurns, rememberTurn as _rememberTurn } from '../ai/SessionMemoryClient.js';
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
import {
  offsetPlaneSpec, planeThrough3PointsSpec, midPlaneSpec, axisFrom2PointsSpec,
} from '../kernel/forge/ReferenceGeometry.js';
import { massProps, distance, angle, meshArea, meshBounds, detectInterference } from './measureDispatch.js';
import { ConfigurationsPanel, pushHistory, loadConfigurations, saveConfigurations } from './ConfigurationsPanel.jsx';
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

// Forge-165 — Phase D.3 simulation auto-trigger (impl in simTriggers.js
// so the unit test can import it without going through the JSX shell).
import { detectSimTriggers as _detectSimTriggers } from './simTriggers.js';

export function ForgeShellV4() {
  const [theme, setTheme]             = useState(() => stored.get('theme', 'dark'));
  const [activeWb, setActiveWb]       = useState(() => stored.get('wb', 'mech'));
  const [activeTool, setActiveTool]   = useState(null);
  const [selection, setSelection]     = useState({ kind: 'none', ids: [] });
  // Slice-4 — datum/reference geometry created by the user (offset planes,
  // 3-point planes, mid-planes, axes). Each is { id, kind, name, origin,
  // normal|direction }. Sketchable planes feed Sketch.openSession(frame).
  const [datumPlanes, setDatumPlanes] = useState([]);
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
  // Forge-191 — monotonic suffix so Archie-created body ids stay unique
  // even when speculative dispatch lands several in one millisecond.
  const _archieBodySeq = useRef(0);

  // Theme into the data attribute that the tokens.css selectors read.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-forge-theme', theme);
    stored.set('theme', theme);
  }, [theme]);
  // PUSH-79 — the Theme switcher panel writes the chosen theme to the
  // SAME localStorage key the shell reads (`forge.v4.theme`), but the
  // shell's React `theme` state would otherwise overwrite the panel's
  // value on the next render. Subscribe to forge:theme-changed so the
  // shell's React state stays synced to whatever the panel last wrote.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const valid = new Set(['dark', 'light', 'sepia', 'high-contrast']);
    const onThemeChanged = (e) => {
      const next = e?.detail?.theme;
      if (typeof next === 'string' && valid.has(next) && next !== theme) {
        setTheme(next);
      }
    };
    window.addEventListener('forge:theme-changed', onThemeChanged);
    return () => window.removeEventListener('forge:theme-changed', onThemeChanged);
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
    // Selection setter — lets the viewport picker (and e2e) drive the
    // shell's selection without poking React state directly. Mirrors the
    // onSelect handler the viewport already calls.
    window.__forgeSelect = (sel) => setSelection(sel);
    // Sketch-on-face (#216) — expose the active sketch session so the
    // dispatch/overlay and tooling can read its plane frame.
    window.__forgeCurrentSketch = currentSketch;
    window.__forgeDatums = datumPlanes;
    window.__forgeActiveWb    = activeWb;
    window.__forgeTheme       = theme;
    // Publish the live configurations record so projectFile.save reads the
    // current variant set (PUSH-56). The Configurations panel writes to
    // localStorage on every edit; reading from LS here keeps the renderer
    // and React state in sync without piping the state through.
    try { window.__forgeConfigurations = loadConfigurations(); } catch {}
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
  }, [bodies, featureTree, selection, activeWb, theme, currentSketch, datumPlanes]);

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

  // PUSH-31 — Smart-fit camera to body bounds whenever viewName changes.
  // Triggered by both the numeric keyboard shortcuts (1-7) and the
  // view.iso/front/top/right/... menu actions.
  useEffect(() => {
    if (typeof window === 'undefined' || !viewName) return undefined;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        try {
          const THREE = window.__forgeThree;
          const scene = window.__forgeScene;
          const fit = window.__forgeFitToBounds;
          if (!THREE || !scene || typeof fit !== 'function') return;
          const box = new THREE.Box3();
          let any = false;
          scene.traverse((o) => {
            if (o.isMesh && o.geometry && !o.userData?.helper) {
              box.expandByObject(o);
              any = true;
            }
          });
          if (!any) return;
          const dirs = {
            front:  [0, -1, 0.05],
            back:   [0,  1, 0.05],
            top:    [0,  0.05, 1],
            bottom: [0,  0.05, -1],
            right:  [1,  0, 0.05],
            left:   [-1, 0, 0.05],
            iso:    [1, -0.7, 1],
          };
          fit(box, { dir: dirs[viewName] || dirs.iso, margin: 1.8 });
        } catch { /* ignore */ }
      });
    });
    return () => {
      try { cancelAnimationFrame(raf1); } catch {}
      try { cancelAnimationFrame(raf2); } catch {}
    };
  }, [viewName]);

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
    // Forge-165 — Phase D.3: simulation auto-trigger. Scan the prompt
    // for load-bearing / dynamic / thermal cues and post a hint to
    // the thread so Archie + the user both see that a Linear Static /
    // Modal / Thermal analysis is appropriate. The user can act on it;
    // a future training pass will teach Archie to auto-include the
    // matching simulate.fea-* tool_calls.
    const _simHint = _detectSimTriggers(prompt);
    if (_simHint) pushThread({ role: 'tool', text: `[sim auto-trigger] ${_simHint}` });
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
    // Forge-162 — viewport perception. Capture the live viewport caption
    // via the local VL server before dispatching the Archie turn. The
    // helper itself bounds the call with an AbortController so a slow
    // VL response cannot stall the chat dispatch; empty caption (vision
    // down or opt-out) means Archie runs blind and the prompt goes
    // through unwrapped.
    let viewportState = '';
    try { viewportState = await _captureForgeViewportCaption(); }
    catch (_) { /* vision optional */ }
    // Forge-163 — long-session memory recall. Same bounded-timeout
    // pattern; empty string when the store is down or opted out so
    // Archie's prompt goes through unwrapped.
    let priorContext = '';
    try { priorContext = await _recallPriorTurns(prompt, { app: 'forge' }); }
    catch (_) { /* memory optional */ }
    const ac = new AbortController();
    archieAbortRef.current = ac;
    // Forge-164 — pre-push a pending archie message that streaming
    // tokens flow into. The post-dispatch final-status block below
    // strips the pending flag + finalises the text; the per-turn
    // tool messages still arrive via onTrace.
    pushThread({ role: 'archie', text: '…thinking…', pending: true });
    const _streamUpdate = (acc) => {
      const visible = (acc || '')
        .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
        .trim();
      setThread((t) => {
        // Update the latest pending archie message.
        for (let i = t.length - 1; i >= 0; i--) {
          if (t[i].role === 'archie' && t[i].pending) {
            const next = t.slice();
            next[i] = { ...t[i], text: visible || '…thinking…' };
            return next;
          }
        }
        return t;
      });
    };
    try {
      const trace = await runForgePrompt({
        prompt,
        discipline: activeWb === 'mech' ? 'part' : activeWb,
        signal: ac.signal,
        forge: window.forge,
        viewportState,
        priorContext,
        onToken: ({ acc_content }) => _streamUpdate(acc_content),
        onTrace: (ev) => {
          if (ev.kind === 'tool') {
            pushThread({
              role: 'tool',
              text: `${ev.call.name}(${JSON.stringify(ev.call.arguments)}) → ${
                ev.response?.ok === false ? '✗ ' + (ev.response.error || 'err')
                                          : '✓'}`,
            });
            // Forge-107/191 — if the tool response carries a kernel handle,
            // surface it as a body so Archie-driven geometry actually appears
            // in the viewport (same path manual confirms use). Forge-191:
            // dispatchToolCall nests the run() payload under `result`, and
            // every part.make-* tool returns `{ shape: <handle> }` — the
            // legacy chain never checked result.shape, so Archie dispatches
            // ticked ✓ in the thread while the viewport stayed empty.
            const _res = ev.response?.result;
            const h = ev.response?.handle ?? ev.response?.shape ??
                      _res?.handle ?? _res?.shape ?? null;
            if (typeof h === 'number') {
              // Forge-191 — Date.now() alone collides when speculative
              // dispatch lands two bodies in the same millisecond.
              const nextId = `archie-${Date.now().toString(36)}-${(_archieBodySeq.current += 1)}`;
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
      // Forge-164 — finalize the pre-pushed pending archie message
      // (drop pending flag + write the canonical final text) so the
      // streaming buffer becomes the durable response. Push a new
      // message only when the pending entry isn't found.
      const _finalizePending = (text) => {
        setThread((t) => {
          for (let i = t.length - 1; i >= 0; i--) {
            if (t[i].role === 'archie' && t[i].pending) {
              const next = t.slice();
              next[i] = { ...t[i], text, pending: false };
              return next;
            }
          }
          return [...t, { role: 'archie', text }];
        });
      };
      if (trace.final?.status === 'done' && trace.final.text) {
        _finalizePending(trace.final.text);
      } else if (trace.final?.status === 'clarify') {
        _finalizePending(`Need: ${trace.final.clarify.question || '…'}`);
      } else if (trace.final?.status === 'cancelled') {
        _finalizePending('(cancelled)');
      } else if (trace.final?.status === 'maxTurns') {
        _finalizePending('(max turns — try a smaller step)');
      } else {
        _finalizePending(trace.final?.text || '');
      }
      // Forge-163 — fire-and-forget remember this turn. The trace
      // captures both the final text AND the tool_call sequence; we
      // give the store the dispatched tool_calls so future recall
      // surfaces "last time you asked for X, Archie ran tools Y, Z".
      const toolCalls = [];
      for (const it of (trace.iterations || [])) {
        for (const c of (it?.parsed?.toolCalls || [])) toolCalls.push(c);
      }
      // Forge-194 — store a DIGEST, never raw tags (mirror of Studio
      // 952/956): a recalled <tool_call> dump inside <prior_context>
      // hijacks the next reply. Recall-side sanitization exists too;
      // store-side keeps the DB itself clean.
      const _rawFinal = (trace.final?.text || trace.final?.status || '');
      // Slice 963 mirror — the digest must read as a TRAINED
      // prior_context clause; "dispatched N tool calls" is an alien
      // shape that collapsed Studio's staged prompts when recalled.
      const _summary = /<(tool_call|plan|think)>/i.test(_rawFinal)
        ? 'Built the requested bodies; checks passed.'
        : _rawFinal.replace(/<\/?\s*(tool_call|plan|think|viewport_state|prior_context|clarify)\b[^>]*>/gi, ' ').slice(0, 800);
      _rememberTurn({
        app: 'forge', user_text: prompt,
        assistant_summary: _summary,
        tool_calls: toolCalls.length ? toolCalls : null,
      });
    } catch (err) {
      // Forge-164 — also finalize the pending message on error so the
      // user doesn't see "…thinking…" stuck after a failure.
      const txt = err.name === 'AbortError' ? '(cancelled)' : `Error: ${err.message}`;
      setThread((t) => {
        for (let i = t.length - 1; i >= 0; i--) {
          if (t[i].role === 'archie' && t[i].pending) {
            const next = t.slice();
            next[i] = { ...t[i], text: txt, pending: false };
            return next;
          }
        }
        return [...t, { role: 'archie', text: txt }];
      });
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
      case 'view.back': case 'view.bottom': case 'view.left':
        // Smart-fit is handled by the useEffect on viewName so this code
        // path AND the numeric keyboard shortcuts both get fit-on-change.
        setViewName(id.replace('view.', ''));
        return;
      case 'view.zoomFit':
      case 'view.fit': {
        // Same smart-fit, but keep current view direction.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          try {
            const THREE = window.__forgeThree;
            const scene = window.__forgeScene;
            const fit = window.__forgeFitToBounds;
            if (!THREE || !scene || typeof fit !== 'function') return;
            const box = new THREE.Box3();
            let any = false;
            scene.traverse((o) => {
              if (o.isMesh && o.geometry) { box.expandByObject(o); any = true; }
            });
            if (any) fit(box, { margin: 1.8 });
          } catch (err) { /* ignore */ }
        }));
        return;
      }
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
      // PUSH-42 — HLR engineering drawings workbench.
      case 'tools.drawingsHlr':
        window.__forgeOpenDrawingsHLRWorkbench?.(true);
        return;
      // PUSH-110 (Slice-79) — Print Preview / PDF panel.
      // PrintPreviewPanelHost (App.jsx) registers __forgeOpenPrintPreview.
      case 'tools.printPreview':
        window.__forgeOpenPrintPreview?.();
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
      // PUSH-98 (Slice-66) — Drilling Pattern. Batched cam.drill across
      // a hole table. The host (DrillingPatternPanelHost in App.jsx)
      // registers window.__forgeOpenDrillingPattern on mount.
      case 'tools.drillingPattern':
      case 'workbench.drillingPattern':
        if (typeof window !== 'undefined') window.__forgeBodies = bodies;
        window.__forgeOpenDrillingPattern?.();
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
      // Forge-91 — Simulation workbench (FEA / CFD).
      case 'tools.simulation':
      case 'tools.fea':
      case 'workbench.simulation':
        setActiveWb('simulation');
        window.__forgeOpenSimulation?.();
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
      // Forge-196 — ARIA / accessibility audit.
      case 'tools.a11y':
      case 'workbench.a11y':
        setActiveWb('a11y');
        window.__forgeOpenA11yWorkbench?.();
        return;
      // Forge-197 — Webhook receiver.
      case 'tools.webhook':
      case 'workbench.webhook':
        setActiveWb('webhook');
        window.__forgeOpenWebhookWorkbench?.();
        return;
      // Forge-198 — Streaming glTF publish.
      case 'tools.gltf-publish':
      case 'workbench.gltf-publish':
        setActiveWb('gltf-publish');
        window.__forgeOpenGltfPublishWorkbench?.();
        return;
      // Forge-200 — Mesh repair toolkit.
      case 'tools.meshrepair':
      case 'workbench.meshrepair':
        setActiveWb('meshrepair');
        window.__forgeOpenMeshRepairWorkbench?.();
        return;
      // Forge-201 — Sheet metal flat-pattern unfold.
      case 'tools.sheetmetal-unfold':
      case 'workbench.sheetmetal-unfold':
        setActiveWb('sheetmetal-unfold');
        window.__forgeOpenSheetMetalUnfoldWorkbench?.();
        return;
      // Forge-202 — Point cloud / reverse engineering.
      case 'tools.pointcloud':
      case 'workbench.pointcloud':
        setActiveWb('pointcloud');
        window.__forgeOpenPointCloudWorkbench?.();
        return;
      // Forge-203 — Path tracer preview.
      case 'tools.pathtrace':
      case 'workbench.pathtrace':
        setActiveWb('pathtrace');
        window.__forgeOpenPathTraceWorkbench?.();
        return;
      // Forge-204 — Standard parts library.
      case 'tools.stdparts':
      case 'workbench.stdparts':
        setActiveWb('stdparts');
        window.__forgeOpenStdPartsWorkbench?.();
        return;
      // Forge-205 — Frame / truss FEA.
      case 'tools.frame':
      case 'workbench.frame':
        setActiveWb('frame');
        window.__forgeOpenFrameWorkbench?.();
        return;
      // Forge-206 — Pipe routing.
      case 'tools.piperoute':
      case 'workbench.piperoute':
        setActiveWb('piperoute');
        window.__forgeOpenPipeRouteWorkbench?.();
        return;
      // Forge-207 — DXF round-trip.
      case 'tools.dxf':
      case 'workbench.dxf':
        setActiveWb('dxf');
        window.__forgeOpenDxfWorkbench?.();
        return;
      // Forge-208 — Sketch DOF audit.
      case 'tools.sketchdof':
      case 'workbench.sketchdof':
        setActiveWb('sketchdof');
        window.__forgeOpenSketchDofWorkbench?.();
        return;
      // Forge-209 — Animation timeline.
      case 'tools.animation':
      case 'workbench.animation':
        setActiveWb('animation');
        window.__forgeOpenAnimationWorkbench?.();
        return;
      // Forge-210 — Modal analysis.
      case 'tools.modal':
      case 'workbench.modal':
        setActiveWb('modal');
        window.__forgeOpenModalWorkbench?.();
        return;
      // Forge-211 — Thermal network FEA.
      case 'tools.thermal':
      case 'workbench.thermal':
        setActiveWb('thermal');
        window.__forgeOpenThermalWorkbench?.();
        return;
      // Forge-212 — Fatigue life calculator.
      case 'tools.fatigue':
      case 'workbench.fatigue':
        setActiveWb('fatigue');
        window.__forgeOpenFatigueWorkbench?.();
        return;
      // Forge-214 — Bolt joint calculator.
      case 'tools.boltjoint':
      case 'workbench.boltjoint':
        setActiveWb('boltjoint');
        window.__forgeOpenBoltJointWorkbench?.();
        return;
      // Forge-215 — Column buckling.
      case 'tools.buckling':
      case 'workbench.buckling':
        setActiveWb('buckling');
        window.__forgeOpenBucklingWorkbench?.();
        return;
      // Forge-219 — Material properties database.
      case 'tools.materialdb':
      case 'workbench.materialdb':
        setActiveWb('materialdb');
        window.__forgeOpenMaterialWorkbench?.();
        return;
      // Forge-216 — Beam deflection.
      case 'tools.beam':
      case 'workbench.beam':
        setActiveWb('beam');
        window.__forgeOpenBeamWorkbench?.();
        return;
      // Forge-217 — Spring design.
      case 'tools.spring':
      case 'workbench.spring':
        setActiveWb('spring');
        window.__forgeOpenSpringWorkbench?.();
        return;
      // Forge-218 — Heat exchanger LMTD.
      case 'tools.hxc':
      case 'workbench.hxc':
        setActiveWb('hxc');
        window.__forgeOpenHxcWorkbench?.();
        return;
      // Forge-220 — Mohr's circle.
      case 'tools.mohr':
      case 'workbench.mohr':
        setActiveWb('mohr');
        window.__forgeOpenMohrWorkbench?.();
        return;
      // Forge-224 — Polygon section properties.
      case 'tools.polysec':
      case 'workbench.polysec':
        setActiveWb('polysec');
        window.__forgeOpenPolySecWorkbench?.();
        return;
      // Forge-221 — Spur gear pair.
      case 'tools.gearpair':
      case 'workbench.gearpair':
        setActiveWb('gearpair');
        window.__forgeOpenGearPairWorkbench?.();
        return;
      // Forge-222 — Hydraulic cylinder sizing.
      case 'tools.hydcyl':
      case 'workbench.hydcyl':
        setActiveWb('hydcyl');
        window.__forgeOpenHydCylWorkbench?.();
        return;
      // Forge-223 — Wind load (ASCE 7).
      case 'tools.windload':
      case 'workbench.windload':
        setActiveWb('windload');
        window.__forgeOpenWindLoadWorkbench?.();
        return;
      // Forge-225 — Snow load (ASCE 7).
      case 'tools.snowload':
      case 'workbench.snowload':
        setActiveWb('snowload');
        window.__forgeOpenSnowLoadWorkbench?.();
        return;
      // Forge-226 — Bearing L10 life.
      case 'tools.bearing':
      case 'workbench.bearing':
        setActiveWb('bearing');
        window.__forgeOpenBearingWorkbench?.();
        return;
      // Forge-227 — V-belt drive.
      case 'tools.vbelt':
      case 'workbench.vbelt':
        setActiveWb('vbelt');
        window.__forgeOpenVBeltWorkbench?.();
        return;
      // Forge-228 — Pressure vessel.
      case 'tools.pvessel':
      case 'workbench.pvessel':
        setActiveWb('pvessel');
        window.__forgeOpenPVesselWorkbench?.();
        return;
      // Forge-229 — Pump head / pipe flow.
      case 'tools.pumphead':
      case 'workbench.pumphead':
        setActiveWb('pumphead');
        window.__forgeOpenPumpHeadWorkbench?.();
        return;
      // Forge-230 — Refrigeration COP.
      case 'tools.refrig':
      case 'workbench.refrig':
        setActiveWb('refrig');
        window.__forgeOpenRefrigWorkbench?.();
        return;
      // Forge-231 — Fan / blower sizing.
      case 'tools.fan':
      case 'workbench.fan':
        setActiveWb('fan');
        window.__forgeOpenFanWorkbench?.();
        return;
      // Forge-232 — Steel column (AISC 360 §E3).
      case 'tools.steelcol':
      case 'workbench.steelcol':
        setActiveWb('steelcol');
        window.__forgeOpenSteelColWorkbench?.();
        return;
      // Forge-234 — Seismic load (ASCE 7 §12.8 ELF).
      case 'tools.seismic':
      case 'workbench.seismic':
        setActiveWb('seismic');
        window.__forgeOpenSeismicWorkbench?.();
        return;
      // Forge-235 — Shaft (combined bending + torsion).
      case 'tools.shaft':
      case 'workbench.shaft':
        setActiveWb('shaft');
        window.__forgeOpenShaftWorkbench?.();
        return;
      // Forge-236 — Bolted connection (AISC J3 / EC3 §3.6).
      case 'tools.boltconn':
      case 'workbench.boltconn':
        setActiveWb('boltconn');
        window.__forgeOpenBoltConnWorkbench?.();
        return;
      // Forge-237 — Fillet weld (AISC J2 / AWS D1.1).
      case 'tools.filletweld':
      case 'workbench.filletweld':
        setActiveWb('filletweld');
        window.__forgeOpenFilletWeldWorkbench?.();
        return;
      // Forge-238 — RC beam flexure (ACI 318-19).
      case 'tools.rcbeam':
      case 'workbench.rcbeam':
        setActiveWb('rcbeam');
        window.__forgeOpenRcBeamWorkbench?.();
        return;
      // Forge-239 — Soil bearing capacity (Terzaghi + Meyerhof).
      case 'tools.bearingcap':
      case 'workbench.bearingcap':
        setActiveWb('bearingcap');
        window.__forgeOpenBearingCapWorkbench?.();
        return;
      // Forge-240 — Retaining wall (Rankine + stability).
      case 'tools.retwall':
      case 'workbench.retwall':
        setActiveWb('retwall');
        window.__forgeOpenRetWallWorkbench?.();
        return;
      // Forge-241 — Pile capacity (α + Meyerhof).
      case 'tools.pilecap':
      case 'workbench.pilecap':
        setActiveWb('pilecap');
        window.__forgeOpenPileCapWorkbench?.();
        return;
      // Forge-242 — Open channel (Manning + critical depth).
      case 'tools.openchan':
      case 'workbench.openchan':
        setActiveWb('openchan');
        window.__forgeOpenOpenChanWorkbench?.();
        return;
      // Forge-243 — Weir / V-notch / orifice.
      case 'tools.weir':
      case 'workbench.weir':
        setActiveWb('weir');
        window.__forgeOpenWeirWorkbench?.();
        return;
      // Forge-244 — Three-phase power.
      case 'tools.threephase':
      case 'workbench.threephase':
        setActiveWb('threephase');
        window.__forgeOpenThreePhaseWorkbench?.();
        return;
      // Forge-245 — Transformer.
      case 'tools.xformer':
      case 'workbench.xformer':
        setActiveWb('xformer');
        window.__forgeOpenXformerWorkbench?.();
        return;
      // Forge-246 — Induction motor.
      case 'tools.imotor':
      case 'workbench.imotor':
        setActiveWb('imotor');
        window.__forgeOpenIMotorWorkbench?.();
        return;
      // Forge-247 — Symmetrical components.
      case 'tools.symcomp':
      case 'workbench.symcomp':
        setActiveWb('symcomp');
        window.__forgeOpenSymCompWorkbench?.();
        return;
      // Forge-248 — Transmission line.
      case 'tools.tline':
      case 'workbench.tline':
        setActiveWb('tline');
        window.__forgeOpenTLineWorkbench?.();
        return;
      // Forge-249 — Synchronous machine.
      case 'tools.syncm':
      case 'workbench.syncm':
        setActiveWb('syncm');
        window.__forgeOpenSyncMWorkbench?.();
        return;
      // Forge-250 — Newton-Raphson power flow.
      case 'tools.pflow':
      case 'workbench.pflow':
        setActiveWb('pflow');
        window.__forgeOpenPFlowWorkbench?.();
        return;
      // Forge-251 — Short-circuit study.
      case 'tools.scstudy':
      case 'workbench.scstudy':
        setActiveWb('scstudy');
        window.__forgeOpenSCStudyWorkbench?.();
        return;
      // Forge-252 — Cable sizing.
      case 'tools.cable':
      case 'workbench.cable':
        setActiveWb('cable');
        window.__forgeOpenCableWorkbench?.();
        return;
      // Forge-253 — Lighting design.
      case 'tools.lighting':
      case 'workbench.lighting':
        setActiveWb('lighting');
        window.__forgeOpenLightingWorkbench?.();
        return;
      // Forge-254 — Battery sizing.
      case 'tools.battery':
      case 'workbench.battery':
        setActiveWb('battery');
        window.__forgeOpenBatteryWorkbench?.();
        return;
      // Forge-255 — Solar PV sizing.
      case 'tools.solar':
      case 'workbench.solar':
        setActiveWb('solar');
        window.__forgeOpenSolarWorkbench?.();
        return;
      // Forge-256 — Hydrology.
      case 'tools.hydro':
      case 'workbench.hydro':
        setActiveWb('hydro');
        window.__forgeOpenHydroWorkbench?.();
        return;
      // Forge-257 — RC column.
      case 'tools.rccolumn':
      case 'workbench.rccolumn':
        setActiveWb('rccolumn');
        window.__forgeOpenRcColumnWorkbench?.();
        return;
      // Forge-258 — Machining.
      case 'tools.machining':
      case 'workbench.machining':
        setActiveWb('machining');
        window.__forgeOpenMachiningWorkbench?.();
        return;
      // Forge-259 — Combustion analysis.
      case 'tools.combustion':
      case 'workbench.combustion':
        setActiveWb('combustion');
        window.__forgeOpenCombustionWorkbench?.();
        return;
      // Forge-260 — Vibration isolation.
      case 'tools.vibiso':
      case 'workbench.vibiso':
        setActiveWb('vibiso');
        window.__forgeOpenVibIsoWorkbench?.();
        return;
      // Forge-261 — Fin efficiency.
      case 'tools.fin':
      case 'workbench.fin':
        setActiveWb('fin');
        window.__forgeOpenFinWorkbench?.();
        return;
      // Forge-262 — Boiler efficiency.
      case 'tools.boilereff':
      case 'workbench.boilereff':
        setActiveWb('boilereff');
        window.__forgeOpenBoilerEffWorkbench?.();
        return;
      // Forge-263 — Sound TL.
      case 'tools.soundtl':
      case 'workbench.soundtl':
        setActiveWb('soundtl');
        window.__forgeOpenSoundTLWorkbench?.();
        return;
      // Forge-264 — PID tuning.
      case 'tools.pidtune':
      case 'workbench.pidtune':
        setActiveWb('pidtune');
        window.__forgeOpenPIDTuneWorkbench?.();
        return;
      // Forge-265 — Tuned mass damper.
      case 'tools.tmd':
      case 'workbench.tmd':
        setActiveWb('tmd');
        window.__forgeOpenTMDWorkbench?.();
        return;
      // Forge-266 — Orifice plate.
      case 'tools.orifice':
      case 'workbench.orifice':
        setActiveWb('orifice');
        window.__forgeOpenOrificeWorkbench?.();
        return;
      // Forge-267 — RC slab punching shear.
      case 'tools.rcpunching':
      case 'workbench.rcpunching':
        setActiveWb('rcpunching');
        window.__forgeOpenRcPunchingWorkbench?.();
        return;
      // Forge-268 — Anchor bolt tension.
      case 'tools.anchorbolt':
      case 'workbench.anchorbolt':
        setActiveWb('anchorbolt');
        window.__forgeOpenAnchorBoltWorkbench?.();
        return;
      // Forge-269 — Power screw torque & efficiency.
      case 'tools.powerscrew':
      case 'workbench.powerscrew':
        setActiveWb('powerscrew');
        window.__forgeOpenPowerScrewWorkbench?.();
        return;
      // Forge-270 — Steel beam LTB (AISC 360 §F2).
      case 'tools.steelbeam':
      case 'workbench.steelbeam':
        setActiveWb('steelbeam');
        window.__forgeOpenSteelBeamLtbWorkbench?.();
        return;
      // Forge-271 — Anchor bolt shear (ACI 318-19 §17.7).
      case 'tools.anchorshear':
      case 'workbench.anchorshear':
        setActiveWb('anchorshear');
        window.__forgeOpenAnchorShearWorkbench?.();
        return;
      // Forge-272 — Wood beam bending (NDS 2018 §3.3).
      case 'tools.woodbeam':
      case 'workbench.woodbeam':
        setActiveWb('woodbeam');
        window.__forgeOpenWoodBeamWorkbench?.();
        return;
      // Forge-273 — Pump NPSH available (ANSI/HI 9.6).
      case 'tools.pumpnpsh':
      case 'workbench.pumpnpsh':
        setActiveWb('pumpnpsh');
        window.__forgeOpenPumpNpshWorkbench?.();
        return;
      // Forge-274 — Wood column buckling (NDS 2018 §3.7).
      case 'tools.woodcolumn':
      case 'workbench.woodcolumn':
        setActiveWb('woodcolumn');
        window.__forgeOpenWoodColumnWorkbench?.();
        return;
      // Forge-275 — Janssen silo pressure.
      case 'tools.silopressure':
      case 'workbench.silopressure':
        setActiveWb('silopressure');
        window.__forgeOpenSiloPressureWorkbench?.();
        return;
      // Forge-276 — Otto cycle (air-standard).
      case 'tools.otto':
      case 'workbench.otto':
        setActiveWb('otto');
        window.__forgeOpenOttoCycleWorkbench?.();
        return;
      // Forge-277 — Diesel cycle (air-standard).
      case 'tools.diesel':
      case 'workbench.diesel':
        setActiveWb('diesel');
        window.__forgeOpenDieselCycleWorkbench?.();
        return;
      // Forge-278 — Brayton cycle (gas turbine).
      case 'tools.brayton':
      case 'workbench.brayton':
        setActiveWb('brayton');
        window.__forgeOpenBraytonCycleWorkbench?.();
        return;
      // Forge-279 — DC shunt motor.
      case 'tools.dcmotor':
      case 'workbench.dcmotor':
        setActiveWb('dcmotor');
        window.__forgeOpenDcMotorWorkbench?.();
        return;
      // Forge-280 — Wire rope sling capacity.
      case 'tools.sling':
      case 'workbench.sling':
        setActiveWb('sling');
        window.__forgeOpenWireRopeSlingWorkbench?.();
        return;
      // Forge-281 — Disc clutch / brake.
      case 'tools.discbrake':
      case 'workbench.discbrake':
        setActiveWb('discbrake');
        window.__forgeOpenDiscBrakeWorkbench?.();
        return;
      // Forge-282 — Reciprocating compressor.
      case 'tools.compressor':
      case 'workbench.compressor':
        setActiveWb('compressor');
        window.__forgeOpenReciprocatingCompressorWorkbench?.();
        return;
      // Forge-283 — Roller chain drive.
      case 'tools.chain':
      case 'workbench.chain':
        setActiveWb('chain');
        window.__forgeOpenChainDriveWorkbench?.();
        return;
      // Forge-284 — Stopping sight distance.
      case 'tools.ssd':
      case 'workbench.ssd':
        setActiveWb('ssd');
        window.__forgeOpenStoppingSightDistanceWorkbench?.();
        return;
      // Forge-285 — AASHTO 93 pavement design.
      case 'tools.aashto':
      case 'workbench.aashto':
        setActiveWb('aashto');
        window.__forgeOpenAashtoPavementWorkbench?.();
        return;
      // Forge-286 — Capstan / bollard friction.
      case 'tools.capstan':
      case 'workbench.capstan':
        setActiveWb('capstan');
        window.__forgeOpenCapstanFrictionWorkbench?.();
        return;
      // Forge-287 — Earthwork prismoidal volume.
      case 'tools.prismoidal':
      case 'workbench.prismoidal':
        setActiveWb('prismoidal');
        window.__forgeOpenPrismoidalWorkbench?.();
        return;
      // Forge-288 — Pitot tube velocity.
      case 'tools.pitot':
      case 'workbench.pitot':
        setActiveWb('pitot');
        window.__forgeOpenPitotTubeWorkbench?.();
        return;
      // Forge-289 — Storm sewer / circular pipe partial flow.
      case 'tools.circpipe':
      case 'workbench.circpipe':
        setActiveWb('circpipe');
        window.__forgeOpenCircularPipeFlowWorkbench?.();
        return;
      // Forge-290 — Worm gear drive.
      case 'tools.wormgear':
      case 'workbench.wormgear':
        setActiveWb('wormgear');
        window.__forgeOpenWormGearWorkbench?.();
        return;
      // Forge-291 — Bevel gear pair.
      case 'tools.bevelgear':
      case 'workbench.bevelgear':
        setActiveWb('bevelgear');
        window.__forgeOpenBevelGearWorkbench?.();
        return;
      // Forge-292 — Wood shear wall.
      case 'tools.woodshear':
      case 'workbench.woodshear':
        setActiveWb('woodshear');
        window.__forgeOpenWoodShearWallWorkbench?.();
        return;
      // Forge-293 — Crane hook.
      case 'tools.hook':
      case 'workbench.hook':
        setActiveWb('hook');
        window.__forgeOpenCraneHookWorkbench?.();
        return;
      // Forge-294 — Air filter Δp + fan energy.
      case 'tools.airfilter':
      case 'workbench.airfilter':
        setActiveWb('airfilter');
        window.__forgeOpenAirFilterWorkbench?.();
        return;
      // Forge-295 — Heat sink fin array.
      case 'tools.finarray':
      case 'workbench.finarray':
        setActiveWb('finarray');
        window.__forgeOpenFinArrayWorkbench?.();
        return;
      // Forge-296 — Headed shear stud connector.
      case 'tools.headedstud':
      case 'workbench.headedstud':
        setActiveWb('headedstud');
        window.__forgeOpenHeadedStudWorkbench?.();
        return;
      // Forge-297 — 1D consolidation settlement.
      case 'tools.consol':
      case 'workbench.consol':
        setActiveWb('consol');
        window.__forgeOpenConsolidationWorkbench?.();
        return;
      // Forge-298 — Vehicle braking energy.
      case 'tools.vehbrake':
      case 'workbench.vehbrake':
        setActiveWb('vehbrake');
        window.__forgeOpenVehicleBrakingWorkbench?.();
        return;
      case 'tools.catenary':
      case 'workbench.catenary':
        setActiveWb('catenary');
        window.__forgeOpenCatenaryWorkbench?.();
        return;
      case 'tools.drumbrake':
      case 'workbench.drumbrake':
        setActiveWb('drumbrake');
        window.__forgeOpenDrumBrakeWorkbench?.();
        return;
      case 'tools.wirerope':
      case 'workbench.wirerope':
        setActiveWb('wirerope');
        window.__forgeOpenWireRopeWorkbench?.();
        return;
      case 'tools.webshear':
      case 'workbench.webshear':
        setActiveWb('webshear');
        window.__forgeOpenWebShearWorkbench?.();
        return;
      case 'tools.hazenwilliams':
      case 'workbench.hazenwilliams':
        setActiveWb('hazenwilliams');
        window.__forgeOpenHazenWilliamsWorkbench?.();
        return;
      case 'tools.voltagedrop':
      case 'workbench.voltagedrop':
        setActiveWb('voltagedrop');
        window.__forgeOpenVoltageDropWorkbench?.();
        return;
      case 'tools.hertzpoint':
      case 'workbench.hertzpoint':
        setActiveWb('hertzpoint');
        window.__forgeOpenHertzPointWorkbench?.();
        return;
      case 'tools.coolingload':
      case 'workbench.coolingload':
        setActiveWb('coolingload');
        window.__forgeOpenCoolingLoadWorkbench?.();
        return;
      case 'tools.rcshear':
      case 'workbench.rcshear':
        setActiveWb('rcshear');
        window.__forgeOpenRCShearWorkbench?.();
        return;
      case 'tools.coolingtower':
      case 'workbench.coolingtower':
        setActiveWb('coolingtower');
        window.__forgeOpenCoolingTowerWorkbench?.();
        return;
      case 'tools.mokabe':
      case 'workbench.mokabe':
        setActiveWb('mokabe');
        window.__forgeOpenMononobeOkabeWorkbench?.();
        return;
      case 'tools.blockshear':
      case 'workbench.blockshear':
        setActiveWb('blockshear');
        window.__forgeOpenBlockShearWorkbench?.();
        return;
      case 'tools.sectclass':
      case 'workbench.sectclass':
        setActiveWb('sectclass');
        window.__forgeOpenSectionClassWorkbench?.();
        return;
      case 'tools.concretemix':
      case 'workbench.concretemix':
        setActiveWb('concretemix');
        window.__forgeOpenConcreteMixWorkbench?.();
        return;
      case 'tools.steampipe':
      case 'workbench.steampipe':
        setActiveWb('steampipe');
        window.__forgeOpenSteamPipeWorkbench?.();
        return;
      case 'tools.airpipe':
      case 'workbench.airpipe':
        setActiveWb('airpipe');
        window.__forgeOpenAirPipeWorkbench?.();
        return;
      case 'tools.windturbine':
      case 'workbench.windturbine':
        setActiveWb('windturbine');
        window.__forgeOpenWindTurbineWorkbench?.();
        return;
      case 'tools.concretecreep':
      case 'workbench.concretecreep':
        setActiveWb('concretecreep');
        window.__forgeOpenConcreteCreepWorkbench?.();
        return;
      case 'tools.detention':
      case 'workbench.detention':
        setActiveWb('detention');
        window.__forgeOpenDetentionBasinWorkbench?.();
        return;
      case 'tools.baseplate':
      case 'workbench.baseplate':
        setActiveWb('baseplate');
        window.__forgeOpenBasePlateWorkbench?.();
        return;
      // Forge-319 5-calc bundle.
      case 'tools.hydjump':
      case 'workbench.hydjump':
        setActiveWb('hydjump');
        window.__forgeOpenHydraulicJumpWorkbench?.();
        return;
      case 'tools.buriedpipe':
      case 'workbench.buriedpipe':
        setActiveWb('buriedpipe');
        window.__forgeOpenBuriedPipeWorkbench?.();
        return;
      case 'tools.subgnd':
      case 'workbench.subgnd':
        setActiveWb('subgnd');
        window.__forgeOpenSubGndWorkbench?.();
        return;
      case 'tools.pilegroup':
      case 'workbench.pilegroup':
        setActiveWb('pilegroup');
        window.__forgeOpenPileGroupWorkbench?.();
        return;
      case 'tools.buoyancy':
      case 'workbench.buoyancy':
        setActiveWb('buoyancy');
        window.__forgeOpenBasementUpliftWorkbench?.();
        return;
      // Forge-320 bundle
      case 'tools.rebardev':
      case 'workbench.rebardev':
        setActiveWb('rebardev');
        window.__forgeOpenRebarDevWorkbench?.();
        return;
      case 'tools.chwpump':
      case 'workbench.chwpump':
        setActiveWb('chwpump');
        window.__forgeOpenChWPumpWorkbench?.();
        return;
      case 'tools.genset':
      case 'workbench.genset':
        setActiveWb('genset');
        window.__forgeOpenGensetWorkbench?.();
        return;
      case 'tools.reverseosmosis':
      case 'workbench.reverseosmosis':
        setActiveWb('reverseosmosis');
        window.__forgeOpenROWorkbench?.();
        return;
      case 'tools.envelope':
      case 'workbench.envelope':
        setActiveWb('envelope');
        window.__forgeOpenEnvelopeWorkbench?.();
        return;
      // Forge-321 bundle
      case 'tools.ventilation':
      case 'workbench.ventilation':
        setActiveWb('ventilation');
        window.__forgeOpenVentilationWorkbench?.();
        return;
      case 'tools.firepump':
      case 'workbench.firepump':
        setActiveWb('firepump');
        window.__forgeOpenFirePumpWorkbench?.();
        return;
      case 'tools.septic':
      case 'workbench.septic':
        setActiveWb('septic');
        window.__forgeOpenSepticWorkbench?.();
        return;
      case 'tools.cyclone':
      case 'workbench.cyclone':
        setActiveWb('cyclone');
        window.__forgeOpenCycloneWorkbench?.();
        return;
      case 'tools.stackeffect':
      case 'workbench.stackeffect':
        setActiveWb('stackeffect');
        window.__forgeOpenStackEffectWorkbench?.();
        return;
      // Forge-322 bundle
      case 'tools.masonry':
      case 'workbench.masonry':
        setActiveWb('masonry');
        window.__forgeOpenMasonryWallWorkbench?.();
        return;
      case 'tools.asphalt':
      case 'workbench.asphalt':
        setActiveWb('asphalt');
        window.__forgeOpenAsphaltMixWorkbench?.();
        return;
      case 'tools.cathodic':
      case 'workbench.cathodic':
        setActiveWb('cathodic');
        window.__forgeOpenCathodicWorkbench?.();
        return;
      case 'tools.heattrace':
      case 'workbench.heattrace':
        setActiveWb('heattrace');
        window.__forgeOpenHeatTraceWorkbench?.();
        return;
      case 'tools.lightning':
      case 'workbench.lightning':
        setActiveWb('lightning');
        window.__forgeOpenLightningWorkbench?.();
        return;
      // Forge-323 bundle
      case 'tools.staticmargin':
      case 'workbench.staticmargin':
        setActiveWb('staticmargin');
        window.__forgeOpenStaticMarginWorkbench?.();
        return;
      case 'tools.refpipe':
      case 'workbench.refpipe':
        setActiveWb('refpipe');
        window.__forgeOpenRefrigerantPipeWorkbench?.();
        return;
      case 'tools.busbar':
      case 'workbench.busbar':
        setActiveWb('busbar');
        window.__forgeOpenBusBarWorkbench?.();
        return;
      case 'tools.ductleakage':
      case 'workbench.ductleakage':
        setActiveWb('ductleakage');
        window.__forgeOpenDuctLeakageWorkbench?.();
        return;
      case 'tools.dustvent':
      case 'workbench.dustvent':
        setActiveWb('dustvent');
        window.__forgeOpenDustVentWorkbench?.();
        return;
      // Forge-324 bundle
      case 'tools.iplv':
      case 'workbench.iplv':
        setActiveWb('iplv');
        window.__forgeOpenIPLVWorkbench?.();
        return;
      case 'tools.snowdrift':
      case 'workbench.snowdrift':
        setActiveWb('snowdrift');
        window.__forgeOpenSnowDriftWorkbench?.();
        return;
      case 'tools.slaboneway':
      case 'workbench.slaboneway':
        setActiveWb('slaboneway');
        window.__forgeOpenSlabOneWayWorkbench?.();
        return;
      case 'tools.cranerunway':
      case 'workbench.cranerunway':
        setActiveWb('cranerunway');
        window.__forgeOpenCraneRunwayWorkbench?.();
        return;
      case 'tools.cmucomp':
      case 'workbench.cmucomp':
        setActiveWb('cmucomp');
        window.__forgeOpenCMUWorkbench?.();
        return;
      // Forge-325 bundle
      case 'tools.prv':
      case 'workbench.prv':
        setActiveWb('prv');
        window.__forgeOpenPRVWorkbench?.();
        return;
      case 'tools.expansiontank':
      case 'workbench.expansiontank':
        setActiveWb('expansiontank');
        window.__forgeOpenExpTankWorkbench?.();
        return;
      case 'tools.platebuck':
      case 'workbench.platebuck':
        setActiveWb('platebuck');
        window.__forgeOpenPlateBuckWorkbench?.();
        return;
      case 'tools.ashrae62r':
      case 'workbench.ashrae62r':
        setActiveWb('ashrae62r');
        window.__forgeOpenAshrae62RWorkbench?.();
        return;
      case 'tools.weldelectrode':
      case 'workbench.weldelectrode':
        setActiveWb('weldelectrode');
        window.__forgeOpenWeldElecWorkbench?.();
        return;
      // Forge-326 bundle
      case 'tools.cover':
      case 'workbench.cover':
        setActiveWb('cover');
        window.__forgeOpenCoverWorkbench?.();
        return;
      case 'tools.mse':
      case 'workbench.mse':
        setActiveWb('mse');
        window.__forgeOpenMSEWorkbench?.();
        return;
      case 'tools.hunter':
      case 'workbench.hunter':
        setActiveWb('hunter');
        window.__forgeOpenHunterWorkbench?.();
        return;
      case 'tools.solarcollector':
      case 'workbench.solarcollector':
        setActiveWb('solarcollector');
        window.__forgeOpenSolarCollWorkbench?.();
        return;
      case 'tools.chimney':
      case 'workbench.chimney':
        setActiveWb('chimney');
        window.__forgeOpenChimneyWorkbench?.();
        return;
      // Forge-327 bundle
      case 'tools.mohrcoulomb':
      case 'workbench.mohrcoulomb':
        setActiveWb('mohrcoulomb');
        window.__forgeOpenMohrCoulombWorkbench?.();
        return;
      case 'tools.stair':
      case 'workbench.stair':
        setActiveWb('stair');
        window.__forgeOpenStairWorkbench?.();
        return;
      case 'tools.snowpv':
      case 'workbench.snowpv':
        setActiveWb('snowpv');
        window.__forgeOpenSnowPVWorkbench?.();
        return;
      case 'tools.nrc':
      case 'workbench.nrc':
        setActiveWb('nrc');
        window.__forgeOpenNRCWorkbench?.();
        return;
      case 'tools.adiabatic':
      case 'workbench.adiabatic':
        setActiveWb('adiabatic');
        window.__forgeOpenAdiabaticCompWorkbench?.();
        return;
      // Forge-328 bundle
      case 'tools.mullion':
      case 'workbench.mullion':
        setActiveWb('mullion');
        window.__forgeOpenMullionWorkbench?.();
        return;
      case 'tools.sprinkler':
      case 'workbench.sprinkler':
        setActiveWb('sprinkler');
        window.__forgeOpenSprinklerWorkbench?.();
        return;
      case 'tools.soundprop':
      case 'workbench.soundprop':
        setActiveWb('soundprop');
        window.__forgeOpenSoundPropWorkbench?.();
        return;
      case 'tools.isa':
      case 'workbench.isa':
        setActiveWb('isa');
        window.__forgeOpenISAWorkbench?.();
        return;
      case 'tools.lpd':
      case 'workbench.lpd':
        setActiveWb('lpd');
        window.__forgeOpenLPDWorkbench?.();
        return;
      // Forge-329 bundle
      case 'tools.geothermal':
      case 'workbench.geothermal':
        setActiveWb('geothermal');
        window.__forgeOpenGeothermalWorkbench?.();
        return;
      case 'tools.tension':
      case 'workbench.tension':
        setActiveWb('tension');
        window.__forgeOpenTensionWorkbench?.();
        return;
      case 'tools.boltedtimber':
      case 'workbench.boltedtimber':
        setActiveWb('boltedtimber');
        window.__forgeOpenBoltedTimberWorkbench?.();
        return;
      case 'tools.conveyor':
      case 'workbench.conveyor':
        setActiveWb('conveyor');
        window.__forgeOpenConveyorWorkbench?.();
        return;
      case 'tools.drift':
      case 'workbench.drift':
        setActiveWb('drift');
        window.__forgeOpenDriftWorkbench?.();
        return;
      // Forge-330 bundle
      case 'tools.slope':
      case 'workbench.slope':
        setActiveWb('slope');
        window.__forgeOpenSlopeWorkbench?.();
        return;
      case 'tools.engperf':
      case 'workbench.engperf':
        setActiveWb('engperf');
        window.__forgeOpenEnginePerfWorkbench?.();
        return;
      case 'tools.daylight':
      case 'workbench.daylight':
        setActiveWb('daylight');
        window.__forgeOpenDaylightWorkbench?.();
        return;
      case 'tools.masshaul':
      case 'workbench.masshaul':
        setActiveWb('masshaul');
        window.__forgeOpenMassHaulWorkbench?.();
        return;
      case 'tools.railbeam':
      case 'workbench.railbeam':
        setActiveWb('railbeam');
        window.__forgeOpenRailBeamWorkbench?.();
        return;
      // Forge-331 bundle
      case 'tools.beamreact':
      case 'workbench.beamreact':
        setActiveWb('beamreact');
        window.__forgeOpenBeamReactionsWorkbench?.();
        return;
      case 'tools.tankanchor':
      case 'workbench.tankanchor':
        setActiveWb('tankanchor');
        window.__forgeOpenTankAnchorWorkbench?.();
        return;
      case 'tools.heatpump':
      case 'workbench.heatpump':
        setActiveWb('heatpump');
        window.__forgeOpenHeatPumpWorkbench?.();
        return;
      case 'tools.baseshear':
      case 'workbench.baseshear':
        setActiveWb('baseshear');
        window.__forgeOpenBaseShearWorkbench?.();
        return;
      case 'tools.pvshade':
      case 'workbench.pvshade':
        setActiveWb('pvshade');
        window.__forgeOpenPVShadeWorkbench?.();
        return;
      // Forge-332 bundle
      case 'tools.padeye':
      case 'workbench.padeye':
        setActiveWb('padeye');
        window.__forgeOpenPadEyeWorkbench?.();
        return;
      case 'tools.hsd':
      case 'workbench.hsd':
        setActiveWb('hsd');
        window.__forgeOpenHSDWorkbench?.();
        return;
      case 'tools.weldgroup':
      case 'workbench.weldgroup':
        setActiveWb('weldgroup');
        window.__forgeOpenWeldGroupWorkbench?.();
        return;
      case 'tools.boltpre':
      case 'workbench.boltpre':
        setActiveWb('boltpre');
        window.__forgeOpenBoltPreloadWorkbench?.();
        return;
      case 'tools.prestress':
      case 'workbench.prestress':
        setActiveWb('prestress');
        window.__forgeOpenPrestressWorkbench?.();
        return;
      // Forge-333 bundle
      case 'tools.flange':
      case 'workbench.flange':
        setActiveWb('flange');
        window.__forgeOpenBoltedFlangeWorkbench?.();
        return;
      case 'tools.ogee':
      case 'workbench.ogee':
        setActiveWb('ogee');
        window.__forgeOpenOgeeWorkbench?.();
        return;
      case 'tools.groundgrid':
      case 'workbench.groundgrid':
        setActiveWb('groundgrid');
        window.__forgeOpenGroundGridWorkbench?.();
        return;
      case 'tools.rspect':
      case 'workbench.rspect':
        setActiveWb('rspect');
        window.__forgeOpenResponseSpectrumWorkbench?.();
        return;
      case 'tools.buoyfloat':
      case 'workbench.buoyfloat':
        setActiveWb('buoyfloat');
        window.__forgeOpenBuoyancyWorkbench?.();
        return;
      // Forge-334 bundle
      case 'tools.vcurve':
      case 'workbench.vcurve':
        setActiveWb('vcurve');
        window.__forgeOpenVCurveWorkbench?.();
        return;
      case 'tools.clarifier':
      case 'workbench.clarifier':
        setActiveWb('clarifier');
        window.__forgeOpenClarifierWorkbench?.();
        return;
      case 'tools.pvbatt':
      case 'workbench.pvbatt':
        setActiveWb('pvbatt');
        window.__forgeOpenPVBattWorkbench?.();
        return;
      case 'tools.silencer':
      case 'workbench.silencer':
        setActiveWb('silencer');
        window.__forgeOpenSilencerWorkbench?.();
        return;
      case 'tools.thrustblk':
      case 'workbench.thrustblk':
        setActiveWb('thrustblk');
        window.__forgeOpenThrustBlockWorkbench?.();
        return;
      // Forge-335 bundle
      case 'tools.corbel':
      case 'workbench.corbel':
        setActiveWb('corbel');
        window.__forgeOpenCorbelWorkbench?.();
        return;
      case 'tools.wtbase':
      case 'workbench.wtbase':
        setActiveWb('wtbase');
        window.__forgeOpenWindTowerWorkbench?.();
        return;
      case 'tools.airrcv':
      case 'workbench.airrcv':
        setActiveWb('airrcv');
        window.__forgeOpenAirReceiverWorkbench?.();
        return;
      case 'tools.butter':
      case 'workbench.butter':
        setActiveWb('butter');
        window.__forgeOpenButterworthWorkbench?.();
        return;
      case 'tools.pedvib':
      case 'workbench.pedvib':
        setActiveWb('pedvib');
        window.__forgeOpenPedVibWorkbench?.();
        return;
      // Forge-336 bundle
      case 'tools.pipenet':
      case 'workbench.pipenet':
        setActiveWb('pipenet');
        window.__forgeOpenPipeNetWorkbench?.();
        return;
      case 'tools.torvib':
      case 'workbench.torvib':
        setActiveWb('torvib');
        window.__forgeOpenTorVibWorkbench?.();
        return;
      case 'tools.pierscour':
      case 'workbench.pierscour':
        setActiveWb('pierscour');
        window.__forgeOpenPierScourWorkbench?.();
        return;
      case 'tools.econ':
      case 'workbench.econ':
        setActiveWb('econ');
        window.__forgeOpenEconomizerWorkbench?.();
        return;
      case 'tools.fiberlink':
      case 'workbench.fiberlink':
        setActiveWb('fiberlink');
        window.__forgeOpenFiberLinkWorkbench?.();
        return;
      // Forge-337 bundle
      case 'tools.biaxfoot':
      case 'workbench.biaxfoot':
        setActiveWb('biaxfoot');
        window.__forgeOpenBiaxFootWorkbench?.();
        return;
      case 'tools.adm':
      case 'workbench.adm':
        setActiveWb('adm');
        window.__forgeOpenADMWorkbench?.();
        return;
      case 'tools.morison':
      case 'workbench.morison':
        setActiveWb('morison');
        window.__forgeOpenMorisonWorkbench?.();
        return;
      case 'tools.fourier':
      case 'workbench.fourier':
        setActiveWb('fourier');
        window.__forgeOpenFourierWorkbench?.();
        return;
      case 'tools.sa':
      case 'workbench.sa':
        setActiveWb('sa');
        window.__forgeOpenSAWorkbench?.();
        return;
      // Forge-338 bundle
      case 'tools.compslab':
      case 'workbench.compslab':
        setActiveWb('compslab');
        window.__forgeOpenCompSlabWorkbench?.();
        return;
      case 'tools.reverb':
      case 'workbench.reverb':
        setActiveWb('reverb');
        window.__forgeOpenReverbWorkbench?.();
        return;
      case 'tools.flame':
      case 'workbench.flame':
        setActiveWb('flame');
        window.__forgeOpenFlameWorkbench?.();
        return;
      case 'tools.msepull':
      case 'workbench.msepull':
        setActiveWb('msepull');
        window.__forgeOpenMSEPullWorkbench?.();
        return;
      case 'tools.bayes':
      case 'workbench.bayes':
        setActiveWb('bayes');
        window.__forgeOpenBayesWorkbench?.();
        return;
      // Forge-339 bundle
      case 'tools.cn':
      case 'workbench.cn':
        setActiveWb('cn');
        window.__forgeOpenCNWorkbench?.();
        return;
      case 'tools.waveguide':
      case 'workbench.waveguide':
        setActiveWb('waveguide');
        window.__forgeOpenWaveguideWorkbench?.();
        return;
      case 'tools.sluice':
      case 'workbench.sluice':
        setActiveWb('sluice');
        window.__forgeOpenSluiceWorkbench?.();
        return;
      case 'tools.knock':
      case 'workbench.knock':
        setActiveWb('knock');
        window.__forgeOpenKnockWorkbench?.();
        return;
      case 'tools.npv':
      case 'workbench.npv':
        setActiveWb('npv');
        window.__forgeOpenNPVWorkbench?.();
        return;
      // Forge-340 bundle
      case 'tools.cmushear':
      case 'workbench.cmushear':
        setActiveWb('cmushear');
        window.__forgeOpenCMUShearWorkbench?.();
        return;
      case 'tools.sccrit':
      case 'workbench.sccrit':
        setActiveWb('sccrit');
        window.__forgeOpenSlipCritWorkbench?.();
        return;
      case 'tools.chbeam':
      case 'workbench.chbeam':
        setActiveWb('chbeam');
        window.__forgeOpenChBeamWorkbench?.();
        return;
      case 'tools.weldhi':
      case 'workbench.weldhi':
        setActiveWb('weldhi');
        window.__forgeOpenWeldHIWorkbench?.();
        return;
      case 'tools.markov':
      case 'workbench.markov':
        setActiveWb('markov');
        window.__forgeOpenMarkovWorkbench?.();
        return;
      // Forge-341 bundle
      case 'tools.soldierpile':
      case 'workbench.soldierpile':
        setActiveWb('soldierpile');
        window.__forgeOpenSoldierPileWorkbench?.();
        return;
      case 'tools.roundhss':
      case 'workbench.roundhss':
        setActiveWb('roundhss');
        window.__forgeOpenRoundHSSWorkbench?.();
        return;
      case 'tools.ehx':
      case 'workbench.ehx':
        setActiveWb('ehx');
        window.__forgeOpenPlateHXWorkbench?.();
        return;
      case 'tools.fosm':
      case 'workbench.fosm':
        setActiveWb('fosm');
        window.__forgeOpenFOSMWorkbench?.();
        return;
      case 'tools.flutter':
      case 'workbench.flutter':
        setActiveWb('flutter');
        window.__forgeOpenFlutterWorkbench?.();
        return;
      // Forge-233 — Hierarchical Tools menu.
      case 'tools.open':
      case 'tools.menu':
        window.__forgeOpenToolsMenu?.();
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
      // PUSH-14: real PDM vault (JSON-backed)
      case 'tools.pdmvault':
      case 'workbench.pdmvault':
        window.__forgeOpenPDMWorkbench?.();
        return;
      // PUSH-16: macro recorder
      case 'tools.macros':
      case 'workbench.macros':
      case 'macro.record':
      case 'macro.stop':
      case 'macro.play':
        window.__forgeOpenMacroRecorder?.();
        return;
      // PUSH-17: materials library + exploded view
      case 'tools.materials':
      case 'workbench.materials':
      case 'render.material':
        window.__forgeOpenMaterialsLibrary?.();
        return;
      case 'tools.explode':
      case 'workbench.explode':
      case 'render.explode':
        window.__forgeOpenExplodedView?.();
        return;
      // PUSH-13: standard parts catalog browser
      case 'tools.stdparts':
      case 'workbench.stdparts':
        window.__forgeOpenStandardPartsBrowser?.();
        return;
      // PUSH-12: PMI / GD&T
      case 'tools.pmi':
      case 'workbench.pmi':
        window.__forgeOpenPMIWorkbench?.();
        return;
      // PUSH-09: Routing
      case 'tools.routing':
      case 'workbench.routing':
        window.__forgeOpenRoutingWorkbench?.();
        return;
      // PUSH-04: Mate solver (forge::matelib)
      case 'tools.matesolver':
      case 'workbench.matesolver':
        window.__forgeOpenMateSolverWorkbench?.();
        return;
      // PUSH-10: Extended CAM (forge::camx)
      case 'tools.camx':
      case 'workbench.camx':
        window.__forgeOpenCAMExtendedWorkbench?.();
        return;
      // PUSH-15: SIMP topology optimisation
      case 'tools.topoOpt':
      case 'workbench.topology':
        window.__forgeOpenTopologyWorkbench?.();
        return;
      // PUSH-02: Solid modelling ops
      case 'tools.solidops':
      case 'workbench.solidops':
        window.__forgeOpenSolidOpsWorkbench?.();
        return;
      // PUSH-03: Sketch constraints
      case 'tools.sketchcs':
      case 'workbench.sketchcs':
        window.__forgeOpenSketchConstraintsWorkbench?.();
        return;
      // PUSH-08: Mold tooling
      case 'tools.moldnew':
      case 'workbench.moldnew':
        window.__forgeOpenMoldWorkbench?.();
        return;
      // PUSH-11: Tet4 FEA
      case 'tools.feat':
      case 'workbench.feat':
        window.__forgeOpenFEATetWorkbench?.();
        return;
      // PUSH-05: Drawings (HLR + DXF/SVG)
      case 'tools.drawings':
      case 'workbench.drawings':
        window.__forgeOpenDrawingsWorkbench?.();
        return;
      // PUSH-01: routes from extended right-click context
      case 'palette.open':
        window.__forgeOpenCommandPalette?.(true);
        return;
      case 'workbench.mech':
      case 'workbench.sheet':
      case 'workbench.draft':
      case 'workbench.sim':
      case 'workbench.mfg':
      case 'workbench.drawing':
      case 'workbench.weld':
      case 'workbench.mold':
      case 'workbench.arch':
      case 'workbench.mesh':
      case 'workbench.robot': {
        const wb = id.split('.')[1];
        setActiveWb(wb);
        return;
      }
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
                  explodeOffsets={explodeOffsets}
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
                       }}
                       bodies={bodies}
                       onToggleBodyVisible={(b) => {
                         // Multi-body manager (Slice-5) — per-body show/hide.
                         setBodies((arr) => arr.map((x) =>
                           (x.handle === b.handle && x.id === b.id)
                             ? { ...x, visible: x.visible === false }
                             : x));
                       }}
                       onRenameBody={(b, name) => {
                         setBodies((arr) => arr.map((x) =>
                           (x.handle === b.handle && x.id === b.id) ? { ...x, name } : x));
                       }}
                       onPickBody={(b) => setSelection({ kind: 'body', ids: [b.handle], bodyHandle: b.handle })} />)
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
                           onApplyVariant={(applied) => {
                             // Regen bodies from the active config's applied
                             // tree but keep `featureTree` as the immutable
                             // base — A→B→A returns A's bodies exactly.
                             setBodies(regenerate(applied.filter((n) => !n.suppressed)));
                           }}
                           onReplaceTree={(nextTree) => {
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
                         // NOTE: sketch.new / sketch.finish are lifecycle tools, not
                         // entity tools — they must fall through to their dedicated
                         // handlers below even when a (stale/finished) session is
                         // still referenced by `currentSketch`. Without this guard,
                         // opening a new sketch after finishing one was silently
                         // swallowed here (sketch-on-face #216 regression).
                         if (tool.startsWith('sketch.') && currentSketch
                             && tool !== 'sketch.new' && tool !== 'sketch.finish') {
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
                         // PUSH-31 — sketch.new from the toolbar opens a
                         // sketch session on the plane the user picked
                         // in the dialog (defaults to XY). Previously
                         // this fell through to the "open a sketch first"
                         // warning because the case was only handled in
                         // the forge:menu-action channel.
                         // Slice-4 — datum / reference geometry. Build the
                         // plane/axis spec, register it as a sketchable datum,
                         // and (for planes) immediately open a sketch ON it so
                         // the user can draw right away (SolidWorks behavior).
                         if (typeof tool === 'string' && tool.startsWith('datum.')) {
                           const NAMED = {
                             XY: { origin: [0,0,0], normal: [0,0,1] },
                             YZ: { origin: [0,0,0], normal: [1,0,0] },
                             XZ: { origin: [0,0,0], normal: [0,1,0] },
                           };
                           let spec = null; let dkind = 'plane'; let label = title;
                           try {
                             if (tool === 'datum.offsetPlane') {
                               let base = NAMED[params?.base] || NAMED.XY;
                               if (/top|bottom|face/i.test(String(params?.base || ''))) {
                                 const lastNative = [...bodies].reverse().find((b) => b.kind === 'native');
                                 const f2 = lastNative ? Sketch.deriveFacePlane(lastNative.handle) : null;
                                 if (f2) base = { origin: f2.origin, normal: f2.normal };
                               }
                               spec = offsetPlaneSpec(base, Number(params?.distance) || 0);
                               label = `Offset Plane (${params?.base || 'XY'} +${params?.distance || 0})`;
                             } else if (tool === 'datum.plane3pt') {
                               spec = planeThrough3PointsSpec(params.p1 || [0,0,0], params.p2 || [10,0,0], params.p3 || [0,10,0]);
                               label = 'Plane (3 points)';
                             } else if (tool === 'datum.midPlane') {
                               const a = offsetPlaneSpec(NAMED[params?.planeA] || NAMED.XY, Number(params?.offsetA) || 0);
                               const b = offsetPlaneSpec(NAMED[params?.planeB] || NAMED.XY, Number(params?.offsetB) || 0);
                               spec = midPlaneSpec(a, b);
                               label = 'Mid Plane';
                             } else if (tool === 'datum.axis2pt') {
                               spec = axisFrom2PointsSpec(params.p1 || [0,0,0], params.p2 || [0,0,50]);
                               dkind = 'axis';
                               label = 'Axis (2 points)';
                             }
                           } catch (err) {
                             showToast({ kind: 'warn', text: `${title}: ${err.message}`, ttl: 2200 });
                             setActiveTool(null);
                             return;
                           }
                           if (!spec) { setActiveTool(null); return; }
                           const datum = { id: nextId, kind: dkind, name: label, ...spec };
                           setDatumPlanes((d) => [...d, datum]);
                           setFeatureTree((t) => [...t, { id: nextId, label, icon: 'sketch.rect', params }]);
                           setActiveFeatureId(nextId);
                           // For planes, open a sketch on the datum immediately.
                           if (dkind === 'plane') {
                             const next = Sketch.openSession({ origin: spec.origin, normal: spec.normal });
                             setCurrentSketch(next);
                             setSketchActive(true);
                             showToast({ kind: 'ok', text: `${label} created — sketch opened on it`, ttl: 1600 });
                           } else {
                             showToast({ kind: 'ok', text: `${label} created`, ttl: 1400 });
                           }
                           setActiveTool(null);
                           return;
                         }
                         if (tool === 'sketch.new') {
                           const planeRaw = (params?.plane || 'XY').toString();
                           // Sketch-on-face (#216) — 'Top face of body' (and
                           // any face-style option) now derives a REAL plane
                           // frame from the target body's top face via the
                           // kernel (direct.inferFeature), so the sketch opens
                           // ON that face. Falls back to XY only when there's
                           // no body / no usable planar face.
                           let plane = 'XY';
                           let planeLabel = 'XY';
                           if (planeRaw === 'YZ' || planeRaw === 'XZ' || planeRaw === 'XY') {
                             plane = planeRaw;
                             planeLabel = planeRaw;
                           } else if (/top|bottom|face/i.test(planeRaw)) {
                             // Slice-2 — prefer the explicitly PICKED face when
                             // the user selected one in the viewport (face filter
                             // click populates selection.faceId + bodyHandle).
                             // Otherwise fall back to the target body's top face.
                             const lastNative = [...bodies].reverse().find((b) => b.kind === 'native');
                             let tgt = null;
                             let pickedFaceId = null;
                             if (selection?.kind === 'face' && typeof selection.faceId === 'number'
                                 && typeof selection.bodyHandle === 'number') {
                               tgt = bodies.find((b) => b.kind === 'native' && b.handle === selection.bodyHandle);
                               pickedFaceId = selection.faceId;
                             }
                             if (!tgt) {
                               tgt = (selection?.kind === 'body' && selection.ids?.length)
                                 ? bodies.find((b) => b.kind === 'native' &&
                                     (b.handle === selection.ids[0] || b.id === selection.ids[0]))
                                 : lastNative;
                             }
                             const frameSpec = tgt ? Sketch.deriveFacePlane(tgt.handle, pickedFaceId) : null;
                             if (frameSpec) {
                               plane = frameSpec;                    // custom frame object
                               planeLabel = pickedFaceId != null
                                 ? `face ${pickedFaceId} of ${tgt.name || ('body ' + tgt.handle)}`
                                 : `top face of ${tgt.name || ('body ' + tgt.handle)}`;
                             } else {
                               showToast({ kind: 'warn',
                                 text: 'No body face to sketch on — falling back to XY',
                                 ttl: 1600 });
                             }
                           }
                           const next = Sketch.openSession(plane);
                           setCurrentSketch(next);
                           setSketchActive(true);
                           setFeatureTree((t) => [...t, {
                             id: nextId, label: `Sketch ${featureTree.length + 1} (${planeLabel})`,
                             icon: 'sketch.rect', params,
                           }]);
                           setActiveFeatureId(nextId);
                           setActiveTool(null);
                           showToast({ kind: 'ok',
                             text: `Sketch opened on ${planeLabel} (handle ${next.kernel ?? 'n/a'})`,
                             ttl: 1200 });
                           return;
                         }
                         // sketch.finish from the toolbar — same as the
                         // menu action.
                         if (tool === 'sketch.finish') {
                           if (currentSketch) {
                             const status = Sketch.solveSession(currentSketch);
                             showToast({ kind: status === 'solved' ? 'ok' : 'warn',
                               text: `Sketch ${status} · ${currentSketch.edges.length} entities`,
                               ttl: 1500 });
                           }
                           setSketchActive(false);
                           setActiveTool(null);
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
                          // Sketch-on-face (#216) — when the active sketch is
                          // on a custom (face-derived) plane, hand the dispatch
                          // its world frame so solid.extrude uses
                          // part.extrudeProfileOnPlane and the solid lands on
                          // that face instead of world Z=0.
                          currentSketchFrame: (currentSketch && typeof currentSketch.plane === 'object')
                            ? Sketch.planeFrameOf(currentSketch) : null,
                          // Slice-3 — when the user picked an edge in the
                          // viewport (edge filter), pass its 0-based id so
                          // fillet/chamfer round THAT edge instead of all.
                          selectedEdges: (selection?.kind === 'edge' && typeof selection.edgeId === 'number')
                            ? [selection.edgeId] : null,
                          // The body the picked face/edge belongs to — lets
                          // selection-aware ops target it directly.
                          pickedBody: (typeof selection?.bodyHandle === 'number')
                            ? selection.bodyHandle : null,
                           // PUSH-31 — pass full bodies list so dispatchers
                           // can fall back to (e.g.) the last two native
                           // bodies for boolean ops when no ref is picked.
                           bodies,
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
                           } else if (tool === 'sheet.flatPattern' || tool === 'sheet.unfold') {
                             // Slice-12 — the flat pattern / unfold result is a
                             // 2D WIRE (invisible as a body). Instead of
                             // committing an invisible wire, develop it into a
                             // real flat-pattern DRAWING in the FlatPatternHost,
                             // sourced from the FORMED sheet body (seeded.shape).
                             if (seeded.shape != null && typeof window !== 'undefined') {
                               window.dispatchEvent(new CustomEvent('forge:open-flat-pattern', {
                                 detail: {
                                   shape: seeded.shape,
                                   thickness: seeded.thickness ?? params.thickness,
                                   bendRadius: seeded.bendRadius ?? params.bendRadius,
                                   k: seeded.k ?? params.k,
                                 },
                               }));
                             }
                             r = { ok: true, kind: 'noop' };
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
                           // Slice-9 Knit — consumes 2+ surface bodies and
                           // produces ONE sewn shell. Remove the input
                           // surface bodies and append the shell (flagged
                           // surface:true so it stays Thicken-able).
                           if (tool === 'solid.knit') {
                             const selSet = new Set(
                               (selHandles && selHandles.length >= 2)
                                 ? selHandles
                                 : bodies.filter((b) => b && b.kind === 'native' && b.surface === true)
                                         .map((b) => b.handle));
                             nextBodies = [
                               ...bodies.filter((b) => !(b && b.kind === 'native' && selSet.has(b.handle))),
                               { id: nextId, kind: 'native', handle: r.handle,
                                 toolId: tool, params, name: title, surface: true },
                             ];
                             setBodies(nextBodies);
                             recordOp({ op: tool, params, before: beforeSnap,
                                        after: { bodies: nextBodies, featureTree: nextFeat } });
                             setActiveFeatureId(nextId);
                             setActiveTool(null);
                             showToast({ kind: 'ok', text: `${title} · shell knit`, ttl: 1500 });
                             return;
                           }
                           // PUSH-31 — solid.translate (and other
                           // body-replacing modifiers) should REPLACE the
                           // previous body's handle, not append a new
                           // body. Otherwise the un-translated copy stays
                           // visible alongside the translated one.
                           const REPLACE_LAST = new Set([
                             'solid.translate', 'solid.rotate',
                             'solid.fillet', 'solid.chamfer', 'solid.shell',
                             'solid.hole', 'solid.draft', 'solid.thicken',
                             'solid.trimSurface',
                           ]);
                           // PUSH-31 — solid.extrude/revolve with op=Cut|Add|
                           // Intersect modifies the previous body via boolean,
                           // so it should REPLACE the prior body, not stack
                           // separately. This is what makes a deck plate with
                           // bores cut through it render as ONE coherent
                           // engine block instead of overlapping cylinders.
                           const op = (params?.op || '').toLowerCase();
                           const isBoolOp = op === 'cut' || op === 'add' || op === 'intersect';
                           if (REPLACE_LAST.has(tool) || isBoolOp) {
                             const idx = [...bodies].map((b, i) => ({ b, i }))
                               .reverse().find((x) => x.b.kind === 'native')?.i;
                             if (typeof idx === 'number') {
                               // Thicken turns a surface body into a solid —
                               // clear the surface flag on the replacement.
                               const clearSurface = (tool === 'solid.thicken');
                               nextBodies = bodies.map((b, i) => i === idx
                                 ? { ...b, handle: r.handle, name: title,
                                     surface: clearSurface ? false : b.surface }
                                 : b);
                             } else {
                               nextBodies = [...bodies, {
                                 id: nextId, kind: 'native', handle: r.handle,
                                 toolId: tool, params, name: title,
                               }];
                             }
                           } else {
                             nextBodies = [...bodies, {
                               id: nextId, kind: 'native', handle: r.handle,
                               toolId: tool, params, name: title,
                             }];
                           }
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
