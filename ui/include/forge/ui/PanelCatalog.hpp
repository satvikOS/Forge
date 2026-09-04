// ui/include/forge/ui/PanelCatalog.hpp
//
// WHAT EACH PANEL IS FOR, IN THE USER'S WORDS — and whether it has content yet.
//
// THE DEFECT THIS EXISTS FOR, MEASURED. The eight default workspaces define 50
// distinct panels between them. WHEN THIS FILE WAS WRITTEN the frame builder
// implemented 23 of them and the other 27 fell through to a single fallback that
// drew this, verbatim, in a shipped build:
//
//   Panel "mates" is docked and laid out by forge::ui::DockLayout, and its
//   position, tab order and active tab persist across restart. Its content is
//   not implemented in this segment.
//
// A user who opens the Mates tab in an assembly wants to know what mates are and
// where they will appear. What they got was the name of a C++ class, a promise
// about a serialisation format, and a note about somebody's development
// schedule. The panel was 27 tabs wide and the sentence was the same in all 27:
// it did not even say what the panel WOULD show, so it told a user nothing at
// all about the one thing they had asked about.
//
// The count is NOT maintained by hand here, and this paragraph is history rather
// than a claim: plannedPanelCount() computes it, the gate prints it on every run,
// and a sentence that has to be edited whenever a panel is finished is a sentence
// that will one day be wrong. Mates was one of the four that fell through, and it
// is one of the four the assembly workflow now draws for real.
//
// ── why the text lives HERE and not in the frame builder ───────────────────
// forge-desktop is compiled by one CI step and RUN by none; ui/ is compiled and
// run headlessly by every gate. Prose that lives in the frame builder can only
// be checked by reading it. Prose that lives here is DATA: a gate enumerates it,
// scans every sentence with scanUserFacingProse(), and asserts that every panel
// the shipped layouts define has one -- so a panel added to a workspace with no
// description turns CI red rather than shipping a blank tab.
//
// ── how many are still empty, and which way that number may move ───────────
// 33 of the 50 are Live as this is written and 17 are still Planned -- it was
// 29/21 one merge ago, and 23/27 when this file was written. That figure
// is not maintained here by hand: ui/test/panel_content_ratchet_test.cpp pins the
// SET of empty panels by name and is red in BOTH directions — a new empty panel
// is a regression, and a panel that gains content is progress that still fails
// until the pin is lowered in the same commit. A pin allowed to sit above the
// truth silently re-admits a regression it has already been lowered past.
//
// ── Live vs Planned is a CLAIM, and the gate checks it ─────────────────────
// `content` says whether the application draws real content for this panel. It
// is not documentation: ui/test/user_facing_text_test.cpp reads the frame
// builder's own dispatch out of forge-desktop/src/ForgeFrame.cpp and requires
// the two to agree. A panel that gains an implementation and is not re-declared
// here goes red, and so does a Planned panel that quietly stops being drawn.
#ifndef FORGE_UI_PANELCATALOG_HPP
#define FORGE_UI_PANELCATALOG_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/DockLayout.hpp"

namespace forge::ui {

enum class PanelContent : std::uint8_t {
  // The application draws real content here from a real model.
  Live,
  // The tab exists, keeps its place in the layout, and says what it is for. It
  // has no content yet. This is a promise to the user, not a note to a
  // developer, and it must read like one.
  Planned,
};

const char* toString(PanelContent content) noexcept;

struct PanelInfo {
  PanelId id;
  // The accessible name. Always equal to panelDisplayName(id) -- kept as a field
  // so a caller has one record to read, and asserted equal by the gate so the
  // two can never drift into naming the same panel two different things.
  std::string name;
  // ONE sentence, in a user's words, saying what this panel shows them. Present
  // for every panel, Live or Planned: a user hovering a tab deserves an answer
  // whether or not the tab is finished.
  std::string purpose;
  PanelContent content = PanelContent::Planned;

  bool live() const noexcept { return content == PanelContent::Live; }
};

// Every panel this application knows about, sorted by id. Deterministic.
const std::vector<PanelInfo>& panelCatalog();

// nullptr when the id is unknown -- a layout saved by a newer build can name a
// panel this one has never heard of, and refusing to answer is better than
// inventing a purpose for it.
const PanelInfo* findPanelInfo(const PanelId& id);

// The union of every panel in every default workspace layout, sorted and unique.
// This is the set a shipped build can actually put in front of somebody.
std::vector<PanelId> defaultLayoutPanelIds();

// How many of defaultLayoutPanelIds() are Planned. The census the release notes
// quote, computed rather than remembered.
std::size_t plannedPanelCount();

}  // namespace forge::ui

#endif  // FORGE_UI_PANELCATALOG_HPP
