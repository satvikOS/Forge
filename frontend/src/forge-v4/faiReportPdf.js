// Forge-162 — First Article Inspection (FAI) report PDF.
//
// Generates an AS9102-style FAI report from a measurement set +
// computed heatmap:
//
//   * Cover page — part number, revision, customer, inspector,
//     date, sign-off block.
//   * Feature table — one row per feature with nominal, probed,
//     tolerance ±, deviation, pass/fail.
//   * Deviation-vector summary — list of the largest 10 deviations
//     in signed form.
//   * Statistical summary — mean, σ, Cp, Cpk plus conformity counts.
//   * Sign-off block — inspector / engineer / quality signatures.
//
// jsPDF is dynamically imported (matches the existing pattern in
// DrawingsWorkbench.jsx); if the dep isn't installed we honestly
// fail with a clear error rather than fall back to a silent "no
// PDF generated".

export async function generateFaiReport({
  measurement,
  heatmap,
  meta = {},
} = {}) {
  if (!measurement) throw new Error('faiReport: measurement is required');
  if (!heatmap)     throw new Error('faiReport: heatmap is required');

  let JsPDF = null;
  // Vite-static-analyser hide: assemble the module ID at runtime so the
  // Rollup graph does not treat jspdf as a hard dependency.  jspdf is an
  // optional dep — when missing, the caller falls back to plain text.
  try {
    const specifier = 'js' + 'pdf';
    const mod = await import(/* @vite-ignore */ specifier);
    JsPDF = mod.jsPDF || mod.default;
  } catch (e) {
    throw new Error(
      'faiReport: jspdf is not installed. Run `npm i jspdf` to enable ' +
      'FAI PDF generation, or use generateFaiReportText() for a plain-text ' +
      'fallback.',
    );
  }

  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  let y = 14;
  const left = 12;

  // Cover.
  doc.setFontSize(16); doc.setFont('helvetica', 'bold');
  doc.text('First Article Inspection (FAI) Report', left, y); y += 7;
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.text(`per AS9102-style format · ISO 14253 conformity zoning`, left, y); y += 6;

  // Metadata block.
  const md = [
    ['Part number',  meta.partNumber  || '-'],
    ['Revision',     meta.revision    || '-'],
    ['Drawing',      meta.drawing     || '-'],
    ['Customer',     meta.customer    || '-'],
    ['Inspector',    meta.inspector   || '-'],
    ['CMM device',   meta.device      || measurement.source.toUpperCase()],
    ['Date',         meta.date        || new Date().toISOString().slice(0, 10)],
  ];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  for (const [k, v] of md) {
    doc.text(`${k}:`, left, y);
    doc.text(String(v), left + 30, y);
    y += 4;
  }
  y += 4;

  // Statistical summary block.
  doc.setFontSize(11); doc.setFont('helvetica', 'bold');
  doc.text('Statistical summary', left, y); y += 5;
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  const s = heatmap.stats;
  const cf = heatmap.conformity;
  doc.text(`Features    : ${s.count}`, left, y); y += 4;
  doc.text(`Mean dev    : ${fmtMm(s.mean)}`, left, y); y += 4;
  doc.text(`σ (stdev)   : ${fmtMm(s.stdev)}`, left, y); y += 4;
  doc.text(`Cp          : ${fmt(s.Cp, 3)}`, left, y); y += 4;
  doc.text(`Cpk         : ${fmt(s.Cpk, 3)}`, left, y); y += 4;
  doc.text(`Conformity  : pass ${cf.pass} · warn ${cf.warn} · fail ${cf.fail}`, left, y); y += 6;

  // Feature table header.
  doc.setFontSize(11); doc.setFont('helvetica', 'bold');
  doc.text('Feature table', left, y); y += 5;
  doc.setFontSize(8); doc.setFont('helvetica', 'bold');
  const colX = [left, left + 22, left + 38, left + 80, left + 122, left + 152, left + 175];
  const headers = ['ID', 'Kind', 'Nominal (mm)', 'Probed (mm)', 'Tol ±', 'Dev', 'PASS/FAIL'];
  for (let i = 0; i < headers.length; i++) doc.text(headers[i], colX[i], y);
  y += 3;
  doc.setDrawColor(120, 100, 60);
  doc.line(left, y, left + 196, y); y += 4;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  for (const f of measurement.features) {
    if (y > 280) {
      doc.addPage();
      y = 14;
    }
    const status = f.result?.status || 'unknown';
    if (status === 'fail') doc.setTextColor(180, 30, 30);
    else if (status === 'warn') doc.setTextColor(180, 110, 0);
    else                        doc.setTextColor(20, 100, 30);
    doc.text(f.id.slice(0, 12),         colX[0], y);
    doc.text(f.kind,                    colX[1], y);
    doc.text(fmtXYZ(f.nominal),         colX[2], y);
    doc.text(fmtXYZ(f.probed),          colX[3], y);
    doc.text(`+${fmtMm(f.tolerance.hi)} / ${fmtMm(f.tolerance.lo)}`, colX[4], y);
    doc.text(fmtMm(f.result?.deviation ?? 0), colX[5], y);
    doc.text(status.toUpperCase(),      colX[6], y);
    y += 4;
  }
  doc.setTextColor(0, 0, 0);
  y += 3;

  // Largest 10 signed deviations.
  const sorted = [...heatmap.points].sort(
    (a, b) => Math.abs(b.signed) - Math.abs(a.signed),
  );
  if (y > 240) { doc.addPage(); y = 14; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('Largest signed deviations', left, y); y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  for (let i = 0; i < Math.min(10, sorted.length); i++) {
    const p = sorted[i];
    doc.text(`${i + 1}. ${p.id}: signed Δ = ${fmtMm(p.signed)} (${p.status})`,
             left, y);
    y += 4;
  }
  y += 6;

  // Sign-off block.
  if (y > 250) { doc.addPage(); y = 14; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('Sign-off', left, y); y += 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  const signers = [
    ['Inspector',       meta.inspector || ''],
    ['Quality engineer',meta.quality   || ''],
    ['Customer rep',    meta.customer  || ''],
  ];
  for (const [role, name] of signers) {
    doc.text(`${role}:`, left, y);
    doc.text(name, left + 35, y);
    doc.line(left + 70, y + 0.5, left + 150, y + 0.5);
    doc.text('signature / date', left + 110, y + 3);
    y += 12;
  }

  // Return both: the raw PDF blob (for save dialog) and the
  // jsPDF doc handle (for tests / further ops).
  const blob = doc.output('blob');
  return { blob, doc };
}

function fmt(n, digits = 4) {
  if (n == null || !Number.isFinite(n)) return '-';
  return n.toFixed(digits);
}
function fmtMm(n) {
  if (n == null || !Number.isFinite(n)) return '-';
  return `${n.toFixed(4)} mm`;
}
function fmtXYZ(p) {
  if (!p) return '-';
  return `(${fmt(p.x, 3)}, ${fmt(p.y, 3)}, ${fmt(p.z, 3)})`;
}

// Plain-text fallback — used by automated tests and as the honest
// "kernel missing" output when jspdf isn't installed.  Surfaces the
// same data as the PDF, structured as plain ASCII so it can be
// diffed by CI.
export function generateFaiReportText({ measurement, heatmap, meta = {} } = {}) {
  if (!measurement) throw new Error('faiReport: measurement is required');
  if (!heatmap)     throw new Error('faiReport: heatmap is required');
  const lines = [];
  lines.push('FIRST ARTICLE INSPECTION REPORT');
  lines.push('===============================');
  lines.push(`Part number  : ${meta.partNumber || '-'}`);
  lines.push(`Revision     : ${meta.revision   || '-'}`);
  lines.push(`Customer     : ${meta.customer   || '-'}`);
  lines.push(`Inspector    : ${meta.inspector  || '-'}`);
  lines.push(`CMM device   : ${meta.device || measurement.source.toUpperCase()}`);
  lines.push(`Date         : ${meta.date || new Date().toISOString().slice(0, 10)}`);
  lines.push('');
  lines.push('STATISTICAL SUMMARY');
  lines.push(`  Features  : ${heatmap.stats.count}`);
  lines.push(`  Mean      : ${fmtMm(heatmap.stats.mean)}`);
  lines.push(`  Sigma     : ${fmtMm(heatmap.stats.stdev)}`);
  lines.push(`  Cp        : ${fmt(heatmap.stats.Cp, 3)}`);
  lines.push(`  Cpk       : ${fmt(heatmap.stats.Cpk, 3)}`);
  lines.push(`  Pass/Warn/Fail : ${heatmap.conformity.pass}/${heatmap.conformity.warn}/${heatmap.conformity.fail}`);
  lines.push('');
  lines.push('FEATURE TABLE');
  for (const f of measurement.features) {
    lines.push(`  [${f.id}] ${f.kind} nom=${fmtXYZ(f.nominal)} ` +
               `probed=${fmtXYZ(f.probed)} tol=±${fmtMm(f.tolerance.hi)} ` +
               `dev=${fmtMm(f.result?.deviation ?? 0)} ${f.result?.status?.toUpperCase() || ''}`);
  }
  return lines.join('\n');
}
