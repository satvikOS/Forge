// Forge-321 bundle — vent + fire pump + septic + cyclone + stack effect.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const mkOpen = (winFn, setOpen) => () => setOpen(true);

export function VentilationWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [P, setP] = useState(10);
    const [A, setA] = useState(100);
    const [Rp, setRp] = useState(2.5);
    const [Ra, setRa] = useState(0.3);
    const [Ez, setEz] = useState(1.0);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenVentilationWorkbench  = () => setOpen(true);
        window.__forgeCloseVentilationWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenVentilationWorkbench; delete window.__forgeCloseVentilationWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => {
        try {
            setR(window.forge?.ventilation?.analyse({
                occupantsP:Number(P), zoneAreaM2:Number(A),
                R_p_LpsPerPerson:Number(Rp), R_a_LpsPerM2:Number(Ra),
                zoneAirDistEffectivenessE_z:Number(Ez),
            })); setE(null);
        } catch (ex) { setE(String(ex.message || ex)); setR(null); }
    };
    return createPortal(
        <P_ testid="forge-vt-panel" title="ASHRAE 62.1 ventilation" onClose={() => setOpen(false)}>
            <Row label="P occupants" v={P} set={setP}/>
            <Row label="A_z (m²)" v={A} set={setA}/>
            <Row label="R_p (L/s/p) — office 2.5" v={Rp} set={setRp}/>
            <Row label="R_a (L/s/m²) — office 0.3" v={Ra} set={setRa}/>
            <Row label="E_z (typ 1.0)" v={Ez} set={setEz}/>
            <Btn testid="forge-vt-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-vt-result">
                <Ln k="V_bz" v={r.breathingZoneFlowLps.toFixed(2) + ' L/s'}/>
                <Big testid="forge-vt-cfm" colour="#3fb950">V_OA = {r.outdoorAirFlowCfm.toFixed(1)} cfm</Big>
                <Big testid="forge-vt-pp" colour="#58a6ff">per person = {r.perPersonOAcfm.toFixed(1)} cfm</Big>
            </Res>}
        </P_>, document.body);
}

export function FirePumpWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Qs, setQs] = useState(1500);
    const [Qh, setQh] = useState(500);
    const [Hs, setHs] = useState(30);
    const [Hf, setHf] = useState(20);
    const [Pr, setPr] = useState(0.5);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenFirePumpWorkbench  = () => setOpen(true);
        window.__forgeCloseFirePumpWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenFirePumpWorkbench; delete window.__forgeCloseFirePumpWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => {
        try {
            setR(window.forge?.firepump?.analyse({
                sprinklerDemandLpm:Number(Qs), hoseAllowanceLpm:Number(Qh),
                staticHeadM:Number(Hs), frictionLossM:Number(Hf), residualPressureBar:Number(Pr),
            })); setE(null);
        } catch (ex) { setE(String(ex.message || ex)); setR(null); }
    };
    return createPortal(
        <P_ testid="forge-fp-panel" title="NFPA 20 fire pump" onClose={() => setOpen(false)}>
            <Row label="Q_sprinkler (L/min)" v={Qs} set={setQs}/>
            <Row label="Q_hose (L/min)" v={Qh} set={setQh}/>
            <Row label="H_static (m)" v={Hs} set={setHs}/>
            <Row label="H_friction (m)" v={Hf} set={setHf}/>
            <Row label="P_residual (bar)" v={Pr} set={setPr}/>
            <Btn testid="forge-fp-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-fp-result">
                <Ln k="Q_rated" v={r.ratedFlowLpm.toFixed(0) + ' L/min'}/>
                <Big testid="forge-fp-P" colour="#3fb950">P_rated = {r.ratedPressureBar.toFixed(2)} bar</Big>
                <Ln k="H_rated" v={r.ratedHeadM.toFixed(1) + ' m'}/>
                <Ln k="150% point" v={r.pump150PercentFlowLpm.toFixed(0) + ' L/min @ ' + r.pump150PercentMinPressureBar.toFixed(2) + ' bar min'}/>
            </Res>}
        </P_>, document.body);
}

export function SepticWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [N, setN] = useState(4);
    const [Q, setQ] = useState(600);
    const [R, setR_] = useState(1);
    const [S, setS] = useState(0.3);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenSepticWorkbench  = () => setOpen(true);
        window.__forgeCloseSepticWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenSepticWorkbench; delete window.__forgeCloseSepticWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => {
        try {
            setR(window.forge?.septic?.analyse({
                occupants:Math.round(Number(N)), dailyFlowPerPersonL:Number(Q),
                retentionDays:Number(R), sludgeReserveFraction:Number(S),
            })); setE(null);
        } catch (ex) { setE(String(ex.message || ex)); setR(null); }
    };
    return createPortal(
        <P_ testid="forge-st-panel" title="Septic tank · residential" onClose={() => setOpen(false)}>
            <Row label="Occupants" v={N} set={setN}/>
            <Row label="L/person/day (600 typ)" v={Q} set={setQ}/>
            <Row label="Retention days" v={R} set={setR_}/>
            <Row label="Sludge reserve frac" v={S} set={setS}/>
            <Btn testid="forge-st-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-st-result">
                <Ln k="Daily inflow" v={r.dailyInflowL + ' L'}/>
                <Ln k="Primary" v={r.primaryStorageL + ' L'}/>
                <Ln k="Sludge reserve" v={r.sludgeReserveL + ' L'}/>
                <Big testid="forge-st-V" colour="#3fb950">V_total = {r.totalVolumeM3.toFixed(2)} m³</Big>
            </Res>}
        </P_>, document.body);
}

export function CycloneWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [V, setV] = useState(15);
    const [W, setW] = useState(0.15);
    const [N, setN] = useState(5);
    const [mu, setMu] = useState(1.8e-5);
    const [rp, setRp] = useState(2500);
    const [rg, setRg] = useState(1.2);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenCycloneWorkbench  = () => setOpen(true);
        window.__forgeCloseCycloneWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenCycloneWorkbench; delete window.__forgeCloseCycloneWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => {
        try {
            setR(window.forge?.cyclone?.analyse({
                inletVelocityMs:Number(V), inletWidthM:Number(W), numberOfTurns:Number(N),
                gasViscosityPaS:Number(mu), particleDensityKgPerM3:Number(rp), gasDensityKgPerM3:Number(rg),
            })); setE(null);
        } catch (ex) { setE(String(ex.message || ex)); setR(null); }
    };
    return createPortal(
        <P_ testid="forge-cy-panel" title="Cyclone separator · Lapple" onClose={() => setOpen(false)}>
            <Row label="V_inlet (m/s)" v={V} set={setV}/>
            <Row label="W inlet (m)" v={W} set={setW}/>
            <Row label="N turns (Lapple 5)" v={N} set={setN}/>
            <Row label="μ_gas (Pa·s)" v={mu} set={setMu}/>
            <Row label="ρ_p (kg/m³)" v={rp} set={setRp}/>
            <Row label="ρ_g (kg/m³)" v={rg} set={setRg}/>
            <Btn testid="forge-cy-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-cy-result">
                <Big testid="forge-cy-d50" colour="#3fb950">d_50 = {r.cutDiameterUm.toFixed(2)} µm</Big>
            </Res>}
        </P_>, document.body);
}

export function StackEffectWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [H, setH] = useState(20);
    const [Ti, setTi] = useState(20);
    const [To, setTo] = useState(0);
    const [P, setP] = useState(101.325);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenStackEffectWorkbench  = () => setOpen(true);
        window.__forgeCloseStackEffectWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenStackEffectWorkbench; delete window.__forgeCloseStackEffectWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => {
        try {
            setR(window.forge?.stackeffect?.analyse({
                stackHeightM:Number(H), indoorTempC:Number(Ti), outdoorTempC:Number(To),
                atmPressureKPa:Number(P),
            })); setE(null);
        } catch (ex) { setE(String(ex.message || ex)); setR(null); }
    };
    return createPortal(
        <P_ testid="forge-se-panel" title="Stack effect · chimney draft" onClose={() => setOpen(false)}>
            <Row label="H (m)" v={H} set={setH}/>
            <Row label="T_i (°C)" v={Ti} set={setTi}/>
            <Row label="T_o (°C)" v={To} set={setTo}/>
            <Row label="p_atm (kPa)" v={P} set={setP}/>
            <Btn testid="forge-se-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-se-result">
                <Ln k="ρ_indoor" v={r.indoorDensityKgPerM3.toFixed(4) + ' kg/m³'}/>
                <Ln k="ρ_outdoor" v={r.outdoorDensityKgPerM3.toFixed(4) + ' kg/m³'}/>
                <Big testid="forge-se-dP" colour={r.stackPressurePa > 0 ? '#3fb950' : '#d29922'}>
                    ΔP = {r.stackPressurePa.toFixed(2)} Pa {r.airflowDirection > 0 ? '(upward draft)' : r.airflowDirection < 0 ? '(downward)' : '(neutral)'}
                </Big>
            </Res>}
        </P_>, document.body);
}

// helpers
function P_({ testid, title, onClose, children }) {
    return <div data-testid={testid} style={{
        position:'fixed', top:90, right:24, width:400, background:'#161b22', color:'#c9d1d9',
        border:'1px solid #30363d', borderRadius:8, padding:18, zIndex:5000,
        fontFamily:'system-ui, sans-serif', fontSize:13, boxShadow:'0 10px 30px rgba(0,0,0,0.6)'}}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <strong style={{ fontSize:14 }}>{title}</strong>
            <button onClick={onClose} style={{ background:'transparent', color:'#8b949e', border:'none', cursor:'pointer' }}>×</button>
        </div>
        {children}
    </div>;
}
function Row({ label, v, set }) {
    return <div style={{ display:'flex', alignItems:'center', margin:'5px 0' }}>
        <span style={{ width:200 }}>{label}</span>
        <input type="number" value={v} onChange={(e) => set(e.target.value)}
               style={{ flex:1, background:'#0d1117', color:'#c9d1d9', border:'1px solid #30363d', borderRadius:4, padding:4 }}/>
    </div>;
}
function Btn({ testid, onClick }) {
    return <button data-testid={testid} onClick={onClick}
        style={{ marginTop:10, width:'100%', padding:8, background:'#238636', border:'none', borderRadius:4,
                 color:'#fff', cursor:'pointer', fontWeight:600 }}>Compute</button>;
}
function Err({ msg }) { return <div style={{ marginTop:8, color:'#f85149', fontSize:12 }}>{msg}</div>; }
function Res({ testid, children }) {
    return <div data-testid={testid} style={{ marginTop:12, padding:10, background:'#0d1117', borderRadius:4,
        border:'1px solid #30363d', fontSize:12 }}>{children}</div>;
}
function Ln({ k, v }) {
    return <div style={{ display:'flex', justifyContent:'space-between', padding:'2px 0' }}>
        <span style={{ color:'#8b949e' }}>{k}</span><span>{v}</span></div>;
}
function Big({ testid, colour, children }) {
    return <div data-testid={testid} style={{ marginTop:6, fontWeight:700, color:colour }}>{children}</div>;
}
