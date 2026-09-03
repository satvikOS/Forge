#include "forge/ui/ToolCatalog.hpp"

#include <algorithm>
#include <cstddef>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/ActivityLog.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/SelectionService.hpp"

namespace forge::ui {
namespace {

const char* paramTypeName(ParamType t) noexcept {
  switch (t) {
    case ParamType::Number: return "number";
    case ParamType::Text:   return "text";
    case ParamType::Flag:   return "flag";
  }
  return "?";
}

const char* sideEffectName(SideEffectClass s) noexcept {
  switch (s) {
    case SideEffectClass::ViewOnly:    return "view";
    case SideEffectClass::Selection:   return "selection";
    case SideEffectClass::Document:    return "document";
    case SideEffectClass::Application: return "application";
  }
  return "?";
}

const char* undoName(UndoContract u) noexcept {
  switch (u) {
    case UndoContract::NotUndoable: return "none";
    case UndoContract::SingleStep:  return "single";
    case UndoContract::Transaction: return "transaction";
  }
  return "?";
}

}  // namespace

const char* toString(ToolAvailability availability) noexcept {
  switch (availability) {
    case ToolAvailability::Available:       return "available";
    case ToolAvailability::NeedsSelection:  return "needs selection";
    case ToolAvailability::NeedsParameters: return "needs parameters";
    case ToolAvailability::Disabled:        return "disabled";
    case ToolAvailability::Unavailable:     return "unavailable";
  }
  return "unavailable";
}

std::string describeParameters(const CommandDescriptor& command) {
  if (command.schema.empty()) return "-";
  std::string out;
  for (std::size_t i = 0; i < command.schema.size(); ++i) {
    const ParamSpec& p = command.schema[i];
    if (i > 0) out += ", ";
    out += p.name;
    out += ':';
    out += paramTypeName(p.type);
    if (p.required) out += '*';
    if (p.hasDefault) {
      out += '=';
      switch (p.type) {
        case ParamType::Number: out += formatIrNumber(p.defaultNumber); break;
        case ParamType::Text:   out += p.defaultText; break;
        case ParamType::Flag:   out += (p.defaultNumber != 0.0 ? "on" : "off"); break;
      }
    }
  }
  return out;
}

const ToolEntry* ToolCatalog::find(const std::string& id) const noexcept {
  for (const ToolEntry& e : entries) {
    if (e.id == id) return &e;
  }
  return nullptr;
}

ToolCatalog buildToolCatalog(const CommandRegistry& registry, const SelectionService& selection,
                             const std::string& query) {
  ToolCatalog catalog;

  std::vector<std::string> ids;
  if (query.empty()) {
    ids = registry.ids();
  } else if (registry.size() > 0) {
    // The palette's own ranked matcher, uncapped: a catalog that silently
    // dropped the 15th match would disagree with the palette about what exists.
    ids = registry.search(query, registry.size());
  }

  for (const std::string& id : ids) {
    const CommandDescriptor* d = registry.find(id);
    if (d == nullptr) continue;

    ToolEntry e;
    e.id = d->id;
    e.label = d->label;
    e.category = d->category;
    e.featureIrOp = d->featureIrOp.empty() ? "-" : d->featureIrOp;
    e.selection = d->signature.describe();
    e.parameters = describeParameters(*d);
    e.sideEffect = sideEffectName(d->sideEffect);
    e.undo = undoName(d->undo);
    e.version = d->version;

    // What an INTERACTIVE caller would supply: declared defaults filled in,
    // exactly as ForgeShell::invoke() does. Anything still required is a genuine
    // prompt, not a refusal — and the entry says so rather than reading Disabled.
    const CommandParams filled = applyDefaults(*d, CommandParams{});
    e.missing = missingRequired(*d, filled);

    const DispatchResult verdict = registry.evaluate(id, selection, filled);
    e.status = verdict.status;
    if (verdict.ok()) {
      e.availability = ToolAvailability::Available;
    } else {
      switch (verdict.status) {
        case DispatchStatus::SelectionSignatureMismatch:
          e.availability = ToolAvailability::NeedsSelection;
          break;
        case DispatchStatus::MissingRequiredParameter:
          e.availability = ToolAvailability::NeedsParameters;
          break;
        case DispatchStatus::Disabled:
          e.availability = ToolAvailability::Disabled;
          break;
        default:
          e.availability = ToolAvailability::Unavailable;
          break;
      }
      // THE SENTENCE, NOT THE STATUS CODE.
      //
      // This one line put "selection_signature_mismatch: 1..n edge
      // (homogeneous)" on screen in three places -- the menu tooltip's "needs:"
      // row, the greyed line under every command in a panel's list, and the
      // Tools panel -- for 51 of the 84 shipped commands. It also passed the
      // first prose gate, which scanned this exact field, by name, on every
      // command: an all-lower-case identifier was a shape that scanner could
      // not see.
      //
      // explainUnavailable is the SAME explainer the activity log and the
      // ribbon use, so a tooltip and a log line still cannot tell two stories.
      // The machine spelling has not been deleted -- `status` is right here on
      // the entry, and machineName() turns it back into "selection_signature_
      // mismatch" for the Console's detail column and for the agent surface.
      e.reason = explainUnavailable(id, d, verdict.status, verdict.detail, e.missing, &selection);
    }
    catalog.entries.push_back(std::move(e));
  }

  std::sort(catalog.entries.begin(), catalog.entries.end(),
            [](const ToolEntry& a, const ToolEntry& b) {
              if (a.category != b.category) return a.category < b.category;
              return a.id < b.id;
            });

  for (const ToolEntry& e : catalog.entries) {
    if (catalog.categories.empty() || catalog.categories.back() != e.category) {
      catalog.categories.push_back(e.category);
    }
    switch (e.availability) {
      case ToolAvailability::Available:       ++catalog.available; break;
      case ToolAvailability::NeedsSelection:  ++catalog.needsSelection; break;
      case ToolAvailability::NeedsParameters: ++catalog.needsParameters; break;
      case ToolAvailability::Disabled:        ++catalog.disabled; break;
      case ToolAvailability::Unavailable:     ++catalog.unavailable; break;
    }
  }
  return catalog;
}

}  // namespace forge::ui
