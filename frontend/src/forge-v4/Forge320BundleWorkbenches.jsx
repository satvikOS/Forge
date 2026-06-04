// Forge-320 bundle — 5 calcs: rebar dev, ChW pump, genset, RO, U-value.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function RebarDevWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [db, setDb] = useState(19);
    const [fc, setFc] = useState(28);
    const [fy, setFy] = useState(420);
    const [pt, setPt] = useState(1.0);
    const [pe, setPe] = useState(1.0);
    const [ps, setPs] = useState(0.8);
    const [lam, setLam] = useState(1.0);
    const [cb, setCb] = useState(50);
    const [Kt, setKt] = useState(0);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenRebarDevWorkbench  = () => setOpen(true);
        window.__forgeCloseRebarDevWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenRebarDevWorkbench; delete window.__forgeCloseRebarDevWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => {
        try {
            setR(window.forge?.rebardev?.analyse({
                barDiameter_db_mm:Number(db), fc_MPa:Number(fc), fy_MPa:Number(fy),
                psi_t:Number(pt), psi_e:Number(pe), psi_s:Number(ps), lambda:Number(lam),
                clearCover_cb_mm:Number(cb), Ktr_mm:Number(Kt),
            })); setE(null);
        } catch (ex) { setE(String(ex.message || ex)); setR(null); }
    };
    return createPortal(
        <P testid="forge-rd-panel" title="Rebar development · ACI §25.4.2" onClose={() => setOpen(false)}>
            <Row label="d_b (mm)" v={db} set={setDb}/>
            <Row label="f'_c (MPa)" v={fc} set={setFc}/>
            <Row label="f_y (MPa)" v={fy} set={setFy}/>
            <Row label="ψ_t (1.0 / 1.3)" v={pt} set={setPt}/>
            <Row label="ψ_e (1.0 / 1.5)" v={pe} set={setPe}/>
            <Row label="ψ_s (0.8 / 1.0)" v={ps} set={setPs}/>
            <Row label="λ (1.0 / 0.75)" v={lam} set={setLam}/>
            <Row label="c_b (mm)" v={cb} set={setCb}/>
            <Row label="K_tr (mm)" v={Kt} set={setKt}/>
            <Btn testid="forge-rd-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-rd-result">
                <Ln k="(c_b+K_tr)/d_b" v={r.cbKtrOverDb.toFixed(2) + (r.cbKtrOverDb === 2.5 ? ' (capped)' : '')}/>
                <Ln k="raw ℓ_d" v={r.rawLengthMm.toFixed(1) + ' mm'}/>
                <Big testid="forge-rd-ld" colour="#3fb950">ℓ_d = {r.developmentLengthMm.toFixed(1)} mm</Big>
            </Res>}
        </P>, document.body);
}

export function ChilledWaterPumpWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Q, setQ] = useState(1000);
    const [dT, setDT] = useState(6);
    const [H, setH] = useState(30);
    const [ep, setEp] = useState(0.75);
    const [em, setEm] = useState(0.93);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenChWPumpWorkbench  = () => setOpen(true);
        window.__forgeCloseChWPumpWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenChWPumpWorkbench; delete window.__forgeCloseChWPumpWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => {
        try {
            setR(window.forge?.chwpump?.analyse({
                coolingLoadKw:Number(Q), designDeltaTKelvin:Number(dT),
                pumpHeadM:Number(H), pumpEfficiency:Number(ep), motorEfficiency:Number(em),
            })); setE(null);
        } catch (ex) { setE(String(ex.message || ex)); setR(null); }
    };
    return createPortal(
        <P testid="forge-chw-panel" title="Chilled-water pump" onClose={() => setOpen(false)}>
            <Row label="Q (kW) cooling load" v={Q} set={setQ}/>
            <Row label="ΔT (K) chilled water" v={dT} set={setDT}/>
            <Row label="H (m) pump head" v={H} set={setH}/>
            <Row label="η_pump" v={ep} set={setEp}/>
            <Row label="η_motor" v={em} set={setEm}/>
            <Btn testid="forge-chw-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-chw-result">
                <Ln k="ṁ" v={r.massFlowKgPerS.toFixed(2) + ' kg/s'}/>
                <Ln k="V̇" v={r.volumeFlowLPerS.toFixed(2) + ' L/s'}/>
                <Ln k="P_hyd" v={(r.hydraulicPowerW/1000).toFixed(2) + ' kW'}/>
                <Big testid="forge-chw-pelec" colour="#3fb950">P_elec = {(r.electricalPowerW/1000).toFixed(2)} kW</Big>
            </Res>}
        </P>, document.body);
}

export function GensetWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [kW, setKW] = useState(500);
    const [div, setDiv] = useState(0.8);
    const [pf, setPf] = useState(0.85);
    const [alt, setAlt] = useState(2000);
    const [T, setT] = useState(45);
    const [fc, setFc] = useState(0.27);
    const [rt, setRt] = useState(8);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenGensetWorkbench  = () => setOpen(true);
        window.__forgeCloseGensetWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenGensetWorkbench; delete window.__forgeCloseGensetWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => {
        try {
            setR(window.forge?.genset?.analyse({
                connectedLoadKw:Number(kW), diversityFactor:Number(div), powerFactor:Number(pf),
                altitudeM:Number(alt), ambientTempC:Number(T),
                fuelConsumptionLPerKwh:Number(fc), designRuntimeHr:Number(rt),
            })); setE(null);
        } catch (ex) { setE(String(ex.message || ex)); setR(null); }
    };
    return createPortal(
        <P testid="forge-gs-panel" title="Diesel genset · sizing" onClose={() => setOpen(false)}>
            <Row label="ΣkW connected" v={kW} set={setKW}/>
            <Row label="diversity factor" v={div} set={setDiv}/>
            <Row label="cos φ" v={pf} set={setPf}/>
            <Row label="altitude (m)" v={alt} set={setAlt}/>
            <Row label="T_amb (°C)" v={T} set={setT}/>
            <Row label="fuel L/kWh (~0.27)" v={fc} set={setFc}/>
            <Row label="runtime (h)" v={rt} set={setRt}/>
            <Btn testid="forge-gs-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-gs-result">
                <Ln k="alt derate" v={r.altitudeDerateFactor.toFixed(3)}/>
                <Ln k="temp derate" v={r.temperatureDerateFactor.toFixed(3)}/>
                <Ln k="demand" v={r.demandKvaRaw.toFixed(1) + ' kVA'}/>
                <Big testid="forge-gs-kva" colour="#3fb950">Nameplate = {r.requiredKvaNameplate.toFixed(1)} kVA</Big>
                <Big testid="forge-gs-fuel" colour="#58a6ff">Fuel = {r.fuelTankLiters.toFixed(0)} L</Big>
            </Res>}
        </P>, document.body);
}

export function ReverseOsmosisWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Q, setQ] = useState(100);
    const [R, setR] = useState(0.5);
    const [tds, setTds] = useState(2000);
    const [P, setP] = useState(15);
    const [T, setT] = useState(25);
    const [i, setI] = useState(2);
    const [res, setRes] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenROWorkbench  = () => setOpen(true);
        window.__forgeCloseROWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenROWorkbench; delete window.__forgeCloseROWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => {
        try {
            setRes(window.forge?.reverseosmosis?.analyse({
                feedFlowLpm:Number(Q), recoveryFraction:Number(R), feedTdsPpm:Number(tds),
                appliedPressureBar:Number(P), temperatureC:Number(T), vantHoffFactorI:Number(i),
            })); setE(null);
        } catch (ex) { setE(String(ex.message || ex)); setRes(null); }
    };
    return createPortal(
        <P testid="forge-ro-panel" title="Reverse osmosis · membrane" onClose={() => setOpen(false)}>
            <Row label="Q_feed (L/min)" v={Q} set={setQ}/>
            <Row label="Recovery (0-1)" v={R} set={setR}/>
            <Row label="Feed TDS (ppm)" v={tds} set={setTds}/>
            <Row label="ΔP applied (bar)" v={P} set={setP}/>
            <Row label="T (°C)" v={T} set={setT}/>
            <Row label="i van't Hoff" v={i} set={setI}/>
            <Btn testid="forge-ro-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {res && <Res testid="forge-ro-result">
                <Ln k="Q_perm" v={res.permeateFlowLpm.toFixed(2) + ' L/min'}/>
                <Ln k="Q_conc" v={res.concentrateFlowLpm.toFixed(2) + ' L/min'}/>
                <Ln k="CF" v={res.concentrationFactor.toFixed(2)}/>
                <Ln k="Brine TDS" v={res.brineTdsPpm.toFixed(0) + ' ppm'}/>
                <Ln k="π_avg" v={res.averageOsmoticPressureKpa.toFixed(0) + ' kPa'}/>
                <Big testid="forge-ro-NDP" colour={res.pressureSufficient ? '#3fb950' : '#f85149'}>
                    NDP = {res.netDrivingPressureKpa.toFixed(0)} kPa
                </Big>
            </Res>}
        </P>, document.body);
}

export function EnvelopeWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [layers, setLayers] = useState([
        { thicknessMm: 200, conductivityWmk: 1.7 },
        { thicknessMm: 100, conductivityWmk: 0.025 },
        { thicknessMm: 12, conductivityWmk: 0.17 },
    ]);
    const [Rin, setRin] = useState(0.13);
    const [Rout, setRout] = useState(0.04);
    const [A, setA] = useState(100);
    const [dT, setDT] = useState(25);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenEnvelopeWorkbench  = () => setOpen(true);
        window.__forgeCloseEnvelopeWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenEnvelopeWorkbench; delete window.__forgeCloseEnvelopeWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => {
        try {
            setR(window.forge?.envelope?.analyse({
                layers, interiorFilmRSI:Number(Rin), exteriorFilmRSI:Number(Rout),
                areaM2:Number(A), designDeltaTKelvin:Number(dT),
            })); setE(null);
        } catch (ex) { setE(String(ex.message || ex)); setR(null); }
    };
    const updateLayer = (i, key, val) => {
        const ls = layers.slice();
        ls[i] = { ...ls[i], [key]: Number(val) };
        setLayers(ls);
    };
    return createPortal(
        <P testid="forge-uv-panel" title="Envelope U-value · ASHRAE" onClose={() => setOpen(false)}>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>Layers (outermost first)</div>
            {layers.map((L, i) => (
                <div key={i} style={{ display: 'flex', gap: 4, margin: '4px 0' }}>
                    <input type="number" value={L.thicknessMm} onChange={(e) => updateLayer(i, 'thicknessMm', e.target.value)}
                           style={{ flex: 1, background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d',
                                    borderRadius: 4, padding: 4 }} placeholder="d mm"/>
                    <input type="number" value={L.conductivityWmk} step="0.01"
                           onChange={(e) => updateLayer(i, 'conductivityWmk', e.target.value)}
                           style={{ flex: 1, background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d',
                                    borderRadius: 4, padding: 4 }} placeholder="k W/m·K"/>
                </div>
            ))}
            <Row label="R_si (interior)" v={Rin} set={setRin}/>
            <Row label="R_so (exterior)" v={Rout} set={setRout}/>
            <Row label="Area (m²)" v={A} set={setA}/>
            <Row label="ΔT (K)" v={dT} set={setDT}/>
            <Btn testid="forge-uv-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-uv-result">
                <Ln k="ΣR_layer" v={r.layerSumRSI.toFixed(3) + ' m²K/W'}/>
                <Ln k="R_total" v={r.totalRSI.toFixed(3) + ' m²K/W'}/>
                <Big testid="forge-uv-u" colour="#3fb950">U = {r.uValueWm2K.toFixed(3)} W/m²K</Big>
                <Big testid="forge-uv-Q" colour="#58a6ff">Q = {r.heatFlowW.toFixed(0)} W</Big>
            </Res>}
        </P>, document.body);
}

// shared UI
function P({ testid, title, onClose, children }) {
    return <div data-testid={testid} style={{
        position:'fixed', top:90, right:24, width:400, background:'#161b22', color:'#c9d1d9',
        border:'1px solid #30363d', borderRadius:8, padding:18, zIndex:5000,
        fontFamily:'system-ui, sans-serif', fontSize:13, boxShadow:'0 10px 30px rgba(0,0,0,0.6)'}}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <strong style={{ fontSize:14 }}>{title}</strong>
            <button onClick={onClose} style={{ background:'transparent', color:'#8b949e', border:'none', cursor:'pointer' }}>×</button>
        </div>
        {children}
    </div>;
}
function Row({ label, v, set }) {
    return <div style={{ display:'flex', alignItems:'center', margin:'5px 0' }}>
        <span style={{ width:170 }}>{label}</span>
        <input type="number" value={v} onChange={(e) => set(e.target.value)}
               style={{ flex:1, background:'#0d1117', color:'#c9d1d9', border:'1px solid #30363d', borderRadius:4, padding:4 }}/>
    </div>;
}
function Btn({ testid, onClick }) {
    return <button data-testid={testid} onClick={onClick}
        style={{ marginTop:10, width:'100%', padding:8, background:'#238636', border:'none', borderRadius:4,
                 color:'#fff', cursor:'pointer', fontWeight:600 }}>Compute</button>;
}
function Err({ msg }) { return <div style={{ marginTop:8, color:'#f85149', fontSize:12 }}>{msg}</div>; }
function Res({ testid, children }) {
    return <div data-testid={testid} style={{ marginTop:12, padding:10, background:'#0d1117', borderRadius:4,
        border:'1px solid #30363d', fontSize:12 }}>{children}</div>;
}
function Ln({ k, v }) {
    return <div style={{ display:'flex', justifyContent:'space-between', padding:'2px 0' }}>
        <span style={{ color:'#8b949e' }}>{k}</span><span>{v}</span></div>;
}
function Big({ testid, colour, children }) {
    return <div data-testid={testid} style={{ marginTop:6, fontWeight:700, color:colour }}>{children}</div>;
}
