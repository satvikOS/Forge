/**
 * MBD / PMI — Model-Based Definition / Product Manufacturing
 * Information. Attaches GD&T + general notes directly to the 3D model
 * so a drawing isn't required to ship to manufacturing.
 *
 * Each annotation knows its anchor (face / edge / vertex topo id),
 * its leader line, and its rendered text. The renderer billboards
 * the text against the camera so notes stay legible at any view angle.
 */

let nextId = 1;
function uid(p) { return `${p}-${nextId++}`; }

export const FCFKind = Object.freeze({
  Flatness:        'flatness',
  Straightness:    'straightness',
  Circularity:     'circularity',
  Cylindricity:    'cylindricity',
  Perpendicularity:'perpendicularity',
  Parallelism:     'parallelism',
  Angularity:      'angularity',
  Position:        'position',
  Concentricity:   'concentricity',
  Symmetry:        'symmetry',
  Runout:          'runout',
  TotalRunout:     'total-runout',
  ProfileLine:     'profile-line',
  ProfileSurface:  'profile-surface',
});

export class Annotation {
  constructor({ shapeId, topoId, leader, position, kind = 'note', text = '' }) {
    if (!shapeId) throw new Error('[forge.mbd] Annotation requires shapeId');
    this.id = uid('ann');
    this.shapeId = shapeId;
    this.topoId = topoId ?? 0;
    this.leader = leader ? [...leader] : null;  // [x,y,z] anchor point on the shape
    this.position = position ? [...position] : null; // [x,y,z] label position in world space
    this.kind = kind;
    this.text = text;
  }
}

export class FCF extends Annotation {
  constructor({ control, tolerance, datums = [], modifiers = [], shapeId, topoId, leader, position }) {
    super({ shapeId, topoId, leader, position, kind: 'fcf' });
    if (!control) throw new Error('[forge.mbd] FCF requires control');
    if (typeof tolerance !== 'number') throw new Error('[forge.mbd] FCF requires tolerance');
    this.control = control;       // one of FCFKind.*
    this.tolerance = tolerance;
    this.datums = [...datums];
    this.modifiers = [...modifiers];  // 'M' (MMC), 'L' (LMC), 'P' (projected zone), …
    this.text = this.format();
  }
  format() {
    const sym = FCF_SYMBOL[this.control] || '?';
    const dat = this.datums.length ? '|' + this.datums.join('|') : '';
    const mod = this.modifiers.length ? this.modifiers.join('') : '';
    return `[${sym}|${this.tolerance.toFixed(3)}${mod}${dat}]`;
  }
}

const FCF_SYMBOL = {
  flatness:        '□',
  straightness:    '—',
  circularity:     '○',
  cylindricity:    '⌭',
  perpendicularity:'⊥',
  parallelism:     '∥',
  angularity:      '∠',
  position:        '⌖',
  concentricity:   '◎',
  symmetry:        '⌬',
  runout:          '↗',
  'total-runout':  '↗↗',
  'profile-line':  '⌒',
  'profile-surface':'⌒⌒',
};

export class Datum extends Annotation {
  constructor({ name, shapeId, topoId, leader, position }) {
    super({ shapeId, topoId, leader, position, kind: 'datum' });
    if (!name) throw new Error('[forge.mbd] Datum requires name');
    this.name = name;
    this.text = `[${name}]`;
  }
}

export class AnnotationSet {
  constructor() { this.annotations = new Map(); }
  add(a) { this.annotations.set(a.id, a); return a; }
  remove(id) { return this.annotations.delete(id); }
  list() { return [...this.annotations.values()]; }
  byShape(shapeId) { return this.list().filter((a) => a.shapeId === shapeId); }
}
