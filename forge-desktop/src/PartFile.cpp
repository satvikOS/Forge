// forge-desktop/src/PartFile.cpp — the DEFAULT PART, and nothing else.
//
// Every line about the .fpart FORMAT that used to live here now lives in
// forge::ui (ui/src/PartDocumentFile.cpp), and PartFile.hpp re-exports it under
// the names this layer already used. See that header for why there may be only
// one writer and one reader.
//
// What is left is the one thing that IS the application's: the statements a
// brand-new document starts on.
#include "PartFile.hpp"

#include <string>
#include <vector>

namespace forge::desktop {

// ── the default part ────────────────────────────────────────────────────────
namespace {

using forge::ui::IrArg;
using forge::ui::IrLine;
using forge::ui::IrValueKind;

const char* const kBodyNode = "body.bracket";

std::vector<SeedStatement> makeDefaultPart() {
  std::vector<SeedStatement> s;
  s.push_back(SeedStatement{IrLine{1, "RECT", {IrArg::num(80.0), IrArg::num(50.0)}},
                            IrValueKind::Profile, "", "Base Sketch  80 x 50",
                            "rectangular profile on XY"});
  s.push_back(SeedStatement{IrLine{2, "EXTRUDE", {IrArg::valueRef(1), IrArg::num(20.0)}},
                            IrValueKind::Solid, "", "Plate  extrude 20", "distance=20 along +Z"});
  s.push_back(SeedStatement{IrLine{3,
                                   "CYL",
                                   {IrArg::num(6.0), IrArg::num(40.0), IrArg::num(0.0),
                                    IrArg::num(0.0), IrArg::num(-10.0)}},
                            IrValueKind::Solid, "", "Bore Tool  d12 x 40",
                            "cylinder r=6 h=40 at (0, 0, -10)"});
  s.push_back(SeedStatement{IrLine{4, "CUT", {IrArg::valueRef(2), IrArg::valueRef(3)}},
                            IrValueKind::Solid, "", "Through Bore  d12",
                            "plate minus the bore tool"});
  s.push_back(SeedStatement{
      IrLine{5, "FILLET", {IrArg::valueRef(4), IrArg::num(3.0), IrArg::keyword("VERTICAL")}},
      IrValueKind::Solid, kBodyNode, "Corner Fillet  r3", "r=3 on the vertical corner edges"});
  return s;
}

}  // namespace

const std::vector<SeedStatement>& defaultPartStatements() {
  static const std::vector<SeedStatement> table = makeDefaultPart();
  return table;
}

std::string defaultPartIr() {
  std::string out;
  for (const SeedStatement& s : defaultPartStatements()) {
    out += s.line.text();
    out += "\n";
  }
  return out;
}

const char* defaultPartBodyNode() { return kBodyNode; }

}  // namespace forge::desktop
