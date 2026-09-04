#pragma once

// BodyInventory — the SEPARATE SOLID BODIES a shape is made of, and how they sit
// against each other.
//
// ── the question this answers ───────────────────────────────────────────────
// One shape handle can hold more than one solid. MEASURED on this kernel, not
// assumed:
//
//   fuse of two boxes 60 mm apart          -> a compound of 2 solids
//                                             (8000 mm^3 and 1000 mm^3)
//   a 4-up linear pattern of a spaced box  -> 4 solids
//   fuse of two boxes that MEET over a face-> 1 solid, because that is what a
//                                             union means
//   a bar cut through the middle           -> 2 solids, exactly 10.000 mm apart
//   a STEP assembly read through importStep-> one solid per component
//
// So "how many parts is this, how big is each, and what touches what" is a
// question the geometry already answers, and this header is where that answer is
// computed ONCE for everything that wants it — the desktop's parts list, its
// contact report and its component visibility all read this one record.
//
// ── why it is not a script over massProperties + detectInterference ────────
// forge::massProperties takes a ShapeHandle and answers for the WHOLE shape, so
// on a two-body compound it returns one combined volume and one combined centre
// of mass, which is the wrong answer to every question above.
// forge::detectInterference answers only for ComponentRegistry INSTANCES, which
// a feature-tree document never creates. Neither of them can be handed a solid
// out of a compound, and a caller that split the compound itself would be a
// second definition of "what a body is". There is one here.
//
// ── every number is off the B-REP ──────────────────────────────────────────
// Volume and area come from OCCT's own integrators (BRepGProp), the distance
// between two bodies from its exact distance solver (BRepExtrema), and a shared
// volume from a real boolean. NOTHING here is measured on a tessellation: a
// meshed volume is wrong in the fourth digit for any curved body, and a parts
// list that quotes a wrong mass is worse than one that quotes none.
//
// ── the face ids are the PICKING ids ───────────────────────────────────────
// bodyOfFace is indexed by the same 1-based face id forge::tessellate writes per
// triangle and forge::faceById resolves — the position of the face in
// TopExp_Explorer(shape, TopAbs_FACE) order. So a triangle the user clicked
// names a body through one lookup, and no second numbering exists to drift out
// of step with the first.

#include "forge/ShapeRegistry.hpp"

#include <cstddef>
#include <cstdint>
#include <vector>

namespace forge {

// One solid body of the shape.
struct SolidBody {
    double volume = 0.0;   // mm^3
    double area   = 0.0;   // mm^2
    double centroid[3] = {0.0, 0.0, 0.0};
    double bboxMin[3]  = {0.0, 0.0, 0.0};
    double bboxMax[3]  = {0.0, 0.0, 0.0};
    std::uint32_t faceCount = 0;
};

// Two bodies and the EXACT distance between them. `gap == 0` means they meet:
// the distance solver returned zero, which is contact and not "close".
// `overlapVolume > 0` means they occupy the same space, which is interference.
struct SolidBodyPair {
    std::uint32_t a = 0;   // 1-based body index; always a < b
    std::uint32_t b = 0;
    double gap = 0.0;            // mm
    double overlapVolume = 0.0;  // mm^3 the two share
};

// How two bodies LINE UP. This is a MEASUREMENT of the geometry, never a stored
// constraint: nothing in a feature-tree document authors one of these, and the
// caller that shows them is required to say so.
enum class BodyAlignmentKind : std::uint8_t {
    Concentric = 0,  // two round faces turning about ONE axis
    Coplanar   = 1,  // two flat faces lying in ONE plane
};

struct SolidBodyAlignment {
    BodyAlignmentKind kind = BodyAlignmentKind::Concentric;
    std::uint32_t a = 0;      // 1-based body index; always a < b
    std::uint32_t b = 0;
    std::uint32_t faceA = 0;  // 1-based face id — the id picking resolves to
    std::uint32_t faceB = 0;
    double deviation = 0.0;               // mm — how far off the alignment is
    double point[3]     = {0.0, 0.0, 0.0};  // a point on the shared axis / plane
    double direction[3] = {0.0, 0.0, 1.0};  // the axis, or the plane's normal
};

struct BodyInventoryOptions {
    // How close two bodies have to be for their alignment to be worth reporting,
    // and the size of the window a contact is judged in. Millimetres.
    double contactTolerance = 1.0;
    // ★ THE CEILING ON EXACT PAIR MEASUREMENTS, AND THE MEASUREMENT BEHIND IT.
    //
    // One exact distance between two solids costs 8-12 ms. MEASURED on this
    // build, over 100 solves between 10 mm boxes: 12.0 ms with the default
    // constructor, 11.5 ms with Extrema_ExtFlag_MIN + Extrema_ExtAlgo_Tree,
    // 8.5 ms with MIN + Grad + a 1e-7 deflection, and 5.3 ms when the two are
    // adjacent. All four return the same distance to the digit, so there is no
    // cheaper spelling of this: the cost is the algorithm, not the call.
    //
    // N bodies is N(N-1)/2 pairs. At 512 that is 3.5 SECONDS on a 40-body
    // pattern -- measured, on every rebuild, on top of the 0.47 s the compile
    // already costs. An application that pauses for four seconds after every
    // edit is broken however exact its numbers are, so the ceiling is 32, which
    // bounds this work at roughly a third of a second in the worst case and
    // costs nothing at all on the handful-of-bodies models this is usually
    // asked about (4 bodies is 6 pairs, 60 ms).
    //
    // Pairs are measured CLOSEST BOX GAP FIRST, so when the ceiling bites it
    // drops the pairs that were furthest apart, and it never drops a contact in
    // favour of a distant pair: a box gap is a LOWER BOUND on the true gap, so
    // every touching pair sorts ahead of every separated one. When it does bite
    // the caller is TOLD (pairsTruncated), because a short list that reads as a
    // complete one is the failure this whole record exists to avoid.
    std::size_t maxPairs = 32;
    // Per pair, and in total, how many alignments may be reported. A bolt circle
    // legitimately produces one concentric row per bolt and those rows are worth
    // having; every flat face of a 400-face import paired against every other is
    // noise, and a list nobody can read has said nothing.
    std::size_t maxAlignmentsPerPair = 12;
    std::size_t maxAlignments = 256;
};

struct BodyInventory {
    // FALSE when the inventory could not be taken at all — an empty handle, or a
    // shape with no solid in it (a sheet body, a faceted result). That is a
    // DIFFERENT fact from "this shape has no bodies", and a caller that showed
    // an empty list for both would be telling somebody something untrue.
    bool analysed = false;
    std::vector<SolidBody> bodies;
    std::vector<SolidBodyPair> pairs;
    std::vector<SolidBodyAlignment> alignments;
    // Indexed by 1-based face id; entry 0 is unused and always 0. The value is
    // the 1-based body the face belongs to, 0 when no solid claims it.
    std::vector<std::uint32_t> bodyOfFace;
    std::size_t pairsEvaluated = 0;
    bool pairsTruncated = false;
};

// Takes the inventory of the shape behind `body`.
//
// NEVER THROWS. A shape that cannot be walked comes back with analysed == false
// rather than as an exception, because the caller is a viewport that must keep
// drawing the user's model either way. A pair whose distance or boolean the
// kernel refuses is omitted rather than reported as zero: a wrong number in a
// contact report is worse than a missing row.
BodyInventory bodyInventory(ShapeHandle body, const BodyInventoryOptions& options = {});

// The same inventory over a shape the caller already holds. This overload is the
// actual definition; the handle form resolves the handle and delegates, so the
// two can never measure differently.
BodyInventory bodyInventory(const TopoDS_Shape& shape, const BodyInventoryOptions& options = {});

} // namespace forge
