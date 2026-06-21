// forge/native/mesh/topologystats_test.cpp
//
// RANDOMIZED gate for forge::native::mesh::analyzeTopology — combinatorial mesh
// topology (V/E/F, components, boundary loops, Euler characteristic, genus,
// closed/manifold/orientable). Pure C++20, no external dependencies.
//
// Build + run (standalone — ONLY this module + its named deps, NOT the whole
// tree, so it does not race sibling agents):
//   cd /Users/account_clawteam1/archdisc-Mech && \
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/mesh/TopologyStats.cpp \
//       forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//       forge-kernel/test/native/mesh/topologystats_test.cpp \
//       -o /tmp/k3_TopologyStats && /tmp/k3_TopologyStats
//
// ─────────────────────────────────────────────────────────────────────────────
// SPEC validations (the headline win — an honest topology analyzer):
//   (S1) SPHERE (icosphere): chi=2, genus 0, closed, manifold, orientable,
//        1 component, 0 boundary loops.
//   (S2) TORUS (parametric grid): chi=0, genus 1, closed/manifold/orientable.
//   (S3) DOUBLE-TORUS (genus-2 slab-with-2-holes boundary): chi=-2, genus 2.
//   (S4) OPEN DISK (triangulated polygon): 1 boundary loop, chi=1, NOT closed,
//        manifold-with-boundary, orientable, genusKnown=false (no fake genus).
//   (S5) TWO DISJOINT SPHERES: 2 components, chi=4, genus 0 (sum over comps).
//   (S6) 0-FAKES honesty on pathological input:
//          * NON-MANIFOLD edge (3 triangles on one edge): isManifold=false,
//            orientKnown=false, genusKnown=false (no fabricated genus).
//          * NON-ORIENTABLE (Mobius band): orientable=false, but orientKnown=true,
//            genusKnown=false; it is a manifold-with-boundary so isManifold=true.
//          * BOW-TIE vertex (two triangles meeting only at a point):
//            isManifold=false (non-manifold vertex), genusKnown=false.
//          * degenerate input (bad index / repeated index / odd-length arrays):
//            ok=false.
//
// HONESTY (Bible §0/§9): genus is emitted ONLY when (closed && orientable &&
// manifold). Every "known" flag is asserted true/false exactly as the math
// demands. The test never weakens an assertion — it fixes the code.
//
// This gate is RANDOMIZED: it prints a fresh std::random_device seed each run
// (so it can never be cherry-picked) and uses it to jitter resolutions, radii,
// hole counts (genus), translations and a random rotation of every fixture, so
// the topology invariants are exercised on never-repeating geometry.
// ─────────────────────────────────────────────────────────────────────────────

#include "forge/native/mesh/TopologyStats.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <array>
#include <cmath>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <map>
#include <random>
#include <vector>

using namespace forge::native::mesh;

static int g_pass = 0, g_total = 0;
static void check(bool c, const char* fmt, ...) {
    ++g_total;
    char buf[512];
    va_list ap; va_start(ap, fmt); std::vsnprintf(buf, sizeof(buf), fmt, ap); va_end(ap);
    if (c) { ++g_pass; std::printf("  [PASS] %s\n", buf); }
    else    std::printf("  [FAIL] %s\n", buf);
}

struct Soup { std::vector<double> pos; std::vector<std::uint32_t> idx; };

static std::uint32_t addV(Soup& s, double x, double y, double z) {
    std::uint32_t id = static_cast<std::uint32_t>(s.pos.size() / 3);
    s.pos.push_back(x); s.pos.push_back(y); s.pos.push_back(z);
    return id;
}
static void addT(Soup& s, std::uint32_t a, std::uint32_t b, std::uint32_t c) {
    s.idx.push_back(a); s.idx.push_back(b); s.idx.push_back(c);
}

// ── icosphere builder (closed genus-0 2-manifold, 20*4^subdiv triangles) ──────
static Soup icosphere(int subdiv, double r, double cx, double cy, double cz) {
    const double t = (1.0 + std::sqrt(5.0)) / 2.0;
    std::vector<std::array<double, 3>> v = {
        {-1, t, 0}, {1, t, 0}, {-1, -t, 0}, {1, -t, 0},
        {0, -1, t}, {0, 1, t}, {0, -1, -t}, {0, 1, -t},
        {t, 0, -1}, {t, 0, 1}, {-t, 0, -1}, {-t, 0, 1},
    };
    std::vector<std::array<std::uint32_t, 3>> f = {
        {0,11,5},{0,5,1},{0,1,7},{0,7,10},{0,10,11},
        {1,5,9},{5,11,4},{11,10,2},{10,7,6},{7,1,8},
        {3,9,4},{3,4,2},{3,2,6},{3,6,8},{3,8,9},
        {4,9,5},{2,4,11},{6,2,10},{8,6,7},{9,8,1},
    };
    auto nrm = [](std::array<double, 3>& p) {
        double n = std::sqrt(p[0]*p[0] + p[1]*p[1] + p[2]*p[2]);
        p[0] /= n; p[1] /= n; p[2] /= n;
    };
    for (auto& p : v) nrm(p);
    for (int s = 0; s < subdiv; ++s) {
        std::map<std::uint64_t, std::uint32_t> mid;
        std::vector<std::array<std::uint32_t, 3>> nf;
        auto mp = [&](std::uint32_t a, std::uint32_t b) -> std::uint32_t {
            std::uint64_t key = a < b ? (std::uint64_t(a) << 32 | b)
                                      : (std::uint64_t(b) << 32 | a);
            auto it = mid.find(key);
            if (it != mid.end()) return it->second;
            std::array<double, 3> m = {
                0.5*(v[a][0]+v[b][0]), 0.5*(v[a][1]+v[b][1]), 0.5*(v[a][2]+v[b][2]) };
            nrm(m);
            std::uint32_t id = static_cast<std::uint32_t>(v.size());
            v.push_back(m); mid[key] = id; return id;
        };
        for (auto& tr : f) {
            std::uint32_t a = mp(tr[0], tr[1]), b = mp(tr[1], tr[2]), c = mp(tr[2], tr[0]);
            nf.push_back({tr[0], a, c}); nf.push_back({tr[1], b, a});
            nf.push_back({tr[2], c, b}); nf.push_back({a, b, c});
        }
        f.swap(nf);
    }
    Soup out;
    for (auto& p : v) { out.pos.push_back(cx + r*p[0]); out.pos.push_back(cy + r*p[1]); out.pos.push_back(cz + r*p[2]); }
    for (auto& tr : f) { out.idx.push_back(tr[0]); out.idx.push_back(tr[1]); out.idx.push_back(tr[2]); }
    return out;
}

// ── torus builder (closed genus-1 2-manifold) ────────────────────────────────
// nMaj segments around the main ring, nMin around the tube. CCW-consistent.
static Soup torus(int nMaj, int nMin, double R, double rr) {
    Soup s;
    auto vid = [&](int i, int j) { return static_cast<std::uint32_t>((i % nMaj) * nMin + (j % nMin)); };
    for (int i = 0; i < nMaj; ++i) {
        double u = 2.0 * M_PI * i / nMaj;
        for (int j = 0; j < nMin; ++j) {
            double w = 2.0 * M_PI * j / nMin;
            double x = (R + rr * std::cos(w)) * std::cos(u);
            double y = (R + rr * std::cos(w)) * std::sin(u);
            double z = rr * std::sin(w);
            addV(s, x, y, z);
        }
    }
    for (int i = 0; i < nMaj; ++i)
        for (int j = 0; j < nMin; ++j) {
            std::uint32_t a = vid(i, j), b = vid(i + 1, j), c = vid(i + 1, j + 1), d = vid(i, j + 1);
            addT(s, a, b, c);
            addT(s, a, c, d);
        }
    return s;
}

// ── genus-g surface: boundary of a thick slab with `g` square holes ──────────
// A horizontal slab [0,W]x[0,H]x{0,thk}. The top and bottom plates each have g
// rectangular holes; outer rim + each hole rim are vertical tube walls. The
// resulting closed orientable 2-manifold has genus exactly g. We build it as a
// triangulated quad mesh with consistent outward winding by construction; the
// test ASSERTS chi == 2-2g rather than trusting the claim.
//
// Construction strategy (robust & easy to wind): we tessellate the top plate as
// a grid, mark the cells that fall inside a hole as absent, and likewise for the
// bottom plate; then stitch every exposed boundary edge of the top grid down to
// the matching bottom-grid vertex with a vertical wall quad. Using a grid makes
// the hole rims automatic and keeps every vertex shared.
struct GridSlab {
    int nx, ny;          // grid cells in x and y
    double W, H, thk;
    std::vector<std::vector<bool>> present;  // present[i][j] cell (i in [0,nx), j in [0,ny))
};

static Soup slabWithHoles(int nx, int ny, double W, double H, double thk,
                          const std::vector<std::array<int,4>>& holes /*x0,y0,x1,y1 in cells*/) {
    GridSlab g; g.nx = nx; g.ny = ny; g.W = W; g.H = H; g.thk = thk;
    g.present.assign(nx, std::vector<bool>(ny, true));
    for (auto& h : holes)
        for (int i = h[0]; i < h[2]; ++i)
            for (int j = h[1]; j < h[3]; ++j)
                g.present[i][j] = false;

    Soup s;
    // vertex grid (nx+1)*(ny+1) for top, then for bottom.
    auto topV = [&](int i, int j) { return static_cast<std::uint32_t>(j * (nx + 1) + i); };
    int topCount = (nx + 1) * (ny + 1);
    auto botV = [&](int i, int j) { return static_cast<std::uint32_t>(topCount + j * (nx + 1) + i); };

    double dx = W / nx, dy = H / ny;
    for (int j = 0; j <= ny; ++j) for (int i = 0; i <= nx; ++i) addV(s, i*dx, j*dy, thk);
    for (int j = 0; j <= ny; ++j) for (int i = 0; i <= nx; ++i) addV(s, i*dx, j*dy, 0.0);

    auto cellPresent = [&](int i, int j) {
        return (i >= 0 && i < nx && j >= 0 && j < ny) && g.present[i][j];
    };

    // Top plate (normal +z, CCW seen from above): for each present cell.
    for (int j = 0; j < ny; ++j) for (int i = 0; i < nx; ++i) {
        if (!cellPresent(i, j)) continue;
        std::uint32_t a = topV(i, j), b = topV(i+1, j), c = topV(i+1, j+1), d = topV(i, j+1);
        addT(s, a, b, c); addT(s, a, c, d);          // CCW from +z (outward up)
    }
    // Bottom plate (normal -z, so reverse winding seen from above).
    for (int j = 0; j < ny; ++j) for (int i = 0; i < nx; ++i) {
        if (!cellPresent(i, j)) continue;
        std::uint32_t a = botV(i, j), b = botV(i+1, j), c = botV(i+1, j+1), d = botV(i, j+1);
        addT(s, a, c, b); addT(s, a, d, c);          // reversed -> outward down
    }
    // Walls: every grid edge that borders exactly one present cell is an exposed
    // boundary (outer rim or a hole rim). Stitch top->bottom with an outward quad.
    // Horizontal edges (along x), between cell rows j-1 and j at fixed j:
    //   edge from (i,j)-(i+1,j). Present below = cell(i,j-1); present above = cell(i,j).
    for (int j = 0; j <= ny; ++j) for (int i = 0; i < nx; ++i) {
        bool below = cellPresent(i, j - 1);
        bool above = cellPresent(i, j);
        if (below == above) continue;                 // interior or fully absent
        std::uint32_t t0 = topV(i, j), t1 = topV(i+1, j);
        std::uint32_t b0 = botV(i, j), b1 = botV(i+1, j);
        // Outward normal points toward the ABSENT side. Wind so the wall normal
        // is outward (away from material). If the present cell is ABOVE (+y side),
        // material is +y, outward is -y.
        if (above && !below) {
            // outward = -y : quad (t0,t1,b1,b0) wound so normal faces -y
            addT(s, t0, b1, t1); addT(s, t0, b0, b1);
        } else {
            // present below, outward = +y
            addT(s, t1, b0, t0); addT(s, t1, b1, b0);
        }
    }
    // Vertical edges (along y), between cell cols i-1 and i at fixed i:
    //   edge from (i,j)-(i,j+1). left = cell(i-1,j); right = cell(i,j).
    for (int i = 0; i <= nx; ++i) for (int j = 0; j < ny; ++j) {
        bool left  = cellPresent(i - 1, j);
        bool right = cellPresent(i, j);
        if (left == right) continue;
        std::uint32_t t0 = topV(i, j), t1 = topV(i, j+1);
        std::uint32_t b0 = botV(i, j), b1 = botV(i, j+1);
        if (right && !left) {
            // material +x, outward -x
            addT(s, t1, b0, t0); addT(s, t1, b1, b0);
        } else {
            // material -x, outward +x
            addT(s, t0, b1, t1); addT(s, t0, b0, b1);
        }
    }
    return s;
}

// ── open disk: a triangulated regular n-gon (fan), one boundary loop ─────────
static Soup diskFan(int n, double r) {
    Soup s;
    std::uint32_t c = addV(s, 0, 0, 0);
    std::vector<std::uint32_t> rim;
    for (int k = 0; k < n; ++k) {
        double a = 2.0 * M_PI * k / n;
        rim.push_back(addV(s, r * std::cos(a), r * std::sin(a), 0.0));
    }
    for (int k = 0; k < n; ++k) addT(s, c, rim[k], rim[(k + 1) % n]);
    return s;
}

// ── Mobius band: a triangulated strip with a half-twist (non-orientable) ─────
static Soup mobius(int n, double r, double w) {
    Soup s;
    // 2 rings of n+1 vertices but the last segment connects with a flip.
    // Standard parametrization: for k in [0,n], two edge points.
    std::vector<std::uint32_t> inner(n), outer(n);
    for (int k = 0; k < n; ++k) {
        double u = 2.0 * M_PI * k / n;           // around the loop
        double hu = u / 2.0;                      // half-twist
        // centre on the big circle, strip direction rotated by hu in the
        // (radial, z) plane.
        double cx = r * std::cos(u), cy = r * std::sin(u), cz = 0;
        double dxr = std::cos(u) * std::cos(hu);  // radial * cos
        double dyr = std::sin(u) * std::cos(hu);
        double dz  = std::sin(hu);
        inner[k] = addV(s, cx - 0.5*w*dxr, cy - 0.5*w*dyr, cz - 0.5*w*dz);
        outer[k] = addV(s, cx + 0.5*w*dxr, cy + 0.5*w*dyr, cz + 0.5*w*dz);
    }
    for (int k = 0; k < n - 1; ++k) {
        int kn = k + 1;
        // Normal quad (inner[k],outer[k]) -> (inner[kn],outer[kn]).
        addT(s, inner[k], outer[k], outer[kn]);
        addT(s, inner[k], outer[kn], inner[kn]);
    }
    // Closing seam (k=n-1 -> 0): the half-twist SWAPS the two long edges, so the
    // far end (inner[0],outer[0]) is glued in REVERSE — inner connects to outer
    // and vice-versa. THIS swap is what makes the band one-sided (non-orientable)
    // with a SINGLE boundary loop, distinguishing it from an ordinary cylinder.
    {
        int k = n - 1;
        addT(s, inner[k], outer[k], inner[0]);   // outer[0] role taken by inner[0]
        addT(s, inner[k], inner[0], outer[0]);   // and inner[0] role by outer[0]
    }
    return s;
}

// rotate a soup in place about a unit axis by angle th (keeps all topology).
static void rotateSoup(Soup& s, double ux, double uy, double uz, double th) {
    double n = std::sqrt(ux*ux + uy*uy + uz*uz); ux/=n; uy/=n; uz/=n;
    double c = std::cos(th), si = std::sin(th), C = 1 - c;
    double R[9] = {
        c + ux*ux*C,     ux*uy*C - uz*si, ux*uz*C + uy*si,
        uy*ux*C + uz*si, c + uy*uy*C,     uy*uz*C - ux*si,
        uz*ux*C - uy*si, uz*uy*C + ux*si, c + uz*uz*C };
    for (std::size_t i = 0; i + 2 < s.pos.size(); i += 3) {
        double x = s.pos[i], y = s.pos[i+1], z = s.pos[i+2];
        s.pos[i  ] = R[0]*x + R[1]*y + R[2]*z;
        s.pos[i+1] = R[3]*x + R[4]*y + R[5]*z;
        s.pos[i+2] = R[6]*x + R[7]*y + R[8]*z;
    }
}

// translate + append soup b into a (disjoint union, indices offset).
static void appendDisjoint(Soup& a, const Soup& b) {
    std::uint32_t off = static_cast<std::uint32_t>(a.pos.size() / 3);
    for (double p : b.pos) a.pos.push_back(p);
    for (std::uint32_t i : b.idx) a.idx.push_back(i + off);
}

int main() {
    std::random_device rd;
    std::uint32_t seed = rd();
    std::mt19937 rng(seed);
    std::uniform_real_distribution<double> U(0.0, 1.0);
    auto uni  = [&](double lo, double hi) { return lo + (hi - lo) * U(rng); };
    auto uniI = [&](int lo, int hi) { return lo + static_cast<int>((hi - lo + 1) * U(rng)); };

    std::printf("=== forge::native::mesh analyzeTopology (V/E/F, components, boundary,\n");
    std::printf("===   chi=V-E+F, genus, closed/manifold/orientable) gate ===\n");
    std::printf("=== SEED: %u (std::random_device, fresh each run) ===\n\n", seed);

    // ── (S1) SPHERE: chi=2, genus 0, closed/manifold/orientable, 1 comp ──────
    std::printf("[S1] icosphere: chi=2, genus 0, closed+manifold+orientable, 1 comp, 0 loops\n");
    bool s1 = true;
    {
        int sub = uniI(1, 3);
        Soup sp = icosphere(sub, uni(0.6, 1.7), uni(-2,2), uni(-2,2), uni(-2,2));
        rotateSoup(sp, uni(0.1,1), uni(0.1,1), uni(0.1,1), uni(0.2,1.2));
        // cross-check V/E/F against the half-edge builder for an accepted input.
        HalfEdgeMesh hm; bool built = hm.buildFromSoup(sp.pos, sp.idx);
        ValidityReport vr = hm.validate();
        TopologyReport t = analyzeTopology(sp.pos, sp.idx);
        s1 &= t.ok;
        bool c_chi = (t.eulerChar == 2);
        bool c_g   = (t.genusKnown && t.genus == 0);
        bool c_cl  = t.isClosed && t.isManifold && t.isOrientable && t.orientKnown;
        bool c_cmp = (t.components == 1);
        bool c_bl  = (t.boundaryLoops == 0);
        bool c_x   = built && vr.isValid()
                  && t.numVertices == vr.numVertices
                  && t.numEdges == vr.numEdges
                  && t.numFaces == vr.numFaces
                  && t.eulerChar == vr.eulerChar;
        check(c_chi, "(S1) chi==2 (got %d, sub=%d)", t.eulerChar, sub);
        check(c_g,   "(S1) genus 0 & genusKnown (got g=%d known=%d)", t.genus, (int)t.genusKnown);
        check(c_cl,  "(S1) closed+manifold+orientable");
        check(c_cmp, "(S1) 1 component (got %u)", t.components);
        check(c_bl,  "(S1) 0 boundary loops (got %u)", t.boundaryLoops);
        check(c_x,   "(S1) V/E/F/chi match HalfEdgeMesh::validate (V=%u E=%u F=%u)",
              t.numVertices, t.numEdges, t.numFaces);
        s1 &= c_chi && c_g && c_cl && c_cmp && c_bl && c_x;
    }
    std::printf("    (S1) = %s\n\n", s1 ? "PASS" : "FAIL");

    // ── (S2) TORUS: chi=0, genus 1, closed/manifold/orientable ───────────────
    std::printf("[S2] torus: chi=0, genus 1, closed+manifold+orientable, 1 comp, 0 loops\n");
    bool s2 = true;
    {
        int nMaj = uniI(12, 28), nMin = uniI(8, 20);
        Soup sp = torus(nMaj, nMin, uni(1.5, 3.0), uni(0.4, 0.9));
        rotateSoup(sp, uni(0.1,1), uni(0.1,1), uni(0.1,1), uni(0.2,1.2));
        TopologyReport t = analyzeTopology(sp.pos, sp.idx);
        bool c_chi = (t.eulerChar == 0);
        bool c_g   = (t.genusKnown && t.genus == 1);
        bool c_cl  = t.isClosed && t.isManifold && t.isOrientable;
        bool c_cmp = (t.components == 1);
        bool c_bl  = (t.boundaryLoops == 0);
        check(t.ok,  "(S2) analyze ok");
        check(c_chi, "(S2) chi==0 (got %d, %dx%d)", t.eulerChar, nMaj, nMin);
        check(c_g,   "(S2) genus 1 & genusKnown (got g=%d known=%d)", t.genus, (int)t.genusKnown);
        check(c_cl,  "(S2) closed+manifold+orientable");
        check(c_cmp, "(S2) 1 component (got %u)", t.components);
        check(c_bl,  "(S2) 0 boundary loops (got %u)", t.boundaryLoops);
        s2 = t.ok && c_chi && c_g && c_cl && c_cmp && c_bl;
    }
    std::printf("    (S2) = %s\n\n", s2 ? "PASS" : "FAIL");

    // ── (S3) DOUBLE-TORUS (genus 2): chi=-2, genus 2 ─────────────────────────
    // Built as the boundary of a thick slab with 2 separated square holes.
    std::printf("[S3] genus-2 slab (2 holes): chi=-2, genus 2, closed+manifold+orientable\n");
    bool s3 = true;
    {
        // grid big enough to host 2 disjoint, non-touching, non-border holes.
        int nx = uniI(7, 10), ny = uniI(5, 7);
        // two holes, each a single interior cell separated by >=1 cell, not on rim
        std::vector<std::array<int,4>> holes = {
            {2, 2, 3, 3},
            {nx - 3, ny - 3, nx - 2, ny - 2},
        };
        Soup sp = slabWithHoles(nx, ny, uni(4,7), uni(3,5), uni(0.4,1.0), holes);
        rotateSoup(sp, uni(0.1,1), uni(0.1,1), uni(0.1,1), uni(0.2,1.2));
        TopologyReport t = analyzeTopology(sp.pos, sp.idx);
        bool c_chi = (t.eulerChar == -2);
        bool c_g   = (t.genusKnown && t.genus == 2);
        bool c_cl  = t.isClosed && t.isManifold && t.isOrientable;
        bool c_cmp = (t.components == 1);
        check(t.ok,  "(S3) analyze ok");
        check(c_cl,  "(S3) closed+manifold+orientable (closed=%d mfld=%d orient=%d)",
              (int)t.isClosed, (int)t.isManifold, (int)t.isOrientable);
        check(c_chi, "(S3) chi==-2 (got %d, grid %dx%d)", t.eulerChar, nx, ny);
        check(c_g,   "(S3) genus 2 & genusKnown (got g=%d known=%d)", t.genus, (int)t.genusKnown);
        check(c_cmp, "(S3) 1 component (got %u)", t.components);
        s3 = t.ok && c_chi && c_g && c_cl && c_cmp;
    }
    std::printf("    (S3) = %s\n\n", s3 ? "PASS" : "FAIL");

    // Bonus: a genus-3 slab (3 holes) -> chi=-4, genus 3 (extra rigor, randomized)
    {
        int nx = uniI(9, 12), ny = 5;
        std::vector<std::array<int,4>> holes = {
            {1, 2, 2, 3}, {4, 2, 5, 3}, {nx - 2, 2, nx - 1, 3} };
        Soup sp = slabWithHoles(nx, ny, 6, 3, uni(0.4,1.0), holes);
        rotateSoup(sp, uni(0.1,1), uni(0.1,1), uni(0.1,1), uni(0.2,1.2));
        TopologyReport t = analyzeTopology(sp.pos, sp.idx);
        check(t.ok && t.isClosed && t.isManifold && t.isOrientable
              && t.eulerChar == -4 && t.genusKnown && t.genus == 3,
              "(S3b) genus-3 slab: chi==-4 genus 3 (got chi=%d g=%d known=%d)",
              t.eulerChar, t.genus, (int)t.genusKnown);
    }
    std::printf("\n");

    // ── (S4) OPEN DISK: 1 boundary loop, chi=1, not closed, no fake genus ────
    std::printf("[S4] open disk (n-gon fan): 1 boundary loop, chi=1, open, no fake genus\n");
    bool s4 = true;
    {
        int n = uniI(5, 40);
        Soup sp = diskFan(n, uni(0.5, 2.0));
        rotateSoup(sp, uni(0.1,1), uni(0.1,1), uni(0.1,1), uni(0.2,1.2));
        TopologyReport t = analyzeTopology(sp.pos, sp.idx);
        // disk: V = n+1, E = 2n, F = n  ->  chi = (n+1) - 2n + n = 1.
        bool c_chi = (t.eulerChar == 1);
        bool c_bl  = (t.boundaryLoops == 1);
        bool c_open= (!t.isClosed);
        bool c_mfd = (t.isManifold);            // manifold-with-boundary
        bool c_or  = (t.isOrientable && t.orientKnown);
        bool c_g   = (!t.genusKnown && t.genus == 0);   // 0 FAKES: no genus on open
        bool c_be  = (t.boundaryEdges == static_cast<std::uint32_t>(n));
        check(c_chi, "(S4) chi==1 (got %d, n=%d)", t.eulerChar, n);
        check(c_bl,  "(S4) exactly 1 boundary loop (got %u)", t.boundaryLoops);
        check(c_open,"(S4) NOT closed");
        check(c_mfd, "(S4) manifold-with-boundary");
        check(c_or,  "(S4) orientable & orientKnown");
        check(c_g,   "(S4) genusKnown==false (no fabricated genus on open mesh)");
        check(c_be,  "(S4) boundaryEdges==n (got %u, n=%d)", t.boundaryEdges, n);
        s4 = c_chi && c_bl && c_open && c_mfd && c_or && c_g && c_be;
    }
    std::printf("    (S4) = %s\n\n", s4 ? "PASS" : "FAIL");

    // ── (S5) TWO DISJOINT SPHERES: 2 components, chi=4, genus 0 ───────────────
    std::printf("[S5] two disjoint spheres: 2 components, chi=4, genus 0 (sum over comps)\n");
    bool s5 = true;
    {
        Soup a = icosphere(uniI(1,2), uni(0.5,1.0), 0, 0, 0);
        Soup b = icosphere(uniI(1,2), uni(0.5,1.0), uni(5,8), 0, 0);  // far apart
        rotateSoup(a, uni(0.1,1), uni(0.1,1), uni(0.1,1), uni(0.2,1.2));
        rotateSoup(b, uni(0.1,1), uni(0.1,1), uni(0.1,1), uni(0.2,1.2));
        appendDisjoint(a, b);
        TopologyReport t = analyzeTopology(a.pos, a.idx);
        bool c_cmp = (t.components == 2);
        bool c_chi = (t.eulerChar == 4);             // 2 + 2
        bool c_g   = (t.genusKnown && t.genus == 0);  // 0 + 0
        bool c_cl  = t.isClosed && t.isManifold && t.isOrientable;
        bool c_bl  = (t.boundaryLoops == 0);
        check(t.ok,  "(S5) analyze ok");
        check(c_cmp, "(S5) 2 components (got %u)", t.components);
        check(c_chi, "(S5) chi==4 (got %d)", t.eulerChar);
        check(c_g,   "(S5) total genus 0 & genusKnown (got g=%d)", t.genus);
        check(c_cl,  "(S5) closed+manifold+orientable");
        check(c_bl,  "(S5) 0 boundary loops (got %u)", t.boundaryLoops);
        s5 = t.ok && c_cmp && c_chi && c_g && c_cl && c_bl;
    }
    std::printf("    (S5) = %s\n\n", s5 ? "PASS" : "FAIL");

    // ── (S6) 0-FAKES on pathological input ───────────────────────────────────
    std::printf("[S6] 0-FAKES: non-manifold / non-orientable / bow-tie / degenerate honestly flagged\n");
    bool s6 = true;
    {
        // (a) NON-MANIFOLD EDGE: 3 triangles sharing edge 0-1.
        {
            Soup s;
            std::uint32_t v0 = addV(s, 0,0,0), v1 = addV(s, 1,0,0);
            std::uint32_t v2 = addV(s, 0,1,0), v3 = addV(s, 0,-1,0), v4 = addV(s, 0,0,1);
            addT(s, v0, v1, v2); addT(s, v0, v1, v3); addT(s, v0, v1, v4);
            TopologyReport t = analyzeTopology(s.pos, s.idx);
            bool ok = t.ok && !t.isManifold && t.nonManifoldEdges >= 1
                   && !t.orientKnown && !t.isOrientable && !t.genusKnown && t.genus == 0;
            check(ok, "(S6a) 3-faces-on-an-edge: non-manifold, orient undecided, no genus "
                      "(mfld=%d nmEdges=%u orientKnown=%d genusKnown=%d)",
                  (int)t.isManifold, t.nonManifoldEdges, (int)t.orientKnown, (int)t.genusKnown);
            s6 &= ok;
        }
        // (b) NON-ORIENTABLE: Mobius band (manifold-with-boundary, one-sided).
        {
            int n = uniI(12, 30);
            Soup sp = mobius(n, uni(1.5,2.5), uni(0.4,0.8));
            rotateSoup(sp, uni(0.1,1), uni(0.1,1), uni(0.1,1), uni(0.2,1.2));
            TopologyReport t = analyzeTopology(sp.pos, sp.idx);
            // The Mobius band has an edge-manifold structure (every edge 1 or 2
            // faces) so orientability IS decidable -> orientKnown=true, but the
            // half-twist makes it non-orientable. No genus on a bordered surface.
            bool ok = t.ok && t.orientKnown && !t.isOrientable
                   && !t.genusKnown && t.genus == 0 && t.boundaryLoops >= 1;
            check(ok, "(S6b) Mobius band: orientKnown && NOT orientable, no genus "
                      "(orientKnown=%d orientable=%d genusKnown=%d loops=%u)",
                  (int)t.orientKnown, (int)t.isOrientable, (int)t.genusKnown, t.boundaryLoops);
            s6 &= ok;
        }
        // (c) BOW-TIE VERTEX: two triangles meeting only at one shared vertex.
        {
            Soup s;
            std::uint32_t c = addV(s, 0,0,0);
            std::uint32_t a1 = addV(s, 1,0,0),  a2 = addV(s, 1,1,0);
            std::uint32_t b1 = addV(s, -1,0,0), b2 = addV(s, -1,1,0);
            addT(s, c, a1, a2);   // fan 1
            addT(s, c, b1, b2);   // fan 2 — shares only vertex c
            TopologyReport t = analyzeTopology(s.pos, s.idx);
            bool ok = t.ok && !t.isManifold && t.nonManifoldVertices >= 1
                   && !t.genusKnown && t.genus == 0;
            check(ok, "(S6c) bow-tie vertex: non-manifold vertex, no genus "
                      "(mfld=%d nmVerts=%u genusKnown=%d)",
                  (int)t.isManifold, t.nonManifoldVertices, (int)t.genusKnown);
            s6 &= ok;
        }
        // (d) DEGENERATE input: ok=false on bad index / repeated index / odd length.
        {
            // out-of-range index
            std::vector<double> p = {0,0,0, 1,0,0, 0,1,0};
            std::vector<std::uint32_t> bad = {0, 1, 9};
            TopologyReport t1 = analyzeTopology(p, bad);
            // repeated index in a triangle
            std::vector<std::uint32_t> rep = {0, 0, 1};
            TopologyReport t2 = analyzeTopology(p, rep);
            // positions length not multiple of 3
            std::vector<double> oddp = {0,0,0, 1,0};
            std::vector<std::uint32_t> tri = {0,1,2};
            TopologyReport t3 = analyzeTopology(oddp, tri);
            // indices length not multiple of 3
            std::vector<std::uint32_t> oddi = {0,1};
            TopologyReport t4 = analyzeTopology(p, oddi);
            bool ok = !t1.ok && !t2.ok && !t3.ok && !t4.ok;
            check(ok, "(S6d) degenerate inputs all return ok=false "
                      "(bad=%d rep=%d oddPos=%d oddIdx=%d)",
                  (int)t1.ok, (int)t2.ok, (int)t3.ok, (int)t4.ok);
            s6 &= ok;
        }
    }
    std::printf("    (S6) = %s\n\n", s6 ? "PASS" : "FAIL");

    std::printf("=== HEADLINE: sphere(chi2,g0) torus(chi0,g1) double-torus(chi-2,g2)\n");
    std::printf("===   disk(1 loop,chi1) two-spheres(2 comp) non-mfld/non-orient honest ===\n");
    std::printf("=== ENVELOPE (honest): combinatorial topology of an indexed triangle soup as a\n");
    std::printf("===   2-complex — V/E/F, face-connected components, boundary-loop count, Euler\n");
    std::printf("===   characteristic chi=V-E+F, edge+vertex manifoldness, orientability by\n");
    std::printf("===   consistent-orientation propagation, and genus (2C-chi)/2 emitted ONLY for\n");
    std::printf("===   closed+orientable+manifold input (genusKnown gates it). Non-manifold edges,\n");
    std::printf("===   bow-tie vertices, Mobius non-orientability and degenerate soups are flagged\n");
    std::printf("===   honestly — NO fabricated genus. Validated against icosphere/torus/genus-2,3\n");
    std::printf("===   slabs/disk/two-spheres + half-edge cross-check, randomized every run.\n");
    std::printf("=== RESULT: %d / %d passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
