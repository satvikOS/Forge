// forge-desktop/src/MaterialBundle.hpp
//
// THE SEAM TO THE MATERIAL CARD LIBRARY -- Forge's own glue, in Forge's tree.
//
// FreeCAD's material cards reach this application in ONE place: the separately
// linked, LGPL-licensed libforge_fcmaterials.dylib
// (third_party/freecad-derived/materials), which hands out file contents through a
// four-function C interface and interprets nothing. This file is the only
// translation unit that calls that interface. It checks the library's ABI version,
// copies the files out, and gives them to Forge's own reader
// (forge::ui::MaterialCatalogue), so no Forge type ever crosses into the LGPL
// library and no LGPL code is compiled into this application.
#ifndef FORGE_DESKTOP_MATERIALBUNDLE_HPP
#define FORGE_DESKTOP_MATERIALBUNDLE_HPP

#include <cstddef>
#include <memory>
#include <string>

#include "forge/ui/MaterialCards.hpp"

namespace forge::desktop {

struct MaterialBundleLoad {
  std::shared_ptr<const forge::ui::MaterialCatalogue> catalogue;  // never null
  std::size_t filesInLibrary = 0;
  unsigned abiVersion = 0;
  // Empty when the library loaded. Otherwise why no card is available -- the
  // catalogue is then EMPTY, and Forge's handbook materials still work.
  std::string problem;
};

// Reads every file the library carries and builds the catalogue. Cheap enough to
// call once per frame builder: 127 files, a few milliseconds.
MaterialBundleLoad loadMaterialBundle();

}  // namespace forge::desktop

#endif  // FORGE_DESKTOP_MATERIALBUNDLE_HPP
