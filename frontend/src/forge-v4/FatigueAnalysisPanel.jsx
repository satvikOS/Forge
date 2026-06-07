// PUSH-119 (Slice-87) — Fatigue Analysis (S-N curve) panel.
//
// PUSH-48 wired the omnibus Simulation workbench with 10 study types
// including a fatigue-life solver. Forge-212 (the legacy FatigueLifeWorkbench
// at tools.fatigue) exposes Basquin + Miner's rule against the kernel's
// `forge.fatigue` calculator — load blocks → cumulative damage. Useful, but
// the user has to type stress amplitudes by hand.
//
// PUSH-119 is the engineering-workflow companion: a single-purpose panel
// that closes the loop between a body, its material, and a finished static
// FEA solve. Specifically the panel:
//
//   1. Picks a body from the live scene (defaults to the selected body if
//      window.__forgeSelection points at one).
//   2. Reads the body's PUSH-109 material record at
//      window.__forgeMaterialProperties[handle] — specifically yield σY,
//      ultimate σU. If no material yet, the user is pointed at PUSH-109.
//   3. Lets the user either type a stress amplitude (MPa) directly, OR
//      pull the max von Mises from the most recent static FEA solve
//      (PUSH-48 publishes its last result on window.__forgeSimulationLast).
//   4. Mean-stress correction selector: None / Goodman / Soderberg.
//        - None       : σ_eff = σ_a
//        - Goodman    : σ_eff = σ_a / (1 - σ_m / σU)         (denom > 0)
//        - Soderberg  : σ_eff = σ_a / (1 - σ_m / σY)         (denom > 0)
//      σ_m defaults to 0 (fully reversed loading) but is editable.
//   5. Runs the kernel S-N curve via forge.fatigue.materialDefaults +
//      forge.fatigue.cyclesToFailure (Basquin's law N = ½·(σ_a/σ'_f)^(1/b)).
//      The user picks one of the calibrated kernel materials (mild-steel /
//      4340 / 7075-T6 / 2024-T3 / Ti-6Al-4V / ductile-iron) to seed σ'_f + b.
//   6. Output: cycles to failure (linear + log10), plus a regime label
//      ("Infinite life" if Nf > 1e6, "Finite life" otherwise) — the
//      conventional 1-million-cycle endurance threshold for steels.
//   7. Optional warning ribbon if σ_eff > σU (overload, not fatigue).
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD — same rule as every Forge panel.
//
// Persistence: lightweight — last-used inputs + last result summary land
// on window.__forgeFatigueAnalysis so the e2e + a future Archie tool can
// read them without DOM scraping. The helper is exposed on
// window.__forgeFatigueAnalysisHelper.
//
// Reachable via tools.fatigueAnalysis menu action. The host listens to
// `forge:menu-action` directly so no ForgeShellV4 switch change is needed.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

const KERNEL_MATERIALS = Object.freeze([
  'mild-steel',
  '4340-steel',
  '7075-T6',
  '2024-T3',
  'Ti-6Al-4V',
  'ductile-iron',
]);

export const CORRECTION_KINDS = Object.freeze(['none', 'goodman', 'soderberg']);

const PRESET_LABEL = Object.freeze({
  'mild-steel':   'Mild Steel (1018/1020)',
  '4340-steel':   '4340 Steel',
  '7075-T6':      'Aluminium 7075-T6',
  '2024-T3':      'Aluminium 2024-T3',
  'Ti-6Al-4V':    'Titanium Ti-6Al-4V',
  'ductile-iron': 'Ductile Iron 65-45-12',
});

// ─────────────────────────────────────────────────────────────────────
// Body + material helpers — mirrors PUSH-114 / PUSH-115 patterns.

function listNativeBodies() {
  if (typeof window === 'undefined') return [];
  const arr = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return arr.filter((b) => b && typeof b.handle === 'number');
}

function preferredBody() {
  const all = listNativeBodies();
  if (all.length === 0) return null;
  if (typeof window !== 'undefined') {
    const sel = window.__forgeSelection;
    if (sel && typeof sel.bodyHandle === 'number') {
      const m = all.find((b) => b.handle === sel.bodyHandle);
      if (m) return m;
    }
  }
  return all[all.length - 1];
}

function bodyLabel(b) {
  if (!b) return 'None';
  return b.name || b.id || `handle ${b.handle}`;
}

/**
 * Pull the PUSH-109 yield / ultimate (MPa) off
 * window.__forgeMaterialProperties[handle]. Returns null if the body
 * has no material record (caller surfaces the "pick a material" hint).
 *
 * PUSH-109 stores σY + σU in MPa already (the units the panel surfaces
 * to the user), so we do no unit conversion here — Goodman + Soderberg
 * normalise σ_m by σU + σY, both in the same MPa space as σ_a.
 */
export function readMaterialForHandle(handle) {
  if (typeof window === 'undefined' || !Number.isFinite(handle)) return null;
  const map = window.__forgeMaterialProperties;
  if (!map || typeof map !== 'object') return null;
  const rec = map[handle];
  if (!rec || typeof rec !== 'object') return null;
  const sigmaY_MPa = Number(rec.sigmaY);
  const sigmaU_MPa = Number(rec.sigmaU);
  if (!Number.isFinite(sigmaY_MPa) || sigmaY_MPa <= 0) return null;
  if (!Number.isFinite(sigmaU_MPa) || sigmaU_MPa <= 0) return null;
  return {
    sigmaY_MPa,
    sigmaU_MPa,
    E_GPa: Number.isFinite(rec.E) ? Number(rec.E) : 0,
    density_gcc: Number.isFinite(rec.density) ? Number(rec.density) : 0,
  };
}

/**
 * Read the max von Mises off the most-recent PUSH-48 static solve.
 *
 * PUSH-48's SimulationWorkbench publishes its last static result on
 * window.__forgeSimulationLast = { maxVonMises, maxDisplacement, ... }.
 * We accept multiple shapes for robustness — direct number, nested
 * `result.vonMises[]`, or `result.stress[]`.
 *
 * Returns max von Mises in MPa (PUSH-48 kernel returns Pa; we convert
 * Pa→MPa so the panel's σ-amplitude stays in one consistent unit).
 */
export function readLastVonMisesMPa() {
  if (typeof window === 'undefined') return null;
  const last = window.__forgeSimulationLast;
  if (!last || typeof last !== 'object') return null;
  // Numeric short-cut (the panel + e2e may stash a pre-converted scalar).
  if (typeof last.maxVonMisesMPa === 'number' && Number.isFinite(last.maxVonMisesMPa)
      && last.maxVonMisesMPa >= 0) {
    return last.maxVonMisesMPa;
  }
  // Pa scalar.
  if (typeof last.maxVonMises === 'number' && Number.isFinite(last.maxVonMises)
      && last.maxVonMises >= 0) {
    return last.maxVonMises / 1e6;
  }
  // Array forms.
  const arr = (last.result && (last.result.vonMises || last.result.stress))
    || last.vonMises || last.stress;
  if (Array.isArray(arr) || ArrayBuffer.isView(arr)) {
    let m = 0;
    for (let i = 0; i < arr.length; i++) {
      const v = Number(arr[i]);
      if (Number.isFinite(v) && v > m) m = v;
    }
    return m > 0 ? m / 1e6 : null;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Kernel dispatch + analytical core.

function kernelFatigue() {
  if (typeof window === 'undefined') return null;
  const f = window.forge;
  if (!f || !f.fatigue) return null;
  return f.fatigue;
}

/**
 * Apply the chosen mean-stress correction:
 *
 *   None       : σ_eff = σ_a
 *   Goodman    : σ_eff = σ_a / (1 - σ_m / σU)
 *   Soderberg  : σ_eff = σ_a / (1 - σ_m / σY)
 *
 * If σ_m ≥ σU (Goodman) or σ_m ≥ σY (Soderberg), the denominator goes
 * non-positive → static failure region (return Infinity so cyclesToFailure
 * collapses to 0 cycles, surfaced to the user as "Static failure" upstream).
 */
export function correctedAmplitude(kind, sigma_a, sigma_m, sigmaY_MPa, sigmaU_MPa) {
  if (!(sigma_a > 0)) return 0;
  const m = Math.max(0, Number(sigma_m) || 0);
  switch (kind) {
    case 'goodman': {
      if (!(sigmaU_MPa > 0)) return sigma_a;
      const denom = 1 - (m / sigmaU_MPa);
      if (denom <= 0) return Infinity;
      return sigma_a / denom;
    }
    case 'soderberg': {
      if (!(sigmaY_MPa > 0)) return sigma_a;
      const denom = 1 - (m / sigmaY_MPa);
      if (denom <= 0) return Infinity;
      return sigma_a / denom;
    }
    case 'none':
    default:
      return sigma_a;
  }
}

/**
 * Real-kernel Basquin S-N solve.
 *
 *   sigma_a_MPa   — stress amplitude (already mean-stress corrected)
 *   materialName  — one of KERNEL_MATERIALS for forge.fatigue.materialDefaults
 *
 * Returns { Nf, log10Nf, sigmaFCoef, bExponent, error? }.
 * No fallback table — if the kernel fatigue surface is missing, the
 * caller gets a hard error.
 */
export function basquinCycles(sigma_a_MPa, materialName) {
  const fat = kernelFatigue();
  if (!fat) return { error: 'forge.fatigue kernel not ready' };
  if (!KERNEL_MATERIALS.includes(materialName)) {
    return { error: `unknown material '${materialName}'` };
  }
  if (!(sigma_a_MPa > 0) || !Number.isFinite(sigma_a_MPa)) {
    return { error: 'stress amplitude must be > 0 MPa' };
  }
  let mat;
  try { mat = fat.materialDefaults(materialName); }
  catch (err) {
    return { error: `materialDefaults: ${err && err.message ? err.message : String(err)}` };
  }
  let Nf;
  try { Nf = fat.cyclesToFailure(sigma_a_MPa, mat.sigmaFCoef, mat.bExponent); }
  catch (err) {
    return { error: `cyclesToFailure: ${err && err.message ? err.message : String(err)}` };
  }
  if (!Number.isFinite(Nf) || Nf <= 0) {
    return { error: `kernel returned non-positive Nf = ${Nf}` };
  }
  return {
    Nf,
    log10Nf: Math.log10(Nf),
    sigmaFCoef: mat.sigmaFCoef,
    bExponent:  mat.bExponent,
  };
}

/**
 * Driver: body handle + inputs → result publishable + on-screen.
 * Stamps the run summary onto window.__forgeFatigueAnalysis.
 */
export function runFatigueAnalysis(input) {
  const {
    bodyHandle,
    sigma_a_MPa,
    sigma_m_MPa,
    correction,
    materialName,
    bodyMaterial,
  } = input;
  const sigmaY = bodyMaterial && bodyMaterial.sigmaY_MPa > 0 ? bodyMaterial.sigmaY_MPa : 0;
  const sigmaU = bodyMaterial && bodyMaterial.sigmaU_MPa > 0 ? bodyMaterial.sigmaU_MPa : 0;
  const sigma_eff = correctedAmplitude(
    correction || 'none', sigma_a_MPa, sigma_m_MPa || 0, sigmaY, sigmaU,
  );
  if (sigma_eff === Infinity) {
    const summary = {
      error: 'mean stress ≥ ultimate (Goodman) / yield (Soderberg) — static failure region',
      bodyHandle, sigma_a_MPa, sigma_m_MPa, correction, materialName,
      sigma_eff: Infinity, Nf: 0, log10Nf: -Infinity,
      timestamp: Date.now(),
    };
    if (typeof window !== 'undefined') {
      window.__forgeFatigueAnalysis = summary;
      try {
        window.dispatchEvent(new CustomEvent('forge:fatigue-analysis-run',
          { detail: { bodyHandle, Nf: 0, error: summary.error } }));
      } catch { /* ignore */ }
    }
    return summary;
  }
  const overload = sigmaU > 0 && sigma_eff > sigmaU;
  const basquin = basquinCycles(sigma_eff, materialName);
  const summary = {
    bodyHandle, sigma_a_MPa, sigma_m_MPa, correction, materialName,
    sigmaY_MPa: sigmaY, sigmaU_MPa: sigmaU,
    sigma_eff_MPa: sigma_eff,
    overload,
    ...(basquin.error
      ? { error: basquin.error, Nf: 0, log10Nf: -Infinity }
      : {
          Nf: basquin.Nf,
          log10Nf: basquin.log10Nf,
          sigmaFCoef: basquin.sigmaFCoef,
          bExponent:  basquin.bExponent,
          regime:     basquin.Nf >= 1e6 ? 'infinite' : 'finite',
        }),
    timestamp: Date.now(),
  };
  if (typeof window !== 'undefined') {
    window.__forgeFatigueAnalysis = summary;
    try {
      window.dispatchEvent(new CustomEvent('forge:fatigue-analysis-run', {
        detail: {
          bodyHandle,
          Nf: summary.Nf,
          regime: summary.regime,
          sigma_eff: sigma_eff,
        },
      }));
    } catch { /* ignore */ }
  }
  return summary;
}

if (typeof window !== 'undefined') {
  window.__forgeFatigueAnalysisHelper = Object.freeze({
    runFatigueAnalysis,
    basquinCycles,
    correctedAmplitude,
    readMaterialForHandle,
    readLastVonMisesMPa,
    KERNEL_MATERIALS,
    CORRECTION_KINDS,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 480,
  zIndex: 1338,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)',
  fontSize: 12,
  overflowY: 'auto',
};

const labelStyle = { display: 'flex', alignItems: 'center', gap: 8 };

const inputStyle = {
  background: 'var(--forge-canvas)',
  color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 4,
  padding: '3px 6px',
  fontFamily: 'var(--forge-mono)',
  fontSize: 11,
  width: '100%',
};

const subSectionStyle = {
  background: 'var(--forge-canvas)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 4,
  padding: '6px 8px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const correctionRadioStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontFamily: 'var(--forge-mono)',
  fontSize: 11,
  cursor: 'pointer',
};

export function FatigueAnalysisPanel({ open, onClose }) {
  const [bodies, setBodies] = useState(() => listNativeBodies());
  const [bodyHandle, setBodyHandle] = useState(() => preferredBody()?.handle ?? null);
  const [materialName, setMaterialName] = useState('mild-steel');
  const [sigmaA, setSigmaA] = useState(200);          // MPa
  const [sigmaM, setSigmaM] = useState(0);            // MPa, mean
  const [correction, setCorrection] = useState('none');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [feaReadTag, setFeaReadTag] = useState(0);    // bumps when σ_a is
                                                       // pulled from FEA so
                                                       // the readout updates

  // Refresh body list when the panel opens or scene changes.
  useEffect(() => {
    if (!open) return undefined;
    const refresh = () => {
      const all = listNativeBodies();
      setBodies(all);
      const sel = (typeof window !== 'undefined' && window.__forgeSelection)
        ? window.__forgeSelection.bodyHandle : null;
      const pickHandle = (typeof sel === 'number' && all.some((b) => b.handle === sel))
        ? sel
        : (bodyHandle != null && all.some((b) => b.handle === bodyHandle))
          ? bodyHandle
          : (all[all.length - 1]?.handle ?? null);
      setBodyHandle(pickHandle);
    };
    refresh();
    const onSel = () => refresh();
    const onMat = () => refresh();
    window.addEventListener('forge:selection-changed', onSel);
    window.addEventListener('forge:material-properties-applied', onMat);
    return () => {
      window.removeEventListener('forge:selection-changed', onSel);
      window.removeEventListener('forge:material-properties-applied', onMat);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeBody = useMemo(
    () => bodies.find((b) => b.handle === bodyHandle) || null,
    [bodies, bodyHandle],
  );

  const bodyMaterial = useMemo(
    () => activeBody ? readMaterialForHandle(activeBody.handle) : null,
    [activeBody, bodies, result], // refresh after Apply / Run
  );

  const onPickBody = useCallback((e) => {
    const h = Number(e?.target?.value);
    if (!Number.isFinite(h)) return;
    setBodyHandle(h);
    setResult(null);
    setError(null);
  }, []);

  const onPickMaterial = useCallback((e) => {
    const name = e?.target?.value;
    if (typeof name === 'string' && KERNEL_MATERIALS.includes(name)) {
      setMaterialName(name);
      setResult(null);
    }
  }, []);

  const onChangeSigmaA = useCallback((e) => {
    const v = Number(e?.target?.value);
    if (Number.isFinite(v) && v >= 0) setSigmaA(v);
  }, []);

  const onChangeSigmaM = useCallback((e) => {
    const v = Number(e?.target?.value);
    if (Number.isFinite(v) && v >= 0) setSigmaM(v);
  }, []);

  const onPickCorrection = useCallback((kind) => {
    if (CORRECTION_KINDS.includes(kind)) {
      setCorrection(kind);
      setResult(null);
    }
  }, []);

  const onPullVonMises = useCallback(() => {
    const vm = readLastVonMisesMPa();
    if (vm == null || !(vm > 0)) {
      setError('No PUSH-48 static result on window.__forgeSimulationLast — run Simulation first.');
      return;
    }
    setSigmaA(Number(vm.toFixed(3)));
    setError(null);
    setFeaReadTag((t) => t + 1);
  }, []);

  const onRun = useCallback(() => {
    setError(null);
    setResult(null);
    if (!activeBody) { setError('Pick a body first.'); return; }
    if (!(sigmaA > 0)) { setError('Stress amplitude must be > 0 MPa.'); return; }
    const summary = runFatigueAnalysis({
      bodyHandle: activeBody.handle,
      sigma_a_MPa: sigmaA,
      sigma_m_MPa: sigmaM,
      correction,
      materialName,
      bodyMaterial,
    });
    if (summary.error) {
      setError(summary.error);
      setResult(summary);   // still show the regime / σ_eff for context
    } else {
      setResult(summary);
    }
  }, [activeBody, sigmaA, sigmaM, correction, materialName, bodyMaterial]);

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-fatigue-analysis-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Fatigue Analysis (S-N curve)</strong>
        <button onClick={onClose}
                data-testid="forge-fatigue-analysis-close"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--forge-rail-edge)',
                  color: 'var(--forge-ink)',
                  cursor: 'pointer',
                  padding: '2px 6px',
                }}>
          ×
        </button>
      </header>

      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.4 }}>
        Basquin's law <code style={{ fontFamily: 'var(--forge-mono)' }}>
          N = ½·(σ_a/σ'_f)^(1/b)
        </code>. Stress amplitude can be typed or pulled from the
        most-recent PUSH-48 static solve. Mean-stress is corrected with
        Goodman (uses σU) or Soderberg (uses σY) — both read from the
        body's PUSH-109 material record.
      </div>

      <label style={labelStyle}>
        Body:
        <select data-testid="forge-fatigue-analysis-body"
                value={bodyHandle ?? ''}
                onChange={onPickBody}
                style={{ ...inputStyle, flex: 1, width: 'auto' }}>
          {bodies.length === 0 && (
            <option value="">— no bodies in scene —</option>
          )}
          {bodies.map((b) => (
            <option key={b.handle} value={b.handle}>
              {bodyLabel(b)} (h:{b.handle})
            </option>
          ))}
        </select>
      </label>

      <div data-testid="forge-fatigue-analysis-material"
           style={{
             background: 'var(--forge-canvas)',
             border: '1px solid var(--forge-rail-edge)',
             borderRadius: 4,
             padding: '6px 8px',
             fontFamily: 'var(--forge-mono)',
             fontSize: 11,
             color: bodyMaterial ? 'var(--forge-ink)' : 'var(--forge-warn, #c9a23a)',
           }}>
        {bodyMaterial ? (
          <>
            <span data-testid="forge-fatigue-analysis-material-sigmaY">
              σY = {bodyMaterial.sigmaY_MPa.toFixed(0)} MPa
            </span>
            {'  ·  '}
            <span data-testid="forge-fatigue-analysis-material-sigmaU">
              σU = {bodyMaterial.sigmaU_MPa.toFixed(0)} MPa
            </span>
            {bodyMaterial.E_GPa > 0 && (
              <>
                {'  ·  '}
                <span>E = {bodyMaterial.E_GPa.toFixed(1)} GPa</span>
              </>
            )}
          </>
        ) : (
          <span>No material set for this body — open Material Properties (FEA) and Apply a preset.</span>
        )}
      </div>

      <label style={labelStyle}>
        S-N material (kernel):
        <select data-testid="forge-fatigue-analysis-kernel-material"
                value={materialName}
                onChange={onPickMaterial}
                style={{ ...inputStyle, flex: 1, width: 'auto' }}>
          {KERNEL_MATERIALS.map((m) => (
            <option key={m} value={m}>{PRESET_LABEL[m] || m}</option>
          ))}
        </select>
      </label>

      <section style={subSectionStyle} data-testid="forge-fatigue-analysis-stress-section">
        <div style={{ color: 'var(--forge-ink-mute)' }}>Stress inputs (MPa)</div>
        <label style={labelStyle}>
          σ_a amplitude:
          <input type="number"
                 min={0} step={1}
                 data-testid="forge-fatigue-analysis-sigma-a"
                 data-fea-read-tag={feaReadTag}
                 value={sigmaA}
                 onChange={onChangeSigmaA}
                 style={{ ...inputStyle, width: 100 }} />
          <button data-testid="forge-fatigue-analysis-pull-vm"
                  onClick={onPullVonMises}
                  style={{
                    background: 'var(--forge-canvas-2)',
                    color: 'var(--forge-ink)',
                    border: '1px solid var(--forge-rail-edge)',
                    borderRadius: 4,
                    padding: '3px 8px',
                    cursor: 'pointer',
                    fontFamily: 'var(--forge-mono)',
                    fontSize: 10,
                  }}>
            Pull max von Mises (PUSH-48)
          </button>
        </label>
        <label style={labelStyle}>
          σ_m mean:
          <input type="number"
                 min={0} step={1}
                 data-testid="forge-fatigue-analysis-sigma-m"
                 value={sigmaM}
                 onChange={onChangeSigmaM}
                 style={{ ...inputStyle, width: 100 }} />
          <span style={{ color: 'var(--forge-ink-mute)', fontSize: 10 }}>
            (0 = fully reversed)
          </span>
        </label>
      </section>

      <section style={subSectionStyle} data-testid="forge-fatigue-analysis-correction-section">
        <div style={{ color: 'var(--forge-ink-mute)' }}>Mean-stress correction</div>
        <div style={{ display: 'flex', gap: 12 }}>
          {CORRECTION_KINDS.map((k) => (
            <label key={k}
                   style={correctionRadioStyle}
                   data-testid={`forge-fatigue-analysis-correction-${k}-label`}>
              <input type="radio"
                     data-testid={`forge-fatigue-analysis-correction-${k}`}
                     name="forge-fatigue-correction"
                     value={k}
                     checked={correction === k}
                     onChange={() => onPickCorrection(k)} />
              {k === 'none' ? 'None' : k.charAt(0).toUpperCase() + k.slice(1)}
            </label>
          ))}
        </div>
      </section>

      <footer style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={onRun}
                data-testid="forge-fatigue-analysis-run"
                disabled={!activeBody || !(sigmaA > 0)}
                style={{
                  background: 'var(--forge-accent, #2f80ed)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  padding: '6px 14px',
                  cursor: (activeBody && sigmaA > 0) ? 'pointer' : 'not-allowed',
                  fontWeight: 600,
                }}>
          Compute Nf
        </button>
        <span data-testid="forge-fatigue-analysis-status"
              style={{
                color: error
                  ? 'var(--forge-bad, #ff6363)'
                  : (result && !result.error ? 'var(--forge-good, #5fb05f)' : 'var(--forge-ink-mute)'),
                fontSize: 11,
              }}>
          {error
            ? `Error · ${error}`
            : result && !result.error
              ? `Solved · Nf = ${Number(result.Nf).toExponential(2)}`
              : (activeBody ? `Ready · ${bodyLabel(activeBody)}` : 'No body selected')}
        </span>
      </footer>

      {result && !result.error && (
        <section data-testid="forge-fatigue-analysis-result"
                 style={{
                   background: 'var(--forge-canvas)',
                   border: '1px solid var(--forge-rail-edge)',
                   borderRadius: 4,
                   padding: 'var(--forge-space-2)',
                   fontFamily: 'var(--forge-mono)',
                   fontSize: 11,
                 }}>
          <div data-testid="forge-fatigue-analysis-regime"
               data-regime={result.regime}
               style={{
                 color: result.regime === 'infinite' ? '#4ade80' : '#c9a23a',
                 fontWeight: 700,
                 fontSize: 13,
                 marginBottom: 4,
               }}>
            {result.regime === 'infinite'
              ? 'INFINITE LIFE (Nf ≥ 1e6 cycles)'
              : 'FINITE LIFE (Nf < 1e6 cycles)'}
          </div>
          <div data-testid="forge-fatigue-analysis-nf">
            Nf = <span data-testid="forge-fatigue-analysis-nf-value">{Number(result.Nf).toExponential(4)}</span> cycles
          </div>
          <div data-testid="forge-fatigue-analysis-log10nf">
            log₁₀(Nf) = <span data-testid="forge-fatigue-analysis-log10nf-value">{Number(result.log10Nf).toFixed(3)}</span>
          </div>
          <div data-testid="forge-fatigue-analysis-sigma-eff">
            σ_eff = {Number(result.sigma_eff_MPa).toFixed(2)} MPa
            {result.correction !== 'none' && (
              <span style={{ color: 'var(--forge-ink-mute)' }}>
                {' '}(from σ_a = {Number(result.sigma_a_MPa).toFixed(2)}, σ_m = {Number(result.sigma_m_MPa).toFixed(2)}, {result.correction})
              </span>
            )}
          </div>
          <div style={{ color: 'var(--forge-ink-mute)' }}>
            σ'f = {Number(result.sigmaFCoef).toFixed(0)} MPa, b = {Number(result.bExponent).toFixed(3)}
          </div>
          {result.overload && (
            <div data-testid="forge-fatigue-analysis-overload"
                 style={{ color: 'var(--forge-bad, #ff6363)', marginTop: 4 }}>
              Warning: σ_eff &gt; σU — static overload, not fatigue.
            </div>
          )}
        </section>
      )}

      {error && (
        <div data-testid="forge-fatigue-analysis-error"
             style={{ color: 'var(--forge-bad, #ff6363)', fontSize: 11 }}>
          {error}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — wires the menu action + imperative open/close hook.

export function FatigueAnalysisHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenFatigueAnalysis  = () => setOpen(true);
    window.__forgeCloseFatigueAnalysis = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.fatigueAnalysis' || id === 'workbench.fatigueAnalysis') {
        setOpen(true);
      }
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <FatigueAnalysisPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default FatigueAnalysisPanel;
