// Forge-333 bundle — bolted flange + ogee spillway + IEEE 80 grounding + response spectrum + buoyant stability.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function BoltedFlangeWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [P, setP] = useState(4);
    const [Od, setOd] = useState(180);
    const [Id, setId] = useState(160);
    const [mF, setMf] = useState(3.0);
    const [yS, setYs] = useState(70);
    const [Sa, setSa] = useState(137);
    const [Satm, setSatm] = useState(172);
    const [Ab, setAb] = useState(92);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenBoltedFlangeWorkbench  = () => setOpen(true);
        window.__forgeCloseBoltedFlangeWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenBoltedFlangeWorkbench; delete window.__forgeCloseBoltedFlangeWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.flange?.analyse({designPressure_MPa:Number(P), gasketOD_mm:Number(Od), gasketID_mm:Number(Id), gasketFactorM:Number(mF), seatingStress_y_MPa:Number(yS), allowableBoltStress_Sa_MPa:Number(Sa), allowableBoltStressAtm_Satm_MPa:Number(Satm), singleBoltArea_mm2:Number(Ab)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-flg-panel" title="Bolted flange · ASME Sec VIII / B16.5" onClose={() => setOpen(false)}>
            <Row label="P design (MPa)" v={P} set={setP}/>
            <Row label="gasket OD (mm)" v={Od} set={setOd}/>
            <Row label="gasket ID (mm)" v={Id} set={setId}/>
            <Row label="m gasket factor" v={mF} set={setMf}/>
            <Row label="y seating (MPa)" v={yS} set={setYs}/>
            <Row label="S_a operating (MPa)" v={Sa} set={setSa}/>
            <Row label="S_atm ambient (MPa)" v={Satm} set={setSatm}/>
            <Row label="A_bolt root (mm²)" v={Ab} set={setAb}/>
            <Btn testid="forge-flg-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-flg-result">
                <Ln k="b effective" v={r.effectiveWidth_b_mm.toFixed(2) + ' mm'}/>
                <Ln k="G effective" v={r.effectiveDiameter_G_mm.toFixed(1) + ' mm'}/>
                <Ln k="H_d / H_p" v={r.Hd_kN.toFixed(2) + ' / ' + r.Hp_kN.toFixed(2) + ' kN'}/>
                <Ln k="W_m1 operating" v={r.Wm1_kN.toFixed(2) + ' kN'}/>
                <Ln k="W_m2 seating" v={r.Wm2_kN.toFixed(2) + ' kN'}/>
                <Big testid="forge-flg-am" colour="#3fb950">A_m = {r.Am_required_mm2.toFixed(0)} mm²</Big>
                <Big testid="forge-flg-nb" colour="#58a6ff">n bolts ≥ {r.boltCountRequired}</Big>
            </Res>}
        </P>, document.body);
}

export function OgeeWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [H, setH] = useState(3);
    const [Hd, setHd] = useState(3.5);
    const [L, setL] = useState(20);
    const [N, setN] = useState(2);
    const [Kp, setKp] = useState(0.01);
    const [Ka, setKa] = useState(0.10);
    const [C, setC] = useState(2.18);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenOgeeWorkbench  = () => setOpen(true);
        window.__forgeCloseOgeeWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenOgeeWorkbench; delete window.__forgeCloseOgeeWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.ogee?.analyse({headOverCrest_H_m:Number(H), designHead_Hd_m:Number(Hd), crestLength_L_m:Number(L), pierCount_N:Math.round(Number(N)), pierContraction_Kp:Number(Kp), abutmentContraction_Ka:Number(Ka), dischargeCoefficient_C:Number(C), profileSamples:0})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-og-panel" title="Ogee spillway · USACE EM 1110" onClose={() => setOpen(false)}>
            <Row label="H head (m)" v={H} set={setH}/>
            <Row label="H_d design head (m)" v={Hd} set={setHd}/>
            <Row label="L crest length (m)" v={L} set={setL}/>
            <Row label="N piers" v={N} set={setN}/>
            <Row label="K_p pier contract" v={Kp} set={setKp}/>
            <Row label="K_a abutment" v={Ka} set={setKa}/>
            <Row label="C discharge coeff" v={C} set={setC}/>
            <Btn testid="forge-og-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-og-result">
                <Ln k="L_e effective" v={r.effectiveLength_Le_m.toFixed(2) + ' m'}/>
                <Big testid="forge-og-Q" colour="#3fb950">Q = {r.dischargeQ_m3s.toFixed(1)} m³/s</Big>
                <Big testid="forge-og-q" colour="#58a6ff">q = {r.specificDischarge_q_m2s.toFixed(2)} m²/s</Big>
            </Res>}
        </P>, document.body);
}

export function GroundGridWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [rho, setRho] = useState(400);
    const [rhos, setRhos] = useState(3000);
    const [hs, setHs] = useState(0.10);
    const [h, setH] = useState(0.5);
    const [A, setA] = useState(900);
    const [Lt, setLt] = useState(600);
    const [ts, setTs] = useState(0.5);
    const [If, setIf] = useState(20);
    const [Kf, setKf] = useState(7.06);
    const [body, setBody] = useState(50);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenGroundGridWorkbench  = () => setOpen(true);
        window.__forgeCloseGroundGridWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenGroundGridWorkbench; delete window.__forgeCloseGroundGridWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.groundgrid?.analyse({soilResistivity_rho_Ohmm:Number(rho), surfaceLayerResistivity_rhos_Ohmm:Number(rhos), surfaceLayerDepth_hs_m:Number(hs), gridDepth_h_m:Number(h), gridArea_m2:Number(A), totalConductorLength_m:Number(Lt), faultClearTime_s:Number(ts), faultCurrent_kA:Number(If), conductorKf:Number(Kf), bodyWeight_kg:Math.round(Number(body))})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-gg-panel" title="Substation grounding · IEEE 80" onClose={() => setOpen(false)}>
            <Row label="ρ soil (Ω·m)" v={rho} set={setRho}/>
            <Row label="ρ_s surface (Ω·m)" v={rhos} set={setRhos}/>
            <Row label="h_s surface depth (m)" v={hs} set={setHs}/>
            <Row label="h grid depth (m)" v={h} set={setH}/>
            <Row label="A grid area (m²)" v={A} set={setA}/>
            <Row label="L_T conductor (m)" v={Lt} set={setLt}/>
            <Row label="t_s clear time (s)" v={ts} set={setTs}/>
            <Row label="I_F fault (kA)" v={If} set={setIf}/>
            <Row label="K_f conductor" v={Kf} set={setKf}/>
            <Row label="body weight (50/70)" v={body} set={setBody}/>
            <Btn testid="forge-gg-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-gg-result">
                <Ln k="C_s" v={r.Cs_surface_derating.toFixed(3)}/>
                <Ln k="E_step" v={r.allowableStepVoltage_V.toFixed(0) + ' V'}/>
                <Ln k="E_touch" v={r.allowableTouchVoltage_V.toFixed(0) + ' V'}/>
                <Big testid="forge-gg-rg" colour="#3fb950">R_g = {r.gridResistance_Ohm.toFixed(2)} Ω</Big>
                <Big testid="forge-gg-gpr" colour="#58a6ff">GPR = {r.groundPotentialRise_V.toFixed(0)} V</Big>
            </Res>}
        </P>, document.body);
}

export function ResponseSpectrumWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [csv, setCsv] = useState('0.3 g · sin(2π·t/0.5), 0–5 s, dt 0.01 (preset)');
    const [zeta, setZeta] = useState(0.05);
    const [Tmin, setTmin] = useState(0.1);
    const [Tmax, setTmax] = useState(2.0);
    const [nPts, setNpts] = useState(10);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenResponseSpectrumWorkbench  = () => setOpen(true);
        window.__forgeCloseResponseSpectrumWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenResponseSpectrumWorkbench; delete window.__forgeCloseResponseSpectrumWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        const N = 501;
        const time = Array.from({length:N}, (_,i) => i * 0.01);
        const accel = time.map(t => 0.3 * 9.81 * Math.sin(2 * Math.PI * t / 0.5));
        setR(window.forge?.rspect?.analyse({time_s:time, accel_ms2:accel, dampingRatio:Number(zeta), Tmin_s:Number(Tmin), Tmax_s:Number(Tmax), nSpectralPoints:Math.round(Number(nPts))})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-rs-panel" title="Response spectrum · Newmark β" onClose={() => setOpen(false)}>
            <div style={{color:'#8b949e', fontSize:11, margin:'5px 0'}}>{csv}</div>
            <Row label="ζ damping" v={zeta} set={setZeta}/>
            <Row label="T_min (s)" v={Tmin} set={setTmin}/>
            <Row label="T_max (s)" v={Tmax} set={setTmax}/>
            <Row label="n spectral points" v={nPts} set={setNpts}/>
            <Btn testid="forge-rs-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && (() => {
                let pk = {Sa_mps2:0, T_s:0};
                r.spectrum.forEach(p => { if (p.Sa_mps2 > pk.Sa_mps2) pk = p; });
                return <Res testid="forge-rs-result">
                    <Ln k="PGA" v={r.peakGroundAccel_ms2.toFixed(2) + ' m/s²'}/>
                    <Big testid="forge-rs-peak" colour="#3fb950">peak Sa = {pk.Sa_mps2.toFixed(2)} m/s²</Big>
                    <Big testid="forge-rs-tpeak" colour="#58a6ff">at T = {pk.T_s.toFixed(3)} s</Big>
                </Res>;
            })()}
        </P>, document.body);
}

export function BuoyancyWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [m, setM] = useState(100000);
    const [rho, setRho] = useState(1025);
    const [L, setL] = useState(20);
    const [B, setBb] = useState(5);
    const [KG, setKG] = useState(2);
    const [phi, setPhi] = useState(10);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenBuoyancyWorkbench  = () => setOpen(true);
        window.__forgeCloseBuoyancyWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenBuoyancyWorkbench; delete window.__forgeCloseBuoyancyWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.buoyfloat?.analyse({bodyMass_kg:Number(m), fluidDensity_kgM3:Number(rho), length_m:Number(L), beam_m:Number(B), KG_m:Number(KG), heelAngle_deg:Number(phi)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-by-panel" title="Buoyant floating-body stability" onClose={() => setOpen(false)}>
            <Row label="m mass (kg)" v={m} set={setM}/>
            <Row label="ρ fluid (kg/m³)" v={rho} set={setRho}/>
            <Row label="L waterplane (m)" v={L} set={setL}/>
            <Row label="B beam (m)" v={B} set={setBb}/>
            <Row label="KG above keel (m)" v={KG} set={setKG}/>
            <Row label="φ heel (°)" v={phi} set={setPhi}/>
            <Btn testid="forge-by-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-by-result">
                <Ln k="V displaced" v={r.displacedVolume_m3.toFixed(2) + ' m³'}/>
                <Ln k="T draught" v={r.draught_m.toFixed(3) + ' m'}/>
                <Ln k="KB / BM" v={r.KB_m.toFixed(3) + ' / ' + r.BM_m.toFixed(3) + ' m'}/>
                <Big testid="forge-by-gm" colour={r.stable ? '#3fb950' : '#f85149'}>GM = {r.GM_m.toFixed(3)} m</Big>
                <Big testid="forge-by-mr" colour="#58a6ff">M_R = {r.rightingMoment_kNm.toFixed(1)} kN·m</Big>
                <Banner testid="forge-by-ok" colour={r.stable ? '#3fb950' : '#f85149'}>
                    {r.stable ? 'STABLE' : 'UNSTABLE'}
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
