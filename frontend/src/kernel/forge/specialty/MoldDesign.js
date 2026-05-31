/**
 * Mold-design helpers — ejector pin placement, runner routing,
 * gating selection. Pure data + heuristics; the 3D mold body
 * geometry is generated through native part ops in a follow-up slice.
 */

let nextId = 1;
function uid(p) { return `${p}-${nextId++}`; }

export const GateKind = Object.freeze({
  Edge:     'edge',
  Submarine:'submarine',
  Pin:      'pin',
  Tunnel:   'tunnel',
  Fan:      'fan',
});

export class EjectorPin {
  constructor({ position, diameter, length, allowedDeviation = 0.5 }) {
    if (!position || position.length !== 3) throw new Error('[forge.mold] position [x,y,z] required');
    if (!diameter) throw new Error('[forge.mold] EjectorPin requires diameter');
    if (!length) throw new Error('[forge.mold] EjectorPin requires length');
    this.id = uid('ep');
    this.position = [...position];
    this.diameter = diameter;
    this.length = length;
    this.allowedDeviation = allowedDeviation;
  }
}

export class Runner {
  constructor({ kind = 'cold', diameter, length, path = [] }) {
    if (!diameter) throw new Error('[forge.mold] Runner requires diameter');
    this.id = uid('rn');
    this.kind = kind;             // 'cold' | 'hot'
    this.diameter = diameter;
    this.length = length || polyLen(path);
    this.path = path.map((p) => [...p]);
  }
}

export class Gate {
  constructor({ kind = GateKind.Edge, position, size }) {
    if (!position) throw new Error('[forge.mold] Gate requires position');
    if (!size) throw new Error('[forge.mold] Gate requires size (mm)');
    this.id = uid('gate');
    this.kind = kind;
    this.position = [...position];
    this.size = size;
  }
}

export class MoldLayout {
  constructor({ partName = 'Part' } = {}) {
    this.id = uid('mold');
    this.partName = partName;
    this.ejectorPins = new Map();
    this.runners = new Map();
    this.gates = new Map();
  }
  addEjector(spec) { const e = spec instanceof EjectorPin ? spec : new EjectorPin(spec); this.ejectorPins.set(e.id, e); return e; }
  addRunner(spec) { const r = spec instanceof Runner ? spec : new Runner(spec); this.runners.set(r.id, r); return r; }
  addGate(spec)   { const g = spec instanceof Gate ? spec : new Gate(spec); this.gates.set(g.id, g); return g; }

  /**
   * Suggest gate kind from rule-of-thumb part geometry: thin-walled → fan,
   * cosmetic Class-A → tunnel, multi-cavity grids → submarine, default edge.
   */
  static suggestGate({ partThickness, isCosmetic = false, cavityCount = 1 }) {
    if (partThickness && partThickness < 1.5)         return GateKind.Fan;
    if (isCosmetic)                                    return GateKind.Tunnel;
    if (cavityCount > 1)                               return GateKind.Submarine;
    return GateKind.Edge;
  }
  /** Total runner volume — used for cycle-time + material-waste estimates. */
  runnerVolume() {
    let V = 0;
    for (const r of this.runners.values()) {
      V += Math.PI * (r.diameter / 2) ** 2 * r.length;
    }
    return V;
  }
}

function polyLen(path) {
  let L = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    L += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return L;
}
