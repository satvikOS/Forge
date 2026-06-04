// Forge-336a — Pipe network analysis (Hardy Cross method, Linsley §13.4).
//   Each loop: Σ H_f = 0,  H_f = r·Q^n   (Darcy-Weisbach n=2; Hazen-Williams n=1.852)
//   r = (8·f·L) / (π²·g·D⁵)            Darcy-Weisbach
//   Correction per loop: ΔQ = − Σ(r·Q·|Q|) / (n · Σ|r·Q^(n−1)|)
//   Iterate until max |ΔQ| < tolerance.

#pragma once

#include <vector>

namespace forge::pipenet {

struct Pipe {
    double length_m;
    double diameter_mm;
    double frictionFactor_f;       // Darcy
    double initialFlow_Lps;        // initial Q with sign (positive in CW loop direction)
    int    loopIndex;              // which loop this pipe belongs to (single-loop case index 0)
    int    loopSignCW;             // +1 if CW, −1 if CCW within the loop
};

struct Input {
    std::vector<Pipe> pipes;
    int    loopCount;
    double tolerance_Lps;          // convergence
    int    maxIterations;
};

struct Result {
    std::vector<double> finalFlows_Lps;        // signed
    std::vector<double> headLosses_m;          // |H_f|
    int    iterationsUsed;
    double maxCorrection_Lps;                  // last ΔQ max
    bool   converged;
};

Result analyse(const Input& in);

}  // namespace forge::pipenet
