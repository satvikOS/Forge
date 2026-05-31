/**
 * BodyHoverDriver — drives the WF-21 hover emissive by tracking the
 * pointer over the viewport and raycasting against every BodyRegistry
 * body's Three.js group.
 *
 * Mechanism:
 *   - Attaches one `pointermove` listener to the viewport renderer's
 *     canvas. Throttled to one raycast per animation frame so even on
 *     a 1000-body scene the cost is bounded.
 *   - Builds the raycast candidate list lazily on every move from
 *     BodyRegistry.list(). Uses `recursive: true` so each body's full
 *     mesh subtree contributes.
 *   - On hit, walks up to the body's group (the one carrying
 *     userData.bodyId) and pushes its id into SelectionHighlight.
 *   - On miss / pointer leave, clears the hover id.
 *
 * Plays cleanly with the WF-18 selection-rim: SelectionHighlight gives
 * selection priority and suppresses hover paint on selected bodies.
 */

import * as THREE from 'three';
import { setHoveredBodyId } from './SelectionHighlight.js';

let _attached = false;
let _disposers = [];

function findBodyGroup(obj) {
  let cur = obj;
  while (cur) {
    if (cur.userData && cur.userData.bodyId) return cur;
    cur = cur.parent;
  }
  return null;
}

export function attachBodyHover() {
  if (_attached) return;
  if (typeof window === 'undefined') return;
  const vp = window.__archdiscViewport;
  if (!vp?.renderer || !vp?.camera || !vp?.scene) return;

  const dom = vp.renderer.domElement;
  if (!dom) return;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let pending = false;
  let lastClient = { x: 0, y: 0 };

  const doRaycast = () => {
    pending = false;
    const rect = dom.getBoundingClientRect();
    ndc.x = ((lastClient.x - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((lastClient.y - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, vp.camera);

    const reg = window.__archdiscBodies;
    if (!reg) { setHoveredBodyId(null); return; }
    const list = typeof reg.list === 'function' ? reg.list() : (reg.bodies || []);
    const groups = list.map(b => b.group).filter(Boolean);
    if (groups.length === 0) { setHoveredBodyId(null); return; }

    const hits = raycaster.intersectObjects(groups, true);
    if (hits.length === 0) { setHoveredBodyId(null); return; }

    const top = findBodyGroup(hits[0].object);
    setHoveredBodyId(top?.userData?.bodyId || null);
  };

  const onMove = (e) => {
    lastClient.x = e.clientX;
    lastClient.y = e.clientY;
    if (pending) return;
    pending = true;
    requestAnimationFrame(doRaycast);
  };
  const onLeave = () => {
    setHoveredBodyId(null);
  };

  dom.addEventListener('pointermove', onMove);
  dom.addEventListener('pointerleave', onLeave);
  _disposers.push(() => dom.removeEventListener('pointermove', onMove));
  _disposers.push(() => dom.removeEventListener('pointerleave', onLeave));

  _attached = true;
  if (typeof window !== 'undefined') {
    window.__archdiscBodyHoverActive = true;
    // Expose the hover setter so headed e2e can simulate the hover
    // without driving the raycaster through a real pointermove (which
    // requires knowing exact body screen coordinates).
    window.__archdiscSetHoveredBodyId = setHoveredBodyId;
  }
}

export function detachBodyHover() {
  for (const d of _disposers) try { d(); } catch { /* ignore */ }
  _disposers = [];
  _attached = false;
  if (typeof window !== 'undefined') {
    window.__archdiscBodyHoverActive = false;
    window.__archdiscHoveredBodyId = null;
  }
}

export default { attachBodyHover, detachBodyHover };
