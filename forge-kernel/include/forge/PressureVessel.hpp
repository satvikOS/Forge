#pragma once

// Forge-228 — Pressure vessel (ASME Section VIII Div 1).
//
// Thin-wall stress (D/t > 20):
//   Cylinder:  σ_h = p · D / (2·t)              (hoop / circumferential)
//              σ_l = p · D / (4·t)              (longitudinal)
//   Sphere:    σ   = p · D / (4·t)
//
// ASME VIII Div 1 minimum-thickness equations (UG-27 / UG-32):
//   Cylinder, circumferential stress:
//     t = p · R / (S · E − 0.6 · p)
//   Sphere (or hemispherical head):
//     t = p · R / (2 · S · E − 0.2 · p)
//
//   p — design pressure (Pa)
//   R — inside radius (m)
//   S — allowable stress (Pa)
//   E — joint efficiency (≤ 1.0)
//
// All inputs in SI.

#include <string>

namespace forge { namespace pvessel {

enum class Geometry { Cylinder, Sphere };

Geometry geometryFromString(const std::string& s);

struct StressInputs {
    double pressure;             // Pa
    double diameter;             // m (inside)
    double wallThickness;        // m
    Geometry geometry;
};

struct StressOutputs {
    double hoopStress;           // Pa (cylinder) or membrane (sphere)
    double longitudinalStress;   // Pa (cylinder); 0 for sphere
};

StressOutputs stress(const StressInputs& in);

struct ThicknessInputs {
    double pressure;             // Pa
    double insideRadius;         // m
    double allowableStress;      // Pa
    double jointEfficiency;
    Geometry geometry;
};

double requiredThickness(const ThicknessInputs& in);

}} // namespace forge::pvessel
