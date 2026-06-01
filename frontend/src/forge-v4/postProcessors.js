// Forge-131 — JS post processors.
//
// We don't ship 4 entirely separate G-code emitters in JS — the native
// kernel already does the heavy lifting (move ordering, feed/speed,
// retract logic, modal-state tracking). Instead each post here takes
// the Fanuc-shaped output cam.gcode.toGcode emits and rewrites the
// header/footer + per-line tokens so the result is a syntactically
// valid program for the target controller.
//
// The four controllers supported:
//   • Heidenhain iTNC530   — Klartext-flavoured G-code, "L X+...Y+..." lines
//   • Okuma OSP            — G-code with M198 subroutine calls
//   • Fagor 8055           — G-code, slightly different modal codes
//   • NUM 1050             — G-code with extra modal codes (G56/G57)
//
// Each post processor has:
//   - id        — the canonical name shown in the dialect dropdown
//   - header(opts) → string  produces the program header
//   - footer(opts) → string  produces the program footer
//   - toolChange(toolId, name) → string
//   - line(rawLine, ctx) → string  rewrites a single G-code line
//
// `postProcess(name, baseText, toolpath, opts)` is the high-level entry
// point camDispatch calls. It splits the base Fanuc-shaped text, applies
// the per-line transform, and wraps it in the header/footer.

// ──────────────────────────────────────────── shared helpers
function fmt(n) {
  if (n === undefined || n === null || Number.isNaN(n)) return '';
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return (v >= 0 ? '+' : '') + v.toFixed(3);
}

function parseAxes(line) {
  // Pull X/Y/Z/A/B/C/F values out of a Fanuc-style G-code line. Returns
  // an object with present keys plus the raw words for fall-through.
  const out = { _raw: line };
  const re = /([XYZABCFIJKR])([-+]?\d+(?:\.\d+)?)/gi;
  let m;
  while ((m = re.exec(line)) !== null) {
    out[m[1].toUpperCase()] = parseFloat(m[2]);
  }
  // Detect the canonical G/M words
  const g = line.match(/G(\d+(?:\.\d+)?)/i);
  if (g) out.G = g[1];
  const mm = line.match(/M(\d+)/i);
  if (mm) out.M = mm[1];
  const tt = line.match(/\bT(\d+)/i);
  if (tt) out.T = tt[1];
  const ss = line.match(/\bS(\d+(?:\.\d+)?)/i);
  if (ss) out.S = ss[1];
  return out;
}

function isComment(line) {
  const t = line.trim();
  return t.startsWith('(') || t.startsWith(';') || t.startsWith('%');
}

// ──────────────────────────────────────────── Heidenhain iTNC530
//
// Heidenhain uses Klartext-flavoured G-code on this controller. We map
// movement words into the "L X+...Y+..." prefix syntax operators read
// when troubleshooting; canned cycles use CYCL DEF blocks. The result
// here is hybrid (Klartext-style coords + ISO header) which is the
// shape iTNC530 actually accepts in ISO-programming mode.

const HEIDENHAIN_ITNC530 = {
  id: 'Heidenhain iTNC530',
  ext: 'h',
  header({ programNumber = 1, toolNumber = 1, safeZ = 25 } = {}) {
    return [
      `BEGIN PGM FORGE${String(programNumber).padStart(4, '0')} MM`,
      `; Forge-131 post · Heidenhain iTNC530`,
      `BLK FORM 0.1 Z X-50 Y-50 Z-50`,
      `BLK FORM 0.2 X+50 Y+50 Z+0`,
      `TOOL CALL ${toolNumber} Z S12000`,
      `L Z+${safeZ.toFixed(3)} R0 FMAX M3`,
    ].join('\n');
  },
  footer({ programNumber = 1, safeZ = 25 } = {}) {
    return [
      `L Z+${safeZ.toFixed(3)} R0 FMAX M5`,
      `L X+0 Y+0 R0 FMAX M30`,
      `END PGM FORGE${String(programNumber).padStart(4, '0')} MM`,
    ].join('\n');
  },
  toolChange(toolId, name = '') {
    return `TOOL CALL ${toolId} Z S12000 ; ${name}`;
  },
  line(line) {
    if (isComment(line)) {
      const stripped = line.trim().replace(/^\(|\)$/g, '');
      return `; ${stripped}`;
    }
    const ax = parseAxes(line);
    // Tool change
    if (ax.T !== undefined && ax.M === '6') {
      return this.toolChange(ax.T);
    }
    // Spindle on/off
    if (ax.M === '3' || ax.M === '4') return `M${ax.M}`;
    if (ax.M === '5') return `M5`;
    if (ax.M === '30' || ax.M === '2') return `M${ax.M}`;
    // Linear/rapid moves
    if (ax.G === '0' || ax.G === '1' || ax.G === '00' || ax.G === '01') {
      const parts = [];
      if (ax.X !== undefined) parts.push(`X${fmt(ax.X)}`);
      if (ax.Y !== undefined) parts.push(`Y${fmt(ax.Y)}`);
      if (ax.Z !== undefined) parts.push(`Z${fmt(ax.Z)}`);
      if (ax.A !== undefined) parts.push(`A${fmt(ax.A)}`);
      if (ax.B !== undefined) parts.push(`B${fmt(ax.B)}`);
      if (ax.C !== undefined) parts.push(`C${fmt(ax.C)}`);
      const feed = (ax.G === '0' || ax.G === '00') ? 'FMAX'
                  : (ax.F !== undefined ? `F${ax.F.toFixed(0)}` : 'F500');
      return `L ${parts.join(' ')} R0 ${feed}`;
    }
    // Arc moves — Heidenhain uses CC (centre) + C
    if (ax.G === '2' || ax.G === '3' || ax.G === '02' || ax.G === '03') {
      const dir = (ax.G === '2' || ax.G === '02') ? 'DR-' : 'DR+';
      const cx = (ax.I !== undefined ? ax.I : 0);
      const cy = (ax.J !== undefined ? ax.J : 0);
      const parts = [];
      if (ax.X !== undefined) parts.push(`X${fmt(ax.X)}`);
      if (ax.Y !== undefined) parts.push(`Y${fmt(ax.Y)}`);
      if (ax.Z !== undefined) parts.push(`Z${fmt(ax.Z)}`);
      const feed = ax.F !== undefined ? `F${ax.F.toFixed(0)}` : 'F500';
      return `CC X${fmt(cx)} Y${fmt(cy)}\nC ${parts.join(' ')} ${dir} R0 ${feed}`;
    }
    // Canned cycles — drill (G81) / peck (G83)
    if (ax.G === '81') return `CYCL DEF 200 DRILLING Q200=2 Q201=${fmt(-Math.abs(ax.Z || 5))} Q206=${ax.F || 200}`;
    if (ax.G === '83') return `CYCL DEF 203 UNIVERSAL DRILLING Q200=2 Q201=${fmt(-Math.abs(ax.Z || 5))} Q206=${ax.F || 200} Q202=3`;
    // Default — passthrough comment so the operator sees the source.
    return `; (passthrough) ${line.trim()}`;
  },
};

// ──────────────────────────────────────────── Okuma OSP
//
// Okuma OSP — G-code is mostly Fanuc-compatible, but Okuma uses M198 to
// call subroutines (instead of M98) and supports ":" labels. We rewrite
// canned cycles to OSP-friendly equivalents (G73/G83 with R-plane).

const OKUMA_OSP = {
  id: 'Okuma OSP',
  ext: 'min',
  header({ programNumber = 100, toolNumber = 1, safeZ = 25 } = {}) {
    return [
      `%`,
      `O${programNumber}(FORGE-131 OKUMA OSP)`,
      `N1 G15 H1`,
      `N2 G90 G94`,
      `N3 G17 G40 G49 G80`,
      `N4 T${String(toolNumber).padStart(2, '0')} M6`,
      `N5 G43 Z${safeZ.toFixed(3)} H${toolNumber}`,
      `N6 S12000 M3`,
    ].join('\n');
  },
  footer({ safeZ = 25 } = {}) {
    return [
      `G91 G28 Z0`,
      `G90 Z${safeZ.toFixed(3)}`,
      `M5`,
      `M9`,
      `M30`,
      `%`,
    ].join('\n');
  },
  toolChange(toolId, name = '') {
    return `T${String(toolId).padStart(2, '0')} M6 (${name})`;
  },
  line(line) {
    if (isComment(line)) return line.replace(/;/g, '(').replace(/$/, ')').replace(/\(\)/g, '');
    // Subprogram call: Fanuc M98 → Okuma M198
    let out = line.replace(/\bM98\b/g, 'M198');
    // G28 references via R-plane
    out = out.replace(/\bG54\b/g, 'G15 H1');
    return out;
  },
};

// ──────────────────────────────────────────── Fagor 8055
//
// Fagor 8055 is G-code-compatible at the surface level but its modal
// state machine prefers explicit work-plane (G17/G18/G19) at the top of
// every tool segment and uses G54..G59 for offsets like Fanuc.

const FAGOR_8055 = {
  id: 'Fagor 8055',
  ext: 'pim',
  header({ programNumber = 1, toolNumber = 1, safeZ = 25 } = {}) {
    return [
      `%${String(programNumber).padStart(4, '0')}`,
      `(FORGE-131 FAGOR 8055)`,
      `N10 G71 G90 G94`,
      `N20 G17 G40 G49`,
      `N30 G54`,
      `N40 T${toolNumber} D${toolNumber} M6`,
      `N50 G0 Z${safeZ.toFixed(3)}`,
      `N60 S12000 M3`,
    ].join('\n');
  },
  footer({ safeZ = 25 } = {}) {
    return [
      `G0 Z${safeZ.toFixed(3)}`,
      `G53`,
      `M5`,
      `M9`,
      `M30`,
      `%`,
    ].join('\n');
  },
  toolChange(toolId, name = '') {
    return `T${toolId} D${toolId} M6 (${name})`;
  },
  line(line) {
    if (isComment(line)) return line;
    // Fagor uses M30 for end-of-program but G53 (machine coords) to
    // reset offsets — our transform leaves move lines alone and just
    // rewrites modal codes the operator cares about.
    let out = line.replace(/\bG28\b/g, 'G53 G0');
    return out;
  },
};

// ──────────────────────────────────────────── NUM 1050
//
// NUM 1050 G-code with extra modal codes — uses G56/G57 for tool length
// + radius corrections (rather than Fanuc's G43/G41), and supports L
// blocks for parameter assignment.

const NUM_1050 = {
  id: 'NUM 1050',
  ext: 'nc',
  header({ programNumber = 1, toolNumber = 1, safeZ = 25 } = {}) {
    return [
      `%`,
      `(FORGE-131 NUM 1050)`,
      `N10 G0 G17 G40 G80 G90 G94`,
      `N20 T${toolNumber} M6`,
      `N30 G56 H${toolNumber}`,
      `N40 G0 Z${safeZ.toFixed(3)}`,
      `N50 S12000 M3`,
    ].join('\n');
  },
  footer({ safeZ = 25 } = {}) {
    return [
      `G0 Z${safeZ.toFixed(3)}`,
      `G75`,
      `M5`,
      `M9`,
      `M30`,
      `%`,
    ].join('\n');
  },
  toolChange(toolId, name = '') {
    return `T${toolId} M6 (${name})\nG56 H${toolId}`;
  },
  line(line) {
    if (isComment(line)) return line;
    // Length comp G43 → NUM's G56; cutter radius G41 → G57.
    let out = line
      .replace(/\bG43\b/g, 'G56')
      .replace(/\bG41\b/g, 'G57')
      .replace(/\bG42\b/g, 'G57');
    return out;
  },
};

// ──────────────────────────────────────────── registry
export const POST_PROCESSORS = {
  'Heidenhain iTNC530': HEIDENHAIN_ITNC530,
  'Okuma OSP':          OKUMA_OSP,
  'Fagor 8055':         FAGOR_8055,
  'NUM 1050':           NUM_1050,
};

/** Ordered list of post processor names — used by the dialect dropdown. */
export function postNames() {
  return Object.keys(POST_PROCESSORS);
}

/** True when the named dialect is one of the JS post processors. */
export function postSupportsDialect(name) {
  return Object.prototype.hasOwnProperty.call(POST_PROCESSORS, name);
}

/** File extension for the named post processor. Returns 'nc' by default. */
export function postExtension(name) {
  return POST_PROCESSORS[name]?.ext || 'nc';
}

/**
 * Apply a JS post processor on top of a base (Fanuc-shaped) G-code text.
 * baseText is the output of cam.gcode.toGcode(toolpath, 'Fanuc', safeZ).
 *
 * Returns the controller-specific text.
 */
export function postProcess(name, baseText, toolpath, opts = {}) {
  const pp = POST_PROCESSORS[name];
  if (!pp) throw new Error(`postProcess: unknown post processor ${name}`);
  const programNumber = opts.programNumber || 1;
  const toolNumber = opts.toolNumber || (toolpath && toolpath.toolId) || 1;
  const safeZ = opts.safeZ || 25;
  const header = pp.header({ programNumber, toolNumber, safeZ });
  const footer = pp.footer({ programNumber, toolNumber, safeZ });
  const bodyLines = String(baseText || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => {
      // Skip the base text's own header/footer so we don't double up
      // the program-start / program-end markers.
      if (/^%$/.test(l)) return null;
      if (/^O\d+/i.test(l)) return null;
      if (/^M30\b/.test(l)) return null;
      return pp.line(l);
    })
    .filter((l) => l !== null && l !== '');
  return [header, ...bodyLines, footer].join('\n');
}

export default { POST_PROCESSORS, postNames, postProcess,
                 postSupportsDialect, postExtension };
