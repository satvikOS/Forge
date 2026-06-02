#include "forge/Ductwork.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge { namespace duct {

namespace {

constexpr double PI = 3.14159265358979323846;

// ASHRAE equivalent diameter for rectangular ducts.
double rectEquivDiamMm(double a, double b) {
    if (a <= 0 || b <= 0) return 0.0;
    return 1.30 * std::pow(a * b, 0.625) / std::pow(a + b, 0.25);
}

// Swamee-Jain explicit Colebrook-White.
double swameeJain(double Re, double epsOverD) {
    if (Re < 2000.0) {
        // Laminar
        return 64.0 / std::max(1.0, Re);
    }
    const double t = std::log10(epsOverD / 3.7 + 5.74 / std::pow(Re, 0.9));
    const double f = 0.25 / (t * t);
    return f;
}

double fittingK(SegKind k) {
    switch (k) {
      case SegKind::Elbow90:        return 0.22;   // smooth, r/D ≈ 1
      case SegKind::Elbow45:        return 0.15;
      case SegKind::Elbow22:        return 0.10;
      case SegKind::TransRoundRect: return 0.05;
      case SegKind::TeeStraight:    return 0.10;
      case SegKind::TeeBranch:      return 0.65;
      default:                      return 0.0;
    }
}

} // anonymous namespace

DuctResult compute(const DuctInputs& in) {
    if (in.route.empty()) {
        throw std::invalid_argument("forge.duct: route must have ≥ 1 segment");
    }
    if (in.flowRateM3s <= 0) {
        throw std::invalid_argument("forge.duct: flowRateM3s must be > 0");
    }
    if (in.air.rhoKgM3 <= 0 || in.air.nuM2s <= 0) {
        throw std::invalid_argument("forge.duct: air properties must be > 0");
    }

    DuctResult R;
    R.segments.reserve(in.route.size());
    R.totalDropPa = 0.0;
    R.maxVelocityMs = 0.0;
    R.totalLengthM = 0.0;

    for (const auto& s : in.route) {
        SegResult r{};
        r.kind = s.kind;
        // Hydraulic diameter (mm), area (mm²).
        double dhMm = 0.0;
        double aMm2 = 0.0;
        switch (s.kind) {
          case SegKind::RoundRun:
          case SegKind::Elbow90:
          case SegKind::Elbow45:
          case SegKind::Elbow22:
            if (!(s.diameterMm > 0)) {
                throw std::invalid_argument("forge.duct: round seg diameter must be > 0");
            }
            dhMm = s.diameterMm;
            aMm2 = 0.25 * PI * dhMm * dhMm;
            break;
          case SegKind::RectRun:
            if (!(s.widthMm > 0) || !(s.heightMm > 0)) {
                throw std::invalid_argument("forge.duct: rect seg width/height must be > 0");
            }
            dhMm = rectEquivDiamMm(s.widthMm, s.heightMm);
            aMm2 = s.widthMm * s.heightMm;
            break;
          case SegKind::TransRoundRect:
            // Use the smaller of the two equivalent diameters as the
            // effective Dh (conservative for K-based loss).
            if (s.diameterMm > 0 && s.widthMm > 0 && s.heightMm > 0) {
                const double deRect = rectEquivDiamMm(s.widthMm, s.heightMm);
                dhMm = std::min(s.diameterMm, deRect);
            } else if (s.diameterMm > 0) {
                dhMm = s.diameterMm;
            } else {
                dhMm = rectEquivDiamMm(s.widthMm, s.heightMm);
            }
            aMm2 = 0.25 * PI * dhMm * dhMm;
            break;
          case SegKind::TeeStraight:
          case SegKind::TeeBranch:
            dhMm = s.diameterMm > 0 ? s.diameterMm : rectEquivDiamMm(s.widthMm, s.heightMm);
            aMm2 = 0.25 * PI * dhMm * dhMm;
            break;
        }
        const double dhM = dhMm / 1000.0;
        const double aM2 = aMm2 / 1.0e6;
        if (aM2 <= 0) {
            throw std::runtime_error("forge.duct: degenerate cross-section");
        }
        const double V = in.flowRateM3s / aM2;
        const double Re = V * dhM / in.air.nuM2s;
        const double epsOverD = (in.air.epsilonMm / 1000.0) / dhM;
        const double f = swameeJain(Re, epsOverD);
        const double dynamic = 0.5 * in.air.rhoKgM3 * V * V;
        // Friction drop only on runs.
        const bool isRun = (s.kind == SegKind::RoundRun || s.kind == SegKind::RectRun);
        const double frictionPa = isRun
            ? f * (s.lengthM / std::max(1e-6, dhM)) * dynamic
            : 0.0;
        const double K = fittingK(s.kind);
        const double fittingPa = K * dynamic;
        r.hydraulicDiameterMm = dhMm;
        r.areaMm2             = aMm2;
        r.velocityMs          = V;
        r.reynolds            = Re;
        r.frictionFactor      = f;
        r.lossCoefficientK    = K;
        r.frictionDropPa      = frictionPa;
        r.fittingDropPa       = fittingPa;
        r.totalDropPa         = frictionPa + fittingPa;
        r.lengthM             = isRun ? s.lengthM : 0.0;
        R.totalDropPa += r.totalDropPa;
        R.maxVelocityMs = std::max(R.maxVelocityMs, V);
        R.totalLengthM += r.lengthM;
        R.segments.push_back(r);
    }
    return R;
}

double sizeRoundForFriction(double flowM3s, double targetPaPerM, const DuctAir& air) {
    if (flowM3s <= 0 || targetPaPerM <= 0) {
        throw std::invalid_argument("forge.duct.size: inputs must be > 0");
    }
    auto gradient = [&](double dMm) {
        const double dM = dMm / 1000.0;
        const double aM2 = 0.25 * PI * dM * dM;
        const double V = flowM3s / aM2;
        const double Re = V * dM / air.nuM2s;
        const double epsOverD = (air.epsilonMm / 1000.0) / dM;
        const double f = swameeJain(Re, epsOverD);
        const double dynamic = 0.5 * air.rhoKgM3 * V * V;
        return f / dM * dynamic;
    };
    // Bisection on diameter to hit target gradient.
    double lo = 50.0, hi = 1500.0;
    const double gLo = gradient(lo);   // large gradient at small D
    const double gHi = gradient(hi);   // tiny gradient at large D
    if (targetPaPerM > gLo) return lo;
    if (targetPaPerM < gHi) return hi;
    for (int i = 0; i < 50; ++i) {
        const double mid = 0.5 * (lo + hi);
        const double gm = gradient(mid);
        if (gm > targetPaPerM) lo = mid;
        else                   hi = mid;
        if (hi - lo < 0.5) break;
    }
    return 0.5 * (lo + hi);
}

}} // namespace forge::duct
