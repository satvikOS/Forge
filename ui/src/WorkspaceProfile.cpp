#include "forge/ui/WorkspaceProfile.hpp"

#include <algorithm>
#include <cstddef>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/DockLayout.hpp"
#include "forge/ui/Types.hpp"

namespace forge::ui {

const char* toString(WorkspaceProfile profile) noexcept {
  switch (profile) {
    case WorkspaceProfile::Part:          return "part";
    case WorkspaceProfile::Sketch:        return "sketch";
    case WorkspaceProfile::Assembly:      return "assembly";
    case WorkspaceProfile::Surface:       return "surface";
    case WorkspaceProfile::Manufacturing: return "manufacturing";
    case WorkspaceProfile::Drawing:       return "drawing";
    case WorkspaceProfile::Simulation:    return "simulation";
    case WorkspaceProfile::Archie:        return "archie";
  }
  return "part";
}

std::vector<WorkspaceProfile> allWorkspaceProfiles() {
  return {WorkspaceProfile::Part,          WorkspaceProfile::Sketch,
          WorkspaceProfile::Assembly,      WorkspaceProfile::Surface,
          WorkspaceProfile::Manufacturing, WorkspaceProfile::Drawing,
          WorkspaceProfile::Simulation,    WorkspaceProfile::Archie};
}

bool workspaceFromString(const std::string& name, WorkspaceProfile& out) noexcept {
  for (WorkspaceProfile p : allWorkspaceProfiles()) {
    if (name == toString(p)) {
      out = p;
      return true;
    }
  }
  return false;
}

namespace {

// The NX/CATIA/Blender shell shape, and the same shape in every workspace so a
// user's spatial memory carries across them: a left browser column, a central
// viewport over a docked bottom strip, and a right properties column.
// Every workspace therefore has exactly 2 + 1 + 3 + 2 = 8 default panels.
DockWindow mainWindow(std::vector<PanelId> left, std::vector<PanelId> centre,
                      std::vector<PanelId> right, std::vector<PanelId> bottom) {
  DockWindow w;
  w.id = 1;
  w.monitor = 1;
  w.rect = Rect{0.0, 0.0, 2560.0, 1440.0};
  w.main = true;
  DockNode centreColumn = DockNode::split(SplitAxis::Vertical, 0.78,
                                          DockNode::tabs(std::move(centre), 0),
                                          DockNode::tabs(std::move(bottom), 0));
  DockNode rightOf = DockNode::split(SplitAxis::Horizontal, 0.76, std::move(centreColumn),
                                     DockNode::tabs(std::move(right), 0));
  w.root = DockNode::split(SplitAxis::Horizontal, 0.18, DockNode::tabs(std::move(left), 0),
                           std::move(rightOf));
  return w;
}

}  // namespace

DockLayout defaultLayout(WorkspaceProfile profile) {
  DockLayout layout;
  switch (profile) {
    case WorkspaceProfile::Part:
      layout.addWindow(mainWindow({"feature_tree", "model_browser"}, {"viewport_3d"},
                                  {"properties", "measure", "appearance"},
                                  {"timeline", "console"}));
      break;
    case WorkspaceProfile::Sketch:
      layout.addWindow(mainWindow({"sketch_tree", "constraints"}, {"viewport_sketch"},
                                  {"dimensions", "properties", "relations"},
                                  {"solver_status", "console"}));
      break;
    case WorkspaceProfile::Assembly:
      layout.addWindow(mainWindow({"assembly_tree", "component_filter"}, {"viewport_3d"},
                                  {"mates", "interference", "properties"}, {"bom", "console"}));
      break;
    case WorkspaceProfile::Surface:
      layout.addWindow(mainWindow({"feature_tree", "curve_list"}, {"viewport_3d"},
                                  {"continuity", "properties", "isocline"},
                                  {"zebra_analysis", "console"}));
      break;
    case WorkspaceProfile::Manufacturing:
      layout.addWindow(mainWindow({"operation_tree", "tool_library"}, {"viewport_toolpath"},
                                  {"operation_params", "stock", "fixtures"},
                                  {"simulation_log", "post_output"}));
      break;
    case WorkspaceProfile::Drawing:
      layout.addWindow(mainWindow({"sheet_tree", "view_list"}, {"sheet_canvas"},
                                  {"annotation", "gdt", "properties"},
                                  {"title_block", "console"}));
      break;
    case WorkspaceProfile::Simulation:
      layout.addWindow(mainWindow({"study_tree", "materials"}, {"viewport_results"},
                                  {"loads", "restraints", "contacts"},
                                  {"convergence", "solver_log"}));
      break;
    case WorkspaceProfile::Archie:
      // "archie_copilot" replaces the placeholder "archie_plan" tab: the CoPilot
      // IS the plan surface -- it shows the op plan, the op-constraint verdict
      // for each line, and the Accept/Reject controls -- so a second tab named
      // Plan would be a tab with nothing left to hold. The count stays at 8
      // (dock_layout_test pins it for every profile) and archie_chat stays where
      // forge_shell_test expects to find it.
      layout.addWindow(mainWindow({"feature_tree", "model_browser"}, {"viewport_3d"},
                                  {"archie_chat", "archie_copilot", "archie_tools"},
                                  {"archie_trace", "verify_report"}));
      break;
  }
  return layout;
}

std::vector<std::string> workspaceCategories(WorkspaceProfile profile) {
  std::vector<std::string> cats{"Application", "Edit", "File", "View"};  // always present
  switch (profile) {
    // Files under BOTH "Model" and "Part". Reachability was MEASURED at 13/34
    // commands on no ribbon in any of the eight workspaces before this; the
    // earlier reading here was that the Part ribbon should be "Part, not Model",
    // which was written before that measurement and would narrow the set again.
    // "Part" as well as "Model": registerPartCommands() files all 31 of its
    // commands (21 when this was measured) under "Part", and the Part workspace is
    // where part modelling happens. It
    // was claimed by no workspace at all, which put every one of those commands
    // on no ribbon in any of the eight workspaces.
    case WorkspaceProfile::Part:          cats.push_back("Model");
                                          cats.push_back("Part"); break;
    case WorkspaceProfile::Sketch:        cats.push_back("Sketch"); break;
    case WorkspaceProfile::Assembly:      cats.push_back("Assembly"); break;
    case WorkspaceProfile::Surface:       cats.push_back("Surface"); break;
    case WorkspaceProfile::Manufacturing: cats.push_back("Manufacturing"); break;
    case WorkspaceProfile::Drawing:       cats.push_back("Drawing"); break;
    case WorkspaceProfile::Simulation:    cats.push_back("Simulation"); break;
    case WorkspaceProfile::Archie:        cats.push_back("Archie"); break;
  }
  std::sort(cats.begin(), cats.end());
  return cats;
}

std::vector<std::string> ribbonCategories(WorkspaceProfile profile,
                                          const std::vector<std::string>& registryCategories) {
  std::vector<std::string> cats = workspaceCategories(profile);
  if (profile == kDefaultWorkspace) {
    // Sweep in every registry category NO workspace claims. Without this, adding
    // a command under a new category name silently puts it on no ribbon: the
    // failure is invisible because the command still exists, still dispatches,
    // and still appears in the menu bar. Claiming it here makes the ribbon TOTAL
    // by construction rather than by a rule somebody has to remember.
    for (const std::string& c : registryCategories) {
      bool claimed = false;
      for (WorkspaceProfile p : allWorkspaceProfiles()) {
        const std::vector<std::string> owned = workspaceCategories(p);
        if (std::find(owned.begin(), owned.end(), c) != owned.end()) { claimed = true; break; }
      }
      if (!claimed && std::find(cats.begin(), cats.end(), c) == cats.end()) cats.push_back(c);
    }
  }
  std::sort(cats.begin(), cats.end());
  return cats;
}

}  // namespace forge::ui
