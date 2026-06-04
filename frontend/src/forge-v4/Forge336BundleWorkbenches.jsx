// Forge-336 bundle — Hardy Cross pipe network + Holzer torsional vibration + HEC-18 pier scour + economizer + fiber link.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function PipeNetWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [pipesText, setPipesText] = useState('200,200,0.02,60,0,1\n200,200,0.02,-40,0,-1');
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenPipeNetWorkbench  = () => setOpen(true);
        window.__forgeClosePipeNetWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenPipeNetWorkbench; delete window.__forgeClosePipeNetWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        const pipes = pipesText.split('\n').filter(s => s.trim()).map(line => {
            const [L, D, f, Q0, idx, sgn] = line.split(',').map(Number);
            return { length_m:L, diameter_mm:D, frictionFactor_f:f, initialFlow_Lps:Q0, loopIndex:idx, loopSignCW:sgn };
        });
        setR(window.forge?.pipenet?.analyse({loopCount:1, tolerance_Lps:0.1, maxIterations:50, pipes})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-pn-panel" title="Hardy Cross pipe network · Linsley" onClose={() => setOpen(false)}>
            <div style={{margin:'5px 0'}}>
                <div style={{color:'#8b949e', fontSize:11, marginBottom:4}}>pipes: L_m, D_mm, f, Q0_Lps, loop, sign</div>
                <textarea value={pipesText} onChange={(ev) => setPipesText(ev.target.value)} rows={4} style={{width:'100%', background:'#0d1117', color:'#c9d1d9', border:'1px solid #30363d', borderRadius:4, padding:6, fontFamily:'monospace', fontSize:12}}/>
            </div>
            <Btn testid="forge-pn-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-pn-result">
                <Ln k="iterations" v={String(r.iterationsUsed)}/>
                <Big testid="forge-pn-conv" colour={r.converged ? '#3fb950' : '#f85149'}>{r.converged ? 'converged' : 'not converged'}</Big>
                <Ln k="flows L/s" v={r.finalFlows_Lps.map(v => v.toFixed(2)).join(', ')}/>
                <Ln k="head loss m" v={r.headLosses_m.map(v => v.toFixed(3)).join(', ')}/>
            </Res>}
        </P>, document.body);
}

export function TorVibWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Jstr, setJstr] = useState('2,1');
    const [Kstr, setKstr] = useState('10000');
    const [fLo, setFLo] = useState(1);
    const [fHi, setFHi] = useState(100);
    const [n, setN] = useState(1);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenTorVibWorkbench  = () => setOpen(true);
        window.__forgeCloseTorVibWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenTorVibWorkbench; delete window.__forgeCloseTorVibWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        const J = Jstr.split(',').map(Number);
        const K = Kstr.split(',').map(Number);
        setR(window.forge?.torvib?.analyse({inertias_kgm2:J, stiffnesses_NmPerRad:K, frequencyLowerBound_Hz:Number(fLo), frequencyUpperBound_Hz:Number(fHi), nModesSought:Math.round(Number(n))})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-tv-panel" title="Torsional vibration · Holzer" onClose={() => setOpen(false)}>
            <Row label="J (kg·m²) csv" v={Jstr} set={setJstr}/>
            <Row label="k (N·m/rad) csv" v={Kstr} set={setKstr}/>
            <Row label="f_lo (Hz)" v={fLo} set={setFLo}/>
            <Row label="f_hi (Hz)" v={fHi} set={setFHi}/>
            <Row label="n modes" v={n} set={setN}/>
            <Btn testid="forge-tv-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-tv-result">
                <Ln k="iterations" v={String(r.iterationsTotal)}/>
                {r.modes.map((m, i) =>
                    <Big key={i} testid={`forge-tv-mode${i+1}`} colour="#3fb950">mode {i+1}: {m.frequency_Hz.toFixed(2)} Hz</Big>
                )}
            </Res>}
        </P>, document.body);
}

export function PierScourWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [V, setV] = useState(3);
    const [y, setY] = useState(4);
    const [a, setA] = useState(1.5);
    const [L, setL] = useState(6);
    const [th, setTh] = useState(10);
    const [shape, setShape] = useState(0);
    const [bed, setBed] = useState(0);
    const [K4, setK4] = useState(1.0);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenPierScourWorkbench  = () => setOpen(true);
        window.__forgeClosePierScourWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenPierScourWorkbench; delete window.__forgeClosePierScourWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.pierscour?.analyse({approachVelocity_mps:Number(V), approachDepth_m:Number(y), pierWidth_m:Number(a), pierLength_m:Number(L), attackAngleDeg:Number(th), pierShape:Math.round(Number(shape)), bedCondition:Math.round(Number(bed)), K4_armoring:Number(K4)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-ps-panel" title="Pier scour · FHWA HEC-18" onClose={() => setOpen(false)}>
            <Row label="V approach (m/s)" v={V} set={setV}/>
            <Row label="y_1 depth (m)" v={y} set={setY}/>
            <Row label="a pier width (m)" v={a} set={setA}/>
            <Row label="L pier length (m)" v={L} set={setL}/>
            <Row label="θ attack (°)" v={th} set={setTh}/>
            <Row label="shape 0=round 1=sq 2=sharp" v={shape} set={setShape}/>
            <Row label="bed 0=plane 1=dunes 2=AD" v={bed} set={setBed}/>
            <Row label="K_4 armoring" v={K4} set={setK4}/>
            <Btn testid="forge-ps-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-ps-result">
                <Ln k="Fr_1" v={r.approachFroude_Fr1.toFixed(3)}/>
                <Ln k="K_1 / K_2 / K_3" v={`${r.K1_shape.toFixed(2)} / ${r.K2_angle.toFixed(2)} / ${r.K3_bed.toFixed(2)}`}/>
                <Big testid="forge-ps-ys" colour="#f85149">y_s = {r.scourDepth_ys_m.toFixed(2)} m</Big>
            </Res>}
        </P>, document.body);
}

export function EconomizerWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Toa, setToa] = useState(15);
    const [Twoa, setTwoa] = useState(12);
    const [Tret, setTret] = useState(24);
    const [Twret, setTwret] = useState(16);
    const [m, setM] = useState(5);
    const [minOA, setMinOA] = useState(0.15);
    const [hiT, setHiT] = useState(24);
    const [hiH, setHiH] = useState(65);
    const [ctl, setCtl] = useState(1);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenEconomizerWorkbench  = () => setOpen(true);
        window.__forgeCloseEconomizerWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenEconomizerWorkbench; delete window.__forgeCloseEconomizerWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.econ?.analyse({oaDryBulb_C:Number(Toa), oaWetBulb_C:Number(Twoa), returnDryBulb_C:Number(Tret), returnWetBulb_C:Number(Twret), airMassFlow_kgPerS:Number(m), minimumOAfraction:Number(minOA), highLimitT_C:Number(hiT), highLimitH_kJperKg:Number(hiH), controlType:Math.round(Number(ctl))})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-ec-panel" title="Air-side economizer · ASHRAE 90.1" onClose={() => setOpen(false)}>
            <Row label="T_oa dry (°C)" v={Toa} set={setToa}/>
            <Row label="T_oa wet (°C)" v={Twoa} set={setTwoa}/>
            <Row label="T_ret dry (°C)" v={Tret} set={setTret}/>
            <Row label="T_ret wet (°C)" v={Twret} set={setTwret}/>
            <Row label="ṁ (kg/s)" v={m} set={setM}/>
            <Row label="min OA frac" v={minOA} set={setMinOA}/>
            <Row label="high T limit (°C)" v={hiT} set={setHiT}/>
            <Row label="high h limit" v={hiH} set={setHiH}/>
            <Row label="ctl 0=dry 1=enthalpy" v={ctl} set={setCtl}/>
            <Btn testid="forge-ec-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-ec-result">
                <Ln k="h_oa" v={r.oaEnthalpy_kJperKg.toFixed(2) + ' kJ/kg'}/>
                <Ln k="h_ret" v={r.returnEnthalpy_kJperKg.toFixed(2) + ' kJ/kg'}/>
                <Ln k="OA frac" v={r.recommendedOAfraction.toFixed(2)}/>
                <Big testid="forge-ec-q" colour="#3fb950">Q_free = {r.freeCoolingCapacity_kW.toFixed(2)} kW</Big>
                <Banner testid="forge-ec-ok" colour={r.economizerActive ? '#3fb950' : '#8b949e'}>
                    {r.economizerActive ? 'ECONOMIZER ACTIVE' : 'idle'}
                </Banner>
            </Res>}
        </P>, document.body);
}

export function FiberLinkWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Tx, setTx] = useState(0);
    const [Rx, setRx] = useState(-28);
    const [M, setM] = useState(3);
    const [alpha, setAlpha] = useState(0.2);
    const [L, setL] = useState(80);
    const [Ns, setNs] = useState(10);
    const [Nc, setNc] = useState(4);
    const [Ls, setLs] = useState(0.1);
    const [Lc, setLc] = useState(0.5);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenFiberLinkWorkbench  = () => setOpen(true);
        window.__forgeCloseFiberLinkWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenFiberLinkWorkbench; delete window.__forgeCloseFiberLinkWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.fiberlink?.analyse({txPower_dBm:Number(Tx), rxSensitivity_dBm:Number(Rx), systemMargin_dB:Number(M), fiberAttenuation_dBperKm:Number(alpha), linkLength_km:Number(L), spliceCount:Math.round(Number(Ns)), connectorCount:Math.round(Number(Nc)), spliceLoss_dB:Number(Ls), connectorLoss_dB:Number(Lc)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-fl-panel" title="Fiber link budget · ITU-T G.957" onClose={() => setOpen(false)}>
            <Row label="P_Tx (dBm)" v={Tx} set={setTx}/>
            <Row label="P_Rx sens (dBm)" v={Rx} set={setRx}/>
            <Row label="M margin (dB)" v={M} set={setM}/>
            <Row label="α (dB/km)" v={alpha} set={setAlpha}/>
            <Row label="L (km)" v={L} set={setL}/>
            <Row label="N splices" v={Ns} set={setNs}/>
            <Row label="N connectors" v={Nc} set={setNc}/>
            <Row label="splice loss (dB)" v={Ls} set={setLs}/>
            <Row label="connector loss (dB)" v={Lc} set={setLc}/>
            <Btn testid="forge-fl-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-fl-result">
                <Ln k="budget" v={r.allowableBudget_dB.toFixed(1) + ' dB'}/>
                <Ln k="total loss" v={r.totalLoss_dB.toFixed(1) + ' dB'}/>
                <Big testid="forge-fl-margin" colour={r.linkOK ? '#3fb950' : '#f85149'}>margin = {r.remainingMargin_dB.toFixed(1)} dB</Big>
                <Big testid="forge-fl-max" colour="#58a6ff">L_max = {r.maxReach_km.toFixed(0)} km</Big>
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
