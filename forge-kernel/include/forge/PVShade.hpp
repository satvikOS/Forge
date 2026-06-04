// Forge-331e — PV array near-shading horizon analysis (IES LS-2 / NREL SPI).
//   Sun altitude α and azimuth γ_s (input).
//   Horizon profile h(γ) sampled at azimuth increments.
//   Shaded if α < h(γ_s) interpolated.
//   Annual sun-hours-shaded fraction = Σ shaded(t) / Σ (α > 0)  approximated by:
//     iterate sun-path samples through the day → count shaded hits.
//   For a single instant, return boolean + delta margin.

#pragma once

#include <vector>

namespace forge::pvshade {

struct HorizonPoint {
    double azimuthDeg;     // 0 = N (some sites use S); monotonic increasing
    double altitudeDeg;    // horizon altitude above observer plane
};

struct Input {
    std::vector<HorizonPoint> horizon;
    double sunAltitudeDeg;
    double sunAzimuthDeg;
};

struct Result {
    double horizonAltitudeAtSunAz_deg;
    double sunMarginDeg;          // α_sun − α_horizon (positive = unshaded)
    bool   shaded;
};

Result analyse(const Input& in);

}  // namespace forge::pvshade
