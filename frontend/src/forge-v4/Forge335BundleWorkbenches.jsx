// Forge-335 bundle — RC corbel + wind tower foundation + air receiver + Butterworth IIR + pedestrian bridge.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function CorbelWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Vu, setVu] = useState(400);
    const [Nuc, setNuc] = useState(80);
    const [a, setA] = useState(150);
    const [bw, setBw] = useState(400);
    const [d, setD] = useState(400);
    const [h, setH] = useState(450);
    const [fc, setFc] = useState(35);
    const [fy, setFy] = useState(420);
    const [mu, setMu] = useState(1.4);
    const [phi, setPhi] = useState(0.75);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenCorbelWorkbench  = () => setOpen(true);
        window.__forgeCloseCorbelWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenCorbelWorkbench; delete window.__forgeCloseCorbelWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.corbel?.analyse({Vu_kN:Number(Vu), Nuc_kN:Number(Nuc), a_mm:Number(a), bw_mm:Number(bw), d_mm:Number(d), h_mm:Number(h), fc_MPa:Number(fc), fy_MPa:Number(fy), frictionMu:Number(mu), phi:Number(phi)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-crb-panel" title="RC corbel · ACI 318 §16.5" onClose={() => setOpen(false)}>
            <Row label="V_u (kN)" v={Vu} set={setVu}/>
            <Row label="N_uc (kN)" v={Nuc} set={setNuc}/>
            <Row label="a span (mm)" v={a} set={setA}/>
            <Row label="b width (mm)" v={bw} set={setBw}/>
            <Row label="d effective (mm)" v={d} set={setD}/>
            <Row label="h total (mm)" v={h} set={setH}/>
            <Row label="f'_c (MPa)" v={fc} set={setFc}/>
            <Row label="f_y (MPa)" v={fy} set={setFy}/>
            <Row label="μ shear-friction" v={mu} set={setMu}/>
            <Row label="φ strength reduction" v={phi} set={setPhi}/>
            <Btn testid="forge-crb-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-crb-result">
                <Ln k="V_n,max" v={r.Vn_max_kN.toFixed(1) + ' kN'}/>
                <Ln k="A_vf" v={r.Avf_required_mm2.toFixed(0) + ' mm²'}/>
                <Big testid="forge-crb-as" colour="#3fb950">A_s primary = {r.As_primary_mm2.toFixed(0)} mm²</Big>
                <Big testid="forge-crb-ah" colour="#58a6ff">A_h stirrups = {r.Ah_stirrups_mm2.toFixed(0)} mm²</Big>
                <Banner testid="forge-crb-ok" colour={r.shearOK ? '#3fb950' : '#f85149'}>
                    {r.shearOK ? 'SHEAR OK' : 'V_u > φV_n,max'}
                </Banner>
            </Res>}
        </P>, document.body);
}

export function WindTowerWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [F, setF] = useState(600);
    const [hub, setHub] = useState(100);
    const [W, setW] = useState(2500);
    const [B, setB] = useState(18);
    const [t, setT] = useState(2.5);
    const [rho_c, setRhoC] = useState(2400);
    const [rho_s, setRhoS] = useState(1800);
    const [cap, setCap] = useState(1.5);
    const [sig, setSig] = useState(200);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenWindTowerWorkbench  = () => setOpen(true);
        window.__forgeCloseWindTowerWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenWindTowerWorkbench; delete window.__forgeCloseWindTowerWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.wtbase?.analyse({thrustForce_kN:Number(F), hubHeight_m:Number(hub), towerWeight_kN:Number(W), foundationWidth_m:Number(B), foundationDepth_m:Number(t), concreteDensity_kgM3:Number(rho_c), soilDensity_kgM3:Number(rho_s), soilCapDepth_m:Number(cap), allowableBearing_kPa:Number(sig)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-wt-panel" title="Wind-tower base · IEC 61400-6" onClose={() => setOpen(false)}>
            <Row label="F thrust (kN)" v={F} set={setF}/>
            <Row label="h hub (m)" v={hub} set={setHub}/>
            <Row label="W tower (kN)" v={W} set={setW}/>
            <Row label="B side (m)" v={B} set={setB}/>
            <Row label="t depth (m)" v={t} set={setT}/>
            <Row label="ρ concrete" v={rho_c} set={setRhoC}/>
            <Row label="ρ soil" v={rho_s} set={setRhoS}/>
            <Row label="cap depth (m)" v={cap} set={setCap}/>
            <Row label="σ_allow (kPa)" v={sig} set={setSig}/>
            <Btn testid="forge-wt-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-wt-result">
                <Ln k="W_total" v={r.totalGravity_kN.toFixed(0) + ' kN'}/>
                <Ln k="SF overturn" v={r.overturningSF.toFixed(2)}/>
                <Ln k="e ecc" v={r.eccentricity_m.toFixed(2) + ' m'}/>
                <Big testid="forge-wt-sig" colour={r.sizeOK ? '#3fb950' : '#f85149'}>σ_max = {r.maxBearingPressure_kPa.toFixed(1)} kPa</Big>
                <Banner testid="forge-wt-ok" colour={r.sizeOK ? '#3fb950' : '#f85149'}>
                    {r.sizeOK ? 'BASE OK' : 'RESIZE'}
                </Banner>
            </Res>}
        </P>, document.body);
}

export function AirReceiverWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [P, setP] = useState(1.0);
    const [R, setRr] = useState(400);
    const [S, setS] = useState(110);
    const [E, setEe] = useState(1.0);
    const [CA, setCA] = useState(1.5);
    const [tb, setTb] = useState(8);
    const [V, setV] = useState(1000);
    const [Q, setQ] = useState(20);
    const [Pmax, setPmax] = useState(1.0);
    const [Pmin, setPmin] = useState(0.5);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenAirReceiverWorkbench  = () => setOpen(true);
        window.__forgeCloseAirReceiverWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenAirReceiverWorkbench; delete window.__forgeCloseAirReceiverWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.airrcv?.analyse({internalPressure_MPa:Number(P), insideRadius_mm:Number(R), allowableStress_S_MPa:Number(S), jointEfficiency_E:Number(E), corrosionAllowance_mm:Number(CA), asBuiltThickness_mm:Number(tb), volume_L:Number(V), flowIn_LperS:Number(Q), pressureMax_MPa:Number(Pmax), pressureMin_MPa:Number(Pmin)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-ar-panel" title="Air receiver · ASME Sec VIII UG-27" onClose={() => setOpen(false)}>
            <Row label="P (MPa)" v={P} set={setP}/>
            <Row label="R inside (mm)" v={R} set={setRr}/>
            <Row label="S allow (MPa)" v={S} set={setS}/>
            <Row label="E joint efficiency" v={E} set={setEe}/>
            <Row label="CA corrosion (mm)" v={CA} set={setCA}/>
            <Row label="t_built (mm)" v={tb} set={setTb}/>
            <Row label="V volume (L)" v={V} set={setV}/>
            <Row label="Q in (L/s)" v={Q} set={setQ}/>
            <Row label="P_max cycle (MPa)" v={Pmax} set={setPmax}/>
            <Row label="P_min cycle (MPa)" v={Pmin} set={setPmin}/>
            <Btn testid="forge-ar-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-ar-result">
                <Ln k="t_circ" v={r.tCirc_mm.toFixed(2) + ' mm'}/>
                <Ln k="t_long" v={r.tLong_mm.toFixed(2) + ' mm'}/>
                <Big testid="forge-ar-treq" colour="#3fb950">t_req = {r.requiredThickness_mm.toFixed(2)} mm</Big>
                <Big testid="forge-ar-mawp" colour="#58a6ff">MAWP = {r.MAWP_MPa.toFixed(3)} MPa</Big>
                <Ln k="t_charge" v={r.chargeTime_s.toFixed(1) + ' s'}/>
            </Res>}
        </P>, document.body);
}

export function ButterworthWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [fs, setFs] = useState(10000);
    const [fp, setFp] = useState(1000);
    const [fst, setFst] = useState(2000);
    const [Ap, setAp] = useState(1);
    const [As, setAs] = useState(40);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenButterworthWorkbench  = () => setOpen(true);
        window.__forgeCloseButterworthWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenButterworthWorkbench; delete window.__forgeCloseButterworthWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.butter?.analyse({sampleRate_Hz:Number(fs), passEdge_Hz:Number(fp), stopEdge_Hz:Number(fst), passRipple_dB:Number(Ap), stopAtten_dB:Number(As)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-bw-panel" title="Butterworth IIR · Oppenheim-Schafer" onClose={() => setOpen(false)}>
            <Row label="f_samp (Hz)" v={fs} set={setFs}/>
            <Row label="f_p pass edge" v={fp} set={setFp}/>
            <Row label="f_s stop edge" v={fst} set={setFst}/>
            <Row label="A_p pass ripple (dB)" v={Ap} set={setAp}/>
            <Row label="A_s stop atten (dB)" v={As} set={setAs}/>
            <Btn testid="forge-bw-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-bw-result">
                <Big testid="forge-bw-N" colour="#3fb950">N = {r.order_N}</Big>
                <Big testid="forge-bw-fc" colour="#58a6ff">f_c = {r.cutoff_Hz.toFixed(1)} Hz</Big>
                <Ln k="biquad b" v={`${r.b0.toFixed(4)} / ${r.b1.toFixed(4)} / ${r.b2.toFixed(4)}`}/>
                <Ln k="biquad a" v={`1 / ${r.a1.toFixed(4)} / ${r.a2.toFixed(4)}`}/>
            </Res>}
        </P>, document.body);
}

export function PedVibWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [L, setL] = useState(30);
    const [EI, setEI] = useState(500000);
    const [m, setM] = useState(400);
    const [d, setD] = useState(1);
    const [w, setW] = useState(3);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenPedVibWorkbench  = () => setOpen(true);
        window.__forgeClosePedVibWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenPedVibWorkbench; delete window.__forgeClosePedVibWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.pedvib?.analyse({span_m:Number(L), EI_kNm2:Number(EI), linearMass_kgM:Number(m), pedestrianCountPerM2:Number(d), bridgeDeckWidth_m:Number(w)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-pv-panel" title="Pedestrian bridge vibration · EN 1990" onClose={() => setOpen(false)}>
            <Row label="L span (m)" v={L} set={setL}/>
            <Row label="EI (kN·m²)" v={EI} set={setEI}/>
            <Row label="m lin mass (kg/m)" v={m} set={setM}/>
            <Row label="d ped/m²" v={d} set={setD}/>
            <Row label="w deck width (m)" v={w} set={setW}/>
            <Btn testid="forge-pv-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-pv-result">
                <Big testid="forge-pv-f1" colour={r.inVerticalResonance ? '#f85149' : '#3fb950'}>f_1 = {r.firstFreq_Hz.toFixed(3)} Hz</Big>
                <Ln k="n_eq SETRA" v={r.resonantPedestrianCount.toFixed(2)}/>
                <Big testid="forge-pv-a" colour={r.meetsComfortLimit ? '#3fb950' : '#f85149'}>a_max = {r.peakAcceleration_mps2.toFixed(4)} m/s²</Big>
                <Banner testid="forge-pv-ok" colour={r.meetsComfortLimit ? '#3fb950' : '#f85149'}>
                    {r.inVerticalResonance ? 'VERT RESONANCE — ' : ''}{r.meetsComfortLimit ? 'COMFORTABLE' : 'EXCEEDS COMFORT'}
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
