// ui/include/forge/ui/ToolCatalog.hpp
//
// THE ARCHIE TOOLS PANEL'S MODEL — the agent-callable surface of the running
// application, rendered from the LIVE command registry and the LIVE selection.
//
// Sacrosanct s19.2 says a menu item, a shortcut, a macro step and an Archie tool
// call are four invokers of ONE command. That claim is only checkable if the
// tool surface is derived from the registry instead of maintained beside it, so
// this builds every entry from CommandRegistry itself and asks
// CommandRegistry::evaluate() — the same call dispatch makes — whether each one
// could run right now. A panel built any other way could disagree with the
// dispatcher, and a tool list that lies about availability is worse than none:
// the agent picks a tool that then refuses.
//
// ui/test/capability_manifest_test.cpp pins WHICH commands exist. This pins what
// a caller is told ABOUT one, including why it cannot run at this instant.
#ifndef FORGE_UI_TOOLCATALOG_HPP
#define FORGE_UI_TOOLCATALOG_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/SelectionService.hpp"

namespace forge::ui {

// Why a tool can or cannot be called right now. These map 1:1 onto the
// DispatchStatus values evaluate() can return before a handler runs, so the
// panel can never invent a reason the dispatcher would not give.
enum class ToolAvailability : std::uint8_t {
  Available,
  NeedsSelection,   // DispatchStatus::SelectionSignatureMismatch
  NeedsParameters,  // a REQUIRED parameter has no declared default
  Disabled,         // the command's own enabled predicate said no
  Unavailable,      // anything else evaluate() refused with
};

const char* toString(ToolAvailability availability) noexcept;

struct ToolEntry {
  std::string id;
  std::string label;
  std::string category;
  std::string featureIrOp;   // "-" when the command emits no feature IR
  std::string selection;     // SelectionSignature::describe()
  std::string parameters;    // "radius:number=1, all:flag" — "-" when there are none
  std::string sideEffect;
  std::string undo;
  std::uint32_t version = 1;

  ToolAvailability availability = ToolAvailability::Unavailable;
  std::string reason;                    // "" exactly when Available
  std::vector<std::string> missing;      // required parameters with no default

  bool callable() const noexcept { return availability == ToolAvailability::Available; }
};

struct ToolCatalog {
  std::vector<ToolEntry> entries;       // sorted by category, then id
  std::vector<std::string> categories;  // sorted, unique, as they appear in `entries`

  std::size_t available = 0;
  std::size_t needsSelection = 0;
  std::size_t needsParameters = 0;
  std::size_t disabled = 0;
  std::size_t unavailable = 0;

  std::size_t size() const noexcept { return entries.size(); }
  const ToolEntry* find(const std::string& id) const noexcept;
};

// Builds the catalog for `registry` as `selection` currently stands. A non-empty
// `query` filters through CommandRegistry::search() — the palette's OWN ranked
// matcher — so the panel's filter and the palette's can never disagree about
// what a query matches.
ToolCatalog buildToolCatalog(const CommandRegistry& registry, const SelectionService& selection,
                             const std::string& query = std::string());

// "radius:number=1, all:flag, name:text*" — `*` marks required, `=v` a default.
std::string describeParameters(const CommandDescriptor& command);

}  // namespace forge::ui

#endif  // FORGE_UI_TOOLCATALOG_HPP
