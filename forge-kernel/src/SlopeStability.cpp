#include "forge/SlopeStability.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace forge { namespace geotech {

namespace {

constexpr double PI = 3.14159265358979323846;
constexpr double GAMMA_W = 9.81; // kN/m³ — unit weight of water

inline double deg2rad(double d) { return d * PI / 180.0; }

// Linear interpolation y at xq on a monotone polyline of 2N doubles
// arranged as x0,y0,x1,y1,…,xN-1,yN-1. Returns false if xq is outside the
// polyline's x range.
bool interpY(const std::vector<double>& poly, double xq, double& y) {
    const std::size_t n = poly.size() / 2;
    if (n < 2) return false;
    if (xq < poly[0] || xq > poly[2 * (n - 1)]) return false;
    // Binary-ish linear search (n is small for slope profiles).
    for (std::size_t i = 1; i < n; ++i) {
        if (poly[2 * i] >= xq) {
            const double x0 = poly[2 * (i - 1)], y0 = poly[2 * (i - 1) + 1];
            const double x1 = poly[2 * i],       y1 = poly[2 * i + 1];
            const double dx = x1 - x0;
            const double t = (dx > 1e-12) ? (xq - x0) / dx : 0.0;
            y = y0 + t * (y1 - y0);
            return true;
        }
    }
    return false;
}

// Solve y_circle = yc − √(R² − (xq − xc)²)  for the lower-half intersection;
// returns false if (xq − xc)² > R² (outside the circle).
bool circleBaseY(double xc, double yc, double r, double xq, double& y) {
    const double dx = xq - xc;
    const double rad = r * r - dx * dx;
    if (rad < 0.0) return false;
    y = yc - std::sqrt(rad);
    return true;
}

// Find the two x-positions where a circle (xc, yc, R) intersects a ground
// surface polyline. Returns true with (xL, xR) populated if exactly two
// intersections in the polyline's x range; otherwise false.
bool findChord(const std::vector<double>& ground, double xc, double yc, double r,
               double& xL, double& xR) {
    if (ground.size() < 4) return false;
    // Find sign changes of f(x) = ground_y(x) − circle_lower_y(x).
    // f > 0 above ground (no failure), f < 0 below (in-ground), f = 0 = chord.
    auto fAt = [&](double x, double& f) -> bool {
        double gy, cy;
        if (!interpY(ground, x, gy)) return false;
        if (!circleBaseY(xc, yc, r, x, cy)) return false;
        f = gy - cy;
        return true;
    };
    // Sample at the polyline vertices + a few intermediate stations.
    const std::size_t n = ground.size() / 2;
    std::vector<double> xs;
    xs.reserve(n * 6);
    for (std::size_t i = 0; i < n; ++i) xs.push_back(ground[2 * i]);
    // Intermediate samples for higher resolution.
    const std::size_t M = n * 5;
    const double x0 = ground[0], x1 = ground[2 * (n - 1)];
    for (std::size_t i = 1; i < M; ++i) {
        xs.push_back(x0 + (x1 - x0) * static_cast<double>(i)
                          / static_cast<double>(M));
    }
    std::sort(xs.begin(), xs.end());
    xs.erase(std::unique(xs.begin(), xs.end()), xs.end());
    // Compute f(x) at all stations; pick the first and last zero-crossing.
    std::vector<double> roots;
    double prevX = xs[0], prevF = 0.0;
    bool prevValid = fAt(prevX, prevF);
    for (std::size_t i = 1; i < xs.size(); ++i) {
        double curX = xs[i], curF;
        bool curValid = fAt(curX, curF);
        if (prevValid && curValid && prevF * curF < 0.0) {
            // Linear interpolation of the root.
            const double t = prevF / (prevF - curF);
            roots.push_back(prevX + t * (curX - prevX));
        }
        prevX = curX; prevF = curF; prevValid = curValid;
    }
    if (roots.size() < 2) return false;
    xL = roots.front();
    xR = roots.back();
    if (xR - xL < 1e-6) return false;
    return true;
}

// Total weight in a vertical slice from the ground surface down to the
// circle base, accumulated layer-by-layer. Assumes the slice is narrow
// enough that we can use mid-chord linear interpolation.
struct SliceMechanics {
    double weight;        // kN per metre length (perpendicular to plane)
    double cBase;         // kPa, dominant layer at base
    double phiBase;       // deg
    double porePressure;  // kPa
};

SliceMechanics sliceMechanics(const SlopeConfig& cfg,
                              double xMid, double width,
                              double yTop, double yBase,
                              double baseLength) {
    SliceMechanics out{0.0, 0.0, 0.0, 0.0};
    if (yBase >= yTop) return out;
    // Sample the layer top of each layer at xMid. The "active" layer at a
    // given depth is the lowest layer whose top is above the depth.
    std::vector<double> layerTops;
    layerTops.reserve(cfg.layers.size());
    for (const auto& layer : cfg.layers) {
        double yt;
        if (interpY(layer.topProfile, xMid, yt)) layerTops.push_back(yt);
        else                                     layerTops.push_back(yTop);
    }
    // Per-layer slab integration: for each layer, the slab extends from
    // max(layerTop[i], yBase) at the top to layerTop[i+1] at the bottom
    // (or yBase for the last layer).
    double yWaterTable = std::numeric_limits<double>::quiet_NaN();
    if (cfg.waterTable.size() >= 4) {
        double yw;
        if (interpY(cfg.waterTable, xMid, yw)) yWaterTable = yw;
    }
    double cumWeight = 0.0;
    int    baseLayerIdx = -1;
    for (std::size_t i = 0; i < cfg.layers.size(); ++i) {
        const double zT = (i == 0) ? yTop : std::min(layerTops[i], yTop);
        const double zB = (i + 1 < cfg.layers.size())
            ? std::max(yBase, layerTops[i + 1])
            : yBase;
        if (zT <= zB) continue;
        const auto& L = cfg.layers[i];
        // Decide saturated/wet by whether the slab is below water.
        double gamma = L.gammaWet;
        if (!std::isnan(yWaterTable)) {
            if (zB < yWaterTable) {
                // Entirely or partially submerged
                const double zWeff = std::min(zT, yWaterTable);
                const double satFrac = (zWeff - zB) / std::max(1e-12, zT - zB);
                gamma = L.gammaWet * (1.0 - satFrac) + L.gammaSat * satFrac;
            }
        }
        cumWeight += gamma * (zT - zB) * width;
        baseLayerIdx = static_cast<int>(i);
    }
    if (baseLayerIdx < 0) baseLayerIdx = 0;
    if (baseLayerIdx >= static_cast<int>(cfg.layers.size())) {
        baseLayerIdx = static_cast<int>(cfg.layers.size()) - 1;
    }
    const auto& baseLayer = cfg.layers[baseLayerIdx];
    out.weight  = cumWeight;
    out.cBase   = baseLayer.cPrime;
    out.phiBase = baseLayer.phiPrime;
    // Pore pressure
    if (!std::isnan(yWaterTable) && yWaterTable > yBase) {
        out.porePressure = GAMMA_W * (yWaterTable - yBase);
    } else {
        // ru × γh formula: u = ru × γ × (depth) using mean weight/(width*depth).
        const double depth = yTop - yBase;
        if (depth > 1e-9) {
            const double avgGamma = cumWeight / (width * depth);
            out.porePressure = baseLayer.ru * avgGamma * depth;
        }
    }
    (void)baseLength;
    return out;
}

struct CircleFoS {
    double  fosBishop;
    double  fosJanbu;
    int     iters;
    std::vector<SliceResult> slices;
};

bool evaluateCircle(const SlopeConfig& cfg,
                    double xc, double yc, double r,
                    CircleFoS& out) {
    double xL, xR;
    if (!findChord(cfg.groundProfile, xc, yc, r, xL, xR)) return false;
    if (xR - xL < cfg.sliceCount * 1e-4) return false;
    const int N = std::max(4, cfg.sliceCount);
    const double sliceW = (xR - xL) / static_cast<double>(N);
    out.slices.clear();
    out.slices.reserve(N);
    // Per-slice quantities collected once.
    double sumWsinA = 0.0, sumWtanA = 0.0;
    std::vector<double> numTerms(N), wTanA(N), wSinA(N);
    for (int i = 0; i < N; ++i) {
        const double xMid = xL + (i + 0.5) * sliceW;
        double yTop;
        if (!interpY(cfg.groundProfile, xMid, yTop)) return false;
        double yBase;
        if (!circleBaseY(xc, yc, r, xMid, yBase)) return false;
        // Skip degenerate slices where chord is above ground (defensive).
        if (yBase >= yTop) return false;
        // Base angle (slope of circle at xMid w.r.t. horizontal). The
        // base is the lower half of the circle: y_base(x) = yc − √(R²−(x−xc)²)
        // dy/dx = (x − xc) / √(R² − (x − xc)²)
        const double dx = xMid - xc;
        const double rad = std::sqrt(std::max(1e-12, r * r - dx * dx));
        const double tanA = dx / rad;
        const double alpha = std::atan(tanA);
        const double cosA = std::cos(alpha);
        const double baseLen = sliceW / cosA;
        const auto sm = sliceMechanics(cfg, xMid, sliceW, yTop, yBase, baseLen);
        SliceResult sr;
        sr.xCentre      = xMid;
        sr.yBase        = yBase;
        sr.width        = sliceW;
        sr.weight       = sm.weight;
        sr.baseAngle    = alpha;
        sr.baseLength   = baseLen;
        sr.porePressure = sm.porePressure;
        sr.cBase        = sm.cBase;
        sr.phiBase      = sm.phiBase;
        out.slices.push_back(sr);
        const double tanPhi = std::tan(deg2rad(sm.phiBase));
        // Numerator term before m_α / n_α division.
        numTerms[i] = sm.cBase * baseLen
                    + (sm.weight - sm.porePressure * baseLen) * tanPhi;
        wTanA[i] = sm.weight * tanA;
        wSinA[i] = sm.weight * std::sin(alpha);
        sumWtanA += wTanA[i];
        sumWsinA += wSinA[i];
    }
    if (std::abs(sumWsinA) < 1e-6) return false;

    // Bishop simplified — iterate FoS.
    double fos = 1.0;
    int iters = 0;
    for (; iters < cfg.bishopMaxIters; ++iters) {
        double numerator = 0.0;
        for (int i = 0; i < N; ++i) {
            const double alpha = out.slices[i].baseAngle;
            const double tanPhi = std::tan(deg2rad(out.slices[i].phiBase));
            const double mA = std::cos(alpha) + std::sin(alpha) * tanPhi / fos;
            if (std::abs(mA) < 1e-9) { numerator = -1; break; }
            numerator += numTerms[i] / mA;
        }
        if (numerator < 0) return false;
        const double next = numerator / sumWsinA;
        if (!std::isfinite(next) || next <= 0.0) return false;
        if (std::abs(next - fos) < cfg.bishopTol) {
            fos = next; ++iters;
            break;
        }
        fos = next;
    }
    out.fosBishop = fos;
    out.iters = iters;

    // Janbu corrected.
    double janbuNum = 0.0;
    for (int i = 0; i < N; ++i) {
        const double alpha = out.slices[i].baseAngle;
        const double tanPhi = std::tan(deg2rad(out.slices[i].phiBase));
        const double cosA = std::cos(alpha);
        const double nA = cosA * cosA * (1.0 + std::tan(alpha) * tanPhi / fos);
        if (std::abs(nA) < 1e-9) return false;
        janbuNum += numTerms[i] / nA;
    }
    if (std::abs(sumWtanA) < 1e-6) {
        // Falls back to Bishop-like denominator (gentle slopes)
        out.fosJanbu = janbuNum / sumWsinA;
    } else {
        out.fosJanbu = janbuNum / sumWtanA;
    }
    // Janbu correction factor — depends on the c-φ mix and depth-to-length
    // ratio. Use the user override if given, else compute from circle
    // chord depth-to-length: d ≈ R − √(R²−(L/2)²), L = xR − xL.
    double f0 = cfg.janbuF0;
    if (f0 <= 0.0) {
        const double L = xR - xL;
        const double d = r - std::sqrt(std::max(0.0, r * r - 0.25 * L * L));
        const double b = 0.31; // c-φ soils
        f0 = 1.0 + b * (d / std::max(1e-6, L));
    }
    out.fosJanbu *= f0;
    return true;
}

} // anonymous namespace

SlopeResult analyse(const SlopeConfig& cfg) {
    if (cfg.groundProfile.size() < 4) {
        throw std::invalid_argument("forge.geotech: groundProfile must have ≥ 2 vertices");
    }
    if (cfg.layers.empty()) {
        throw std::invalid_argument("forge.geotech: at least one soil layer required");
    }
    if (cfg.nXc < 1 || cfg.nYc < 1 || cfg.nR < 1) {
        throw std::invalid_argument("forge.geotech: search grid dims must be ≥ 1");
    }
    if (cfg.sliceCount < 4) {
        throw std::invalid_argument("forge.geotech: sliceCount must be ≥ 4");
    }
    if (!(cfg.xcMax > cfg.xcMin) || !(cfg.ycMax > cfg.ycMin) || !(cfg.rMax > cfg.rMin)) {
        throw std::invalid_argument("forge.geotech: search ranges must satisfy max > min");
    }

    SlopeResult best;
    best.fosBishop = std::numeric_limits<double>::infinity();
    best.fosJanbu  = std::numeric_limits<double>::infinity();
    int trials = 0;
    const double dXc = (cfg.xcMax - cfg.xcMin)
                       / std::max(1, cfg.nXc - 1);
    const double dYc = (cfg.ycMax - cfg.ycMin)
                       / std::max(1, cfg.nYc - 1);
    const double dR  = (cfg.rMax  - cfg.rMin )
                       / std::max(1, cfg.nR  - 1);

    for (int ix = 0; ix < cfg.nXc; ++ix) {
        const double xc = cfg.xcMin + ix * dXc;
        for (int iy = 0; iy < cfg.nYc; ++iy) {
            const double yc = cfg.ycMin + iy * dYc;
            for (int ir = 0; ir < cfg.nR; ++ir) {
                const double r = cfg.rMin + ir * dR;
                CircleFoS f{};
                if (!evaluateCircle(cfg, xc, yc, r, f)) continue;
                if (!std::isfinite(f.fosBishop) || f.fosBishop <= 0.0) continue;
                ++trials;
                if (f.fosBishop < best.fosBishop) {
                    best.fosBishop = f.fosBishop;
                    best.fosJanbu  = f.fosJanbu;
                    best.xcCritical = xc;
                    best.ycCritical = yc;
                    best.rCritical  = r;
                    best.slices     = std::move(f.slices);
                    best.iterations = f.iters;
                    // Rebuild the slip surface as a dense polyline.
                    const std::size_t nPts = 60;
                    best.slipSurface.clear();
                    best.slipSurface.reserve(2 * nPts);
                    double xL, xR;
                    if (findChord(cfg.groundProfile, xc, yc, r, xL, xR)) {
                        for (std::size_t i = 0; i < nPts; ++i) {
                            const double t = static_cast<double>(i)
                                           / static_cast<double>(nPts - 1);
                            const double x = xL + t * (xR - xL);
                            double y;
                            if (circleBaseY(xc, yc, r, x, y)) {
                                best.slipSurface.push_back(x);
                                best.slipSurface.push_back(y);
                            }
                        }
                    }
                }
            }
        }
    }
    best.trialsEvaluated = trials;
    if (trials == 0) {
        throw std::runtime_error("forge.geotech: no valid trial circles found "
                                 "in the search grid — widen the (Xc, Yc, R) range");
    }
    return best;
}

}} // namespace forge::geotech
