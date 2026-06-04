// Forge-322b — Marshall / Superpave asphalt mix volumetrics (AASHTO T 245 / R 35).
//   G_mm  = 100 / ((W_b/G_b) + (100 − W_b)/G_a)              Rice
//   V_a   = (G_mm − G_mb) / G_mm · 100
//   VMA   = 100 − G_mb · (100 − W_b) / G_a
//   VFA   = (VMA − V_a) / VMA · 100

#pragma once

namespace forge::asphalt {

struct Input {
    double aggregateSG;            // G_a
    double asphaltSG;              // G_b (~1.02)
    double asphaltContentPct;      // W_b (%, typical 4.5-6.5)
    double bulkSG_Gmb;             // G_mb measured (compacted)
};

struct Result {
    double theoreticalMaxSG;      // G_mm
    double airVoidsPct;
    double vmaPct;
    double vfaPct;
    bool   meetsSuperpaveAirVoids;  // 3.0-5.0 %
};

Result analyse(const Input& in);

}  // namespace forge::asphalt
