// ui/test/selection_service_test.cpp
//
// CONTRACT 3 — typed selection keeps preselection / selection / focus /
// committed as SEPARATE states. The test drives each state and asserts the other
// three are UNCHANGED, which is what fails the moment somebody collapses two of
// them into one member.
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

EntityRef edge(const std::string& name, std::uint64_t generation = 1) {
  return EntityRef{"body_1", EntityKind::Edge, name, generation};
}
EntityRef face(const std::string& name) {
  return EntityRef{"body_1", EntityKind::Face, name, 1};
}

}  // namespace

int main() {
  Harness H("selection_service");

  SelectionService sel;

  // ── the four states start empty and independent ─────────────────────────
  CHECK(!sel.preselection().has_value());
  CHECK_EQ_INT(sel.count(), 0);
  CHECK(!sel.focus().has_value());
  CHECK_EQ_INT(sel.committed().size(), 0);

  // ── PRESELECTION does not disturb selection, focus or committed ─────────
  sel.setPreselection(edge("E_hover"));
  CHECK(sel.preselection().has_value());
  CHECK_EQ_STR(sel.preselection()->persistentName, "E_hover");
  CHECK_EQ_INT(sel.count(), 0);          // hovering picked nothing
  CHECK(!sel.focus().has_value());
  CHECK_EQ_INT(sel.committed().size(), 0);

  sel.setPreselection(edge("E_hover2"));
  CHECK_EQ_STR(sel.preselection()->persistentName, "E_hover2");
  CHECK_EQ_INT(sel.count(), 0);

  // ── SELECTION ───────────────────────────────────────────────────────────
  CHECK(sel.add(edge("E1")));
  CHECK(sel.add(edge("E2")));
  CHECK(!sel.add(edge("E2")));  // idempotent, reported as "no change"
  CHECK_EQ_INT(sel.count(), 2);
  CHECK(sel.contains(edge("E1")));
  CHECK(sel.homogeneous());

  // preselection survived the picks untouched
  CHECK_EQ_STR(sel.preselection()->persistentName, "E_hover2");

  // first pick seeded focus, and focus is a MEMBER of the selection
  CHECK(sel.focus().has_value());
  CHECK_EQ_STR(sel.focus()->persistentName, "E1");
  CHECK(!sel.setFocus(edge("E_not_selected")));       // refused: not a member
  CHECK_EQ_STR(sel.focus()->persistentName, "E1");    // unchanged by the refusal
  CHECK(sel.setFocus(edge("E2")));
  CHECK_EQ_STR(sel.focus()->persistentName, "E2");
  CHECK_EQ_INT(sel.count(), 2);  // moving focus did NOT reselect

  // keyboard cycling wraps and stays inside the selection
  CHECK(sel.advanceFocus(1));
  CHECK_EQ_STR(sel.focus()->persistentName, "E1");
  CHECK(sel.advanceFocus(-1));
  CHECK_EQ_STR(sel.focus()->persistentName, "E2");
  CHECK_EQ_INT(sel.count(), 2);

  // ── COMMITTED is a snapshot, not an alias ───────────────────────────────
  sel.commit();
  CHECK_EQ_INT(sel.committed().size(), 2);

  // The dialog is open. The user now picks something else entirely behind it.
  sel.replaceWith({edge("E7"), edge("E8"), edge("E9")});
  CHECK_EQ_INT(sel.count(), 3);
  CHECK_EQ_INT(sel.committed().size(), 2);  // the open command still sees ITS geometry
  CHECK_EQ_STR(sel.committed()[0].persistentName, "E1");
  CHECK_EQ_STR(sel.committed()[1].persistentName, "E2");

  // Clearing the live selection still does not touch the committed snapshot.
  sel.clearSelection();
  CHECK_EQ_INT(sel.count(), 0);
  CHECK(!sel.focus().has_value());  // focus cannot outlive its selection
  CHECK_EQ_INT(sel.committed().size(), 2);
  CHECK(sel.preselection().has_value());  // and hovering is still its own state

  sel.clearCommitted();
  CHECK_EQ_INT(sel.committed().size(), 0);

  // ── removing the focused member reseats focus, does not orphan it ───────
  sel.replaceWith({edge("A"), edge("B"), edge("C")});
  CHECK(sel.setFocus(edge("B")));
  CHECK(sel.remove(edge("B")));
  CHECK_EQ_INT(sel.count(), 2);
  CHECK(sel.focus().has_value());
  CHECK_EQ_STR(sel.focus()->persistentName, "C");
  CHECK(sel.contains(*sel.focus()));

  // ── the filter makes "pick an edge" mean it ─────────────────────────────
  sel.clearSelection();
  sel.setFilter(EntityKind::Edge);
  CHECK(sel.add(edge("E1")));
  CHECK(!sel.add(face("F1")));  // rejected outright, not silently accepted
  CHECK_EQ_INT(sel.count(), 1);
  CHECK_EQ_INT(sel.countOf(EntityKind::Face), 0);
  sel.setPreselection(face("F1"));
  CHECK(!sel.preselection().has_value());  // hover is filtered too

  sel.setFilter(EntityKind::Any);
  CHECK(sel.add(face("F1")));
  CHECK_EQ_INT(sel.count(), 2);
  CHECK(!sel.homogeneous());

  // ── toggle ──────────────────────────────────────────────────────────────
  CHECK(!sel.toggle(face("F1")));  // was present -> removed, returns false
  CHECK_EQ_INT(sel.count(), 1);
  CHECK(sel.toggle(face("F1")));   // absent -> added
  CHECK_EQ_INT(sel.count(), 2);

  // ── stable references, never raw indices ────────────────────────────────
  // The same persistent name IS the same entity even after the modeller bumps
  // the generation, which is precisely what an index-based selection loses.
  CHECK(edge("E1", 1) == edge("E1", 99));
  CHECK(edge("E1") != edge("E2"));
  CHECK_EQ_STR(edge("E1").key(), "body_1/edge/E1");
  CHECK(edge("E1").valid());
  CHECK(!EntityRef{}.valid());

  // An invalid ref is never admitted to any state.
  sel.clearSelection();
  CHECK(!sel.add(EntityRef{}));
  CHECK_EQ_INT(sel.count(), 0);

  // ── listeners see every state change exactly once ───────────────────────
  SelectionService watched;
  std::size_t preselectionEvents = 0;
  std::size_t selectionEvents = 0;
  std::size_t focusEvents = 0;
  std::size_t committedEvents = 0;
  watched.addListener([&](SelectionChange what) {
    switch (what) {
      case SelectionChange::Preselection: ++preselectionEvents; break;
      case SelectionChange::Selection:    ++selectionEvents; break;
      case SelectionChange::Focus:        ++focusEvents; break;
      case SelectionChange::Committed:    ++committedEvents; break;
    }
  });
  watched.setPreselection(edge("H"));
  watched.setPreselection(edge("H"));  // same ref: no event, no churn
  watched.add(edge("S1"));
  watched.add(edge("S2"));
  watched.setFocus(edge("S2"));
  watched.commit();
  CHECK_EQ_INT(preselectionEvents, 1);
  CHECK_EQ_INT(selectionEvents, 2);
  CHECK_EQ_INT(focusEvents, 1);
  CHECK_EQ_INT(committedEvents, 1);
  CHECK_EQ_INT(watched.notificationCount(), 5);

  return H.finish();
}
