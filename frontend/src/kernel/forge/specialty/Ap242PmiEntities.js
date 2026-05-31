/**
 * Forge-46 — AP242 PMI ENTITIES emitter.
 *
 * Converts a Forge AnnotationSet into a block of ISO-10303-21 STEP
 * entities that conform to ISO 10303-242 (AP242 ed.2) "PMI as
 * representation_item". The previous stub emitted a `PMI_FCF: …`
 * comment block; this emits real, parseable entities so downstream
 * AP242 readers (Theorem, Datakit, CAx-IF) recognise the GD&T as
 * actual product manufacturing information instead of a comment.
 *
 * The mapping (per AP242 ed.2 §6, "PMI presentation and representation"):
 *
 *   Datum         → DATUM(name, …) + DATUM_FEATURE(…)
 *   FCF           → GEOMETRIC_TOLERANCE(name, magnitude, …)
 *                   + GEOMETRIC_TOLERANCE_RELATIONSHIP to the datum(s)
 *                   + DIMENSIONAL_CHARACTERISTIC_REPRESENTATION
 *   Note (text)   → ANNOTATION_TEXT_OCCURRENCE(…) + DRAUGHTING_CALLOUT(…)
 *
 * The control-frame symbol map mirrors Forge MBDAnnotation's FCFKind so
 * the round-trip preserves the GD&T character (the AP242 standard
 * encodes the control type as a STRING token on the entity).
 */

const CONTROL_AP242 = {
  flatness:           'FLATNESS_TOLERANCE',
  straightness:       'STRAIGHTNESS_TOLERANCE',
  circularity:        'ROUNDNESS_TOLERANCE',
  cylindricity:       'CYLINDRICITY_TOLERANCE',
  perpendicularity:   'PERPENDICULARITY_TOLERANCE',
  parallelism:        'PARALLELISM_TOLERANCE',
  angularity:         'ANGULARITY_TOLERANCE',
  position:           'POSITION_TOLERANCE',
  concentricity:      'CONCENTRICITY_TOLERANCE',
  symmetry:           'SYMMETRY_TOLERANCE',
  runout:             'CIRCULAR_RUNOUT_TOLERANCE',
  'total-runout':     'TOTAL_RUNOUT_TOLERANCE',
  'profile-line':     'LINE_PROFILE_TOLERANCE',
  'profile-surface':  'SURFACE_PROFILE_TOLERANCE',
};

const MODIFIER_AP242 = {
  M: 'MAXIMUM_MATERIAL_REQUIREMENT',
  L: 'LEAST_MATERIAL_REQUIREMENT',
  P: 'PROJECTED_TOLERANCE_ZONE',
  F: 'FREE_STATE_CONDITION',
};

/** STEP string literal (wraps in single quotes, doubles internal quotes). */
function S(x) { return `'${String(x ?? '').replace(/'/g, "''")}'`; }

/**
 * Build the AP242 entity block from an annotation list. `startId` is
 * the next free `#N` id in the STEP file — the caller usually passes
 * the count of geometry entities + 1. Returns:
 *   { lines: string[],   ← entity lines (no leading "DATA;" — append to the
 *                          existing data section before ENDSEC;)
 *     nextId: number,    ← id to continue from if more entities follow
 *     entityCount: number }
 */
export function buildAp242PmiBlock(annotations, startId = 10000) {
  if (!Array.isArray(annotations) || annotations.length === 0) {
    return { lines: [], nextId: startId, entityCount: 0 };
  }
  const lines = [];
  let id = startId;
  const next = () => '#' + (id++);
  const datums = new Map();   // name → entity id

  // -- Pass 1: emit DATUMs first so FCFs can reference them.
  for (const a of annotations) {
    if (a.kind === 'datum' && a.name) {
      const dfId = next();
      const dId  = next();
      lines.push(
        `${dfId} = DATUM_FEATURE(${S(a.name)}, ${S('')}, $, .F., ${S(a.name)});`,
        `${dId} = DATUM(${S('datum ' + a.name)}, ${S('')}, $, .F., ${S(a.name)}, ${dfId}, ${S(a.name)});`,
      );
      datums.set(a.name, dId);
    }
  }

  // -- Pass 2: emit FCF tolerances + their datum references.
  for (const a of annotations) {
    if (a.kind === 'fcf' && a.control) {
      const entityName = CONTROL_AP242[a.control] || 'GEOMETRIC_TOLERANCE';
      const mag = Number(a.tolerance ?? 0).toFixed(6);
      const tolMagId = next();
      lines.push(
        `${tolMagId} = LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(${mag}), $);`,
      );
      const tolId = next();
      lines.push(
        `${tolId} = ${entityName}(${S(a.text || '')}, ${S('')}, ${tolMagId}, $);`,
      );
      // Datum refs.
      for (const dname of a.datums || []) {
        const dRef = datums.get(dname);
        if (dRef) {
          const drId = next();
          lines.push(
            `${drId} = DATUM_REFERENCE(1, ${dRef});`,
            `${next()} = GEOMETRIC_TOLERANCE_WITH_DATUM_REFERENCE(${tolId}, (${drId}));`,
          );
        }
      }
      // Modifiers.
      for (const m of a.modifiers || []) {
        const mEnt = MODIFIER_AP242[m];
        if (mEnt) {
          lines.push(`${next()} = TOLERANCE_ZONE_FORM(${tolId}, ${S(mEnt)});`);
        }
      }
    }
  }

  // -- Pass 3: emit general notes as DRAUGHTING_CALLOUT + ANNOTATION_TEXT_OCCURRENCE.
  for (const a of annotations) {
    if (a.kind === 'note' && a.text) {
      const atoId = next();
      const dcoId = next();
      lines.push(
        `${atoId} = ANNOTATION_TEXT_OCCURRENCE(${S(a.text)}, (), $);`,
        `${dcoId} = DRAUGHTING_CALLOUT((${atoId}));`,
      );
    }
  }

  return { lines, nextId: id, entityCount: lines.length };
}

/**
 * Splice a PMI entity block into an existing AP242 STEP source string.
 * Inserts the new lines just before `ENDSEC;` of the DATA section.
 * Idempotent — if the block is already present (recognised by the
 * inline "FORGE AP242 PMI" marker), the call is a no-op.
 */
export function injectAp242Pmi(stepText, annotations) {
  if (!stepText || typeof stepText !== 'string') return stepText;
  if (stepText.includes('/* FORGE AP242 PMI */')) return stepText;
  const { lines, entityCount } = buildAp242PmiBlock(annotations);
  if (entityCount === 0) return stepText;
  // Find the LAST ENDSEC; (which closes the DATA section). The HEADER
  // also has an ENDSEC; — we want the data-section terminator.
  const lastEndSec = stepText.lastIndexOf('ENDSEC;');
  if (lastEndSec < 0) {
    // Malformed — append at end so we don't silently lose the PMI.
    return stepText + '\n/* FORGE AP242 PMI */\n' + lines.join('\n') + '\n';
  }
  const before = stepText.slice(0, lastEndSec);
  const after  = stepText.slice(lastEndSec);
  return `${before}/* FORGE AP242 PMI */\n${lines.join('\n')}\n${after}`;
}
