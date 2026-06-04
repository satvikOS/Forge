#include "forge/Reverberation.hpp"

#include <algorithm>
#include <stdexcept>

namespace forge::reverb {

Result analyse(const Input& in) {
    if (in.roomVolume_m3 <= 0)         throw std::runtime_error("V > 0");
    if (in.surfaces.empty())           throw std::runtime_error("surfaces > 0");

    double A = 0.0;
    for (const auto& s : in.surfaces) {
        if (s.area_m2 <= 0)            throw std::runtime_error("S > 0");
        if (s.absorption_alpha < 0 || s.absorption_alpha > 1)
            throw std::runtime_error("α in [0, 1]");
        A += s.absorption_alpha * s.area_m2;
    }
    if (A <= 0)                        throw std::runtime_error("Σα·S > 0");

    const double T60 = 0.161 * in.roomVolume_m3 / A;
    double STI = 1.0 - (T60 - 0.5) / 1.5;
    STI = std::clamp(STI, 0.0, 1.0);

    Result r;
    r.absorptionTotal_m2 = A;
    r.T60_s              = T60;
    r.STI_estimate       = STI;
    r.intelligible       = STI >= 0.5;
    return r;
}

}  // namespace forge::reverb
