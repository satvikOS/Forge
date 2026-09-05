// ft_edge_selector_test.cpp — dump the edge inventory and the edge SET that
// forge::ft::selectEdgeIds picks, for one feature-tree IR program.
//
// This is the kernel HALF of the selector gate. The Python half
// (scripts/selector_gate.py) builds the geometrically identical solid in
// CadQuery, asks CadQuery which edges ITS selector picks, and requires the two
// sets to be equal, selector by selector.
//
// WHY IR AND NOT A STEP FILE. The first version of this test imported a STEP
// exported by CadQuery. That measured the STEP READER, not the selector:
// forge::io::importStep returns a FACETED approximation of a filleted box —
// measured, every edge of `box(30,20,5).edges("|Z").fillet(4)` comes back as
// GeomAbs_Line, including face diagonals, and a quarter-circle fillet arc
// evaluates as a straight chord. Building through the IR exercises exactly the
// path the corpus uses (kernel-built solids), so a disagreement here is a
// disagreement about SELECTION and nothing else.
//
// Output, one record per line:
//   EDGE <id> <cx> <cy> <cz> <len>     every edge, arc-length centroid + length
//   SEL  <expr> <id>                   one selected edge per line
//   COUNT <expr> <n>
//   ERROR <expr> <message>
// Edges are reported by id AND by geometry because the id is a TopExp position
// that means nothing outside this build.
//
// Build (against a candidate tree, never the pin):
//   clang++ -std=c++20 -O2 -arch arm64 -Iinclude -I$OCCT/include/opencascade \
//     -DFORGE_NATIVE_BREP test/ft_edge_selector_test.cpp \
//     -Lbuild-selectors/Release -lforge_kernel_core \
//     -Wl,-rpath,$PWD/build-selectors/Release -o build-selectors/ft_edge_selector_test
//
// Usage:  ft_edge_selector_test <program.ir> <SEL> [SEL ...]
//   Each SEL is one selector EXPRESSION; '+' unions keywords, so "MAX_Z+MIN_Z"
//   is CadQuery's ">Z or <Z".

#include <cmath>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "forge/DirectModeling.hpp"
#include "forge/ft/FeatureTree.hpp"

namespace {

void edgeKey(const std::vector<float>& p, double c[3], double& len) {
    const std::size_t n = p.size() / 3;
    len = 0.0;
    c[0] = c[1] = c[2] = 0.0;
    if (n == 0) return;
    if (n == 1) { for (int k = 0; k < 3; ++k) c[k] = p[k]; return; }
    double acc[3] = {0, 0, 0};
    for (std::size_t i = 0; i + 1 < n; ++i) {
        double d[3];
        for (int k = 0; k < 3; ++k) d[k] = double(p[3 * (i + 1) + k]) - double(p[3 * i + k]);
        const double L = std::sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
        len += L;
        for (int k = 0; k < 3; ++k)
            acc[k] += L * 0.5 * (double(p[3 * i + k]) + double(p[3 * (i + 1) + k]));
    }
    if (len > 1e-15) for (int k = 0; k < 3; ++k) c[k] = acc[k] / len;
    else             for (int k = 0; k < 3; ++k) c[k] = p[k];
}

std::vector<std::string> splitPlus(const std::string& s) {
    std::vector<std::string> out;
    std::string cur;
    for (char ch : s) {
        if (ch == '+') { if (!cur.empty()) out.push_back(cur); cur.clear(); }
        else cur.push_back(ch);
    }
    if (!cur.empty()) out.push_back(cur);
    return out;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 3) {
        std::fprintf(stderr, "usage: %s <program.ir> <SEL> [SEL ...]\n", argv[0]);
        return 2;
    }
    std::ifstream in(argv[1]);
    if (!in) { std::fprintf(stderr, "cannot read %s\n", argv[1]); return 2; }
    std::stringstream ss;
    ss << in.rdbuf();

    forge::ft::CompileResult r = forge::ft::compileText(ss.str(), "", "");
    if (!r.ok || r.handle == 0) {
        std::printf("BUILD-FAILED %s\n", r.error.c_str());
        return 3;
    }
    std::printf("VOLUME %.6f\n", r.volume);

    // Same sampling the selector uses, so a printed key describes the edge the
    // kernel actually chose rather than a coarser version of it.
    auto segs = forge::direct::edgeSegments(r.handle, 0.25);
    double lo[3] = {1e300, 1e300, 1e300}, hi[3] = {-1e300, -1e300, -1e300};
    for (const auto& e : segs)
        for (std::size_t i = 0; i + 2 < e.points.size(); i += 3)
            for (int k = 0; k < 3; ++k) {
                const double v = e.points[i + k];
                if (v < lo[k]) lo[k] = v;
                if (v > hi[k]) hi[k] = v;
            }
    double diag = 0.0;
    if (lo[0] <= hi[0]) {
        const double dx = hi[0] - lo[0], dy = hi[1] - lo[1], dz = hi[2] - lo[2];
        diag = std::sqrt(dx * dx + dy * dy + dz * dz);
    }
    const double defl = diag * 1.0e-5;
    if (defl > 1e-9 && defl < 0.25) {
        auto fine = forge::direct::edgeSegments(r.handle, defl);
        if (fine.size() == segs.size()) segs.swap(fine);
    }
    for (const auto& e : segs) {
        double c[3], len;
        edgeKey(e.points, c, len);
        std::printf("EDGE %u %.6f %.6f %.6f %.6f\n", e.id, c[0], c[1], c[2], len);
    }

    int rc = 0;
    for (int a = 2; a < argc; ++a) {
        const std::string expr = argv[a];
        std::vector<std::uint32_t> ids;
        try {
            ids = forge::ft::selectEdgeIds(r.handle, splitPlus(expr));
        } catch (const std::exception& e) {
            std::printf("ERROR %s %s\n", expr.c_str(), e.what());
            rc = 1;
            continue;
        }
        for (std::uint32_t id : ids) std::printf("SEL %s %u\n", expr.c_str(), id);
        std::printf("COUNT %s %zu\n", expr.c_str(), ids.size());
    }
    return rc;
}
