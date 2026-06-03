// Forge-293 — implementation; see header for derivation references.

#include "forge/CraneHook.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::cranehook {

constexpr double PI = 3.14159265358979323846;

Result analyse(const Input& in) {
    if (in.wllKN <= 0.0)
        throw std::runtime_error("wllKN must be > 0");
    if (in.shankDiameterMm <= 0.0)
        throw std::runtime_error("shankDiameterMm must be > 0");
    if (in.shankAllowableStressMPa <= 0.0)
        throw std::runtime_error("shankAllowableStressMPa must be > 0");
    if (in.throatSectionModulusMm3 <= 0.0)
        throw std::runtime_error("throatSectionModulusMm3 must be > 0");
    if (in.throatMomentArmMm <= 0.0)
        throw std::runtime_error("throatMomentArmMm must be > 0");
    if (in.throatAllowableStressMPa <= 0.0)
        throw std::runtime_error("throatAllowableStressMPa must be > 0");

    const double A_shank = PI * in.shankDiameterMm * in.shankDiameterMm / 4.0;
    const double sigma_shank = (in.wllKN * 1000.0) / A_shank;       // MPa
    const double M_throat    = in.wllKN * 1000.0 * in.throatMomentArmMm;  // N·mm
    const double sigma_throat = M_throat / in.throatSectionModulusMm3;    // MPa

    const double dcr_shank  = sigma_shank  / in.shankAllowableStressMPa;
    const double dcr_throat = sigma_throat / in.throatAllowableStressMPa;
    const double dcr_gov    = std::max(dcr_shank, dcr_throat);

    Result r;
    r.shankAreaMm2          = A_shank;
    r.shankStressMPa        = sigma_shank;
    r.shankDCR              = dcr_shank;
    r.bendingMomentNmm      = M_throat;
    r.throatStressMPa       = sigma_throat;
    r.throatDCR             = dcr_throat;
    r.governingDCR          = dcr_gov;
    r.shankOK               = dcr_shank  <= 1.0;
    r.throatOK              = dcr_throat <= 1.0;
    r.overallOK             = r.shankOK && r.throatOK;
    return r;
}

}  // namespace forge::cranehook
