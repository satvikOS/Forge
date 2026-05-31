import { useEffect, useState } from 'react';
import * as THREE from 'three';
import './QuickMeasureOverlay.css';

/**
 * QuickMeasureOverlay — viewport HUD that shows real engineering
 * measurements between selected bodies. Auto-appears when 2+ bodies
 * are selected; auto-hides otherwise.
 *
 * Surfaced values (all mm except dimensionless overlap):
 *   • Δ centroid    Euclidean distance between body[0] and body[1]
 *                   centroids
 *   • Δ x / y / z   per-axis component of that distance
 *   • Bbox overlap  intersection-volume / smaller-bbox-volume ratio
 *                   (0 = disjoint; 1 = first body fully inside second)
 *   • N selected    count when > 2; we collapse the per-pair display
 *                   to first vs. last to keep the HUD compact
 *
 * Reads BodyRegistry.onChange. Uses THREE.Box3 for bbox math.
 * Coordinates in scene-units (m) are scaled to mm for display.
 */

function bboxOf(group) {
  if (!group) return null;
  const b = new THREE.Box3().setFromObject(group);
  if (b.isEmpty()) return null;
  return b;
}

function intersectionVolume(a, b) {
  if (!a || !b) return 0;
  const ix = new THREE.Box3();
  ix.copy(a).intersect(b);
  if (ix.isEmpty()) return 0;
  const s = ix.getSize(new THREE.Vector3());
  return s.x * s.y * s.z;
}

function volume(box) {
  if (!box || box.isEmpty()) return 0;
  const s = box.getSize(new THREE.Vector3());
  return s.x * s.y * s.z;
}

export default function QuickMeasureOverlay() {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const reg = window.__archdiscBodies;
    if (!reg) return undefined;
    const sync = () => {
      const ids = typeof reg.selectedIds === 'function' ? reg.selectedIds() : (reg.selectedId ? [reg.selectedId] : []);
      if (ids.length < 2) { setData(null); return; }
      const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
      const selected = list.filter(b => ids.includes(b.id));
      if (selected.length < 2) { setData(null); return; }
      // First and last selected — for >2 we show the bounding-pair
      // measurement; centroid distance between an arbitrary pair gives
      // engineers a quick spread number.
      const a = selected[0];
      const b = selected[selected.length - 1];
      const bA = bboxOf(a.group);
      const bB = bboxOf(b.group);
      if (!bA || !bB) { setData(null); return; }
      const cA = bA.getCenter(new THREE.Vector3());
      const cB = bB.getCenter(new THREE.Vector3());
      const d = cB.clone().sub(cA);
      const distMm = d.length() * 1000;
      const dxMm = d.x * 1000;
      const dyMm = d.y * 1000;
      const dzMm = d.z * 1000;
      const overlap = (() => {
        const inter = intersectionVolume(bA, bB);
        const vA = volume(bA);
        const vB = volume(bB);
        const denom = Math.min(vA, vB);
        return denom > 0 ? inter / denom : 0;
      })();
      setData({
        count: selected.length,
        aName: a.name,
        bName: b.name,
        distMm,
        dxMm, dyMm, dzMm,
        overlap,
      });
    };
    sync();
    return reg.onChange ? reg.onChange(sync) : undefined;
  }, []);

  if (!data) return null;

  const fmt = (v, d = 2) => (Math.abs(v) < 1e-6 ? '0.00' : v.toFixed(d));

  return (
    <div className="quickmeasure" data-archdisc-quickmeasure="active" data-archdisc-quickmeasure-count={data.count}>
      <div className="qm-head">
        Quick measure · {data.count} selected
      </div>
      <div className="qm-row">
        <span className="qm-label">From</span>
        <span className="qm-value" data-archdisc-qm-from>{data.aName}</span>
      </div>
      <div className="qm-row">
        <span className="qm-label">To</span>
        <span className="qm-value" data-archdisc-qm-to>{data.bName}</span>
      </div>
      <div className="qm-row">
        <span className="qm-label">Δ centroid</span>
        <span className="qm-value mono" data-archdisc-qm-distance>{fmt(data.distMm)} mm</span>
      </div>
      <div className="qm-row">
        <span className="qm-label">Δ X · Y · Z</span>
        <span className="qm-value mono" data-archdisc-qm-axes>
          {fmt(data.dxMm)} · {fmt(data.dyMm)} · {fmt(data.dzMm)} mm
        </span>
      </div>
      <div className="qm-row">
        <span className="qm-label">Bbox overlap</span>
        <span className="qm-value mono" data-archdisc-qm-overlap>
          {(data.overlap * 100).toFixed(1)} %
        </span>
      </div>
    </div>
  );
}
