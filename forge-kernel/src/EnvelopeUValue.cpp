// Forge-320e — see header.

#include "forge/EnvelopeUValue.hpp"

#include <stdexcept>

namespace forge::uvalue {

Result analyse(const Input& in) {
    if (in.layers.empty())
        throw std::runtime_error("layers must contain at least one layer");
    if (in.interiorFilmRSI < 0.0)
        throw std::runtime_error("interiorFilmRSI must be ≥ 0");
    if (in.exteriorFilmRSI < 0.0)
        throw std::runtime_error("exteriorFilmRSI must be ≥ 0");
    if (in.areaM2 <= 0.0)
        throw std::runtime_error("areaM2 must be > 0");

    double sumR = 0.0;
    for (const auto& L : in.layers) {
        if (L.thicknessMm <= 0.0 || L.conductivityWmk <= 0.0)
            throw std::runtime_error("each layer must have positive d and k");
        sumR += (L.thicknessMm / 1000.0) / L.conductivityWmk;
    }
    const double totalR = sumR + in.interiorFilmRSI + in.exteriorFilmRSI;
    if (totalR <= 0.0)
        throw std::runtime_error("totalRSI must be > 0");
    const double U = 1.0 / totalR;
    const double Q = U * in.areaM2 * in.designDeltaTKelvin;

    Result r;
    r.layerSumRSI = sumR;
    r.totalRSI    = totalR;
    r.uValueWm2K  = U;
    r.heatFlowW   = Q;
    return r;
}

}  // namespace forge::uvalue
