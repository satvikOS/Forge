/**
 * ArchDisc — Material Certification + Certificate of Conformance
 *
 * Per-part documents that travel with the part from supplier to assembly:
 *
 *   1. Material Certificate — chemistry + mechanical properties of the
 *      heat lot (one cert per heat — multiple parts share a heat).
 *      Format: ASTM A6 / EN 10204 type 3.1 or 3.2.
 *
 *   2. Certificate of Conformance (CoC) — supplier's attestation that
 *      this specific part conforms to drawing rev X. Includes
 *      traceability chain (raw material → process → inspection).
 *
 * Material chemistry / mechanical lookup uses real published values for
 * common aerospace alloys.
 */

const MATERIAL_DATA = {
  'Titanium Ti-6Al-4V': {
    spec: 'AMS 4928 / ASTM B348 Grade 5',
    chemistry: { Ti: 'bal', Al: '5.5-6.75', V: '3.5-4.5', Fe: '≤0.30', O: '≤0.20', C: '≤0.08', N: '≤0.05', H: '≤0.015' },
    mechanical: { UTS_MPa: 950, YS_MPa: 880, elongation_pct: 14, RA_pct: 36, hardness_HRC: 36, density_kg_m3: 4430 },
    heatTreat: 'Annealed: 705°C/1hr, AC',
  },
  'Inconel 718': {
    spec: 'AMS 5662 / AMS 5663',
    chemistry: { Ni: '50-55', Cr: '17-21', Fe: 'bal', Nb: '4.75-5.5', Mo: '2.8-3.3', Ti: '0.65-1.15', Al: '0.20-0.80', C: '≤0.08' },
    mechanical: { UTS_MPa: 1240, YS_MPa: 1035, elongation_pct: 12, RA_pct: 15, hardness_HRC: 40, density_kg_m3: 8190 },
    heatTreat: 'Solution + age: 980°C/1hr WQ + 720°C/8hr FC + 620°C/8hr AC',
  },
  'Single-Crystal Nickel CMSX-4': {
    spec: 'CMSX-4 (Cannon-Muskegon)',
    chemistry: { Ni: 'bal', Cr: '6.5', Co: '9', Mo: '0.6', W: '6', Ta: '6.5', Al: '5.6', Ti: '1.0', Re: '3', Hf: '0.1' },
    mechanical: { UTS_MPa: 1100, YS_MPa: 950, elongation_pct: 10, RA_pct: 8, hardness_HRC: 38, density_kg_m3: 8700 },
    heatTreat: 'Solution: 1320°C/6hr + age 1140°C/4hr + 870°C/16hr',
  },
  'Single-Crystal Nickel CMSX-4 (TBC-coated)': {
    spec: 'CMSX-4 + APS YSZ TBC topcoat per AMS 4955',
    chemistry: { Ni: 'bal', Cr: '6.5', Co: '9', '+TBC': 'YSZ 7%Y2O3' },
    mechanical: { UTS_MPa: 1100, YS_MPa: 950, elongation_pct: 10, RA_pct: 8, hardness_HRC: 38, density_kg_m3: 8700 },
    heatTreat: 'Substrate solution + age + plasma-spray TBC 250µm',
  },
  'CMC SiC/SiC': {
    spec: 'GE9X CMC technology / NASA proprietary',
    chemistry: { SiC_fiber: 'Hi-Nicalon Type S', matrix: 'CVI SiC + MI Si', volume_fraction: '40-45%' },
    mechanical: { UTS_MPa: 400, YS_MPa: 350, elongation_pct: 0.5, hardness_HRC: 'N/A — ceramic', density_kg_m3: 2700 },
    heatTreat: 'Pyrolysis 1200°C / N2 + melt-infiltration 1450°C / Ar',
  },
  'Composite Carbon-Epoxy': {
    spec: 'Hexcel IM7/8552 prepreg',
    chemistry: { fiber: 'Hexcel IM7 carbon', matrix: 'Hexcel 8552 epoxy', volume_fraction: '60% fiber' },
    mechanical: { UTS_MPa: 1500, YS_MPa: 'N/A — composite', elongation_pct: 1.4, density_kg_m3: 1600 },
    heatTreat: 'Autoclave cure: 180°C / 7 bar / 2hr',
  },
  'Aluminum 6061-T6': {
    spec: 'AMS 4027 / ASTM B221',
    chemistry: { Al: 'bal', Mg: '0.8-1.2', Si: '0.4-0.8', Cu: '0.15-0.40', Cr: '0.04-0.35', Fe: '≤0.7' },
    mechanical: { UTS_MPa: 310, YS_MPa: 276, elongation_pct: 12, hardness_HRB: 60, density_kg_m3: 2700 },
    heatTreat: 'T6: solution 530°C + age 175°C / 8hr',
  },
  'Steel AISI 4340': {
    spec: 'AMS 6414 / ASTM A29',
    chemistry: { Fe: 'bal', C: '0.38-0.43', Mn: '0.60-0.80', Cr: '0.70-0.90', Ni: '1.65-2.00', Mo: '0.20-0.30' },
    mechanical: { UTS_MPa: 1110, YS_MPa: 710, elongation_pct: 13, RA_pct: 50, hardness_HRC: 35, density_kg_m3: 7850 },
    heatTreat: 'Q&T: austenitize 845°C, oil quench, temper 540°C',
  },
  'Stainless Steel 316': {
    spec: 'ASTM A276 / AMS 5648',
    chemistry: { Fe: 'bal', Cr: '16-18', Ni: '10-14', Mo: '2-3', C: '≤0.08', Mn: '≤2', Si: '≤1' },
    mechanical: { UTS_MPa: 580, YS_MPa: 290, elongation_pct: 50, hardness_HRB: 95, density_kg_m3: 8000 },
    heatTreat: 'Solution annealed 1040°C, water quenched',
  },
  'Copper C11000': {
    spec: 'ASTM B187 ETP copper',
    chemistry: { Cu: '99.90 min', O: '0.04', P: '0.00' },
    mechanical: { UTS_MPa: 220, YS_MPa: 69, elongation_pct: 45, hardness_HRB: 30, density_kg_m3: 8940 },
    heatTreat: 'Annealed',
  },
};

export { MATERIAL_DATA };

export default class MaterialCert {

  /**
   * Generate material certificate for a heat lot.
   *
   * @param {object} options
   *   material        material name
   *   heatLot         e.g. 'HL-12345'
   *   supplier
   *   poNumber
   * @returns {object} { json, markdown }
   */
  static buildMaterialCert(options = {}) {
    const {
      material = 'Aluminum 6061-T6',
      heatLot = `HL-${Math.floor(Math.random() * 1e5).toString().padStart(5, '0')}`,
      supplier = 'Acme Mill Co.',
      poNumber = 'PO-2026-ARCHDISC-001',
      certDate = new Date().toISOString().slice(0, 10),
    } = options;

    const data = MATERIAL_DATA[material];
    if (!data) {
      return { json: { error: `unknown material: ${material}` }, markdown: '' };
    }

    const json = {
      certType: 'EN 10204 Type 3.1 / ASTM A6 Material Certificate',
      heatLot, supplier, poNumber, certDate,
      material,
      specification: data.spec,
      chemistry: data.chemistry,
      mechanicalProperties: data.mechanical,
      heatTreatment: data.heatTreat,
      certifiedBy: 'Mill Metallurgist (signature on file)',
    };

    const md = [
      `# Material Certificate — ${material}`,
      '',
      `**Cert Type:** ${json.certType}`,
      `**Heat Lot:** ${json.heatLot}  ·  **Supplier:** ${json.supplier}  ·  **PO:** ${json.poNumber}`,
      `**Date:** ${json.certDate}`,
      `**Specification:** ${json.specification}`,
      '',
      '## Chemistry',
      '| Element | wt % |',
      '|---------|------|',
      ...Object.entries(json.chemistry).map(([k, v]) => `| ${k} | ${v} |`),
      '',
      '## Mechanical Properties',
      '| Property | Value |',
      '|----------|-------|',
      ...Object.entries(json.mechanicalProperties).map(([k, v]) => `| ${k} | ${v} |`),
      '',
      `## Heat Treatment`,
      json.heatTreatment,
      '',
      `Certified by: ${json.certifiedBy}`,
    ].join('\n');

    return { json, markdown: md };
  }

  /**
   * Build Certificate of Conformance for a finished part.
   */
  static buildCoC(options = {}) {
    const {
      partID = 'PART-XXXX',
      partTitle = '',
      serialNumber = `SN-${Math.floor(Math.random() * 1e6).toString().padStart(6, '0')}`,
      drawingNumber = `${partID}-DWG`,
      drawingRev = 'A',
      heatLot,
      manufacturingLot = `MFG-${Date.now() % 100000}`,
      qualityManager = 'Q. Manager (QM-1)',
      certDate = new Date().toISOString().slice(0, 10),
      facilityCode = 'AD-001',
    } = options;

    const json = {
      certType: 'Certificate of Conformance',
      partID, partTitle, serialNumber,
      drawingNumber, drawingRev,
      heatLot, manufacturingLot,
      facilityCode,
      certDate,
      attestation: 'This part has been manufactured, inspected, and tested in accordance with the referenced drawing revision and conforms in all aspects to its specified requirements.',
      qualityManager,
      traceability: {
        rawMaterial: heatLot,
        manufacturingProcess: manufacturingLot,
        inspectionRecord: `INSP-${serialNumber}`,
        finalAcceptance: certDate,
      },
    };

    const md = [
      `# Certificate of Conformance`,
      '',
      `**Part:** ${partID} — ${partTitle}`,
      `**Serial No.:** ${serialNumber}`,
      `**Drawing:** ${drawingNumber} Rev ${drawingRev}`,
      `**Heat Lot:** ${heatLot}  ·  **Mfg Lot:** ${manufacturingLot}`,
      `**Facility:** ${facilityCode}  ·  **Cert Date:** ${certDate}`,
      '',
      '## Attestation',
      '',
      json.attestation,
      '',
      '## Traceability Chain',
      '',
      `- Raw Material: ${json.traceability.rawMaterial}`,
      `- Manufacturing: ${json.traceability.manufacturingProcess}`,
      `- Inspection: ${json.traceability.inspectionRecord}`,
      `- Final Acceptance: ${json.traceability.finalAcceptance}`,
      '',
      `Quality Manager: ${json.qualityManager}`,
    ].join('\n');

    return { json, markdown: md };
  }
}
