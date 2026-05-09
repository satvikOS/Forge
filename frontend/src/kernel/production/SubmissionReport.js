/**
 * ArchDisc — Submission Report
 *
 * Generates a single self-contained HTML file summarizing a complete
 * production-article submission. Embeds the master assembly drawing
 * inline, lists Class 1 LLP parts with cycle limits, shows BOM,
 * performance, noise, certification status — everything a reviewer
 * needs to evaluate the submission without opening individual files.
 *
 * Different from HTMLReportBuilder (general-purpose) — this one is
 * tailored for FAA Part 21 / similar engineering deliveries and
 * pulls from PartIDRegistry + the production-package output.
 */

import PartIDRegistry from '../registry/PartIDRegistry.js';
import FMEA from './FMEA.js';

export default class SubmissionReport {

  /**
   * @param {object} options
   *   project              project name
   *   title                full title
   *   submissionType       'FAA Part 21 Production Approval', etc.
   *   manifest             the engine-level manifest object
   *   masterDrawingSVG     embedded SVG (string)
   *   bom                  MBOM lines (top N)
   *   performance          { takeoff: {...}, cruise: {...} }
   *   noise                noise cert object
   *   compliance           FAR 33 / CS-E compliance report
   *   maintenance          task list + LLP table
   *   llp                  life-limited parts with cycle limits
   *   thumbnails           { name → dataURL } for embedded screenshots
   * @returns {string} HTML
   */
  static build(options = {}) {
    const {
      project = 'PROJECT',
      title = 'Production Article Submission',
      submissionType = 'FAA Part 21 Production Approval',
      manifest = {},
      masterDrawingSVG = '',
      bom = [],
      performance = {},
      noise = null,
      compliance = null,
      maintenance = null,
      llp = [],
      thumbnails = {},
    } = options;

    const stats = PartIDRegistry.stats();

    // Compute Class 1 LLP parts from registry
    const llpEntries = PartIDRegistry.all().filter(e =>
      FMEA.classify(e.category, e.subsystem) === 'Class 1'
    );
    const llpByName = new Map();
    for (const e of llpEntries) {
      const key = `${e.category}-${e.subsystem}-${e.name.replace(/\s+\d+/, '')}`;
      if (!llpByName.has(key)) {
        llpByName.set(key, {
          name: e.name, category: e.category, subsystem: e.subsystem,
          material: e.material, count: 0, samplePartID: e.partID,
        });
      }
      llpByName.get(key).count++;
    }
    const uniqueLLP = Array.from(llpByName.values());

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${SubmissionReport._esc(title)} — ${SubmissionReport._esc(project)} Submission</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${SubmissionReport._css()}</style>
</head>
<body>
<header>
  <div class="banner">
    <span class="proj">${SubmissionReport._esc(project)}</span>
    <span class="submission-type">${SubmissionReport._esc(submissionType)}</span>
    <span class="rev">REV ${SubmissionReport._esc(manifest.revision || 'A')}</span>
  </div>
  <h1>${SubmissionReport._esc(title)}</h1>
  <p class="subtitle">${SubmissionReport._esc(manifest.cad || 'ArchDisc proprietary B-Rep CAD kernel')}</p>
  <p class="meta">Generated: ${SubmissionReport._esc(manifest.generatedAt || new Date().toISOString())}</p>
</header>

<nav class="toc">
  <a href="#summary">Summary</a>
  <a href="#assembly">Master Assembly</a>
  <a href="#performance">Performance</a>
  <a href="#noise">Noise</a>
  <a href="#llp">LLP Table</a>
  <a href="#bom">BOM</a>
  <a href="#compliance">Compliance</a>
  <a href="#maintenance">Maintenance</a>
  <a href="#screenshots">Visual Renders</a>
  <a href="#parts">Per-Part Index</a>
</nav>

<main>
<section id="summary">
  <h2>1. Submission Summary</h2>
  <div class="stats-grid">
    <div class="stat"><div class="num">${(manifest.counts?.totalComponents || stats.total).toLocaleString()}</div><div class="lbl">total components</div></div>
    <div class="stat"><div class="num">${(manifest.counts?.uniquePartDefinitions || 0).toLocaleString()}</div><div class="lbl">unique part numbers</div></div>
    <div class="stat critical"><div class="num">${manifest.counts?.class1_LLP || uniqueLLP.length}</div><div class="lbl">Class 1 LLP</div></div>
    <div class="stat ok"><div class="num">${(manifest.counts?.class2_Important || 0).toLocaleString()}</div><div class="lbl">Class 2 Important</div></div>
    <div class="stat"><div class="num">${(manifest.counts?.class3_Standard || 0).toLocaleString()}</div><div class="lbl">Class 3 Standard</div></div>
    <div class="stat"><div class="num">${(manifest.physical?.totalMass_kg || 0).toLocaleString()}</div><div class="lbl">kg total mass</div></div>
  </div>
  <p class="meta">Output folder: <code>${SubmissionReport._esc(manifest.folderLayout?.[0]?.split(' ')[0] || 'engine-output/...')}</code></p>
</section>

<section id="assembly">
  <h2>2. Master Assembly Drawing</h2>
  ${masterDrawingSVG
    ? `<div class="drawing-frame">${masterDrawingSVG}</div>`
    : '<p class="muted">— master drawing not embedded —</p>'}
</section>

<section id="performance">
  <h2>3. Performance (Brayton Cycle)</h2>
  ${performance.takeoff ? `
    <table class="perf-table">
      <thead><tr><th>Quantity</th><th>Takeoff</th><th>Cruise</th></tr></thead>
      <tbody>
        <tr><td>Thrust (kN)</td><td>${performance.takeoff.thrust_total_kN?.toFixed(1)}</td><td>${performance.cruise?.thrust_total_kN?.toFixed(1) || '—'}</td></tr>
        <tr><td>SFC (lbm/lbf·hr)</td><td>${performance.takeoff.TSFC_lbm_lbf_hr?.toFixed(3)}</td><td>${performance.cruise?.TSFC_lbm_lbf_hr?.toFixed(3) || '—'}</td></tr>
        <tr><td>OPR</td><td>${performance.takeoff.OPR?.toFixed(1)}</td><td>—</td></tr>
        <tr><td>BPR</td><td>${performance.takeoff.BPR}</td><td>—</td></tr>
        <tr><td>TIT (°C)</td><td>${performance.takeoff.TIT_C?.toFixed(0)}</td><td>—</td></tr>
        <tr><td>EGT (°C)</td><td>${performance.takeoff.EGT_C?.toFixed(0)}</td><td>—</td></tr>
        <tr><td>Mass flow (kg/s)</td><td>${performance.takeoff.massFlow || '—'}</td><td>—</td></tr>
      </tbody>
    </table>
    <p class="muted">Computed from station-by-station Brayton cycle (ISA atmosphere → diffuser → fan → compressor → combustor → turbines → nozzles).</p>
  ` : '<p class="muted">— performance data not provided —</p>'}
</section>

<section id="noise">
  <h2>4. Acoustic Noise (FAR Part 36 / ICAO Annex 16 Ch.14)</h2>
  ${noise ? `
    <table class="noise-table">
      <thead><tr><th>Cert Point</th><th>EPNdB</th><th>Limit</th><th>Margin</th><th>Status</th></tr></thead>
      <tbody>
        <tr><td>Lateral (sideline)</td><td>${noise.certPoints.lateral.EPNdB}</td><td>${noise.certPoints.lateral.limit}</td><td class="${noise.certPoints.lateral.margin > 0 ? 'pass' : 'fail'}">${noise.certPoints.lateral.margin > 0 ? '+' : ''}${noise.certPoints.lateral.margin}</td><td>${noise.certPoints.lateral.margin > 0 ? '✓' : '✗'}</td></tr>
        <tr><td>Flyover (cutback)</td><td>${noise.certPoints.flyover.EPNdB}</td><td>${noise.certPoints.flyover.limit}</td><td class="${noise.certPoints.flyover.margin > 0 ? 'pass' : 'fail'}">${noise.certPoints.flyover.margin > 0 ? '+' : ''}${noise.certPoints.flyover.margin}</td><td>${noise.certPoints.flyover.margin > 0 ? '✓' : '✗'}</td></tr>
        <tr><td>Approach</td><td>${noise.certPoints.approach.EPNdB}</td><td>${noise.certPoints.approach.limit}</td><td class="${noise.certPoints.approach.margin > 0 ? 'pass' : 'fail'}">${noise.certPoints.approach.margin > 0 ? '+' : ''}${noise.certPoints.approach.margin}</td><td>${noise.certPoints.approach.margin > 0 ? '✓' : '✗'}</td></tr>
      </tbody>
    </table>
    <p class="meta"><strong>Cumulative margin: ${noise.cumulativeMargin_EPNdB} EPNdB</strong> (Ch.14 needs ≥ 17). <strong>${noise.ch14Compliant ? '✓ Compliant' : '✗ Non-compliant'}</strong>.</p>
  ` : '<p class="muted">— noise certification not run —</p>'}
</section>

<section id="llp">
  <h2>5. Life-Limited Parts (LLP)</h2>
  <p>Per FAR 33.70 Critical Parts. Hard cycle limits — mandatory replacement regardless of measured condition.</p>
  ${llp.length > 0 ? `
    <table class="llp-table">
      <thead><tr><th>Part</th><th>Cycle Limit</th><th>Labor (hr)</th><th>EM Reference</th></tr></thead>
      <tbody>
        ${llp.map(p => `<tr><td>${SubmissionReport._esc(p.title?.replace('LLP — ', '') || p.id)}</td><td>${p.interval?.cycles?.toLocaleString() || '—'}</td><td>${p.laborHours}</td><td><code>${SubmissionReport._esc(p.emRef)}</code></td></tr>`).join('')}
      </tbody>
    </table>
  ` : ''}
  <h3>Class 1 Components in This Submission (${uniqueLLP.length} unique)</h3>
  <table class="llp-comp">
    <thead><tr><th>Component</th><th>Category</th><th>Subsystem</th><th>Material</th><th>Qty</th></tr></thead>
    <tbody>
      ${uniqueLLP.slice(0, 30).map(c => `<tr>
        <td>${SubmissionReport._esc(c.name)}</td>
        <td><code>${SubmissionReport._esc(c.category)}</code></td>
        <td><code>${SubmissionReport._esc(c.subsystem)}</code></td>
        <td>${SubmissionReport._esc(c.material)}</td>
        <td class="qty">${c.count}</td>
      </tr>`).join('')}
    </tbody>
  </table>
</section>

<section id="bom">
  <h2>6. Bill of Materials (top by quantity)</h2>
  <table class="bom-table">
    <thead><tr><th>#</th><th>Component</th><th>Cat</th><th>Sub</th><th>Material</th><th>Class</th><th>Qty</th><th>Mass (kg)</th><th>Cost (USD)</th></tr></thead>
    <tbody>
      ${bom.slice(0, 50).map(item => `<tr>
        <td>${item.item}</td>
        <td>${SubmissionReport._esc(item.name)}</td>
        <td><code>${SubmissionReport._esc(item.category)}</code></td>
        <td><code>${SubmissionReport._esc(item.subsystem)}</code></td>
        <td>${SubmissionReport._esc(item.material)}</td>
        <td><span class="class ${(item.classification || 'cls3').toLowerCase().replace(' ', '')}">${SubmissionReport._esc(item.classification || '')}</span></td>
        <td class="qty">${item.quantity?.toLocaleString() || ''}</td>
        <td class="qty">${item.unitMassKg ?? ''}</td>
        <td class="qty">$${(item.extendedCostUSD || 0).toLocaleString()}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  <p class="muted">${bom.length > 50 ? `… ${bom.length - 50} more entries in MBOM.csv / MBOM.json` : ''}</p>
</section>

<section id="compliance">
  <h2>7. Certification Compliance (FAR Part 33 / EASA CS-E)</h2>
  ${compliance ? `
    <div class="stats-grid compact">
      <div class="stat ok"><div class="num">${compliance.verified}</div><div class="lbl">Verified</div></div>
      <div class="stat marginal"><div class="num">${compliance.partial}</div><div class="lbl">Partial</div></div>
      <div class="stat"><div class="num">${compliance.unverified}</div><div class="lbl">Unverified</div></div>
      <div class="stat"><div class="num">${compliance.coveragePercent}%</div><div class="lbl">Coverage</div></div>
    </div>
    <table class="compliance-table">
      <thead><tr><th>§ Code</th><th>Title</th><th>Status</th><th>Pass / Fail / Total</th></tr></thead>
      <tbody>
        ${compliance.items.map(it => `<tr>
          <td><code>${SubmissionReport._esc(it.code)}</code></td>
          <td>${SubmissionReport._esc(it.title)}</td>
          <td><span class="status ${it.status.toLowerCase()}">${SubmissionReport._esc(it.status)}</span></td>
          <td>${it.passes} / ${it.fails} / ${it.evidenceCount}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  ` : '<p class="muted">— compliance not run —</p>'}
</section>

<section id="maintenance">
  <h2>8. Maintenance</h2>
  ${maintenance ? `
    <p>${maintenance.tasks?.length || 0} task cards · ${maintenance.llp?.length || 0} LLPs · ${maintenance.totalLaborOver24kCycles?.toFixed(0) || '—'} man-hours over 24,000-cycle life</p>
    <details><summary>Show all task cards</summary>
      <table class="maint-table">
        <thead><tr><th>Task ID</th><th>Title</th><th>Hours</th><th>Cycles</th><th>Days</th><th>Labor</th><th>LLP</th></tr></thead>
        <tbody>
          ${maintenance.tasks?.map(t => `<tr>
            <td><code>${SubmissionReport._esc(t.id)}</code></td>
            <td>${SubmissionReport._esc(t.title)}</td>
            <td>${t.interval?.hours ?? ''}</td>
            <td>${t.interval?.cycles?.toLocaleString() ?? ''}</td>
            <td>${t.interval?.calendar_days ?? ''}</td>
            <td>${t.laborHours} hr</td>
            <td>${t.llp ? '<strong>YES</strong>' : ''}</td>
          </tr>`).join('') || ''}
        </tbody>
      </table>
    </details>
  ` : '<p class="muted">— maintenance not generated —</p>'}
</section>

<section id="screenshots">
  <h2>9. Visual Renders</h2>
  ${Object.keys(thumbnails).length === 0 ? '<p class="muted">— no embedded thumbnails —</p>' :
    `<div class="screenshots">${Object.entries(thumbnails).map(([name, src]) => `
      <figure>
        <img src="${SubmissionReport._esc(src)}" alt="${SubmissionReport._esc(name)}" loading="lazy">
        <figcaption>${SubmissionReport._esc(name)}</figcaption>
      </figure>
    `).join('')}</div>`}
</section>

<section id="parts">
  <h2>10. Per-Part Index</h2>
  <p>Each component has its own folder under <code>parts/&lt;CATEGORY&gt;/&lt;SUBSYSTEM&gt;/&lt;PART_NAME&gt;/</code> containing:</p>
  <ul class="package-list">
    <li><code>part.step</code> — ISO 10303 STEP geometry (for SolidWorks / CATIA / NX / Fusion 360 / FreeCAD)</li>
    <li><code>drawing.svg</code> — ASME Y14.5 production drawing with title block, GD&amp;T frames, classification stripe</li>
    <li><code>tolerance.json</code> — datums, dimensional tolerances, GD&amp;T callouts, surface finishes</li>
    <li><code>inspection.md / .json</code> — AS9102 First Article Inspection (Form 1/2/3)</li>
    <li><code>material-cert.md / .json</code> — EN 10204 Type 3.1 mill certificate</li>
    <li><code>coc.md / .json</code> — Certificate of Conformance with traceability</li>
    <li><code>fmea.md / .json</code> — Design FMEA with S/O/D/RPN, FAR 33.70 risk class</li>
    <li><code>process-specs.md</code> — heat treat / surface finish / NDT / coating callouts</li>
    <li><code>fea.json</code> — class-tiered analysis (Class 1: full battery, Class 2: static + modal, Class 3: skip)</li>
    <li><code>quantity.json</code> — instance count + sample IDs</li>
    <li><code>manifest.json</code> — package manifest + sign-offs</li>
  </ul>
  <p class="muted">A non-technical reviewer can open any <code>drawing.svg</code> in a browser and see the full ASME Y14.5 sheet. Engineers can open <code>part.step</code> in any major CAD package.</p>
</section>

<footer>
  <p>${SubmissionReport._esc(project)} ${SubmissionReport._esc(manifest.revision || 'A')} · ${SubmissionReport._esc(manifest.generatedAt || '')}</p>
  <p class="muted">Generated by ArchDisc — proprietary B-Rep geometry kernel · No external CAD dependencies</p>
</footer>

<script>
for (const a of document.querySelectorAll('nav.toc a')) {
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href').slice(1);
    const t = document.getElementById(id);
    if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth' }); }
  });
}
</script>
</body>
</html>`;
  }

  static _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  static _css() {
    return `
* { box-sizing: border-box; }
body {
  font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
  margin: 0; padding: 0;
  background: #0e0e16; color: #e6e6ea; line-height: 1.55;
}
header {
  background: linear-gradient(135deg, #1a1a2e 0%, #16162a 100%);
  padding: 32px;
  border-bottom: 1px solid #2a2a4e;
}
.banner {
  display: flex; gap: 16px; align-items: center;
  font-family: 'JetBrains Mono', monospace; font-size: 12px;
  color: #8aa8d9; letter-spacing: 0.5px; margin-bottom: 8px;
}
.banner .submission-type {
  background: #d94a4a; color: #fff;
  padding: 2px 8px; border-radius: 2px;
  font-weight: 700; letter-spacing: 0.3px;
}
.banner .rev {
  margin-left: auto; color: #4ed99d;
  background: #1a3a26; padding: 2px 8px; border-radius: 2px;
}
header h1 { margin: 4px 0 6px; font-size: 32px; color: #fff; }
header .subtitle { color: #8a8aae; margin: 0; font-size: 14px; }
header .meta { color: #555570; font-size: 11px; margin-top: 12px; font-family: 'JetBrains Mono', monospace; }
nav.toc {
  position: sticky; top: 0; z-index: 10;
  background: #16162a;
  padding: 12px 32px;
  border-bottom: 1px solid #2a2a4e;
  display: flex; flex-wrap: wrap; gap: 18px;
  font-size: 12px;
}
nav.toc a {
  color: #8aa8d9; text-decoration: none; font-weight: 500;
}
nav.toc a:hover { color: #4a90d9; }
main { padding: 0; }
section {
  padding: 32px;
  border-bottom: 1px solid #1a1a2e;
}
section h2 { color: #4a90d9; margin: 0 0 16px; font-size: 22px; letter-spacing: 0.5px; }
section h3 { color: #c8c8e0; font-size: 16px; margin: 20px 0 8px; }
section p { color: #aab; }
.stats-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px; margin: 16px 0;
}
.stats-grid.compact .stat { padding: 12px; }
.stat {
  background: #16162a; border: 1px solid #2a2a4e; border-radius: 4px;
  padding: 16px; text-align: center;
}
.stat .num { font-size: 28px; font-weight: 700; color: #4a90d9; font-family: 'JetBrains Mono', monospace; }
.stat .lbl { font-size: 11px; color: #8a8aae; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }
.stat.critical .num { color: #d94a4a; }
.stat.ok .num { color: #4ed99d; }
.stat.marginal .num { color: #d9c84a; }
table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 12px; }
table th, table td {
  text-align: left; padding: 8px 12px;
  border-bottom: 1px solid #1a1a2e;
}
table th { background: #14142a; color: #8aa8d9; font-weight: 500; }
table tr:hover td { background: #14142a; }
table code {
  font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #4a90d9;
}
table .qty { text-align: right; font-family: 'JetBrains Mono', monospace; }
table td.pass { color: #4ed99d; font-weight: 700; }
table td.fail { color: #d94a4a; font-weight: 700; }
.class { display: inline-block; padding: 1px 6px; font-size: 10px; font-weight: 700; border-radius: 2px; }
.class.class1 { background: #3a1a26; color: #d94a4a; }
.class.class2 { background: #3a3a1a; color: #d9c84a; }
.class.class3 { background: #1a3a26; color: #4ed99d; }
.status { display: inline-block; padding: 1px 8px; font-size: 10px; font-weight: 700; border-radius: 2px; }
.status.verified { background: #1a3a26; color: #4ed99d; }
.status.partial, .status.mixed { background: #3a3a1a; color: #d9c84a; }
.status.failed { background: #3a1a26; color: #d94a4a; }
.status.unverified { background: #2a2a2a; color: #888; }
.muted { color: #8a8aae; font-size: 11px; }
.drawing-frame {
  background: #fff; padding: 16px; border-radius: 4px;
  overflow-x: auto; max-width: 100%;
}
.drawing-frame svg { width: 100%; height: auto; max-width: 100%; }
.screenshots {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 16px;
}
.screenshots figure {
  margin: 0; background: #14142a;
  border: 1px solid #2a2a4e; border-radius: 4px; overflow: hidden;
}
.screenshots img { width: 100%; display: block; }
.screenshots figcaption {
  padding: 8px 12px; font-size: 11px; color: #8aa8d9;
  font-family: 'JetBrains Mono', monospace;
  border-top: 1px solid #2a2a4e;
}
.package-list { font-size: 13px; }
.package-list li { padding: 4px 0; color: #c8c8e0; }
.package-list code { color: #4a90d9; }
footer { padding: 24px 32px; text-align: center; background: #08080f; color: #555570; font-size: 11px; }
details summary { cursor: pointer; padding: 8px 0; color: #8aa8d9; font-weight: 500; }
@media (max-width: 720px) {
  nav.toc { padding: 8px 16px; gap: 12px; }
  section { padding: 16px; }
  header { padding: 16px; }
  table { font-size: 10px; }
  .screenshots { grid-template-columns: 1fr; }
}
`;
  }
}
