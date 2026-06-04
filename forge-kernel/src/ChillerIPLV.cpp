#include "forge/ChillerIPLV.hpp"

#include <stdexcept>

namespace forge::iplv {

Result analyse(const Input& in) {
    if (in.cop100 <= 0 || in.cop75 <= 0 || in.cop50 <= 0 || in.cop25 <= 0)
        throw std::runtime_error("all COP values must be > 0");

    const double iplv = 0.01 * in.cop100 + 0.42 * in.cop75
                      + 0.45 * in.cop50 + 0.12 * in.cop25;

    Result r;
    r.iplv          = iplv;
    r.iplv_kWperTon = 12.0 / (3.412 * iplv);
    return r;
}

}  // namespace forge::iplv
