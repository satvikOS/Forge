// Forge-334 bundle — vertical curve + clarifier + PV battery + duct silencer + thrust block.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function VCurveWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [g1, setG1] = useState(3);
    const [g2, setG2] = useState(-2);
    const [V, setV] = useState(100);
    const [L, setL] = useState(200);
    const [K, setK] = useState(0);
    const [type, setType] = useState(0);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenVCurveWorkbench  = () => setOpen(true);
        window.__forgeCloseVCurveWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenVCurveWorkbench; delete window.__forgeCloseVCurveWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.vcurve?.analyse({grade1_pct:Number(g1), grade2_pct:Number(g2), designSpeed_kmh:Number(V), curveLength_m:Number(L), Kvalue:Number(K), curveType:Math.round(Number(type))})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-vc-panel" title="Vertical curve · AASHTO §3.3.3" onClose={() => setOpen(false)}>
            <Row label="g1 entry grade (%)" v={g1} set={setG1}/>
            <Row label="g2 exit grade (%)" v={g2} set={setG2}/>
            <Row label="V design (km/h)" v={V} set={setV}/>
            <Row label="L given (m) — 0 use K" v={L} set={setL}/>
            <Row label="K value — 0 use L" v={K} set={setK}/>
            <Row label="type 0=crest 1=sag" v={type} set={setType}/>
            <Btn testid="forge-vc-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-vc-result">
                <Ln k="A" v={r.algebraicGradeChange_A_pct.toFixed(2) + ' %'}/>
                <Ln k="K = L/A" v={r.Kvalue.toFixed(1)}/>
                <Ln k="SSD @ V" v={r.assumedSSD_m.toFixed(1) + ' m'}/>
                <Ln k="L_min AASHTO" v={r.minLength_AASHTO_m.toFixed(1) + ' m'}/>
                <Ln k="HP/LP @ x" v={r.highOrLowPointStation_m.toFixed(1) + ' m'}/>
                <Banner testid="forge-vc-ok" colour={r.meetsSightDistance ? '#3fb950' : '#f85149'}>
                    {r.meetsSightDistance ? 'MEETS SSD' : 'INSUFFICIENT SSD'}
                </Banner>
            </Res>}
        </P>, document.body);
}

export function ClarifierWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Q, setQ] = useState(10000);
    const [D, setD] = useState(20);
    const [dep, setDep] = useState(3.5);
    const [Lw, setLw] = useState(62.83);
    const [R, setRr] = useState(0.5);
    const [MLSS, setMLSS] = useState(3.5);
    const [type, setType] = useState(1);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenClarifierWorkbench  = () => setOpen(true);
        window.__forgeCloseClarifierWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenClarifierWorkbench; delete window.__forgeCloseClarifierWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.clarifier?.analyse({designFlow_m3d:Number(Q), tankDiameter_m:Number(D), tankDepth_m:Number(dep), weirLength_m:Number(Lw), returnSludgeRatio:Number(R), mixedLiquorMLSS_kgM3:Number(MLSS), clarifierType:Math.round(Number(type))})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-cl-panel" title="Clarifier · Metcalf-Eddy Ch 8" onClose={() => setOpen(false)}>
            <Row label="Q (m³/d)" v={Q} set={setQ}/>
            <Row label="D tank (m)" v={D} set={setD}/>
            <Row label="SWD depth (m)" v={dep} set={setDep}/>
            <Row label="L_w weir (m)" v={Lw} set={setLw}/>
            <Row label="R sludge return" v={R} set={setRr}/>
            <Row label="MLSS (kg/m³)" v={MLSS} set={setMLSS}/>
            <Row label="type 0=primary 1=secondary" v={type} set={setType}/>
            <Btn testid="forge-cl-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-cl-result">
                <Ln k="A_s" v={r.surfaceArea_m2.toFixed(2) + ' m²'}/>
                <Ln k="HRT" v={r.HRT_h.toFixed(2) + ' h'}/>
                <Ln k="SLR" v={r.SLR_kgPerM2D.toFixed(1) + ' kg/m²d'}/>
                <Big testid="forge-cl-sor" colour={r.meetsSOR ? '#3fb950' : '#f85149'}>SOR = {r.SOR_mPerD.toFixed(2)} m/d</Big>
                <Big testid="forge-cl-wlr" colour={r.meetsWLR ? '#3fb950' : '#f85149'}>WLR = {r.WLR_m3PerMpD.toFixed(1)} m³/m·d</Big>
            </Res>}
        </P>, document.body);
}

export function PVBattWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Ed, setEd] = useState(4000);
    const [V, setV] = useState(48);
    const [DoA, setDoA] = useState(3);
    const [DoD, setDoD] = useState(0.8);
    const [eta, setEta] = useState(0.9);
    const [Kt, setKt] = useState(0.95);
    const [Kage, setKage] = useState(0.85);
    const [Ah, setAh] = useState(100);
    const [Vc, setVc] = useState(3.2);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenPVBattWorkbench  = () => setOpen(true);
        window.__forgeClosePVBattWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenPVBattWorkbench; delete window.__forgeClosePVBattWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.pvbatt?.analyse({dailyLoadWh:Number(Ed), systemVoltage_V:Number(V), daysOfAutonomy:Number(DoA), depthOfDischarge:Number(DoD), inverterEfficiency:Number(eta), temperatureDerate:Number(Kt), ageingDerate:Number(Kage), singleCellAh:Number(Ah), singleCellV:Number(Vc)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-pvb-panel" title="Off-grid PV battery · NREL/IEEE 1013" onClose={() => setOpen(false)}>
            <Row label="E_d (Wh/day)" v={Ed} set={setEd}/>
            <Row label="V_sys (V)" v={V} set={setV}/>
            <Row label="DoA (days)" v={DoA} set={setDoA}/>
            <Row label="DoD" v={DoD} set={setDoD}/>
            <Row label="η_inv" v={eta} set={setEta}/>
            <Row label="K_T temp" v={Kt} set={setKt}/>
            <Row label="K_age" v={Kage} set={setKage}/>
            <Row label="Ah/cell" v={Ah} set={setAh}/>
            <Row label="V/cell" v={Vc} set={setVc}/>
            <Btn testid="forge-pvb-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-pvb-result">
                <Ln k="Bank Ah" v={r.bankCapacity_Ah.toFixed(1)}/>
                <Ln k="Bank kWh" v={r.bankCapacity_kWh.toFixed(2)}/>
                <Ln k="series × parallel" v={r.seriesStringSize + ' × ' + r.parallelStringCount}/>
                <Big testid="forge-pvb-total" colour="#3fb950">{r.totalCellCount} cells</Big>
            </Res>}
        </P>, document.body);
}

export function SilencerWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [L, setL] = useState(1.5);
    const [A, setA] = useState(0.4);
    const [P, setP] = useState(2);
    const [v, setVv] = useState(8);
    const [rho, setRho] = useState(1.2);
    const [Kloss, setKloss] = useState(0.5);
    const [Koct, setKoct] = useState(1.0);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenSilencerWorkbench  = () => setOpen(true);
        window.__forgeCloseSilencerWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenSilencerWorkbench; delete window.__forgeCloseSilencerWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.silencer?.analyse({length_m:Number(L), openCrossArea_m2:Number(A), linedPerimeter_m:Number(P), faceVelocity_mps:Number(v), airDensity_kgM3:Number(rho), pressureLossK:Number(Kloss), Koct_dBPerMeter:Number(Koct)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-sil-panel" title="Duct silencer · ASHRAE Ch 49" onClose={() => setOpen(false)}>
            <Row label="L length (m)" v={L} set={setL}/>
            <Row label="A_open (m²)" v={A} set={setA}/>
            <Row label="P lined perim (m)" v={P} set={setP}/>
            <Row label="v face (m/s)" v={v} set={setVv}/>
            <Row label="ρ air (kg/m³)" v={rho} set={setRho}/>
            <Row label="K_loss" v={Kloss} set={setKloss}/>
            <Row label="K_oct (dB·m²/m²)" v={Koct} set={setKoct}/>
            <Btn testid="forge-sil-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-sil-result">
                <Big testid="forge-sil-il" colour="#3fb950">IL = {r.insertionLoss_dB.toFixed(2)} dB</Big>
                <Big testid="forge-sil-dp" colour="#58a6ff">ΔP = {r.pressureDrop_Pa.toFixed(2)} Pa</Big>
                <Ln k="self-noise L_w" v={r.selfNoise_LwA_dB.toFixed(1) + ' dB'}/>
            </Res>}
        </P>, document.body);
}

export function ThrustBlockWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [D, setD] = useState(400);
    const [P, setP] = useState(1.0);
    const [theta, setTheta] = useState(90);
    const [sig, setSig] = useState(200);
    const [SF, setSF] = useState(1.5);
    const [type, setType] = useState(0);
    const [D2, setD2] = useState(0);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenThrustBlockWorkbench  = () => setOpen(true);
        window.__forgeCloseThrustBlockWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenThrustBlockWorkbench; delete window.__forgeCloseThrustBlockWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.thrustblk?.analyse({pipeOuterDiameter_mm:Number(D), designPressure_MPa:Number(P), bendAngleDeg:Number(theta), soilBearingPressure_kPa:Number(sig), safetyFactor:Number(SF), fittingType:Math.round(Number(type)), reducerOD2_mm:Number(D2)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-tb-panel" title="Thrust block · DIPRA TB-3 / AWWA M11" onClose={() => setOpen(false)}>
            <Row label="D OD (mm)" v={D} set={setD}/>
            <Row label="P pressure (MPa)" v={P} set={setP}/>
            <Row label="θ bend (°)" v={theta} set={setTheta}/>
            <Row label="σ_soil (kPa)" v={sig} set={setSig}/>
            <Row label="SF" v={SF} set={setSF}/>
            <Row label="type 0=bend 1=tee 2=cap 3=red" v={type} set={setType}/>
            <Row label="reducer OD2 (mm)" v={D2} set={setD2}/>
            <Btn testid="forge-tb-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-tb-result">
                <Ln k="A pipe" v={r.pipeArea_mm2.toFixed(0) + ' mm²'}/>
                <Big testid="forge-tb-t" colour="#3fb950">T = {r.thrustForce_kN.toFixed(2)} kN</Big>
                <Ln k="A bearing" v={r.requiredBearingArea_m2.toFixed(3) + ' m²'}/>
                <Big testid="forge-tb-s" colour="#58a6ff">block side ≥ {r.squareBlockSide_m.toFixed(3)} m</Big>
                <Ln k="concrete mass" v={r.blockMassEstimate_t.toFixed(2) + ' t'}/>
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
        <span style={{width:210}}>{label}</span>
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
