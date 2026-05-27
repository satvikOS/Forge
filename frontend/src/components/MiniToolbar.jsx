import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import './MiniToolbar.css';

/**
 * Mini-Toolbar — NX-radial / SW-context-style floating action bar that
 * appears next to the currently-selected body. The seven actions cover
 * the most-used selection-driven ops:
 *
 *   Delete (Del)  Hide  Isolate  Properties  Fillet  Pattern  Mirror
 *
 * Trigger
 *   BodyRegistry.select(id) → registry notifies → this listener picks
 *   the first selected body, computes its centroid in world space,
 *   projects to screen, and renders the toolbar a few pixels offset
 *   to the upper-right so it doesn't occlude the body.
 *
 * Lifetime
 *   While a single body is selected the toolbar lives. If selection
 *   clears (or grows to multi-select) the toolbar fades out. Position
 *   tracks the camera via requestAnimationFrame so the toolbar follows
 *   the body during orbit / pan / zoom — same way a SW mini-toolbar
 *   tracks the selection.
 */

export default function MiniToolbar() {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: -1000, y: -1000 });
  const [body, setBody] = useState(null);
  const rafRef = useRef(0);

  // Subscribe to BodyRegistry selection.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const reg = window.__archdiscBodies;
    if (!reg || typeof reg.onChange !== 'function') return undefined;

    const sync = () => {
      const ids = typeof reg.selectedIds === 'function' ? reg.selectedIds() : (reg.selectedId ? [reg.selectedId] : []);
      if (ids.length === 1) {
        const list = typeof reg.list === 'function' ? reg.list() : (reg.bodies || []);
        const b = list.find(x => x.id === ids[0]);
        if (b) { setBody(b); setVisible(true); return; }
      }
      setBody(null);
      setVisible(false);
    };
    sync();  // initial
    return reg.onChange(sync);
  }, []);

  // Track world→screen projection while visible.
  useEffect(() => {
    if (!visible || !body?.group) {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
      return undefined;
    }
    const vp = window.__archdiscViewport;
    if (!vp?.camera || !vp?.renderer) return undefined;

    const project = () => {
      const camera = vp.camera;
      const renderer = vp.renderer;
      if (!body.group) return;
      // Centroid of bbox in world coords.
      const box = new THREE.Box3().setFromObject(body.group);
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());
      const top = new THREE.Vector3(center.x, box.max.y, center.z);
      // Project to NDC then to client px.
      const ndc = top.clone().project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      let x = rect.left + (ndc.x * 0.5 + 0.5) * rect.width;
      let y = rect.top  + (1 - (ndc.y * 0.5 + 0.5)) * rect.height;
      // Behind the camera → hide entirely.
      if (ndc.z > 1) { setPos({ x: -1000, y: -1000 }); }
      else {
        // Clamp inside the viewport rect with a margin so the toolbar
        // is always reachable even if the body sits at the edge of (or
        // partially outside) the visible canvas. Without clamping a
        // tall body whose top projects above the viewport would put
        // the toolbar outside the click region.
        const MARGIN_X = 240;  // toolbar is roughly 220 px wide
        const MARGIN_Y = 28;
        x = Math.min(Math.max(x + 20, rect.left + 4), rect.right  - MARGIN_X);
        y = Math.min(Math.max(y - 40, rect.top + 4),  rect.bottom - MARGIN_Y);
        setPos({ x: Math.round(x), y: Math.round(y) });
      }
      rafRef.current = requestAnimationFrame(project);
    };
    rafRef.current = requestAnimationFrame(project);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = 0; };
  }, [visible, body]);

  const runTool = (tab, tool) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('archdisc:run-tool', { detail: { tab, tool } }));
  };

  const onDelete = () => {
    const reg = window.__archdiscBodies;
    if (reg && body && typeof reg.remove === 'function') {
      reg.remove(body.id);
    }
  };

  const onHide = () => {
    const reg = window.__archdiscBodies;
    if (reg && body && typeof reg.setVisible === 'function') {
      reg.setVisible(body.id, !body.visible);
    }
  };

  const onIsolate = () => {
    const reg = window.__archdiscBodies;
    if (!reg || !body) return;
    const list = typeof reg.list === 'function' ? reg.list() : (reg.bodies || []);
    for (const b of list) {
      if (typeof reg.setVisible === 'function') reg.setVisible(b.id, b.id === body.id);
    }
  };

  const onProperties = () => {
    if (typeof window === 'undefined') return;
    // PropertyManager listens for this event (SP-2 attribute system); if
    // it's not mounted, the dispatch is a no-op — graceful degradation.
    window.dispatchEvent(new CustomEvent('archdisc:open-properties', { detail: { id: body?.id } }));
  };

  if (!visible || !body) return null;

  // Hidden bodies show different "Hide" label.
  const hideLabel = body.visible === false ? 'Show' : 'Hide';

  return (
    <div
      className="mini-toolbar"
      role="toolbar"
      aria-label={`Mini-toolbar for ${body.name}`}
      style={{ left: pos.x, top: pos.y }}
      data-archdisc-mini-toolbar="active"
      data-archdisc-mini-toolbar-body={body.id}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button className="mt-btn mt-btn-danger" onClick={onDelete}            title="Delete (Del)"                data-mt-action="delete">✕</button>
      <button className="mt-btn"                 onClick={onHide}              title={`${hideLabel} body`}         data-mt-action="hide">{body.visible === false ? '◐' : '◑'}</button>
      <button className="mt-btn"                 onClick={onIsolate}           title="Isolate body"                data-mt-action="isolate">⊡</button>
      <button className="mt-btn"                 onClick={onProperties}        title="Properties"                  data-mt-action="properties">ⓘ</button>
      <span className="mt-sep" aria-hidden />
      <button className="mt-btn" onClick={() => runTool('part',     'Fillet')}         title="Fillet"          data-mt-action="fillet">⌒</button>
      <button className="mt-btn" onClick={() => runTool('part',     'Linear Pattern')} title="Linear Pattern"  data-mt-action="pattern">⋮⋮</button>
      <button className="mt-btn" onClick={() => runTool('assembly', 'Mirror')}         title="Mirror"          data-mt-action="mirror">⟷</button>
    </div>
  );
}
