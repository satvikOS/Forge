// Forge-331 bundle — beam reactions + API 650 tank anchor + heat-pump COP + ASCE base shear + PV shading.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function BeamReactionsWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [L, setL] = useState(6);
    const [P, setP] = useState(20);
    const [a, setA] = useState(2);
    const [w, setW] = useState(5);
    const [EI, setEI] = useState(20000);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenBeamReactionsWorkbench  = () => setOpen(true);
        window.__forgeCloseBeamReactionsWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenBeamReactionsWorkbench; delete window.__forgeCloseBeamReactionsWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.beamreact?.analyse({span_m:Number(L), pointLoad_kN:Number(P), pointLoadPosition_m:Number(a), udl_kNm:Number(w), EI_kNm2:Number(EI)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-bmr-panel" title="Simply-supported beam · Hibbeler §6" onClose={() => setOpen(false)}>
            <Row label="L span (m)" v={L} set={setL}/>
            <Row label="P point load (kN)" v={P} set={setP}/>
            <Row label="a position from left (m)" v={a} set={setA}/>
            <Row label="w UDL (kN/m)" v={w} set={setW}/>
            <Row label="EI (kN·m²)" v={EI} set={setEI}/>
            <Btn testid="forge-bmr-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-bmr-result">
                <Ln k="R_left" v={r.leftReaction_kN.toFixed(2) + ' kN'}/>
                <Ln k="R_right" v={r.rightReaction_kN.toFixed(2) + ' kN'}/>
                <Ln k="V_max" v={r.maxShear_kN.toFixed(2) + ' kN'}/>
                <Big testid="forge-bmr-Mmax" colour="#3fb950">M_max = {r.maxBendingMoment_kNm.toFixed(2)} kN·m</Big>
                <Big testid="forge-bmr-defl" colour="#58a6ff">δ_max = {r.maxDeflection_mm.toFixed(2)} mm</Big>
            </Res>}
        </P>, document.body);
}

export function TankAnchorWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [D, setD] = useState(20);
    const [H, setH] = useState(15);
    const [Ws, setWs] = useState(500);
    const [Wf, setWf] = useState(10000);
    const [V, setV] = useState(50);
    const [n, setN] = useState(20);
    const [Ks, setKs] = useState(1.0);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenTankAnchorWorkbench  = () => setOpen(true);
        window.__forgeCloseTankAnchorWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenTankAnchorWorkbench; delete window.__forgeCloseTankAnchorWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.tankanchor?.analyse({tankDiameter_m:Number(D), tankHeight_m:Number(H), shellWeight_kN:Number(Ws), fluidWeight_kN:Number(Wf), windSpeed_ms:Number(V), anchorCount:Math.round(Number(n)), importanceFactorKs:Number(Ks)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-tnk-panel" title="API 650 tank wind anchor" onClose={() => setOpen(false)}>
            <Row label="D diameter (m)" v={D} set={setD}/>
            <Row label="H height (m)" v={H} set={setH}/>
            <Row label="W_shell (kN)" v={Ws} set={setWs}/>
            <Row label="W_fluid (kN)" v={Wf} set={setWf}/>
            <Row label="V wind (m/s)" v={V} set={setV}/>
            <Row label="n anchors" v={n} set={setN}/>
            <Row label="K_s importance" v={Ks} set={setKs}/>
            <Btn testid="forge-tnk-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-tnk-result">
                <Ln k="P_w wind" v={r.windPressure_kPa.toFixed(2) + ' kPa'}/>
                <Ln k="M_w overturn" v={r.overturningMoment_kNm.toFixed(0) + ' kN·m'}/>
                <Ln k="M_dl restore" v={r.restoringMoment_kNm.toFixed(0) + ' kN·m'}/>
                <Ln k="SF" v={r.safetyFactor.toFixed(2)}/>
                <Big testid="forge-tnk-uplift" colour={r.netUplift_kN === 0 ? '#3fb950' : '#f85149'}>uplift = {r.netUplift_kN.toFixed(2)} kN/bolt</Big>
                <Banner testid="forge-tnk-ok" colour={r.anchorageRequired ? '#f85149' : '#3fb950'}>
                    {r.anchorageRequired ? 'ANCHORAGE REQUIRED' : 'SELF-ANCHORED'}
                </Banner>
            </Res>}
        </P>, document.body);
}

export function HeatPumpWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Tc, setTc] = useState(-5);
    const [Th, setTh] = useState(40);
    const [eta, setEta] = useState(0.5);
    const [Win, setWin] = useState(3);
    const [mode, setMode] = useState(0);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenHeatPumpWorkbench  = () => setOpen(true);
        window.__forgeCloseHeatPumpWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenHeatPumpWorkbench; delete window.__forgeCloseHeatPumpWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.heatpump?.analyse({sourceTemp_C:Number(Tc), sinkTemp_C:Number(Th), secondLawEfficiency:Number(eta), compressorPower_kW:Number(Win), mode:Math.round(Number(mode))})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-hp-panel" title="Heat-pump COP · Çengel §11" onClose={() => setOpen(false)}>
            <Row label="T_source (°C)" v={Tc} set={setTc}/>
            <Row label="T_sink (°C)" v={Th} set={setTh}/>
            <Row label="η_2nd (0.3–0.6)" v={eta} set={setEta}/>
            <Row label="W_in compressor (kW)" v={Win} set={setWin}/>
            <Row label="mode 0=heat 1=cool" v={mode} set={setMode}/>
            <Btn testid="forge-hp-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-hp-result">
                <Ln k="COP Carnot" v={r.cop_carnot.toFixed(2)}/>
                <Ln k="EER" v={r.eer_btuhPerW.toFixed(1)}/>
                <Big testid="forge-hp-cop" colour="#3fb950">COP_actual = {r.cop_actual.toFixed(2)}</Big>
                <Big testid="forge-hp-q" colour="#58a6ff">Q = {r.capacity_kW.toFixed(2)} kW</Big>
            </Res>}
        </P>, document.body);
}

export function BaseShearWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [hn, setHn] = useState(30);
    const [W, setW] = useState(50000);
    const [sds, setSds] = useState(1.0);
    const [sd1, setSd1] = useState(0.6);
    const [R, setRR] = useState(8);
    const [Ie, setIe] = useState(1.0);
    const [sys, setSys] = useState(0);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenBaseShearWorkbench  = () => setOpen(true);
        window.__forgeCloseBaseShearWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenBaseShearWorkbench; delete window.__forgeCloseBaseShearWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.baseshear?.analyse({heightAboveBase_m:Number(hn), seismicWeight_kN:Number(W), sds:Number(sds), sd1:Number(sd1), R:Number(R), Ie:Number(Ie), structuralSystem:Math.round(Number(sys))})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-bs-panel" title="ASCE 7 §12.8 ELF base shear" onClose={() => setOpen(false)}>
            <Row label="h_n height (m)" v={hn} set={setHn}/>
            <Row label="W seismic (kN)" v={W} set={setW}/>
            <Row label="S_DS" v={sds} set={setSds}/>
            <Row label="S_D1" v={sd1} set={setSd1}/>
            <Row label="R modification" v={R} set={setRR}/>
            <Row label="I_e importance" v={Ie} set={setIe}/>
            <Row label="sys 0=steelMRF 1=concMRF 2=EBF 3=other" v={sys} set={setSys}/>
            <Btn testid="forge-bs-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-bs-result">
                <Ln k="T_a" v={r.approximatePeriod_s.toFixed(3) + ' s'}/>
                <Ln k="C_s,max" v={r.CsMax.toFixed(4)}/>
                <Ln k="C_s,min" v={r.CsMin.toFixed(4)}/>
                <Big testid="forge-bs-cs" colour="#3fb950">C_s = {r.Cs.toFixed(4)}</Big>
                <Big testid="forge-bs-v" colour="#58a6ff">V = {r.baseShear_kN.toFixed(0)} kN</Big>
            </Res>}
        </P>, document.body);
}

export function PVShadeWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [csv, setCsv] = useState('90,10\n180,15\n270,8');
    const [alpha, setAlpha] = useState(12);
    const [gamma, setGamma] = useState(180);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenPVShadeWorkbench  = () => setOpen(true);
        window.__forgeClosePVShadeWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenPVShadeWorkbench; delete window.__forgeClosePVShadeWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        const horizon = csv.split('\n').filter(s => s.trim()).map(line => {
            const [az, alt] = line.split(',').map(Number);
            return { azimuthDeg:az, altitudeDeg:alt };
        });
        setR(window.forge?.pvshade?.analyse({horizon, sunAltitudeDeg:Number(alpha), sunAzimuthDeg:Number(gamma)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-pvs-panel" title="PV horizon shading · IES LS-2" onClose={() => setOpen(false)}>
            <div style={{margin:'5px 0'}}>
                <div style={{color:'#8b949e', fontSize:11, marginBottom:4}}>horizon: az_deg,alt_deg per line</div>
                <textarea value={csv} onChange={(ev) => setCsv(ev.target.value)} rows={4} style={{width:'100%', background:'#0d1117', color:'#c9d1d9', border:'1px solid #30363d', borderRadius:4, padding:6, fontFamily:'monospace', fontSize:12}}/>
            </div>
            <Row label="α sun altitude (°)" v={alpha} set={setAlpha}/>
            <Row label="γ sun azimuth (°)" v={gamma} set={setGamma}/>
            <Btn testid="forge-pvs-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-pvs-result">
                <Ln k="h(γ)" v={r.horizonAltitudeAtSunAz_deg.toFixed(2) + '°'}/>
                <Ln k="margin" v={r.sunMarginDeg.toFixed(2) + '°'}/>
                <Banner testid="forge-pvs-ok" colour={r.shaded ? '#f85149' : '#3fb950'}>
                    {r.shaded ? 'SHADED' : 'UNSHADED'}
                </Banner>
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
        <span style={{width:230}}>{label}</span>
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
