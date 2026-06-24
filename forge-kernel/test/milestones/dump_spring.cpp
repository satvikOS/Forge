// dump_spring.cpp — milestone: a helical-sweep coil (spring), the native
// curved-path sweep. Circular profile RMF-transported along a constant-pitch
// helix -> closed 2-manifold coiled tube. Dumps the tessellation to JSON.
#include "forge/native/brep/HelicalSweep.hpp"
#include "forge/native/brep/SolidTessellate.hpp"
#include <cstdio>
#include <vector>
#include <cstdint>
using namespace forge::native::brep;

int main() {
    HelixSpec spec;
    spec.coilRadius = 3.0; spec.pitch = 2.2; spec.turns = 5.0;
    spec.profileRadius = 0.5; spec.stepsPerTurn = 160; spec.profileSegments = 48;
    HelicalSweepResult r = helicalSweep(spec);
    if (!r.ok || !r.solid) { std::fprintf(stderr, "helicalSweep failed\n"); return 1; }
    std::vector<double> pos; std::vector<std::uint32_t> idx;
    tessellateSolid(*r.solid, pos, idx);
    FILE* fp = std::fopen("/tmp/ms_spring.json", "w");
    std::fprintf(fp, "{\"positions\":[");
    for (std::size_t i = 0; i < pos.size(); ++i) std::fprintf(fp, "%s%.5g", i ? "," : "", pos[i]);
    std::fprintf(fp, "],\"indices\":[");
    for (std::size_t i = 0; i < idx.size(); ++i) std::fprintf(fp, "%s%u", i ? "," : "", idx[i]);
    std::fprintf(fp, "]}");
    std::fclose(fp);
    std::printf("spring: vol=%.4f verts=%zu tris=%zu closed=%d\n", r.volume, pos.size()/3, idx.size()/3, r.closedManifold);
    return 0;
}
