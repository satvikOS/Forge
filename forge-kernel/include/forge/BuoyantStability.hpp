// Forge-333e — Floating-body buoyancy & transverse stability (Çengel §3 + naval).
//   Volume displaced  V = m_body / ρ_fluid
//   Draught (rectangular prismatic hull):  T = V / (L · B)
//   Centre of buoyancy B is at T/2 above keel.
//   BM = I_T / V   where I_T = (L · B³) / 12   transverse waterplane moment.
//   GM = KB + BM − KG       metacentric height (KG = centre of gravity above keel).
//   Righting moment at heel angle φ:  M_R = m_body · g · GM · sin(φ)

#pragma once

namespace forge::buoyfloat {

struct Input {
    double bodyMass_kg;
    double fluidDensity_kgM3;     // 1025 sea, 1000 fresh
    double length_m;              // L hull at waterplane
    double beam_m;                // B
    double KG_m;                  // height of CG above keel
    double heelAngle_deg;
};

struct Result {
    double displacedVolume_m3;
    double draught_m;
    double KB_m;
    double BM_m;
    double GM_m;
    double rightingArm_GZ_m;
    double rightingMoment_kNm;
    bool   stable;                // GM > 0
};

Result analyse(const Input& in);

}  // namespace forge::buoyfloat
