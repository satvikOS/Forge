// Forge-247 — Symmetrical components (Stevenson / Grainger).
//
// a = e^(j2π/3) = 1∠120°. Fortescue transform between phase
// quantities (a, b, c) and sequence components (0, +, −):
//
//   [V_0]   1   [1   1     1  ] [V_a]
//   [V_+] = − · [1   a    a²] [V_b]
//   [V_−]   3   [1   a²   a ] [V_c]
//
//   [V_a]   [1   1     1 ] [V_0]
//   [V_b] = [1   a²   a ] [V_+]
//   [V_c]   [1   a    a²] [V_−]
//
// Fault sequence impedance reductions at fault point (per-unit or Ω):
//
//   3-phase:  I_a = V/Z_+
//   LG (a-g): I_a = 3·V / (Z_+ + Z_- + Z_0)
//   LL (b-c): I_a fault = √3 · V / (Z_+ + Z_-)
//   LLG (b-c-g): more complex parallel combination at the fault.

#pragma once

namespace forge::symcomp {

struct PhasorPolar {
    double magnitude;
    double angleDeg;
};

struct PhasorRect {
    double re;
    double im;
};

struct DecomposeInput {
    PhasorPolar Va;
    PhasorPolar Vb;
    PhasorPolar Vc;
};

struct DecomposeResult {
    PhasorPolar zero;
    PhasorPolar positive;
    PhasorPolar negative;
};

DecomposeResult decompose(const DecomposeInput& in);
DecomposeInput  compose(const DecomposeResult& seq);

struct FaultInput {
    double prefaultPhaseVoltage;   // |V_th| or rated phase voltage
    double Z0_magnitude;           // |Z_0|
    double Z0_angleDeg;
    double Z1_magnitude;
    double Z1_angleDeg;
    double Z2_magnitude;
    double Z2_angleDeg;
};

struct FaultResult {
    double threePhaseFaultI;       // |I_3φ|
    double lineToGroundFaultI;     // |I_LG|
    double lineToLineFaultI;       // |I_LL|
};

FaultResult faultCurrents(const FaultInput& in);

}  // namespace forge::symcomp
