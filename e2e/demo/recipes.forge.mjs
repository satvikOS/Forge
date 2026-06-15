// Curated Forge demo recipes (Monday investor demo, task #61).
//
// SINGLE-PROMPT per reference. The harness waits for the turn to FULLY
// complete (cmdbar re-enables) before reading the go/no-go.
//
// 2026-06-15: driven by the ASSET adapter (hermes_forge = assets-20260615)
// under its byte-matched ASSET_SYS. Archie now PREFERS a parametric asset
// (asset.make-flange / l-bracket / tube / stepped-shaft / bored-plate /
// gusset-bracket) when a request matches a whole part — one tool call →
// one clean, manufacturable single body (probe 6/6). Distinctive features
// (bolt circles, bores, L-profiles) compose deterministically in kernel
// code instead of the old stochastic multi-primitive boolean. Plain
// primitive parts (housing/shaft) still build from part.make-*.
//
// Each recipe: { id, title, ref, plan, prompt, expect(state)->bool }.

export const FORGE_RECIPES = [
  {
    id: 'tape-measure-housing',
    title: 'Tape-measure housing — exact 70×65×35 mm',
    ref: 'V-358',
    plan: 'Housing blank to exact outer dimensions — the parametric master a '
        + 'tape-measure body is cut from. Native build, manufacturing STEP out.',
    prompt: 'model a tape-measure housing as a single block, exactly 70 mm wide, 65 mm tall and 35 mm deep',
    expect: (st) => st.bodies >= 1,
  },
  {
    id: 'precision-shaft',
    title: 'Precision shaft — Ø24 × 90 mm',
    ref: 'V-656 mechanical',
    plan: 'Turned shaft to exact diameter and length — a single clean cylinder. STEP out.',
    prompt: 'model a precision shaft as a single cylinder, exactly 24 mm in diameter and 90 mm long',
    expect: (st) => st.bodies >= 1,
  },
  {
    id: 'pipe-flange',
    title: 'Pipe flange — Ø80, 6 bolt holes on Ø60 BCD, Ø25 bore',
    ref: 'V-656 mechanical / standard part',
    plan: 'Real flange: disc + centre bore + 6-hole bolt circle, composed in '
        + 'one parametric asset call → one clean body. STEP out.',
    prompt: 'model a Ø80 steel flange, 12 mm thick, 6 bolt holes on a 60 mm bolt circle, 25 mm bore',
    expect: (st) => st.bodies >= 1,
  },
  {
    id: 'l-bracket',
    title: 'L-bracket — 100×60×8 mm, two mounting holes',
    ref: 'V-656 mechanical',
    plan: 'Foot + wall fused into an L, two through-holes — one asset call → one body.',
    prompt: 'model an L-bracket, 100 long, 60 wide, 8 thick, with two mounting holes',
    expect: (st) => st.bodies >= 1,
  },
  {
    id: 'tube',
    title: 'Tube — outer Ø50, 4 mm wall, 120 long',
    ref: 'V-656 mechanical',
    plan: 'Hollow round tube — outer cylinder minus bore — one asset call → one body.',
    prompt: 'model a tube, outer Ø50, 4 mm wall, 120 long',
    expect: (st) => st.bodies >= 1,
  },
  // NOTE: stepped-shaft dropped from the LIVE set — the coaxial-fuse asset
  // is the most degradation-sensitive (came out as a box+blob once serve had
  // handled several requests). Re-add once serve stability over a long session
  // is solved (see feedback-models-serve-restart-before-demo). flange / tube /
  // l-bracket / bored-plate exercise the cut+fuse story reliably.
  {
    id: 'bored-mounting-plate',
    title: 'Mounting plate 120×80×14 mm + Ø25 centre bore',
    ref: 'V-656 mechanical',
    plan: 'Drilled plate: block + centred bore — the boolean that turns a blank '
        + 'into a manufacturable part — one asset call → one body.',
    prompt: 'model a mounting plate 120 by 80 by 14 mm with a 25 mm hole through the centre',
    expect: (st) => st.bodies >= 1,
  },
];
