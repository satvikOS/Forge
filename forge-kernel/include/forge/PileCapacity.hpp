// Forge-241 — Static axial pile capacity.
//
// Layered ground, single circular pile, drained or undrained skin
// friction by layer:
//
//   Clay (undrained, α-method, Tomlinson):
//     f_s = α · c_u                  (α ∈ [0, 1])
//
//   Sand (drained, β-method, Burland):
//     f_s = β · σ'_v_mid             (σ'_v at mid-depth of layer)
//     β   = K_0 · tanδ ≈ (1 − sinφ) · tanφ   if user passes β = 0
//
//   Layer perimeter contact: A_s = π·d·t_layer
//
// End bearing at pile tip:
//   Clay:  q_p = 9 · c_u            (Skempton)
//   Sand:  q_p = N_q · σ'_v(tip)    capped at q_p_limit
//
// Ultimate Q_ult = Σ f_s·A_s + q_p · A_p; allowable Q_a = Q_ult / FS.

#pragma once
#include <vector>

namespace forge::pilecap {

enum class SoilType { Clay, Sand };

struct Layer {
    SoilType type;
    double thicknessM;           // t
    double effectiveUnitWeightNPerM3;   // γ' (for σ'_v build-up)
    double undrainedShearStrengthPa;    // c_u (clay)
    double alpha;                       // α (clay; pass 0 for default)
    double frictionAngleDeg;            // φ (sand)
    double beta;                        // β (sand; pass 0 → derive from φ)
};

struct Input {
    double diameterM;            // d
    std::vector<Layer> layers;   // top→bottom (tip is in last layer)
    double waterTableDepthM;     // depth below grade where water table is (≤ 0 means none)
    double factorOfSafety;       // FS
    double Nq_tip;               // user-supplied Meyerhof N_q at tip (sand)
    double limitTipBearingPa;    // cap on q_p for sand (e.g. 11000 kPa Meyerhof)
};

struct LayerResult {
    double topDepthM;
    double bottomDepthM;
    double effectiveStressAtMidPa;
    double skinFrictionPa;       // f_s
    double skinForceN;           // f_s · π·d·t
};

struct Result {
    std::vector<LayerResult> layers;
    double effectiveStressAtTipPa;
    double tipBearingPa;         // q_p
    double tipForceN;            // q_p · A_p
    double shaftForceN;          // Σ skinForceN
    double ultimateCapacityN;    // Q_ult
    double allowableCapacityN;   // Q_a
};

Result analyse(const Input& in);

}  // namespace forge::pilecap
