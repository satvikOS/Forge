// Forge-242 — Open-channel flow (Manning + critical/normal depth).
//
// Trapezoidal channel with bottom width b, side slope m (rise/run from
// vertical: side wall = m horizontal per 1 vertical), depth y.
//
//   A(y) = (b + m·y)·y
//   P(y) = b + 2·y·√(1 + m²)
//   T(y) = b + 2·m·y    (top width)
//   R(y) = A/P
//
//   Manning: Q = (1/n)·A·R^(2/3)·√S
//
// Normal depth y_n: solve Manning Q(y) = Q_target with Newton-Raphson.
// Critical depth y_c: solve Q²·T(y) / (g·A(y)³) = 1.
// Froude: Fr = V / √(g·D_h) where D_h = A/T (hydraulic depth).
//
// Regime: Fr < 1 subcritical, Fr = 1 critical, Fr > 1 supercritical.

#pragma once

namespace forge::openchannel {

struct GeomInput {
    double bottomWidthM;     // b
    double sideSlopeM;       // m (horizontal / vertical); 0 = rectangular
};

struct SectionResult {
    double area;
    double wetPerim;
    double hydraulicRadius;
    double topWidth;
};

SectionResult sectionAtDepth(const GeomInput& g, double y);

struct UniformInput {
    GeomInput geom;
    double manningN;         // n
    double slope;            // S (m/m)
    double depthM;           // y (for direct Q calc)
};

double manningDischarge(const UniformInput& u);   // Q = (1/n)·A·R^(2/3)·√S

struct NormalDepthInput {
    GeomInput geom;
    double manningN;
    double slope;
    double targetDischarge;  // Q
};

double normalDepth(const NormalDepthInput& in);

struct CriticalDepthInput {
    GeomInput geom;
    double dischargeQ;
    double gravityG;         // 9.81
};

double criticalDepth(const CriticalDepthInput& in);

struct FlowRegimeInput {
    GeomInput geom;
    double depthM;
    double dischargeQ;
    double gravityG;
};

struct FlowRegimeResult {
    double area;
    double topWidth;
    double hydraulicDepth;
    double velocity;
    double froude;
    int regime;              // -1 supercritical, 0 critical, +1 subcritical
};

FlowRegimeResult flowRegime(const FlowRegimeInput& in);

}  // namespace forge::openchannel
