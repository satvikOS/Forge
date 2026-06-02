// Forge-239 — Soil bearing capacity (Terzaghi + Meyerhof N-factors).
//
// Terzaghi general bearing capacity equation:
//   q_ult = c·N_c·s_c·d_c + q·N_q·s_q·d_q + 0.5·γ·B·N_γ·s_γ·d_γ
//
// Bearing capacity factors (Meyerhof closed form):
//   N_q = e^(π·tanφ) · tan²(45° + φ/2)
//   N_c = (N_q − 1)·cotφ          (or 5.14 for φ = 0)
//   N_γ = (N_q − 1)·tan(1.4·φ)    (Meyerhof 1963)
//
// Shape factors (Vesić / Meyerhof, simplified for the common cases):
//   strip   : s_c = s_q = s_γ = 1
//   square  : s_c = 1 + (N_q/N_c); s_q = 1 + tanφ; s_γ = 0.6
//   circular: s_c = 1 + (N_q/N_c); s_q = 1 + tanφ; s_γ = 0.6
//
// Depth factors (Brinch-Hansen, for D/B ≤ 1):
//   d_c = 1 + 0.4·(D/B)
//   d_q = 1 + 2·tanφ·(1 − sinφ)²·(D/B)
//   d_γ = 1

#pragma once

namespace forge::bearingcap {

enum class Shape { Strip, Square, Circular };

struct Input {
    Shape shape;
    double widthM;            // B
    double depthM;            // D (embedment)
    double cohesionPa;        // c
    double surchargeKnPerM3;  // γ (unit weight)  — kept name; supplied in N/m³
    double frictionAngleDeg;  // φ
    double factorOfSafety;    // FS
};

struct Result {
    double Nq;
    double Nc;
    double Ngamma;
    double shapeFactorC;
    double shapeFactorQ;
    double shapeFactorGamma;
    double depthFactorC;
    double depthFactorQ;
    double depthFactorGamma;
    double surchargePa;        // q = γ·D
    double ultimateBearingPa;  // q_ult
    double allowableBearingPa; // q_a = q_ult / FS
};

Result analyse(const Input& in);

Shape shapeFromString(const char* s);

}  // namespace forge::bearingcap
