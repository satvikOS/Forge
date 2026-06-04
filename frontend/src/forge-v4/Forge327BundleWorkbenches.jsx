// Forge-327 bundle — Mohr-Coulomb + stair + snow on PV + NRC + adiabatic compressor.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function MohrCoulombWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [c, setC] = useState(10);
    const [phi, setPhi] = useState(30);
    const [sn, setSn] = useState(100);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenMohrCoulombWorkbench  = () => setOpen(true);
        window.__forgeCloseMohrCoulombWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenMohrCoulombWorkbench; delete window.__forgeCloseMohrCoulombWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.mohrcoulomb?.analyse({cohesionKpa:Number(c), frictionAngleDeg:Number(phi), normalStressKpa:Number(sn)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-mc-panel" title="Mohr-Coulomb shear" onClose={() => setOpen(false)}>
            <Row label="c (kPa) cohesion" v={c} set={setC}/>
            <Row label="φ (°) friction" v={phi} set={setPhi}/>
            <Row label="σ_n (kPa) normal" v={sn} set={setSn}/>
            <Btn testid="forge-mc-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-mc-result">
                <Ln k="c contrib" v={r.cohesionContributionKpa.toFixed(2) + ' kPa'}/>
                <Ln k="σ·tan φ" v={r.frictionContributionKpa.toFixed(2) + ' kPa'}/>
                <Big testid="forge-mc-tau" colour="#3fb950">τ_f = {r.shearStrengthKpa.toFixed(2)} kPa</Big>
            </Res>}
        </P>, document.body);
}

export function StairWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [H, setH] = useState(3200);
    const [maxR, setMaxR] = useState(178);
    const [minT, setMinT] = useState(279);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenStairWorkbench  = () => setOpen(true);
        window.__forgeCloseStairWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenStairWorkbench; delete window.__forgeCloseStairWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.stair?.analyse({floorToFloorHeightMm:Number(H), maxRiserMm:Number(maxR), minTreadMm:Number(minT)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-stair-panel" title="Stair · IBC 2021 §1011" onClose={() => setOpen(false)}>
            <Row label="floor-to-floor (mm)" v={H} set={setH}/>
            <Row label="max riser (178 mm)" v={maxR} set={setMaxR}/>
            <Row label="min tread (279 mm)" v={minT} set={setMinT}/>
            <Btn testid="forge-stair-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-stair-result">
                <Ln k="risers" v={r.numberOfRisers + ' × ' + r.actualRiserMm.toFixed(1) + ' mm'}/>
                <Ln k="run" v={r.totalRunMm + ' mm'}/>
                <Ln k="pitch" v={r.pitchAngleDeg.toFixed(1) + '°'}/>
                <Ln k="R+T" v={r.riserPlusTreadMm.toFixed(1) + ' mm'}/>
                <Banner testid="forge-stair-comply" colour={r.overallCompliant ? '#3fb950' : '#f85149'}>
                    {r.overallCompliant ? 'IBC + Blondel pass' : 'CODE FAIL'}
                </Banner>
            </Res>}
        </P>, document.body);
}

export function SnowOnPVWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [pg, setPg] = useState(1.5);
    const [theta, setTheta] = useState(25);
    const [ct, setCt] = useState(1.0);
    const [ce, setCe] = useState(1.0);
    const [Is, setIs] = useState(1.0);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenSnowPVWorkbench  = () => setOpen(true);
        window.__forgeCloseSnowPVWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenSnowPVWorkbench; delete window.__forgeCloseSnowPVWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.snowpv?.analyse({groundSnowKnM2:Number(pg), slopeAngleDeg:Number(theta), thermalC_t:Number(ct), exposureC_e:Number(ce), importanceI_s:Number(Is)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-spv-panel" title="Snow on PV · ASCE 7-22 §7.13" onClose={() => setOpen(false)}>
            <Row label="p_g (kN/m²)" v={pg} set={setPg}/>
            <Row label="slope θ (°)" v={theta} set={setTheta}/>
            <Row label="c_t thermal (1.0)" v={ct} set={setCt}/>
            <Row label="c_e exposure (1.0)" v={ce} set={setCe}/>
            <Row label="I_s importance" v={Is} set={setIs}/>
            <Btn testid="forge-spv-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-spv-result">
                <Ln k="C_s slope" v={r.slopeCoefficient_C_s.toFixed(3)}/>
                <Ln k="p_f flat" v={r.flatRoofSnowKnM2.toFixed(3) + ' kN/m²'}/>
                <Big testid="forge-spv-ps" colour="#3fb950">p_s = {r.slopedRoofSnowKnM2.toFixed(3)} kN/m²</Big>
            </Res>}
        </P>, document.body);
}

export function NRCWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [a250, setA250] = useState(0.40);
    const [a500, setA500] = useState(0.65);
    const [a1000, setA1000] = useState(0.80);
    const [a2000, setA2000] = useState(0.75);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenNRCWorkbench  = () => setOpen(true);
        window.__forgeCloseNRCWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenNRCWorkbench; delete window.__forgeCloseNRCWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.nrc?.analyse({alpha250:Number(a250), alpha500:Number(a500), alpha1000:Number(a1000), alpha2000:Number(a2000)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-nrc-panel" title="NRC · ASTM C423" onClose={() => setOpen(false)}>
            <Row label="α @ 250 Hz" v={a250} set={setA250}/>
            <Row label="α @ 500 Hz" v={a500} set={setA500}/>
            <Row label="α @ 1000 Hz" v={a1000} set={setA1000}/>
            <Row label="α @ 2000 Hz" v={a2000} set={setA2000}/>
            <Btn testid="forge-nrc-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-nrc-result">
                <Ln k="NRC raw" v={r.nrcRaw.toFixed(4)}/>
                <Big testid="forge-nrc-r" colour={r.meetsAbsorbentClass ? '#3fb950' : '#d29922'}>NRC = {r.nrcRounded.toFixed(2)}</Big>
            </Res>}
        </P>, document.body);
}

export function AdiabaticCompressorWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [T1, setT1] = useState(20);
    const [P1, setP1] = useState(100);
    const [P2, setP2] = useState(800);
    const [k, setK] = useState(1.4);
    const [eta, setEta] = useState(0.80);
    const [M, setM] = useState(29);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenAdiabaticCompWorkbench  = () => setOpen(true);
        window.__forgeCloseAdiabaticCompWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenAdiabaticCompWorkbench; delete window.__forgeCloseAdiabaticCompWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.adiabatic?.analyse({inletTempC:Number(T1), inletPressureKpaAbs:Number(P1), dischargePressureKpaAbs:Number(P2), kRatio:Number(k), isentropicEfficiency:Number(eta), molecularWeight:Number(M)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-acmp-panel" title="Adiabatic compressor" onClose={() => setOpen(false)}>
            <Row label="T_1 (°C)" v={T1} set={setT1}/>
            <Row label="P_1 (kPa abs)" v={P1} set={setP1}/>
            <Row label="P_2 (kPa abs)" v={P2} set={setP2}/>
            <Row label="k = C_p/C_v" v={k} set={setK}/>
            <Row label="η isentropic" v={eta} set={setEta}/>
            <Row label="M (g/mol)" v={M} set={setM}/>
            <Btn testid="forge-acmp-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-acmp-result">
                <Ln k="P_2/P_1" v={r.pressureRatio.toFixed(2)}/>
                <Ln k="T_2s" v={r.isentropicDischargeTempC.toFixed(1) + ' °C'}/>
                <Big testid="forge-acmp-T2" colour={r.actualDischargeTempC > 175 ? '#f85149' : '#3fb950'}>
                    T_2 = {r.actualDischargeTempC.toFixed(1)} °C
                </Big>
                <Ln k="c_p" v={r.specificHeatCpKJpkgK.toFixed(3) + ' kJ/kg·K'}/>
                <Big testid="forge-acmp-w" colour="#58a6ff">w_in = {r.specificWorkKJpkg.toFixed(1)} kJ/kg</Big>
            </Res>}
        </P>, document.body);
}

function P({ testid, title, onClose, children }) {
    return <div data-testid={testid} style={{position:'fixed', top:90, right:24, width:400, background:'#161b22', color:'#c9d1d9', border:'1px solid #30363d', borderRadius:8, padding:18, zIndex:5000, fontFamily:'system-ui, sans-serif', fontSize:13, boxShadow:'0 10px 30px rgba(0,0,0,0.6)'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
            <strong style={{fontSize:14}}>{title}</strong>
            <button onClick={onClose} style={{background:'transparent', color:'#8b949e', border:'none', cursor:'pointer'}}>×</button>
        </div>
        {children}
    </div>;
}
function Row({ label, v, set }) {
    return <div style={{display:'flex', alignItems:'center', margin:'5px 0'}}>
        <span style={{width:200}}>{label}</span>
        <input type="number" value={v} onChange={(e) => set(e.target.value)} style={{flex:1, background:'#0d1117', color:'#c9d1d9', border:'1px solid #30363d', borderRadius:4, padding:4}}/>
    </div>;
}
function Btn({ testid, onClick }) {
    return <button data-testid={testid} onClick={onClick} style={{marginTop:10, width:'100%', padding:8, background:'#238636', border:'none', borderRadius:4, color:'#fff', cursor:'pointer', fontWeight:600}}>Compute</button>;
}
function Err({ msg }) { return <div style={{marginTop:8, color:'#f85149', fontSize:12}}>{msg}</div>; }
function Res({ testid, children }) {
    return <div data-testid={testid} style={{marginTop:12, padding:10, background:'#0d1117', borderRadius:4, border:'1px solid #30363d', fontSize:12}}>{children}</div>;
}
function Ln({ k, v }) {
    return <div style={{display:'flex', justifyContent:'space-between', padding:'2px 0'}}>
        <span style={{color:'#8b949e'}}>{k}</span><span>{v}</span></div>;
}
function Big({ testid, colour, children }) {
    return <div data-testid={testid} style={{marginTop:6, fontWeight:700, color:colour}}>{children}</div>;
}
function Banner({ testid, colour, children }) {
    return <div data-testid={testid} style={{marginTop:8, padding:'4px 8px', borderRadius:4,
        background:colour === '#3fb950' ? '#1d2d1d' : '#3d1d1d',
        color:colour, fontWeight:700, textAlign:'center'}}>{children}</div>;
}
