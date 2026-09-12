#include "forge/ui/MachineProgram.hpp"

#include <cstddef>
#include <string>
#include <vector>

// isUserReadable lives with the exchange messages it was written for; the rule it
// encodes belongs to the whole layer, and the success sentence below applies it to
// the one word of itself that came from somewhere else.
#include "forge/ui/FileExchange.hpp"

namespace forge::ui {

const char* toString(MachineProgramRefusal refusal) noexcept {
  switch (refusal) {
    case MachineProgramRefusal::None:        return "none";
    case MachineProgramRefusal::NoPath:      return "no_path";
    case MachineProgramRefusal::NoSource:    return "no_source";
    case MachineProgramRefusal::NoProgram:   return "no_program";
    case MachineProgramRefusal::WriteFailed: return "write_failed";
  }
  return "none";
}

const std::vector<std::string>& machineProgramExtensions() {
  // Canonical FIRST: `.nc` is what a Save panel appends when a user types a bare
  // name. See the header for why all three dialects' suffixes are here and why
  // none of them is reconciled against the chosen dialect.
  static const std::vector<std::string> exts = {".nc", ".gcode", ".ngc", ".tap",
                                                ".h",  ".mpf"};
  return exts;
}

namespace {

// The path, quoted. Quoting matters twice: it tells the user which characters
// are part of the name, and it is what makes isUserReadable() skip the path when
// it looks for source code.
std::string quoted(const std::string& path) { return "\"" + path + "\""; }

}  // namespace

std::string machineProgramMessage(MachineProgramRefusal refusal, const std::string& path) {
  const bool hasPath = !path.empty();
  switch (refusal) {
    case MachineProgramRefusal::None:
      // Reachable only if a caller asks for the message of a refusal that did
      // not happen. It still has to be a sentence: an empty string shown in a
      // status strip reads as the app having nothing to say about a failure.
      return "Nothing went wrong.";
    case MachineProgramRefusal::NoPath:
      return "No file name was given, so there is nothing to save the program to.";
    case MachineProgramRefusal::NoSource:
      return "This copy of Forge cannot write machine programs yet.";
    case MachineProgramRefusal::NoProgram:
      return "There is no machine program yet. Set an operation up on the Post Output "
             "tab and it fills in.";
    case MachineProgramRefusal::WriteFailed:
      return hasPath ? "Forge could not write " + quoted(path) +
                           ". The folder may be read-only, or the disk may be full."
                     : "Forge could not write the machine program. The folder may be "
                       "read-only, or the disk may be full.";
  }
  return "Forge could not save the machine program.";
}

std::string machineProgramSuccessMessage(const std::string& dialect, std::size_t lines,
                                         const std::string& path) {
  // The DIALECT is named because it is the one thing about this file a user can
  // get wrong without noticing: a Heidenhain control fed a Fanuc program does not
  // do something subtly different, it refuses the first line.
  //
  // It arrives from the SOURCE, so it is the one part of this sentence this
  // function did not write -- and it is checked with the same predicate the gate
  // applies to the whole sentence before it is pasted in. A source handing over
  // an identifier degrades the sentence to "the machine program" instead of
  // putting that identifier in front of a machinist.
  const std::string name =
      (!dialect.empty() && isUserReadable(dialect)) ? (dialect + " program") : "machine program";
  return "Saved the " + name + ", " + std::to_string(lines) + " lines, to " + quoted(path) + ".";
}

}  // namespace forge::ui
