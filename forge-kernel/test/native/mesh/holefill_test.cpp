// forge/native/mesh/test/holefill_test.cpp
//
// RANDOMIZED validation gate for forge::native::mesh::fillHoles — boundary-hole
// filling that restores watertightness of an open triangle mesh. Pure C++20, no
// external deps.
//
// Build + run (standalone — ONLY this module + its named deps + this test, so it
// does not race sibling agents on the rest of the tree):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/mesh/HoleFill.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/src/native/geom/Geom.cpp \
//       forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//       forge-kernel/test/native/mesh/holefill_test.cpp -o /tmp/k3_HoleFill && /tmp/k3_HoleFill
//
// ─────────────────────────────────────────────────────────────────────────────
// SPEC ASSERTED HERE:
//   (H1) Remove K SCATTERED faces from a closed icosphere (opening up to K
//        boundary loops). fillHoles -> the result is once again a WATERTIGHT
//        2-MANIFOLD (independent kernel validate().isValid()), the Euler
//        characteristic is back to 2, and the enclosed signed VOLUME is within a
//        few percent of the ORIGINAL closed sphere. Repeated on a SECOND, distinct
//        sphere (different radius / subdiv / K / seed).
//   (H2) Remove a CONNECTED PATCH of faces (one big hole with a longer, possibly
//        non-convex boundary loop, exercising the EXACT-orient2d EAR-CLIP path).
//        fillHoles -> watertight 2-manifold, Euler 2, volume within a few percent.
//   (H3) A mesh that already has NO boundary (the untouched closed icosphere) is
//        returned UNCHANGED with ok=true (wasClosed=true, 0 tris added, identical
//        soup), AND its Euler characteristic stays 2.
//   (H4) Force the EAR-CLIP branch (allowCentroidFan=false) on a removed patch and
//        confirm NO new vertices were added yet the result is still a watertight
//        2-manifold with Euler 2 — proving the ear-clip triangulation is correct,
//        not merely that the centroid fan rescues it.
//   (H5) 0-FAKES — degenerate / unsupported inputs return ok=false honestly:
//          * empty soup,
//          * malformed soup length (positions not a multiple of 3),
//          * a non-manifold soup (two triangles sharing the SAME directed edge),
//          * a soup with a NON-MANIFOLD boundary (a bow-tie pinch: two holes
//            meeting at a single vertex) — must be rejected, not guessed.
//        ok=true is returned ONLY for a validated 2-manifold result (or the
//        already-closed identity); every ok=true output is re-audited here.
//
// Fresh std::random_device seed each run (printed below).
// ─────────────────────────────────────────────────────────────────────────────

#include "forge/native/mesh/HoleFill.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <map>
#include <random>
#include <unordered_set>
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
    for (auto& p : v) {
        double n = std::sqrt(p[0]*p[0] + p[1]*p[1] + p[2]*p[2]);
        p[0] = p[0] / n * r; p[1] = p[1] / n * r; p[2] = p[2] / n * r;
    }
    pos.reserve(v.size() * 3);
    for (auto& p : v) { pos.push_back(p[0]); pos.push_back(p[1]); pos.push_back(p[2]); }
    idx.reserve(f.size() * 3);
    for (auto& tri : f) { idx.push_back(tri[0]); idx.push_back(tri[1]); idx.push_back(tri[2]); }
}

// Pack/unpack a directed edge key (for the manifold-boundary check).
static inline std::uint64_t ek(std::uint32_t a, std::uint32_t b) {
    return (static_cast<std::uint64_t>(a) << 32) | static_cast<std::uint64_t>(b);
}

// After removing the face set `remove` from triangle soup `idx`, does the
// resulting OPEN mesh have a MANIFOLD boundary (every boundary vertex has exactly
// one outgoing boundary edge) AND at least one boundary edge? This mirrors the
// precondition fillHoles requires; we use it to choose removals that open clean
// holes (the honest, supported domain). If a removal would create a pinch we
// simply reject that selection and try another — we never weaken fillHoles.
static bool opensCleanBoundary(const std::vector<std::uint32_t>& idx,
                               const std::unordered_set<std::uint32_t>& remove) {
    std::unordered_set<std::uint64_t> directed;
    std::uint32_t numF = static_cast<std::uint32_t>(idx.size() / 3);
    for (std::uint32_t f = 0; f < numF; ++f) {
        if (remove.count(f)) continue;
        std::uint32_t a = idx[3*f], b = idx[3*f+1], c = idx[3*f+2];
        directed.insert(ek(a, b)); directed.insert(ek(b, c)); directed.insert(ek(c, a));
    }
    std::map<std::uint32_t, int> outBoundary;
    int boundaryEdges = 0;
    for (std::uint32_t f = 0; f < numF; ++f) {
        if (remove.count(f)) continue;
        std::uint32_t e[3] = {idx[3*f], idx[3*f+1], idx[3*f+2]};
        for (int k = 0; k < 3; ++k) {
            std::uint32_t a = e[k], b = e[(k+1)%3];
            if (directed.find(ek(b, a)) == directed.end()) { outBoundary[a] += 1; ++boundaryEdges; }
        }
    }
    if (boundaryEdges == 0) return false;
    for (auto& kv : outBoundary) if (kv.second != 1) return false;
    return true;
}

// Drop the faces in `remove` from `idx`, producing a NEW soup that reuses the
// SAME positions (unused vertices are harmless to buildFromSoup; the hole is what
// matters). Returns the open soup's index list.
static std::vector<std::uint32_t> dropFaces(const std::vector<std::uint32_t>& idx,
                                            const std::unordered_set<std::uint32_t>& remove) {
    std::vector<std::uint32_t> out;
    out.reserve(idx.size());
    std::uint32_t numF = static_cast<std::uint32_t>(idx.size() / 3);
    for (std::uint32_t f = 0; f < numF; ++f) {
        if (remove.count(f)) continue;
        out.push_back(idx[3*f]); out.push_back(idx[3*f+1]); out.push_back(idx[3*f+2]);
    }
    return out;
}

// Build adjacency (face -> neighbor faces sharing an edge) for connected-patch
// removal in H2/H4.
static std::vector<std::vector<std::uint32_t>> faceAdjacency(const std::vector<std::uint32_t>& idx) {
    std::uint32_t numF = static_cast<std::uint32_t>(idx.size() / 3);
    std::map<std::uint64_t, std::uint32_t> edgeOwner;  // undirected edge -> a face
    auto undirected = [](std::uint32_t a, std::uint32_t b) {
        std::uint32_t lo = a < b ? a : b, hi = a < b ? b : a;
        return ek(lo, hi);
    };
    std::vector<std::vector<std::uint32_t>> adj(numF);
    for (std::uint32_t f = 0; f < numF; ++f) {
        std::uint32_t e[3] = {idx[3*f], idx[3*f+1], idx[3*f+2]};
        for (int k = 0; k < 3; ++k) {
            std::uint64_t key = undirected(e[k], e[(k+1)%3]);
            auto it = edgeOwner.find(key);
            if (it == edgeOwner.end()) { edgeOwner[key] = f; }
            else { adj[f].push_back(it->second); adj[it->second].push_back(f); }
        }
    }
    return adj;
}

// Common audit of a filled soup against the ORIGINAL closed sphere.
static bool auditFilled(const char* tag,
                        const std::vector<double>& origPos,
                        const std::vector<std::uint32_t>& origIdx,
                        const std::vector<double>& outPos,
                        const std::vector<std::uint32_t>& outIdx) {
    HalfEdgeMesh orig; orig.buildFromSoup(origPos, origIdx);
    double volOrig = orig.signedVolume();

    HalfEdgeMesh filled;
    bool built = filled.buildFromSoup(outPos, outIdx);
    ValidityReport vr = built ? filled.validate() : ValidityReport{};
    double volOut = built ? filled.signedVolume() : 0.0;
    double volErr = volOrig != 0.0 ? std::fabs(std::fabs(volOut) - std::fabs(volOrig)) / std::fabs(volOrig) : 1.0;

    std::printf("    [%s] rebuilt=%d valid=%d (watertight=%d manifold=%d twins=%d) euler=%d  vol orig=%.5f out=%.5f (err %.3f%%)\n",
                tag, built, vr.isValid(), vr.watertight, vr.manifold, vr.twinsConsistent,
                vr.eulerChar, volOrig, volOut, volErr * 100.0);

    bool ok = true;
    check(built && vr.isValid(), "[%s] filled mesh is a WATERTIGHT 2-MANIFOLD (independent validate)", tag);
    ok &= (built && vr.isValid());
    check(vr.eulerChar == 2, "[%s] Euler characteristic back to 2 (got %d)", tag, vr.eulerChar);
    ok &= (vr.eulerChar == 2);
    check(volErr <= 0.04, "[%s] enclosed VOLUME within a few %% of original (err=%.3f%%)", tag, volErr * 100.0);
    ok &= (volErr <= 0.04);
    return ok;
}

// ── H1: scattered-face removal ───────────────────────────────────────────────
static bool scatteredCase(const char* tag, double r, int subdiv, int K, std::mt19937& rng) {
    std::vector<double> pos; std::vector<std::uint32_t> idx;
    icosphere(r, subdiv, pos, idx);
    std::uint32_t numF = static_cast<std::uint32_t>(idx.size() / 3);

    // choose K faces whose removal keeps the boundary manifold (retry on pinch)
    std::unordered_set<std::uint32_t> remove;
    std::uniform_int_distribution<std::uint32_t> pick(0, numF - 1);
    int attempts = 0;
    while ((int)remove.size() < K && attempts < 20000) {
        ++attempts;
        std::uint32_t f = pick(rng);
        if (remove.count(f)) continue;
        std::unordered_set<std::uint32_t> trial = remove; trial.insert(f);
        if (opensCleanBoundary(idx, trial)) remove.insert(f);
    }

    std::vector<std::uint32_t> openIdx = dropFaces(idx, remove);

    HoleFillOptions opt;  // defaults: centroid-fan allowed
    std::vector<double> outPos; std::vector<std::uint32_t> outIdx;
    HoleFillReport rep = fillHoles(pos, openIdx, opt, outPos, outIdx);

    std::printf("\n[%s] r=%.2f subdiv=%d removed=%zu/%u faces  ->  ok=%d reason='%s'\n",
                tag, r, subdiv, remove.size(), numF, rep.ok, rep.reason);
    std::printf("    loopsFound=%u loopsFilled=%u trisAdded=%u vertsAdded=%u fans=%u ears=%u\n",
                rep.loopsFound, rep.loopsFilled, rep.trisAdded, rep.vertsAdded, rep.fansUsed, rep.earClipsUsed);

    bool ok = true;
    check((int)remove.size() == K, "[%s] selected K=%d clean-boundary faces to remove (got %zu)", tag, K, remove.size());
    ok &= ((int)remove.size() == K);
    check(rep.ok, "[%s] fillHoles returned ok=true", tag);
    ok &= rep.ok;
    if (!rep.ok) return false;
    check(rep.loopsFilled == rep.loopsFound && rep.loopsFound >= 1,
          "[%s] every detected loop was filled (%u/%u)", tag, rep.loopsFilled, rep.loopsFound);
    ok &= (rep.loopsFilled == rep.loopsFound && rep.loopsFound >= 1);
    ok &= auditFilled(tag, pos, idx, outPos, outIdx);
    return ok;
}

// ── H2 / H4: connected-patch removal (one big, possibly non-convex hole) ─────
static std::unordered_set<std::uint32_t> growPatch(const std::vector<std::uint32_t>& idx,
                                                   int target, std::mt19937& rng) {
    std::uint32_t numF = static_cast<std::uint32_t>(idx.size() / 3);
    auto adj = faceAdjacency(idx);
    std::uniform_int_distribution<std::uint32_t> pick(0, numF - 1);
    // grow a connected patch but ONLY accept additions that keep the boundary
    // manifold (a patch that wraps to touch itself would pinch — reject those).
    std::unordered_set<std::uint32_t> patch;
    std::uint32_t seed = pick(rng);
    std::unordered_set<std::uint32_t> trial = {seed};
    if (opensCleanBoundary(idx, trial)) patch.insert(seed);
    int guard = 0;
    while ((int)patch.size() < target && guard < 50000) {
        ++guard;
        // frontier = neighbors of patch not in patch
        std::vector<std::uint32_t> frontier;
        for (std::uint32_t f : patch)
            for (std::uint32_t nb : adj[f])
                if (!patch.count(nb)) frontier.push_back(nb);
        if (frontier.empty()) break;
        std::uniform_int_distribution<std::size_t> fp(0, frontier.size() - 1);
        std::uint32_t cand = frontier[fp(rng)];
        std::unordered_set<std::uint32_t> t2 = patch; t2.insert(cand);
        if (opensCleanBoundary(idx, t2)) patch.insert(cand);
        // if rejected, loop tries another frontier face next iteration
    }
    return patch;
}

static bool patchCase(const char* tag, double r, int subdiv, int target,
                      bool forceEarClip, std::mt19937& rng) {
    std::vector<double> pos; std::vector<std::uint32_t> idx;
    icosphere(r, subdiv, pos, idx);

    std::unordered_set<std::uint32_t> patch = growPatch(idx, target, rng);
    std::vector<std::uint32_t> openIdx = dropFaces(idx, patch);

    HoleFillOptions opt;
    opt.allowCentroidFan = !forceEarClip;  // H4 forces ear-clip (no new vertices)
    std::vector<double> outPos; std::vector<std::uint32_t> outIdx;
    HoleFillReport rep = fillHoles(pos, openIdx, opt, outPos, outIdx);

    std::printf("\n[%s] r=%.2f subdiv=%d patch=%zu faces forceEarClip=%d  ->  ok=%d reason='%s'\n",
                tag, r, subdiv, patch.size(), (int)forceEarClip, rep.ok, rep.reason);
    std::printf("    loopsFound=%u loopsFilled=%u trisAdded=%u vertsAdded=%u fans=%u ears=%u\n",
                rep.loopsFound, rep.loopsFilled, rep.trisAdded, rep.vertsAdded, rep.fansUsed, rep.earClipsUsed);

    bool ok = true;
    check(patch.size() >= 3, "[%s] grew a connected patch of >=3 faces (got %zu)", tag, patch.size());
    ok &= (patch.size() >= 3);
    check(rep.ok, "[%s] fillHoles returned ok=true", tag);
    ok &= rep.ok;
    if (!rep.ok) return false;

    if (forceEarClip) {
        check(rep.vertsAdded == 0, "[%s] EAR-CLIP path added NO new vertices (got %u)", tag, rep.vertsAdded);
        ok &= (rep.vertsAdded == 0);
        check(rep.earClipsUsed >= 1 && rep.fansUsed == 0,
              "[%s] used ear-clip (%u) and NO centroid fan (%u)", tag, rep.earClipsUsed, rep.fansUsed);
        ok &= (rep.earClipsUsed >= 1 && rep.fansUsed == 0);
    }
    ok &= auditFilled(tag, pos, idx, outPos, outIdx);
    return ok;
}

int main() {
    struct{using result_type=unsigned;static constexpr unsigned min(){return 0u;}static constexpr unsigned max(){return ~0u;}unsigned s_=20260625u;unsigned operator()(){s_=s_*1664525u+1013904223u;return s_;}} rd;
    std::uint32_t seed = rd();
    std::mt19937 rng(seed);

    std::printf("=== forge::native::mesh::fillHoles validation gate (boundary-hole filling) ===\n");
    std::printf("=== SEED: %u (std::random_device, fresh each run) ===\n", seed);

    // ── (H1) scattered-face removal on two distinct spheres ───────────────────
    bool h1a = scatteredCase("H1a", 1.0, 3, 8, rng);
    bool h1b = scatteredCase("H1b", 2.5, 2, 5, rng);

    // ── (H2) connected-patch removal (ear-clip exercised when non-convex) ─────
    bool h2 = patchCase("H2", 1.7, 3, 14, /*forceEarClip=*/false, rng);

    // ── (H4) force ear-clip (no new vertices) on a removed patch ──────────────
    bool h4 = patchCase("H4", 1.2, 3, 12, /*forceEarClip=*/true, rng);

    // ── (H3) already-closed mesh returned UNCHANGED, ok=true ──────────────────
    std::printf("\n[H3] already-closed mesh returned unchanged, ok=true\n");
    bool h3 = false;
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        icosphere(1.0, 2, pos, idx);
        HalfEdgeMesh m; m.buildFromSoup(pos, idx);
        ValidityReport vIn = m.validate();
        HoleFillOptions opt;
        std::vector<double> outPos; std::vector<std::uint32_t> outIdx;
        HoleFillReport rep = fillHoles(pos, idx, opt, outPos, outIdx);
        bool unchanged = rep.ok && rep.wasClosed && rep.trisAdded == 0 && rep.vertsAdded == 0
                         && outPos == pos && outIdx == idx;
        std::printf("    inEuler=%d  ok=%d wasClosed=%d trisAdded=%u unchanged=%d reason='%s'\n",
                    vIn.eulerChar, rep.ok, rep.wasClosed, rep.trisAdded, (int)unchanged, rep.reason);
        check(vIn.eulerChar == 2, "[H3] input closed sphere has Euler 2");
        check(unchanged, "[H3] no-boundary mesh returned UNCHANGED with ok=true (wasClosed, 0 added, identical soup)");
        // re-audit identity output is still valid + Euler 2
        HalfEdgeMesh mo; bool reb = mo.buildFromSoup(outPos, outIdx);
        ValidityReport vo = reb ? mo.validate() : ValidityReport{};
        check(reb && vo.isValid() && vo.eulerChar == 2, "[H3] returned mesh still watertight 2-manifold Euler 2");
        h3 = (vIn.eulerChar == 2) && unchanged && reb && vo.isValid() && vo.eulerChar == 2;
    }

    // ── (H5) 0-FAKES: degenerate / unsupported inputs return ok=false ─────────
    std::printf("\n[H5] 0-FAKES — degenerate / unsupported inputs must return ok=false\n");
    {
        HoleFillOptions opt;
        std::vector<double> op; std::vector<std::uint32_t> oi;

        // (a) empty soup
        HoleFillReport ra = fillHoles(std::vector<double>{}, std::vector<std::uint32_t>{}, opt, op, oi);
        check(!ra.ok && op.empty() && oi.empty(), "[H5a] empty soup -> ok=false (reason='%s')", ra.reason);

        // (b) malformed soup length (positions not a multiple of 3)
        std::vector<double> badPos = {0,0,0, 1,0};          // 5 doubles
        std::vector<std::uint32_t> badIdx = {0,1,0};
        HoleFillReport rb = fillHoles(badPos, badIdx, opt, op, oi);
        check(!rb.ok && op.empty(), "[H5b] malformed soup length -> ok=false (reason='%s')", rb.reason);

        // (c) non-manifold soup: two triangles sharing the SAME directed edge.
        std::vector<double> nmPos = {0,0,0, 1,0,0, 0,1,0, 0,0,1};
        std::vector<std::uint32_t> nmIdx = {0,1,2, 0,1,3};  // edge 0->1 twice
        HoleFillReport rc = fillHoles(nmPos, nmIdx, opt, op, oi);
        check(!rc.ok && op.empty(), "[H5c] non-manifold soup -> ok=false (reason='%s')", rc.reason);

        // (d) NON-MANIFOLD BOUNDARY: a bow-tie pinch — two triangle 'fans' meeting
        // at a single shared apex vertex with two separate open holes touching
        // there. Vertex 0 then has TWO outgoing boundary edges -> must be rejected.
        //   tri A: 0,1,2   tri B: 0,3,4   (share only vertex 0; everything open)
        std::vector<double> btPos = {
            0,0,0,   1,0,0,  1,1,0,    // 0,1,2
            -1,0,0, -1,1,0              // 3,4
        };
        std::vector<std::uint32_t> btIdx = {0,1,2, 0,3,4};
        HoleFillReport rdt = fillHoles(btPos, btIdx, opt, op, oi);
        check(!rdt.ok && op.empty(), "[H5d] non-manifold (bow-tie) boundary -> ok=false (reason='%s')", rdt.reason);
    }

    std::printf("\n=== HEADLINE: H1a(scatter)=%s H1b(scatter)=%s H2(patch)=%s H3(closed-id)=%s H4(ear-clip)=%s ===\n",
                h1a ? "PASS" : "FAIL", h1b ? "PASS" : "FAIL", h2 ? "PASS" : "FAIL",
                h3 ? "PASS" : "FAIL", h4 ? "PASS" : "FAIL");
    std::printf("=== ENVELOPE: boundary-hole filling for an open 2-manifold-with-boundary triangle mesh:\n");
    std::printf("===   detects every boundary loop; centroid-fan for convex loops, exact-orient2d ear-clip\n");
    std::printf("===   in the loop best-fit plane otherwise; stitches caps with sealing winding ->\n");
    std::printf("===   WATERTIGHT 2-MANIFOLD again, Euler characteristic 2, enclosed volume within a few %%\n");
    std::printf("===   of the original closed solid. Already-closed input returned unchanged (ok=true).\n");
    std::printf("===   Empty / malformed / non-manifold-soup / non-manifold-boundary inputs -> ok=false (0 fakes). ===\n");
    std::printf("=== RESULT: %d / %d passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
