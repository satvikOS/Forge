/**
 * Multi-body OBJ + MTL export. Each scene body becomes its own OBJ
 * group `g` plus its own MTL material entry whose diffuse colour
 * matches the engineering material assigned through WF-08's Body
 * Properties Inspector (Steel grey, Aluminum light, Brass gold,
 * etc.).
 *
 * OBJ is the lowest-common-denominator mesh format -- every DCC tool
 * (Blender, 3ds Max, Cinema 4D, Maya, Houdini, Unity, Unreal,
 * KeyShot) reads it natively. Multi-body OBJ preserves per-part names
 * + material assignments so the user can re-author appearances in
 * those tools without losing identity.
 */

import * as THREE from 'three';
import { makeZipBrowser } from './ProjectBundleExport.js';

// Diffuse colour per material (Munsell-style approximation of the
// physical surface). Keys match the WF-08 BodyPropertiesInspector
// material registry; values are 0..1 RGB.
const MATERIAL_COLORS = {
  'steel-1045':  [0.62, 0.62, 0.64],
  'steel-4140':  [0.58, 0.59, 0.62],
  'stainless':   [0.78, 0.80, 0.82],
  'aluminum':    [0.83, 0.84, 0.86],
  'brass':       [0.85, 0.65, 0.20],
  'cast-iron':   [0.36, 0.36, 0.38],
  'titanium':    [0.68, 0.66, 0.66],
  'pu':          [0.85, 0.55, 0.20],
};
const DEFAULT_COLOR = [0.65, 0.66, 0.68];

const MAT_STORAGE_KEY = 'archdisc:body-materials:v1';

function loadMaterialMap() {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(MAT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch { return {}; }
}

function listBodies() {
  if (typeof window === 'undefined' || !window.__archdiscBodies) return [];
  const reg = window.__archdiscBodies;
  if (typeof reg.list === 'function') return reg.list();
  if (Array.isArray(reg.bodies)) return reg.bodies;
  return [];
}

function safeName(s, fallback) {
  const cleaned = String(s ?? fallback).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.length === 0 ? fallback : cleaned;
}

/**
 * Build the OBJ + MTL texts + a ZIP bundling both. Returns the bundle
 * bytes + counts + (optional) triggers download.
 */
export function exportMultiBodyObj(opts = {}) {
  const bodies = listBodies();
  if (bodies.length === 0) {
    return { ok: false, reason: 'empty-scene', bodies: 0 };
  }
  const matMap = loadMaterialMap();
  const projName = safeName(opts.projectName ?? 'archdisc-assembly', 'archdisc-assembly');

  const mtlLines = [];
  const objLines = [`mtllib ${projName}.mtl`];

  // Vertex / normal counters are global (OBJ uses 1-based global indices).
  let vOff = 0;
  let vnOff = 0;

  // Per-body material naming.
  const usedMaterials = new Set();

  for (let bi = 0; bi < bodies.length; bi++) {
    const body = bodies[bi];
    if (!body?.group) continue;
    const baseName = safeName(body.name ?? `Body_${bi + 1}`, `Body_${bi + 1}`);
    const matKey = matMap[body.id] || null;
    const matSlug = safeName(matKey || 'Default', 'Default');
    const matName = `${matSlug}`;

    // Register material in MTL if new.
    if (!usedMaterials.has(matName)) {
      const [r, g, b] = matKey && MATERIAL_COLORS[matKey] ? MATERIAL_COLORS[matKey] : DEFAULT_COLOR;
      mtlLines.push(
        `newmtl ${matName}`,
        `Ka ${(r * 0.2).toFixed(3)} ${(g * 0.2).toFixed(3)} ${(b * 0.2).toFixed(3)}`,
        `Kd ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`,
        `Ks 0.30 0.30 0.30`,
        `Ns 32`,
        `illum 2`,
        '',
      );
      usedMaterials.add(matName);
    }

    objLines.push('', `o ${baseName}`, `g ${baseName}`, `usemtl ${matName}`);

    // Harvest vertices + normals in world mm (matches WF-13 / WF-14 / WF-20).
    body.group.updateMatrixWorld(true);
    body.group.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry) return;
      const pos = obj.geometry.attributes.position;
      const norm = obj.geometry.attributes.normal;
      if (!pos) return;
      const matrix = obj.matrixWorld;
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
      const tmp = new THREE.Vector3();
      const tmpN = new THREE.Vector3();
      const startV = vOff;
      const startVN = vnOff;
      for (let i = 0; i < pos.count; i++) {
        tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(matrix);
        objLines.push(`v ${(tmp.x * 1000).toFixed(4)} ${(tmp.y * 1000).toFixed(4)} ${(tmp.z * 1000).toFixed(4)}`);
        vOff += 1;
        if (norm) {
          tmpN.set(norm.getX(i), norm.getY(i), norm.getZ(i)).applyMatrix3(normalMatrix).normalize();
          objLines.push(`vn ${tmpN.x.toFixed(4)} ${tmpN.y.toFixed(4)} ${tmpN.z.toFixed(4)}`);
          vnOff += 1;
        }
      }
      const idx = obj.geometry.index;
      const triCount = idx ? idx.count : pos.count;
      for (let i = 0; i < triCount; i += 3) {
        const i0 = (idx ? idx.getX(i)     : i) + 1;
        const i1 = (idx ? idx.getX(i + 1) : i + 1) + 1;
        const i2 = (idx ? idx.getX(i + 2) : i + 2) + 1;
        const v0 = startV + i0;
        const v1 = startV + i1;
        const v2 = startV + i2;
        if (norm) {
          const n0 = startVN + i0;
          const n1 = startVN + i1;
          const n2 = startVN + i2;
          objLines.push(`f ${v0}//${n0} ${v1}//${n1} ${v2}//${n2}`);
        } else {
          objLines.push(`f ${v0} ${v1} ${v2}`);
        }
      }
    });
  }

  const objText = objLines.join('\n') + '\n';
  const mtlText = mtlLines.join('\n') + '\n';
  const zipBytes = makeZipBrowser([
    { path: `${projName}.obj`, data: objText },
    { path: `${projName}.mtl`, data: mtlText },
  ]);
  const filename = opts.filename ?? `${projName}.zip`;

  if (opts.download !== false && typeof window !== 'undefined' && typeof document !== 'undefined') {
    try {
      const blob = new Blob([zipBytes], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.warn('[OBJ multi] download failed', err);
    }
  }

  return {
    ok: true,
    bodies: bodies.length,
    materials: usedMaterials.size,
    objBytes: objText.length,
    mtlBytes: mtlText.length,
    bytes: zipBytes.length,
    filename,
    objText,
    mtlText,
    zipBytes,
  };
}

export default { exportMultiBodyObj };
