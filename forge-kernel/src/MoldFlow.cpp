#include "forge/MoldFlow.hpp"

#include "forge/native/linalg/LinAlg.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <map>
#include <stdexcept>
#include <unordered_map>
#include <vector>

namespace la = forge::native::linalg;

namespace forge { namespace mold {

namespace {

inline double dot2(double ax, double ay, double bx, double by) {
    return ax * bx + ay * by;
}

inline double dist2(double ax, double ay, double bx, double by) {
    const double dx = bx - ax, dy = by - ay;
    return std::sqrt(dx * dx + dy * dy);
}

// Per-triangle centroid and area (XY plane).
struct TriProp {
    double cx, cy;
    double area;       // m²
    double thickness;  // m
};

// Edge key as ordered pair of vertex indices.
struct EdgeKey {
    uint32_t lo, hi;
    bool operator==(const EdgeKey& o) const { return lo == o.lo && hi == o.hi; }
};
struct EdgeKeyHash {
    std::size_t operator()(const EdgeKey& k) const noexcept {
        return std::hash<uint64_t>{}((uint64_t(k.lo) << 32) | k.hi);
    }
};
inline EdgeKey edgeKey(uint32_t a, uint32_t b) {
    return a < b ? EdgeKey{a, b} : EdgeKey{b, a};
}

// One half-edge entry: triangle id + opposing-vertex id for picking the
// shared-edge endpoints downstream.
struct HalfEdgeOwner {
    uint32_t tri;
};

// Cross-WLF viscosity. γ̇ in 1/s, T in K.
double viscosity(const CrossWLF& mat, double gammaDot, double T) {
    const double Tg = mat.Tg;
    const double denomWLF = mat.A2 + (T - Tg);
    if (denomWLF < 1.0) {
        // Avoid blowing up far below Tg; clamp.
        return 1.0e8;  // huge viscosity floor
    }
    const double eta0 = mat.D1 * std::exp(-mat.A1 * (T - Tg) / denomWLF);
    if (gammaDot < 1e-9) return eta0;
    const double x = eta0 * gammaDot / std::max(1.0, mat.tauStar);
    const double denom = 1.0 + std::pow(x, 1.0 - mat.n);
    return eta0 / denom;
}

} // anonymous namespace

FlowResult heleShawFill(const MeshShell& mesh,
                        const InjectionGate& gate,
                        const CrossWLF& mat,
                        double moldTempK,
                        double maxTimeSec,
                        int    maxSteps) {
    const std::size_t M = mesh.triangles.size() / 3;
    const std::size_t N = mesh.vertices.size() / 3;
    if (M < 4) throw std::invalid_argument("forge.mold: need ≥ 4 triangles");
    if (mesh.thickness.size() != M) {
        throw std::invalid_argument("forge.mold: thickness count must equal triangle count");
    }
    if (!(gate.flowRateM3s > 0)) {
        throw std::invalid_argument("forge.mold: flow rate must be > 0");
    }
    if (maxSteps < 10) maxSteps = 10;
    if (!(maxTimeSec > 0)) maxTimeSec = 60.0;

    // ----------------------------------- per-triangle properties + edge map
    std::vector<TriProp> tri(M);
    for (std::size_t t = 0; t < M; ++t) {
        const uint32_t i0 = mesh.triangles[3 * t + 0];
        const uint32_t i1 = mesh.triangles[3 * t + 1];
        const uint32_t i2 = mesh.triangles[3 * t + 2];
        if (i0 >= N || i1 >= N || i2 >= N) {
            throw std::invalid_argument("forge.mold: triangle index out of range");
        }
        const double x0 = mesh.vertices[3 * i0 + 0], y0 = mesh.vertices[3 * i0 + 1];
        const double x1 = mesh.vertices[3 * i1 + 0], y1 = mesh.vertices[3 * i1 + 1];
        const double x2 = mesh.vertices[3 * i2 + 0], y2 = mesh.vertices[3 * i2 + 1];
        tri[t].cx = (x0 + x1 + x2) / 3.0;
        tri[t].cy = (y0 + y1 + y2) / 3.0;
        tri[t].area = 0.5 * std::abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0));
        tri[t].thickness = mesh.thickness[t];
    }

    // Build edge → (triangle, vertex pair). Each interior edge has 2 tris.
    std::unordered_map<EdgeKey, std::vector<uint32_t>, EdgeKeyHash> edgeMap;
    edgeMap.reserve(M * 3);
    for (std::size_t t = 0; t < M; ++t) {
        const uint32_t a = mesh.triangles[3 * t + 0];
        const uint32_t b = mesh.triangles[3 * t + 1];
        const uint32_t c = mesh.triangles[3 * t + 2];
        for (auto pr : { std::pair{a, b}, std::pair{b, c}, std::pair{c, a} }) {
            edgeMap[edgeKey(pr.first, pr.second)].push_back(static_cast<uint32_t>(t));
        }
    }
    // Per-triangle adjacency: up to 3 neighbours + per-edge length.
    struct Neighbour { uint32_t nb; double edgeLen; double dCentroid; };
    std::vector<std::vector<Neighbour>> adj(M);
    for (auto& kv : edgeMap) {
        const auto& tris = kv.second;
        if (tris.size() != 2) continue;  // boundary edge
        const uint32_t ta = tris[0], tb = tris[1];
        const double x0 = mesh.vertices[3 * kv.first.lo + 0];
        const double y0 = mesh.vertices[3 * kv.first.lo + 1];
        const double x1 = mesh.vertices[3 * kv.first.hi + 0];
        const double y1 = mesh.vertices[3 * kv.first.hi + 1];
        const double L = dist2(x0, y0, x1, y1);
        const double dC = dist2(tri[ta].cx, tri[ta].cy, tri[tb].cx, tri[tb].cy);
        adj[ta].push_back({ tb, L, dC });
        adj[tb].push_back({ ta, L, dC });
    }

    // ----------------------------------- locate gate triangle (nearest centroid)
    uint32_t gateTri = 0;
    {
        double best = std::numeric_limits<double>::infinity();
        for (std::size_t t = 0; t < M; ++t) {
            const double d2 = (tri[t].cx - gate.x) * (tri[t].cx - gate.x)
                            + (tri[t].cy - gate.y) * (tri[t].cy - gate.y);
            if (d2 < best) { best = d2; gateTri = static_cast<uint32_t>(t); }
        }
    }

    // ----------------------------------- fields
    std::vector<double>  f(M, 0.0);     // fill fraction
    std::vector<double>  fillTime(M, -1.0);
    std::vector<double>  peakP(M, 0.0);
    std::vector<double>  T(M, gate.meltTempK); // isothermal in this slice
    // Start at zero-shear viscosity η₀(T_melt) — D1 is just the WLF
    // reference at Tg, not the actual fluid viscosity at the melt
    // temperature. Without this the first time step picks a dt that
    // saturates the entire maxTime budget and the run stalls at step 0.
    std::vector<double>  eta(M, viscosity(mat, 0.0, gate.meltTempK));
    std::vector<uint8_t> weld(M, 0);
    std::vector<uint32_t> weldList;
    f[gateTri] = 1.0;   // gate cell starts filled
    fillTime[gateTri] = 0.0;

    const double totalCavityVol = [&]() {
        double v = 0;
        for (std::size_t t = 0; t < M; ++t) v += tri[t].area * tri[t].thickness;
        return v;
    }();

    // ----------------------------------- time march
    double simT = 0.0;
    int step = 0;
    bool fullyFilled = false;
    int filledCount = 1;
    double maxP = 0.0;

    for (; step < maxSteps && !fullyFilled; ++step) {
        // 1. Identify filled (f == 1) and active (0 < f < 1) cells.
        std::vector<uint32_t> filled, partial;
        filled.reserve(M); partial.reserve(M);
        for (std::size_t t = 0; t < M; ++t) {
            if (f[t] >= 1.0)        filled.push_back(static_cast<uint32_t>(t));
            else if (f[t] > 1.0e-6) partial.push_back(static_cast<uint32_t>(t));
        }
        if (filled.empty()) break;

        // 2. Assemble FV system on filled cells only.
        //    For each filled cell, sum K_{t,t'}(P_t − P_t') = source_t.
        //    Boundary (cells adjacent to partial / empty) clamp via Dirichlet
        //    on the partial neighbour at P = 0.
        std::map<uint32_t, int> idxOf;
        for (std::size_t i = 0; i < filled.size(); ++i)
            idxOf[filled[i]] = static_cast<int>(i);

        const int nUnknowns = static_cast<int>(filled.size());
        la::SparseCSR<double> A(nUnknowns, nUnknowns);
        std::vector<double>   b(nUnknowns, 0.0);
        std::vector<la::Triplet<double>> trips;
        trips.reserve(nUnknowns * 4);

        // Compute conductance K from face geometry + per-cell S = h³/(12·η).
        auto cellS = [&](uint32_t t) {
            const double h = tri[t].thickness;
            return (h * h * h) / (12.0 * std::max(1e-3, eta[t]));
        };

        for (int row = 0; row < nUnknowns; ++row) {
            const uint32_t t = filled[row];
            double diag = 0.0;
            for (const auto& n : adj[t]) {
                const double S_t = cellS(t);
                const double S_n = cellS(n.nb);
                const double S_h = (S_t * S_n) > 0
                                   ? 2.0 * S_t * S_n / (S_t + S_n)
                                   : 0.0;
                const double K = S_h * n.edgeLen / std::max(1e-9, n.dCentroid);
                if (f[n.nb] >= 1.0) {
                    // Interior neighbour — unknown P.
                    const int col = idxOf[n.nb];
                    trips.emplace_back(row, col, -K);
                    diag += K;
                } else {
                    // Partial / empty neighbour clamped at P = 0 (front).
                    diag += K;
                    // No b-contribution since P_neighbour = 0.
                }
            }
            // Stabilisation: if a cell has no adjacency with f<1 around it
            // (deep interior), there is no driving boundary, so diag may
            // be zero from only filled neighbours. Add ε to avoid singular.
            trips.emplace_back(row, row, diag + 1.0e-12);
            // Source: at the gate cell only, inject flowRate.
            if (t == gateTri) {
                b[row] = gate.flowRateM3s;
            }
        }
        A.setFromTriplets(nUnknowns, nUnknowns, trips);

        la::SparseLU solver;
        solver.compute(A);
        if (!solver.ok()) break;
        std::vector<double> P = solver.solve(b);
        if (!solver.ok()) break;
        // Update peak pressures + maxP.
        for (int row = 0; row < nUnknowns; ++row) {
            const uint32_t t = filled[row];
            if (P[row] > peakP[t]) peakP[t] = P[row];
            if (P[row] > maxP) maxP = P[row];
        }

        // 3. Edge fluxes — Q from filled to partial/empty neighbours.
        std::vector<double> influxToPartial(M, 0.0);
        // Map of cell → set of upstream cell ids (for weld-line detection).
        std::vector<int> upstream(M, -1);
        for (int row = 0; row < nUnknowns; ++row) {
            const uint32_t t = filled[row];
            for (const auto& n : adj[t]) {
                if (f[n.nb] >= 1.0) continue;
                const double S_t = cellS(t);
                const double S_n = cellS(n.nb);
                const double S_h = (S_t * S_n) > 0
                                   ? 2.0 * S_t * S_n / (S_t + S_n)
                                   : 0.0;
                const double K = S_h * n.edgeLen / std::max(1e-9, n.dCentroid);
                // Pressure drop drives flux Q (m³/s) from t into n.nb.
                const double Q = K * P[row];
                if (Q > 0) {
                    influxToPartial[n.nb] += Q;
                    if (upstream[n.nb] == -1) upstream[n.nb] = static_cast<int>(t);
                    else if (upstream[n.nb] != static_cast<int>(t) && !weld[n.nb]) {
                        weld[n.nb] = 1;
                        weldList.push_back(n.nb);
                    }
                }
            }
        }

        // 4. Choose dt so the most-saturated downstream cell crosses to
        //    f = 1 this step. Loop over ALL cells receiving influx
        //    (empty + partial alike) — the first iteration only has
        //    empty neighbours of the gate, no `partial` cells yet.
        double dtCandidate = std::numeric_limits<double>::infinity();
        for (std::size_t t = 0; t < M; ++t) {
            if (influxToPartial[t] <= 0) continue;
            if (f[t] >= 1.0) continue;  // already full (shouldn't happen but safe)
            const double remain = 1.0 - f[t];
            if (remain < 1e-9) continue;
            const double Vol = tri[t].area * tri[t].thickness;
            const double dtT = remain * Vol / influxToPartial[t];
            if (dtT < dtCandidate) dtCandidate = dtT;
        }
        if (!std::isfinite(dtCandidate) || dtCandidate <= 0) break;
        const double dt = std::min(dtCandidate, maxTimeSec - simT);
        if (dt <= 0) break;

        // 5. Advance fill.
        int newlyFilled = 0;
        for (std::size_t t = 0; t < M; ++t) {
            if (influxToPartial[t] <= 0) continue;
            const double Vol = tri[t].area * tri[t].thickness;
            const double df = dt * influxToPartial[t] / Vol;
            const double prevF = f[t];
            f[t] = std::min(1.0, f[t] + df);
            if (f[t] >= 1.0 && fillTime[t] < 0) {
                fillTime[t] = simT + dt;
                ++newlyFilled;
                ++filledCount;
            }
            if (prevF < 1.0 && f[t] >= 1.0) {
                // record peak pressure carried over from upstream.
                if (upstream[t] >= 0) peakP[t] = std::max(peakP[t], peakP[upstream[t]]);
            }
        }
        simT += dt;

        // 6. Update viscosity from new pressure gradients.
        for (std::size_t t = 0; t < M; ++t) {
            // approximate γ̇ from |∇P| × h / (2η). |∇P| ≈ |ΔP|_max over neighbours / d_centroid.
            double gradPmax = 0.0;
            for (const auto& n : adj[t]) {
                const double Pn = (idxOf.count(n.nb) ? P[idxOf[n.nb]] : 0.0);
                const double Pt = (idxOf.count(t)    ? P[idxOf[t]]    : 0.0);
                const double g = std::abs(Pt - Pn) / std::max(1e-9, n.dCentroid);
                if (g > gradPmax) gradPmax = g;
            }
            const double gammaDot = gradPmax * tri[t].thickness / (2.0 * std::max(1.0, eta[t]));
            eta[t] = viscosity(mat, gammaDot, T[t]);
        }

        // 7. Termination.
        if (filledCount >= static_cast<int>(M)) { fullyFilled = true; break; }
        if (newlyFilled == 0) {
            // Nothing advanced — geometry stalled, exit.
            break;
        }
        if (simT >= maxTimeSec) break;
    }

    // ----------------------------------- detect air traps
    std::vector<uint32_t> airTrap;
    for (std::size_t t = 0; t < M; ++t) {
        if (f[t] >= 0.99) continue;
        bool surrounded = true;
        for (const auto& n : adj[t]) {
            if (f[n.nb] < 0.99) { surrounded = false; break; }
        }
        if (surrounded && !adj[t].empty()) airTrap.push_back(static_cast<uint32_t>(t));
    }

    FlowResult R;
    R.fillTimeSec      = std::move(fillTime);
    R.peakPressurePa   = std::move(peakP);
    R.filledFraction   = std::move(f);
    R.weldLineTriangles= std::move(weldList);
    R.airTrapTriangles = std::move(airTrap);
    R.totalFillTimeSec = simT;
    R.maxPressurePa    = maxP;
    R.stepsTaken       = step;
    R.converged        = fullyFilled;
    (void)totalCavityVol;
    return R;
}

}} // namespace forge::mold
