// forge-desktop/src/DrawingGdt.hpp
//
// THE SEAM BETWEEN A DRAWING'S TOLERANCES AND THE GEOMETRY THEY CONTROL.
//
// forge::ui::Drawing owns the CALLOUT -- what the frame says. Measuring one
// needs the part, and the part is behind the kernel. This is the only file in
// forge-desktop besides KernelScene and FileExchangeHost that reaches a
// forge-kernel header, and it reaches exactly one: forge/native/gdt/Gdt.hpp,
// the in-house ASME Y14.5-2018 evaluator. That header is pure C++20 with no
// OCCT, so the frame builder still compiles, links and runs headlessly.
//
// ── WHAT IS MEASURED, AND WHAT IS REFUSED, AND WHY ─────────────────────────
//
// The only geometry this application holds after a rebuild is the TESSELLATION
// the viewport draws. That is enough for some characteristics and it is a LIE
// for others, and the difference is the whole design of this file.
//
//   MEASURED, because the tessellation carries the exact answer:
//     * A planar face's triangle vertices lie EXACTLY in its plane, and its
//       area-weighted normal IS the surface normal. So flatness, parallelism,
//       perpendicularity and angularity of a flat face to a flat datum are
//       computed from real coordinates and are exactly right.
//     * These are not circular checks. Parallelism measures the spread of the
//       face's own points along the DATUM's normal, and perpendicularity along
//       the datum-plane projection of the feature normal -- so a face modelled
//       at 45 degrees to datum A FAILS a perpendicularity callout, which is the
//       finding that matters: the drawing and the model disagree.
//
//   REFUSED, because the tessellation does not carry the answer:
//     * Circularity and cylindricity would measure the FACETING of the display
//       mesh. A 24-sided approximation of a 20 mm bore reports about 0.09 mm of
//       out-of-roundness that the part does not have. That number is plausible,
//       wrong, and in the units a machinist would act on.
//     * Position needs the actual mating size of the feature, and a faceted
//       bore's inscribed diameter is smaller than the modelled one.
//     * Straightness of a derived median line, and profile of a surface, need
//       the analytic surface for the same reason.
//
// A refusal here is a SENTENCE, not a blank. It says which of the two it is --
// "this needs the exact curved surface, and what is on screen is the display
// approximation of it" -- so the callout still stands on the drawing, still gets
// its legality checked, and is honestly marked as unmeasured.
//
// ── the legality check is the kernel's, not a second copy ──────────────────
// forge::native::gdt::checkFcfLegality is the repository's ASME Y14.5 frame
// checker. It is called here rather than reimplemented, and its terse answers
// are TRANSLATED into sentences rather than echoed: the evaluator writes for an
// engineer reading a report, and this is a panel.
#ifndef FORGE_DESKTOP_DRAWINGGDT_HPP
#define FORGE_DESKTOP_DRAWINGGDT_HPP

#include <cstddef>
#include <cstdint>
#include <string>

#include "forge/ui/Drawing.hpp"
#include "forge/ui/MeasureModel.hpp"

namespace forge::desktop {

// What happened when one feature control frame met the part.
struct GdtVerdict {
  // ── the frame itself ────────────────────────────────────────────────────
  bool legal = false;
  std::string legality;  // a sentence; empty when the frame is legal

  // ── the face it controls ────────────────────────────────────────────────
  bool targetFound = false;
  std::uint32_t faceId = 0;
  bool facePlanar = false;
  double faceAreaMm2 = 0.0;
  std::size_t samples = 0;

  // ── the measurement ─────────────────────────────────────────────────────
  bool measured = false;
  std::string refusal;  // why not, when !measured; always a full sentence
  double deviationMm = 0.0;
  double allowedMm = 0.0;
  bool pass = false;
  // The angle between the controlled face and its primary datum, in degrees.
  // Real, and reported for every orientation control whether or not it passed:
  // "the model is at 45 degrees where the drawing calls for 90" is the finding.
  bool haveAngle = false;
  double nominalAngleDeg = 0.0;
  double basicAngleDeg = 0.0;

  // The internal wording the evaluator produced, for the activity log. NEVER
  // drawn: `legality` and `refusal` are what a user reads.
  std::string internalDetail;
};

// Evaluates one frame against the tessellation the viewport is drawing.
// Total: it answers for an empty mesh, a missing face and an unknown datum, and
// every one of those answers is a sentence rather than a zero.
GdtVerdict evaluateFrame(const forge::ui::FeatureControlFrame& frame,
                         const forge::ui::DrawingModel& drawing,
                         const forge::ui::MeasureMesh& mesh);

// The face id an "face@N" entity reference names, or 0 when the reference is not
// a face of this part. Spelled once here because the drawing panels and the
// selection service both need it.
std::uint32_t faceIdOfRef(const forge::ui::EntityRef& ref);

}  // namespace forge::desktop

#endif  // FORGE_DESKTOP_DRAWINGGDT_HPP
