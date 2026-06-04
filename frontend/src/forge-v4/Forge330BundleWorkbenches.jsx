// Forge-330 bundle — slope + bearing L10 + daylight + mass-haul + rail.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function SlopeWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [c, setC] = useState(0);
    const [g, setG] = useState(18);
    const [h, setH] = useState(3);
    const [b, setB] = useState(25);
    const [phi, setPhi] = useState(30);
    const [zw, setZw] = useState(3);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenSlopeWorkbench  = () => setOpen(true);
        window.__forgeCloseSlopeWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenSlopeWorkbench; delete window.__forgeCloseSlopeWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.slope?.analyse({cohesion_kPa:Number(c), unitWeight_kNm3:Number(g), sliceDepth_m:Number(h), slopeAngleDeg:Number(b), frictionAngleDeg:Number(phi), waterTableDepth_m:Number(zw)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-slp-panel" title="Infinite slope · Coulomb-Mohr" onClose={() => setOpen(false)}>
            <Row label="c' (kPa)" v={c} set={setC}/>
            <Row label="γ (kN/m³)" v={g} set={setG}/>
            <Row label="h slip depth (m)" v={h} set={setH}/>
            <Row label="β slope (°)" v={b} set={setB}/>
            <Row label="φ' (°)" v={phi} set={setPhi}/>
            <Row label="z_w water table (m)" v={zw} set={setZw}/>
            <Btn testid="forge-slp-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-slp-result">
                <Ln k="σ'_n" v={r.effectiveNormalStress_kPa.toFixed(2) + ' kPa'}/>
                <Ln k="τ mob" v={r.mobilisedShearStress_kPa.toFixed(2) + ' kPa'}/>
                <Ln k="τ res" v={r.resistingShearStress_kPa.toFixed(2) + ' kPa'}/>
                <Big testid="forge-slp-fs" colour={r.stable ? '#3fb950' : '#f85149'}>FS = {r.factorOfSafety.toFixed(3)}</Big>
                <Banner testid="forge-slp-ok" colour={r.stable ? '#3fb950' : '#f85149'}>
                    {r.stable ? 'STABLE (FS ≥ 1.5)' : 'UNSTABLE'}
                </Banner>
            </Res>}
        </P>, document.body);
}

export function EnginePerfWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Vd, setVd] = useState(2.0);
    const [n, setN] = useState(3000);
    const [T, setT] = useState(180);
    const [mf, setMf] = useState(15);
    const [ma, setMa] = useState(220);
    const [rho, setRho] = useState(1.18);
    const [L, setL] = useState(86);
    const [cyc, setCyc] = useState(0);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenEnginePerfWorkbench  = () => setOpen(true);
        window.__forgeCloseEnginePerfWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenEnginePerfWorkbench; delete window.__forgeCloseEnginePerfWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.engperf?.analyse({displacement_L:Number(Vd), speed_rpm:Number(n), brakeTorque_Nm:Number(T), fuelMassFlow_kgPerH:Number(mf), airMassFlow_kgPerH:Number(ma), airDensity_kgM3:Number(rho), stroke_mm:Number(L), cycleType:Math.round(Number(cyc))})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-eng-panel" title="IC engine BMEP / BSFC · Heywood" onClose={() => setOpen(false)}>
            <Row label="V_d disp. (L)" v={Vd} set={setVd}/>
            <Row label="n speed (rpm)" v={n} set={setN}/>
            <Row label="T brake torque (N·m)" v={T} set={setT}/>
            <Row label="ṁ_f fuel (kg/h)" v={mf} set={setMf}/>
            <Row label="ṁ_a air (kg/h)" v={ma} set={setMa}/>
            <Row label="ρ_a air density" v={rho} set={setRho}/>
            <Row label="L stroke (mm)" v={L} set={setL}/>
            <Row label="cycle 0=4-stroke 1=2-stroke" v={cyc} set={setCyc}/>
            <Btn testid="forge-eng-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-eng-result">
                <Ln k="BMEP" v={r.bmep_kPa.toFixed(0) + ' kPa'}/>
                <Ln k="BSFC" v={r.bsfc_g_per_kWh.toFixed(0) + ' g/kW·h'}/>
                <Ln k="η_v" v={(r.volumetricEfficiency * 100).toFixed(1) + ' %'}/>
                <Ln k="v_p mean" v={r.meanPistonSpeed_mPerS.toFixed(2) + ' m/s'}/>
                <Ln k="AFR" v={r.airFuelRatio.toFixed(2)}/>
                <Big testid="forge-eng-pb" colour="#3fb950">P_b = {r.brakePower_kW.toFixed(1)} kW</Big>
            </Res>}
        </P>, document.body);
}

export function DaylightWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [T, setT] = useState(0.7);
    const [th, setTh] = useState(70);
    const [Ag, setAg] = useState(4);
    const [M, setM] = useState(0.8);
    const [At, setAt] = useState(80);
    const [rho, setRho] = useState(0.5);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenDaylightWorkbench  = () => setOpen(true);
        window.__forgeCloseDaylightWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenDaylightWorkbench; delete window.__forgeCloseDaylightWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.daylight?.analyse({visibleTransmittance:Number(T), skyAngleDeg:Number(th), glazingArea_m2:Number(Ag), maintenanceFactor:Number(M), totalSurfaceArea_m2:Number(At), avgReflectance:Number(rho)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-dl-panel" title="Daylight factor · BS 8206 / LEED" onClose={() => setOpen(false)}>
            <Row label="T visible transmittance" v={T} set={setT}/>
            <Row label="θ sky angle (°)" v={th} set={setTh}/>
            <Row label="A_g glazing (m²)" v={Ag} set={setAg}/>
            <Row label="M maintenance" v={M} set={setM}/>
            <Row label="A_tot surfaces (m²)" v={At} set={setAt}/>
            <Row label="ρ avg reflectance" v={rho} set={setRho}/>
            <Btn testid="forge-dl-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-dl-result">
                <Big testid="forge-dl-df" colour="#3fb950">DF = {r.daylightFactorPct.toFixed(2)} %</Big>
                <Banner testid="forge-dl-leed" colour={r.meetsLeed2pct ? '#3fb950' : '#f85149'}>
                    LEED 2 %: {r.meetsLeed2pct ? 'PASS' : 'FAIL'}
                </Banner>
            </Res>}
        </P>, document.body);
}

export function MassHaulWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [csv, setCsv] = useState('0,5,2\n100,8,3\n200,4,5');
    const [swell, setSwell] = useState(1.2);
    const [shrink, setShrink] = useState(0.9);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenMassHaulWorkbench  = () => setOpen(true);
        window.__forgeCloseMassHaulWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenMassHaulWorkbench; delete window.__forgeCloseMassHaulWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        const stations = csv.split('\n').filter(s => s.trim()).map(line => {
            const [s, c, f] = line.split(',').map(Number);
            return { station_m:s, cutArea_m2:c, fillArea_m2:f, midCutArea_m2:0, midFillArea_m2:0 };
        });
        setR(window.forge?.masshaul?.analyse({swellFactor:Number(swell), shrinkageFactor:Number(shrink), stations})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-mh-panel" title="Mass-haul · Average End Areas" onClose={() => setOpen(false)}>
            <div style={{margin:'5px 0'}}>
                <div style={{color:'#8b949e', fontSize:11, marginBottom:4}}>stations: station_m,cut_m²,fill_m² (one per line)</div>
                <textarea value={csv} onChange={(ev) => setCsv(ev.target.value)} rows={5} style={{width:'100%', background:'#0d1117', color:'#c9d1d9', border:'1px solid #30363d', borderRadius:4, padding:6, fontFamily:'monospace', fontSize:12}}/>
            </div>
            <Row label="swell (1.2)" v={swell} set={setSwell}/>
            <Row label="shrinkage (0.9)" v={shrink} set={setShrink}/>
            <Btn testid="forge-mh-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-mh-result">
                <Ln k="cut" v={r.totalCut_m3.toFixed(1) + ' m³'}/>
                <Ln k="fill loose" v={r.totalFillLoose_m3.toFixed(1) + ' m³'}/>
                <Big testid="forge-mh-net" colour={r.netBalance_m3 >= 0 ? '#3fb950' : '#f85149'}>
                    net = {r.netBalance_m3.toFixed(1)} m³ ({r.netBalance_m3 >= 0 ? 'waste' : 'borrow'})
                </Big>
                <Big testid="forge-mh-max" colour="#58a6ff">max ord = {r.maxOrdinate_m3.toFixed(1)} m³</Big>
            </Res>}
        </P>, document.body);
}

export function RailBeamWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [P, setP] = useState(125);
    const [E, setE2] = useState(210);
    const [I, setI] = useState(2730);
    const [S, setS] = useState(336);
    const [u, setU] = useState(20);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenRailBeamWorkbench  = () => setOpen(true);
        window.__forgeCloseRailBeamWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenRailBeamWorkbench; delete window.__forgeCloseRailBeamWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.railbeam?.analyse({wheelLoad_kN:Number(P), railE_GPa:Number(E), railI_cm4:Number(I), railSectionModulusBase_cm3:Number(S), trackModulus_MPaPerM:Number(u)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-rbl-panel" title="Rail beam-on-foundation · AREMA 16" onClose={() => setOpen(false)}>
            <Row label="P wheel load (kN)" v={P} set={setP}/>
            <Row label="E rail (GPa)" v={E} set={setE2}/>
            <Row label="I rail (cm⁴)" v={I} set={setI}/>
            <Row label="S base (cm³)" v={S} set={setS}/>
            <Row label="u track (MN/m/m)" v={u} set={setU}/>
            <Btn testid="forge-rbl-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-rbl-result">
                <Ln k="L_e characteristic" v={r.characteristicLength_m.toFixed(3) + ' m'}/>
                <Ln k="y_max defl" v={r.maxRailDeflection_mm.toFixed(2) + ' mm'}/>
                <Ln k="M_max" v={r.maxBendingMoment_kNm.toFixed(2) + ' kN·m'}/>
                <Big testid="forge-rbl-sigma" colour="#3fb950">σ_max = {r.maxRailStress_MPa.toFixed(1)} MPa</Big>
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
