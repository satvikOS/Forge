// ui/include/forge/ui/WorkspaceProfile.hpp
//
// The eight workspaces Sacrosanct s19.2 names — Part, Sketch, Assembly, Surface,
// Manufacturing, Drawing, Simulation, Archie. A workspace is a DEFAULT LAYOUT
// plus the command categories that belong in its ribbon; it is not a mode with
// its own command set, because every command still lives in the one registry.
//
// "Deterministic default layouts" is a testable claim: defaultLayout(p) must
// serialize byte-identically on every call and in every process, so a user who
// hits "Reset workspace" lands somewhere predictable.
#ifndef FORGE_UI_WORKSPACEPROFILE_HPP
#define FORGE_UI_WORKSPACEPROFILE_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/DockLayout.hpp"

namespace forge::ui {

enum class WorkspaceProfile : std::uint8_t {
  Part = 0,
  Sketch,
  Assembly,
  Surface,
  Manufacturing,
  Drawing,
  Simulation,
  Archie,
};

inline constexpr std::size_t kWorkspaceProfileCount = 8;

// The slug: "part", "manufacturing". A saved-layout key and a surface context,
// not a label -- a tab that reads "manufacturing" in lower case is showing an
// identifier where a name belongs.
const char* toString(WorkspaceProfile profile) noexcept;
// The name on the tab.
const char* userText(WorkspaceProfile profile) noexcept;
bool workspaceFromString(const std::string& name, WorkspaceProfile& out) noexcept;
std::vector<WorkspaceProfile> allWorkspaceProfiles();

// Deterministic: same bytes every call.
DockLayout defaultLayout(WorkspaceProfile profile);

// Command categories this workspace CLAIMS, sorted. This is the product
// statement — which ribbon a category belongs on — and it is hand-written,
// because "Model belongs to Part, Assembly belongs to Assembly" is knowledge no
// algorithm can derive. Being hand-written is exactly why it can go stale
// against a registry that grows, so it is not what the ribbon renders.
std::vector<std::string> workspaceCategories(WorkspaceProfile profile);

// What the ribbon actually renders: `workspaceCategories(profile)` made TOTAL
// over `registryCategories`. Any category the registry holds that NO workspace
// claims lands on the default (Part) workspace, so a command can never be
// registered into a ribbon-less category.
//
// It could, and did. `registerPartCommands` registers every one of its commands
// (21 at the revision measured below, 31 today) under the category "Part";
// workspaceCategories() named "Model" for the Part workspace
// and "Part" for nothing at all. Measured on 6a7f3aa3: the union of every
// workspace's ribbon was 13 of 34 commands, and the 21 missing ones were every
// command that builds geometry — extrude, revolve, loft, shell, the booleans,
// the patterns, and the RECT/CIRCLE/TRANSLATE trio added to close the profile
// gap. All 34 were still reachable from the menu bar, the palette, the context
// menu and the tool catalog, each of which enumerates the registry directly;
// only the ribbon consulted the hand-written list, and only the ribbon drifted.
//
// `registryCategories` is passed in rather than the registry itself so this
// stays a pure function of two lists — no dependency from the workspace module
// onto the command module, and directly testable against a fabricated category.
std::vector<std::string> ribbonCategories(WorkspaceProfile profile,
                                          const std::vector<std::string>& registryCategories);

// The workspace an unclaimed category falls to. Named rather than spelled
// `WorkspaceProfile::Part` at each use, so the gate and the implementation
// cannot disagree about which ribbon is the catch-all.
inline constexpr WorkspaceProfile kDefaultWorkspace = WorkspaceProfile::Part;

}  // namespace forge::ui

#endif  // FORGE_UI_WORKSPACEPROFILE_HPP
