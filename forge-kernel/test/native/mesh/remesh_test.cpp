// forge/native/mesh/test/remesh_test.cpp
//
// RANDOMIZED validation gate for forge::native::mesh::remesh — incremental
// isotropic remeshing. Pure C++20, no external deps.
//
// Build + run (standalone — ONLY this module + its named deps + this test, so
// it does not race sibling agents on the rest of the tree):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/mesh/Remesh.cpp \
//       forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//       forge-kernel/test/native/mesh/remesh_test.cpp -o /tmp/k_Remesh && /tmp/k_Remesh
//
// ─────────────────────────────────────────────────────────────────────────────
// SPEC ASSERTED HERE (Manifold-class isotropic remeshing):
//   (S1) Remesh a NOISY sphere (an icosphere whose vertices are radially jittered
//        and whose triangle SIZES are deliberately non-uniform). After remeshing
//        to a target edge length L:
//          * edge-length STDDEV shrinks MARKEDLY (we require >=2x reduction, and
//            print the live ratio so it can never be cherry-picked),
//          * mean edge length lands near L,
//          * the mesh stays WATERTIGHT + 2-MANIFOLD (kernel half-edge audit),
//          * NO non-manifold edges,
//          * VOLUME is preserved within 3%.
//   (S2) Repeated on a SECOND, distinct noisy sphere (different radius / seed /
//        target) so the gate is not tuned to one fixture.
//   (S3) 0-FAKES: degenerate / unsupported inputs return ok=false honestly:
//          * target length <= 0,
//          * empty mesh,
//          * a non-manifold soup (two triangles sharing a directed edge).
//        ok=true is returned ONLY for a validated 2-manifold result; we also
//        re-audit every ok=true output independently.
//
// Fresh std::random_device seed each run (printed below).
// ─────────────────────────────────────────────────────────────────────────────

#include "forge/native/mesh/Remesh.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <cmath>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <map>
#include <random>
#include <unordered_map>
#include <vector>

using namespace forge::native::mesh;

static int g_pass = 0, g_total = 0;
static void check(bool c, const char* fmt, ...) {
    ++g_total;
    char buf[512];
    va_list ap; va_start(ap, fmt); std::vsnprintf(buf, sizeof(buf), fmt, ap); va_end(ap);
    if (c) { ++g_pass; std::printf("  [PASS] %s\n", buf); }
    else     std::printf("  [FAIL] %s\n", buf);
}

// ── build an icosphere (subdivided icosahedron), radius r, `subdiv` levels ────
static void icosphere(double r, int subdiv,
                      std::vector<double>& pos, std::vector<std::uint32_t>& idx) {
    pos.clear(); idx.clear();
    const double t = (1.0 + std::sqrt(5.0)) * 0.5;
    std::vector<std::array<double, 3>> v = {
        {-1, t, 0}, {1, t, 0}, {-1,-t, 0}, {1,-t, 0},
        {0,-1, t}, {0, 1, t}, {0,-1,-t}, {0, 1,-t},
        { t, 0,-1}, { t, 0, 1}, {-t, 0,-1}, {-t, 0, 1}
    };
    std::vector<std::array<std::uint32_t, 3>> f = {
        {0,11,5},{0,5,1},{0,1,7},{0,7,10},{0,10,11},
        {1,5,9},{5,11,4},{11,10,2},{10,7,6},{7,1,8},
        {3,9,4},{3,4,2},{3,2,6},{3,6,8},{3,8,9},
        {4,9,5},{2,4,11},{6,2,10},{8,6,7},{9,8,1}
    };
    // subdivide
    for (int s = 0; s < subdiv; ++s) {
        std::map<std::uint64_t, std::uint32_t> mid;
        auto midpoint = [&](std::uint32_t a, std::uint32_t b) {
            std::uint64_t key = a < b
                ? (static_cast<std::uint64_t>(a) << 32) | b
                : (static_cast<std::uint64_t>(b) << 32) | a;
            auto it = mid.find(key);
            if (it != mid.end()) return it->second;
            std::array<double, 3> m = {
                0.5 * (v[a][0] + v[b][0]),
                0.5 * (v[a][1] + v[b][1]),
                0.5 * (v[a][2] + v[b][2]) };
            std::uint32_t id = static_cast<std::uint32_t>(v.size());
            v.push_back(m); mid[key] = id; return id;
        };
        std::vector<std::array<std::uint32_t, 3>> nf;
        for (auto& tri : f) {
            std::uint32_t a = midpoint(tri[0], tri[1]);
            std::uint32_t b = midpoint(tri[1], tri[2]);
            std::uint32_t c = midpoint(tri[2], tri[0]);
            nf.push_back({tri[0], a, c});
            nf.push_back({tri[1], b, a});
            nf.push_back({tri[2], c, b});
            nf.push_back({a, b, c});
        }
        f.swap(nf);
    }
    // project to the sphere of radius r
    for (auto& p : v) {
        double n = std::sqrt(p[0]*p[0] + p[1]*p[1] + p[2]*p[2]);
        p[0] = p[0] / n * r; p[1] = p[1] / n * r; p[2] = p[2] / n * r;
    }
    pos.reserve(v.size() * 3);
    for (auto& p : v) { pos.push_back(p[0]); pos.push_back(p[1]); pos.push_back(p[2]); }
    idx.reserve(f.size() * 3);
    for (auto& tri : f) { idx.push_back(tri[0]); idx.push_back(tri[1]); idx.push_back(tri[2]); }
}

// Make a NOISY sphere: jitter each vertex TANGENTIALLY by a random offset, then
// re-project EXACTLY onto the sphere of radius r. This keeps the surface the
// clean analytic sphere (so the volume is well-defined and identical for any
// vertex set on it) while making the TRIANGULATION non-uniform — some edges
// short, some long. Isotropic remeshing's job is to equalize those edges, so
// the edge-length stddev must shrink markedly while the volume is preserved.
static void noisifySphere(std::vector<double>& pos, double r, double amp, std::mt19937& rng) {
    std::uniform_real_distribution<double> U(-1.0, 1.0);
    for (std::size_t i = 0; i + 2 < pos.size(); i += 3) {
        double x = pos[i], y = pos[i+1], z = pos[i+2];
        double n = std::sqrt(x*x + y*y + z*z);
        if (n < 1e-12) continue;
        // unit normal at this point
        double nx = x / n, ny = y / n, nz = z / n;
        // an arbitrary tangent basis (Gram-Schmidt off a non-parallel axis)
        double ax = (std::fabs(nx) < 0.9) ? 1.0 : 0.0;
        double ay = (std::fabs(nx) < 0.9) ? 0.0 : 1.0;
        double az = 0.0;
        double t1x = ay*nz - az*ny, t1y = az*nx - ax*nz, t1z = ax*ny - ay*nx;
        double t1n = std::sqrt(t1x*t1x + t1y*t1y + t1z*t1z);
        t1x /= t1n; t1y /= t1n; t1z /= t1n;
        double t2x = ny*t1z - nz*t1y, t2y = nz*t1x - nx*t1z, t2z = nx*t1y - ny*t1x;
        // tangential displacement (amp is a fraction of r)
        double du = amp * r * U(rng), dv = amp * r * U(rng);
        double px = x + du*t1x + dv*t2x;
        double py = y + du*t1y + dv*t2y;
        double pz = z + du*t1z + dv*t2z;
        // re-project EXACTLY onto the sphere of radius r
        double pn = std::sqrt(px*px + py*py + pz*pz);
        pos[i  ] = px / pn * r;
        pos[i+1] = py / pn * r;
        pos[i+2] = pz / pn * r;
    }
}

// edge-length stddev of a soup (undirected edges, via half-edge twins).
static void soupEdgeStats(const std::vector<double>& pos,
                          const std::vector<std::uint32_t>& idx,
                          double& mean, double& stddev) {
    std::unordered_map<std::uint64_t, double> edges;
    auto key = [](std::uint32_t a, std::uint32_t b) {
        std::uint32_t lo = std::min(a, b), hi = std::max(a, b);
        return (static_cast<std::uint64_t>(lo) << 32) | hi;
    };
    for (std::size_t f = 0; f + 2 < idx.size(); f += 3) {
        std::uint32_t tri[3] = { idx[f], idx[f+1], idx[f+2] };
        for (int k = 0; k < 3; ++k) {
            std::uint32_t a = tri[k], b = tri[(k+1)%3];
            double dx = pos[3*a]-pos[3*b], dy = pos[3*a+1]-pos[3*b+1], dz = pos[3*a+2]-pos[3*b+2];
            edges[key(a, b)] = std::sqrt(dx*dx + dy*dy + dz*dz);
        }
    }
    double s = 0, s2 = 0; double n = 0;
    for (auto& [k, L] : edges) { s += L; s2 += L*L; ++n; }
    if (n == 0) { mean = stddev = 0; return; }
    mean = s / n;
    double var = s2 / n - mean * mean;
    stddev = var > 0 ? std::sqrt(var) : 0.0;
}

static std::uint32_t countNonManifold(const std::vector<double>&,
                                      const std::vector<std::uint32_t>& idx) {
    std::unordered_map<std::uint64_t, int> ec;
    auto key = [](std::uint32_t a, std::uint32_t b) {
        std::uint32_t lo = std::min(a, b), hi = std::max(a, b);
        return (static_cast<std::uint64_t>(lo) << 32) | hi;
    };
    for (std::size_t f = 0; f + 2 < idx.size(); f += 3) {
        std::uint32_t tri[3] = { idx[f], idx[f+1], idx[f+2] };
        for (int k = 0; k < 3; ++k) ec[key(tri[k], tri[(k+1)%3])] += 1;
    }
    std::uint32_t nm = 0;
    for (auto& [k, c] : ec) if (c != 2) ++nm;
    return nm;
}

// One full noisy-sphere remesh case. Returns true if every SPEC assertion holds.
static bool noisySphereCase(const char* tag, double r, int subdiv, double noiseAmp,
                            double targetMul, std::mt19937& rng) {
    std::vector<double> pos; std::vector<std::uint32_t> idx;
    icosphere(r, subdiv, pos, idx);

    // Clean (un-noised) mean edge length = the TRUE resolution of this sampling.
    // We remesh back to THIS length so the surface stays sampled at its native
    // density (tight volume); the noise only perturbs the triangulation, not the
    // intended density.
    double meanClean, sdClean; soupEdgeStats(pos, idx, meanClean, sdClean);

    noisifySphere(pos, r, noiseAmp, rng);

    // sanity: the noisy sphere must itself be a valid closed 2-manifold
    HalfEdgeMesh m0;
    bool built = m0.buildFromSoup(pos, idx);
    ValidityReport v0 = built ? m0.validate() : ValidityReport{};
    double volIn = built ? m0.signedVolume() : 0.0;

    double meanIn, sdIn; soupEdgeStats(pos, idx, meanIn, sdIn);

    // Target edge length = the CLEAN native resolution (×targetMul near 1) so we
    // remesh at the input DENSITY: the surface stays well-sampled (tight volume)
    // and the win is pure UNIFORMITY — short/long edges from the noisy
    // triangulation are equalized, so the absolute edge-length stddev shrinks.
    // Both split AND collapse paths fire (long edges split, short ones collapse).
    double L = meanClean * targetMul;

    RemeshOptions opt;
    opt.iterations = 10;
    std::vector<double> outPos; std::vector<std::uint32_t> outIdx;
    RemeshReport rep = remesh(pos, idx, L, opt, outPos, outIdx);

    std::printf("\n[%s] r=%.2f subdiv=%d noise=%.2f  target L=%.4f\n", tag, r, subdiv, noiseAmp, L);
    std::printf("    in: V=%u F=%u  meanEdge=%.4f stddev=%.4f  vol=%.5f  (closed=%d manifold=%d)\n",
                rep.inVertices, rep.inFaces, meanIn, sdIn, volIn, v0.watertight, v0.manifold);
    std::printf("    out: ok=%d reason='%s'  V=%u F=%u  meanEdge=%.4f stddev=%.4f  vol=%.5f\n",
                rep.ok, rep.reason, rep.outVertices, rep.outFaces,
                rep.meanEdgeAfter, rep.stddevEdgeAfter, rep.volumeAfter);
    std::printf("    out: watertight=%d manifold=%d nonManifoldEdges=%u boundaryEdges=%u "
                "(splits=%d collapses=%d flips=%d)\n",
                rep.watertight, rep.manifold, rep.nonManifoldEdges, rep.boundaryEdges,
                rep.splits, rep.collapses, rep.flips);

    bool ok = true;

    // input must be a clean closed 2-manifold (fixture sanity)
    check(built && v0.watertight && v0.manifold,
          "[%s] input noisy sphere is a closed 2-manifold (fixture)", tag); ok &= (built && v0.watertight && v0.manifold);

    // remesh must succeed
    check(rep.ok, "[%s] remesh returned ok=true (validated 2-manifold)", tag); ok &= rep.ok;
    if (!rep.ok) return false;

    // independent re-audit of the OUTPUT soup (don't trust the report alone)
    HalfEdgeMesh m1;
    bool rebuilt = m1.buildFromSoup(outPos, outIdx);
    ValidityReport v1 = rebuilt ? m1.validate() : ValidityReport{};
    double volOut = rebuilt ? m1.signedVolume() : 0.0;
    std::uint32_t nmOut = countNonManifold(outPos, outIdx);

    check(rebuilt && v1.watertight, "[%s] OUTPUT is WATERTIGHT (independent rebuild)", tag); ok &= (rebuilt && v1.watertight);
    check(rebuilt && v1.manifold,   "[%s] OUTPUT is 2-MANIFOLD (independent rebuild)", tag);  ok &= (rebuilt && v1.manifold);
    check(nmOut == 0, "[%s] OUTPUT has ZERO non-manifold edges (got %u)", tag, nmOut);        ok &= (nmOut == 0);

    // edge-length stddev recomputed independently on the output soup
    double meanOut, sdOut; soupEdgeStats(outPos, outIdx, meanOut, sdOut);
    double ratio = sdIn > 1e-12 ? sdIn / std::max(sdOut, 1e-12) : 0.0;
    std::printf("    stddev: in=%.4f -> out=%.4f  (shrink %.2fx)   meanOut=%.4f (target %.4f)\n",
                sdIn, sdOut, ratio, meanOut, L);

    check(ratio >= 2.0, "[%s] edge-length STDDEV shrinks markedly (>=2x): %.2fx", tag, ratio); ok &= (ratio >= 2.0);

    // mean lands near the target (within +/-35%: collapse/split snap edges into
    // the [4/5 L, 4/3 L] band, mean ~ L)
    bool meanNearTarget = std::fabs(meanOut - L) <= 0.35 * L;
    check(meanNearTarget, "[%s] mean edge near target L (%.4f vs %.4f, within 35%%)", tag, meanOut, L); ok &= meanNearTarget;

    // volume preserved within 3%
    double volErr = volIn != 0.0 ? std::fabs(volOut - volIn) / std::fabs(volIn) : 1.0;
    check(volErr <= 0.03, "[%s] VOLUME preserved within 3%% (err=%.3f%%)", tag, volErr * 100.0); ok &= (volErr <= 0.03);

    return ok;
}

int main() {
    std::random_device rd;
    std::uint32_t seed = rd();
    std::mt19937 rng(seed);

    std::printf("=== forge::native::mesh::remesh validation gate (isotropic remeshing) ===\n");
    std::printf("=== SEED: %u (std::random_device, fresh each run) ===\n", seed);

    // ── (S1) primary noisy sphere (remesh at native resolution) ───────────────
    bool s1 = noisySphereCase("S1", 1.0, 3, 0.35, 1.0, rng);

    // ── (S2) a SECOND, distinct noisy sphere (different radius/subdiv/noise/L) ─
    bool s2 = noisySphereCase("S2", 2.5, 3, 0.30, 1.1, rng);

    // ── (S3) 0-FAKES: degenerate / unsupported inputs return ok=false ─────────
    std::printf("\n[S3] 0-FAKES — degenerate / unsupported inputs must return ok=false\n");
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        icosphere(1.0, 1, pos, idx);
        std::vector<double> op; std::vector<std::uint32_t> oi;
        RemeshOptions opt;

        // (a) non-positive target length
        RemeshReport ra = remesh(pos, idx, 0.0, opt, op, oi);
        check(!ra.ok && op.empty(), "[S3a] target length <= 0 -> ok=false, no soup (reason='%s')", ra.reason);

        // (b) empty mesh
        std::vector<double> ep; std::vector<std::uint32_t> ei;
        RemeshReport rb = remesh(ep, ei, 0.1, opt, op, oi);
        check(!rb.ok && op.empty(), "[S3b] empty mesh -> ok=false, no soup (reason='%s')", rb.reason);

        // (c) non-manifold soup: two triangles sharing the SAME directed edge.
        // (0,1,2) and (0,1,3) both contain directed edge 0->1 -> buildFromSoup fails.
        std::vector<double> np = { 0,0,0, 1,0,0, 0,1,0, 0,0,1 };
        std::vector<std::uint32_t> ni = { 0,1,2, 0,1,3 };
        RemeshReport rc = remesh(np, ni, 0.3, opt, op, oi);
        check(!rc.ok && op.empty(), "[S3c] non-manifold soup -> ok=false, no soup (reason='%s')", rc.reason);

        // (d) a valid input but with a NaN target -> ok=false
        RemeshReport rdn = remesh(pos, idx, std::nan(""), opt, op, oi);
        check(!rdn.ok && op.empty(), "[S3d] NaN target -> ok=false, no soup (reason='%s')", rdn.reason);
    }

    std::printf("\n=== HEADLINE: S1(noisy sphere)=%s  S2(noisy sphere #2)=%s ===\n",
                s1 ? "PASS" : "FAIL", s2 ? "PASS" : "FAIL");
    std::printf("=== ENVELOPE: robust for closed 2-manifold triangle meshes (watertight in/out,\n");
    std::printf("===           stddev collapses, vol within 3%%, 0 non-manifold edges). Degenerate /\n");
    std::printf("===           non-manifold / non-positive-L inputs return ok=false (0 fakes). ===\n");
    std::printf("=== RESULT: %d / %d passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
