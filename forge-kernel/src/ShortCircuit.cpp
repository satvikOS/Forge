// Forge-251 — Short-circuit study implementation.

#include "forge/ShortCircuit.hpp"

#include "forge/native/linalg/LinAlg.hpp"
#include <cmath>
#include <complex>
#include <numbers>
#include <stdexcept>

namespace forge::shortcircuit {

namespace la = forge::native::linalg;

namespace {
constexpr double pi = std::numbers::pi;
using cd = std::complex<double>;
}  // namespace

Result analyse(const Input& in) {
    const int N = in.numBuses;
    if (N < 2) throw std::invalid_argument("need ≥ 2 buses");
    if (in.prefaultVoltagePu <= 0.0)
        throw std::invalid_argument("V_prefault must be positive");

    la::MatrixC Y(N, N);  // was Eigen::MatrixXcd::Zero(N, N) — Matrix ctor zero-inits
    for (const auto& g : in.generators) {
        if (g.busIndex < 0 || g.busIndex >= N)
            throw std::invalid_argument("generator bus out of range");
        if (g.subtransientX <= 0.0)
            throw std::invalid_argument("X_d'' must be positive");
        const cd y = 1.0 / cd(0.0, g.subtransientX);
        Y(g.busIndex, g.busIndex) += y;
    }
    for (const auto& br : in.branches) {
        if (br.from < 0 || br.to < 0 || br.from >= N || br.to >= N)
            throw std::invalid_argument("branch bus out of range");
        if (br.from == br.to) continue;
        const cd z(br.R, br.X);
        if (std::abs(z) < 1e-18) throw std::invalid_argument("branch Z nonzero");
        const cd y = 1.0 / z;
        Y(br.from, br.to) -= y;
        Y(br.to, br.from) -= y;
        Y(br.from, br.from) += y;
        Y(br.to, br.to) += y;
    }

    // Z_bus = Y_bus^-1.  Must be invertible (no isolated buses).
    la::MatrixC Z;
    {
      la::LU<cd> lu(Y);  // was Eigen::FullPivLU<Eigen::MatrixXcd> — full pivot by default
      if (!lu.ok())  // was !lu.isInvertible()
          throw std::invalid_argument("Y_bus is singular — verify generators and branches connect every bus");
      Z = lu.inverse();
    }

    Result r{};
    r.buses.resize(N);
    for (int i = 0; i < N; ++i) {
        const cd Zii = Z(i, i);
        r.buses[i].zDriveMag    = std::abs(Zii);
        r.buses[i].zDriveAngDeg = std::atan2(Zii.imag(), Zii.real()) * 180.0 / pi;
        const double Vpre = in.prefaultVoltagePu;
        if (r.buses[i].zDriveMag > 1e-12) {
            r.buses[i].faultCurrentPu = Vpre / r.buses[i].zDriveMag;
            r.buses[i].faultMvaPu     = Vpre * Vpre / r.buses[i].zDriveMag;
        } else {
            r.buses[i].faultCurrentPu = 0.0;
            r.buses[i].faultMvaPu     = 0.0;
        }
    }
    return r;
}

}  // namespace forge::shortcircuit
