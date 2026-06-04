// Forge-332b — Horizontal sight distance / middle ordinate (AASHTO GDHS §3.3.10).
//   m = R · (1 − cos(28.65·S/R))           m, R, S in m & deg of arc
//   if S ≤ L (sight line within curve):
//     S = (R/28.65)·arccos(1 − m/R)         m required clearance
//   For SSD as S and known m, the curve radius R is iterated, but the closed
//   form for the standard "lateral clearance" question:
//     m_avail = (R − sight obstruction offset)·...

#pragma once

namespace forge::hsd {

struct Input {
    double curveRadius_m;        // R
    double sightDistance_m;      // S (input SSD)
    double offsetAvailable_m;    // m available (clearance)
};

struct Result {
    double middleOrdinateRequired_m;     // m_req for S
    double maxSafeSightDistance_m;       // S corresponding to m_avail
    bool   meetsAvailableClearance;
};

Result analyse(const Input& in);

}  // namespace forge::hsd
