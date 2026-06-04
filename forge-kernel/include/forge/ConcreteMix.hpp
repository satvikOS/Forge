// Forge-312 — Concrete mix design (ACI 211.1-91 absolute-volume method).
//
// Industry-standard procedure for proportioning normal-weight concrete by
// the absolute-volume method. Driven by three engineer-controlled targets
// (specified strength, slump, maximum aggregate size) plus material-property
// inputs (specific gravities, coarse FM and dry-rodded density). The slice
// hands back the per-cubic-metre mass of every batch ingredient ready to
// scale to any pour volume.
//
// Step 1 — Water-cement ratio from f'_c regression of Table 6.3.4(a)
//          (non-air-entrained):
//              w/c = 0.94 − 0.0085 · f'_c[MPa]                clamped [0.32, 0.82]
//
// Step 2 — Water demand from slump + max-agg interpolation of Table 6.3.3:
//              W = base(d_max) + slump_factor(slump)
//          We use the canonical 25 mm-max curve and linearly extrapolate
//          to neighbouring d_max values via a power-law fit.
//
// Step 3 — Cement = W / (w/c).
//
// Step 4 — Coarse-aggregate fraction by volume from Table 6.3.6 (FM 2.6):
//              vol_ca = lookup(d_max, FM)
//          Coarse-agg mass = vol_ca · ρ_ca,DRD (dry-rodded density).
//
// Step 5 — Absolute volumes:
//              V_c     = m_cement / (1000 · SG_cement)
//              V_w     = W / 1000
//              V_ca    = m_coarse / (1000 · SG_ca)
//              V_air   = entrained-air fraction
//              V_sand  = 1.0 − (V_c + V_w + V_ca + V_air)
//          Sand mass = V_sand · 1000 · SG_sand.

#pragma once

namespace forge::concretemix {

struct Input {
    double targetStrengthMPa;       // f'_c
    double slumpMm;                 // 50-200 typical
    double maxAggregateSizeMm;      // 10, 12, 20, 25, 40
    double airContentFraction;      // 0.015 = 1.5% non-entrained, 0.06 = severe
    double cementSpecificGravity;   // 3.15 OPC default
    double sandSpecificGravity;     // 2.65 typical
    double coarseSpecificGravity;   // 2.70 typical
    double coarseDryRoddedDensity;  // kg/m³, typical 1600
    double coarseFinenessModulus;   // ignored in this simplified version (FM=2.6 assumed)
};

struct Result {
    double waterCementRatio;
    double waterDemandKg;
    double cementMassKg;
    double coarseAggregateMassKg;
    double sandMassKg;
    double airVolumeM3;
    double cementVolumeM3;
    double waterVolumeM3;
    double coarseVolumeM3;
    double sandVolumeM3;
    double freshUnitWeightKgPerM3;
};

Result analyse(const Input& in);

}  // namespace forge::concretemix
