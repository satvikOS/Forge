// Forge-336e — Optical fiber link power budget (ITU-T G.957 / G.652).
//   Allowable loss A = P_tx − P_rx_sensitivity − margin
//   Loss budget breakdown:
//     A_fiber = α_dB_per_km · L
//     A_splices = N_splice · 0.1 dB
//     A_connectors = N_conn · 0.5 dB
//   Required: A_fiber + A_splices + A_connectors ≤ A.
//   Max reach L_max solved from above with safety margin.

#pragma once

namespace forge::fiberlink {

struct Input {
    double txPower_dBm;
    double rxSensitivity_dBm;       // negative number e.g., −28
    double systemMargin_dB;          // safety, typ 3 dB
    double fiberAttenuation_dBperKm; // 0.2 @1550 nm SMF, 0.35 @1310
    double linkLength_km;
    int    spliceCount;
    int    connectorCount;
    double spliceLoss_dB;            // 0.1 typ
    double connectorLoss_dB;         // 0.5 typ
};

struct Result {
    double allowableBudget_dB;
    double fiberLoss_dB;
    double spliceLoss_dB_total;
    double connectorLoss_dB_total;
    double totalLoss_dB;
    double remainingMargin_dB;
    double maxReach_km;
    bool   linkOK;
};

Result analyse(const Input& in);

}  // namespace forge::fiberlink
