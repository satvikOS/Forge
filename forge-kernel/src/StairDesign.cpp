#include "forge/StairDesign.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::stair {

Result analyse(const Input& in) {
    if (in.floorToFloorHeightMm <= 0)
        throw std::runtime_error("floor height > 0");
    if (in.maxRiserMm <= 0) throw std::runtime_error("maxRiser > 0");
    if (in.minTreadMm <= 0) throw std::runtime_error("minTread > 0");

    const int n_risers = static_cast<int>(std::ceil(in.floorToFloorHeightMm / in.maxRiserMm));
    const int n_treads = n_risers - 1;
    const double riser_actual = in.floorToFloorHeightMm / n_risers;
    const double tread = in.minTreadMm;
    const double total_run = n_treads * tread;
    const double pitch_deg = std::atan(riser_actual / tread) * 180.0 / 3.141592653589793;
    const double RplusT = riser_actual + tread;

    const bool riser_ok = riser_actual <= in.maxRiserMm;
    const bool tread_ok = tread >= in.minTreadMm;
    const bool blondel_ok = RplusT >= 432.0 && RplusT <= 457.0;

    Result r;
    r.numberOfRisers   = n_risers;
    r.numberOfTreads   = n_treads;
    r.actualRiserMm    = riser_actual;
    r.totalRunMm       = total_run;
    r.pitchAngleDeg    = pitch_deg;
    r.riserPlusTreadMm = RplusT;
    r.riserCompliant   = riser_ok;
    r.treadCompliant   = tread_ok;
    r.blondelCompliant = blondel_ok;
    r.overallCompliant = riser_ok && tread_ok && blondel_ok;
    return r;
}

}  // namespace forge::stair
