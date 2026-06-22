// forge/native/am/Am.hpp
//
// In-house ADDITIVE-MANUFACTURING BUILD-PROCESS SIMULATION — forge::native::am.
//
// WHY THIS EXISTS (the marketed differentiator, per Forge Engineering Bible):
//   An AM part does NOT come out of the machine on nominal. An LPBF (laser powder
//   bed fusion) part accumulates residual stress as each molten layer solidifies
//   and contracts against the already-solid material below it; on release from the
//   build plate it WARPS. A binder-jet / bound-metal part is printed oversize and
//   then SINTERS, shrinking ~17-20% (often anisotropically — gravity/friction make
//   the bottom shrink less than the top). Either way the as-built / as-sintered
//   geometry misses nominal, sometimes by millimetres on a 100 mm part.
//
//   This module predicts that distortion and — the KILLER FEATURE — automatically
//   PRE-COMPENSATES the geometry: it morphs the part by the INVERSE of the
//   predicted distortion so that after the build/sinter the part lands on nominal.
//
// THE METHODS (and their honest limits):
//
//   (A) INHERENT-STRAIN WARP (LPBF) — the fast industry-standard method.
//       Instead of a full transient thermo-mechanical solve (hours per part), a
//       single CALIBRATED inherent (eigen)strain tensor eps* is applied to every
//       deposited element, and ONE linear-elastic FE solve gives the residual
//       distortion field. This is the method Ansys/Additive-Works/Simufact ship
//       as their "fast" assumed-strain solver. It is a CALIBRATED APPROXIMATION,
//       not a first-principles thermal simulation: eps* must be calibrated for the
//       (material, machine, parameter set) — typically from a cantilever
//       deflection print — and is supplied by the caller in BuildSpec.inherent,
//       NEVER invented here. WarpField.calibrated propagates that honesty: if the
//       caller passes calibrated==false, the warp is a SHAPE-TREND only (the right
//       distortion mode, an uncalibrated magnitude), explicitly flagged.
//
//   (B) SINTER-SHRINK (binder-jet / bound-metal) — an affine, optionally
//       anisotropic, optionally field-driven contraction about the part centroid
//       (or a build-plate point). The shrink scale is again a CALIBRATED material
//       input (e.g. 0.83 = 17% for 316L binder jet), supplied by the caller in
//       SinterShrink, not invented here. A non-uniform field(z) captures the
//       gravity/friction gradient (bottom shrinks less than top). Pure geometry.
//
//   (C) AUTOMATIC GEOMETRIC PRE-COMPENSATION — iterate: predict the distortion of
//       the current shape, displace every node by the NEGATIVE predicted
//       distortion (inverse-warp morph), re-predict on the pre-deformed shape, and
//       measure how far (pre-deformed + its predicted warp) lands from nominal.
//       Stop when that residual is within tolerance. The shipped pre-deformed body
//       prints / sinters back to nominal. This is the deliverable that turns a
//       distortion PREDICTION into a process FIX.
//
// MATERIALS REUSE (forge::native::materials):
//   The elastic side of the FE constitutive law is taken from the #38 process-
//   aware material DB: buildCompliance(rec->C) -> the 6x6 stiffness C, rotated by
//   the build orientation. The DB deliberately has NO inherent-strain / CTE /
//   shrink field (that is correct, not a gap): those are calibrated PROCESS inputs
//   the caller supplies. So `am` reuses Materials ONLY for the elastic stiffness,
//   and reuses materials::{Vec3, Mat6, mul6, invert6} for the small linear algebra
//   (no duplicate type, no duplicate solver — `am` links against Materials.o).
//
// SELF-CONTAINED FE (no OCCT / Eigen / WASM):
//   The production FEA (src/Fea*.cpp, WeldingFea.cpp) all #include <Eigen/...> and
//   <BRep*.hxx> and live at top-level src/, so they CANNOT link into the
//   dependency-free native gate (Materials.hpp note (a) flags this severance).
//   This module therefore carries its own minimal, self-contained linear-elastic
//   FE: a tet4 constant-strain (CST) assembly and a hex8 trilinear assembly, each
//   solved by a Jacobi-preconditioned conjugate gradient — the same math template
//   as FeaTet's tet4 CG solver, re-derived natively against the standard library.
//
// CONVENTIONS: pure C++20, standard library only. Voigt order (11,22,33,23,13,12)
// throughout (matching materials). SI units: m for length, Pa for stress/modulus,
// strain dimensionless. Build frame: Z is the build (deposition) direction by
// default; the build plate is the z = plateZ plane (clamped nodes).

#ifndef FORGE_NATIVE_AM_AM_HPP
#define FORGE_NATIVE_AM_AM_HPP

#include <vector>
#include <array>
#include <cstddef>
#include <cstdint>
#include <functional>

#include "forge/native/materials/Materials.hpp"   // Vec3, Mat6, MaterialDB, buildCompliance, rotateStiffness

namespace forge {
namespace native {
namespace am {

// Reuse the materials linear-algebra + vector types directly (no duplicate type).
using materials::Vec3;
using materials::Mat6;

// ---------------------------------------------------------------------------
// FE mesh inputs.
// ---------------------------------------------------------------------------

// A tet mesh — the natural output of geom::delaunay3D (positive-oriented quads),
// or any other tet source. Nodes are in metres in the BUILD frame.
struct TetMesh {
    std::vector<Vec3>              nodes;   // node coordinates (m)
    std::vector<std::array<int,4>> tets;    // positive-oriented index quads
};

// A hex grid — a thin description of a regular voxel grid's solid cells. Node
// (i,j,k) sits at origin + (i,j,k)*spacing; cell (i,j,k) (i<nx-1,...) is solid iff
// occupied[ i + (nx-1)*(j + (ny-1)*k) ]. Empty `occupied` => every cell solid.
struct HexGrid {
    int   nx{0}, ny{0}, nz{0};   // NODE counts per axis (cells = n-1)
    double spacing{0.0};         // uniform cell edge (m)
    Vec3  origin{0,0,0};
    std::vector<char> occupied;  // per-CELL solid flag (size (nx-1)*(ny-1)*(nz-1)), or empty=all
};

// ---------------------------------------------------------------------------
// INHERENT STRAIN (LPBF) — the CALIBRATED process input.
//   LPBF inherent strain is anisotropic in the build frame: a large compressive
//   in-plane component (XY) from layer contraction, a smaller component along the
//   build (Z). Sign convention: a NEGATIVE eps* is a contraction (the physical
//   solidification shrinkage). Values are a CALIBRATION (e.g. eps_xy in the
//   -1e-3..-1e-2 range from a cantilever-deflection calibration print), NOT
//   invented here. `calibrated` carries the honesty: false => warp is shape-trend.
// ---------------------------------------------------------------------------
struct InherentStrain {
    double exx{0}, eyy{0}, ezz{0};   // normal eigenstrains, BUILD frame (Voigt 1,2,3)
    double eyz{0}, exz{0}, exy{0};   // shear eigenstrains (usually 0)
    bool   calibrated{false};        // false => HONESTY: warp is shape-trend only
    const char* provenance{""};      // e.g. "cantilever calibration, 316L, 195W/0.8m/s"

    // As a 6-vector in Voigt order (11,22,33,23,13,12). Engineering shear (gamma).
    std::array<double,6> voigt() const { return { exx, eyy, ezz, eyz, exz, exy }; }
};

// ---------------------------------------------------------------------------
// BUILD SPEC — material key (-> elastic C) + orientation + the calibrated strain.
// ---------------------------------------------------------------------------
struct BuildSpec {
    materials::MatKey   material{};      // -> elastic C via buildCompliance(rec->C)
    // Build-frame -> part-frame direction cosines (row-major 3x3); identity = the
    // part is built in its design frame. Rotates the stiffness AND the eigenstrain.
    std::array<double,9> orientation{ 1,0,0, 0,1,0, 0,0,1 };
    InherentStrain      inherent{};      // LPBF eigenstrain (calibrated, caller-supplied)
    Vec3                buildDir{0,0,1}; // deposition direction (for layerByLayer)
    bool                layerByLayer{false}; // false = whole-part one-shot (fast standard)
    double              layerHeight{0.0};    // m, used iff layerByLayer
    double              plateZ{0.0};     // build plate plane; nodes with z<=plateZ+eps clamped
    double              plateEps{1e-9};  // tolerance band for "on the plate"
};

// ---------------------------------------------------------------------------
// WARP FIELD — the predicted residual distortion + a residual-stress proxy.
// ---------------------------------------------------------------------------
struct WarpField {
    std::vector<Vec3> nodeDisp;       // per-node residual displacement (m)
    double maxWarp{0.0};              // max |disp| over nodes
    double rmsWarp{0.0};              // root-mean-square |disp|
    std::vector<double> elemVonMises; // per-element residual von-Mises (Pa)
    double maxVonMises{0.0};
    bool   ok{false};
    bool   calibrated{false};         // mirrors spec.inherent.calibrated
    int    cgIters{0};
    double cgResidual{0.0};           // final CG relative residual
    const char* note{""};             // honesty / diagnostic string
};

// ---------------------------------------------------------------------------
// SINTER SHRINK — binder-jet / bound-metal contraction.
//   scale = per-axis (1 - shrink) about `center`; e.g. 0.83 = 17% shrink.
//   field(p) (optional) returns a per-axis MULTIPLIER on the base scale at point p
//   (e.g. less shrink near the plate): nullptr => uniform.
// ---------------------------------------------------------------------------
struct SinterShrink {
    Vec3 scale{0.83,0.83,0.83};   // per-axis post-sinter scale (1 - shrink)
    Vec3 center{0,0,0};           // shrink centre (centroid or plate point)
    bool anisotropic{false};      // documentation flag (scale may differ per axis regardless)
    std::function<Vec3(const Vec3&)> field{nullptr};  // per-axis multiplier vs position
    const char* provenance{""};   // e.g. "316L binder jet, 17% iso, sinter profile X"
};

// ---------------------------------------------------------------------------
// PRE-COMPENSATION — the killer feature's output.
// ---------------------------------------------------------------------------
struct PreCompensation {
    TetMesh preDeformed;     // the morphed (pre-deformed) mesh that builds back to nominal
    double  residual{0.0};   // max |as-built(preDeformed) - nominal| after compensation (m)
    double  initialError{0.0};   // the uncompensated as-built error (m) = maxWarp on nominal
    int     iters{0};
    bool    converged{false};
    bool    calibrated{false};
    const char* note{""};
};

// ===========================================================================
// FUNCTIONS
// ===========================================================================

// (A) LPBF INHERENT-STRAIN WARP.
// Assemble the linear-elastic stiffness K with element D = the rotated 6x6 from
// materials::buildCompliance(rec->C). The eigenstrain enters as an equivalent
// nodal load  f_e = V_e * B_e^T * D * eps*  (the "thermal/eigenstrain -> nodal
// force" of the inherent-strain method). Clamp build-plate nodes (z<=plateZ).
// Solve K u = f by Jacobi-preconditioned CG. Returns u as the residual distortion
// field + the per-element residual von-Mises proxy sigma = D*(B*u_e - eps*).
WarpField predictInherentStrainWarp(const TetMesh& mesh, const BuildSpec& spec,
                                    const materials::MaterialDB& db);
WarpField predictInherentStrainWarp(const HexGrid& grid, const BuildSpec& spec,
                                    const materials::MaterialDB& db);

// (B) SINTER-SHRINK. Affine (optionally anisotropic / field-driven) contraction
// about center. Pure geometry, no FE. Returns the shrunk mesh.
TetMesh applySinterShrink(const TetMesh& mesh, const SinterShrink& s);

// Centroid (mean of nodes) — exposed for callers picking a shrink centre.
Vec3 centroid(const TetMesh& mesh);
// Axis-aligned bounding box of the mesh nodes.
void boundingBox(const TetMesh& mesh, Vec3& lo, Vec3& hi);

// (C) THE KILLER FEATURE — automatic geometric PRE-COMPENSATION (LPBF warp).
// Iterate: predict warp w on the current (pre-deformed) shape -> morph nodes by
// -w -> re-predict -> residual = max over nodes of |(preDeformed + predictedWarp)
// - nominal|. Stop when residual <= tol or maxIters reached.
PreCompensation preCompensate(const TetMesh& nominal, const BuildSpec& spec,
                              const materials::MaterialDB& db,
                              double tol = 1e-4, int maxIters = 8);

// Sinter variant: pre-scale by the INVERSE shrink about center so the post-sinter
// part returns to nominal. One closed-form step for uniform/anisotropic scale; a
// few fixed-point iterations when a non-uniform field is present.
PreCompensation preCompensateSinter(const TetMesh& nominal, const SinterShrink& s,
                                    double tol = 1e-6, int maxIters = 6);

// ---------------------------------------------------------------------------
// Lower-level FE building blocks (exposed for tests / reuse). Self-contained.
// ---------------------------------------------------------------------------

// The element constitutive matrix D for `spec`: materials::buildCompliance(rec->C).C
// rotated by spec.orientation. `ok` false if the material record is absent/invalid.
Mat6 elementStiffnessMatrix(const BuildSpec& spec, const materials::MaterialDB& db, bool& ok);

// Apply a 3x3 (row-major) rotation R to a Voigt-6 strain vector (engineering shear).
std::array<double,6> rotateStrainVoigt(const std::array<double,6>& eps,
                                       const std::array<double,9>& R);

} // namespace am
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_AM_AM_HPP
