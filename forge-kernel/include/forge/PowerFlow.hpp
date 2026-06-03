// Forge-250 — Newton-Raphson AC power flow (Stevenson Ch. 9 / Glover Ch. 6).
//
// Bus types:
//   Slack (V, θ fixed)        — exactly one
//   PV    (P, |V| specified)  — voltage-controlled
//   PQ    (P, Q specified)    — load
//
// Y_bus assembled from branch list (from, to, R+jX series, B/2 shunt at
// each end). Diagonal Y_ii = Σ y_series + shunt; off-diagonal = −y_series.
//
// Polar-form Newton-Raphson:
//   P_i = Σ |V_i||V_k|·(G_ik cosθ_ik + B_ik sinθ_ik)
//   Q_i = Σ |V_i||V_k|·(G_ik sinθ_ik − B_ik cosθ_ik)
//   Δ[P; Q] = J · Δ[θ; |V|]
//   J = [[dP/dθ, dP/dV], [dQ/dθ, dQ/dV]]
//
// We expose: solveFlow → final |V|, ∠V, and slack-bus P, Q.

#pragma once
#include <vector>

namespace forge::powerflow {

enum class BusKind { Slack, PV, PQ };

struct Bus {
    BusKind kind;
    double V_init;       // initial voltage magnitude (pu)
    double angleDegInit; // initial angle (deg); slack: fixed
    double P_specified;  // P at bus (gen - load) for PV/PQ (slack ignored)
    double Q_specified;  // Q at bus for PQ (PV ignored)
};

struct Branch {
    int from;          // 0-indexed bus
    int to;
    double R;          // series resistance (pu)
    double X;          // series reactance (pu)
    double halfB;      // half-line shunt susceptance at each end (pu)
};

struct Settings {
    double tolerance;  // |mismatch| in pu (default 1e-6)
    int    maxIterations;  // default 30
};

struct BusResult {
    double V;          // final |V|
    double angleDeg;   // final ∠V
    double P;          // injected real power (pu)
    double Q;          // injected reactive power (pu)
};

struct Result {
    std::vector<BusResult> buses;
    int iterations;
    double finalMaxMismatch;
    bool   converged;
};

Result solve(const std::vector<Bus>& buses,
             const std::vector<Branch>& branches,
             const Settings& s);

}  // namespace forge::powerflow
