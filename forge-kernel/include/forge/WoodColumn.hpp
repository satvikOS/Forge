// Forge-274 — Wood column buckling (NDS 2018 §3.7 column stability).
//
// Reference design value F_c is adjusted by the cumulative product of
// applicable factors plus the column-stability factor C_p:
//
//   F'_c = F_c · C_D · C_M · C_t · C_F · C_i · C_p
//
// Column-stability factor (§3.7.1):
//   Slenderness:     λ = l_e / d
//   Euler stress:    F_cE = 0.822 · E'_min / λ²
//   F*_c = F_c · all adjustments except C_p
//   α = F_cE / F*_c
//   C_p = (1+α)/(2c) − √( ((1+α)/(2c))² − α/c )
//
// c = 0.8 for sawn lumber, 0.85 for round timber poles & piles,
//     0.9 for glulam & structural composite lumber.
//
// Allowable axial:  P_allow = F'_c · A

#pragma once

namespace forge::woodcolumn {

enum class ColumnType { SawnLumber, RoundTimber, Glulam };

struct Input {
    double referenceFcMPa;
    double emin_MPa;
    double areaMm2;
    double effectiveLengthMm;
    double leastDimensionMm;
    ColumnType columnType;
    double cD;
    double cM;
    double cT;
    double cF;
    double cI;
};

struct Result {
    double slendernessLeOverD;
    double fStarCMPa;
    double fcEMPa;
    double alphaRatio;
    double cFactor;          // 0.8 / 0.85 / 0.9
    double cP;
    double fcPrimeMPa;
    double pAllowN;
};

Result analyse(const Input& in);

}  // namespace forge::woodcolumn
