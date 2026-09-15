#include "MaterialBundle.hpp"

#include <string>
#include <vector>

// The LGPL library's C interface. Linked DYNAMICALLY (forge-desktop/CMakeLists.txt
// links the SHARED target forge_fcmaterials); nothing from it is compiled here.
#include "forge_fcmat/fcmat_bundle.h"

namespace forge::desktop {

MaterialBundleLoad loadMaterialBundle() {
  MaterialBundleLoad out;
  out.abiVersion = forge_fcmat_abi_version();
  if (out.abiVersion != FORGE_FCMAT_ABI_VERSION) {
    // A library built against a different interface may hand out something this
    // reader would misread. Refusing it keeps the handbook materials working and
    // offers no card at all, rather than cards read wrongly.
    out.problem = "the material library installed with Forge is a different version from the "
                  "one this build expects, so its materials are not offered";
    out.catalogue = forge::ui::MaterialCatalogue::build({});
    return out;
  }
  const std::size_t n = forge_fcmat_file_count();
  std::vector<forge::ui::MaterialLibraryFile> files;
  files.reserve(n);
  for (std::size_t i = 0; i < n; ++i) {
    forge_fcmat_file f{};
    if (forge_fcmat_file_at(i, &f) != 0 || f.path == nullptr || f.bytes == nullptr) {
      out.problem = "the material library could not hand over one of its files";
      out.catalogue = forge::ui::MaterialCatalogue::build({});
      return out;
    }
    files.push_back({std::string(f.path), std::string(f.bytes, f.size)});
  }
  out.filesInLibrary = files.size();
  const char* commit = forge_fcmat_upstream_commit();
  out.catalogue = forge::ui::MaterialCatalogue::build(files, commit == nullptr ? "" : commit);
  if (out.catalogue->cards().empty()) {
    out.problem = "the material library holds no material this build can weigh";
  }
  return out;
}

}  // namespace forge::desktop
