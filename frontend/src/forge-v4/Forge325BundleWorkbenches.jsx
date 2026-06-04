// Forge-325 bundle — PRV + expansion tank + plate buckling + ASHRAE 62.2 + weld electrode.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function PRVWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState('gas');
    const [P1, setP1] = useState(500);
    const [Kd, setKd] = useState(0.975);
    const [W, setW] = useState(1000);
    const [T, setT] = useState(350);
    const [M, setM] = useState(18);
    const [k, setK] = useState(1.3);
    const [Q, setQ] = useState(200);
    const [P2, setP2] = useState(100);
    const [G, setG] = useState(1.0);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenPRVWorkbench  = () => setOpen(true);
        window.__forgeClosePRVWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenPRVWorkbench; delete window.__forgeClosePRVWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.prv?.analyse({mode, inletPressureKpaAbs:Number(P1), dischargeCoeffKd:Number(Kd), massFlowKgPerH:Number(W), inletTempK:Number(T), molecularWeight:Number(M), kRatio:Number(k), volumeFlowLpm:Number(Q), backPressureKpaAbs:Number(P2), specificGravity:Number(G)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-prv-panel" title="PRV · API 520" onClose={() => setOpen(false)}>
            <div style={{display:'flex', alignItems:'center', margin:'5px 0'}}>
                <span style={{width:160}}>mode</span>
                <select value={mode} onChange={(e) => setMode(e.target.value)}
                        style={{flex:1, background:'#0d1117', color:'#c9d1d9', border:'1px solid #30363d', borderRadius:4, padding:4}}>
                    <option value="gas">gas/vapor</option>
                    <option value="liquid">liquid</option>
                </select>
            </div>
            <Row label="P_1 (kPa abs)" v={P1} set={setP1}/>
            <Row label="K_d" v={Kd} set={setKd}/>
            {mode === 'gas' && <>
                <Row label="W (kg/h)" v={W} set={setW}/>
                <Row label="T (K)" v={T} set={setT}/>
                <Row label="M (g/mol)" v={M} set={setM}/>
                <Row label="k = C_p/C_v" v={k} set={setK}/>
            </>}
            {mode === 'liquid' && <>
                <Row label="Q (L/min)" v={Q} set={setQ}/>
                <Row label="P_2 back (kPa abs)" v={P2} set={setP2}/>
                <Row label="G specific gravity" v={G} set={setG}/>
            </>}
            <Btn testid="forge-prv-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-prv-result">
                {mode === 'gas' && <Ln k="C(k)" v={r.gasCoefficientC.toFixed(1)}/>}
                <Big testid="forge-prv-A" colour="#3fb950">A_req = {r.requiredOrificeAreaMm2.toFixed(1)} mm²</Big>
                <Ln k="orifice" v={r.nextStandardOrifice + ' (' + r.standardLetterOrificeMm2 + ' mm²)'}/>
            </Res>}
        </P>, document.body);
}

export function ExpansionTankWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [V, setV] = useState(1000);
    const [Tmin, setTmin] = useState(4);
    const [Tmax, setTmax] = useState(25);
    const [Pmin, setPmin] = useState(1.5);
    const [Pmax, setPmax] = useState(3.0);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenExpTankWorkbench  = () => setOpen(true);
        window.__forgeCloseExpTankWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenExpTankWorkbench; delete window.__forgeCloseExpTankWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.expansiontank?.analyse({systemVolumeLiters:Number(V), minTempC:Number(Tmin), maxTempC:Number(Tmax), minPressureBarAbs:Number(Pmin), maxPressureBarAbs:Number(Pmax)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-ext-panel" title="Expansion tank · hydronic" onClose={() => setOpen(false)}>
            <Row label="V_sys (L)" v={V} set={setV}/>
            <Row label="T_min (°C)" v={Tmin} set={setTmin}/>
            <Row label="T_max (°C)" v={Tmax} set={setTmax}/>
            <Row label="P_min (bar abs)" v={Pmin} set={setPmin}/>
            <Row label="P_max (bar abs)" v={Pmax} set={setPmax}/>
            <Btn testid="forge-ext-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-ext-result">
                <Ln k="Δv/v" v={r.expansionFraction.toExponential(3)}/>
                <Ln k="ΔV fluid" v={r.expansionVolumeLiters.toFixed(2) + ' L'}/>
                <Ln k="K_p" v={r.pressureFactor.toFixed(3)}/>
                <Big testid="forge-ext-V" colour="#3fb950">V_tank = {r.tankVolumeLiters.toFixed(1)} L</Big>
            </Res>}
        </P>, document.body);
}

export function PlateBucklingWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [type, setType] = useState('flange');
    const [b, setB] = useState(80);
    const [t, setT] = useState(10);
    const [fy, setFy] = useState(345);
    const [E, setE_] = useState(200000);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenPlateBuckWorkbench  = () => setOpen(true);
        window.__forgeClosePlateBuckWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenPlateBuckWorkbench; delete window.__forgeClosePlateBuckWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.platebuck?.analyse({elementType:type, widthMm:Number(b), thicknessMm:Number(t), Fy_MPa:Number(fy), E_MPa:Number(E)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-pbl-panel" title="Plate buckling local · AISC §B4.1a" onClose={() => setOpen(false)}>
            <div style={{display:'flex', alignItems:'center', margin:'5px 0'}}>
                <span style={{width:160}}>element</span>
                <select value={type} onChange={(e) => setType(e.target.value)}
                        style={{flex:1, background:'#0d1117', color:'#c9d1d9', border:'1px solid #30363d', borderRadius:4, padding:4}}>
                    <option value="flange">flange (case 1)</option>
                    <option value="web">web (case 5)</option>
                </select>
            </div>
            <Row label="b or h (mm)" v={b} set={setB}/>
            <Row label="t (mm)" v={t} set={setT}/>
            <Row label="F_y (MPa)" v={fy} set={setFy}/>
            <Row label="E (MPa)" v={E} set={setE_}/>
            <Btn testid="forge-pbl-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-pbl-result">
                <Ln k="b/t" v={r.slenderness.toFixed(2)}/>
                <Ln k="λ_r" v={r.lambdaR.toFixed(2)}/>
                <Banner testid="forge-pbl-class" colour={r.classification === 'nonslender' ? '#3fb950' : '#d29922'}>
                    {r.classification.toUpperCase()}
                </Banner>
                <Big testid="forge-pbl-Qs" colour={r.Qs >= 1 ? '#3fb950' : '#d29922'}>Q_s = {r.Qs.toFixed(4)}</Big>
            </Res>}
        </P>, document.body);
}

export function Ashrae62RWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [A, setA] = useState(200);
    const [N, setN] = useState(3);
    const [inf, setInf] = useState(0);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenAshrae62RWorkbench  = () => setOpen(true);
        window.__forgeCloseAshrae62RWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenAshrae62RWorkbench; delete window.__forgeCloseAshrae62RWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.ashrae62r?.analyse({conditionedFloorAreaM2:Number(A), bedroomCount:Math.round(Number(N)), infiltrationCreditCfm:Number(inf)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-a62r-panel" title="ASHRAE 62.2 residential vent" onClose={() => setOpen(false)}>
            <Row label="A (m²) floor" v={A} set={setA}/>
            <Row label="N bedrooms" v={N} set={setN}/>
            <Row label="infil credit cfm" v={inf} set={setInf}/>
            <Btn testid="forge-a62r-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-a62r-result">
                <Ln k="Q_req" v={r.requiredVentilationCfm.toFixed(1) + ' cfm'}/>
                <Big testid="forge-a62r-Q" colour="#3fb950">Q_net = {r.netVentilationCfm.toFixed(1)} cfm</Big>
                <Ln k="= L/s" v={r.netVentilationLps.toFixed(1)}/>
            </Res>}
        </P>, document.body);
}

export function WeldElectrodeWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [type, setType] = useState('fillet');
    const [sz, setSz] = useState(6);
    const [L, setL] = useState(10);
    const [eta, setEta] = useState(0.65);
    const [cost, setCost] = useState(3.0);
    const [bev, setBev] = useState(60);
    const [gap, setGap] = useState(2);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenWeldElecWorkbench  = () => setOpen(true);
        window.__forgeCloseWeldElecWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenWeldElecWorkbench; delete window.__forgeCloseWeldElecWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.weldelectrode?.analyse({weldType:type, sizeMm:Number(sz), weldLengthM:Number(L), processEfficiency:Number(eta), electrodeCostPerKg:Number(cost), bevelAngleDeg:Number(bev), rootGapMm:Number(gap)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-we-panel" title="Weld electrode consumption" onClose={() => setOpen(false)}>
            <div style={{display:'flex', alignItems:'center', margin:'5px 0'}}>
                <span style={{width:160}}>type</span>
                <select value={type} onChange={(e) => setType(e.target.value)}
                        style={{flex:1, background:'#0d1117', color:'#c9d1d9', border:'1px solid #30363d', borderRadius:4, padding:4}}>
                    <option value="fillet">fillet</option>
                    <option value="groove">V-groove</option>
                </select>
            </div>
            <Row label="size (mm) leg/thickness" v={sz} set={setSz}/>
            <Row label="L (m)" v={L} set={setL}/>
            <Row label="η process (0.65 SMAW)" v={eta} set={setEta}/>
            <Row label="cost $/kg" v={cost} set={setCost}/>
            {type === 'groove' && <>
                <Row label="bevel ° (60 typ)" v={bev} set={setBev}/>
                <Row label="root gap mm" v={gap} set={setGap}/>
            </>}
            <Btn testid="forge-we-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-we-result">
                <Ln k="area" v={r.weldAreaMm2.toFixed(1) + ' mm²/mm'}/>
                <Ln k="deposit" v={r.depositMassKg.toFixed(2) + ' kg'}/>
                <Big testid="forge-we-elec" colour="#3fb950">Electrode = {r.electrodeMassKg.toFixed(2)} kg</Big>
                <Big testid="forge-we-cost" colour="#58a6ff">Cost = ${r.electrodeCost.toFixed(2)}</Big>
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
        background:colour === '#3fb950' ? '#1d2d1d' : '#3d2d0d',
        color:colour, fontWeight:700, textAlign:'center'}}>{children}</div>;
}
