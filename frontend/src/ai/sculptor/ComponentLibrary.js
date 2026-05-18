/**
 * ArchDisc — Component Library.
 *
 * As the autonomous sculptor completes each component of a product, the
 * component is exported to a STEP file and saved here with a stable id. The
 * library is the running record of finished components — the basis of the
 * final deliverable ZIP (every component as a STEP file).
 */

import { manifoldToSTEP } from '../../foundation/StepExport.js';

/**
 * Export a sculpted Part's solid to STEP (ISO 10303-21) text.
 *
 * @param {object} part  a Part with a `.solid` manifold-3d object
 * @returns {string} the STEP file text
 */
export function partToStep(part) {
  if (!part || !part.solid) throw new Error('partToStep: part has no solid');
  const step = manifoldToSTEP(part.solid);
  if (typeof step !== 'string' || !step) throw new Error('partToStep: STEP export produced no text');
  return step;
}

/**
 * An ordered registry of finished components.
 */
export class ComponentLibrary {
  constructor() {
    this._entries = new Map();
  }

  saveComponent(c) {
    if (!c || typeof c.id !== 'string' || !c.id) throw new Error('saveComponent: a non-empty string id is required');
    if (typeof c.stepText !== 'string' || !c.stepText) throw new Error('saveComponent: non-empty stepText is required');
    if (this._entries.has(c.id)) throw new Error(`saveComponent: duplicate id '${c.id}'`);
    const entry = { id: c.id, name: c.name ?? c.id, stepText: c.stepText, volume: c.volume ?? 0 };
    this._entries.set(c.id, entry);
    return entry;
  }

  get(id) {
    return this._entries.get(id) ?? null;
  }

  list() {
    return [...this._entries.values()];
  }

  count() {
    return this._entries.size;
  }
}
