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

const char* toString(WorkspaceProfile profile) noexcept;
bool workspaceFromString(const std::string& name, WorkspaceProfile& out) noexcept;
std::vector<WorkspaceProfile> allWorkspaceProfiles();

// Deterministic: same bytes every call.
DockLayout defaultLayout(WorkspaceProfile profile);

// Command categories surfaced by this workspace's ribbon, sorted.
std::vector<std::string> workspaceCategories(WorkspaceProfile profile);

}  // namespace forge::ui

#endif  // FORGE_UI_WORKSPACEPROFILE_HPP
