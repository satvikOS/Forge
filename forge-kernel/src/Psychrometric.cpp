#include "forge/Psychrometric.hpp"

#include <cmath>
#include <stdexcept>

namespace forge { namespace psychro {

namespace {

constexpr double T_K_AT_0C = 273.15;

// Hyland-Wexler 1983. T in Kelvin.
// Over ice (T < 273.15)
double psIce(double T) {
    const double C1 = -5.6745359e3;
    const double C2 =  6.3925247;
    const double C3 = -9.677843e-3;
    const double C4 =  6.2215701e-7;
    const double C5 =  2.0747825e-9;
    const double C6 = -9.484024e-13;
    const double C7 =  4.1635019;
    return std::exp(C1 / T + C2 + C3 * T + C4 * T * T + C5 * T * T * T
                  + C6 * T * T * T * T + C7 * std::log(T));
}
// Over water (T >= 273.15)
double psWater(double T) {
    const double C8  = -5.8002206e3;
    const double C9  =  1.3914993;
    const double C10 = -4.8640239e-2;
    const double C11 =  4.1764768e-5;
    const double C12 = -1.4452093e-8;
    const double C13 =  6.5459673;
    return std::exp(C8 / T + C9 + C10 * T + C11 * T * T + C12 * T * T * T
                  + C13 * std::log(T));
}

} // anonymous namespace

double saturationPressurePa(double tempC) {
    const double T = tempC + T_K_AT_0C;
    if (T < T_K_AT_0C) return psIce(T);
    return psWater(T);
}

double humidityRatio(double pwPa, double pAtmPa) {
    if (pwPa < 0) pwPa = 0;
    if (pwPa >= pAtmPa) pwPa = pAtmPa - 1.0;
    return 0.621945 * pwPa / (pAtmPa - pwPa);
}

double enthalpyKJperKg(double tempC, double W) {
    return 1.006 * tempC + W * (2501.0 + 1.86 * tempC);
}

double dewPointC(double pwPa) {
    if (pwPa <= 0) return -100.0;
    // Newton-Raphson on f(T) = ps(T) − pw with bracket [-60, 100]°C.
    double T = 10.0;
    for (int i = 0; i < 60; ++i) {
        const double ps = saturationPressurePa(T);
        if (std::abs(ps - pwPa) < pwPa * 1e-7) break;
        // Numerical derivative.
        const double dT = 0.001;
        const double psd = saturationPressurePa(T + dT);
        const double slope = (psd - ps) / dT;
        if (std::abs(slope) < 1e-12) break;
        T -= (ps - pwPa) / slope;
        if (T < -60) T = -60;
        if (T > 100) T = 100;
    }
    return T;
}

double wetBulbC(double tdbC, double W, double pAtmPa) {
    // Adiabatic-saturation equation:
    //   (W_sat(Twb) − W)·(2501 − 2.381·Twb) = 1.006·(Tdb − Twb) − W·1.86·(Tdb − Twb)
    // Solve for Twb via bisection in [Tdew, Tdb] (Twb is between).
    const double pw = humidityRatio(0, 0) >= 0 ? 0 : 0; // dummy
    (void)pw;
    // We don't have pw directly here; recover from W:
    //   W = 0.622·pw/(P−pw) → pw = W·P/(0.622+W)
    const double pwActual = W * pAtmPa / (0.621945 + W);
    const double tdp = dewPointC(pwActual);
    double lo = tdp, hi = tdbC;
    if (lo > hi) lo = hi - 0.1;
    auto residual = [&](double twb) {
        const double ws  = humidityRatio(saturationPressurePa(twb), pAtmPa);
        const double lhs = (ws - W) * (2501.0 - 2.381 * twb);
        const double rhs = 1.006 * (tdbC - twb) - W * 1.86 * (tdbC - twb);
        return lhs - rhs;
    };
    double rLo = residual(lo);
    double rHi = residual(hi);
    if (rLo * rHi > 0) {
        // Fallback if no bracket — Twb pinned to dry bulb (saturated air).
        return tdbC;
    }
    for (int i = 0; i < 60; ++i) {
        const double mid = 0.5 * (lo + hi);
        const double r = residual(mid);
        if (std::abs(r) < 1e-4) return mid;
        if (r * rLo < 0) { hi = mid; rHi = r; }
        else             { lo = mid; rLo = r; }
        if (hi - lo < 1e-4) return mid;
    }
    return 0.5 * (lo + hi);
}

namespace {

int countBits(int x) {
    int c = 0;
    while (x) { c += x & 1; x >>= 1; }
    return c;
}

} // anonymous namespace

State stateFromTwo(int whichMask, double a, double b, double pAtmPa) {
    if (countBits(whichMask) != 2) {
        throw std::invalid_argument(
            "forge.psychro: whichMask must have exactly 2 bits set");
    }
    if (pAtmPa <= 0) {
        throw std::invalid_argument("forge.psychro: pAtmPa must be > 0");
    }
    // Resolve mask flags → (Tdb, RH, W, Tdp, Twb, h) ↔ a, b.
    enum Flags { TDB = 1, RH = 2, W = 4, TDP = 8, TWB = 16, H = 32 };

    double tdb = 0, rh = 0, w = 0, tdp = 0, twb = 0, h = 0;
    bool haveTdb = false, haveRh = false, haveW = false,
         haveTdp = false, haveTwb = false, haveH = false;

    auto assign = [&](int flag, double v) {
        switch (flag) {
          case TDB: tdb = v; haveTdb = true; break;
          case RH:  rh  = v; haveRh  = true; break;
          case W:   w   = v; haveW   = true; break;
          case TDP: tdp = v; haveTdp = true; break;
          case TWB: twb = v; haveTwb = true; break;
          case H:   h   = v; haveH   = true; break;
        }
    };

    int hi = whichMask;
    // First-set-bit branches.
    int firstFlag = 0;
    for (int f = 1; f <= 32; f <<= 1) {
        if (hi & f) { firstFlag = f; break; }
    }
    assign(firstFlag, a);
    hi &= ~firstFlag;
    int secondFlag = 0;
    for (int f = 1; f <= 32; f <<= 1) {
        if (hi & f) { secondFlag = f; break; }
    }
    assign(secondFlag, b);

    // Resolve to (Tdb, W) first (canonical), then derive the rest.
    double pw = 0;
    if (haveTdb && haveRh) {
        const double ps = saturationPressurePa(tdb);
        pw = rh * ps;
        w = humidityRatio(pw, pAtmPa);
    } else if (haveTdb && haveW) {
        pw = w * pAtmPa / (0.621945 + w);
        rh = pw / saturationPressurePa(tdb);
    } else if (haveTdb && haveTdp) {
        pw = saturationPressurePa(tdp);
        w = humidityRatio(pw, pAtmPa);
        rh = pw / saturationPressurePa(tdb);
    } else if (haveTdb && haveTwb) {
        // Iterate W until wetBulb(tdb, W) ≈ twb.
        double lo = 0.0, hi2 = 0.04;
        for (int it = 0; it < 60; ++it) {
            const double mid = 0.5 * (lo + hi2);
            const double pred = wetBulbC(tdb, mid, pAtmPa);
            if (pred > twb) hi2 = mid; else lo = mid;
            if (hi2 - lo < 1e-7) break;
        }
        w = 0.5 * (lo + hi2);
        pw = w * pAtmPa / (0.621945 + w);
        rh = pw / saturationPressurePa(tdb);
    } else if (haveTdb && haveH) {
        // h = 1.006·Tdb + W·(2501 + 1.86·Tdb)  →  W = (h − 1.006·Tdb)/(2501+1.86·Tdb)
        w = (h - 1.006 * tdb) / (2501.0 + 1.86 * tdb);
        pw = w * pAtmPa / (0.621945 + w);
        rh = pw / saturationPressurePa(tdb);
    } else if (haveRh && haveTdp) {
        pw = saturationPressurePa(tdp);
        const double ps = pw / rh;
        // Recover Tdb such that ps(Tdb) = ps.
        tdb = dewPointC(ps);
        w = humidityRatio(pw, pAtmPa);
    } else if (haveW && haveTdp) {
        pw = saturationPressurePa(tdp);
        w  = humidityRatio(pw, pAtmPa);
        // Use h and W? Not unique without one of Tdb, h, Twb.
        // Falls back: tdb ≈ Tdp (saturated air).
        tdb = tdp;
        rh = 1.0;
    } else if (haveW && haveH) {
        // h = 1.006·Tdb + w·(2501 + 1.86·Tdb)
        tdb = (h - w * 2501.0) / (1.006 + w * 1.86);
        pw = w * pAtmPa / (0.621945 + w);
        rh = pw / saturationPressurePa(tdb);
    } else {
        throw std::invalid_argument(
            "forge.psychro: this 2-input pair is not yet supported in this slice");
    }
    if (!std::isfinite(w)) w = 0;
    const double ps = saturationPressurePa(tdb);
    if (pw == 0) pw = w * pAtmPa / (0.621945 + w);

    State R;
    R.tdbC            = tdb;
    R.rh              = pw / ps;
    R.humidityRatio   = w;
    R.tdpC            = dewPointC(pw);
    R.twbC            = wetBulbC(tdb, w, pAtmPa);
    R.enthalpyKJperKg = enthalpyKJperKg(tdb, w);
    R.vapourPressurePa= pw;
    R.satPressurePa   = ps;
    R.atmPressurePa   = pAtmPa;
    return R;
}

}} // namespace forge::psychro
