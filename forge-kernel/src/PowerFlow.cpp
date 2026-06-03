// Forge-250 — Newton-Raphson AC power flow implementation.

#include "forge/PowerFlow.hpp"

#include <Eigen/Dense>
#include <cmath>
#include <complex>
#include <limits>
#include <numbers>
#include <stdexcept>

namespace forge::powerflow {

namespace {
constexpr double pi = std::numbers::pi;
using cd = std::complex<double>;
}  // namespace

Result solve(const std::vector<Bus>& buses,
             const std::vector<Branch>& branches,
             const Settings& s) {
    const int N = static_cast<int>(buses.size());
    if (N < 2) throw std::invalid_argument("need at least 2 buses");
    int slackCount = 0;
    for (const auto& b : buses) if (b.kind == BusKind::Slack) ++slackCount;
    if (slackCount != 1) throw std::invalid_argument("exactly one slack bus required");
    if (s.tolerance <= 0.0) throw std::invalid_argument("tolerance must be positive");
    if (s.maxIterations <= 0) throw std::invalid_argument("maxIterations must be positive");

    // Build Y_bus.
    Eigen::MatrixXcd Y = Eigen::MatrixXcd::Zero(N, N);
    for (const auto& br : branches) {
        if (br.from == br.to) continue;
        if (br.from < 0 || br.to < 0 || br.from >= N || br.to >= N)
            throw std::invalid_argument("branch index out of range");
        const cd z(br.R, br.X);
        if (std::abs(z) < 1e-18) throw std::invalid_argument("branch Z must be nonzero");
        const cd y = 1.0 / z;
        Y(br.from, br.to) -= y;
        Y(br.to, br.from) -= y;
        Y(br.from, br.from) += y + cd(0, br.halfB);
        Y(br.to,   br.to)   += y + cd(0, br.halfB);
    }

    // Initial state vectors.
    Eigen::VectorXd V(N), theta(N);
    std::vector<int> slack_idx;
    std::vector<int> pv_idx;
    std::vector<int> pq_idx;
    for (int i = 0; i < N; ++i) {
        V(i) = buses[i].V_init;
        theta(i) = buses[i].angleDegInit * pi / 180.0;
        if      (buses[i].kind == BusKind::Slack) slack_idx.push_back(i);
        else if (buses[i].kind == BusKind::PV)    pv_idx.push_back(i);
        else                                       pq_idx.push_back(i);
    }

    // P/Q specified vectors (for non-slack).
    auto computePQ = [&](Eigen::VectorXd& P, Eigen::VectorXd& Q) {
        for (int i = 0; i < N; ++i) {
            double Pi = 0.0, Qi = 0.0;
            for (int k = 0; k < N; ++k) {
                const double G = Y(i, k).real();
                const double B = Y(i, k).imag();
                const double th = theta(i) - theta(k);
                Pi += V(i) * V(k) * (G * std::cos(th) + B * std::sin(th));
                Qi += V(i) * V(k) * (G * std::sin(th) - B * std::cos(th));
            }
            P(i) = Pi;
            Q(i) = Qi;
        }
    };

    Result r{};
    r.converged = false;
    r.finalMaxMismatch = std::numeric_limits<double>::infinity();

    // Variable ordering: [θ_i for i ∉ slack], then [V_i for i ∈ PQ].
    const int N_theta = N - 1;           // exclude slack
    const int N_v = static_cast<int>(pq_idx.size());
    const int dim = N_theta + N_v;

    std::vector<int> theta_idx;
    for (int i = 0; i < N; ++i) if (buses[i].kind != BusKind::Slack)
        theta_idx.push_back(i);

    for (int iter = 0; iter < s.maxIterations; ++iter) {
        Eigen::VectorXd P_calc(N), Q_calc(N);
        computePQ(P_calc, Q_calc);

        // Mismatch.
        Eigen::VectorXd mismatch = Eigen::VectorXd::Zero(dim);
        for (int j = 0; j < N_theta; ++j) {
            const int i = theta_idx[j];
            mismatch(j) = buses[i].P_specified - P_calc(i);
        }
        for (int j = 0; j < N_v; ++j) {
            const int i = pq_idx[j];
            mismatch(N_theta + j) = buses[i].Q_specified - Q_calc(i);
        }

        r.finalMaxMismatch = mismatch.cwiseAbs().maxCoeff();
        if (r.finalMaxMismatch < s.tolerance) {
            r.converged = true;
            r.iterations = iter;
            break;
        }

        // Build Jacobian.
        Eigen::MatrixXd J = Eigen::MatrixXd::Zero(dim, dim);
        // dP/dθ block (N_theta × N_theta).
        for (int a = 0; a < N_theta; ++a) {
            const int i = theta_idx[a];
            for (int b = 0; b < N_theta; ++b) {
                const int k = theta_idx[b];
                const double G = Y(i, k).real();
                const double B = Y(i, k).imag();
                if (i == k) {
                    J(a, b) = -Q_calc(i) - V(i) * V(i) * B;
                } else {
                    const double th = theta(i) - theta(k);
                    J(a, b) = V(i) * V(k) * (G * std::sin(th) - B * std::cos(th));
                }
            }
        }
        // dP/dV block (N_theta × N_v).
        for (int a = 0; a < N_theta; ++a) {
            const int i = theta_idx[a];
            for (int b = 0; b < N_v; ++b) {
                const int k = pq_idx[b];
                const double G = Y(i, k).real();
                const double B = Y(i, k).imag();
                if (i == k) {
                    J(a, N_theta + b) = P_calc(i) / V(i) + V(i) * G;
                } else {
                    const double th = theta(i) - theta(k);
                    J(a, N_theta + b) = V(i) * (G * std::cos(th) + B * std::sin(th));
                }
            }
        }
        // dQ/dθ block (N_v × N_theta).
        for (int a = 0; a < N_v; ++a) {
            const int i = pq_idx[a];
            for (int b = 0; b < N_theta; ++b) {
                const int k = theta_idx[b];
                const double G = Y(i, k).real();
                const double B = Y(i, k).imag();
                if (i == k) {
                    J(N_theta + a, b) = P_calc(i) - V(i) * V(i) * G;
                } else {
                    const double th = theta(i) - theta(k);
                    J(N_theta + a, b) = -V(i) * V(k) * (G * std::cos(th) + B * std::sin(th));
                }
            }
        }
        // dQ/dV block (N_v × N_v).
        for (int a = 0; a < N_v; ++a) {
            const int i = pq_idx[a];
            for (int b = 0; b < N_v; ++b) {
                const int k = pq_idx[b];
                const double G = Y(i, k).real();
                const double B = Y(i, k).imag();
                if (i == k) {
                    J(N_theta + a, N_theta + b) = Q_calc(i) / V(i) - V(i) * B;
                } else {
                    const double th = theta(i) - theta(k);
                    J(N_theta + a, N_theta + b) =
                        V(i) * (G * std::sin(th) - B * std::cos(th));
                }
            }
        }

        // Solve J · Δx = mismatch.
        Eigen::VectorXd delta = J.fullPivLu().solve(mismatch);

        // Apply updates.
        for (int j = 0; j < N_theta; ++j) {
            theta(theta_idx[j]) += delta(j);
        }
        for (int j = 0; j < N_v; ++j) {
            V(pq_idx[j]) += delta(N_theta + j);
        }

        r.iterations = iter + 1;
    }

    // Compute final P/Q and pack results.
    Eigen::VectorXd P_final(N), Q_final(N);
    computePQ(P_final, Q_final);
    r.buses.resize(N);
    for (int i = 0; i < N; ++i) {
        r.buses[i].V = V(i);
        r.buses[i].angleDeg = theta(i) * 180.0 / pi;
        r.buses[i].P = P_final(i);
        r.buses[i].Q = Q_final(i);
    }
    return r;
}

}  // namespace forge::powerflow
