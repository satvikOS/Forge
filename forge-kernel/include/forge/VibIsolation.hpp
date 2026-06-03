// Forge-260 — Single-DoF vibration isolation (Rao Ch. 9).
//
// Natural frequency: ω_n = √(k/m)
// Damping ratio: ζ = c / (2·√(k·m))
//
// Frequency ratio r = ω/ω_n.
//
// Transmissibility (force or absolute displacement):
//   TR = √( (1 + (2ζr)²) / ((1 − r²)² + (2ζr)²) )
//
// Isolation only effective for r > √2.
//
// Required stiffness for given isolation I (= 1 − TR) at design ω:
//   r needed: TR_target = 1 − I; solve r²(1 + (2ζr)²)/((1−r²)² + (2ζr)²)
//   When damping is small (ζ ≈ 0), TR ≈ 1/(r² − 1) so r² = (1 + 1/TR_target).
//   Then k = m·ω²/r²  (Hz form: k = m·(2π·f)²/r²).

#pragma once

namespace forge::vibiso {

struct ResponseInput {
    double massKg;             // m
    double stiffnessNPerM;     // k
    double dampingCoefficientNsm;  // c
    double drivingFrequencyHz; // f
};

struct ResponseResult {
    double naturalFrequencyHz;
    double dampingRatio;
    double frequencyRatio;
    double transmissibility;
    double isolationPct;       // 100·(1 − TR), clamped ≥ 0
};

ResponseResult response(const ResponseInput& in);

struct SizingInput {
    double massKg;
    double drivingFrequencyHz;
    double targetIsolationPct;  // I (0-100), e.g. 90% isolation
    double dampingRatio;        // ζ assumed
};

struct SizingResult {
    double requiredFrequencyRatio;
    double requiredNaturalFrequencyHz;
    double requiredStiffnessNPerM;
};

SizingResult sizeIsolator(const SizingInput& in);

}  // namespace forge::vibiso
