#include "forge/SunPath.hpp"

#include <algorithm>
#include <cmath>

namespace forge { namespace sun {

namespace {

constexpr double PI = 3.14159265358979323846;
inline double deg2rad(double d) { return d * PI / 180.0; }
inline double rad2deg(double r) { return r * 180.0 / PI; }

// Iqbal (1983) Fourier series for solar declination (radians).
double declinationRad(double gammaRad) {
    return 0.006918
         - 0.399912 * std::cos(gammaRad)
         + 0.070257 * std::sin(gammaRad)
         - 0.006758 * std::cos(2.0 * gammaRad)
         + 0.000907 * std::sin(2.0 * gammaRad)
         - 0.002697 * std::cos(3.0 * gammaRad)
         + 0.001480 * std::sin(3.0 * gammaRad);
}

// Equation of time in minutes (Spencer 1971).
double eqTimeMin(double gammaRad) {
    return 229.18 * (0.000075
                   + 0.001868 * std::cos(gammaRad)
                   - 0.032077 * std::sin(gammaRad)
                   - 0.014615 * std::cos(2.0 * gammaRad)
                   - 0.040849 * std::sin(2.0 * gammaRad));
}

int dayOfYearForMonth(int year, int month) {
    // 21st of each month — typical sun-path diagram convention.
    static const int cum[] = { 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334 };
    bool leap = ((year % 4 == 0) && (year % 100 != 0)) || (year % 400 == 0);
    if (month < 1) month = 1;
    if (month > 12) month = 12;
    int base = cum[month - 1] + 21;
    if (leap && month > 2) base += 1;
    return base;
}

} // anonymous namespace

SolarPosition compute(int year, int dayOfYear,
                      double localHour,
                      double latitudeDeg,
                      double longitudeDeg,
                      double tzOffsetHours) {
    if (dayOfYear < 1) dayOfYear = 1;
    if (dayOfYear > 366) dayOfYear = 366;
    // Fractional year γ in radians.
    const double gamma = 2.0 * PI / 365.0 * (dayOfYear - 1 + (localHour - 12.0) / 24.0);
    const double declRad = declinationRad(gamma);
    const double eqTime  = eqTimeMin(gamma);
    // Time offset (minutes) between local clock and solar noon at longitude.
    const double timeOffset = eqTime + 4.0 * longitudeDeg - 60.0 * tzOffsetHours;
    // True solar time (minutes since midnight)
    const double tst = localHour * 60.0 + timeOffset;
    const double hourAngleDeg = (tst / 4.0) - 180.0;
    const double H = deg2rad(hourAngleDeg);
    const double phi = deg2rad(latitudeDeg);
    // cos(zenith) = sin(φ)sin(δ) + cos(φ)cos(δ)cos(H)
    const double cosZ = std::sin(phi) * std::sin(declRad)
                      + std::cos(phi) * std::cos(declRad) * std::cos(H);
    const double zenithRad = std::acos(std::clamp(cosZ, -1.0, 1.0));
    const double altitudeDeg = 90.0 - rad2deg(zenithRad);
    // Azimuth: cos(A) = (sin(δ) - sin(α)sin(φ)) / (cos(α)cos(φ))
    const double sinAlt = std::sin(deg2rad(altitudeDeg));
    const double cosAlt = std::cos(deg2rad(altitudeDeg));
    const double numer = std::sin(declRad) - sinAlt * std::sin(phi);
    const double denom = cosAlt * std::cos(phi);
    double azimuthDeg;
    if (std::abs(denom) < 1e-9) {
        azimuthDeg = 180.0;
    } else {
        const double cosA = std::clamp(numer / denom, -1.0, 1.0);
        azimuthDeg = rad2deg(std::acos(cosA));
        // Resolve east/west: morning → east (azimuth < 180°), afternoon
        // → west (azimuth > 180°). Hour angle < 0 is morning.
        if (hourAngleDeg > 0) azimuthDeg = 360.0 - azimuthDeg;
    }
    // Sunrise/sunset hour angle: cos(H₀) = -tan(φ)tan(δ).
    const double cosH0 = -std::tan(phi) * std::tan(declRad);
    double daylightHours = 0.0;
    double sunriseLocal = 0.0, sunsetLocal = 24.0;
    if (cosH0 > 1.0)        { daylightHours = 0.0; sunriseLocal = 12.0; sunsetLocal = 12.0; }
    else if (cosH0 < -1.0)  { daylightHours = 24.0; sunriseLocal = 0.0; sunsetLocal = 24.0; }
    else {
        const double H0 = std::acos(cosH0);
        const double H0Deg = rad2deg(H0);
        daylightHours = 2.0 * H0Deg / 15.0;
        const double noonLocal = (720.0 - timeOffset) / 60.0;   // solar noon in local clock
        sunriseLocal = noonLocal - H0Deg / 15.0;
        sunsetLocal  = noonLocal + H0Deg / 15.0;
    }
    SolarPosition s;
    s.altitudeDeg     = altitudeDeg;
    s.azimuthDeg      = azimuthDeg;
    s.zenithDeg       = rad2deg(zenithRad);
    s.declinationDeg  = rad2deg(declRad);
    s.eqOfTimeMin     = eqTime;
    s.sunriseLocalHour = sunriseLocal;
    s.sunsetLocalHour  = sunsetLocal;
    s.daylightHours    = daylightHours;
    s.sunUp            = altitudeDeg > 0;
    return s;
}

std::vector<HourlySample> sweepHourly(int year, int dayOfYear,
                                      double latitudeDeg, double longitudeDeg,
                                      double tzOffsetHours) {
    std::vector<HourlySample> out;
    out.reserve(24);
    for (int h = 0; h < 24; ++h) {
        HourlySample s;
        s.localHour = h;
        s.pos = compute(year, dayOfYear, h, latitudeDeg, longitudeDeg, tzOffsetHours);
        out.push_back(s);
    }
    return out;
}

std::vector<MonthlyNoonSample> annualNoon(int year,
                                          double latitudeDeg, double longitudeDeg,
                                          double tzOffsetHours) {
    std::vector<MonthlyNoonSample> out;
    out.reserve(12);
    for (int m = 1; m <= 12; ++m) {
        const int doy = dayOfYearForMonth(year, m);
        const auto p = compute(year, doy, 12.0, latitudeDeg, longitudeDeg, tzOffsetHours);
        MonthlyNoonSample s;
        s.monthOneBased = m;
        s.dayOfYear     = doy;
        s.altitudeDeg   = p.altitudeDeg;
        s.azimuthDeg    = p.azimuthDeg;
        s.daylightHours = p.daylightHours;
        out.push_back(s);
    }
    return out;
}

}} // namespace forge::sun
