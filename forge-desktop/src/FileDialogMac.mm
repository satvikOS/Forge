// forge-desktop/src/FileDialogMac.mm
//
// THE NATIVE macOS FILE PANEL — NSOpenPanel and NSSavePanel behind
// forge::desktop::FileDialog.
//
// ── why this is a SEPARATE TRANSLATION UNIT, and Objective-C++ ──────────────
// It is the only file in forge-desktop that imports AppKit, and it is compiled
// into the APPLICATION target alone. Every headless gate links
// forge_desktop_core, which does not contain it: a gate that had to open a modal
// window would be a gate that cannot run on a build machine, and the whole point
// of the FileDialog seam is that the path a panel produces can be scripted.
//
// ── THE MODAL LOOP, AND WHERE IT IS ALLOWED TO RUN ─────────────────────────
// -[NSSavePanel runModal] spins a nested run loop and does not return until the
// user answers. It must run on the main thread, and it must NOT run inside a
// Dear ImGui frame: ForgeFrame::invoke() is reached from inside
// BeginMainMenuBar(), from the ribbon and from inside the dock walk, and every
// one of those is holding a reference into a container the dispatch afterwards
// rebuilds. ForgeFrame therefore DEFERS the panel to the end of build(), and
// this file is only ever entered from there. SDL2 owns the NSApplication, and
// the panel's nested loop pumps the same NSEvent queue SDL is reading, which is
// why the window behind it stays composited while it is up.
//
// ── allowedContentTypes, NOT allowedFileTypes ──────────────────────────────
// NSSavePanel.allowedFileTypes is deprecated as of macOS 12 and this target is
// built with -Wall -Wextra -Werror, so using it would not compile. The
// replacement takes UTTypes; -[UTType typeWithFilenameExtension:] answers a
// dynamic type for a suffix the system has never heard of (".fpart"), which
// filters correctly and is exactly what is wanted here. A suffix it cannot type
// at all is DROPPED rather than substituted, and a request whose filters all
// drop leaves the panel unfiltered: a picker that can select nothing is worse
// than one that shows everything.
#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

#include <memory>
#include <string>

#include "FileDialog.hpp"

namespace forge::desktop {
namespace {

NSString* toNS(const std::string& s) {
  return [NSString stringWithUTF8String:s.c_str()];
}

// Every extension named by every filter in the request, as UTTypes, in order and
// without duplicates. Returns an empty array when nothing could be typed.
NSArray<UTType*>* contentTypesFor(const FileDialogRequest& request) {
  NSMutableArray<UTType*>* types = [NSMutableArray array];
  for (const FileFilter& filter : request.filters) {
    for (const std::string& ext : filter.extensions) {
      // formatExtensions() carries the leading dot; UTType wants it without.
      std::string bare = ext;
      if (!bare.empty() && bare.front() == '.') bare.erase(bare.begin());
      if (bare.empty()) continue;
      UTType* type = [UTType typeWithFilenameExtension:toNS(bare)];
      if (type == nil) continue;
      if ([types containsObject:type]) continue;
      [types addObject:type];
    }
  }
  return types;
}

// The directory a panel should open in, and the name it should start on.
// `suggestedPath` may be absolute, may be a bare file name, and may be empty.
void seedPanel(NSSavePanel* panel, const FileDialogRequest& request) {
  if (request.suggestedPath.empty()) return;
  NSString* suggested = toNS(request.suggestedPath);
  NSString* directory = [suggested stringByDeletingLastPathComponent];
  // A bare name ("untitled.fpart") deletes to "", and setting directoryURL to a
  // URL built from an empty path would send the panel to the process's working
  // directory -- which for a Finder launch is "/". Left unset, the panel opens
  // wherever the user last left it, which is the better answer.
  if ([directory length] > 0) {
    panel.directoryURL = [NSURL fileURLWithPath:directory isDirectory:YES];
  }
  if (request.mode == FileDialogMode::Save) {
    const std::string name = fileDialogNameField(request.suggestedPath);
    if (!name.empty()) panel.nameFieldStringValue = toNS(name);
  }
}

class MacFileDialog final : public FileDialog {
 public:
  FileDialogResult run(const FileDialogRequest& request) override {
    FileDialogResult out;  // accepted == false: a cancel needs no other value
    @autoreleasepool {
      NSSavePanel* panel = nil;
      NSOpenPanel* open = nil;
      if (request.mode == FileDialogMode::Open) {
        open = [NSOpenPanel openPanel];
        open.canChooseFiles = YES;
        open.canChooseDirectories = NO;
        open.allowsMultipleSelection = NO;
        // The command takes ONE path. Resolving an alias here means the file the
        // kernel is handed is the file the user sees, not a link to it.
        open.resolvesAliases = YES;
        panel = open;
      } else {
        panel = [NSSavePanel savePanel];
        panel.canCreateDirectories = YES;
        // The suffix is part of what the command means -- "Save a Copy as STEP"
        // writing `bracket` with no extension gives a file nothing will reopen
        // -- so the panel keeps it visible rather than hiding it behind a
        // checkbox the user has to find.
        panel.extensionHidden = NO;
      }
      panel.title = toNS(request.title);
      panel.message = toNS(request.title);
      if (!request.prompt.empty()) panel.prompt = toNS(request.prompt);

      NSArray<UTType*>* types = contentTypesFor(request);
      if ([types count] > 0) {
        panel.allowedContentTypes = types;
        // A Save panel that refuses every other suffix would stop a user writing
        // `part.stp` from an Export STEP -- .stp IS a STEP file and
        // formatExtensions() lists it, but the popup names one type. The command
        // itself re-checks the suffix (ForgeShell::runExport refuses a format it
        // cannot write), so the panel does not need to be the enforcement point.
        panel.allowsOtherFileTypes = (request.mode == FileDialogMode::Save) ? YES : NO;
      }
      seedPanel(panel, request);

      // MODAL. Returns only when the user has answered; anything other than OK
      // is a CANCEL, which is a no-op all the way back up.
      if ([panel runModal] != NSModalResponseOK) return out;

      NSURL* url = (open != nil) ? open.URLs.firstObject : panel.URL;
      if (url == nil) return out;
      // fileSystemRepresentation, not [url path]: it is the byte sequence the
      // file system itself uses, so a name the user typed in a script Cocoa
      // normalises differently still names the same file when std::ifstream
      // opens it.
      const char* fs = url.fileSystemRepresentation;
      if (fs == nullptr || fs[0] == 0) return out;
      out.accepted = true;
      out.path = fs;
    }
    return out;
  }
};

}  // namespace

std::unique_ptr<FileDialog> makeNativeFileDialog() { return std::make_unique<MacFileDialog>(); }

}  // namespace forge::desktop
