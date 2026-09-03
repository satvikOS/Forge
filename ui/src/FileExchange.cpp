#include "forge/ui/FileExchange.hpp"

#include <cctype>
#include <cstddef>
#include <string>
#include <string_view>
#include <vector>

namespace forge::ui {

const char* toString(ExchangeFormat format) noexcept {
  switch (format) {
    case ExchangeFormat::Step: return "step";
    case ExchangeFormat::Brep: return "brep";
    case ExchangeFormat::Stl:  return "stl";
    case ExchangeFormat::Iges: return "iges";
  }
  return "step";
}

// ALL CAPS on purpose, and it is not decoration: isUserReadable() rejects a word
// with an interior capital preceded by a lower-case letter, so "Step" would be
// fine but "StepFile" would not, and an acronym is what a user reads anyway.
const char* formatName(ExchangeFormat format) noexcept {
  switch (format) {
    case ExchangeFormat::Step: return "STEP";
    case ExchangeFormat::Brep: return "BREP";
    case ExchangeFormat::Stl:  return "STL";
    case ExchangeFormat::Iges: return "IGES";
  }
  return "STEP";
}

const std::vector<std::string>& formatExtensions(ExchangeFormat format) {
  // Function-local statics: one copy each, built once, and no order-of-static-
  // initialisation question between translation units.
  static const std::vector<std::string> step{".step", ".stp"};
  static const std::vector<std::string> brep{".brep", ".brp"};
  static const std::vector<std::string> stl{".stl"};
  static const std::vector<std::string> iges{".iges", ".igs"};
  switch (format) {
    case ExchangeFormat::Step: return step;
    case ExchangeFormat::Brep: return brep;
    case ExchangeFormat::Stl:  return stl;
    case ExchangeFormat::Iges: return iges;
  }
  return step;
}

namespace {

std::string lowered(std::string_view text) {
  std::string out;
  out.reserve(text.size());
  for (const char c : text) {
    out += static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  }
  return out;
}

// The extension INCLUDING its dot, lower-cased; "" when the leaf has none. The
// last dot of the LEAF, not of the path: a folder called `~/v1.2/part` has a dot
// in it and the file has none, and treating "2/part" as an extension is how an
// extension check silently starts answering about the wrong string.
std::string extensionOf(std::string_view path) {
  const std::size_t slash = path.find_last_of('/');
  const std::string_view leaf =
      slash == std::string_view::npos ? path : path.substr(slash + 1);
  const std::size_t dot = leaf.find_last_of('.');
  if (dot == std::string_view::npos || dot == 0) return std::string();
  return lowered(leaf.substr(dot));
}

}  // namespace

bool formatFromPath(std::string_view path, ExchangeFormat& out) noexcept {
  const std::string ext = extensionOf(path);
  if (ext.empty()) return false;
  for (const ExchangeFormat format : kAllExchangeFormats) {
    for (const std::string& candidate : formatExtensions(format)) {
      if (ext == candidate) {
        out = format;
        return true;
      }
    }
  }
  return false;
}

// ── what the kernel really does ─────────────────────────────────────────────
// These two functions are the app's ONLY statement about the kernel's exchange
// capability, and each value is justified against forge/IoExchange.hpp and the
// body behind it, not against the declaration:
//
//   importStep  real (native analytic reader, foreign reader, OCCT transfer)
//   importBrep  real (OCCT BRepTools::Read)
//   importStl   READS EXACTLY -- measured, on a hand-written 10 mm cube: volume
//               1000.000000, centre of mass (5,5,5), bounding box (0,0,0)-(10,10,10),
//               all to 1e-6. And it is STILL NOT OFFERED, because the body it
//               produces is native-MESH-backed: it has no B-rep face census
//               (forge::direct::faceCount throws), and forge::ft::compile of
//               `%1 = INPUT()` over it returns ok=FALSE -- "first invalid solid is
//               produced by op %1 INPUT: validity check threw" -- so the document
//               would hold a statement the app cannot build. An Import that reads
//               a file perfectly and leaves an unbuildable document is exactly the
//               half-working feature the standing bar forbids. It becomes offerable
//               the moment compile's validity check tolerates a mesh-backed body.
//   importIges  real (native readForeignIges), and it REFUSES anything it cannot
//               reconstruct completely rather than handing back a partial body --
//               but this branch has NO FIXTURE it could be proven on. There is no
//               IGES file in the tree and no reachable IGES writer to make one
//               (forge::io::exportIges refuses; the native writer at
//               forge-kernel/src/native/brep/IgesWrite.cpp is not wired to it). An
//               unproven read is not a capability, so it is not offered either.
//   exportStep  real (AP242 analytic writer)
//   exportBrep  real (OCCT BRepTools::Write)
//   exportStl   NOT REACHABLE FROM THIS APP, and the app says so. The body is
//               native-only: an OCCT-backed handle throws "native STL export
//               covers native-kernel bodies; this handle is OCCT-backed and has
//               no native tessellation". Every solid the app can save is OCCT-
//               backed, because forge::ft::compile forces the native backend OFF
//               for the whole build ("Force the clean OCCT analytic backend").
//               MEASURED: exporting the app's own default bracket to STL refuses.
//               So canExport(Stl) is false and no Save-as-STL command exists --
//               a capability nothing the app can build could ever use is not a
//               capability. STL IMPORT is unaffected and is registered.
//   exportIges  REFUSES. Not "sometimes fails" -- the body is an unconditional
//               throw. Whether that refusal is still fully justified is a
//               separate question (a native IGES writer covering PLANE and NURBS
//               faces DOES now exist at forge-kernel/src/native/brep/IgesWrite.cpp,
//               and it refuses quadric faces); until forge::io::exportIges routes
//               to it, the app must say Forge cannot save IGES, because that is
//               what Forge does.
// ── these two describe WHAT THE APP OFFERS, which is a stricter thing than what
// the kernel declares. Each `false` below is a MEASURED refusal, recorded above,
// and forge-desktop/test/file_exchange_gate.cpp re-measures every one of them so
// a value here cannot quietly stop being true.
bool canImport(ExchangeFormat format) noexcept {
  switch (format) {
    case ExchangeFormat::Step: return true;
    case ExchangeFormat::Brep: return true;
    case ExchangeFormat::Stl:  return false;  // reads exactly; will not build. See above.
    case ExchangeFormat::Iges: return false;  // no fixture to prove it on. See above.
  }
  return false;
}

bool canExport(ExchangeFormat format) noexcept {
  switch (format) {
    case ExchangeFormat::Step: return true;
    case ExchangeFormat::Brep: return true;
    case ExchangeFormat::Stl:  return false;  // native-backed bodies only; see above
    case ExchangeFormat::Iges: return false;  // no writer is linked; see above
  }
  return false;
}

const char* toString(ExchangeRefusal refusal) noexcept {
  switch (refusal) {
    case ExchangeRefusal::None:          return "none";
    case ExchangeRefusal::NoPath:        return "no_path";
    case ExchangeRefusal::NoExchange:    return "no_exchange";
    case ExchangeRefusal::NoDocument:    return "no_document";
    case ExchangeRefusal::CannotWrite:   return "cannot_write";
    case ExchangeRefusal::CannotRead:    return "cannot_read";
    case ExchangeRefusal::FileMissing:   return "file_missing";
    case ExchangeRefusal::WrongContents: return "wrong_contents";
    case ExchangeRefusal::NoSolid:       return "no_solid";
    case ExchangeRefusal::BuildFailed:   return "build_failed";
    case ExchangeRefusal::WriteFailed:   return "write_failed";
    case ExchangeRefusal::NotPlaced:     return "not_placed";
    case ExchangeRefusal::Truncated:     return "truncated";
  }
  return "none";
}

namespace {

// The path, quoted, or a plain phrase when there is none. Quoting matters twice:
// it tells the user which characters are part of the name, and it is what makes
// isUserReadable() skip the path when it looks for source code.
std::string quoted(const std::string& path) { return "\"" + path + "\""; }

}  // namespace

std::string exchangeMessage(ExchangeRefusal refusal, ExchangeFormat format,
                            const std::string& path) {
  const std::string name = formatName(format);
  const bool hasPath = !path.empty();
  switch (refusal) {
    case ExchangeRefusal::None:
      // Reachable only if a caller asks for the message of a refusal that did
      // not happen. It still has to be a sentence: an empty string shown in a
      // status strip reads as the app having nothing to say about a failure.
      return "Nothing went wrong.";
    case ExchangeRefusal::NoPath:
      return "No file name was given, so there is nothing to open or save.";
    case ExchangeRefusal::NoExchange:
      return "This copy of Forge cannot open or save part files yet.";
    case ExchangeRefusal::NoDocument:
      return "There is no part open, so there is nothing to save.";
    case ExchangeRefusal::CannotWrite:
      return "Forge cannot save " + name + " files. Save as STEP instead.";
    case ExchangeRefusal::CannotRead:
      return "Forge cannot open " + name +
             " files. Save the part as STEP in the program it came from, then open that.";
    case ExchangeRefusal::FileMissing:
      return hasPath ? "Forge could not find a file at " + quoted(path) +
                           ". Check the folder and the spelling."
                     : "Forge could not find that file. Check the folder and the spelling.";
    case ExchangeRefusal::WrongContents:
      return hasPath ? "The file at " + quoted(path) + " is not a " + name +
                           " file. Open it as the kind of file it really is, or save "
                           "it as STEP first."
                     : "That file is not a " + name + " file.";
    case ExchangeRefusal::NoSolid:
      return hasPath ? "Forge read " + quoted(path) +
                           " but found no solid shape in it."
                     : "Forge read that " + name + " file but found no solid shape in it.";
    case ExchangeRefusal::BuildFailed:
      return "The part has not rebuilt, so there is nothing to save. Fix the "
             "feature that is failing and try again.";
    case ExchangeRefusal::WriteFailed:
      return hasPath ? "Forge could not write " + quoted(path) +
                           ". Check that the folder exists and that you can save into it."
                     : "Forge could not write that file. Check that the folder exists "
                       "and that you can save into it.";
    case ExchangeRefusal::Truncated:
      return hasPath ? "The file at " + quoted(path) +
                           " is incomplete -- it stops before the end. Copy it again "
                           "and open the whole file."
                     : "That " + name +
                           " file is incomplete -- it stops before the end. Copy it "
                           "again and open the whole file.";
    case ExchangeRefusal::NotPlaced:
      return hasPath ? "Forge read " + quoted(path) +
                           " but could not add it to the part."
                     : "Forge read the " + name + " file but could not add it to the part.";
  }
  return "Nothing went wrong.";
}

std::string exchangeSuccessMessage(bool imported, ExchangeFormat format,
                                   const std::string& path) {
  const std::string name = formatName(format);
  if (imported) {
    return path.empty() ? "Opened a " + name + " file."
                        : "Opened the " + name + " file " + quoted(path) + ".";
  }
  return path.empty() ? "Saved the part as " + name + "."
                      : "Saved the part to " + quoted(path) + " as " + name + ".";
}

// ── the prose rule ──────────────────────────────────────────────────────────
bool isUserReadable(std::string_view sentence) {
  if (sentence.empty()) return false;

  // 1. Strip every double-quoted span. A file path is the user's own text, and
  //    /Users/a_b/part_v2.step is full of things that would otherwise read as
  //    identifiers. Everything OUTSIDE the quotes is ours and is checked.
  std::string plain;
  plain.reserve(sentence.size());
  bool inQuote = false;
  for (const char c : sentence) {
    if (c == '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote) plain += c;
  }
  // An unbalanced quote would have swallowed the tail of the sentence, so the
  // check would silently stop looking. That is the "a gate that cannot fail"
  // shape; refuse instead.
  if (inQuote) return false;

  if (plain.find("::") != std::string::npos) return false;

  // 2. Word by word.
  std::size_t i = 0;
  while (i < plain.size()) {
    while (i < plain.size() &&
           std::isspace(static_cast<unsigned char>(plain[i])) != 0) {
      ++i;
    }
    const std::size_t begin = i;
    while (i < plain.size() &&
           std::isspace(static_cast<unsigned char>(plain[i])) == 0) {
      ++i;
    }
    if (begin == i) break;
    const std::string raw = plain.substr(begin, i - begin);
    std::string word = raw;

    // ── checks that must run BEFORE the punctuation trim ──────────────────
    // Trimming is what let four known developer sentences through on the first
    // run of the gate, measured: "INPUT()" trims to "INPUT", which is a
    // perfectly good acronym, and "forge.io:" trims to "forge.io", which has
    // neither an underscore nor an interior capital. A trim that erases the
    // evidence has to happen after the evidence is read.
    //
    //   * a call:      any word containing "()"
    //   * an id:       any word starting with '%' (an IR value reference)
    //   * a namespace: a dot with a letter on both sides, i.e. forge.io, a.b
    if (raw.find("()") != std::string::npos) return false;
    if (raw[0] == '%') return false;
    for (std::size_t k = 1; k + 1 < raw.size(); ++k) {
      if (raw[k] != '.') continue;
      if (std::isalpha(static_cast<unsigned char>(raw[k - 1])) != 0 &&
          std::isalpha(static_cast<unsigned char>(raw[k + 1])) != 0) {
        return false;
      }
    }

    // Trim the punctuation an English sentence hangs on a word.
    const std::string edge = ".,;:!?()[]{}";
    while (!word.empty() && edge.find(word.front()) != std::string::npos) {
      word.erase(word.begin());
    }
    while (!word.empty() && edge.find(word.back()) != std::string::npos) {
      word.pop_back();
    }
    if (word.empty()) continue;

    if (word.find('_') != std::string::npos) return false;
    if (word.size() > 2 && word[0] == '0' && (word[1] == 'x' || word[1] == 'X')) {
      return false;
    }

    // An interior capital PRECEDED BY A LOWER-CASE LETTER is the signature of a
    // C++ identifier: TopoDS, ShapeHandle, MoltenVK, runtimeError, forgeNative.
    // It is NOT the signature of an acronym (STEP, IGES, AP242) or of a normal
    // capitalised word (Forge, Check), which is why the rule looks at the
    // PRECEDING character rather than at capitals alone.
    for (std::size_t k = 1; k < word.size(); ++k) {
      if (std::isupper(static_cast<unsigned char>(word[k])) != 0 &&
          std::islower(static_cast<unsigned char>(word[k - 1])) != 0) {
        return false;
      }
    }

    // A short deny-list for the words that pass the shape rules above and are
    // still unmistakably ours. Each one is a term that appears in a kernel
    // message this layer is responsible for translating.
    // Words that pass every shape rule above and are still unmistakably ours.
    // Each one appears in a message this layer is responsible for translating --
    // "imgui" and "programmer" come straight from the two examples the user named
    // verbatim ("message from imgui, programmer error").
    static const char* const banned[] = {
        "std",       "occt",       "tkde",     "napi",    "imgui",   "vulkan",
        "nullptr",   "errno",      "throw",    "thrown",  "throws",  "exception",
        "stderr",    "stdout",     "handle",   "pointer", "null",    "compiler",
        "programmer", "toolkit",   "segfault", "assert",  "abort",   "dylib",
        "callback",  "predicate",  "dispatch", "registry"};
    const std::string low = lowered(word);
    for (const char* term : banned) {
      if (low == term) return false;
    }
  }
  return true;
}

}  // namespace forge::ui
