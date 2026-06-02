#pragma once

// Forge-218 — Heat exchanger LMTD sizing.
//
// Counter-flow or parallel-flow log-mean temperature difference, plus
// required heat-transfer area and effectiveness-NTU calculations.
//
//   Counter-flow:
//     ΔT₁ = Th_in − Tc_out,  ΔT₂ = Th_out − Tc_in
//   Parallel-flow:
//     ΔT₁ = Th_in − Tc_in,   ΔT₂ = Th_out − Tc_out
//
//   LMTD = (ΔT₁ − ΔT₂) / ln(ΔT₁ / ΔT₂)        (else ΔT₁ when equal)
//   Q    = U · A · LMTD · F
//   ε-NTU (counter):    ε = (1 − exp(−NTU(1 − Cr))) / (1 − Cr·exp(−NTU(1 − Cr)))
//   ε-NTU (parallel):   ε = (1 − exp(−NTU(1 + Cr))) / (1 + Cr)
//   ε-NTU (Cr → 0, condenser/boiler): ε = 1 − exp(−NTU)

#include <string>

namespace forge { namespace hxc {

enum class Flow { CounterFlow, ParallelFlow };

Flow flowFromString(const std::string& name);

struct LmtdInputs {
    double thIn, thOut, tcIn, tcOut;
    Flow   flow;
};

struct LmtdOutputs {
    double dT1;
    double dT2;
    double lmtd;
};

LmtdOutputs lmtd(const LmtdInputs& in);

struct AreaInputs {
    double Q;          // duty, W
    double U;          // overall U, W/(m²·K)
    double lmtd;       // K
    double F;          // correction factor; 1.0 if pure counter/parallel
};

double requiredArea(const AreaInputs& in);

struct NtuInputs {
    double UA;         // W/K
    double cMin;       // W/K
    double cMax;       // W/K
    Flow   flow;
};

double effectiveness(const NtuInputs& in);

}} // namespace forge::hxc
