/**
 * ArchDisc Foundation — Part: a feature-tree wrapper around manifold solids.
 *
 * A Part is a sequence of features. Features are functions
 *   (manifold, opts) → manifold
 * that build the part incrementally. We keep the feature list so the
 * part can be re-evaluated when a parameter changes (toward parametric
 * history). The current evaluator is straight-line — replays features
 * in order.
 *
 * For mating + assembly, each Part has a transform that places it in
 * world space. The transform is applied lazily at evaluation time so
 * the underlying manifold stays at the part's local origin.
 */

import { getManifold } from './manifoldKernel.js';

let _partCounter = 0;

export class Part {
  constructor(name) {
    this.id = `part_${++_partCounter}`;
    this.name = name || this.id;
    this.features = [];      // array of { kind, builder, opts }
    this._cache = null;      // last evaluated manifold
    this._dirty = true;
    this.transform = {
      translation: [0, 0, 0],
      rotation: [0, 0, 0],   // Euler XYZ degrees
    };
    this.material = null;
    this.color = 0xa0a0a0;
    this.metadata = {};
  }

  /**
   * Add a feature. `builder` is an async function:
   *   (currentManifold | null, ctx) → manifold
   * where ctx is the Part instance (for opts access).
   */
  addFeature(kind, builder, opts = {}) {
    this.features.push({ kind, builder, opts });
    this._dirty = true;
    return this;
  }

  /**
   * Replay the feature stack and return the final manifold.
   */
  async evaluate() {
    if (!this._dirty && this._cache) return this._cache;
    let m = null;
    for (const f of this.features) {
      m = await f.builder(m, this, f.opts);
    }
    this._cache = m;
    this._dirty = false;
    return m;
  }

  /**
   * Evaluate and apply the part transform.
   */
  async evaluateInWorld() {
    let m = await this.evaluate();
    if (!m) return null;
    const [rx, ry, rz] = this.transform.rotation;
    const [tx, ty, tz] = this.transform.translation;
    if (rx || ry || rz) m = m.rotate([rx, ry, rz]);
    if (tx || ty || tz) m = m.translate([tx, ty, tz]);
    return m;
  }

  setTranslation([x, y, z]) {
    this.transform.translation = [x, y, z];
    return this;
  }

  setRotation([rx, ry, rz]) {
    this.transform.rotation = [rx, ry, rz];
    return this;
  }

  /**
   * Get part diagnostics from the evaluated manifold.
   */
  async diagnostics() {
    const m = await this.evaluate();
    if (!m) return { empty: true };
    const bbox = m.boundingBox();
    return {
      empty: false,
      volumeMm3: m.volume(),
      surfaceAreaMm2: m.surfaceArea(),
      boundingBoxMm: bbox,
      genus: m.genus(),       // # holes — useful manifold sanity check
      featureCount: this.features.length,
    };
  }
}

/**
 * Build a Part from a sequence of operations expressed as feature
 * builders. The first feature must produce a base solid (extrude /
 * revolve / etc); subsequent features can add or subtract.
 *
 * Example:
 *   const part = await buildPart('Bracket', [
 *     { kind: 'extrude', profile, distance: 5 },
 *     { kind: 'subtract', body: holePattern },
 *     { kind: 'fillet', edgeMask: 'all', radius: 2 },
 *   ]);
 */
export async function buildPart(name, ops) {
  const part = new Part(name);
  for (const op of ops) {
    part.addFeature(op.kind, async (current) => {
      const Features = await import('./Features.js');
      switch (op.kind) {
        case 'extrude': return Features.extrude(op.profile, op.distance, op);
        case 'revolve': return Features.revolve(op.profile, op.angleDeg ?? 360, op);
        case 'add':
          if (!current) throw new Error('add requires a base solid');
          return Features.add(current, op.body);
        case 'subtract':
          if (!current) throw new Error('subtract requires a base solid');
          return Features.subtract(current, op.body);
        case 'intersect':
          if (!current) throw new Error('intersect requires a base solid');
          return Features.intersect(current, op.body);
        case 'translate':
          if (!current) throw new Error('translate requires a base solid');
          return Features.translate(current, op.vec);
        case 'rotate':
          if (!current) throw new Error('rotate requires a base solid');
          return Features.rotate(current, op.angles);
        case 'scale':
          if (!current) throw new Error('scale requires a base solid');
          return Features.scale(current, op.factor);
        case 'mirror':
          if (!current) throw new Error('mirror requires a base solid');
          return Features.mirror(current, op.normal);
        case 'shell':
          if (!current) throw new Error('shell requires a base solid');
          return Features.shell(current, op.thickness);
        case 'linearPattern':
          if (!current) return Features.linearPattern(op.body, op.vec, op.count);
          throw new Error('linearPattern as add: pass body in op');
        case 'circularPattern':
          if (!current) return Features.circularPattern(op.body, op.count, op.axis);
          throw new Error('circularPattern as add: pass body in op');
        default:
          throw new Error(`Unknown feature kind: ${op.kind}`);
      }
    }, op);
  }
  // Touch evaluate so cache is warm
  await part.evaluate();
  return part;
}
