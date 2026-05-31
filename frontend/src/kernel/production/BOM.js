/**
 * ArchDisc — MBOM + EBOM Generators
 *
 * EBOM (Engineering BOM): hierarchical, indented by assembly tree.
 * MBOM (Manufacturing BOM): flat, with quantity-rolled-up + sourcing
 * info (supplier, lead time, unit cost) per line.
 *
 * Both reference PartIDRegistry as source of truth. CSV + JSON outputs.
 */

import PartIDRegistry from '../registry/PartIDRegistry.js';
import { MATERIAL_DATA } from './MaterialCert.js';
import FMEA from './FMEA.js';

const COST_PER_KG = {
  'Aluminum 6061-T6': 8,
  'Steel AISI 4340': 6,
  'Stainless Steel 316': 12,
  'Titanium Ti-6Al-4V': 65,
  'Inconel 718': 95,
  'Single-Crystal Nickel CMSX-4': 800,
  'Single-Crystal Nickel CMSX-4 (TBC-coated)': 1100,
  'CMC SiC/SiC': 2500,
  'Composite Carbon-Epoxy': 220,
  'Carbon Fiber Composite': 200,
  'Copper C11000': 16,
};

const SUPPLIERS = {
  'Aluminum 6061-T6':              'Alcoa',
  'Steel AISI 4340':               'Carpenter Technology',
  'Stainless Steel 316':           'Carpenter Technology',
  'Titanium Ti-6Al-4V':            'TIMET',
  'Inconel 718':                   'Special Metals (PCC)',
  'Single-Crystal Nickel CMSX-4':  'Cannon-Muskegon',
  'Single-Crystal Nickel CMSX-4 (TBC-coated)':  'Cannon-Muskegon + Praxair (coating)',
  'CMC SiC/SiC':                   'GE Aviation (proprietary)',
  'Composite Carbon-Epoxy':        'Hexcel',
  'Carbon Fiber Composite':        'Hexcel',
  'Copper C11000':                 'Mueller Industries',
};

const LEAD_WEEKS = {
  'Class 1': { forge_cast: 26, machined: 18, simple: 8 },
  'Class 2': { forge_cast: 12, machined: 8, simple: 4 },
  'Class 3': { forge_cast: 6, machined: 4, simple: 2 },
};

export default class BOM {

  /**
   * Build EBOM (engineering hierarchical) from registry tree.
   * @returns {object} hierarchy + total
   */
  static buildEBOM() {
    const tree = PartIDRegistry.tree();
    const lines = [];
    function walk(node, depth) {
      const entry = PartIDRegistry.get(node.id);
      if (!entry) return;
      const massKg = entry.partInstance?.solid?.massProperties?.(BOM._densityFor(entry.material))?.mass || 0;
      const cost = +(massKg * (COST_PER_KG[entry.material] || 5)).toFixed(2);
      lines.push({
        depth,
        partID: node.id,
        name: node.name,
        category: node.category,
        subsystem: node.subsystem,
        material: entry.material,
        quantity: 1,  // EBOM lists each instance
        massKg: +massKg.toFixed(3),
        unitCostUSD: cost,
        classification: FMEA.classify(node.category, node.subsystem),
      });
      for (const c of node.children || []) walk(c, depth + 1);
    }
    for (const r of tree) walk(r, 0);
    const totalCost = lines.reduce((s, l) => s + l.unitCostUSD, 0);
    const totalMass = lines.reduce((s, l) => s + l.massKg, 0);
    return { lines, totalCost, totalMass, count: lines.length };
  }

  /**
   * Build MBOM (manufacturing flat) — group identical names with quantity.
   */
  static buildMBOM() {
    const all = PartIDRegistry.all();
    const grouped = new Map();
    for (const e of all) {
      const massKg = e.partInstance?.solid?.massProperties?.(BOM._densityFor(e.material))?.mass || 0;
      const key = `${e.category}-${e.subsystem}-${e.name}`;
      if (!grouped.has(key)) {
        const cls = FMEA.classify(e.category, e.subsystem);
        grouped.set(key, {
          item: grouped.size + 1,
          name: e.name,
          category: e.category, subsystem: e.subsystem,
          material: e.material,
          classification: cls,
          quantity: 0,
          unitMassKg: +massKg.toFixed(3),
          unitCostUSD: +(massKg * (COST_PER_KG[e.material] || 5)).toFixed(2),
          supplier: SUPPLIERS[e.material] || 'TBD',
          leadTimeWeeks: BOM._leadTime(cls, e.subsystem),
          samplePartID: e.partID,
        });
      }
      const g = grouped.get(key);
      g.quantity++;
    }
    const lines = Array.from(grouped.values()).sort((a, b) => b.quantity - a.quantity);
    let totalCost = 0, totalMass = 0;
    for (const l of lines) {
      l.extendedCostUSD = +(l.unitCostUSD * l.quantity).toFixed(2);
      l.extendedMassKg = +(l.unitMassKg * l.quantity).toFixed(3);
      totalCost += l.extendedCostUSD;
      totalMass += l.extendedMassKg;
    }
    return { lines, totalCost: +totalCost.toFixed(2), totalMass: +totalMass.toFixed(2), uniqueParts: lines.length };
  }

  static toCSV_EBOM(ebom) {
    const lines = ['Depth,PartID,Name,Category,Subsystem,Material,Class,Mass_kg,Unit_Cost_USD'];
    for (const l of ebom.lines) {
      lines.push([l.depth, l.partID, `"${l.name}"`, l.category, l.subsystem, `"${l.material}"`, l.classification, l.massKg, l.unitCostUSD].join(','));
    }
    return lines.join('\n');
  }

  static toCSV_MBOM(mbom) {
    const lines = ['Item,Name,Category,Subsystem,Material,Class,Qty,Unit_Mass_kg,Unit_Cost_USD,Ext_Mass_kg,Ext_Cost_USD,Supplier,Lead_Weeks,Sample_PartID'];
    for (const l of mbom.lines) {
      lines.push([
        l.item, `"${l.name}"`, l.category, l.subsystem,
        `"${l.material}"`, l.classification,
        l.quantity, l.unitMassKg, l.unitCostUSD,
        l.extendedMassKg, l.extendedCostUSD,
        `"${l.supplier}"`, l.leadTimeWeeks, l.samplePartID,
      ].join(','));
    }
    return lines.join('\n');
  }

  static _densityFor(material) {
    return MATERIAL_DATA[material]?.mechanical?.density_kg_m3 || 2700;
  }

  static _leadTime(cls, subsystem) {
    const tier = ['BLD', 'NGV'].includes(subsystem) ? 'forge_cast'
      : ['DSK', 'CSG', 'LIN', 'SHFT'].includes(subsystem) ? 'forge_cast'
      : ['BLT', 'NUT', 'WSH', 'PIN'].includes(subsystem) ? 'simple'
      : 'machined';
    return LEAD_WEEKS[cls]?.[tier] || 4;
  }
}
