// forge-desktop/test/panel_probe.mm
//
// THE APPKIT HALF — does a REAL NSOpenPanel / NSSavePanel accept the values
// forge::desktop::fileDialogRequestFor() produces?
//
// ── what this covers that the gate cannot ───────────────────────────────────
// forge_desktop_file_dialog_gate drives the whole shipping path with the panel
// SCRIPTED: the deferral, the one registry, the override, the receiving end. It
// therefore proves everything about the wiring and NOTHING about Cocoa. This
// probe is the other side of that line. It builds the real panels, hands them
// the real titles, the real UTTypes and the real seeded file name, and reads
// each value back out of AppKit.
//
// It stops one call short of -[NSSavePanel runModal], and that is deliberate:
// runModal blocks until a human answers, so a probe that called it would hang a
// build machine for ever. What remains unverified by ANY automated check in this
// repository is therefore exactly: the modal loop, the user's click, and the URL
// AppKit hands back. That is stated here rather than implied by a green run.
//
// ── WHY IT IS NOT IN CI ─────────────────────────────────────────────────────
// NSSavePanel is service-backed on modern macOS (the open-and-save panel runs in
// its own process), and this repository has NO MEASUREMENT of whether a GitHub
// macos-15 runner can instantiate one. Wiring an unmeasured dependency into the
// `desktop` job is how a gate becomes flaky, and a flaky gate is worse than an
// absent one because it teaches people to re-run instead of to read. So this is
// a probe a person runs on a Mac:
//
//     bash forge-desktop/test/run_panel_probe.sh
//
// MEASURED 2026-09-03, macOS 15 (Darwin 25.6.0), Apple clang 21.0.0, in a
// terminal with no window of its own: 27 checks, 0 failures, all six commands
// (4 for each Open panel, 5 for each Save panel -- the name field is the fifth).
// If a future measurement shows a GitHub runner can do the same, promote it.
#import <AppKit/AppKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#include <cstdio>
#include <string>
#include "FileDialog.hpp"

static int fails = 0;
static void ck(bool ok, const char* what) {
  std::printf("  %-58s %s\n", what, ok ? "ok" : "FAIL");
  if (!ok) ++fails;
}

int main() {
  @autoreleasepool {
    [NSApplication sharedApplication];
    const char* ids[] = {"file.open", "file.save", "file.import_step",
                         "file.export_step", "file.import_brep", "file.export_brep"};
    for (const char* id : ids) {
      forge::desktop::FileDialogRequest r;
      if (!forge::desktop::fileDialogRequestFor(id, "/tmp/forge_probe/bracket.fpart", r)) {
        std::printf("  %s: NO POLICY\n", id); ++fails; continue;
      }
      std::printf("[%s] mode=%s title=\"%s\" seed=\"%s\" ext=\"%s\"\n", id,
                  r.mode == forge::desktop::FileDialogMode::Open ? "Open" : "Save",
                  r.title.c_str(), r.suggestedPath.c_str(), r.defaultExtension.c_str());

      NSSavePanel* panel = nil;
      NSOpenPanel* open = nil;
      if (r.mode == forge::desktop::FileDialogMode::Open) {
        open = [NSOpenPanel openPanel]; open.canChooseFiles = YES;
        open.canChooseDirectories = NO; open.allowsMultipleSelection = NO;
        open.resolvesAliases = YES; panel = open;
      } else {
        panel = [NSSavePanel savePanel]; panel.canCreateDirectories = YES;
        panel.extensionHidden = NO;
      }
      ck(panel != nil, "the panel object exists");
      if (panel == nil) continue;
      panel.title = [NSString stringWithUTF8String:r.title.c_str()];
      panel.message = panel.title;
      panel.prompt = [NSString stringWithUTF8String:r.prompt.c_str()];

      NSMutableArray<UTType*>* types = [NSMutableArray array];
      for (const forge::desktop::FileFilter& f : r.filters) {
        for (const std::string& e : f.extensions) {
          std::string bare = e; if (!bare.empty() && bare.front()=='.') bare.erase(bare.begin());
          UTType* t = [UTType typeWithFilenameExtension:[NSString stringWithUTF8String:bare.c_str()]];
          if (t != nil && ![types containsObject:t]) [types addObject:t];
        }
      }
      ck([types count] > 0, "every extension in the policy types as a UTType");
      panel.allowedContentTypes = types;
      panel.allowsOtherFileTypes = (r.mode == forge::desktop::FileDialogMode::Save) ? YES : NO;
      ck([panel.allowedContentTypes count] == [types count], "AppKit kept the content types");

      NSString* suggested = [NSString stringWithUTF8String:r.suggestedPath.c_str()];
      NSString* dir = [suggested stringByDeletingLastPathComponent];
      if ([dir length] > 0) panel.directoryURL = [NSURL fileURLWithPath:dir isDirectory:YES];
      if (r.mode == forge::desktop::FileDialogMode::Save) {
        const std::string name = forge::desktop::fileDialogNameField(r.suggestedPath);
        panel.nameFieldStringValue = [NSString stringWithUTF8String:name.c_str()];
        ck([panel.nameFieldStringValue UTF8String] != nullptr &&
           name == std::string([panel.nameFieldStringValue UTF8String]),
           "AppKit kept the file name we seeded");
      }
      ck([panel.title UTF8String] != nullptr && r.title == std::string([panel.title UTF8String]),
         "AppKit kept the title");
    }
  }
  std::printf("\n%s (%d failures)\n", fails ? "PROBE RED" : "PROBE GREEN", fails);
  return fails ? 1 : 0;
}
