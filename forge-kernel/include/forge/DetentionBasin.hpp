// Forge-317 — Stormwater detention-basin sizing (Modified Rational Method,
// Wycoff & Singh 1976 / Williams 1950 trapezoidal hydrograph).
//
// Companion to Forge-256 hydrology (rational method peak Q only — this slice
// adds storage volume). Required for every MS4/NPDES Phase II permitted
// site to limit post-development peak discharge to pre-development levels.
//
// Pre-/post-development peak discharges (rational method):
//     Q_pre  = C_pre  · i / 3.6e6 · A_m²        m³/s
//     Q_post = C_post · i / 3.6e6 · A_m²
//
// Allowable release rate:
//     Q_release = α · Q_pre                     α = 1.0 typical (match pre-dev)
//
// Detention storage volume (trapezoidal hydrograph with storm duration T_d):
//     V_storage ≈ 60 · (Q_post − Q_release) · T_d     m³
//
// Required-detention flag: Q_post > Q_release.

#pragma once

namespace forge::detention {

struct Input {
    double areaHa;                     // A in hectares
    double runoffCoeffPre;             // C_pre (0.10 woods → 0.85 paved)
    double runoffCoeffPost;            // C_post
    double designIntensityMmHr;        // i — typical 25-yr 1-hr design IDF point
    double allowableReleaseRatio;      // α (1.0 = match pre-dev rate)
    double timeOfConcentrationMin;     // T_c (reported, not used in V calc)
    double designStormDurationMin;     // T_d ≥ T_c
};

struct Result {
    double areaM2;
    double preDevQM3PerS;
    double postDevQM3PerS;
    double allowableReleaseQM3PerS;
    double detentionVolumeM3;
    double detentionVolumeAcreFt;       // m³ × 0.000810714
    bool   detentionRequired;
};

Result analyse(const Input& in);

}  // namespace forge::detention
