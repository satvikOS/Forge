// forge/native/brep/CadScoreGates.hpp
//
// CADGenBench PRE-SUBMIT GATES (= RL-reward terms) for the Forge native kernel.
// Per docs/SCOPE_2026-06-24/research/cadgen_ecosystem_research_2026-06-24.md
// §3.2 / §5.3 and docs/SCOPE_2026-06-24/CADGENBENCH_SPEC.md. These are the
// in-kernel topology / validity / interface self-checks the research flags as
// "the kernel already BINDS but doesn't BRIDGE" (gaps G2 + G3): they double as a
// pre-submit guard AND as the per-axis RL reward signal CADGenBench scores.
//
// ============================ HONESTY (Bible §0/§9) ========================
// REAL algorithms only, pure C++20 + stdlib (NO new deps, NO OCCT, NO WASM, no
// test framework). ADDITIVE: a brand-new header + TU. It does NOT edit
// Topology.hpp / Sew.hpp / Check.hpp / SolidTessellate.hpp / HalfEdgeMesh.hpp;
// it only READS the topology graph + REUSES the existing connectivity / Euler /
// genus machinery:
//   * mesh::HalfEdgeMesh::validate()  — the V-E+F, 2-manifold, watertight audit,
//   * tessellateSolid(...)            — the watertight Solid -> triangle soup,
//   * mesh::HalfEdgeMesh::signedVolume() — for shell nesting (void) orientation.
//
// THREE gate operations (1:1 with the three CADGenBench axes the kernel can
// self-check pre-submit — Validity, Topology, Interface):
//
//   (1) BETTI NUMBERS (b0, b1, b2) of the solid's TESSELLATED BOUNDARY — the
//       EXACT count triple CADGenBench multiplies (s_i per axis then b0*b1*b2):
//         b0 = number of connected SOLID BODIES (top-level, non-nested shells),
//         b1 = total independent loops / tunnels on the boundary surface
//              = sum over boundary shells of 2*genus(shell),
//         b2 = number of ENCLOSED regions = total number of closed boundary
//              shells (outer shells + every nested void shell).
//       Verified closed-form by the gate test:
//         sphere/cube ->(1,0,1); torus ->(1,2,1); two disjoint cubes ->(2,0,2);
//         cube-with-through-hole ->(1,2,1); cube-with-internal-void ->(1,0,2).
//
//   (2) WATERTIGHT / MANIFOLD validity self-check (reuses the HalfEdgeMesh
//       validity predicates: twins-consistent + 2-manifold + watertight/closed +
//       a consistent (positive) signed volume for the outward-wound boundary).
//
//   (3) INTERFACE KEEP-IN / KEEP-OUT IoU helper — the CADGenBench "interface"
//       axis. Given the solid + an axis-aligned KEEP-IN box and KEEP-OUT box,
//       voxel-sample the material occupancy and report:
//         keepInIoU  = |material ∩ keepIn| / |material ∪ keepIn| inside the
//                      keep-in region (the fraction of required volume filled),
//         keepOutIoU = the overlap of material with the forbidden keep-out box
//                      (a violation; 0 == clean), plus the ramped axis score
//                      (IoU>=0.95 -> 1.0, <=0.80 -> 0, linear between) used as
//                      the reward term.

#ifndef FORGE_NATIVE_BREP_CADSCOREGATES_HPP
#define FORGE_NATIVE_BREP_CADSCOREGATES_HPP

#include <cstddef>
#include <cstdint>
#include <vector>

#include "forge/native/brep/Topology.hpp"          // brep::Solid
#include "forge/native/mesh/HalfEdgeMesh.hpp"       // mesh::HalfEdgeMesh

namespace forge {
namespace native {
namespace brep {

// ===========================================================================
// (1) BETTI NUMBERS
// ===========================================================================

// The Betti triple of a tessellated boundary, plus the per-shell breakdown used
// to derive it (so a heal / reward op can see WHY a count is what it is).
struct BettiNumbers {
    bool ok = false;          // false if the boundary did not tessellate to a
                              // closed 2-manifold (then the counts are unreliable)

    long long b0 = 0;         // connected solid bodies (top-level shells)
    long long b1 = 0;         // independent tunnels = sum 2*genus over shells
    long long b2 = 0;         // enclosed regions = total closed shells

    // Per closed boundary shell: its V/E/F, Euler characteristic and genus, and
    // whether it is a VOID (nested inside another shell -> an internal cavity).
    struct ShellInfo {
        long long V = 0, E = 0, F = 0;
        long long eulerChar = 0;     // V - E + F  (= 2 - 2*genus for a closed surf)
        long long genus = 0;         // (2 - eulerChar) / 2
        bool      isVoid = false;    // nested inside another shell (cavity)
        double    signedVolume = 0;  // +outer-wound, -inverted (void) shell
    };
    std::vector<ShellInfo> shells;

    // The multiplied CADGenBench triple form is just b0*b1*b2 (callers compute the
    // per-axis s_i against the ground-truth triple; this is the candidate side).
    long long product() const { return b0 * b1 * b2; }
};

// Compute the Betti triple of the solid by tessellating its boundary (reusing
// tessellateSolid) and analysing the resulting mesh's connected shells. `weldTol`
// is forwarded to the tessellator's position weld.
BettiNumbers computeBetti(const Solid& solid, double weldTol = 1e-9);

// Overload: compute the Betti triple directly from an already-tessellated
// boundary triangle soup (positions flat xyz, indices flat tri). This is the path
// the RL reward uses on a mesh the kernel already produced for the shape axis (no
// re-tessellation). The soup may contain MULTIPLE disjoint closed shells.
BettiNumbers computeBettiFromSoup(const std::vector<double>& positions,
                                  const std::vector<std::uint32_t>& indices);

// ===========================================================================
// (2) WATERTIGHT / MANIFOLD VALIDITY
// ===========================================================================

struct ValiditySelfCheck {
    bool tessellated     = false;  // the boundary produced a half-edge mesh
    bool twinsConsistent = false;  // every twin.twin == self, opposite-wound
    bool manifold        = false;  // every undirected edge has exactly 2 faces
    bool watertight      = false;  // closed: no boundary (naked) edge
    bool positiveVolume  = false;  // outward-wound (signed volume > 0)

    // The CADGenBench binary validity gate: a clean watertight orientable
    // manifold with a consistent outward winding.
    bool valid() const {
        return tessellated && twinsConsistent && manifold && watertight &&
               positiveVolume;
    }

    // The mesh measures (handy for the shape / reward axes).
    std::uint32_t numVertices = 0, numEdges = 0, numFaces = 0;
    int           eulerChar   = 0;
    double        signedVolume = 0.0;
    double        surfaceArea  = 0.0;
};

// Tessellate the solid's boundary and run the watertight/manifold validity audit.
ValiditySelfCheck checkValidity(const Solid& solid, double weldTol = 1e-9);

// Overload on an already-built mesh (no re-tessellation).
ValiditySelfCheck checkValidity(const mesh::HalfEdgeMesh& meshIn);

// ===========================================================================
// (3) INTERFACE KEEP-IN / KEEP-OUT IoU
// ===========================================================================

// An axis-aligned box constraint region (model space).
struct AABBox {
    double min[3] = {0, 0, 0};
    double max[3] = {0, 0, 0};
    bool valid() const {
        return max[0] > min[0] && max[1] > min[1] && max[2] > min[2];
    }
    double volume() const {
        return (max[0] - min[0]) * (max[1] - min[1]) * (max[2] - min[2]);
    }
};

struct InterfaceIoU {
    bool ok = false;

    // KEEP-IN: the material must FILL the keep-in box. keepInIoU is the volumetric
    // IoU of (material ∩ keepIn) against keepIn  ==  filled / keepIn-volume
    // (since the intersection is a subset of keepIn, union == keepIn here), so it
    // is the fraction of the required region that is solid. 1.0 == fully present.
    double keepInIoU = 0.0;

    // KEEP-OUT: the material must AVOID the keep-out box. keepOutOverlap is the
    // fraction of the keep-out box that is (wrongly) filled with material; 0 ==
    // clean. keepOutIoU = 1 - keepOutOverlap is the "cleanliness" in [0,1].
    double keepOutOverlap = 0.0;
    double keepOutIoU = 0.0;

    // The CADGenBench interface RAMP applied to the worst (min) of the two sub-
    // scores: IoU>=0.95 -> 1.0, IoU<=0.80 -> 0, linear between. This is the per-
    // feature interface axis score (group score = worst feature == this min).
    double rampedScore = 0.0;

    // Raw sampled occupancies (for diagnostics / reward shaping).
    long long samplesKeepIn = 0,  filledKeepIn = 0;
    long long samplesKeepOut = 0, filledKeepOut = 0;
};

// Voxel-sample the IoU of the solid's material against an axis-aligned KEEP-IN box
// (material required) and KEEP-OUT box (material forbidden). `gridN` is the number
// of samples per axis inside each constraint box (gridN^3 point tests per box).
// Material membership is decided by an even-odd ray cast against the tessellated
// boundary (a robust interior test for a watertight mesh). Either box may be left
// default (invalid()) to skip that side.
InterfaceIoU interfaceIoU(const Solid& solid,
                          const AABBox& keepIn,
                          const AABBox& keepOut,
                          std::size_t gridN = 16,
                          double weldTol = 1e-9);

// Overload on an already-tessellated boundary soup (the reward path).
InterfaceIoU interfaceIoUFromSoup(const std::vector<double>& positions,
                                  const std::vector<std::uint32_t>& indices,
                                  const AABBox& keepIn,
                                  const AABBox& keepOut,
                                  std::size_t gridN = 16);

// The CADGenBench interface ramp: IoU>=0.95 -> 1.0, <=0.80 -> 0, linear between.
// Exposed so callers can ramp their own per-feature IoUs into the axis reward.
double interfaceRamp(double iou);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_CADSCOREGATES_HPP
