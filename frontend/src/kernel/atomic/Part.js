/**
 * ArchDisc Kernel — Part: the atomic construction-history record.
 *
 * A Part is an ordered list of features; each feature stores its type and
 * its parameters. The Part IS the editable construction history a human can
 * read and replay. Kernel-free bookkeeping — it holds an opaque `solid`
 * value (a manifold-3d object, supplied by AtomicOps) but never computes
 * geometry itself.
 */

let _partId = 0;
let _featureId = 0;

export class Part {
  constructor(name = 'Part') {
    this.id = ++_partId;
    this.name = name;
    this.features = [];        // ordered construction history
    this.solid = null;         // current result — opaque (a manifold-3d object)
    this.activeSketch = null;  // the open sketch, or null
    this.pendingProfile = null;// a finished sketch's closed loops, awaiting a feature
  }

  /**
   * Append a feature to the history. If `solid` is provided, it becomes the
   * Part's current solid; if omitted, the current solid is left unchanged.
   *
   * @param {string} type    operation name (e.g. 'extrude')
   * @param {object} params  operation parameters (copied, not referenced)
   * @param {*} [solid]      the geometry this feature produced, if any
   * @returns {{id:number,type:string,params:object}}
   */
  addFeature(type, params, solid) {
    const feature = { id: ++_featureId, type, params: { ...params } };
    this.features.push(feature);
    if (solid !== undefined) this.solid = solid;
    return feature;
  }

  /** @returns {number} number of features in the history */
  featureCount() {
    return this.features.length;
  }

  /** @returns {string} the construction history as an ordered arrow chain */
  describe() {
    return this.features.map((f, i) => `${i + 1}. ${f.type}`).join(' -> ');
  }
}
