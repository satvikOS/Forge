/**
 * Electrical schematic — 2D symbolic diagram (resistors, capacitors,
 * sources, ICs as black boxes), with a netlist export.
 *
 * Strictly 2D; this slice is the data + netlist model. SVG rendering
 * comes via the Drawings layer (Forge-10) since it already does
 * polyline output and SVG export.
 */

let nextId = 1;
function uid(p) { return `${p}-${nextId++}`; }

export class SchematicSymbol {
  constructor({ kind, label = '', value = '', position = [0, 0], rotation = 0,
                pins = [] }) {
    if (!kind) throw new Error('[forge.elec] SchematicSymbol requires kind');
    this.id = uid('sym');
    this.kind = kind;     // resistor | capacitor | inductor | diode | vsource | isource | gnd | ic | …
    this.label = label || kind;
    this.value = value;   // "10k", "100nF", "12V", etc.
    this.position = [...position];
    this.rotation = rotation; // radians
    this.pins = pins.map((p, i) => ({ pinId: uid('pin'), index: i, offset: [...p] }));
  }
}

export class Schematic {
  constructor({ name = 'Schematic' } = {}) {
    this.id = uid('sch');
    this.name = name;
    this.symbols = new Map();   // id → SchematicSymbol
    this.wires = new Map();     // id → { from: pinId, to: pinId }
  }
  addSymbol(s) {
    const sym = s instanceof SchematicSymbol ? s : new SchematicSymbol(s);
    this.symbols.set(sym.id, sym);
    return sym;
  }
  removeSymbol(id) {
    if (!this.symbols.has(id)) return false;
    // Cull any wires that referenced this symbol's pins.
    const pinIds = new Set(this.symbols.get(id).pins.map((p) => p.pinId));
    for (const [wid, w] of [...this.wires]) {
      if (pinIds.has(w.from) || pinIds.has(w.to)) this.wires.delete(wid);
    }
    return this.symbols.delete(id);
  }
  connect(pinA, pinB) {
    if (!this._pinExists(pinA)) throw new Error(`[forge.elec] unknown pin ${pinA}`);
    if (!this._pinExists(pinB)) throw new Error(`[forge.elec] unknown pin ${pinB}`);
    const id = uid('wire');
    this.wires.set(id, { from: pinA, to: pinB });
    return id;
  }
  _pinExists(pinId) {
    for (const s of this.symbols.values()) {
      if (s.pins.some((p) => p.pinId === pinId)) return true;
    }
    return false;
  }

  /**
   * Compute nets — connected components of the wire graph. Two pins
   * are on the same net iff they're in the same component. Returns
   * an array of { netId, pins }.
   */
  netlist() {
    const parent = new Map();
    const find = (x) => parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x));
    const union = (a, b) => { parent.set(find(a), find(b)); };

    for (const s of this.symbols.values()) {
      for (const p of s.pins) parent.set(p.pinId, p.pinId);
    }
    for (const w of this.wires.values()) {
      if (parent.has(w.from) && parent.has(w.to)) union(w.from, w.to);
    }
    const nets = new Map();
    for (const p of parent.keys()) {
      const root = find(p);
      if (!nets.has(root)) nets.set(root, []);
      nets.get(root).push(p);
    }
    return [...nets].map(([netId, pins]) => ({ netId, pins }));
  }

  /** Minimal SPICE netlist export (one component per symbol, gnd → 0). */
  toSpice() {
    const nets = this.netlist();
    const pinToNet = new Map();
    nets.forEach(({ netId, pins }, i) => {
      const name = pinToGndCheck(netId, this) ? '0' : String(i + 1);
      for (const p of pins) pinToNet.set(p, name);
    });
    const lines = [`* ${this.name}`];
    let counter = 0;
    for (const s of this.symbols.values()) {
      if (s.kind === 'gnd') continue;
      counter++;
      const nets = s.pins.map((p) => pinToNet.get(p.pinId) || '0').join(' ');
      const refdes = s.label || `${prefixFor(s.kind)}${counter}`;
      lines.push(`${refdes} ${nets} ${s.value || ''}`.trim());
    }
    lines.push('.end');
    return lines.join('\n');
  }
}

function prefixFor(kind) {
  switch (kind) {
    case 'resistor':  return 'R';
    case 'capacitor': return 'C';
    case 'inductor':  return 'L';
    case 'diode':     return 'D';
    case 'vsource':   return 'V';
    case 'isource':   return 'I';
    default:          return 'X';
  }
}

function pinToGndCheck(netId, sch) {
  for (const s of sch.symbols.values()) {
    if (s.kind !== 'gnd') continue;
    for (const p of s.pins) if (p.pinId === netId) return true;
  }
  return false;
}
