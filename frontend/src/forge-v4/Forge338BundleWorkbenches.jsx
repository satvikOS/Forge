// Forge-338 bundle — composite slab + reverberation + adiabatic flame + MSE pullout + Bayesian update.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function CompSlabWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [fc, setFc] = useState(28);
    const [ts, setTs] = useState(100);
    const [hr, setHr] = useState(50);
    const [b, setB] = useState(2000);
    const [Qn, setQn] = useState(120);
    const [n, setN] = useState(12);
    const [As, setAs] = useState(6280);
    const [d, setD] = useState(305);
    const [Fy, setFy] = useState(345);
    const [Es, setEs] = useState(200);
    const [Ec, setEc] = useState(24);
    const [L, setL] = useState(8);
    const [w, setW] = useState(20);
    const [Is, setIs] = useState(145e6);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenCompSlabWorkbench  = () => setOpen(true);
        window.__forgeCloseCompSlabWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenCompSlabWorkbench; delete window.__forgeCloseCompSlabWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.compslab?.analyse({slabConcreteStrength_fc_MPa:Number(fc), slabThickness_mm:Number(ts), ribHeight_hr_mm:Number(hr), effectiveWidth_b_mm:Number(b), studCapacity_Qn_kN:Number(Qn), studCount_perSpan:Math.round(Number(n)), steelArea_mm2:Number(As), steelDepth_mm:Number(d), steelYield_Fy_MPa:Number(Fy), Es_GPa:Number(Es), Ec_GPa:Number(Ec), span_m:Number(L), serviceLoad_w_kNm:Number(w), steelI_mm4:Number(Is)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-cs-panel" title="Composite slab · ANSI/SDI C-1" onClose={() => setOpen(false)}>
            <Row label="f'_c (MPa)" v={fc} set={setFc}/>
            <Row label="t_s slab (mm)" v={ts} set={setTs}/>
            <Row label="h_r ribs (mm)" v={hr} set={setHr}/>
            <Row label="b effective (mm)" v={b} set={setB}/>
            <Row label="Q_n stud (kN)" v={Qn} set={setQn}/>
            <Row label="n studs" v={n} set={setN}/>
            <Row label="A_s steel (mm²)" v={As} set={setAs}/>
            <Row label="d_b steel (mm)" v={d} set={setD}/>
            <Row label="F_y (MPa)" v={Fy} set={setFy}/>
            <Row label="E_s (GPa)" v={Es} set={setEs}/>
            <Row label="E_c (GPa)" v={Ec} set={setEc}/>
            <Row label="span (m)" v={L} set={setL}/>
            <Row label="w service (kN/m)" v={w} set={setW}/>
            <Row label="I_steel (mm⁴)" v={Is} set={setIs}/>
            <Btn testid="forge-cs-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-cs-result">
                <Ln k="C compression" v={r.C_compression_kN.toFixed(0) + ' kN'}/>
                <Ln k="a depth" v={r.aDepth_mm.toFixed(2) + ' mm'}/>
                <Big testid="forge-cs-mn" colour="#3fb950">φM_n = {r.phiMn_kNm.toFixed(1)} kN·m</Big>
                <Ln k="δ_service" v={r.serviceDeflection_mm.toFixed(2) + ' mm'}/>
                <Banner testid="forge-cs-ok" colour={r.partialComposite ? '#f85149' : '#3fb950'}>
                    {r.partialComposite ? 'PARTIAL composite (studs govern)' : 'FULL composite'}
                </Banner>
            </Res>}
        </P>, document.body);
}

export function ReverbWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [V, setV] = useState(144);
    const [csv, setCsv] = useState('96,0.10\n48,0.05\n48,0.50');
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenReverbWorkbench  = () => setOpen(true);
        window.__forgeCloseReverbWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenReverbWorkbench; delete window.__forgeCloseReverbWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        const surfaces = csv.split('\n').filter(s => s.trim()).map(line => {
            const [area, alpha] = line.split(',').map(Number);
            return { area_m2:area, absorption_alpha:alpha };
        });
        setR(window.forge?.reverb?.analyse({roomVolume_m3:Number(V), surfaces})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-rv-panel" title="Sabine reverberation · ISO 3382" onClose={() => setOpen(false)}>
            <Row label="V (m³)" v={V} set={setV}/>
            <div style={{margin:'5px 0'}}>
                <div style={{color:'#8b949e', fontSize:11, marginBottom:4}}>surfaces: area_m²,α per line</div>
                <textarea value={csv} onChange={(ev) => setCsv(ev.target.value)} rows={4} style={{width:'100%', background:'#0d1117', color:'#c9d1d9', border:'1px solid #30363d', borderRadius:4, padding:6, fontFamily:'monospace', fontSize:12}}/>
            </div>
            <Btn testid="forge-rv-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-rv-result">
                <Ln k="A total" v={r.absorptionTotal_m2.toFixed(2) + ' m²'}/>
                <Big testid="forge-rv-t60" colour="#3fb950">T_60 = {r.T60_s.toFixed(3)} s</Big>
                <Big testid="forge-rv-sti" colour={r.intelligible ? '#3fb950' : '#f85149'}>STI ≈ {r.STI_estimate.toFixed(3)}</Big>
            </Res>}
        </P>, document.body);
}

export function FlameWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [LHV, setLHV] = useState(802300);
    const [phi, setPhi] = useState(1.0);
    const [T0, setT0] = useState(25);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenFlameWorkbench  = () => setOpen(true);
        window.__forgeCloseFlameWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenFlameWorkbench; delete window.__forgeCloseFlameWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.flame?.analyse({LHV_CH4_kJperKmol:Number(LHV), equivalenceRatio_phi:Number(phi), initialTemperature_C:Number(T0)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-fl-panel" title="Adiabatic flame · CH4/air · Turns" onClose={() => setOpen(false)}>
            <Row label="LHV (kJ/kmol)" v={LHV} set={setLHV}/>
            <Row label="φ equivalence" v={phi} set={setPhi}/>
            <Row label="T_init (°C)" v={T0} set={setT0}/>
            <Btn testid="forge-fl-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-fl-result">
                <Ln k="excess air" v={(r.airExcessFraction * 100).toFixed(1) + ' %'}/>
                <Ln k="moles CO₂/H₂O/N₂/O₂" v={`${r.productMoles_CO2.toFixed(2)} / ${r.productMoles_H2O.toFixed(2)} / ${r.productMoles_N2.toFixed(2)} / ${r.productMoles_O2.toFixed(2)}`}/>
                <Big testid="forge-fl-tad" colour="#f85149">T_ad = {r.adiabaticFlameTemp_K.toFixed(0)} K</Big>
                <Big testid="forge-fl-tadc" colour="#fbb13c">= {r.adiabaticFlameTemp_C.toFixed(0)} °C</Big>
            </Res>}
        </P>, document.body);
}

export function MSEPullWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [H, setH] = useState(6);
    const [z, setZ] = useState(3);
    const [Sv, setSv] = useState(0.5);
    const [phi, setPhi] = useState(34);
    const [gamma, setGamma] = useState(20);
    const [q, setQ] = useState(15);
    const [Rc, setRc] = useState(1);
    const [Fstar, setFstar] = useState(0.45);
    const [alpha, setAlpha] = useState(0.8);
    const [SF, setSF] = useState(1.5);
    const [bar, setBar] = useState(false);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenMSEPullWorkbench  = () => setOpen(true);
        window.__forgeCloseMSEPullWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenMSEPullWorkbench; delete window.__forgeCloseMSEPullWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.msepull?.analyse({wallHeight_H_m:Number(H), depthBelowCrest_z_m:Number(z), verticalSpacing_Sv_m:Number(Sv), soilFrictionAngleDeg_phi:Number(phi), soilUnitWeight_gamma_kNm3:Number(gamma), surchargeQ_kNm2:Number(q), reinforcementCoverage_Rc:Number(Rc), pulloutResistanceFactor_F:Number(Fstar), scaleEffectAlpha:Number(alpha), safetyFactorSF:Number(SF), isInextensibleBar:Boolean(bar)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-msp-panel" title="MSE wall pullout · FHWA-NHI-10-024" onClose={() => setOpen(false)}>
            <Row label="H wall (m)" v={H} set={setH}/>
            <Row label="z below crest (m)" v={z} set={setZ}/>
            <Row label="S_v spacing (m)" v={Sv} set={setSv}/>
            <Row label="φ (°)" v={phi} set={setPhi}/>
            <Row label="γ (kN/m³)" v={gamma} set={setGamma}/>
            <Row label="q surcharge (kN/m²)" v={q} set={setQ}/>
            <Row label="R_c coverage" v={Rc} set={setRc}/>
            <Row label="F* pullout factor" v={Fstar} set={setFstar}/>
            <Row label="α scale" v={alpha} set={setAlpha}/>
            <Row label="SF" v={SF} set={setSF}/>
            <div style={{display:'flex', alignItems:'center', margin:'5px 0'}}>
                <span style={{width:200}}>inextensible bar?</span>
                <input type="checkbox" checked={bar} onChange={(ev) => setBar(ev.target.checked)}/>
            </div>
            <Btn testid="forge-msp-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-msp-result">
                <Ln k="K_a / K_r/K_a / K_r" v={`${r.Ka.toFixed(3)} / ${r.KrOverKa.toFixed(2)} / ${r.Kr.toFixed(3)}`}/>
                <Ln k="σ_v" v={r.verticalEffectiveStress_sigmaV_kPa.toFixed(1) + ' kPa'}/>
                <Big testid="forge-msp-t" colour="#3fb950">T_max = {r.maxLayerTension_Tmax_kNperM.toFixed(2)} kN/m</Big>
                <Ln k="L_e" v={r.requiredEmbedmentLength_Le_m.toFixed(3) + ' m'}/>
                <Ln k="L_a" v={r.activeZoneLength_La_m.toFixed(3) + ' m'}/>
                <Big testid="forge-msp-l" colour="#58a6ff">L total ≥ {r.totalReinforcementLength_L_m.toFixed(3)} m</Big>
            </Res>}
        </P>, document.body);
}

export function BayesWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [a, setA] = useState(2);
    const [b, setB] = useState(2);
    const [n, setN] = useState(30);
    const [k, setK] = useState(18);
    const [cl, setCL] = useState(0.95);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenBayesWorkbench  = () => setOpen(true);
        window.__forgeCloseBayesWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenBayesWorkbench; delete window.__forgeCloseBayesWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.bayes?.analyse({priorAlpha:Number(a), priorBeta:Number(b), trials_n:Math.round(Number(n)), successes_k:Math.round(Number(k)), credibleLevel:Number(cl)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-by-panel" title="Beta-Binomial update · Gelman BDA" onClose={() => setOpen(false)}>
            <Row label="α prior" v={a} set={setA}/>
            <Row label="β prior" v={b} set={setB}/>
            <Row label="n trials" v={n} set={setN}/>
            <Row label="k successes" v={k} set={setK}/>
            <Row label="credible level" v={cl} set={setCL}/>
            <Btn testid="forge-by-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-by-result">
                <Ln k="posterior Beta" v={`(${r.posteriorAlpha.toFixed(1)}, ${r.posteriorBeta.toFixed(1)})`}/>
                <Big testid="forge-by-mean" colour="#3fb950">mean θ = {r.posteriorMean.toFixed(3)}</Big>
                <Ln k="sd" v={r.posteriorStdDev.toFixed(3)}/>
                <Big testid="forge-by-ci" colour="#58a6ff">CI = [{r.credibleIntervalLower.toFixed(3)}, {r.credibleIntervalUpper.toFixed(3)}]</Big>
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
