// forge/native/mesh/Smooth.cpp
//
// Implementation of forge::native::mesh::taubinSmooth — shrink-free Taubin
// (lambda/mu) mesh smoothing. Pure C++20, no external dependencies. See
// Smooth.hpp for the honest scope / preservation guarantees.
//
// The algorithm only MOVES vertices over a FIXED topology, so we do not need a
// mutable half-edge engine here: we build the kernel's immutable HalfEdgeMesh
// once to (a) validate the input is a real 2-manifold, (b) extract the uniform
// 1-ring adjacency (the "umbrella" Laplacian's neighbour sets), and (c) flag
// boundary vertices (those touched by a twin-less half-edge). We then run the
// alternating +lambda / -mu Laplacian sweeps on a plain position array and round-
// trip the result back through HalfEdgeMesh::buildFromSoup + validate() so that
// ok==true is only ever returned for a genuine 2-manifold mesh.

#include "forge/native/mesh/Smooth.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

// Reuse the kernel types/headers by #include only (per spec). We do NOT call any
// symbol whose translation unit is not on the build line (e.g. the exact
// predicates in Predicates.cpp); these includes give us the shared types and
// keep the module wired into the kernel's header graph. Taubin smoothing is a
// linear vertex filter with no half-edge surgery, so there is no combinatorial
// decision for an exact predicate to guard — the connectivity is preserved
// exactly (integer index bookkeeping is untouched).
#include "forge/native/Predicates.hpp"  // exact orient/insphere (declarations)
#include "forge/native/geom/Geom.hpp"   // Point2 / Point3 (shared geom types)

#include <cstdint>
#include <cstddef>
#include <cmath>
#include <vector>
#include <algorithm>

namespace forge {
namespace native {
namespace mesh {

namespace {

inline bool finite3(double a, double b, double c) {
    return std::isfinite(a) && std::isfinite(b) && std::isfinite(c);
}

} // namespace

SmoothReport taubinSmooth(const std::vector<double>&        positions,
                          const std::vector<std::uint32_t>& indices,
                          const SmoothOptions&              options,
                          std::vector<double>&              outPositions,
                          std::vector<std::uint32_t>&       outIndices) {
    SmoothReport rep;
    rep.lambda = options.lambda;
    rep.mu     = options.mu;
    outPositions.clear();
    outIndices.clear();

    // ── 0-FAKES: validate the parameters up front ────────────────────────────
    if (options.iterations < 0) { rep.reason = "iterations < 0"; return rep; }

    if (positions.empty() || positions.size() % 3 != 0) {
        rep.reason = "positions empty or not a multiple of 3";
        return rep;
    }
    if (indices.empty() || indices.size() % 3 != 0) {
        rep.reason = "indices empty or not a multiple of 3";
        return rep;
    }

    // lambda / mu must be finite and satisfy the shrink-free band 0 < lambda < -mu
    // (only enforced when we actually filter; for iterations == 0 the factors are
    // never used, so the identity path below does not require them to be valid).
    if (options.iterations > 0) {
        if (!std::isfinite(options.lambda) || !std::isfinite(options.mu)) {
            rep.reason = "lambda/mu not finite";
            return rep;
        }
        if (!(options.lambda > 0.0)) {
            rep.reason = "lambda must be > 0";
            return rep;
        }
        if (!(options.mu < 0.0)) {
            rep.reason = "mu must be < 0";
            return rep;
        }
        if (!(-options.mu > options.lambda)) {
            // |mu| must exceed lambda so the combined filter is shrink-free with a
            // POSITIVE pass-band boundary k_PB = 1/lambda + 1/mu > 0.
            rep.reason = "require |mu| > lambda (shrink-free band)";
            return rep;
        }
    }

    // ── build the kernel half-edge mesh: this also validates 2-manifoldness ──
    HalfEdgeMesh mesh;
    if (!mesh.buildFromSoup(positions, indices)) {
        rep.reason = "buildFromSoup failed (non-manifold / bad index / degenerate face)";
        return rep;
    }
    ValidityReport vin = mesh.validate();
    if (!vin.twinsConsistent || !vin.manifold) {
        rep.reason = "input is not a consistent 2-manifold";
        return rep;
    }

    const std::vector<Vertex>&   V = mesh.vertices();
    const std::vector<HalfEdge>& H = mesh.halfEdges();

    const std::uint32_t nv = static_cast<std::uint32_t>(V.size());
    rep.numVertices = nv;
    rep.numFaces    = static_cast<std::uint32_t>(mesh.faceCount());
    rep.watertight  = vin.watertight;
    rep.manifold    = vin.manifold;
    rep.volumeBefore = mesh.signedVolume();

    // ── extract the uniform 1-ring adjacency + flag boundary vertices ────────
    // A half-edge h: origin(h) -> dest(h). dest(h) = origin(next(h)). Every
    // undirected edge {a,b} contributes b to a's neighbour set and a to b's.
    // We deduplicate per-vertex (a vertex appears at most once per neighbour).
    std::vector<std::vector<std::uint32_t>> ring(nv);
    std::vector<unsigned char> isBoundary(nv, 0u);

    auto dest = [&](std::uint32_t h) -> std::uint32_t {
        return H[H[h].next].origin;
    };

    for (std::uint32_t h = 0; h < static_cast<std::uint32_t>(H.size()); ++h) {
        std::uint32_t a = H[h].origin;
        std::uint32_t b = dest(h);
        if (a >= nv || b >= nv) { rep.reason = "internal: bad half-edge origin"; return rep; }
        // boundary detection: a twin-less half-edge marks BOTH its endpoints as
        // boundary vertices (they lie on the open boundary polyline).
        if (H[h].twin == kInvalid) { isBoundary[a] = 1u; isBoundary[b] = 1u; }
        // add b to a's ring (dedup). Each directed half-edge adds its dest to its
        // origin; the twin (or the opposing face's half-edge) supplies the reverse.
        auto& ra = ring[a];
        if (std::find(ra.begin(), ra.end(), b) == ra.end()) ra.push_back(b);
    }

    // Count boundary vs interior (movable) vertices for the report.
    for (std::uint32_t v = 0; v < nv; ++v) {
        if (isBoundary[v]) ++rep.boundaryVertices;
        else               ++rep.movedVertices;
    }

    // ── working positions (double-buffered) ──────────────────────────────────
    std::vector<double> P = positions;   // current
    std::vector<double> Q = positions;   // scratch / next

    // Pass-band boundary k_PB = 1/lambda + 1/mu (only meaningful when filtering).
    if (options.iterations > 0) {
        rep.passBandFreq = 1.0 / options.lambda + 1.0 / options.mu;
    }

    // One uniform-Laplacian sweep with factor `factor`:
    //   p_i' = p_i + factor * ( mean(neighbours) - p_i )
    // Boundary vertices are PINNED (default) or smoothed only along their two
    // boundary neighbours (smoothBoundaryAlongCurve). Reads from `src`, writes
    // `dst`. Returns false only on a non-finite result (0-fakes guard).
    auto sweep = [&](const std::vector<double>& src, std::vector<double>& dst,
                     double factor) -> bool {
        for (std::uint32_t v = 0; v < nv; ++v) {
            const double px = src[3*v], py = src[3*v+1], pz = src[3*v+2];

            if (isBoundary[v]) {
                if (!options.smoothBoundaryAlongCurve) {
                    // pinned: copy through unchanged
                    dst[3*v] = px; dst[3*v+1] = py; dst[3*v+2] = pz;
                    continue;
                }
                // smooth along the 1-D boundary curve only: use ONLY the
                // neighbours that are themselves boundary vertices (the two
                // boundary-polyline neighbours of an open-mesh boundary vertex).
                double cx = 0, cy = 0, cz = 0; std::uint32_t m = 0;
                for (std::uint32_t nb : ring[v]) {
                    if (!isBoundary[nb]) continue;
                    cx += src[3*nb]; cy += src[3*nb+1]; cz += src[3*nb+2]; ++m;
                }
                if (m == 0) { dst[3*v]=px; dst[3*v+1]=py; dst[3*v+2]=pz; continue; }
                const double inv = 1.0 / static_cast<double>(m);
                cx *= inv; cy *= inv; cz *= inv;
                double nx = px + factor * (cx - px);
                double ny = py + factor * (cy - py);
                double nz = pz + factor * (cz - pz);
                if (!finite3(nx, ny, nz)) return false;
                dst[3*v]=nx; dst[3*v+1]=ny; dst[3*v+2]=nz;
                continue;
            }

            // interior vertex: full uniform 1-ring umbrella Laplacian.
            const std::vector<std::uint32_t>& r = ring[v];
            if (r.empty()) {
                // isolated vertex (no incident edge) — leave it where it is.
                dst[3*v] = px; dst[3*v+1] = py; dst[3*v+2] = pz;
                continue;
            }
            double cx = 0, cy = 0, cz = 0;
            for (std::uint32_t nb : r) { cx += src[3*nb]; cy += src[3*nb+1]; cz += src[3*nb+2]; }
            const double inv = 1.0 / static_cast<double>(r.size());
            cx *= inv; cy *= inv; cz *= inv;
            double nx = px + factor * (cx - px);
            double ny = py + factor * (cy - py);
            double nz = pz + factor * (cz - pz);
            if (!finite3(nx, ny, nz)) return false;
            dst[3*v]=nx; dst[3*v+1]=ny; dst[3*v+2]=nz;
        }
        return true;
    };

    // ── N full Taubin passes: each is (+lambda) then (-mu) ───────────────────
    for (int it = 0; it < options.iterations; ++it) {
        // shrinking (low-pass) sweep with +lambda: P -> Q
        if (!sweep(P, Q, options.lambda)) {
            rep.reason = "non-finite vertex during lambda sweep";
            outPositions.clear(); outIndices.clear();
            return rep;
        }
        // un-shrinking (high-pass / inflate) sweep with mu (< 0): Q -> P
        if (!sweep(Q, P, options.mu)) {
            rep.reason = "non-finite vertex during mu sweep";
            outPositions.clear(); outIndices.clear();
            return rep;
        }
        ++rep.passes;
    }
    rep.laplacianSweeps = rep.passes * 2;

    // ── re-audit the result as a genuine 2-manifold (0-fakes) ────────────────
    // Connectivity is identical to the input by construction; only positions
    // moved. We still rebuild + validate so ok==true is earned, not asserted.
    HalfEdgeMesh outMesh;
    if (!outMesh.buildFromSoup(P, indices)) {
        rep.reason = "smoothed soup failed re-audit (buildFromSoup)";
        outPositions.clear(); outIndices.clear();
        return rep;
    }
    ValidityReport vout = outMesh.validate();
    if (!vout.twinsConsistent || !vout.manifold) {
        rep.reason = "smoothed soup is not a 2-manifold";
        outPositions.clear(); outIndices.clear();
        return rep;
    }
    // watertightness must be exactly preserved (a closed mesh stays closed).
    if (vout.watertight != vin.watertight) {
        rep.reason = "watertightness changed (should be impossible)";
        outPositions.clear(); outIndices.clear();
        return rep;
    }

    rep.watertight  = vout.watertight;
    rep.manifold    = vout.manifold;
    rep.volumeAfter = outMesh.signedVolume();

    // success — emit the smoothed positions with the UNCHANGED connectivity.
    outPositions = std::move(P);
    outIndices   = indices;
    rep.ok = true;
    rep.reason = "ok";
    return rep;
}

} // namespace mesh
} // namespace native
} // namespace forge
