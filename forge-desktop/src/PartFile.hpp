// forge-desktop/src/PartFile.hpp
//
// THE .fpart DOCUMENT — re-exported, plus the part a new document starts on.
//
// ═══ THIS FILE USED TO BE A SECOND IMPLEMENTATION ═══════════════════════════
//
// It was 121 header lines and 357 source lines of writer, reader, capture and
// restore for the .fpart format, alongside a SECOND writer, reader, capture and
// restore for the same format in forge::ui. Its own header argued, correctly,
// that two parsers for one grammar is the "same thing, two code paths" failure
// the single-registry rule exists to prevent -- and it WAS the second one.
//
// The two had drifted exactly as that argument predicts, and always in the
// direction of the copy with fewer users:
//
//   * `kPartFileVersion` was 1 here and 2 there. The version policy in
//     PartDocumentFile.hpp -- write the current version, read
//     kPartFileMinReadVersion..kPartFileVersion, upgrade older files, refuse a
//     newer one by name -- existed in one copy and not the other, so THE
//     APPLICATION had no version policy.
//   * `PartFileFeature` stored ONE node here and a vector there, so the app's
//     Save dropped every second selection name bound to one value.
//   * And the whole of what makes a .fpart a DOCUMENT rather than a program --
//     named parameters and their argument bindings, materials and their per-body
//     assignments, L4 persistent @names, the suppression flags, the rollback
//     bar, the kernel's own per-row diagnostics, and the `X-` lines that let a
//     future version's field survive a round trip -- existed only in forge::ui.
//     forge::desktop::capturePartDocument copied name, units and the statements.
//
//     SO THE SHIPPED APPLICATION'S SAVE SILENTLY DELETED ALL OF IT. Set a
//     parameter, assign a material, name a face, suppress a feature, drag the
//     rollback bar, then Save: none of it was in the file, and none of it came
//     back. An app that cannot save is a demo, and an app that saves half the
//     document without saying so is worse than one that cannot.
//
// There is now ONE writer and ONE reader, in forge::ui, gated by
// `bash ui/test/run_ui.sh` (part_document_file_test.cpp, 1,830 checks) and by
// `bash ui/test/run_document_roundtrip_gate.sh`, which asks the KERNEL whether a
// save and a load change the solid. This file re-exports them under the names
// this layer already used, so every existing call site keeps working.
#ifndef FORGE_DESKTOP_PARTFILE_HPP
#define FORGE_DESKTOP_PARTFILE_HPP

#include <string>
#include <vector>

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/PartDocumentFile.hpp"

namespace forge::desktop {

// ── the format, from forge::ui ──────────────────────────────────────────────
// Deliberately `using` and not wrappers: a wrapper is a place for the two to
// disagree again, and there is nothing for a desktop-specific layer to add to a
// line reader.
using forge::ui::kPartFileExtension;
using forge::ui::kPartFileMagic;
using forge::ui::kPartFileMinReadVersion;
using forge::ui::kPartFileVersion;

using forge::ui::PartFileDoc;
using forge::ui::PartFileFeature;

using forge::ui::partFileVersion;
using forge::ui::readPartFile;
using forge::ui::writePartFile;

using forge::ui::capturePartDocument;
using forge::ui::restorePartDocument;

using forge::ui::loadPartFile;
using forge::ui::savePartFile;

// ── the part a fresh document starts on ─────────────────────────────────────
//
// ONE table, read by BOTH the document seed (ForgeFrame::wirePartCommands) and
// the scene's default build (KernelScene::build). Two hand-written copies of a
// starting part is how the app ended up rendering a body that no document
// described: the C++-hardcoded KernelScene part and the `%1 = BOX(80, 50, 20)`
// PartDocument seed were different objects that never met.
//
// It is a CONNECTED chain on purpose. forge::ft::compile runs an s0.4
// graph-quality gate that fails the whole program when any op "contributes
// nothing to the result" — MEASURED here: seeding an unconsumed `%1 = RECT(80,
// 50)` alongside a BOX chain returns
//   "unexplained_orphans=1 [%1] ... The required value for each is ZERO".
// So the sketch is EXTRUDEd rather than left dangling, and only the final solid
// is bound to a selection node.
struct SeedStatement {
  forge::ui::IrLine line;
  forge::ui::IrValueKind produces = forge::ui::IrValueKind::Solid;
  std::string node;    // "" = this value is not addressable by the selection
  std::string label;   // feature-tree row
  std::string detail;  // properties/timeline row
};

const std::vector<SeedStatement>& defaultPartStatements();
std::string defaultPartIr();
// The node id the default part's finished solid is bound to — what a solid
// command's selection resolves against.
const char* defaultPartBodyNode();

}  // namespace forge::desktop

#endif  // FORGE_DESKTOP_PARTFILE_HPP
