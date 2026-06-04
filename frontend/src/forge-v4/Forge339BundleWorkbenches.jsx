// Forge-339 bundle — runoff CN + waveguide + sluice gate + ICE knock + project NPV.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function CNWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [CN, setCN] = useState(75);
    const [P, setP] = useState(100);
    const [A, setA] = useState(1);
    const [Tc, setTc] = useState(2);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenCNWorkbench  = () => setOpen(true);
        window.__forgeCloseCNWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenCNWorkbench; delete window.__forgeCloseCNWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.cn?.analyse({curveNumber_CN:Number(CN), rainfall_P_mm:Number(P), drainageArea_km2:Number(A), timeOfConcentration_Tc_h:Number(Tc)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-cn-panel" title="NRCS TR-55 curve-number runoff" onClose={() => setOpen(false)}>
            <Row label="CN (30–98)" v={CN} set={setCN}/>
            <Row label="P rainfall (mm)" v={P} set={setP}/>
            <Row label="A area (km²)" v={A} set={setA}/>
            <Row label="T_c (h)" v={Tc} set={setTc}/>
            <Btn testid="forge-cn-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-cn-result">
                <Ln k="S retention" v={r.maxRetention_S_mm.toFixed(2) + ' mm'}/>
                <Ln k="I_a initial abst." v={r.initialAbstraction_Ia_mm.toFixed(2) + ' mm'}/>
                <Big testid="forge-cn-Q" colour="#3fb950">Q = {r.runoffDepth_Q_mm.toFixed(2)} mm</Big>
                <Ln k="V volume" v={r.runoffVolume_m3.toFixed(0) + ' m³'}/>
                <Big testid="forge-cn-qp" colour="#58a6ff">q_p = {r.peakFlow_qp_m3PerS.toFixed(2)} m³/s</Big>
            </Res>}
        </P>, document.body);
}

export function WaveguideWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [a, setA] = useState(22.86);
    const [b, setB] = useState(10.16);
    const [eps, setEps] = useState(1);
    const [f, setF] = useState(10);
    const [m, setM] = useState(1);
    const [n, setN] = useState(0);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenWaveguideWorkbench  = () => setOpen(true);
        window.__forgeCloseWaveguideWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenWaveguideWorkbench; delete window.__forgeCloseWaveguideWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.waveguide?.analyse({broadDim_a_mm:Number(a), narrowDim_b_mm:Number(b), dielectric_eps_r:Number(eps), operatingFreq_GHz:Number(f), modeM:Math.round(Number(m)), modeN:Math.round(Number(n))})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-wg-panel" title="Rectangular waveguide · Pozar §3.3" onClose={() => setOpen(false)}>
            <Row label="a broad (mm)" v={a} set={setA}/>
            <Row label="b narrow (mm)" v={b} set={setB}/>
            <Row label="ε_r" v={eps} set={setEps}/>
            <Row label="f operating (GHz)" v={f} set={setF}/>
            <Row label="mode m" v={m} set={setM}/>
            <Row label="mode n" v={n} set={setN}/>
            <Btn testid="forge-wg-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-wg-result">
                <Big testid="forge-wg-fc" colour="#3fb950">f_c = {r.cutoffFreq_GHz.toFixed(3)} GHz</Big>
                <Ln k="λ_c cutoff" v={r.cutoffWavelength_mm.toFixed(2) + ' mm'}/>
                <Ln k="β phase const" v={r.phaseConstant_beta_perM.toFixed(2) + ' /m'}/>
                <Ln k="λ_g guided" v={r.guidedWavelength_mm.toFixed(2) + ' mm'}/>
                <Ln k="v_g group vel" v={(r.groupVelocity_mps / 1e8).toFixed(3) + '·10⁸ m/s'}/>
                <Banner testid="forge-wg-ok" colour={r.isPropagating ? '#3fb950' : '#f85149'}>
                    {r.isPropagating ? 'PROPAGATING' : 'EVANESCENT'}
                </Banner>
            </Res>}
        </P>, document.body);
}

export function SluiceWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [a, setA] = useState(0.5);
    const [h, setH] = useState(3);
    const [b, setB] = useState(2);
    const [yt, setYt] = useState(0.2);
    const [contracted, setContracted] = useState(true);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenSluiceWorkbench  = () => setOpen(true);
        window.__forgeCloseSluiceWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenSluiceWorkbench; delete window.__forgeCloseSluiceWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.sluice?.analyse({gateOpening_a_m:Number(a), upstreamHead_h_m:Number(h), gateWidth_b_m:Number(b), tailwaterDepth_yt_m:Number(yt), useContractedCd:Boolean(contracted)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-sl-panel" title="Sluice gate · Henderson" onClose={() => setOpen(false)}>
            <Row label="a opening (m)" v={a} set={setA}/>
            <Row label="h upstream (m)" v={h} set={setH}/>
            <Row label="b gate width (m)" v={b} set={setB}/>
            <Row label="y_t tailwater (m)" v={yt} set={setYt}/>
            <div style={{display:'flex', alignItems:'center', margin:'5px 0'}}>
                <span style={{width:200}}>contracted C_d?</span>
                <input type="checkbox" checked={contracted} onChange={(ev) => setContracted(ev.target.checked)}/>
            </div>
            <Btn testid="forge-sl-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-sl-result">
                <Ln k="C_d" v={r.dischargeCoefficient_Cd.toFixed(3)}/>
                <Ln k="q per metre" v={r.specificDischarge_qPerM.toFixed(3) + ' m²/s'}/>
                <Big testid="forge-sl-Q" colour="#3fb950">Q = {r.totalDischarge_Q_m3s.toFixed(2)} m³/s</Big>
                <Ln k="y_2 vena contracta" v={r.venaContracta_y2_m.toFixed(3) + ' m'}/>
                <Banner testid="forge-sl-sub" colour={r.isSubmerged ? '#f85149' : '#3fb950'}>
                    {r.isSubmerged ? 'SUBMERGED' : 'free flow'}
                </Banner>
            </Res>}
        </P>, document.body);
}

export function KnockWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [CR, setCR] = useState(10);
    const [T1, setT1] = useState(320);
    const [p1, setP1] = useState(100);
    const [gamma, setGamma] = useState(1.34);
    const [RON, setRON] = useState(95);
    const [MON, setMON] = useState(85);
    const [Ta, setTa] = useState(900);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenKnockWorkbench  = () => setOpen(true);
        window.__forgeCloseKnockWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenKnockWorkbench; delete window.__forgeCloseKnockWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.knock?.analyse({compressionRatio:Number(CR), intakeTemp_T1_K:Number(T1), intakePressure_p1_kPa:Number(p1), specificHeatRatio_gamma:Number(gamma), octaneRON:Number(RON), octaneMON:Number(MON), criticalAutoignition_Ta_K:Number(Ta)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-kn-panel" title="SI engine knock · Heywood §9" onClose={() => setOpen(false)}>
            <Row label="CR" v={CR} set={setCR}/>
            <Row label="T_1 intake (K)" v={T1} set={setT1}/>
            <Row label="p_1 intake (kPa)" v={p1} set={setP1}/>
            <Row label="γ ratio (1.34)" v={gamma} set={setGamma}/>
            <Row label="RON" v={RON} set={setRON}/>
            <Row label="MON" v={MON} set={setMON}/>
            <Row label="T_a autoign (K)" v={Ta} set={setTa}/>
            <Btn testid="forge-kn-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-kn-result">
                <Ln k="T_2 end gas" v={r.endGasTemp_T2_K.toFixed(0) + ' K'}/>
                <Ln k="p_2 end gas" v={r.endGasPressure_p2_kPa.toFixed(0) + ' kPa'}/>
                <Ln k="CR_limit" v={r.knockLimitedCR.toFixed(2)}/>
                <Ln k="AKI" v={r.antiKnockIndex.toFixed(1)}/>
                <Ln k="ON margin" v={r.octaneMargin.toFixed(1)}/>
                <Banner testid="forge-kn-ok" colour={r.willKnock ? '#f85149' : '#3fb950'}>
                    {r.willKnock ? 'KNOCK PREDICTED' : 'no knock'}
                </Banner>
            </Res>}
        </P>, document.body);
}

export function NPVWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [csv, setCsv] = useState('-200000\n30000\n30000\n30000\n30000\n30000\n30000\n30000\n30000\n30000\n30000');
    const [rate, setRate] = useState(7);
    const [capex, setCapex] = useState(200000);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenNPVWorkbench  = () => setOpen(true);
        window.__forgeCloseNPVWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenNPVWorkbench; delete window.__forgeCloseNPVWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        const cf = csv.split('\n').filter(s => s.trim()).map(Number);
        setR(window.forge?.npv?.analyse({cashflows_USD:cf, annualEnergy_kWh:[], annualOpex_USD:[], initialCapex_USD:Number(capex), discountRate_pct:Number(rate)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-np-panel" title="Project NPV / IRR · Park §5" onClose={() => setOpen(false)}>
            <div style={{margin:'5px 0'}}>
                <div style={{color:'#8b949e', fontSize:11, marginBottom:4}}>cashflows USD (one per year, CF_0 negative)</div>
                <textarea value={csv} onChange={(ev) => setCsv(ev.target.value)} rows={6} style={{width:'100%', background:'#0d1117', color:'#c9d1d9', border:'1px solid #30363d', borderRadius:4, padding:6, fontFamily:'monospace', fontSize:12}}/>
            </div>
            <Row label="discount rate (%)" v={rate} set={setRate}/>
            <Row label="CAPEX (for LCOE)" v={capex} set={setCapex}/>
            <Btn testid="forge-np-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-np-result">
                <Big testid="forge-np-npv" colour={r.NPV_USD >= 0 ? '#3fb950' : '#f85149'}>NPV = ${r.NPV_USD.toFixed(0)}</Big>
                <Big testid="forge-np-irr" colour="#58a6ff">IRR = {r.IRR_pct.toFixed(2)} %</Big>
                <Ln k="payback" v={r.paybackYears.toFixed(2) + ' yr'}/>
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
