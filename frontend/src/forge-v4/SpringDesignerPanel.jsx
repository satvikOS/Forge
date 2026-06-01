// Forge-167 — Spring designer panel.
//
// Three tabs: Compression / Extension / Torsion. Each tab exercises
// the real engineering analysis in springDesigner.js (Wahl factor,
// Goodman fatigue, ASTM material tables) and renders pass/fail badges
// against the design allowable. "Generate body" produces a parametric
// helical-sweep solid via window.__forgeAppendBody so the shell adds
// it to the body registry.
//
// Manual UI never writes to Archie's thread.
//
// React #185 avoidance:
//   - useState for inputs (cheap primitives, freezing input snapshots).
//   - Derived analysis is memoised via useMemo on raw scalars.
//   - The host registers window.__forgeOpenSpringDesigner *once* via a
//     mountedRef so a re-render race can't blow it away.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  SPRING_MATERIALS,
  analyzeCompressionSpring,
  analyzeExtensionSpring,
  analyzeTorsionSpring,
  generateCompressionSpringMesh,
} from './springDesigner.js';

const SPRING_PANEL_EVENT = 'forge:open-spring-designer-panel';

const TAB_DEFS = [
  { id: 'compression', label: 'Compression' },
  { id: 'extension',   label: 'Extension' },
  { id: 'torsion',     label: 'Torsion' },
];

const END_TYPES = [
  { id: 'plain',          label: 'Plain' },
  { id: 'plain-ground',   label: 'Plain ground' },
  { id: 'squared',        label: 'Squared' },
  { id: 'squared-ground', label: 'Squared & ground' },
];

const RELIABILITY_PCTS = [50, 90, 95, 99, 99.9, 99.99];

// ─────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────

const panelStyle = {
  position: 'fixed',
  top: 72, left: 76, right: 16, bottom: 48,
  background: 'rgba(10,11,14,0.98)',
  color: '#ebecef',
  border: '1px solid #1d2027',
  borderRadius: 6,
  boxShadow: '0 14px 38px rgba(0,0,0,0.5)',
  fontFamily: 'ui-sans-serif, system-ui',
  zIndex: 8500,
  display: 'flex', flexDirection: 'column',
  overflow: 'hidden',
  fontSize: 12,
};
const headerStyle = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '8px 12px', background: '#000',
  borderBottom: '1px solid #1d2027',
};
const tabsStyle = {
  display: 'flex', borderBottom: '1px solid #1d2027',
  background: '#0a0b0e',
};
const tabBtn = (active) => ({
  flex: 1, background: 'transparent', border: 'none',
  color: active ? '#ebecef' : '#7f8694',
  padding: '8px 12px', cursor: 'pointer',
  borderBottom: `2px solid ${active ? '#3da3ff' : 'transparent'}`,
});
const bodyStyle = {
  flex: 1, overflowY: 'auto', padding: 16,
  display: 'grid', gap: 18,
  gridTemplateColumns: '1.1fr 1.0fr',
  alignItems: 'start',
};
const sectionStyle = {
  border: '1px solid #1d2027', borderRadius: 6,
  background: '#101218', padding: 12,
};
const sectionTitleStyle = {
  fontWeight: 600, fontSize: 12, color: '#cdd2dc',
  marginBottom: 8, letterSpacing: 0.4, textTransform: 'uppercase',
};
const fieldRowStyle = {
  display: 'grid', gridTemplateColumns: '140px 1fr',
  alignItems: 'center', gap: 8, marginBottom: 6,
};
const labelStyle = { color: '#9aa1ad', fontSize: 11 };
const inputStyle = {
  width: '100%', background: '#0a0b0e', color: '#ebecef',
  border: '1px solid #1d2027', borderRadius: 3,
  padding: '4px 8px', fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};
const selectStyle = { ...inputStyle, padding: '4px 6px' };
const resultRowStyle = {
  display: 'grid', gridTemplateColumns: '180px 1fr',
  alignItems: 'center', gap: 8, padding: '3px 0',
  borderBottom: '1px dotted #1d2027',
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  fontSize: 12,
};
const okBadge = {
  display: 'inline-block', padding: '2px 8px',
  borderRadius: 3, fontSize: 10,
  background: '#093f1d', color: '#65eb88',
  border: '1px solid #1a6e3a',
};
const failBadge = {
  ...okBadge,
  background: '#3f0e15', color: '#ff8a96',
  border: '1px solid #6e1f2b',
};
const generateBtnStyle = {
  background: '#1a4a8a', color: '#fff',
  border: '1px solid #2e6fc4', borderRadius: 4,
  padding: '6px 16px', fontSize: 12, cursor: 'pointer',
};
const closeBtn = {
  background: 'transparent', color: '#ebecef',
  border: 'none', fontSize: 18, cursor: 'pointer',
  marginLeft: 'auto',
};

// ─────────────────────────────────────────────────────────────────────
// Per-tab forms
// ─────────────────────────────────────────────────────────────────────

function CompressionTab({ onGenerate }) {
  const [materialId, setMaterialId] = useState('astm-a228');
  const [wireDia, setWireDia]   = useState('3.5');
  const [meanDia, setMeanDia]   = useState('25');
  const [Nactive, setNactive]   = useState('8');
  const [endType, setEndType]   = useState('squared-ground');
  const [Fmin, setFmin]         = useState('50');
  const [Fmax, setFmax]         = useState('250');
  const [reliab, setReliab]     = useState('99');
  const [peened, setPeened]     = useState(false);

  // Memoise the analysis on PRIMITIVE deps only — that way the snapshot
  // identity is stable across re-renders that didn't change inputs.
  const params = useMemo(() => ({
    materialId,
    wireDia_mm: parseFloat(wireDia) || 0,
    meanDia_mm: parseFloat(meanDia) || 0,
    N_active:   parseFloat(Nactive) || 0,
    endType,
    F_min_N: parseFloat(Fmin) || 0,
    F_max_N: parseFloat(Fmax) || 0,
    reliability_pct: parseFloat(reliab) || 99,
    peened,
  }), [materialId, wireDia, meanDia, Nactive, endType, Fmin, Fmax, reliab, peened]);

  const analysis = useMemo(() => {
    try { return analyzeCompressionSpring(params); }
    catch (e) { return { error: e.message }; }
  }, [params]);

  const onGen = () => {
    if (analysis?.error) return;
    const body = generateCompressionSpringMesh(params, { id: `spring-c-${Date.now()}` });
    onGenerate?.(body, params, analysis);
  };

  return (
    <>
      <div style={sectionStyle} data-testid="forge-spring-form-compression">
        <div style={sectionTitleStyle}>Inputs · Compression spring</div>
        <SelectField label="Material" value={materialId} onChange={setMaterialId}
                     testid="forge-spring-mat-compression"
                     options={SPRING_MATERIALS.map((m) => ({ value: m.id, label: m.name }))} />
        <NumField label="Wire dia d (mm)"  value={wireDia} onChange={setWireDia}
                  testid="forge-spring-d-compression" />
        <NumField label="Mean dia D (mm)"  value={meanDia} onChange={setMeanDia}
                  testid="forge-spring-D-compression" />
        <NumField label="Active coils Nₐ"  value={Nactive} onChange={setNactive}
                  testid="forge-spring-N-compression" />
        <SelectField label="End condition" value={endType} onChange={setEndType}
                     testid="forge-spring-end-compression"
                     options={END_TYPES.map((e) => ({ value: e.id, label: e.label }))} />
        <NumField label="F min (N)" value={Fmin} onChange={setFmin}
                  testid="forge-spring-Fmin-compression" />
        <NumField label="F max (N)" value={Fmax} onChange={setFmax}
                  testid="forge-spring-Fmax-compression" />
        <SelectField label="Reliability (%)" value={reliab} onChange={setReliab}
                     testid="forge-spring-reliab-compression"
                     options={RELIABILITY_PCTS.map((p) => ({ value: String(p), label: `${p}%` }))} />
        <div style={fieldRowStyle}>
          <span style={labelStyle}>Shot-peened</span>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={peened}
                   data-testid="forge-spring-peened-compression"
                   onChange={(e) => setPeened(e.target.checked)} />
            <span style={{ color: '#9aa1ad', fontSize: 11 }}>Zimmerli SHOT_PEENED (398 MPa)</span>
          </label>
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
          <button style={generateBtnStyle} onClick={onGen}
                  data-testid="forge-spring-generate-compression">
            Generate body
          </button>
        </div>
      </div>
      <CompressionResults analysis={analysis} />
    </>
  );
}

function CompressionResults({ analysis }) {
  if (!analysis || analysis.error) {
    return (
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Analysis</div>
        <div style={{ color: '#ff8a96' }}>
          {analysis?.error || 'Enter spring parameters above.'}
        </div>
      </div>
    );
  }
  const d = analysis.display;
  return (
    <div style={sectionStyle} data-testid="forge-spring-results-compression">
      <div style={sectionTitleStyle}>Results · Compression analysis</div>
      <Row label="Spring index C">{d.C}</Row>
      <Row label="Wahl factor Kw">{d.Kw}</Row>
      <Row label="Rate k">{d.rate_N_per_mm} N/mm</Row>
      <Row label="Free length Lf">{d.Lf_mm} mm</Row>
      <Row label="Solid height Ls">{d.Ls_mm} mm</Row>
      <Row label="Pitch p">{d.pitch_mm} mm</Row>
      <Row label="Mass">{d.mass_g} g</Row>
      <Row label="τ at F_max">{d.tauAtFmax_MPa} MPa</Row>
      <Row label="τ_allow (static)">{d.tauAllowStatic_MPa} MPa</Row>
      <Row label="σ_uts">{d.sigmaUts_MPa} MPa</Row>
      <Row label="Buckling Lf/D">{d.bucklingRatio}</Row>
      <Row label="τ_a (alt)">{d.tauA_MPa} MPa</Row>
      <Row label="τ_m (mean)">{d.tauM_MPa} MPa</Row>
      <Row label="S_se (endur)">{d.Sse_MPa} MPa</Row>
      <Row label="Goodman n_f">{d.n_f}</Row>
      <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Badge ok={analysis.pass.stress} testid="forge-spring-stress-pass"
               labelOk="Static stress ✓" labelFail="Static stress ✗" />
        <Badge ok={analysis.pass.buckling} testid="forge-spring-buckling-pass"
               labelOk={`Lf/D ${d.bucklingRatio}<2.6 ✓`}
               labelFail={`Lf/D ${d.bucklingRatio}≥2.6 ✗`} />
        <Badge ok={analysis.pass.fatigue} testid="forge-spring-fatigue-pass"
               labelOk={`Fatigue n_f=${d.n_f}≥1.2 ✓`}
               labelFail={`Fatigue n_f=${d.n_f}<1.2 ✗`} />
        <Badge ok={analysis.pass.indexInRange} testid="forge-spring-index-pass"
               labelOk={`Index C=${d.C} in 4–12 ✓`}
               labelFail={`Index C=${d.C} out 4–12 ✗`} />
      </div>
    </div>
  );
}

function ExtensionTab({ onGenerate }) {
  const [materialId, setMaterialId] = useState('astm-a229');
  const [wireDia, setWireDia] = useState('2.5');
  const [meanDia, setMeanDia] = useState('20');
  const [Nactive, setNactive] = useState('12');
  const [Fmin, setFmin] = useState('20');
  const [Fmax, setFmax] = useState('120');
  const [Fi,   setFi]   = useState('15');
  const [reliab, setReliab] = useState('99');
  const [peened, setPeened] = useState(false);

  const params = useMemo(() => ({
    materialId,
    wireDia_mm: parseFloat(wireDia) || 0,
    meanDia_mm: parseFloat(meanDia) || 0,
    N_active:   parseFloat(Nactive) || 0,
    F_min_N: parseFloat(Fmin) || 0,
    F_max_N: parseFloat(Fmax) || 0,
    initialTension_N: parseFloat(Fi) || 0,
    reliability_pct: parseFloat(reliab) || 99,
    peened,
  }), [materialId, wireDia, meanDia, Nactive, Fmin, Fmax, Fi, reliab, peened]);

  const analysis = useMemo(() => {
    try { return analyzeExtensionSpring(params); }
    catch (e) { return { error: e.message }; }
  }, [params]);

  return (
    <>
      <div style={sectionStyle} data-testid="forge-spring-form-extension">
        <div style={sectionTitleStyle}>Inputs · Extension spring</div>
        <SelectField label="Material" value={materialId} onChange={setMaterialId}
                     testid="forge-spring-mat-extension"
                     options={SPRING_MATERIALS.map((m) => ({ value: m.id, label: m.name }))} />
        <NumField label="Wire dia d (mm)" value={wireDia} onChange={setWireDia}
                  testid="forge-spring-d-extension" />
        <NumField label="Mean dia D (mm)" value={meanDia} onChange={setMeanDia}
                  testid="forge-spring-D-extension" />
        <NumField label="Active coils Nₐ" value={Nactive} onChange={setNactive}
                  testid="forge-spring-N-extension" />
        <NumField label="F min (N)" value={Fmin} onChange={setFmin}
                  testid="forge-spring-Fmin-extension" />
        <NumField label="F max (N)" value={Fmax} onChange={setFmax}
                  testid="forge-spring-Fmax-extension" />
        <NumField label="Initial tension Fi (N)" value={Fi} onChange={setFi}
                  testid="forge-spring-Fi-extension" />
        <SelectField label="Reliability (%)" value={reliab} onChange={setReliab}
                     testid="forge-spring-reliab-extension"
                     options={RELIABILITY_PCTS.map((p) => ({ value: String(p), label: `${p}%` }))} />
        <div style={fieldRowStyle}>
          <span style={labelStyle}>Shot-peened</span>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={peened}
                   data-testid="forge-spring-peened-extension"
                   onChange={(e) => setPeened(e.target.checked)} />
            <span style={{ color: '#9aa1ad', fontSize: 11 }}>Shot-peened</span>
          </label>
        </div>
      </div>
      <ExtensionResults analysis={analysis} />
    </>
  );
}

function ExtensionResults({ analysis }) {
  if (!analysis || analysis.error) {
    return (
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Analysis</div>
        <div style={{ color: '#ff8a96' }}>{analysis?.error || 'Enter parameters.'}</div>
      </div>
    );
  }
  const d = analysis.display;
  return (
    <div style={sectionStyle} data-testid="forge-spring-results-extension">
      <div style={sectionTitleStyle}>Results · Extension analysis</div>
      <Row label="Spring index C">{d.C}</Row>
      <Row label="Rate k">{d.rate_N_per_mm} N/mm</Row>
      <Row label="τ body">{d.tauBody_MPa} MPa</Row>
      <Row label="τ_allow body">{d.tauAllowBody_MPa} MPa</Row>
      <Row label="σ hook">{d.sigmaHook_MPa} MPa</Row>
      <Row label="τ_allow hook">{d.tauAllowHook_MPa} MPa</Row>
      <Row label="σ_uts">{d.sigmaUts_MPa} MPa</Row>
      <Row label="Body length Lf">{d.Lf_body_mm} mm</Row>
      <Row label="Deflection max">{d.deflection_mm} mm</Row>
      <Row label="Goodman n_f">{d.n_f}</Row>
      <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Badge ok={analysis.pass.body}     testid="forge-spring-body-pass"
               labelOk="Body stress ✓"     labelFail="Body stress ✗" />
        <Badge ok={analysis.pass.hook}     testid="forge-spring-hook-pass"
               labelOk="Hook stress ✓"     labelFail="Hook stress ✗" />
        <Badge ok={analysis.pass.fatigue}  testid="forge-spring-fatigue-pass-ext"
               labelOk={`Fatigue ${d.n_f}≥1.2 ✓`}
               labelFail={`Fatigue ${d.n_f}<1.2 ✗`} />
      </div>
    </div>
  );
}

function TorsionTab() {
  const [materialId, setMaterialId] = useState('astm-a231');
  const [wireDia, setWireDia] = useState('3.0');
  const [meanDia, setMeanDia] = useState('22');
  const [Nactive, setNactive] = useState('10');
  const [Mmin, setMmin] = useState('0.50');
  const [Mmax, setMmax] = useState('2.50');
  const [reliab, setReliab] = useState('99');
  const [peened, setPeened] = useState(false);

  const params = useMemo(() => ({
    materialId,
    wireDia_mm: parseFloat(wireDia) || 0,
    meanDia_mm: parseFloat(meanDia) || 0,
    N_active:   parseFloat(Nactive) || 0,
    M_min_Nm: parseFloat(Mmin) || 0,
    M_max_Nm: parseFloat(Mmax) || 0,
    reliability_pct: parseFloat(reliab) || 99,
    peened,
  }), [materialId, wireDia, meanDia, Nactive, Mmin, Mmax, reliab, peened]);

  const analysis = useMemo(() => {
    try { return analyzeTorsionSpring(params); }
    catch (e) { return { error: e.message }; }
  }, [params]);

  return (
    <>
      <div style={sectionStyle} data-testid="forge-spring-form-torsion">
        <div style={sectionTitleStyle}>Inputs · Torsion spring</div>
        <SelectField label="Material" value={materialId} onChange={setMaterialId}
                     testid="forge-spring-mat-torsion"
                     options={SPRING_MATERIALS.map((m) => ({ value: m.id, label: m.name }))} />
        <NumField label="Wire dia d (mm)" value={wireDia} onChange={setWireDia}
                  testid="forge-spring-d-torsion" />
        <NumField label="Mean dia D (mm)" value={meanDia} onChange={setMeanDia}
                  testid="forge-spring-D-torsion" />
        <NumField label="Active coils Nₐ" value={Nactive} onChange={setNactive}
                  testid="forge-spring-N-torsion" />
        <NumField label="M min (N·m)" value={Mmin} onChange={setMmin}
                  testid="forge-spring-Mmin-torsion" />
        <NumField label="M max (N·m)" value={Mmax} onChange={setMmax}
                  testid="forge-spring-Mmax-torsion" />
        <SelectField label="Reliability (%)" value={reliab} onChange={setReliab}
                     testid="forge-spring-reliab-torsion"
                     options={RELIABILITY_PCTS.map((p) => ({ value: String(p), label: `${p}%` }))} />
        <div style={fieldRowStyle}>
          <span style={labelStyle}>Shot-peened</span>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={peened}
                   data-testid="forge-spring-peened-torsion"
                   onChange={(e) => setPeened(e.target.checked)} />
            <span style={{ color: '#9aa1ad', fontSize: 11 }}>Shot-peened</span>
          </label>
        </div>
      </div>
      <TorsionResults analysis={analysis} />
    </>
  );
}

function TorsionResults({ analysis }) {
  if (!analysis || analysis.error) {
    return (
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Analysis</div>
        <div style={{ color: '#ff8a96' }}>{analysis?.error || 'Enter parameters.'}</div>
      </div>
    );
  }
  const d = analysis.display;
  return (
    <div style={sectionStyle} data-testid="forge-spring-results-torsion">
      <div style={sectionTitleStyle}>Results · Torsion analysis</div>
      <Row label="Spring index C">{d.C}</Row>
      <Row label="Wahl bend Kb">{d.Kb}</Row>
      <Row label="σ bend (max)">{d.sigmaBend_MPa} MPa</Row>
      <Row label="σ_allow (static)">{d.sigmaAllow_MPa} MPa</Row>
      <Row label="σ_uts">{d.sigmaUts_MPa} MPa</Row>
      <Row label="Rate k_M (rev)">{d.rate_Nm_per_rev} N·m/rev</Row>
      <Row label="Rate k_M (deg)">{d.rate_Nm_per_deg} N·m/deg</Row>
      <Row label="Goodman n_f">{d.n_f}</Row>
      <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Badge ok={analysis.pass.stress}  testid="forge-spring-bend-pass"
               labelOk="Bend stress ✓"    labelFail="Bend stress ✗" />
        <Badge ok={analysis.pass.fatigue} testid="forge-spring-fatigue-pass-tor"
               labelOk={`Fatigue ${d.n_f}≥1.2 ✓`}
               labelFail={`Fatigue ${d.n_f}<1.2 ✗`} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Atoms
// ─────────────────────────────────────────────────────────────────────

function Row({ label, children }) {
  return (
    <div style={resultRowStyle}>
      <span style={{ color: '#9aa1ad' }}>{label}</span>
      <span style={{ color: '#ebecef', textAlign: 'right' }}>{children}</span>
    </div>
  );
}
function Badge({ ok, labelOk, labelFail, testid }) {
  return (
    <span style={ok ? okBadge : failBadge}
          data-testid={testid}
          data-pass={ok ? 'true' : 'false'}>
      {ok ? labelOk : labelFail}
    </span>
  );
}
function NumField({ label, value, onChange, testid }) {
  return (
    <div style={fieldRowStyle}>
      <span style={labelStyle}>{label}</span>
      <input style={inputStyle} value={value}
             data-testid={testid}
             onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
function SelectField({ label, value, onChange, options, testid }) {
  return (
    <div style={fieldRowStyle}>
      <span style={labelStyle}>{label}</span>
      <select style={selectStyle} value={value}
              data-testid={testid}
              onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Panel
// ─────────────────────────────────────────────────────────────────────

export function SpringDesignerPanel({ open, onClose, onGenerate }) {
  const [tab, setTab] = useState('compression');
  if (!open) return null;
  return (
    <div style={panelStyle} data-testid="forge-spring-designer">
      <header style={headerStyle}>
        <span style={{ fontWeight: 600 }}>Spring Designer</span>
        <span style={{ color: '#7f8694', fontSize: 11 }}>
          Forge-167 · Wahl / Goodman / ASTM
        </span>
        <button style={closeBtn} onClick={onClose}
                data-testid="forge-spring-close">×</button>
      </header>
      <nav style={tabsStyle}>
        {TAB_DEFS.map((t) => (
          <button key={t.id} style={tabBtn(tab === t.id)}
                  data-testid={`forge-spring-tab-${t.id}`}
                  data-active={tab === t.id ? 'true' : 'false'}
                  onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div style={bodyStyle}>
        {tab === 'compression' && <CompressionTab onGenerate={onGenerate} />}
        {tab === 'extension'   && <ExtensionTab   onGenerate={onGenerate} />}
        {tab === 'torsion'     && <TorsionTab />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host
// ─────────────────────────────────────────────────────────────────────

export function SpringDesignerPanelHost() {
  const [open, setOpen] = useState(false);
  const [generated, setGenerated] = useState([]);  // snapshot cache
  const mountedRef = useRef(false);
  const versionRef = useRef(0);

  useEffect(() => {
    if (mountedRef.current) return undefined;
    mountedRef.current = true;
    if (typeof window === 'undefined') return undefined;

    window.__forgeOpenSpringDesigner = (v) => {
      setOpen(typeof v === 'boolean' ? v : true);
    };
    window.__forgeCloseSpringDesigner = () => setOpen(false);

    const onEvt = () => setOpen(true);
    window.addEventListener(SPRING_PANEL_EVENT, onEvt);

    const onClick = (e) => {
      const tab = e.target?.closest?.('[data-wb="spring"]');
      if (tab) setOpen(true);
    };
    document.addEventListener('click', onClick, true);

    return () => {
      window.removeEventListener(SPRING_PANEL_EVENT, onEvt);
      document.removeEventListener('click', onClick, true);
    };
  }, []);

  const handleGenerate = useCallback((body, params, analysis) => {
    versionRef.current += 1;
    setGenerated((arr) => [...arr, { body, params, analysis, v: versionRef.current }]);

    if (typeof window === 'undefined') return;
    window.__forgeSpringDesigner = Object.freeze({
      version: versionRef.current,
      lastGenerated: { id: body.id, params, analysis },
    });

    // Convert to a body the shell can render via buildSyntheticGeometry.
    // We expose a synthetic 'cylinder' bounding form because the shell's
    // synthetic switch doesn't yet have a 'helicalSweep' case; the real
    // helical mesh is attached as `mesh` for downstream consumers.
    const synthetic = {
      kind: 'cylinder',
      r: body.synthetic.meanRadius_m * 1000 + body.synthetic.wireRadius_m * 1000,
      h: body.synthetic.freeLength_m * 1000,
      segments: 36,
    };
    const wireBody = {
      id: body.id,
      kind: 'synthetic',
      synthetic,
      label: `Spring (Lf=${(body.synthetic.freeLength_m*1000).toFixed(1)}mm, ` +
             `D=${(body.synthetic.meanRadius_m*2000).toFixed(1)}mm, ` +
             `d=${(body.synthetic.wireRadius_m*2000).toFixed(2)}mm)`,
      spring: {
        helicalSweep: body.synthetic,
        mesh: body.mesh,
        params,
        analysis: {
          C: analysis.display.C,
          rate_N_per_mm: analysis.display.rate_N_per_mm,
          Lf_mm: analysis.display.Lf_mm,
          tau_MPa: analysis.display.tauAtFmax_MPa,
          n_f: analysis.display.n_f,
        },
      },
    };
    window.__forgeAppendBody?.(wireBody);
    window.dispatchEvent(new CustomEvent('forge:body-added', { detail: wireBody }));
  }, []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <SpringDesignerPanel open={open}
                         onClose={() => setOpen(false)}
                         onGenerate={handleGenerate} />,
    document.body);
}

export default SpringDesignerPanel;
