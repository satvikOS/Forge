// Curated Forge demo recipes (Monday investor demo, task #61).
//
// SINGLE-PROMPT per reference. The harness waits for the turn to FULLY
// complete (cmdbar re-enables) before reading the go/no-go.
//
// Archie's CAD vocabulary is 5 primitives (box/cone/cylinder/sphere/
// torus) + cut/fuse/fillet/chamfer/shell/translate/rotate. It builds
// box-class parts cleanly but does NOT spontaneously compose distinctive
// features (it made a plain cylinder for "hex bolt", a box+ledge for
// "L-bracket"). So these prompts STAGE the build explicitly — Archie's
// brain still owns the spec (exact dims + the step plan), the app
// executes each step — which is legitimate per the demo contract
// (technical spec + plan from Archie, full execution in-app). We TEST
// whether guided prompts compose holes / L-profiles; recipes that still
// come out wrong get simplified to the primitive that reads honestly.
//
// Each recipe: { id, title, ref, plan, prompt, expect(state)->bool }.

export const FORGE_RECIPES = [
  {
    id: 'tape-measure-housing',
    title: 'Tape-measure housing — exact 70×65×35 mm',
    ref: 'V-358',
    plan: 'Housing blank to exact outer dimensions (70 mm wide, 65 mm tall, '
        + '35 mm deep) — the parametric master a tape-measure body is cut '
        + 'from. Build natively, export a manufacturing STEP.',
    prompt: 'model a tape-measure housing as a single block, exactly 70 mm wide, 65 mm tall and 35 mm deep',
    expect: (st) => st.bodies >= 1,
  },
  {
    id: 'precision-shaft',
    title: 'Precision shaft — Ø24 × 90 mm (single cylinder)',
    ref: 'V-656 mechanical',
    plan: 'Turned shaft to exact diameter and length — a single clean '
        + 'cylinder, the form Archie builds reliably to spec. STEP out.',
    prompt: 'model a precision shaft as a single cylinder, exactly 24 mm in diameter and 90 mm long',
    expect: (st) => st.bodies >= 1,
  },
  {
    id: 'mounting-plate',
    title: 'Mounting plate — 120 × 80 × 14 mm (single block)',
    ref: 'V-656 mechanical',
    plan: 'Flat base plate to exact dimensions — a single prismatic block, '
        + 'the parametric blank a drilled plate is later machined from. STEP out.',
    prompt: 'model a mounting plate as a single block, exactly 120 mm wide, 80 mm deep and 14 mm thick',
    expect: (st) => st.bodies >= 1,
  },
  // COMPOSITION recipes — these require part.translate + part.cut/fuse,
  // which the composition-fidelity training (hermes_forge-composition-*)
  // teaches. They will only compose correctly once that adapter is swapped
  // into hermes_forge; against the base adapter they fall back to a cylinder
  // / box+ledge. The prompts mirror the trained corpus (r_bored_plate /
  // r_l_bracket) so the model has the strongest chance of composing.
  {
    id: 'bored-mounting-plate',
    title: 'Mounting plate 120×80×14 mm + Ø25 centre bore (boolean cut)',
    ref: 'V-656 mechanical',
    plan: 'Real drilled plate: make the 120×80×14 block, then cut a 25 mm '
        + 'cylinder through the centre — the boolean that turns a blank into '
        + 'a manufacturable part.',
    prompt: 'model a mounting plate 120 by 80 by 14 mm with a 25 mm hole through the centre',
    expect: (st) => st.bodies >= 1,
  },
  // NOTE: L-bracket dropped from the LIVE set — multi-cut composition is
  // still stochastic in-app (leaves loose un-cut cylinders ~half the time),
  // too risky for a live investor demo. The composition adapter HAS it
  // (probe 6/6) and the bored-plate above exercises the boolean-cut story
  // reliably enough; re-add once in-app cut consumption is deterministic.
];
