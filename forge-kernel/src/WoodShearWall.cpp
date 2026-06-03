// Forge-292 — implementation; see header for derivation references.

#include "forge/WoodShearWall.hpp"

#include <stdexcept>

namespace forge::woodshear {

constexpr double ASPECT_LIMIT = 3.5;

Result analyse(const Input& in) {
    if (in.shearLoadKN <= 0.0)
        throw std::runtime_error("shearLoadKN must be > 0");
    if (in.wallLengthM <= 0.0)
        throw std::runtime_error("wallLengthM must be > 0");
    if (in.wallHeightM <= 0.0)
        throw std::runtime_error("wallHeightM must be > 0");
    if (in.allowableShearKNm <= 0.0)
        throw std::runtime_error("allowableShearKNm must be > 0");
    if (in.chordAreaMm2 <= 0.0)
        throw std::runtime_error("chordAreaMm2 must be > 0");
    if (in.chordAllowableStressMPa <= 0.0)
        throw std::runtime_error("chordAllowableStressMPa must be > 0");

    const double v = in.shearLoadKN / in.wallLengthM;
    const double aspect = in.wallHeightM / in.wallLengthM;
    const double T = in.shearLoadKN * in.wallHeightM / in.wallLengthM;   // kN
    const double sigma_c = (T * 1000.0) / in.chordAreaMm2;               // MPa
    const double dcr_shear = v / in.allowableShearKNm;
    const double dcr_chord = sigma_c / in.chordAllowableStressMPa;

    const bool aspectOK = aspect <= ASPECT_LIMIT;
    const bool shearOK  = dcr_shear <= 1.0;
    const bool chordOK  = dcr_chord <= 1.0;

    Result r;
    r.unitShearKNm     = v;
    r.shearDCR         = dcr_shear;
    r.aspectRatio      = aspect;
    r.aspectOK         = aspectOK;
    r.chordForceKN     = T;
    r.chordStressMPa   = sigma_c;
    r.chordDCR         = dcr_chord;
    r.shearOK          = shearOK;
    r.chordOK          = chordOK;
    r.overallOK        = aspectOK && shearOK && chordOK;
    return r;
}

}  // namespace forge::woodshear
