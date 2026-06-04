// Forge-341 bundle — soldier pile + round HSS + plate HX + FOSM + bridge flutter.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function SoldierPileWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [H, setH] = useState(5);
    const [phi, setPhi] = useState(30);
    const [g, setG] = useState(18);
    const [q, setQ] = useState(10);
    const [S, setS] = useState(2.4);
    const [d, setD] = useState(350);
    const [fy, setFy] = useState(345);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenSoldierPileWorkbench  = () => setOpen(true);
        window.__forgeCloseSoldierPileWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenSoldierPileWorkbench; delete window.__forgeCloseSoldierPileWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.soldierpile?.analyse({wallHeight_H_m:Number(H), soilFrictionAngleDeg_phi:Number(phi), soilUnitWeight_kNm3:Number(g), surcharge_q_kNm2:Number(q), pileSpacing_S_m:Number(S), soldierPileDepth_d_mm:Number(d), soldierPileFy_MPa:Number(fy)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-sp-panel" title="Soldier pile wall · FHWA" onClose={() => setOpen(false)}>
            <Row label="H (m)" v={H} set={setH}/>
            <Row label="φ (°)" v={phi} set={setPhi}/>
            <Row label="γ (kN/m³)" v={g} set={setG}/>
            <Row label="q surcharge" v={q} set={setQ}/>
            <Row label="S spacing (m)" v={S} set={setS}/>
            <Row label="d_pile (mm)" v={d} set={setD}/>
            <Row label="F_y (MPa)" v={fy} set={setFy}/>
            <Btn testid="forge-sp-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-sp-result">
                <Ln k="K_a / K_p" v={`${r.Ka.toFixed(3)} / ${r.Kp.toFixed(3)}`}/>
                <Ln k="P_a/m" v={r.totalActiveForce_kNperM.toFixed(2) + ' kN/m'}/>
                <Big testid="forge-sp-d" colour="#3fb950">d_embed = {r.requiredEmbedment_m.toFixed(2)} m</Big>
                <Big testid="forge-sp-m" colour="#58a6ff">M_max/pile = {r.maxBendingMoment_kNm_perPile.toFixed(1)} kN·m</Big>
                <Ln k="σ_max" v={r.maxFiberStress_MPa.toFixed(1) + ' MPa'}/>
            </Res>}
        </P>, document.body);
}

export function RoundHSSWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [D, setD] = useState(168.3);
    const [t, setT] = useState(7.11);
    const [fy, setFy] = useState(345);
    const [E, setEe] = useState(200);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenRoundHSSWorkbench  = () => setOpen(true);
        window.__forgeCloseRoundHSSWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenRoundHSSWorkbench; delete window.__forgeCloseRoundHSSWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.roundhss?.analyse({outsideDiameter_D_mm:Number(D), wallThickness_t_mm:Number(t), Fy_MPa:Number(fy), E_GPa:Number(E)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    const classText = (c) => c === 0 ? 'COMPACT' : c === 1 ? 'NON-COMPACT' : 'SLENDER';
    const classColor = (c) => c === 0 ? '#3fb950' : c === 1 ? '#fbb13c' : '#f85149';
    return createPortal(
        <P testid="forge-rh-panel" title="Round HSS bending · AISC §F8" onClose={() => setOpen(false)}>
            <Row label="D OD (mm)" v={D} set={setD}/>
            <Row label="t wall (mm)" v={t} set={setT}/>
            <Row label="F_y (MPa)" v={fy} set={setFy}/>
            <Row label="E (GPa)" v={E} set={setEe}/>
            <Btn testid="forge-rh-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-rh-result">
                <Ln k="D/t" v={r.DoverT.toFixed(2)}/>
                <Ln k="λ_p / λ_r" v={`${r.lambda_p.toFixed(1)} / ${r.lambda_r.toFixed(1)}`}/>
                <Banner testid="forge-rh-class" colour={classColor(r.classification)}>
                    {classText(r.classification)}
                </Banner>
                <Ln k="Z" v={r.plasticModulus_Z_mm3.toFixed(0) + ' mm³'}/>
                <Big testid="forge-rh-mn" colour="#3fb950">φM_n = {r.phiMn_kNm.toFixed(2)} kN·m</Big>
            </Res>}
        </P>, document.body);
}

export function PlateHXWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Th, setTh] = useState(80);
    const [Tc, setTc] = useState(20);
    const [mh, setMh] = useState(2);
    const [mc, setMc] = useState(1);
    const [cph, setCph] = useState(4.18);
    const [cpc, setCpc] = useState(4.18);
    const [UA, setUA] = useState(12);
    const [flow, setFlow] = useState(0);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenPlateHXWorkbench  = () => setOpen(true);
        window.__forgeClosePlateHXWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenPlateHXWorkbench; delete window.__forgeClosePlateHXWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.ehx?.analyse({hotInletTemp_Th_in_C:Number(Th), coldInletTemp_Tc_in_C:Number(Tc), hotMassFlow_kgPerS:Number(mh), coldMassFlow_kgPerS:Number(mc), hotCp_kJperKgK:Number(cph), coldCp_kJperKgK:Number(cpc), UA_kWperK:Number(UA), flowArrangement:Math.round(Number(flow))})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-px-panel" title="Plate HX ε-NTU · Çengel §11" onClose={() => setOpen(false)}>
            <Row label="T_h,in (°C)" v={Th} set={setTh}/>
            <Row label="T_c,in (°C)" v={Tc} set={setTc}/>
            <Row label="ṁ_h (kg/s)" v={mh} set={setMh}/>
            <Row label="ṁ_c (kg/s)" v={mc} set={setMc}/>
            <Row label="cp_h" v={cph} set={setCph}/>
            <Row label="cp_c" v={cpc} set={setCpc}/>
            <Row label="UA (kW/K)" v={UA} set={setUA}/>
            <Row label="flow 0=cf 1=pf" v={flow} set={setFlow}/>
            <Btn testid="forge-px-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-px-result">
                <Ln k="C_min/C_r" v={`${r.Cmin_kWperK.toFixed(2)} / ${r.Cr.toFixed(2)}`}/>
                <Ln k="NTU" v={r.NTU.toFixed(3)}/>
                <Big testid="forge-px-eps" colour="#3fb950">ε = {r.effectiveness.toFixed(3)}</Big>
                <Big testid="forge-px-q" colour="#58a6ff">Q = {r.heatTransfer_kW.toFixed(1)} kW</Big>
                <Ln k="T_h,out" v={r.hotOutletTemp_C.toFixed(1) + ' °C'}/>
                <Ln k="T_c,out" v={r.coldOutletTemp_C.toFixed(1) + ' °C'}/>
            </Res>}
        </P>, document.body);
}

export function FOSMWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [muR, setMuR] = useState(1000);
    const [sR, setSR] = useState(100);
    const [muS, setMuS] = useState(500);
    const [sS, setSS] = useState(50);
    const [rho, setRho] = useState(0);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenFOSMWorkbench  = () => setOpen(true);
        window.__forgeCloseFOSMWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenFOSMWorkbench; delete window.__forgeCloseFOSMWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.fosm?.analyse({meanR:Number(muR), sigmaR:Number(sR), meanS:Number(muS), sigmaS:Number(sS), correlation_rho:Number(rho)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-fo-panel" title="FOSM reliability β · Cornell" onClose={() => setOpen(false)}>
            <Row label="μ_R" v={muR} set={setMuR}/>
            <Row label="σ_R" v={sR} set={setSR}/>
            <Row label="μ_S" v={muS} set={setMuS}/>
            <Row label="σ_S" v={sS} set={setSS}/>
            <Row label="ρ R-S correl" v={rho} set={setRho}/>
            <Btn testid="forge-fo-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-fo-result">
                <Ln k="μ_g" v={r.mean_g.toFixed(2)}/>
                <Ln k="σ_g" v={r.sigma_g.toFixed(2)}/>
                <Big testid="forge-fo-b" colour="#3fb950">β = {r.beta.toFixed(3)}</Big>
                <Big testid="forge-fo-pf" colour="#58a6ff">p_f = {r.probabilityOfFailure.toExponential(2)}</Big>
            </Res>}
        </P>, document.body);
}

export function FlutterWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [B, setB] = useState(30);
    const [m, setM] = useState(15000);
    const [fa, setFa] = useState(0.3);
    const [fh, setFh] = useState(0.15);
    const [rho, setRho] = useState(1.225);
    const [Vd, setVd] = useState(70);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenFlutterWorkbench  = () => setOpen(true);
        window.__forgeCloseFlutterWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenFlutterWorkbench; delete window.__forgeCloseFlutterWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.flutter?.analyse({deckWidth_B_m:Number(B), linearMass_kgPerM:Number(m), torsionalFreq_falpha_Hz:Number(fa), heaveFreq_fh_Hz:Number(fh), airDensity_kgM3:Number(rho), designWindSpeed_Vd_mps:Number(Vd)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-fl-panel" title="Bridge deck flutter · Selberg" onClose={() => setOpen(false)}>
            <Row label="B deck (m)" v={B} set={setB}/>
            <Row label="m (kg/m)" v={m} set={setM}/>
            <Row label="f_α torsion (Hz)" v={fa} set={setFa}/>
            <Row label="f_h heave (Hz)" v={fh} set={setFh}/>
            <Row label="ρ_air" v={rho} set={setRho}/>
            <Row label="V_d design wind (m/s)" v={Vd} set={setVd}/>
            <Btn testid="forge-fl-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-fl-result">
                <Ln k="μ mass ratio" v={r.massRatio_mu.toFixed(2)}/>
                <Big testid="forge-fl-ucr" colour={r.stable ? '#3fb950' : '#f85149'}>U_cr = {r.criticalWindSpeed_Ucr_mps.toFixed(1)} m/s</Big>
                <Ln k="SF U_cr/V_d" v={r.safetyFactorUcrOverVd.toFixed(2)}/>
                <Banner testid="forge-fl-ok" colour={r.stable ? '#3fb950' : '#f85149'}>
                    {r.stable ? 'STABLE' : 'FLUTTER PREDICTED'}
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
        background:colour === '#3fb950' ? '#1d2d1d' : colour === '#fbb13c' ? '#3d2d1d' : '#3d1d1d',
        color:colour, fontWeight:700, textAlign:'center'}}>{children}</div>;
}
