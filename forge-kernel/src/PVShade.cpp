#include "forge/PVShade.hpp"

#include <stdexcept>

namespace forge::pvshade {

static double interpolate(const std::vector<HorizonPoint>& h, double az) {
    if (h.front().azimuthDeg >= az) return h.front().altitudeDeg;
    if (h.back().azimuthDeg  <= az) return h.back().altitudeDeg;
    for (size_t i = 1; i < h.size(); ++i) {
        if (h[i].azimuthDeg >= az) {
            const auto& a = h[i - 1];
            const auto& b = h[i];
            const double t = (az - a.azimuthDeg) / (b.azimuthDeg - a.azimuthDeg);
            return a.altitudeDeg + t * (b.altitudeDeg - a.altitudeDeg);
        }
    }
    return h.back().altitudeDeg;
}

Result analyse(const Input& in) {
    if (in.horizon.size() < 2) throw std::runtime_error("≥ 2 horizon points");
    for (size_t i = 1; i < in.horizon.size(); ++i)
        if (in.horizon[i].azimuthDeg <= in.horizon[i - 1].azimuthDeg)
            throw std::runtime_error("horizon azimuths must be monotonic");
    if (in.sunAltitudeDeg < -90 || in.sunAltitudeDeg > 90)
        throw std::runtime_error("α in [-90, 90]");

    const double h = interpolate(in.horizon, in.sunAzimuthDeg);
    const double margin = in.sunAltitudeDeg - h;

    Result r;
    r.horizonAltitudeAtSunAz_deg = h;
    r.sunMarginDeg               = margin;
    r.shaded                     = margin < 0.0;
    return r;
}

}  // namespace forge::pvshade
