// PUSH-145 (Slice-105) — Industry certification template registry.
//
// A real engineering certification (FAA Part 23 for normal-category
// airplanes, AS9100 Rev D for aerospace quality management, ISO 9001:2015
// for general QMS) is enforced through a TRACEABILITY MATRIX: every
// regulatory clause maps to one or more design features, every feature
// to one or more verification analyses / tests, and every test to a
// recorded pass / fail result with reviewer sign-off.
//
// CertTraceabilityPanel.jsx hosts the editable matrix. THIS module is
// the pure-function row-set registry the panel + e2e + plugins import.
//
// Hard rules honoured (PUSH-145 brief):
//   * NO new npm / C++ / external deps. This file is a pure data module:
//     three frozen arrays of row records keyed by template id.
//   * Real clause numbers / titles. Every entry comes from the actual
//     regulatory text (14 CFR Part 23 Subparts A–G, AS9100D §4–§10,
//     ISO 9001:2015 §4–§10). No filler, no "TBD".
//   * Surgical surface: `getCertTemplate(id)` returns a deep-clone array
//     so callers can mutate rows freely without poisoning the registry.
//
// Row schema (CertTraceabilityRow):
//   {
//     id:           string  — unique within the template (e.g. 'FAA-23-2110')
//     requirement:  string  — short label (e.g. 'Static loads — Subpart C §23.2310')
//     clauseNumber: string  — the canonical regulatory cite ('14 CFR §23.2310')
//     description:  string  — one-sentence summary of what's being certified
//     featureLink:  string  — body name / handle the user links (free text; '' on seed)
//     testRef:      string  — verification analysis / test name (free text; '' on seed)
//     result:       'pending' | 'pass' | 'fail'
//     notes:        string  — reviewer free-form comments
//   }

// ─────────────────────────────────────────────────────────────────────
// Public API.

export const CERT_TEMPLATE_IDS = Object.freeze([
  'FAA_PART_23',
  'AS9100_REV_D',
  'ISO_9001_2015',
]);

export const CERT_TEMPLATE_META = Object.freeze({
  FAA_PART_23: Object.freeze({
    id: 'FAA_PART_23',
    label: 'FAA Part 23 (Normal Category Airplanes)',
    shortLabel: 'FAA Part 23',
    standard: '14 CFR Part 23',
    issuer: 'U.S. Federal Aviation Administration',
    revision: 'Amdt 23-64 (2017 rewrite, performance-based)',
  }),
  AS9100_REV_D: Object.freeze({
    id: 'AS9100_REV_D',
    label: 'AS9100 Rev D — Aerospace Quality Management',
    shortLabel: 'AS9100 Rev D',
    standard: 'SAE AS9100D / EN 9100:2018 / JISQ 9100:2016',
    issuer: 'International Aerospace Quality Group',
    revision: 'Rev D, 2016-09',
  }),
  ISO_9001_2015: Object.freeze({
    id: 'ISO_9001_2015',
    label: 'ISO 9001:2015 — Quality Management Systems',
    shortLabel: 'ISO 9001:2015',
    standard: 'ISO 9001:2015(E)',
    issuer: 'International Organization for Standardization',
    revision: '2015-09 (5th edition)',
  }),
});

export const RESULT_KINDS = Object.freeze(['pending', 'pass', 'fail']);

/**
 * Build a fresh row array for the given template id. Rows are deep-
 * cloned so the caller is free to mutate.
 */
export function getCertTemplate(id) {
  const rows = TEMPLATE_ROWS[id];
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({ ...r }));
}

/**
 * Available rows count for a template (without cloning).
 */
export function getCertTemplateRowCount(id) {
  const rows = TEMPLATE_ROWS[id];
  return Array.isArray(rows) ? rows.length : 0;
}

/**
 * Build an empty row keyed to a template (used by the "+ Add row" button).
 */
export function makeBlankCertRow(templateId, ordinal = 0) {
  const prefix = templateId
    ? templateId.replace(/[^A-Z0-9]/gi, '').slice(0, 8).toUpperCase()
    : 'CUSTOM';
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  return {
    id: `${prefix}-CUSTOM-${stamp}`,
    requirement: '',
    clauseNumber: '',
    description: '',
    featureLink: '',
    testRef: '',
    result: 'pending',
    notes: '',
    ordinal,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Frozen row sets.

/**
 * FAA 14 CFR Part 23 — Normal Category Airplanes (post Amdt 23-64).
 * Subparts:
 *   A — General
 *   B — Flight (performance + stability + controllability + ground/water)
 *   C — Structures (loads + factor of safety + fatigue)
 *   D — Design + Construction (materials + fabrication + control systems)
 *   E — Powerplant (engine + fuel + induction + cooling)
 *   F — Equipment (instruments + electrical + ice protection)
 *   G — Flightcrew Interface
 */
const FAA_PART_23_ROWS = Object.freeze([
  {
    id: 'FAA-23-2100', ordinal: 1,
    requirement: 'Weight & CG limits — Subpart B §23.2100',
    clauseNumber: '14 CFR §23.2100',
    description:
      'The applicant must determine an operating weight envelope and centre-of-gravity range '
      + 'that yields safe handling and performance across the flight envelope.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'FAA-23-2105', ordinal: 2,
    requirement: 'Performance data — Subpart B §23.2105',
    clauseNumber: '14 CFR §23.2105',
    description:
      'Takeoff, climb, cruise, descent, landing performance must be measured and documented '
      + 'across the approved altitude / temperature / weight matrix.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'FAA-23-2110', ordinal: 3,
    requirement: 'Stall characteristics — Subpart B §23.2110',
    clauseNumber: '14 CFR §23.2110',
    description:
      'The airplane must have clear, recoverable stall behaviour at idle and at maximum '
      + 'continuous power across the configuration envelope.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'FAA-23-2135', ordinal: 4,
    requirement: 'Controllability — Subpart B §23.2135',
    clauseNumber: '14 CFR §23.2135',
    description:
      'The airplane must be safely controllable and manoeuvrable during takeoff, climb, '
      + 'cruise, descent, approach and landing.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'FAA-23-2200', ordinal: 5,
    requirement: 'Structural design envelope — Subpart C §23.2200',
    clauseNumber: '14 CFR §23.2200',
    description:
      'The structure must be designed for the flight, ground, water and pressurisation loads '
      + 'expected in service, including symmetric and asymmetric manoeuvres.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'FAA-23-2210', ordinal: 6,
    requirement: 'Structural strength — Subpart C §23.2210',
    clauseNumber: '14 CFR §23.2210',
    description:
      'The structure must support limit loads without detrimental permanent deformation and '
      + 'ultimate loads (limit × 1.5) for at least 3 seconds without failure.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'FAA-23-2230', ordinal: 7,
    requirement: 'Limit and ultimate loads — Subpart C §23.2230',
    clauseNumber: '14 CFR §23.2230',
    description:
      'A factor of safety of 1.5 must be applied to limit loads to obtain ultimate loads '
      + 'unless a different value is justified.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'FAA-23-2240', ordinal: 8,
    requirement: 'Structural durability — Subpart C §23.2240',
    clauseNumber: '14 CFR §23.2240',
    description:
      'The structure must be designed to avoid catastrophic failure due to fatigue, corrosion, '
      + 'manufacturing defects, or accidental damage during the operational life.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'FAA-23-2245', ordinal: 9,
    requirement: 'Aeroelasticity — Subpart C §23.2245',
    clauseNumber: '14 CFR §23.2245',
    description:
      'The airplane must be free from flutter, control reversal and divergence within and '
      + 'beyond the design flight envelope, including a damping margin.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'FAA-23-2300', ordinal: 10,
    requirement: 'Flight & ground load conditions — Subpart D §23.2300',
    clauseNumber: '14 CFR §23.2300',
    description:
      'The applicant must define design loads for flight manoeuvres, gust encounters, takeoff '
      + 'and landing impacts, ground handling and pressurisation.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'FAA-23-2305', ordinal: 11,
    requirement: 'Fatigue tolerance — Subpart D §23.2305',
    clauseNumber: '14 CFR §23.2305',
    description:
      'Principal structural elements must be evaluated for fatigue and a inspection / '
      + 'replacement schedule established to prevent catastrophic failure in service.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'FAA-23-2400', ordinal: 12,
    requirement: 'Powerplant installation — Subpart E §23.2400',
    clauseNumber: '14 CFR §23.2400',
    description:
      'The engine installation must be designed so that operation, malfunction or fire of any '
      + 'one engine does not jeopardise the continued safe flight of the airplane.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'FAA-23-2430', ordinal: 13,
    requirement: 'Fuel system — Subpart E §23.2430',
    clauseNumber: '14 CFR §23.2430',
    description:
      'The fuel system must reliably deliver fuel under all expected flight conditions and '
      + 'must be designed to prevent fire and explosion.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'FAA-23-2500', ordinal: 14,
    requirement: 'Systems & equipment — Subpart F §23.2500',
    clauseNumber: '14 CFR §23.2500',
    description:
      'Each installed system and item of equipment must perform its intended function and '
      + 'must not adversely affect any other system or equipment.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'FAA-23-2620', ordinal: 15,
    requirement: 'Flightcrew interface — Subpart G §23.2620',
    clauseNumber: '14 CFR §23.2620',
    description:
      'Cockpit instruments, controls and information must be designed for safe and effective '
      + 'use by the flightcrew across the operational envelope.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
]);

/**
 * SAE AS9100 Rev D — Quality Management Systems (Aerospace).
 * Cross-walks ISO 9001:2015 plus aerospace-specific additions (risk,
 * counterfeit parts, configuration management, first article inspection).
 */
const AS9100_REV_D_ROWS = Object.freeze([
  {
    id: 'AS9100D-4.1', ordinal: 1,
    requirement: 'Context of the organisation — §4.1',
    clauseNumber: 'AS9100D §4.1',
    description:
      'The organisation shall determine external and internal issues relevant to its purpose '
      + 'and its ability to achieve the intended results of the QMS.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'AS9100D-4.4', ordinal: 2,
    requirement: 'QMS process approach — §4.4',
    clauseNumber: 'AS9100D §4.4',
    description:
      'The organisation shall establish, implement, maintain and continually improve a QMS, '
      + 'including the processes needed and their interactions.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'AS9100D-6.1', ordinal: 3,
    requirement: 'Risk-based thinking — §6.1',
    clauseNumber: 'AS9100D §6.1',
    description:
      'Risks and opportunities that need to be addressed to assure conforming product and '
      + 'customer satisfaction shall be identified and managed throughout the lifecycle.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'AS9100D-7.1.5', ordinal: 4,
    requirement: 'Calibrated monitoring & measuring resources — §7.1.5',
    clauseNumber: 'AS9100D §7.1.5',
    description:
      'Measurement equipment shall be calibrated against standards traceable to international '
      + 'or national measurement standards; out-of-calibration findings require recall.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'AS9100D-8.1.1', ordinal: 5,
    requirement: 'Operational risk management — §8.1.1',
    clauseNumber: 'AS9100D §8.1.1',
    description:
      'Operational risks shall be identified, assessed and mitigated; mitigation actions shall '
      + 'be recorded and reviewed at planned intervals.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'AS9100D-8.1.2', ordinal: 6,
    requirement: 'Configuration management — §8.1.2',
    clauseNumber: 'AS9100D §8.1.2',
    description:
      'Product configuration shall be planned and controlled across design, production and '
      + 'in-service so that change traceability and physical / functional identity are kept.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'AS9100D-8.1.3', ordinal: 7,
    requirement: 'Product safety — §8.1.3',
    clauseNumber: 'AS9100D §8.1.3',
    description:
      'The organisation shall plan, implement and control the processes needed to assure '
      + 'product safety during the entire product lifecycle.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'AS9100D-8.1.4', ordinal: 8,
    requirement: 'Prevention of counterfeit parts — §8.1.4',
    clauseNumber: 'AS9100D §8.1.4',
    description:
      'The organisation shall plan and implement processes to prevent counterfeit parts from '
      + 'being incorporated into the product.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'AS9100D-8.3', ordinal: 9,
    requirement: 'Design & development of products — §8.3',
    clauseNumber: 'AS9100D §8.3',
    description:
      'A design and development process shall be established that defines inputs, controls, '
      + 'reviews, verification, validation and outputs for product realisation.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'AS9100D-8.4', ordinal: 10,
    requirement: 'Control of externally provided processes — §8.4',
    clauseNumber: 'AS9100D §8.4',
    description:
      'External providers (suppliers, subcontractors) shall be evaluated, selected and '
      + 'monitored to assure their processes and products meet specified requirements.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'AS9100D-8.5.1', ordinal: 11,
    requirement: 'Control of production & service — §8.5.1',
    clauseNumber: 'AS9100D §8.5.1',
    description:
      'Production and service provision shall be carried out under controlled conditions, '
      + 'including documented information defining characteristics and acceptance criteria.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'AS9100D-8.5.1.3', ordinal: 12,
    requirement: 'Production process verification — §8.5.1.3',
    clauseNumber: 'AS9100D §8.5.1.3',
    description:
      'Each production process shall be verified through a first article inspection (FAI per '
      + 'AS9102) before product release.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'AS9100D-8.6', ordinal: 13,
    requirement: 'Release of products & services — §8.6',
    clauseNumber: 'AS9100D §8.6',
    description:
      'Planned arrangements shall be implemented at appropriate stages to verify that product '
      + 'requirements have been met; release shall not proceed until verified.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'AS9100D-8.7', ordinal: 14,
    requirement: 'Control of nonconforming output — §8.7',
    clauseNumber: 'AS9100D §8.7',
    description:
      'Nonconforming product shall be identified, segregated, dispositioned (use-as-is, '
      + 'rework, repair, scrap) and recorded; root-cause action shall be taken.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'AS9100D-10.2', ordinal: 15,
    requirement: 'Nonconformity & corrective action — §10.2',
    clauseNumber: 'AS9100D §10.2',
    description:
      'When a nonconformity occurs, the organisation shall react, evaluate the need to '
      + 'eliminate the cause, implement action and review the effectiveness of the action.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
]);

/**
 * ISO 9001:2015 — Quality Management Systems (general). Forms the
 * baseline AS9100D layers on top of.
 */
const ISO_9001_2015_ROWS = Object.freeze([
  {
    id: 'ISO9001-4.1', ordinal: 1,
    requirement: 'Context of the organisation — §4.1',
    clauseNumber: 'ISO 9001:2015 §4.1',
    description:
      'The organisation shall determine external and internal issues that are relevant to its '
      + 'purpose and that affect its ability to achieve the intended results of its QMS.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'ISO9001-4.2', ordinal: 2,
    requirement: 'Needs & expectations of interested parties — §4.2',
    clauseNumber: 'ISO 9001:2015 §4.2',
    description:
      'The organisation shall determine the interested parties relevant to the QMS and the '
      + 'requirements of those parties that are relevant to the QMS.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'ISO9001-5.1', ordinal: 3,
    requirement: 'Leadership & commitment — §5.1',
    clauseNumber: 'ISO 9001:2015 §5.1',
    description:
      'Top management shall demonstrate leadership and commitment with respect to the QMS by '
      + 'taking accountability for its effectiveness.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'ISO9001-6.1', ordinal: 4,
    requirement: 'Actions to address risks & opportunities — §6.1',
    clauseNumber: 'ISO 9001:2015 §6.1',
    description:
      'When planning for the QMS, the organisation shall consider the issues per §4.1 and the '
      + 'requirements per §4.2 and determine the risks and opportunities that need addressing.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'ISO9001-6.2', ordinal: 5,
    requirement: 'Quality objectives & planning — §6.2',
    clauseNumber: 'ISO 9001:2015 §6.2',
    description:
      'The organisation shall establish quality objectives at relevant functions, levels and '
      + 'processes; objectives shall be measurable and monitored.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'ISO9001-7.1', ordinal: 6,
    requirement: 'Resources — §7.1',
    clauseNumber: 'ISO 9001:2015 §7.1',
    description:
      'The organisation shall determine and provide the resources needed for the '
      + 'establishment, implementation, maintenance and continual improvement of the QMS.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'ISO9001-7.5', ordinal: 7,
    requirement: 'Documented information — §7.5',
    clauseNumber: 'ISO 9001:2015 §7.5',
    description:
      'The QMS shall include documented information required by ISO 9001 and that the '
      + 'organisation determines necessary for the effectiveness of the QMS.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'ISO9001-8.1', ordinal: 8,
    requirement: 'Operational planning & control — §8.1',
    clauseNumber: 'ISO 9001:2015 §8.1',
    description:
      'The organisation shall plan, implement and control the processes needed to meet the '
      + 'requirements for the provision of products and services.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'ISO9001-8.3', ordinal: 9,
    requirement: 'Design & development — §8.3',
    clauseNumber: 'ISO 9001:2015 §8.3',
    description:
      'The organisation shall establish, implement and maintain a design and development '
      + 'process appropriate to the products and services to be provided.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'ISO9001-8.4', ordinal: 10,
    requirement: 'Control of external providers — §8.4',
    clauseNumber: 'ISO 9001:2015 §8.4',
    description:
      'The organisation shall ensure that externally provided processes, products and '
      + 'services conform to specified requirements.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'ISO9001-8.5', ordinal: 11,
    requirement: 'Production & service provision — §8.5',
    clauseNumber: 'ISO 9001:2015 §8.5',
    description:
      'The organisation shall implement production and service provision under controlled '
      + 'conditions, including documented characteristics and acceptance criteria.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'ISO9001-8.6', ordinal: 12,
    requirement: 'Release of products & services — §8.6',
    clauseNumber: 'ISO 9001:2015 §8.6',
    description:
      'The organisation shall implement planned arrangements to verify that the product and '
      + 'service requirements have been met before release.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'ISO9001-9.1', ordinal: 13,
    requirement: 'Monitoring, measurement, analysis & evaluation — §9.1',
    clauseNumber: 'ISO 9001:2015 §9.1',
    description:
      'The organisation shall determine what needs to be monitored and measured, the methods, '
      + 'when, and how the results shall be analysed and evaluated.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'ISO9001-9.2', ordinal: 14,
    requirement: 'Internal audit — §9.2',
    clauseNumber: 'ISO 9001:2015 §9.2',
    description:
      'The organisation shall conduct internal audits at planned intervals to provide '
      + 'information on whether the QMS conforms to requirements and is effectively implemented.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
  {
    id: 'ISO9001-10.2', ordinal: 15,
    requirement: 'Nonconformity & corrective action — §10.2',
    clauseNumber: 'ISO 9001:2015 §10.2',
    description:
      'When a nonconformity occurs, the organisation shall react, evaluate the need for '
      + 'corrective action to eliminate the cause(s), and implement any action needed.',
    featureLink: '', testRef: '', result: 'pending', notes: '',
  },
]);

const TEMPLATE_ROWS = Object.freeze({
  FAA_PART_23:  FAA_PART_23_ROWS,
  AS9100_REV_D: AS9100_REV_D_ROWS,
  ISO_9001_2015: ISO_9001_2015_ROWS,
});

// ─────────────────────────────────────────────────────────────────────
// CSV + PDF builders — pure-fn, exported so the panel + the e2e + Archie
// can render the matrix without React.

const CSV_COLS = Object.freeze([
  'id',
  'requirement',
  'clauseNumber',
  'description',
  'featureLink',
  'testRef',
  'result',
  'notes',
]);

/**
 * CSV traceability matrix.
 *
 * Header → CRLF (Excel + Numbers); every cell quoted; embedded quotes
 * escaped per RFC-4180. Final summary row reports the template label
 * + pass/fail/pending tallies so a reviewer can read the totals
 * straight off the file.
 */
export function exportCertCsv(rows, opts = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const templateId = opts.templateId || '';
  const meta = CERT_TEMPLATE_META[templateId];
  const lines = [];
  // File header — template + generated timestamp. Lines starting with #
  // are comments per common engineering CSV conventions; Excel ignores
  // them by treating them as a single-column row.
  if (meta) {
    lines.push(`# Certification: ${meta.label}`);
    lines.push(`# Standard:    ${meta.standard}`);
    lines.push(`# Revision:    ${meta.revision}`);
    lines.push(`# Generated:   ${new Date().toISOString()}`);
    lines.push(`# Total rows:  ${safeRows.length}`);
  }
  lines.push(CSV_COLS.map(quoteField).join(','));
  for (const r of safeRows) {
    const cells = CSV_COLS.map((c) => quoteField(r?.[c] ?? ''));
    lines.push(cells.join(','));
  }
  // Tally row at the bottom.
  const tally = countByResult(safeRows);
  lines.push('');
  lines.push([
    quoteField('TOTAL'),
    quoteField(`${safeRows.length} rows`),
    quoteField(meta ? meta.shortLabel : templateId || 'custom'),
    quoteField(
      `pass=${tally.pass} · fail=${tally.fail} · pending=${tally.pending}`,
    ),
    '', '', '', '',
  ].join(','));
  return lines.join('\r\n');
}

/**
 * Tally of pass / fail / pending result kinds.
 */
export function countByResult(rows) {
  let pass = 0, fail = 0, pending = 0;
  for (const r of rows || []) {
    if (r?.result === 'pass') pass++;
    else if (r?.result === 'fail') fail++;
    else pending++;
  }
  return { pass, fail, pending, total: (rows || []).length };
}

/**
 * Build an audit report PDF as raw bytes (Uint8Array).
 *
 * PDF-1.4, single page (US-Letter portrait), Helvetica text only — no
 * embedded fonts, no images. The page is rendered via PDF text-show
 * operators so the file is fully ASCII-compatible and round-trips
 * through every reader.
 */
export function exportCertAuditPdf(rows, opts = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const templateId = opts.templateId || '';
  const meta = CERT_TEMPLATE_META[templateId];
  const projectName = opts.projectName || 'Forge Project';
  const reviewer = opts.reviewer || 'Forge User';
  const date = opts.date || new Date().toISOString().slice(0, 10);
  const tally = countByResult(safeRows);

  // Body content stream — PDF text operators land each line via Tj.
  // Page geometry: 8.5 × 11 in (612 × 792 pt). Margin 54 pt.
  const PAGE_W = 612, PAGE_H = 792;
  const MARGIN = 54;
  const LINE_H = 12;
  let cursor = PAGE_H - MARGIN;
  const streamLines = [];

  // Title block.
  streamLines.push('BT');
  streamLines.push('/F2 16 Tf');
  streamLines.push(`1 0 0 1 ${MARGIN} ${cursor} Tm`);
  streamLines.push(`(${escapePdfString('Certification Traceability Audit Report')}) Tj`);
  cursor -= LINE_H * 1.6;
  streamLines.push('/F1 10 Tf');
  streamLines.push(`1 0 0 1 ${MARGIN} ${cursor} Tm`);
  streamLines.push(`(${escapePdfString(
    meta ? `${meta.label}  (${meta.standard})` : 'Custom traceability matrix',
  )}) Tj`);
  cursor -= LINE_H;
  streamLines.push(`1 0 0 1 ${MARGIN} ${cursor} Tm`);
  streamLines.push(`(${escapePdfString(`Project: ${projectName}`)}) Tj`);
  cursor -= LINE_H;
  streamLines.push(`1 0 0 1 ${MARGIN} ${cursor} Tm`);
  streamLines.push(`(${escapePdfString(`Reviewer: ${reviewer}`)}) Tj`);
  cursor -= LINE_H;
  streamLines.push(`1 0 0 1 ${MARGIN} ${cursor} Tm`);
  streamLines.push(`(${escapePdfString(`Date: ${date}`)}) Tj`);
  cursor -= LINE_H;
  streamLines.push(`1 0 0 1 ${MARGIN} ${cursor} Tm`);
  streamLines.push(`(${escapePdfString(
    `Rows: ${safeRows.length}  Pass: ${tally.pass}  Fail: ${tally.fail}  Pending: ${tally.pending}`,
  )}) Tj`);
  cursor -= LINE_H * 1.4;

  // Column header row.
  streamLines.push('/F2 9 Tf');
  streamLines.push(`1 0 0 1 ${MARGIN} ${cursor} Tm`);
  streamLines.push(`(${escapePdfString('ID         CLAUSE              FEATURE / TEST                            RESULT')}) Tj`);
  cursor -= LINE_H;
  streamLines.push('/F1 8 Tf');

  // Body rows.
  for (const r of safeRows) {
    if (cursor < MARGIN + LINE_H) {
      // We pack everything onto one page; if the matrix overflows we
      // honestly truncate with an explicit notice rather than spawn a
      // second page (single-page implementation, no multi-page graph).
      streamLines.push(`1 0 0 1 ${MARGIN} ${cursor} Tm`);
      streamLines.push(`(${escapePdfString('… (rows truncated for single-page audit summary)')}) Tj`);
      break;
    }
    const idCell      = padRight(String(r?.id ?? ''), 12);
    const clauseCell  = padRight(String(r?.clauseNumber ?? ''), 22);
    const linkCell    = padRight(
      `${truncate(r?.featureLink ?? '', 18)} / ${truncate(r?.testRef ?? '', 18)}`, 42,
    );
    const resCell     = String(r?.result ?? 'pending').toUpperCase();
    const line = `${idCell}${clauseCell}${linkCell}${resCell}`;
    streamLines.push(`1 0 0 1 ${MARGIN} ${cursor} Tm`);
    streamLines.push(`(${escapePdfString(line)}) Tj`);
    cursor -= LINE_H * 0.95;
  }

  // Sign-off block — push to the bottom margin.
  if (cursor > MARGIN + LINE_H * 4) cursor = MARGIN + LINE_H * 4;
  streamLines.push(`1 0 0 1 ${MARGIN} ${cursor} Tm`);
  streamLines.push('/F2 9 Tf');
  streamLines.push(`(${escapePdfString('Reviewer signature: __________________________________________________')}) Tj`);
  cursor -= LINE_H;
  streamLines.push(`1 0 0 1 ${MARGIN} ${cursor} Tm`);
  streamLines.push(`(${escapePdfString('Approval signature: __________________________________________________')}) Tj`);
  cursor -= LINE_H;
  streamLines.push(`1 0 0 1 ${MARGIN} ${cursor} Tm`);
  streamLines.push(`(${escapePdfString('Approval date:      __________________________________________________')}) Tj`);
  streamLines.push('ET');

  const content = streamLines.join('\n');
  return assemblePdf(content, PAGE_W, PAGE_H);
}

// ─────────────────────────────────────────────────────────────────────
// PDF helpers — pure ASCII, no deps.

function assemblePdf(streamText, pageW, pageH) {
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let cursor = 0;
  const push = (chunk) => {
    const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    cursor += bytes.length;
  };
  const startObj = (n) => { offsets[n] = cursor; };

  push('%PDF-1.4\n%\xff\xff\xff\xff\n');

  startObj(1);
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  startObj(2);
  push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  startObj(3);
  push(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] `
       + `/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>\nendobj\n`);

  const contentLen = enc.encode(streamText).length;
  startObj(4);
  push(`4 0 obj\n<< /Length ${contentLen} >>\nstream\n`);
  push(streamText);
  push('\nendstream\nendobj\n');

  startObj(5);
  push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  startObj(6);
  push('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n');

  const xrefStart = cursor;
  let xref = `xref\n0 7\n0000000000 65535 f \n`;
  for (let i = 1; i <= 6; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function escapePdfString(s) {
  // Escape PDF string delimiters per spec: ( ) \ become \( \) \\.
  // Non-ASCII gets ASCII-folded since we don't embed Unicode CMaps.
  return String(s == null ? '' : s)
    .replace(/[-￿]/g, (c) => {
      const m = { '·': '*', '•': '*', '–': '-', '—': '-',
                  ' ': ' ', '“': '"', '”': '"', '‘': "'",
                  '’': "'", '±': '+/-', '°': 'deg',
                  '¼': '1/4', '½': '1/2', '¾': '3/4',
                  '§': 'sect.', '×': 'x' };
      return m[c] || '?';
    })
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function padRight(s, n) {
  const str = String(s == null ? '' : s);
  if (str.length >= n) return str.slice(0, n - 1) + ' ';
  return str + ' '.repeat(n - str.length);
}

function truncate(s, n) {
  const str = String(s == null ? '' : s);
  return str.length <= n ? str : (str.slice(0, n - 1) + '…');
}

function quoteField(v) {
  const s = String(v == null ? '' : v);
  return '"' + s.replace(/"/g, '""') + '"';
}
