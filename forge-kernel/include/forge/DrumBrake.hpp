// Forge-300 — Short-shoe block-on-drum brake (Shigley §16-3 / Norton §18.3).
//
// Companion to Forge-281 (disc brake). A short shoe (contact half-angle ≤ 15°)
// can be modelled as a single block pressing on the drum at one effective
// contact point. The lever pivots at one end; the operator applies force P at
// the far end (lever arm c); the block contacts the drum at distance a from
// the pivot; drum radius r; coefficient of friction μ.
//
// Taking moments about the pivot pin and summing horizontal/vertical
// reactions (Shigley Ex. 16-1 form):
//
//   Self-energizing case (drum rotation drags the block INTO the drum):
//       P·c = N·a − μ·N·r        ⇒   N = P·c / (a − μr)
//
//   De-energizing case (drum rotation drags the block AWAY from the drum):
//       P·c = N·a + μ·N·r        ⇒   N = P·c / (a + μr)
//
// In both cases friction = μN and braking torque T = μ·N·r.
//
// Self-locking condition: a − μr ≤ 0  →  brake grabs and cannot be released
// by reducing P. Standard design margin keeps μr/a ≤ 0.5 for the
// self-energizing geometry, i.e. amplification ratio capped near 2× the
// de-energizing torque.

#pragma once

namespace forge::drumbrake {

struct Input {
    double leverForceP_N;       // P at lever end
    double leverLength_c_m;     // pivot → applied force
    double contactArm_a_m;      // pivot → block contact (perpendicular)
    double drumRadius_r_m;      // r
    double friction_mu;         // μ between block and drum
    bool   selfEnergizing;      // true = drag-in rotation sense
};

struct Result {
    double normalForceN;        // N on drum from block
    double frictionForceN;      // μ·N
    double brakingTorqueNm;     // μ·N·r
    double mechanicalAdvantage; // T / (P·r) — dimensionless gain
    double selfLockingMargin;   // a − μr (negative → self-locked)
    bool   selfLocked;          // a − μr ≤ 0 in self-energizing mode
};

Result analyse(const Input& in);

}  // namespace forge::drumbrake
