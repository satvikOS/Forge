// ui/test/part_document_fixture.hpp
//
// THE 71-STATEMENT DOCUMENT every document gate is asserted on, in ONE place.
//
// ── why 71 and not 5 ────────────────────────────────────────────────────────
// Archie emits 40-70 statement feature trees, so a save/load gate proved on a
// three-statement toy proves the format on a program nobody will ever author.
// Everything that only goes wrong at length lives here: a reorder whose `%N`
// rewrite has 71 chances to be off by one, a suppression whose pass-through has
// to survive twenty-two FUSEs, an orphan prune with real orphans to find, and a
// document whose file is long enough that a reader losing one line in the middle
// is not visible by eye.
//
// ── why THIS part and not a random 71 lines ─────────────────────────────────
// It BUILDS. The program was run through the kernel's own verifier
// (forge_verify, census=full) before it was written down, and it comes back
// ok=true / valid=true / bodies=1 with a genuinely awkward solid: 238 faces, 606
// edges, genus 6 and TWO shells, because the tube shroud encloses a void. Those
// are the observables ui/test/run_document_roundtrip_gate.sh compares across a
// save and a load, and a fixture that came back genus 0 with one shell would be
// unable to notice a round trip that dropped a feature. It uses 19 distinct ops
// across all three IR value kinds (PROFILE, WIRE, SOLID), so the `KIND` field
// and the `ARG num|ref|kw` codec are exercised by real rows, not synthetic ones.
//
// ── it is a DOCUMENT, not a program ─────────────────────────────────────────
// Every non-geometric field the .fpart format claims to store is populated with
// a value that is NOT its default, because a round trip is only proved on fields
// that differ from what a fresh document would have invented anyway: parameters
// bound to real argument slots, materials assigned to real body nodes, L4
// persistent @names, a many-to-one node binding, a verifier message containing
// the two characters a line-oriented format cannot carry raw, and an `X-` line
// from a version this build does not have.
//
// ── the statement numbering, once, so no gate has to count ──────────────────
//   1  RECT           2  EXTRUDE(plate) 3  FILLET          4  CIRCLE
//   5  EXTRUDE(boss)  6  FUSE           7  FILLET
//   8..19   four corner pads   (CYL, TRANSLATE, FUSE) x4
//   20..35  four ribs          (BOX, ROTATE, TRANSLATE, FUSE) x4
//   36..40  spout              RING RING RING LOFT FUSE
//   41..43  torus collar       44..47 hex standoff   48..50 tube shroud
//   51..53  cone tip           54..58 five HOLEs
//   59..62  cut pocket         63..66 patterned pocket
//   67..69  spherical dimple   70..71 locating pin
#ifndef FORGE_UI_TEST_PART_DOCUMENT_FIXTURE_HPP
#define FORGE_UI_TEST_PART_DOCUMENT_FIXTURE_HPP

#include <cstddef>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/PartCommands.hpp"

namespace forge::uitest {

inline constexpr int kFixtureStatements = 71;

// The statements the gates address by name, so a gate never spells a bare
// number whose meaning the next edit to this file would silently change.
inline constexpr int kFixturePlateExtrude = 2;    // EXTRUDE(%1, 14)  -- plate_t drives slot 1
inline constexpr int kFixtureBossFuse = 6;        // FUSE(%3, %5)
inline constexpr int kFixtureBossFillet = 7;      // FILLET(%6, 3, ALL)
inline constexpr int kFixturePad0Cyl = 8;         // CYL(9, 12)       -- pad_r drives slot 0
inline constexpr int kFixtureRib1Rotate = 25;     // ROTATE(%24, 45, 0, 0, 1)
inline constexpr int kFixtureLoft = 39;           // LOFT(%36, %37, %38)
inline constexpr int kFixtureDimpleSphere = 67;   // SPHERE(9)
inline constexpr int kFixtureDimpleMove = 68;     // TRANSLATE(%67, 30, 0, 20)
inline constexpr int kFixtureDimpleCut = 69;      // CUT(%66, %68)
inline constexpr int kFixturePinFuse = 71;        // FUSE(%69, %70)

// The two selection nodes that name the FINISHED body. Many-to-one on purpose:
// v1 of the format stored one node per feature and the second was lost.
inline constexpr const char* kFixtureBodyNode = "bracket";
inline constexpr const char* kFixtureBodyAlias = "bracket.alias";

// Appends statements through the LOAD path (adoptFeature), which is what a file
// does, and remembers whether every one of them was legal feature-IR.
class FixtureBuilder {
 public:
  explicit FixtureBuilder(forge::ui::PartDocument& doc) : doc_(doc) {}

  int add(forge::ui::IrValueKind kind, const std::string& op,
          std::vector<forge::ui::IrArg> args, const std::string& label,
          const std::string& commandId = std::string(),
          std::vector<std::string> nodes = {}) {
    forge::ui::FeatureRecord rec;
    rec.irId = doc_.nextIrId();
    rec.commandId = commandId;
    rec.label = label;
    rec.produces = kind;
    rec.line = forge::ui::IrLine{rec.irId, op, std::move(args)};
    if (!doc_.adoptFeature(rec, nodes)) {
      illegal_ = true;
      return 0;
    }
    if (doc_.lastCheck() != forge::ui::IrCheck::Ok) illegal_ = true;
    return rec.irId;
  }

  // A fixture that silently contains an illegal row would make every gate built
  // on it prove something other than what it says.
  bool allLegal() const noexcept { return !illegal_; }

 private:
  forge::ui::PartDocument& doc_;
  bool illegal_ = false;
};

namespace fixture {
inline forge::ui::IrArg n(double v) { return forge::ui::IrArg::num(v); }
inline forge::ui::IrArg r(int id) { return forge::ui::IrArg::valueRef(id); }
inline forge::ui::IrArg k(const char* w) { return forge::ui::IrArg::keyword(w); }
}  // namespace fixture

// ── the program ─────────────────────────────────────────────────────────────
inline bool buildFixtureProgram(forge::ui::PartDocument& doc) {
  using forge::ui::IrValueKind;
  using forge::uitest::fixture::k;
  using forge::uitest::fixture::n;
  using forge::uitest::fixture::r;
  FixtureBuilder B(doc);

  // base plate
  const int p1 = B.add(IrValueKind::Profile, "RECT", {n(120), n(80)}, "Plate sketch",
                       "part.sketch.rect");
  int b = B.add(IrValueKind::Solid, "EXTRUDE", {r(p1), n(14)}, "Plate", "part.extrude", {"plate"});
  b = B.add(IrValueKind::Solid, "FILLET", {r(b), n(8), k("VERTICAL")}, "Plate corners",
            "part.fillet");

  // central boss
  const int c = B.add(IrValueKind::Profile, "CIRCLE", {n(26)}, "Boss sketch",
                      "part.sketch.circle");
  const int bo = B.add(IrValueKind::Solid, "EXTRUDE", {r(c), n(36)}, "Boss", "part.extrude");
  b = B.add(IrValueKind::Solid, "FUSE", {r(b), r(bo)}, "Boss to plate", "part.fuse");
  b = B.add(IrValueKind::Solid, "FILLET", {r(b), n(3), k("ALL")}, "Boss root", "part.fillet");

  // four corner pads
  const double padXY[4][2] = {{48, 28}, {-48, 28}, {48, -28}, {-48, -28}};
  for (const auto& xy : padXY) {
    const int pad = B.add(IrValueKind::Solid, "CYL", {n(9), n(12)}, "Pad", "part.cylinder");
    const int at = B.add(IrValueKind::Solid, "TRANSLATE", {r(pad), n(xy[0]), n(xy[1]), n(8)},
                         "Pad placed", "part.translate");
    b = B.add(IrValueKind::Solid, "FUSE", {r(b), r(at)}, "Pad to plate", "part.fuse");
  }

  // four ribs
  for (const double ang : {0.0, 45.0, 90.0, 135.0}) {
    const int rb = B.add(IrValueKind::Solid, "BOX", {n(70), n(6), n(18)}, "Rib", "part.box");
    const int rot = B.add(IrValueKind::Solid, "ROTATE", {r(rb), n(ang), n(0), n(0), n(1)},
                          "Rib turned", "part.rotate");
    const int at = B.add(IrValueKind::Solid, "TRANSLATE", {r(rot), n(0), n(0), n(8)},
                         "Rib placed", "part.translate");
    b = B.add(IrValueKind::Solid, "FUSE", {r(b), r(at)}, "Rib to plate", "part.fuse");
  }

  // lofted spout
  const int w0 = B.add(IrValueKind::Wire, "RING", {n(16), n(16), n(30)}, "Spout root",
                       "part.ring");
  const int w1 = B.add(IrValueKind::Wire, "RING", {n(11), n(11), n(46)}, "Spout waist",
                       "part.ring");
  const int w2 = B.add(IrValueKind::Wire, "RING", {n(8), n(8), n(60)}, "Spout mouth",
                       "part.ring");
  const int lf = B.add(IrValueKind::Solid, "LOFT", {r(w0), r(w1), r(w2)}, "Spout", "part.loft",
                       {"spout"});
  b = B.add(IrValueKind::Solid, "FUSE", {r(b), r(lf)}, "Spout to boss", "part.fuse");

  // torus collar
  const int tp = B.add(IrValueKind::Solid, "TORUS", {n(26), n(4)}, "Collar", "part.torus");
  const int tpAt = B.add(IrValueKind::Solid, "TRANSLATE", {r(tp), n(0), n(0), n(30)},
                         "Collar placed", "part.translate");
  b = B.add(IrValueKind::Solid, "FUSE", {r(b), r(tpAt)}, "Collar to boss", "part.fuse");

  // hex standoff
  const int hx = B.add(IrValueKind::Profile, "REGPOLY", {n(14), n(6)}, "Standoff sketch",
                       "part.sketch.regpoly");
  const int hxs = B.add(IrValueKind::Solid, "EXTRUDE", {r(hx), n(8)}, "Standoff", "part.extrude");
  const int hxAt = B.add(IrValueKind::Solid, "TRANSLATE", {r(hxs), n(0), n(0), n(-6)},
                         "Standoff placed", "part.translate");
  b = B.add(IrValueKind::Solid, "FUSE", {r(b), r(hxAt)}, "Standoff to plate", "part.fuse");

  // tube shroud — this is what gives the solid its SECOND shell
  const int tb = B.add(IrValueKind::Solid, "TUBE", {n(34), n(30), n(20)}, "Shroud", "part.tube");
  const int tbAt = B.add(IrValueKind::Solid, "TRANSLATE", {r(tb), n(0), n(0), n(6)},
                         "Shroud placed", "part.translate");
  b = B.add(IrValueKind::Solid, "FUSE", {r(b), r(tbAt)}, "Shroud to plate", "part.fuse");

  // cone tip
  const int cn = B.add(IrValueKind::Solid, "CONE", {n(8), n(4), n(14)}, "Tip", "part.cone");
  const int cnAt = B.add(IrValueKind::Solid, "TRANSLATE", {r(cn), n(0), n(0), n(54)},
                         "Tip placed", "part.translate");
  b = B.add(IrValueKind::Solid, "FUSE", {r(b), r(cnAt)}, "Tip to spout", "part.fuse");

  // holes
  b = B.add(IrValueKind::Solid, "HOLE", {r(b), n(12), n(0), n(0), n(0)}, "Bore", "part.hole");
  for (const auto& xy : padXY) {
    b = B.add(IrValueKind::Solid, "HOLE", {r(b), n(7), n(xy[0]), n(xy[1]), n(0)}, "Pad hole",
              "part.hole");
  }

  // cut pocket
  const int pk = B.add(IrValueKind::Profile, "RRECT", {n(40), n(18), n(5)}, "Pocket sketch",
                       "part.sketch.rrect");
  const int pks = B.add(IrValueKind::Solid, "EXTRUDE", {r(pk), n(10)}, "Pocket tool",
                        "part.extrude");
  const int pkAt = B.add(IrValueKind::Solid, "TRANSLATE", {r(pks), n(0), n(-30), n(8)},
                         "Pocket placed", "part.translate");
  b = B.add(IrValueKind::Solid, "CUT", {r(b), r(pkAt)}, "Pocket", "part.cut");

  // patterned pocket
  const int p2 = B.add(IrValueKind::Solid, "BOX", {n(8), n(8), n(12)}, "Slot tool", "part.box");
  const int p2At = B.add(IrValueKind::Solid, "TRANSLATE", {r(p2), n(-40), n(0), n(8)},
                         "Slot placed", "part.translate");
  const int p2Pat = B.add(IrValueKind::Solid, "PATTERN", {r(p2At), k("LINEAR"), n(5), n(20)},
                          "Slot row", "part.pattern");
  b = B.add(IrValueKind::Solid, "CUT", {r(b), r(p2Pat)}, "Slots", "part.cut");

  // spherical dimple
  const int dm = B.add(IrValueKind::Solid, "SPHERE", {n(9)}, "Dimple tool", "part.sphere");
  const int dmAt = B.add(IrValueKind::Solid, "TRANSLATE", {r(dm), n(30), n(0), n(20)},
                         "Dimple placed", "part.translate");
  b = B.add(IrValueKind::Solid, "CUT", {r(b), r(dmAt)}, "Dimple", "part.cut");

  // locating pin — the finished body carries TWO selection nodes
  const int pn = B.add(IrValueKind::Solid, "CYL", {n(5), n(30), n(30), n(-20), n(0)}, "Pin",
                       "part.cylinder");
  b = B.add(IrValueKind::Solid, "FUSE", {r(b), r(pn)}, "Pin to plate", "part.fuse",
            {kFixtureBodyNode, kFixtureBodyAlias});

  return B.allLegal() && b == kFixturePinFuse &&
         static_cast<int>(doc.records().size()) == kFixtureStatements;
}

// ── the DOCUMENT state on top of the program ────────────────────────────────
//
// The three optional pieces are optional because they change what the KERNEL is
// asked to build, and two different gates need two different answers:
//
//   suppression      %25 (a rib's ROTATE) is turned off. It PASSES THROUGH, so
//                    %26 keeps building off %24 -- and the rib comes out
//                    unrotated, which the geometry gate can SEE. That is the
//                    positive control: if suppression did nothing observable,
//                    "before == after" would be green for the wrong reason.
//   rollback         the bar sits after %68, so the dimple CUT and the pin are
//                    not built -- and %67/%68, orphaned by that, are pruned and
//                    reported rather than silently dropped.
//   verifierMessage  a kernel message on %7 puts that row in Error and BLOCKS
//                    everything below it. Right for the file gate (a document
//                    saved broken must reopen broken); fatal for the geometry
//                    gate, which would then be measuring an empty program.
struct FixtureOptions {
  bool suppression = false;
  bool rollback = false;
  bool verifierMessage = false;
};

inline void decorateFixture(forge::ui::PartDocument& doc, const FixtureOptions& opt) {
  forge::ui::PartDocument::BatchEdit hold(doc);
  doc.setName("Mounting Bracket");
  doc.setUnits("mm");

  forge::ui::Parameter plateThickness;
  plateThickness.name = "plate_t";
  plateThickness.value = 14.0;
  plateThickness.unit = "mm";
  plateThickness.comment = "plate thickness -- drives the extrude";
  doc.setParameter(plateThickness);

  forge::ui::Parameter padR;
  padR.name = "pad_r";
  padR.value = 9.0;
  padR.unit = "mm";
  padR.comment = "corner pad radius";
  doc.setParameter(padR);

  doc.bindArgToParameter(kFixturePlateExtrude, 1, "plate_t");
  for (int pad = kFixturePad0Cyl; pad <= kFixturePad0Cyl + 9; pad += 3) {
    doc.bindArgToParameter(pad, 0, "pad_r");
  }

  forge::ui::Material al;
  al.name = "AL6061";
  al.density = 2700.0;
  al.standard = "ASTM B209";
  al.appearance = "#B8BCC0";
  doc.setMaterial(al);

  forge::ui::Material steel;
  steel.name = "S355";
  steel.density = 7850.0;
  steel.standard = "EN 10025-2";
  steel.appearance = "#6E7377";
  doc.setMaterial(steel);

  doc.assignMaterial(kFixtureBodyNode, "AL6061");
  doc.assignMaterial("plate", "S355");

  // L4 persistent names, stored with the '@' a kernel TAG selector uses.
  doc.setPersistentName(kFixturePlateExtrude, "@plate");
  doc.setPersistentName(kFixtureBossFuse, "@boss");
  doc.setPersistentName(kFixtureLoft, "@spout");
  doc.setPersistentName(kFixturePinFuse, "@bracket");

  // Lines from a version this build does not have.
  doc.setExtensions({"X-APPEARANCE-THEME dark", "X-SIM-MESH-SEED 40219"});

  if (opt.verifierMessage) {
    doc.setVerifierDiagnostic(
        kFixtureBossFillet,
        "kernel declined FILLET at every distance\n  tried r=3, r=2.25, r=1.6875 \\ gave up");
  }
  if (opt.suppression) doc.setSuppressed(kFixtureRib1Rotate, true);
  if (opt.rollback) doc.setRollbackAfter(kFixtureDimpleMove);
}

// The whole fixture, program plus state. Returns false if the program did not
// come out at 71 legal statements.
inline bool buildFixture(forge::ui::PartDocument& doc, const FixtureOptions& opt) {
  if (!buildFixtureProgram(doc)) return false;
  decorateFixture(doc, opt);
  return true;
}

}  // namespace forge::uitest

#endif  // FORGE_UI_TEST_PART_DOCUMENT_FIXTURE_HPP
