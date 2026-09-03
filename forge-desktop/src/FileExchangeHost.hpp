// forge-desktop/src/FileExchangeHost.hpp
//
// THE KERNEL HALF OF FILE EXCHANGE — forge::ui::FileExchange, implemented.
//
// forge::ui declares WHAT the app can open and save and writes every sentence a
// user reads; this class is the only thing that actually calls
// forge::io::importStep / exportStep / importBrep / exportBrep / importStl /
// exportStl and forge::ft::compile on their behalf.
//
// ── it is a SECOND translation unit that sees the kernel ────────────────────
// KernelScene.hpp says "NOTHING else in forge-desktop includes an OCCT or
// forge-kernel header", and that was true of a tree whose only kernel-facing
// question was "what does the viewport draw". File exchange is a different
// question with a different lifetime -- it reads and writes files, holds no
// geometry, and has no scene -- and folding it into KernelScene would have made
// the scene own the file system. So the invariant now reads: KernelScene.cpp and
// FileExchangeHost.cpp are the only translation units that see the kernel. The
// property that mattered is intact: the ImGui frame builder still reaches no
// OCCT header, and every headless gate still links what it needs and no more.
//
// ── NOTHING THROWS ACROSS THIS BOUNDARY ─────────────────────────────────────
// Every forge::io entry point throws on failure, and the messages are written
// for us: "forge.io: STEP read failed for …", "forge.io: IGES export is not
// available in this build. No IGES writer is linked (OCCT TKDEIGES is
// read-only…)". Those strings are correct and they are unshowable. Each call
// below is wrapped, the exception is DISCARDED RATHER THAN FORWARDED, and the
// caller gets an ExchangeRefusal whose sentence forge::ui wrote. That is not
// catch-and-ignore: the refusal is reported, the operation fails, and the
// specific cause is preserved as an enumerator rather than as prose.
#ifndef FORGE_DESKTOP_FILEEXCHANGEHOST_HPP
#define FORGE_DESKTOP_FILEEXCHANGEHOST_HPP

#include <string>

#include "forge/ui/FileExchange.hpp"
#include "forge/ui/PartCommands.hpp"

namespace forge::desktop {

class KernelScene;

class FileExchangeHost final : public forge::ui::FileExchange {
 public:
  // `document` supplies the feature-IR program an export compiles -- the SAME
  // program the viewport is built from, so "save what you see" is true by
  // construction rather than by a second copy of the geometry.
  //
  // `scene` may be null. When it is not, importFile tells it which file the
  // document's `INPUT()` binds, so the next viewport rebuild resolves it. A null
  // scene is a real configuration (a headless gate), and it is the one the round
  // trip is proven in.
  FileExchangeHost(const forge::ui::PartDocument& document, KernelScene* scene);

  bool importFile(const std::string& path, forge::ui::ExchangeFormat format,
                  forge::ui::ExchangeReport& report) override;
  bool exportFile(const std::string& path, forge::ui::ExchangeFormat format,
                  forge::ui::ExchangeReport& report) override;

  // The file the document's `INPUT()` currently binds; "" when none does.
  const std::string& inputFile() const noexcept { return inputFile_; }

  // ── a TEST seam, and only a test seam ───────────────────────────────────
  // Corrupts the NEXT successful write: the bytes are written and then damaged
  // on disk. It exists so the round-trip gate can prove it is capable of going
  // red -- a gate that has never failed has not been shown to be a gate. It is
  // never set by the application: nothing outside the gate calls this.
  // The four mutations are chosen so that NO SINGLE OBSERVABLE catches all of
  // them, which is the whole reason the report carries a vector:
  //   Truncate / EmptyFile / ZeroBody  the file no longer reads back at all
  //   Translate                        volume, area and the face census are
  //                                    BIT-IDENTICAL; only the bounding box and
  //                                    the centre of mass move
  //   SameVolumeCube                   volume AND the centre of mass are
  //                                    identical; the bounding box, the area and
  //                                    the face census differ
  // A gate checking volume alone passes two of these. A gate checking volume and
  // centre of mass still passes one.
  enum class WriteMutation : int {
    None = 0,
    Truncate,       // keep the first half of the file
    ZeroBody,       // blank the tail, keeping the header so the magic still reads
    EmptyFile,      // write nothing at all
    Translate,      // write the right solid in the wrong place
    SameVolumeCube  // write a cube of the same volume, about the same centre
  };
  void setWriteMutation(WriteMutation mutation) noexcept { mutation_ = mutation; }

 private:
  const forge::ui::PartDocument& document_;
  KernelScene* scene_;
  std::string inputFile_;
  WriteMutation mutation_ = WriteMutation::None;
};

}  // namespace forge::desktop

#endif  // FORGE_DESKTOP_FILEEXCHANGEHOST_HPP
