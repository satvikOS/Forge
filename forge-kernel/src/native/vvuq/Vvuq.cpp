// forge/native/vvuq/Vvuq.cpp
//
// Implementation of forge::native::vvuq — the simulation-credibility / VVUQ layer:
// singularity detection, mesh-convergence (Richardson/GCI) classification,
// explicit-dynamics energy monitors, CFD y+ / wall-treatment, analytic
// cross-checks, and the fit-for-purpose RED/AMBER/GREEN aggregator.
// Pure C++20, standard library only. See Vvuq.hpp for the full scope note.

#include "forge/native/vvuq/Vvuq.hpp"

#include <cmath>
#include <algorithm>
#include <numeric>
#include <vector>
#include <limits>
#include <cstddef>
#include <cstdint>

namespace forge {
namespace native {
namespace vvuq {

// ===========================================================================
// Vector math (self-contained).
// ===========================================================================
double dot(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
Vec3   cross(const Vec3& a, const Vec3& b) {
    return Vec3{ a.y * b.z - a.z * b.y,
                a.z * b.x - a.x * b.z,
                a.x * b.y - a.y * b.x };
}
Vec3   sub(const Vec3& a, const Vec3& b) { return Vec3{ a.x - b.x, a.y - b.y, a.z - b.z }; }
Vec3   add(const Vec3& a, const Vec3& b) { return Vec3{ a.x + b.x, a.y + b.y, a.z + b.z }; }
Vec3   scale(const Vec3& a, double s)    { return Vec3{ a.x * s, a.y * s, a.z * s }; }
double norm(const Vec3& a)               { return std::sqrt(dot(a, a)); }
Vec3   normalize(const Vec3& a) {
    const double n = norm(a);
    if (n <= std::numeric_limits<double>::min()) return Vec3{0.0, 0.0, 0.0};
    return scale(a, 1.0 / n);
}

namespace {

constexpr double kPi = 3.14159265358979323846;

inline bool finite(double v) { return std::isfinite(v); }

inline Vec3 vertexAt(const std::vector<double>& pos, std::uint32_t i) {
    const std::size_t k = static_cast<std::size_t>(i) * 3u;
    return Vec3{ pos[k], pos[k + 1], pos[k + 2] };
}

// Triangle centroid + (unnormalized) outward normal (CCW winding convention).
inline Vec3 triNormal(const Vec3& a, const Vec3& b, const Vec3& c) {
    return cross(sub(b, a), sub(c, a));
}

// An undirected edge keyed by its two (sorted) vertex indices.
struct EdgeKey {
    std::uint32_t a, b;
};
inline std::uint64_t edgeCode(std::uint32_t i, std::uint32_t j) {
    std::uint32_t lo = i < j ? i : j;
    std::uint32_t hi = i < j ? j : i;
    return (static_cast<std::uint64_t>(lo) << 32) | static_cast<std::uint64_t>(hi);
}

// One half-edge record: the triangle's three vertices (in winding order) + the
// opposite (third) vertex — enough to recover the face's TRUE outward normal and
// to sign the dihedral independently of how the soup wound the other face.
struct HalfEdgeRec {
    std::uint32_t tri;
    std::uint32_t v0, v1, v2;  // the triangle in its own winding order
    std::uint32_t opp;         // the third vertex of `tri` (NOT on the edge)
};

} // namespace

// ===========================================================================
// (A) SINGULARITY DETECTION
// ===========================================================================
//
// SIGNED DIHEDRAL / CONCAVITY.  For an interior edge shared by two triangles
// f0, f1 with outward normals n0, n1 and the edge directed e (consistent CCW),
// the *deviation* dihedral angle is  theta = atan2(|n0 x n1|, n0 . n1)  in
// [0, pi] — the bend away from flat. theta > sharpThreshold => SHARP.
//
// CONCAVE (re-entrant) vs CONVEX is the SIGN that a magnitude-only dihedral can
// not see: the surface folds INTO the material at a concave edge. With p1 the
// opposite vertex of f1 and pShared a point on the edge, the neighbour face
// folds toward n0's *positive* (outward) side iff dot(n0, p1 - pShared) > 0 —
// that is the re-entrant case (a cube's convex edge gives < 0). This is why a
// 90-degree convex cube edge and a 90-degree re-entrant notch — identical
// |dihedral| — are correctly distinguished.
//
// A geometric edge is a STRESS SINGULARITY site iff:
//   sharp  AND  concave (re-entrant)  AND  filletRadius == 0
//   AND incident to a loaded vertex.
// Point-load nodes and single-node prescribed-displacement nodes are ALWAYS
// singular sites (a delta-function traction/constraint => infinite stress).
std::vector<SingularitySite> detectSingularities(const SingularityInput& in) {
    std::vector<SingularitySite> sites;

    const std::size_t nIdx = in.indices.size();
    const std::size_t nPos = in.positions.size();
    const std::uint32_t nVerts = static_cast<std::uint32_t>(nPos / 3u);
    const double sharpThetaRad = in.sharpThresholdDeg * kPi / 180.0;

    // ---- geometric re-entrant / sharp-notch sites (need a valid triangle soup)
    if (nIdx >= 3 && (nIdx % 3u) == 0u && nPos >= 9 && (nPos % 3u) == 0u) {
        const std::size_t nTris = nIdx / 3u;

        // index validity guard (no UB on malformed soup)
        bool indicesOk = true;
        for (std::size_t k = 0; k < nIdx; ++k)
            if (in.indices[k] >= nVerts) { indicesOk = false; break; }

        // loaded-vertex set, validated.
        std::vector<bool> loaded(nVerts, false);
        for (std::uint32_t v : in.loadedVertices)
            if (v < nVerts) loaded[v] = true;

        if (indicesOk) {
            // Build the half-edge adjacency: for each undirected edge, collect
            // up to two (tri, opposite-vertex) records.
            std::vector<std::uint64_t> codes;
            std::vector<HalfEdgeRec>   recs;
            codes.reserve(nTris * 3u);
            recs.reserve(nTris * 3u);
            for (std::size_t t = 0; t < nTris; ++t) {
                const std::uint32_t v0 = in.indices[t * 3u + 0u];
                const std::uint32_t v1 = in.indices[t * 3u + 1u];
                const std::uint32_t v2 = in.indices[t * 3u + 2u];
                const std::uint32_t tri[3] = {v0, v1, v2};
                // edges (v0,v1)->opp v2, (v1,v2)->opp v0, (v2,v0)->opp v1
                const std::uint32_t opp[3] = {v2, v0, v1};
                for (int e = 0; e < 3; ++e) {
                    const std::uint32_t i = tri[e];
                    const std::uint32_t j = tri[(e + 1) % 3];
                    codes.push_back(edgeCode(i, j));
                    HalfEdgeRec r;
                    r.tri = static_cast<std::uint32_t>(t);
                    r.v0 = v0; r.v1 = v1; r.v2 = v2;
                    r.opp = opp[e];
                    recs.push_back(r);
                }
            }
            // Sort half-edges by undirected code so the (<=2) sharing a manifold
            // edge are adjacent.
            std::vector<std::size_t> order(codes.size());
            std::iota(order.begin(), order.end(), std::size_t{0});
            std::sort(order.begin(), order.end(),
                      [&](std::size_t a, std::size_t b) { return codes[a] < codes[b]; });

            std::size_t m = 0;
            while (m < order.size()) {
                std::size_t n = m + 1;
                while (n < order.size() && codes[order[n]] == codes[order[m]]) ++n;
                // interior manifold edge: exactly two incident faces.
                if (n - m == 2) {
                    const HalfEdgeRec& r0 = recs[order[m]];
                    const HalfEdgeRec& r1 = recs[order[m + 1]];
                    // decode the shared edge endpoints from the code.
                    const std::uint64_t code = codes[order[m]];
                    const std::uint32_t ea = static_cast<std::uint32_t>(code >> 32);
                    const std::uint32_t eb = static_cast<std::uint32_t>(code & 0xffffffffu);

                    const Vec3 A = vertexAt(in.positions, ea);
                    const Vec3 B = vertexAt(in.positions, eb);
                    const Vec3 P0 = vertexAt(in.positions, r0.opp);
                    const Vec3 P1 = vertexAt(in.positions, r1.opp);

                    // Each face's TRUE outward normal from ITS OWN winding order
                    // (NOT forced onto a shared A,B basis) — so the dihedral sign
                    // is independent of how the soup wound the neighbour face.
                    const Vec3 n0raw = triNormal(vertexAt(in.positions, r0.v0),
                                                 vertexAt(in.positions, r0.v1),
                                                 vertexAt(in.positions, r0.v2));
                    const Vec3 n1raw = triNormal(vertexAt(in.positions, r1.v0),
                                                 vertexAt(in.positions, r1.v1),
                                                 vertexAt(in.positions, r1.v2));
                    if (norm(n0raw) <= 0.0 || norm(n1raw) <= 0.0) { m = n; continue; }
                    const Vec3 n0 = normalize(n0raw);
                    const Vec3 n1 = normalize(n1raw);

                    // deviation dihedral in [0, pi] (magnitude of the bend).
                    const Vec3 cx = cross(n0, n1);
                    const double thetaRad = std::atan2(norm(cx), dot(n0, n1));
                    const double thetaDeg = thetaRad * 180.0 / kPi;
                    const bool sharp = thetaRad > sharpThetaRad;

                    // SIGNED CONCAVITY (winding-independent): a re-entrant (valley)
                    // fold is one where each face's opposite vertex sits on the
                    // OUTWARD side of the other face — the surfaces "cup" toward the
                    // material so the elastic field re-enters. Using each face's
                    // true outward normal and the OTHER face's far vertex:
                    //   concave  <=>  dot(n0, P1 - A) > 0  AND  dot(n1, P0 - A) > 0
                    // A convex (roof) edge gives both dot products < 0 (the far
                    // vertices dip below each face's outward side), so the same
                    // |dihedral| is correctly NOT flagged.
                    const double s0 = dot(n0, sub(P1, A));
                    const double s1 = dot(n1, sub(P0, A));
                    const bool concave = (s0 > 0.0) && (s1 > 0.0);

                    const bool edgeLoaded = loaded[ea] || loaded[eb];
                    const bool sharpLoaded = sharp && edgeLoaded && in.filletRadius == 0.0;

                    if (sharpLoaded && concave) {
                        SingularitySite s;
                        s.kind = SingularityKind::REENTRANT_CORNER;
                        const Vec3 mid = scale(add(A, B), 0.5);
                        s.x = mid.x; s.y = mid.y; s.z = mid.z;
                        s.dihedralDeg = 180.0 - thetaDeg; // interior opening angle
                        s.filletRadius = in.filletRadius;
                        s.note = "re-entrant corner under load: peak here is SINGULAR -- not a number";
                        sites.push_back(s);
                    } else if (sharpLoaded && !concave) {
                        // sharp + loaded + zero fillet but CONVEX: a sharp notch
                        // tip is still a stress riser the elastic FE won't resolve
                        // — but a convex sharp edge is NOT a Williams singularity,
                        // so it is NOT flagged here (proves signed, not magnitude).
                    }
                }
                m = n;
            }
        }
    }

    // ---- point-load nodes: always singular (delta-function traction)
    for (std::uint32_t v : in.pointLoadNodes) {
        SingularitySite s;
        s.kind = SingularityKind::POINT_LOAD;
        if (v < nVerts && (nPos % 3u) == 0u) {
            const Vec3 p = vertexAt(in.positions, v);
            s.x = p.x; s.y = p.y; s.z = p.z;
        }
        s.note = "concentrated point load: peak here is SINGULAR -- not a number";
        sites.push_back(s);
    }

    // ---- single-node / edge prescribed-displacement nodes: always singular
    for (std::uint32_t v : in.pointDispBCNodes) {
        SingularitySite s;
        s.kind = SingularityKind::POINT_DISP_BC;
        if (v < nVerts && (nPos % 3u) == 0u) {
            const Vec3 p = vertexAt(in.positions, v);
            s.x = p.x; s.y = p.y; s.z = p.z;
        }
        s.note = "single-node prescribed displacement: peak here is SINGULAR -- not a number";
        sites.push_back(s);
    }

    return sites;
}

bool isPeakSingular(const std::vector<SingularitySite>& sites,
                    double px, double py, double pz, double tol) {
    const double t2 = tol * tol;
    for (const auto& s : sites) {
        const double dx = s.x - px, dy = s.y - py, dz = s.z - pz;
        if (dx * dx + dy * dy + dz * dz <= t2) return true;
    }
    return false;
}

// ===========================================================================
// (B) MESH-CONVERGENCE CLASSIFICATION  (Richardson / GCI)
// ===========================================================================
//
// Levels arrive coarse->fine: h1 > h2 > h3 (finest last), with the monitored
// value at each. Using the three finest levels (f1 coarse, f2, f3 fine):
//
//   epsilon21 = f2 - f1,  epsilon32 = f3 - f2
//   refinement ratios  r21 = h1/h2,  r32 = h2/h3   (>1)
//
//   OBSERVED ORDER p  (Roache fixed-point, general non-constant ratio):
//     p = | ln|eps32/eps21| + q(p) | / ln(r21),
//       q(p) = ln( (r21^p - s) / (r32^p - s) ),   s = sign(eps32/eps21)
//     (q==0 for a constant ratio r21==r32, giving the textbook closed form).
//
//   RICHARDSON-EXTRAPOLATED (converged) value as h->0:
//     f_h0 = f3 + (f3 - f2) / (r32^p - 1)
//
//   FINE-GRID GCI (fraction):
//     GCI = Fs * |(f2 - f3)/f3| / (r32^p - 1)
//
// CONVERGING        : monotone (eps21, eps32 same sign), shrinking deltas
//                     (|eps32| < |eps21|), and 0.5 < p < ~6 (a real algebraic
//                     order). The asymptote is f_h0.
// DIVERGING_SINGULAR: monotone but GROWING deltas (|eps32| >= |eps21|): the
//                     quantity rises without bound as h->0 (the FE peak refining
//                     a singularity). Fit value ~ C * h^(-a) =>
//                       a = ln(|f3/f2|)/ln(h2/h3) > 0.
// OSCILLATORY       : eps21, eps32 opposite sign.
// INSUFFICIENT      : <3 finite levels.
ConvergenceResult classifyConvergence(const std::vector<ConvergenceLevel>& levelsIn,
                                      double safetyFactor) {
    ConvergenceResult r;

    // sanitize: need >=3 finite (h,value) with strictly positive h.
    std::vector<ConvergenceLevel> L;
    L.reserve(levelsIn.size());
    for (const auto& lv : levelsIn)
        if (finite(lv.h) && finite(lv.value) && lv.h > 0.0) L.push_back(lv);
    if (L.size() < 3) {
        r.cls = ConvergenceClass::INSUFFICIENT;
        r.reason = "fewer than 3 finite refinement levels";
        return r;
    }

    // order coarse->fine (descending h).
    std::sort(L.begin(), L.end(),
              [](const ConvergenceLevel& a, const ConvergenceLevel& b) { return a.h > b.h; });

    // take the three FINEST levels (last three after the descending sort).
    const ConvergenceLevel& c1 = L[L.size() - 3]; // coarsest of the trio
    const ConvergenceLevel& c2 = L[L.size() - 2];
    const ConvergenceLevel& c3 = L[L.size() - 1]; // finest

    const double f1 = c1.value, f2 = c2.value, f3 = c3.value;
    const double h1 = c1.h, h2 = c2.h, h3 = c3.h;
    const double r21 = h1 / h2;
    const double r32 = h2 / h3;
    const double eps21 = f2 - f1;
    const double eps32 = f3 - f2;

    const double Fs = (safetyFactor > 0.0) ? safetyFactor : 1.25;

    // degenerate: already converged (both deltas ~0).
    const double scale = 1.0 + std::fabs(f1) + std::fabs(f2) + std::fabs(f3);
    if (std::fabs(eps21) <= 1e-12 * scale && std::fabs(eps32) <= 1e-12 * scale) {
        r.cls = ConvergenceClass::CONVERGING;
        r.converging = true;
        r.monotone = true;
        r.convergedValue = f3;
        r.orderP = 0.0;
        r.gci = 0.0;
        r.reason = "already converged: refinement deltas vanish";
        return r;
    }

    // oscillatory: opposite-sign deltas (no monotone trend).
    if (eps21 * eps32 < 0.0) {
        r.cls = ConvergenceClass::OSCILLATORY;
        r.monotone = false;
        r.converging = false;
        r.reason = "oscillatory: successive refinement deltas alternate sign";
        return r;
    }

    r.monotone = true;
    // A genuinely converging algebraic sequence has |eps32|/|eps21| = r^-p < 1 by
    // a CLEAR margin (for r>=2, p>=~0.1 that ratio is <= ~0.93). Deltas that are
    // merely EQUAL (ratio ~ 1) are the signature of a LOG singularity
    // q ~ -K*ln(h): its successive deltas are constant K*ln(r), so it grows
    // without bound as h->0 yet would slip past a bare `<` test on rounding noise.
    // We therefore require the deltas to shrink by a real margin; constant (or
    // growing) deltas are NOT treated as converging.
    const double a21 = std::fabs(eps21);
    const double a32 = std::fabs(eps32);
    const double deltaRatio = (a21 > 0.0) ? (a32 / a21) : 0.0;
    const bool deltasShrinking = (a32 < a21) && (deltaRatio < 0.999);

    // ---- observed order p via Roache fixed-point (handles r21 != r32) -------
    double p = 2.0;  // start at the common FE order
    if (std::fabs(eps21) > 0.0 && std::fabs(eps32) > 0.0 && r21 > 1.0 && r32 > 1.0
        && deltasShrinking) {
        const double s = (eps32 / eps21) < 0.0 ? -1.0 : 1.0;
        const double base = std::fabs(eps32 / eps21);
        for (int it = 0; it < 50; ++it) {
            const double q = std::log((std::pow(r21, p) - s) / (std::pow(r32, p) - s));
            const double pn = std::fabs(std::log(base) + q) / std::log(r21);
            if (!finite(pn)) break;
            if (std::fabs(pn - p) < 1e-10) { p = pn; break; }
            p = pn;
        }
    }

    // ---- DIVERGING (singular): non-shrinking deltas => no asymptote ---------
    // Covers BOTH the power-law peak (growing deltas, ~h^-a) AND the log
    // singularity (constant deltas, ~ -K*ln(h)) — both grow without bound as
    // h->0 and must never be reported as a converged number.
    if (!deltasShrinking) {
        r.cls = ConvergenceClass::DIVERGING_SINGULAR;
        r.converging = false;
        // value ~ C * h^(-a): a = ln(|f3/f2|)/ln(h2/h3), using the finest pair.
        // For a log singularity the deltas are constant so this exponent comes
        // out ~0 (sub-power-law), which is itself the honest "not algebraic" tell.
        double a = 0.0;
        if (std::fabs(f2) > 0.0 && h3 > 0.0 && h2 > h3) {
            const double ratio = std::fabs(f3 / f2);
            if (ratio > 0.0)
                a = std::log(ratio) / std::log(h2 / h3);
        }
        r.divergenceExponent = a;
        r.orderP = 0.0;
        const bool constantDeltas = (deltaRatio >= 0.999);
        r.reason = constantDeltas
            ? "singular/diverging: refinement deltas do NOT shrink (~constant) -- "
              "unbounded growth as h->0 (log-type singularity, no finite asymptote)"
            : "singular/diverging: peak grows without bound as h->0 "
              "(mesh refining a singularity, ~h^-a)";
        return r;
    }

    // ---- CONVERGING: monotone, shrinking, real algebraic order --------------
    // Richardson-extrapolated converged value + fine-grid GCI.
    double fExtrap = f3;
    if (p > 0.0) {
        const double denom = std::pow(r32, p) - 1.0;
        if (std::fabs(denom) > 1e-300)
            fExtrap = f3 + (f3 - f2) / denom;
    }
    double gci = 0.0;
    if (std::fabs(f3) > 0.0 && p > 0.0) {
        const double denom = std::pow(r32, p) - 1.0;
        if (std::fabs(denom) > 1e-300)
            gci = Fs * std::fabs((f2 - f3) / f3) / denom;
    }

    r.orderP = p;
    r.convergedValue = fExtrap;
    r.gci = gci;

    const bool realOrder = (p > 0.5 && p < 6.0);
    if (realOrder) {
        r.cls = ConvergenceClass::CONVERGING;
        r.converging = true;
        r.reason = "converging: monotone to a Richardson asymptote with a real order p";
    } else if (p >= 6.0) {
        // super-high order: deltas shrank fast but the 3-grid p is super-physical
        // (often a near-converged sequence). Report converging but flag the order.
        r.cls = ConvergenceClass::CONVERGING;
        r.converging = true;
        r.reason = "converging (monotone, fast-shrinking deltas) but order p above "
                   "the asymptotic range -- GCI is indicative only";
    } else {
        // p ~ 0: the deltas shrink only marginally and Richardson degenerates to a
        // meaningless (often enormous) extrapolation. This is NOT a trustworthy
        // asymptote -- it is the non-asymptotic / near-log signature. Report it as
        // singular/non-convergent rather than fabricating a converged number.
        r.cls = ConvergenceClass::DIVERGING_SINGULAR;
        r.converging = false;
        r.convergedValue = 0.0;   // do not surface the degenerate extrapolation
        r.gci = 0.0;
        r.reason = "non-convergent: order p collapses toward 0 -- deltas barely "
                   "shrink, no trustworthy Richardson asymptote (treat as singular)";
    }
    return r;
}

// ===========================================================================
// (C) ENERGY-RATIO MONITORS  (explicit dynamics)
// ===========================================================================
EnergyAudit auditEnergy(const EnergyInput& e) {
    EnergyAudit a;
    const double IE = e.internalEnergy;
    const bool ieValid = finite(IE) && IE > 0.0;

    a.hourglassPct   = ieValid ? (e.hourglassEnergy   / IE) * 100.0 : 0.0;
    a.keIeRatio      = ieValid ? (e.kineticEnergy      / IE)         : 0.0;
    a.contactStabPct = ieValid ? (e.contactStabEnergy  / IE) * 100.0 : 0.0;

    if (!ieValid) {
        a.level = Level::AMBER;
        a.reasons.push_back("internal energy non-positive: energy ratios undefined");
        return a;
    }

    Level lvl = Level::GREEN;
    auto raise = [&lvl](Level x) { if (static_cast<int>(x) > static_cast<int>(lvl)) lvl = x; };

    // Hourglass / artificial strain energy: ASME/LS-DYNA practice.
    if (a.hourglassPct > 10.0) {
        raise(Level::RED);
        a.reasons.push_back("hourglass/artificial strain energy > 10% of internal energy");
    } else if (a.hourglassPct > 5.0) {
        raise(Level::AMBER);
        a.reasons.push_back("hourglass/artificial strain energy > 5% of internal energy");
    }

    // KE/IE for a quasi-static run: dynamic effects / abusive mass-scaling.
    if (e.quasiStatic) {
        if (a.keIeRatio > 0.05) {
            raise(Level::RED);
            a.reasons.push_back("KE/IE > 5% in a quasi-static run (dynamic effects / mass-scaling abuse)");
        } else if (a.keIeRatio > 0.02) {
            raise(Level::AMBER);
            a.reasons.push_back("KE/IE > 2% in a quasi-static run (watch dynamic effects)");
        }
    }

    // Contact-stabilization energy: artificial springs holding the contact.
    if (a.contactStabPct > 10.0) {
        raise(Level::RED);
        a.reasons.push_back("contact-stabilization energy > 10% of internal energy");
    } else if (a.contactStabPct > 5.0) {
        raise(Level::AMBER);
        a.reasons.push_back("contact-stabilization energy > 5% of internal energy");
    }

    if (a.reasons.empty())
        a.reasons.push_back("artificial energies within accepted limits");
    a.level = lvl;
    return a;
}

// ===========================================================================
// (D) y+ / WALL-TREATMENT  (CFD)
// ===========================================================================
YPlusCheck checkYPlus(double yPlus, WallTreatment treatment) {
    YPlusCheck c;
    c.yPlus = yPlus;
    c.treatment = treatment;
    c.cfdUnverified = true;  // honesty: turbulent CFD UNVERIFIED in this kernel

    switch (treatment) {
        case WallTreatment::WALL_FUNCTION: c.lo = 30.0; c.hi = 300.0; break;
        case WallTreatment::LOW_RE_RESOLVED: c.lo = 0.0; c.hi = 1.0;  break;
        case WallTreatment::AUTO_WALL: c.lo = 0.0; c.hi = 300.0;      break;
    }

    if (!finite(yPlus) || yPlus < 0.0) {
        c.inBand = false;
        c.level = Level::RED;
        c.reason = "y+ is non-finite or negative";
        return c;
    }

    c.inBand = (yPlus >= c.lo && yPlus <= c.hi);

    if (!c.inBand) {
        c.level = Level::RED;
        switch (treatment) {
            case WallTreatment::WALL_FUNCTION:
                c.reason = "y+ outside the log-law band: wall function needs 30 <= y+ <= 300";
                break;
            case WallTreatment::LOW_RE_RESOLVED:
                c.reason = "y+ too large: a wall-resolved (low-Re) model needs y+ ~ 1";
                break;
            case WallTreatment::AUTO_WALL:
                c.reason = "y+ outside the automatic-wall-treatment band (1..300)";
                break;
        }
        return c;
    }

    // In-band -> but turbulent CFD is UNVERIFIED, so cap GREEN at AMBER.
    c.level = Level::AMBER;
    switch (treatment) {
        case WallTreatment::WALL_FUNCTION:
            c.reason = "y+ in the wall-function band (30..300) -- but turbulent CFD is UNVERIFIED (capped AMBER)";
            break;
        case WallTreatment::LOW_RE_RESOLVED:
            c.reason = "y+ wall-resolved (~1) -- but turbulent CFD is UNVERIFIED (capped AMBER)";
            break;
        case WallTreatment::AUTO_WALL:
            c.reason = "y+ within automatic wall treatment -- but turbulent CFD is UNVERIFIED (capped AMBER)";
            break;
    }
    return c;
}

// ===========================================================================
// (E) ANALYTICAL / BENCHMARK CROSS-CHECK
// ===========================================================================
double cantileverTipDeflection(double P, double L, double E, double I) {
    if (E == 0.0 || I == 0.0) return 0.0;
    return P * L * L * L / (3.0 * E * I);
}
double ssBeamCenterDeflection(double P, double L, double E, double I) {
    if (E == 0.0 || I == 0.0) return 0.0;
    return P * L * L * L / (48.0 * E * I);
}
double lamePressurizedStress(double pi, double ri, double ro, double r) {
    // Hoop (circumferential) stress in an internally pressurized thick cylinder:
    //   sigma_theta(r) = pi*ri^2/(ro^2 - ri^2) * (1 + ro^2/r^2)
    const double denom = ro * ro - ri * ri;
    if (denom == 0.0 || r == 0.0) return 0.0;
    return pi * ri * ri / denom * (1.0 + (ro * ro) / (r * r));
}
double plateCenterDeflection(double q, double a, double D, double nu) {
    // Center deflection of a uniformly loaded simply-supported circular plate:
    //   w = q*a^4/(64 D) * (5 + nu)/(1 + nu)
    if (D == 0.0) return 0.0;
    return q * a * a * a * a / (64.0 * D) * (5.0 + nu) / (1.0 + nu);
}

AnalyticCheck crossCheckAnalytic(Benchmark which, double computed,
                                 const double* params, std::size_t n) {
    AnalyticCheck c;
    c.which = which;
    c.computed = computed;

    auto get = [&](std::size_t i) -> double { return (i < n && params) ? params[i] : 0.0; };

    switch (which) {
        case Benchmark::CANTILEVER_TIP:
            c.analytic = cantileverTipDeflection(get(0), get(1), get(2), get(3));
            break;
        case Benchmark::SS_BEAM_CENTER:
            c.analytic = ssBeamCenterDeflection(get(0), get(1), get(2), get(3));
            break;
        case Benchmark::LAME_THICK_CYL:
            c.analytic = lamePressurizedStress(get(0), get(1), get(2), get(3));
            break;
        case Benchmark::PLATE_CENTER:
            c.analytic = plateCenterDeflection(get(0), get(1), get(2), get(3));
            break;
        case Benchmark::CUSTOM:
            c.analytic = get(0);
            break;
    }

    if (!finite(c.analytic) || c.analytic == 0.0) {
        c.pctError = std::numeric_limits<double>::infinity();
        c.level = Level::RED;
        c.reason = "benchmark analytic value is zero/non-finite -- cannot cross-check";
        return c;
    }

    c.pctError = std::fabs(computed - c.analytic) / std::fabs(c.analytic) * 100.0;

    // Tolerances consistent with the validated static-FEA gate (0.33%).
    if (c.pctError < 2.0) {
        c.level = Level::GREEN;
        c.reason = "FE result agrees with the closed-form benchmark (< 2% error)";
    } else if (c.pctError < 10.0) {
        c.level = Level::AMBER;
        c.reason = "FE result deviates 2-10% from the closed-form benchmark";
    } else {
        c.level = Level::RED;
        c.reason = "FE result deviates >= 10% from the closed-form benchmark";
    }
    return c;
}

// ===========================================================================
// (F) FIT-FOR-PURPOSE VERDICT  (aggregator -- NEVER a bare number)
// ===========================================================================
CredibilityReport fitForPurpose(const CredibilityReport& partial) {
    CredibilityReport r = partial;
    r.reasons.clear();

    Level lvl = Level::GREEN;
    auto raise = [&lvl](Level x) { if (static_cast<int>(x) > static_cast<int>(lvl)) lvl = x; };

    // ---- (A) singularities -------------------------------------------------
    if (r.hasSingularities) {
        if (!r.singularities.empty()) {
            if (r.peakIsSingular) {
                raise(Level::RED);
                r.reasons.push_back("REPORTED PEAK sits on a stress singularity -- peak is NOT a number");
            } else {
                raise(Level::AMBER);
                r.reasons.push_back("stress singularities present in the model (peak not at one, but interpret local stresses with care)");
            }
        } else {
            r.reasons.push_back("no stress singularities detected");
        }
    }

    // ---- (B) mesh convergence ---------------------------------------------
    if (r.hasConvergence) {
        switch (r.convergence.cls) {
            case ConvergenceClass::DIVERGING_SINGULAR:
                raise(Level::RED);
                r.reasons.push_back("monitored quantity DIVERGES under refinement -- mesh is refining a singularity, no converged value");
                break;
            case ConvergenceClass::OSCILLATORY:
                raise(Level::AMBER);
                r.reasons.push_back("mesh-refinement response is oscillatory -- not yet asymptotic");
                break;
            case ConvergenceClass::INSUFFICIENT:
                raise(Level::AMBER);
                r.reasons.push_back("insufficient refinement levels to judge convergence");
                break;
            case ConvergenceClass::CONVERGING:
                if (r.convergence.gci > 0.05) {
                    raise(Level::AMBER);
                    r.reasons.push_back("converging but the fine-grid GCI (discretization uncertainty) exceeds 5%");
                } else {
                    r.reasons.push_back("mesh-converged: monotone to a Richardson asymptote with a small GCI");
                }
                break;
        }
    }

    // ---- (C) energy --------------------------------------------------------
    if (r.hasEnergy) {
        raise(r.energy.level);
        for (const char* s : r.energy.reasons) r.reasons.push_back(s);
    }

    // ---- (D) y+ / CFD (honesty: caps GREEN at AMBER) -----------------------
    if (r.hasYPlus) {
        raise(r.yplus.level);
        r.reasons.push_back(r.yplus.reason);
        if (r.yplus.cfdUnverified) {
            raise(Level::AMBER);
            r.reasons.push_back("turbulent CFD is UNVERIFIED in this kernel -- CFD verdict capped at AMBER");
        }
    }

    // ---- (E) analytic ------------------------------------------------------
    if (r.hasAnalytic) {
        raise(r.analytic.level);
        r.reasons.push_back(r.analytic.reason);
    }

    if (r.reasons.empty())
        r.reasons.push_back("all present credibility checks pass");

    r.level = lvl;
    return r;
}

} // namespace vvuq
} // namespace native
} // namespace forge
