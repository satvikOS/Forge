#include "forge/ConcreteCover.hpp"

#include <stdexcept>
#include <string>

namespace forge::cover {

Result analyse(const Input& in) {
    Result r{};
    if (in.exposureCondition == "interior") {
        r.minimumCoverMm = (in.barSize == "large") ? 40.0 : 20.0;
        r.exteriorFireRated = false;
    } else if (in.exposureCondition == "weather") {
        r.minimumCoverMm = (in.barSize == "large") ? 50.0 : 40.0;
        r.exteriorFireRated = true;
    } else if (in.exposureCondition == "earth-formed") {
        r.minimumCoverMm = 50.0;
        r.exteriorFireRated = true;
    } else if (in.exposureCondition == "earth-direct") {
        r.minimumCoverMm = 75.0;
        r.exteriorFireRated = true;
    } else {
        throw std::runtime_error("exposureCondition must be interior | weather | earth-formed | earth-direct");
    }
    if (in.barSize != "small" && in.barSize != "large")
        throw std::runtime_error("barSize must be 'small' or 'large'");
    return r;
}

}  // namespace forge::cover
