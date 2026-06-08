// Forge-165 — Phase D.3 simulation auto-trigger detector.
//
// Pure function. Returns a semicolon-joined one-line hint when the
// prompt mentions load-bearing, dynamic, or thermal cues that an FEA
// pass should accompany. Empty string when no trigger fires.
//
// Lives in its own file so the unit test under __tests__ can import
// it without going through the JSX shell.

export function detectSimTriggers(prompt) {
  const p = String(prompt || '').toLowerCase();
  if (!p) return '';
  const hits = [];
  if (/\b(load.?bearing|support[s]?\s+\d|withstand|sustain|fos|factor of safety|yield|max(imum)? stress|von ?mises|deflection|sag(s|ging)?|stiff)\b/.test(p) ||
      /\b\d+\s*(n|kn|lb[fs]?|kg|tonnes?|tons?)\b/.test(p)) {
    hits.push('Linear Static (simulate.fea-static) recommended');
  }
  if (/\b(modal|natural frequenc(y|ies)|resonan(ce|t)|vibrat(e|ion)|harmonic|eigenfrequenc(y|ies)|first mode)\b/.test(p)) {
    hits.push('Modal (simulate.fea-modal) recommended');
  }
  if (/\b(impact|drop test|crash|transient|cyclic|fatigue|s-?n curve|miner.?s rule)\b/.test(p)) {
    hits.push('Transient Dynamic (simulate.fea-dynamic) recommended');
  }
  if (/\b(thermal|heat|temperature gradient|heat shed|hot spot|coolant|heat exchanger)\b/.test(p)) {
    hits.push('Thermal FEA recommended (queue once kernel exposes it)');
  }
  return hits.join('; ');
}
