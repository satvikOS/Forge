// forge-desktop/src/AssemblySolverHost.hpp
//
// FORGE'S ADAPTER onto libforge_asmsolver -- the LGPL assembly solver Forge ships
// as a separate dynamic library in Contents/Frameworks.
//
// This file is Forge's own code and lives in Forge's tree. It maps Forge's
// assembly (forge/ui/AssemblyModel.hpp: components with ids and names, joints
// with frames in each component's coordinates, degrees) onto the library's one
// plain-data header (forge_asmsolver/AsmSolver.h: bodies by index, radians) and
// back. Nothing from the solver's internals is visible here, which is the
// property that lets a recipient rebuild and replace the library without
// relinking Forge.
//
// It is ONE of the two instruments an assembly edit is checked by. The other is
// forge::ui::assembly::solveAndVerify, which re-measures whatever this returns
// with Forge's own arithmetic and refuses on any disagreement.
#ifndef FORGE_DESKTOP_ASSEMBLYSOLVERHOST_HPP
#define FORGE_DESKTOP_ASSEMBLYSOLVERHOST_HPP

#include <string>
#include <vector>

#include "forge/ui/AssemblyModel.hpp"

namespace forge::desktop {

class AssemblySolverHost final : public forge::ui::assembly::AssemblySolver {
 public:
  forge::ui::assembly::SolveOutcome solve(const forge::ui::assembly::Assembly& a,
                                          const std::vector<forge::ui::assembly::Drive>& drives) override;
  std::string engineName() const override;

  // FALSE when the library loaded at run time was built against a different
  // layout of its header than this application. solve() then refuses rather
  // than read structs whose shape it cannot trust.
  bool compatible() const noexcept;

  std::size_t solves() const noexcept { return solves_; }

 private:
  std::size_t solves_ = 0;
};

}  // namespace forge::desktop

#endif  // FORGE_DESKTOP_ASSEMBLYSOLVERHOST_HPP
