#pragma once

// PUSH-11 — forge::fea::tet
//
// Real linear-elastic FEA on a Tet4 (4-node linear tetrahedron) volume mesh.
//
// Why this is a sub-namespace of forge::fea instead of replacing the
// existing hex/grid implementation: PARITY rule, Forge-12 already shipped
// a complete hex-grid solver under `forge::fea` (see Fea.hpp) with three
// solvers + thermal + nonlinear + fatigue + buckling + contact. PUSH-11
// adds the canonical Tet4 path that an external user expects from the
// task spec — constant-strain tetrahedra with a Bowyer-Watson volume
// mesher and a CG-based linear-static / inverse-iteration modal pair.
// The two paths coexist and can be benchmarked against each other.
//
// Honest scope notes:
//   * meshShape: uses OCCT BRepMesh_IncrementalMesh to triangulate the
//     boundary, then runs a Bowyer-Watson incremental Delaunay
//     tetrahedralisation on the unique boundary vertices, surrounded by a
//     super-tetrahedron. After insertion the super-tet is stripped and
//     each remaining tet is centroid-classified against the original
//     BRep via BRepClass3d_SolidClassifier::Perform so concave regions
//     are filtered. If the resulting interior tet count is zero (which
//     happens for sliver shells or very low `targetEdge`), the function
//     falls back to the *documented* shell-tet construction described in
//     the task spec: each surface triangle becomes a Tet4 with an
//     additional inner-offset node (extruded along the inward face
//     normal by 1/3 of the local edge length). This guarantees a valid
//     non-empty tet mesh covering the surface as a single inward layer.
//     The boolean `Mesh::shellTetsOnly` records which path was used so
//     callers can warn.
//
//   * solveLinearStatic: assembles global stiffness K using the
//     standard Tet4 6×12 B-matrix in CSR form, applies BCs by the
//     penalty method (multiply diagonal by 1e30 for fixed DOFs and
//     zero the row's off-diagonal contributions), and solves K·u = f
//     via Jacobi-preconditioned conjugate gradient (the implementation
//     is intentionally inline, no Eigen, no external solver). Per-
//     element von Mises follows directly from the strain-displacement
//     reconstruction.
//
//   * solveModal: generalised eigenproblem K·φ = ω²·M·φ. Mass matrix
//     is the consistent Tet4 mass M_e = ρV/20 (2,1,1,1; 1,2,1,1;
//     1,1,2,1; 1,1,1,2). Lowest n modes are computed by shifted
//     inverse power iteration with deflation against previously-
//     converged modes (Gram-Schmidt M-orthogonalisation).
//
// All quantities are SI (m, kg, s, N, Pa).

// T-129: this was `#include "forge/ShapeRegistry.hpp"`, and it is the entire
// reason OCCT_REMOVAL_TRACKER listed FeaTet.hpp under "public headers that reach
// OCCT only THROUGH another Forge header". MEASURED before changing it: the only
// two names this header takes from that include are `::forge::ShapeHandle` (which
// lives in ShapeHandle.hpp, and names no OCCT type) and `::TopoDS_Shape`, which is
// FORWARD-DECLARED below and needs no definition to appear in a reference
// parameter. Nothing else in this file mentions ShapeRegistry, ShapeKind, or any
// OCCT type. All three includers (src/FeaTet.cpp, src/binding.cpp,
// test/native_occt_wire_activation_test.cpp) include ShapeRegistry.hpp directly
// already, so none of them was relying on this line transitively.
#include "forge/ShapeHandle.hpp"

#include <array>
#include <vector>
#include <utility>

class TopoDS_Shape;

namespace forge::fea::tet {

struct Material {
    double E;   // Young's modulus  (Pa)
    double nu;  // Poisson ratio    (dimensionless)
    double rho; // density          (kg/m³)
    double alpha = 0.0; // Inc1c: coefficient of thermal expansion (1/K); 0 ⇒ no thermoelastic
};

struct Node {
    double x, y, z;
    int    id;
};

struct Tet {
    int a, b, c, d; // node indices
    int id;
};

// Default budget for the interior Steiner-seed grid (candidate lattice points inside
// the shape AABB). It is a RUNTIME guard, not a mesh-quality choice, and honouring it
// COARSENS the interior spacing beyond `targetEdge`.
//
// What it is guarding against, MEASURED (test/fea_nafems_convergence.mjs, `cost` mode,
// NAFEMS LE1 slab, 2026-08-28): meshShape costs ~1.25 ms PER TET, and that figure is flat
// across 1351 -> 64230 tets. So the cost is roughly LINEAR in this range, not quadratic —
// but the constant is enormous (a production Delaunay refiner is ~3 orders of magnitude
// faster per element), and 60k tets already takes ~79 s. (Those figures predate T-035. The
// note that used to follow here — that bowyerWatson() locates each point by a linear scan
// over every tet ever created, O(N·T) by construction — is no longer true: since T-035 a
// point is located by a randomized visibility walk over face adjacency, its cavity grown
// locally, and dead tets are recycled through a free list; an exhaustive scan runs only for
// a point the walk fails to locate, and that point is counted in Mesh::bwSkippedUnlocated
// when even the scan cannot place it. The meshShape profile after T-035 is dominated by the
// per-tet B-rep classifier of the carve, not by insertion — T-255.)
inline constexpr int kDefaultSeedGridBudget = 20000;

struct Mesh {
    std::vector<Node> nodes;
    std::vector<Tet>  tets;
    bool              shellTetsOnly = false; // see header note

    // ---- seed-grid budget diagnostics (NAFEMS track, 2026-08-28) -------------
    // MEASURED DEFECT this records: when the AABB lattice at `targetEdge` exceeded
    // kDefaultSeedGridBudget the spacing was inflated to fit the budget and NOTHING
    // said so. A caller asking for targetEdge=0.020 on the NAFEMS LE1 slab silently
    // received interior spacing 0.0353 — so a mesh-refinement study stopped refining
    // while continuing to report ever-smaller `targetEdge`. Recording it turns a
    // silent floor into a readable one; these fields are diagnostics only and do not
    // change the mesh.
    bool   seedGridCapped   = false; // true ⇒ interiorSpacing was FORCED above targetEdge
    int    seedGridBudget   = 0;     // budget actually in force for this call
    double requestedEdge    = 0.0;   // targetEdge as asked for (m)
    double interiorSpacing  = 0.0;   // max(dx,dy,dz) of the interior seed lattice (m)

    // ---- Bowyer-Watson insertion census (T-256) -----------------------------
    // Every point meshShape hands the Delaunay fill (boundary samples + interior lattice)
    // is either inserted or SKIPPED, and a skipped point is a hole in the sampling the
    // caller asked for: a boundary sample that is not a mesh vertex leaves the surface
    // coarser than requested there. Until T-256 the skips were printed on stderr only, so
    // no gate could see them. MEASURED (T-035 mutation M3, naive orientation/in-sphere
    // predicates in place of the exact ones): every asserted check of the native gate
    // passed, and the one symptom was "1 unlocated of 3367" on stderr (NAFEMS LE1 slab,
    // targetEdge 0.09). These fields carry that census so a gate can assert
    // bwInsertedPoints == bwInputPoints. Diagnostics only — they do not change the mesh.
    //   duplicate: equal to an existing vertex after the mesher's coordinate snap;
    //   unlocated: no live tet contains it (visibility walk AND exhaustive scan failed);
    //   noCavity:  its Delaunay cavity could not be made star-shaped from it.
    // bwInsertedPoints + bwSkipped() == bwInputPoints whenever the fill completed. When it
    // threw, bwFailed is set and the counts stop where the throw did (the mesh is then the
    // shell fallback, shellTetsOnly). A Mesh built by hand leaves every field zero.
    int  bwInputPoints      = 0;     // points handed to Bowyer-Watson
    int  bwInsertedPoints   = 0;     // points that became Delaunay vertices
    int  bwSkippedDuplicate = 0;
    int  bwSkippedUnlocated = 0;
    int  bwSkippedNoCavity  = 0;
    bool bwFailed           = false; // Bowyer-Watson threw (non-manifold cavity / degenerate super-tet)
    int  bwSkipped() const { return bwSkippedDuplicate + bwSkippedUnlocated + bwSkippedNoCavity; }
};

// Build a tet mesh from a TopoDS_Shape.  `targetEdge` is the desired
// surface edge length in metres (passed straight through to
// BRepMesh_IncrementalMesh). Throws std::invalid_argument on a stale
// handle (via ShapeRegistry::get).
//
// `seedGridBudget` <= 0 selects the default (kDefaultSeedGridBudget, overridable by
// the env var FORGE_FEA_TET_SEED_BUDGET — same escape-hatch convention as
// FORGE_THICKSOLID_NATIVE / FORGE_BRIDGE_FACETED). Passing an explicit larger budget
// is what makes a genuine h-refinement sequence possible; the caller pays the ~1.25 ms/tet
// meshing cost knowingly. Default value ⇒ byte-identical behaviour to before.
Mesh meshShape(const ::TopoDS_Shape& s, double targetEdge, int seedGridBudget = 0);

// Convenience overload: load the shape from the registry first.
Mesh meshShapeFromHandle(::forge::ShapeHandle h, double targetEdge, int seedGridBudget = 0);

// Inc1c — general per-DOF boundary condition. A constrained DOF takes a
// prescribed displacement value (0 ⇒ pin / symmetry plane, non-zero ⇒ enforced
// motion). Node-set selection (BRep-face id or geometric predicate) is done
// caller-side; this carries the resolved node + per-DOF flags/values.
struct PrescribedDisp {
    int    nodeId;
    bool   fx = false, fy = false, fz = false; // which DOFs are prescribed
    double ux = 0.0,  uy = 0.0,  uz = 0.0;     // prescribed values (m)
};

struct BC {
    std::vector<int> fixedNodes;                                       // full 3-DOF pin (legacy)
    std::vector<std::pair<int, std::array<double, 3>>> nodalForces;    // (nodeId, Fx,Fy,Fz)
    // Inc1c additions:
    std::vector<PrescribedDisp>          prescribed; // per-DOF prescribed / symmetry
    std::vector<std::pair<int, double>>  nodeTemps;  // (nodeId, ΔT) thermoelastic field
};

struct Result {
    std::vector<std::array<double, 3>> displacement; // per node, m
    std::vector<double>                vonMises;     // per element, Pa
    // Inc1b — full Cauchy stress tensor + principal stresses, stored both
    // per-element (constant-strain Tet4 → one value per element) and
    // nodal-recovered (unweighted average of incident-element stresses) so a
    // probe point reads a real σ_yy/σ_zz. Voigt order = {sxx,syy,szz,sxy,syz,szx}.
    std::vector<std::array<double, 6>> elemStress;     // per element, Pa
    std::vector<std::array<double, 3>> elemPrincipal;  // per element {s1≥s2≥s3}, Pa
    std::vector<std::array<double, 6>> nodalStress;     // per node, Pa
    std::vector<std::array<double, 3>> nodalPrincipal;  // per node {s1≥s2≥s3}, Pa
    std::vector<double>                nodalVonMises;   // per node, Pa
    double maxDisp      = 0.0;
    double maxVonMises  = 0.0;
    bool   converged    = false;
    int    cgIterations = 0;
    double cgResidual   = 0.0;
};

Result solveLinearStatic(const Mesh& m, const Material& mat, const BC& bc);

struct ModalResult {
    std::vector<double>                                eigenfrequencies; // Hz
    std::vector<std::vector<std::array<double, 3>>>    modeShapes;       // per mode, per node
    bool                                               converged = false;
};

ModalResult solveModal(const Mesh& m, const Material& mat,
                       const std::vector<int>& fixedNodes,
                       int nModes);

} // namespace forge::fea::tet
