#pragma once

// Forge-223 — Wind load (ASCE 7-22 / 7-16) velocity pressure + design
// pressure for main wind-force-resisting systems.
//
//   Velocity pressure exposure coefficient (ASCE 7-22 Table 26.10-1):
//     z < z_g:  K_z = 2.01 · (z / z_g)^(2/α)
//     z ≥ z_g:  K_z capped at 2.01
//
//   Exposure B (suburban):  z_g = 365.76 m,  α = 7.0
//   Exposure C (open):       z_g = 274.32 m,  α = 9.5
//   Exposure D (water):      z_g = 213.36 m,  α = 11.5
//
//   Velocity pressure (SI):
//     q_z = 0.613 · K_z · K_zt · K_d · K_e · V²   [Pa, with V in m/s]
//
//   Design pressure (MWFRS):
//     p = q_z · G · C_p          (external)
//     p = p − q_i · G·C_pi       (internal, optional)
//
// Defaults: K_zt = 1.0 (flat terrain), K_d = 0.85 (most buildings),
// K_e = 1.0 (sea level), G = 0.85 (rigid building).

#include <string>

namespace forge { namespace windload {

enum class Exposure { B, C, D };

Exposure exposureFromString(const std::string& name);

double kzCoefficient(double z, Exposure exposure);

struct VelocityPressureInputs {
    double V;         // basic wind speed, m/s
    double z;         // height above ground, m
    Exposure exposure;
    double Kzt;
    double Kd;
    double Ke;
};

double velocityPressure(const VelocityPressureInputs& in);

struct DesignPressureInputs {
    double qz;        // Pa
    double G;         // gust factor (≈ 0.85)
    double Cp;        // external pressure coefficient
    double qi;        // internal velocity pressure (0 if not used)
    double GCpi;      // internal pressure coefficient (signed)
};

double designPressure(const DesignPressureInputs& in);

}} // namespace forge::windload
