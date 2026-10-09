#include "forge/ui/DrawingExport.hpp"

#include <cctype>
#include <cstddef>
#include <string>
#include <vector>

// isUserReadable lives with the exchange messages it was written for; the rule
// belongs to the whole layer, and the success sentence below applies it to the
// one part of itself that came from somewhere else.
#include "forge/ui/FileExchange.hpp"

namespace forge::ui {

const char* toString(DrawingFileFormat format) noexcept {
  switch (format) {
    case DrawingFileFormat::Svg: return "svg";
    case DrawingFileFormat::Dxf: return "dxf";
  }
  return "svg";
}

const std::vector<std::string>& drawingExtensions() {
  static const std::vector<std::string> exts = {".svg", ".dxf"};
  return exts;
}

bool drawingFormatFromPath(const std::string& path, DrawingFileFormat& out) noexcept {
  // No allocation, so `noexcept` is a promise and not a terminate().
  const std::size_t slash = path.find_last_of("/\\");
  const std::size_t dot = path.find_last_of('.');
  if (dot == std::string::npos || (slash != std::string::npos && dot < slash)) return false;
  const auto is = [&](const char* ext) {
    std::size_t i = 0;
    for (; ext[i] != '\0'; ++i) {
      if (dot + i >= path.size()) return false;
      const char c = static_cast<char>(std::tolower(static_cast<unsigned char>(path[dot + i])));
      if (c != ext[i]) return false;
    }
    return dot + i == path.size();
  };
  if (is(".svg")) {
    out = DrawingFileFormat::Svg;
    return true;
  }
  if (is(".dxf")) {
    out = DrawingFileFormat::Dxf;
    return true;
  }
  return false;
}

const char* toString(DrawingExportRefusal refusal) noexcept {
  switch (refusal) {
    case DrawingExportRefusal::None: return "none";
    case DrawingExportRefusal::NoPath: return "no_path";
    case DrawingExportRefusal::NoSource: return "no_source";
    case DrawingExportRefusal::NoDrawing: return "no_drawing";
    case DrawingExportRefusal::UnknownFormat: return "unknown_format";
    case DrawingExportRefusal::WriteFailed: return "write_failed";
    case DrawingExportRefusal::TargetIsDocument: return "target_is_document";
    case DrawingExportRefusal::TargetIsBound: return "target_is_bound";
  }
  return "none";
}

namespace {

std::string quoted(const std::string& path) { return "\"" + path + "\""; }

}  // namespace

std::string drawingExportMessage(DrawingExportRefusal refusal, const std::string& path) {
  const bool hasPath = !path.empty();
  switch (refusal) {
    case DrawingExportRefusal::None:
      return "Nothing went wrong.";
    case DrawingExportRefusal::NoPath:
      return "No file name was given, so there is nothing to save the drawing to.";
    case DrawingExportRefusal::NoSource:
      return "This copy of Forge cannot save drawings yet.";
    case DrawingExportRefusal::NoDrawing:
      return "There is no drawing to save yet. Build the part and choose a sheet in the Title "
             "Block tab, and its views can be saved.";
    case DrawingExportRefusal::UnknownFormat:
      return hasPath ? "Forge saves drawings as SVG or DXF, and " + quoted(path) +
                           " is neither. End the name in .svg or .dxf."
                     : "Forge saves drawings as SVG or DXF. End the name in .svg or .dxf.";
    case DrawingExportRefusal::WriteFailed:
      return hasPath ? "Forge could not write " + quoted(path) +
                           ". The folder may be missing or read-only, or the disk may be full."
                     : "Forge could not write the drawing. The folder may be missing or "
                       "read-only, or the disk may be full.";
    case DrawingExportRefusal::TargetIsDocument:
      return hasPath ? "The drawing goes in a file of its own, so Forge did not write it over "
                       "the part at " + quoted(path) + ". Pick another name."
                     : "The drawing goes in a file of its own, so Forge did not write it over "
                       "the part you have open. Pick another name.";
    case DrawingExportRefusal::TargetIsBound:
      return hasPath ? "This part is built from the file at " + quoted(path) +
                           ", so a drawing written over it would change the part it shows. "
                           "Pick another name."
                     : "This part is built from that file, so a drawing written over it would "
                       "change the part it shows. Pick another name.";
  }
  return "Forge could not save the drawing.";
}

std::string drawingExportSuccessMessage(const DrawingExportReport& report,
                                        const std::string& path) {
  std::string kind = report.format == DrawingFileFormat::Dxf ? "DXF" : "SVG";
  std::string sheet = (!report.sheetLabel.empty() && isUserReadable(report.sheetLabel))
                          ? report.sheetLabel
                          : std::string("the chosen sheet");
  std::string msg = "Saved the drawing as " + kind + ", " + std::to_string(report.views) +
                    " views on " + sheet + " at " + report.scaleText + ", to " + quoted(path) +
                    ".";
  if (report.crowded) {
    msg += " The views do not all fit inside the frame at this scale.";
  }
  return msg;
}

}  // namespace forge::ui
