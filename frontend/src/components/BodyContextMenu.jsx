import { useEffect, useState } from 'react';
import './BodyContextMenu.css';

/**
 * BodyContextMenu — viewport right-click context menu pinned to the
 * clicked body. Listens for `contextmenu` on the viewport canvas,
 * raycasts to find the body under the cursor, then shows a small
 * menu at the click point.
 *
 * Actions (mirror the WF-05 MiniToolbar set):
 *   Properties · Hide / Show · Isolate · Delete · Fillet · Linear Pattern
 *
 * Closes on:
 *   - Click outside
 *   - ESC
 *   - Selection of any menu item
 */

function dispatchTool(tab, tool) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('archdisc:run-tool', { detail: { tab, tool } }));
}

export default function BodyContextMenu() {
  const [state, setState] = useState(null);   // { x, y, body } | null

  // Attach contextmenu listener to the viewport canvas + raycast.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let raycaster = null;
    let attachTimer;
    const tryAttach = () => {
      const vp = window.__archdiscViewport;
      if (!vp?.renderer?.domElement || !vp?.camera || !vp?.scene) return false;
      const dom = vp.renderer.domElement;
      // Lazy import THREE for the raycaster.
      import('three').then(THREE => {
        raycaster = new THREE.Raycaster();
        const onCtx = (e) => {
          // Find body under cursor.
          const rect = dom.getBoundingClientRect();
          const ndc = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1,
          );
          raycaster.setFromCamera(ndc, vp.camera);
          const reg = window.__archdiscBodies;
          if (!reg) return;
          const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
          const groups = list.map(b => b.group).filter(Boolean);
          if (groups.length === 0) return;
          const hits = raycaster.intersectObjects(groups, true);
          if (hits.length === 0) return;
          let g = hits[0].object;
          while (g && !(g.userData && g.userData.bodyId)) g = g.parent;
          if (!g) return;
          const body = list.find(b => b.id === g.userData.bodyId);
          if (!body) return;
          e.preventDefault();
          // Auto-select the clicked body so the action targets it.
          reg.select(body.id, false);
          setState({ x: e.clientX, y: e.clientY, body });
        };
        dom.addEventListener('contextmenu', onCtx);
        // Save the disposer in the closure scope.
        window.__archdiscBodyContextMenuDispose = () => dom.removeEventListener('contextmenu', onCtx);
      });
      return true;
    };
    if (!tryAttach()) {
      attachTimer = setInterval(() => { if (tryAttach()) clearInterval(attachTimer); }, 250);
    }
    return () => {
      if (attachTimer) clearInterval(attachTimer);
      if (window.__archdiscBodyContextMenuDispose) {
        window.__archdiscBodyContextMenuDispose();
        delete window.__archdiscBodyContextMenuDispose;
      }
    };
  }, []);

  // Close on outside-click + ESC.
  useEffect(() => {
    if (!state) return undefined;
    const onDown = (e) => {
      // Don't close if click is INSIDE the menu — let the click handler fire.
      if (e.target?.closest?.('.body-context-menu')) return;
      setState(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setState(null); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [state]);

  if (!state) return null;
  const { x, y, body } = state;

  const fire = (fn) => {
    fn();
    setState(null);
  };

  const onProperties = () => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('archdisc:open-properties', { detail: { id: body.id } }));
  };
  const onHide = () => {
    const reg = window.__archdiscBodies;
    if (reg?.setVisible) reg.setVisible(body.id, !body.visible);
  };
  const onIsolate = () => {
    const reg = window.__archdiscBodies;
    if (!reg) return;
    const list = typeof reg.list === 'function' ? reg.list() : (reg.bodies || []);
    for (const b of list) {
      if (typeof reg.setVisible === 'function') reg.setVisible(b.id, b.id === body.id);
    }
  };
  const onDelete = () => {
    const reg = window.__archdiscBodies;
    if (reg?.remove) reg.remove(body.id);
  };

  return (
    <div
      className="body-context-menu"
      data-archdisc-body-context-menu="open"
      data-archdisc-body-context-body={body.id}
      style={{ left: x, top: y }}
    >
      <div className="bcm-head" title={body.name}>{body.name}</div>
      <button className="bcm-item" data-bcm-action="properties" onClick={() => fire(onProperties)}>Properties</button>
      <button className="bcm-item" data-bcm-action="hide"       onClick={() => fire(onHide)}>{body.visible === false ? 'Show' : 'Hide'}</button>
      <button className="bcm-item" data-bcm-action="isolate"    onClick={() => fire(onIsolate)}>Isolate</button>
      <div className="bcm-sep" />
      <button className="bcm-item" data-bcm-action="fillet"     onClick={() => fire(() => dispatchTool('part', 'Fillet'))}>Fillet…</button>
      <button className="bcm-item" data-bcm-action="pattern"    onClick={() => fire(() => dispatchTool('part', 'Linear Pattern'))}>Linear Pattern…</button>
      <button className="bcm-item" data-bcm-action="mirror"     onClick={() => fire(() => dispatchTool('part', 'Mirror Feature'))}>Mirror Feature…</button>
      <div className="bcm-sep" />
      <button className="bcm-item bcm-item-danger" data-bcm-action="delete" onClick={() => fire(onDelete)}>Delete</button>
    </div>
  );
}
