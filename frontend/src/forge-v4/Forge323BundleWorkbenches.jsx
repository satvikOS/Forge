// Forge-323 bundle — static margin + refrigerant pipe + bus bar + duct leak + dust vent.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

function useOpenClose(openWin, closeWin) {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        window[openWin]  = () => setOpen(true);
        window[closeWin] = () => setOpen(false);
        return () => { delete window[openWin]; delete window[closeWin]; };
    }, []);
    return [open, setOpen];
}

export function StaticMarginWorkbenchHost() {
    const [open, setOpen] = useOpenClose('__forgeOpenStaticMarginWorkbench', '__forgeCloseStaticMarginWorkbench');
    const [xCG, setXCG] = useState(0.30);
    const [xAC, setXAC] = useState(0.25);
    const [Vh, setVh] = useState(0.5);
    const [Cl, setCl] = useState(0.8);
    const [de, setDe] = useState(0.4);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.staticmargin?.analyse({xCG_normalized:Number(xCG), xACwing_normalized:Number(xAC), tailVolumeCoefficient:Number(Vh), tailToWingCLalphaRatio:Number(Cl), downwashGradient:Number(de)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-sm-panel" title="Aircraft static margin" onClose={() => setOpen(false)}>
            <Row label="x_CG / c̄" v={xCG} set={setXCG}/>
            <Row label="x_AC,wing / c̄" v={xAC} set={setXAC}/>
            <Row label="V_h tail vol coeff" v={Vh} set={setVh}/>
            <Row label="C_Lα,t / C_Lα,w" v={Cl} set={setCl}/>
            <Row label="dε/dα" v={de} set={setDe}/>
            <Btn testid="forge-sm-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-sm-result">
                <Ln k="x_NP / c̄" v={r.xNP_normalized.toFixed(4)}/>
                <Big testid="forge-sm-margin" colour={r.stable ? '#3fb950' : '#f85149'}>SM = {(r.staticMargin*100).toFixed(2)} %</Big>
                <Banner testid="forge-sm-stable" colour={r.stable ? '#3fb950' : '#f85149'}>
                    {r.stable ? (r.meetsTypicalDesignTarget ? 'Stable + in design band' : 'Stable (outside 5-15 %)') : 'UNSTABLE'}
                </Banner>
            </Res>}
        </P>, document.body);
}

export function RefrigerantPipeWorkbenchHost() {
    const [open, setOpen] = useOpenClose('__forgeOpenRefrigerantPipeWorkbench', '__forgeCloseRefrigerantPipeWorkbench');
    const [Q, setQ] = useState(100);
    const [dh, setDh] = useState(200);
    const [vg, setVg] = useState(0.058);
    const [vlim, setVlim] = useState(6);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.refpipe?.analyse({coolingDutyKw:Number(Q), enthalpyChangeKJpkg:Number(dh), specificVolumeM3pkg:Number(vg), velocityLimitMs:Number(vlim)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-rp-panel" title="Refrigerant pipe · ASHRAE" onClose={() => setOpen(false)}>
            <Row label="Q (kW) cooling" v={Q} set={setQ}/>
            <Row label="Δh (kJ/kg)" v={dh} set={setDh}/>
            <Row label="v_g (m³/kg)" v={vg} set={setVg}/>
            <Row label="v_lim (m/s) — 6/18/1" v={vlim} set={setVlim}/>
            <Btn testid="forge-rp-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-rp-result">
                <Ln k="ṁ" v={r.massFlowKgPerS.toFixed(3) + ' kg/s'}/>
                <Ln k="V̇" v={r.volumeFlowM3PerS.toFixed(5) + ' m³/s'}/>
                <Big testid="forge-rp-D" colour="#3fb950">D ≥ {r.requiredDiameterMm.toFixed(1)} mm</Big>
            </Res>}
        </P>, document.body);
}

export function BusBarWorkbenchHost() {
    const [open, setOpen] = useOpenClose('__forgeOpenBusBarWorkbench', '__forgeCloseBusBarWorkbench');
    const [Isc, setIsc] = useState(50);
    const [k, setK] = useState(1.8);
    const [a, setA] = useState(100);
    const [L, setL] = useState(1);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.busbar?.analyse({shortCircuitCurrentKaRms:Number(Isc), asymmetryFactorKappa:Number(k), conductorSpacingMm:Number(a), spanLengthM:Number(L)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-bb-panel" title="Bus bar · IEC 60865 short circuit" onClose={() => setOpen(false)}>
            <Row label="I_sc (kA) rms" v={Isc} set={setIsc}/>
            <Row label="κ asymmetry" v={k} set={setK}/>
            <Row label="a (mm) spacing" v={a} set={setA}/>
            <Row label="L (m) span" v={L} set={setL}/>
            <Btn testid="forge-bb-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-bb-result">
                <Ln k="I_peak" v={r.peakCurrentKa.toFixed(2) + ' kA'}/>
                <Big testid="forge-bb-F" colour="#f85149">F = {(r.forcePerLengthNm / 1000).toFixed(2)} kN/m</Big>
                <Ln k="F_total" v={(r.totalForcePerSpanN / 1000).toFixed(2) + ' kN'}/>
                <Ln k="M_max" v={r.maxBendingMomentNm.toFixed(1) + ' N·m'}/>
            </Res>}
        </P>, document.body);
}

export function DuctLeakageWorkbenchHost() {
    const [open, setOpen] = useOpenClose('__forgeOpenDuctLeakageWorkbench', '__forgeCloseDuctLeakageWorkbench');
    const [A, setA] = useState(100);
    const [P, setP] = useState(1.0);
    const [CL, setCL] = useState(6);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.ductleakage?.analyse({ductSurfaceAreaM2:Number(A), testPressureInchWC:Number(P), leakageClassCL:Number(CL)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-dl-panel" title="Duct leakage · SMACNA" onClose={() => setOpen(false)}>
            <Row label="A_duct (m²)" v={A} set={setA}/>
            <Row label="P_test (in H₂O)" v={P} set={setP}/>
            <Row label="C_L class — A12 / B6 / C3 / 2" v={CL} set={setCL}/>
            <Btn testid="forge-dl-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-dl-result">
                <Ln k="rate cfm/100ft²" v={r.leakageRateCfmPer100ft2.toFixed(2)}/>
                <Big testid="forge-dl-lps" colour="#3fb950">Total = {r.totalLeakageLPerS.toFixed(1)} L/s</Big>
                <Ln k="total cfm" v={r.totalLeakageCfm.toFixed(1)}/>
            </Res>}
        </P>, document.body);
}

export function DustVentWorkbenchHost() {
    const [open, setOpen] = useOpenClose('__forgeOpenDustVentWorkbench', '__forgeCloseDustVentWorkbench');
    const [V, setV] = useState(10);
    const [Kst, setKst] = useState(200);
    const [Pred, setPred] = useState(0.5);
    const [Pstat, setPstat] = useState(0.1);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.dustvent?.analyse({vesselVolumeM3:Number(V), kstBarMperS:Number(Kst), maxAllowableOverpressureBar:Number(Pred), ventReleasePressureBar:Number(Pstat)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-dv-panel" title="Dust explosion vent · NFPA 68" onClose={() => setOpen(false)}>
            <Row label="V (m³) vessel" v={V} set={setV}/>
            <Row label="K_St (bar·m/s)" v={Kst} set={setKst}/>
            <Row label="P_red (bar) max" v={Pred} set={setPred}/>
            <Row label="P_stat (bar) release" v={Pstat} set={setPstat}/>
            <Btn testid="forge-dv-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-dv-result">
                <Ln k="ΔP margin" v={r.pressureMarginBar.toFixed(3) + ' bar'}/>
                <Big testid="forge-dv-A" colour="#3fb950">A_v = {r.ventAreaM2.toFixed(4)} m²</Big>
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
        <span style={{color:'#8b949e'}}>{k}</span><span>{v}</span>
    </div>;
}
function Big({ testid, colour, children }) {
    return <div data-testid={testid} style={{marginTop:6, fontWeight:700, color:colour}}>{children}</div>;
}
function Banner({ testid, colour, children }) {
    return <div data-testid={testid} style={{marginTop:8, padding:'4px 8px', borderRadius:4,
        background:colour === '#3fb950' ? '#1d2d1d' : '#3d1d1d',
        color:colour, fontWeight:700, textAlign:'center'}}>{children}</div>;
}
