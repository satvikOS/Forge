// ShapeClassify.hpp — the ONE place in the kernel where a ShapeHandle becomes an
// in/out answer.
//
// ============================== WHY THIS FILE EXISTS =========================
//
// Point-in-solid classification was, until this file, acquired ad hoc at every
// site that needed it. Four production TUs each constructed their OWN
// BRepClass3d_SolidClassifier:
//
//     src/FeaTet.cpp:466, :953, :987
//     src/VoxelIoU.cpp:171, :245
//     src/Fea.cpp:959
//     src/native/brep/NativeThickenShell.cpp:1918
//
// Between them they are the whole reason the shipped library imports these eight
// OCCT symbols (verified with `nm -u libforge_kernel_core.dylib | c++filt`):
//
//     BRep_Tool::Triangulation(TopoDS_Face const&, TopLoc_Location&, unsigned int)
//     BRepClass3d_SClassifier::State() const
//     BRepClass3d_SolidClassifier::BRepClass3d_SolidClassifier()
//     BRepClass3d_SolidClassifier::BRepClass3d_SolidClassifier(TopoDS_Shape const&)
//     BRepClass3d_SolidClassifier::Destroy()
//     BRepClass3d_SolidClassifier::Load(TopoDS_Shape const&)
//     BRepClass3d_SolidClassifier::Perform(gp_Pnt const&, double)
//     BRepClass3d_SolidExplorer::~BRepClass3d_SolidExplorer()
//
// Eight symbols held in place by four independent call sites is a decomposition
// problem, not a geometry problem: there is nowhere to delete the OCCT classifier
// FROM. Every previous attempt had to edit four files in lockstep and any one of
// them left behind kept all eight symbols in the link, because a symbol is
// imported by the library if ANY translation unit in it names the symbol.
//
// So this header is a SEAM, and its whole value is that it is singular. It turns
// a handle into an in/out answer, it names no OCCT type, and it is the only
// declaration the consumers need. Once all four consumers ask THIS question, the
// OCCT classifier has exactly one place left to be deleted from — src/ShapeClassify.cpp
// — and the deletion is a single edit whose effect on the link is total.
//
// §4.2 note (an owning OCCT-free representation): the answer is computed by the
// native engine over a native Solid. An OCCT-backed body is IMPORTED across the
// bridge first (forge::importOcctSolid) and the native engine answers. A native
// algorithm never reaches for the OCCT classifier as its normal internal path;
// that is the violation this seam exists to remove, and it is why
// NativeThickenShell.cpp:1918 — a NATIVE engine holding an OCCT solid classifier —
// is in the consumer list above.
//
// §4.3 note (the symbol count may never increase): this header adds no OCCT
// symbol. It includes forge/ShapeHandle.hpp (which names no OCCT type) and the
// native query header, and nothing else.
//
// ================================ NO FALLBACK ================================
//
// When the OCCT->native import declines, classifyPoint THROWS and quotes the
// import's own reason. It does NOT fall back to the OCCT classifier. Families G
// and I set this precedent — "there is no fallback to fall back to" — and the
// reason is arithmetic rather than aesthetic: a fallback branch still NAMES the
// OCCT classifier, so every one of the eight symbols stays in the link and the
// measured delta of this whole exercise becomes exactly zero.
//
// Likewise a refusal is never reported as Outside. In every consumer OUTSIDE is
// the answer that REMOVES material, and silently removing material because a
// probe failed is the failure mode that makes a mesher or an IoU number quietly
// wrong instead of loudly broken.

#ifndef FORGE_SHAPE_CLASSIFY_HPP
#define FORGE_SHAPE_CLASSIFY_HPP

#include <cstddef>
#include <stdexcept>
#include <string>

#include "forge/ShapeHandle.hpp"           // ShapeHandle, ShapeKind, shapeKind()
#include "forge/native/brep/Query.hpp"     // native::brep::PointClass + pointInSolid

namespace forge {

// ---------------------------------------------------------------------------
// THE ONE ENUM.
// ---------------------------------------------------------------------------
// forge/native/brep/Query.hpp:95 already defines the in/out/on partition that the
// native engine answers in. Declaring a second one here — even an identical one —
// would create two vocabularies that have to be mapped into each other at every
// call site, and a mapping is a place for an Inside to become an Outside. So this
// is an ALIAS of the existing enum, not a new type.
using PointClass = native::brep::PointClass;   // Inside | Outside | On

// ---------------------------------------------------------------------------
// Refusal.
// ---------------------------------------------------------------------------
// Thrown when the handle cannot be classified AT ALL. Distinct from every in/out
// answer on purpose: a caller that wants to treat a refusal as a value has to
// write that down, and none of the four consumers should.
//
// what() always names the handle and the concrete cause — for an OCCT-backed body
// it quotes forge::ImportResult::reason verbatim, so the deferral cause
// ("non-analytic face BSpline", "not a closed 2-manifold after import", ...)
// survives to the caller instead of being flattened into "could not classify".
class ClassifyRefused : public std::runtime_error {
public:
    explicit ClassifyRefused(const std::string& what) : std::runtime_error(what) {}
};

// ---------------------------------------------------------------------------
// The query.
// ---------------------------------------------------------------------------
// Classify (x,y,z) against the body behind `h`.
//
//   NativeSolid — answered directly by native::brep::pointInSolid.
//   Occt        — the body is imported to a native Solid once (cached per handle)
//                 and answered by the same native engine. THROWS ClassifyRefused
//                 if the import declines.
//   NativeMesh  — THROWS ClassifyRefused: there is no mesh point-in-solid query in
//                 the tree today, and reporting Outside for one would be a
//                 fabricated answer.
//
// `onTol` is the ON band in model-space units, passed straight through to the
// native engine. Points ON the boundary are reported as PointClass::On; the
// existing consumers treat On as material (their convention is `IN || ON -> in`)
// and that mapping stays the caller's, not this seam's.
//
// Thread-safe. The per-handle import cache is mutex-guarded and the imported
// topology is kept alive for the duration of each call.
PointClass classifyPoint(ShapeHandle h, double x, double y, double z,
                         double onTol = 1e-9);

// ---------------------------------------------------------------------------
// Cache diagnostics — for the A/B gate, not for production logic.
// ---------------------------------------------------------------------------
// classifyCacheSize() reports how many OCCT-backed bodies have been imported.
// The A/B gate asserts it is non-zero, which is how the gate proves the OCCT
// bodies really did traverse the native path rather than being skipped.
std::size_t classifyCacheSize();

// Drop every cached import. TEST-ONLY: it must not be called concurrently with
// classifyPoint on another thread. (classifyPoint holds its own reference to the
// topology it is reading for the whole call, so a concurrent clear cannot dangle
// a live call — but the next call then pays for a re-import, which in production
// would be a performance cliff and never a correctness need.)
void classifyCacheClear();

}  // namespace forge

#endif  // FORGE_SHAPE_CLASSIFY_HPP
