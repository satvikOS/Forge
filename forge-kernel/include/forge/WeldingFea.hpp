#pragma once

// Forge-174 — Welding distortion FEA (Goldak heat source + sequentially-
// coupled thermo-mechanical with J2 plasticity).
//
// Thermal pass:
//   * Explicit FTCS time-marching of ρ·cp·∂T/∂t = ∇·(k·∇T) + q_vol on a
//     linear-tet mesh. Mass-lumped capacity matrix.
//   * Moving Goldak double-ellipsoid heat source along a polyline path
//     at constant speed:
//
//       q_f(x,y,z,t) = 6√3·ff·P / (π√π·a·b·cf)
//                      × exp(−3(x²/cf² + y²/a² + z²/b²))
//       q_r similar with cr/fr.
//
//     Axes are oriented to the local path tangent; ff + fr = 2.
//
// Mechanical pass:
//   * Linear-tet small-strain elasto-plastic FEA solved quasi-statically
//     at each thermal snapshot.
//   * ε = ε_e + ε_p + ε_th,   ε_th = α·(T − T_ref)·I.
//   * J2 radial-return with linear isotropic hardening:
//
//       Δε_p_eq = √(3/2)·‖dev(σ_trial)‖ < σ_y(ε_p_eq + Δε_p_eq) → 0,
//       hardening modulus H = E·Et / (E − Et).
//
//   * Outputs: residual displacement (3N), per-element equivalent plastic
//     strain, per-element von Mises stress, per-node peak HAZ temperature.

#include <cstdint>
#include <vector>

namespace forge { namespace welding {

struct TetMesh {
    std::vector<double>   nodes;   // 3N, metres
    std::vector<uint32_t> tets;    // 4M
    std::vector<uint8_t>  fixedDof; // 3N — 1 = fixed, 0 = free
};

struct Material {
    double rho;       // kg/m³
    double cp;        // J/(kg·K)
    double k;         // W/(m·K)
    double alpha;     // 1/K thermal expansion
    double E;         // Pa Young's
    double nu;        // -  Poisson
    double sigmaY0;   // Pa initial yield
    double Etan;      // Pa tangent modulus (linear hardening)
    double Tref;      // K stress-free reference
};

struct GoldakSource {
    double power;       // W (η · V · I, e.g. 0.7 × 25 V × 200 A = 3500)
    double a, b;        // m, transverse + depth half-axes
    double cf, cr;      // m, forward + rear half-axes
    double ff, fr;      // power fractions (sum = 2)
    // Polyline path in node coordinates (m), Nseg+1 points.
    std::vector<double> pathXYZ;
    double speed;       // m/s
};

struct WeldResult {
    std::vector<double> displacement;     // 3N
    std::vector<double> plasticStrain;    // M (equivalent)
    std::vector<double> misesStressPa;    // M
    std::vector<double> peakHazTempK;     // N
    double maxDisplacementMm;
    double maxMisesPa;
    double maxTempK;
    int    snapshotsTaken;
    int    thermalStepsTaken;
};

WeldResult simulateWeld(const TetMesh& mesh,
                        const Material& mat,
                        const GoldakSource& src,
                        double totalTimeSec,
                        int    snapshotCount);

}} // namespace forge::welding
