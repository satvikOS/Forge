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

// ── CAN THE DOCUMENT'S `INPUT()` ACTUALLY READ THIS FILE? ───────────────────
//
// Asked by ForgeFrame::documentOpen about the path a saved .fpart names, and
// answered HERE because this is the translation unit that already owns the
// content sniff the kernel's own opInput performs. The app and the kernel have
// to agree about what a model file is, or an Open accepts a file the rebuild
// then refuses -- which is exactly the failure this enum was added for.
//
// ★ WHY NOT fopen. The first version of that open check asked only whether the
//   name could be opened for reading. MEASURED, all three silently: the .step
//   overwritten with junk, the .step truncated to zero bytes, and an INPUT-FILE
//   naming a DIRECTORY each reported a successful open and then left the user
//   with `%1 = INPUT()`, volume 0.000000 and faces -1 -- the original defect,
//   reproduced through the very guard meant to prevent it. Existence is not
//   readability and readability is not a model.
//
// ★ AND WHY `Unreadable` IS NOT `Missing`. The first version of this enum had
//   four non-usable states and NONE of them meant "it is there and cannot be
//   read", so a failed ifstream was folded into Missing -- whose sentence is
//   "there is no file at that name now" and whose remedy is "put that file back
//   where it was". MEASURED: chmod 000 on a source file produced exactly that
//   sentence, about a file that had never moved, and prescribed a step the user
//   cannot perform on a file that never left. This is reachable on macOS with
//   no exotic setup at all -- a part whose source lives in a TCC-protected
//   ~/Documents, ~/Desktop or ~/Downloads, a file owned by another user, or a
//   network share that has gone away -- and "put it back" is the wrong
//   instruction for every one of them.
enum class InputFileState {
  Usable,      // sniffed as STEP, BREP or STL, and whole
  Missing,     // no file at that name -- the name itself does not resolve
  Unreadable,  // the name resolves and the BYTES cannot be reached (permission)
  Nothing,     // it opens and yields no bytes -- a zero-length file, or a folder
  NotAModel,   // bytes, but not a format `INPUT()` reads
  Truncated,   // the right format, cut short (a BREP cut short SEGFAULTS the reader)
};

InputFileState inputFileState(const std::string& path);

// The half-sentence a refusal quotes, in the user's words and never the
// enumerator's; "" for Usable. It is a clause, not a sentence: the caller owns
// the part that says which file and what to do about it.
std::string inputFileProblem(InputFileState state);

// ── AND THE STEP THAT ACTUALLY HELPS, WHICH IS NOT THE SAME FOR ALL OF THEM ──
// "Put that file back where it was" is the right answer for a file that is GONE
// and the wrong answer for one that is sitting there unreadable or corrupt --
// the user cannot put back a file that never left. The remedy therefore travels
// WITH the problem rather than being written once at the call site, which is how
// the two came to disagree. A full sentence, ending in a full stop.
std::string inputFileRemedy(InputFileState state);

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

  // Binds a file the DOCUMENT names, without reading it -- see the note on the
  // interface. It sets BOTH halves of the binding, this object's and the
  // scene's, because the two are one fact kept in two places and an Open that
  // set only one of them is the half fix that header describes.
  void bindInputFile(const std::string& path) override;

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
    SameVolumeCube, // write a cube of the same volume, about the same centre
    // STL through forge::io::exportStl instead of the tessellation. This is the
    // state the application was in before STL export existed, restored on
    // purpose: that entry point refuses every OCCT-backed body and every body
    // forge::ft::compile produces is one, so the export must fail. It is the
    // "revert the fix and watch it go red" proof, wired in permanently, and it is
    // the only mutation here that targets WHICH WRITER is used rather than what
    // is written.
    StlThroughNativeWriter
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
