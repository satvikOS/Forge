// Curated Forge demo recipes (Monday investor demo, task #61).
//
// Architecture (locked): Archie's BRAIN produces the engineering spec —
// exact dimensions, measurements, SIMULATION PLANNING — and drives the
// real CAD app via human-like tool interactions; each stage is visually
// verified before proceeding (zero on-stage mistakes). Mapped to flows
// the Forge native OCCT kernel + promoted adapter execute reliably.
//
// Each stage: { prompt, expect(state)->bool, shot, sim? }. `state` =
// { bodies, lastSim, hasDrawing } snapshot. Bars are minimums.

export const FORGE_RECIPES = [
  {
    id: 'tape-measure-parametric',
    title: 'Exact part → "10× bigger" parametric cascade (V-358 tape measure)',
    ref: 'V-358',
    plan: 'Spec the housing as an exact dimensioned part (named vars: '
        + 'len/width/thick), build it natively, then drive ONE master-scale '
        + 'edit so every dimension cascades 10× — no re-model, no spawn. '
        + 'Measure to confirm exact dims.',
    stages: [
      { prompt: 'model a tape-measure housing: 70 mm wide, 65 mm tall, 35 mm deep', expect: (st) => st.bodies >= 1, shot: 'part-exact' },
      { prompt: 'scale the whole part 10× bigger', expect: (st) => st.bodies >= 1, shot: 'part-10x' },
    ],
  },
  {
    id: 'm8-bolt-sim',
    title: 'M8 hex bolt + Linear Static under 5 kN (engineering + sim)',
    ref: 'DoD-2 / V-656 mechanical',
    plan: 'M8×1.25 hex bolt to spec; SIMULATION PLAN: Linear Static, 5 kN '
        + 'axial tension, fixed head bearing face, report peak von Mises vs '
        + 'the 640 MPa proof stress of class-8.8 — flag if over yield.',
    stages: [
      { prompt: 'model an M8 hex bolt, 1.25 mm pitch, 30 mm shank', expect: (st) => st.bodies >= 1, shot: 'bolt' },
      { prompt: 'run a Linear Static analysis under 5 kN axial tension and report peak von Mises stress', expect: (st) => !!st.lastSim, shot: 'bolt-sim', sim: true },
    ],
  },
  {
    id: 'bracket-assembly',
    title: 'L-bracket + bolted joint (assembly + mates)',
    ref: 'V-656 assembly tree',
    plan: 'Build an L-bracket and a bolt, mate the bolt into the hole '
        + '(coaxial + coincident), so the assembly tree reads as real '
        + 'constraints — not stacked bodies.',
    stages: [
      { prompt: 'model an L-bracket 60×40×5 mm with two 8 mm holes', expect: (st) => st.bodies >= 1, shot: 'bracket' },
    ],
  },
];
