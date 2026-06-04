#include "forge/MassHaul.hpp"

#include <algorithm>
#include <stdexcept>

namespace forge::masshaul {

Result analyse(const Input& in) {
    if (in.stations.size() < 2)        throw std::runtime_error("≥ 2 stations");
    if (in.swellFactor <= 0)           throw std::runtime_error("swell > 0");
    if (in.shrinkageFactor <= 0)       throw std::runtime_error("shrink > 0");

    double total_cut = 0, total_fill_compacted = 0;
    std::vector<double> ordinate(in.stations.size(), 0.0);

    for (size_t i = 1; i < in.stations.size(); ++i) {
        const auto& a = in.stations[i - 1];
        const auto& b = in.stations[i];
        const double L = b.station_m - a.station_m;
        if (L <= 0) throw std::runtime_error("stations must be monotonic increasing");
        double cut_seg, fill_seg;
        if (a.midCutArea_m2 > 0 || a.midFillArea_m2 > 0) {
            cut_seg  = L / 6.0 * (a.cutArea_m2 + 4.0 * a.midCutArea_m2 + b.cutArea_m2);
            fill_seg = L / 6.0 * (a.fillArea_m2 + 4.0 * a.midFillArea_m2 + b.fillArea_m2);
        } else {
            cut_seg  = L / 2.0 * (a.cutArea_m2 + b.cutArea_m2);
            fill_seg = L / 2.0 * (a.fillArea_m2 + b.fillArea_m2);
        }
        total_cut            += cut_seg;
        total_fill_compacted += fill_seg;
        // Mass-haul: cut (loose) minus fill required to be brought in (loose),
        // where loose = compacted / shrinkage.
        const double fill_loose_seg = fill_seg / in.shrinkageFactor;
        ordinate[i] = ordinate[i - 1] + cut_seg - fill_loose_seg;
    }
    const double total_fill_loose = total_fill_compacted / in.shrinkageFactor;

    Result r;
    r.cumulativeOrdinate_m3   = ordinate;
    r.totalCut_m3             = total_cut;
    r.totalFillCompacted_m3   = total_fill_compacted;
    r.totalFillLoose_m3       = total_fill_loose;
    r.netBalance_m3           = total_cut - total_fill_loose;
    r.maxOrdinate_m3          = *std::max_element(ordinate.begin(), ordinate.end());
    r.minOrdinate_m3          = *std::min_element(ordinate.begin(), ordinate.end());
    return r;
}

}  // namespace forge::masshaul
