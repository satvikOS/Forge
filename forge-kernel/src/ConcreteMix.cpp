// Forge-312 — implementation; see header for derivation references.

#include "forge/ConcreteMix.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::concretemix {

namespace {

// Approximation of Table 6.3.3 water demand (kg/m³ of concrete) versus
// nominal max aggregate size, for 75-100 mm slump. Endpoints from ACI 211.1.
double baseWaterDemand(double dmax_mm) {
    // Piecewise log-log interpolation across published sizes
    struct Point { double d, w; } pts[] = {
        {10.0, 207.0}, {12.5, 199.0}, {20.0, 190.0},
        {25.0, 179.0}, {40.0, 166.0}, {50.0, 154.0},
    };
    if (dmax_mm <= pts[0].d) return pts[0].w;
    if (dmax_mm >= pts[5].d) return pts[5].w;
    for (int i = 0; i < 5; ++i) {
        if (dmax_mm >= pts[i].d && dmax_mm <= pts[i+1].d) {
            const double f = (dmax_mm - pts[i].d) / (pts[i+1].d - pts[i].d);
            return pts[i].w + f * (pts[i+1].w - pts[i].w);
        }
    }
    return 190.0;
}

// Slump adjustment per Table 6.3.3 note: roughly +2 kg/m³ per 10 mm slump
// above 100 mm, −1 kg per 10 mm below 75 mm.
double slumpAdjustment(double slump_mm) {
    if (slump_mm < 75.0)  return -1.0 * (75.0  - slump_mm) / 10.0;
    if (slump_mm > 100.0) return  2.0 * (slump_mm - 100.0) / 10.0;
    return 0.0;
}

// Coarse-aggregate fraction by bulk volume per Table 6.3.6 (FM=2.6).
double coarseVolumeFraction(double dmax_mm) {
    struct Point { double d, v; } pts[] = {
        {10.0, 0.50}, {12.5, 0.59}, {20.0, 0.66},
        {25.0, 0.69}, {40.0, 0.75}, {50.0, 0.78},
    };
    if (dmax_mm <= pts[0].d) return pts[0].v;
    if (dmax_mm >= pts[5].d) return pts[5].v;
    for (int i = 0; i < 5; ++i) {
        if (dmax_mm >= pts[i].d && dmax_mm <= pts[i+1].d) {
            const double f = (dmax_mm - pts[i].d) / (pts[i+1].d - pts[i].d);
            return pts[i].v + f * (pts[i+1].v - pts[i].v);
        }
    }
    return 0.66;
}

}  // namespace

Result analyse(const Input& in) {
    if (in.targetStrengthMPa <= 0.0)
        throw std::runtime_error("targetStrengthMPa must be > 0");
    if (in.slumpMm <= 0.0)
        throw std::runtime_error("slumpMm must be > 0");
    if (in.maxAggregateSizeMm <= 0.0)
        throw std::runtime_error("maxAggregateSizeMm must be > 0");
    if (in.airContentFraction < 0.0 || in.airContentFraction > 0.10)
        throw std::runtime_error("airContentFraction must be in [0, 0.10]");
    if (in.cementSpecificGravity <= 1.0)
        throw std::runtime_error("cementSpecificGravity must be > 1");
    if (in.sandSpecificGravity <= 1.0)
        throw std::runtime_error("sandSpecificGravity must be > 1");
    if (in.coarseSpecificGravity <= 1.0)
        throw std::runtime_error("coarseSpecificGravity must be > 1");
    if (in.coarseDryRoddedDensity <= 0.0)
        throw std::runtime_error("coarseDryRoddedDensity must be > 0");

    // Step 1: w/c from f'_c regression
    const double wc = std::clamp(0.94 - 0.0085 * in.targetStrengthMPa, 0.32, 0.82);

    // Step 2: water demand from slump + max-agg
    const double W = baseWaterDemand(in.maxAggregateSizeMm) + slumpAdjustment(in.slumpMm);

    // Step 3: cement
    const double cement = W / wc;

    // Step 4: coarse-agg
    const double vol_ca_bulk = coarseVolumeFraction(in.maxAggregateSizeMm);
    const double coarse = vol_ca_bulk * in.coarseDryRoddedDensity;

    // Step 5: absolute volumes
    const double V_c   = cement / (1000.0 * in.cementSpecificGravity);
    const double V_w   = W      / 1000.0;
    const double V_ca  = coarse / (1000.0 * in.coarseSpecificGravity);
    const double V_air = in.airContentFraction;
    const double V_s   = 1.0 - (V_c + V_w + V_ca + V_air);
    if (V_s <= 0.0)
        throw std::runtime_error("sand volume non-positive — inputs over-determine mix");
    const double sand = V_s * 1000.0 * in.sandSpecificGravity;

    Result r;
    r.waterCementRatio       = wc;
    r.waterDemandKg          = W;
    r.cementMassKg           = cement;
    r.coarseAggregateMassKg  = coarse;
    r.sandMassKg             = sand;
    r.airVolumeM3            = V_air;
    r.cementVolumeM3         = V_c;
    r.waterVolumeM3          = V_w;
    r.coarseVolumeM3         = V_ca;
    r.sandVolumeM3           = V_s;
    r.freshUnitWeightKgPerM3 = cement + W + coarse + sand;
    return r;
}

}  // namespace forge::concretemix
