// Forge-327a — Mohr-Coulomb soil shear strength (Terzaghi 1925, every geotech textbook).
//   τ_f = c + σ_n · tan φ
// Total / effective stress depending on c and φ choice.

#pragma once

namespace forge::mc {

struct Input {
    double cohesionKpa;            // c (or c' for effective)
    double frictionAngleDeg;       // φ
    double normalStressKpa;        // σ_n
};

struct Result {
    double cohesionContributionKpa;
    double frictionContributionKpa;
    double shearStrengthKpa;
};

Result analyse(const Input& in);

}  // namespace forge::mc
