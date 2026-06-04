// Forge-326c — Hunter probability-curve plumbing flow (IPC, ASPE Data Book).
//   Empirical Roy Hunter (NBS BMS 65, 1940) for diversified fixture demand.
//   Approximate fit (residential, flush valve mix < 30 %):
//     Q[gpm] = 6.5·FU^0.42       for FU 5–500
//     Q[gpm] = 2.5·FU^0.55       for FU > 500
//   FU per fixture: WC tank 3, lav 1, kitchen 2, dishwasher 1.4, washing 4.

#pragma once

namespace forge::hunter {

struct Input {
    double totalFixtureUnits;       // Σ FU
    bool   flushValveMix;           // > 30 % flush-valve installations
};

struct Result {
    double designFlowGpm;
    double designFlowLps;
};

Result analyse(const Input& in);

}  // namespace forge::hunter
