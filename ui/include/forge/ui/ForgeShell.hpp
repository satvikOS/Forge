// ui/include/forge/ui/ForgeShell.hpp
//
// The CAD workstation shell: the one object that owns the registry, the typed
// selection, the input profiles, the dock layouts and the feature tree, and
// routes every input through them. It is HEADLESS — no ImGui, no window, no GPU.
// The ImGui frame builder is a consumer of this state, not its owner, which is
// what lets the whole shell be tested in CI without a display.
//
// The journal is the point of the single-registry rule made visible: keyboard,
// menu, palette, macro and Archie tool call all append to the SAME journal
// because they all went through the SAME dispatch.
#ifndef FORGE_UI_FORGESHELL_HPP
#define FORGE_UI_FORGESHELL_HPP

#include <cstddef>
#include <map>
#include <string>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/DockLayout.hpp"
#include "forge/ui/Keymap.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/WorkspaceProfile.hpp"

namespace forge::ui {

// Observable document state, mutated only by registered command handlers.
struct DocumentStats {
  std::size_t features = 0;
  std::size_t undoDepth = 0;
  std::size_t redoDepth = 0;
  std::size_t fitCount = 0;
  std::size_t deletedCount = 0;
  bool wireframe = false;
  bool dirty = false;
};

struct KeyOutcome {
  ResolveStatus resolve = ResolveStatus::Unbound;
  std::string commandId;
  DispatchResult dispatch{};
  bool ran() const noexcept { return resolve == ResolveStatus::Bound && dispatch.ok(); }
};

class ForgeShell {
 public:
  ForgeShell();

  const CommandRegistry& registry() const noexcept { return registry_; }
  SelectionService& selection() noexcept { return selection_; }
  const SelectionService& selection() const noexcept { return selection_; }
  const Keymap& keymap() const noexcept { return keymap_; }
  const DocumentStats& document() const noexcept { return doc_; }

  // ── workspaces ──────────────────────────────────────────────────────────
  WorkspaceProfile workspace() const noexcept { return workspace_; }
  void setWorkspace(WorkspaceProfile profile);   // saves the current layout first
  void resetWorkspaceLayout();                   // back to the deterministic default
  const DockLayout& layout() const noexcept { return layout_; }
  DockLayout& layout() noexcept { return layout_; }

  // ── input ───────────────────────────────────────────────────────────────
  InputProfile inputProfile() const noexcept { return input_; }
  void setInputProfile(InputProfile profile) noexcept;
  KeyOutcome key(const KeyStroke& stroke);  // feeds the pending key sequence
  void cancelPendingSequence() noexcept { pending_.clear(); }
  const KeySequence& pendingSequence() const noexcept { return pending_; }

  // ── dispatch ────────────────────────────────────────────────────────────
  // The single path. A menu click, a palette pick, a macro step and an Archie
  // tool call all land here.
  DispatchResult run(const std::string& id, const CommandParams& params = {});
  const std::vector<std::string>& journal() const noexcept { return journal_; }

  // ── monitors ────────────────────────────────────────────────────────────
  RecoveryReport monitorsChanged(const std::vector<MonitorInfo>& available);

  // ── persistence ─────────────────────────────────────────────────────────
  std::string saveState() const;
  bool loadState(const std::string& text);

 private:
  void registerCommands();

  CommandRegistry registry_;
  SelectionService selection_;
  Keymap keymap_ = defaultKeymaps();
  InputProfile input_ = InputProfile::ForgeNative;
  KeySequence pending_;

  WorkspaceProfile workspace_ = WorkspaceProfile::Part;
  DockLayout layout_ = defaultLayout(WorkspaceProfile::Part);
  std::map<std::string, std::string> savedLayouts_;  // workspace name -> serialized layout

  DocumentStats doc_;
  std::vector<std::string> journal_;
};

}  // namespace forge::ui

#endif  // FORGE_UI_FORGESHELL_HPP
