// forge/native/composites/Composites.hpp
//
// In-house COMPOSITES / LAMINATE workbench — forge::native::composites.
//
// WHY THIS EXISTS (the loudest composite-engineering pain, per Forge Bible):
//   Two failures dominate composite design tools:
//     (1) "the material library doesn't have MY material" — every shop runs its own
//         resin / fibre / cure recipe, so a fixed dropdown of canned laminae is
//         useless. The fix here is to take each ply's orthotropic lamina constants
//         straight from the shared forge::native::materials (#38) MaterialDB — the
//         SAME process-aware DB the rest of the kernel uses — so "my material" is a
//         materials::OrthoConstants the caller already owns (and can add to the DB),
//         not a hard-coded entry.
//     (2) FLAT Classical-Lamination-Theory predictions diverge BADLY from measured
//         parts on CURVED (double-curvature) molds, because the fibres do NOT stay
//         at their nominal 0/90/±45 — they SHEAR (trellis) and rotate as the flat
//         ply is draped onto the tool. A 30° nominal ply can end up at 50° in a
//         corner. CLT on the nominal angles is then simply the wrong stiffness.
//         The fix is a KINEMATIC DRAPING simulation (pin-jointed fishnet) that
//         predicts the real fibre-path / shear-angle field on the tool, flags
//         WRINKLING where the shear exceeds the fabric's locking angle, and hands
//         each surface element its ACTUAL orthotropic orientation for downstream FEA.
//
// WHAT THIS MODULE PROVIDES:
//   (A) PLY-STACK LAYUP — a laminate is an ordered stack of plies, each
//       {material (orthotropic, from #38), thickness, orientation-angle}, with
//       symmetric / balanced verdicts.
//   (B) CLASSICAL LAMINATION THEORY — the plane-stress reduced stiffness Q from the
//       orthotropic {E1,E2,G12,nu12}, the transformed reduced stiffness Qbar(theta)
//       (Jones 2.80-2.84), the laminate ABD matrices integrated through-thickness
//       about the midplane, and the effective laminate Ex/Ey/Gxy/nuxy. The B==0
//       check for a symmetric layup is the key stress-engineering verdict.
//   (C) KINEMATIC DRAPING — map a flat ply onto an analytic curved tool surface via
//       the pin-jointed-net / fishnet kinematic algorithm; predict the fibre paths
//       (warp/weft tangents) + the shear-angle field; flag wrinkling past a locking
//       angle. On double curvature the fibres rotate away from nominal.
//   (D) PER-ELEMENT ORTHOTROPIC ORIENTATION — from the draped shear field, the
//       ACTUAL material orientation per surface node (never the nominal 0/90 on the
//       curved region) — exactly what an orientation-aware FEA needs.
//   (E) VERSIONED LAYUP-SCHEDULE / ALLOWABLES — every orientation / resin / cure
//       change is a new tracked schedule record (id + the immutable stack +
//       provenance + lineage), so the ply book is auditable.
//
// MATERIALS REUSE (forge::native::materials, #38):
//   The DB is a FULL 3D anisotropic engine (6x6 Voigt, Bond/Auld tensor rotation).
//   CLT needs the 2D PLANE-STRESS reduced Q and the in-plane Qbar(theta) 3x3
//   transform, which condensing-then-rotating the 6x6 does NOT give (condense then
//   rotate != rotate then condense). So this module builds its own 2D reduced-Q /
//   Jones-Qbar layer directly (the proven frontend/src/forge-v4/compositesMath.js
//   oracle, ported into SI) — and reuses materials ONLY as the SOURCE of each ply's
//   orthotropic constants (materials::OrthoConstants / MaterialDB). A thin helper
//   pulls OrthoConstants out of the shared DB so "my material" is solved by one
//   source of truth.
//
// HONESTY / FOLLOW-UPS (noted, deliberately NOT stubbed):
//   (a) LIVE FEA / BRIDGE WIRING — feeding perElementOrientation() into the element
//       constitutive matrix of forge::fea / the Studio bridge is a cross-namespace
//       change on the OCCT/Eigen side and is the explicit follow-up. This module
//       produces the per-element orientation field that wiring will consume.
//   (b) brep::NurbsSurface TOOL ADAPTER — drape() takes an analytic
//       std::function<Vec3(u,v)> tool surface so the gate stays dependency-free and
//       deterministic. A follow-up adds a brep::NurbsSurface adapter (it already
//       exposes evaluate(u,v) + an analytic normal); we note it, we do not stub it.
//   No fabricated geometry: a degenerate laminate => CltResult.ok==false; a draping
//   Newton/fishnet non-convergence => DrapeResult.ok==false (the failure surfaces).
//
// CONVENTIONS: pure C++20, standard library only (no OCCT, no Eigen, no WASM, no
// third-party libs). SI units internally: Pa for moduli, metres for thickness,
// radians for angles. (The JS oracle uses GPa-mm; native stays SI to match
// materials — the test oracles compute in the same SI units, so magnitudes are
// self-consistent with no unit drift.) A self-contained local Vec2/Vec3 (mirroring
// gdt/tolstack/materials) keeps the surface math un-coupled from any one mesh Vec3.

#ifndef FORGE_NATIVE_COMPOSITES_COMPOSITES_HPP
#define FORGE_NATIVE_COMPOSITES_COMPOSITES_HPP

#include <vector>
#include <array>
#include <cstddef>
#include <cstdint>
#include <functional>

#include "forge/native/materials/Materials.hpp"   // OrthoConstants, MaterialDB, MatKey

namespace forge {
namespace native {
namespace composites {

// ---------------------------------------------------------------------------
// Self-contained minimal vectors (gdt/tolstack/materials convention — in-namespace
// so they NEVER clash with another module's file-local Vec3 at the all-objects link).
// ---------------------------------------------------------------------------
struct Vec2 {
    double u{0.0};
    double v{0.0};
};
struct Vec3 {
    double x{0.0};
    double y{0.0};
    double z{0.0};
};
double dot3(const Vec3& a, const Vec3& b);
Vec3   sub3(const Vec3& a, const Vec3& b);
double norm3(const Vec3& a);

// ===========================================================================
// (B) CLASSICAL LAMINATION THEORY — the plane-stress lamina building blocks.
// ===========================================================================

// Plane-stress reduced stiffness Q (Pa); 1 = fibre axis, 2 = transverse.
struct ReducedStiffness {
    double Q11{0.0}, Q12{0.0}, Q22{0.0}, Q66{0.0};
};

// Transformed reduced stiffness Qbar(theta) (Pa) — the 6 distinct entries of the
// symmetric 3x3 [Q11 Q12 Q16; Q12 Q22 Q26; Q16 Q26 Q66].
struct Qbar {
    double Q11{0.0}, Q12{0.0}, Q22{0.0}, Q16{0.0}, Q26{0.0}, Q66{0.0};
    std::array<double, 9> as3x3() const;   // row-major
};

// Plane-stress reduced Q from the orthotropic lamina constants (#38 mean values).
//   nu21 = nu12*E2/E1; den = 1 - nu12*nu21;
//   Q11 = E1/den, Q22 = E2/den, Q12 = nu12*E2/den, Q66 = G12.
ReducedStiffness reducedStiffness(const materials::OrthoConstants& c);

// Qbar(theta) — Jones "Mechanics of Composite Materials" eq. 2.80-2.84.
Qbar rotatedQ(const ReducedStiffness& Q, double thetaRad);

// ---------------------------------------------------------------------------
// Ply-stack layup.
// ---------------------------------------------------------------------------
struct Ply {
    materials::OrthoConstants material;   // the lamina's orthotropic constants (#38)
    double thickness{0.0};                // m
    double angle{0.0};                    // rad — ply orientation
    const char* materialName{""};         // provenance label
};

struct Laminate {
    std::vector<Ply> plies;               // bottom -> top stacking order
    double totalThickness() const;
};

// Symmetric: ply k and ply (N-1-k) share {material-by-stiffness, angle, thickness}
// for every k (the B==0 condition). tolDeg in radians? No — tolDeg is DEGREES of
// allowed angle mismatch, tolT metres of thickness mismatch.
bool isSymmetric(const Laminate& lam, double tolDeg = 1e-4, double tolT = 1e-9);
// Balanced: every +theta ply has a matching -theta ply (same |angle|, material,
// thickness summed) -> zeroes A16/A26. 0 and 90 are their own mirrors.
bool isBalanced(const Laminate& lam, double tolDeg = 1e-4);

// ---------------------------------------------------------------------------
// CLT result.
// ---------------------------------------------------------------------------
struct Mat3 {
    std::array<double, 9> a{};            // row-major a[3*i + j]
    double  at(int i, int j) const { return a[3 * i + j]; }
    double& at(int i, int j)       { return a[3 * i + j]; }
};

struct CltResult {
    Mat3   A, B, D;        // extensional (Pa*m=N/m), coupling (Pa*m^2=N), bending (Pa*m^3=N*m)
    double Ex{0.0}, Ey{0.0}, Gxy{0.0};   // effective laminate engineering constants (Pa)
    double nuxy{0.0};
    bool   symmetric{false};   // ||B||_inf < tol — the key symmetric-layup check
    bool   balanced{false};    // |A16|,|A26| < tol
    bool   ok{false};
};

// Assemble the ABD matrices about the midplane, derive the effective membrane
// constants from the in-plane compliance of A, run the symmetric/balanced verdicts.
// Empty / degenerate laminate -> ok==false (no fabricated result).
CltResult buildClt(const Laminate& lam);

// ===========================================================================
// (C) KINEMATIC DRAPING — pin-jointed-net / fishnet mapping onto a curved tool.
// ===========================================================================

// An analytic parametric tool surface S(u,v) -> R^3 over [u0,u1] x [v0,v1].
// (A brep::NurbsSurface adapter is the noted follow-up — see HONESTY (b).)
struct ToolSurface {
    std::function<Vec3(double, double)> S;   // S(u,v)
    double u0{0.0}, u1{1.0}, v0{0.0}, v1{1.0};
};

struct DrapeNode {
    Vec2   uv;            // tool parameters at this net node
    Vec3   xyz;          // R^3 position on the tool
    double shearAngle{0.0};   // |trellis shear| at this node (rad)
    bool   wrinkle{false};    // shearAngle > lockingAngle
};

struct DrapeParams {
    double lockingAngle{0.5236};   // rad — fabric trellis lock (~30 deg default)
    int    nu{21}, nv{21};         // net grid resolution (warp x weft node counts)
    Vec2   origin{0.0, 0.0};       // seed tool-param at net node (0,0)
    double warpDirRad{0.0};        // warp marching direction in the param plane
    double weftDirRad{1.5707963267948966};   // weft marching direction (pi/2)
};

struct DrapeResult {
    int nu{0}, nv{0};
    std::vector<DrapeNode> nodes;            // row-major (nu x nv)
    std::vector<double>    shearAngleField;  // |shear| per node (rad)
    std::vector<std::array<Vec3, 2>> fiberPaths;  // {warp,weft} unit tangents per node
    std::vector<char>      wrinkleFlags;     // per-node (1 = wrinkled); char to avoid vector<bool>
    double maxShearAngle{0.0};
    bool   anyWrinkle{false};
    bool   ok{false};
    const char* note{""};
};

// Drape a flat ply's fishnet onto the tool surface. The warp & weft lines are
// inextensible (constant cell pitch = arc span / (n-1)); pins rotate (trellis
// shear) to keep every node on S. Returns the shear-angle field + fibre paths +
// wrinkle flags. Newton non-convergence -> DrapeResult.ok==false (no fake geometry).
DrapeResult drape(const ToolSurface& tool, const DrapeParams& params);

// ===========================================================================
// (D) PER-ELEMENT ORTHOTROPIC ORIENTATION (downstream FEA).
// ===========================================================================
struct ElementOrientation {
    int    node{0};
    double fiberAngle{0.0};   // ACTUAL fibre direction (rad) = nominal + draped shear
    bool   wrinkled{false};
};

// Each node's actual fibre direction = nominalAngle + the local trellis rotation
// the fishnet imparts (the warp tangent's deviation). On a developable region this
// returns the nominal angle; on double curvature it deviates — the orientation an
// orientation-aware FEA must use instead of the nominal 0/90.
std::vector<ElementOrientation> perElementOrientation(const DrapeResult& drape,
                                                      double nominalAngle = 0.0);

// ===========================================================================
// (E) VERSIONED LAYUP SCHEDULE / ALLOWABLES.
// ===========================================================================
struct LayupSchedule {
    std::uint64_t id{0};          // monotonically assigned (>=1)
    Laminate      stack;          // an immutable snapshot of the stack at commit time
    const char*   resin{""};
    const char*   cure{""};       // cure cycle id
    const char*   provenance{""};
    std::uint64_t parentId{0};    // lineage (0 = root)
};

// Every orientation / resin / cure change = a new tracked record. get(id) returns
// the original immutable snapshot (lineage preserved).
class ScheduleRegistry {
public:
    std::uint64_t commit(const Laminate& stack, const char* resin, const char* cure,
                         const char* provenance, std::uint64_t parentId = 0);
    const LayupSchedule* get(std::uint64_t id) const;   // nullptr if absent
    std::size_t          size() const { return records_.size(); }

private:
    std::vector<LayupSchedule> records_;
    std::uint64_t             next_{1};
};

// ---------------------------------------------------------------------------
// Helper — pull a ply's orthotropic constants from the shared #38 MaterialDB so
// "my material" is one source of truth. `ok` false if the key is absent.
// ---------------------------------------------------------------------------
materials::OrthoConstants orthoFromDB(const materials::MaterialDB& db,
                                      const materials::MatKey& key, bool& ok);

} // namespace composites
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_COMPOSITES_COMPOSITES_HPP
