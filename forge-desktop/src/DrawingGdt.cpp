#include "DrawingGdt.hpp"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

// The ONE forge-kernel header this file reaches. Pure C++20, no OCCT: the frame
// builder and every headless gate still link and run without a graphics stack.
#include "forge/native/gdt/Gdt.hpp"

namespace forge::desktop {
namespace {

namespace gdt = forge::native::gdt;

gdt::Characteristic toKernel(forge::ui::GdtCharacteristic c) {
  switch (c) {
    case forge::ui::GdtCharacteristic::Flatness: return gdt::Characteristic::FLATNESS;
    case forge::ui::GdtCharacteristic::Circularity: return gdt::Characteristic::CIRCULARITY;
    case forge::ui::GdtCharacteristic::Cylindricity: return gdt::Characteristic::CYLINDRICITY;
    case forge::ui::GdtCharacteristic::Position: return gdt::Characteristic::POSITION;
    case forge::ui::GdtCharacteristic::Perpendicularity:
      return gdt::Characteristic::PERPENDICULARITY;
    case forge::ui::GdtCharacteristic::Parallelism: return gdt::Characteristic::PARALLELISM;
    case forge::ui::GdtCharacteristic::Angularity: return gdt::Characteristic::ANGULARITY;
    case forge::ui::GdtCharacteristic::ProfileOfASurface:
      return gdt::Characteristic::PROFILE_SURFACE;
    case forge::ui::GdtCharacteristic::Straightness:
      // The kernel's legality table has no STRAIGHTNESS enumerator. Flatness is
      // its neighbour in every rule that matters here -- a form control, no
      // datum, legal on a surface -- so the legality answer is the same one, and
      // the MEASUREMENT is refused separately below whatever this returns.
      return gdt::Characteristic::FLATNESS;
  }
  return gdt::Characteristic::FLATNESS;
}

gdt::ControlledFeature toKernel(forge::ui::ControlledFeatureKind k) {
  switch (k) {
    case forge::ui::ControlledFeatureKind::PlanarSurface:
      return gdt::ControlledFeature::PLANAR_SURFACE;
    case forge::ui::ControlledFeatureKind::CylinderAxis:
      return gdt::ControlledFeature::CYLINDER_AXIS;
    case forge::ui::ControlledFeatureKind::CylinderSurface:
      return gdt::ControlledFeature::CYLINDER_SURFACE;
    case forge::ui::ControlledFeatureKind::FeatureOfSize:
      return gdt::ControlledFeature::FEATURE_OF_SIZE;
    case forge::ui::ControlledFeatureKind::LineElement:
      return gdt::ControlledFeature::LINE_ELEMENT;
  }
  return gdt::ControlledFeature::PLANAR_SURFACE;
}

gdt::MaterialCondition toKernel(forge::ui::MaterialModifier m) {
  switch (m) {
    case forge::ui::MaterialModifier::RegardlessOfFeatureSize: return gdt::MaterialCondition::RFS;
    case forge::ui::MaterialModifier::MaximumMaterial: return gdt::MaterialCondition::MMC;
    case forge::ui::MaterialModifier::LeastMaterial: return gdt::MaterialCondition::LMC;
  }
  return gdt::MaterialCondition::RFS;
}

// ── the translator ──────────────────────────────────────────────────────────
// The evaluator's own wording is written for an inspection report. It is not
// echoed: this maps each answer it can give to a sentence a drafter can act on,
// and an answer this table does not know falls back to a true general statement
// rather than to the raw text. The detail still travels, in `internalDetail`,
// to the activity log.
std::string translateLegality(const std::string& raw, const forge::ui::FeatureControlFrame& f) {
  const std::string what = forge::ui::gdtLabel(f.characteristic);
  if (raw == "more than three datum references") {
    return "A control can reference at most three datums: a primary, a secondary and a tertiary.";
  }
  if (raw == "duplicate datum reference") {
    return "This control names the same datum twice.";
  }
  if (raw == "referenced datum does not exist on the part") {
    return "This control is measured from a datum that is not on the part. Add it to a face "
           "first.";
  }
  if (raw == "form control cannot reference a datum") {
    return what + " is measured on the feature itself, so it cannot be referenced to a datum.";
  }
  if (raw == "position requires at least one datum reference") {
    return "Position says where a feature has to be, so it has to be located from at least one "
           "datum.";
  }
  if (raw == "orientation control requires a datum reference") {
    return what + " is an angle between two things, so it needs a datum to be measured from.";
  }
  if (raw == "position applies only to a feature of size / its axis") {
    return "Position applies to a hole or a boss, or to the axis of one.";
  }
  if (raw == "flatness applies to a planar surface (or a FoS derived median)") {
    return "Flatness applies to a flat face.";
  }
  if (raw == "circularity applies to a round surface / line element") {
    return "Circularity applies to a round surface, or to one line taken across it.";
  }
  if (raw == "cylindricity applies only to a cylindrical surface") {
    return "Cylindricity applies to a round surface.";
  }
  if (raw == "MMC/LMC modifier valid only on a feature-of-size control" ||
      raw == "material modifier requires a feature of size") {
    return "A material condition adds tolerance as a hole or a boss departs from its size limit, "
           "so it only belongs on a control applied to one.";
  }
  return "This is not a legal control frame as it stands.";
}

double angleBetweenDeg(const double a[3], const double b[3]) {
  const double d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const double na = std::sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
  const double nb = std::sqrt(b[0] * b[0] + b[1] * b[1] + b[2] * b[2]);
  if (!(na > 1e-12) || !(nb > 1e-12)) return -1.0;
  double c = d / (na * nb);
  if (c > 1.0) c = 1.0;
  if (c < -1.0) c = -1.0;
  double deg = std::acos(c) * 180.0 / 3.14159265358979323846;
  // Two planes at 170 degrees of NORMAL are 10 degrees apart, so the angle
  // between the SURFACES is the fold into 0..90. That is the number a drawing
  // means by "the angle between this face and datum A".
  if (deg > 90.0) deg = 180.0 - deg;
  return deg;
}

std::vector<gdt::Vec3> toKernelPoints(const std::vector<forge::ui::Point3>& pts) {
  std::vector<gdt::Vec3> out;
  out.reserve(pts.size());
  for (const forge::ui::Point3& p : pts) out.push_back(gdt::Vec3{p.x, p.y, p.z});
  return out;
}

}  // namespace

std::uint32_t faceIdOfRef(const forge::ui::EntityRef& ref) {
  if (ref.kind != forge::ui::EntityKind::Face) return 0;
  const std::size_t at = ref.persistentName.find('@');
  if (at == std::string::npos || at + 1 >= ref.persistentName.size()) return 0;
  const std::string digits = ref.persistentName.substr(at + 1);
  for (char c : digits) {
    if (c < '0' || c > '9') return 0;
  }
  const long v = std::strtol(digits.c_str(), nullptr, 10);
  if (v <= 0 || v > 0x7fffffffL) return 0;
  return static_cast<std::uint32_t>(v);
}

GdtVerdict evaluateFrame(const forge::ui::FeatureControlFrame& frame,
                         const forge::ui::DrawingModel& drawing,
                         const forge::ui::MeasureMesh& mesh) {
  GdtVerdict v;
  v.basicAngleDeg = forge::ui::basicAngleOf(frame);

  // ── 1. is the frame itself legal? The kernel's own Y14.5 checker. ────────
  const std::vector<char> available = drawing.datumLetters();
  const gdt::FcfLegality legality =
      gdt::checkFcfLegality(toKernel(frame.characteristic), toKernel(frame.feature),
                            toKernel(frame.modifier), frame.datumRefs, available);
  v.legal = legality.legal;
  if (!v.legal) {
    v.internalDetail = legality.reason;
    v.legality = translateLegality(legality.reason, frame);
  }

  // ── 2. is the face it controls still in the part? ────────────────────────
  v.faceId = faceIdOfRef(frame.target);
  if (v.faceId == 0) {
    v.refusal = "This control is not attached to a face of this part.";
    return v;
  }
  forge::ui::FaceMeasure face{};
  if (!forge::ui::measureFace(mesh, v.faceId, face)) {
    v.refusal =
        "The face this control was placed on is not in the part that is built now. Rebuild the "
        "part, or put the control on a face that is.";
    return v;
  }
  v.targetFound = true;
  v.facePlanar = face.planar;
  v.faceAreaMm2 = face.area;

  const std::vector<forge::ui::Point3> pts = forge::ui::facePoints(mesh, v.faceId);
  v.samples = pts.size();

  // ── 3. the primary datum, when the control names one ────────────────────
  forge::ui::FaceMeasure datumFace{};
  bool haveDatumFace = false;
  if (!frame.datumRefs.empty()) {
    const forge::ui::DatumFeature* d = drawing.datum(frame.datumRefs.front());
    if (d == nullptr) {
      v.refusal = std::string("Datum ") + frame.datumRefs.front() + " is not on this part.";
      return v;
    }
    const std::uint32_t datumFaceId = faceIdOfRef(d->target);
    if (datumFaceId == 0 || !forge::ui::measureFace(mesh, datumFaceId, datumFace)) {
      v.refusal = std::string("The face carrying datum ") + frame.datumRefs.front() +
                  " is not in the part that is built now.";
      return v;
    }
    if (!datumFace.planar) {
      v.refusal = std::string("Datum ") + frame.datumRefs.front() +
                  " is on a curved face. A datum plane has to be a flat face.";
      return v;
    }
    haveDatumFace = true;
    const double a = angleBetweenDeg(face.normal, datumFace.normal);
    if (a >= 0.0) {
      v.haveAngle = true;
      v.nominalAngleDeg = a;
    }
  }

  // ── 4. measure, or say plainly why not ──────────────────────────────────
  //
  // The refusals below are the honest half of this function. Everything the
  // display tessellation cannot answer is REFUSED with the reason, never
  // answered with the faceting of the mesh.
  switch (frame.characteristic) {
    case forge::ui::GdtCharacteristic::Circularity:
    case forge::ui::GdtCharacteristic::Cylindricity: {
      v.refusal =
          "Roundness is measured on the exact curved surface. What this application holds after a "
          "rebuild is the flat-sided approximation it draws, and measuring roundness on that "
          "would report the flat sides as an error the part does not have.";
      return v;
    }
    case forge::ui::GdtCharacteristic::Position: {
      v.refusal =
          "Position needs the measured size of the hole or boss as well as where it sits, and the "
          "drawn approximation of a round feature is slightly smaller than the real one. The "
          "control is kept on the drawing and checked for correctness, but not measured here.";
      return v;
    }
    case forge::ui::GdtCharacteristic::Straightness:
    case forge::ui::GdtCharacteristic::ProfileOfASurface: {
      v.refusal =
          "This control is measured against the exact surface the part was built from, which is "
          "not what is drawn on screen. The control is kept on the drawing and checked for "
          "correctness, but not measured here.";
      return v;
    }
    case forge::ui::GdtCharacteristic::Flatness: {
      if (!face.planar) {
        v.refusal =
            "This face is curved, so a flatness call-out on it cannot be checked. Flatness "
            "applies to a face that is meant to be flat.";
        return v;
      }
      if (pts.size() < 3) {
        v.refusal = "There are too few points on this face to fit a plane through.";
        return v;
      }
      const gdt::ToleranceZoneVerdict z =
          gdt::validateFlatnessPointSet(toKernelPoints(pts), frame.toleranceMm);
      if (!z.ok) {
        v.internalDetail = z.reason;
        v.refusal = "The points on this face do not define a plane to measure against.";
        return v;
      }
      v.measured = true;
      v.deviationMm = z.worstDeviationMm;
      v.allowedMm = z.allowedZone;
      v.pass = z.pass;
      return v;
    }
    case forge::ui::GdtCharacteristic::Parallelism:
    case forge::ui::GdtCharacteristic::Perpendicularity:
    case forge::ui::GdtCharacteristic::Angularity: {
      if (!haveDatumFace) {
        v.refusal = "An angle control needs a datum to be measured from.";
        return v;
      }
      if (!face.planar) {
        v.refusal =
            "This face is curved. An angle control measured this way applies to a flat face "
            "against a flat datum.";
        return v;
      }
      if (pts.size() < 3) {
        v.refusal = "There are too few points on this face to measure an angle from.";
        return v;
      }
      const gdt::Vec3 datumNormal{datumFace.normal[0], datumFace.normal[1], datumFace.normal[2]};
      const gdt::Vec3 featureNormal{face.normal[0], face.normal[1], face.normal[2]};
      const gdt::ToleranceZoneVerdict z = gdt::validateOrientationPointSet(
          toKernelPoints(pts), datumNormal, toKernel(frame.characteristic), v.basicAngleDeg,
          frame.toleranceMm, featureNormal);
      if (!z.ok) {
        // The evaluator refuses when the nominal feature normal has no component
        // in the datum plane -- which is exactly the case of a face lying
        // PARALLEL to the datum under a perpendicularity call-out. That is not a
        // measurement problem, it is a contradiction between the model and the
        // drawing, and saying so is far more use than saying nothing could be
        // measured.
        v.internalDetail = z.reason;
        if (v.haveAngle) {
          char said[220];
          std::snprintf(said, sizeof(said),
                        "As modelled this face sits at %.2f degrees to datum %c, and this control "
                        "calls for %.2f. Correct the part or the control; they cannot both be "
                        "right.",
                        v.nominalAngleDeg, frame.datumRefs.front(), v.basicAngleDeg);
          v.refusal = said;
        } else {
          v.refusal = "This face and this datum do not define an angle that can be measured.";
        }
        return v;
      }
      v.measured = true;
      v.deviationMm = z.worstDeviationMm;
      v.allowedMm = z.allowedZone;
      v.pass = z.pass;
      return v;
    }
  }
  v.refusal = "This control has no check in this version.";
  return v;
}

}  // namespace forge::desktop
