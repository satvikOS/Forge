// forge/native/mesh/test/boolean2_test.cpp
//
// Standalone validation gate for the GENERAL mesh boolean
// (forge::native::mesh::meshBoolean — union / intersection / difference on two
// closed 2-manifold triangle solids). Pure C++20, no external deps. Build + run:
//
//   clang++ -std=c++20 -O2 -I forge-kernel/include \
//       forge-kernel/src/native/mesh/MeshBoolean2.cpp \
//       forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//       forge-kernel/src/native/mesh/TriTriIntersect.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/test/native/mesh/boolean2_test.cpp -o /tmp/b2 && /tmp/b2
//
// WHAT IS ASSERTED (every passing op MUST be watertight + 2-manifold + correct
// VOLUME within tolerance):
//   [1] two unit cubes overlapping by half (coplanar contact):
//         union 1.5, intersection 0.5, difference 0.5.
//   [2] cube MINUS a centered sphere (sphere fully enclosed) -> cube - sphere.
//   [3] cube INTERSECT sphere -> the sphere.
//   [4] cube UNION sphere (sphere enclosed) -> the cube.
//   [5] cube + sphere identity   A == (A∩B) ∪ (A−B)  (partition invariant).
//   [6] STRESS: 30 sequential small-sphere subtractions from one cube; EVERY
//       intermediate asserted watertight + 2-manifold + monotone volume.
//
// HONESTY (Bible §0/§9): a general mesh boolean is one of the hardest mesh
// algorithms. The ROBUST regime validated here is: non-coplanar-contact solids,
// coplanar axis-aligned contact (the cube-cube case), enclosed solids, clean
// single-face crossings, and well-separated sequential subtractions. The
// snap-rounding ceiling (robust-in-practice, NOT CGAL-exact) is exercised
// explicitly in [7] TARGETED: a sphere that pokes OUT through a face near a
// triangle boundary can produce coincident-but-not-identical cut points on the
// two surfaces; the engine DETECTS the resulting non-manifold and returns
// ok=false rather than emitting a self-intersecting fake. That detection is what
// [7] asserts — never a faked pass.

#include "forge/native/mesh/MeshBoolean2.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <vector>

using namespace forge::native::mesh;

static int g_pass = 0;
static int g_total = 0;
static void check(bool cond, const char* name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name); }
    else      {            std::printf("  [FAIL] %s\n", name); }
}

// ---- geometry helpers ------------------------------------------------------
static void cube(double ox,double oy,double oz,double s,
                 std::vector<double>& pos, std::vector<std::uint32_t>& idx) {
    pos = { ox,oy,oz, ox+s,oy,oz, ox+s,oy+s,oz, ox,oy+s,oz,
            ox,oy,oz+s, ox+s,oy,oz+s, ox+s,oy+s,oz+s, ox,oy+s,oz+s };
    idx = { 0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4,
            1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7 };
}

// Closed UV sphere, outward CCW.
static void sphere(double cx,double cy,double cz,double r,int nlat,int nlon,
                   std::vector<double>& pos, std::vector<std::uint32_t>& idx) {
    pos.clear(); idx.clear();
    auto V=[&](double x,double y,double z){
        std::uint32_t k=(std::uint32_t)(pos.size()/3);
        pos.push_back(x); pos.push_back(y); pos.push_back(z); return k; };
    std::uint32_t top=V(cx,cy,cz+r), bot=V(cx,cy,cz-r);
    std::vector<std::vector<std::uint32_t>> ring(nlat-1);
    for (int i=1;i<nlat;++i){ double th=M_PI*i/nlat;
        for (int j=0;j<nlon;++j){ double ph=2*M_PI*j/nlon;
            ring[i-1].push_back(V(cx+r*std::sin(th)*std::cos(ph),
                                  cy+r*std::sin(th)*std::sin(ph),
                                  cz+r*std::cos(th))); } }
    for (int j=0;j<nlon;++j){ idx.push_back(top); idx.push_back(ring[0][j]); idx.push_back(ring[0][(j+1)%nlon]); }
    for (int i=0;i<nlat-2;++i) for(int j=0;j<nlon;++j){
        std::uint32_t a=ring[i][j], b=ring[i][(j+1)%nlon], c=ring[i+1][(j+1)%nlon], d=ring[i+1][j];
        idx.push_back(a); idx.push_back(d); idx.push_back(b);
        idx.push_back(b); idx.push_back(d); idx.push_back(c); }
    int last=nlat-2;
    for (int j=0;j<nlon;++j){ idx.push_back(bot); idx.push_back(ring[last][(j+1)%nlon]); idx.push_back(ring[last][j]); }
}

// Mesh volume of a closed soup (for cross-checking against the boolean result).
static double soupVolume(const std::vector<double>& pos, const std::vector<std::uint32_t>& idx) {
    HalfEdgeMesh m; if (!m.buildFromSoup(pos,idx)) return 0.0;
    return m.signedVolume();
}

static bool validClosed(const HalfEdgeMesh& m) {
    ValidityReport vr = m.validate();
    return vr.isValid(); // twins consistent + 2-manifold + watertight
}

int main() {
    std::printf("=== forge::native::mesh general boolean gate ===\n");

    // ---- [1] two unit cubes overlapping by half ------------------------
    std::printf("\n[1] two unit cubes overlapping by half (coplanar contact)\n");
    {
        std::vector<double> ap,bp; std::vector<std::uint32_t> ai,bi;
        cube(0,0,0,1.0,ap,ai);          // [0,1]^3
        cube(0.5,0,0,1.0,bp,bi);        // [0.5,1.5]x[0,1]x[0,1]

        BoolResult u = meshBoolean(ap,ai,bp,bi,BoolOp::UNION);
        std::printf("    union:        ok=%d vol=%.6f (expect 1.5)  [%s]\n",
                    (int)u.ok, u.ok?u.mesh.signedVolume():0.0, u.reason);
        check(u.ok && validClosed(u.mesh), "union closed 2-manifold");
        check(u.ok && std::fabs(u.mesh.signedVolume()-1.5)<1e-6, "union volume == 1.5");

        BoolResult n = meshBoolean(ap,ai,bp,bi,BoolOp::INTERSECTION);
        std::printf("    intersection: ok=%d vol=%.6f (expect 0.5)  [%s]\n",
                    (int)n.ok, n.ok?n.mesh.signedVolume():0.0, n.reason);
        check(n.ok && validClosed(n.mesh), "intersection closed 2-manifold");
        check(n.ok && std::fabs(n.mesh.signedVolume()-0.5)<1e-6, "intersection volume == 0.5");

        BoolResult d = meshBoolean(ap,ai,bp,bi,BoolOp::DIFFERENCE);
        std::printf("    difference:   ok=%d vol=%.6f (expect 0.5)  [%s]\n",
                    (int)d.ok, d.ok?d.mesh.signedVolume():0.0, d.reason);
        check(d.ok && validClosed(d.mesh), "difference closed 2-manifold");
        check(d.ok && std::fabs(d.mesh.signedVolume()-0.5)<1e-6, "difference volume == 0.5");
    }

    // ---- [2..5] cube vs a centered (fully enclosed) sphere -------------
    std::printf("\n[2-5] cube vs centered enclosed sphere\n");
    {
        std::vector<double> cp,sp; std::vector<std::uint32_t> ci,si;
        cube(-1,-1,-1,2.0,cp,ci);            // [-1,1]^3, vol 8
        sphere(0,0,0,0.8, 16,24, sp,si);     // enclosed sphere
        double cubeVol = 8.0;
        double sphVol  = soupVolume(sp,si);  // MESH sphere volume (the truth here)
        std::printf("    cube vol=%.5f  mesh-sphere vol=%.5f\n", cubeVol, sphVol);

        BoolResult d = meshBoolean(cp,ci,sp,si,BoolOp::DIFFERENCE);
        check(d.ok && validClosed(d.mesh), "[2] cube-sphere closed 2-manifold");
        check(d.ok && std::fabs(d.mesh.signedVolume()-(cubeVol-sphVol))<1e-6,
              "[2] cube-sphere volume == 8 - sphere");

        BoolResult n = meshBoolean(cp,ci,sp,si,BoolOp::INTERSECTION);
        check(n.ok && validClosed(n.mesh), "[3] cube∩sphere closed 2-manifold");
        check(n.ok && std::fabs(n.mesh.signedVolume()-sphVol)<1e-6,
              "[3] cube∩sphere volume == sphere");

        BoolResult u = meshBoolean(cp,ci,sp,si,BoolOp::UNION);
        check(u.ok && validClosed(u.mesh), "[4] cube∪sphere closed 2-manifold");
        check(u.ok && std::fabs(u.mesh.signedVolume()-cubeVol)<1e-6,
              "[4] cube∪sphere volume == cube (sphere enclosed)");

        // [5] partition invariant: cube = (cube∩sphere) ∪ (cube−sphere).
        double part = (n.ok?n.mesh.signedVolume():0.0) + (d.ok?d.mesh.signedVolume():0.0);
        std::printf("    partition (cube∩s)+(cube-s)=%.6f (expect 8)\n", part);
        check(n.ok && d.ok && std::fabs(part-cubeVol)<1e-6,
              "[5] partition invariant cube == (cube∩s) ∪ (cube-s)");
    }

    // ---- [6] STRESS: 30 sequential small-sphere subtractions -----------
    std::printf("\n[6] STRESS: 30 sequential small-sphere subtractions from one cube\n");
    {
        std::vector<double> cp; std::vector<std::uint32_t> ci;
        cube(-2,-2,-2,4.0,cp,ci);                  // [-2,2]^3, vol 64
        HalfEdgeMesh acc; acc.buildFromSoup(cp,ci);
        int ok_count=0; double prevVol=acc.signedVolume(); bool everyValid=true;
        for (int k=0;k<30;++k){
            int gx=k%3, gy=(k/3)%3, gz=k/9;        // 3x3x4 lattice
            double cx=-1.2+gx*1.2, cy=-1.2+gy*1.2, cz=-1.2+gz*0.8;
            double r=0.3;                          // well-separated internal holes
            std::vector<double> sp; std::vector<std::uint32_t> si;
            sphere(cx,cy,cz,r, 8,12, sp,si);
            std::vector<double> ap; std::vector<std::uint32_t> ai; acc.toSoup(ap,ai);
            BoolResult res=meshBoolean(ap,ai,sp,si,BoolOp::DIFFERENCE);
            if (!res.ok){ std::printf("    step %d FAILED: %s\n",k,res.reason); everyValid=false; break; }
            if (!validClosed(res.mesh)){ std::printf("    step %d not valid closed 2-manifold\n",k); everyValid=false; break; }
            double v=res.mesh.signedVolume();
            if (v >= prevVol){ std::printf("    step %d volume did not decrease (%.4f>=%.4f)\n",k,v,prevVol); everyValid=false; break; }
            prevVol=v; acc=std::move(res.mesh); ++ok_count;
        }
        std::printf("    %d/30 sequential subtractions stayed watertight 2-manifold (final vol=%.4f)\n",
                    ok_count, acc.signedVolume());
        check(ok_count==30 && everyValid, "[6] all 30 intermediates watertight 2-manifold + monotone volume");
    }

    // ---- [7] TARGETED: boundary-grazing poke-out -> HONEST ok=false ----
    // A sphere that pokes OUT a face such that its cut grazes a triangle
    // boundary produces coincident-but-not-bit-identical cut points on the two
    // surfaces (the snap-rounding ceiling). The engine MUST DETECT the resulting
    // non-manifold and return ok=false — NEVER a self-intersecting fake. We
    // assert that an honest failure (or a valid mesh, if it happens to resolve)
    // is reported, but NEVER ok==true with an invalid mesh.
    std::printf("\n[7] TARGETED: boundary-grazing poke-out is detected (honest ok=false, never a fake)\n");
    {
        std::vector<double> cp,sp; std::vector<std::uint32_t> ci,si;
        cube(-2,-2,-2,4.0,cp,ci);
        sphere(-0.5,1.75,0.265,0.35, 8,12, sp,si);  // pokes out the +y face, grazing
        BoolResult d = meshBoolean(cp,ci,sp,si,BoolOp::DIFFERENCE);
        std::printf("    result: ok=%d  reason=%s\n", (int)d.ok, d.reason);
        // The contract: ok==true IMPLIES a valid closed 2-manifold. The engine
        // must never claim success on a broken mesh.
        check(!d.ok || validClosed(d.mesh),
              "[7] ok==true ONLY if the result is a genuine closed 2-manifold (no fake)");
        if (!d.ok) std::printf("    >>> HONEST: detected non-manifold/snap-rounding wall, returned ok=false (TARGETED).\n");
        else        std::printf("    >>> resolved to a valid closed 2-manifold.\n");
    }

    std::printf("\n=== %d/%d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
