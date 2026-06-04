// Forge-328 bundle — mullion + sprinkler + sound prop + ISA + LPD.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function MullionWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [L, setL] = useState(3500);
    const [w, setW] = useState(1.5);
    const [tr, setTr] = useState(1500);
    const [E, setE_] = useState(70000);
    const [I, setI] = useState(2e6);
    const [div, setDiv] = useState(175);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenMullionWorkbench  = () => setOpen(true);
        window.__forgeCloseMullionWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenMullionWorkbench; delete window.__forgeCloseMullionWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.mullion?.analyse({spanLengthMm:Number(L), windPressureKnM2:Number(w), tributaryWidthMm:Number(tr), E_MPa:Number(E), momentOfInertiaMm4:Number(I), deflectionLimitDivisor:Number(div)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-mul-panel" title="Mullion deflection · AAMA" onClose={() => setOpen(false)}>
            <Row label="L (mm) span" v={L} set={setL}/>
            <Row label="w (kN/m²) wind" v={w} set={setW}/>
            <Row label="trib (mm)" v={tr} set={setTr}/>
            <Row label="E (MPa) — Al 70k" v={E} set={setE_}/>
            <Row label="I (mm⁴)" v={I} set={setI}/>
            <Row label="L/divisor (175 typ)" v={div} set={setDiv}/>
            <Btn testid="forge-mul-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-mul-result">
                <Ln k="δ midspan" v={r.midspanDeflectionMm.toFixed(2) + ' mm'}/>
                <Ln k="δ limit" v={r.deflectionLimitMm.toFixed(2) + ' mm'}/>
                <Banner testid="forge-mul-pass" colour={r.passes ? '#3fb950' : '#f85149'}>
                    {r.passes ? 'Deflection OK' : 'EXCEEDS LIMIT'}
                </Banner>
            </Res>}
        </P>, document.body);
}

export function SprinklerWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [K, setK] = useState(5.6);
    const [met, setMet] = useState(false);
    const [P, setP] = useState(10);
    const [d, setD] = useState(6.1);
    const [A, setA] = useState(144);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenSprinklerWorkbench  = () => setOpen(true);
        window.__forgeCloseSprinklerWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenSprinklerWorkbench; delete window.__forgeCloseSprinklerWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.sprinkler?.analyse({kFactorUSorMetric:Number(K), metricInputs:Boolean(met), pressurePsi_or_bar:Number(P), designDensityMmPerMin:Number(d), operationAreaM2:Number(A)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-spr-panel" title="Sprinkler K-factor · NFPA 13" onClose={() => setOpen(false)}>
            <Row label="K (5.6 SR / 8.0 EC)" v={K} set={setK}/>
            <label style={{display:'flex', alignItems:'center', margin:'6px 0', fontSize:12}}>
                <input type="checkbox" checked={met} onChange={(e) => setMet(e.target.checked)} style={{marginRight:8}}/>
                Metric K + bar
            </label>
            <Row label="P (psi or bar)" v={P} set={setP}/>
            <Row label="density (mm/min)" v={d} set={setD}/>
            <Row label="area (m²)" v={A} set={setA}/>
            <Btn testid="forge-spr-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-spr-result">
                <Big testid="forge-spr-Q" colour="#3fb950">Q = {r.sprinklerFlowGpm.toFixed(1)} gpm</Big>
                <Ln k="= L/min" v={r.sprinklerFlowLpm.toFixed(1)}/>
                <Ln k="req hazard" v={r.requiredAreaFlowLpm.toFixed(0) + ' L/min'}/>
            </Res>}
        </P>, document.body);
}

export function SoundPropWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Lw, setLw] = useState(90);
    const [r_, setR_] = useState(10);
    const [Q, setQ] = useState(2);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenSoundPropWorkbench  = () => setOpen(true);
        window.__forgeCloseSoundPropWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenSoundPropWorkbench; delete window.__forgeCloseSoundPropWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.soundprop?.analyse({soundPowerLevelDbW:Number(Lw), distanceM:Number(r_), directivityQ:Number(Q)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-sp-panel" title="Sound L_w → L_p" onClose={() => setOpen(false)}>
            <Row label="L_w (dB)" v={Lw} set={setLw}/>
            <Row label="r (m)" v={r_} set={setR_}/>
            <Row label="Q dir (1/2/4/8)" v={Q} set={setQ}/>
            <Btn testid="forge-sp-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-sp-result">
                <Ln k="loss" v={r.inverseSquareLossDb.toFixed(1) + ' dB'}/>
                <Big testid="forge-sp-Lp" colour="#3fb950">L_p = {r.soundPressureLevelDbA.toFixed(1)} dB</Big>
            </Res>}
        </P>, document.body);
}

export function ISAWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [h, setH] = useState(5000);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenISAWorkbench  = () => setOpen(true);
        window.__forgeCloseISAWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenISAWorkbench; delete window.__forgeCloseISAWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.isa?.analyse({altitudeM:Number(h)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-isa-panel" title="Standard atmosphere · ICAO" onClose={() => setOpen(false)}>
            <Row label="altitude (m)" v={h} set={setH}/>
            <Btn testid="forge-isa-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-isa-result">
                <Big testid="forge-isa-T" colour="#3fb950">T = {r.temperatureC.toFixed(2)} °C</Big>
                <Ln k="p" v={r.pressureKpa.toFixed(2) + ' kPa'}/>
                <Ln k="ρ" v={r.densityKgM3.toFixed(4) + ' kg/m³'}/>
                <Big testid="forge-isa-a" colour="#58a6ff">a = {r.speedOfSoundMs.toFixed(1)} m/s</Big>
            </Res>}
        </P>, document.body);
}

export function LPDWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [sp, setSp] = useState('office');
    const [A, setA] = useState(200);
    const [P, setP] = useState(150);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenLPDWorkbench  = () => setOpen(true);
        window.__forgeCloseLPDWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenLPDWorkbench; delete window.__forgeCloseLPDWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.lpd?.analyse({spaceType:sp, floorAreaM2:Number(A), installedPowerW:Number(P)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-lpd-panel" title="LPD · ASHRAE 90.1" onClose={() => setOpen(false)}>
            <div style={{display:'flex', alignItems:'center', margin:'5px 0'}}>
                <span style={{width:200}}>space type</span>
                <select value={sp} onChange={(e) => setSp(e.target.value)}
                        style={{flex:1, background:'#0d1117', color:'#c9d1d9', border:'1px solid #30363d', borderRadius:4, padding:4}}>
                    {['office','retail','classroom','warehouse','hospital','garage','restaurant','hotel','industrial'].map(s =>
                        <option key={s} value={s}>{s}</option>)}
                </select>
            </div>
            <Row label="A (m²)" v={A} set={setA}/>
            <Row label="P installed (W)" v={P} set={setP}/>
            <Btn testid="forge-lpd-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-lpd-result">
                <Ln k="allowance" v={r.allowanceWperM2 + ' W/m²'}/>
                <Ln k="allowed" v={r.allowedPowerW + ' W'}/>
                <Big testid="forge-lpd-over" colour={r.compliant ? '#3fb950' : '#f85149'}>
                    {r.compliant ? 'COMPLIANT' : `Over by ${r.overshootW.toFixed(0)} W (${r.overshootPercent.toFixed(1)} %)`}
                </Big>
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
