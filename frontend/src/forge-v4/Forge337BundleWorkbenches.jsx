// Forge-337 bundle — biaxial footing + aluminum ADM + Morison wave + Fourier heat + simulated annealing.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function BiaxFootWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [P, setP] = useState(2000);
    const [Mx, setMx] = useState(400);
    const [My, setMy] = useState(600);
    const [Bx, setBx] = useState(3);
    const [By, setBy] = useState(4);
    const [sig, setSig] = useState(300);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenBiaxFootWorkbench  = () => setOpen(true);
        window.__forgeCloseBiaxFootWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenBiaxFootWorkbench; delete window.__forgeCloseBiaxFootWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.biaxfoot?.analyse({axialLoad_P_kN:Number(P), momentMx_kNm:Number(Mx), momentMy_kNm:Number(My), footingBx_m:Number(Bx), footingBy_m:Number(By), allowableBearing_kPa:Number(sig)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-bf-panel" title="Biaxial footing · ACI 318 §13.3" onClose={() => setOpen(false)}>
            <Row label="P (kN)" v={P} set={setP}/>
            <Row label="M_x (kN·m)" v={Mx} set={setMx}/>
            <Row label="M_y (kN·m)" v={My} set={setMy}/>
            <Row label="B_x (m)" v={Bx} set={setBx}/>
            <Row label="B_y (m)" v={By} set={setBy}/>
            <Row label="σ_allow (kPa)" v={sig} set={setSig}/>
            <Btn testid="forge-bf-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-bf-result">
                <Ln k="e_x / e_y" v={`${r.eccentricity_ex_m.toFixed(3)} / ${r.eccentricity_ey_m.toFixed(3)} m`}/>
                <Big testid="forge-bf-max" colour={r.stable ? '#3fb950' : '#f85149'}>σ_max = {r.sigmaMax_kPa.toFixed(2)} kPa</Big>
                <Ln k="σ_min" v={r.sigmaMin_kPa.toFixed(2) + ' kPa'}/>
                <Banner testid="forge-bf-ok" colour={r.stable ? '#3fb950' : '#f85149'}>
                    {r.upliftDetected ? 'UPLIFT — partial bearing' : (r.stable ? 'OK' : 'σ_max > σ_allow')}
                </Banner>
            </Res>}
        </P>, document.body);
}

export function ADMWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [alloy, setAlloy] = useState('6061-T6');
    const [kL, setKL] = useState(1500);
    const [r_g, setRg] = useState(25);
    const [b, setB] = useState(80);
    const [t, setT] = useState(4);
    const [Omega, setOmega] = useState(1.65);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenADMWorkbench  = () => setOpen(true);
        window.__forgeCloseADMWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenADMWorkbench; delete window.__forgeCloseADMWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.adm?.analyse({alloy:String(alloy), effectiveLength_mm:Number(kL), radiusOfGyration_mm:Number(r_g), flatWidth_b_mm:Number(b), flatThickness_t_mm:Number(t), safetyFactor_Omega:Number(Omega)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-adm-panel" title="Aluminum ADM 2020 · §F.4" onClose={() => setOpen(false)}>
            <div style={{display:'flex', alignItems:'center', margin:'5px 0'}}>
                <span style={{width:200}}>alloy</span>
                <input type="text" value={alloy} onChange={(ev) => setAlloy(ev.target.value)} style={{flex:1, background:'#0d1117', color:'#c9d1d9', border:'1px solid #30363d', borderRadius:4, padding:4}}/>
            </div>
            <Row label="kL (mm)" v={kL} set={setKL}/>
            <Row label="r radius gyr (mm)" v={r_g} set={setRg}/>
            <Row label="b flat (mm)" v={b} set={setB}/>
            <Row label="t thickness (mm)" v={t} set={setT}/>
            <Row label="Ω safety" v={Omega} set={setOmega}/>
            <Btn testid="forge-adm-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-adm-result">
                <Ln k="F_y / F_u" v={`${r.yieldStrength_MPa} / ${r.ultimateStrength_MPa} MPa`}/>
                <Ln k="λ" v={r.slenderness.toFixed(1)}/>
                <Ln k="b/t" v={r.btRatio.toFixed(1)}/>
                <Big testid="forge-adm-fa" colour="#3fb950">F_a = {r.allowableAxialStress_MPa.toFixed(2)} MPa</Big>
                <Banner testid="forge-adm-ok" colour={r.localBucklingControlled ? '#f85149' : '#3fb950'}>
                    {r.localBucklingControlled ? 'LOCAL BUCKLING' : 'compact section'}
                </Banner>
            </Res>}
        </P>, document.body);
}

export function MorisonWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [H, setH] = useState(10);
    const [T, setT] = useState(12);
    const [d, setD] = useState(30);
    const [D, setDd] = useState(2);
    const [rho, setRho] = useState(1025);
    const [CM, setCM] = useState(2.0);
    const [CD, setCD] = useState(1.0);
    const [z, setZ] = useState(0);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenMorisonWorkbench  = () => setOpen(true);
        window.__forgeCloseMorisonWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenMorisonWorkbench; delete window.__forgeCloseMorisonWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.morison?.analyse({waveHeight_H_m:Number(H), wavePeriod_T_s:Number(T), waterDepth_d_m:Number(d), cylinderDiameter_D_m:Number(D), waterDensity_kgM3:Number(rho), inertiaCoeff_CM:Number(CM), dragCoeff_CD:Number(CD), evaluationDepth_z_m:Number(z)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-mr-panel" title="Morison wave force · DNV/API" onClose={() => setOpen(false)}>
            <Row label="H (m)" v={H} set={setH}/>
            <Row label="T (s)" v={T} set={setT}/>
            <Row label="d depth (m)" v={d} set={setD}/>
            <Row label="D cyl (m)" v={D} set={setDd}/>
            <Row label="ρ water" v={rho} set={setRho}/>
            <Row label="C_M" v={CM} set={setCM}/>
            <Row label="C_D" v={CD} set={setCD}/>
            <Row label="z evaluation (≤0)" v={z} set={setZ}/>
            <Btn testid="forge-mr-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-mr-result">
                <Ln k="k" v={r.waveNumber_k_perM.toFixed(4) + ' /m'}/>
                <Ln k="u_max" v={r.maxParticleVelocity_mps.toFixed(2) + ' m/s'}/>
                <Ln k="F_inertia" v={r.inertiaForcePerM_kN.toFixed(2) + ' kN/m'}/>
                <Ln k="F_drag" v={r.dragForcePerM_kN.toFixed(2) + ' kN/m'}/>
                <Big testid="forge-mr-res" colour="#3fb950">F_res = {r.resultantPerM_kN.toFixed(2)} kN/m</Big>
            </Res>}
        </P>, document.body);
}

export function FourierWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Ts, setTs] = useState(600);
    const [Tinf, setTinf] = useState(20);
    const [kCond, setKCond] = useState(50);
    const [rho, setRho] = useState(7850);
    const [cp, setCp] = useState(470);
    const [x, setX] = useState(0.005);
    const [t, setT] = useState(10);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenFourierWorkbench  = () => setOpen(true);
        window.__forgeCloseFourierWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenFourierWorkbench; delete window.__forgeCloseFourierWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.fourier?.analyse({surfaceTemperature_Ts_C:Number(Ts), initialTemperature_Tinf_C:Number(Tinf), thermalConductivity_k_WmK:Number(kCond), density_rho_kgM3:Number(rho), specificHeat_cp_JkgK:Number(cp), depth_x_m:Number(x), time_t_s:Number(t)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-fh-panel" title="Fourier conduction · Carslaw-Jaeger" onClose={() => setOpen(false)}>
            <Row label="T_s surface (°C)" v={Ts} set={setTs}/>
            <Row label="T_∞ initial (°C)" v={Tinf} set={setTinf}/>
            <Row label="k W/m·K" v={kCond} set={setKCond}/>
            <Row label="ρ kg/m³" v={rho} set={setRho}/>
            <Row label="c_p J/kg·K" v={cp} set={setCp}/>
            <Row label="x depth (m)" v={x} set={setX}/>
            <Row label="t time (s)" v={t} set={setT}/>
            <Btn testid="forge-fh-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-fh-result">
                <Ln k="α" v={r.thermalDiffusivity_alpha_m2pers.toExponential(3) + ' m²/s'}/>
                <Ln k="η = x/(2√(αt))" v={r.normalisedDepth_eta.toFixed(3)}/>
                <Big testid="forge-fh-T" colour="#3fb950">T(x,t) = {r.temperatureAtDepth_C.toFixed(1)} °C</Big>
                <Ln k="q_s surface" v={(r.surfaceHeatFlux_Wm2 / 1000).toFixed(0) + ' kW/m²'}/>
                <Ln k="δ penetration" v={(r.penetrationDepth_m * 1000).toFixed(1) + ' mm'}/>
            </Res>}
        </P>, document.body);
}

export function SAWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [xL, setXL] = useState(-2);
    const [xU, setXU] = useState(2);
    const [yL, setYL] = useState(-2);
    const [yU, setYU] = useState(3);
    const [T0, setT0] = useState(10);
    const [alpha, setAlpha] = useState(0.995);
    const [iters, setIters] = useState(5000);
    const [sigma, setSigma] = useState(0.5);
    const [seed, setSeed] = useState(42);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenSAWorkbench  = () => setOpen(true);
        window.__forgeCloseSAWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenSAWorkbench; delete window.__forgeCloseSAWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.sa?.analyse({xLower:Number(xL), xUpper:Number(xU), yLower:Number(yL), yUpper:Number(yU), initialTemperature:Number(T0), coolingFactor:Number(alpha), iterationsTotal:Math.round(Number(iters)), proposalStdDev:Number(sigma), randomSeed:Math.round(Number(seed))})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-sa-panel" title="Simulated annealing · Rosenbrock" onClose={() => setOpen(false)}>
            <Row label="x_lo / x_hi" v={xL} set={setXL}/>
            <Row label="x upper" v={xU} set={setXU}/>
            <Row label="y_lo" v={yL} set={setYL}/>
            <Row label="y_hi" v={yU} set={setYU}/>
            <Row label="T_0 initial" v={T0} set={setT0}/>
            <Row label="α cooling" v={alpha} set={setAlpha}/>
            <Row label="iters" v={iters} set={setIters}/>
            <Row label="σ proposal" v={sigma} set={setSigma}/>
            <Row label="seed" v={seed} set={setSeed}/>
            <Btn testid="forge-sa-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-sa-result">
                <Big testid="forge-sa-pt" colour="#3fb950">best (x,y) = ({r.bestX.toFixed(3)}, {r.bestY.toFixed(3)})</Big>
                <Big testid="forge-sa-val" colour="#58a6ff">f = {r.bestValue.toExponential(3)}</Big>
                <Ln k="acceptance" v={(r.acceptanceRatio * 100).toFixed(1) + ' %'}/>
                <Ln k="T_final" v={r.finalTemperature.toExponential(2)}/>
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
