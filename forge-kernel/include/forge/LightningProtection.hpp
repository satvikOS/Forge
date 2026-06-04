// Forge-322e — Rolling-sphere lightning protection (NFPA 780-2023 §4.8.3,
// IEC 62305-3 Annex B).
//   r_p(h) = √(h · (2R − h))        ground-level protected radius for single mast
//   R: 20 m (Class I), 30 m (II), 45 m (III), 60 m (IV)

#pragma once

namespace forge::lightning {

struct Input {
    double rollingSphereRadiusM;    // R per IEC 62305 Class
    double mastHeightM;             // h
    double protectedObjectHeightM;  // 0 for ground level
};

struct Result {
    double groundProtectedRadiusM;        // r_p at ground level
    double objectProtectedRadiusM;        // r_p at object height (if h ≥ h_obj)
    double maximumProtectionConeRatio;    // r/h at base
};

Result analyse(const Input& in);

}  // namespace forge::lightning
