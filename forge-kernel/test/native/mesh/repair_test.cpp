// forge/native/mesh/test/repair_test.cpp
//
// RANDOMIZED validation gate for forge::native::mesh::repairMesh — comprehensive
// mesh repair toward a clean watertight 2-manifold. Pure C++20, no external deps.
//
// Build + run (standalone — ONLY this module + its named deps + this test):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/mesh/Repair.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/src/native/geom/Geom.cpp \
//       forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//       forge-kernel/test/native/mesh/repair_test.cpp -o /tmp/k5_Repair && /tmp/k5_Repair
//
// ─────────────────────────────────────────────────────────────────────────────
// SPEC ASSERTED HERE:
//   (R1) A SPHERE SOUP that is dirty in every way the repair must handle, on TWO
//        distinct spheres (different radius / subdiv / counts / seed):
//          * exploded to a TRIANGLE SOUP (every triangle carries its OWN copies of
//            its three corners -> massive near-duplicate vertex count), so welding
//            is genuinely required for any edge to acquire a twin;
//          * a few faces FLIPPED (winding made inconsistent);
//          * a small boundary HOLE opened (a patch of faces removed).
//        repairMesh -> the result is a WATERTIGHT 2-MANIFOLD (independent kernel
//        validate().isValid()), enclosed signed VOLUME within a few percent of the
//        ORIGINAL clean sphere, and CONSISTENT OUTWARD winding (signedVolume > 0).
//        The report honestly accounts for the welds / flips / hole fill performed.
//   (R2) An ALREADY-CLEAN closed 2-manifold (the untouched icosphere) is returned
//        UNCHANGED: ok=true, wasClean=true, ZERO repairs (no welds/drops/dups/
//        flips/holes), identical soup, still a watertight 2-manifold with positive
//        signed volume.
//   (R3) 0-FAKES — degenerate / unsupported inputs return ok=false honestly:
//          * empty soup,
//          * malformed soup length (positions not a multiple of 3),
//          * an index out of range,
//          * a genuinely NON-MANIFOLD soup (an edge shared by 3 faces),
//          * a hole too LARGE to fill within maxHoleEdges (left open, ok=false).
//
// Fresh std::random_device seed each run (printed below). NEVER weakens an assert.
// ─────────────────────────────────────────────────────────────────────────────

#include "forge/native/mesh/Repair.hpp"
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

static inline std::uint64_t ek(std::uint32_t a, std::uint32_t b) {
    return (static_cast<std::uint64_t>(a) << 32) | static_cast<std::uint64_t>(b);
}

// face -> neighbor faces sharing an edge (for connected-patch hole removal)
static std::vector<std::vector<std::uint32_t>> faceAdjacency(const std::vector<std::uint32_t>& idx) {
    std::uint32_t numF = static_cast<std::uint32_t>(idx.size() / 3);
    std::map<std::uint64_t, std::uint32_t> edgeOwner;
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

// Does removing `remove` keep a MANIFOLD boundary (every boundary vertex exactly
// one outgoing boundary edge) and open at least one boundary edge? Mirrors the
// repair hole-fill precondition so the opened hole is in the supported domain.
static bool opensCleanBoundary(const std::vector<std::uint32_t>& idx,
                               const std::unordered_set<std::uint32_t>& remove) {
    std::unordered_set<std::uint64_t> directed;
    std::uint32_t numF = static_cast<std::uint32_t>(idx.size() / 3);
    for (std::uint32_t f = 0; f < numF; ++f) {
        if (remove.count(f)) continue;
        std::uint32_t a = idx[3*f], b = idx[3*f+1], c = idx[3*f+2];
        directed.insert(ek(a, b)); directed.insert(ek(b, c)); directed.insert(ek(c, a));
    }
    std::map<std::uint32_t, int> outBoundary, inBoundary;
    int boundaryEdges = 0;
    for (std::uint32_t f = 0; f < numF; ++f) {
        if (remove.count(f)) continue;
        std::uint32_t e[3] = {idx[3*f], idx[3*f+1], idx[3*f+2]};
        for (int k = 0; k < 3; ++k) {
            std::uint32_t a = e[k], b = e[(k+1)%3];
            if (directed.find(ek(b, a)) == directed.end()) { outBoundary[a] += 1; inBoundary[b] += 1; ++boundaryEdges; }
        }
    }
    if (boundaryEdges == 0) return false;
    for (auto& kv : outBoundary) if (kv.second != 1) return false;
    for (auto& kv : inBoundary)  if (kv.second != 1) return false;
    return true;
}

// Grow a connected patch whose removal keeps a clean manifold boundary.
static std::unordered_set<std::uint32_t> growPatch(const std::vector<std::uint32_t>& idx,
                                                   int target, std::mt19937& rng) {
    std::uint32_t numF = static_cast<std::uint32_t>(idx.size() / 3);
    auto adj = faceAdjacency(idx);
    std::uniform_int_distribution<std::uint32_t> pick(0, numF - 1);
    std::unordered_set<std::uint32_t> patch;
    std::uint32_t seed = pick(rng);
    std::unordered_set<std::uint32_t> trial = {seed};
    if (opensCleanBoundary(idx, trial)) patch.insert(seed);
    int guard = 0;
    while ((int)patch.size() < target && guard < 50000) {
        ++guard;
        std::vector<std::uint32_t> frontier;
        for (std::uint32_t f : patch)
            for (std::uint32_t nb : adj[f])
                if (!patch.count(nb)) frontier.push_back(nb);
        if (frontier.empty()) break;
        std::uniform_int_distribution<std::size_t> fp(0, frontier.size() - 1);
        std::uint32_t cand = frontier[fp(rng)];
        std::unordered_set<std::uint32_t> t2 = patch; t2.insert(cand);
        if (opensCleanBoundary(idx, t2)) patch.insert(cand);
    }
    return patch;
}

// Build the DIRTY soup: explode to a triangle soup (per-tri vertex copies),
// remove a small connected patch (a hole), and flip a few faces' winding.
static void makeDirty(const std::vector<double>& pos, const std::vector<std::uint32_t>& idx,
                      const std::unordered_set<std::uint32_t>& removed, int numFlip,
                      std::mt19937& rng,
                      std::vector<double>& dpos, std::vector<std::uint32_t>& didx,
                      int& flippedCount) {
    dpos.clear(); didx.clear();
    std::uint32_t numF = static_cast<std::uint32_t>(idx.size() / 3);
    // Surviving faces, in random order so flips/holes are scattered.
    std::vector<std::uint32_t> keep;
    for (std::uint32_t f = 0; f < numF; ++f) if (!removed.count(f)) keep.push_back(f);
    std::shuffle(keep.begin(), keep.end(), rng);

    // Choose which surviving faces to flip.
    std::unordered_set<std::uint32_t> flipSet;
    std::uniform_int_distribution<std::size_t> kp(0, keep.empty() ? 0 : keep.size() - 1);
    int guard = 0;
    while ((int)flipSet.size() < numFlip && guard++ < 100000 && !keep.empty())
        flipSet.insert(keep[kp(rng)]);
    flippedCount = (int)flipSet.size();

    for (std::uint32_t f : keep) {
        std::uint32_t a = idx[3*f], b = idx[3*f+1], c = idx[3*f+2];
        if (flipSet.count(f)) std::swap(b, c);  // flip winding
        std::uint32_t base = static_cast<std::uint32_t>(dpos.size() / 3);
        for (std::uint32_t vi : {a, b, c}) {
            dpos.push_back(pos[3*vi]); dpos.push_back(pos[3*vi+1]); dpos.push_back(pos[3*vi+2]);
        }
        didx.push_back(base); didx.push_back(base+1); didx.push_back(base+2);
    }
}

static double signedVolOf(const std::vector<double>& pos, const std::vector<std::uint32_t>& idx) {
    HalfEdgeMesh m;
    if (!m.buildFromSoup(pos, idx)) return 0.0;
    return m.signedVolume();
}

// ── R1: one dirty-sphere case ────────────────────────────────────────────────
static bool dirtyCase(const char* tag, double r, int subdiv, int patchTarget, int numFlip,
                      std::mt19937& rng) {
    std::vector<double> pos; std::vector<std::uint32_t> idx;
    icosphere(r, subdiv, pos, idx);
    double volClean = signedVolOf(pos, idx);

    std::unordered_set<std::uint32_t> patch = growPatch(idx, patchTarget, rng);

    std::vector<double> dpos; std::vector<std::uint32_t> didx;
    int flipped = 0;
    makeDirty(pos, idx, patch, numFlip, rng, dpos, didx, flipped);

    std::uint32_t dirtyVerts = static_cast<std::uint32_t>(dpos.size() / 3);
    std::uint32_t cleanVerts = static_cast<std::uint32_t>(pos.size() / 3);

    // weldEps: sphere edge length is comfortably >> this for these subdivs.
    RepairOptions opt;
    opt.weldEps = 1e-6;
    std::vector<double> opos; std::vector<std::uint32_t> oidx;
    RepairReport rep = repairMesh(dpos, didx, opt, opos, oidx);

    std::printf("\n[%s] r=%.2f subdiv=%d  dirty: verts=%u (clean %u) faces=%zu removed=%zu flipped=%d\n",
                tag, r, subdiv, dirtyVerts, cleanVerts, didx.size()/3, patch.size(), flipped);
    std::printf("    -> ok=%d reason='%s' welded=%u dropped=%u dups=%u flips=%u holesFilled=%u holeTris=%u open=%u comps=%u vOut=%u fOut=%u\n",
                rep.ok, rep.reason, rep.vertsWelded, rep.trisDropped, rep.dupFacesRemoved,
                rep.facesFlipped, rep.holesFilled, rep.holeTrisAdded, rep.holesLeftOpen,
                rep.components, rep.vertsOut, rep.facesOut);

    bool ok = true;
    check(patch.size() >= 1, "[%s] opened a hole (removed %zu faces)", tag, patch.size());
    ok &= (patch.size() >= 1);
    check(flipped >= 1, "[%s] flipped >=1 face (got %d)", tag, flipped);
    ok &= (flipped >= 1);
    check(rep.ok, "[%s] repairMesh returned ok=true", tag);
    ok &= rep.ok;
    if (!rep.ok) return false;

    // Independent re-audit.
    HalfEdgeMesh m;
    bool built = m.buildFromSoup(opos, oidx);
    ValidityReport vr = built ? m.validate() : ValidityReport{};
    double volOut = built ? m.signedVolume() : 0.0;
    double volErr = std::fabs(std::fabs(volOut) - std::fabs(volClean)) / std::fabs(volClean);

    std::printf("    [audit] rebuilt=%d valid=%d (watertight=%d manifold=%d twins=%d) euler=%d  vol clean=%.5f out=%.5f (err %.3f%%)\n",
                built, vr.isValid(), vr.watertight, vr.manifold, vr.twinsConsistent,
                vr.eulerChar, volClean, volOut, volErr * 100.0);

    check(built && vr.isValid(), "[%s] repaired mesh is a WATERTIGHT 2-MANIFOLD (independent validate)", tag);
    ok &= (built && vr.isValid());
    check(vr.eulerChar == 2, "[%s] Euler characteristic 2 (got %d)", tag, vr.eulerChar);
    ok &= (vr.eulerChar == 2);
    check(volOut > 0.0, "[%s] consistent OUTWARD winding: signedVolume > 0 (got %.5f)", tag, volOut);
    ok &= (volOut > 0.0);
    check(volErr <= 0.05, "[%s] enclosed VOLUME within a few %% of clean sphere (err=%.3f%%)", tag, volErr * 100.0);
    ok &= (volErr <= 0.05);
    // The repair must actually have WELDED the exploded soup (otherwise no edge
    // could have a twin) and fixed the flips / hole.
    check(rep.vertsWelded > 0, "[%s] welding happened (welded %u vertices)", tag, rep.vertsWelded);
    ok &= (rep.vertsWelded > 0);
    check(rep.totalRepairs(), "[%s] report records non-zero repairs", tag);
    ok &= rep.totalRepairs();
    check(!rep.wasClean, "[%s] dirty input NOT flagged wasClean", tag);
    ok &= !rep.wasClean;
    return ok;
}

int main() {
    std::random_device rd;
    std::uint32_t seed = rd();
    std::mt19937 rng(seed);

    std::printf("=== forge::native::mesh::repairMesh validation gate (mesh repair) ===\n");
    std::printf("=== SEED: %u (std::random_device, fresh each run) ===\n", seed);

    // ── (R1) dirty sphere soup on two distinct spheres ────────────────────────
    bool r1a = dirtyCase("R1a", 1.0, 3, 6, 12, rng);
    bool r1b = dirtyCase("R1b", 2.5, 2, 3, 5,  rng);

    // ── (R2) already-clean closed mesh returned UNCHANGED, 0 repairs ──────────
    std::printf("\n[R2] already-clean closed mesh returned unchanged, ok=true, 0 repairs\n");
    bool r2 = false;
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        icosphere(1.3, 2, pos, idx);
        // Ensure the clean input is itself valid + positively oriented (icosphere is).
        HalfEdgeMesh mi; bool bi = mi.buildFromSoup(pos, idx);
        ValidityReport vi = bi ? mi.validate() : ValidityReport{};
        double volIn = bi ? mi.signedVolume() : 0.0;

        RepairOptions opt; opt.weldEps = 1e-9;  // far below any real spacing
        std::vector<double> opos; std::vector<std::uint32_t> oidx;
        RepairReport rep = repairMesh(pos, idx, opt, opos, oidx);

        bool unchanged = rep.ok && rep.wasClean && !rep.totalRepairs()
                         && opos == pos && oidx == idx;
        std::printf("    inValid=%d volIn=%.5f ok=%d wasClean=%d repairs=%d unchanged=%d reason='%s'\n",
                    vi.isValid(), volIn, rep.ok, rep.wasClean, rep.totalRepairs(), (int)unchanged, rep.reason);
        check(bi && vi.isValid() && volIn > 0.0, "[R2] clean input is a positively-oriented watertight 2-manifold");
        check(rep.ok, "[R2] repairMesh returned ok=true on clean input");
        check(rep.wasClean, "[R2] clean input flagged wasClean=true");
        check(!rep.totalRepairs(), "[R2] ZERO repairs (no welds/drops/dups/flips/holes)");
        check(unchanged, "[R2] clean mesh returned UNCHANGED (identical soup, 0 repairs)");
        // re-audit identity output
        HalfEdgeMesh mo; bool ro = mo.buildFromSoup(opos, oidx);
        ValidityReport vo = ro ? mo.validate() : ValidityReport{};
        check(ro && vo.isValid() && mo.signedVolume() > 0.0,
              "[R2] returned mesh still watertight 2-manifold, signedVolume>0");
        r2 = bi && vi.isValid() && volIn > 0.0 && rep.ok && rep.wasClean
             && !rep.totalRepairs() && unchanged && ro && vo.isValid() && mo.signedVolume() > 0.0;
    }

    // ── (R3) 0-FAKES: degenerate / unsupported inputs return ok=false ─────────
    std::printf("\n[R3] 0-FAKES — degenerate / unsupported inputs must return ok=false\n");
    {
        RepairOptions opt;
        std::vector<double> op; std::vector<std::uint32_t> oi;

        // (a) empty soup
        RepairReport ra = repairMesh(std::vector<double>{}, std::vector<std::uint32_t>{}, opt, op, oi);
        check(!ra.ok && op.empty() && oi.empty(), "[R3a] empty soup -> ok=false (reason='%s')", ra.reason);

        // (b) malformed soup length (positions not multiple of 3)
        std::vector<double> badPos = {0,0,0, 1,0};
        std::vector<std::uint32_t> badIdx = {0,1,0};
        RepairReport rb = repairMesh(badPos, badIdx, opt, op, oi);
        check(!rb.ok && op.empty(), "[R3b] malformed soup length -> ok=false (reason='%s')", rb.reason);

        // (c) index out of range
        std::vector<double> p3 = {0,0,0, 1,0,0, 0,1,0};
        std::vector<std::uint32_t> i3 = {0,1,5};  // 5 OOR
        RepairReport rc = repairMesh(p3, i3, opt, op, oi);
        check(!rc.ok && op.empty(), "[R3c] index out of range -> ok=false (reason='%s')", rc.reason);

        // (d) genuinely NON-MANIFOLD soup: an undirected edge shared by 3 faces.
        // Three triangles all sharing edge (0,1): each adds a distinct apex.
        std::vector<double> nmPos = {
            0,0,0,  1,0,0,   // shared edge 0-1
            0,1,0,  0,-1,0,  0,0,1   // three apexes 2,3,4
        };
        std::vector<std::uint32_t> nmIdx = {0,1,2,  0,1,3,  0,1,4};  // edge 0-1 in 3 faces
        RepairReport rdt = repairMesh(nmPos, nmIdx, opt, op, oi);
        check(!rdt.ok && op.empty(), "[R3d] non-manifold (edge in 3 faces) -> ok=false (reason='%s')", rdt.reason);

        // (e) hole too LARGE to fill within maxHoleEdges -> left open -> ok=false.
        std::random_device rd2; std::mt19937 rng2(rd2());
        std::vector<double> sp; std::vector<std::uint32_t> si;
        icosphere(1.0, 2, sp, si);
        std::unordered_set<std::uint32_t> patch = growPatch(si, 30, rng2);
        // build open soup (no flips, shared verts kept) by dropping the patch
        std::vector<std::uint32_t> openIdx;
        std::uint32_t numF = static_cast<std::uint32_t>(si.size()/3);
        for (std::uint32_t f = 0; f < numF; ++f)
            if (!patch.count(f)) { openIdx.push_back(si[3*f]); openIdx.push_back(si[3*f+1]); openIdx.push_back(si[3*f+2]); }
        RepairOptions tightOpt; tightOpt.weldEps = 1e-9; tightOpt.maxHoleEdges = 3;  // too small for the loop
        RepairReport re = repairMesh(sp, openIdx, tightOpt, op, oi);
        // The opened patch boundary loop is longer than 3 edges, so it is left
        // open and the rebuild cannot be watertight -> ok=false.
        std::printf("    [R3e] patch=%zu maxHoleEdges=3 -> ok=%d holesLeftOpen=%u reason='%s'\n",
                    patch.size(), re.ok, re.holesLeftOpen, re.reason);
        check(!re.ok && op.empty(), "[R3e] hole too large for maxHoleEdges -> ok=false (left open, not guessed)");
    }

    std::printf("\n=== HEADLINE: R1a(dirty)=%s R1b(dirty)=%s R2(clean-id)=%s ===\n",
                r1a ? "PASS" : "FAIL", r1b ? "PASS" : "FAIL", r2 ? "PASS" : "FAIL");
    std::printf("=== ENVELOPE: comprehensive triangle-soup repair toward a clean watertight 2-manifold:\n");
    std::printf("===   spatial-hash vertex WELD (within eps) -> drop zero-area/degenerate tris ->\n");
    std::printf("===   remove exact-duplicate faces -> BFS face-orientation propagation for consistent\n");
    std::printf("===   winding per connected component -> EXACT-orient2d ear-clip fill of small boundary\n");
    std::printf("===   holes -> global OUTWARD orientation (signedVolume>0). A dirty sphere soup (exploded\n");
    std::printf("===   verts + flipped faces + a small hole) -> WATERTIGHT 2-MANIFOLD, Euler 2, volume\n");
    std::printf("===   within a few %% of the clean sphere. A clean closed mesh -> unchanged, 0 repairs.\n");
    std::printf("===   Empty / malformed / out-of-range / non-manifold / unfillable-hole -> ok=false (0 fakes). ===\n");
    std::printf("=== RESULT: %d / %d passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
