// Forge-253 — IES lumen method lighting design.
//
// Illuminance E (lux) on a work plane from N luminaires of Φ lumens
// each in a rectangular room of length L × width W, height H above
// work plane h_ws:
//
//   E = (N · Φ · CU · LLF) / (L · W)
//
// Room Cavity Ratio (RCR), 9'th edition IES handbook:
//   RCR = 5 · h_rc · (L + W) / (L · W)
//   where h_rc = ceiling height − work-plane height.
//
// CU is read from a manufacturer table by RCR + reflectances. We
// approximate a typical recessed 2×2 troffer with 80/50/20
// (ceiling/wall/floor) reflectances using a polynomial fit:
//   CU(RCR) = 0.85 − 0.045·RCR + 0.0015·RCR²        for 0 ≤ RCR ≤ 10
// User can override with a measured CU value.
//
// LLF (Light Loss Factor) = LLD · LDD · BF · LSDD …
// Default 0.75 (lumens depreciation + dirt depreciation).
//
// Returns: lumens needed to hit a target E, count of luminaires for a
// given Φ, and the calculated E at a given N.

#pragma once

namespace forge::lighting {

struct RoomGeom {
    double lengthM;        // L
    double widthM;         // W
    double mountingHeightM;  // h_rc (from work plane to luminaire)
};

double roomCavityRatio(const RoomGeom& g);
double coefficientOfUtilization(double rcr);

struct LumenMethodInput {
    RoomGeom room;
    double lumensPerLuminaire;
    int    luminaireCount;       // N (0 → solve for N)
    double targetIlluminanceLux; // E_target (only used when N == 0)
    double cuOverride;           // <= 0 → use approximation
    double lightLossFactor;      // LLF
};

struct LumenMethodResult {
    double rcr;
    double cu;
    double illuminanceLux;            // E for given N (if N > 0)
    int    requiredLuminaires;        // ceil to meet E_target (if N == 0)
    double computedTotalLumens;       // N · Φ
};

LumenMethodResult lumenMethod(const LumenMethodInput& in);

}  // namespace forge::lighting
