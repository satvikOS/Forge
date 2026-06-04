// Forge-299 — Catenary cable sag-tension analysis.
//
// Used for high-voltage transmission line conductor sag-tension, suspension
// bridge main cable design, cable car / aerial tramway hanger lines, and
// open-pit mining haulage ropes. The exact catenary curve is
//
//   y(x) = c · (cosh(x / c) − 1)              c = H / w
//
// where x is measured from midspan, H is the horizontal component of cable
// tension (constant along the cable), and w is the cable weight per unit
// horizontal length (in this approximation; for the true catenary w is per
// unit arc length, but the difference is < 1% at typical 3-5% sag ratios).
//
// Sag at midspan (level supports):
//   s = c · (cosh(L / (2c)) − 1)
//
// Parabolic approximation (sag/span < 10%, cf. Roark §7.6, transmission-line
// design handbooks):
//   s_para = w · L² / (8 · H)
//
// Maximum tension occurs at the support:
//   T_max = H · cosh(L / (2c)) = H + w · s          (exact catenary form)
//
// Cable length (between two level supports):
//   L_cable = 2c · sinh(L / (2c))                    (exact)
//          ≈ L + 8 · s² / (3 · L)                    (parabolic approx)
//
// SI throughout: L m, H N, w N/m, sag m, T N.

#pragma once

namespace forge::catenary {

struct Input {
    double spanM;                  // L (level support-to-support span)
    double horizontalTensionN;     // H
    double linearWeightNPerM;      // w (= ρ_l·g for cable mass per m)
};

struct Result {
    double catenaryParameterM;     // c = H/w
    double sagM;                   // catenary form
    double sagParabolicM;          // approximation s ≈ wL²/(8H)
    double maxTensionN;            // T_max at support
    double cableLengthM;           // exact via sinh
    double cableLengthParabolicM;  // L + 8s²/(3L)
    double sagRatio;               // s / L (design target ~3-5 % typical)
};

Result analyse(const Input& in);

}  // namespace forge::catenary
