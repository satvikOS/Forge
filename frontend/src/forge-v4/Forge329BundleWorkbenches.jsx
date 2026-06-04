// Forge-329 bundle — geothermal + tension + bolted timber + conveyor + drift.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function GeothermalWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Q, setQ] = useState(35);
    const [k, setK] = useState(2.0);
    const [r_b, setRb] = useState(0.075);
    const [D, setD] = useState(32);
    const [kp, setKp] = useState(0.4);
    const [kg, setKg] = useState(1.5);
    const [dT, setDT] = useState(10);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenGeothermalWorkbench  = () => setOpen(true);
        window.__forgeCloseGeothermalWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenGeothermalWorkbench; delete window.__forgeCloseGeothermalWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.geothermal?.analyse({coolingLoadKw:Number(Q), soilConductivityWmk:Number(k), boreRadiusM:Number(r_b), pipeOuterDiameterMm:Number(D), pipeConductivityWmk:Number(kp), groutConductivityWmk:Number(kg), designTempDiffK:Number(dT)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-geo-panel" title="Geothermal ground loop · IGSHPA" onClose={() => setOpen(false)}>
            <Row label="Q (kW) cooling" v={Q} set={setQ}/>
            <Row label="k_soil (W/m·K)" v={k} set={setK}/>
            <Row label="r_bore (m)" v={r_b} set={setRb}/>
            <Row label="D_pipe (mm)" v={D} set={setD}/>
            <Row label="k_pipe (HDPE 0.4)" v={kp} set={setKp}/>
            <Row label="k_grout (1.5)" v={kg} set={setKg}/>
            <Row label="ΔT_design (K)" v={dT} set={setDT}/>
            <Btn testid="forge-geo-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-geo-result">
                <Ln k="R_total" v={r.totalResistanceMpwK.toFixed(4) + ' mK/W'}/>
                <Big testid="forge-geo-L" colour="#3fb950">L_bore = {r.requiredBoreLengthM.toFixed(0)} m</Big>
                <Big testid="forge-geo-mton" colour="#58a6ff">{r.mPerTon.toFixed(1)} m/ton</Big>
            </Res>}
        </P>, document.body);
}

export function TensionMemberWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Ag, setAg] = useState(2000);
    const [An, setAn] = useState(1700);
    const [xb, setXb] = useState(20);
    const [L, setL] = useState(200);
    const [fy, setFy] = useState(345);
    const [fu, setFu] = useState(450);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenTensionWorkbench  = () => setOpen(true);
        window.__forgeCloseTensionWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenTensionWorkbench; delete window.__forgeCloseTensionWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.tension?.analyse({grossArea_mm2:Number(Ag), netArea_mm2:Number(An), xBar_mm:Number(xb), connectionLength_mm:Number(L), Fy_MPa:Number(fy), Fu_MPa:Number(fu)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-ten-panel" title="Tension member · AISC §D3" onClose={() => setOpen(false)}>
            <Row label="A_g (mm²) gross" v={Ag} set={setAg}/>
            <Row label="A_n (mm²) net" v={An} set={setAn}/>
            <Row label="x̄ (mm) eccentr." v={xb} set={setXb}/>
            <Row label="L (mm) conn." v={L} set={setL}/>
            <Row label="F_y (MPa)" v={fy} set={setFy}/>
            <Row label="F_u (MPa)" v={fu} set={setFu}/>
            <Btn testid="forge-ten-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-ten-result">
                <Ln k="U shear-lag" v={r.shearLag_U.toFixed(3)}/>
                <Ln k="A_e" v={r.effectiveArea_mm2.toFixed(0) + ' mm²'}/>
                <Ln k="P_y yield" v={r.yieldCapacity_kN.toFixed(1) + ' kN'}/>
                <Ln k="P_r rupture" v={r.ruptureCapacity_kN.toFixed(1) + ' kN'}/>
                <Big testid="forge-ten-Pd" colour="#3fb950">P_d = {r.designCapacity_kN.toFixed(1)} kN</Big>
            </Res>}
        </P>, document.body);
}

export function BoltedTimberWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [D, setD] = useState(12.7);
    const [tm, setTm] = useState(89);
    const [ts, setTs] = useState(38);
    const [fem, setFem] = useState(38);
    const [fes, setFes] = useState(38);
    const [cd, setCd] = useState(1.6);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenBoltedTimberWorkbench  = () => setOpen(true);
        window.__forgeCloseBoltedTimberWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenBoltedTimberWorkbench; delete window.__forgeCloseBoltedTimberWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.boltedtimber?.analyse({boltDiameterMm:Number(D), mainMemberThicknessMm:Number(tm), sideMemberThicknessMm:Number(ts), mainEmbedmentMPa:Number(fem), sideEmbedmentMPa:Number(fes), loadDurationFactor:Number(cd)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-bt-panel" title="Bolted timber · NDS 2018" onClose={() => setOpen(false)}>
            <Row label="D (mm) bolt" v={D} set={setD}/>
            <Row label="t_m (mm) main" v={tm} set={setTm}/>
            <Row label="t_s (mm) side" v={ts} set={setTs}/>
            <Row label="F_em (MPa)" v={fem} set={setFem}/>
            <Row label="F_es (MPa)" v={fes} set={setFes}/>
            <Row label="C_D (1.0/1.6/2.0)" v={cd} set={setCd}/>
            <Btn testid="forge-bt-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-bt-result">
                <Ln k="Z_main" v={r.Z_mainMode_kN.toFixed(2) + ' kN'}/>
                <Ln k="Z_side" v={r.Z_sideMode_kN.toFixed(2) + ' kN'}/>
                <Ln k="Z gov" v={r.governingZ_kN.toFixed(2) + ' kN'}/>
                <Big testid="forge-bt-Zadj" colour="#3fb950">Z·C_D = {r.adjustedZ_kN.toFixed(2)} kN</Big>
            </Res>}
        </P>, document.body);
}

export function ConveyorWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [L, setL] = useState(200);
    const [H, setH] = useState(10);
    const [v, setV] = useState(2);
    const [m, setM] = useState(50);
    const [wb, setWb] = useState(15);
    const [wi, setWi] = useState(20);
    const [f, setF] = useState(0.02);
    const [eta, setEta] = useState(0.85);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenConveyorWorkbench  = () => setOpen(true);
        window.__forgeCloseConveyorWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenConveyorWorkbench; delete window.__forgeCloseConveyorWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.conveyor?.analyse({horizontalLengthM:Number(L), liftHeightM:Number(H), beltSpeedMs:Number(v), materialMassFlowKgPerS:Number(m), beltMassPerLengthKgM:Number(wb), idlerMassPerLengthKgM:Number(wi), primaryFriction:Number(f), drivetrainEfficiency:Number(eta)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-cnv-panel" title="Conveyor power · CEMA" onClose={() => setOpen(false)}>
            <Row label="L (m) horiz" v={L} set={setL}/>
            <Row label="H (m) lift" v={H} set={setH}/>
            <Row label="v (m/s) belt" v={v} set={setV}/>
            <Row label="ṁ (kg/s)" v={m} set={setM}/>
            <Row label="W_belt (kg/m)" v={wb} set={setWb}/>
            <Row label="W_idler (kg/m)" v={wi} set={setWi}/>
            <Row label="f primary friction" v={f} set={setF}/>
            <Row label="η drivetrain" v={eta} set={setEta}/>
            <Btn testid="forge-cnv-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-cnv-result">
                <Ln k="W_mat" v={r.materialPerLengthKgM.toFixed(1) + ' kg/m'}/>
                <Ln k="F_eff" v={r.effectiveTensionN.toFixed(0) + ' N'}/>
                <Big testid="forge-cnv-P" colour="#3fb950">P = {r.powerRequiredKW.toFixed(2)} kW</Big>
            </Res>}
        </P>, document.body);
}

export function DriftWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [del, setDel] = useState(380);
    const [H, setH] = useState(200);
    const [N, setN] = useState(50);
    const [div, setDiv] = useState(500);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenDriftWorkbench  = () => setOpen(true);
        window.__forgeCloseDriftWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenDriftWorkbench; delete window.__forgeCloseDriftWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.drift?.analyse({topDeflectionMm:Number(del), buildingHeightM:Number(H), numberOfStories:Math.round(Number(N)), driftLimitDivisor:Number(div)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-drf-panel" title="Tall-building drift · H/500" onClose={() => setOpen(false)}>
            <Row label="δ_top (mm)" v={del} set={setDel}/>
            <Row label="H (m) building" v={H} set={setH}/>
            <Row label="N stories" v={N} set={setN}/>
            <Row label="H/divisor (400 / 500)" v={div} set={setDiv}/>
            <Btn testid="forge-drf-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-drf-result">
                <Ln k="δ/H" v={r.overallDriftIndex.toExponential(3)}/>
                <Ln k="limit" v={r.overallLimit.toExponential(3)}/>
                <Ln k="avg storey" v={r.storeyDriftAverageMm.toFixed(2) + ' mm'}/>
                <Banner testid="forge-drf-ok" colour={r.meetsOverallLimit ? '#3fb950' : '#f85149'}>
                    {r.meetsOverallLimit ? 'WITHIN LIMIT' : 'EXCEEDS LIMIT'}
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
