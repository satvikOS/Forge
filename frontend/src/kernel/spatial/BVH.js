/**
 * ArchDisc — Bounding Volume Hierarchy (BVH)
 *
 * Spatial acceleration structure for fast raycasting in large scenes.
 * Default Three.js raycasting is O(n) over all objects.
 * BVH gives O(log n) by hierarchically partitioning bounding boxes.
 *
 * Build: top-down, split by longest axis at object centroid median.
 * Query: traverse tree, descend only into nodes whose AABB the ray hits.
 *
 * Critical for 100K+ component scenes — without this, picking becomes
 * unusable past a few thousand parts.
 */

import * as THREE from 'three';

const MAX_LEAF_OBJECTS = 4;
const MAX_DEPTH = 24;

class BVHNode {
  constructor() {
    this.bbox = new THREE.Box3();
    this.left = null;
    this.right = null;
    this.objects = null; // leaf only
  }
  isLeaf() { return this.objects !== null; }
}

export default class BVH {

  /**
   * Build a BVH from a list of Three.js objects.
   * Each object must have a computed bounding box (or geometry with one).
   * @param {THREE.Object3D[]} objects
   * @returns {BVH}
   */
  static build(objects) {
    const bvh = new BVH();
    if (!objects.length) return bvh;

    // Compute world-space bounding boxes once
    const items = objects.map(obj => {
      const box = new THREE.Box3().setFromObject(obj);
      const center = box.getCenter(new THREE.Vector3());
      return { obj, box, center };
    }).filter(it => isFinite(it.box.min.x) && isFinite(it.box.max.x));

    bvh.root = BVH._buildNode(items, 0);
    bvh.itemCount = items.length;
    return bvh;
  }

  static _buildNode(items, depth) {
    const node = new BVHNode();
    for (const it of items) node.bbox.union(it.box);

    if (items.length <= MAX_LEAF_OBJECTS || depth >= MAX_DEPTH) {
      node.objects = items.map(it => it.obj);
      return node;
    }

    // Split by longest axis at median
    const size = node.bbox.getSize(new THREE.Vector3());
    let axis = 0;
    if (size.y > size.x && size.y > size.z) axis = 1;
    else if (size.z > size.x) axis = 2;

    const axisKey = axis === 0 ? 'x' : axis === 1 ? 'y' : 'z';
    items.sort((a, b) => a.center[axisKey] - b.center[axisKey]);

    const mid = Math.floor(items.length / 2);
    const leftItems = items.slice(0, mid);
    const rightItems = items.slice(mid);

    if (leftItems.length === 0 || rightItems.length === 0) {
      node.objects = items.map(it => it.obj);
      return node;
    }

    node.left = BVH._buildNode(leftItems, depth + 1);
    node.right = BVH._buildNode(rightItems, depth + 1);
    return node;
  }

  /**
   * Raycast through the BVH. Returns candidate objects whose bbox the ray hits.
   * Caller still needs to do per-triangle intersection (much smaller set).
   * @param {THREE.Ray} ray
   * @returns {THREE.Object3D[]}
   */
  raycast(ray) {
    if (!this.root) return [];
    const candidates = [];
    BVH._traverse(this.root, ray, candidates);
    return candidates;
  }

  static _traverse(node, ray, out) {
    if (!ray.intersectsBox(node.bbox)) return;
    if (node.isLeaf()) {
      for (const obj of node.objects) out.push(obj);
      return;
    }
    if (node.left) BVH._traverse(node.left, ray, out);
    if (node.right) BVH._traverse(node.right, ray, out);
  }

  /**
   * Get tree depth — for diagnostics.
   */
  depth() {
    if (!this.root) return 0;
    const measure = (n) => {
      if (!n || n.isLeaf()) return 1;
      return 1 + Math.max(measure(n.left), measure(n.right));
    };
    return measure(this.root);
  }

  /**
   * Stats for debugging/diagnostics.
   */
  stats() {
    if (!this.root) return { depth: 0, leaves: 0, internal: 0, items: 0 };
    let leaves = 0, internal = 0;
    const walk = (n) => {
      if (!n) return;
      if (n.isLeaf()) leaves++;
      else { internal++; walk(n.left); walk(n.right); }
    };
    walk(this.root);
    return { depth: this.depth(), leaves, internal, items: this.itemCount || 0 };
  }
}
