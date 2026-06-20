// forge/native/test/voxel/voxelmesh_test.cpp
//
// Stage 5 voxel->mesh validation gate (standalone, no framework, no deps). This
// is the gate for VoxelMesh.hpp — the voxel-field -> half-edge surface bridge
// that REUSES the shared implicit::IsoMesher and the canonical mesh::HalfEdgeMesh
// (no duplicate mesher / grid / mesh type). Every assertion checks a COMPUTED
// value against an ANALYTIC oracle (Bible §0/§9, roadmap §D rule 2).
//
// GATES:
//   (A) SPHERE -> CLOSED 2-MANIFOLD, VOLUME -> 4/3 pi r^3 (shrinking error).
//       Voxelize an SDF sphere (strictly interior to the grid box) at shrinking
//       spacings; contour each; assert the mesh is closed + 2-manifold via
//       HalfEdgeMesh::validate(), and that its signedVolume() converges to the
//       closed-form sphere volume with the error DECREASING under refinement.
//   (B) GYROID -> CONNECTED 2-MANIFOLD SURFACE.
//       Contour an iso=0 gyroid TPMS field; assert the surface is 2-manifold
//       (every undirected edge has 1 or 2 incident faces — manifold WITH
//       boundary, since the bicontinuous gyroid is clipped open at the box
//       faces) and is a single connected component over face adjacency.
//
// Build + run (standalone):
//   clang++ -std=c++20 -O2 -I <include> \
//       src/native/mesh/HalfEdgeMesh.cpp \
//       src/native/implicit/SdfTree.cpp src/native/implicit/IsoMesher.cpp \
//       src/native/voxel/VoxelGrid.cpp src/native/voxel/VoxelMesh.cpp \
//       src/native/Predicates.cpp \
//       test/native/voxel/voxelmesh_test.cpp -o /tmp/voxelmesh_test && /tmp/voxelmesh_test

#include "forge/native/voxel/VoxelMesh.hpp"
#include "forge/native/voxel/Tpms.hpp"

#include <cstdio>
#include <cmath>
#include <vector>
#include <string>
#include <map>
#include <utility>

using namespace forge::native;

static int g_passed = 0;
static int g_total  = 0;

static void check(bool cond, const std::string& name, const std::string& detail) {
    ++g_total;
    if (cond) {
        ++g_passed;
        std::printf("  [PASS] %s\n", name.c_str());
    } else {
        std::printf("  [FAIL] %s -- %s\n", name.c_str(), detail.c_str());
    }
}

// ---------------------------------------------------------------------------
// Manifold-WITH-boundary audit on a half-edge mesh: count incident faces per
// UNDIRECTED edge from the triangle soup. A 2-manifold(-with-boundary) surface
// has every undirected edge incident to exactly 1 (boundary) or 2 (interior)
// faces — never 3+. Also returns whether the surface is closed (no boundary
// edge) and a single connected component over face adjacency.
// ---------------------------------------------------------------------------
struct SurfaceAudit {
    bool manifoldWithBoundary = false; // every edge has 1 or 2 faces
    bool closed = false;               // no boundary edge (every edge has 2)
    bool connected = false;            // single component (face adjacency)
    std::size_t numFaces = 0;
    std::size_t boundaryEdges = 0;
    std::size_t nonManifoldEdges = 0;  // edges with 3+ incident faces
    std::size_t components = 0;
};

static SurfaceAudit auditSurface(const mesh::HalfEdgeMesh& m) {
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    m.toSoup(pos, idx);
    const std::size_t F = idx.size() / 3;

    SurfaceAudit a;
    a.numFaces = F;
    if (F == 0) return a;

    // Undirected-edge -> incident-face list (store at most 3 to detect 3+).
    auto ekey = [](std::uint32_t u, std::uint32_t v) {
        std::uint32_t lo = u < v ? u : v, hi = u < v ? v : u;
        return (std::uint64_t(lo) << 32) | std::uint64_t(hi);
    };
    std::map<std::uint64_t, std::vector<std::size_t>> edgeFaces;
    for (std::size_t f = 0; f < F; ++f) {
        std::uint32_t i0 = idx[3 * f + 0], i1 = idx[3 * f + 1], i2 = idx[3 * f + 2];
        edgeFaces[ekey(i0, i1)].push_back(f);
        edgeFaces[ekey(i1, i2)].push_back(f);
        edgeFaces[ekey(i2, i0)].push_back(f);
    }

    a.manifoldWithBoundary = true;
    a.closed = true;
    for (auto& [k, faces] : edgeFaces) {
        (void)k;
        if (faces.size() == 1)      { ++a.boundaryEdges; a.closed = false; }
        else if (faces.size() == 2) { /* interior, fine */ }
        else                        { ++a.nonManifoldEdges; a.manifoldWithBoundary = false; }
    }

    // Connectivity over face adjacency (faces sharing an undirected edge).
    std::vector<std::vector<std::size_t>> adj(F);
    for (auto& [k, faces] : edgeFaces) {
        (void)k;
        if (faces.size() == 2) {
            adj[faces[0]].push_back(faces[1]);
            adj[faces[1]].push_back(faces[0]);
        }
    }
    std::vector<int> comp(F, -1);
    std::size_t comps = 0;
    std::vector<std::size_t> stack;
    for (std::size_t s = 0; s < F; ++s) {
        if (comp[s] != -1) continue;
        comp[s] = int(comps);
        stack.clear();
        stack.push_back(s);
        while (!stack.empty()) {
            std::size_t c = stack.back(); stack.pop_back();
            for (std::size_t nb : adj[c])
                if (comp[nb] == -1) { comp[nb] = int(comps); stack.push_back(nb); }
        }
        ++comps;
    }
    a.components = comps;
    a.connected = (comps == 1);
    return a;
}

// ---------------------------------------------------------------------------
// Gate (A): voxelized SDF sphere -> closed 2-manifold, volume -> 4/3 pi r^3.
// ---------------------------------------------------------------------------
static void gateSphere() {
    std::printf("\n[gate A] voxelized sphere -> CLOSED 2-manifold mesh, volume -> 4/3 pi r^3\n");
    const double r = 1.0;
    const double exact = (4.0 / 3.0) * M_PI * r * r * r;
    std::printf("    analytic volume = %.10f\n", exact);

    const std::vector<double> spacings = {0.20, 0.10, 0.05};
    std::vector<double> relErr;
    bool allClosed = true, allManifold = true, allBuilt = true;

    for (double h : spacings) {
        VoxelGrid<float> g = voxelizeSphere(r, h);          // sphere strictly interior (padded)
        voxel::ContourResult cr = voxel::VoxelMesh::contour(g, 0.0);

        if (!cr.ok) {
            allBuilt = false;
            std::printf("    h=%.4f  *** contour REJECTED (non-manifold soup, MC33 TARGETED) ***\n", h);
            relErr.push_back(1.0);
            continue;
        }

        // Strict closed-manifold audit via the shared HalfEdgeMesh validator.
        const mesh::ValidityReport& rep = cr.report;
        if (!rep.watertight) allClosed = false;
        if (!rep.isValid())  allManifold = false;

        const double vol = cr.mesh.signedVolume();
        const double e = std::fabs(vol - exact) / exact;
        relErr.push_back(e);
        std::printf("    h=%.4f  V=%zu F=%zu E=%zu chi=%d  closed=%d 2mani=%d  vol=%.6f relErr=%.4f%%\n",
                    h, std::size_t(rep.numVertices), std::size_t(rep.numFaces),
                    std::size_t(rep.numEdges), rep.eulerChar,
                    int(rep.watertight), int(rep.isValid()), vol, e * 100.0);
    }

    check(allBuilt, "sphere soup is manifold-clean (buildFromSoup accepted every level)",
          "a level produced a non-manifold marching-cubes soup");
    check(allClosed, "sphere mesh is CLOSED / watertight at every level", "a level was open");
    check(allManifold, "sphere mesh is 2-manifold (validate().isValid()) at every level",
          "a level failed validate()");

    // Sphere is a topological 2-sphere: Euler characteristic must be 2.
    // (Re-contour finest to read chi for the assertion message.)
    {
        VoxelGrid<float> g = voxelizeSphere(r, spacings.back());
        voxel::ContourResult cr = voxel::VoxelMesh::contour(g, 0.0);
        check(cr.ok && cr.report.eulerChar == 2,
              "sphere mesh has Euler characteristic 2 (topological sphere)",
              "chi=" + std::to_string(cr.ok ? cr.report.eulerChar : -999));
    }

    // Volume accuracy at the finest level + convergence (error shrinks).
    check(relErr.back() < 0.02,
          "sphere meshed volume within 2% at finest spacing",
          "finest relErr=" + std::to_string(relErr.back()));
    check(relErr.back() < relErr.front(),
          "sphere meshed volume error SHRINKS under refinement",
          "coarse=" + std::to_string(relErr.front()) + " fine=" + std::to_string(relErr.back()));
}

// ---------------------------------------------------------------------------
// Gate (B): gyroid TPMS -> connected 2-manifold surface.
// ---------------------------------------------------------------------------
static void gateGyroid() {
    std::printf("\n[gate B] gyroid TPMS -> CONNECTED 2-manifold surface\n");
    const int periods = 2;
    const int samplesPerPeriod = 16;
    VoxelGrid<float> g = buildGyroidGrid(periods, samplesPerPeriod);

    voxel::ContourResult cr = voxel::VoxelMesh::contour(g, 0.0);
    check(cr.ok, "gyroid contour accepted (buildFromSoup, manifold-clean soup)",
          "buildFromSoup rejected the gyroid soup (non-manifold)");
    if (!cr.ok) return;

    SurfaceAudit a = auditSurface(cr.mesh);
    std::printf("    faces=%zu  boundaryEdges=%zu  nonManifoldEdges=%zu  components=%zu  closed=%d\n",
                a.numFaces, a.boundaryEdges, a.nonManifoldEdges, a.components, int(a.closed));

    check(a.numFaces > 0, "gyroid surface is non-empty", "0 faces");
    check(a.nonManifoldEdges == 0,
          "gyroid surface is 2-manifold (no edge with 3+ faces)",
          "nonManifoldEdges=" + std::to_string(a.nonManifoldEdges));
    check(a.manifoldWithBoundary,
          "gyroid surface is a 2-manifold-with-boundary (every edge has 1 or 2 faces)",
          "found a non-manifold edge");
    check(a.connected,
          "gyroid surface is a single connected component (face adjacency)",
          "components=" + std::to_string(a.components));
    // The bicontinuous gyroid is clipped open at the box faces, so it SHOULD have
    // boundary edges (it is manifold-with-boundary, not closed). Assert that fact
    // so the open-surface handling is exercised honestly (capping is TARGETED).
    check(a.boundaryEdges > 0,
          "gyroid surface has boundary edges (open at box faces -- capping TARGETED)",
          "boundaryEdges=0 (unexpectedly closed)");
}

int main() {
    std::printf("=== forge::native::voxel — VoxelMesh (voxel->mesh) gate ===\n");
    std::printf("(reuses implicit::IsoMesher + mesh::HalfEdgeMesh; no duplicate mesher/grid/mesh type)\n");

    gateSphere();
    gateGyroid();

    std::printf("\n=== RESULT: %d / %d passed ===\n", g_passed, g_total);
    std::printf("TARGETED remainder: MC33/asymptotic-decider saddle disambiguation\n"
                "(a non-manifold soup is REJECTED today, not meshed); dual contouring\n"
                "for sharp features; capping of box-boundary-clipped open surfaces\n"
                "(mesh::HalfEdgeMesh::planeClip is the future capper); anisotropic spacing.\n");
    return (g_passed == g_total) ? 0 : 1;
}
