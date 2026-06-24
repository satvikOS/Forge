// dump_trimmed_face.cpp — build a curved trimmed-NURBS B-rep face (K1.2) and
// dump its trim-respecting tessellation to JSON for the milestone render.
// A quarter-cylinder NURBS surface trimmed to its full chart MINUS three
// circular holes — unmistakably a trimmed face (curved panel + clean cutouts).
#include "forge/native/brep/TrimmedFace.hpp"
#include "forge/native/brep/Nurbs.hpp"
#include "forge/native/brep/NurbsSurface.hpp"
#include "forge/native/brep/Curve.hpp"
#include <cmath>
#include <cstdio>
#include <vector>
using namespace forge::native::brep;
static const double k2Pi = 2.0 * M_PI;

static NurbsSurface makeQuarterCylinder(double R, double Hc) {
    NurbsSurface s;
    s.degreeU = 2; s.degreeV = 1;
    const double w = std::sqrt(2.0) / 2.0;
    s.control = {
        { {R, 0, 0}, {R, 0, Hc} },
        { {R, R, 0}, {R, R, Hc} },
        { {0, R, 0}, {0, R, Hc} },
    };
    s.weights = { {1.0, 1.0}, {w, w}, {1.0, 1.0} };
    s.knotsU = {0, 0, 0, 1, 1, 1};
    s.knotsV = {0, 0, 1, 1};
    return s;
}
static TrimLoop fullRectLoop() {
    TrimLoop loop; loop.isOuter = true;
    loop.segments.push_back(PCurve::makeLine2({0, 0}, {1, 0}));
    loop.segments.push_back(PCurve::makeLine2({1, 0}, {1, 1}));
    loop.segments.push_back(PCurve::makeLine2({1, 1}, {0, 1}));
    loop.segments.push_back(PCurve::makeLine2({0, 1}, {0, 0}));
    return loop;
}
static TrimLoop circleHoleLoop(double cu, double cv, double rho) {
    TrimLoop loop; loop.isOuter = false;
    loop.segments.push_back(PCurve::makeCircle2({cu, cv}, rho, k2Pi, 0.0));
    return loop;
}

int main() {
    TrimmedFace f;
    f.surface = makeQuarterCylinder(8.0, 13.0);
    f.loops.push_back(fullRectLoop());
    f.loops.push_back(circleHoleLoop(0.50, 0.50, 0.17));
    f.loops.push_back(circleHoleLoop(0.27, 0.74, 0.085));
    f.loops.push_back(circleHoleLoop(0.73, 0.26, 0.085));
    TessellateOptions opt; opt.loopSamples = 110; opt.interiorGrid = 44; opt.curvatureRefine = 3.0;
    TrimMesh m = tessellateTrimmedFace(f, opt);
    if (!m.ok) { std::fprintf(stderr, "tessellate failed: %s\n", m.reason); return 1; }
    FILE* fp = std::fopen("/tmp/ms_trimmed.json", "w");
    std::fprintf(fp, "{\"positions\":[");
    for (std::size_t i = 0; i < m.positions.size(); ++i) {
        const auto& p = m.positions[i];
        std::fprintf(fp, "%s%.6g,%.6g,%.6g", i ? "," : "", p.x, p.y, p.z);
    }
    std::fprintf(fp, "],\"indices\":[");
    for (std::size_t i = 0; i < m.triangles.size(); ++i) {
        const auto& t = m.triangles[i];
        std::fprintf(fp, "%s%u,%u,%u", i ? "," : "", t[0], t[1], t[2]);
    }
    std::fprintf(fp, "]}");
    std::fclose(fp);
    std::printf("trimmed face mesh: %zu verts, %zu tris (3 holes)\n",
                m.positions.size(), m.triangles.size());
    return 0;
}
