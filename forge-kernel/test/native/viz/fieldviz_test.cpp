// forge/native/test/viz/fieldviz_test.cpp
//
// Known-answer validation gate for forge::native::viz — the CAE field-
// visualization pipeline (#65, the ParaView-native track). Standalone, no
// framework, no deps. Every assertion checks a COMPUTED value against an
// ANALYTIC oracle (Bible §0/§9).
//
// GATES:
//   (A) WARP BY VECTOR — x' = x + scale·u verified exactly at several nodes;
//       length-mismatch throws.
//   (B) SCALAR COLORMAP — viridis endpoints (t=0 dark purple, t=1 yellow);
//       normalization is monotone + clamps out-of-range; perceived LUMINANCE
//       increases monotonically along t (viridis' defining property).
//   (C) ISOSURFACE OF A LINEAR FIELD -> PLANE — f(x,y,z)=x over the unit grid,
//       contour at L=0.55 MUST be the planar slice x=L: every triangle vertex
//       lies on x=L within tol, and the extracted area equals the unit cross-
//       section (1.0). [The rigorous geometric gate, part 1.]
//   (D) ISOSURFACE OF A RADIAL FIELD -> SPHERE — f=√(x²+y²+z²), contour at R=1
//       MUST be a sphere of radius R: every vertex satisfies |p|≈R, the mesh is
//       a CLOSED 2-manifold (no cracks / non-manifold edges, Euler char 2), and
//       its enclosed volume/area -> 4/3·π·R³ / 4·π·R². [The rigorous geometric
//       gate, part 2 — the marching-cubes topology check.]
//   (E) STREAMLINE (RK4) — a tracer in the rigid-rotation field v=(-ωy,ωx,0)
//       traces a circle of constant radius and returns to its start after one
//       period (analytic oracle: the exact circular orbit).
//
// The CONTOUR filter REUSES implicit::IsoMesher (the validated Lorensen-Cline
// marching cubes); this gate proves the field->geometry pipeline end to end.

#include "forge/native/viz/FieldViz.hpp"

#include <algorithm>
#include <cstdio>
#include <cmath>
#include <cstdint>
#include <map>
#include <string>
#include <vector>

using namespace forge::native;
using viz::Vec3;

static int g_passed = 0;
static int g_total  = 0;
static constexpr double PI = 3.14159265358979323846;

static void check(bool cond, const std::string& name, const std::string& detail) {
    ++g_total;
    if (cond) { ++g_passed; std::printf("  [PASS] %s\n", name.c_str()); }
    else      { std::printf("  [FAIL] %s -- %s\n", name.c_str(), detail.c_str()); }
}

// Build a structured scalar field by sampling an analytic function at every node.
template <class F>
static viz::StructuredScalarField buildScalarField(const Vec3& mn, const Vec3& mx,
                                                   int nx, int ny, int nz, F f) {
    viz::StructuredScalarField fld;
    fld.min = mn; fld.max = mx; fld.nx = nx; fld.ny = ny; fld.nz = nz;
    const int VX = nx + 1, VY = ny + 1, VZ = nz + 1;
    fld.values.resize(static_cast<std::size_t>(VX) * VY * VZ);
    const double dx = (mx.x - mn.x) / nx, dy = (mx.y - mn.y) / ny, dz = (mx.z - mn.z) / nz;
    for (int k = 0; k < VZ; ++k)
        for (int j = 0; j < VY; ++j)
            for (int i = 0; i < VX; ++i) {
                const Vec3 p{mn.x + i * dx, mn.y + j * dy, mn.z + k * dz};
                fld.values[(static_cast<std::size_t>(k) * VY + j) * VX + i] = f(p);
            }
    return fld;
}

// ---------------------------------------------------------------------------
// Closed-2-manifold audit on an indexed triangle soup: count incident faces per
// UNDIRECTED edge. Closed + 2-manifold <=> every edge has exactly 2 faces and
// no edge has 3+ (a crack would leave boundary edges; a non-manifold join would
// give 3+). Also computes the Euler characteristic V-E+F.
// ---------------------------------------------------------------------------
struct Audit { std::size_t boundaryEdges=0, nonManifoldEdges=0; long euler=0; bool closed=false; };
static Audit auditClosed(const viz::Mesh& m) {
    auto ekey = [](int u, int v) {
        std::uint32_t lo = u < v ? u : v, hi = u < v ? v : u;
        return (std::uint64_t(lo) << 32) | std::uint64_t(hi);
    };
    std::map<std::uint64_t, int> edgeFaces;
    for (const auto& t : m.triangles) {
        ++edgeFaces[ekey(t[0], t[1])];
        ++edgeFaces[ekey(t[1], t[2])];
        ++edgeFaces[ekey(t[2], t[0])];
    }
    Audit a;
    for (auto& [k, n] : edgeFaces) { (void)k;
        if (n == 1) ++a.boundaryEdges; else if (n >= 3) ++a.nonManifoldEdges; }
    a.closed = (a.boundaryEdges == 0 && a.nonManifoldEdges == 0);
    a.euler = static_cast<long>(m.positions.size())
            - static_cast<long>(edgeFaces.size())
            + static_cast<long>(m.triangles.size());
    return a;
}

// ===========================================================================
static void gateWarp() {
    std::printf("\n[gate A] warp by vector: x' = x + scale·u\n");
    std::vector<Vec3> pos = {{0,0,0}, {1,2,3}, {-1,0.5,4}};
    std::vector<Vec3> disp = {{1,0,0}, {0,-1,2}, {3,3,-3}};
    const double scale = 10.0;
    auto out = viz::warpByVector(pos, disp, scale);

    bool exact = true;
    double maxerr = 0.0;
    for (std::size_t i = 0; i < pos.size(); ++i) {
        const Vec3 expect{pos[i].x + scale*disp[i].x,
                          pos[i].y + scale*disp[i].y,
                          pos[i].z + scale*disp[i].z};
        const double e = std::fabs(out[i].x-expect.x)+std::fabs(out[i].y-expect.y)+std::fabs(out[i].z-expect.z);
        if (e > maxerr) maxerr = e;
        if (e > 1e-12) exact = false;
    }
    std::printf("    nodes=%zu  scale=%.1f  maxAbsErr=%.3e\n", pos.size(), scale, maxerr);
    check(exact, "warp deforms every node exactly (x'=x+scale·u)",
          "maxAbsErr=" + std::to_string(maxerr));

    bool threw = false;
    try { viz::warpByVector(pos, {{0,0,0}}, 1.0); } catch (const std::exception&) { threw = true; }
    check(threw, "warp rejects mismatched positions/displacements lengths", "no throw");
}

static void gateColormap() {
    std::printf("\n[gate B] viridis colormap: endpoints, clamp, luminance-monotone\n");

    const viz::RGB c0 = viz::viridisUnit(0.0);
    const viz::RGB c1 = viz::viridisUnit(1.0);
    std::printf("    t=0 -> (%.3f,%.3f,%.3f)  t=1 -> (%.3f,%.3f,%.3f)\n",
                c0.r, c0.g, c0.b, c1.r, c1.g, c1.b);
    // t=0 is dark purple (low R, ~0 G, mid B); t=1 is yellow (high R, high G, low B).
    check(c0.r < 0.35 && c0.g < 0.05 && c0.b > 0.25 && c0.b < 0.45,
          "viridis first colour is dark purple (t=0)", "endpoint colour wrong");
    check(c1.r > 0.9 && c1.g > 0.85 && c1.b < 0.25,
          "viridis last colour is yellow (t=1)", "endpoint colour wrong");

    // Normalization: vmin->first colour, vmax->last colour; out-of-range clamps.
    const double vmin = -50.0, vmax = 150.0;
    const viz::RGB lo  = viz::viridis(vmin, vmin, vmax);
    const viz::RGB hi  = viz::viridis(vmax, vmin, vmax);
    const viz::RGB under = viz::viridis(vmin - 1000.0, vmin, vmax); // below range
    const viz::RGB over  = viz::viridis(vmax + 1000.0, vmin, vmax); // above range
    auto same = [](const viz::RGB& a, const viz::RGB& b) {
        return std::fabs(a.r-b.r)+std::fabs(a.g-b.g)+std::fabs(a.b-b.b) < 1e-12; };
    check(same(lo, c0), "viridis(vmin) == first colour", "vmin not mapped to t=0");
    check(same(hi, c1), "viridis(vmax) == last colour", "vmax not mapped to t=1");
    check(same(under, c0) && same(over, c1),
          "viridis clamps out-of-range values to the endpoint colours", "clamp failed");

    // Monotone perceived luminance (Rec.601) along t — viridis' defining property.
    bool lumMono = true; double prevL = -1.0, minStep = 1e9;
    for (int s = 0; s <= 40; ++s) {
        const double t = s / 40.0;
        const viz::RGB c = viz::viridisUnit(t);
        const double L = 0.299*c.r + 0.587*c.g + 0.114*c.b;
        if (s > 0) { const double d = L - prevL; if (d <= 0.0) lumMono = false; if (d < minStep) minStep = d; }
        prevL = L;
    }
    std::printf("    luminance strictly increasing along t (min step %.5f)\n", minStep);
    check(lumMono, "viridis luminance increases monotonically along t",
          "luminance non-monotone (minStep=" + std::to_string(minStep) + ")");

    // Per-vertex colorization + auto-range.
    std::vector<double> field = {10, 20, 20, 30, 40};
    viz::Range r{};
    auto cols = viz::colormapFieldAuto(field, r);
    check(cols.size() == field.size() && r.vmin == 10.0 && r.vmax == 40.0,
          "colormapFieldAuto sizes output and auto-ranges [10,40]",
          "size/range wrong");
}

static void gatePlane() {
    std::printf("\n[gate C] isosurface of LINEAR field f=x -> PLANE x=L\n");
    const int n = 10;                 // 10 cells over [0,1]^3
    const double L = 0.55;            // mid-cell (vertices at 0,0.1,...,1.0)
    auto field = buildScalarField({0,0,0}, {1,1,1}, n, n, n,
                                  [](const Vec3& p){ return p.x; });
    viz::Mesh m = viz::contour(field, L);

    double maxOff = 0.0;
    for (const auto& v : m.positions) maxOff = std::max(maxOff, std::fabs(v.x - L));
    const double area = m.area();
    std::printf("    verts=%zu tris=%zu  max|x-L|=%.3e  area=%.10f (exact 1.0)\n",
                m.positions.size(), m.triangles.size(), maxOff, area);

    check(!m.triangles.empty(), "linear-field contour produced geometry", "empty mesh");
    check(maxOff < 1e-9, "every contour vertex lies on the plane x=L (planarity)",
          "maxOff=" + std::to_string(maxOff));
    check(std::fabs(area - 1.0) < 1e-6,
          "contour area equals the unit cross-section (1.0)",
          "area=" + std::to_string(area));
}

static void gateSphere() {
    std::printf("\n[gate D] isosurface of RADIAL field f=|p| -> SPHERE radius R\n");
    const int n = 40;                  // 40 cells over [-2,2]^3, h=0.1
    const double R = 1.0;
    const double exactVol = (4.0/3.0)*PI*R*R*R;
    const double exactArea = 4.0*PI*R*R;
    auto field = buildScalarField({-2,-2,-2}, {2,2,2}, n, n, n,
                                  [](const Vec3& p){ return std::sqrt(p.x*p.x+p.y*p.y+p.z*p.z); });
    viz::Mesh m = viz::contour(field, R);

    double maxRadDev = 0.0;
    for (const auto& v : m.positions) {
        const double rad = std::sqrt(v.x*v.x + v.y*v.y + v.z*v.z);
        maxRadDev = std::max(maxRadDev, std::fabs(rad - R));
    }
    const double vol = m.volume();
    const double area = m.area();
    const Audit a = auditClosed(m);
    std::printf("    verts=%zu tris=%zu  maxRadDev=%.4f  vol=%.5f (exact %.5f, err %.3f%%)\n",
                m.positions.size(), m.triangles.size(), maxRadDev, vol, exactVol,
                100.0*std::fabs(vol-exactVol)/exactVol);
    std::printf("    area=%.5f (exact %.5f, err %.3f%%)  boundaryEdges=%zu nonManifoldEdges=%zu euler=%ld\n",
                area, exactArea, 100.0*std::fabs(area-exactArea)/exactArea,
                a.boundaryEdges, a.nonManifoldEdges, a.euler);

    check(m.triangles.size() > 1000, "radial-field contour is a tessellated sphere (sphere-like tri count)",
          "tris=" + std::to_string(m.triangles.size()));
    check(maxRadDev < 0.02, "every contour vertex satisfies |p|≈R (radial tol)",
          "maxRadDev=" + std::to_string(maxRadDev));
    // The marching-cubes topology gate: no cracks, no non-manifold edges, χ=2.
    check(a.closed, "sphere isosurface is a CLOSED 2-manifold (no cracks/non-manifold edges)",
          "boundaryEdges=" + std::to_string(a.boundaryEdges) +
          " nonManifoldEdges=" + std::to_string(a.nonManifoldEdges));
    check(a.euler == 2, "sphere isosurface has Euler characteristic 2 (topological sphere)",
          "euler=" + std::to_string(a.euler));
    check(std::fabs(vol - exactVol)/exactVol < 0.02,
          "sphere enclosed volume within 2% of 4/3·π·R³",
          "relErr=" + std::to_string(std::fabs(vol-exactVol)/exactVol));
    check(std::fabs(area - exactArea)/exactArea < 0.05,
          "sphere surface area within 5% of 4·π·R²",
          "relErr=" + std::to_string(std::fabs(area-exactArea)/exactArea));
}

static void gateStreamline() {
    std::printf("\n[gate E] RK4 streamline in rigid-rotation field v=(-ωy,ωx,0)\n");
    const double omega = 1.0;
    const int n = 4;  // trilinear reproduces the LINEAR field exactly at any res
    viz::StructuredVectorField vf;
    vf.min = {-2,-2,-2}; vf.max = {2,2,2}; vf.nx = vf.ny = vf.nz = n;
    const int VX = n+1, VY = n+1, VZ = n+1;
    vf.values.resize(static_cast<std::size_t>(VX)*VY*VZ);
    const double d = 4.0 / n;
    for (int k=0;k<VZ;++k) for (int j=0;j<VY;++j) for (int i=0;i<VX;++i) {
        const double x = -2 + i*d, y = -2 + j*d;
        vf.values[(static_cast<std::size_t>(k)*VY + j)*VX + i] = Vec3{-omega*y, omega*x, 0.0};
    }

    const double radius = 1.0;
    const int N = 400;
    const double T = 2.0*PI/omega;     // one revolution
    const double dt = T / N;
    auto path = viz::streamline(vf, Vec3{radius,0,0}, dt, N);

    double maxRadDev = 0.0, maxZ = 0.0;
    for (const auto& p : path) {
        maxRadDev = std::max(maxRadDev, std::fabs(std::sqrt(p.x*p.x+p.y*p.y) - radius));
        maxZ = std::max(maxZ, std::fabs(p.z));
    }
    const Vec3 last = path.back();
    const double closeErr = std::sqrt((last.x-radius)*(last.x-radius) + last.y*last.y + last.z*last.z);
    std::printf("    steps=%zu  maxRadDev=%.3e  maxZ=%.3e  return-to-seed err=%.3e\n",
                path.size()-1, maxRadDev, maxZ, closeErr);

    check(path.size() == static_cast<std::size_t>(N)+1, "streamline produced one point per RK4 step",
          "len=" + std::to_string(path.size()));
    check(maxRadDev < 1e-3, "streamline stays on the circle (radius preserved)",
          "maxRadDev=" + std::to_string(maxRadDev));
    check(maxZ < 1e-9, "streamline stays in the z=0 plane", "maxZ=" + std::to_string(maxZ));
    check(closeErr < 1e-2, "streamline returns to its start after one period",
          "closeErr=" + std::to_string(closeErr));
}

int main() {
    std::printf("=== forge::native::viz — CAE field-visualization gate ===\n");
    std::printf("(contour REUSES implicit::IsoMesher; warp/colormap/streamline native; no deps)\n");
    gateWarp();
    gateColormap();
    gatePlane();
    gateSphere();
    gateStreamline();
    std::printf("\n=== RESULT: %d / %d passed ===\n", g_passed, g_total);
    return (g_passed == g_total) ? 0 : 1;
}
