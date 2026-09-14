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
#include <optional>
#include <string>
#include <vector>

#include "forge/ui/ActivityLog.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/DockLayout.hpp"
#include "forge/ui/FileExchange.hpp"
#include "forge/ui/Keymap.hpp"
#include "forge/ui/KeymapAudit.hpp"
#include "forge/ui/MachineProgram.hpp"
#include "forge/ui/PanelFocus.hpp"
#include "forge/ui/RecentDocuments.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Theme.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/WorkspaceProfile.hpp"

namespace forge::ui {

// ── ★ THE TWO QUESTIONS A WRITE TARGET IS JUDGED BY (T-128) ─────────────────
// Exposed rather than file-local because the SHELL judges a target and the FRAME
// has to raise its Replace question about the SAME target BEFORE dispatching --
// and a box that asks about a different thing from what the shell judges is two
// opinions, which is how this family reached its ninth member.
//
// pathNamesSameFile: "/w/./bracket.fpart" and "/w/bracket.fpart" are one file and
// two strings; so are a symlink and its target, a hard link and its twin, and --
// on the case-insensitive volume this application ships on -- "Bracket.fpart" and
// "bracket.fpart". Answers false when either side is absent or empty.
//
// pathIsOccupied: is anything already sitting there. This is the question T-123
// did not ask; it asked whether the target was a Forge PART, so a user's
// hand-authored STEP was not a part and was replaced in silence.
// fileHoldsForgeDocument: are the first bytes the document magic. Asked of the
// CONTENT and never of the name, because a part a user renamed `bracket.step` is
// still a part nothing but Forge can open -- and because an extension rule is
// the exact shape that let the seventh member of this family through.
bool pathNamesSameFile(const std::string& a, const std::string& b);
bool pathIsOccupied(const std::string& path);
bool fileHoldsForgeDocument(const std::string& path);

// Observable document state, mutated only by registered command handlers.
struct DocumentStats {
  std::size_t features = 0;
  std::size_t undoDepth = 0;
  std::size_t redoDepth = 0;
  std::size_t fitCount = 0;
  std::size_t deletedCount = 0;
  bool wireframe = false;
  bool dirty = false;

  // ── camera requests, on the SAME pull pattern fitCount established ────────
  // These are MONOTONIC COUNTERS, not booleans and not "the camera". The frame
  // builder compares each against its own watermark and applies the difference,
  // which is the pattern that made `view.fit` work for every invoker at once --
  // menu, keystroke, palette, ribbon, macro or an Archie tool call -- with no
  // handler having to push anything at the camera.
  //
  // A boolean would be wrong here for a specific reason: two `view.front`
  // invocations in a row are two requests, and a flag that is already true
  // swallows the second, so re-pressing the key after orbiting away would do
  // nothing. A counter cannot swallow a repeat.
  std::size_t selectionFitCount = 0;  // view.selection -- frame the picked entities
  std::size_t viewOrientCount = 0;    // view.front / .back / .left / .right / ...
  NamedView requestedView = NamedView::Isometric;
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

  // EMPTY, not "new". `documentNew` means File > New, and in the shipped app
  // that seeds a starter part -- which is right for File > New and wrong for
  // anything that is about to write its own statements into the document. Load
  // Sample would otherwise stack a sample's fourteen features on top of the
  // starter part's five and produce a program that is neither.
  //
  // PURE, like the rest of this interface, and for the same reason: a defaulted
  // no-op would let a host silently ignore the request and leave the caller
  // appending onto whatever was already there. A host that cannot empty its
  // document has to say so.
  virtual bool documentReset(std::string& error) = 0;

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

  // ── ★ EVERY FILE THE OPEN DOCUMENT READS OR IS (T-127) ──────────────────
  // documentPath() answers ONE of several, and for eight rounds it was the only
  // one anything could ask about. The application holds at least four: the
  // document's own .fpart (above), the imported body the scene compiles with,
  // the path the .fpart itself records, and the recovery copy. A guard that can
  // reach one of four is a guard with three blind spots, and T-127 is the second
  // of them being measured.
  //
  // Order and duplicates do not matter; "" entries are ignored. A path listed
  // here may not be written over by ANY caller and no consent lifts it, so a
  // host lists a file here when writing over it would change what the open
  // document reads -- not merely when the file is interesting.
  //
  // PURE, like the rest of this interface. A defaulted empty list is the exact
  // shape of the defect: a host that forgets a binding would compile, ship, and
  // be invisible until a user's file was gone. Here it does not compile.
  virtual std::vector<std::string> documentBoundFiles() const = 0;
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

  // ── every command reachable from the keyboard ───────────────────────────
  //
  // THE GAP THIS CLOSES, MEASURED. `defaultKeymaps()` binds 13 commands. The
  // application registry holds 45. So 32 commands — every primitive, every
  // pattern, the booleans, the parameter edit — had no key sequence in ANY of
  // the four profiles: 128 of the 180 command/profile slots were empty.
  // KeymapAudit.hpp shipped `bindUnboundCommands()` to fill exactly that, and
  // NOTHING CALLED IT. A capability with no invoker is not a capability, and a
  // symbol reference is not a call path — there was not even a reference.
  //
  // This is the invoker. It is EXPLICIT rather than automatic because the
  // registry is not complete when ForgeShell is constructed: the host adds its
  // workspace's product commands afterwards (registerPartCommands), so the only
  // moment that can know the map is finishable is the host's.
  //
  // THE INVARIANT, not a call count: call it after BOTH the registry is complete
  // AND any session keymap has been installed — whichever of the two happens
  // last. loadState() REPLACES the map with whatever the file held, and a file
  // written by an older build predates half the registry, so completing before
  // a load is undone by the load. The shipped app satisfies this with one call:
  // main.cpp loads the session file first and ForgeFrame::wirePartCommands()
  // calls this afterwards. A host that loads state later must call it again —
  // which is free, because it is idempotent.
  //
  // Idempotent, never destructive: it only fills gaps, and it skips any
  // candidate Keymap refuses, so it cannot create the prefix conflicts Keymap
  // exists to prevent. Returns how many bindings it added.
  std::size_t completeKeymap();

  // The audit as a value: dead bindings, unbound commands, per-profile gaps and
  // the commands a bare gesture cannot run. Reported, not enforced — a
  // GestureBlocked command is a fact about its schema, not a defect in the map.
  KeymapReport keymapReport() const { return auditKeymap(keymap_, registry_); }
  const DocumentStats& document() const noexcept { return doc_; }

  // ── the FILE-EXCHANGE seam ──────────────────────────────────────────────
  //
  // A SECOND seam rather than three more DocumentHost methods, and the reason is
  // not tidiness. DocumentHost's methods are PURE, ForgeFrame is the application's
  // only implementation of it, and "a file nothing compiles cannot break" is
  // already a measured lesson in this tree: adding a pure virtual there makes the
  // one implementer abstract and breaks a translation unit no forge::ui gate
  // compiles. A separate, separately-installed interface adds nothing to any
  // existing implementer and cannot break one.
  //
  // It is also a different QUESTION. DocumentHost answers "what is the document";
  // this answers "what can the geometry kernel read and write". A build with a
  // document and no kernel is a real configuration -- every headless forge::ui
  // gate is one -- and the file commands below say so by being disabled rather
  // than by failing when pressed.
  void setFileExchange(FileExchange* exchange) noexcept { fileExchange_ = exchange; }
  FileExchange* fileExchange() const noexcept { return fileExchange_; }
  // What the last file.import_* / file.export_* command measured. Volume AND
  // bounding box AND centre of mass AND the face-kind census, because this
  // programme has measured a wrong solid reproducing a right volume four times.
  const ExchangeReport& lastExchange() const noexcept { return lastExchange_; }

  // ── the MANUFACTURING-EGRESS seam ───────────────────────────────────────
  //
  // A THIRD seam, on the same pattern and for the same stated reason as the
  // second: the posted machine program is not the document's geometry, it does
  // not come out of the kernel's exchange module, and adding a method to
  // FileExchange would make its one implementer abstract. It answers a third
  // question -- "is there an operation set up, and what did the post-processor
  // write for it" -- and a build with no CAM panels answers no by leaving
  // file.export_gcode disabled instead of failing when it is pressed.
  void setMachineProgramSource(MachineProgramSource* source) noexcept {
    machineProgramSource_ = source;
  }
  MachineProgramSource* machineProgramSource() const noexcept { return machineProgramSource_; }
  // What the last file.export_gcode wrote, or why it did not.
  const MachineProgramReport& lastMachineProgram() const noexcept { return lastMachineProgram_; }

  // ── the document seam ───────────────────────────────────────────────────
  // Install the owner of the real document. Pass nullptr to detach. The counters
  // are refreshed from the host immediately, and again after every dispatch.
  void setDocumentHost(DocumentHost* host) noexcept;
  DocumentHost* documentHost() const noexcept { return documentHost_; }
  // Why the last file.* command did not do what it says. Empty when it did.
  // `execute` returns void, so this is how a refused open reaches the UI.
  //
  // IT IS STICKY, AND THAT IS WHY THE COUNTER BELOW IS PUBLIC TOO. Only the
  // file, undo/redo and reset commands clear it, so a Part command dispatched
  // after one refused import sees the OLD sentence -- and a caller asking "is it
  // empty" concludes a command that ran perfectly did not. recordDispatch()
  // already states the rule in its own comment ("the COUNTER is what
  // distinguishes a refusal raised by THIS dispatch from one still sitting there
  // from an earlier command") and uses it; the counter was private, so
  // ForgeFrame::invoke could not apply the same rule and tested the string alone.
  // MEASURED in frame_gate: after the file section's refused import, EVERY later
  // command set lastInvokeOk_ = false, which left the parameter sheet standing
  // open on a command that had just run -- and the next gesture on that command
  // then dispatched it TWICE (two sketch points where the user asked for one).
  const std::string& lastDocumentError() const noexcept { return documentError_; }
  std::size_t documentErrorSeq() const noexcept { return documentErrorSeq_; }

  // ── ★ A HUMAN SAID "REPLACE IT" (T-128) ─────────────────────────────────
  // ONE SHOT, PATH-SCOPED, AND GESTURE-SCOPED. It is spent by the next dispatch
  // whether or not that dispatch asked for it, so a consent can never outlive
  // the gesture it was given in and cannot be banked for a later command.
  //
  // WHO MAY CALL IT, and this is the whole of what makes it consent rather than
  // a flag: a surface that has just put the question in front of a person and
  // read their answer. In this application that is exactly two places --
  // ForgeFrame's own Replace question on the typed route, and a native Save
  // panel that came back ACCEPTED on a path that already exists, which AppKit
  // cannot produce without having shown its Replace sheet.
  //
  // A COMMAND PARAMETER IS NOT A MINTER. A macro, a plan step or an Archie tool
  // call setting `path` is a caller naming a file, not a person being asked
  // about one, and treating the two the same is how T-124 destroyed a part
  // through the shipping CoPilot Apply button with errors +0.
  //
  // It lifts OCCUPANCY. It NEVER lifts a binding: see writeTarget().
  void consentToReplace(const std::string& path) { consentedPath_ = path; }
  const std::string& consentedReplacePath() const noexcept { return consentedPath_; }

  // Every file the open document reads or is: the host's own list plus the
  // input file the exchange holds. Public because the frame seeds its file
  // boxes from it -- a box that OPENS on a path the guard will refuse is a trap
  // even when the guard holds, which is half of what T-127 and T-128 were.
  std::vector<std::string> documentBindings() const;

  // ── where the user's parts are ──────────────────────────────────────────
  // Written by the file.open and file.save HANDLERS, so every invoker feeds it
  // by construction: a menu click, Ctrl+O, the palette, `--open` on the command
  // line and an Archie tool call all dispatch the same command. A surface that
  // remembered paths itself would be a second, drifting copy of this list that
  // only the surface it lives on can see.
  //
  // Only a SUCCESSFUL open or save is remembered. A refused open — a path that
  // does not exist, a file that is not a .fpart — leaves the list untouched,
  // because a document that never opened is not a document the user was working
  // on, and offering it back in File > Open Recent would offer a broken path
  // for ever.
  const RecentDocuments& recentDocuments() const noexcept { return recent_; }
  RecentDocuments& recentDocuments() noexcept { return recent_; }

  // ── what happened, and why ──────────────────────────────────────────────
  // EVERY dispatch is recorded here, refusals included, each with the sentence
  // that names the missing selection or parameter. `journal()` below is still
  // the success-only list it always was -- a macro recorder reads that, and
  // adding failures to it would change what a recorded macro replays.
  const ActivityLog& log() const noexcept { return log_; }
  ActivityLog& log() noexcept { return log_; }

  // ── theme ───────────────────────────────────────────────────────────────
  // The MODE is shell state (it persists in saveState); the palette is derived
  // from it on demand, so a session file can never pin an old set of colours.
  ThemeMode themeMode() const noexcept { return themeMode_; }
  void setThemeMode(ThemeMode mode) noexcept { themeMode_ = mode; }
  Theme theme() const { return Theme::forMode(themeMode_); }

  // ── keyboard panel focus ────────────────────────────────────────────────
  // Derived from the dock layout. layout() hands out a mutable reference, so a
  // caller that reshapes the tree must call refreshPanelFocus() -- the ring
  // cannot observe a write it was not told about, and pretending otherwise
  // would make "focus is on a panel that no longer exists" reachable.
  const FocusRing& panelFocus() const noexcept { return panelFocus_; }
  FocusRing& panelFocus() noexcept { return panelFocus_; }
  void refreshPanelFocus() { panelFocus_.rebuild(layout_); }

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

  // What loadState() actually found. A session file is written by ONE build and
  // read by another, and refusing the whole file because it carries a record
  // this build does not know about throws away the user's layouts, keymap and
  // workspace to protect them from one unread line. Unknown RECORD NAMES are
  // skipped and counted here; a MALFORMED KNOWN record is still refused
  // outright, because that one really is corruption.
  struct StateLoadReport {
    bool ok = false;
    std::size_t unknownRecords = 0;
    std::vector<std::string> unknownNames;  // sorted, unique
    std::string error;                      // "" when ok
  };
  StateLoadReport loadStateReport(const std::string& text);

 private:
  void registerCommands();
  // Pulls the counters out of the installed host. A no-op with no host, which is
  // what keeps the host-free behaviour bit-identical.
  void syncDocumentStats();
  // Writes one line into the activity log for a dispatch that has just finished.
  // Called from run() for EVERY outcome, so there is no path that mutates the
  // application and leaves no record of having done so.
  void recordDispatch(const std::string& id, const CommandDescriptor* command,
                      const DispatchResult& result, const CommandParams& params,
                      std::size_t documentErrorSeqBefore);

  // The two file-exchange handlers, written once and invoked by each registered
  // format's command. The command IDs and parameter schemas are still spelled
  // LONGHAND at each registration -- that is what the vocabulary generator reads
  // -- but the BEHAVIOUR is one code path, so "Import STEP" and "Import STL"
  // cannot come to disagree about what a missing file means.
  void runImport(CommandContext& ctx, ExchangeFormat format);
  // `id` is the registry id this handler was registered under, passed in by the
  // registration rather than derived from `format` here: a format->id table in
  // this file would be a second opinion about which command is which, and the
  // write-intent declaration writeTarget() reads lives on the descriptor.
  void runExport(CommandContext& ctx, const std::string& id, ExchangeFormat format);
  // ONE save handler behind BOTH `file.save` and `file.save_as`. The two
  // commands differ in exactly one thing -- whether `path` is required -- and
  // that difference belongs in the two schemas, not in two bodies that can come
  // to disagree about what remembering a document means.
  // ONE body behind file.save and file.save_as. `requirePath` is the only
  // difference between them: Save As with no name is Save, and "" is no name --
  // a required TEXT parameter is satisfied by a present-but-empty one, so the
  // schema cannot refuse it and this does. See the comment over the definition.
  void runSave(CommandContext& ctx, bool requirePath);
  // True when a file command can run at all: an exchange is installed, and (for
  // import) the ONE command that can state an imported body in feature-IR is
  // registered. Offering an Import that cannot put the body in the document is
  // the same defect app.load_sample already refuses to commit.
  bool importAvailable() const noexcept;
  bool exportAvailable() const noexcept;
  // Records the refusal on the shell in the ONE way a file command reports one:
  // the user-readable sentence into documentError_, the sequence bumped, and the
  // same sentence handed to the dispatcher. Returns false, always, so a caller
  // can `return refuseExchange(...)`.
  void refuseExchange(CommandContext& ctx, ExchangeRefusal refusal,
                      ExchangeFormat format, const std::string& path);

  // ── ★★ THE ONE PLACE A CALLER-NAMED WRITE TARGET IS PRODUCED (T-128) ────
  // Returns the path this command must write, or NULLOPT having ALREADY refused
  // it through the right seam for the caller.
  //
  // WHY IT RETURNS THE PATH RATHER THAN ANSWERING A QUESTION ABOUT IT. T-123's
  // predecessor was `bool refuseTargetIsDocument(...)`, a CALL placed "last
  // before the bytes" in the two handlers that had been measured -- and the
  // third handler, `runSave`, sat twenty lines above it in this same file and
  // called nothing. That is T-124, and eight rounds of this family are eight
  // versions of the same omission. A call is what the next handler forgets.
  //
  // This is not a call a handler makes; it is where the handler's path COMES
  // FROM. `ctx.params().text("path")` is read HERE and nowhere else in the
  // writing handlers, so a handler that writes has asked by construction: there
  // is no order of operations to get right and no "last line" to preserve.
  //
  // AND THE INTENT IS READ FROM THE COMMAND, NOT PASSED IN. A command whose
  // descriptor declares WriteIntent::None is REFUSED rather than waved through,
  // so the declaration is load-bearing: delete one and that command stops
  // writing, loudly, instead of quietly losing its guard.
  //
  // THE QUESTION IS OCCUPANCY AND BINDING, NEVER "IS IT THE ORIGINAL".
  // T-123 asked identity (is this the open .fpart) and content (does it start
  // with the document magic). T-128's own gate then asserted that a Save As box
  // moving from bracket.txt to bracket.fpart was safe "because the box now names
  // a file that is NOT the original" -- true, and irrelevant: not-the-original
  // is not not-someone's-part, and one Run took a stranger's part from 2 NOTE /
  // 5 FEATURE / 738 B to 1 / 5 / 635 B with errors +0.
  //
  // `writing` is the exchange format being written, or NULLPTR for the machine
  // program and for the document saves -- neither is an ExchangeFormat and
  // neither must become one.
  std::optional<std::string> writeTarget(CommandContext& ctx, const std::string& id,
                                         const ExchangeFormat* writing);

  // file.export_gcode. Separate from runExport for the reason MachineProgram.hpp
  // gives: a machine program is not the document's geometry and does not travel
  // the FileExchange seam at all.
  void runExportMachineProgram(CommandContext& ctx);
  bool machineProgramAvailable() const noexcept;
  void refuseMachineProgram(CommandContext& ctx, MachineProgramRefusal refusal,
                            const std::string& path, const std::string& advice);

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
  FileExchange* fileExchange_ = nullptr;
  ExchangeReport lastExchange_;
  MachineProgramSource* machineProgramSource_ = nullptr;
  MachineProgramReport lastMachineProgram_;
  // ★ See consentToReplace(). SPENT BY run() ON EVERY DISPATCH, asked for or
  //   not, so it cannot outlive the gesture that minted it.
  std::string consentedPath_;
  std::string documentError_;
  // Bumped every time a handler RAISES a document error. Comparing the counter
  // across a dispatch is what tells the log "this command refused" apart from
  // "an earlier command refused and its message is still sitting there" -- the
  // string alone cannot, because two failed opens leave the same text.
  std::size_t documentErrorSeq_ = 0;
  std::vector<std::string> journal_;
  RecentDocuments recent_;
  ActivityLog log_;
  ThemeMode themeMode_ = ThemeMode::Dark;
  FocusRing panelFocus_;
};

}  // namespace forge::ui

#endif  // FORGE_UI_FORGESHELL_HPP
