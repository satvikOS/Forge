// Forge-247 — Symmetrical components implementation.

#include "forge/SymComponents.hpp"

#include <cmath>
#include <complex>
#include <numbers>
#include <stdexcept>

namespace forge::symcomp {

namespace {
constexpr double pi = std::numbers::pi;
using cd = std::complex<double>;

cd polarToComplex(double mag, double angleDeg) {
    const double rad = angleDeg * pi / 180.0;
    return cd(mag * std::cos(rad), mag * std::sin(rad));
}

PhasorPolar complexToPolar(const cd& z) {
    PhasorPolar p{};
    p.magnitude = std::abs(z);
    p.angleDeg = (p.magnitude > 1e-18) ? std::atan2(z.imag(), z.real()) * 180.0 / pi : 0.0;
    // Normalize angle to [-180, 180].
    while (p.angleDeg > 180.0)  p.angleDeg -= 360.0;
    while (p.angleDeg < -180.0) p.angleDeg += 360.0;
    return p;
}

cd a_operator() {
    return polarToComplex(1.0, 120.0);
}
}  // namespace

DecomposeResult decompose(const DecomposeInput& in) {
    const cd Va = polarToComplex(in.Va.magnitude, in.Va.angleDeg);
    const cd Vb = polarToComplex(in.Vb.magnitude, in.Vb.angleDeg);
    const cd Vc = polarToComplex(in.Vc.magnitude, in.Vc.angleDeg);
    const cd a = a_operator();
    const cd a2 = a * a;

    const cd V0 = (Va + Vb + Vc) / 3.0;
    const cd V1 = (Va + a * Vb + a2 * Vc) / 3.0;
    const cd V2 = (Va + a2 * Vb + a * Vc) / 3.0;

    DecomposeResult r{};
    r.zero     = complexToPolar(V0);
    r.positive = complexToPolar(V1);
    r.negative = complexToPolar(V2);
    return r;
}

DecomposeInput compose(const DecomposeResult& seq) {
    const cd V0 = polarToComplex(seq.zero.magnitude, seq.zero.angleDeg);
    const cd V1 = polarToComplex(seq.positive.magnitude, seq.positive.angleDeg);
    const cd V2 = polarToComplex(seq.negative.magnitude, seq.negative.angleDeg);
    const cd a = a_operator();
    const cd a2 = a * a;

    DecomposeInput out{};
    out.Va = complexToPolar(V0 + V1 + V2);
    out.Vb = complexToPolar(V0 + a2 * V1 + a * V2);
    out.Vc = complexToPolar(V0 + a * V1 + a2 * V2);
    return out;
}

FaultResult faultCurrents(const FaultInput& in) {
    if (in.prefaultPhaseVoltage <= 0.0)
        throw std::invalid_argument("V must be positive");
    if (in.Z0_magnitude <= 0.0 || in.Z1_magnitude <= 0.0 || in.Z2_magnitude <= 0.0)
        throw std::invalid_argument("sequence impedances must be positive");

    const cd Z0 = polarToComplex(in.Z0_magnitude, in.Z0_angleDeg);
    const cd Z1 = polarToComplex(in.Z1_magnitude, in.Z1_angleDeg);
    const cd Z2 = polarToComplex(in.Z2_magnitude, in.Z2_angleDeg);
    const cd V  = cd(in.prefaultPhaseVoltage, 0.0);

    FaultResult r{};
    r.threePhaseFaultI   = std::abs(V / Z1);
    r.lineToGroundFaultI = std::abs(3.0 * V / (Z0 + Z1 + Z2));
    // For LL b-c: |I_b| = |I_c| = √3·|V|/|Z_1+Z_2| (no zero seq)
    r.lineToLineFaultI = std::abs(std::sqrt(3.0) * V / (Z1 + Z2));
    return r;
}

}  // namespace forge::symcomp
