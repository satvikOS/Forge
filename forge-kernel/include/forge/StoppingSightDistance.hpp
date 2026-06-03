// Forge-284 — Stopping sight distance (AASHTO Green Book §3.2.2).
//
//   SSD = v · t_perception  +  v² / (2 · a)
//
// where:
//   v               = design speed [m/s]   (convert from km/h or mph)
//   t_perception   = 2.5 s   (AASHTO standard perception-reaction time)
//   a              = effective deceleration [m/s²]:
//                       a = g · (f ± G/100)
//                       f = coefficient of friction (0.35 typical wet)
//                       G = roadway grade (%, positive uphill)
//                       g = 9.81 m/s²
//
// US customary: SSD (ft) = 1.47·V(mph)·t + V² / (30·(f ± G/100)).
//
// Validation: positive speed, t > 0, f ∈ (0, 1], G ∈ [-15, +15] %.

#pragma once

namespace forge::ssd {

struct Input {
    double designSpeedKmH;        // converts internally to m/s
    double perceptionTimeS;       // 2.5 s default
    double frictionCoefficient;   // f
    double gradePct;              // G (negative = downhill)
};

struct Result {
    double designSpeedMs;
    double effectiveDecelerationMs2;   // a
    double perceptionDistanceM;        // v·t
    double brakingDistanceM;           // v²/(2a)
    double totalSsdM;                  // sum
    double totalSsdFt;                 // m · 3.28084
};

Result analyse(const Input& in);

}  // namespace forge::ssd
