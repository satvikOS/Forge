/**
 * ArchDisc Foundation — assembly-sequence animation.
 *
 * Turns a static assembly (parts + mates) into an animated assembly
 * sequence: the order parts go together, an exploded pose for each,
 * and a per-part keyframe track that moves it from exploded to mated
 * position over its time slot. The reverse is a true exploded-view
 * animation.
 *
 * Assembly order is derived from the mate graph: the base part first,
 * then parts connected to an already-placed part, in breadth-first
 * waves — i.e. a part is never assembled before whatever it mates to.
 *
 * Output is consumed by the keyframe AnimationSystem (and by the
 * motion-study frame sampler). Translation-only, which is the standard
 * exploded-view convention; parts keep their assembled orientation.
 *
 * Kernel-free pure math — node-importable for e2e.
 */

const lerp3 = (a, b, u) => [
  a[0] + (b[0] - a[0]) * u,
  a[1] + (b[1] - a[1]) * u,
  a[2] + (b[2] - a[2]) * u,
];

/** Hermite smoothstep ease (0→0, 1→1, zero slope at both ends). */
const smoothstep = (u) => {
  const c = Math.max(0, Math.min(1, u));
  return c * c * (3 - 2 * c);
};

/**
 * Breadth-first assembly order from the mate graph.
 * @returns {string[]} part ids, base first, dependency-respecting.
 */
export function assemblyOrder(parts, mates, baseId) {
  const ids = parts.map((p) => p.id);
  const base = baseId ?? ids[0];
  const adj = new Map(ids.map((id) => [id, []]));
  for (const m of mates) {
    if (adj.has(m.a) && adj.has(m.b)) {
      adj.get(m.a).push(m.b);
      adj.get(m.b).push(m.a);
    }
  }
  const order = [];
  const seen = new Set();
  const queue = [base];
  seen.add(base);
  while (queue.length) {
    const p = queue.shift();
    order.push(p);
    for (const n of adj.get(p) ?? []) {
      if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  // Disconnected parts (no mate path to the base) go last.
  for (const id of ids) if (!seen.has(id)) order.push(id);
  return order;
}

/**
 * Generate an assembly-sequence animation.
 *
 * @param {object} assembly
 * @param {Array<{id,name,assembledPosition:number[]}>} assembly.parts
 * @param {Array<{a:string,b:string}>} assembly.mates
 * @param {object=} opts
 * @param {string=}  opts.baseId       fixed base part (default first part)
 * @param {number[]=} opts.explodeAxis direction parts retract along (default +Y)
 * @param {number=}  opts.explodeGap   spacing between parts along the axis (default 60)
 * @param {number=}  opts.duration     total animation time (default = part count)
 * @param {string=}  opts.mode         'assemble' (default) | 'explode'
 * @returns {{ order, duration, mode, parts, sample }}
 */
export function generateAssemblySequence(assembly, opts = {}) {
  const { parts, mates } = assembly;
  const baseId = opts.baseId ?? parts[0]?.id;
  const axisRaw = opts.explodeAxis ?? [0, 1, 0];
  const axLen = Math.hypot(...axisRaw) || 1;
  const axis = [axisRaw[0] / axLen, axisRaw[1] / axLen, axisRaw[2] / axLen];
  const gap = opts.explodeGap ?? 60;
  const mode = opts.mode ?? 'assemble';

  const order = assemblyOrder(parts, mates, baseId);
  const M = order.length;
  const duration = opts.duration ?? Math.max(1, M);
  const byId = new Map(parts.map((p) => [p.id, p]));

  // Each non-base part assembles in its own equal time slot.
  const slotCount = Math.max(1, M - 1);
  const slot = duration / slotCount;

  const seqParts = order.map((id, i) => {
    const part = byId.get(id);
    const assembled = part.assembledPosition;
    // The base (i=0) stays put; others retract `gap·i` along the axis.
    const exploded = [
      assembled[0] + axis[0] * gap * i,
      assembled[1] + axis[1] * gap * i,
      assembled[2] + axis[2] * gap * i,
    ];
    const slotStart = i === 0 ? 0 : (i - 1) * slot;
    const slotEnd = i === 0 ? 0 : i * slot;
    return {
      id, name: part.name, orderIndex: i,
      assembledPosition: assembled,
      explodedPosition: exploded,
      slotStart, slotEnd,
      // Keyframes for the AnimationSystem (assemble direction).
      keyframes: [
        { t: 0, position: exploded.slice() },
        { t: slotStart, position: exploded.slice() },
        { t: slotEnd, position: assembled.slice() },
        { t: duration, position: assembled.slice() },
      ],
    };
  });

  /** Position of every part at time t (smoothstep-eased within slots). */
  const sample = (t) => {
    const tt = mode === 'explode' ? duration - t : t;
    const out = {};
    for (const sp of seqParts) {
      let u;
      if (sp.slotEnd <= sp.slotStart) u = 1;                       // base
      else u = smoothstep((tt - sp.slotStart) / (sp.slotEnd - sp.slotStart));
      out[sp.id] = lerp3(sp.explodedPosition, sp.assembledPosition, u);
    }
    return out;
  };

  return { order, duration, mode, parts: seqParts, sample };
}

/**
 * Sample an assembly sequence into a flat array of animation frames.
 * @returns {Array<{ t, positions:Record<string,number[]> }>}
 */
export function sampleAssemblyFrames(sequence, frameCount = 48) {
  const n = Math.max(2, frameCount);
  const frames = [];
  for (let f = 0; f < n; f++) {
    const t = (f / (n - 1)) * sequence.duration;
    frames.push({ t, positions: sequence.sample(t) });
  }
  return frames;
}
