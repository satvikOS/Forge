#include "forge/Acoustics.hpp"

#include <algorithm>
#include <cmath>
#include <random>
#include <stdexcept>
#include <vector>

namespace forge { namespace acoustics {

namespace {

constexpr double PI = 3.14159265358979323846;

// Per-band absorption product for a mirror at (nx, ny, nz).
// For the shoebox layout, the wall sequence visited has |nx| hits on
// ±X walls, |ny| on ±Y, |nz| on ±Z. We split the count between -wall
// and +wall by parity of (nx, ny, nz).
double reflectionFactor(int nx, int ny, int nz,
                        std::size_t band,
                        const std::array<std::array<double, NUM_BANDS>, 6>& walls) {
    const int hxn = (nx > 0 ? nx : -nx + (nx == 0 ? 0 : 0));
    // Use the standard Allen-Berkley count where each axis index of
    // magnitude |n| crosses each wall (-/+) approximately |n|/2 times.
    // For simplicity we apply the average of the two opposing walls
    // raised to |n| (this preserves the harmonic average we want for
    // RT60 vs the Sabine formula).
    const int nax = std::abs(nx), nay = std::abs(ny), naz = std::abs(nz);
    const double aMx = 1.0 - walls[0][band];   // -X
    const double aPx = 1.0 - walls[1][band];   // +X
    const double aMy = 1.0 - walls[2][band];
    const double aPy = 1.0 - walls[3][band];
    const double aMz = 1.0 - walls[4][band];
    const double aPz = 1.0 - walls[5][band];
    // Geometric mean of the two walls per axis, raised to |n|.
    const double avgX = std::sqrt(std::max(1e-9, aMx * aPx));
    const double avgY = std::sqrt(std::max(1e-9, aMy * aPy));
    const double avgZ = std::sqrt(std::max(1e-9, aMz * aPz));
    const double rx = std::pow(avgX, nax);
    const double ry = std::pow(avgY, nay);
    const double rz = std::pow(avgZ, naz);
    (void)hxn;
    return rx * ry * rz;
}

// Compute the 8 image-source positions for index (nx, ny, nz).
struct Img {
    double x, y, z;
    int    nx, ny, nz;
};

void imagesFor(int nx, int ny, int nz,
               const Shoebox& room,
               double xs, double ys, double zs,
               Img out[8]) {
    const double Lx = room.Lx, Ly = room.Ly, Lz = room.Lz;
    int k = 0;
    for (int sx = 0; sx <= 1; ++sx) {
      for (int sy = 0; sy <= 1; ++sy) {
        for (int sz = 0; sz <= 1; ++sz, ++k) {
          const double X = 2.0 * nx * Lx + (sx ? -xs : xs);
          const double Y = 2.0 * ny * Ly + (sy ? -ys : ys);
          const double Z = 2.0 * nz * Lz + (sz ? -zs : zs);
          out[k] = Img{ X, Y, Z, nx, ny, nz };
        }
      }
    }
}

// Linear least-squares slope of (xs, ys) for samples within [lo, hi]
// dB. Returns the slope as dB-per-second; -infinity if too few samples
// or non-monotone EDC.
double edcSlope(const std::vector<double>& edcDb, double sampleStrideSec,
                double loDb, double hiDb) {
    std::vector<double> xs, ys;
    for (std::size_t i = 0; i < edcDb.size(); ++i) {
        const double v = edcDb[i];
        if (v <= loDb && v >= hiDb) {
            xs.push_back(static_cast<double>(i) * sampleStrideSec);
            ys.push_back(v);
        }
    }
    if (xs.size() < 4) return -1.0;
    const std::size_t n = xs.size();
    double sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (std::size_t i = 0; i < n; ++i) {
        sx += xs[i]; sy += ys[i];
        sxx += xs[i] * xs[i];
        sxy += xs[i] * ys[i];
    }
    const double denom = n * sxx - sx * sx;
    if (std::abs(denom) < 1e-9) return -1.0;
    return (n * sxy - sx * sy) / denom;
}

} // anonymous namespace

AcousticResult simulate(const AcousticConfig& cfg) {
    const Shoebox& room = cfg.room;
    if (room.Lx <= 0 || room.Ly <= 0 || room.Lz <= 0) {
        throw std::invalid_argument("forge.acoustics: room dimensions must be > 0");
    }
    if (cfg.sampleRateHz < 8000) {
        throw std::invalid_argument("forge.acoustics: sample rate must be ≥ 8000 Hz");
    }
    if (cfg.irLengthSec <= 0) {
        throw std::invalid_argument("forge.acoustics: IR length must be > 0");
    }
    if (cfg.maxOrder < 1) {
        throw std::invalid_argument("forge.acoustics: maxOrder must be ≥ 1");
    }
    if (cfg.sourceX <= 0 || cfg.sourceX >= room.Lx ||
        cfg.sourceY <= 0 || cfg.sourceY >= room.Ly ||
        cfg.sourceZ <= 0 || cfg.sourceZ >= room.Lz) {
        throw std::invalid_argument("forge.acoustics: source outside room");
    }
    if (cfg.recvX <= 0 || cfg.recvX >= room.Lx ||
        cfg.recvY <= 0 || cfg.recvY >= room.Ly ||
        cfg.recvZ <= 0 || cfg.recvZ >= room.Lz) {
        throw std::invalid_argument("forge.acoustics: receiver outside room");
    }

    const int samples = static_cast<int>(std::ceil(cfg.irLengthSec * cfg.sampleRateHz));
    const double c = cfg.speedOfSound > 0 ? cfg.speedOfSound : 343.0;

    AcousticResult R;
    R.sampleRateHz = static_cast<int>(cfg.sampleRateHz);
    R.samples = samples;
    R.irCombined.assign(samples, 0.0);
    for (std::size_t b = 0; b < NUM_BANDS; ++b) {
        R.irPerBand[b].assign(samples, 0.0);
    }

    // ----------------------- 1. Early reflections: image sources
    int imgCount = 0;
    for (int nx = -cfg.maxOrder; nx <= cfg.maxOrder; ++nx) {
      for (int ny = -cfg.maxOrder; ny <= cfg.maxOrder; ++ny) {
        for (int nz = -cfg.maxOrder; nz <= cfg.maxOrder; ++nz) {
          if (std::abs(nx) + std::abs(ny) + std::abs(nz) > cfg.maxOrder) continue;
          Img imgs[8];
          imagesFor(nx, ny, nz, room, cfg.sourceX, cfg.sourceY, cfg.sourceZ, imgs);
          for (int k = 0; k < 8; ++k) {
            const Img& I = imgs[k];
            const double dx = I.x - cfg.recvX;
            const double dy = I.y - cfg.recvY;
            const double dz = I.z - cfg.recvZ;
            const double d  = std::sqrt(dx * dx + dy * dy + dz * dz);
            if (d < 1e-3) continue;
            const int sampleIdx = static_cast<int>(d / c * cfg.sampleRateHz);
            if (sampleIdx >= samples) continue;
            ++imgCount;
            // Amplitude reaching the receiver: A = factor / d × √(W·ρ·c)
            // (we drop ρc since the constant cancels in dB ratios).
            for (std::size_t b = 0; b < NUM_BANDS; ++b) {
              const double refl = reflectionFactor(nx, ny, nz, b, room.walls);
              const double airL = std::exp(-room.airAtten[b] * d);
              const double A    = std::sqrt(cfg.sourcePowerW) / d * refl * airL;
              R.irPerBand[b][sampleIdx] += A;
            }
          }
        }
      }
    }
    R.imageSourcesEvaluated = imgCount;

    // ----------------------- 2. Statistical Eyring late tail
    // Compute per-band RT60 via Eyring/Sabine then synthesise a
    // Gaussian-noise envelope after t_early = max(150 ms, time of
    // last image source).
    const double V = room.Lx * room.Ly * room.Lz;
    const double S = 2.0 * (room.Lx * room.Ly
                          + room.Lx * room.Lz
                          + room.Ly * room.Lz);
    std::mt19937_64 rng(cfg.randomSeed);
    std::normal_distribution<double> gauss(0.0, 1.0);

    // Approx mean absorption per band.
    std::array<double, NUM_BANDS> alphaMean{};
    for (std::size_t b = 0; b < NUM_BANDS; ++b) {
      double sumA = 0.0;
      double areas[6] = {
        room.Ly * room.Lz, room.Ly * room.Lz,    // -X, +X
        room.Lx * room.Lz, room.Lx * room.Lz,    // -Y, +Y
        room.Lx * room.Ly, room.Lx * room.Ly,    // -Z, +Z
      };
      double sumS = 0;
      for (int w = 0; w < 6; ++w) {
        sumA += areas[w] * room.walls[w][b];
        sumS += areas[w];
      }
      alphaMean[b] = (sumS > 0) ? sumA / sumS : 0.2;
    }

    // Eyring RT60: T = 0.161 V / ((-S ln(1-α) + 4 m V)
    for (std::size_t b = 0; b < NUM_BANDS; ++b) {
      const double a = std::min(0.999, std::max(0.001, alphaMean[b]));
      const double denom = -S * std::log(1.0 - a) + 4.0 * room.airAtten[b] * V;
      const double RT = (denom > 0) ? 0.161 * V / denom : 0.0;
      // Stash to R.rt60Sec for diagnostic; will be overwritten by EDC fit.
      R.rt60Sec[b] = RT;
    }
    R.sabineRt60Mid = R.rt60Sec[2];  // 500 Hz band

    // Append stochastic tail to each band.
    const int tEarly = static_cast<int>(0.150 * cfg.sampleRateHz);
    for (std::size_t b = 0; b < NUM_BANDS; ++b) {
      const double tau = R.rt60Sec[b] / 6.91;  // 60/ln(10³) = 6.91
      if (tau <= 0) continue;
      // Estimate the energy at t_early — use the average squared sample
      // around tEarly to set the tail amplitude.
      double meanSq = 0; int cnt = 0;
      for (int i = std::max(0, tEarly - 100); i < std::min(samples, tEarly + 100); ++i) {
        meanSq += R.irPerBand[b][i] * R.irPerBand[b][i]; ++cnt;
      }
      const double rms = (cnt > 0 && meanSq > 0) ? std::sqrt(meanSq / cnt) : 1e-6;
      const double phase = b * PI * 0.5;
      for (int i = tEarly; i < samples; ++i) {
        const double t = (i - tEarly) / cfg.sampleRateHz;
        const double env = std::exp(-t / tau) * rms;
        const double noise = gauss(rng);
        // Band-localise the tail by modulating with the band's centre
        // frequency — gives a colour to each band's noise that matches
        // its spectral region. Without a Butterworth bank this is a
        // pragmatic substitute.
        const double mod = std::cos(2.0 * PI * BAND_HZ[b] * t + phase);
        R.irPerBand[b][i] += env * noise * mod;
      }
    }

    // ----------------------- 3. Combined IR + EDC + metrics
    for (int i = 0; i < samples; ++i) {
      double sum = 0;
      for (std::size_t b = 0; b < NUM_BANDS; ++b) sum += R.irPerBand[b][i];
      R.irCombined[i] = sum;
    }

    // Schroeder backward integration per band → EDC dB.
    R.edcStrideSamples = std::max(1, samples / 1024);
    const double strideSec = R.edcStrideSamples / cfg.sampleRateHz;
    for (std::size_t b = 0; b < NUM_BANDS; ++b) {
      std::vector<double> energy(samples + 1, 0.0);
      for (int i = samples - 1; i >= 0; --i) {
        const double s = R.irPerBand[b][i];
        energy[i] = energy[i + 1] + s * s;
      }
      const double total = energy[0];
      auto& edc = R.edcDb[b];
      edc.clear();
      if (total <= 0) { edc.assign(samples / R.edcStrideSamples + 1, -120.0); continue; }
      for (int i = 0; i < samples; i += R.edcStrideSamples) {
        const double ratio = energy[i] / total;
        edc.push_back(10.0 * std::log10(std::max(1e-12, ratio)));
      }
      // Fit RT60 from -5 → -35 dB slope.
      const double slope = edcSlope(edc, strideSec, -5.0, -35.0);
      if (slope < 0) {
        R.rt60Sec[b] = -60.0 / slope;   // extrapolate to -60 dB
      }
      // C50, C80, D50
      const int n50 = std::min(samples, static_cast<int>(0.050 * cfg.sampleRateHz));
      const int n80 = std::min(samples, static_cast<int>(0.080 * cfg.sampleRateHz));
      double e0_50 = 0, eAfter50 = 0, e0_80 = 0, eAfter80 = 0, eTot = 0;
      for (int i = 0; i < samples; ++i) {
        const double s = R.irPerBand[b][i];
        const double e = s * s;
        eTot += e;
        if (i < n50) e0_50 += e; else eAfter50 += e;
        if (i < n80) e0_80 += e; else eAfter80 += e;
      }
      R.c50Db[b] = (eAfter50 > 0) ? 10.0 * std::log10(e0_50 / eAfter50) : 60.0;
      R.c80Db[b] = (eAfter80 > 0) ? 10.0 * std::log10(e0_80 / eAfter80) : 60.0;
      R.d50[b]   = (eTot     > 0) ? e0_50 / eTot                       : 0.0;
    }
    return R;
}

}} // namespace forge::acoustics
