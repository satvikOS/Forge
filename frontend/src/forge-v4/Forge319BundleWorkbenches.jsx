// Forge-319 bundle — 5 calc workbenches: hydraulic jump, buried pipe,
// IEEE 80 grounding, pile group, basement uplift.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// ============================================================================
// Hydraulic jump
// ============================================================================
export function HydraulicJumpWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [b,  setB]  = useState(10);
    const [y1, setY1] = useState(0.5);
    const [Q,  setQ]  = useState(20);
    const [g,  setG]  = useState(9.81);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenHydraulicJumpWorkbench  = () => setOpen(true);
        window.__forgeCloseHydraulicJumpWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenHydraulicJumpWorkbench;
            delete window.__forgeCloseHydraulicJumpWorkbench;
        };
    }, []);
    if (!open) return null;

    const run = () => {
        try {
            const res = window.forge?.hydjump?.analyse({
                channelWidthB_m: Number(b), upstreamDepthY1_m: Number(y1),
                dischargeQM3PerS: Number(Q), gravityMs2: Number(g),
            });
            setResult(res); setError(null);
        } catch (e) { setError(String(e.message || e)); setResult(null); }
    };

    return createPortal(
        <Panel testid="forge-hj-panel" title="Hydraulic jump · Belanger" onClose={() => setOpen(false)}>
            <Row label="b (m) channel width"      v={b}  set={setB}/>
            <Row label="y_1 (m) upstream depth"   v={y1} set={setY1}/>
            <Row label="Q (m³/s) discharge"       v={Q}  set={setQ}/>
            <Row label="g (m/s²)"                 v={g}  set={setG}/>
            <RunButton testid="forge-hj-run" onClick={run}/>
            {error && <Err msg={error}/>}
            {result && (
                <Result testid="forge-hj-result">
                    <Line k="Fr_1"   v={result.upstreamFroudeNumber.toFixed(3)}/>
                    <Line k="V_1"    v={result.upstreamVelocityV1_ms.toFixed(2) + ' m/s'}/>
                    <Big testid="forge-hj-y2" colour="#3fb950">y_2 = {result.sequentDepthY2_m.toFixed(3)} m</Big>
                    <Line k="Fr_2"   v={result.downstreamFroudeNumber.toFixed(3)}/>
                    <Big testid="forge-hj-dE" colour="#58a6ff">ΔE = {result.energyHeadLossM.toFixed(3)} m</Big>
                    <Line k="L_jump" v={result.jumpLengthM.toFixed(2) + ' m'}/>
                    <Banner testid="forge-hj-type" colour="#d29922">Jump type: {result.jumpType}</Banner>
                </Result>
            )}
        </Panel>, document.body);
}

// ============================================================================
// Buried-pipe Marston earth load
// ============================================================================
export function BuriedPipeWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Bd,  setBd]  = useState(1.5);
    const [H,   setH]   = useState(4);
    const [phi, setPhi] = useState(30);
    const [g,   setG]   = useState(18);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenBuriedPipeWorkbench  = () => setOpen(true);
        window.__forgeCloseBuriedPipeWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenBuriedPipeWorkbench;
            delete window.__forgeCloseBuriedPipeWorkbench;
        };
    }, []);
    if (!open) return null;

    const run = () => {
        try {
            const res = window.forge?.buriedpipe?.analyse({
                trenchWidthBd_m: Number(Bd), fillHeightH_m: Number(H),
                soilFrictionAngleDeg: Number(phi), soilUnitWeightKnPerM3: Number(g),
            });
            setResult(res); setError(null);
        } catch (e) { setError(String(e.message || e)); setResult(null); }
    };

    return createPortal(
        <Panel testid="forge-marston-panel" title="Buried pipe · Marston load" onClose={() => setOpen(false)}>
            <Row label="B_d (m) trench width"  v={Bd}  set={setBd}/>
            <Row label="H (m) fill above pipe" v={H}   set={setH}/>
            <Row label="φ (°) soil friction"   v={phi} set={setPhi}/>
            <Row label="γ (kN/m³) soil"        v={g}   set={setG}/>
            <RunButton testid="forge-marston-run" onClick={run}/>
            {error && <Err msg={error}/>}
            {result && (
                <Result testid="forge-marston-result">
                    <Line k="K (Rankine)"  v={result.K_Rankine.toFixed(3)}/>
                    <Line k="μ′"           v={result.mu_prime.toFixed(3)}/>
                    <Line k="C_d"          v={result.C_d.toFixed(3)}/>
                    <Big testid="forge-marston-Wd" colour="#3fb950">W_d = {result.earthLoadKnPerM.toFixed(2)} kN/m</Big>
                </Result>
            )}
        </Panel>, document.body);
}

// ============================================================================
// IEEE 80 substation ground-grid
// ============================================================================
export function SubstationGroundWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [rho, setRho] = useState(100);
    const [A,   setA]   = useState(10000);
    const [L,   setL]   = useState(2000);
    const [h,   setH]   = useState(0.5);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenSubGndWorkbench  = () => setOpen(true);
        window.__forgeCloseSubGndWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenSubGndWorkbench;
            delete window.__forgeCloseSubGndWorkbench;
        };
    }, []);
    if (!open) return null;

    const run = () => {
        try {
            const res = window.forge?.subgnd?.analyse({
                soilResistivityOhmM: Number(rho), gridAreaM2: Number(A),
                totalConductorLengthM: Number(L), burialDepthM: Number(h),
            });
            setResult(res); setError(null);
        } catch (e) { setError(String(e.message || e)); setResult(null); }
    };

    return createPortal(
        <Panel testid="forge-subgnd-panel" title="Substation grounding · IEEE 80 Sverak" onClose={() => setOpen(false)}>
            <Row label="ρ (Ω·m) soil resistivity"  v={rho} set={setRho}/>
            <Row label="A (m²) grid area"          v={A}   set={setA}/>
            <Row label="L (m) total conductor"     v={L}   set={setL}/>
            <Row label="h (m) burial depth"        v={h}   set={setH}/>
            <RunButton testid="forge-subgnd-run" onClick={run}/>
            {error && <Err msg={error}/>}
            {result && (
                <Result testid="forge-subgnd-result">
                    <Big testid="forge-subgnd-Rg" colour={result.meetsIeee80Target ? '#3fb950' : '#f85149'}>
                        R_g = {result.gridResistanceOhm.toFixed(3)} Ω
                    </Big>
                    <Banner testid="forge-subgnd-pass"
                            colour={result.meetsIeee80Target ? '#3fb950' : '#f85149'}>
                        {result.meetsIeee80Target ? 'Meets IEEE 80 (≤ 1 Ω)' : 'EXCEEDS 1 Ω target'}
                    </Banner>
                </Result>
            )}
        </Panel>, document.body);
}

// ============================================================================
// Pile group efficiency Converse-Labarre
// ============================================================================
export function PileGroupWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [d, setD] = useState(300);
    const [s, setS] = useState(1000);
    const [m, setM] = useState(3);
    const [n, setN] = useState(3);
    const [Q, setQ] = useState(500);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenPileGroupWorkbench  = () => setOpen(true);
        window.__forgeClosePileGroupWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenPileGroupWorkbench;
            delete window.__forgeClosePileGroupWorkbench;
        };
    }, []);
    if (!open) return null;

    const run = () => {
        try {
            const res = window.forge?.pilegroup?.analyse({
                pileDiameterMm: Number(d), spacingMm: Number(s),
                rows_m: Math.round(Number(m)), columns_n: Math.round(Number(n)),
                singlePileCapacityKn: Number(Q),
            });
            setResult(res); setError(null);
        } catch (e) { setError(String(e.message || e)); setResult(null); }
    };

    return createPortal(
        <Panel testid="forge-pg-panel" title="Pile group · Converse-Labarre" onClose={() => setOpen(false)}>
            <Row label="d (mm) pile dia"        v={d} set={setD}/>
            <Row label="s (mm) c-c spacing"     v={s} set={setS}/>
            <Row label="m rows"                 v={m} set={setM}/>
            <Row label="n columns"              v={n} set={setN}/>
            <Row label="Q_single (kN) capacity" v={Q} set={setQ}/>
            <RunButton testid="forge-pg-run" onClick={run}/>
            {error && <Err msg={error}/>}
            {result && (
                <Result testid="forge-pg-result">
                    <Line k="θ = atan(d/s)" v={result.anglePhiDeg.toFixed(2) + '°'}/>
                    <Big testid="forge-pg-eta" colour="#d29922">η = {result.efficiency.toFixed(3)}</Big>
                    <Big testid="forge-pg-Q" colour="#3fb950">Q_group = {result.groupCapacityKn.toFixed(0)} kN</Big>
                </Result>
            )}
        </Panel>, document.body);
}

// ============================================================================
// Basement uplift / buoyancy
// ============================================================================
export function BasementUpliftWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [B,  setB]  = useState(20);
    const [N,  setN]  = useState(10);
    const [hw, setHw] = useState(3);
    const [qs, setQs] = useState(5);
    const [qo, setQo] = useState(8);
    const [gw, setGw] = useState(9.81);
    const [result, setResult] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        window.__forgeOpenBasementUpliftWorkbench  = () => setOpen(true);
        window.__forgeCloseBasementUpliftWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenBasementUpliftWorkbench;
            delete window.__forgeCloseBasementUpliftWorkbench;
        };
    }, []);
    if (!open) return null;

    const run = () => {
        try {
            const res = window.forge?.buoyancy?.analyse({
                basementWidthB_m: Number(B), basementLengthN_m: Number(N),
                waterHeadAboveSlabM: Number(hw),
                slabSelfWeightKnPerM2: Number(qs), overburdenKnPerM2: Number(qo),
                waterUnitWeightKnPerM3: Number(gw),
            });
            setResult(res); setError(null);
        } catch (e) { setError(String(e.message || e)); setResult(null); }
    };

    return createPortal(
        <Panel testid="forge-buoy-panel" title="Basement uplift · buoyancy" onClose={() => setOpen(false)}>
            <Row label="B (m) width"               v={B}  set={setB}/>
            <Row label="N (m) length"              v={N}  set={setN}/>
            <Row label="h_w (m) above slab"        v={hw} set={setHw}/>
            <Row label="q_slab (kN/m²)"            v={qs} set={setQs}/>
            <Row label="q_overburden (kN/m²)"      v={qo} set={setQo}/>
            <Row label="γ_w (kN/m³)"               v={gw} set={setGw}/>
            <RunButton testid="forge-buoy-run" onClick={run}/>
            {error && <Err msg={error}/>}
            {result && (
                <Result testid="forge-buoy-result">
                    <Line k="F_uplift"   v={result.upliftForceKn.toFixed(0) + ' kN'}/>
                    <Line k="W_total"    v={result.weightForceKn.toFixed(0) + ' kN'}/>
                    <Big testid="forge-buoy-FOS"
                         colour={result.passes ? '#3fb950' : '#f85149'}>
                        FOS = {result.factorOfSafety.toFixed(3)}
                    </Big>
                    <Banner testid="forge-buoy-pass"
                            colour={result.passes ? '#3fb950' : '#f85149'}>
                        {result.passes ? 'Uplift OK (FOS ≥ 1.10)' : 'UPLIFT FAILS'}
                    </Banner>
                </Result>
            )}
        </Panel>, document.body);
}

// ============================================================================
// Shared UI helpers
// ============================================================================
function Panel({ testid, title, onClose, children }) {
    return (
        <div data-testid={testid} style={{
            position: 'fixed', top: 90, right: 24, width: 400,
            background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d',
            borderRadius: 8, padding: 18, zIndex: 5000,
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>{title}</strong>
                <button onClick={onClose}
                        style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>
            {children}
        </div>
    );
}

function Row({ label, v, set }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', margin: '5px 0' }}>
            <span style={{ width: 180 }}>{label}</span>
            <input type="number" value={v} onChange={(e) => set(e.target.value)}
                   style={{ flex: 1, background: '#0d1117', color: '#c9d1d9',
                            border: '1px solid #30363d', borderRadius: 4, padding: '4px' }}/>
        </div>
    );
}

function RunButton({ testid, onClick }) {
    return (
        <button data-testid={testid} onClick={onClick}
                style={{ marginTop: 10, width: '100%', padding: 8,
                         background: '#238636', border: 'none', borderRadius: 4,
                         color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Compute</button>
    );
}

function Err({ msg }) {
    return <div style={{ marginTop: 8, color: '#f85149', fontSize: 12 }}>{msg}</div>;
}

function Result({ testid, children }) {
    return (
        <div data-testid={testid}
             style={{ marginTop: 12, padding: 10, background: '#0d1117',
                      borderRadius: 4, border: '1px solid #30363d', fontSize: 12 }}>
            {children}
        </div>
    );
}

function Line({ k, v }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
            <span style={{ color: '#8b949e' }}>{k}</span>
            <span>{v}</span>
        </div>
    );
}

function Big({ testid, colour, children }) {
    return (
        <div data-testid={testid}
             style={{ marginTop: 6, fontWeight: 700, color: colour }}>
            {children}
        </div>
    );
}

function Banner({ testid, colour, children }) {
    return (
        <div data-testid={testid}
             style={{ marginTop: 8, padding: '4px 8px', borderRadius: 4,
                      background: colour === '#3fb950' ? '#1d2d1d' :
                                  colour === '#f85149' ? '#3d1d1d' : '#3d2d0d',
                      color: colour, fontWeight: 700, textAlign: 'center' }}>
            {children}
        </div>
    );
}
