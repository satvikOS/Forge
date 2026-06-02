#include "forge/VBelt.hpp"

#include <cmath>
#include <stdexcept>

namespace forge { namespace vbelt {

namespace { constexpr double kPi = 3.14159265358979323846; }

double pitchLength(double d1, double d2, double C) {
    if (d1 <= 0 || d2 <= 0) throw std::invalid_argument("pitchLength: d > 0");
    if (d2 < d1)            throw std::invalid_argument("pitchLength: d_2 ≥ d_1");
    if (C <= 0)             throw std::invalid_argument("pitchLength: C > 0");
    const double diff = d2 - d1;
    return 2.0 * C + (kPi / 2.0) * (d1 + d2) + diff * diff / (4.0 * C);
}

double centreDistFromLength(double d1, double d2, double Lp) {
    if (Lp <= 0) throw std::invalid_argument("centreDist: L_p > 0");
    if (d2 < d1) throw std::invalid_argument("centreDist: d_2 ≥ d_1");
    const double diff = d2 - d1;
    const double B = 4.0 * Lp - 2.0 * kPi * (d1 + d2);
    const double disc = B * B - 32.0 * diff * diff;
    if (disc < 0) throw std::invalid_argument("centreDist: no real solution (belt too short)");
    return (B + std::sqrt(disc)) / 16.0;
}

double wrapAngleSmallRad(double d1, double d2, double C) {
    if (C <= 0) throw std::invalid_argument("wrapAngle: C > 0");
    const double arg = (d2 - d1) / (2.0 * C);
    if (arg > 1.0) throw std::invalid_argument("wrapAngle: pulleys can't span C");
    return kPi - 2.0 * std::asin(arg);
}

Outputs analyse(const Inputs& in) {
    if (in.rpmSmall <= 0)        throw std::invalid_argument("vbelt: rpm > 0");
    if (in.nominalPower <= 0)    throw std::invalid_argument("vbelt: power > 0");
    if (in.serviceFactor <= 0)   throw std::invalid_argument("vbelt: K_S > 0");
    if (in.ratingPerBelt <= 0)   throw std::invalid_argument("vbelt: rating > 0");

    Outputs out{};
    out.pitchLength = pitchLength(in.d1, in.d2, in.centreDist);
    out.wrapAngleSmallDeg = wrapAngleSmallRad(in.d1, in.d2, in.centreDist) * 180.0 / kPi;
    out.beltSpeed = kPi * in.d1 * in.rpmSmall / 60.0;
    out.designPower = in.serviceFactor * in.nominalPower;
    out.beltCount = out.designPower / in.ratingPerBelt;
    return out;
}

}} // namespace forge::vbelt
