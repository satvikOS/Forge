// Forge-160 — OpenSCAD-style CSG scripting workbench.
//
// Full-screen modal: code editor on the left (plain textarea with
// monospace + gutter line numbers), live preview metadata on the
// right.  Typing debounces 500 ms; on quiescence the script runs
// through csgRuntime.evalScript and the resulting bodies are pushed
// into the v4 shell via `window.__forgeAppendBody`.
//
// Strict invariants:
//   * If `forge.isReady()` is false the right pane shows a
//     "kernel required" banner; no fake bodies are emitted.
//   * Each evaluation REPLACES the previous CSG run's bodies (the
//     panel tags them with `kind: 'csg'`) so the user doesn't
//     accumulate stale geometry on every keystroke.
//   * Manual UI (typing, clicking Run, clicking Insert sample)
//     NEVER posts to Archie's thread — same Forge-83 invariant the
//     rest of the shell follows.
//
// React #185 hygiene:
//   * The bodies-snapshot we observe (`__forgeBodies`) is a plain
//     React state owned by ForgeShellV4 — no useSyncExternalStore
//     here.  The host's useEffect deps are `[]` so it registers the
//     window hook exactly once.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { evalScript, BUILTIN_MODULES, BUILTIN_FUNCTIONS } from './csgRuntime.js';
import { showToast } from './Toast.jsx';
import { Icon } from './icons/Icon.jsx';

export const CSG_EVENT = 'forge:open-csg-panel';

const DEBOUNCE_MS = 500;

const SAMPLE_SCRIPT = `// Forge-160 sample · sphere with a cube cut from it.
//
// Try editing the radii / sizes — the viewport updates 500 ms
// after you stop typing.  All bodies come from the real OCCT
// kernel (forge.makeSphere / makeBox / cut).

difference() {
  sphere(r = 18);
  translate([8, 0, 0]) cube(size = [22, 22, 22], center = true);
}
`;

const REFERENCE_SNIPPETS = [
  {
    label: 'Boolean tour',
    body: `union() {
  cube(size = [20, 20, 4], center = true);
  translate([0, 0, 6]) cylinder(h = 4, r = 6);
}`,
  },
  {
    label: 'for-range lattice',
    body: `for (i = [0:1:4])
  translate([i * 12, 0, 0]) cube(size = 8, center = true);`,
  },
  {
    label: 'function + let',
    body: `function lerp(a, b, t) = a + (b - a) * t;
let (n = 6)
  for (i = [0:1:n - 1])
    translate([lerp(-20, 20, i / (n - 1)), 0, 0])
      cube(size = 4, center = true);`,
  },
];

/* ---------------------------------------------------------------- */
/*  Helpers                                                         */
/* ---------------------------------------------------------------- */

function kernelReady() {
  return typeof window !== 'undefined' &&
         window.forge &&
         typeof window.forge.isReady === 'function' &&
         window.forge.isReady();
}

// CSG bodies use `kind: 'native'` so SceneMeshes tessellates them
// through the regular OCCT path, plus a `toolId: 'csg.script'` tag so
// this panel can find and replace them on every re-run without
// touching bodies created by other panels (sketches, standard parts,
// Archie).  An extra `csgSource: true` field is set for future
// belt-and-braces filtering.
function publishCsgBodies(produced) {
  if (typeof window === 'undefined') return;
  if (typeof window.__forgeSetBodies !== 'function') return;
  const current = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  const kept = current.filter((b) => b.toolId !== 'csg.script');
  const next = [
    ...kept,
    ...produced.map((b) => ({
      id: b.id,
      kind: 'native',
      handle: b.handle,
      name: b.name,
      toolId: 'csg.script',
      csgSource: true,
    })),
  ];
  window.__forgeSetBodies(next);
  // Belt-and-braces: mirror immediately so reads observing
  // window.__forgeBodies before the shell's publish effect re-runs
  // can still see the new state. The shell effect will overwrite
  // with the same content on next render — but external observers
  // (Archie's snapshot read, the e2e harness) get instant truth.
  window.__forgeBodies = next;
}

function clearCsgBodies() {
  if (typeof window === 'undefined') return;
  if (typeof window.__forgeSetBodies !== 'function') return;
  const current = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  const kept = current.filter((b) => b.toolId !== 'csg.script');
  if (kept.length !== current.length) {
    window.__forgeSetBodies(kept);
    // Mirror immediately (see publishCsgBodies for the same trick).
    window.__forgeBodies = kept;
  }
}

/* ---------------------------------------------------------------- */
/*  Line-numbered editor                                            */
/* ---------------------------------------------------------------- */

function LineGutter({ count }) {
  const lines = useMemo(() => {
    const out = [];
    for (let i = 1; i <= Math.max(1, count); i++) out.push(i);
    return out;
  }, [count]);
  return (
    <div
      data-testid="forge-csg-gutter"
      aria-hidden="true"
      style={{
        width: 44,
        padding: '8px 8px 8px 0',
        fontFamily: 'var(--forge-mono, ui-monospace, Menlo, monospace)',
        fontSize: 12,
        lineHeight: '18px',
        color: 'var(--forge-ink-mute, #5f6b77)',
        background: 'var(--forge-canvas-2, #15171c)',
        borderRight: '1px solid var(--forge-rail-edge, #2a2f37)',
        textAlign: 'right',
        userSelect: 'none',
        flexShrink: 0,
        boxSizing: 'border-box',
      }}>
      {lines.map((n) => <div key={n}>{n}</div>)}
    </div>
  );
}

function Editor({ value, onChange, lineCount }) {
  const textareaRef = useRef(null);
  const gutterRef   = useRef(null);

  const onScroll = useCallback((e) => {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = e.target.scrollTop;
    }
  }, []);

  const onKeyDown = useCallback((e) => {
    // Tab inserts two spaces — no eval of user code, just literal text.
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end   = ta.selectionEnd;
      const next = value.slice(0, start) + '  ' + value.slice(end);
      onChange(next);
      // Restore caret on the next tick.
      window.requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  }, [value, onChange]);

  return (
    <div style={{
      flex: 1, display: 'flex',
      minWidth: 0, minHeight: 0,
      background: 'var(--forge-canvas, #0e1014)',
      borderBottom: '1px solid var(--forge-rail-edge, #2a2f37)',
      position: 'relative',
    }}>
      <div ref={gutterRef}
           style={{ overflow: 'hidden' }}>
        <LineGutter count={lineCount} />
      </div>
      <textarea
        ref={textareaRef}
        data-testid="forge-csg-editor"
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        style={{
          flex: 1,
          minWidth: 0,
          background: 'transparent',
          color: 'var(--forge-ink, #d8dde4)',
          border: 'none',
          outline: 'none',
          padding: '8px 12px',
          fontFamily: 'var(--forge-mono, ui-monospace, Menlo, monospace)',
          fontSize: 12,
          lineHeight: '18px',
          resize: 'none',
          whiteSpace: 'pre',
          overflow: 'auto',
          tabSize: 2,
          boxSizing: 'border-box',
        }} />
    </div>
  );
}

/* ---------------------------------------------------------------- */
/*  Preview pane                                                    */
/* ---------------------------------------------------------------- */

function PreviewPane({ kernelOk, status, bodies, errorText }) {
  if (!kernelOk) {
    return (
      <div data-testid="forge-csg-preview"
           data-csg-state="kernel-offline"
           style={previewOuter()}>
        <div style={previewBannerErr()}>
          <strong>kernel required</strong>
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>
            forge-kernel.node is not loaded in this shell. CSG scripting
            needs the native OCCT addon — install it and reopen the
            workbench.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div data-testid="forge-csg-preview"
         data-csg-state={status}
         style={previewOuter()}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 14px',
        borderBottom: '1px solid var(--forge-rail-edge, #2a2f37)',
        background: 'var(--forge-canvas-2, #15171c)',
        flexShrink: 0,
      }}>
        <Icon name="wb.mech" size={14} />
        <strong style={{ fontSize: 12 }}>Preview</strong>
        <span data-testid="forge-csg-status"
              style={{
                fontFamily: 'var(--forge-mono)', fontSize: 11,
                padding: '2px 8px', borderRadius: 3,
                background: status === 'ok' ? 'rgba(80,180,120,0.15)'
                          : status === 'err' ? 'rgba(220,80,80,0.18)'
                          : 'rgba(120,140,180,0.18)',
                color: status === 'ok' ? '#7ec8a3'
                     : status === 'err' ? '#ee8a8a'
                     : 'var(--forge-ink-mute, #99a3ad)',
              }}>
          {status === 'ok'     ? 'compiled'
         : status === 'err'    ? 'error'
         : status === 'idle'   ? 'idle'
         : status === 'pending' ? 'compiling…'
         : status}
        </span>
        <span style={{ flex: 1 }} />
        <span data-testid="forge-csg-body-count"
              style={{ fontSize: 11, fontFamily: 'var(--forge-mono)',
                       color: 'var(--forge-ink-mute, #99a3ad)' }}>
          {bodies.length} {bodies.length === 1 ? 'body' : 'bodies'}
        </span>
      </header>

      {status === 'err' && errorText ? (
        <div data-testid="forge-csg-err"
             style={previewBannerErr()}>
          <strong>Error</strong>
          <pre style={{
            margin: '6px 0 0 0',
            whiteSpace: 'pre-wrap',
            fontFamily: 'var(--forge-mono)',
            fontSize: 12,
          }}>{errorText}</pre>
        </div>
      ) : null}

      <div style={{
        flex: 1, overflow: 'auto', padding: '8px 14px',
        background: 'var(--forge-canvas, #0e1014)',
      }}>
        {bodies.length === 0 ? (
          <div data-testid="forge-csg-bodies-empty"
               style={{
                 fontSize: 12,
                 opacity: 0.6,
                 padding: '24px 0',
                 textAlign: 'center',
               }}>
            no bodies — write a primitive or boolean to begin.
          </div>
        ) : (
          <ol data-testid="forge-csg-bodies"
              style={{ margin: 0, padding: '0 0 0 18px',
                       fontSize: 12, lineHeight: '20px' }}>
            {bodies.map((b) => (
              <li key={b.id} data-csg-body={b.id}>
                <code style={{ fontFamily: 'var(--forge-mono)' }}>
                  #{b.handle}
                </code>
                <span style={{ marginLeft: 8, opacity: 0.85 }}>{b.name}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <ReferenceBar />
    </div>
  );
}

function ReferenceBar() {
  return (
    <footer data-testid="forge-csg-reference"
            style={{
              padding: '6px 14px',
              borderTop: '1px solid var(--forge-rail-edge, #2a2f37)',
              background: 'var(--forge-canvas-2, #15171c)',
              fontSize: 11, fontFamily: 'var(--forge-mono)',
              color: 'var(--forge-ink-mute, #99a3ad)',
              flexShrink: 0,
              maxHeight: 96, overflow: 'auto',
            }}>
      <div><strong>modules</strong> · {BUILTIN_MODULES.join(', ')}</div>
      <div style={{ marginTop: 2 }}>
        <strong>functions</strong> · {BUILTIN_FUNCTIONS.join(', ')}
      </div>
      <div style={{ marginTop: 2, opacity: 0.75 }}>
        control · for(i=[0:n]){'{…}'}, if(cond){'{…}'} else{'{…}'},
        function name(a,b)=expr;, let(a=1) expr
      </div>
    </footer>
  );
}

/* ---------------------------------------------------------------- */
/*  Workbench panel                                                 */
/* ---------------------------------------------------------------- */

export function CsgScriptingWorkbench({ open, onClose }) {
  const [source,    setSource]    = useState(SAMPLE_SCRIPT);
  const [bodies,    setBodies]    = useState([]);
  const [status,    setStatus]    = useState('idle');   // 'idle'|'pending'|'ok'|'err'
  const [errorText, setErrorText] = useState(null);
  const [kernelOk,  setKernelOk]  = useState(() => kernelReady());

  const timerRef = useRef(null);
  const runIdRef = useRef(0);

  // Poll the kernel readiness once on open (the addon loads lazily on
  // Electron startup) — without it the panel can't run.
  useEffect(() => {
    if (!open) return undefined;
    setKernelOk(kernelReady());
    const t = setInterval(() => setKernelOk(kernelReady()), 600);
    return () => clearInterval(t);
  }, [open]);

  const runNow = useCallback((src) => {
    const myRun = ++runIdRef.current;
    setStatus('pending');
    // The interpreter is synchronous — no need to defer beyond the
    // next microtask.  Wrap in setTimeout(0) so the "pending" badge
    // paints before the OCCT calls block.
    setTimeout(() => {
      if (myRun !== runIdRef.current) return;
      const result = evalScript(src);
      if (myRun !== runIdRef.current) return;
      if (!result.ok) {
        setStatus('err');
        setErrorText(result.error || 'unknown error');
        if (result.kernelOffline) {
          setKernelOk(false);
          clearCsgBodies();
        }
        return;
      }
      setStatus('ok');
      setErrorText(null);
      setBodies(result.bodies);
      publishCsgBodies(result.bodies);
    }, 0);
  }, []);

  // 500 ms debounce after the last keystroke.
  useEffect(() => {
    if (!open) return undefined;
    if (!kernelOk) return undefined;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => runNow(source), DEBOUNCE_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [source, open, kernelOk, runNow]);

  // First-open evaluation (no wait).
  const firstRunRef = useRef(false);
  useEffect(() => {
    if (!open) return;
    if (firstRunRef.current) return;
    if (!kernelOk) return;
    firstRunRef.current = true;
    runNow(source);
  }, [open, kernelOk, runNow, source]);

  // Esc closes; expose imperative run / set so e2e can poke without
  // typing if needed (clicks are still the test path).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Publish minimal hooks for tests/Archie — read-only-ish.
  useEffect(() => {
    if (!open) return undefined;
    if (typeof window === 'undefined') return undefined;
    window.__forgeCsgSource     = source;
    window.__forgeCsgBodies     = bodies;
    window.__forgeCsgStatus     = status;
    window.__forgeCsgKernelOk   = kernelOk;
    window.__forgeCsgErr        = errorText;
    window.__forgeCsgEval       = (src) => evalScript(src);
    return () => {
      try { delete window.__forgeCsgSource;   } catch {}
      try { delete window.__forgeCsgBodies;   } catch {}
      try { delete window.__forgeCsgStatus;   } catch {}
      try { delete window.__forgeCsgKernelOk; } catch {}
      try { delete window.__forgeCsgErr;      } catch {}
      try { delete window.__forgeCsgEval;     } catch {}
    };
  }, [source, bodies, status, kernelOk, errorText, open]);

  const lineCount = useMemo(() => {
    let n = 1;
    for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) n++;
    return n;
  }, [source]);

  const onCloseClick = useCallback(() => {
    onClose?.();
  }, [onClose]);

  const onInsertSnippet = useCallback((snippet) => {
    setSource((prev) => prev.endsWith('\n') ? prev + snippet + '\n' : prev + '\n' + snippet + '\n');
    showToast({ kind: 'info', text: `Inserted snippet (${snippet.split('\n').length} lines)`, ttl: 1400 });
  }, []);

  const onClearBodies = useCallback(() => {
    setBodies([]);
    clearCsgBodies();
    setStatus('idle');
    setErrorText(null);
    showToast({ kind: 'ok', text: 'CSG bodies cleared', ttl: 1200 });
  }, []);

  const onRunNow = useCallback(() => {
    runNow(source);
  }, [runNow, source]);

  if (!open) return null;

  return (
    <div role="dialog"
         aria-label="CSG Scripting Workbench"
         data-testid="forge-csg-workbench"
         data-csg-kernel={kernelOk ? 'ready' : 'offline'}
         style={panelOuter()}>
      {/* header */}
      <header style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 14px',
        borderBottom: '1px solid var(--forge-rail-edge, #2a2f37)',
        background: 'var(--forge-canvas-2, #15171c)',
        flexShrink: 0,
      }}>
        <Icon name="archie.formula" size={14} />
        <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>CSG Scripting</h2>
        <span style={{
          color: 'var(--forge-ink-mute, #99a3ad)', fontSize: 11,
          fontFamily: 'var(--forge-mono)',
        }}>
          OpenSCAD-flavoured · real OCCT kernel · {lineCount} lines · debounce 500 ms
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                data-testid="forge-csg-run"
                onClick={onRunNow}
                style={pillBtn()}>Run now</button>
        <button type="button"
                data-testid="forge-csg-clear"
                onClick={onClearBodies}
                style={pillBtn()}>Clear bodies</button>
        <button type="button"
                data-testid="forge-csg-close"
                onClick={onCloseClick}
                aria-label="Close"
                style={pillBtn()}>Close</button>
      </header>

      {/* snippet bar */}
      <div data-testid="forge-csg-snippets"
           style={{
             display: 'flex', alignItems: 'center', gap: 8,
             padding: '6px 14px',
             borderBottom: '1px solid var(--forge-rail-edge, #2a2f37)',
             background: 'var(--forge-canvas, #0e1014)',
             flexShrink: 0,
             flexWrap: 'wrap',
           }}>
        <span style={{ fontSize: 11, color: 'var(--forge-ink-mute, #99a3ad)' }}>Insert:</span>
        {REFERENCE_SNIPPETS.map((s) => (
          <button key={s.label}
                  type="button"
                  data-testid={`forge-csg-snippet-${s.label.replace(/\s+/g, '-').toLowerCase()}`}
                  onClick={() => onInsertSnippet(s.body)}
                  style={chipBtn()}>{s.label}</button>
        ))}
        <span style={{ flex: 1 }} />
        <button type="button"
                data-testid="forge-csg-reset"
                onClick={() => setSource(SAMPLE_SCRIPT)}
                style={chipBtn()}>Reset to sample</button>
      </div>

      {/* split body */}
      <div style={{
        flex: 1, minHeight: 0,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
      }}>
        <Editor value={source} onChange={setSource} lineCount={lineCount} />
        <PreviewPane kernelOk={kernelOk}
                     status={status}
                     bodies={bodies}
                     errorText={errorText} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/*  Self-mounting host                                              */
/* ---------------------------------------------------------------- */

export function CsgScriptingWorkbenchHost() {
  const [open, setOpen] = useState(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) return undefined;
    mountedRef.current = true;
    if (typeof window === 'undefined') return undefined;

    window.__forgeOpenCsg  = (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeCloseCsg = () => setOpen(false);

    const onEvt = (e) => {
      const d = e?.detail || {};
      if (d.close) setOpen(false); else setOpen(true);
    };
    window.addEventListener(CSG_EVENT, onEvt);

    // [data-wb="csg"] rail clicks also open the panel — the rail tab
    // is contributed alongside the existing workbenches below.
    const onRailClick = (e) => {
      const tab = e.target?.closest?.('[data-wb="csg"]');
      if (tab) setOpen(true);
    };
    document.addEventListener('click', onRailClick, true);

    return () => {
      window.removeEventListener(CSG_EVENT, onEvt);
      document.removeEventListener('click', onRailClick, true);
      try { delete window.__forgeOpenCsg;  } catch {}
      try { delete window.__forgeCloseCsg; } catch {}
    };
  }, []);

  return <CsgScriptingWorkbench open={open} onClose={() => setOpen(false)} />;
}

/* ---------------------------------------------------------------- */
/*  Styling                                                         */
/* ---------------------------------------------------------------- */

function panelOuter() {
  return {
    position: 'fixed',
    top:    'calc(var(--forge-topbar-h, 36px) + var(--forge-qat-h, 28px))',
    left:   0,
    right:  0,
    bottom: 'var(--forge-cmdbar-h, 32px)',
    background: 'var(--forge-canvas-2, #15171c)',
    color: 'var(--forge-ink, #d8dde4)',
    display: 'flex', flexDirection: 'column',
    zIndex: 1290,
  };
}

function previewOuter() {
  return {
    display: 'flex', flexDirection: 'column',
    minHeight: 0, minWidth: 0,
    background: 'var(--forge-canvas, #0e1014)',
    borderLeft: '1px solid var(--forge-rail-edge, #2a2f37)',
  };
}

function previewBannerErr() {
  return {
    margin: 12,
    padding: '10px 12px',
    border: '1px solid rgba(220,80,80,0.45)',
    background: 'rgba(220,80,80,0.08)',
    borderRadius: 4,
    color: '#f3b1b1',
    fontSize: 12,
  };
}

function pillBtn() {
  return {
    background: 'transparent',
    border: '1px solid var(--forge-rail-edge, #2a2f37)',
    color: 'var(--forge-ink, #d8dde4)',
    cursor: 'pointer',
    padding: '4px 10px',
    fontSize: 11,
    borderRadius: 3,
  };
}

function chipBtn() {
  return {
    background: 'var(--forge-canvas-2, #1d2026)',
    border: '1px solid var(--forge-rail-edge, #2a2f37)',
    color: 'var(--forge-ink, #d8dde4)',
    cursor: 'pointer',
    padding: '3px 8px',
    fontSize: 11,
    borderRadius: 3,
    fontFamily: 'var(--forge-mono)',
  };
}

export default CsgScriptingWorkbench;
