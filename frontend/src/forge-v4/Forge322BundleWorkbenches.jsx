// Forge-322 bundle — masonry + asphalt + cathodic + heat trace + lightning.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

function mk(useFn, openName, closeName) {
    return (set) => {
        useEffect(() => {
            window[openName]  = () => set(true);
            window[closeName] = () => set(false);
            return () => { delete window[openName]; delete window[closeName]; };
        }, []);
    };
}

export function MasonryWallWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [b, setB] = useState(1000);
    const [d, setD] = useState(100);
    const [As, setAs] = useState(200);
    const [Pu, setPu] = useState(50);
    const [fm, setFm] = useState(14);
    const [fy, setFy] = useState(420);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenMasonryWallWorkbench  = () => setOpen(true);
        window.__forgeCloseMasonryWallWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenMasonryWallWorkbench; delete window.__forgeCloseMasonryWallWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.masonry?.analyse({wallWidthB_mm:Number(b), effectiveDepth_d_mm:Number(d), steelAreaAs_mm2:Number(As), factoredAxialPu_kN:Number(Pu), fm_MPa:Number(fm), fy_MPa:Number(fy)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-mw-panel" title="Masonry wall · TMS 402 §9.3.5.2" onClose={() => setOpen(false)}>
            <Row label="b (mm) wall width" v={b} set={setB}/>
            <Row label="d (mm) eff depth" v={d} set={setD}/>
            <Row label="A_s (mm²)" v={As} set={setAs}/>
            <Row label="P_u (kN)" v={Pu} set={setPu}/>
            <Row label="f'_m (MPa)" v={fm} set={setFm}/>
            <Row label="f_y (MPa)" v={fy} set={setFy}/>
            <Btn testid="forge-mw-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-mw-result">
                <Ln k="A_se" v={r.Ase_mm2.toFixed(0) + ' mm²'}/>
                <Ln k="a stress block" v={r.aMm.toFixed(1) + ' mm'}/>
                <Ln k="M_n" v={r.nominalMoment_kNm.toFixed(2) + ' kN·m'}/>
                <Big testid="forge-mw-phiMn" colour="#3fb950">φM_n = {r.designMoment_kNm.toFixed(2)} kN·m</Big>
            </Res>}
        </P>, document.body);
}

export function AsphaltMixWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Ga, setGa] = useState(2.65);
    const [Gb, setGb] = useState(1.02);
    const [Wb, setWb] = useState(5);
    const [Gmb, setGmb] = useState(2.40);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenAsphaltMixWorkbench  = () => setOpen(true);
        window.__forgeCloseAsphaltMixWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenAsphaltMixWorkbench; delete window.__forgeCloseAsphaltMixWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.asphalt?.analyse({aggregateSG:Number(Ga), asphaltSG:Number(Gb), asphaltContentPct:Number(Wb), bulkSG_Gmb:Number(Gmb)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-as-panel" title="Asphalt mix · Marshall/Superpave" onClose={() => setOpen(false)}>
            <Row label="G_a aggregate SG" v={Ga} set={setGa}/>
            <Row label="G_b asphalt SG (~1.02)" v={Gb} set={setGb}/>
            <Row label="W_b asphalt %" v={Wb} set={setWb}/>
            <Row label="G_mb bulk SG" v={Gmb} set={setGmb}/>
            <Btn testid="forge-as-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-as-result">
                <Ln k="G_mm" v={r.theoreticalMaxSG.toFixed(4)}/>
                <Big testid="forge-as-Va" colour={r.meetsSuperpaveAirVoids ? '#3fb950' : '#f85149'}>
                    V_a = {r.airVoidsPct.toFixed(2)} % {r.meetsSuperpaveAirVoids ? '✓ Superpave' : '✗ out of 3-5%'}
                </Big>
                <Ln k="VMA" v={r.vmaPct.toFixed(2) + ' %'}/>
                <Ln k="VFA" v={r.vfaPct.toFixed(2) + ' %'}/>
            </Res>}
        </P>, document.body);
}

export function CathodicWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [A, setA] = useState(500);
    const [j, setJ] = useState(50);
    const [yr, setYr] = useState(20);
    const [k_c, setKc] = useState(11.9);
    const [u, setU] = useState(0.85);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenCathodicWorkbench  = () => setOpen(true);
        window.__forgeCloseCathodicWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenCathodicWorkbench; delete window.__forgeCloseCathodicWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.cathodic?.analyse({protectedAreaM2:Number(A), currentDensityMaPerM2:Number(j), designLifeYears:Number(yr), anodeConsumptionKgPerAmpYr:Number(k_c), anodeUtilizationFactor:Number(u)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-cp-panel" title="Cathodic protection · sacrificial anode" onClose={() => setOpen(false)}>
            <Row label="A_protected (m²)" v={A} set={setA}/>
            <Row label="i (mA/m²) — 50 soil" v={j} set={setJ}/>
            <Row label="design life (yr)" v={yr} set={setYr}/>
            <Row label="k_anode (kg/A·yr) Zn 11.9" v={k_c} set={setKc}/>
            <Row label="η utilization" v={u} set={setU}/>
            <Btn testid="forge-cp-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-cp-result">
                <Big testid="forge-cp-I" colour="#3fb950">I_required = {r.totalCurrentRequiredA.toFixed(2)} A</Big>
                <Big testid="forge-cp-m" colour="#58a6ff">m_anode = {r.anodeMassRequiredKg.toFixed(0)} kg</Big>
            </Res>}
        </P>, document.body);
}

export function HeatTraceWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [D, setD] = useState(100);
    const [tInsmm, setTInsmm] = useState(50);
    const [kIns, setKIns] = useState(0.04);
    const [h, setH] = useState(25);
    const [Tp, setTp] = useState(5);
    const [Ta, setTa] = useState(-20);
    const [sf, setSf] = useState(1.25);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenHeatTraceWorkbench  = () => setOpen(true);
        window.__forgeCloseHeatTraceWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenHeatTraceWorkbench; delete window.__forgeCloseHeatTraceWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.heattrace?.analyse({pipeOuterDiameterMm:Number(D), insulationThicknessMm:Number(tInsmm), insulationConductivityWmk:Number(kIns), outdoorFilmCoefficientWm2K:Number(h), pipeTargetTempC:Number(Tp), ambientTempC:Number(Ta), safetyFactor:Number(sf)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-ht-panel" title="Heat trace · pipe freeze protection" onClose={() => setOpen(false)}>
            <Row label="D_pipe (mm) outer" v={D} set={setD}/>
            <Row label="t_ins (mm)" v={tInsmm} set={setTInsmm}/>
            <Row label="k_ins (W/m·K) FG 0.04" v={kIns} set={setKIns}/>
            <Row label="h_out (W/m²·K) 25" v={h} set={setH}/>
            <Row label="T_pipe (°C)" v={Tp} set={setTp}/>
            <Row label="T_amb (°C)" v={Ta} set={setTa}/>
            <Row label="safety factor" v={sf} set={setSf}/>
            <Btn testid="forge-ht-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-ht-result">
                <Ln k="D_ins outer" v={r.insulationOD_mm.toFixed(1) + ' mm'}/>
                <Ln k="q heat loss" v={r.heatLossWPerM.toFixed(1) + ' W/m'}/>
                <Big testid="forge-ht-W" colour="#3fb950">Cable rating ≥ {r.recommendedCableWperM.toFixed(1)} W/m</Big>
            </Res>}
        </P>, document.body);
}

export function LightningWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [R, setR] = useState(30);
    const [h, setH] = useState(10);
    const [ho, setHo] = useState(0);
    const [r, setR_] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenLightningWorkbench  = () => setOpen(true);
        window.__forgeCloseLightningWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenLightningWorkbench; delete window.__forgeCloseLightningWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR_(window.forge?.lightning?.analyse({rollingSphereRadiusM:Number(R), mastHeightM:Number(h), protectedObjectHeightM:Number(ho)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR_(null); } };
    return createPortal(
        <P testid="forge-lp-panel" title="Lightning · rolling sphere NFPA 780" onClose={() => setOpen(false)}>
            <Row label="R sphere (m) — 30=II" v={R} set={setR}/>
            <Row label="h mast (m)" v={h} set={setH}/>
            <Row label="h_obj (m)" v={ho} set={setHo}/>
            <Btn testid="forge-lp-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-lp-result">
                <Big testid="forge-lp-rg" colour="#3fb950">r_p ground = {r.groundProtectedRadiusM.toFixed(2)} m</Big>
                <Ln k="r_p at h_obj" v={r.objectProtectedRadiusM.toFixed(2) + ' m'}/>
                <Ln k="cone ratio r/h" v={r.maximumProtectionConeRatio.toFixed(3)}/>
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
