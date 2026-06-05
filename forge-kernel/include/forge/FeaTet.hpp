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

#include "forge/ShapeRegistry.hpp"

#include <array>
#include <vector>
#include <utility>

class TopoDS_Shape;

namespace forge::fea::tet {

struct Material {
    double E;   // Young's modulus  (Pa)
    double nu;  // Poisson ratio    (dimensionless)
    double rho; // density          (kg/m³)
};

struct Node {
    double x, y, z;
    int    id;
};

struct Tet {
    int a, b, c, d; // node indices
    int id;
};

struct Mesh {
    std::vector<Node> nodes;
    std::vector<Tet>  tets;
    bool              shellTetsOnly = false; // see header note
};

// Build a tet mesh from a TopoDS_Shape.  `targetEdge` is the desired
// surface edge length in metres (passed straight through to
// BRepMesh_IncrementalMesh). Throws std::invalid_argument on a stale
// handle (via ShapeRegistry::get).
Mesh meshShape(const ::TopoDS_Shape& s, double targetEdge);

// Convenience overload: load the shape from the registry first.
Mesh meshShapeFromHandle(::forge::ShapeHandle h, double targetEdge);

struct BC {
    std::vector<int> fixedNodes;                                       // restrained DOFs
    std::vector<std::pair<int, std::array<double, 3>>> nodalForces;    // (nodeId, Fx,Fy,Fz)
};

struct Result {
    std::vector<std::array<double, 3>> displacement; // per node, m
    std::vector<double>                vonMises;     // per element, Pa
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
