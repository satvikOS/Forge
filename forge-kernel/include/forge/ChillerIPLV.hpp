// Forge-324a — Chiller IPLV (AHRI Std 550/590-2020 / ASHRAE 90.1).
//   IPLV = 0.01·COP_100 + 0.42·COP_75 + 0.45·COP_50 + 0.12·COP_25

#pragma once

namespace forge::iplv {

struct Input {
    double cop100;
    double cop75;
    double cop50;
    double cop25;
};

struct Result {
    double iplv;
    double iplv_kWperTon;   // convert: 12 / (3.412·COP) → kW/ton
};

Result analyse(const Input& in);

}  // namespace forge::iplv
