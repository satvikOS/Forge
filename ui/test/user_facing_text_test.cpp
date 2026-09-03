// ui/test/user_facing_text_test.cpp — WHAT A USER IS ALLOWED TO READ.
//
// THE DEFECT, VERBATIM, FROM A SHIPPED BUILD:
//
//   Panel "mates" is docked and laid out by forge::ui::DockLayout, and its
//   position, tab order and active tab persist across restart. Its content is
//   not implemented in this segment.
//
// and, on the failure path, straight out of an exception handler and into the
// panel and the activity log:
//
//   parse failed: a non-std exception escaped forge::ft::parse
//
// and, from Dear ImGui's own error recovery, in a red popup over the user's
// model: "Programmer error: N visible items with conflicting ID!".
//
// ── WHY A PROSE RULE IS NOT ENOUGH ──────────────────────────────────────────
// "Do not show developers' words to users" is a rule with no failing case. Every
// engineer who typed one of the strings above agreed with the rule at the time.
// So this is not a rule, it is a gate, and it is built so that PROSE CANNOT
// SATISFY IT: it reads the shipped sources as DATA, extracts the strings that
// actually reach a text-drawing call, and runs them through
// forge::ui::scanUserFacingProse() -- the same function the application links.
//
// SIX CHECKS, and the FIRST one is the falsifiability proof:
//
//   A. the scanner FIRES. A corpus of known-bad strings must each be caught by
//      the expected class, and a corpus of real CAD prose must be silent. Skip
//      this and every check below could be a scanner that returns {} always.
//   B. every panel the shipped layouts define has a name and a purpose, and both
//      are clean.
//   C. the catalogue's Live/Planned claim MATCHES the frame builder's own
//      dispatch, read out of forge-desktop/src/ForgeFrame.cpp.
//   D. every string literal that reaches an ImGui text call in forge-desktop/src
//      is clean.
//   E. no raw internal-detail accessor (scene_.error(), backend(), diagnostic())
//      is passed to an ImGui text call. That is check D's blind spot: the
//      literal at such a call is "%s", which is clean, and the leak arrives at
//      run time.
//   F. every string the LIVE command surface produces -- label, hint, reason,
//      group title -- is clean, enumerated from the registry, not scanned; and
//      so is every REFUSAL the op-constraint bridge writes, because
//      OpRuling::reason is copied to PlanStepVerdict::reason and DRAWN, per step,
//      in the Archie CoPilot panel. That path is how "the modelling engine
//      accepts 2-n" used to read "forge::ft::compile accepts 2-n" IN THE PANEL.
//   G. the translators do not echo their input: fed every internal failure
//      string this repository actually produces, their output is clean AND does
//      not contain the detail.
//   H. the ACTIVITY LOG'S MESSAGE. log().info/warning/error take (source,
//      message, detail); the MESSAGE is drawn in the Console panel and in the
//      status strip, the detail is the one engineer surface. Check D scanned
//      neither, because a log call is not a text-drawing call -- which is how
//      "an OCCT fault loses that operation" sat in ForgeFrame.cpp, in a file
//      this gate already read, and passed.
//   I. NO MACHINE NAME AT A SINK. machineName(DispatchStatus) and its two
//      siblings return the wire spelling ("selection_signature_mismatch"); they
//      are named so that this check can forbid them, by name, inside a call that
//      draws text -- along with the descriptor fields that are identifiers
//      (commandId, featureIrOp, parameters, the raw IR of a statement).
//   J. EVERY userText() ENUMERATOR is clean, and every one of them differs from
//      its machineName() twin. A userText that forwarded to machineName would
//      satisfy every other check in this file.
//   K. THE RUNTIME SENTENCES, over the whole cross-product: explainUnavailable
//      for every registered command x every DispatchStatus, every ToolCatalog
//      reason, every selection description, every signature phrase, the empty
//      state, the samples, and the CoPilot's transcript.
//
// ── WHY THE FIRST VERSION OF THIS GATE PASSED OVER A LIVE LEAK ─────────────
// It was not a reachability failure. Check F scanned `item.reason` BY NAME on
// every shipped command, and on 51 of the 84 that field read
//
//     selection_signature_mismatch: 1..n edge (homogeneous)
//
// on the menu tooltip, in every panel's command list and in the Tools panel. The
// SCANNER could not see it. Its only positive detectors were (a) the "::"
// operator, (b) a fixed list of debugger nouns and library names, and (c) three
// identifier SHAPES that every one require an underscore joining two DIFFERENT
// cases, or a "vk" prefix. An all-lower-case snake_case identifier matched none
// of them; neither did a bare CamelCase class name ("LocalPlanner", drawn in the
// CoPilot panel's header); neither did a dotted command id ("part.fillet", drawn
// on every palette row); and neither did a sentence built entirely out of
// ordinary English words that names the program's own machinery -- "its enabled
// predicate refused the current parameters", "registered with no handler",
// "id: %s  IR: %s  parameters: %s".
//
// ProseDefect::MachineIdentifier and ProseDefect::DeveloperVocabulary are those
// four shapes. Check A now pins each of them with an example taken from the
// shipped build.
//
// forge-desktop/src is read, not compiled: run_ui.sh builds ui/ only, and the
// application's own sources are checked for TYPE by
// forge-desktop/test/run_syntax_gate.sh. Reading them here is what makes this
// gate cheap enough to run on every push.
#include <algorithm>
#include <cstddef>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/CommandSurface.hpp"
#include "forge/ui/DockLayout.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/PanelCatalog.hpp"
#include "forge/ui/PanelFocus.hpp"
#include "forge/ui/ArchieCopilot.hpp"
#include "forge/ui/Onboarding.hpp"
#include "forge/ui/OpConstraintBridge.hpp"
#include "forge/ui/StatusModel.hpp"
#include "forge/ui/ToolCatalog.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/UserFacingText.hpp"
#include "forge/ui/WorkspaceProfile.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;

namespace {

// ── reading the application's sources as data ───────────────────────────────

std::string repoRoot() {
#ifdef FORGE_UI_REPO_ROOT
  return std::string(FORGE_UI_REPO_ROOT);
#else
  return std::string(".");
#endif
}

std::string readFile(const std::string& path, bool& ok) {
  std::ifstream in(path);
  if (!in.good()) { ok = false; return std::string(); }
  std::ostringstream ss;
  ss << in.rdbuf();
  ok = true;
  return ss.str();
}

// One piece of a source file, comments already gone.
struct Piece {
  bool isString = false;
  std::string text;    // code, or the DECODED contents of a string literal
  std::size_t line = 1;
};

// A real lexer, not a regex. `//` inside a string literal is not a comment, a
// string literal inside a comment is not a string, and getting either backwards
// makes this gate scan something other than the program. bash-and-grep is how
// the placeholder survived a dozen greps in the first place.
std::vector<Piece> lex(const std::string& src) {
  std::vector<Piece> out;
  std::string code;
  std::size_t line = 1;
  std::size_t codeLine = 1;
  const std::size_t n = src.size();
  std::size_t i = 0;
  auto flushCode = [&]() {
    if (!code.empty()) { out.push_back(Piece{false, code, codeLine}); code.clear(); }
    codeLine = line;
  };
  while (i < n) {
    const char c = src[i];
    if (c == '\n') { ++line; code += c; ++i; continue; }
    if (c == '/' && i + 1 < n && src[i + 1] == '/') {
      while (i < n && src[i] != '\n') ++i;
      continue;
    }
    if (c == '/' && i + 1 < n && src[i + 1] == '*') {
      i += 2;
      while (i + 1 < n && !(src[i] == '*' && src[i + 1] == '/')) { if (src[i] == '\n') ++line; ++i; }
      i = i + 2 <= n ? i + 2 : n;
      continue;
    }
    if (c == '\'') {  // a character literal: skip it, it holds no prose
      code += c; ++i;
      while (i < n && src[i] != '\'') { if (src[i] == '\\') ++i; ++i; }
      if (i < n) { code += src[i]; ++i; }
      continue;
    }
    if (c == '"') {
      flushCode();
      const std::size_t startLine = line;
      std::string lit;
      ++i;
      while (i < n && src[i] != '"') {
        if (src[i] == '\\' && i + 1 < n) {
          const char e = src[i + 1];
          if (e == 'n' || e == 't') lit += ' ';
          else if (e == '"') lit += '"';
          else if (e == '\\') lit += '\\';
          i += 2;
          continue;
        }
        if (src[i] == '\n') ++line;
        lit += src[i];
        ++i;
      }
      if (i < n) ++i;
      out.push_back(Piece{true, lit, startLine});
      codeLine = line;
      continue;
    }
    code += c;
    ++i;
  }
  flushCode();
  return out;
}

// Every ImGui call that puts characters on the screen. A widget whose first
// argument is a LABEL the user reads is in this list; one whose first argument
// is only an identity ("##body") is too, and its "##"-prefixed ids are simply
// clean.
const char* const kTextSinks[] = {
    "Text",        "TextColored",  "TextWrapped",   "TextDisabled",  "TextUnformatted",
    "BulletText",  "LabelText",    "SetTooltip",    "SetItemTooltip", "Button",
    "SmallButton", "MenuItem",     "Selectable",    "RadioButton",   "Checkbox",
    "InputText",   "InputTextWithHint", "SliderFloat", "DragFloat",  "BeginMenu",
    "Begin",       "BeginChild",   "BeginCombo",    "BeginTooltip",  "CollapsingHeader",
    "TreeNode",    "OpenPopup",    "BeginPopupModal",
};

// A member that returns the PROGRAM's own description of a failure. Useful in a
// log, never in a sentence a user reads. Listed here so check E can find one
// where check D cannot: the literal at `TextWrapped("%s", scene_.error().c_str())`
// is "%s", which is perfectly clean, and the leak arrives at run time.
//
// By MEMBER NAME, not by spelling. The first draft of this list held four exact
// expressions -- "scene_.error()", "viewport.error()" and two more -- and would
// have been silent on `r.error.c_str()`, which is the properties panel and was
// one of the four real leaks in the build this gate was written against. A list
// of the call sites somebody remembered is the same census failure the app
// surface gate already learned once.
const char* const kInternalDetailMembers[] = {
    // A member that returns the program's own description of a failure...
    "error", "backend", "diagnostic", "what",
    // ...and `detail`, which is the SAME thing under the name the dispatcher
    // gives it. DispatchResult::detail carried "1..n edge (homogeneous)" and the
    // command's own id, and it was handed to note() -- a text sink this file
    // already knew about -- from two places in ForgeFrame.cpp. It was not on
    // this list, so check E was silent at a call site it was reading.
    "detail",
};

// EXPRESSIONS THAT ARE NAMES, at a call that draws text.
//
// Check D reads the LITERAL at a sink and check E reads one class of runtime
// value. Neither could see the third thing a sink is handed: a field of a
// descriptor, a record or a verdict whose value is an IDENTIFIER. The menu
// tooltip's literal was "%s\nid: %s\nneeds: %s\nIR: %s\nparameters: %s" --
// which is clean, and which drew "part.fillet", "FILLET" and
// "radius:number*=3" on every command in the application.
//
// Matched as written, including the "." or "->", so a local named `parameters`
// is not the same thing as `item.parameters`.
const char* const kMachineExpressions[] = {
    ".commandId",   "->commandId",   ".featureIrOp", "->featureIrOp",
    ".parameters",  "->parameters",  ".irOp",        "->irOp",
    ".line.text()", "->line.text()", ".line.op",     "->line.op",
    ".persistentName", "->persistentName",
    "machineName(",
};

// The ONE surface allowed to draw a machine name, and the one line of it.
//
// The Console panel's detail column is dimmed, sits under the sentence, and is
// where every other surface in this application tells the user the technical
// detail is. Carving it out BY FUNCTION NAME rather than by a magic comment
// means the exemption is one place, is named, and shows up in a grep for the
// function.
const char kDetailSurface[] = "ForgeFrame::drawConsolePanel";

// True when `code` reads one of those members off something. Requires the name
// to END there: `.errorCount` and `.whatever` are not failure text.
// Where a translator call opens and closes. Reading the detail INSIDE one is
// the correct pattern -- userFacingBuildFailure(scene_.error()) is the fix, not
// the defect -- and a rule that could not tell the two apart would forbid the
// remedy it exists to require.
std::vector<std::pair<std::size_t, std::size_t>> translatorSpans(const std::string& code) {
  std::vector<std::pair<std::size_t, std::size_t>> spans;
  std::size_t at = 0;
  while ((at = code.find("userFacing", at)) != std::string::npos) {
    const std::size_t open = code.find('(', at);
    if (open == std::string::npos) break;
    int depth = 0;
    std::size_t k = open;
    for (; k < code.size(); ++k) {
      if (code[k] == '(') ++depth;
      else if (code[k] == ')') {
        --depth;
        if (depth == 0) break;
      }
    }
    spans.emplace_back(at, k < code.size() ? k : code.size());
    at = open + 1;
  }
  return spans;
}

bool readsInternalDetail(const std::string& code, std::string& which) {
  const std::vector<std::pair<std::size_t, std::size_t>> safe = translatorSpans(code);
  auto insideTranslator = [&safe](std::size_t offset) {
    for (const std::pair<std::size_t, std::size_t>& span : safe) {
      if (offset >= span.first && offset <= span.second) return true;
    }
    return false;
  };
  for (const char* member : kInternalDetailMembers) {
    const std::string name = member;
    for (const char* op : {".", "->"}) {
      const std::string needle = std::string(op) + name;
      std::size_t at = 0;
      while ((at = code.find(needle, at)) != std::string::npos) {
        const std::size_t after = at + needle.size();
        const bool ends = after >= code.size() ||
                          !((code[after] >= 'A' && code[after] <= 'Z') ||
                            (code[after] >= 'a' && code[after] <= 'z') ||
                            (code[after] >= '0' && code[after] <= '9') || code[after] == '_');
        if (ends && !insideTranslator(at)) { which = needle; return true; }
        at = after;
      }
    }
  }
  return false;
}

struct SinkCall {
  std::string sink;
  std::size_t line = 1;
  std::vector<std::string> literals;
  std::string code;   // the non-literal text of the call, for check E
};

// Finds `ImGui::<sink>(` in the lexed stream and collects everything up to the
// matching `)`, literals and code separately.
std::vector<SinkCall> findSinkCalls(const std::vector<Piece>& pieces) {
  std::vector<SinkCall> calls;
  for (std::size_t p = 0; p < pieces.size(); ++p) {
    if (pieces[p].isString) continue;
    const std::string& code = pieces[p].text;
    std::size_t at = 0;
    while ((at = code.find("ImGui::", at)) != std::string::npos) {
      const std::size_t nameStart = at + 7;
      std::size_t nameEnd = nameStart;
      while (nameEnd < code.size() &&
             ((code[nameEnd] >= 'A' && code[nameEnd] <= 'Z') ||
              (code[nameEnd] >= 'a' && code[nameEnd] <= 'z') ||
              (code[nameEnd] >= '0' && code[nameEnd] <= '9') || code[nameEnd] == '_')) {
        ++nameEnd;
      }
      const std::string name = code.substr(nameStart, nameEnd - nameStart);
      bool isSink = false;
      for (const char* s : kTextSinks) {
        if (name == s) { isSink = true; break; }
      }
      if (!isSink || nameEnd >= code.size() || code[nameEnd] != '(') { at = nameEnd; continue; }

      // Count the line the call starts on, then walk the argument list across
      // pieces until the parenthesis that opened it closes.
      std::size_t line = pieces[p].line;
      for (std::size_t k = 0; k < at; ++k) {
        if (code[k] == '\n') ++line;
      }
      SinkCall call;
      call.sink = name;
      call.line = line;
      int depth = 0;
      std::size_t q = p;
      std::size_t cursor = nameEnd;
      bool closed = false;
      while (q < pieces.size() && !closed) {
        if (pieces[q].isString) {
          if (depth > 0) call.literals.push_back(pieces[q].text);
          ++q;
          cursor = 0;
          continue;
        }
        const std::string& c2 = pieces[q].text;
        for (std::size_t k = cursor; k < c2.size(); ++k) {
          if (c2[k] == '(') ++depth;
          else if (c2[k] == ')') {
            --depth;
            if (depth == 0) { call.code += c2.substr(cursor, k - cursor); closed = true; break; }
          }
          if (depth > 0 && k + 1 == c2.size()) call.code += c2.substr(cursor);
        }
        if (!closed) { ++q; cursor = 0; }
      }
      calls.push_back(std::move(call));
      at = nameEnd;
    }

    // ForgeFrame::note() is a text sink with no ImGui in its name at all: the
    // string it is handed becomes ForgeFrame::status_, which the STATUS STRIP
    // draws every frame, and it lands in the Console panel's frame notes. The
    // line it used to be handed was
    //     "kernel body UNAVAILABLE: " + scene_.error()
    // -- the kernel's exception text, in the status bar, on startup.
    //
    // It takes exactly one argument, so there is no argument-position rule to
    // get wrong here. The activity log's three-argument form is deliberately NOT
    // treated this way: its THIRD argument is the technical detail and is meant
    // to carry exactly what this check forbids everywhere else.
    at = 0;
    while ((at = code.find("note(", at)) != std::string::npos) {
      const bool ownWord = at == 0 || !((code[at - 1] >= 'A' && code[at - 1] <= 'Z') ||
                                        (code[at - 1] >= 'a' && code[at - 1] <= 'z') ||
                                        (code[at - 1] >= '0' && code[at - 1] <= '9') ||
                                        code[at - 1] == '_');
      if (!ownWord) { at += 5; continue; }
      std::size_t line = pieces[p].line;
      for (std::size_t k = 0; k < at; ++k) {
        if (code[k] == '\n') ++line;
      }
      SinkCall call;
      call.sink = "note";
      call.line = line;
      int depth = 0;
      std::size_t q = p;
      std::size_t cursor = at + 4;  // the '(' itself
      bool closed = false;
      while (q < pieces.size() && !closed) {
        if (pieces[q].isString) {
          if (depth > 0) call.literals.push_back(pieces[q].text);
          ++q;
          cursor = 0;
          continue;
        }
        const std::string& c2 = pieces[q].text;
        for (std::size_t k = cursor; k < c2.size(); ++k) {
          if (c2[k] == '(') ++depth;
          else if (c2[k] == ')') {
            --depth;
            if (depth == 0) { call.code += c2.substr(cursor, k - cursor); closed = true; break; }
          }
          if (depth > 0 && k + 1 == c2.size()) call.code += c2.substr(cursor);
        }
        if (!closed) { ++q; cursor = 0; }
      }
      calls.push_back(std::move(call));
      at += 5;
    }

    // ImDrawList::AddText is a text sink that is NOT reached through ImGui::,
    // and the viewport's failure banner -- the red sentence drawn straight over
    // the user's model -- was one of them. A sink list that only knows one
    // spelling of "draw some text" is a list with a hole in exactly the place
    // the most prominent message in the application lives.
    at = 0;
    while ((at = code.find("AddText(", at)) != std::string::npos) {
      const bool qualified = at > 0 && (code[at - 1] == '.' || code[at - 1] == '>');
      if (!qualified) { at += 8; continue; }
      std::size_t line = pieces[p].line;
      for (std::size_t k = 0; k < at; ++k) {
        if (code[k] == '\n') ++line;
      }
      SinkCall call;
      call.sink = "AddText";
      call.line = line;
      int depth = 0;
      std::size_t q = p;
      std::size_t cursor = at + 7;  // the '(' itself
      bool closed = false;
      while (q < pieces.size() && !closed) {
        if (pieces[q].isString) {
          if (depth > 0) call.literals.push_back(pieces[q].text);
          ++q;
          cursor = 0;
          continue;
        }
        const std::string& c2 = pieces[q].text;
        for (std::size_t k = cursor; k < c2.size(); ++k) {
          if (c2[k] == '(') ++depth;
          else if (c2[k] == ')') {
            --depth;
            if (depth == 0) { call.code += c2.substr(cursor, k - cursor); closed = true; break; }
          }
          if (depth > 0 && k + 1 == c2.size()) call.code += c2.substr(cursor);
        }
        if (!closed) { ++q; cursor = 0; }
      }
      calls.push_back(std::move(call));
      at += 8;
    }
  }
  return calls;
}

// ── the activity log's MESSAGE argument ─────────────────────────────────────
//
// log().info(source, message, detail) — argument 1 is DRAWN (Console panel, and
// the status strip when it is the worst entry); argument 2 is the one engineer
// surface in this application and is deliberately NOT scanned. A gate that read
// all three would forbid the remedy it exists to require.
//
// This is a separate walker from findSinkCalls because it needs the ARGUMENT
// POSITION, which a sink call does not: a sink's literals are all drawn.
struct LogCall {
  std::string method;
  std::size_t line = 1;
  std::vector<std::string> messageLiterals;
};

std::vector<LogCall> findLogCalls(const std::vector<Piece>& pieces) {
  struct Spec { const char* name; std::size_t messageArg; };
  const Spec kSpecs[] = {{"info", 1}, {"warning", 1}, {"error", 1}, {"add", 2}};
  std::vector<LogCall> calls;
  for (std::size_t p = 0; p < pieces.size(); ++p) {
    if (pieces[p].isString) continue;
    const std::string& code = pieces[p].text;
    for (const Spec& spec : kSpecs) {
      const std::string name = spec.name;
      std::size_t at = 0;
      while ((at = code.find(name + "(", at)) != std::string::npos) {
        // A METHOD call, not a free function: `log_.info(` / `log().info(`.
        const bool qualified = at > 0 && (code[at - 1] == '.' || code[at - 1] == '>');
        if (!qualified) { at += name.size(); continue; }
        std::size_t line = pieces[p].line;
        for (std::size_t k = 0; k < at; ++k) {
          if (code[k] == '\n') ++line;
        }
        LogCall call;
        call.method = name;
        call.line = line;
        int depth = 0;
        std::size_t argIndex = 0;
        std::size_t q = p;
        std::size_t cursor = at + name.size();
        bool closed = false;
        while (q < pieces.size() && !closed) {
          if (pieces[q].isString) {
            if (depth > 0 && argIndex == spec.messageArg) {
              call.messageLiterals.push_back(pieces[q].text);
            }
            ++q;
            cursor = 0;
            continue;
          }
          const std::string& c2 = pieces[q].text;
          for (std::size_t k = cursor; k < c2.size(); ++k) {
            if (c2[k] == '(' || c2[k] == '[' || c2[k] == '{') ++depth;
            else if (c2[k] == ')' || c2[k] == ']' || c2[k] == '}') {
              --depth;
              if (depth == 0) { closed = true; break; }
            } else if (c2[k] == ',' && depth == 1) {
              ++argIndex;
            }
          }
          if (!closed) { ++q; cursor = 0; }
        }
        calls.push_back(std::move(call));
        at += name.size();
      }
    }
  }
  return calls;
}

// First and last line of one function's body, so a check can ask WHERE a call
// is. Used for exactly one carve-out — see kDetailSurface.
bool functionLineRange(const std::vector<Piece>& pieces, const std::string& signature,
                       std::size_t& first, std::size_t& last) {
  int depth = 0;
  bool inside = false;
  for (std::size_t p = 0; p < pieces.size(); ++p) {
    if (!inside) {
      if (pieces[p].isString) continue;
      const std::size_t at = pieces[p].text.find(signature);
      if (at == std::string::npos) continue;
      inside = true;
      first = pieces[p].line;
      for (std::size_t k = 0; k < at; ++k) {
        if (pieces[p].text[k] == '\n') ++first;
      }
      std::size_t line = first;
      for (std::size_t k = at; k < pieces[p].text.size(); ++k) {
        if (pieces[p].text[k] == '\n') ++line;
        if (pieces[p].text[k] == '{') ++depth;
        else if (pieces[p].text[k] == '}') {
          --depth;
          if (depth == 0) { last = line; return true; }
        }
      }
      continue;
    }
    if (pieces[p].isString) continue;
    std::size_t line = pieces[p].line;
    for (char c : pieces[p].text) {
      if (c == '\n') ++line;
      if (c == '{') ++depth;
      else if (c == '}') {
        --depth;
        if (depth == 0) { last = line; return true; }
      }
    }
  }
  return false;
}

// Every .cpp and .hpp under a directory, sorted. THE LIST IS THE FILESYSTEM, not
// a list somebody remembered to extend.
//
// MEASURED, so the claim is the right size: check D used to name four files by
// hand; forge-desktop/src holds 28. Of those 28, exactly TWO hold a call that
// puts characters on a user's screen today -- ForgeFrame.cpp and main.cpp -- and
// the four-name list had both. It also listed two files with no text call in
// them at all. So this is a LATENT hole, not a live one: no leak was hiding
// behind it, and the next text call added to any of the other 24 files would
// have been unscanned. Mutation 12 puts one there.
std::vector<std::string> sourcesUnder(const std::string& dir) {
  std::vector<std::string> out;
  std::error_code ec;
  for (std::filesystem::recursive_directory_iterator it(dir, ec), end; it != end; it.increment(ec)) {
    if (ec) break;
    if (!it->is_regular_file()) continue;
    const std::string ext = it->path().extension().string();
    if (ext != ".cpp" && ext != ".hpp") continue;
    out.push_back(it->path().string());
  }
  std::sort(out.begin(), out.end());
  return out;
}

// The body of one function, as pieces, for check C.
std::vector<Piece> functionBody(const std::vector<Piece>& pieces, const std::string& signature,
                                bool& found) {
  found = false;
  std::vector<Piece> body;
  int depth = 0;
  bool inside = false;
  for (std::size_t p = 0; p < pieces.size(); ++p) {
    if (!inside) {
      if (pieces[p].isString) continue;
      const std::size_t at = pieces[p].text.find(signature);
      if (at == std::string::npos) continue;
      inside = true;
      found = true;
      for (std::size_t k = at; k < pieces[p].text.size(); ++k) {
        if (pieces[p].text[k] == '{') ++depth;
        else if (pieces[p].text[k] == '}') {
          --depth;
          if (depth == 0) return body;
        }
        if (depth > 0) body.push_back(Piece{false, std::string(1, pieces[p].text[k]), pieces[p].line});
      }
      continue;
    }
    if (pieces[p].isString) { body.push_back(pieces[p]); continue; }
    for (std::size_t k = 0; k < pieces[p].text.size(); ++k) {
      if (pieces[p].text[k] == '{') ++depth;
      else if (pieces[p].text[k] == '}') {
        --depth;
        if (depth == 0) return body;
      }
      body.push_back(Piece{false, std::string(1, pieces[p].text[k]), pieces[p].line});
    }
  }
  return body;
}

bool contains(const std::vector<std::string>& v, const std::string& s) {
  return std::find(v.begin(), v.end(), s) != v.end();
}

// The application registry, exactly as ForgeFrame::wirePartCommands() builds it.
struct App {
  ForgeShell shell;
  PartDocument document;
  UndoStack stack;
  App() { registerPartCommands(shell.registry(), document, stack); }
  SurfaceContext context() {
    SurfaceContext ctx;
    ctx.registry = &shell.registry();
    ctx.selection = &shell.selection();
    ctx.keymap = &shell.keymap();
    ctx.input = shell.inputProfile();
    return ctx;
  }
};

}  // namespace

int main() {
  forge::uitest::Harness H("user_facing_text");
  const std::string root = repoRoot();

  // ── A. the scanner fires ──────────────────────────────────────────────────
  // Every check below is an application of scanUserFacingProse(). If it returned
  // {} unconditionally they would all pass and the gate would be a decoration.
  {
    struct Bad { const char* text; ProseDefect want; };
    const Bad kBad[] = {
        {"Panel is docked and laid out by forge::ui::DockLayout.", ProseDefect::CppScope},
        {"the value is a std::string", ProseDefect::CppScope},
        {"could not initialise Vulkan on this device", ProseDefect::LibraryName},
        {"ImGui reported a problem", ProseDefect::LibraryName},
        {"SDL_Init failed", ProseDefect::ApiSymbol},
        {"vkCreateFramebuffer failed", ProseDefect::ApiSymbol},
        {"ImGui_ImplVulkan_AddTexture failed", ProseDefect::ApiSymbol},
        {"Its content is not implemented", ProseDefect::NotImplemented},
        {"TODO: wire this up", ProseDefect::NotImplemented},
        {"this is a placeholder panel", ProseDefect::NotImplemented},
        {"Programmer error: 3 visible items with conflicting ID", ProseDefect::DeveloperNoun},
        {"a non-std exception escaped the parser", ProseDefect::DeveloperNoun},
        {"content is not built in this segment", ProseDefect::DeveloperNoun},
        {"assertion failed while rebuilding", ProseDefect::DeveloperNoun},
        {"see ForgeFrame.cpp for the reason", ProseDefect::SourceLocation},
        // ── THE FOUR SHAPES THE FIRST SCANNER COULD NOT SEE ────────────────
        // Every one of these was on screen in the build this gate was written
        // against, and every one of them scanned CLEAN.
        {"selection_signature_mismatch: 1..n edge (homogeneous)",
         ProseDefect::MachineIdentifier},                                  // item.reason
        {"missing_required_parameter: path", ProseDefect::MachineIdentifier},
        {"planner: LocalPlanner (offline, deterministic)",
         ProseDefect::MachineIdentifier},                                  // CoPilot header
        {"Extrude  (part.extrude)", ProseDefect::MachineIdentifier},       // panel command list
        {"id: app.load_sample", ProseDefect::MachineIdentifier},           // menu tooltip
        {"the tool catalog did not produce an entry for it",
         ProseDefect::DeveloperVocabulary},
        {"its enabled predicate refused the current parameters",
         ProseDefect::DeveloperVocabulary},
        {"nothing in the registry answers to it", ProseDefect::DeveloperVocabulary},
        {"is registered with no handler", ProseDefect::DeveloperVocabulary},
        {"Edge Fillet — emits FILLET", ProseDefect::DeveloperVocabulary},
        {"ops 14 declared / 14 parsed / 14 compiled", ProseDefect::DeveloperVocabulary},
        {"(the document has no statements)", ProseDefect::DeveloperVocabulary},
        {"host transport", ProseDefect::DeveloperVocabulary},
        {"BOX: wrong arity -- 7 argument(s)", ProseDefect::DeveloperVocabulary},
    };
    for (const Bad& b : kBad) {
      const std::vector<ProseFinding> f = scanUserFacingProse(b.text);
      CHECK(!f.empty());
      bool sawWanted = false;
      for (const ProseFinding& x : f) {
        if (x.defect == b.want) sawWanted = true;
      }
      if (!sawWanted) {
        std::printf("  scanner missed %s in \"%s\" (found: %s)\n", toString(b.want), b.text,
                    describeProseFindings(f).c_str());
      }
      CHECK(sawWanted);
    }

    // And it must be SILENT on real CAD prose. A scanner that flags "segments"
    // on a mesh edge, or "Assembly", gets turned off, and a gate that is turned
    // off is not a gate.
    const char* const kGood[] = {
        "edges     12 recovered from 48 face-boundary segments",
        "volume    not defined: the mesh does not close",
        "The mates holding this assembly together, and how many ways each component can move.",
        "pick a feature row in the tree, then change its number",
        "Geometric tolerances on this drawing: flatness, position, runout and the rest.",
        "size      12.000 x 4.000 x 3.000 mm",
        "%s  (%s)",
        "##body",
        "distance and angle need exactly two faces",
        "Forge could not find a graphics card it can draw 3D with, so the 3D view is empty.",
        // The wider scanner's own false-positive corpus. Each of these WOULD be
        // caught by a lazier version of one of the two new rules, and each is
        // something a CAD application has to be able to say.
        "bracket.fpart",                       // a dotted word that is the USER'S file
        "untitled.fpart  *",
        "Opened /Users/anna/parts/housing.step  (14 features)",
        "Archie CoPilot",                      // a product name with an internal capital
        "Front", "Isometric", "Extrude", "Open Recent", "Command Palette",
        "##tree_rows",                         // an ImGui identity: drawn as nothing
        "Fillet##part.fillet",                 // ...and one carrying a real label
        "edges     12 recovered from 48 face-boundary segments",
        "closed surface, outward winding",     // the user's mesh, not the program
        "42 boundary, 0 non-manifold, 0 reversed edges",
        ("Edge Fillet needs one or more edges, all of the same kind; nothing selected is "
         "picked. Set the pick filter to edge and click one in the 3D view"),
        "peak stress 240 MPa",                 // "peak" is a reading, not a cache
        "the gate diameter is 2.5 mm",         // "gate" is a feature of a moulded part
        "12 segments",                         // a mesh edge really is made of segments
    };
    for (const char* g : kGood) {
      const std::vector<ProseFinding> f = scanUserFacingProse(g);
      if (!f.empty()) {
        std::printf("  FALSE POSITIVE on \"%s\": %s\n", g, describeProseFindings(f).c_str());
      }
      CHECK(f.empty());
    }
  }

  // ── B. every shipped panel has a name and a purpose, and both are clean ──
  const std::vector<PanelId> shipped = defaultLayoutPanelIds();
  {
    // 8 workspaces x 8 panels, deduplicated. A number, so a workspace that
    // silently loses its panels cannot pass this file by having nothing to check.
    CHECK(shipped.size() >= 40);
    for (const PanelId& id : shipped) {
      const PanelInfo* info = findPanelInfo(id);
      if (info == nullptr) {
        std::printf("  panel \"%s\" is in a default workspace and has NO catalogue entry\n",
                    id.c_str());
      }
      CHECK(info != nullptr);
      if (info == nullptr) continue;
      CHECK(!info->name.empty());
      CHECK_EQ_STR(info->name, panelDisplayName(id));
      // A purpose short enough to be a label is not a purpose.
      CHECK(info->purpose.size() >= 30);
      CHECK(!info->purpose.empty() && info->purpose.back() == '.');
      const std::vector<ProseFinding> pf = scanUserFacingProse(info->purpose);
      if (!pf.empty()) {
        std::printf("  panel \"%s\" purpose leaks: %s\n", id.c_str(),
                    describeProseFindings(pf).c_str());
      }
      CHECK(pf.empty());
      const std::vector<ProseFinding> nf = scanUserFacingProse(info->name);
      CHECK(nf.empty());
    }
    // Every panel a saved layout could name is also nameable. panelDisplayName
    // is total by construction; this pins that the catalogue never disagrees.
    for (const PanelInfo& info : panelCatalog()) {
      CHECK_EQ_STR(info.name, panelDisplayName(info.id));
    }
  }

  // ── C. the Live/Planned claim matches the frame builder ─────────────────
  const std::string framePath = root + "/forge-desktop/src/ForgeFrame.cpp";
  bool frameOk = false;
  const std::string frameSrc = readFile(framePath, frameOk);
  if (!frameOk) {
    std::printf("  cannot read %s -- the source-scanning checks cannot run\n", framePath.c_str());
  }
  CHECK(frameOk);
  std::vector<Piece> framePieces;
  if (frameOk) framePieces = lex(frameSrc);
  if (frameOk) {
    bool foundDispatch = false;
    const std::vector<Piece> body =
        functionBody(framePieces, "void ForgeFrame::drawPanel(", foundDispatch);
    CHECK(foundDispatch);
    std::vector<std::string> implemented;
    for (const Piece& piece : body) {
      if (piece.isString && !piece.text.empty()) implemented.push_back(piece.text);
    }
    // The dispatch's FIRST branch is isViewportPanel(panelId), whose rule is a
    // prefix and is therefore not a literal in the body. Mirrored here -- and
    // the mirror is pinned: if the predicate changes, this assertion fails and
    // asks for the mirror to be updated rather than silently disagreeing.
    const bool predicatePinned =
        frameSrc.find("return id.rfind(\"viewport_\", 0) == 0 || id == \"sheet_canvas\";") !=
        std::string::npos;
    if (!predicatePinned) {
      std::printf("  isViewportPanel() has changed; update the mirror in this gate\n");
    }
    CHECK(predicatePinned);
    auto drawnByFrame = [&](const std::string& id) {
      if (id.rfind("viewport_", 0) == 0 || id == "sheet_canvas") return true;
      return contains(implemented, id);
    };
    CHECK(implemented.size() >= 10);
    for (const PanelId& id : shipped) {
      const PanelInfo* info = findPanelInfo(id);
      if (info == nullptr) continue;
      const bool drawn = drawnByFrame(id);
      if (drawn != info->live()) {
        std::printf("  panel \"%s\": the catalogue says %s, the frame builder %s draw it\n",
                    id.c_str(), toString(info->content), drawn ? "DOES" : "does NOT");
      }
      CHECK_EQ_INT(drawn ? 1 : 0, info->live() ? 1 : 0);
    }
    // The census, printed so a reviewer reads a number rather than a promise.
    std::printf("[user_facing_text] %zu panels in the shipped workspaces, %zu still planned\n",
                shipped.size(), plannedPanelCount());
  }

  // ── D/E/H/I. what reaches a user surface, across the WHOLE application ──
  //
  // THE LIST IS THE DIRECTORY. This block used to name four files; there are 28.
  // Nothing was leaking from the other 24 on the day this was written -- see
  // sourcesUnder() for that measurement -- and the hazard is the shape of the
  // list, not what is behind it today: a gate whose coverage is a list somebody
  // remembered to extend has the same failure mode as the defect it checks for.
  {
    const std::vector<std::string> sources = sourcesUnder(root + "/forge-desktop/src");
    if (sources.size() < 12) {
      std::printf("  only %zu sources found under forge-desktop/src -- the walk is not working\n",
                  sources.size());
    }
    CHECK(sources.size() >= 12);
    std::size_t sinkCalls = 0;
    std::size_t sinkLiterals = 0;
    std::size_t logCalls = 0;
    std::size_t logLiterals = 0;
    for (const std::string& path : sources) {
      bool ok = false;
      const std::string src = readFile(path, ok);
      if (!ok) { std::printf("  cannot read %s\n", path.c_str()); }
      CHECK(ok);
      if (!ok) continue;
      const std::string rel = path.substr(root.size() + 1);
      const std::vector<Piece> pieces = lex(src);

      // The one carve-out, resolved per file: the Console panel's detail line.
      std::size_t detailFirst = 0;
      std::size_t detailLast = 0;
      const bool hasDetailSurface =
          functionLineRange(pieces, std::string("void ") + kDetailSurface + "(", detailFirst,
                            detailLast);

      const std::vector<SinkCall> calls = findSinkCalls(pieces);
      for (const SinkCall& call : calls) {
        ++sinkCalls;
        for (const std::string& lit : call.literals) {
          ++sinkLiterals;
          const std::vector<ProseFinding> f = scanUserFacingProse(lit);
          if (!f.empty()) {
            std::printf("  %s:%zu %s draws \"%s\"\n        %s\n", rel.c_str(), call.line,
                        call.sink.c_str(), lit.c_str(), describeProseFindings(f).c_str());
          }
          CHECK(f.empty());
        }
        const bool inDetailSurface =
            hasDetailSurface && call.line >= detailFirst && call.line <= detailLast;
        std::string which;
        const bool leaked = readsInternalDetail(call.code, which);
        if (leaked && !inDetailSurface) {
          std::printf("  %s:%zu %s is handed %s -- translate it with "
                      "forge::ui::userFacing*Failure() and log the detail instead\n",
                      rel.c_str(), call.line, call.sink.c_str(), which.c_str());
        }
        CHECK(leaked ? inDetailSurface : true);

        // ── I. a NAME where a sentence belongs ────────────────────────────
        for (const char* needle : kMachineExpressions) {
          const bool present = call.code.find(needle) != std::string::npos;
          if (present && !inDetailSurface) {
            std::printf("  %s:%zu %s draws %s -- that is an identifier, not a sentence. Use the "
                        "command's label, forge::ui::userText() or "
                        "forge::ui::featureDisplayName().\n",
                        rel.c_str(), call.line, call.sink.c_str(), needle);
          }
          CHECK(present ? inDetailSurface : true);
        }
      }

      // ── H. the activity log's MESSAGE ───────────────────────────────────
      for (const LogCall& call : findLogCalls(pieces)) {
        ++logCalls;
        for (const std::string& lit : call.messageLiterals) {
          ++logLiterals;
          const std::vector<ProseFinding> f = scanUserFacingProse(lit);
          if (!f.empty()) {
            std::printf("  %s:%zu log().%s writes \"%s\" as the MESSAGE -- the Console panel "
                        "draws it. Put this in the third argument, the detail.\n        %s\n",
                        rel.c_str(), call.line, call.method.c_str(), lit.c_str(),
                        describeProseFindings(f).c_str());
          }
          CHECK(f.empty());
        }
      }
    }
    // A scan that found nothing to scan is a scan that proves nothing.
    if (sinkCalls < 100) std::printf("  only %zu text calls found -- the lexer is not working\n",
                                     sinkCalls);
    CHECK(sinkCalls >= 100);
    CHECK(sinkLiterals >= 100);
    CHECK(logCalls >= 5);
    CHECK(logLiterals >= 5);
    std::printf("[user_facing_text] %zu sources, %zu text calls, %zu drawn literals, "
                "%zu log messages scanned\n",
                sources.size(), sinkCalls, sinkLiterals, logLiterals);
  }

  // ── F. the LIVE command surface ─────────────────────────────────────────
  {
    App app;
    std::size_t scanned = 0;
    for (WorkspaceProfile profile : allWorkspaceProfiles()) {
      const CommandSurface surface = buildRibbonSurface(app.context(), profile);
      for (const SurfaceGroup& group : surface.groups) {
        const std::vector<ProseFinding> tf = scanUserFacingProse(group.title);
        if (!tf.empty()) {
          std::printf("  group title \"%s\": %s\n", group.title.c_str(),
                      describeProseFindings(tf).c_str());
        }
        CHECK(tf.empty());
        ++scanned;
        for (const SurfaceItem& item : group.items) {
          // label, hint and reason -- the three fields a menu, a ribbon button
          // and the palette actually draw.
          //
          // `item.parameters` is DELIBERATELY NOT SCANNED, and saying so is the
          // point: it renders PARAMETER NAMES ("assertion:text=volume > 0"),
          // part.verify and part.surfcheck declare a parameter called
          // "assertion", and that word is on the DeveloperNoun list. Scanning
          // this field today would be red, and the fix is a rename that reaches
          // the generated op vocabulary, the op-constraint table and the app
          // surface manifest. That is a change worth making on its own and is
          // not smuggled into this one. It is recorded here rather than left as
          // an unexplained gap, because a gate that quietly skips a field is the
          // same silence this file exists to remove.
          const std::string fields[] = {item.label, item.hint, item.reason};
          for (const std::string& field : fields) {
            ++scanned;
            const std::vector<ProseFinding> f = scanUserFacingProse(field);
            if (!f.empty()) {
              std::printf("  command \"%s\" shows \"%s\": %s\n", item.commandId.c_str(),
                          field.c_str(), describeProseFindings(f).c_str());
            }
            CHECK(f.empty());
          }
        }
      }
    }
    CHECK(scanned >= 100);
    std::printf("[user_facing_text] %zu live surface strings scanned\n", scanned);
  }

  // ── F2. what the op-constraint bridge says when it refuses a step ────────
  // ArchieCopilot copies OpRuling::reason into PlanStepVerdict::reason and the
  // CoPilot panel draws it under the step. These are not gate diagnostics; they
  // are sentences in the shipped application, and every branch below was one.
  {
    const OpConstraintBridge bridge(generatedVocabulary());
    auto step = [](int id, const char* op, std::vector<IrArg> args, EntityKind sel,
                   std::size_t count) {
      ProposedOp p;
      p.line.id = id;
      p.line.op = op;
      p.line.args = std::move(args);
      p.selection = sel;
      p.selectionCount = count;
      return p;
    };
    // One proposal per refusal branch the bridge can take, plus the TOLERATED
    // note, which is written on an ACCEPTED ruling and shown just the same.
    const ProposedOp kProposals[] = {
        step(1, "SLOT", {IrArg::num(40), IrArg::num(12)}, EntityKind::None, 0),
        step(1, "FROBNICATE", {IrArg::num(1)}, EntityKind::None, 0),
        step(0, "RECT", {IrArg::num(40), IrArg::num(30)}, EntityKind::None, 0),
        step(2, "EXTRUDE", {IrArg::valueRef(1)}, EntityKind::None, 0),
        step(2, "EXTRUDE",
             {IrArg::valueRef(1), IrArg::num(10), IrArg::num(1), IrArg::num(2), IrArg::num(3),
              IrArg::num(4), IrArg::num(5), IrArg::num(6)},
             EntityKind::None, 0),
        step(2, "FILLET", {IrArg::valueRef(1), IrArg::num(3)}, EntityKind::Face, 1),
        step(2, "FILLET", {IrArg::valueRef(1), IrArg::num(3), IrArg::keyword("ALL")},
             EntityKind::None, 0),
        step(1, "RECT", {IrArg::num(40), IrArg::keyword("SLOT")}, EntityKind::None, 0),
        step(1, "POLY", {IrArg::points({}, 2)}, EntityKind::None, 0),
    };
    std::size_t reasons = 0;
    for (const ProposedOp& proposal : kProposals) {
      const OpRuling r = bridge.check(proposal);
      const std::string fields[] = {r.reason, r.tolerated};
      for (const std::string& field : fields) {
        if (field.empty()) continue;
        ++reasons;
        const std::vector<ProseFinding> f = scanUserFacingProse(field);
        if (!f.empty()) {
          std::printf("  the CoPilot would show \"%s\"\n        %s\n", field.c_str(),
                      describeProseFindings(f).c_str());
        }
        CHECK(f.empty());
      }
    }
    // A corpus that refused nothing would scan nothing and prove nothing.
    if (reasons < 5) std::printf("  only %zu refusals produced -- the corpus is not biting\n",
                                 reasons);
    CHECK(reasons >= 5);
    std::printf("[user_facing_text] %zu op-constraint refusals scanned\n", reasons);
  }

  // ── G. the translators do not echo their input ──────────────────────────
  {
    // Every internal failure string this repository actually produces on a path
    // that reaches a user, quoted from the sources. A translator that appended
    // its input would pass a hand-picked corpus and fail here.
    const char* const kInternalDetails[] = {
        "parse failed: a non-std exception escaped forge::ft::parse",
        "parse failed at line 12: unknown op SHELLL",
        "compile threw a non-std exception (an OCCT Standard_Failure)",
        "compile threw: Standard_ConstructionError",
        "tessellate failed: a non-std exception escaped forge::tessellate",
        "tessellate returned no triangles",
        "the kernel produced no solid",
        "the worker reported a failed build",
        "vkCreateFramebuffer failed",
        "ImGui_ImplVulkan_AddTexture failed",
        "vkAllocateMemory(vertex) failed",
        "no host-visible memory type for the vertex buffer",
        "SDL_Vulkan_CreateSurface: no MoltenVK ICD",
        "no VkPhysicalDevice",
        "forge::ui -> forge::ft -> forge-kernel (14 ops, 68 faces)",
        // Dear ImGui's own recoverable-error messages, quoted from
        // forge-desktop/third_party/imgui/imgui.cpp. These reach a user through
        // the error callback ImGuiErrorPolicy.cpp installs, so the sentence they
        // are turned into is scanned here with every other one.
        "Missing End()",
        "Missing PopID()",
        "Missing EndTable()",
        "Missing PopStyleVar()",
        "Missing EndChild()",
        "Missing TreePop()",
        "Missing EndDisabled()",
        "Missing EndMenuBar()",
        "Forgot to call ImGui::NewFrame()?",
        "Programmer error: 2 visible items with conflicting ID!",
        "",
    };
    for (const char* detail : kInternalDetails) {
      const std::string d = detail;
      const std::string sentences[] = {
          userFacingBuildFailure(d),
          userFacingViewportFailure(d),
          userFacingStartupFailure("swapchain", d),
          userFacingStartupFailure("window", d),
          userFacingInterfaceFailure(d),
      };
      for (const std::string& s : sentences) {
        const std::vector<ProseFinding> f = scanUserFacingProse(s);
        if (!f.empty()) {
          std::printf("  translating \"%s\" produced \"%s\": %s\n", detail, s.c_str(),
                      describeProseFindings(f).c_str());
        }
        CHECK(f.empty());
        // Not echoed. A clean-looking sentence with the raw cause glued on the
        // end is the same leak wearing a hat.
        const bool echoed = !d.empty() && s.find(d) != std::string::npos;
        CHECK(!echoed);
      }
      // An empty detail is not an error, and the build translator must not
      // invent one. Nor must the interface one: a recoverable error always
      // arrives with the library's message attached, so an empty detail means
      // nothing happened and a sentence would be an error the user does not have.
      if (d.empty()) {
        CHECK(userFacingBuildFailure(d).empty());
        CHECK(userFacingInterfaceFailure(d).empty());
      } else {
        CHECK(!userFacingBuildFailure(d).empty());
        CHECK(!userFacingInterfaceFailure(d).empty());
      }
    }
  }

  // ── J. every userText() enumerator, and it is not machineName in disguise ─
  //
  // Five of the enums in this layer have two spellings: the wire name a macro
  // stores and an agent reads, and the phrase a person reads. The whole scheme
  // rests on the second being different from the first, so that is asserted
  // rather than assumed -- a userText() that forwarded to machineName() would
  // satisfy every other check in this file, because every other check reads the
  // sentence these produce.
  {
    std::size_t pairs = 0;
    auto both = [&](const char* user, const char* machine) {
      const std::vector<ProseFinding> f = scanUserFacingProse(user);
      if (!f.empty()) {
        std::printf("  userText gives \"%s\": %s\n", user, describeProseFindings(f).c_str());
      }
      CHECK(f.empty());
      if (std::string(user) == std::string(machine)) {
        std::printf("  userText and machineName agree on \"%s\" -- one of them is not doing "
                    "its job\n", user);
      }
      CHECK(std::string(user) != std::string(machine));
      ++pairs;
    };
    for (DispatchStatus x : {DispatchStatus::Ok, DispatchStatus::UnknownCommand,
                             DispatchStatus::SelectionSignatureMismatch, DispatchStatus::Disabled,
                             DispatchStatus::MissingRequiredParameter, DispatchStatus::NoHandler,
                             DispatchStatus::EditRefused}) {
      both(userText(x), machineName(x));
    }
    for (int i = 0; i <= static_cast<int>(OpConstraint::MalformedArgumentValue); ++i) {
      const auto x = static_cast<OpConstraint>(i);
      both(userText(x), machineName(x));
    }
    for (int i = 0; i <= static_cast<int>(PlanCheck::OpConstraintRefused); ++i) {
      const auto x = static_cast<PlanCheck>(i);
      both(userText(x), machineName(x));
    }
    // EntityKind and the two profiles have no machineName(): their toString IS
    // the wire name (a selection signature is matched against it), so the pair
    // is toString/userText and the same two properties hold.
    for (int i = 0; i <= static_cast<int>(EntityKind::Any); ++i) {
      const auto k = static_cast<EntityKind>(i);
      const std::vector<ProseFinding> f = scanUserFacingProse(userText(k));
      if (!f.empty()) {
        std::printf("  userText(EntityKind) gives \"%s\": %s\n", userText(k),
                    describeProseFindings(f).c_str());
      }
      CHECK(f.empty());
      ++pairs;
    }
    for (WorkspaceProfile w : allWorkspaceProfiles()) {
      CHECK(scanUserFacingProse(userText(w)).empty());
      ++pairs;
    }
    for (InputProfile ip : allInputProfiles()) {
      CHECK(scanUserFacingProse(userText(ip)).empty());
      ++pairs;
    }
    CHECK(pairs >= 40);
    std::printf("[user_facing_text] %zu enum spellings checked\n", pairs);
  }

  // ── K. THE RUNTIME SENTENCES, over the whole cross-product ───────────────
  //
  // Checks B and F enumerate a surface. This one enumerates the FUNCTIONS that
  // build what those surfaces show, over every input the shipped application can
  // hand them: every registered command against every DispatchStatus, every
  // catalogue row, every selection shape, the empty state and the samples. The
  // leak this gate was rewritten for -- "selection_signature_mismatch: 1..n edge
  // (homogeneous)" -- lived in exactly one of these functions, and reached three
  // separate surfaces from there.
  {
    App app;
    std::size_t sentences = 0;
    auto expect = [&](const char* what, const std::string& text) {
      if (text.empty()) return;
      ++sentences;
      const std::vector<ProseFinding> f = scanUserFacingProse(text);
      if (!f.empty()) {
        std::printf("  %s: \"%s\"\n        %s\n", what, text.c_str(),
                    describeProseFindings(f).c_str());
      }
      CHECK(f.empty());
    };

    const std::vector<std::string> ids = app.shell.registry().ids();
    CHECK(ids.size() >= 40);
    for (const std::string& id : ids) {
      const CommandDescriptor* d = app.shell.registry().find(id);
      CHECK(d != nullptr);
      if (d == nullptr) continue;
      expect("signature", d->signature.describeForUser());
      expect("label", d->label);
      expect("category", d->category);
      for (DispatchStatus st : {DispatchStatus::Ok, DispatchStatus::UnknownCommand,
                                DispatchStatus::SelectionSignatureMismatch,
                                DispatchStatus::Disabled,
                                DispatchStatus::MissingRequiredParameter,
                                DispatchStatus::NoHandler, DispatchStatus::EditRefused}) {
        // Both with and without a detail, because two branches append one.
        expect("explainUnavailable", explainUnavailable(id, d, st, "", {}, &app.shell.selection()));
        expect("explainUnavailable+detail",
               explainUnavailable(id, d, st, "the internal cause", {}, &app.shell.selection()));
      }
    }
    // Unknown ids go through the same explainer and must not quote themselves.
    for (const char* strange : {"part.no_such_command", "app.load_sample", ""}) {
      const std::string sentence = explainUnavailable(strange, nullptr,
                                                      DispatchStatus::UnknownCommand, "", {},
                                                      &app.shell.selection());
      expect("explainUnavailable(unknown)", sentence);
      if (strange[0] != 0) CHECK(sentence.find(strange) == std::string::npos);
    }

    // The tool catalogue, and the surface item built from it, with the selection
    // both empty and populated -- the reason field only exists when a command
    // refuses, so an empty selection is what makes most of them speak.
    for (int pass = 0; pass < 2; ++pass) {
      if (pass == 1) {
        EntityRef r;
        r.bodyId = "body";
        r.kind = EntityKind::Face;
        r.persistentName = "face@1";
        app.shell.selection().setFilter(EntityKind::Any);
        app.shell.selection().replaceWith({r});
      }
      const ToolCatalog cat = buildToolCatalog(app.shell.registry(), app.shell.selection(), "");
      CHECK(cat.entries.size() >= 40);
      std::size_t reasons = 0;
      for (const ToolEntry& e : cat.entries) {
        expect("ToolEntry::reason", e.reason);
        expect("ToolEntry::label", e.label);
        if (!e.reason.empty()) ++reasons;
      }
      // A catalogue in which nothing refused would scan nothing.
      if (pass == 0 && reasons < 10) {
        std::printf("  only %zu tool reasons produced -- the corpus is not biting\n", reasons);
      }
      if (pass == 0) CHECK(reasons >= 10);
      expect("describeSelection", describeSelection(app.shell.selection()));
      expect("selectionStatusText", selectionStatusText(app.shell.selection()));
    }
    app.shell.selection().clearSelection();

    // The first card a new user sees, and every sample it offers.
    for (std::size_t features : {std::size_t(0), std::size_t(14)}) {
      const EmptyState st = buildEmptyState(app.shell.registry(), features);
      expect("EmptyState::headline", st.headline);
      expect("EmptyState::body", st.body);
      for (const EmptyStateAction& a : st.creators) {
        expect("EmptyStateAction::label", a.label);
        expect("EmptyStateAction::description", a.description);
      }
      for (const std::string& next : st.nextSteps) expect("EmptyState::nextSteps", next);
    }
    for (const SampleDocument& sample : sampleDocuments()) {
      expect("sample.title", sample.title);
      expect("sample.summary", sample.summary);
      for (const std::string& t : sample.teaches) expect("sample.teaches", t);
    }

    // The plan verdict's own sentence, over every refusal validatePlan can
    // reach. Drawn under "NOT OFFERED" in the CoPilot panel.
    {
      const OpConstraintBridge bridge(generatedVocabulary());
      auto planWith = [](const char* commandId, const char* irOp) {
        Plan plan;
        PlanStep step;
        step.commandId = commandId;
        step.irOp = irOp;
        plan.steps.push_back(std::move(step));
        return plan;
      };
      const Plan kPlans[] = {
          Plan{},
          planWith("part.no_such_command", "FILLET"),
          planWith("part.fillet", "CHAMFER"),
          planWith("part.fillet", "FILLET"),
          planWith("part.primitive_box", "BOX"),
      };
      std::size_t refusals = 0;
      for (const Plan& plan : kPlans) {
        const PlanVerdict v = validatePlan(plan, app.shell.registry(), bridge);
        expect("PlanVerdict::explanation", v.explanation);
        for (const StepVerdict& sv : v.steps) expect("StepVerdict::reason", sv.reason);
        if (v.check != PlanCheck::Ok) ++refusals;
      }
      CHECK(refusals >= 3);
    }
    CHECK(sentences >= 500);
    std::printf("[user_facing_text] %zu runtime sentences scanned\n", sentences);
  }

  return H.finish();
}
