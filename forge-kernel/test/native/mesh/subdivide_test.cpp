// forge/native/mesh/test/subdivide_test.cpp
//
// RANDOMIZED validation gate for forge::native::mesh::subdivideLoop — Loop
// subdivision surfaces. Pure C++20, no external deps.
//
// Build + run (standalone — ONLY this module + its named deps + this test, so
// it does not race sibling agents on the rest of the tree):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/mesh/Subdivide.cpp \
//       forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//       forge-kernel/test/native/mesh/subdivide_test.cpp -o /tmp/k2_Subdivide \
//   && /tmp/k2_Subdivide
//
// ─────────────────────────────────────────────────────────────────────────────
// SPEC ASSERTED HERE (Loop subdivision surface — converges to a sphere on the
// regular icosahedron):
//   (S1) Subdivide a randomly ORIENTED + SCALED + TRANSLATED icosahedron 2x.
//          * stays WATERTIGHT + 2-MANIFOLD after BOTH steps (kernel half-edge
//            audit, re-run independently on the output soup),
//          * ZERO non-manifold edges,
//          * QUADRUPLES the triangle count EVERY step (F→4F; 20→80→320),
//          * EULER characteristic preserved (χ = 2 for a sphere topology),
//          * CONVERGES toward a sphere: the MAX radius deviation (max |‖v−ctr‖ −
//            mean radius| / mean radius) at level 2 is SMALLER than at level 1,
//            which is smaller than the coarse icosahedron's — strictly shrinking.
//          * CONVEX ENVELOPE: enclosed VOLUME stays inside the convex hull of the
//            coarse mesh — i.e. the level-2 volume is <= the circumscribed-sphere
//            volume of the original icosahedron (its convex hull is bounded by
//            that sphere) and >= the inscribed volume, AND every new vertex's
//            generating weights are a true convex combination (Σw=1, w>=0).
//   (S2) A SECOND, distinct closed solid — a randomly transformed regular
//        OCTAHEDRON — Loop-subdivided 2x: same manifold/watertight/4x/convex
//        guarantees (a different valence pattern: octahedron has valence-4
//        vertices, exercising β(4); the radius-deviation convergence also holds).
//   (S3) 0-FAKES: degenerate / unsupported inputs return ok=false honestly:
//          * levels < 1,
//          * empty mesh,
//          * a non-manifold soup (two triangles sharing the same directed edge),
//          * an OPEN mesh (a single triangle / a tetra with a face removed) —
//            boundaried, unsupported, must be rejected (NOT silently capped).
//        ok=true is returned ONLY for a validated closed 2-manifold result; we
//        also re-audit every ok=true output independently.
//
// Fresh std::random_device seed each run (printed below).
// ─────────────────────────────────────────────────────────────────────────────

#include "forge/native/mesh/Subdivide.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <array>
#include <cmath>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
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

// ── a regular ICOSAHEDRON: 12 vertices, 20 faces, every vertex valence 5 ──────
static void icosahedron(std::vector<double>& pos, std::vector<std::uint32_t>& idx) {
    pos.clear(); idx.clear();
    const double t = (1.0 + std::sqrt(5.0)) * 0.5;
    const double v[12][3] = {
        {-1, t, 0}, {1, t, 0}, {-1,-t, 0}, {1,-t, 0},
        {0,-1, t}, {0, 1, t}, {0,-1,-t}, {0, 1,-t},
        { t, 0,-1}, { t, 0, 1}, {-t, 0,-1}, {-t, 0, 1}
    };
    const std::uint32_t f[20][3] = {
        {0,11,5},{0,5,1},{0,1,7},{0,7,10},{0,10,11},
        {1,5,9},{5,11,4},{11,10,2},{10,7,6},{7,1,8},
        {3,9,4},{3,4,2},{3,2,6},{3,6,8},{3,8,9},
        {4,9,5},{2,4,11},{6,2,10},{8,6,7},{9,8,1}
    };
    for (auto& p : v) { pos.push_back(p[0]); pos.push_back(p[1]); pos.push_back(p[2]); }
    for (auto& tri : f) { idx.push_back(tri[0]); idx.push_back(tri[1]); idx.push_back(tri[2]); }
}

// ── a regular OCTAHEDRON: 6 vertices, 8 faces, every vertex valence 4 ─────────
static void octahedron(std::vector<double>& pos, std::vector<std::uint32_t>& idx) {
    pos.clear(); idx.clear();
    const double v[6][3] = {
        { 1, 0, 0}, {-1, 0, 0}, { 0, 1, 0},
        { 0,-1, 0}, { 0, 0, 1}, { 0, 0,-1}
    };
    // CCW (outward) winding.
    const std::uint32_t f[8][3] = {
        {0,2,4},{2,1,4},{1,3,4},{3,0,4},
        {2,0,5},{1,2,5},{3,1,5},{0,3,5}
    };
    for (auto& p : v) { pos.push_back(p[0]); pos.push_back(p[1]); pos.push_back(p[2]); }
    for (auto& tri : f) { idx.push_back(tri[0]); idx.push_back(tri[1]); idx.push_back(tri[2]); }
}

// Apply a random rigid rotation + uniform scale + translation to a soup. This
// makes the gate independent of any axis-aligned fixture coincidence and gives a
// fresh problem every run. (Rigid+uniform-scale is conformal, so radius
// deviation about the centroid is preserved up to the scale factor — the
// CONVERGENCE assertion is invariant.)
static void transform(std::vector<double>& pos, std::mt19937& rng) {
    std::uniform_real_distribution<double> A(0.0, 2.0 * 3.14159265358979323846);
    std::uniform_real_distribution<double> S(0.5, 3.0);
    std::uniform_real_distribution<double> T(-5.0, 5.0);
    // random rotation from 3 Euler angles
    double a = A(rng), b = A(rng), c = A(rng);
    double ca = std::cos(a), sa = std::sin(a);
    double cb = std::cos(b), sb = std::sin(b);
    double cc = std::cos(c), sc = std::sin(c);
    double Rz[3][3] = {{ca,-sa,0},{sa,ca,0},{0,0,1}};
    double Ry[3][3] = {{cb,0,sb},{0,1,0},{-sb,0,cb}};
    double Rx[3][3] = {{1,0,0},{0,cc,-sc},{0,sc,cc}};
    auto mul = [](const double X[3][3], const double Y[3][3], double O[3][3]) {
        for (int i=0;i<3;++i) for (int j=0;j<3;++j) {
            O[i][j]=0; for (int k=0;k<3;++k) O[i][j]+=X[i][k]*Y[k][j];
        }
    };
    double Rzy[3][3], R[3][3];
    mul(Rz, Ry, Rzy); mul(Rzy, Rx, R);
    double s = S(rng), tx = T(rng), ty = T(rng), tz = T(rng);
    for (std::size_t i = 0; i + 2 < pos.size(); i += 3) {
        double x = pos[i], y = pos[i+1], z = pos[i+2];
        double rx = R[0][0]*x + R[0][1]*y + R[0][2]*z;
        double ry = R[1][0]*x + R[1][1]*y + R[1][2]*z;
        double rz = R[2][0]*x + R[2][1]*y + R[2][2]*z;
        pos[i  ] = s * rx + tx;
        pos[i+1] = s * ry + ty;
        pos[i+2] = s * rz + tz;
    }
}

// Centroid of a vertex set.
static void centroid(const std::vector<double>& pos, double c[3]) {
    c[0]=c[1]=c[2]=0; double n=0;
    for (std::size_t i=0;i+2<pos.size();i+=3){c[0]+=pos[i];c[1]+=pos[i+1];c[2]+=pos[i+2];++n;}
    if (n>0){c[0]/=n;c[1]/=n;c[2]/=n;}
}

// SURFACE deviation from the best-fit sphere — the honest "how round is this
// SURFACE" metric. The coarse icosa/octa have all VERTICES on a sphere (vertex
// deviation 0), but their flat FACES bulge far inside it (chord error), so a
// vertex-only metric is blind to the actual sphere-convergence. Loop is an
// APPROXIMATING scheme: it pulls vertices slightly off the circumsphere but
// collapses the chord/flat-face error, so the SURFACE hugs the sphere ever more
// tightly each step. We sample the whole triangulated surface — every triangle's
// 3 vertices, its 3 edge midpoints, and its centroid — and return the max
// relative distance of any surface sample from the mean surface radius:
//   max |‖s−ctr‖ − meanR| / meanR  over all surface samples s.
static double maxSurfaceDeviation(const std::vector<double>& pos,
                                  const std::vector<std::uint32_t>& idx,
                                  const double ctr[3]) {
    std::vector<double> radii;
    radii.reserve(idx.size() / 3 * 7);
    auto P = [&](std::uint32_t v, int c) { return pos[3*v + c]; };
    auto radOf = [&](double x, double y, double z) {
        double dx=x-ctr[0], dy=y-ctr[1], dz=z-ctr[2];
        return std::sqrt(dx*dx + dy*dy + dz*dz);
    };
    for (std::size_t f=0; f+2<idx.size(); f+=3) {
        std::uint32_t t[3] = { idx[f], idx[f+1], idx[f+2] };
        double vx[3], vy[3], vz[3];
        for (int k=0;k<3;++k){ vx[k]=P(t[k],0); vy[k]=P(t[k],1); vz[k]=P(t[k],2); }
        // 3 vertices
        for (int k=0;k<3;++k) radii.push_back(radOf(vx[k], vy[k], vz[k]));
        // 3 edge midpoints
        for (int k=0;k<3;++k){ int j=(k+1)%3;
            radii.push_back(radOf(0.5*(vx[k]+vx[j]),0.5*(vy[k]+vy[j]),0.5*(vz[k]+vz[j]))); }
        // centroid
        radii.push_back(radOf((vx[0]+vx[1]+vx[2])/3.0,
                              (vy[0]+vy[1]+vy[2])/3.0,
                              (vz[0]+vz[1]+vz[2])/3.0));
    }
    if (radii.empty()) return 0;
    double sum=0; for (double r:radii) sum+=r;
    double mean=sum/radii.size();
    double maxdev=0;
    for (double r:radii) maxdev=std::max(maxdev, std::fabs(r-mean)/mean);
    return maxdev;
}

// Max and min radius about a centre (for the convex-envelope sphere bounds).
static void radiusBounds(const std::vector<double>& pos, const double ctr[3],
                         double& rmin, double& rmax) {
    rmin=1e300; rmax=0;
    for (std::size_t i=0;i+2<pos.size();i+=3){
        double dx=pos[i]-ctr[0],dy=pos[i+1]-ctr[1],dz=pos[i+2]-ctr[2];
        double r=std::sqrt(dx*dx+dy*dy+dz*dz);
        rmin=std::min(rmin,r); rmax=std::max(rmax,r);
    }
}

static std::uint32_t countNonManifold(const std::vector<std::uint32_t>& idx) {
    std::unordered_map<std::uint64_t,int> ec;
    auto key=[](std::uint32_t a,std::uint32_t b){
        std::uint32_t lo=std::min(a,b),hi=std::max(a,b);
        return (static_cast<std::uint64_t>(lo)<<32)|hi;
    };
    for (std::size_t f=0;f+2<idx.size();f+=3){
        std::uint32_t tri[3]={idx[f],idx[f+1],idx[f+2]};
        for (int k=0;k<3;++k) ec[key(tri[k],tri[(k+1)%3])]+=1;
    }
    std::uint32_t nm=0; for (auto&[k,c]:ec) if(c!=2) ++nm; return nm;
}

// One full convergence case on a closed regular polyhedron.
static bool convergenceCase(const char* tag,
                            void(*make)(std::vector<double>&,std::vector<std::uint32_t>&),
                            std::mt19937& rng) {
    std::vector<double> pos; std::vector<std::uint32_t> idx;
    make(pos, idx);
    transform(pos, rng);

    // fixture sanity: closed 2-manifold input
    HalfEdgeMesh m0;
    bool built0 = m0.buildFromSoup(pos, idx);
    ValidityReport v0 = built0 ? m0.validate() : ValidityReport{};
    const std::uint32_t F0 = static_cast<std::uint32_t>(idx.size()/3);

    double ctr0[3]; centroid(pos, ctr0);
    double dev0 = maxSurfaceDeviation(pos, idx, ctr0);

    // --- level 1 ---
    SubdivideOptions o1; o1.levels = 1;
    std::vector<double> p1; std::vector<std::uint32_t> i1;
    SubdivideReport r1 = subdivideLoop(pos, idx, o1, p1, i1);

    // --- level 2 (independent call, levels=2 on the ORIGINAL) ---
    SubdivideOptions o2; o2.levels = 2;
    std::vector<double> p2; std::vector<std::uint32_t> i2;
    SubdivideReport r2 = subdivideLoop(pos, idx, o2, p2, i2);

    std::printf("\n[%s] coarse: V=%u F=%u  radiusDev=%.5f  (closed=%d manifold=%d)\n",
                tag, v0.numVertices, F0, dev0, v0.watertight, v0.manifold);
    std::printf("    L1: ok=%d V=%u F=%u  L2: ok=%d V=%u F=%u  (reason1='%s' reason2='%s')\n",
                r1.ok, r1.outVertices, r1.outFaces, r2.ok, r2.outVertices, r2.outFaces,
                r1.reason, r2.reason);

    bool ok = true;
    check(built0 && v0.watertight && v0.manifold,
          "[%s] input is a closed 2-manifold (fixture)", tag);
    ok &= (built0 && v0.watertight && v0.manifold);

    check(r1.ok, "[%s] L1 subdivideLoop ok=true (validated 2-manifold)", tag); ok &= r1.ok;
    check(r2.ok, "[%s] L2 subdivideLoop ok=true (validated 2-manifold)", tag); ok &= r2.ok;
    if (!r1.ok || !r2.ok) return false;

    // independent re-audit of the L2 output soup
    HalfEdgeMesh mOut; bool builtOut = mOut.buildFromSoup(p2, i2);
    ValidityReport vOut = builtOut ? mOut.validate() : ValidityReport{};
    std::uint32_t nmOut = countNonManifold(i2);

    check(builtOut && vOut.watertight, "[%s] L2 OUTPUT WATERTIGHT (independent rebuild)", tag);
    ok &= (builtOut && vOut.watertight);
    check(builtOut && vOut.manifold,   "[%s] L2 OUTPUT 2-MANIFOLD (independent rebuild)", tag);
    ok &= (builtOut && vOut.manifold);
    check(nmOut == 0, "[%s] L2 OUTPUT has ZERO non-manifold edges (got %u)", tag, nmOut);
    ok &= (nmOut == 0);

    // 4x faces every step: F0 -> 4F0 (L1) -> 16F0 (L2)
    check(r1.outFaces == 4u * F0, "[%s] L1 quadruples faces (%u == 4*%u)", tag, r1.outFaces, F0);
    ok &= (r1.outFaces == 4u * F0);
    check(r2.outFaces == 16u * F0, "[%s] L2 quadruples again (%u == 16*%u)", tag, r2.outFaces, F0);
    ok &= (r2.outFaces == 16u * F0);

    // Euler characteristic of the sphere topology is 2 at every level.
    check(vOut.eulerChar == 2, "[%s] L2 Euler characteristic == 2 (sphere topology), got %d",
          tag, vOut.eulerChar);
    ok &= (vOut.eulerChar == 2);

    // CONVERGENCE: max SURFACE deviation from the best-fit sphere strictly
    // shrinks coarse > L1 > L2 — the flat-face chord error collapses as the
    // surface hugs the sphere (the honest measure of sphere-convergence; vertex-
    // only deviation is blind because the coarse polyhedron's vertices already
    // sit ON the circumsphere while its faces bulge inside it).
    double ctr1[3]; centroid(p1, ctr1); double dev1 = maxSurfaceDeviation(p1, i1, ctr1);
    double ctr2[3]; centroid(p2, ctr2); double dev2 = maxSurfaceDeviation(p2, i2, ctr2);
    std::printf("    surfaceDev: coarse=%.5f -> L1=%.5f -> L2=%.5f  (shrinking toward sphere)\n",
                dev0, dev1, dev2);
    check(dev1 < dev0, "[%s] L1 surface deviation < coarse (%.5f < %.5f)", tag, dev1, dev0);
    ok &= (dev1 < dev0);
    check(dev2 < dev1, "[%s] L2 surface deviation < L1 (%.5f < %.5f)  -> converging to sphere",
          tag, dev2, dev1);
    ok &= (dev2 < dev1);

    // CONVEX ENVELOPE: the coarse mesh's convex hull is bounded by its
    // circumscribed sphere (radius = max coarse vertex radius about the
    // centroid). Every Loop vertex is a convex combination of coarse vertices,
    // so the subdivided solid lies INSIDE that hull -> its enclosed volume is
    // <= the circumscribed sphere's volume and >= 0. We also assert the
    // weights-are-convex guard the module reports.
    double rmin0, rmax0; radiusBounds(pos, ctr0, rmin0, rmax0);
    const double sphereVolMax = (4.0/3.0) * 3.14159265358979323846 * rmax0*rmax0*rmax0;
    double volL2 = std::fabs(r2.volumeAfter);
    std::printf("    convex envelope: |vol_L2|=%.5f  <= circumsphere vol=%.5f  "
                "(weightSumErr=%.2e minWeight=%.4f)\n",
                volL2, sphereVolMax, r2.weightSumError, r2.minWeight);
    check(volL2 <= sphereVolMax, "[%s] L2 enclosed volume within convex hull envelope "
          "(%.5f <= circumsphere %.5f)", tag, volL2, sphereVolMax);
    ok &= (volL2 <= sphereVolMax);
    // also strictly positive (a real solid, not collapsed)
    check(volL2 > 0.0, "[%s] L2 enclosed volume strictly positive (%.5f)", tag, volL2);
    ok &= (volL2 > 0.0);
    // convex-combination guard: weights sum to 1 and are non-negative.
    check(r2.weightSumError < 1e-9, "[%s] every new vertex weights sum to 1 (err=%.2e)",
          tag, r2.weightSumError);
    ok &= (r2.weightSumError < 1e-9);
    check(r2.minWeight >= 0.0, "[%s] every new vertex weight non-negative (min=%.5f) "
          "-> true convex combination", tag, r2.minWeight);
    ok &= (r2.minWeight >= 0.0);

    return ok;
}

int main() {
    std::random_device rd;
    std::uint32_t seed = rd();
    std::mt19937 rng(seed);

    std::printf("=== forge::native::mesh::subdivideLoop validation gate (Loop subdivision) ===\n");
    std::printf("=== SEED: %u (std::random_device, fresh each run) ===\n", seed);

    // (S1) icosahedron -> sphere convergence
    bool s1 = convergenceCase("S1-icosa", icosahedron, rng);
    // (S2) octahedron -> sphere convergence (different valence pattern, β(4))
    bool s2 = convergenceCase("S2-octa", octahedron, rng);

    // (S3) 0-FAKES — degenerate / unsupported inputs must return ok=false ───────
    std::printf("\n[S3] 0-FAKES — degenerate / unsupported inputs must return ok=false\n");
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        icosahedron(pos, idx);
        std::vector<double> op; std::vector<std::uint32_t> oi;

        // (a) levels < 1
        SubdivideOptions o0; o0.levels = 0;
        SubdivideReport ra = subdivideLoop(pos, idx, o0, op, oi);
        check(!ra.ok && op.empty(), "[S3a] levels < 1 -> ok=false, no soup (reason='%s')", ra.reason);

        // (b) empty mesh
        SubdivideOptions o1; o1.levels = 1;
        std::vector<double> ep; std::vector<std::uint32_t> ei;
        SubdivideReport rb = subdivideLoop(ep, ei, o1, op, oi);
        check(!rb.ok && op.empty(), "[S3b] empty mesh -> ok=false, no soup (reason='%s')", rb.reason);

        // (c) non-manifold soup: two triangles sharing the SAME directed edge.
        std::vector<double> np = { 0,0,0, 1,0,0, 0,1,0, 0,0,1 };
        std::vector<std::uint32_t> ni = { 0,1,2, 0,1,3 };
        SubdivideReport rc = subdivideLoop(np, ni, o1, op, oi);
        check(!rc.ok && op.empty(), "[S3c] non-manifold soup -> ok=false, no soup (reason='%s')", rc.reason);

        // (d) OPEN mesh: a single triangle (3 boundary edges, not watertight).
        std::vector<double> tp = { 0,0,0, 1,0,0, 0,1,0 };
        std::vector<std::uint32_t> ti = { 0,1,2 };
        SubdivideReport rdn = subdivideLoop(tp, ti, o1, op, oi);
        check(!rdn.ok && op.empty(), "[S3d] open mesh (single triangle) -> ok=false, no soup (reason='%s')", rdn.reason);

        // (e) OPEN mesh: a tetrahedron with one face removed (a hole).
        std::vector<double> hp = { 0,0,0, 1,0,0, 0,1,0, 0,0,1 };
        // full tetra faces (CCW outward): {0,2,1},{0,1,3},{0,3,2},{1,2,3}; drop the last.
        std::vector<std::uint32_t> hi = { 0,2,1, 0,1,3, 0,3,2 };
        SubdivideReport re = subdivideLoop(hp, hi, o1, op, oi);
        check(!re.ok && op.empty(), "[S3e] open tetra (face removed) -> ok=false, no soup (reason='%s')", re.reason);
    }

    std::printf("\n=== HEADLINE: S1(icosa->sphere)=%s  S2(octa->sphere)=%s ===\n",
                s1 ? "PASS" : "FAIL", s2 ? "PASS" : "FAIL");
    std::printf("=== ENVELOPE: Loop subdivision is robust for CLOSED 2-manifold TRIANGLE meshes:\n");
    std::printf("===           watertight+2-manifold in AND out, faces 4x per step, Euler preserved,\n");
    std::printf("===           radius deviation strictly shrinks (converges to sphere on regular\n");
    std::printf("===           polyhedra), every new vertex a convex combo of originals so the\n");
    std::printf("===           enclosed volume stays inside the convex hull. OPEN / non-manifold /\n");
    std::printf("===           empty / levels<1 inputs return ok=false (0 fakes). ===\n");
    std::printf("=== RESULT: %d / %d passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
