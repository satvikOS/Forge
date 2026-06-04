// Forge-326 bundle — concrete cover + MSE wall + Hunter + solar collector + chimney.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function ConcreteCoverWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [exp, setExp] = useState('weather');
    const [bar, setBar] = useState('large');
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenCoverWorkbench  = () => setOpen(true);
        window.__forgeCloseCoverWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenCoverWorkbench; delete window.__forgeCloseCoverWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.cover?.analyse({exposureCondition:exp, barSize:bar})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-cov-panel" title="Concrete cover · ACI §20.6" onClose={() => setOpen(false)}>
            <div style={{display:'flex', margin:'5px 0'}}>
                <span style={{width:200}}>exposure</span>
                <select value={exp} onChange={(e) => setExp(e.target.value)}
                        style={{flex:1, background:'#0d1117', color:'#c9d1d9', border:'1px solid #30363d', borderRadius:4, padding:4}}>
                    <option value="interior">interior</option>
                    <option value="weather">weather</option>
                    <option value="earth-formed">earth (formed)</option>
                    <option value="earth-direct">earth (direct cast)</option>
                </select>
            </div>
            <div style={{display:'flex', margin:'5px 0'}}>
                <span style={{width:200}}>bar size</span>
                <select value={bar} onChange={(e) => setBar(e.target.value)}
                        style={{flex:1, background:'#0d1117', color:'#c9d1d9', border:'1px solid #30363d', borderRadius:4, padding:4}}>
                    <option value="small">small (≤ #5 / Ø16)</option>
                    <option value="large">large (≥ #6 / Ø20)</option>
                </select>
            </div>
            <Btn testid="forge-cov-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-cov-result">
                <Big testid="forge-cov-c" colour="#3fb950">Cover = {r.minimumCoverMm} mm</Big>
                {r.exteriorFireRated && <Ln k="fire-rating" v="exterior bumped"/>}
            </Res>}
        </P>, document.body);
}

export function MSEWallWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [H, setH] = useState(6);
    const [phi, setPhi] = useState(34);
    const [phif, setPhif] = useState(30);
    const [gamma, setGamma] = useState(19);
    const [L, setL] = useState(0);
    const [q, setQ] = useState(10);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenMSEWorkbench  = () => setOpen(true);
        window.__forgeCloseMSEWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenMSEWorkbench; delete window.__forgeCloseMSEWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.mse?.analyse({wallHeightH_m:Number(H), soilFrictionAngleDeg:Number(phi), foundationFrictionAngleDeg:Number(phif), soilUnitWeightKnM3:Number(gamma), reinforcementLengthM:Number(L), surchargeKnM2:Number(q)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-mse-panel" title="MSE wall · FHWA NHI-10-024" onClose={() => setOpen(false)}>
            <Row label="H (m) wall" v={H} set={setH}/>
            <Row label="φ (°) backfill" v={phi} set={setPhi}/>
            <Row label="φ_f (°) foundation" v={phif} set={setPhif}/>
            <Row label="γ (kN/m³)" v={gamma} set={setGamma}/>
            <Row label="L (m) reinf (0=auto)" v={L} set={setL}/>
            <Row label="q (kN/m²) surcharge" v={q} set={setQ}/>
            <Btn testid="forge-mse-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-mse-result">
                <Ln k="K_a" v={r.K_active.toFixed(4)}/>
                <Ln k="L_eff" v={r.effectiveReinforcementLengthM.toFixed(2) + ' m'}/>
                <Ln k="F_drive" v={r.drivingForceKnPerM.toFixed(1) + ' kN/m'}/>
                <Ln k="R_resist" v={r.resistingForceKnPerM.toFixed(1) + ' kN/m'}/>
                <Big testid="forge-mse-fos" colour={r.meetsFOS ? '#3fb950' : '#f85149'}>FOS_sliding = {r.slidingFOS.toFixed(2)}</Big>
            </Res>}
        </P>, document.body);
}

export function HunterWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [FU, setFU] = useState(50);
    const [fv, setFv] = useState(false);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenHunterWorkbench  = () => setOpen(true);
        window.__forgeCloseHunterWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenHunterWorkbench; delete window.__forgeCloseHunterWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.hunter?.analyse({totalFixtureUnits:Number(FU), flushValveMix:Boolean(fv)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-hnt-panel" title="Hunter fixture flow" onClose={() => setOpen(false)}>
            <Row label="Σ FU fixture units" v={FU} set={setFU}/>
            <label style={{display:'flex', alignItems:'center', margin:'6px 0', fontSize:12}}>
                <input type="checkbox" checked={fv} onChange={(e) => setFv(e.target.checked)} style={{marginRight:8}}/>
                Flush-valve dominant (&gt;30 %)
            </label>
            <Btn testid="forge-hnt-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-hnt-result">
                <Big testid="forge-hnt-Q" colour="#3fb950">Q = {r.designFlowGpm.toFixed(1)} gpm</Big>
                <Ln k="= L/s" v={r.designFlowLps.toFixed(2)}/>
            </Res>}
        </P>, document.body);
}

export function SolarCollectorWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [A, setA] = useState(5);
    const [opt, setOpt] = useState(0.75);
    const [UL, setUL] = useState(4.5);
    const [Fr, setFr] = useState(0.85);
    const [G, setG] = useState(800);
    const [Tin, setTin] = useState(40);
    const [Ta, setTa] = useState(20);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenSolarCollWorkbench  = () => setOpen(true);
        window.__forgeCloseSolarCollWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenSolarCollWorkbench; delete window.__forgeCloseSolarCollWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.solarcollector?.analyse({collectorAreaM2:Number(A), opticalEfficiency_F_R_tau_alpha:Number(opt), overallLossCoeff_U_L:Number(UL), F_R:Number(Fr), globalIrradianceWm2:Number(G), inletTempC:Number(Tin), ambientTempC:Number(Ta)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-sol-panel" title="Solar collector · Hottel-Whillier" onClose={() => setOpen(false)}>
            <Row label="A (m²)" v={A} set={setA}/>
            <Row label="F_R·τα (0.7-0.85)" v={opt} set={setOpt}/>
            <Row label="U_L (W/m²·K)" v={UL} set={setUL}/>
            <Row label="F_R" v={Fr} set={setFr}/>
            <Row label="G_T (W/m²)" v={G} set={setG}/>
            <Row label="T_in (°C)" v={Tin} set={setTin}/>
            <Row label="T_amb (°C)" v={Ta} set={setTa}/>
            <Btn testid="forge-sol-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-sol-result">
                <Big testid="forge-sol-q" colour="#3fb950">q_u = {r.usefulHeatGainW.toFixed(0)} W</Big>
                <Big testid="forge-sol-eta" colour="#58a6ff">η = {(r.instantaneousEfficiency*100).toFixed(1)} %</Big>
                <Ln k="T* reduced" v={r.reducedTemperature.toFixed(4) + ' m²K/W'}/>
            </Res>}
        </P>, document.body);
}

export function ChimneyDraftWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [h, setH] = useState(15);
    const [D, setD] = useState(0.3);
    const [Tflue, setTflue] = useState(200);
    const [Tamb, setTamb] = useState(20);
    const [md, setMd] = useState(0.5);
    const [p, setP] = useState(101.325);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenChimneyWorkbench  = () => setOpen(true);
        window.__forgeCloseChimneyWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenChimneyWorkbench; delete window.__forgeCloseChimneyWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.chimney?.analyse({stackHeightM:Number(h), flueDiameterM:Number(D), flueGasTempC:Number(Tflue), ambientTempC:Number(Tamb), flueMassFlowKgPerS:Number(md), atmPressureKPa:Number(p)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-chm-panel" title="Chimney draft · ASHRAE Ch 35" onClose={() => setOpen(false)}>
            <Row label="h (m) stack" v={h} set={setH}/>
            <Row label="D (m) flue" v={D} set={setD}/>
            <Row label="T_flue (°C)" v={Tflue} set={setTflue}/>
            <Row label="T_amb (°C)" v={Tamb} set={setTamb}/>
            <Row label="ṁ_flue (kg/s)" v={md} set={setMd}/>
            <Row label="p_atm (kPa)" v={p} set={setP}/>
            <Btn testid="forge-chm-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-chm-result">
                <Ln k="ΔP_avail" v={r.availableDraftPa.toFixed(1) + ' Pa'}/>
                <Ln k="V_flue" v={r.flueVelocityMs.toFixed(2) + ' m/s'}/>
                <Ln k="ΔP_friction" v={r.frictionLossPa.toFixed(1) + ' Pa'}/>
                <Big testid="forge-chm-net" colour={r.draftAdequate ? '#3fb950' : '#f85149'}>
                    Net draft = {r.netDraftPa.toFixed(1)} Pa
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
