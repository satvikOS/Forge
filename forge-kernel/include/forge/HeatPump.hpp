// Forge-331c — Heat-pump COP (Carnot bound + actual, Çengel §11).
//   COP_HP_Carnot = T_H / (T_H − T_C)
//   COP_COOL_Carnot = T_C / (T_H − T_C)
//   COP_actual = COP_Carnot · η_2nd          (typical η_2nd = 0.3 – 0.55)
//   Heating capacity Q_H = COP_HP_actual · W_in
//   Cooling capacity Q_C = COP_COOL_actual · W_in
//   EER = COP_COOL · 3.412     (Btu/h·W)

#pragma once

namespace forge::heatpump {

struct Input {
    double sourceTemp_C;
    double sinkTemp_C;
    double secondLawEfficiency;   // η_2nd (0 < η < 1)
    double compressorPower_kW;    // W_in
    int    mode;                  // 0 = heating, 1 = cooling
};

struct Result {
    double cop_carnot;
    double cop_actual;
    double eer_btuhPerW;
    double capacity_kW;           // Q_H or Q_C depending on mode
    double waste_kW;              // |Q_H − Q_C − W|, sanity, near zero
};

Result analyse(const Input& in);

}  // namespace forge::heatpump
