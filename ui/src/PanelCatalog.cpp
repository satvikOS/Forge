#include "forge/ui/PanelCatalog.hpp"

#include <algorithm>
#include <cstddef>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/DockLayout.hpp"
#include "forge/ui/PanelFocus.hpp"
#include "forge/ui/WorkspaceProfile.hpp"

namespace forge::ui {

namespace {

struct Row {
  const char* id;
  const char* purpose;
  PanelContent content;
};

// ── the catalogue ───────────────────────────────────────────────────────────
//
// One sentence each, addressed to the person using the application. The rules
// they are written to, which the gate enforces rather than trusts:
//
//   * say what the USER sees here, not what the program does;
//   * name no class, no library and no file;
//   * for a Planned panel, say what it WILL show -- "not finished" is not an
//     answer to "what is this tab".
//
// ── LIVE IS A CLAIM, AND IT WAS FALSE FOR FOUR OF THESE, TWICE ─────────────
// assembly_tree, operation_tree, study_tree and sheet_tree were all marked Live,
// and all four were: the frame builder dispatched them, together with
// feature_tree, model_browser and sketch_tree, to ONE function that draws the
// FEATURE HISTORY. So the Assembly tab was "live" in the only sense the gate
// could measure -- something was drawn -- while showing a user the build history
// under a name that promised the components of an assembly.
//
// They were then marked Planned, with the reason written here that "nothing in
// this application holds an assembly, a machining setup, a simulation study or a
// drawing sheet: there is no such data to query". That was the SECOND false
// claim, and it is the one that left four workspace tabs drawing nothing at all.
// There is no second document holding those things and there does not need to
// be: an assembly is the bodies this program builds and how they nest, a
// machining setup is the statements that take material away, a drawing sheet is
// the standard sheet and scale this part's measured size needs, and a study is a
// question plus the inputs it is waiting for. All four are readings of the part
// document that already exists -- see forge/ui/WorkspaceTrees.hpp -- and all four
// are Live because all four are now written.
//
// Sorted by id so the table reads as a list and a missing entry is visible.
constexpr Row kRows[] = {
    {"annotation",
     "Notes, balloons and leader text placed on the drawing sheet.",
     PanelContent::Planned},
    {"appearance",
     "What this part would weigh in each material it could be made from, beside the colour that "
     "material is shaded in.",
     PanelContent::Live},
    {"archie_chat",
     "Ask Archie for an edit in plain language and see the plan it offers before anything runs.",
     PanelContent::Live},
    {"archie_copilot",
     "Archie's proposed edit, checked step by step, with Accept and Reject for the whole plan.",
     PanelContent::Live},
    {"archie_plan",
     "Archie's proposed edit, checked step by step, with Accept and Reject for the whole plan.",
     PanelContent::Planned},
    {"archie_tools",
     "Every command Archie is allowed to use, and whether each one could run on what you have "
     "selected right now.",
     PanelContent::Live},
    {"archie_trace",
     "A running record of what Archie and the application did, newest last.",
     PanelContent::Live},
    {"assembly_tree",
     "The components in this assembly and how they are nested.",
     PanelContent::Live},
    {"bom",
     "The parts list for this model: every separate body in it, how many of each, and how much "
     "material each one takes.",
     PanelContent::Live},
    {"component_filter",
     "Show and hide the bodies of a model without deleting anything, and pick one out of a "
     "crowded view.",
     PanelContent::Live},
    {"console",
     "A running record of every command that ran, with the technical detail behind any failure.",
     PanelContent::Live},
    {"constraints",
     "The constraints holding this sketch together, and which of them conflict.",
     PanelContent::Planned},
    {"contacts",
     "Which bodies of this model touch each other, which overlap, and exactly how far apart the "
     "nearest of the others are.",
     PanelContent::Live},
    {"continuity",
     "How smoothly neighbouring surfaces meet, so you can find the joins a customer would see.",
     PanelContent::Planned},
    {"convergence",
     "Whether the study's answer has settled, and how much it is still moving as the mesh gets "
     "finer.",
     PanelContent::Planned},
    {"curve_list",
     "Every curve on this shape with its length, so you can pick one without hunting in the 3D "
     "view.",
     PanelContent::Live},
    {"dimensions",
     "Every number that drives the shape of this part, in one list, so you can find the one you "
     "want to change.",
     PanelContent::Live},
    {"feature_tree",
     "Every feature in this part, in the order it was built. Pick a row to select it, or change "
     "its number to change the shape.",
     PanelContent::Live},
    {"fixtures",
     "How the raw stock is clamped on the machine, and which faces the clamps cover.",
     PanelContent::Planned},
    {"gdt",
     "Geometric tolerances on this drawing: flatness, position, runout and the rest, with the "
     "datums they are measured from.",
     PanelContent::Planned},
    {"interference",
     "Which components in this assembly overlap each other, and by how much.",
     PanelContent::Planned},
    {"isocline",
     "Where a surface tips past a chosen angle, so you can check a part will release from its "
     "mould.",
     PanelContent::Planned},
    {"loads",
     "The forces, pressures and temperatures applied to this study.",
     PanelContent::Planned},
    {"materials",
     "The density of every material this part could be made from, and the weight each one gives "
     "it.",
     PanelContent::Live},
    {"mates",
     "Where the bodies of this model line up: which of them turn about one axis, which sit flush "
     "on one plane, and how far off each one is.",
     PanelContent::Live},
    {"measure",
     "Size, area, volume and centre of the part, and the distance or angle between whatever you "
     "have picked.",
     PanelContent::Live},
    {"model_browser",
     "Everything in this document -- bodies, sketches and features -- in one list you can pick "
     "from.",
     PanelContent::Live},
    {"operation_params",
     "The settings of the machining operation you have selected: depths, speeds, feeds and "
     "stepover.",
     PanelContent::Live},
    {"operation_tree",
     "The machining operations for this part, in the order the machine will run them.",
     PanelContent::Live},
    {"post_output",
     "The machine code produced for this setup, ready to read before you send it to the machine.",
     PanelContent::Planned},
    {"properties",
     "The document you have open and the feature you have picked, with the one number that drives "
     "it.",
     PanelContent::Live},
    {"relations",
     "How the entities in this sketch depend on each other, so you can see what will move when "
     "you drag one.",
     PanelContent::Planned},
    {"restraints",
     "Where this study is held still: the faces that are fixed, pinned or supported.",
     PanelContent::Planned},
    {"sheet_canvas",
     "The drawing sheet itself, with the views, notes and title block laid out as they will "
     "print.",
     PanelContent::Live},
    {"sheet_tree",
     "The sheets in this drawing and the views on each one.",
     PanelContent::Live},
    {"simulation_log",
     "What the machining simulation did, step by step, and anything it stopped on.",
     PanelContent::Live},
    {"sketch_tree",
     "The entities in this sketch -- lines, arcs, circles and points -- in the order you drew "
     "them.",
     PanelContent::Live},
    {"solver_log",
     "What the study's solver did, step by step, and anything it stopped on.",
     PanelContent::Live},
    {"solver_status",
     "Whether this sketch is fully defined, and what is still free to move if it is not.",
     PanelContent::Planned},
    {"stock",
     "The smallest block of raw material this part can be cut from, and how much of that block "
     "is cut away.",
     PanelContent::Live},
    {"study_tree",
     "The simulation studies set up for this part, and what each one is solving for.",
     PanelContent::Live},
    {"timeline",
     "The history of this part as a strip you can roll back through to see how it was built.",
     PanelContent::Live},
    {"title_block",
     "The title block of this drawing: part number, revision, material, scale and who signed it.",
     PanelContent::Planned},
    {"tool_library",
     "The cutting tools available for this setup, with their diameters, flute counts and holders.",
     PanelContent::Planned},
    {"verify_report",
     "Whether the part that was built matches what was asked for, and where it does not.",
     PanelContent::Live},
    {"view_list",
     "The views placed on this drawing sheet, and which part each one is showing.",
     PanelContent::Planned},
    {"viewport_3d",
     "The part in three dimensions. Orbit, pan and zoom here, and click to pick a face or an "
     "edge.",
     PanelContent::Live},
    {"viewport_results",
     "The study's answer shaded onto the part, so you can see where it is highest.",
     PanelContent::Live},
    {"viewport_sketch",
     "The sketch you are drawing, seen square on to its plane.",
     PanelContent::Live},
    {"viewport_toolpath",
     "The cutter's path over the part, so you can watch what the machine will do before it does "
     "it.",
     PanelContent::Live},
    {"zebra_analysis",
     "Striped reflections across a surface, which is the quickest way to see a kink a shaded view "
     "hides.",
     PanelContent::Planned},
};

std::vector<PanelInfo> buildCatalog() {
  std::vector<PanelInfo> out;
  out.reserve(sizeof(kRows) / sizeof(kRows[0]));
  for (const Row& row : kRows) {
    PanelInfo info;
    info.id = row.id;
    // ONE source for the name. Copying it here and letting the two drift is how
    // a tab ends up called one thing on screen and another to a screen reader.
    info.name = panelDisplayName(info.id);
    info.purpose = row.purpose;
    info.content = row.content;
    out.push_back(std::move(info));
  }
  std::sort(out.begin(), out.end(),
            [](const PanelInfo& a, const PanelInfo& b) { return a.id < b.id; });
  return out;
}

}  // namespace

const char* toString(PanelContent content) noexcept {
  switch (content) {
    case PanelContent::Live:    return "live";
    case PanelContent::Planned: return "planned";
  }
  return "planned";
}

const std::vector<PanelInfo>& panelCatalog() {
  static const std::vector<PanelInfo> kCatalog = buildCatalog();
  return kCatalog;
}

const PanelInfo* findPanelInfo(const PanelId& id) {
  const std::vector<PanelInfo>& all = panelCatalog();
  for (const PanelInfo& info : all) {
    if (info.id == id) return &info;
  }
  return nullptr;
}

std::vector<PanelId> defaultLayoutPanelIds() {
  std::vector<PanelId> out;
  for (WorkspaceProfile profile : allWorkspaceProfiles()) {
    const std::vector<PanelId> panels = defaultLayout(profile).panels();
    out.insert(out.end(), panels.begin(), panels.end());
  }
  std::sort(out.begin(), out.end());
  out.erase(std::unique(out.begin(), out.end()), out.end());
  return out;
}

std::size_t plannedPanelCount() {
  std::size_t n = 0;
  for (const PanelId& id : defaultLayoutPanelIds()) {
    const PanelInfo* info = findPanelInfo(id);
    if (info == nullptr || !info->live()) ++n;
  }
  return n;
}

}  // namespace forge::ui
