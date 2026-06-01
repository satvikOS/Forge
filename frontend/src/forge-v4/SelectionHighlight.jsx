// Forge-158 — SelectionHighlight overlay.
//
// Reads window.__forgeAisSelection + window.__forgeScene (published by
// Viewport.jsx's RendererPublisher) and attaches a yellow pre-select
// outline / orange selection overlay directly into the live three.js
// scene. No new <Canvas> mount — we piggy-back on the existing r3f
// scene so the highlight stays in lock-step with the active camera.
//
// Faces  → polygonOffset coloured mesh overlay (avoids z-fighting).
// Edges  → THREE.LineSegments along the body's geometry edge buffer.
// Bodies → outline pass via a slightly-inflated back-side mesh.
// Vertices → small sphere at the picked point.
//
// The host self-mounts inside <App/> as a sibling of <ForgeShellV4/>.
// It is a React component but renders no DOM — its useEffect drives
// the scene-graph mutation.

import React from 'react';
import {
  subscribe as subscribeSelection,
  getSelection, getHovered,
  PRESELECT_COLOR, SELECT_COLOR,
} from './aisSelection.js';

const FACE_OPACITY = 0.45;
const EDGE_WIDTH   = 2;
const BODY_OUTLINE_SCALE = 1.012;

export function SelectionHighlight() {
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let cancelled = false;
    let raf = 0;
    let groupRef = null;
    let preMesh = null, selMesh = null;
    let preEdge = null, selEdge = null;
    let preDot  = null, selDot  = null;
    let THREE   = null;

    (async () => {
      try {
        THREE = await import('three');
      } catch (err) {
        console.warn('[forge.v4.selection-highlight] three load failed:', err.message);
        return;
      }
      if (cancelled) return;

      // Re-attach to the live scene whenever it becomes available. The
      // RendererPublisher sets/clears window.__forgeScene as the Canvas
      // mounts/unmounts, so we poll once per frame and re-add our group
      // if the scene was swapped.
      const ensureAttached = () => {
        const scene = window.__forgeScene;
        if (!scene) return false;
        if (!groupRef) {
          groupRef = new THREE.Group();
          groupRef.name = 'forge-selection-highlight';
          groupRef.renderOrder = 999;
          // Mount the slots (empty geometries swapped in per frame).
          const emptyGeom = new THREE.BufferGeometry();
          // Body / face overlay meshes — use polygonOffset so we don't
          // z-fight with the underlying body mesh.
          const overlayMat = (color) => new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: FACE_OPACITY,
            depthTest: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
            side: THREE.DoubleSide,
            toneMapped: false,
          });
          preMesh = new THREE.Mesh(emptyGeom, overlayMat(PRESELECT_COLOR));
          selMesh = new THREE.Mesh(emptyGeom, overlayMat(SELECT_COLOR));
          preMesh.visible = selMesh.visible = false;
          preMesh.frustumCulled = selMesh.frustumCulled = false;
          groupRef.add(preMesh, selMesh);
          // Edge / outline highlights — LineSegments via the body's
          // EdgesGeometry. Rebuilt whenever the body changes.
          const edgeMat = (color) => new THREE.LineBasicMaterial({
            color, linewidth: EDGE_WIDTH, depthTest: true, depthWrite: false,
            transparent: false, toneMapped: false,
          });
          preEdge = new THREE.LineSegments(emptyGeom, edgeMat(PRESELECT_COLOR));
          selEdge = new THREE.LineSegments(emptyGeom, edgeMat(SELECT_COLOR));
          preEdge.visible = selEdge.visible = false;
          preEdge.frustumCulled = selEdge.frustumCulled = false;
          groupRef.add(preEdge, selEdge);
          // Vertex dots — small spheres.
          const dotGeom = new THREE.SphereGeometry(0.6, 16, 12);
          const dotMat  = (color) => new THREE.MeshBasicMaterial({
            color, depthTest: false, toneMapped: false,
          });
          preDot = new THREE.Mesh(dotGeom, dotMat(PRESELECT_COLOR));
          selDot = new THREE.Mesh(dotGeom, dotMat(SELECT_COLOR));
          preDot.visible = selDot.visible = false;
          preDot.renderOrder = 1000;
          selDot.renderOrder = 1000;
          groupRef.add(preDot, selDot);
        }
        if (groupRef.parent !== scene) {
          scene.add(groupRef);
        }
        return true;
      };

      const tick = () => {
        if (cancelled) return;
        if (ensureAttached()) {
          applyEntity(getHovered(),   preMesh, preEdge, preDot, BODY_OUTLINE_SCALE * 1.004);
          applyEntity(getSelection(), selMesh, selEdge, selDot, BODY_OUTLINE_SCALE);
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();

    // Force a re-render of the highlight as soon as the selection
    // module fires a change (avoids the one-frame lag from the raf
    // polling loop on click).
    const unsub = subscribeSelection(() => {
      // The raf tick will pick it up on the next frame; we just bump
      // the renderer so the redraw is immediate even if the camera is
      // idle.
      if (typeof window !== 'undefined' && window.__forgeRenderer?.render) {
        // No direct call — the r3f loop drives the renderer. The
        // raf in this effect is enough to keep state in sync.
      }
    });

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      unsub?.();
      if (groupRef && groupRef.parent) groupRef.parent.remove(groupRef);
      // Dispose geometry/material slots.
      for (const m of [preMesh, selMesh, preEdge, selEdge, preDot, selDot]) {
        if (m) {
          m.geometry?.dispose?.();
          m.material?.dispose?.();
        }
      }
      groupRef = null;
    };

    function applyEntity(ent, faceMesh, edgeLine, vertexDot, outlineScale) {
      if (!ent || !ent.object) {
        faceMesh.visible = edgeLine.visible = vertexDot.visible = false;
        return;
      }
      // Track the source body's world transform so the overlay sits
      // exactly on top.
      const src = ent.object;
      const geom = src.geometry;
      if (!geom) {
        faceMesh.visible = edgeLine.visible = vertexDot.visible = false;
        return;
      }
      if (ent.kind === 'body') {
        // Outline pass: render an inflated back-side mesh so the
        // silhouette reads as a halo.
        faceMesh.geometry = geom;
        src.updateMatrixWorld(true);
        faceMesh.matrix.copy(src.matrixWorld);
        faceMesh.matrix.scale(new THREE.Vector3(outlineScale, outlineScale, outlineScale));
        faceMesh.matrixAutoUpdate = false;
        faceMesh.matrix.decompose(faceMesh.position, faceMesh.quaternion, faceMesh.scale);
        faceMesh.matrixAutoUpdate = true;
        faceMesh.visible = true;
        // Edge outline for body mode: derive EdgesGeometry once per
        // unique source geometry; cache on geom.userData.
        edgeLine.geometry = ensureEdgeGeometry(geom);
        edgeLine.matrix.copy(src.matrixWorld);
        edgeLine.matrixAutoUpdate = false;
        edgeLine.matrix.decompose(edgeLine.position, edgeLine.quaternion, edgeLine.scale);
        edgeLine.matrixAutoUpdate = true;
        edgeLine.visible = true;
        vertexDot.visible = false;
        return;
      }
      if (ent.kind === 'face') {
        // Coloured face overlay. For synthetic geometry we restrict to
        // a single face index by building a one-triangle (or two for
        // quads) sub-geometry; for kernel meshes the producer attaches
        // userData.facesGeom[faceIdx] which we use directly.
        const subGeom = ensureFaceSubGeometry(geom, ent.faceIdx);
        faceMesh.geometry = subGeom || geom;
        src.updateMatrixWorld(true);
        faceMesh.matrix.copy(src.matrixWorld);
        faceMesh.matrixAutoUpdate = false;
        faceMesh.matrix.decompose(faceMesh.position, faceMesh.quaternion, faceMesh.scale);
        faceMesh.matrixAutoUpdate = true;
        faceMesh.visible = true;
        edgeLine.visible = false;
        vertexDot.visible = false;
        return;
      }
      if (ent.kind === 'edge') {
        // Highlight the triangle's three edges as the selected edge
        // strip when the picker only resolved to a face. Kernel-mode
        // attaches a true edge polyline via userData.edges[edgeIdx]
        // and we use that when present.
        const edgeGeom = ensureEdgeSubGeometry(geom, ent.edgeIdx);
        edgeLine.geometry = edgeGeom || ensureEdgeGeometry(geom);
        src.updateMatrixWorld(true);
        edgeLine.matrix.copy(src.matrixWorld);
        edgeLine.matrixAutoUpdate = false;
        edgeLine.matrix.decompose(edgeLine.position, edgeLine.quaternion, edgeLine.scale);
        edgeLine.matrixAutoUpdate = true;
        edgeLine.visible = true;
        faceMesh.visible = false;
        vertexDot.visible = false;
        return;
      }
      if (ent.kind === 'vertex') {
        const p = ent.point;
        if (!p) { vertexDot.visible = false; return; }
        // ent.point is already in world space (set by aisSelection when
        // it sampled hit.point or geometry.attributes.position via the
        // hit's local transform).
        const local = new THREE.Vector3(p.x, p.y, p.z);
        // If the point was sampled from local-space positions, apply
        // the body world matrix; ent.point from hit.point is already
        // world. Heuristic: if vertexIdx >= 0 we sampled from local
        // positions → transform.
        if (ent.vertexIdx >= 0) {
          src.updateMatrixWorld(true);
          local.applyMatrix4(src.matrixWorld);
        }
        vertexDot.position.copy(local);
        vertexDot.visible = true;
        faceMesh.visible = false;
        edgeLine.visible = false;
      }
    }

    function ensureEdgeGeometry(geom) {
      if (!geom) return new THREE.BufferGeometry();
      if (geom.userData.__edgeGeom) return geom.userData.__edgeGeom;
      const eg = new THREE.EdgesGeometry(geom, 30);
      geom.userData.__edgeGeom = eg;
      return eg;
    }
    function ensureFaceSubGeometry(geom, faceIdx) {
      if (!geom || faceIdx < 0) return null;
      // Cache per face index on the geometry so repeated hovers don't
      // rebuild a BufferGeometry every frame.
      geom.userData.__faceSubs ||= new Map();
      const cache = geom.userData.__faceSubs;
      if (cache.has(faceIdx)) return cache.get(faceIdx);
      const pos = geom.attributes.position;
      if (!pos) return null;
      const idx = geom.index;
      let a, b, c;
      if (idx) {
        const i3 = faceIdx * 3;
        if (i3 + 2 >= idx.count) return null;
        a = idx.getX(i3);
        b = idx.getX(i3 + 1);
        c = idx.getX(i3 + 2);
      } else {
        const base = faceIdx * 3;
        a = base; b = base + 1; c = base + 2;
        if (c >= pos.count) return null;
      }
      const out = new THREE.BufferGeometry();
      const buf = new Float32Array(9);
      buf.set([pos.getX(a), pos.getY(a), pos.getZ(a)], 0);
      buf.set([pos.getX(b), pos.getY(b), pos.getZ(b)], 3);
      buf.set([pos.getX(c), pos.getY(c), pos.getZ(c)], 6);
      out.setAttribute('position', new THREE.BufferAttribute(buf, 3));
      out.computeVertexNormals();
      cache.set(faceIdx, out);
      return out;
    }
    function ensureEdgeSubGeometry(geom, edgeIdx) {
      if (!geom || edgeIdx < 0) return null;
      geom.userData.__edgeSubs ||= new Map();
      const cache = geom.userData.__edgeSubs;
      if (cache.has(edgeIdx)) return cache.get(edgeIdx);
      const pos = geom.attributes.position;
      const idx = geom.index;
      if (!pos) return null;
      let a, b, c;
      if (idx) {
        const i3 = edgeIdx * 3;
        if (i3 + 2 >= idx.count) return null;
        a = idx.getX(i3);
        b = idx.getX(i3 + 1);
        c = idx.getX(i3 + 2);
      } else {
        const base = edgeIdx * 3;
        a = base; b = base + 1; c = base + 2;
        if (c >= pos.count) return null;
      }
      const out = new THREE.BufferGeometry();
      // 3 edges = 6 endpoints.
      const buf = new Float32Array(18);
      const set = (off, vi) => buf.set(
        [pos.getX(vi), pos.getY(vi), pos.getZ(vi)], off);
      set(0, a); set(3, b);
      set(6, b); set(9, c);
      set(12, c); set(15, a);
      out.setAttribute('position', new THREE.BufferAttribute(buf, 3));
      cache.set(edgeIdx, out);
      return out;
    }
  }, []);

  return null;
}

/** App-level mount. Installs window.__forgeOpenSelectionMode for the
 *  Tools menu (rotates through body/face/edge/vertex). */
export function SelectionHighlightHost() {
  const [mode, setMode] = React.useState(() => {
    if (typeof window === 'undefined') return 'body';
    return window.__forgeSelectionApi?.getMode?.() || 'body';
  });
  // Keep local state in sync with module state. Used by tests +
  // future status-bar chip.
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onModeChange = (e) => setMode(e.detail?.mode || 'body');
    window.addEventListener('forge:selection-mode-changed', onModeChange);
    // Mode rotator hook used by the tools.selectionMode menu entry.
    window.__forgeOpenSelectionMode = (next) => {
      const api = window.__forgeSelectionApi;
      if (!api) return null;
      if (typeof next === 'string') { api.setMode(next); return next; }
      const seq = api.MODES;
      const cur = api.getMode();
      const i = seq.indexOf(cur);
      const nx = seq[(i + 1) % seq.length];
      api.setMode(nx);
      return nx;
    };
    return () => {
      window.removeEventListener('forge:selection-mode-changed', onModeChange);
      delete window.__forgeOpenSelectionMode;
    };
  }, []);
  return <SelectionHighlight />;
}

export default SelectionHighlight;
