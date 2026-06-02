#include "forge/BoltJoint.hpp"

#include <stdexcept>

namespace forge { namespace boltjoint {

double computePreload(const PreloadInputs& in) {
    if (in.torque <= 0)    throw std::invalid_argument("computePreload: torque > 0");
    if (in.nutFactor <= 0) throw std::invalid_argument("computePreload: nutFactor > 0");
    if (in.diameter <= 0)  throw std::invalid_argument("computePreload: diameter > 0");
    return in.torque / (in.nutFactor * in.diameter);
}

StiffnessOutputs jointStiffness(const StiffnessInputs& in) {
    if (in.gripLength <= 0)  throw std::invalid_argument("jointStiffness: gripLength > 0");
    if (in.boltAt <= 0)      throw std::invalid_argument("jointStiffness: boltAt > 0");
    if (in.memberArea <= 0)  throw std::invalid_argument("jointStiffness: memberArea > 0");
    if (in.boltE <= 0)       throw std::invalid_argument("jointStiffness: boltE > 0");
    if (in.memberE <= 0)     throw std::invalid_argument("jointStiffness: memberE > 0");
    StiffnessOutputs out{};
    out.boltStiffness   = in.boltE   * in.boltAt     / in.gripLength;
    out.memberStiffness = in.memberE * in.memberArea / in.gripLength;
    out.loadFactor      = out.boltStiffness
                        / (out.boltStiffness + out.memberStiffness);
    return out;
}

CheckOutputs check(const CheckInputs& in) {
    if (in.tensileArea <= 0)   throw std::invalid_argument("check: tensileArea > 0");
    if (in.proofStrength <= 0) throw std::invalid_argument("check: proofStrength > 0");
    CheckOutputs out{};
    out.workingBoltForce = in.preload + in.loadFactor * in.externalLoad;
    out.workingStress    = out.workingBoltForce / in.tensileArea;
    out.proofLoad        = in.proofStrength * in.tensileArea;
    out.marginOfSafety   = (out.proofLoad / out.workingBoltForce) - 1.0;
    out.adequate         = out.marginOfSafety > 0.0;
    return out;
}

MetricBolt metricBolt(const std::string& mCode) {
    // Tensile areas per ISO 898 (mm²) → convert to m². Proof strengths
    // are class 8.8 = 580 MPa, 10.9 = 830 MPa, 12.9 = 970 MPa.
    static const struct {
        const char* code;
        double diameter_mm;
        double tensileArea_mm2;
    } TBL[] = {
        {"M3",   3.0,   5.03},
        {"M4",   4.0,   8.78},
        {"M5",   5.0,  14.18},
        {"M6",   6.0,  20.12},
        {"M8",   8.0,  36.61},
        {"M10", 10.0,  57.99},
        {"M12", 12.0,  84.27},
        {"M16", 16.0, 156.67},
        {"M20", 20.0, 244.79},
        {"M24", 24.0, 352.50},
    };
    for (const auto& row : TBL) {
        if (row.code == mCode) {
            return {
                row.diameter_mm * 1e-3,
                row.tensileArea_mm2 * 1e-6,
                580e6,
                830e6,
                970e6,
            };
        }
    }
    throw std::invalid_argument("metricBolt: unsupported M code " + mCode);
}

}} // namespace forge::boltjoint
