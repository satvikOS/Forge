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

// What an INTERACTIVE invocation did. `promptFor` is the explicit "this command
// needs parameters I have no default for" outcome: a UI opens its dialog on it
// instead of the command failing mute, which is what a shortcut used to do.
struct InvokeOutcome {
  DispatchResult dispatch{};
  std::vector<std::string> promptFor;
  bool ran() const noexcept { return dispatch.ok(); }
  bool needsParameters() const noexcept { return !promptFor.empty(); }
};

// ── the document seam ───────────────────────────────────────────────────────
//
// THE REASON THIS EXISTS. `DocumentStats` below is a set of COUNTERS, and until
// this interface existed they were the only document the shell had: `edit.undo`
// ran `--doc_.undoDepth; ++doc_.redoDepth; if (doc_.features > 0) --doc_.features;`
// and `file.open`'s entire execute body was `doc_.dirty = false;` — it never read
// its own path argument. The application meanwhile owned a REAL document (a
// PartDocument of feature-IR statements with a memento undo stack) that the shell
// could not see, so the status strip reported "features 0 undo 0 redo 0" over a
// document holding real features, and Save wrote nothing anywhere.
//
// The fix is NOT a second registry of file commands in the app — that is exactly
// the "one command, two invokers, two outcomes" defect the single-registry rule
// forbids. It is this: the shell keeps ONE `file.open`, and delegates what that
// command MEANS to whoever owns the document.
//
// `edit.undo` and `edit.redo` now REQUIRE a host. Their counter fallback was a
// second, private undo model that could only move numbers, and it made "there is
// no document to undo" indistinguishable from a successful undo. With no host
// they are disabled and say "no document is open"; the file commands still fall
// back to setting `dirty`, because a shell with no document genuinely has
// nothing to save and that is what the flag then means.
class DocumentHost {
 public:
  virtual ~DocumentHost() = default;

  // Each returns false and fills `error` when it could not do the thing. A host
  // that cannot save must say so; silently succeeding is the failure mode this
  // interface was written to remove.
  virtual bool documentNew(std::string& error) = 0;
  virtual bool documentOpen(const std::string& path, std::string& error) = 0;
  virtual bool documentSave(const std::string& path, std::string& error) = 0;
  virtual bool documentUndo() = 0;
  virtual bool documentRedo() = 0;

  // ── A COMMAND CHANGES THE PICTURE ───────────────────────────────────────
  // Called by ForgeShell::run() after ANY command that dispatched OK and whose
  // descriptor declares sideEffect == Document. The host re-evaluates whatever
  // it derives from the document -- for the desktop app that is: emit the IR
  // program, compile it through forge::ft, tessellate, and hand the viewport a
  // new vertex stream.
  //
  // WHY IT IS HERE AND NOT IN THE CALLER. Every mutation of the document goes
  // through one dispatch, so exactly one place has to notice. Before this, the
  // frame builder called its own syncSceneToDocument() from each invocation site
  // it knew about (a menu click, a key press) and once more per frame as a
  // backstop -- so a dispatch from anywhere else (a macro runner, an Archie tool
  // call, a headless script, a gate) changed the document and left the geometry
  // behind until something happened to draw a frame. "A mutation path that
  // forgets to call it" was reachable by construction; now there is no call to
  // forget. It is PURE, not a defaulted no-op: a host that derives nothing from
  // the document still has to say so.
  virtual void documentChanged() = 0;

  // What the status strip reports. Read from the real document every dispatch,
  // never accumulated here, so the two cannot drift apart.
  virtual std::size_t documentFeatureCount() const = 0;
  virtual std::size_t documentUndoDepth() const = 0;
  virtual std::size_t documentRedoDepth() const = 0;
  virtual bool documentDirty() const = 0;
  // The path a bare Save writes to. "" means "never saved"; the host picks one.
  virtual std::string documentPath() const = 0;
};

struct KeyOutcome {
  ResolveStatus resolve = ResolveStatus::Unbound;
  std::string commandId;
  DispatchResult dispatch{};
  std::vector<std::string> promptFor;  // required parameters the UI must collect
  bool ran() const noexcept { return resolve == ResolveStatus::Bound && dispatch.ok(); }
  bool needsParameters() const noexcept { return !promptFor.empty(); }
};

class ForgeShell {
 public:
  ForgeShell();

  const CommandRegistry& registry() const noexcept { return registry_; }
  // Mutable, so a HOST APPLICATION can add its workspace's product commands --
  // registerPartCommands() and friends -- into THE SAME registry the shell
  // dispatches, journals and resolves shortcuts through. Without this the app
  // would need a second registry, which is precisely the "same command, two code
  // paths" failure the single-registry rule exists to prevent (s19.2). It is an
  // accessor, not a second registration path: everything still goes through
  // CommandRegistry::add and its duplicate-ID refusal.
  CommandRegistry& registry() noexcept { return registry_; }
  SelectionService& selection() noexcept { return selection_; }
  const SelectionService& selection() const noexcept { return selection_; }
  const Keymap& keymap() const noexcept { return keymap_; }
  const DocumentStats& document() const noexcept { return doc_; }

  // ── the document seam ───────────────────────────────────────────────────
  // Install the owner of the real document. Pass nullptr to detach. The counters
  // are refreshed from the host immediately, and again after every dispatch.
  void setDocumentHost(DocumentHost* host) noexcept;
  DocumentHost* documentHost() const noexcept { return documentHost_; }
  // Why the last file.* command did not do what it says. Empty when it did.
  // `execute` returns void, so this is how a refused open reaches the UI.
  const std::string& lastDocumentError() const noexcept { return documentError_; }

  // ── workspaces ──────────────────────────────────────────────────────────
  WorkspaceProfile workspace() const noexcept { return workspace_; }
  // Switches workspace, saving the outgoing layout first. Returns false when
  // that layout does not survive its own serialize/parse round trip — the saved
  // copy is then dropped rather than kept in a form that comes back corrupt.
  bool setWorkspace(WorkspaceProfile profile);
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
  // tool call all land here. run() is the RAW path: a macro and an Archie tool
  // call state every argument, so nothing is filled in for them.
  DispatchResult run(const std::string& id, const CommandParams& params = {});

  // The INTERACTIVE path — a shortcut, a menu item, a toolbar button. The user
  // supplied a gesture, not a parameter list, so declared schema defaults are
  // filled in and anything still required is reported for the UI to prompt for.
  // Both paths dispatch through run(), so both land in the same journal.
  InvokeOutcome invoke(const std::string& id, const CommandParams& overrides = {});
  const std::vector<std::string>& journal() const noexcept { return journal_; }

  // ── monitors ────────────────────────────────────────────────────────────
  RecoveryReport monitorsChanged(const std::vector<MonitorInfo>& available);

  // ── persistence ─────────────────────────────────────────────────────────
  std::string saveState() const;
  bool loadState(const std::string& text);

 private:
  void registerCommands();
  // Pulls the counters out of the installed host. A no-op with no host, which is
  // what keeps the host-free behaviour bit-identical.
  void syncDocumentStats();

  CommandRegistry registry_;
  SelectionService selection_;
  Keymap keymap_ = defaultKeymaps();
  InputProfile input_ = InputProfile::ForgeNative;
  KeySequence pending_;

  WorkspaceProfile workspace_ = WorkspaceProfile::Part;
  DockLayout layout_ = defaultLayout(WorkspaceProfile::Part);
  std::map<std::string, std::string> savedLayouts_;  // workspace name -> serialized layout

  DocumentStats doc_;
  DocumentHost* documentHost_ = nullptr;
  std::string documentError_;
  std::vector<std::string> journal_;
};

}  // namespace forge::ui

#endif  // FORGE_UI_FORGESHELL_HPP
