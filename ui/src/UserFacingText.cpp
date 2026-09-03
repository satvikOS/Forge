#include "forge/ui/UserFacingText.hpp"

#include <algorithm>
#include <cstddef>
#include <string>
#include <vector>

namespace forge::ui {

namespace {

bool isWordChar(char c) {
  const unsigned char u = static_cast<unsigned char>(c);
  return (u >= '0' && u <= '9') || (u >= 'a' && u <= 'z') || (u >= 'A' && u <= 'Z') || u == '_';
}

char lower(char c) {
  const unsigned char u = static_cast<unsigned char>(c);
  if (u >= 'A' && u <= 'Z') return static_cast<char>(u - 'A' + 'a');
  return c;
}

std::string toLower(const std::string& s) {
  std::string out;
  out.reserve(s.size());
  for (char c : s) out += lower(c);
  return out;
}

// A phrase match that is not allowed to land inside a longer word. "todo" must
// fire on "TODO:" and stay silent on "todos" and on "photodocument" -- a gate
// that cries on an innocent word gets switched off, and a gate that is switched
// off is not a gate.
bool boundedAt(const std::string& hay, std::size_t pos, std::size_t len) {
  const bool leftOk = pos == 0 || !isWordChar(hay[pos - 1]);
  const bool rightOk = pos + len >= hay.size() || !isWordChar(hay[pos + len]);
  return leftOk && rightOk;
}

void findPhrases(const std::string& lowerText, const std::string& original, ProseDefect defect,
                 const char* const* phrases, std::size_t count,
                 std::vector<ProseFinding>& out) {
  for (std::size_t i = 0; i < count; ++i) {
    const std::string needle = phrases[i];
    if (needle.empty()) continue;
    std::size_t at = 0;
    while ((at = lowerText.find(needle, at)) != std::string::npos) {
      if (boundedAt(lowerText, at, needle.size())) {
        out.push_back(ProseFinding{defect, original.substr(at, needle.size()), at});
      }
      at += needle.size();
    }
  }
}

// ── the word lists ──────────────────────────────────────────────────────────
// Lower case; matched case-insensitively and only on whole words.

// The program's own parts list. A user's part is made of faces and edges; it is
// not made of Vulkan.
const char* const kLibraryNames[] = {
    "imgui", "dear imgui", "vulkan", "moltenvk", "sdl",  "sdl2",
    "glfw",  "opengl",     "glsl",   "spir-v",   "occt", "opencascade",
};

// Notes about the development schedule. Every one of these is addressed to a
// colleague, and a user is not one.
const char* const kNotImplemented[] = {
    "not implemented", "unimplemented", "not yet implemented", "todo",
    "fixme",           "placeholder",   "stub",                "stubbed",
    "no-op",           "noop",          "wip",                 "work in progress",
};

// The vocabulary of the debugger.
//
// "segment" is NOT here and must not be: a mesh edge really is made of segments
// and the Measure panel says so correctly. The offence is "in this segment",
// meaning a slice of the development plan, so THAT is what is listed.
const char* const kDeveloperNouns[] = {
    "programmer error",  "internal error",     "assertion",      "assert",
    "invariant",         "exception",          "nullptr",        "null pointer",
    "segfault",          "segmentation fault", "stack trace",    "backtrace",
    "undefined behaviour", "undefined behavior", "in this segment", "this segment",
    "dereference",       "std",                "unreachable",    "should not happen",
};

// The program's own machinery, named in ordinary English.
//
// THE MISS THIS LIST EXISTS FOR. Every word above is a word no one would type
// into a CAD dialog by accident. These are the opposite: each is a normal word,
// and a sentence made entirely of them reads as English and still tells the user
// about the inside of Forge. The menu tooltip on EVERY command said
//
//     id: part.fillet   needs: selection_signature_mismatch: 1..n edge   IR: FILLET
//
// and not one character of it is a debugger noun.
//
// Chosen so that each entry has NO meaning in a machine shop:
//   "registry", "dispatch", "handler", "predicate", "schema", "callback" —
//        the command system's own parts.
//   "compile", "parse", "statement", "declared", "emits", "arity", "opcode" —
//        the compiler's vocabulary. A part has features, not statements.
//   "in process", "out of process", "transport", "serialise" — the runtime's.
// Deliberately NOT here, and each for a reason a reader can check:
//   "segment"   a mesh edge really is made of segments (Measure says so).
//   "peak"      peak stress is a real reading.
//   "gate"      a gate is a real feature of a moulded part.
//   "mesh", "triangle", "non-manifold", "winding" — these describe the USER'S
//               model. A CAD application is allowed to name the user's geometry.
const char* const kDeveloperVocabulary[] = {
    "registry",   "dispatch",    "dispatcher",  "dispatched", "handler",
    "predicate",  "schema",      "callback",    "enum",       "namespace",
    "singleton",  "mutex",       "deadlock",    "opcode",     "bytecode",
    "compiler",   "parser",      "lexer",       "compile",    "compiled",
    "compiles",   "parse",       "parsed",      "parses",     "statement",
    "statements", "declares",    "declared",    "emits",      "emitted",
    "arity",      "refs",        "serialise",   "serialize",  "in process",
    "in-process", "out of process", "subprocess", "transport", "telemetry",
    "op-constraint", "value ref", "valueref",   "identifier", "api",
    "sdk",        "stderr",      "stdout",      "codebase",   "call site",
    // "the tool catalog did not produce an entry for it" was a real hint on a
    // real menu item. "catalog" alone is NOT here: a parts catalogue is a thing
    // a machinist has.
    "tool catalog", "tool catalogue", "live registry",
};

// Names the PROGRAM answers to, in three shapes. See ProseDefect::MachineIdentifier.
//
// Two allowlists, and both are narrow ON PURPOSE:
//   kProductNames  spellings a user is MEANT to read. "CoPilot" is the panel's
//                  own title; flagging it would make the gate wrong and a wrong
//                  gate gets switched off.
//   kUserFileTypes a dotted word ending in one of these is a FILE, which is the
//                  user's own object -- "bracket.fpart" must stay sayable while
//                  "part.fillet" must not.
const char* const kProductNames[] = {"CoPilot", "ArchDisc", "OpenSCAD"};
const char* const kUserFileTypes[] = {"fpart", "step", "stp",  "brep", "iges",
                                      "igs",   "stl",  "json", "txt",  "csv",
                                      "png",   "log",  "obj",  "dxf",  "pdf"};

bool inList(const std::string& word, const char* const* list, std::size_t count) {
  for (std::size_t i = 0; i < count; ++i) {
    if (word == list[i]) return true;
  }
  return false;
}

// snake_case: two or more all-lower-case segments joined by underscores. Our own
// panel and command ids are exactly this shape, which is the point -- they are
// identifiers and a sentence must not contain one.
bool isSnakeCaseIdentifier(const std::string& token) {
  if (token.size() < 5) return false;
  std::size_t segments = 1;
  std::size_t segLen = 0;
  for (char c : token) {
    if (c == '_') {
      if (segLen < 2) return false;  // "a_b" is not an identifier, it is punctuation
      ++segments;
      segLen = 0;
      continue;
    }
    if (c >= 'A' && c <= 'Z') return false;  // handled by the mixed-case rule
    ++segLen;
  }
  return segments >= 2 && segLen >= 2;
}

// CamelCase: a capital, then lower case, then ANOTHER capital -- "LocalPlanner",
// "DockLayout", "ForgeShell". One capitalised word ("Front", "Extrude") is
// English and is left alone, which is why the second capital is required.
bool isCamelCaseIdentifier(const std::string& token) {
  if (token.size() < 4) return false;
  if (!(token[0] >= 'A' && token[0] <= 'Z')) return false;
  bool sawLower = false;
  for (std::size_t i = 1; i < token.size(); ++i) {
    const char c = token[i];
    if (c >= 'a' && c <= 'z') { sawLower = true; continue; }
    if (c >= 'A' && c <= 'Z') { if (sawLower) return true; continue; }
    return false;  // a digit or an underscore: another rule's business
  }
  return false;
}

// A dotted id -- "part.fillet", "app.load_sample", "view.iso". Both halves are
// lower case, and the tail must not be a file type a user owns.
void scanDottedIdentifiers(const std::string& text, std::vector<ProseFinding>& out) {
  std::size_t i = 0;
  while (i < text.size()) {
    if (!isWordChar(text[i])) { ++i; continue; }
    const std::size_t start = i;
    bool dotted = false;
    bool upper = false;
    while (i < text.size() && (isWordChar(text[i]) ||
                               (text[i] == '.' && i + 1 < text.size() && isWordChar(text[i + 1])))) {
      if (text[i] == '.') dotted = true;
      if (text[i] >= 'A' && text[i] <= 'Z') upper = true;
      ++i;
    }
    if (!dotted || upper) continue;
    const std::string token = text.substr(start, i - start);
    const std::size_t dot = token.find_last_of('.');
    const std::string head = token.substr(0, dot);
    const std::string tail = token.substr(dot + 1);
    if (head.size() < 3 || tail.size() < 2) continue;
    if (inList(tail, kUserFileTypes, sizeof(kUserFileTypes) / sizeof(kUserFileTypes[0]))) continue;
    // A decimal number is not a name.
    bool anyAlpha = false;
    for (char c : token) {
      if (c >= 'a' && c <= 'z') anyAlpha = true;
    }
    if (!anyAlpha) continue;
    out.push_back(ProseFinding{ProseDefect::MachineIdentifier, token, start});
  }
}

void scanTokens(const std::string& text, std::vector<ProseFinding>& out) {
  std::size_t i = 0;
  while (i < text.size()) {
    if (!isWordChar(text[i])) { ++i; continue; }
    const std::size_t start = i;
    while (i < text.size() && isWordChar(text[i])) ++i;
    const std::string token = text.substr(start, i - start);
    if (token.size() < 3) continue;

    bool hasUnderscore = false;
    bool hasUpper = false;
    bool hasLower = false;
    for (char c : token) {
      if (c == '_') hasUnderscore = true;
      const unsigned char u = static_cast<unsigned char>(c);
      if (u >= 'A' && u <= 'Z') hasUpper = true;
      if (u >= 'a' && u <= 'z') hasLower = true;
    }

    // vkCreateFramebuffer, VkResult -- the Vulkan naming convention, which no
    // sentence written for a person ever produces by accident.
    const bool vkPrefixed = token.size() > 2 && (token[0] == 'v' || token[0] == 'V') &&
                            token[1] == 'k' &&
                            static_cast<unsigned char>(token[2]) >= 'A' &&
                            static_cast<unsigned char>(token[2]) <= 'Z';
    // ImGui_ImplVulkan_AddTexture, SDL_Vulkan_GetInstanceExtensions: an
    // underscore holding two differently-cased words together is a C identifier,
    // not English. Our own ids ("feature_tree", "archie_copilot") are all lower
    // case and are therefore silent here, which is the point.
    const bool mixedCaseIdentifier = hasUnderscore && hasUpper && hasLower;
    // VK_SUCCESS, SDL_INIT_VIDEO -- a shouted constant.
    const bool shoutedConstant = hasUnderscore && hasUpper && !hasLower && token.size() >= 5;

    if (vkPrefixed || mixedCaseIdentifier || shoutedConstant) {
      out.push_back(ProseFinding{ProseDefect::ApiSymbol, token, start});
      continue;
    }
    if (inList(token, kProductNames, sizeof(kProductNames) / sizeof(kProductNames[0]))) continue;
    if (isSnakeCaseIdentifier(token) || isCamelCaseIdentifier(token)) {
      out.push_back(ProseFinding{ProseDefect::MachineIdentifier, token, start});
    }
  }
}

void scanSourceLocations(const std::string& lowerText, const std::string& original,
                         std::vector<ProseFinding>& out) {
  static const char* const kExtensions[] = {".cpp", ".hpp", ".cxx", ".hxx", ".cc"};
  for (const char* ext : kExtensions) {
    const std::string needle = ext;
    std::size_t at = 0;
    while ((at = lowerText.find(needle, at)) != std::string::npos) {
      // A file name has a name: ".cpp" alone, or " .cpp", is punctuation.
      const bool named = at > 0 && isWordChar(lowerText[at - 1]);
      const bool ends = at + needle.size() >= lowerText.size() ||
                        !isWordChar(lowerText[at + needle.size()]);
      if (named && ends) {
        std::size_t start = at;
        while (start > 0 && isWordChar(lowerText[start - 1])) --start;
        out.push_back(ProseFinding{ProseDefect::SourceLocation,
                                   original.substr(start, at + needle.size() - start), start});
      }
      at += needle.size();
    }
  }
}

}  // namespace

const char* toString(ProseDefect defect) noexcept {
  switch (defect) {
    case ProseDefect::CppScope:       return "CppScope";
    case ProseDefect::LibraryName:    return "LibraryName";
    case ProseDefect::ApiSymbol:      return "ApiSymbol";
    case ProseDefect::NotImplemented: return "NotImplemented";
    case ProseDefect::DeveloperNoun:  return "DeveloperNoun";
    case ProseDefect::SourceLocation: return "SourceLocation";
    case ProseDefect::MachineIdentifier:   return "MachineIdentifier";
    case ProseDefect::DeveloperVocabulary: return "DeveloperVocabulary";
  }
  return "Unknown";
}

std::vector<ProseFinding> scanUserFacingProse(const std::string& raw) {
  std::vector<ProseFinding> out;
  if (raw.empty()) return out;
  // ── ImGui's "##" ────────────────────────────────────────────────────────────
  // Everything from "##" onward is an IDENTITY, not a label: ImGui hashes it and
  // draws nothing. "##tree_rows" puts no characters on the screen, so it is not
  // prose and a rule that called it one would be wrong -- and a wrong rule is
  // the one that gets an exception written for it, then two, then it is off.
  // The part BEFORE the "##" is drawn and is scanned exactly as before, which is
  // what stops "Fillet##part.fillet" from becoming a hiding place.
  const std::size_t hash = raw.find("##");
  const std::string text = hash == std::string::npos ? raw : raw.substr(0, hash);
  if (text.empty()) return out;
  const std::string low = toLower(text);

  // A scope operator in running text is a C++ name. There is no second reading.
  std::size_t at = 0;
  while ((at = text.find("::", at)) != std::string::npos) {
    std::size_t start = at;
    while (start > 0 && isWordChar(text[start - 1])) --start;
    // Walk the WHOLE qualified name, so "forge::ui::DockLayout" is reported once
    // as itself rather than twice as two overlapping halves. A finding a reader
    // has to reassemble is a finding they will misread.
    std::size_t end = at;
    while (end + 1 < text.size() && text[end] == ':' && text[end + 1] == ':') {
      end += 2;
      while (end < text.size() && isWordChar(text[end])) ++end;
    }
    out.push_back(ProseFinding{ProseDefect::CppScope, text.substr(start, end - start), start});
    at = end;
  }

  findPhrases(low, text, ProseDefect::LibraryName, kLibraryNames,
              sizeof(kLibraryNames) / sizeof(kLibraryNames[0]), out);
  findPhrases(low, text, ProseDefect::NotImplemented, kNotImplemented,
              sizeof(kNotImplemented) / sizeof(kNotImplemented[0]), out);
  findPhrases(low, text, ProseDefect::DeveloperNoun, kDeveloperNouns,
              sizeof(kDeveloperNouns) / sizeof(kDeveloperNouns[0]), out);
  findPhrases(low, text, ProseDefect::DeveloperVocabulary, kDeveloperVocabulary,
              sizeof(kDeveloperVocabulary) / sizeof(kDeveloperVocabulary[0]), out);
  scanTokens(text, out);
  scanDottedIdentifiers(text, out);
  scanSourceLocations(low, text, out);

  std::sort(out.begin(), out.end(), [](const ProseFinding& a, const ProseFinding& b) {
    if (a.offset != b.offset) return a.offset < b.offset;
    return static_cast<int>(a.defect) < static_cast<int>(b.defect);
  });
  return out;
}

bool userFacingProseIsClean(const std::string& text) {
  return scanUserFacingProse(text).empty();
}

std::string describeProseFindings(const std::vector<ProseFinding>& findings) {
  std::string out;
  for (const ProseFinding& f : findings) {
    if (!out.empty()) out += "; ";
    out += "\"" + f.match + "\" [";
    out += toString(f.defect);
    out += "]";
  }
  return out;
}

const char* userFacingDetailPointer() noexcept {
  return "The Console panel has the technical detail.";
}

namespace {

// Does the internal detail mention this? Case-insensitive substring, because the
// detail is a machine's sentence and its shape is not guaranteed.
bool mentions(const std::string& lowerDetail, const char* needle) {
  return lowerDetail.find(needle) != std::string::npos;
}

}  // namespace

std::string userFacingBuildFailure(const std::string& detail) {
  // Nothing went wrong and nothing is being explained. Returning a sentence here
  // would put an error in front of a user who does not have one.
  if (detail.empty()) return std::string();
  const std::string d = toLower(detail);

  if (mentions(d, "parse failed") || mentions(d, "unknown op") || mentions(d, "syntax")) {
    return "Forge could not read this part's history of features, so nothing was rebuilt. "
           "The part on screen is the last one that built. " +
           std::string(userFacingDetailPointer());
  }
  if (mentions(d, "timed out") || mentions(d, "deadline") || mentions(d, "timeout") ||
      mentions(d, "killed") || mentions(d, "worker") || mentions(d, "crashed") ||
      mentions(d, "signal")) {
    return "The modelling engine stopped responding and was restarted. Your part is unchanged "
           "and the shape on screen is the last one that built. Try the operation again, or "
           "simplify it if it repeats. " +
           std::string(userFacingDetailPointer());
  }
  if (mentions(d, "tessellate") || mentions(d, "no triangles") || mentions(d, "de-index")) {
    return "Forge rebuilt this part but could not draw it. The shape on screen is the last one "
           "that could be drawn. " +
           std::string(userFacingDetailPointer());
  }
  if (mentions(d, "no solid") || mentions(d, "compile") || mentions(d, "boolean") ||
      mentions(d, "fillet") || mentions(d, "shell")) {
    return "This operation could not be applied to the current shape, so the part was left as "
           "it was. Try a smaller value, or a different face or edge. " +
           std::string(userFacingDetailPointer());
  }
  return "Forge could not rebuild this part. The shape on screen is the last one that built, "
         "and nothing you have drawn has been lost. " +
         std::string(userFacingDetailPointer());
}

std::string userFacingViewportFailure(const std::string& detail) {
  const std::string d = toLower(detail);
  if (mentions(d, "memory") || mentions(d, "allocate")) {
    return "The 3D view ran out of graphics memory. Close other 3D applications and reopen this "
           "part. Everything else in Forge still works.";
  }
  if (mentions(d, "no ") && mentions(d, "device")) {
    return "Forge could not find a graphics card it can draw 3D with, so the 3D view is empty. "
           "The rest of the application still works, and your part is safe.";
  }
  if (detail.empty()) {
    return "The 3D view is not ready yet.";
  }
  return "Forge could not draw the 3D view on this computer's graphics hardware. The rest of the "
         "application still works, and your part is safe.";
}

std::string userFacingStartupFailure(const std::string& stage, const std::string& detail) {
  const std::string s = toLower(stage) + " " + toLower(detail);
  if (mentions(s, "window") || mentions(s, "display") || mentions(s, "video")) {
    return "Forge could not open its window on this display. Check that a display is connected "
           "and that Forge is allowed to open windows, then try again.";
  }
  if (mentions(s, "graphic") || mentions(s, "gpu") || mentions(s, "device") ||
      mentions(s, "surface") || mentions(s, "swapchain") || mentions(s, "renderer")) {
    return "Forge could not start because it could not use this computer's graphics hardware. "
           "Update the graphics drivers, or start Forge on a machine with a supported graphics "
           "card.";
  }
  return "Forge could not finish starting up. Try starting it again; if it keeps happening, "
         "send the startup log to support.";
}

}  // namespace forge::ui
