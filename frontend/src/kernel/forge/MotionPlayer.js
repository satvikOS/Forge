/**
 * ArchDisc Forge — MotionPlayer (Forge-12b)
 *
 * Live motion showcase for dynamic / CFD / nonlinear-FEA results. Given a
 * base Three.js mesh and an array of per-frame nodal displacements, this
 * class drives a requestAnimationFrame loop that:
 *
 *   1. Interpolates between the two adjacent frames linearly (in time).
 *   2. Applies per-vertex displacements to the mesh's position attribute
 *      (with optional `setExaggeration(scale)` to amplify visibly).
 *   3. Maps the per-frame scalar field (von-Mises / temperature / pressure
 *      magnitude) to per-vertex colours via a chosen palette (default
 *      viridis), writing into the mesh's `color` attribute.
 *   4. Calls `onFrame({ t, frameIndex, maxScalar, displacementScale })` so
 *      the renderer can update a colorbar UI.
 *
 * Headless-friendly: the constructor accepts an optional `THREE` object so
 * tests in plain Node can pass a tiny stub that mimics the bits we need
 * (BufferAttribute.needsUpdate, BufferAttribute.array). When running in the
 * Electron renderer we use the global `THREE` from the import side.
 *
 * Units: displacement frames are in metres (matching solveDynamic /
 * solveNonlinearStatic output). Scalar fields are dimensionless in this
 * class — callers should normalise (e.g. divide by max von-Mises) before
 * handing them in. The `displacementScale` argument is multiplied onto the
 * raw frame displacement during render.
 */

const _DEFAULT_PALETTE = 'viridis';

/**
 * Linear interpolation. Returns a + (b - a) * t.
 */
function lerp(a, b, t) { return a + (b - a) * t; }

/**
 * Viridis colormap (Matplotlib). Returns [r, g, b] in [0, 1].
 * Approximated with a 9-stop piecewise-linear LUT — small enough to inline,
 * smooth enough to look right in a renderer.
 */
const VIRIDIS_STOPS = [
  [0.267004, 0.004874, 0.329415],
  [0.282623, 0.140926, 0.457517],
  [0.253935, 0.265254, 0.529983],
  [0.206756, 0.371758, 0.553117],
  [0.163625, 0.471133, 0.558148],
  [0.127568, 0.566949, 0.550556],
  [0.134692, 0.658636, 0.517649],
  [0.266941, 0.748751, 0.440573],
  [0.477504, 0.821444, 0.318195],
  [0.741388, 0.873449, 0.149561],
  [0.993248, 0.906157, 0.143936],
];
const PLASMA_STOPS = [
  [0.050383, 0.029803, 0.527975],
  [0.260271, 0.022637, 0.628530],
  [0.439359, 0.005168, 0.659643],
  [0.605542, 0.043510, 0.633913],
  [0.748324, 0.157151, 0.557120],
  [0.866013, 0.286627, 0.450184],
  [0.953666, 0.426377, 0.355823],
  [0.998151, 0.598838, 0.244017],
  [0.987325, 0.785471, 0.130284],
  [0.940015, 0.975158, 0.131326],
];
const PALETTES = { viridis: VIRIDIS_STOPS, plasma: PLASMA_STOPS };

/** Sample a palette at normalised t ∈ [0, 1]. Returns [r, g, b]. */
export function samplePalette(palette, t) {
  const stops = PALETTES[palette] || VIRIDIS_STOPS;
  const tc = Math.min(1, Math.max(0, t));
  const k = tc * (stops.length - 1);
  const i = Math.floor(k);
  const a = stops[i];
  const b = stops[Math.min(stops.length - 1, i + 1)];
  const f = k - i;
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
}

export class MotionPlayer {
  /**
   * @param {object} cfg
   * @param {object} cfg.baseMesh — Three.js Mesh-like object with
   *   `.geometry.attributes.position` (BufferAttribute) and optionally
   *   `.geometry.attributes.color`.
   * @param {Array<Float64Array>} cfg.frames — per-step displacement.
   *   Each frame is length 3N (matching baseMesh's nodeCount).
   * @param {Array<Float32Array>=} cfg.scalarFrames — optional per-step
   *   per-vertex scalar (length N), for color mapping. If omitted, no
   *   color attribute is written.
   * @param {Array<number>=} cfg.times — per-frame timestamps (s). If
   *   omitted, frames are assumed uniformly spaced.
   * @param {function=} cfg.onFrame — callback every frame.
   * @param {object=} cfg.three — Three.js module override (for tests).
   * @param {object=} cfg.clock — clock with `.now()` (for tests).
   */
  constructor({ baseMesh, frames, scalarFrames = null, times = null,
                onFrame = null, three = null, clock = null }) {
    if (!baseMesh || !baseMesh.geometry || !baseMesh.geometry.attributes ||
        !baseMesh.geometry.attributes.position) {
      throw new Error('[MotionPlayer] baseMesh requires .geometry.attributes.position');
    }
    if (!Array.isArray(frames) || frames.length < 2) {
      throw new Error('[MotionPlayer] frames must be an array of ≥ 2 Float64Array entries');
    }
    const N = baseMesh.geometry.attributes.position.array.length / 3;
    for (const f of frames) {
      if (!f || f.length !== 3 * N) {
        throw new Error(`[MotionPlayer] each frame must be Float64Array length 3·${N}; got ${f && f.length}`);
      }
    }
    if (scalarFrames) {
      if (!Array.isArray(scalarFrames) || scalarFrames.length !== frames.length) {
        throw new Error('[MotionPlayer] scalarFrames length must match frames length');
      }
      for (const sf of scalarFrames) {
        if (!sf || sf.length !== N) {
          throw new Error(`[MotionPlayer] scalarFrames entries must be length ${N}`);
        }
      }
    }
    if (times) {
      if (!Array.isArray(times) || times.length !== frames.length) {
        throw new Error('[MotionPlayer] times length must match frames length');
      }
    }

    this._mesh = baseMesh;
    this._frames = frames;
    this._scalarFrames = scalarFrames;
    this._times = times || frames.map((_, i) => i / (frames.length - 1));
    this._onFrame = onFrame;
    this._three = three;
    this._clock = clock || { now: () => (typeof performance !== 'undefined'
                                          ? performance.now()
                                          : Date.now()) };
    // Snapshot the rest-position so each frame is applied against the
    // undeformed mesh (otherwise we'd accumulate displacement on each tick).
    const pos = baseMesh.geometry.attributes.position;
    this._restPositions = new Float32Array(pos.array.length);
    this._restPositions.set(pos.array);

    // Optional color attribute creation (if scalarFrames given but mesh has none).
    if (this._scalarFrames && !baseMesh.geometry.attributes.color) {
      this._ensureColorAttribute(N);
    }

    // Animation state.
    this._playing = false;
    this._loop    = true;
    this._speed   = 1.0;
    this._palette = _DEFAULT_PALETTE;
    this._t       = this._times[0];
    this._startWall = 0;
    this._exaggeration = 1.0;
    this._rafToken  = null;

    // Cache for normalisation across the whole sequence — used for stable
    // colorbar limits (so the colour at t=0.5 is comparable to t=0.9).
    this._maxScalarGlobal = 0;
    if (this._scalarFrames) {
      for (const sf of this._scalarFrames) {
        for (const s of sf) if (s > this._maxScalarGlobal) this._maxScalarGlobal = s;
      }
      if (!(this._maxScalarGlobal > 0)) this._maxScalarGlobal = 1; // avoid divide-by-zero
    }
  }

  _ensureColorAttribute(N) {
    // Build a stub BufferAttribute-like object so the headless renderer can
    // read .array / .needsUpdate without a real Three.js dependency.
    const arr = new Float32Array(3 * N);
    arr.fill(1);
    if (this._three && this._three.BufferAttribute) {
      this._mesh.geometry.attributes.color = new this._three.BufferAttribute(arr, 3);
    } else {
      this._mesh.geometry.attributes.color = { array: arr, count: N, itemSize: 3, needsUpdate: false };
    }
  }

  /**
   * Begin playback. Idempotent — calling play() while already playing has
   * no effect.
   *
   * @param {object} cfg
   * @param {number} [cfg.speed=1] — playback speed (1 = real-time relative to `times`).
   * @param {boolean}[cfg.loop=true]
   * @param {string} [cfg.palette='viridis']
   */
  play({ speed = 1, loop = true, palette = _DEFAULT_PALETTE } = {}) {
    if (this._playing) return;
    this._playing = true;
    this._speed   = speed;
    this._loop    = loop;
    this._palette = palette;
    this._startWall = this._clock.now();
    this._scheduleTick();
  }

  pause() {
    this._playing = false;
    if (this._rafToken != null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._rafToken);
      this._rafToken = null;
    }
  }

  /**
   * Jump to a specific simulation time (s). Renders one frame at the
   * new position and pauses if it was paused.
   */
  seek(t) {
    const t0 = this._times[0];
    const tf = this._times[this._times.length - 1];
    this._t = Math.max(t0, Math.min(tf, t));
    // Reset the wall-clock baseline so an in-progress play() continues from
    // here rather than snapping back to where it was.
    if (this._playing) this._startWall = this._clock.now() - (this._t - t0) * 1000 / this._speed;
    this._renderFrameAt(this._t);
  }

  /**
   * Multiplier applied to every displacement before writing to the mesh.
   * Useful for visualising tiny strains (e.g. set to 50× for a static
   * cantilever where actual deflection is only millimetres on a metre-long
   * beam).
   */
  setExaggeration(scale) {
    if (!Number.isFinite(scale)) throw new Error('[MotionPlayer] exaggeration must be finite');
    this._exaggeration = scale;
    this._renderFrameAt(this._t);
  }

  /** Returns the current simulation time. */
  currentTime() { return this._t; }
  /** Returns the total animation duration (s). */
  duration() { return this._times[this._times.length - 1] - this._times[0]; }
  /** Returns the active palette. */
  palette() { return this._palette; }
  /** Returns true if playback is in progress. */
  isPlaying() { return this._playing; }

  /**
   * Manually advance the player by `dtMs` milliseconds and render the
   * resulting frame. Useful for the test harness (no requestAnimationFrame
   * available in Node).
   */
  tick(dtMs) {
    const elapsedSimS = dtMs * 0.001 * this._speed;
    const total = this.duration();
    let newT = this._t + elapsedSimS;
    if (newT > this._times[this._times.length - 1]) {
      if (this._loop) {
        newT = this._times[0] + ((newT - this._times[0]) % Math.max(1e-12, total));
      } else {
        newT = this._times[this._times.length - 1];
        this._playing = false;
      }
    }
    this._t = newT;
    this._renderFrameAt(this._t);
  }

  // ------------------------------------------------------------------
  _scheduleTick() {
    if (!this._playing) return;
    if (typeof requestAnimationFrame === 'function') {
      this._rafToken = requestAnimationFrame(() => this._rafStep());
    }
    // In Node (no rAF), the consumer should drive the loop via tick().
  }

  _rafStep() {
    if (!this._playing) return;
    const wallNow = this._clock.now();
    const elapsedMs = wallNow - this._startWall;
    const t0 = this._times[0];
    const total = this.duration();
    let newT = t0 + elapsedMs * 0.001 * this._speed;
    if (newT > this._times[this._times.length - 1]) {
      if (this._loop) {
        newT = t0 + ((newT - t0) % Math.max(1e-12, total));
        this._startWall = wallNow - (newT - t0) * 1000 / this._speed;
      } else {
        newT = this._times[this._times.length - 1];
        this._playing = false;
      }
    }
    this._t = newT;
    this._renderFrameAt(this._t);
    this._scheduleTick();
  }

  _renderFrameAt(t) {
    // Locate the bracketing frame indices.
    const times = this._times;
    const n = times.length;
    let i0 = 0;
    while (i0 < n - 1 && times[i0 + 1] < t) i0++;
    const i1 = Math.min(n - 1, i0 + 1);
    const tA = times[i0];
    const tB = times[i1];
    const u  = tB > tA ? (t - tA) / (tB - tA) : 0;

    const fA = this._frames[i0];
    const fB = this._frames[i1];

    const pos = this._mesh.geometry.attributes.position;
    const restArr = this._restPositions;
    const arr = pos.array;
    const N = arr.length / 3;

    const scale = this._exaggeration;
    for (let v = 0; v < N; v++) {
      const ax = fA[3*v    ], bx = fB[3*v    ];
      const ay = fA[3*v + 1], by = fB[3*v + 1];
      const az = fA[3*v + 2], bz = fB[3*v + 2];
      arr[3*v    ] = restArr[3*v    ] + (ax + (bx - ax) * u) * scale;
      arr[3*v + 1] = restArr[3*v + 1] + (ay + (by - ay) * u) * scale;
      arr[3*v + 2] = restArr[3*v + 2] + (az + (bz - az) * u) * scale;
    }
    pos.needsUpdate = true;

    // Optional scalar field → per-vertex RGB.
    let maxScalar = 0;
    if (this._scalarFrames) {
      const sA = this._scalarFrames[i0];
      const sB = this._scalarFrames[i1];
      const colorAttr = this._mesh.geometry.attributes.color;
      const carr = colorAttr ? colorAttr.array : null;
      const denom = this._maxScalarGlobal;
      for (let v = 0; v < N; v++) {
        const sv = sA[v] + (sB[v] - sA[v]) * u;
        if (sv > maxScalar) maxScalar = sv;
        if (carr) {
          const c = samplePalette(this._palette, sv / denom);
          carr[3*v    ] = c[0];
          carr[3*v + 1] = c[1];
          carr[3*v + 2] = c[2];
        }
      }
      if (colorAttr) colorAttr.needsUpdate = true;
    }

    if (typeof this._onFrame === 'function') {
      this._onFrame({
        t,
        frameIndex: i0,
        maxScalar,
        displacementScale: scale,
      });
    }
  }
}

export default { MotionPlayer, samplePalette };
