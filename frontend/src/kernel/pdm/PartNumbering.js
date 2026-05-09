/**
 * ArchDisc — Part Numbering System
 *
 * Auto-generates part numbers from configurable schemes.
 * Supports common formats: sequential, prefixed-sequential,
 * project-prefixed, and intelligent (encodes type/size/material).
 */

const SCHEMES = {
  sequential: {
    description: 'Simple incrementing number',
    format: '{seq:6}',  // 000001, 000002, ...
  },
  prefixed: {
    description: 'Prefix + sequential',
    format: '{prefix}-{seq:5}', // PRT-00001
  },
  project: {
    description: 'Project + prefix + sequential',
    format: '{project}-{prefix}-{seq:4}', // PROJ001-PRT-0001
  },
  intelligent: {
    description: 'Type-Size-Material-Sequential',
    format: '{type}-{size:3}-{mat:3}-{seq:4}', // BKT-100-AL6-0001
  },
  iso: {
    description: 'ISO 14000-style with category',
    format: '{category:2}-{date:6}-{seq:4}', // 01-260509-0001
  },
};

export { SCHEMES };

let _globalCounter = 1;

export default class PartNumbering {

  /**
   * Generate a part number from a scheme.
   * @param {string} schemeName
   * @param {object} context - { prefix, project, type, size, mat, category, date, seq }
   */
  static generate(schemeName = 'prefixed', context = {}) {
    const scheme = SCHEMES[schemeName];
    if (!scheme) throw new Error(`Unknown scheme: ${schemeName}`);

    const seq = context.seq ?? _globalCounter++;
    const date = context.date || new Date();
    const dateStr = `${(date.getFullYear() % 100).toString().padStart(2, '0')}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}`;

    const fields = {
      seq: (digits) => seq.toString().padStart(parseInt(digits) || 5, '0'),
      prefix: () => (context.prefix || 'PRT').toUpperCase(),
      project: () => (context.project || 'ARCHDISC').toUpperCase(),
      type: () => (context.type || 'PRT').toUpperCase(),
      size: (digits) => Math.round(context.size || 100).toString().padStart(parseInt(digits) || 3, '0'),
      mat: (digits) => (context.mat || 'AL').toUpperCase().substring(0, parseInt(digits) || 3),
      category: (digits) => (context.category || '01').toString().padStart(parseInt(digits) || 2, '0'),
      date: () => dateStr,
    };

    return scheme.format.replace(/\{(\w+)(?::(\d+))?\}/g, (m, name, digits) => {
      const fn = fields[name];
      return fn ? fn(digits) : m;
    });
  }

  /**
   * Auto-derive part number from a TopoSolid based on its features.
   */
  static fromSolid(solid, options = {}) {
    const bbox = solid.boundingBox?.();
    const size = bbox ? Math.round(bbox.size().length() * 1000) : 100;
    const mat = (options.material || 'Aluminum 6061-T6').split(' ')[0].substring(0, 3).toUpperCase();
    const type = options.type || 'PRT';
    return PartNumbering.generate('intelligent', { type, size, mat });
  }

  /**
   * Reset the global sequential counter (for tests).
   */
  static reset(value = 1) {
    _globalCounter = value;
  }

  /**
   * Validate a part number against a scheme pattern.
   */
  static validate(partNumber, schemeName) {
    const scheme = SCHEMES[schemeName];
    if (!scheme) return { valid: false, reason: 'Unknown scheme' };

    // Build regex pieces (avoiding string-replace backslash issues)
    const parts = [];
    let lastIdx = 0;
    const re = /\{(\w+)(?::(\d+))?\}/g;
    let match;
    while ((match = re.exec(scheme.format)) !== null) {
      // Literal text before the placeholder (escape regex chars)
      const literal = scheme.format.slice(lastIdx, match.index).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      if (literal) parts.push(literal);

      const name = match[1];
      const n = parseInt(match[2]) || 4;
      if (name === 'seq' || name === 'date' || name === 'category' || name === 'size') {
        parts.push(`\\d{${n}}`);
      } else {
        parts.push(`[A-Z0-9]+`);
      }
      lastIdx = match.index + match[0].length;
    }
    if (lastIdx < scheme.format.length) {
      parts.push(scheme.format.slice(lastIdx).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'));
    }

    const regexStr = parts.join('');
    const valid = new RegExp(`^${regexStr}$`).test(partNumber);
    return { valid, scheme: schemeName, format: scheme.format, regex: regexStr };
  }
}
