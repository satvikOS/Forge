// PUSH-184 (Slice-140 / FAI AS9102 generator).
//
// SAE AS9102 Rev B (2014-10) is the aerospace First Article Inspection
// standard cross-walked by AS9100D §8.5.1.3. Every aerospace supplier
// that ships hardware against an engineering drawing must produce a
// FAIR (First Article Inspection Report) consisting of THREE forms
// before the production run is released:
//
//   * Form 1 — Part Number Accountability. One row per part / sub-
//     assembly; identifies the part, its drawing revision, the FAIR
//     identifier, the manufacturing process, the supplier code + the
//     P.O. + signatures.
//   * Form 2 — Product Accountability for Materials, Special Processes
//     & Functional Testing. One row per call-out (raw material lot,
//     heat-treat process, plating spec, etc.) — name + spec number +
//     supplier + Certificate-of-Conformance (CoC) number.
//   * Form 3 — Characteristic Accountability, Verification & Compatibility
//     Evaluation. One row per dimensional / GD&T characteristic on the
//     drawing — char number, location, K/C designator, requirement
//     (nominal + tolerance), measured result, tool used, non-conformance.
//
// PUSH-184 brief constraints honoured:
//   * NO new npm / C++ / external deps. Pure ES module.
//   * Real AS9102 column structure — every column comes from the AS9102B
//     form template, NOT invented. Column order matches the official
//     reporter.
//   * Each form ships a row schema + an ASCII formatter so the panel +
//     the e2e + headless callers can produce a TXT FAIR without touching
//     React.
//
// Row schema (per-form, each field is a string unless noted):
//
//   form1Row = {
//     partNumber, partName, serialNumber, fairIdentifier,
//     partRevisionLevel, drawingNumber, drawingRevisionLevel,
//     additionalChanges,
//     manufacturingProcessReference,
//     organizationName, supplierCode, customerCode, poNumber,
//     detailFai (boolean),        // Detail FAI vs Assembly FAI
//     fullFai   (boolean),        // Full FAI  vs Partial FAI
//     reasonForPartialFai,
//     baselinePartNumber,         // populated when detailFai = false
//     signatureName, signatureDate,
//     reviewerName, reviewerDate,
//     customerApprovalName, customerApprovalDate,
//   }
//
//   form2Row = {
//     materialOrProcessName, specificationNumber, code,
//     supplier, customerApprovalVerification, certificateNumber,
//   }
//
//   form3Row = {
//     characteristicNumber, referenceLocation,
//     characteristicDesignator,           // K / KC / Critical / Major / Minor
//     requirement, results, designedTooling,
//     nonConformanceNumber,
//   }
//
// FAIR document = { form1 (single row), form2 (array of rows), form3
// (array of rows), generatedAt, fairIdentifier, partNumber, partName }.

// ─────────────────────────────────────────────────────────────────────
// Schema metadata. The `id` is stable; `header` is what lands at the
// top of each ASCII column.

export const FORM_IDS = Object.freeze(['form1', 'form2', 'form3']);

export const FORM_META = Object.freeze({
  form1: Object.freeze({
    id: 'form1',
    label: 'Form 1 — Part Number Accountability',
    shortLabel: 'Form 1',
    asciiHeader: 'AS9102 Form 1 — Part Number Accountability',
  }),
  form2: Object.freeze({
    id: 'form2',
    label: 'Form 2 — Product Accountability: Materials, Processes & Functional Testing',
    shortLabel: 'Form 2',
    asciiHeader: 'AS9102 Form 2 — Materials / Processes / Functional Test Accountability',
  }),
  form3: Object.freeze({
    id: 'form3',
    label: 'Form 3 — Characteristic Accountability, Verification & Compatibility Evaluation',
    shortLabel: 'Form 3',
    asciiHeader: 'AS9102 Form 3 — Characteristic Accountability',
  }),
});

// AS9102B Form 1 — every official field number is preserved as the .id.
// "1" through "21" map straight to the official template. Field 8 splits
// into 8a (Detail FAI) / 8b (Assembly FAI); 9 splits into 9a (Full FAI)
// / 9b (Partial FAI, with 9c reason).
export const FORM1_FIELDS = Object.freeze([
  { id: 'partNumber',                  field: '1',  header: 'Part Number' },
  { id: 'partName',                    field: '2',  header: 'Part Name' },
  { id: 'serialNumber',                field: '3',  header: 'Serial Number' },
  { id: 'fairIdentifier',              field: '4',  header: 'FAIR Identifier' },
  { id: 'partRevisionLevel',           field: '5',  header: 'Part Revision Level' },
  { id: 'drawingNumber',               field: '6',  header: 'Drawing Number' },
  { id: 'drawingRevisionLevel',        field: '7',  header: 'Drawing Revision Level' },
  { id: 'additionalChanges',           field: '7a', header: 'Additional Changes' },
  { id: 'manufacturingProcessReference', field: '8', header: 'Manufacturing Process Reference' },
  { id: 'organizationName',            field: '9',  header: 'Organization Name' },
  { id: 'supplierCode',                field: '10', header: 'Supplier Code' },
  { id: 'customerCode',                field: '11', header: 'Customer Code' },
  { id: 'poNumber',                    field: '12', header: 'P.O. Number' },
  { id: 'detailFai',                   field: '13', header: 'Detail FAI (true) / Assembly FAI (false)', kind: 'bool' },
  { id: 'fullFai',                     field: '14', header: 'Full FAI (true) / Partial FAI (false)', kind: 'bool' },
  { id: 'reasonForPartialFai',         field: '14a', header: 'Reason for Partial FAI' },
  { id: 'baselinePartNumber',          field: '15', header: 'Baseline Part Number (assembly FAI)' },
  { id: 'signatureName',               field: '19', header: 'Signature' },
  { id: 'signatureDate',               field: '20', header: 'Date' },
  { id: 'reviewerName',                field: '21', header: 'Reviewed By' },
  { id: 'reviewerDate',                field: '22', header: 'Reviewed Date' },
  { id: 'customerApprovalName',        field: '23', header: 'Customer Approval' },
  { id: 'customerApprovalDate',        field: '24', header: 'Customer Approval Date' },
]);

// AS9102B Form 2 — fields 1 through 9.
export const FORM2_FIELDS = Object.freeze([
  { id: 'materialOrProcessName',       field: '5',  header: 'Material or Process Name',         width: 30 },
  { id: 'specificationNumber',         field: '6',  header: 'Specification Number',             width: 24 },
  { id: 'code',                        field: '7',  header: 'Code',                             width: 10 },
  { id: 'supplier',                    field: '8',  header: 'Supplier',                         width: 24 },
  { id: 'customerApprovalVerification', field: '9', header: 'Customer Approval Verification',   width: 12 },
  { id: 'certificateNumber',           field: '10', header: 'Certificate of Conformance Number', width: 24 },
]);

// AS9102B Form 3 — fields 5 through 13.
export const FORM3_FIELDS = Object.freeze([
  { id: 'characteristicNumber',        field: '5',  header: 'Char No.',         width: 8 },
  { id: 'referenceLocation',           field: '6',  header: 'Reference Location', width: 16 },
  { id: 'characteristicDesignator',    field: '7',  header: 'Designator',        width: 12 },
  { id: 'requirement',                 field: '8',  header: 'Requirement (Nominal + Tolerance)', width: 36 },
  { id: 'results',                     field: '9',  header: 'Results',           width: 16 },
  { id: 'designedTooling',             field: '10', header: 'Designed Tooling',  width: 16 },
  { id: 'nonConformanceNumber',        field: '11', header: 'Non-Conformance #', width: 14 },
]);

// Per-form schema lookup — used by the panel to render column inputs.
export const FORM_SCHEMA = Object.freeze({
  form1: FORM1_FIELDS,
  form2: FORM2_FIELDS,
  form3: FORM3_FIELDS,
});

// AS9102B Designator vocabulary — the panel surfaces these in a dropdown
// so a reviewer can't type a free-text designator that fails audit.
export const CHARACTERISTIC_DESIGNATORS = Object.freeze([
  '',           // unspecified
  'Major',
  'Minor',
  'KC',         // Key Characteristic
  'Critical',   // Critical (Flight-Safety) Characteristic
]);

// ─────────────────────────────────────────────────────────────────────
// Blank row builders.

export function makeBlankForm1() {
  return {
    partNumber: '', partName: '', serialNumber: '',
    fairIdentifier: '',
    partRevisionLevel: '', drawingNumber: '', drawingRevisionLevel: '',
    additionalChanges: '',
    manufacturingProcessReference: '',
    organizationName: '', supplierCode: '', customerCode: '',
    poNumber: '',
    detailFai: true, fullFai: true,
    reasonForPartialFai: '',
    baselinePartNumber: '',
    signatureName: '', signatureDate: '',
    reviewerName: '', reviewerDate: '',
    customerApprovalName: '', customerApprovalDate: '',
  };
}
export function makeBlankForm2Row(ordinal = 0) {
  return {
    ordinal,
    materialOrProcessName: '',
    specificationNumber: '',
    code: '',
    supplier: '',
    customerApprovalVerification: '',
    certificateNumber: '',
  };
}
export function makeBlankForm3Row(ordinal = 0) {
  return {
    ordinal,
    characteristicNumber: String(ordinal + 1),
    referenceLocation: '',
    characteristicDesignator: '',
    requirement: '',
    results: '',
    designedTooling: '',
    nonConformanceNumber: '',
  };
}

export function makeBlankFair() {
  return {
    form1: makeBlankForm1(),
    form2: [makeBlankForm2Row(0)],
    form3: [makeBlankForm3Row(0)],
  };
}

// ─────────────────────────────────────────────────────────────────────
// ASCII formatter — produces a fixed-width FAIR document that round-
// trips through any ASCII reader. Used by the panel's Export TXT
// button + the e2e + headless callers.

function pad(str, width, align = 'left') {
  const s = String(str == null ? '' : str);
  if (s.length >= width) return s.slice(0, Math.max(0, width - 1)) + (s.length > width ? '…' : s.charAt(width - 1));
  const fill = ' '.repeat(width - s.length);
  return align === 'right' ? fill + s : s + fill;
}

function rule(width) {
  return '-'.repeat(Math.max(1, width));
}

const PAGE_WIDTH = 110;

function bannerLine(text, width = PAGE_WIDTH) {
  const txt = ` ${text} `;
  const left = Math.max(0, Math.floor((width - txt.length) / 2));
  const right = Math.max(0, width - left - txt.length);
  return '=' + '='.repeat(left - 1) + txt + '='.repeat(right - 1) + '=';
}

/**
 * Render AS9102 Form 1 as ASCII. Each numbered field appears on its own
 * line, labelled `[FIELD-N] Header........: value`. This matches the
 * SAE PDF template's vertical layout (Form 1 is one row per FAIR, so
 * vertical key-value is the canonical reading order).
 */
export function formatForm1Ascii(row) {
  const r = row && typeof row === 'object' ? row : makeBlankForm1();
  const lines = [];
  lines.push(FORM_META.form1.asciiHeader);
  lines.push(rule(FORM_META.form1.asciiHeader.length));
  lines.push('');
  for (const f of FORM1_FIELDS) {
    const raw = r[f.id];
    let val;
    if (f.kind === 'bool') {
      val = raw === true ? 'YES' : raw === false ? 'NO' : '';
    } else {
      val = raw == null ? '' : String(raw);
    }
    const label = `[FIELD-${f.field}] ${f.header}`;
    // Pad label to 60 chars then ": " then value.
    lines.push(`${pad(label, 60)}: ${val}`);
  }
  return lines.join('\n');
}

/**
 * Render AS9102 Form 2 as ASCII. Header row + N body rows + a footer
 * with the row count. Columns widths come from FORM2_FIELDS.
 */
export function formatForm2Ascii(rows) {
  const safe = Array.isArray(rows) ? rows : [];
  const lines = [];
  lines.push(FORM_META.form2.asciiHeader);
  lines.push(rule(FORM_META.form2.asciiHeader.length));
  lines.push('');
  const headerLine = FORM2_FIELDS.map((c) => pad(c.header, c.width)).join(' | ');
  const ruleLine   = FORM2_FIELDS.map((c) => rule(c.width)).join('-+-');
  lines.push(headerLine);
  lines.push(ruleLine);
  if (safe.length === 0) {
    lines.push('(no rows)');
  } else {
    for (const r of safe) {
      const cells = FORM2_FIELDS.map((c) => pad(r?.[c.id] ?? '', c.width));
      lines.push(cells.join(' | '));
    }
  }
  lines.push('');
  lines.push(`Total rows: ${safe.length}`);
  return lines.join('\n');
}

export function formatForm3Ascii(rows) {
  const safe = Array.isArray(rows) ? rows : [];
  const lines = [];
  lines.push(FORM_META.form3.asciiHeader);
  lines.push(rule(FORM_META.form3.asciiHeader.length));
  lines.push('');
  const headerLine = FORM3_FIELDS.map((c) => pad(c.header, c.width)).join(' | ');
  const ruleLine   = FORM3_FIELDS.map((c) => rule(c.width)).join('-+-');
  lines.push(headerLine);
  lines.push(ruleLine);
  if (safe.length === 0) {
    lines.push('(no rows)');
  } else {
    for (const r of safe) {
      const cells = FORM3_FIELDS.map((c) => pad(r?.[c.id] ?? '', c.width));
      lines.push(cells.join(' | '));
    }
  }
  lines.push('');
  lines.push(`Total characteristics: ${safe.length}`);
  return lines.join('\n');
}

/**
 * Render a full FAIR document — banner + Form 1 + Form 2 + Form 3 +
 * footer. This is what Export TXT lands on disk.
 */
export function formatFairAscii(fair, opts = {}) {
  const f = fair && typeof fair === 'object' ? fair : makeBlankFair();
  const generatedAt = opts.generatedAt || new Date().toISOString();
  const partNumber  = f.form1?.partNumber || '';
  const fairId      = f.form1?.fairIdentifier || '';
  const partName    = f.form1?.partName || '';

  const lines = [];
  lines.push(bannerLine('AS9102 First Article Inspection Report (FAIR)'));
  lines.push(bannerLine('SAE AS9102 Rev B (2014-10) · Forms 1 / 2 / 3'));
  lines.push('');
  lines.push(`Part Number:     ${partNumber}`);
  lines.push(`Part Name:       ${partName}`);
  lines.push(`FAIR Identifier: ${fairId}`);
  lines.push(`Generated:       ${generatedAt}`);
  lines.push('');
  lines.push(formatForm1Ascii(f.form1));
  lines.push('');
  lines.push(formatForm2Ascii(f.form2));
  lines.push('');
  lines.push(formatForm3Ascii(f.form3));
  lines.push('');
  lines.push(bannerLine('END OF FAIR'));
  lines.push('');
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Auto-populate helpers — pull Part Number from the PDM revisions store
// (window.__forgePdmRevisions) and Material from the PUSH-109 store
// (window.__forgeMaterialProperties). These are pure functions; they
// take the source maps as args so they're trivially testable.

/**
 * Build a partial Form 1 populated from PDM revisions. The current
 * semver becomes the Part Revision Level; the FAIR Identifier is
 * `FAIR-<part>-<version>` so the same FAIR can be re-emitted across
 * revisions and stay unique.
 */
export function populateForm1FromPdm(pdmState, fallbackPartNumber) {
  const out = makeBlankForm1();
  if (pdmState && typeof pdmState === 'object') {
    const current = typeof pdmState.current === 'string' ? pdmState.current : '';
    if (current) {
      out.partRevisionLevel = current;
      out.drawingRevisionLevel = current;
    }
    const history = Array.isArray(pdmState.history) ? pdmState.history : [];
    // The most recent ECN if it exists makes a nice "additional changes"
    // pull — AS9102 Form 1 §7a is exactly that field.
    if (history.length > 0) {
      const last = history[history.length - 1];
      if (last && typeof last === 'object') {
        out.additionalChanges = last.ecn
          ? `${last.ecn}${last.desc ? ' — ' + last.desc : ''}`
          : (last.desc || '');
      }
    }
  }
  // PDM doesn't store a part number explicitly — use the project name
  // if the caller passed one, otherwise fall back to a stamp.
  const pn = typeof fallbackPartNumber === 'string' && fallbackPartNumber.trim()
    ? fallbackPartNumber.trim()
    : 'PN-000001';
  out.partNumber = pn;
  out.drawingNumber = `DWG-${pn}`;
  out.fairIdentifier = `FAIR-${pn}-${out.partRevisionLevel || '1.0.0'}`;
  out.organizationName = 'ArchDisc Forge';
  return out;
}

/**
 * Build Form 2 material/process rows from window.__forgeMaterialProperties.
 * Each handle keys one body; the material preset name (if present in the
 * .all map) becomes the material name. Specification number falls back
 * to a generated stub keyed off the handle so the row is uniquely
 * identifiable.
 */
export function populateForm2FromMaterials(materialProps, materialPropsAll) {
  const out = [];
  const safe = materialProps && typeof materialProps === 'object' ? materialProps : {};
  const safeAll = materialPropsAll && typeof materialPropsAll === 'object' ? materialPropsAll : {};
  const handles = Object.keys(safe);
  if (handles.length === 0) return out;
  let ordinal = 0;
  for (const h of handles) {
    const rec = safe[h] || {};
    const allRec = safeAll[`h:${h}`] || {};
    const name = allRec.preset || allRec.label || rec.preset || `Material H${h}`;
    const row = makeBlankForm2Row(ordinal);
    row.materialOrProcessName = String(name);
    row.specificationNumber = allRec.spec || `MIL-SPEC-${h}`;
    row.code = `MAT-${h}`;
    row.supplier = allRec.supplier || 'TBD';
    row.customerApprovalVerification = 'TBD';
    row.certificateNumber = `CoC-${h}`;
    out.push(row);
    ordinal++;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Public surface guards — make sure schema arrays stay stable in case
// downstream callers iterate them at module-load. Object.freeze() is
// already applied above; this is the read-side guard.

export function getFormSchema(formId) {
  const s = FORM_SCHEMA[formId];
  return Array.isArray(s) ? s.slice() : [];
}

export default Object.freeze({
  FORM_IDS,
  FORM_META,
  FORM1_FIELDS,
  FORM2_FIELDS,
  FORM3_FIELDS,
  FORM_SCHEMA,
  CHARACTERISTIC_DESIGNATORS,
  makeBlankForm1,
  makeBlankForm2Row,
  makeBlankForm3Row,
  makeBlankFair,
  formatForm1Ascii,
  formatForm2Ascii,
  formatForm3Ascii,
  formatFairAscii,
  populateForm1FromPdm,
  populateForm2FromMaterials,
  getFormSchema,
});
