#include "forge/Circuit.hpp"

#include <Eigen/Dense>

#include <complex>
#include <stdexcept>

namespace forge { namespace circuit {

namespace {

// Count the number of independent voltage sources in the component list.
int countVSources(const std::vector<Component>& comps) {
    int n = 0;
    for (const auto& c : comps) if (c.kind == Kind::VoltageSource) ++n;
    return n;
}

// Generic MNA build for a complex admittance Y(ω). The branches that
// contribute purely conductive admittance (R, C, L) drop into the upper
// N×N block; voltage sources span an extra M rows/cols.
//
// The system is (N+M) × (N+M):
//   [G   B] [V] = [I]
//   [Bᵀ  0] [Iv]  [Vs]
//
// where N excludes ground (so the indexing of the matrix starts at the
// first non-ground node).
template <typename Scalar>
void buildMNA(const DCInputs& in,
              Eigen::Matrix<Scalar, Eigen::Dynamic, Eigen::Dynamic>& A,
              Eigen::Matrix<Scalar, Eigen::Dynamic, 1>& rhs,
              double omega,
              bool isAC) {
    if (in.nodeCount < 1) {
        throw std::invalid_argument("forge.circuit: nodeCount must be ≥ 1");
    }
    const int N = static_cast<int>(in.nodeCount) - 1;   // non-ground node count
    const int M = countVSources(in.comps);
    if (N < 1) throw std::invalid_argument("forge.circuit: need at least 1 non-ground node");
    A = Eigen::Matrix<Scalar, Eigen::Dynamic, Eigen::Dynamic>::Zero(N + M, N + M);
    rhs = Eigen::Matrix<Scalar, Eigen::Dynamic, 1>::Zero(N + M);

    int vIdx = 0;
    for (const auto& c : in.comps) {
        const std::uint32_t a = c.nA;
        const std::uint32_t b = c.nB;
        switch (c.kind) {
            case Kind::Resistor: {
                if (c.value <= 0) throw std::invalid_argument("forge.circuit: R must be > 0");
                const Scalar Y = Scalar(1.0 / c.value);
                if (a != 0) A(a - 1, a - 1) += Y;
                if (b != 0) A(b - 1, b - 1) += Y;
                if (a != 0 && b != 0) {
                    A(a - 1, b - 1) -= Y;
                    A(b - 1, a - 1) -= Y;
                }
                break;
            }
            case Kind::Capacitor: {
                if (c.value <= 0) throw std::invalid_argument("forge.circuit: C must be > 0");
                if constexpr (std::is_same_v<Scalar, std::complex<double>>) {
                    // Y = jωC
                    const Scalar Y = std::complex<double>(0.0, omega * c.value);
                    if (a != 0) A(a - 1, a - 1) += Y;
                    if (b != 0) A(b - 1, b - 1) += Y;
                    if (a != 0 && b != 0) {
                        A(a - 1, b - 1) -= Y;
                        A(b - 1, a - 1) -= Y;
                    }
                } else if (isAC) {
                    // Real DC analysis: capacitor is open circuit (Y = 0)
                    (void)0;
                } else {
                    // DC: open circuit
                    (void)0;
                }
                break;
            }
            case Kind::Inductor: {
                if (c.value <= 0) throw std::invalid_argument("forge.circuit: L must be > 0");
                if constexpr (std::is_same_v<Scalar, std::complex<double>>) {
                    // Y = 1/(jωL) = -j/(ωL)
                    const double inv = 1.0 / (omega * c.value);
                    const Scalar Y = std::complex<double>(0.0, -inv);
                    if (a != 0) A(a - 1, a - 1) += Y;
                    if (b != 0) A(b - 1, b - 1) += Y;
                    if (a != 0 && b != 0) {
                        A(a - 1, b - 1) -= Y;
                        A(b - 1, a - 1) -= Y;
                    }
                } else {
                    // DC: short — model with very large admittance (penalty).
                    const Scalar Y = Scalar(1.0e9);
                    if (a != 0) A(a - 1, a - 1) += Y;
                    if (b != 0) A(b - 1, b - 1) += Y;
                    if (a != 0 && b != 0) {
                        A(a - 1, b - 1) -= Y;
                        A(b - 1, a - 1) -= Y;
                    }
                }
                break;
            }
            case Kind::VoltageSource: {
                const int idx = N + vIdx;
                if (a != 0) {
                    A(a - 1, idx) += Scalar(1.0);
                    A(idx, a - 1) += Scalar(1.0);
                }
                if (b != 0) {
                    A(b - 1, idx) -= Scalar(1.0);
                    A(idx, b - 1) -= Scalar(1.0);
                }
                rhs(idx) = Scalar(c.value);
                ++vIdx;
                break;
            }
            case Kind::CurrentSource: {
                // SPICE convention: current `value` flows from nA (+) to
                // nB (−) inside the source — externally that current
                // flows OUT of nB and INTO nA, so J[nA] += value and
                // J[nB] −= value (currents INTO the node are positive
                // in the MNA right-hand side).
                if (a != 0) rhs(a - 1) += Scalar(c.value);
                if (b != 0) rhs(b - 1) -= Scalar(c.value);
                break;
            }
        }
    }
    (void)isAC;
}

} // anonymous namespace

DCResult dcAnalysis(const DCInputs& in) {
    Eigen::MatrixXd A;
    Eigen::VectorXd rhs;
    buildMNA<double>(in, A, rhs, 0.0, /*isAC*/ false);
    if (A.rows() == 0) throw std::runtime_error("forge.circuit: empty system");
    Eigen::VectorXd x = A.colPivHouseholderQr().solve(rhs);
    const int N = static_cast<int>(in.nodeCount) - 1;
    DCResult R;
    R.nodeVoltages.assign(in.nodeCount, 0.0);
    for (int i = 0; i < N; ++i) R.nodeVoltages[i + 1] = x(i);
    int vIdx = 0;
    for (const auto& c : in.comps) {
        if (c.kind == Kind::VoltageSource) {
            R.vSourceCurrents.push_back(x(N + vIdx));
            ++vIdx;
        }
    }
    return R;
}

ACResult acAnalysis(const DCInputs& in, const std::vector<double>& freqs) {
    if (freqs.empty()) throw std::invalid_argument("forge.circuit.ac: freqs empty");
    ACResult R;
    R.frequencies = freqs;
    R.nodeVoltages.reserve(freqs.size());
    using C = std::complex<double>;
    for (double f : freqs) {
        const double omega = 2.0 * 3.14159265358979323846 * f;
        Eigen::Matrix<C, Eigen::Dynamic, Eigen::Dynamic> A;
        Eigen::Matrix<C, Eigen::Dynamic, 1> rhs;
        buildMNA<C>(in, A, rhs, omega, /*isAC*/ true);
        Eigen::Matrix<C, Eigen::Dynamic, 1> x =
            A.colPivHouseholderQr().solve(rhs);
        const int N = static_cast<int>(in.nodeCount) - 1;
        std::vector<C> V(in.nodeCount, C(0.0, 0.0));
        for (int i = 0; i < N; ++i) V[i + 1] = x(i);
        R.nodeVoltages.push_back(std::move(V));
    }
    return R;
}

}} // namespace forge::circuit
