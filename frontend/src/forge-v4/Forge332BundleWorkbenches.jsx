// Forge-332 bundle — pad-eye + horizontal sight + weld group + bolt preload + prestress losses.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function PadEyeWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [P, setP] = useState(100);
    const [t, setT] = useState(20);
    const [Dp, setDp] = useState(120);
    const [Dh, setDh] = useState(33);
    const [Dpin, setDpin] = useState(30);
    const [ce, setCe] = useState(45);
    const [Fy, setFy] = useState(345);
    const [Cat, setCat] = useState(1.0);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenPadEyeWorkbench  = () => setOpen(true);
        window.__forgeClosePadEyeWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenPadEyeWorkbench; delete window.__forgeClosePadEyeWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.padeye?.analyse({designLoad_kN:Number(P), padThickness_mm:Number(t), padDiameter_mm:Number(Dp), holeDiameter_mm:Number(Dh), pinDiameter_mm:Number(Dpin), cheekToEdge_mm:Number(ce), yieldStrength_MPa:Number(Fy), designCategory:Number(Cat)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-pe-panel" title="Pad-eye lifting lug · ASME BTH-1" onClose={() => setOpen(false)}>
            <Row label="P design (kN)" v={P} set={setP}/>
            <Row label="t thickness (mm)" v={t} set={setT}/>
            <Row label="D_pad overall (mm)" v={Dp} set={setDp}/>
            <Row label="d_h hole (mm)" v={Dh} set={setDh}/>
            <Row label="d_pin (mm)" v={Dpin} set={setDpin}/>
            <Row label="cheek to edge (mm)" v={ce} set={setCe}/>
            <Row label="F_y (MPa)" v={Fy} set={setFy}/>
            <Row label="Cat 1.0=A / 0.6=B" v={Cat} set={setCat}/>
            <Btn testid="forge-pe-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-pe-result">
                <Ln k="bearing" v={r.bearingStress_MPa.toFixed(2) + ' MPa'}/>
                <Ln k="tens@hole" v={r.tensionAcrossHole_MPa.toFixed(2) + ' MPa'}/>
                <Ln k="shear-tear" v={r.shearTearOut_MPa.toFixed(2) + ' MPa'}/>
                <Big testid="forge-pe-u" colour={r.passes ? '#3fb950' : '#f85149'}>U = {r.governingUtilisation.toFixed(3)}</Big>
                <Banner testid="forge-pe-ok" colour={r.passes ? '#3fb950' : '#f85149'}>
                    {r.passes ? 'PASS' : 'FAIL'}
                </Banner>
            </Res>}
        </P>, document.body);
}

export function HSDWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [R, setRr] = useState(400);
    const [S, setS] = useState(160);
    const [m, setM] = useState(8);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenHSDWorkbench  = () => setOpen(true);
        window.__forgeCloseHSDWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenHSDWorkbench; delete window.__forgeCloseHSDWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.hsd?.analyse({curveRadius_m:Number(R), sightDistance_m:Number(S), offsetAvailable_m:Number(m)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-hsd-panel" title="Horizontal sight distance · AASHTO" onClose={() => setOpen(false)}>
            <Row label="R curve radius (m)" v={R} set={setRr}/>
            <Row label="S SSD (m)" v={S} set={setS}/>
            <Row label="m available (m)" v={m} set={setM}/>
            <Btn testid="forge-hsd-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-hsd-result">
                <Big testid="forge-hsd-mreq" colour="#3fb950">m_req = {r.middleOrdinateRequired_m.toFixed(2)} m</Big>
                <Ln k="S_max@m_avail" v={r.maxSafeSightDistance_m.toFixed(2) + ' m'}/>
                <Banner testid="forge-hsd-ok" colour={r.meetsAvailableClearance ? '#3fb950' : '#f85149'}>
                    {r.meetsAvailableClearance ? 'CLEAR' : 'OBSTRUCTED'}
                </Banner>
            </Res>}
        </P>, document.body);
}

export function WeldGroupWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [csv, setCsv] = useState('0,0,0,200');
    const [P, setP] = useState(50);
    const [e, setE] = useState(100);
    const [leg, setLeg] = useState(8);
    const [fexx, setFexx] = useState(480);
    const [r, setR] = useState(null);
    const [err, setErr] = useState(null);
    useEffect(() => {
        window.__forgeOpenWeldGroupWorkbench  = () => setOpen(true);
        window.__forgeCloseWeldGroupWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenWeldGroupWorkbench; delete window.__forgeCloseWeldGroupWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        const segments = csv.split('\n').filter(s => s.trim()).map(line => {
            const [x0, y0, x1, y1] = line.split(',').map(Number);
            return { x0_mm:x0, y0_mm:y0, x1_mm:x1, y1_mm:y1 };
        });
        setR(window.forge?.weldgroup?.analyse({segments, loadP_kN:Number(P), eccentricity_mm:Number(e), legSize_mm:Number(leg), electrodeFu_MPa:Number(fexx)})); setErr(null);
    } catch (ex) { setErr(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-wg-panel" title="Welded fillet group · Salmon-Johnson" onClose={() => setOpen(false)}>
            <div style={{margin:'5px 0'}}>
                <div style={{color:'#8b949e', fontSize:11, marginBottom:4}}>segments: x0,y0,x1,y1 per line (mm)</div>
                <textarea value={csv} onChange={(ev) => setCsv(ev.target.value)} rows={4} style={{width:'100%', background:'#0d1117', color:'#c9d1d9', border:'1px solid #30363d', borderRadius:4, padding:6, fontFamily:'monospace', fontSize:12}}/>
            </div>
            <Row label="P (kN)" v={P} set={setP}/>
            <Row label="e eccentricity (mm)" v={e} set={setE}/>
            <Row label="leg w (mm)" v={leg} set={setLeg}/>
            <Row label="F_EXX (MPa)" v={fexx} set={setFexx}/>
            <Btn testid="forge-wg-run" onClick={run}/>
            {err && <Err msg={err}/>}
            {r && <Res testid="forge-wg-result">
                <Ln k="centroid" v={`(${r.centroidX_mm.toFixed(1)}, ${r.centroidY_mm.toFixed(1)})`}/>
                <Ln k="L_total" v={r.totalLength_mm.toFixed(0) + ' mm'}/>
                <Ln k="σ_throat" v={r.maxStress_MPa.toFixed(1) + ' MPa'}/>
                <Big testid="forge-wg-u" colour={r.passes ? '#3fb950' : '#f85149'}>U = {r.utilisation.toFixed(3)}</Big>
                <Banner testid="forge-wg-ok" colour={r.passes ? '#3fb950' : '#f85149'}>
                    {r.passes ? 'PASS' : 'FAIL'}
                </Banner>
            </Res>}
        </P>, document.body);
}

export function BoltPreloadWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [Sp, setSp] = useState(600);
    const [At, setAt] = useState(84.3);
    const [d, setD] = useState(12);
    const [lb, setLb] = useState(40);
    const [lm, setLm] = useState(40);
    const [Eb, setEb] = useState(207);
    const [Em, setEm] = useState(207);
    const [P, setP] = useState(10);
    const [K, setK] = useState(0.20);
    const [frac, setFrac] = useState(0.75);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenBoltPreloadWorkbench  = () => setOpen(true);
        window.__forgeCloseBoltPreloadWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenBoltPreloadWorkbench; delete window.__forgeCloseBoltPreloadWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.boltpre?.analyse({proofStrength_MPa:Number(Sp), tensileArea_mm2:Number(At), boltDiameter_mm:Number(d), boltLengthGrip_mm:Number(lb), memberGripThickness_mm:Number(lm), boltE_GPa:Number(Eb), memberE_GPa:Number(Em), externalLoadP_kN:Number(P), torqueCoefficient:Number(K), preloadFraction:Number(frac)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-bpre-panel" title="Bolt preload · Shigley §8.8" onClose={() => setOpen(false)}>
            <Row label="S_p proof (MPa)" v={Sp} set={setSp}/>
            <Row label="A_t (mm²)" v={At} set={setAt}/>
            <Row label="d nominal (mm)" v={d} set={setD}/>
            <Row label="l_b bolt grip (mm)" v={lb} set={setLb}/>
            <Row label="l_m member (mm)" v={lm} set={setLm}/>
            <Row label="E_bolt (GPa)" v={Eb} set={setEb}/>
            <Row label="E_member (GPa)" v={Em} set={setEm}/>
            <Row label="P external (kN)" v={P} set={setP}/>
            <Row label="K torque (0.20 dry)" v={K} set={setK}/>
            <Row label="preload fraction" v={frac} set={setFrac}/>
            <Btn testid="forge-bpre-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-bpre-result">
                <Ln k="F_i" v={r.recommendedPreload_kN.toFixed(2) + ' kN'}/>
                <Ln k="T torque" v={r.tighteningTorque_Nm.toFixed(2) + ' N·m'}/>
                <Ln k="C ratio" v={r.jointStiffnessRatio_C.toFixed(3)}/>
                <Ln k="F_b" v={r.boltLoad_kN.toFixed(2) + ' kN'}/>
                <Ln k="F_m" v={r.memberLoad_kN.toFixed(2) + ' kN'}/>
                <Big testid="forge-bpre-sep" colour="#3fb950">P_sep = {r.separationLoad_kN.toFixed(2)} kN</Big>
            </Res>}
        </P>, document.body);
}

export function PrestressWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [fpj, setFpj] = useState(1395);
    const [fci, setFci] = useState(30);
    const [fc, setFc] = useState(40);
    const [fcgp, setFcgp] = useState(15);
    const [fcdp, setFcdp] = useState(8);
    const [Ep, setEp] = useState(196);
    const [H, setH] = useState(70);
    const [esh, setEsh] = useState(400);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenPrestressWorkbench  = () => setOpen(true);
        window.__forgeClosePrestressWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenPrestressWorkbench; delete window.__forgeClosePrestressWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.prestress?.analyse({initialStress_fpj_MPa:Number(fpj), concreteStrengthAtTransfer_fci_MPa:Number(fci), finalConcreteStrength_fc_MPa:Number(fc), fcgp_MPa:Number(fcgp), fcdp_MPa:Number(fcdp), strandModulus_GPa:Number(Ep), humidityH_pct:Number(H), shrinkageStrain_e6:Number(esh)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-prs-panel" title="Prestress losses · AASHTO LRFD §5.9" onClose={() => setOpen(false)}>
            <Row label="f_pj jacking (MPa)" v={fpj} set={setFpj}/>
            <Row label="f'_ci transfer (MPa)" v={fci} set={setFci}/>
            <Row label="f'_c final (MPa)" v={fc} set={setFc}/>
            <Row label="f_cgp @ strand CG (MPa)" v={fcgp} set={setFcgp}/>
            <Row label="f_cdp dead-load (MPa)" v={fcdp} set={setFcdp}/>
            <Row label="E_p strand (GPa)" v={Ep} set={setEp}/>
            <Row label="H humidity (%)" v={H} set={setH}/>
            <Row label="ε_sh shrinkage (μ)" v={esh} set={setEsh}/>
            <Btn testid="forge-prs-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-prs-result">
                <Ln k="ES" v={r.loss_ES_MPa.toFixed(1) + ' MPa'}/>
                <Ln k="SR" v={r.loss_SR_MPa.toFixed(1) + ' MPa'}/>
                <Ln k="CR" v={r.loss_CR_MPa.toFixed(1) + ' MPa'}/>
                <Ln k="RE" v={r.loss_RE_MPa.toFixed(1) + ' MPa'}/>
                <Big testid="forge-prs-tot" colour="#3fb950">Total = {r.totalLoss_MPa.toFixed(1)} MPa ({r.totalLossPercent.toFixed(1)} %)</Big>
                <Big testid="forge-prs-fpe" colour="#58a6ff">f_pe = {r.finalStress_MPa.toFixed(1)} MPa</Big>
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
