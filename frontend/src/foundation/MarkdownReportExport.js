/**
 * Markdown Engineering Review Report. Emits a single .md file that
 * summarises the entire current scene -- title, generation timestamp,
 * body table with material / volume / mass / bbox, ΣVolume / ΣMass
 * totals, history-entry count, and the canonical references to every
 * accompanying export format the user already ships (STEP, 3MF, BOM,
 * DXF, OBJ).
 *
 * Markdown is the universal review format -- GitHub renders it inline,
 * every IDE editor previews it, project trackers (Asana, ClickUp, Jira
 * via plugins) accept it. ArchDisc now produces a ready-to-paste
 * engineering-review summary without leaving the app.
 */

import * as THREE from 'three';

const MAT_STORAGE_KEY = 'archdisc:body-materials:v1';

const MATERIAL_INFO = {
  'steel-1045': { label: 'Steel · AISI 1045',   density_g_cm3: 7.85 },
  'steel-4140': { label: 'Steel · AISI 4140',   density_g_cm3: 7.85 },
  'stainless':  { label: 'Stainless · 316L',    density_g_cm3: 7.96 },
  'aluminum':   { label: 'Aluminum · 6061-T6',  density_g_cm3: 2.70 },
  'brass':      { label: 'Brass · C36000',      density_g_cm3: 8.49 },
  'cast-iron':  { label: 'Cast iron · A48 Cl40',density_g_cm3: 7.20 },
  'titanium':   { label: 'Titanium · Ti-6Al-4V',density_g_cm3: 4.43 },
  'pu':         { label: 'Polyurethane',        density_g_cm3: 1.20 },
};

function loadMaterialMap() {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(MAT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch { return {}; }
}

function listBodies() {
  if (typeof window === 'undefined' || !window.__archdiscBodies) return [];
  const reg = window.__archdiscBodies;
  if (typeof reg.list === 'function') return reg.list();
  if (Array.isArray(reg.bodies)) return reg.bodies;
  return [];
}

function bboxMm(group) {
  if (!group) return null;
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3());
  return {
    lx: size.x * 1000,
    ly: size.y * 1000,
    lz: size.z * 1000,
  };
}

function escMd(s) {
  return String(s ?? '').replace(/\|/g, '\\|');
}

export function exportMarkdownReport(opts = {}) {
  const bodies = listBodies();
  const matMap = loadMaterialMap();
  const projectName = String(opts.projectName ?? 'ArchDisc Project').trim();
  const now = new Date();
  const lines = [];

  lines.push(`# ${escMd(projectName)} — Engineering Review`);
  lines.push('');
  lines.push(`_Generated ${now.toISOString()} by ArchDisc · Mechanical CAD._`);
  lines.push('');

  if (bodies.length === 0) {
    lines.push('> ⚠ Scene is empty — no bodies to report.');
    const md = lines.join('\n') + '\n';
    return { ok: false, reason: 'empty-scene', bodies: 0, md };
  }

  // ─── Summary header ─────────────────────────────────────────────────
  let totalVolume = 0, totalMass = 0;
  const enriched = bodies.map((b, i) => {
    const matKey = matMap[b.id] || null;
    const matDef = matKey ? MATERIAL_INFO[matKey] : null;
    const v = b.volume_mm3 ?? null;
    const m = (v != null && matDef && matDef.density_g_cm3 > 0) ? (v / 1000) * matDef.density_g_cm3 : null;
    if (v != null) totalVolume += v;
    if (m != null) totalMass += m;
    const bb = bboxMm(b.group);
    return { index: i + 1, body: b, matKey, matDef, v, m, bb };
  });
  const hist = (typeof window !== 'undefined' ? window.__archdiscHistory : null);
  const historyLen = hist?.entries?.length ?? 0;

  lines.push(`**Bodies:** ${bodies.length}`);
  lines.push(`**Design-history entries:** ${historyLen}`);
  lines.push(`**ΣVolume:** ${totalVolume.toFixed(1)} mm³`);
  lines.push(`**ΣMass:** ${totalMass > 0 ? totalMass.toFixed(2) + ' g' : '— (assign materials in the Inspector to compute)'}`);
  lines.push('');

  // ─── Body table ─────────────────────────────────────────────────────
  lines.push('## Components');
  lines.push('');
  lines.push('| #  | Name | Source | Material | ρ g/cm³ | Volume mm³ | Mass g | Lx × Ly × Lz mm |');
  lines.push('|---:|------|--------|----------|--------:|-----------:|-------:|-----------------|');
  for (const e of enriched) {
    const dims = e.bb ? `${e.bb.lx.toFixed(2)} × ${e.bb.ly.toFixed(2)} × ${e.bb.lz.toFixed(2)}` : '—';
    lines.push(
      `| ${e.index} ` +
      `| ${escMd(e.body.name ?? '(unnamed)')} ` +
      `| ${escMd(e.body.sourceTool ?? '—')} ` +
      `| ${escMd(e.matDef ? e.matDef.label : (e.matKey ?? '—'))} ` +
      `| ${e.matDef ? e.matDef.density_g_cm3.toFixed(2) : '—'} ` +
      `| ${e.v != null ? e.v.toFixed(1) : '—'} ` +
      `| ${e.m != null ? e.m.toFixed(2) : '—'} ` +
      `| ${dims} |`
    );
  }
  lines.push(`| | **TOTAL** | | | | **${totalVolume.toFixed(1)}** | **${totalMass.toFixed(2)}** | |`);
  lines.push('');

  // ─── Companion exports ──────────────────────────────────────────────
  lines.push('## Companion exports');
  lines.push('');
  lines.push('- **STEP** — `Drawing → Export STEP` (per-component STEP bundle via `Export Project Bundle`)');
  lines.push('- **3MF** — `Drawing → Export 3MF` for slicer / 3D-print hand-off');
  lines.push('- **BOM CSV** — `Drawing → Export BOM (CSV)` for procurement / ERP import');
  lines.push('- **DXF** — `Drawing → Export DXF` for fabrication shops (R12 AutoCAD)');
  lines.push('- **OBJ + MTL** — `Drawing → Export OBJ (multi-body)` for DCC / KeyShot');
  lines.push('');

  // ─── Sign-off ───────────────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push('| Role | Name | Signature | Date |');
  lines.push('|------|------|-----------|------|');
  lines.push('| Designer | | | |');
  lines.push('| Reviewer | | | |');
  lines.push('| Approver | | | |');
  lines.push('');

  const md = lines.join('\n') + '\n';
  const filename = opts.filename ?? `archdisc-review-${now.toISOString().replace(/[:.]/g, '-').slice(0, 19)}.md`;

  if (opts.download !== false && typeof window !== 'undefined' && typeof document !== 'undefined') {
    try {
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.warn('[Markdown report] download failed', err);
    }
  }

  return {
    ok: true,
    bodies: bodies.length,
    historyLen,
    totalVolume,
    totalMass,
    bytes: md.length,
    filename,
    md,
  };
}

export default { exportMarkdownReport };
