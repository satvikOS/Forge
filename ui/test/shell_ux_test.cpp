// ui/test/shell_ux_test.cpp — THE FOUR THINGS A PERSON NEEDS THAT ARE NOT COMMANDS.
//
// Feedback (what just happened, and why it failed), status (what is selected and
// what state the document is in), onboarding (what to do with an empty window)
// and the panel focus ring. Plus the theme, because a palette with unreadable
// text is a usability defect that is measurable rather than a matter of taste.
//
// All five modules shipped with no gate at all. This one exists because the
// interesting claim in each is not "it returns a string" but "the string is
// DERIVED from the thing it describes" — the empty state's actions are the
// registry's own no-selection creators, the status line is the shell's own
// counters, and the failure message is the dispatcher's own explanation. A
// hand-written string would pass a smoke test and fail every block below.
//
// ── the standing rule this gate enforces ────────────────────────────────────
// "When a feature fails the user must learn why WITHOUT a debugger." Block (b)
// is that rule made falsifiable: every refusal the dispatcher can produce is
// driven, and each must reach the log with a sentence that names the cause.
#include <algorithm>
#include <cstddef>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/ActivityLog.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/DockLayout.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/Onboarding.hpp"
#include "forge/ui/PanelFocus.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/StatusModel.hpp"
#include "forge/ui/Theme.hpp"
#include "forge/ui/Types.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;

namespace {

struct App {
  ForgeShell shell;
  PartDocument document;
  UndoStack stack;
  App() { registerPartCommands(shell.registry(), document, stack); }
};

EntityRef ref(EntityKind kind, const char* name) {
  EntityRef r;
  r.bodyId = "body.probe";
  r.kind = kind;
  r.persistentName = name;
  return r;
}

bool mentions(const std::string& haystack, const std::string& needle) {
  return haystack.find(needle) != std::string::npos;
}

}  // namespace

int main() {
  forge::uitest::Harness H("shell_ux");

  // ── (a) the log is a RING that admits what it dropped ────────────────────
  // A log that silently discards its oldest entries teaches a user that the
  // thing they are looking for never happened.
  {
    ActivityLog log(3);
    CHECK_EQ_INT(log.capacity(), 3);
    CHECK(log.last() == nullptr);
    CHECK_EQ_INT(log.since(0).size(), 0);

    log.info("a", "first");
    log.warning("b", "second", "detail-b");
    log.error("c", "third");
    CHECK_EQ_INT(log.size(), 3);
    CHECK_EQ_INT(log.dropped(), 0);
    CHECK_EQ_INT(log.recorded(), 3);
    CHECK_EQ_INT(log.count(Severity::Info), 1);
    CHECK_EQ_INT(log.count(Severity::Warning), 1);
    CHECK_EQ_INT(log.count(Severity::Error), 1);
    CHECK_EQ_INT(log.atLeast(Severity::Warning).size(), 2);
    CHECK_EQ_STR(log.entries()[1].render(), "[warning] b  second  (detail-b)");
    CHECK_EQ_STR(log.entries()[0].render(), "[info] a  first");

    log.info("d", "fourth");
    CHECK_EQ_INT(log.size(), 3);
    CHECK_EQ_INT(log.dropped(), 1);
    CHECK_EQ_INT(log.recorded(), 4);
    CHECK_EQ_STR(log.entries()[0].message, "second");
    CHECK(mentions(log.render(), "1 earlier entry dropped"));

    // A `since` cursor survives the drop: sequence numbers are lifetime-unique,
    // so a reader that saw entry 2 is shown 3 and 4 and never re-shown 2.
    CHECK_EQ_INT(log.since(2).size(), 2);
    CHECK_EQ_INT(log.since(4).size(), 0);
    const LogEntry* worst = log.lastAtLeast(Severity::Error);
    CHECK(worst != nullptr);
    if (worst != nullptr) CHECK_EQ_STR(worst->message, "third");

    // clear() drops the ROWS, not the lifetime counters — a sequence that
    // restarted would make an old cursor read entries it has already seen.
    log.clear();
    CHECK_EQ_INT(log.size(), 0);
    CHECK_EQ_INT(log.recorded(), 4);
    log.info("e", "fifth");
    CHECK_EQ_INT(log.entries()[0].sequence, 5);

    // A zero capacity is coerced to one: a log that silently discards
    // everything is the single behaviour a log must never have.
    ActivityLog degenerate(0);
    CHECK_EQ_INT(degenerate.capacity(), 1);
    degenerate.info("x", "kept");
    CHECK_EQ_INT(degenerate.size(), 1);
    // And an empty message is named rather than drawn as a blank row.
    degenerate.info("x", "");
    CHECK_EQ_STR(degenerate.entries()[0].message, "(no message supplied)");
  }

  // ── (b) EVERY refusal reaches the user with a reason ─────────────────────
  // The standing rule, driven: each DispatchStatus a user can provoke is
  // produced through the real shell, and the log line must name the cause. The
  // assertion is on CONTENT, not on non-emptiness — "something failed" is not
  // actionable, and a message that merely echoed the status enum would pass a
  // non-empty check.
  {
    App app;
    const std::size_t before = app.shell.log().size();

    // 1. a selection signature that is not satisfied
    app.shell.selection().clearSelection();
    const InvokeOutcome mismatch = app.shell.invoke("part.fillet");
    CHECK(mismatch.dispatch.status == DispatchStatus::SelectionSignatureMismatch);
    const LogEntry* e1 = app.shell.log().last();
    CHECK(e1 != nullptr);
    if (e1 != nullptr) {
      CHECK(e1->severity == Severity::Warning);
      CHECK_EQ_STR(e1->source, "part.fillet");
      CHECK(mentions(e1->message, "Edge Fillet"));
      CHECK(mentions(e1->message, "edge"));            // the kind it wanted
      CHECK(mentions(e1->message, "nothing selected"));  // what was actually picked
      CHECK(mentions(e1->message, "pick filter"));       // what to DO about it
      // THE OP IS NOT IN THE MESSAGE, and this assertion is the inverse of the
      // one it replaces. The explanation used to end "[op FILLET]" -- the
      // feature-IR op name, appended to every refusal in the application, on the
      // menu tooltip and in the status strip. It was justified here as being
      // "for a bug report", which is the whole defect in one comment: a bug
      // report is written by an engineer, and this string is read by a
      // machinist. The op is still recorded -- it is a field of the descriptor,
      // and the agent surface reports it -- and the MESSAGE now says only what
      // the user can act on. The machine's own spelling of the refusal is still
      // the log's detail column, one line below, which is the one surface in
      // this application that is allowed to talk to a developer.
      CHECK(!mentions(e1->message, "FILLET"));
      CHECK(!mentions(e1->message, "[op"));
      CHECK_EQ_STR(e1->detail, "selection_signature_mismatch");
    }

    // 2. a required parameter with no honest default
    const InvokeOutcome missing = app.shell.invoke("file.open");
    CHECK(missing.dispatch.status == DispatchStatus::MissingRequiredParameter);
    CHECK(missing.needsParameters());
    const LogEntry* e2 = app.shell.log().last();
    CHECK(e2 != nullptr);
    if (e2 != nullptr) {
      CHECK(mentions(e2->message, "path"));
      CHECK(mentions(e2->message, "needs a value"));
    }

    // 3. an id nothing registered
    const InvokeOutcome unknown = app.shell.invoke("part.no_such_command");
    CHECK(unknown.dispatch.status == DispatchStatus::UnknownCommand);
    const LogEntry* e3 = app.shell.log().last();
    CHECK(e3 != nullptr);
    if (e3 != nullptr) {
      CHECK(e3->severity == Severity::Error);
      // NOT the id. This used to require the command id inside the sentence --
      // "there is no command with the id "part.no_such_command" -- nothing in
      // the registry answers to it". The id is still the log entry's SOURCE
      // column, which is where an engineer reads it.
      CHECK(!mentions(e3->message, "part.no_such_command"));
      CHECK(!mentions(e3->message, "registry"));
      CHECK(mentions(e3->message, "version of Forge"));
      CHECK_EQ_STR(e3->source, "part.no_such_command");
    }

    // 4. the enabled predicate refusing
    const InvokeOutcome disabled = app.shell.invoke("edit.undo");  // no host installed
    CHECK(disabled.dispatch.status == DispatchStatus::Disabled);
    CHECK(app.shell.log().size() == before + 4);

    // A SUCCESS is recorded too, so the log is a record of what happened and not
    // only of what went wrong.
    const InvokeOutcome ok = app.shell.invoke("part.sketch_rect");
    CHECK(ok.ran());
    const LogEntry* e5 = app.shell.log().last();
    CHECK(e5 != nullptr);
    if (e5 != nullptr) {
      CHECK(e5->severity == Severity::Info);
      CHECK_EQ_STR(e5->source, "part.sketch_rect");
    }
    // journal() stays SUCCESS-ONLY: a macro recorder reads it, and replaying a
    // refusal is not a macro.
    CHECK_EQ_INT(app.shell.journal().size(), 1);
    CHECK_EQ_STR(forge::uitest::at(app.shell.journal(), 0), "part.sketch_rect");
  }

  // ── (c) severity is the DISPATCHER'S, and each status maps once ──────────
  {
    CHECK(severityOf(DispatchStatus::Ok) == Severity::Info);
    CHECK(severityOf(DispatchStatus::SelectionSignatureMismatch) == Severity::Warning);
    CHECK(severityOf(DispatchStatus::Disabled) == Severity::Warning);
    CHECK(severityOf(DispatchStatus::MissingRequiredParameter) == Severity::Warning);
    // A missing handler and a refused edit are APPLICATION defects, not
    // something the user did wrong, so they are errors and not warnings.
    CHECK(severityOf(DispatchStatus::UnknownCommand) == Severity::Error);
    CHECK(severityOf(DispatchStatus::NoHandler) == Severity::Error);
    CHECK(severityOf(DispatchStatus::EditRefused) == Severity::Error);

    Severity parsed = Severity::Info;
    CHECK(severityFromString("error", parsed));
    CHECK(parsed == Severity::Error);
    CHECK(!severityFromString("catastrophe", parsed));
    CHECK(parsed == Severity::Error);  // unchanged on refusal

    // explainDispatch says NOTHING about a success — a log that narrates every
    // ok is a log nobody reads the errors in.
    DispatchResult good;
    CHECK_EQ_STR(explainDispatch("x", nullptr, good, {}, nullptr), "");
  }

  // ── (d) the selection description COUNTS, it does not enumerate ──────────
  // A 400-face body selected whole must not render four hundred names into a
  // status strip.
  {
    SelectionService sel;
    CHECK_EQ_STR(describeSelection(sel), "nothing selected");
    sel.setFilter(EntityKind::Any);
    sel.add(ref(EntityKind::Face, "face@1"));
    CHECK_EQ_STR(describeSelection(sel), "1 face");
    sel.add(ref(EntityKind::Face, "face@2"));
    CHECK_EQ_STR(describeSelection(sel), "2 faces");
    sel.add(ref(EntityKind::Edge, "edge@9"));
    CHECK_EQ_STR(describeSelection(sel), "1 edge and 2 faces");

    std::vector<EntityRef> many;
    for (int i = 0; i < 400; ++i) {
      many.push_back(ref(EntityKind::Face, ("face@" + std::to_string(i)).c_str()));
    }
    sel.replaceWith(many);
    const std::string text = describeSelection(sel);
    CHECK_EQ_STR(text, "400 faces");
    CHECK(text.size() < 40);
  }

  // ── (e) progress is honest about what it does not know ───────────────────
  {
    ProgressTracker p;
    CHECK(!p.active());
    CHECK_EQ_STR(p.text(), "");
    CHECK_NEAR(p.state().fraction(), 0.0, 1e-12);

    p.begin("Rebuilding", 14);
    p.step(7);
    CHECK(p.active());
    CHECK(!p.state().indeterminate());
    CHECK_NEAR(p.state().fraction(), 0.5, 1e-12);
    CHECK_EQ_STR(p.text(), "Rebuilding  7 / 14  (50%)");
    p.end();
    CHECK(!p.active());
    CHECK_EQ_INT(p.begun(), 1);
    CHECK_EQ_INT(p.ended(), 1);

    // total == 0 means the work is real and the count is not. A tracker that
    // faked a percentage here would draw a bar that lies.
    p.begin("Compiling");
    CHECK(p.state().indeterminate());
    CHECK_NEAR(p.state().fraction(), 0.0, 1e-12);
    CHECK_EQ_STR(p.text(), "Compiling  (working)");
    p.setLabel("Tessellating");
    CHECK(mentions(p.text(), "Tessellating"));
    p.end();
    CHECK_EQ_INT(p.begun(), 2);
  }

  // ── (f) the status summary is DERIVED from the shell ─────────────────────
  {
    App app;
    ProgressTracker progress;
    StatusSummary idle = buildStatusSummary(app.shell, progress);
    CHECK_EQ_STR(idle.workspace, toString(app.shell.workspace()));
    CHECK_EQ_STR(idle.inputProfile, toString(app.shell.inputProfile()));
    CHECK_EQ_STR(idle.filter, toString(app.shell.selection().filter()));
    CHECK(mentions(idle.selection, "nothing selected"));
    CHECK(mentions(idle.document, "features 0"));
    CHECK_EQ_STR(idle.progress, "");
    CHECK(idle.severity == Severity::Info);
    CHECK(!idle.message.empty());  // "Ready", never a blank strip

    // Change the shell; the summary follows, because it reads the shell rather
    // than accumulating its own copy.
    app.shell.setInputProfile(InputProfile::BlenderLike);
    app.shell.setWorkspace(WorkspaceProfile::Sketch);
    app.shell.selection().setFilter(EntityKind::Edge);
    app.shell.selection().replaceWith({ref(EntityKind::Edge, "edge@7")});
    app.shell.selection().setFocus(ref(EntityKind::Edge, "edge@7"));
    progress.begin("Rebuilding", 4);
    progress.step(1);

    const StatusSummary live = buildStatusSummary(app.shell, progress, "length 40.000 mm");
    CHECK_EQ_STR(live.inputProfile, "blender-like");
    CHECK_EQ_STR(live.workspace, "sketch");
    CHECK_EQ_STR(live.filter, "edge");
    CHECK(mentions(live.selection, "1 edge"));
    CHECK(mentions(live.selection, "edge@7"));
    CHECK_EQ_STR(live.measurement, "length 40.000 mm");
    CHECK(mentions(live.progress, "Rebuilding"));
    // A measurement the host does not have is "-", never an invented zero.
    CHECK_EQ_STR(buildStatusSummary(app.shell, progress).measurement, "-");

    // The last REFUSAL is what the strip shows, and it carries its severity so a
    // renderer can colour it without re-deriving the reason.
    app.shell.selection().clearSelection();
    app.shell.invoke("part.fillet");
    const StatusSummary after = buildStatusSummary(app.shell, progress);
    CHECK(after.severity == Severity::Warning);
    CHECK(mentions(after.message, "Edge Fillet"));

    // Eliding keeps the TAIL, because that is where a path and a failure reason
    // say what happened, and it never exceeds the budget.
    const std::string elided = after.elidedMessage(30);
    CHECK(elided.size() <= 30);
    CHECK(mentions(elided, "..."));
    // A budget wider than the message leaves it alone.
    CHECK_EQ_STR(after.elidedMessage(4096), after.message);
  }

  // ── (g) the empty state is DERIVED, not written down ─────────────────────
  {
    App app;
    const EmptyState empty = buildEmptyState(app.shell.registry(), 0);
    CHECK(empty.documentEmpty);
    CHECK(!empty.empty());
    CHECK(!empty.headline.empty());
    CHECK(!empty.body.empty());
    CHECK(!empty.creators.empty());
    CHECK(!empty.nextSteps.empty());

    // Every offered action is a REAL command that really needs no selection —
    // the property that makes it a legal first step in an empty document. An
    // empty state offering a command that cannot run is worse than none.
    for (const EmptyStateAction& action : empty.creators) {
      const CommandDescriptor* d = app.shell.registry().find(action.commandId);
      CHECK(d != nullptr);
      if (d == nullptr) continue;
      CHECK(d->signature.kind == EntityKind::None);
      CHECK(!d->featureIrOp.empty());
      CHECK_EQ_STR(action.label, d->label);
      // NOT the op. This used to require the feature-IR op name INSIDE the
      // description, so the first tooltip a new user hovers read
      // "emits BOX — nothing needs to be selected". The op is still a field of
      // the descriptor, checked non-empty two lines above, which is what makes
      // this a creator; it is simply not what the tooltip says.
      CHECK(!mentions(action.description, d->featureIrOp));
      CHECK(!action.description.empty());
      // And it dispatches from a fresh shell, with nothing selected.
      App probe;
      const InvokeOutcome outcome = probe.shell.invoke(action.commandId);
      CHECK(outcome.ran());
    }

    // The set is exactly the registry's no-selection IR emitters — derived, so a
    // new primitive appears in the empty state without anyone editing it.
    std::vector<std::string> expected;
    for (const std::string& id : app.shell.registry().ids()) {
      const CommandDescriptor* d = app.shell.registry().find(id);
      if (d == nullptr || d->featureIrOp.empty()) continue;
      if (d->signature.kind != EntityKind::None) continue;
      expected.push_back(id);
    }
    CHECK_EQ_INT(empty.creators.size(), expected.size());
    for (std::size_t i = 0; i < empty.creators.size() && i < expected.size(); ++i) {
      CHECK_EQ_STR(empty.creators[i].commandId, expected[i]);
    }

    // A document with features is NOT empty, and says so differently.
    const EmptyState populated = buildEmptyState(app.shell.registry(), 5);
    CHECK(!populated.documentEmpty);
    CHECK(mentions(populated.headline, "5"));
    CHECK(populated.headline != empty.headline);

    // A registry with nothing in it must not claim there is something to do.
    CommandRegistry bare;
    const EmptyState nothing = buildEmptyState(bare, 0);
    CHECK(nothing.creators.empty());
    CHECK(!nothing.headline.empty());
  }

  // ── (h) every sample REPLAYS through the registry ────────────────────────
  // Samples are COMMAND SEQUENCES, not pasted IR, which is the only form that
  // cannot drift from what the commands actually emit. Replaying each one is
  // the proof — and comparing against expectedIr is the proof that the recorded
  // text is still what the commands produce today.
  {
    CHECK(!sampleDocuments().empty());
    CHECK_EQ_INT(sampleIds().size(), sampleDocuments().size());
    for (const std::string& id : sampleIds()) {
      const SampleDocument* sample = findSample(id);
      CHECK(sample != nullptr);
      if (sample == nullptr) continue;
      CHECK(!sample->title.empty());
      CHECK(!sample->summary.empty());
      CHECK(!sample->teaches.empty());
      CHECK(!sample->steps.empty());
      CHECK_EQ_INT(sample->statementCount(), sample->steps.size());

      App app;
      const SampleOutcome outcome =
          replaySample(*sample, app.shell.registry(), app.shell.selection(), &app.document);
      CHECK(outcome.ok);
      CHECK_EQ_INT(outcome.stepsRun, sample->steps.size());
      CHECK_EQ_STR(outcome.failedCommand, "");
      CHECK(outcome.status == DispatchStatus::Ok);
      // The IR the commands emit today, against the text recorded with the
      // sample. This is the assertion that fails the day a command changes its
      // argument order.
      CHECK_EQ_STR(outcome.irProgram, sample->expectedIr);
      CHECK_EQ_INT(app.document.featureCount(), sample->steps.size());
      CHECK(!outcome.describe().empty());

      // Every step names a command the registry holds — a sample referring to a
      // renamed command would replay as a refusal, which is exactly what a new
      // user must never meet.
      for (const SampleStep& step : sample->steps) {
        CHECK(app.shell.registry().contains(step.commandId));
      }
    }
    CHECK(findSample("no-such-sample") == nullptr);

    // A sample naming a command nothing registered FAILS and says which — it
    // does not run half a document and report success. This is the negative
    // control for the block above.
    {
      App app;
      SampleDocument broken;
      broken.id = "broken";
      broken.title = "Broken";
      broken.summary = "names a command that does not exist";
      SampleStep step;
      step.commandId = "part.does_not_exist";
      broken.steps.push_back(step);
      const SampleOutcome outcome =
          replaySample(broken, app.shell.registry(), app.shell.selection(), &app.document);
      CHECK(!outcome.ok);
      CHECK_EQ_STR(outcome.failedCommand, "part.does_not_exist");
      CHECK(outcome.status == DispatchStatus::UnknownCommand);
      CHECK(mentions(outcome.describe(), "part.does_not_exist"));
    }
  }

  // ── (i) the focus ring is the dock tree, and it CYCLES ───────────────────
  {
    App app;
    app.shell.refreshPanelFocus();
    const FocusRing& ring = app.shell.panelFocus();
    CHECK(ring.size() > 0);
    CHECK(!ring.focused().empty());

    // Every stop is a real panel with a human name, and the ring's own stops
    // agree with the free function over the same layout.
    //
    // NOT stops.size() == ring.size(): focusStops() reports EVERY panel in the
    // tree, and the ring keeps only the ones a user can currently see, counting
    // the rest as hidden() — a keyboard ring that focused a panel behind an
    // inactive tab would move the focus somewhere invisible. MEASURED on the
    // default Part layout: 8 panels, 4 visible, 4 behind tabs.
    const std::vector<FocusStop> stops = focusStops(app.shell.layout());
    CHECK_EQ_INT(ring.size() + ring.hidden(), stops.size());
    CHECK(ring.hidden() > 0);  // the default layout really does tab some away
    for (const FocusStop& stop : ring.stops()) {
      CHECK(!stop.panelId.empty());
      CHECK(!stop.displayName.empty());
      CHECK(stop.visible);
      // A curated name is a HUMAN name, never the raw id — "3D Viewport", not
      // "viewport_3d". An id shown to a user is an unfinished UI.
      if (hasCuratedPanelName(stop.panelId)) CHECK(stop.displayName != stop.panelId);
    }

    // next() visits every stop and returns to where it started: a ring that
    // ran off its end would strand the keyboard on the last panel.
    const std::string start = ring.focused();
    std::vector<std::string> visited;
    for (std::size_t i = 0; i < ring.size(); ++i) {
      visited.push_back(app.shell.panelFocus().next());
    }
    CHECK_EQ_STR(app.shell.panelFocus().focused(), start);
    std::vector<std::string> sorted = visited;
    std::sort(sorted.begin(), sorted.end());
    CHECK_EQ_INT(std::unique(sorted.begin(), sorted.end()) - sorted.begin(), ring.size());

    // previous() is next()'s inverse.
    const std::string here = app.shell.panelFocus().next();
    CHECK_EQ_STR(app.shell.panelFocus().previous(), start);
    CHECK(here != start || ring.size() == 1);

    // focus() accepts a real panel and REFUSES one that is not in the ring,
    // rather than silently focusing nothing.
    CHECK(app.shell.panelFocus().focus(ring.stops().front().panelId));
    CHECK_EQ_STR(app.shell.panelFocus().focused(), ring.stops().front().panelId);
    CHECK(!app.shell.panelFocus().focus("panel.does_not_exist"));
    CHECK_EQ_STR(app.shell.panelFocus().focused(), ring.stops().front().panelId);

    // An EMPTY ring must not crash and must not invent a focus.
    FocusRing bare;
    CHECK_EQ_INT(bare.size(), 0);
    CHECK_EQ_STR(bare.focused(), "");
    CHECK_EQ_STR(bare.next(), "");
    CHECK_EQ_STR(bare.previous(), "");
    CHECK(bare.focusedStop() == nullptr);

    // Switching workspace reshapes the tree; the ring follows once refreshed.
    app.shell.setWorkspace(WorkspaceProfile::Simulation);
    app.shell.refreshPanelFocus();
    CHECK(app.shell.panelFocus().size() > 0);
  }

  // ── (j) the palette is READABLE, in both modes, measured ─────────────────
  // Contrast is arithmetic, not taste: WCAG relative luminance over the two
  // colours a renderer actually paints on top of each other.
  {
    CHECK_EQ_INT(auditContrast().size(), 0);
    CHECK_EQ_INT(allThemeModes().size(), kThemeModeCount);
    CHECK(!contrastRequirements().empty());

    for (ThemeMode mode : allThemeModes()) {
      const Theme theme = Theme::forMode(mode);
      CHECK(theme.mode() == mode);
      CHECK_EQ_INT(auditContrast(theme).size(), 0);
      // Body text over the window must clear WCAG AA for normal text.
      CHECK(theme.contrast(ColorToken::Text, ColorToken::WindowBg) >= 4.5);
      // Every token is defined: an undefined one comes back as transparent
      // black, which paints as an invisible control rather than as an error.
      for (ColorToken token : allColorTokens()) {
        const Rgba c = theme.color(token);
        CHECK(c.a > 0.0);
        // And it has a name, so a serialized theme names every token it holds.
        CHECK(toString(token)[0] != '\0');
        ColorToken parsedToken = ColorToken::Text;
        CHECK(colorTokenFromString(toString(token), parsedToken));
        CHECK(parsedToken == token);
      }
      // Round trip through the storage format.
      Theme back = Theme::forMode(ThemeMode::Dark);
      const std::string text = theme.serialize();
      CHECK(Theme::parse(text, back));
      CHECK_EQ_STR(back.serialize(), text);
      CHECK(back.mode() == mode);
    }

    // The two modes really differ — a "light" theme equal to the dark one would
    // pass every contrast check and be a defect.
    CHECK(Theme::forMode(ThemeMode::Dark).color(ColorToken::WindowBg) !=
          Theme::forMode(ThemeMode::Light).color(ColorToken::WindowBg));
    CHECK(relativeLuminance(Theme::forMode(ThemeMode::Light).color(ColorToken::WindowBg)) >
          relativeLuminance(Theme::forMode(ThemeMode::Dark).color(ColorToken::WindowBg)));

    // The audit can FAIL — the negative control, without which "0 failures" is
    // an untested claim. contrastRatio is symmetric and bounded by 21:1.
    const Rgba grey = rgbFromHex(0x808080);
    CHECK_NEAR(contrastRatio(grey, grey), 1.0, 1e-9);
    CHECK_NEAR(contrastRatio(rgbFromHex(0xFFFFFF), rgbFromHex(0x000000)), 21.0, 1e-6);
    CHECK_NEAR(contrastRatio(rgbFromHex(0x000000), rgbFromHex(0xFFFFFF)), 21.0, 1e-6);

    ThemeMode parsed = ThemeMode::Dark;
    CHECK(themeModeFromString("light", parsed));
    CHECK(parsed == ThemeMode::Light);
    CHECK(!themeModeFromString("sepia", parsed));
    ColorToken token = ColorToken::Text;
    CHECK(colorTokenFromString("accent", token));
    CHECK(token == ColorToken::Accent);
    CHECK(!colorTokenFromString("chartreuse", token));
  }

  // ── (k) the session file survives a NEWER build's record ─────────────────
  // A file is written by one build and read by another. Discarding the user's
  // workspace, layouts and keymap over one unread line is the failure this
  // tolerance exists to remove — while a MALFORMED KNOWN record is still
  // refused, because that one really is corruption.
  {
    App app;
    app.shell.setThemeMode(ThemeMode::Light);
    app.shell.setInputProfile(InputProfile::CATIALike);
    const std::string state = app.shell.saveState();

    App restored;
    const ForgeShell::StateLoadReport ok = restored.shell.loadStateReport(state);
    CHECK(ok.ok);
    CHECK_EQ_INT(ok.unknownRecords, 0);
    CHECK(restored.shell.themeMode() == ThemeMode::Light);
    CHECK(restored.shell.inputProfile() == InputProfile::CATIALike);
    CHECK_EQ_STR(restored.shell.saveState(), state);

    App tolerant;
    const ForgeShell::StateLoadReport newer =
        tolerant.shell.loadStateReport(state + "record-from-a-newer-build 1 2 3\n");
    CHECK(newer.ok);
    CHECK_EQ_INT(newer.unknownRecords, 1);
    CHECK_EQ_STR(forge::uitest::at(newer.unknownNames, 0), "record-from-a-newer-build");
    CHECK(tolerant.shell.themeMode() == ThemeMode::Light);

    App corrupt;
    const ForgeShell::StateLoadReport bad = corrupt.shell.loadStateReport("not a session file\n");
    CHECK(!bad.ok);
    CHECK(!bad.error.empty());
  }

  return H.finish();
}
