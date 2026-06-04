// Forge-321b — NFPA 20 fire pump sizing (simplified).
//   Q_rated = sum of all sprinkler design flows + hose allowance
//   Min H = system pressure at most remote demand + elevation + friction
//   Pump must deliver ≥ 100% rated Q at ≤ 150% rated H, and 150% rated Q at ≥ 65% rated H.

#pragma once

namespace forge::firepump {

struct Input {
    double sprinklerDemandLpm;     // hydraulic-calc design flow
    double hoseAllowanceLpm;
    double staticHeadM;            // elevation lift from tank to highest sprinkler
    double frictionLossM;          // total at design flow
    double residualPressureBar;    // required at design point (typ 0.5-1 bar)
};

struct Result {
    double ratedFlowLpm;
    double ratedPressureBar;       // = static·H/10 + friction·H/10 + residual
    double ratedHeadM;
    double pump150PercentFlowLpm;
    double pump150PercentMinPressureBar;   // 65% rated
};

Result analyse(const Input& in);

}  // namespace forge::firepump
