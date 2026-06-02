#pragma once

// Forge-181 — Sun-path + daylight analysis.
//
// Computes solar altitude + azimuth at a given lat/lon/date/time using
// the NOAA Solar Position Algorithm (simplified spherical earth model,
// accurate to ±0.5° for architectural shading studies). Outputs:
//
//   * altitude_deg   — angle above the horizon (negative when below)
//   * azimuth_deg    — measured clockwise from true north (0 = N, 90 = E)
//   * solar_zenith_deg = 90 − altitude
//   * daylight_hours — hours between sunrise and sunset for the date
//   * declination_deg — solar declination (intermediate)
//   * eqOfTimeMin    — equation of time correction in minutes
//
// Per-hour sweep:
//   * sweepHourly(date, lat, lon, tzOffsetHours) returns 24 records
//     (one per hour of the local day) for shadow studies + dial plates.

#include <cstdint>
#include <vector>

namespace forge { namespace sun {

struct SolarPosition {
    double altitudeDeg;
    double azimuthDeg;
    double zenithDeg;
    double declinationDeg;
    double eqOfTimeMin;
    double sunriseLocalHour;   // 0..24, local clock time of sunrise
    double sunsetLocalHour;
    double daylightHours;
    bool   sunUp;              // false when below horizon
};

struct HourlySample {
    double localHour;       // 0..23.999
    SolarPosition pos;
};

// `dayOfYear` is 1..366. `latitudeDeg` north is positive, longitudeDeg
// east of Greenwich is positive. `tzOffsetHours` is the local timezone
// offset (e.g. +1 for CET, −5 for EST). `localHour` is 24-hr clock time.
SolarPosition compute(int year, int dayOfYear,
                      double localHour,
                      double latitudeDeg,
                      double longitudeDeg,
                      double tzOffsetHours);

// Returns 24 hourly samples + the rise/set summary inside each sample
// (so the renderer can plot a continuous trajectory).
std::vector<HourlySample> sweepHourly(int year, int dayOfYear,
                                      double latitudeDeg,
                                      double longitudeDeg,
                                      double tzOffsetHours);

// Annual sun-path summary: per-month sample at solar noon (alt+az +
// daylight hours), useful for stereographic polar plots.
struct MonthlyNoonSample {
    int    monthOneBased;     // 1..12
    int    dayOfYear;         // day used for the sample (21st)
    double altitudeDeg;
    double azimuthDeg;
    double daylightHours;
};

std::vector<MonthlyNoonSample> annualNoon(int year,
                                          double latitudeDeg,
                                          double longitudeDeg,
                                          double tzOffsetHours);

}} // namespace forge::sun
