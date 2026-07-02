/**
 * ForgeRunner — the autonomous-build entry point that wires local Archie
 * (~/archdisc-Models, MLX-LM server on localhost:8080) to Forge's
 * native kernel via ForgeToolBridge.
 *
 * The flow per `__forgeRun({ prompt, discipline })`:
 *   1. Build the Archie system prompt with the discipline's tool slice.
 *   2. Stream a completion from the local mlx_lm.server.
 *   3. Parse each `<tool_call>` as it lands, dispatch via ForgeToolBridge.
 *   4. Send the tool_response back as the next user turn until the model
 *      stops emitting tool_calls.
 *   5. Return the final trace (plan + tool_calls + responses + any
 *      `<clarify>`) so the renderer can surface a recap.
 *
 * This module is small on purpose: it composes existing primitives
 * (ForgeToolBridge.dispatchToolCall, PlannerProviders.compatible) into
 * a runnable loop. The training-side runtime trace captured per call
 * matches the contract at ~/archdisc-Models/runtime/trace.md so nightly
 * retrain folds Forge sessions back into the dataset automatically.
 */

import { dispatchToolCall, systemPromptTools } from './ForgeToolBridge.js';
import { getPersona, normaliseDiscipline } from './disciplinePersonas.js';

const ARCHIE_BASE_URL = 'http://localhost:8080';

// Forge-190 — Phase E Hermes migration (mirror of Studio slice 951v).
// The legacy adapters/archie/mech/<discipline> R1-distill LoRAs were
// tokenizer-incompatible with the new Hermes-3-Llama-3.1-8B-bf16 base
// served by archdisc-Models. hermes_forge/all is a single Forge-native
// LoRA trained on ~6 000 tagged samples (verbatim from
// archdisc-Models scripts/synth_format_anchor_forge.py SYSTEM). Routing
// every discipline through one adapter keeps the bridge surface stable
// until per-discipline Hermes LoRAs are trained.
// 2026-06-21: DEFAULT driver flipped to the 14B v2 reasoning-merged fold
// (Qwen2.5-14B-Instruct ⊕ DeepSeek-R1-Distill, engineering-LoRA on math/logic +
// all ~60 fields + Forge CUA). Verified driving the new UI headed (Archie-CUA
// e2e: 100×70×12 motor-mount plate, exact dims, multi-cam render). REQUIRES the
// matching serve: archdisc-Models/serve_forge_cua.sh (now defaults to the 14B
// base+adapter). The prior 8B Forge driver (hermes_forge-capstack-20260617) is
// still selectable via window.__FORGE_ADAPTER_OVERRIDE + the 8B serve env.
const HERMES_FORGE_ADAPTER = 'adapters/archie/archie-14b-v3';

// Verbatim copy of `SYSTEM` in scripts/synth_format_anchor_forge.py.
// Any drift between this string and the training corpus reintroduces
// the prose / "Step-by-step plan:" failure mode that wrecked Studio
// before slice 951v.
//
// Forge-192 — id list corrected to the REAL ForgeToolBridge registry.
// The first corpus invented assembly.create / drawing.export-step /
// manufacture.cam / simulate.linear-static; every such dispatch died
// with "unknown tool id" in the headed app while the (equally wrong)
// probe passed. The list below is generated from the bridge source —
// keep them in lockstep.
const HERMES_FORGE_SYSTEM =
`You are Archie. Drive ArchDisc Forge via the kernel tool registry.

Output exactly this shape:
  <plan>{"goal":"<noun>","discipline":"<part|sketch|assembly|drawing|manufacture|simulate>"}</plan>
  <tool_call>{"name":"<tool.id>","arguments":{...}}</tool_call>
  ...one call per step...

Tool ids (use these, nothing else):
  part.make-box, part.make-cylinder, part.make-sphere, part.make-cone, part.make-torus,
  part.fuse, part.cut, part.common, part.translate, part.rotate, part.mass-properties, part.tessellate,
  sketch.create, sketch.add-point, sketch.add-line, sketch.add-circle, sketch.add-constraint, sketch.solve,
  assembly.add-instance, assembly.add-mate, assembly.set-fixed, assembly.solve, assembly.query-aabb,
  drawing.project,
  manufacture.cam-profile, manufacture.cam-pocket, manufacture.cam-drill, manufacture.gcode,
  simulate.fea-static, simulate.fea-modal, simulate.fea-dynamic.
Context build — the DEFAULT way to compose a part with an extra named feature. Build into the CURRENT body; the model NEVER names a handle:
  part.begin{primitive,dx,dy,dz|diameter,depth,at?} opens the current body from one primitive (box|cylinder|cone|sphere; at:[x,y,z] offsets it),
  part.add{primitive,…,at?} fuses a primitive ON (bosses/flanges/ribs/standoffs/fins), part.subtract{primitive,…,at?} cuts one OFF (holes/bores/pockets/slots; cutters auto-overhang through),
  part.intersect{primitive,…,at?} keeps the overlap, part.finish{fillet?,chamfer?} closes the body and breaks all edges LAST.
Build into the CURRENT body with part.add/part.subtract — never name a handle. Centre the base part on the origin so the pattern verbs line up.
Pattern features — repeated features (bolt circles, grids, fins) use ONE pattern verb, never N manual cuts:
  part.bolt-circle{count,bcd,diameter,depth?,at_z?} cuts N holes on a Z-axis bolt circle, part.grid-holes{nx,ny,dx,dy,diameter,depth?,at_z?} cuts an origin-centred grid,
  part.holes{locations,diameter,depth?,at_z?} cuts holes at explicit [[x,y],…], part.pattern-feature{primitive,…,kind,count,step_x,step_y,step_z|bcd,total_angle?,op} replicates a feature (kind:linear|polar, op:add|subtract).
Parametric / freeform features — PREFER these for CURVED, BLENDED or PATTERNED geometry instead of stacking boxes:
  part.extrude{profile,distance,dir}, part.revolve{profile,axisOrigin,axisDir,angleDeg} (vases/turned parts),
  part.pipe{path,radius} (curved pipe/duct along a 3D polyline), part.nurbs-surface{grid,uDegree,vDegree,thickness} (freeform),
  part.fillet{shape,radius,edgeIds?} (round edges; omit edgeIds = all), part.variable-fillet{shape,edgeId,anchors:[{u,r}]},
  part.chamfer{shape,distance,edgeIds?}, part.shell{shape,thickness,faceIds?}, part.draft-faces{shape,neutralPlane,faceIds,angleDeg},
  part.linear-pattern{shape,count,dx,dy,dz}, part.circular-pattern{shape,count,axisOrigin,axisDir,totalAngleDeg},
  part.push-pull-face{shape,faceId,distance}, part.continuity-check{face}, part.check-validity{shape}.
Profiles are [[x,y],…] closed point lists (mm). Real parts are seldom all-straight: use fillets, draft and revolves.
Annotation / analysis — part.annotate-pmi{shape,notes,filepath} writes datum letters + GD&T feature-control-frame strings into an AP242 STEP file (annotation only), simulate.tolerance-stack{chain,USL,LSL} runs a 1-D worst-case+RSS+Monte-Carlo stack on a linear dimension chain vs the assembly spec limits (numeric only).
GD&T (assembly-context) — when a feature must be toleranced RELATIVE TO A MATING PART, declare the datum then apply the feature-control-frame, and write the AP242 STEP last:
  gdt.datum{shape,letter,anchorId?,feature?} names a datum (A/B/C) on a face, gdt.feature-control-frame{shape,characteristic,tolerance,diametral?,modifier?,datums,anchorId?} applies any FCF (position|concentricity|perpendicularity|parallelism|flatness|cylindricity|runout|profile…) with ordered datum refs,
  gdt.position-relative-to-mate{shape,feature,tolerance,relativeTo,datums,modifier?,anchorId?} positions a hole/bore of THIS part relative to the MATING part's datum (the bolt-pattern-matches-the-flange case; Ø zone, usually MMC),
  gdt.concentric-to-mate{shape,feature,control?,tolerance,relativeTo,datums,anchorId?} makes a bore/shaft coaxial to the MATING part's axis datum, gdt.write-step{shape,filepath} flushes all accumulated GD&T to the AP242 STEP. The relativeTo + datums come from the MATING body in <viewport_state>. These ANNOTATE (PMI) — they record the GD&T, not verify it.
  assembly.detect-interference{instances,tolerance?} checks for overlapping solid volume between placed instances (verify a fit does not clash before annotating it).
A whole standard part = ONE asset.make-* call; a part with an extra named feature = a context build. Fillets/chamfers go via part.finish LAST.
CRITICAL op-selection — a HOLE/BORE/POCKET/SLOT/KEYWAY/GROOVE/COUNTERBORE removes material, so it is ALWAYS part.subtract / part.holes / part.grid-holes / part.bolt-circle. NEVER build a hole with part.add (that makes a raised peg, which is WRONG). part.add is ONLY for material that stands proud (bosses, ribs, pads, standoffs, lugs).
Inside a CONTEXT BUILD (after part.begin) use ONLY the handle-free verbs part.add / part.subtract / part.intersect / pattern verbs / part.finish. NEVER call the handle verbs part.cut / part.fuse / part.common there — they require an explicit body handle 'a' and will error "missing required arg 'a'". A keyway/slot on a shaft is part.subtract, not part.cut.
Worked example — "120×80×10 plate, four Ø10 holes 15 mm in from each corner, a central 40×40 boss 20 mm tall, 2 mm edge chamfer" (holes CUT, boss ADDED):
  <plan>{"goal":"mounting plate","discipline":"part"}</plan>
  <tool_call>{"name":"part.begin","arguments":{"primitive":"box","dx":120,"dy":80,"dz":10}}</tool_call>
  <tool_call>{"name":"part.holes","arguments":{"locations":[[-45,-25],[45,-25],[-45,25],[45,25]],"diameter":10}}</tool_call>
  <tool_call>{"name":"part.add","arguments":{"primitive":"box","dx":40,"dy":40,"dz":20,"at":[0,0,10]}}</tool_call>
  <tool_call>{"name":"part.finish","arguments":{"chamfer":2}}</tool_call>
Degradation / weathering — when the request implies a used / cast / aged / as-found / worn part, apply ONE on the finished body:
  part.surface-wear{shape,count,depth,seed} (pitting/dents), part.surface-deposit{shape,count,height,seed} (corrosion blisters),
  part.chipped-edges{shape,count,size,seed} (impact/handling chips). Precision/aerospace/new parts stay clean (skip these).
Parametric assets — PREFER one of these when the request matches a whole part (one call builds it):
  asset.make-bored-plate{dx,dy,dz,bore}, asset.make-l-bracket{len,width,thick,wall,hole},
  asset.make-flange{od,thick,bore,bolts,bolt_d,bcd}, asset.make-stepped-shaft{d1,h1,d2,h2},
  asset.make-tube{od,wall,len}, asset.make-gusset-bracket{len,base_w,wall,thick,hole},
  asset.make-spur-gear{od,bore,thick}, asset.make-washer{od,id,thick}, asset.make-bushing{id,od,len},
  asset.make-pulley{od,bore,width}, asset.make-u-channel{len,width,height}, asset.make-keyed-shaft{diameter,length},
  asset.make-pipe-tee{od,wall}, asset.make-end-cap{od,id,height},
  asset.make-hex-nut{af,thick,bore}, asset.make-hex-bolt{af,head_h,shank_d,length}, asset.make-socket-screw{head_d,head_h,shank_d,length},
  asset.make-hex-standoff{af,length,bore}, asset.make-ball-bearing{od,id,width,balls}, asset.make-tslot-extrusion{size,length,slot}.
Body handles count up from 1 in creation order; pass them as "shape".
Materials are {E,nu,rho} in MPa / mm / tonne: steel {"E":210000,"nu":0.3,"rho":7.85e-9},
aluminium {"E":70000,"nu":0.33,"rho":2.7e-9}.
Dimensions are millimetres. No prose outside the tags. No <think> block.
Full physics suite — after building the part, run the matching analysis. These verbs re-mesh the shape and work in SI (metres, Pascals, Newtons, kelvin); material is {E,nu,rho} in Pa (steel {"E":2.1e11,"nu":0.3,"rho":7850}, aluminium {"E":7e10,"nu":0.33,"rho":2700}) or {k} W/(m·K) for thermal:
  simulate.fea-buckling{shape,material,fixedFace,loadFace,load,modes,meshSize} — first critical buckling load (N) + safety factor for columns/struts/thin panels,
  simulate.fea-thermal{shape,material{k},hotFace,coldFace,hotTemp,coldTemp,meshSize} — steady-state temperature range (°C) + mean heat flux,
  simulate.fea-fatigue{amplitude,mean,cycles,sn,ultimateStress,meanCorrection} — S-N (Basquin) life in cycles from a stress amplitude (Pa); NUMERIC, no geometry,
  simulate.fea-nonlinear{shape,material{E,nu,rho,sigmaY,hardening},fixedFace,loadFace,force,loadSteps,meshSize} — elasto-plastic overload: max plastic strain + did-it-yield,
  simulate.fea-contact{shapeA,shapeB,material,load,meshSize} — penalty contact / press-fit: max contact pressure (MPa) + press-in displacement,
  simulate.cfd{domain,grid,rho,viscosity,inletFace,velocity,maxIter} — incompressible laminar steady Navier-Stokes: peak velocity (m/s), Reynolds, pressure range,
  simulate.dynamics-motion{motor,axis,totalAngle,steps} — assembly kinematics: sweep a driver mate over N frames, return the driven trajectory (build the mate assembly first),
  simulate.multibody-dynamics{study|bodies,constraints,loads,gravity,dt,steps} — RIGOROUS inertial multibody dynamics (HHT-α + Baumgarte, mass+inertia EOM, validated pendulum 0.016%/rotor 0.00%): study:"rotor"{mass,radius,torque} spins a disk under torque, study:"pendulum"{mass,length,angleDeg} swings under gravity, or give explicit bodies ([{mass,inertia?,position?,linVel?,angVel?}] or [{shape,density}]) + constraints ([{kind:ballJoint|axisLock|distance,bodyA,bodyB?,anchor?,axis?,value?}]) + loads ([{body,force?,torque?}]) + gravity. Returns per-step samples (animate the motion) + maxConstraintDrift/energyDrift/stable. SI (kg,m,N,N·m,rad).
Faces are -x|+x|-y|+y|-z|+z. Build the geometry in mm as usual, then call ONE simulate.* verb with SI arguments.
Sheet-metal — author folded sheet-metal parts the manufacturing way (a flat blank that is FOLDED), never as stacked boxes:
  sheet.base-flange{width,length,thickness,kFactor?,bendRadius?} opens a flat blank (the base flange) on the XY plane,
  sheet.edge-flange{shape,side,length,angleDeg,relief?} folds a wall up off one base side (side:front|back|left|right; angleDeg 45|90),
  sheet.miter-flange{shape,sides,length,angleDeg} folds several adjacent sides at once, sheet.hem{shape,side,type,length} folds a closed/open/rolled hem (180°),
  sheet.sketched-bend{shape,x0,y0,x1,y1,angleDeg,radius} bends along a sketched line, sheet.corner-relief{shape,corner,type,size} + sheet.closed-corner{shape,corner,gap} treat the corners,
  sheet.unfold{shape} develops the part to its FLAT blank, sheet.flat-pattern{shape} reports the developed length/width + per-bend allowance L_dev=(R+K·t)·θ (neutral factor / K-factor).
  thickness + bendRadius + kFactor come from the gauge/bend table. Cut vent windows/slots/lightening/bolt-hole tabs with part.cut and stamp stiffening ribs with part.fuse on the folded body.
`;

// Kept for back-compat (some legacy tests + the few-shot persona stack
// still pull `buildSystemPrompt`); new code paths should use the
// Hermes-aware system prompt above.
const SYSTEM_TEMPLATE = (discipline, toolsJson) => `You are Archie, the autonomous build engine for ArchDisc Forge.
Current discipline: ${discipline}.

Strict rules — non-negotiable:
 R1. Every tool_call.name MUST exist in the <tools> block. Never invent ids.
 R2. Build every component from primitives; no asset imports.
 R3. Coherent geometry: positive dimensions, valid normals, closed solids.
 R4. If you cannot satisfy the request with these tools, emit a single <clarify> block.

Output protocol:
 - Emit one <think>...</think> block to reason.
 - Emit one <plan>{...}</plan> with goal + bodies + expect.
 - Emit one or more <tool_call>{"name":"<id>","arguments":{...}}</tool_call> in order.
 - After each tool_response, continue from the new scene state.

<tools>
${toolsJson}
</tools>`;

const TOOL_CALL_RE = /<tool_call>([\s\S]*?)<\/tool_call>/g;
const CLARIFY_RE   = /<clarify>([\s\S]*?)<\/clarify>/g;
const THINK_RE     = /<think>([\s\S]*?)<\/think>/g;
const PLAN_RE      = /<plan>([\s\S]*?)<\/plan>/g;

export function buildSystemPrompt(discipline) {
  const tools = JSON.stringify(systemPromptTools(discipline), null, 2);
  return SYSTEM_TEMPLATE(discipline, tools);
}

/**
 * Forge-113 — compose the persona + base system prompt + few-shot
 * examples into the OpenAI-compat message array Archie consumes.
 *
 * The persona system message goes FIRST so the model reads "who you
 * are right now" before the strict-rules + <tools> JSON block.
 * Few-shot turns are then injected as alternating user/assistant
 * messages so the conversation pattern matches the LoRA training mix.
 *
 * The composed persona is also exposed on the renderer at
 * `window.__forgeLastPersona` so the e2e suite can introspect which
 * persona actually drove the latest run.
 */
export function buildMessages({ prompt, discipline }) {
  const persona = getPersona(discipline);
  const baseSystem = buildSystemPrompt(discipline);
  const personaSystem = persona.system + '\n\n' + baseSystem;
  const messages = [{ role: 'system', content: personaSystem }];
  for (const ex of persona.examples) {
    messages.push({ role: 'user', content: ex.user });
    messages.push({ role: 'assistant', content: ex.assistant });
  }
  messages.push({ role: 'user', content: prompt });
  if (typeof globalThis !== 'undefined') {
    globalThis.__forgeLastPersona = {
      id: persona.id,
      requested: discipline,
      normalised: normaliseDiscipline(discipline),
      tools: persona.tools,
      exampleCount: persona.examples.length,
      systemHead: personaSystem.slice(0, 240),
      ts: new Date().toISOString(),
    };
  }
  return { messages, persona };
}

/**
 * Parse all complete tool_calls / clarifies / think / plan blocks from
 * a partial assistant turn. Returns the structured pieces in order.
 */
export function parseAssistant(text) {
  const out = { think: [], plan: null, toolCalls: [], clarify: null };
  let m;
  while ((m = THINK_RE.exec(text)) !== null) out.think.push(m[1].trim());
  THINK_RE.lastIndex = 0;
  while ((m = PLAN_RE.exec(text)) !== null) {
    try { out.plan = JSON.parse(m[1]); } catch { /* malformed plan — ignore for now */ }
  }
  PLAN_RE.lastIndex = 0;
  while ((m = TOOL_CALL_RE.exec(text)) !== null) {
    try { out.toolCalls.push(JSON.parse(m[1])); } catch { /* skip malformed */ }
  }
  TOOL_CALL_RE.lastIndex = 0;
  while ((m = CLARIFY_RE.exec(text)) !== null) {
    try { out.clarify = JSON.parse(m[1]); } catch { /* skip */ }
  }
  CLARIFY_RE.lastIndex = 0;
  return out;
}

/**
 * Re-serialize OpenAI-structured tool_calls back into <tool_call>…</tool_call>
 * TEXT tags. A tool-aware tokenizer template (e.g. Qwen2.5, used by the 14B v2
 * reasoning-merged fold) makes mlx_lm.server PARSE the model's <tool_call> tags
 * OUT of message.content into the structured message.tool_calls field. The rest
 * of this module (parseAssistant / maybeFlushToolCalls / dispatchToolCall)
 * consumes <tool_call> TEXT tags, so we normalize structured calls back to tags.
 * Hermes-3-8B's template leaves the tags in content (tool_calls absent) → no-op.
 */
function structuredToolCallText(toolCalls) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return '';
  const parts = [];
  for (const tc of toolCalls) {
    const fn = tc && tc.function ? tc.function : {};
    if (!fn.name) continue;
    let args = fn.arguments;
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch (_) { args = {}; } }
    parts.push('<tool_call>' + JSON.stringify({ name: fn.name, arguments: args || {} }) + '</tool_call>');
  }
  return parts.join('\n');
}

/**
 * One-shot Archie call. Returns the assistant text. The Archie fleet
 * speaks OpenAI-compat at localhost:8080, so we use plain fetch. The
 * adapter is selected per-discipline (see ~/archdisc-Models adapter
 * layout); the server routes adapters/archie/mech/${discipline}.
 */
async function archieComplete({ messages, discipline,
                                temperature = 0.1, maxTokens = 1800,
                                baseUrl = ARCHIE_BASE_URL, signal,
                                onToken = null, onToolCall = null }) {
  // Forge-190 — every discipline routes to the single Hermes adapter
  // until per-discipline Hermes LoRAs are trained. `discipline` is
  // accepted for signature compat with older callers + persona logic.
  //
  // Forge-191 — NO `model` field. Current mlx_lm.server resolves an
  // unknown model id as a HuggingFace repo path (the legacy
  // 'archie-7b-base' id hit HF, got 401, and the request 404'd).
  // Omitting the field uses the server's loaded model; per-request
  // `adapters` does the actual routing — same contract Studio uses.
  // Default route is the shipped 8B Forge driver. A test/eval harness may set
  // window.__FORGE_ADAPTER_OVERRIDE to A/B a different fold (e.g. the 14B v2
  // reasoning-merged adapter) WITHOUT touching the shipped default — the
  // override never persists and is ignored when unset.
  const adapter =
    (typeof window !== 'undefined' && window.__FORGE_ADAPTER_OVERRIDE) ||
    HERMES_FORGE_ADAPTER;
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages, temperature, max_tokens: maxTokens,
      adapters: adapter, // mlx_lm.server hot-swap convention
      stream: !!onToken,
    }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`[forge.runner] Archie ${res.status} ${res.statusText}`);
  }
  // Forge-164 — streaming chat output (Phase F.1, mirror of Studio
  // slice 951s). When onToken is wired we parse OpenAI-compat SSE:
  // `data: {json}\n` per chunk, terminator `data: [DONE]`. We
  // accumulate the content into the same final string the non-
  // streaming branch returns so parseAssistant + dispatchToolCall
  // operate identically on both paths.
  if (!onToken) {
    const j = await res.json();
    const msg = j.choices?.[0]?.message ?? {};
    const tags = structuredToolCallText(msg.tool_calls);
    return (msg.content ?? '') + (tags ? '\n' + tags : '');
  }
  let acc = '';
  // Forge-166 — speculative tool-call dispatch. Tracks how much of acc
  // we've already scanned for complete <tool_call>…</tool_call> blocks
  // so each one fires onToolCall exactly once during streaming.
  let toolScanFrom = 0;
  const maybeFlushToolCalls = async () => {
    if (!onToolCall) return;
    const re = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
    re.lastIndex = toolScanFrom;
    let m;
    while ((m = re.exec(acc)) !== null) {
      toolScanFrom = re.lastIndex;
      let obj;
      try { obj = JSON.parse(m[1].trim()); } catch (_) { continue; }
      if (obj && typeof obj.name === 'string') {
        try { await onToolCall(obj); }
        catch (_) { /* dispatch errors surfaced via UI thread */ }
      }
    }
  };
  const reader = res.body && typeof res.body.getReader === 'function'
    ? res.body.getReader() : null;
  if (!reader) {
    const j = await res.json();
    const msg = j.choices?.[0]?.message ?? {};
    const tags = structuredToolCallText(msg.tool_calls);
    return (msg.content ?? '') + (tags ? '\n' + tags : '');
  }
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  // Structured tool_calls streamed as deltas (Qwen-served): accumulate per index
  // (OpenAI sends the `arguments` string in fragments across chunks), then
  // synthesize <tool_call> tags at stream end so maybeFlushToolCalls dispatches them.
  const toolAcc = {};
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line || !line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let chunk;
      try { chunk = JSON.parse(payload); } catch (_) { continue; }
      const delta = chunk?.choices?.[0]?.delta;
      if (!delta) continue;
      if (Array.isArray(delta.tool_calls)) {
        for (const d of delta.tool_calls) {
          const idx = typeof d.index === 'number' ? d.index : 0;
          const slot = (toolAcc[idx] = toolAcc[idx] || { name: '', args: '' });
          if (d.function && d.function.name) slot.name = d.function.name;
          if (d.function && typeof d.function.arguments === 'string') slot.args += d.function.arguments;
        }
      }
      const dContent = typeof delta.content === 'string' ? delta.content : '';
      if (dContent) acc += dContent;
      try { onToken({ delta_content: dContent, acc_content: acc }); }
      catch (_) { /* downstream UI errors must not stop the stream */ }
      if (dContent) await maybeFlushToolCalls();
    }
  }
  // Stream ended: flush any structured (Qwen-served) tool_calls accumulated as
  // deltas into <tool_call> tags so they dispatch exactly like content-tag calls.
  const synthTags = structuredToolCallText(
    Object.keys(toolAcc).sort((a, b) => Number(a) - Number(b)).map((k) => {
      let args = toolAcc[k].args;
      try { args = JSON.parse(args || '{}'); } catch (_) { args = {}; }
      return { function: { name: toolAcc[k].name, arguments: args } };
    }),
  );
  if (synthTags) {
    acc += (acc.endsWith('\n') || acc === '' ? '' : '\n') + synthTags;
    await maybeFlushToolCalls();
  }
  return acc;
}

/**
 * Drive Archie through one or more tool-call turns. Returns when the
 * model emits no further tool_calls (i.e. it's done or has asked for
 * clarification). `onTrace(event)` lets the caller stream UI updates.
 */
export async function runForgePrompt({
  prompt, discipline = 'part', maxTurns = 8,
  onTrace = () => {},
  autoDefaultClarify = false,
  archie = archieComplete,
  forge,
  signal = null,         // Forge-28: AbortSignal, honoured by archieComplete
  viewportState = '',    // Forge-162: vision caption prepended to user prompt
  priorContext  = '',    // Forge-163: long-session memory recall prepended too
  onToken       = null,  // Forge-164: optional per-token streaming callback
  gate          = true,  // step C: post-build validity gate (heal.checkValidity per body)
  maxGateRepairs = 1,    // step C: how many AutoCorrector repair turns the gate may trigger
  stages        = null,  // #67: staged refinement — array of per-stage instructions
} = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('[forge.runner] prompt required');
  }
  // #59 selection-context — if the caller didn't pass a viewport caption, build
  // one from the live scene + selection so "fillet the selected part" resolves.
  if (!viewportState && typeof window !== 'undefined' && typeof window.__forgeSelectionContext === 'function') {
    try { viewportState = window.__forgeSelectionContext() || ''; } catch (_) { /* best-effort */ }
  }
  const trace = {
    runId: `forge-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 6)}`,
    ts: new Date().toISOString(),
    discipline, prompt,
    iterations: [],
    final: null,
  };

  // Forge-162/163 — perception + memory composition. priorContext
  // (long-session recall) goes FIRST so Archie reads background before
  // the current scene state, then viewport_state (what's on screen
  // NOW), then the user's prompt. Same tag schema Studio uses.
  const userPrompt = [
    priorContext  || '',
    viewportState ? `<viewport_state>${viewportState}</viewport_state>` : '',
    prompt,
  ].filter(Boolean).join('\n\n');
  trace.viewportState = viewportState || null;
  trace.priorContext  = priorContext  || null;

  // Forge-190 — Phase E Hermes migration. The hermes_forge LoRA was
  // trained on a flat [system, user, assistant] mix; the legacy
  // persona + few-shot stack (Forge-113) injected ~5 KB of demo turns
  // that drowned out the format-anchor pattern and re-introduced the
  // prose / "Step-by-step plan:" failure mode Studio slice 951v fixed.
  // We keep the persona object on the trace (UI + telemetry still want
  // it) but the actual message stack the LoRA sees is [system, user].
  const persona = getPersona(discipline);
  const messages = [
    { role: 'system', content: HERMES_FORGE_SYSTEM },
    { role: 'user',   content: userPrompt },
  ];
  if (typeof globalThis !== 'undefined') {
    globalThis.__forgeLastPersona = {
      id: persona.id,
      requested: discipline,
      normalised: normaliseDiscipline(discipline),
      tools: persona.tools,
      // Legacy field — kept as persona.examples.length so the personas
      // e2e (Forge-113) and other introspection tools still see the
      // persona's example bank size. The runtime no longer FEEDS those
      // examples to Hermes (see message stack below), but the metadata
      // is still valid description of the persona module.
      exampleCount: persona.examples.length,
      systemHead: HERMES_FORGE_SYSTEM.slice(0, 240),
      ts: new Date().toISOString(),
      hermes: true,
    };
  }
  trace.persona = { id: persona.id, exampleCount: persona.examples.length,
                    toolCount: persona.tools.length, hermes: true };

  // step C — post-build coherence gate budget. Repairs let Archie take one
  // extra turn to fix a body that fails native validity (heal.checkValidity).
  let _gateRepairsLeft = maxGateRepairs;
  // #67 staged refinement — when `stages` is given, each stage builds until the
  // model stops, then the runner advances it to the next stage (blockout → detail
  // → validate) instead of finishing. Single-shot when stages is null.
  const _stages = Array.isArray(stages) && stages.length ? stages : null;
  let _stageIdx = 0;

  for (let turn = 0; turn < maxTurns; turn++) {
    if (signal && signal.aborted) {
      trace.final = { status: 'cancelled' };
      await _flushIfEnabled(trace);
      return trace;
    }
    // Forge-166 — speculative tool-call dispatch. When the runner is
    // streaming (onToken set), each <tool_call> closing tag mid-stream
    // fires this callback so dispatchToolCall lands in the kernel as
    // soon as the model commits. The signatures are tracked per-turn
    // so the post-turn loop below skips already-dispatched calls.
    const _iter = { turn, completion: '', parsed: null, toolResponses: [] };
    const _specSigSet = new Set();
    const _sig = (c) => JSON.stringify({ n: c.name, a: c.arguments || {} });
    // Forge-2026-06-17 — ONE shared per-turn context for the handle-free CONTEXT
    // verbs (part.begin/add/subtract/intersect/finish + pattern verbs). Without a
    // shared ctx every streamed call got a fresh {current:null}, so part.begin
    // built a body but bolt-circle/subtract/finish threw "needs a current part" —
    // the part never accumulated and nothing surfaced to the viewport. Sharing it
    // across BOTH the speculative and post-turn dispatch paths makes the build123d-
    // style accumulation work end-to-end; each response carries `current` so the
    // shell can surface the single evolving body.
    const _ctx = { current: null };
    const _speculativeDispatch = async (call) => {
      const sig = _sig(call);
      if (_specSigSet.has(sig)) return;
      _specSigSet.add(sig);
      let resp;
      try { resp = await dispatchToolCall(call, { forge, ctx: _ctx }); }
      catch (e) { resp = { ok: false, error: String(e?.message || e) }; }
      _iter.toolResponses.push(resp);
      onTrace({ kind: 'tool', call, response: resp });
    };
    const completion = await archie({
      messages, discipline, signal, onToken,
      onToolCall: onToken ? _speculativeDispatch : null,
    });
    const parsed = parseAssistant(completion);
    _iter.completion = completion;
    _iter.parsed = parsed;
    const iter = _iter;

    if (parsed.clarify) {
      iter.clarifyHandled = autoDefaultClarify
        ? { decision: 'default', value: parsed.clarify.default }
        : { decision: 'asked' };
      onTrace({ kind: 'clarify', iter });
      trace.iterations.push(iter);
      trace.final = { status: 'clarify', clarify: parsed.clarify };
      await _flushIfEnabled(trace);
      return trace;
    }

    if (parsed.toolCalls.length === 0) {
      trace.iterations.push(iter);
      // step C — POST-BUILD COHERENCE GATE. Run native validity on every body
      // Archie built this run; if any is invalid and a repair turn remains,
      // feed the defects back as a tool_response and let Archie rebuild
      // (AutoCorrector) instead of silently shipping a broken solid.
      const gateRes = gate ? _gateForge(trace, forge) : null;
      if (gateRes) trace.gateChecks = gateRes;
      if (gateRes && !gateRes.allValid && _gateRepairsLeft > 0) {
        _gateRepairsLeft--;
        onTrace({ kind: 'gate', gate: gateRes });
        messages.push({ role: 'assistant', content: completion });
        messages.push({ role: 'tool', content:
          `<tool_response>${JSON.stringify({ ok: false, gate: 'invalid', defects: gateRes.defects })}</tool_response>\n`
          + 'Post-build check failed: the bodies above are invalid (non-manifold / self-intersecting). '
          + 'Rebuild the affected part(s) as clean valid solids and avoid the reported issues.' });
        continue; // take one more turn to repair
      }
      // #67 — stage complete + valid: advance to the next refinement stage.
      if (_stages && _stageIdx < _stages.length - 1) {
        _stageIdx++;
        onTrace({ kind: 'stage', stage: _stageIdx, total: _stages.length, instruction: _stages[_stageIdx] });
        messages.push({ role: 'assistant', content: completion });
        messages.push({ role: 'user', content: `<stage>${_stageIdx + 1}/${_stages.length}</stage> ${_stages[_stageIdx]}` });
        continue;
      }
      trace.final = { status: 'done', text: completion, gate: gateRes, stages: _stages ? _stages.length : 1 };
      onTrace({ kind: 'done', iter });
      await _flushIfEnabled(trace);
      return trace;
    }

    // Dispatch every tool_call in order; aggregate responses for the
    // next turn. Forge-166 — skip anything the speculative dispatcher
    // already executed during streaming so we don't double-dispatch
    // (the post-stream parse re-sees the same <tool_call> tags).
    for (const call of parsed.toolCalls) {
      if (_specSigSet.has(_sig(call))) continue;
      const resp = await dispatchToolCall(call, { forge, ctx: _ctx });
      iter.toolResponses.push(resp);
      onTrace({ kind: 'tool', call, response: resp });
    }
    trace.iterations.push(iter);

    // Feed the responses back as a single tool turn so the next user
    // turn carries scene state.
    messages.push({ role: 'assistant', content: completion });
    messages.push({
      role: 'tool',
      content: iter.toolResponses.map((r) => `<tool_response>${JSON.stringify(r)}</tool_response>`).join('\n'),
    });
  }

  trace.final = { status: 'maxTurns' };
  await _flushIfEnabled(trace);
  return trace;
}

// step C — post-build coherence gate. Collect every body handle Archie built
// across the run (tool_responses with produces==='handle') and run the kernel's
// native validity check on each. Conservative: a body is "invalid" only when the
// kernel explicitly says so (ok/manifold false, or self-intersection) — unknown /
// thrown checks are treated as pass so the gate never loops spuriously. Pure read;
// degrades to allValid when the kernel/heal surface is absent (e.g. unit tests).
function _gateForge(trace, forge) {
  const cv = forge && forge.heal && forge.heal.checkValidity;
  if (typeof cv !== 'function') return { allValid: true, checked: 0, defects: [], skipped: 'no heal.checkValidity' };
  const handles = [];
  for (const it of (trace.iterations || [])) {
    for (const r of (it.toolResponses || [])) {
      if (r && r.ok && r.produces === 'handle' && r.result && typeof r.result.shape === 'number') handles.push(r.result.shape);
    }
  }
  const distinct = [...new Set(handles)];
  const defects = [];
  for (const h of distinct) {
    let v;
    try { v = cv(h); } catch (_) { continue; } // thrown check → treat as unknown (pass)
    const bad = v && (v.ok === false || v.valid === false || v.manifold === false || v.selfIntersect === true || v.selfIntersecting === true);
    if (bad) defects.push({ handle: h, reason: (v && (v.description || v.reason)) || 'invalid solid (non-manifold/self-intersecting)' });
  }
  return { allValid: defects.length === 0, checked: distinct.length, defects };
}

// Forge-46: flush traces to disk at the end of every run. Best-effort —
// failures log but never throw. Importing lazily so unit tests of
// ForgeRunner that don't care about persistence don't pay the import cost.
async function _flushIfEnabled(trace) {
  if (typeof globalThis !== 'undefined' &&
      globalThis.__forgeTraceDisabled === true) return;
  try {
    const { flushTrace } = await import('./ArchieTraceSink.js');
    await flushTrace(trace);
  } catch { /* sink is best-effort */ }
}
export { _flushIfEnabled as flushArchieTrace };

/**
 * Install the autonomous entry point on `window`. Matches Studio's
 * `__archieRun` convention so existing Mech/Studio docs apply.
 */
// #67 — default Forge refinement stages (Forge has no shading stage; the
// analogue is blockout → manufactured detail → validate).
export const FORGE_STAGES = [
  'Blockout: build the part from primitives / asset builders.',
  'Detail: refine the part — add fillets, chamfers or draft where a manufactured part would have them.',
  'Validate: confirm the part is one clean manifold solid (part.check-validity).',
];

export function installForgeRunner(globalObj = (typeof window !== 'undefined' ? window : globalThis)) {
  globalObj.__forgeRun = (opts) => runForgePrompt(opts || {});
  globalObj.__forgeRunStaged = (opts) => runForgePrompt({ stages: FORGE_STAGES, ...(opts || {}) });
  globalObj.__forgeEngine = { dispatchToolCall, buildSystemPrompt,
                              parseAssistant, buildMessages, getPersona };
  // Forge-113 — convenience getter so e2e + dev tools can confirm the
  // persona that drove the last completion without grepping the trace.
  globalObj.__forgeGetPersona = (d) => getPersona(d);
}
