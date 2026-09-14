#include "FileDialog.hpp"

#include <cstddef>
#include <filesystem>
#include <string>
#include <system_error>
#include <vector>

#include "PartFile.hpp"
#include "forge/ui/FileExchange.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/MachineProgram.hpp"

namespace forge::desktop {
namespace {

using forge::ui::ExchangeFormat;

// The exchange filter for one format, READ from forge::ui rather than spelled
// again here. formatExtensions() is the same list ForgeShell::runExport uses to
// decide whether the suffix a user typed names a format Forge can write, so the
// panel cannot offer a suffix the command would then refuse.
FileFilter exchangeFilter(ExchangeFormat format) {
  FileFilter f;
  f.label = forge::ui::formatName(format);
  f.extensions = forge::ui::formatExtensions(format);
  return f;
}

// Forge's own document. It is NOT an ExchangeFormat and must not become one:
// .fpart is the feature-IR program plus its bindings, not an interchange file,
// and forge::ui::formatFromPath has correctly never heard of it.
FileFilter partFilter() {
  FileFilter f;
  f.label = "Forge Part";
  f.extensions.push_back(kPartFileExtension);
  return f;
}

// The leaf of `path`, or the whole thing when it names no directory.
std::string leafOf(const std::string& path) {
  const std::size_t slash = path.find_last_of('/');
  return slash == std::string::npos ? path : path.substr(slash + 1);
}

// `path` with its extension replaced by `extension`. A leading dot in the leaf
// (".profile") is NOT an extension, which is why the search is bounded below by
// position 1 of the LEAF rather than of the whole path -- a directory component
// containing a dot must never be truncated.
std::string withExtension(const std::string& path, const std::string& extension) {
  if (path.empty() || extension.empty()) return path;
  const std::size_t slash = path.find_last_of('/');
  const std::size_t leafStart = slash == std::string::npos ? 0 : slash + 1;
  const std::string leaf = path.substr(leafStart);
  const std::size_t dot = leaf.find_last_of('.');
  const std::string stem = (dot != std::string::npos && dot > 0) ? leaf.substr(0, dot) : leaf;
  if (stem.empty()) return path;
  return path.substr(0, leafStart) + stem + extension;
}

// ── THE TABLE ───────────────────────────────────────────────────────────────
// One row per registered file command that needs a path -- the six PR #206
// registered, plus the two WAYS OUT: file.export_stl (STL was offered in neither
// direction, so nothing modelled in Forge could reach a slicer) and
// file.export_gcode (the Manufacturing workspace's posted program could leave the
// application only on the clipboard). The file-dialog gate walks the registry in
// the OTHER direction too, so a file command added without a row here is a red
// check and not a menu item that silently cannot be reached.
//
// Every sentence in it is
// shown to a user and every one of them is checked by the file-dialog gate with
// forge::ui::isUserReadable -- the same predicate the exchange refusal messages
// pass -- so a title that leaked an identifier would be a red gate rather than a
// panel nobody reads carefully.
struct Row {
  const char* id;
  FileDialogMode mode;
  PathRole role;
  const char* title;
  const char* prompt;
};

constexpr Row kRows[] = {
    {"file.open", FileDialogMode::Open, PathRole::Required, "Open a Forge Part", "Open"},
    // SaveTarget, not Required: file.save declares `path` OPTIONAL so that a
    // bare Ctrl+S dispatches. See PathRole in the header for why a panel on
    // every save would be the wrong answer.
    {"file.save", FileDialogMode::Save, PathRole::SaveTarget, "Save the Part", "Save"},
    // Required, not SaveTarget, and that is the whole of Save As: it asks EVERY
    // time, including on a part that already has a file, because choosing a new
    // name is the only thing it is for. file.save's `path` is optional and this
    // one's is required, so the registry itself reports the missing parameter
    // and the panel is owed on every invocation.
    {"file.save_as", FileDialogMode::Save, PathRole::Required, "Save the Part As", "Save"},
    {"file.import_step", FileDialogMode::Open, PathRole::Required, "Import a STEP File",
     "Import"},
    {"file.export_step", FileDialogMode::Save, PathRole::Required, "Save a Copy as STEP",
     "Export"},
    {"file.import_brep", FileDialogMode::Open, PathRole::Required, "Import a BREP File",
     "Import"},
    {"file.export_brep", FileDialogMode::Save, PathRole::Required, "Save a Copy as BREP",
     "Export"},
    {"file.export_stl", FileDialogMode::Save, PathRole::Required, "Save a Copy as STL",
     "Export"},
    // The Manufacturing workspace's egress. A SAVE panel like the other exports,
    // and for the same reason its `path` is Required: a machine program has no
    // honest default name either.
    {"file.export_gcode", FileDialogMode::Save, PathRole::Required, "Save the Machine Program",
     "Export"},
};

// The filters and the default suffix for one row. Kept beside the table rather
// than in it because a std::vector cannot live in a constexpr row.
void fillFormats(const std::string& id, FileDialogPolicy& out) {
  if (id == "file.open" || id == "file.save" || id == "file.save_as") {
    out.filters.push_back(partFilter());
    out.defaultExtension = kPartFileExtension;
    return;
  }
  if (id == "file.export_gcode") {
    // READ from forge::ui, exactly as the exchange filters are, and for the same
    // reason: a second list of suffixes here would be a second opinion about what
    // a machine program is called. It is NOT an ExchangeFormat -- a posted
    // program is not geometry and forge::ui::formatFromPath has correctly never
    // heard of it, which is why this row cannot reuse exchangeFilter().
    FileFilter f;
    f.label = "Machine Program";
    f.extensions = forge::ui::machineProgramExtensions();
    out.filters.push_back(f);
    const std::vector<std::string>& exts = forge::ui::machineProgramExtensions();
    if (!exts.empty() && out.mode == FileDialogMode::Save) out.defaultExtension = exts.front();
    return;
  }
  const bool step = (id == "file.import_step" || id == "file.export_step");
  const ExchangeFormat format = step                      ? ExchangeFormat::Step
                                : id == "file.export_stl" ? ExchangeFormat::Stl
                                                          : ExchangeFormat::Brep;
  out.filters.push_back(exchangeFilter(format));
  // The canonical extension is FIRST in formatExtensions() by contract, and it
  // is the one a Save panel appends. Reading [0] rather than naming ".step"
  // keeps this file with no opinion about what a STEP file is called.
  const std::vector<std::string>& exts = forge::ui::formatExtensions(format);
  if (!exts.empty() && out.mode == FileDialogMode::Save) out.defaultExtension = exts.front();
}

}  // namespace

bool fileDialogPolicyFor(const std::string& commandId, FileDialogPolicy& out) {
  for (const Row& row : kRows) {
    if (commandId != row.id) continue;
    out = FileDialogPolicy{};
    out.mode = row.mode;
    out.role = row.role;
    out.title = row.title;
    out.prompt = row.prompt;
    fillFormats(commandId, out);
    return true;
  }
  return false;
}

bool fileDialogRequestFor(const std::string& commandId, const std::string& seed,
                          const SeedContext& context, FileDialogRequest& out) {
  FileDialogPolicy policy;
  if (!fileDialogPolicyFor(commandId, policy)) return false;
  out = FileDialogRequest{};
  out.mode = policy.mode;
  out.title = policy.title;
  out.prompt = policy.prompt;
  out.filters = policy.filters;
  out.defaultExtension = policy.defaultExtension;
  // ── THE SEED ────────────────────────────────────────────────────────────
  // An OPEN panel is seeded with the path as given: it decides which directory
  // opens, and the file name in it is a reasonable thing to start beside.
  //
  // A SAVE panel is seeded with the STEM and this command's own suffix. Without
  // the swap, "Save a Copy as STEP" on an open `bracket.fpart` starts on
  // `bracket.fpart` -- so the one-click answer writes STEP bytes into a file
  // named like a Forge document, and reopening it later fails in a way that
  // looks like the document is corrupt.
  //
  // ★ AND THE SAME FUNCTION THE TYPED BOX USES. This expression used to live
  // here, inline, and ForgeFrame::openPrompt() -- the fallback UI for a build
  // with no native panel -- seeded its box from the raw path instead. Two UIs,
  // one question, two answers: T-123.
  out.suggestedPath = fileDialogSuggestedPath(commandId, seed, context);
  return true;
}

// ── ★ MOVED HERE FROM ForgeFrame's ANONYMOUS NAMESPACE, UNCHANGED ──────────
// Its contract is the load-bearing part: it may ONLY return a path that
// std::filesystem::exists() says is absent and that is not `forbidden`. It had
// two callers in one file; the seed producer below is the third, and it is the
// one that needed it -- T-123's suffix swap INVENTED a name and skipped this
// rule entirely, which is T-128.
std::string firstFreeFallbackPath(const std::string& directory, const std::string& stem,
                                  const std::string& forbidden, const std::string& extension,
                                  Swerve& swerved, std::string& firstChoice) {
  std::string base = stem.empty() ? std::string("untitled") : stem;
  // A name this function itself produced goes back into the SERIES it came from
  // rather than growing a second tail: "untitled-4" asks for "untitled-5", not
  // "untitled-4-2".
  {
    const std::size_t dash = base.find_last_of('-');
    if (dash != std::string::npos && dash > 0 && dash + 1 < base.size() &&
        base.find_first_not_of("0123456789", dash + 1) == std::string::npos) {
      base.erase(dash);
    }
  }
  swerved = Swerve::None;
  firstChoice = directory + "/" + base + extension;
  std::error_code ec;
  bool skippedForRefusal = false;
  bool skippedForFile = false;
  for (int n = 1; n <= 1000; ++n) {
    const std::string candidate = n == 1 ? firstChoice
                                         : directory + "/" + base + "-" + std::to_string(n) +
                                               extension;
    if (!forbidden.empty() && candidate == forbidden) {
      skippedForRefusal = true;
      continue;
    }
    if (!std::filesystem::exists(candidate, ec)) {
      // A file in the way outranks a refusal in the sentence the user reads:
      // if both happened, something really is at a name in this series.
      swerved = skippedForFile ? Swerve::Occupied
                               : (skippedForRefusal ? Swerve::Refused : Swerve::None);
      return candidate;
    }
    skippedForFile = true;
  }
  // A thousand untitled parts in one directory is not a state to guess at.
  return std::string();
}

std::string fileDialogSuggestedPath(const std::string& commandId, const std::string& seed,
                                    const SeedContext& context) {
  FileDialogPolicy policy;
  // A command with no policy row is not a file command; whatever the caller
  // seeded stands.
  if (!fileDialogPolicyFor(commandId, policy)) return seed;
  // An OPEN box keeps the path as given: naming a file that DOES exist is the
  // entire point of Open.
  if (policy.mode != FileDialogMode::Save) return seed;
  const std::string candidate = withExtension(seed, policy.defaultExtension);
  if (candidate.empty()) return candidate;

  // ── ★ (a) THE DOCUMENT'S OWN FILE STANDS ────────────────────────────────
  // Save As on a .fpart is the identity, and Save writes the file you chose.
  // This is the one occupied path a Save box is allowed to open on.
  if (forge::ui::pathNamesSameFile(candidate, context.ownDocument)) return candidate;

  // ── ★ (b) A FILE THE OPEN DOCUMENT READS -- T-127 ───────────────────────
  bool namesABinding = false;
  for (const std::string& bound : context.boundFiles) {
    if (!forge::ui::pathNamesSameFile(candidate, bound)) continue;
    namesABinding = true;
    break;
  }

  // ── ★ (c) SAVE AS ONTO AN OCCUPIED NAME -- T-128 ────────────────────────
  // Save As means "give it a name it does not have". An invented one that is
  // occupied is a trap, whatever is sitting there.
  const bool saveAsOntoOccupied =
      commandId == "file.save_as" && forge::ui::pathIsOccupied(candidate);

  // ── (d) an EXPORT onto a merely-occupied path STANDS. See the header.
  if (!namesABinding && !saveAsOntoOccupied) return candidate;

  const std::size_t slash = candidate.find_last_of('/');
  const std::string dir = slash == std::string::npos ? std::string(".")
                                                     : candidate.substr(0, slash);
  std::string leaf = slash == std::string::npos ? candidate : candidate.substr(slash + 1);
  const std::size_t dot = leaf.find_last_of('.');
  const std::string stem = (dot != std::string::npos && dot > 0) ? leaf.substr(0, dot) : leaf;
  Swerve swerved = Swerve::None;
  std::string wanted;
  const std::string free = firstFreeFallbackPath(dir, stem, context.ownDocument,
                                                 policy.defaultExtension, swerved, wanted);
  // A thousand collisions in one folder: hand back the candidate rather than an
  // empty box. The shell still refuses it, and an empty Save As box is a dead
  // end the user cannot act on.
  return free.empty() ? candidate : free;
}

const std::vector<std::string>& fileDialogCommandIds() {
  static const std::vector<std::string> ids = [] {
    std::vector<std::string> v;
    for (const Row& row : kRows) v.emplace_back(row.id);
    return v;
  }();
  return ids;
}

// ── the seed, spelled out for a reader of the gate ──────────────────────────
// `leafOf` is used by the macOS panel to fill the name field; it is defined here
// so the one rule about what a file is called lives beside the one that decides
// its suffix.
std::string fileDialogNameField(const std::string& suggestedPath) { return leafOf(suggestedPath); }

}  // namespace forge::desktop
