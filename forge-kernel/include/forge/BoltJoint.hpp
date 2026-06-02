#pragma once

// Forge-214 — bolt joint preload + load-factor calculator.
//
// Industry-standard textbook equations (Shigley, VDI 2230):
//
//   Preload from torque:    F_i = T / (K · d)
//   Joint stiffness ratio:  C = k_b / (k_b + k_m)
//   Working bolt force:     F_b = F_i + C · F_ext
//   Margin of safety:       MS = (proof load) / F_b - 1
//
// where T is the applied tightening torque [N·m], K the nut factor
// (≈ 0.2 dry, ≈ 0.15 lubricated), d the nominal diameter [m], k_b
// and k_m the bolt + member axial stiffnesses [N/m], F_ext the
// external load on the joint [N], and proof load = σ_proof · A_t.

#include <string>

namespace forge { namespace boltjoint {

struct PreloadInputs {
    double torque;        // N·m
    double nutFactor;     // K, dimensionless
    double diameter;      // m
};

double computePreload(const PreloadInputs& in);

struct StiffnessInputs {
    double boltE;          // Pa
    double boltAt;         // m² (tensile area)
    double gripLength;     // m
    double memberE;        // Pa
    double memberArea;     // m²  (clamped frustum effective area)
};

struct StiffnessOutputs {
    double boltStiffness;     // N/m
    double memberStiffness;   // N/m
    double loadFactor;        // C, dimensionless
};

StiffnessOutputs jointStiffness(const StiffnessInputs& in);

struct CheckInputs {
    double preload;              // F_i, N
    double externalLoad;         // F_ext, N
    double loadFactor;           // C
    double tensileArea;          // A_t, m²
    double proofStrength;        // σ_proof, Pa
};

struct CheckOutputs {
    double workingBoltForce;     // F_b, N
    double workingStress;        // Pa
    double proofLoad;            // N
    double marginOfSafety;       // F_p/F_b − 1
    bool   adequate;             // MS > 0
};

CheckOutputs check(const CheckInputs& in);

// Tensile area per ISO 898/ASME B1.1 for the M-series codes covered
// by the standard (M3..M24). Diameter is the nominal d [m].
struct MetricBolt {
    double diameter;
    double tensileArea;
    double proofStrengthClass88;     // class 8.8 σ_proof, Pa
    double proofStrengthClass109;    // class 10.9 σ_proof, Pa
    double proofStrengthClass129;    // class 12.9 σ_proof, Pa
};

MetricBolt metricBolt(const std::string& mCode);

}} // namespace forge::boltjoint
