// ui/test/selection_reachability_test.cpp
//
// CAN A USER SATISFY IT? — the third question, and the one nothing was asking.
//
// capability_manifest_test asks whether the committed manifest equals the live
// registry. app_surface_reachability_test asks whether every surface OFFERS
// every command, and says in its own header that it proves "enumeration, not
// pixels". Both were green while this was true:
//
//   ForgeFrame had exactly TWO producers of selection refs — clickFace, which
//   makes an EntityKind::Face, and clickEdge, which makes an EntityKind::Edge.
//   Nothing anywhere in the application constructed a ref of any other kind.
//
// SelectionSignature::satisfiedBy compares kinds EXACTLY (`countOf(kind) ==
// total`, no subsumption), so a picked Face does not stand in for a Body and
// certainly not for a Profile. Every command whose signature named any other
// kind was therefore un-invocable by a human — in the registry, in the manifest,
// in the menu, in the ribbon, greyed out for ever. Measured on the tree that
// added this file: 28 of 80, including part.extrude and part.revolve, every
// boolean, every pattern, mirror/move/rotate, loft, skin, thicken, and the whole
// sketch family. The Archie CoPilot could drive all 28
// (ArchieCopilot::resolveSelection builds exactly those refs). A person could
// not.
//
// ── what this gate is ───────────────────────────────────────────────────────
// A RATCHET on that gap, in the two halves that make it mean something:
//
//   PART 1  the CLASSIFICATION, from the live registry: for every command, which
//           EntityKind must be picked, and is that a kind the application can
//           produce. The producible set is read out of ForgeFrame.cpp AS DATA —
//           the `ref.kind = forge::ui::EntityKind::X` assignments — so this
//           cannot drift into agreeing with a stale list, and a new producer
//           moves the number here by itself.
//   PART 2  the MAPPING that closes it. entityKindFor() must be total over
//           IrValueKind and must round-trip against the signatures that consume
//           each kind, or a tree row would select a Body for a statement that
//           produces a profile and the command would refuse anyway.
//
// The unreachable count is an EQUALITY, not a ceiling: it must be lowered in the
// same commit that closes one, so a stale baseline can never silently re-admit a
// regression. That is the s0-ratchet idiom, applied to a product gap.
#include <cctype>
#include <cstddef>
#include <cstdio>
#include <fstream>
#include <set>
#include <sstream>
#include <string>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

std::string readFile(const std::string& path, bool& ok) {
  std::ifstream in(path, std::ios::binary);
  if (!in) { ok = false; return {}; }
  std::ostringstream b; b << in.rdbuf(); ok = true; return b.str();
}

// Every EntityKind the application can ASSIGN to a ref it puts in the selection,
// read out of ForgeFrame.cpp AS DATA. Reading the source rather than keeping a
// list here is the same method app_surface_reachability_test uses on the draw
// functions, and for the same reason: a list in the gate is a second copy of the
// app's behaviour, and the two agree right up until they do not.
//
// TWO forms, because the app has two:
//
//   LITERAL     `ref.kind = forge::ui::EntityKind::Face;` — clickFace and
//               clickEdge each name exactly one kind.
//   DELEGATED   `ref.kind = kind;` where `kind` came from
//               `forge::ui::entityKindFor(...)` — clickFeature, whose kind is
//               whatever the clicked STATEMENT produces. It can therefore
//               produce every kind entityKindFor returns, and PART 2 below
//               proves independently what that set is.
//
// The delegated form is a source-read claim about a call, exactly as
// app_surface_reachability_test's PART 1 is; what it cannot prove is that the
// click reaches dispatch. That is proved where it can be — against the real
// linked ForgeFrame — by forge-desktop/test/frame_gate.cpp, which clicks the
// seeded profile row and requires part.extrude to actually emit an EXTRUDE.
std::set<EntityKind> producibleKinds(const std::string& src, bool& parsed) {
  std::set<EntityKind> kinds;
  const std::string needle = "ref.kind = forge::ui::EntityKind::";
  std::size_t at = 0;
  while ((at = src.find(needle, at)) != std::string::npos) {
    at += needle.size();
    std::string name;
    while (at < src.size() && (std::isalnum(static_cast<unsigned char>(src[at])) != 0)) {
      name += src[at];
      ++at;
    }
    // LOWERED before comparing. The source spells the enumerator (`Face`);
    // toString spells the vocabulary name (`face`), which is what every other
    // consumer -- the manifest, the vocabulary JSON, the log -- uses. Comparing
    // them raw matched NOTHING, so the scan reported an empty producible set and
    // `parsed` went false. That is the gate refusing to guess rather than
    // passing vacuously, and it is why `parsed` is asserted.
    for (char& c : name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    for (int i = 0; i <= static_cast<int>(EntityKind::SketchRef); ++i) {
      const EntityKind k = static_cast<EntityKind>(i);
      if (name == toString(k)) { kinds.insert(k); break; }
    }
  }
  // The literal form is what makes the scan falsifiable at all: if the needle
  // stops matching, `parsed` is false and every check below is reported as
  // unmeasured rather than passing vacuously.
  parsed = !kinds.empty();

  const bool delegates = src.find("forge::ui::entityKindFor(") != std::string::npos &&
                         src.find("ref.kind = kind;") != std::string::npos;
  if (delegates) {
    for (const IrValueKind v : kAllIrValueKinds) {
      const EntityKind e = entityKindFor(v);
      if (e != EntityKind::None) kinds.insert(e);
    }
  }
  return kinds;
}

}  // namespace

int main() {
  Harness H("selection_reachability");

  // The live registry, built exactly as ForgeFrame::wirePartCommands does.
  ForgeShell shell;
  PartDocument doc;
  UndoStack undo;
  CHECK_EQ_INT(doc.seed(IrValueKind::Profile, "sketch.base", "RECT",
                        {IrArg::num(80.0), IrArg::num(50.0)}), 1);
  CHECK_EQ_INT(doc.seed(IrValueKind::Solid, "body.bracket", "BOX",
                        {IrArg::num(80.0), IrArg::num(50.0), IrArg::num(20.0)}), 2);
  CHECK(registerPartCommands(shell.registry(), doc, undo) > 0);
  const CommandRegistry& reg = shell.registry();

  // ═══ PART 1 — what can the application actually put in a selection? ═══════
#ifdef FORGE_UI_REPO_ROOT
  const std::string framePath =
      std::string(FORGE_UI_REPO_ROOT) + "/forge-desktop/src/ForgeFrame.cpp";
  bool haveFrame = false;
  const std::string frame = readFile(framePath, haveFrame);
  if (!haveFrame) {
    std::printf("  [selection] CANNOT READ %s — a gate that cannot read its subject cannot\n"
                "  pass. This is RED on purpose.\n", framePath.c_str());
    CHECK(haveFrame);
    return H.finish();
  }
  bool parsed = false;
  const std::set<EntityKind> producible = producibleKinds(frame, parsed);
  // A scanner that stopped matching would report an EMPTY producible set, every
  // command would classify as unreachable, and the ratchet below would go red
  // for the wrong reason — but it WOULD go red, which is the property that
  // matters. Assert the parse anyway so the message names the real cause.
  if (!parsed)
    std::printf("  [selection] found NO `ref.kind = forge::ui::EntityKind::` assignment in\n"
                "  ForgeFrame.cpp — the scanner has stopped matching, or the app has stopped\n"
                "  producing selection refs. Either way nothing below is meaningful.\n");
  CHECK(parsed);
  std::printf("  [selection] the app can produce %zu selection kind(s):", producible.size());
  for (EntityKind k : producible) std::printf(" %s", toString(k));
  std::printf("\n");
#else
#error "FORGE_UI_REPO_ROOT is required: this gate reads ForgeFrame.cpp as data."
#endif

  std::vector<std::string> unreachable;
  std::size_t needsNothing = 0;
  for (const std::string& id : reg.ids()) {
    const CommandDescriptor* d = reg.find(id);
    if (d == nullptr) continue;
    const EntityKind want = d->signature.kind;
    if (want == EntityKind::None) { ++needsNothing; continue; }
    // EntityKind::Any is satisfied by ANY homogeneous selection, so it is
    // reachable as soon as the app can produce one kind at all.
    if (want == EntityKind::Any) continue;
    if (producible.count(want) != 0) continue;
    unreachable.push_back(id);
  }
  for (const std::string& id : unreachable) {
    const CommandDescriptor* d = reg.find(id);
    std::printf("  [selection] UNREACHABLE  %-28s needs %s\n", id.c_str(),
                d != nullptr ? toString(d->signature.kind) : "?");
  }
  std::printf("  [selection] %zu commands need no selection; %zu of %zu need a kind the app\n"
              "              cannot produce\n",
              needsNothing, unreachable.size(), reg.size());

  // ── THE RATCHET ──────────────────────────────────────────────────────────
  // ZERO, and it was 28 one commit ago — measured from this same registry and
  // this same source read, with clickFace and clickEdge the only producers.
  // clickFeature is what closed it. An EQUALITY, not a ceiling: adding a command
  // that needs a kind no surface produces turns this RED instead of shipping a
  // menu item nobody can invoke, and removing a producer turns it red instead of
  // silently greying out a family of commands again.
  const long long kKnownUnreachable = 0;
  if (static_cast<long long>(unreachable.size()) != kKnownUnreachable) {
    std::printf("  [selection] the unreachable count MOVED (%zu, baseline %lld).\n"
                "  If a producer was added, lower kKnownUnreachable in THIS FILE in the same\n"
                "  commit. If a command was added needing a kind no surface produces, it is a\n"
                "  menu item no user can invoke — add the producer, do not raise the number.\n",
                unreachable.size(), kKnownUnreachable);
  }
  CHECK_EQ_INT(unreachable.size(), kKnownUnreachable);

  // ═══ PART 2 — the mapping that closes it ═════════════════════════════════
  // entityKindFor() is what a surface holding an IR STATEMENT needs in order to
  // build a ref a signature will accept. If it were wrong the tree would select
  // a Body for a statement that produces a profile, and Extrude would refuse a
  // sketch the user had just clicked.
  CHECK(entityKindFor(IrValueKind::None) == EntityKind::None);
  CHECK(entityKindFor(IrValueKind::Profile) == EntityKind::Sketch);
  CHECK(entityKindFor(IrValueKind::Wire) == EntityKind::Wire);
  CHECK(entityKindFor(IrValueKind::Solid) == EntityKind::Body);
  CHECK(entityKindFor(IrValueKind::Sketch) == EntityKind::OpenSketch);
  CHECK(entityKindFor(IrValueKind::SketchRef) == EntityKind::SketchRef);
  CHECK(entityKindFor(IrValueKind::Surface) == EntityKind::Surface);

  // TOTAL: every kind but None must map to something selectable, or a statement
  // of that kind is a statement no surface can offer.
  std::size_t mapped = 0;
  for (const IrValueKind k : kAllIrValueKinds) {
    if (k == IrValueKind::None) continue;
    const EntityKind e = entityKindFor(k);
    if (e == EntityKind::None)
      std::printf("  [selection] IrValueKind::%s maps to no EntityKind — a statement producing\n"
                  "  one could never be selected\n", toString(k));
    CHECK(e != EntityKind::None);
    ++mapped;
  }
  CHECK_EQ_INT(mapped, 6);

  // INJECTIVE over the kinds that matter: two IR kinds sharing one EntityKind
  // would make a signature unable to tell them apart, which is exactly the
  // Wire-vs-Sketch and Surface-vs-Body distinction the kernel forced into the
  // enum in the first place.
  std::set<int> seen;
  for (const IrValueKind k : kAllIrValueKinds) {
    if (k == IrValueKind::None) continue;
    seen.insert(static_cast<int>(entityKindFor(k)));
  }
  CHECK_EQ_INT(seen.size(), 6);

  // ── WHO PRODUCES EACH KIND THE SIGNATURES DEMAND ─────────────────────────
  // With the ratchet at zero the unreachable list is empty, and a check over an
  // empty list proves nothing. This is the half that stays meaningful: every
  // kind the registry DEMANDS, and which producer answers for it. It is what
  // would catch entityKindFor's use being removed from the frame while the
  // literal producers kept the count at zero for the two kinds they cover.
  std::set<int> reachableThroughMapping;
  for (const IrValueKind k : kAllIrValueKinds) {
    if (k == IrValueKind::None) continue;
    reachableThroughMapping.insert(static_cast<int>(entityKindFor(k)));
  }
  std::set<int> required;
  for (const std::string& id : reg.ids()) {
    const CommandDescriptor* d = reg.find(id);
    if (d == nullptr) continue;
    if (d->signature.kind == EntityKind::None || d->signature.kind == EntityKind::Any) continue;
    required.insert(static_cast<int>(d->signature.kind));
  }
  std::size_t viaMapping = 0;
  for (const int raw : required) {
    const EntityKind k = static_cast<EntityKind>(raw);
    const bool byMapping = reachableThroughMapping.count(raw) != 0;
    if (byMapping) ++viaMapping;
    std::printf("  [selection] signatures demand %-11s produced by %s\n", toString(k),
                producible.count(k) == 0 ? "NOBODY"
                                         : (byMapping ? "entityKindFor (a statement click)"
                                                      : "a literal producer (a viewport pick)"));
    CHECK(producible.count(k) != 0);
  }
  // SIX of the demanded kinds are answered only by the statement click — body,
  // sketch, sketchref, opensketch, surface, wire. No viewport pick produces any
  // of them, which is precisely why 28 commands were dead before it existed.
  std::printf("  [selection] %zu of %zu demanded kinds are answered ONLY by a statement click\n",
              viaMapping, required.size());
  CHECK_EQ_INT(viaMapping, 6);

  return H.finish();
}
