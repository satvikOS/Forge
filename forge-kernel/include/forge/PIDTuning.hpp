// Forge-264 — PID controller tuning (Åström & Hägglund Ch. 7).
//
// Two classic auto-tuning methods:
//
// 1. Ziegler-Nichols closed-loop (ultimate gain method):
//    Given K_u (gain that produces sustained oscillation) and P_u
//    (oscillation period at K_u):
//      P    : Kp = 0.5·K_u
//      PI   : Kp = 0.45·K_u; T_i = P_u/1.2
//      PID  : Kp = 0.6·K_u;  T_i = P_u/2;  T_d = P_u/8
//
// 2. Cohen-Coon for FOPDT model G(s) = K_p · e^(−θs) / (τs + 1):
//      P   : Kp = (1/K_p)·(τ/θ)·(1 + θ/(3τ))
//      PI  : Kp = (1/K_p)·(τ/θ)·(0.9 + θ/(12τ))
//             T_i = θ · (30 + 3·θ/τ) / (9 + 20·θ/τ)
//      PID : Kp = (1/K_p)·(τ/θ)·(4/3 + θ/(4τ))
//             T_i = θ · (32 + 6·θ/τ) / (13 + 8·θ/τ)
//             T_d = θ · 4 / (11 + 2·θ/τ)
//
// All controllers expressed in parallel form:
//   u(t) = Kp·(e + (1/Ti)·∫e dt + Td·de/dt)
// (Some literature presents T_i in "minutes per repeat" — here T_i is
//  in the same time unit as θ and τ; consistent throughout.)

#pragma once

namespace forge::pidtuning {

enum class Controller { P, PI, PID };

struct ZieglerNicholsInput {
    Controller controller;
    double ultimateGainKu;
    double ultimatePeriodPuSec;
};

struct ZieglerNicholsResult {
    double Kp;
    double Ti;   // 0 for P
    double Td;   // 0 for P or PI
};

ZieglerNicholsResult zieglerNichols(const ZieglerNicholsInput& in);

struct CohenCoonInput {
    Controller controller;
    double processGainKp;     // K_p (steady-state)
    double timeConstantTau;   // τ (s)
    double deadTimeTheta;     // θ (s)
};

struct CohenCoonResult {
    double Kp;
    double Ti;
    double Td;
};

CohenCoonResult cohenCoon(const CohenCoonInput& in);

}  // namespace forge::pidtuning
