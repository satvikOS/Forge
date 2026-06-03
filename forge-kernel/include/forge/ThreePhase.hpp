// Forge-244 — Three-phase AC power (balanced).
//
// Star (Y): V_LL = √3·V_ph;  I_L = I_ph.
// Delta (Δ): V_LL = V_ph;     I_L = √3·I_ph.
//
// Total balanced 3-phase power (per IEC, line-to-line basis):
//   S = √3·V_LL·I_L     (VA, apparent)
//   P = S·cosφ          (W, real)
//   Q = S·sinφ          (VAR, reactive; sign by sin)
//
// Power-factor correction (capacitor bank to raise cosφ_1 → cosφ_2):
//   φ_i = acos(pf_i)
//   ΔQ_c = P·(tanφ_1 − tanφ_2)     (VAR)
//   C    = ΔQ_c / (ω·V_LL²)        (Δ-connected single-bank, line-to-line)
//
// Per-unit conversions for 3-phase:
//   Z_base = V_LL² / S_base
//   I_base = S_base / (√3·V_LL)
//   Z_pu   = Z / Z_base

#pragma once

namespace forge::threephase {

enum class Connection { Star, Delta };

struct PowerInput {
    Connection connection;
    double lineLineVoltageV;
    double lineCurrentA;
    double powerFactor;        // cosφ ∈ [0, 1]
    bool   leading;            // true → Q negative
};

struct PowerResult {
    double phaseVoltageV;      // V_ph
    double phaseCurrentA;      // I_ph
    double apparentVA;
    double realW;
    double reactiveVAR;        // signed
};

PowerResult balancedPower(const PowerInput& in);

struct PfCorrInput {
    double realPowerW;         // P
    double powerFactor1;       // before
    double powerFactor2;       // target
    double lineLineVoltageV;   // V_LL
    double frequencyHz;        // f
};

struct PfCorrResult {
    double phi1Rad;
    double phi2Rad;
    double reactiveBeforeVAR;  // Q_1
    double reactiveAfterVAR;   // Q_2
    double capacitorVAR;       // ΔQ_c
    double capacitanceF;       // C (Δ-bank)
};

PfCorrResult powerFactorCorrection(const PfCorrInput& in);

struct PerUnitInput {
    double baseVA;
    double baseVoltageLineLineV;
    double ohmicZ;
};

struct PerUnitResult {
    double baseImpedanceOhm;
    double baseCurrentA;
    double zpu;
};

PerUnitResult perUnit(const PerUnitInput& in);

}  // namespace forge::threephase
