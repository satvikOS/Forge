// Forge-313 — implementation; see header for derivation references.

#include "forge/SteamPipe.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::steampipe {

namespace {

// Saturated-steam table fit (0–10 bar gauge): (P_g, T_sat°C, v_g m³/kg)
// from Spirax Sarco Steam Tables (also matches Rogers-Mayhew 4th ed).
struct SatRow { double pg, t, vg; };
const SatRow TABLE[] = {
    { 0.0, 100.0, 1.6730},
    { 1.0, 120.2, 0.8854},
    { 2.0, 133.5, 0.6055},
    { 3.0, 143.6, 0.4621},
    { 4.0, 151.8, 0.3747},
    { 5.0, 158.8, 0.3155},
    { 6.0, 165.0, 0.2727},
    { 7.0, 170.4, 0.2403},
    { 8.0, 175.4, 0.2148},
    { 9.0, 179.9, 0.1942},
    {10.0, 184.1, 0.1772},
};
constexpr int N = sizeof(TABLE) / sizeof(TABLE[0]);

void interpSteam(double pg, double& T, double& vg) {
    if (pg <= TABLE[0].pg)      { T = TABLE[0].t;     vg = TABLE[0].vg;     return; }
    if (pg >= TABLE[N-1].pg)    { T = TABLE[N-1].t;   vg = TABLE[N-1].vg;   return; }
    for (int i = 0; i < N - 1; ++i) {
        if (pg >= TABLE[i].pg && pg <= TABLE[i+1].pg) {
            const double f = (pg - TABLE[i].pg) / (TABLE[i+1].pg - TABLE[i].pg);
            T  = TABLE[i].t  + f * (TABLE[i+1].t  - TABLE[i].t);
            vg = TABLE[i].vg + f * (TABLE[i+1].vg - TABLE[i].vg);
            return;
        }
    }
}

// Standard DN sequence in mm — pick first ≥ required
double nextStandardDN(double requested_mm) {
    static const double DN[] = {
        15.0, 20.0, 25.0, 32.0, 40.0, 50.0, 65.0, 80.0,
       100.0,125.0,150.0,200.0,250.0,300.0,400.0,500.0,
    };
    for (double d : DN)
        if (d >= requested_mm) return d;
    return 600.0;  // beyond chart
}

}  // namespace

Result analyse(const Input& in) {
    if (in.steamPressureBarGauge < 0.0 || in.steamPressureBarGauge > 10.0)
        throw std::runtime_error("steamPressureBarGauge must be in [0, 10]");
    if (in.steamMassFlowKgPerH <= 0.0)
        throw std::runtime_error("steamMassFlowKgPerH must be > 0");
    if (in.velocityLimitMs <= 0.0)
        throw std::runtime_error("velocityLimitMs must be > 0");
    if (in.pipeLengthM <= 0.0)
        throw std::runtime_error("pipeLengthM must be > 0");

    constexpr double PI = 3.141592653589793;

    double T, vg;
    interpSteam(in.steamPressureBarGauge, T, vg);

    const double m_dot = in.steamMassFlowKgPerH / 3600.0;     // kg/s
    const double Q_v   = m_dot * vg;                           // m³/s
    const double A_req = Q_v / in.velocityLimitMs;             // m²
    const double D_req = std::sqrt(4.0 * A_req / PI) * 1000.0; // mm

    const double DN = nextStandardDN(D_req);
    const double D_m = DN / 1000.0;
    const double A_actual = 0.25 * PI * D_m * D_m;
    const double V_actual = Q_v / A_actual;

    constexpr double f = 0.02;                                 // smooth steel
    const double rho   = 1.0 / vg;                              // kg/m³
    const double dPdL_Pa_per_m = f * rho * V_actual * V_actual
                                / (2.0 * D_m);                  // Pa/m
    const double dP_per_100 = dPdL_Pa_per_m * 100.0 / 1.0e5;    // bar
    const double dP_total   = dPdL_Pa_per_m * in.pipeLengthM
                                / 1.0e5;                          // bar

    Result r;
    r.saturationTempC          = T;
    r.specificVolumeM3PerKg    = vg;
    r.requiredAreaMm2          = A_req * 1.0e6;
    r.requiredDiameterMm       = D_req;
    r.standardDN               = DN;
    r.actualVelocityMs         = V_actual;
    r.pressureDropBarPer100m   = dP_per_100;
    r.totalPressureDropBar     = dP_total;
    return r;
}

}  // namespace forge::steampipe
