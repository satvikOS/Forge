// Forge-324 bundle — IPLV + snow drift + RC slab + crane runway + CMU.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function IPLVWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [c100, setC100] = useState(5.5);
    const [c75, setC75] = useState(6.5);
    const [c50, setC50] = useState(7.5);
    const [c25, setC25] = useState(5.0);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenIPLVWorkbench  = () => setOpen(true);
        window.__forgeCloseIPLVWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenIPLVWorkbench; delete window.__forgeCloseIPLVWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.iplv?.analyse({cop100:Number(c100), cop75:Number(c75), cop50:Number(c50), cop25:Number(c25)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-iplv-panel" title="Chiller IPLV · AHRI 550/590" onClose={() => setOpen(false)}>
            <Row label="COP @ 100 %" v={c100} set={setC100}/>
            <Row label="COP @ 75 %" v={c75} set={setC75}/>
            <Row label="COP @ 50 %" v={c50} set={setC50}/>
            <Row label="COP @ 25 %" v={c25} set={setC25}/>
            <Btn testid="forge-iplv-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-iplv-result">
                <Big testid="forge-iplv-cop" colour="#3fb950">IPLV COP = {r.iplv.toFixed(3)}</Big>
                <Ln k="kW/ton" v={r.iplv_kWperTon.toFixed(3)}/>
            </Res>}
        </P>, document.body);
}

export function SnowDriftWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [pg, setPg] = useState(2.0);
    const [Lu, setLu] = useState(30);
    const [lee, setLee] = useState(true);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenSnowDriftWorkbench  = () => setOpen(true);
        window.__forgeCloseSnowDriftWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenSnowDriftWorkbench; delete window.__forgeCloseSnowDriftWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.snowdrift?.analyse({groundSnowLoad_kNm2:Number(pg), upwindFetchLength_m:Number(Lu), leewardDrift:Boolean(lee)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-snd-panel" title="Snow drift · ASCE 7-22 §7.7" onClose={() => setOpen(false)}>
            <Row label="p_g (kN/m²) ground snow" v={pg} set={setPg}/>
            <Row label="L_u (m) upwind fetch" v={Lu} set={setLu}/>
            <label style={{display:'flex', alignItems:'center', margin:'6px 0', fontSize:12}}>
                <input type="checkbox" checked={lee} onChange={(e) => setLee(e.target.checked)} style={{marginRight:8}}/>
                Leeward drift (uncheck for windward)
            </label>
            <Btn testid="forge-snd-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-snd-result">
                <Ln k="γ snow" v={r.snowUnitWeight_kNm3.toFixed(3) + ' kN/m³'}/>
                <Ln k="h_d drift" v={r.driftHeight_m.toFixed(3) + ' m'}/>
                <Big testid="forge-snd-p" colour="#3fb950">p_d = {r.driftPressure_kNm2.toFixed(3)} kN/m²</Big>
            </Res>}
        </P>, document.body);
}

export function SlabOneWayWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [L, setL] = useState(6);
    const [t, setT] = useState(200);
    const [d, setD] = useState(170);
    const [As, setAs] = useState(600);
    const [fc, setFc] = useState(28);
    const [fy, setFy] = useState(420);
    const [supp, setSupp] = useState('simple');
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenSlabOneWayWorkbench  = () => setOpen(true);
        window.__forgeCloseSlabOneWayWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenSlabOneWayWorkbench; delete window.__forgeCloseSlabOneWayWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.slaboneway?.analyse({spanLength_m:Number(L), slabThickness_mm:Number(t), effectiveDepth_d_mm:Number(d), areaSteelMm2PerM:Number(As), fc_MPa:Number(fc), fy_MPa:Number(fy), supportCondition:supp})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-slab-panel" title="RC one-way slab · ACI 318" onClose={() => setOpen(false)}>
            <Row label="L (m) span" v={L} set={setL}/>
            <Row label="t (mm) slab" v={t} set={setT}/>
            <Row label="d (mm) eff depth" v={d} set={setD}/>
            <Row label="A_s (mm²/m)" v={As} set={setAs}/>
            <Row label="f'_c (MPa)" v={fc} set={setFc}/>
            <Row label="f_y (MPa)" v={fy} set={setFy}/>
            <div style={{display:'flex', alignItems:'center', margin:'5px 0'}}>
                <span style={{width:160}}>Support</span>
                <select value={supp} onChange={(e) => setSupp(e.target.value)}
                        style={{flex:1, background:'#0d1117', color:'#c9d1d9', border:'1px solid #30363d', borderRadius:4, padding:4}}>
                    <option value="simple">simple (L/20)</option>
                    <option value="one-cont">one-cont (L/24)</option>
                    <option value="both-cont">both-cont (L/28)</option>
                    <option value="cantilever">cantilever (L/10)</option>
                </select>
            </div>
            <Btn testid="forge-slab-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-slab-result">
                <Ln k="t_min" v={r.minimumThicknessMm.toFixed(0) + ' mm'}/>
                <Ln k="a stress block" v={r.a_mm.toFixed(1) + ' mm'}/>
                <Big testid="forge-slab-phi" colour={r.thicknessAdequate ? '#3fb950' : '#f85149'}>
                    φM_n = {r.designMoment_kNmPerM.toFixed(2)} kN·m/m
                </Big>
                <Banner testid="forge-slab-t" colour={r.thicknessAdequate ? '#3fb950' : '#f85149'}>
                    {r.thicknessAdequate ? 'Slab thickness adequate' : 'Slab too thin (deflection control)'}
                </Banner>
            </Res>}
        </P>, document.body);
}

export function CraneRunwayWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [P, setP] = useState(200);
    const [L, setL] = useState(8);
    const [imp, setImp] = useState(0.25);
    const [lat, setLat] = useState(0.20);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenCraneRunwayWorkbench  = () => setOpen(true);
        window.__forgeCloseCraneRunwayWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenCraneRunwayWorkbench; delete window.__forgeCloseCraneRunwayWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.cranerunway?.analyse({maxWheelLoadKn:Number(P), spanLengthM:Number(L), impactFactor:Number(imp), lateralFraction:Number(lat)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-crn-panel" title="Crane runway beam · AISC DG7" onClose={() => setOpen(false)}>
            <Row label="P (kN) max wheel" v={P} set={setP}/>
            <Row label="L (m) span" v={L} set={setL}/>
            <Row label="impact (0.25 cab)" v={imp} set={setImp}/>
            <Row label="lateral (0.20 typ)" v={lat} set={setLat}/>
            <Btn testid="forge-crn-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-crn-result">
                <Ln k="P+impact" v={r.wheelLoadWithImpactKn.toFixed(1) + ' kN'}/>
                <Ln k="P lateral" v={r.lateralLoadKn.toFixed(1) + ' kN'}/>
                <Ln k="M vert" v={r.verticalMomentKnm.toFixed(1) + ' kN·m'}/>
                <Ln k="M lat" v={r.lateralMomentKnm.toFixed(1) + ' kN·m'}/>
                <Big testid="forge-crn-M" colour="#3fb950">M_design = {r.combinedDesignMomentKnm.toFixed(1)} kN·m</Big>
            </Res>}
        </P>, document.body);
}

export function CMUCompressionWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [A, setA] = useState(55000);
    const [r_g, setR_g] = useState(55);
    const [h, setH] = useState(3000);
    const [fm, setFm] = useState(13.8);
    const [r, setR] = useState(null);
    const [e, setE] = useState(null);
    useEffect(() => {
        window.__forgeOpenCMUWorkbench  = () => setOpen(true);
        window.__forgeCloseCMUWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenCMUWorkbench; delete window.__forgeCloseCMUWorkbench; };
    }, []);
    if (!open) return null;
    const run = () => { try {
        setR(window.forge?.cmucomp?.analyse({netAreaMm2:Number(A), radiusOfGyrationMm:Number(r_g), effectiveHeightMm:Number(h), fm_MPa:Number(fm)})); setE(null);
    } catch (ex) { setE(String(ex.message || ex)); setR(null); } };
    return createPortal(
        <P testid="forge-cmu-panel" title="CMU compression · TMS 402" onClose={() => setOpen(false)}>
            <Row label="A_n (mm²) net area" v={A} set={setA}/>
            <Row label="r (mm) radius of gyration" v={r_g} set={setR_g}/>
            <Row label="h (mm) eff height" v={h} set={setH}/>
            <Row label="f'_m (MPa)" v={fm} set={setFm}/>
            <Btn testid="forge-cmu-run" onClick={run}/>
            {e && <Err msg={e}/>}
            {r && <Res testid="forge-cmu-result">
                <Ln k="h/r" v={r.slendernessRatio_h_r.toFixed(2) + (r.slenderRegime ? ' (slender)' : '')}/>
                <Ln k="P_n" v={r.nominalCapacityKn.toFixed(0) + ' kN'}/>
                <Big testid="forge-cmu-phi" colour="#3fb950">φP_n = {r.designCapacityKn.toFixed(0)} kN</Big>
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
        <span style={{color:'#8b949e'}}>{k}</span><span>{v}</span>
    </div>;
}
function Big({ testid, colour, children }) {
    return <div data-testid={testid} style={{marginTop:6, fontWeight:700, color:colour}}>{children}</div>;
}
function Banner({ testid, colour, children }) {
    return <div data-testid={testid} style={{marginTop:8, padding:'4px 8px', borderRadius:4,
        background:colour === '#3fb950' ? '#1d2d1d' : '#3d1d1d',
        color:colour, fontWeight:700, textAlign:'center'}}>{children}</div>;
}
