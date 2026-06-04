// Forge-340 bundle — CMU shear + slip-critical bolts + chilled beam + weld heat input + Markov.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function CMUShearWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Vu, setVu] = useState(600);
    const [Mu, setMu] = useState(300);
    const [An, setAn] = useState(600000);
    const [dv, setDv] = useState(3000);
    const [fm, setFm] = useState(20);
    const [Av, setAv] = useState(129);
    const [s, setS] = useState(300);
    const [fy, setFy] = useState(400);
    const [phi, setPhi] = useState(0.8);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenCMUShearWorkbench  = () => setOpen(true);
        window.__forgeCloseCMUShearWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenCMUShearWorkbench; delete window.__forgeCloseCMUShearWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.cmushear?.analyse({Vu_kN:Number(Vu), Mu_kNm:Number(Mu), netArea_An_mm2:Number(An), wallLength_dv_mm:Number(dv), primeMasonryStrength_fm_MPa:Number(fm), horizReinfArea_Av_mm2:Number(Av), horizReinfSpacing_s_mm:Number(s), horizReinfYield_fy_MPa:Number(fy), phi:Number(phi)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-cmsh-panel" title="CMU in-plane shear · TMS 402 §9.3" onClose={() => setOpen(false)}>
            <Row label="V_u (kN)" v={Vu} set={setVu}/>
            <Row label="M_u (kN·m)" v={Mu} set={setMu}/>
            <Row label="A_n (mm²)" v={An} set={setAn}/>
            <Row label="d_v wall length (mm)" v={dv} set={setDv}/>
            <Row label="f'_m (MPa)" v={fm} set={setFm}/>
            <Row label="A_v (mm²)" v={Av} set={setAv}/>
            <Row label="s spacing (mm)" v={s} set={setS}/>
            <Row label="f_y (MPa)" v={fy} set={setFy}/>
            <Row label="φ" v={phi} set={setPhi}/>
            <Btn testid="forge-cmsh-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-cmsh-result">
                <Ln k="M/(V·d_v)" v={r.M_over_Vd.toFixed(3)}/>
                <Ln k="V_nm masonry" v={r.Vnm_kN.toFixed(1) + ' kN'}/>
                <Ln k="V_ns reinf" v={r.Vns_kN.toFixed(1) + ' kN'}/>
                <Ln k="V_n,max cap" v={r.VnMax_kN.toFixed(1) + ' kN'}/>
                <Big testid="forge-cmsh-vn" colour="#3fb950">φV_n = {r.phiVn_kN.toFixed(1)} kN</Big>
                <Banner testid="forge-cmsh-ok" colour={r.meetsDemand ? '#3fb950' : '#f85149'}>
                    {r.meetsDemand ? 'φV_n ≥ V_u OK' : 'INSUFFICIENT'}
                </Banner>
            </Res>}
        </P>, document.body);
}

export function SlipCritWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [mu, setMu] = useState(0.30);
    const [hf, setHf] = useState(0);
    const [Tb, setTb] = useState(142);
    const [ns, setNs] = useState(1);
    const [nb, setNb] = useState(6);
    const [Tu, setTu] = useState(0);
    const [phi, setPhi] = useState(1.0);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenSlipCritWorkbench  = () => setOpen(true);
        window.__forgeCloseSlipCritWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenSlipCritWorkbench; delete window.__forgeCloseSlipCritWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.sccrit?.analyse({slipCoefficient_mu:Number(mu), fillerCount_hf:Math.round(Number(hf)), pretension_Tb_kN:Number(Tb), slipPlaneCount_ns:Math.round(Number(ns)), boltCount_nb:Math.round(Number(nb)), Tu_per_bolt_kN:Number(Tu), phi_for_holeType:Number(phi)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-sc-panel" title="Slip-critical bolts · AISC §J3.8" onClose={() => setOpen(false)}>
            <Row label="μ (0.30 A / 0.50 B)" v={mu} set={setMu}/>
            <Row label="fillers count" v={hf} set={setHf}/>
            <Row label="T_b pretension (kN)" v={Tb} set={setTb}/>
            <Row label="n_s slip planes" v={ns} set={setNs}/>
            <Row label="n_b bolt count" v={nb} set={setNb}/>
            <Row label="T_u per bolt (kN)" v={Tu} set={setTu}/>
            <Row label="φ (1.0 std / 0.85 OVS)" v={phi} set={setPhi}/>
            <Btn testid="forge-sc-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-sc-result">
                <Ln k="D_u" v={r.Du}/>
                <Ln k="h_f" v={r.hf}/>
                <Ln k="K_sc" v={r.Ksc_reduction.toFixed(3)}/>
                <Ln k="R_n/bolt" v={r.Rn_per_bolt_kN.toFixed(2) + ' kN'}/>
                <Big testid="forge-sc-rn" colour="#3fb950">φR_n total = {r.phiRn_total_kN.toFixed(2)} kN</Big>
            </Res>}
        </P>, document.body);
}

export function ChBeamWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Tz, setTz] = useState(24);
    const [Tpa, setTpa] = useState(14);
    const [Vpa, setVpa] = useState(25);
    const [Vw, setVw] = useState(1);
    const [Twi, setTwi] = useState(14);
    const [Two, setTwo] = useState(17);
    const [Ki, setKi] = useState(3.5);
    const [A, setA] = useState(20);
    const [occ, setOcc] = useState(5);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenChBeamWorkbench  = () => setOpen(true);
        window.__forgeCloseChBeamWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenChBeamWorkbench; delete window.__forgeCloseChBeamWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.chbeam?.analyse({zoneTemp_C:Number(Tz), primaryAirTemp_C:Number(Tpa), primaryAirFlow_LperS:Number(Vpa), chilledWaterFlow_LperMin:Number(Vw), chilledWaterIn_C:Number(Twi), chilledWaterOut_C:Number(Two), inductionRatio_Ki:Number(Ki), zoneArea_m2:Number(A), occupantCount:Math.round(Number(occ))})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-cb-panel" title="Active chilled beam · ASHRAE Ch 18" onClose={() => setOpen(false)}>
            <Row label="T_zone (°C)" v={Tz} set={setTz}/>
            <Row label="T_pa supply (°C)" v={Tpa} set={setTpa}/>
            <Row label="V_pa (L/s)" v={Vpa} set={setVpa}/>
            <Row label="V_water (L/min)" v={Vw} set={setVw}/>
            <Row label="T_w in (°C)" v={Twi} set={setTwi}/>
            <Row label="T_w out (°C)" v={Two} set={setTwo}/>
            <Row label="K_i induction" v={Ki} set={setKi}/>
            <Row label="A zone (m²)" v={A} set={setA}/>
            <Row label="occupants" v={occ} set={setOcc}/>
            <Btn testid="forge-cb-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-cb-result">
                <Ln k="Q_pa" v={r.primaryAirSensible_kW.toFixed(3) + ' kW'}/>
                <Ln k="Q_coil" v={r.coilSensible_kW.toFixed(3) + ' kW'}/>
                <Big testid="forge-cb-q" colour="#3fb950">Q_total = {r.totalCooling_kW.toFixed(3)} kW</Big>
                <Ln k="OA required" v={r.requiredOutsideAir_LperS.toFixed(1) + ' L/s'}/>
                <Banner testid="forge-cb-ok" colour={r.meetsOA ? '#3fb950' : '#f85149'}>
                    {r.meetsOA ? 'OA OK' : 'OA UNDERSIZED'}
                </Banner>
            </Res>}
        </P>, document.body);
}

export function WeldHIWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [eta, setEta] = useState(0.7);
    const [V, setV] = useState(25);
    const [I, setI] = useState(180);
    const [v, setVv] = useState(4);
    const [t, setT] = useState(10);
    const [T0, setT0] = useState(100);
    const [kcond, setKcond] = useState(50);
    const [rho, setRho] = useState(7850);
    const [cp, setCp] = useState(470);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenWeldHIWorkbench  = () => setOpen(true);
        window.__forgeCloseWeldHIWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenWeldHIWorkbench; delete window.__forgeCloseWeldHIWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.weldhi?.analyse({arcEfficiency_eta:Number(eta), voltage_V:Number(V), current_A:Number(I), travelSpeed_mmPerS:Number(v), plateThickness_mm:Number(t), preheatTemp_C:Number(T0), thermalConductivity_k_WmK:Number(kcond), densityRho_kgM3:Number(rho), specificHeat_cp_JkgK:Number(cp)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-whi-panel" title="Weld heat input · AWS D1.1 §3.6" onClose={() => setOpen(false)}>
            <Row label="η arc" v={eta} set={setEta}/>
            <Row label="V (volts)" v={V} set={setV}/>
            <Row label="I (amps)" v={I} set={setI}/>
            <Row label="v travel (mm/s)" v={v} set={setVv}/>
            <Row label="t plate (mm)" v={t} set={setT}/>
            <Row label="T_preheat (°C)" v={T0} set={setT0}/>
            <Row label="k (W/m·K)" v={kcond} set={setKcond}/>
            <Row label="ρ (kg/m³)" v={rho} set={setRho}/>
            <Row label="c_p (J/kg·K)" v={cp} set={setCp}/>
            <Btn testid="forge-whi-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-whi-result">
                <Big testid="forge-whi-hi" colour="#3fb950">HI = {r.heatInput_kJperMm.toFixed(3)} kJ/mm</Big>
                <Ln k="t_8/5" v={r.tEightFive_s.toFixed(2) + ' s'}/>
                <Ln k="HAZ width est." v={r.maxHAZWidthEstimate_mm.toFixed(2) + ' mm'}/>
                <Ln k="severity" v={r.thermalCycleSeverity.toFixed(4)}/>
            </Res>}
        </P>, document.body);
}

export function MarkovWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [n, setN] = useState(2);
    const [P, setP] = useState('0.9, 0.1\n0.5, 0.5');
    const [pi0, setPi0] = useState('1, 0');
    const [iters, setIters] = useState(10);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenMarkovWorkbench  = () => setOpen(true);
        window.__forgeCloseMarkovWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenMarkovWorkbench; delete window.__forgeCloseMarkovWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        const Pflat = P.split('\n').flatMap(s => s.split(',').map(Number));
        const pi = pi0.split(',').map(Number);
        setR(window.forge?.markov?.analyse({stateCount:Math.round(Number(n)), transitionMatrix:Pflat, initialDistribution:pi, iterationCount:Math.round(Number(iters)), powerMethodMaxIter:1000, powerMethodTolerance:1e-9})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-mk-panel" title="Markov chain · Grinstead-Snell" onClose={() => setOpen(false)}>
            <Row label="n states" v={n} set={setN}/>
            <div style={{margin:'5px 0'}}>
                <div style={{color:'#8b949e', fontSize:11, marginBottom:4}}>P matrix (rows comma-sep, lines per row)</div>
                <textarea value={P} onChange={(ev) => setP(ev.target.value)} rows={4} style={{width:'100%', background:'#0d1117', color:'#c9d1d9', border:'1px solid #30363d', borderRadius:4, padding:6, fontFamily:'monospace', fontSize:12}}/>
            </div>
            <Row label="π_0 (csv)" v={pi0} set={setPi0}/>
            <Row label="n iter for π_n" v={iters} set={setIters}/>
            <Btn testid="forge-mk-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-mk-result">
                <Ln k={`π_${iters}`} v={r.distributionAtN.map(v => v.toFixed(4)).join(', ')}/>
                <Big testid="forge-mk-pi" colour="#3fb950">π* = [{r.stationary.map(v => v.toFixed(4)).join(', ')}]</Big>
                <Ln k="conv iters" v={String(r.iterationsUsed)}/>
                <Banner testid="forge-mk-ok" colour={r.stationaryConverged ? '#3fb950' : '#f85149'}>
                    {r.stationaryConverged ? 'converged' : 'not converged'}
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
        background:colour === '#3fb950' ? '#1d2d1d' : '#3d1d1d',
        color:colour, fontWeight:700, textAlign:'center'}}>{children}</div>;
}
