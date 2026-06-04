// Forge-320c — Diesel-generator nameplate sizing (Cummins, Caterpillar, MTU
// applications manuals).
//
//   kVA_required = (kW_connected · diversity / pf) · altDerate · tempDerate
//   altDerate    = 1 − 0.01 · max(0, (h − 1000) / 100)        % per 100 m > 1000 m
//   tempDerate   = 1 − 0.01 · max(0, (T − 40) / 5)            % per 5 °C > 40 °C

#pragma once

namespace forge::genset {

struct Input {
    double connectedLoadKw;          // total ΣkW
    double diversityFactor;          // 0.7-0.9
    double powerFactor;              // cos φ
    double altitudeM;                // site altitude
    double ambientTempC;             // design ambient
    double fuelConsumptionLPerKwh;   // typ 0.27 L/kWh at 75 % load
    double designRuntimeHr;          // for fuel-tank sizing
};

struct Result {
    double altitudeDerateFactor;
    double temperatureDerateFactor;
    double demandKvaRaw;             // kW·div/pf
    double requiredKvaNameplate;     // with derates
    double fuelTankLiters;           // approximate
};

Result analyse(const Input& in);

}  // namespace forge::genset
